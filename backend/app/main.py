from __future__ import annotations

import json
import random
import threading
import time
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from .config import PORT, SOURCE_POLL_INTERVAL_MS, SOURCE_POLL_JITTER_MS, SOURCE_POLLING_ENABLED, resolve_cors_origin
from .ingest import build_candidate_from_text, candidate_to_edital, collect_source_candidates, filter_new_candidates
from .services import (
    apply_analysis_to_edital,
    build_analysis,
    build_default_opportunity,
    build_auto_opportunity,
    build_match_records,
    enrich_edital_record,
    generate_chat_bundle,
    ensure_auto_opportunities,
    ensure_matches,
    now_iso,
    summarize_state,
)
from .seed import canonical_sources
from .store import create_id, mutate_state, read_state

SYNCING_SOURCE_IDS: set[str] = set()
SYNCING_LOCK = threading.Lock()
SOURCE_POLL_IN_FLIGHT = False
SOURCE_POLL_LOCK = threading.Lock()


def parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def is_source_due(source: dict, now: datetime) -> bool:
    if source.get("active") is False:
        return False
    last_sync = parse_iso(source.get("lastSyncAt"))
    if last_sync is None:
        return True
    frequency = max(1, int(source.get("frequencyMinutes") or 60))
    due_at = last_sync.timestamp() + frequency * 60
    return due_at <= now.timestamp()


def send_json(handler: BaseHTTPRequestHandler, status: int, payload: dict) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    cors_origin = resolve_cors_origin(handler.headers.get("Origin"))
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Access-Control-Allow-Origin", cors_origin)
    handler.send_header("Vary", "Origin")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
    handler.end_headers()
    handler.wfile.write(body)


def send_text(handler: BaseHTTPRequestHandler, status: int, text: str) -> None:
    body = text.encode("utf-8")
    cors_origin = resolve_cors_origin(handler.headers.get("Origin"))
    handler.send_response(status)
    handler.send_header("Content-Type", "text/plain; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Access-Control-Allow-Origin", cors_origin)
    handler.send_header("Vary", "Origin")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
    handler.end_headers()
    handler.wfile.write(body)


def send_empty(handler: BaseHTTPRequestHandler, status: int = HTTPStatus.NO_CONTENT) -> None:
    cors_origin = resolve_cors_origin(handler.headers.get("Origin"))
    handler.send_response(status)
    handler.send_header("Access-Control-Allow-Origin", cors_origin)
    handler.send_header("Vary", "Origin")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
    handler.send_header("Content-Length", "0")
    handler.end_headers()


def bad_request(handler: BaseHTTPRequestHandler, message: str) -> None:
    send_json(handler, HTTPStatus.BAD_REQUEST, {"error": message})


def not_found(handler: BaseHTTPRequestHandler, message: str = "Not found") -> None:
    send_json(handler, HTTPStatus.NOT_FOUND, {"error": message})


def read_json_body(handler: BaseHTTPRequestHandler) -> dict:
    length = int(handler.headers.get("Content-Length") or 0)
    if length <= 0:
        return {}
    raw = handler.rfile.read(length).decode("utf-8")
    if not raw.strip():
        return {}
    return json.loads(raw)


def deep_merge(target: dict, updates: dict, keys: list[str]) -> dict:
    for key in keys:
        if key in updates:
            target[key] = updates[key]
    target["updatedAt"] = now_iso()
    return target


def get_path_segments(path: str) -> list[str]:
    return [segment for segment in path.split("/") if segment]


def build_edital_from_payload(payload: dict, source_name: str = "Manual") -> dict:
    now = now_iso()
    return {
        "id": create_id("edital"),
        "nome": payload.get("nome") or "Edital sem nome",
        "fonte": payload.get("fonte") or source_name,
        "fonteUrl": payload.get("fonteUrl"),
        "area": payload.get("area") or "Geral",
        "prazo": int(payload.get("prazo") or 0),
        "valor": int(payload.get("valor") or 0),
        "status": payload.get("status") or "Novo",
        "prioridade": payload.get("prioridade") or "Media",
        "compatibilidade": int(payload.get("compatibilidade") or 0),
        "matches": payload.get("matches") or {"artistas": 0, "projetos": 0},
        "resumo": payload.get("resumo") or "",
        "quemPodeParticipar": payload.get("quemPodeParticipar") or "",
        "riscos": list(payload.get("riscos") or []),
        "proximaAcao": payload.get("proximaAcao") or "Revisar manualmente.",
        "descricaoCompleta": payload.get("descricaoCompleta") or "",
        "tags": list(payload.get("tags") or []),
        "sourceId": payload.get("sourceId"),
        "rawKind": payload.get("rawKind"),
        "createdAt": now,
        "updatedAt": now,
    }


