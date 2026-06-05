from __future__ import annotations

import json
import socket
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .config import OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL, OPENAI_TIMEOUT_SECONDS

DEFAULT_FALLBACK_MODEL = "gpt-5.2"


@dataclass
class OpenAIEnrichmentResult:
    edital: dict[str, Any]
    analysis: dict[str, Any]
    raw: dict[str, Any]


EDITAL_ENRICHMENT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["edital", "analysis"],
    "properties": {
        "edital": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "nome",
                "fonte",
                "fonteUrl",
                "area",
                "prazo",
                "valor",
                "status",
                "prioridade",
                "resumo",
                "quemPodeParticipar",
                "descricaoCompleta",
                "tags",
                "riscos",
                "proximaAcao",
            ],
            "properties": {
                "nome": {"type": "string"},
                "fonte": {"type": "string"},
                "fonteUrl": {"type": ["string", "null"]},
                "area": {"type": "string"},
                "prazo": {"type": "integer"},
                "valor": {"type": "integer"},
                "status": {"type": "string"},
                "prioridade": {"type": "string"},
                "resumo": {"type": "string"},
                "quemPodeParticipar": {"type": "string"},
                "descricaoCompleta": {"type": "string"},
                "tags": {"type": "array", "items": {"type": "string"}},
                "riscos": {"type": "array", "items": {"type": "string"}},
                "proximaAcao": {"type": "string"},
            },
        },
        "analysis": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "resumoExecutivo",
                "requisitos",
                "criterios",
                "documentosObrigatorios",
                "riscos",
                "sugestoes",
                "proximasAcoes",
            ],
            "properties": {
                "resumoExecutivo": {"type": "string"},
                "requisitos": {"type": "array", "items": {"type": "string"}},
                "criterios": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["criterio", "peso"],
                        "properties": {
                            "criterio": {"type": "string"},
                            "peso": {"type": "string"},
                        },
                    },
                },
                "documentosObrigatorios": {"type": "array", "items": {"type": "string"}},
                "riscos": {"type": "array", "items": {"type": "string"}},
                "sugestoes": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": [
                            "artistaId",
                            "artista",
                            "projetoId",
                            "projeto",
                            "compatibilidade",
                            "motivo",
                            "pendencias",
                        ],
                        "properties": {
                            "artistaId": {"type": "string"},
                            "artista": {"type": "string"},
                            "projetoId": {"anyOf": [{"type": "string"}, {"type": "null"}]},
                            "projeto": {"anyOf": [{"type": "string"}, {"type": "null"}]},
                            "compatibilidade": {"type": "integer"},
                            "motivo": {"type": "string"},
                            "pendencias": {"type": "integer"},
                        },
                    },
                },
                "proximasAcoes": {"type": "array", "items": {"type": "string"}},
            },
        },
    },
}

EDITAL_CHAT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["reply", "sections", "actions", "highlights", "confidence"],
    "properties": {
        "reply": {"type": "string"},
        "sections": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["title", "bullets"],
                "properties": {
                    "title": {"type": "string"},
                    "bullets": {"type": "array", "items": {"type": "string"}},
                },
            },
        },
        "actions": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["label", "prompt", "kind"],
                "properties": {
                    "label": {"type": "string"},
                    "prompt": {"type": "string"},
                    "kind": {
                        "type": "string",
                        "enum": [
                            "analysis",
                            "checklist",
                            "opportunity",
                            "document",
                            "risk",
                            "comparison",
                            "followup",
                        ],
                    },
                },
            },
        },
        "highlights": {"type": "array", "items": {"type": "string"}},
        "confidence": {"type": "integer", "minimum": 0, "maximum": 100},
    },
}


def is_enabled() -> bool:
    return bool(OPENAI_API_KEY)


def _truncate(value: str, max_length: int) -> str:
    text = str(value or "").strip()
    if len(text) <= max_length:
        return text
    return f"{text[:max_length].rstrip()}..."


