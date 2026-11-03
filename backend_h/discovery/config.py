"""Configuration for the paper discovery MVP."""
from __future__ import annotations

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]


def load_dotenv(path: Path | None = None) -> None:
    """Load KEY=VALUE settings without overriding process environment.

    The canonical location is the integrated backend root (beside api.py).
    A module-local .env is also checked for compatibility with older layouts.
    """
    if path is not None:
        candidates = [path]
    else:
        candidates = [PROJECT_ROOT / ".env", Path(__file__).resolve().parent / ".env"]

    for env_path in candidates:
        if not env_path.is_file():
            continue
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


load_dotenv()

OPENALEX_BASE_URL = os.getenv("OPENALEX_BASE_URL", "https://api.openalex.org")
OPENALEX_API_KEY = os.getenv("OPENALEX_API_KEY", "").strip()
CONTACT_EMAIL = os.getenv("CONTACT_EMAIL", "").strip()
USER_AGENT = os.getenv(
    "USER_AGENT",
    f"ResearchPaperDiscoveryMVP/0.1 (mailto:{CONTACT_EMAIL})" if CONTACT_EMAIL else "ResearchPaperDiscoveryMVP/0.1",
)
HTTP_TIMEOUT_SECONDS = float(os.getenv("HTTP_TIMEOUT_SECONDS", "20"))
MAX_RETRIES = int(os.getenv("MAX_RETRIES", "3"))
