from __future__ import annotations

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware

from backend.app.main import (
    _append_chat_message,
    _apply_edital_analysis,
    _build_artista,
    _build_documento,
    _build_projeto,
    _build_source,
    _create_artista,
    _create_documento,
    _create_edital,
    _create_oportunidade,
    _create_projeto,
    _create_source,
    _ensure_canonical_sources,
    _patch_oportunidade,
    _patch_source,
    _refresh_matches_for_edital,
    _replace_edital,
    build_analysis,
    build_edital_from_payload,
    build_source_response,
    build_default_opportunity,
    ensure_auto_opportunities,
    ensure_matches,
    enrich_edital_record,
    get_edital_detail,
    list_messages,
    poll_due_sources,
    sync_source_by_id,
)
from backend.app.main import build_match_records  # re-exported for completeness
from backend.app.store import mutate_state, read_state
from backend.app.services import summarize_state


app = FastAPI(title="Edital Sales API", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    mutate_state(_ensure_canonical_sources)
    mutate_state(ensure_auto_opportunities)
    mutate_state(ensure_matches)


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.get("/api/v1/summary")
def api_summary() -> dict:
    return summarize_state(read_state())


@app.get("/api/v1/editais")
def list_editais(sourceId: str | None = Query(default=None)) -> dict:
    state = read_state()
    items = state["editais"]
    if sourceId:
        items = [item for item in items if item.get("sourceId") == sourceId]
    return {"items": items}


@app.post("/api/v1/editais")
async def create_edital(request: Request) -> dict:
    body = await request.json()
    item = build_edital_from_payload(body)
    state = read_state()
    item = enrich_edital_record(state, item, source=None, raw_text=item.get("descricaoCompleta") or item.get("resumo"))
    next_state = mutate_state(lambda draft: _create_edital(draft, item))
    return {"item": next_state["editais"][0]}


@app.post("/api/v1/editais/import")
async def import_edital(request: Request) -> dict:
    body = await request.json()
    raw_text = body.get("content") or body.get("text") or ""
    source_name = body.get("fonte") or body.get("sourceName") or "Importado"
    from backend.app.main import build_candidate_from_text, candidate_to_edital

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
            "id": body.get("sourceId") or "source_manual",
            "name": source_name,
        },
    )
    state = read_state()
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
    return {"item": next_state["editais"][0]}


@app.post("/api/v1/editais/sync")
def sync_all_sources() -> dict:
    state_before = read_state()
    results = []
    for source in state_before["sources"]:
        if source.get("active") is False:
            continue
        results.append({"sourceId": source["id"], **sync_source_by_id(source["id"])})
    return {"items": results}


