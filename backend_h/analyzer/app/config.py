"""Configuration for Research Paper Analyzer MVP 2."""
from __future__ import annotations

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]


def load_dotenv(path: Path | None = None) -> None:
    """Load simple KEY=VALUE settings; existing environment wins."""
    env_path = path or PROJECT_ROOT / ".env"
    if not env_path.exists():
        return
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

USER_AGENT = os.getenv("USER_AGENT", "ResearchPaperAnalyzerMVP/0.2 (academic-research-tool)")
HTTP_TIMEOUT_SECONDS = float(os.getenv("HTTP_TIMEOUT_SECONDS", "30"))
MAX_PDF_MB = int(os.getenv("MAX_PDF_MB", "50"))
UNPAYWALL_EMAIL = os.getenv("UNPAYWALL_EMAIL", "").strip()
GROBID_URL = os.getenv("GROBID_URL", "").strip().rstrip("/")
GROBID_TIMEOUT_SECONDS = float(os.getenv("GROBID_TIMEOUT_SECONDS", "90"))
