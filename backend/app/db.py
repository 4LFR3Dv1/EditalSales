from __future__ import annotations

import json
from contextlib import contextmanager
from typing import Iterator
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .config import (
    DATABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_STATE_KEY,
    SUPABASE_STATE_TABLE,
    SUPABASE_URL,
)


STATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS app_state (
    state_key TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""


def _with_sslmode_require(url: str) -> str:
    parsed = urlparse(url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    if "sslmode" not in query and parsed.hostname and "supabase" in parsed.hostname:
        query["sslmode"] = "require"
    return urlunparse(parsed._replace(query=urlencode(query)))


def _require_psycopg():
    try:
        import psycopg  # type: ignore
    except ImportError as exc:  # pragma: no cover - exercised when dependency is missing
        raise RuntimeError(
            "psycopg nao esta instalado. Rode `python -m pip install psycopg[binary]`."
        ) from exc
    return psycopg


def has_database() -> bool:
    return bool(DATABASE_URL or (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY))


def has_supabase_http() -> bool:
    return bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)


def supabase_rest_url() -> str | None:
    if not SUPABASE_URL:
        return None
    base = SUPABASE_URL.rstrip("/")
    if base.endswith("/rest/v1"):
        return base
    return f"{base}/rest/v1"


def normalized_database_url() -> str | None:
    if not DATABASE_URL:
        return None
    return _with_sslmode_require(DATABASE_URL)


@contextmanager
def connect_db() -> Iterator[object]:
    psycopg = _require_psycopg()
    url = normalized_database_url()
    if not url:
        raise RuntimeError("DATABASE_URL nao configurada")
    conn = psycopg.connect(url)
    try:
        yield conn
    finally:
        conn.close()


def _supabase_headers() -> dict[str, str]:
    if not SUPABASE_SERVICE_ROLE_KEY:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY nao configurada")
    return {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Prefer": "return=representation",
    }


def _supabase_request(method: str, path: str, *, query: dict[str, str] | None = None, payload: dict | list | None = None):
    base = supabase_rest_url()
    if not base:
        raise RuntimeError("SUPABASE_URL nao configurada")

    url = f"{base.rstrip('/')}/{path.lstrip('/')}"
    if query:
        url = f"{url}?{urlencode(query)}"

    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = Request(url, data=data, method=method.upper(), headers=_supabase_headers())
    try:
        with urlopen(request, timeout=30) as response:
            body = response.read().decode("utf-8")
            return json.loads(body) if body else None
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace") if exc.fp else ""
        raise RuntimeError(f"Supabase HTTP error {exc.code}: {body or exc.reason}") from exc
    except URLError as exc:
        raise RuntimeError(f"Supabase HTTP error: {exc.reason}") from exc


def _supabase_table_path() -> str:
    return SUPABASE_STATE_TABLE or "app_state"


def ensure_schema() -> None:
    if has_supabase_http():
        return
    if not has_database():
        return
    with connect_db() as conn:
        with conn.cursor() as cur:
            cur.execute(STATE_TABLE_SQL)
        conn.commit()


def load_state_row() -> dict | None:
    if has_supabase_http():
        rows = _supabase_request(
            "GET",
            _supabase_table_path(),
            query={
                "select": "data",
                "state_key": f"eq.{SUPABASE_STATE_KEY}",
                "limit": "1",
            },
        )
        if not rows:
            return None
        row = rows[0]
        data = row.get("data")
        if isinstance(data, str):
            return json.loads(data)
        return data
    if not has_database():
        return None
    ensure_schema()
    with connect_db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT data FROM app_state WHERE state_key = %s", ("default",))
            row = cur.fetchone()
    if not row:
        return None
    data = row[0]
    if isinstance(data, str):
        return json.loads(data)
    return data


def upsert_state_row(state: dict) -> dict:
    if has_supabase_http():
        existing = load_state_row()
        payload = {"state_key": SUPABASE_STATE_KEY, "data": state}
        if existing is None:
            _supabase_request("POST", _supabase_table_path(), payload=payload)
        else:
            _supabase_request(
                "PATCH",
                _supabase_table_path(),
                query={"state_key": f"eq.{SUPABASE_STATE_KEY}"},
                payload={"data": state},
            )
        return state
    if not has_database():
        return state
    ensure_schema()
    payload = json.dumps(state, ensure_ascii=False)
    with connect_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO app_state (state_key, data, updated_at)
                VALUES (%s, %s::jsonb, NOW())
                ON CONFLICT (state_key)
                DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
                """,
                ("default", payload),
            )
        conn.commit()
    return state