@app.get("/api/v1/editais/{edital_id}")
def get_edital(edital_id: str) -> dict:
    detail = get_edital_detail(read_state(), edital_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Edital nao encontrado")
    return detail


@app.post("/api/v1/editais/{edital_id}/analyze")
def analyze_edital(edital_id: str) -> dict:
    state = read_state()
    edital = next((item for item in state["editais"] if item["id"] == edital_id), None)
    if not edital:
        raise HTTPException(status_code=404, detail="Edital nao encontrado")
    source = next((item for item in state["sources"] if item["id"] == edital.get("sourceId")), None)
    enriched = enrich_edital_record(state, edital, source=source, raw_text=edital.get("descricaoCompleta"))
    updated = mutate_state(lambda draft: _replace_edital(draft, edital_id, enriched))
    fresh = next(item for item in updated["editais"] if item["id"] == edital_id)
    mutate_state(lambda draft: _refresh_matches_for_edital(draft, fresh))
    return {"analysis": fresh.get("analysis")}


@app.get("/api/v1/oportunidades")
def list_oportunidades() -> dict:
    return {"items": read_state()["oportunidades"]}


@app.post("/api/v1/oportunidades")
async def create_oportunidade(request: Request) -> dict:
    body = await request.json()
    state = read_state()
    edital = next((item for item in state["editais"] if item["id"] == body.get("editalId")), None)
    artista = next((item for item in state["artistas"] if item["id"] == body.get("artistaId")), None)
    projeto = next((item for item in state["projetos"] if item["id"] == body.get("projectId")), None) if body.get("projectId") else None
    if not edital or not artista:
        raise HTTPException(status_code=400, detail="Edital e artista obrigatorios")
    item = build_default_opportunity(edital, artista, projeto, body)
    next_state = mutate_state(lambda draft: _create_oportunidade(draft, item))
    return {"item": next_state["oportunidades"][0]}


@app.get("/api/v1/oportunidades/{opportunity_id}")
def get_oportunidade(opportunity_id: str) -> dict:
    state = read_state()
    item = next((item for item in state["oportunidades"] if item["id"] == opportunity_id), None)
    if not item:
        raise HTTPException(status_code=404, detail="Oportunidade nao encontrada")
    return {"item": item}


@app.patch("/api/v1/oportunidades/{opportunity_id}")
async def patch_oportunidade(opportunity_id: str, request: Request) -> dict:
    body = await request.json()
    updated = mutate_state(lambda draft: _patch_oportunidade(draft, opportunity_id, body))
    state = read_state()
    item = next((entry for entry in state["oportunidades"] if entry["id"] == opportunity_id), None)
    if not item:
        raise HTTPException(status_code=404, detail="Oportunidade nao encontrada")
    return {"item": item}


@app.get("/api/v1/artistas")
def list_artistas() -> dict:
    return {"items": read_state()["artistas"]}


@app.post("/api/v1/artistas")
async def create_artista(request: Request) -> dict:
    body = await request.json()
    item = _build_artista(body)
    next_state = mutate_state(lambda draft: _create_artista(draft, item))
    return {"item": next_state["artistas"][0]}


@app.get("/api/v1/artistas/{artist_id}")
def get_artista(artist_id: str) -> dict:
    state = read_state()
    artist = next((item for item in state["artistas"] if item["id"] == artist_id), None)
    if not artist:
        raise HTTPException(status_code=404, detail="Artista nao encontrado")
    projetos = [item for item in state["projetos"] if item["artistaId"] == artist_id]
    oportunidades = [item for item in state["oportunidades"] if item["artistaId"] == artist_id]
    documentos = [item for item in state["documentos"] if item["ownerId"] == artist_id and item["ownerType"] == "artist"]
    return {"item": artist, "projetos": projetos, "oportunidades": oportunidades, "documentos": documentos}


@app.get("/api/v1/projetos")
def list_projetos() -> dict:
    return {"items": read_state()["projetos"]}


@app.post("/api/v1/projetos")
async def create_projeto(request: Request) -> dict:
    body = await request.json()
    if not body.get("artistaId") or not body.get("nome"):
        raise HTTPException(status_code=400, detail="Campos obrigatorios: artistaId e nome")
    item = _build_projeto(body)
    next_state = mutate_state(lambda draft: _create_projeto(draft, item))
    return {"item": next_state["projetos"][0]}


@app.get("/api/v1/documentos")
def list_documentos() -> dict:
    return {"items": read_state()["documentos"]}


@app.post("/api/v1/documentos")
async def create_documento(request: Request) -> dict:
    body = await request.json()
    if not body.get("nome") or not body.get("ownerType") or not body.get("ownerId"):
        raise HTTPException(status_code=400, detail="Campos obrigatorios: nome, ownerType e ownerId")
    item = _build_documento(body)
    next_state = mutate_state(lambda draft: _create_documento(draft, item))
    return {"item": next_state["documentos"][0]}


@app.get("/api/v1/matches")
def list_matches() -> dict:
    return {"items": read_state().get("matches", [])}


@app.get("/api/v1/matches/{match_id}")
def get_match(match_id: str) -> dict:
    state = read_state()
    match = next((item for item in state.get("matches", []) if item["id"] == match_id), None)
    if not match:
        raise HTTPException(status_code=404, detail="Match nao encontrado")
    return {"item": match}


@app.get("/api/v1/sources")
def list_sources() -> dict:
    return {"items": read_state()["sources"]}


@app.post("/api/v1/sources")
async def create_source(request: Request) -> dict:
    body = await request.json()
    if not body.get("name") or not body.get("url"):
        raise HTTPException(status_code=400, detail="Campos obrigatorios: name e url")
    item = _build_source(body)
    next_state = mutate_state(lambda draft: _create_source(draft, item))
    return {"item": next_state["sources"][0]}


@app.get("/api/v1/sources/{source_id}")
def get_source(source_id: str) -> dict:
    return build_source_response(read_state(), source_id)


@app.patch("/api/v1/sources/{source_id}")
async def patch_source(source_id: str, request: Request) -> dict:
    body = await request.json()
    updated = mutate_state(lambda draft: _patch_source(draft, source_id, body))
    state = read_state()
    item = next((entry for entry in state["sources"] if entry["id"] == source_id), None)
    if not item:
        raise HTTPException(status_code=404, detail="Fonte nao encontrada")
    return {"item": item}


@app.post("/api/v1/sources/sync")
def sync_sources() -> dict:
    state_before = read_state()
    results = []
    for source in state_before["sources"]:
        if source.get("active") is False:
            continue
        results.append({"sourceId": source["id"], **sync_source_by_id(source["id"])})
    return {"items": results}


@app.post("/api/v1/sources/{source_id}/sync")
def sync_source(source_id: str) -> dict:
    result = sync_source_by_id(source_id)
    if result.get("ok"):
        return result["result"]
    raise HTTPException(status_code=result["status"], detail=result["error"])


@app.get("/api/v1/ingestions")
def list_ingestions(
    sourceId: str | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1),
) -> dict:
    state = read_state()
    items = [
        item
        for item in state["ingestions"]
        if (not sourceId or item["sourceId"] == sourceId) and (not status or item["status"] == status)
    ][:limit]
    return {"items": items}


@app.get("/api/v1/chat/{scope}/{entity_id}/messages")
def list_chat_messages(scope: str, entity_id: str) -> dict:
    state = read_state()
    return {"items": list_messages(state, scope, entity_id)}


@app.post("/api/v1/chat/{scope}/{entity_id}/messages")
async def create_chat_message(scope: str, entity_id: str, request: Request) -> dict:
    body = await request.json()
    content = (body.get("content") or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="content obrigatorio")
    updated = mutate_state(lambda draft: _append_chat_message(draft, scope, entity_id, content))
    return {"items": list_messages(updated, scope, entity_id)}

