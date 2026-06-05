from __future__ import annotations

import json
import threading
from copy import deepcopy
from pathlib import Path
from typing import Any, Callable

from .config import DATA_DIR, STATE_FILE
from .db import has_database, load_state_row, upsert_state_row
from .seed import create_seed_state, now_iso

STATE_LOCK = threading.RLock()


def create_id(prefix: str) -> str:
    import uuid

    return f"{prefix}_{uuid.uuid4().hex[:10]}"


def _base_meta(state: dict) -> dict:
    meta = state.get("meta") or {}
    now = now_iso()
    return {
        "version": meta.get("version", 1),
        "createdAt": meta.get("createdAt", now),
        "updatedAt": meta.get("updatedAt", now),
    }


def normalize_state(state: dict | None) -> dict:
    state = state or {}
    chat = state.get("chat") or {}
    normalized = {
        "meta": _base_meta(state),
        "editais": list(state.get("editais") or []),
        "artistas": list(state.get("artistas") or []),
        "projetos": list(state.get("projetos") or []),
        "documentos": list(state.get("documentos") or []),
        "oportunidades": list(state.get("oportunidades") or []),
        "matches": list(state.get("matches") or []),
        "sources": list(state.get("sources") or []),
        "ingestions": list(state.get("ingestions") or []),
        "chat": {
            "edital": dict(chat.get("edital") or {}),
            "oportunidade": dict(chat.get("oportunidade") or {}),
        },
        "auditLog": list(state.get("auditLog") or []),
    }
    return normalized


def ensure_data_dir() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def _read_state_file() -> dict:
    if not STATE_FILE.exists():
        state = normalize_state(create_seed_state())
        write_state(state)
        return state

    with STATE_FILE.open("r", encoding="utf-8") as handle:
        raw = json.load(handle)
    return normalize_state(raw)


def read_state() -> dict:
    with STATE_LOCK:
        if has_database():
            try:
                state = load_state_row()
                if state is None:
                    state = normalize_state(create_seed_state())
                    upsert_state_row(state)
                    return state
                return normalize_state(state)
            except Exception:
                return _read_state_file()
        return _read_state_file()


def write_state(next_state: dict) -> dict:
    with STATE_LOCK:
        if has_database():
            state = normalize_state(next_state)
            state["meta"]["updatedAt"] = now_iso()
            try:
                return upsert_state_row(state)
            except Exception:
                pass
        ensure_data_dir()
        state = normalize_state(next_state)
        state["meta"]["updatedAt"] = now_iso()
        with STATE_FILE.open("w", encoding="utf-8") as handle:
            json.dump(state, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        return state


def mutate_state(mutator: Callable[[dict], Any]) -> dict:
    with STATE_LOCK:
        current = read_state()
        draft = deepcopy(current)
        result = mutator(draft)
        next_state = result if isinstance(result, dict) else draft
        return write_state(next_state)