def build_opportunity_response_items(items: list[dict]) -> list[dict]:
    return items


def sync_source_by_id(source_id: str) -> dict:
    with SYNCING_LOCK:
        if source_id in SYNCING_SOURCE_IDS:
            return {"ok": False, "status": 409, "error": "Fonte ja esta sendo sincronizada"}
        SYNCING_SOURCE_IDS.add(source_id)

    started_at = now_iso()
    source_name = source_id
    source_record = None

    try:
        state = read_state()
        source_record = next((item for item in state["sources"] if item["id"] == source_id), None)
        if not source_record:
            return {"ok": False, "status": 404, "error": "Fonte nao encontrada"}

        source_name = source_record["name"]
        candidates = collect_source_candidates(source_record)
        unique_candidates = filter_new_candidates(candidates, state["editais"])
        new_editais = []
        for candidate in unique_candidates:
            base_edital = candidate_to_edital(candidate, source_record)
            enriched_edital = enrich_edital_record(
                state,
                base_edital,
                source=source_record,
                raw_text=candidate.get("descricaoCompleta") or candidate.get("resumo"),
            )
            new_editais.append(enriched_edital)
        finished_at = now_iso()

        next_state = mutate_state(
            lambda draft: _apply_source_sync_success(
                draft,
                source_id=source_id,
                source_name=source_name,
                candidates=candidates,
                new_editais=new_editais,
                started_at=started_at,
                finished_at=finished_at,
            )
        )

        next_source = next((item for item in next_state["sources"] if item["id"] == source_id), source_record)
        return {
            "ok": True,
            "status": 200,
            "result": {
                "source": next_source,
                "discoveredCount": len(candidates),
                "createdCount": len(new_editais),
                "editais": new_editais,
            },
        }
    except Exception as exc:
        finished_at = now_iso()
        message = str(exc) or "Falha ao sincronizar fonte"
        mutate_state(
            lambda draft: _apply_source_sync_error(
                draft,
                source_id=source_id,
                source_name=source_name,
                started_at=started_at,
                finished_at=finished_at,
                message=message,
            )
        )
        return {"ok": False, "status": 500, "error": message}
    finally:
        with SYNCING_LOCK:
            SYNCING_SOURCE_IDS.discard(source_id)


def _apply_source_sync_success(
    draft: dict,
    *,
    source_id: str,
    source_name: str,
    candidates: list[dict],
    new_editais: list[dict],
    started_at: str,
    finished_at: str,
) -> dict:
    target_source = next((item for item in draft["sources"] if item["id"] == source_id), None)
    if target_source:
        target_source["lastSyncAt"] = finished_at
        target_source["lastError"] = None
        target_source["updatedAt"] = finished_at

    draft["ingestions"].insert(
        0,
        {
            "id": create_id("ing"),
            "sourceId": source_id,
            "sourceName": source_name,
            "status": "success",
            "discoveredCount": len(candidates),
            "createdCount": len(new_editais),
            "startedAt": started_at,
            "finishedAt": finished_at,
            "error": None,
        },
    )

    for edital in new_editais:
        draft["editais"].insert(0, edital)
        draft["auditLog"].insert(
            0,
            {
                "id": create_id("audit"),
                "type": "edital.ingested",
                "entityId": edital["id"],
                "createdAt": finished_at,
            },
        )

    return draft


def _apply_source_sync_error(
    draft: dict,
    *,
    source_id: str,
    source_name: str,
    started_at: str,
    finished_at: str,
    message: str,
) -> dict:
    target_source = next((item for item in draft["sources"] if item["id"] == source_id), None)
    if target_source:
        target_source["lastSyncAt"] = finished_at
        target_source["lastError"] = message
        target_source["updatedAt"] = finished_at

    draft["ingestions"].insert(
        0,
        {
            "id": create_id("ing"),
            "sourceId": source_id,
            "sourceName": target_source["name"] if target_source else source_name,
            "status": "error",
            "discoveredCount": 0,
            "createdCount": 0,
            "startedAt": started_at,
            "finishedAt": finished_at,
            "error": message,
        },
    )
    return draft