def _build_catalog_snapshot(state: dict) -> dict:
    projects_by_artist: dict[str, int] = {}
    docs_by_artist: dict[str, int] = {}

    for project in state.get("projetos", []):
        artist_id = project.get("artistaId")
        if artist_id:
            projects_by_artist[artist_id] = projects_by_artist.get(artist_id, 0) + 1

    for document in state.get("documentos", []):
        owner_id = document.get("ownerId")
        if document.get("ownerType") == "artist" and owner_id:
            docs_by_artist[owner_id] = docs_by_artist.get(owner_id, 0) + 1

    artists = [
        {
            "id": artist["id"],
            "nome": artist.get("nome"),
            "area": artist.get("area"),
            "cidade": artist.get("cidade"),
            "bio": _truncate(artist.get("bio") or "", 220),
            "statusDocumental": artist.get("statusDocumental"),
            "projetos": projects_by_artist.get(artist["id"], 0),
            "documentos": docs_by_artist.get(artist["id"], 0),
        }
        for artist in state.get("artistas", [])
    ]

    projects = [
        {
            "id": project["id"],
            "artistaId": project.get("artistaId"),
            "nome": project.get("nome"),
            "descricao": _truncate(project.get("descricao") or "", 220),
            "status": project.get("status"),
            "orcamento": project.get("orcamento") or 0,
            "editaisRelacionados": list(project.get("editaisRelacionados") or []),
        }
        for project in state.get("projetos", [])
    ]

    documents = [
        {
            "id": document["id"],
            "ownerType": document.get("ownerType"),
            "ownerId": document.get("ownerId"),
            "nome": document.get("nome"),
            "tipo": document.get("tipo"),
            "status": document.get("status"),
            "validade": document.get("validade"),
        }
        for document in state.get("documentos", [])
    ]

    return {
        "artists": artists,
        "projects": projects,
        "documents": documents,
    }


def _build_prompt_payload(state: dict, edital: dict, source: dict | None, raw_text: str | None) -> dict:
    return {
        "source": {
            "id": source.get("id") if source else edital.get("sourceId"),
            "name": source.get("name") if source else edital.get("fonte"),
            "type": source.get("type") if source else None,
            "url": source.get("url") if source else edital.get("fonteUrl"),
        },
        "edital": {
            "nome": edital.get("nome"),
            "fonte": edital.get("fonte"),
            "fonteUrl": edital.get("fonteUrl"),
            "area": edital.get("area"),
            "prazo": edital.get("prazo"),
            "valor": edital.get("valor"),
            "status": edital.get("status"),
            "prioridade": edital.get("prioridade"),
            "resumo": edital.get("resumo"),
            "quemPodeParticipar": edital.get("quemPodeParticipar"),
            "descricaoCompleta": edital.get("descricaoCompleta"),
            "tags": list(edital.get("tags") or []),
            "riscos": list(edital.get("riscos") or []),
            "proximaAcao": edital.get("proximaAcao"),
            "rawKind": edital.get("rawKind"),
        },
        "raw_text": _truncate(raw_text or edital.get("descricaoCompleta") or edital.get("resumo") or "", 9000),
        "catalog": _build_catalog_snapshot(state),
    }


def _extract_output_text(response: dict) -> str:
    output_text = response.get("output_text")
    if isinstance(output_text, str) and output_text.strip():
        return output_text.strip()

    chunks: list[str] = []
    for item in response.get("output", []) or []:
        if item.get("type") != "message":
            continue
        for content in item.get("content", []) or []:
            content_type = content.get("type")
            if content_type in {"output_text", "text"}:
                text = content.get("text")
                if isinstance(text, str):
                    chunks.append(text)

    return "".join(chunks).strip()


def _call_responses_api(payload: dict, allow_model_fallback: bool = True) -> dict:
    request = Request(
        f"{OPENAI_BASE_URL}/responses",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {OPENAI_API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=OPENAI_TIMEOUT_SECONDS) as response:
            body = response.read().decode("utf-8")
            return json.loads(body)
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        if allow_model_fallback and exc.code == 400 and "model_not_found" in body and payload.get("model") != DEFAULT_FALLBACK_MODEL:
            fallback_payload = dict(payload)
            fallback_payload["model"] = DEFAULT_FALLBACK_MODEL
            return _call_responses_api(fallback_payload, allow_model_fallback=False)
        raise RuntimeError(f"OpenAI API error {exc.code}: {body}") from exc
    except (URLError, TimeoutError, socket.timeout) as exc:
        reason = getattr(exc, "reason", exc)
        raise RuntimeError(f"OpenAI API request failed: {reason}") from exc


def enrich_edital_with_openai(state: dict, edital: dict, source: dict | None = None, raw_text: str | None = None) -> OpenAIEnrichmentResult | None:
    if not is_enabled():
        return None

    system_prompt = (
        "Você é um analista de editais culturais brasileiros. "
        "Use apenas a evidência fornecida. Não invente dados. "
        "Se um campo não puder ser determinado, preserve o valor atual recebido ou use texto explícito como 'Não identificado automaticamente'. "
        "Seu objetivo é preencher um edital para uso em um radar operacional. "
        "Priorize precisão sobre completude."
    )
    user_payload = _build_prompt_payload(state, edital, source, raw_text)
    user_prompt = json.dumps(user_payload, ensure_ascii=False, indent=2)

    request_payload = {
        "model": OPENAI_MODEL,
        "input": [
            {
                "role": "developer",
                "content": [{"type": "input_text", "text": system_prompt}],
            },
            {
                "role": "user",
                "content": [{"type": "input_text", "text": user_prompt}],
            },
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "edital_enrichment",
                "strict": True,
                "schema": EDITAL_ENRICHMENT_SCHEMA,
            }
        },
    }

    response = _call_responses_api(request_payload)
    raw_text_output = _extract_output_text(response)
    if not raw_text_output:
        return None

    try:
        parsed = json.loads(raw_text_output)
    except json.JSONDecodeError:
        return None

    edital_payload = parsed.get("edital") or {}
    analysis_payload = parsed.get("analysis") or {}

    if not isinstance(edital_payload, dict) or not isinstance(analysis_payload, dict):
        return None

    return OpenAIEnrichmentResult(edital=edital_payload, analysis=analysis_payload, raw=response)


