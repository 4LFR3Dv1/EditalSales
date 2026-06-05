from __future__ import annotations

import os
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT_DIR / "backend" / "data"
STATE_FILE = DATA_DIR / "state.json"


def _load_env_file(path: Path) -> None:
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].strip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not key or key in os.environ:
            continue
        value = value.strip()
        if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
            value = value[1:-1]
        os.environ[key] = value


for candidate in (ROOT_DIR / ".env", ROOT_DIR / ".env.local"):
    _load_env_file(candidate)

PORT = int(os.getenv("PORT", "8000"))
CORS_ORIGINS = [item.strip() for item in os.getenv("CORS_ORIGIN", "*").split(",") if item.strip()]


def resolve_cors_origin(request_origin: str | None) -> str:
    if not request_origin:
        return CORS_ORIGINS[0] if CORS_ORIGINS else "*"

    if "*" in CORS_ORIGINS:
        return request_origin

    for allowed in CORS_ORIGINS:
        if allowed == request_origin:
            return request_origin
        if allowed.endswith(":*") and request_origin.startswith(allowed[:-1]):
            return request_origin
        if allowed == "http://localhost" and request_origin.startswith("http://localhost:"):
            return request_origin
        if allowed == "http://127.0.0.1" and request_origin.startswith("http://127.0.0.1:"):
            return request_origin

    return CORS_ORIGINS[0] if CORS_ORIGINS else "*"

SOURCE_POLLING_ENABLED = os.getenv("SOURCE_POLLING_ENABLED", "0").lower() in {"1", "true", "yes", "on"}
SOURCE_POLL_INTERVAL_MS = int(os.getenv("SOURCE_POLL_INTERVAL_MS", "60000"))
SOURCE_POLL_JITTER_MS = int(os.getenv("SOURCE_POLL_JITTER_MS", "0"))

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-5.2")
OPENAI_TIMEOUT_SECONDS = int(os.getenv("OPENAI_TIMEOUT_SECONDS", "90"))
SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
SUPABASE_STATE_TABLE = os.getenv("SUPABASE_STATE_TABLE", "app_state").strip() or "app_state"
SUPABASE_STATE_KEY = os.getenv("SUPABASE_STATE_KEY", "default").strip() or "default"
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