def poll_due_sources(reason: str = "interval") -> dict:
    global SOURCE_POLL_IN_FLIGHT

    with SOURCE_POLL_LOCK:
        if SOURCE_POLL_IN_FLIGHT:
            return {"ok": False, "reason": reason, "skipped": True}
        SOURCE_POLL_IN_FLIGHT = True

    try:
        state = read_state()
        now = datetime.now(timezone.utc)
        due_sources = [source for source in state["sources"] if is_source_due(source, now)]
        results = []
        for source in due_sources:
            results.append({"sourceId": source["id"], **sync_source_by_id(source["id"])})
        return {"ok": True, "reason": reason, "polled": len(due_sources), "results": results}
    finally:
        with SOURCE_POLL_LOCK:
            SOURCE_POLL_IN_FLIGHT = False


def build_source_response(state: dict, source_id: str) -> dict:
    source = next((item for item in state["sources"] if item["id"] == source_id), None)
    ingestions = [item for item in state["ingestions"] if item["sourceId"] == source_id]
    return {"item": source, "ingestions": ingestions}


def get_edital_detail(state: dict, edital_id: str) -> dict | None:
    edital = next((item for item in state["editais"] if item["id"] == edital_id), None)
    if not edital:
        return None
    analysis = edital.get("analysis") or build_analysis(state, edital)
    return {"item": edital, "analysis": analysis}


def list_messages(state: dict, scope: str, entity_id: str) -> list[dict]:
    return list(state.get("chat", {}).get(scope, {}).get(entity_id, []))