def generate_edital_chat_bundle(
    scope: str,
    context: dict,
    question: str,
    state: dict | None = None,
) -> dict[str, Any] | None:
    if not is_enabled():
        return None

    assistant_style = (
        "Você é o Assistente do edital em um sistema operacional de captação cultural. "
        "Responda em português do Brasil. Seja objetivo, factual e útil. "
        "Use apenas as evidências do contexto fornecido. "
        "Se algo não puder ser comprovado, diga explicitamente que precisa de validação no texto oficial. "
        "Inclua ações práticas curtas e diretamente acionáveis quando fizer sentido. "
        "Formate a resposta como texto editorial com seções curtas e bullets claros."
    )

    prompt_payload = {
        "scope": scope,
        "question": question,
        "context": context,
        "catalog": _build_catalog_snapshot(state or {}) if state else {"artists": [], "projects": [], "documents": []},
    }

    request_payload = {
        "model": OPENAI_MODEL,
        "input": [
            {
                "role": "developer",
                "content": [{"type": "input_text", "text": assistant_style}],
            },
            {
                "role": "user",
                "content": [{"type": "input_text", "text": json.dumps(prompt_payload, ensure_ascii=False, indent=2)}],
            },
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "edital_chat_reply",
                "strict": True,
                "schema": EDITAL_CHAT_SCHEMA,
            }
        },
    }

    try:
        response = _call_responses_api(request_payload)
    except RuntimeError:
        return None

    raw_text_output = _extract_output_text(response)
    if not raw_text_output:
        return None

    try:
        parsed = json.loads(raw_text_output)
    except json.JSONDecodeError:
        return None

    if not isinstance(parsed, dict):
        return None

    reply = parsed.get("reply")
    sections = parsed.get("sections") or []
    actions = parsed.get("actions") or []
    highlights = parsed.get("highlights") or []
    confidence = parsed.get("confidence")

    if not isinstance(reply, str) or not isinstance(sections, list) or not isinstance(actions, list) or not isinstance(highlights, list):
        return None

    return {
        "reply": reply.strip(),
        "sections": sections,
        "actions": actions,
        "highlights": [str(item).strip() for item in highlights if str(item).strip()],
        "confidence": int(confidence) if isinstance(confidence, (int, float, str)) and str(confidence).strip().isdigit() else 0,
        "raw": response,
    }


def generate_edital_chat_reply(
    scope: str,
    context: dict,
    question: str,
    state: dict | None = None,
) -> str | None:
    if not is_enabled():
        return None

    assistant_style = (
        "Você é o Assistente do edital em um sistema operacional de captação cultural. "
        "Responda em português do Brasil, de forma objetiva e útil. "
        "Use apenas as evidências do contexto fornecido. "
        "Se algo não puder ser comprovado, diga explicitamente que precisa de validação no texto oficial. "
        "Quando fizer sentido, termine com uma ação prática curta."
    )

    prompt_payload = {
        "scope": scope,
        "question": question,
        "context": context,
        "catalog": _build_catalog_snapshot(state or {}) if state else {"artists": [], "projects": [], "documents": []},
    }

    request_payload = {
        "model": OPENAI_MODEL,
        "input": [
            {
                "role": "developer",
                "content": [{"type": "input_text", "text": assistant_style}],
            },
            {
                "role": "user",
                "content": [{"type": "input_text", "text": json.dumps(prompt_payload, ensure_ascii=False, indent=2)}],
            },
        ],
        "max_output_tokens": 500,
    }

    response = _call_responses_api(request_payload)
    reply_text = _extract_output_text(response)
    return reply_text or None