class ApiHandler(BaseHTTPRequestHandler):
    server_version = "EditalSalesPython/1.0"

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        return

    def _handle(self) -> None:
        parsed = urlparse(self.path)
        segments = get_path_segments(parsed.path)

        if parsed.path == "/health":
            return send_json(self, 200, {"ok": True})

        if not segments or segments[:2] != ["api", "v1"]:
            return not_found(self)

        if segments[2] == "summary":
            return self.handle_summary()
        if segments[2] == "editais":
            return self.handle_editais(segments, parse_qs(parsed.query))
        if segments[2] == "oportunidades":
            return self.handle_oportunidades(segments)
        if segments[2] == "artistas":
            return self.handle_artistas(segments)
        if segments[2] == "projetos":
            return self.handle_projetos(segments)
        if segments[2] == "documentos":
            return self.handle_documentos(segments)
        if segments[2] == "matches":
            return self.handle_matches(segments)
        if segments[2] == "sources":
            return self.handle_sources(segments, parse_qs(parsed.query))
        if segments[2] == "ingestions":
            return self.handle_ingestions(parse_qs(parsed.query))
        if segments[2] == "chat":
            return self.handle_chat(segments)

        return not_found(self)

    def do_GET(self) -> None:  # noqa: N802
        self._handle()

    def do_POST(self) -> None:  # noqa: N802
        self._handle()

    def do_PATCH(self) -> None:  # noqa: N802
        self._handle()

    def do_OPTIONS(self) -> None:  # noqa: N802
        send_empty(self)

    def handle_summary(self) -> None:
        state = read_state()
        send_json(self, 200, summarize_state(state))

    def handle_editais(self, segments: list[str], query: dict[str, list[str]]) -> None:
        state = read_state()

        if self.command == "GET" and len(segments) == 3:
            source_id = query.get("sourceId", [None])[0]
            items = state["editais"]
            if source_id:
                items = [item for item in items if item.get("sourceId") == source_id]
            return send_json(self, 200, {"items": items})

        if self.command == "POST" and len(segments) == 3:
            try:
                body = read_json_body(self)
            except json.JSONDecodeError:
                return bad_request(self, "Body JSON invalido")

            item = build_edital_from_payload(body)
            item = enrich_edital_record(state, item, source=None, raw_text=item.get("descricaoCompleta") or item.get("resumo"))
            next_state = mutate_state(
                lambda draft: _create_edital(draft, item)
            )
            created = next_state["editais"][0]
            return send_json(self, 201, {"item": created})

        if self.command == "POST" and len(segments) == 4 and segments[3] == "import":
            try:
                body = read_json_body(self)
            except json.JSONDecodeError:
                return bad_request(self, "Body JSON invalido")

            raw_text = body.get("content") or body.get("text") or ""
            source_name = body.get("fonte") or body.get("sourceName") or "Importado"
            candidate = build_candidate_from_text(
                url=body.get("fonteUrl") or body.get("url") or "import://manual",
                title=body.get("nome") or source_name,
                text=raw_text,
                source_name=source_name,
                kind="import",
            )
            item = candidate_to_edital(
                candidate,
                {
                    "id": body.get("sourceId") or create_id("source"),
                    "name": source_name,
                },
            )
            item = enrich_edital_record(state, item, source=None, raw_text=raw_text)
            item.update(
                {
                    "nome": body.get("nome") or item["nome"],
                    "fonte": source_name,
                    "area": body.get("area") or item["area"],
                    "prazo": int(body.get("prazo") or item["prazo"]),
                    "valor": int(body.get("valor") or item["valor"]),
                    "prioridade": body.get("prioridade") or item["prioridade"],
                    "resumo": body.get("resumo") or item["resumo"],
                    "quemPodeParticipar": body.get("quemPodeParticipar") or item["quemPodeParticipar"],
                    "descricaoCompleta": raw_text or item["descricaoCompleta"],
                    "tags": body.get("tags") or item["tags"],
                }
            )
            next_state = mutate_state(lambda draft: _create_edital(draft, item))
            return send_json(self, 201, {"item": next_state["editais"][0]})

        if len(segments) == 4 and segments[3] == "sync":
            if self.command != "POST":
                return not_found(self)
            state_before = read_state()
            results = []
            for source in state_before["sources"]:
                if source.get("active") is False:
                    continue
                results.append({"sourceId": source["id"], **sync_source_by_id(source["id"])})
            return send_json(self, 200, {"items": results})

        if len(segments) == 4:
            edital_id = segments[3]
            if self.command == "GET":
                detail = get_edital_detail(state, edital_id)
                if not detail:
                    return not_found(self, "Edital nao encontrado")
                return send_json(self, 200, detail)

            if self.command == "POST" and segments[3] == edital_id and len(segments) == 4:
                return not_found(self)

        if len(segments) == 5 and segments[4] == "analyze":
            if self.command != "POST":
                return not_found(self)
            edital_id = segments[3]
            edital = next((item for item in state["editais"] if item["id"] == edital_id), None)
            if not edital:
                return not_found(self, "Edital nao encontrado")
            source = next((item for item in state["sources"] if item["id"] == edital.get("sourceId")), None)
            enriched = enrich_edital_record(state, edital, source=source, raw_text=edital.get("descricaoCompleta"))
            updated = mutate_state(lambda draft: _replace_edital(draft, edital_id, enriched))
            fresh = next(item for item in updated["editais"] if item["id"] == edital_id)
            mutate_state(lambda draft: _refresh_matches_for_edital(draft, fresh))
            return send_json(self, 200, {"analysis": fresh.get("analysis")})

        return not_found(self)

    def handle_oportunidades(self, segments: list[str]) -> None:
        state = read_state()

        if self.command == "GET" and len(segments) == 3:
            return send_json(self, 200, {"items": state["oportunidades"]})

        if self.command == "POST" and len(segments) == 3:
            try:
                body = read_json_body(self)
            except json.JSONDecodeError:
                return bad_request(self, "Body JSON invalido")

            edital = next((item for item in state["editais"] if item["id"] == body.get("editalId")), None)
            artista = next((item for item in state["artistas"] if item["id"] == body.get("artistaId")), None)
            projeto = next((item for item in state["projetos"] if item["id"] == body.get("projectId")), None) if body.get("projectId") else None
            if not edital or not artista:
                return bad_request(self, "Edital e artista obrigatorios")
            item = build_default_opportunity(edital, artista, projeto, body)
            next_state = mutate_state(lambda draft: _create_oportunidade(draft, item))
            return send_json(self, 201, {"item": next_state["oportunidades"][0]})

        if len(segments) == 4:
            opportunity_id = segments[3]
            current = next((item for item in state["oportunidades"] if item["id"] == opportunity_id), None)
            if not current:
                return not_found(self, "Oportunidade nao encontrada")

            if self.command == "GET":
                return send_json(self, 200, {"item": current})

            if self.command == "PATCH":
                try:
                    body = read_json_body(self)
                except json.JSONDecodeError:
                    return bad_request(self, "Body JSON invalido")
                updated = mutate_state(lambda draft: _patch_oportunidade(draft, opportunity_id, body))
                item = next(item for item in updated["oportunidades"] if item["id"] == opportunity_id)
                return send_json(self, 200, {"item": item})

        return not_found(self)

    def handle_artistas(self, segments: list[str]) -> None:
        state = read_state()

        if self.command == "GET" and len(segments) == 3:
            return send_json(self, 200, {"items": state["artistas"]})

        if self.command == "POST" and len(segments) == 3:
            try:
                body = read_json_body(self)
            except json.JSONDecodeError:
                return bad_request(self, "Body JSON invalido")
            item = _build_artista(body)
            next_state = mutate_state(lambda draft: _create_artista(draft, item))
            return send_json(self, 201, {"item": next_state["artistas"][0]})

        if len(segments) == 4:
            artist_id = segments[3]
            artist = next((item for item in state["artistas"] if item["id"] == artist_id), None)
            if not artist:
                return not_found(self, "Artista nao encontrado")
            if self.command == "GET":
                projetos = [item for item in state["projetos"] if item["artistaId"] == artist_id]
                oportunidades = [item for item in state["oportunidades"] if item["artistaId"] == artist_id]
                documentos = [item for item in state["documentos"] if item["ownerId"] == artist_id and item["ownerType"] == "artist"]
                return send_json(self, 200, {"item": artist, "projetos": projetos, "oportunidades": oportunidades, "documentos": documentos})

        return not_found(self)

    def handle_projetos(self, segments: list[str]) -> None:
        state = read_state()

        if self.command == "GET" and len(segments) == 3:
            return send_json(self, 200, {"items": state["projetos"]})

        if self.command == "POST" and len(segments) == 3:
            try:
                body = read_json_body(self)
            except json.JSONDecodeError:
                return bad_request(self, "Body JSON invalido")
            if not body.get("artistaId") or not body.get("nome"):
                return bad_request(self, "Campos obrigatorios: artistaId e nome")
            item = _build_projeto(body)
            next_state = mutate_state(lambda draft: _create_projeto(draft, item))
            return send_json(self, 201, {"item": next_state["projetos"][0]})

        return not_found(self)

    def handle_documentos(self, segments: list[str]) -> None:
        state = read_state()

        if self.command == "GET" and len(segments) == 3:
            return send_json(self, 200, {"items": state["documentos"]})

        if self.command == "POST" and len(segments) == 3:
            try:
                body = read_json_body(self)
            except json.JSONDecodeError:
                return bad_request(self, "Body JSON invalido")
            if not body.get("nome") or not body.get("ownerType") or not body.get("ownerId"):
                return bad_request(self, "Campos obrigatorios: nome, ownerType e ownerId")
            item = _build_documento(body)
            next_state = mutate_state(lambda draft: _create_documento(draft, item))
            return send_json(self, 201, {"item": next_state["documentos"][0]})

        return not_found(self)

    def handle_matches(self, segments: list[str]) -> None:
        state = read_state()

        if self.command == "GET" and len(segments) == 3:
            return send_json(self, 200, {"items": state.get("matches", [])})

        if len(segments) == 4:
            match_id = segments[3]
            match = next((item for item in state.get("matches", []) if item["id"] == match_id), None)
            if not match:
                return not_found(self, "Match nao encontrado")
            if self.command == "GET":
                return send_json(self, 200, {"item": match})

        return not_found(self)

    def handle_sources(self, segments: list[str], query: dict[str, list[str]]) -> None:
        state = read_state()

        if self.command == "GET" and len(segments) == 3:
            return send_json(self, 200, {"items": state["sources"]})

        if self.command == "POST" and len(segments) == 3:
            try:
                body = read_json_body(self)
            except json.JSONDecodeError:
                return bad_request(self, "Body JSON invalido")
            if not body.get("name") or not body.get("url"):
                return bad_request(self, "Campos obrigatorios: name e url")
            item = _build_source(body)
            next_state = mutate_state(lambda draft: _create_source(draft, item))
            return send_json(self, 201, {"item": next_state["sources"][0]})

        if len(segments) == 4 and segments[3] == "sync":
            if self.command != "POST":
                return not_found(self)
            state_before = read_state()
            results = []
            for source in state_before["sources"]:
                if source.get("active") is False:
                    continue
                results.append({"sourceId": source["id"], **sync_source_by_id(source["id"])})
            return send_json(self, 200, {"items": results})

        if len(segments) == 4:
            source_id = segments[3]
            source = next((item for item in state["sources"] if item["id"] == source_id), None)
            if not source:
                return not_found(self, "Fonte nao encontrada")
            if self.command == "GET":
                return send_json(self, 200, build_source_response(state, source_id))
            if self.command == "PATCH":
                try:
                    body = read_json_body(self)
                except json.JSONDecodeError:
                    return bad_request(self, "Body JSON invalido")
                updated = mutate_state(lambda draft: _patch_source(draft, source_id, body))
                item = next(item for item in updated["sources"] if item["id"] == source_id)
                return send_json(self, 200, {"item": item})

        if len(segments) == 5 and segments[4] == "sync":
            if self.command != "POST":
                return not_found(self)
            result = sync_source_by_id(segments[3])
            return send_json(self, result["status"], result["result"] if result.get("ok") else {"error": result["error"]})

        return not_found(self)

    def handle_ingestions(self, query: dict[str, list[str]]) -> None:
        state = read_state()
        source_id = query.get("sourceId", [None])[0]
        status = query.get("status", [None])[0]
        limit = int(query.get("limit", ["50"])[0] or 50)
        items = [
            item
            for item in state["ingestions"]
            if (not source_id or item["sourceId"] == source_id) and (not status or item["status"] == status)
        ][: max(1, limit)]
        return send_json(self, 200, {"items": items})

    def handle_chat(self, segments: list[str]) -> None:
        if len(segments) != 6 or segments[5] != "messages":
            return not_found(self)

        scope = segments[3]
        entity_id = segments[4]
        state = read_state()

        if self.command == "GET":
            return send_json(self, 200, {"items": list_messages(state, scope, entity_id)})

        if self.command == "POST":
            try:
                body = read_json_body(self)
            except json.JSONDecodeError:
                return bad_request(self, "Body JSON invalido")
            content = (body.get("content") or "").strip()
            if not content:
                return bad_request(self, "content obrigatorio")

            updated = mutate_state(
                lambda draft: _append_chat_message(draft, scope, entity_id, content)
            )
            return send_json(self, 200, {"items": list_messages(updated, scope, entity_id)})

        return not_found(self)


def _append_chat_message(draft: dict, scope: str, entity_id: str, content: str) -> dict:
    from datetime import datetime, timezone

    scope_store = draft.setdefault("chat", {}).setdefault(scope, {})
    history = list(scope_store.get(entity_id) or [])
    user_message = {
        "id": create_id("msg"),
        "role": "user",
        "content": content,
        "createdAt": now_iso(),
    }
    history.append(user_message)

    context = _chat_context(draft, scope, entity_id)
    bundle = generate_chat_bundle(scope, context, content, state=draft)
    reply = {
        "id": create_id("msg"),
        "role": "assistant",
        "content": bundle["reply"],
        "metadata": {
            "sections": bundle.get("sections", []),
            "actions": bundle.get("actions", []),
            "highlights": bundle.get("highlights", []),
            "confidence": bundle.get("confidence", 0),
        },
        "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    history.append(reply)
    scope_store[entity_id] = history
    return draft


def _chat_context(state: dict, scope: str, entity_id: str) -> dict:
    if scope == "edital":
        edital = next((item for item in state["editais"] if item["id"] == entity_id), {})
        return edital
    if scope == "oportunidade":
        opportunity = next((item for item in state["oportunidades"] if item["id"] == entity_id), {})
        return opportunity
    return {}


def _create_edital(draft: dict, item: dict) -> dict:
    draft["editais"].insert(0, item)
    draft["auditLog"].insert(
        0,
        {
            "id": create_id("audit"),
            "type": "edital.created",
            "entityId": item["id"],
            "createdAt": now_iso(),
        },
    )
    auto_opportunity = build_auto_opportunity(item, item.get("analysis"))
    _create_oportunidade(draft, auto_opportunity)
    draft.setdefault("matches", []).extend(build_match_records(item, auto_opportunity, item.get("analysis")))
    return draft


def _replace_edital(draft: dict, edital_id: str, item: dict) -> dict:
    target_index = next((index for index, existing in enumerate(draft["editais"]) if existing["id"] == edital_id), None)
    if target_index is None:
        return draft
    draft["editais"][target_index] = item
    return draft


def _apply_edital_analysis(draft: dict, edital_id: str, analysis: dict) -> dict:
    target = next((item for item in draft["editais"] if item["id"] == edital_id), None)
    if target:
        apply_analysis_to_edital(target, analysis)
    return draft


def _refresh_matches_for_edital(draft: dict, edital: dict) -> dict:
    edital_id = edital.get("id")
    if not edital_id:
        return draft

    draft["matches"] = [item for item in draft.get("matches", []) if item.get("editalId") != edital_id]
    opportunity = next(
        (item for item in draft.get("oportunidades", []) if item.get("editalId") == edital_id),
        None,
    )
    if not opportunity:
        return draft

    draft.setdefault("matches", []).extend(build_match_records(edital, opportunity, edital.get("analysis")))
    return draft


def _create_oportunidade(draft: dict, item: dict) -> dict:
    draft["oportunidades"].insert(0, item)
    draft["auditLog"].insert(
        0,
        {
            "id": create_id("audit"),
            "type": "oportunidade.created",
            "entityId": item["id"],
            "createdAt": now_iso(),
        },
    )
    return draft


def _patch_oportunidade(draft: dict, opportunity_id: str, updates: dict) -> dict:
    target = next((item for item in draft["oportunidades"] if item["id"] == opportunity_id), None)
    if not target:
        return draft
    merged = dict(target)
    merged.update(updates)
    merged["updatedAt"] = now_iso()
    target.update(merged)
    return draft


def _create_artista(draft: dict, item: dict) -> dict:
    draft["artistas"].insert(0, item)
    draft["auditLog"].insert(
        0,
        {
            "id": create_id("audit"),
            "type": "artista.created",
            "entityId": item["id"],
            "createdAt": now_iso(),
        },
    )
    return draft


def _create_projeto(draft: dict, item: dict) -> dict:
    draft["projetos"].insert(0, item)
    draft["auditLog"].insert(
        0,
        {
            "id": create_id("audit"),
            "type": "projeto.created",
            "entityId": item["id"],
            "createdAt": now_iso(),
        },
    )
    return draft


def _create_documento(draft: dict, item: dict) -> dict:
    draft["documentos"].insert(0, item)
    draft["auditLog"].insert(
        0,
        {
            "id": create_id("audit"),
            "type": "documento.created",
            "entityId": item["id"],
            "createdAt": now_iso(),
        },
    )
    return draft


def _create_source(draft: dict, item: dict) -> dict:
    draft["sources"].insert(0, item)
    draft["auditLog"].insert(
        0,
        {
            "id": create_id("audit"),
            "type": "source.created",
            "entityId": item["id"],
            "createdAt": now_iso(),
        },
    )
    return draft


def _ensure_canonical_sources(draft: dict) -> dict:
    existing_sources = draft.setdefault("sources", [])
    by_url = {item.get("url"): item for item in existing_sources if item.get("url")}
    by_name = {item.get("name"): item for item in existing_sources if item.get("name")}

    for canonical in canonical_sources():
        target = by_url.get(canonical.get("url")) or by_name.get(canonical.get("name"))
        if target:
            for key in [
                "name",
                "type",
                "url",
                "notes",
                "esfera",
                "confiabilidade",
                "metodoCaptura",
                "precisaValidacaoHumana",
                "classificacao",
            ]:
                if not target.get(key) and canonical.get(key) is not None:
                    target[key] = canonical[key]
            continue
        existing_sources.append(canonical)

    return draft


def _patch_source(draft: dict, source_id: str, updates: dict) -> dict:
    target = next((item for item in draft["sources"] if item["id"] == source_id), None)
    if not target:
        return draft
    allowed = [
        "name",
        "type",
        "url",
        "active",
        "frequencyMinutes",
        "notes",
        "esfera",
        "confiabilidade",
        "metodoCaptura",
        "precisaValidacaoHumana",
        "classificacao",
    ]
    for key in allowed:
        if key in updates:
            target[key] = updates[key]
    target["updatedAt"] = now_iso()
    return draft


def _build_artista(body: dict) -> dict:
    now = now_iso()
    return {
        "id": create_id("art"),
        "nome": body.get("nome") or "Artista sem nome",
        "tipo": body.get("tipo") or "artista",
        "area": body.get("area") or "Música",
        "cidade": body.get("cidade") or "Nao informado",
        "projetos": int(body.get("projetos") or 0),
        "oportunidadesAtivas": int(body.get("oportunidadesAtivas") or 0),
        "statusDocumental": body.get("statusDocumental") or "Pendente",
        "bio": body.get("bio") or "",
        "links": list(body.get("links") or []),
        "contatos": list(body.get("contatos") or []),
        "tags": list(body.get("tags") or []),
        "createdAt": now,
        "updatedAt": now,
    }


def _build_projeto(body: dict) -> dict:
    now = now_iso()
    return {
        "id": create_id("proj"),
        "artistaId": body["artistaId"],
        "nome": body["nome"],
        "descricao": body.get("descricao") or "",
        "status": body.get("status") or "Em desenvolvimento",
        "orcamento": int(body.get("orcamento") or 0),
        "editaisRelacionados": list(body.get("editaisRelacionados") or []),
        "tags": list(body.get("tags") or []),
        "createdAt": now,
        "updatedAt": now,
    }


def _build_documento(body: dict) -> dict:
    now = now_iso()
    return {
        "id": create_id("doc"),
        "nome": body["nome"],
        "status": body.get("status") or "Pendente",
        "responsavel": body.get("responsavel") or "Nao atribuido",
        "arquivo": body.get("arquivo") or None,
        "ownerType": body["ownerType"],
        "ownerId": body["ownerId"],
        "tipo": body.get("tipo") or "Documento",
        "validade": body.get("validade") or None,
        "oportunidadeId": body.get("oportunidadeId") or (body["ownerId"] if body["ownerType"] == "opportunity" else None),
        "editalId": body.get("editalId") or None,
        "versao": body.get("versao") or "v1",
        "textoExtraido": body.get("textoExtraido") or "",
        "resumoIa": body.get("resumoIa") or "",
        "checklistGerado": bool(body.get("checklistGerado", False)),
        "fonteDocumento": body.get("fonteDocumento") or None,
        "createdAt": now,
        "updatedAt": now,
    }


def _build_source(body: dict) -> dict:
    now = now_iso()
    return {
        "id": create_id("source"),
        "name": body["name"],
        "type": body.get("type") or "html",
        "url": body["url"],
        "active": body.get("active", True),
        "frequencyMinutes": int(body.get("frequencyMinutes") or 60),
        "notes": body.get("notes") or "",
        "esfera": body.get("esfera") or "nacional",
        "confiabilidade": body.get("confiabilidade") or "media",
        "metodoCaptura": body.get("metodoCaptura") or "scraping",
        "precisaValidacaoHumana": bool(body.get("precisaValidacaoHumana", True)),
        "classificacao": body.get("classificacao") or "edital",
        "lastSyncAt": None,
        "lastError": None,
        "createdAt": now,
        "updatedAt": now,
    }


def _polling_loop() -> None:
    if SOURCE_POLL_JITTER_MS > 0:
        time.sleep(random.randint(0, SOURCE_POLL_JITTER_MS) / 1000)
    while True:
        try:
            poll_due_sources("interval")
        except Exception:
            pass
        time.sleep(max(5_000, SOURCE_POLL_INTERVAL_MS) / 1000)


def run_server() -> None:
    mutate_state(_ensure_canonical_sources)
    mutate_state(ensure_auto_opportunities)
    mutate_state(ensure_matches)
    server = ThreadingHTTPServer(("", PORT), ApiHandler)
    print(f"Edital Sales API running on http://localhost:{PORT}")
    if SOURCE_POLLING_ENABLED:
        threading.Thread(target=_polling_loop, daemon=True).start()
    server.serve_forever()


if __name__ == "__main__":
    run_server()
