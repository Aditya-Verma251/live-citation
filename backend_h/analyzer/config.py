"""Configuration for the local PDF analyzer and offline relationship engine."""
from __future__ import annotations

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]


def load_dotenv(path: Path | None = None) -> None:
    """Load simple KEY=VALUE settings; environment variables take precedence."""
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

USER_AGENT = os.getenv("USER_AGENT", "ResearchPaperAnalyzer/1.0 (academic-research-tool)")
HTTP_TIMEOUT_SECONDS = float(os.getenv("HTTP_TIMEOUT_SECONDS", "30"))
MAX_PDF_MB = int(os.getenv("MAX_PDF_MB", "50"))
UNPAYWALL_EMAIL = os.getenv("UNPAYWALL_EMAIL", "").strip()
GROBID_URL = os.getenv("GROBID_URL", "").strip().rstrip("/")
GROBID_TIMEOUT_SECONDS = float(os.getenv("GROBID_TIMEOUT_SECONDS", "90"))

# Phase 2: independent category thresholds. These are heuristic score cutoffs,
# not probabilities. V4-specific environment names prevent stale V3 values in
# existing .env files from silently keeping the old, overly permissive thresholds.
RELATIONSHIP_FOCUS_THRESHOLD = float(os.getenv("OFFLINE_RELATIONSHIP_V4_FOCUS_THRESHOLD", "0.15"))
RELATIONSHIP_METHOD_THRESHOLD = float(os.getenv("OFFLINE_RELATIONSHIP_V4_METHOD_THRESHOLD", "0.20"))
RELATIONSHIP_GAP_THRESHOLD = float(os.getenv("OFFLINE_RELATIONSHIP_V4_GAP_THRESHOLD", "0.18"))
RELATIONSHIP_GAP_ADDRESS_THRESHOLD = float(os.getenv("OFFLINE_RELATIONSHIP_V4_GAP_ADDRESS_THRESHOLD", "0.17"))
RELATIONSHIP_CONFLICT_THRESHOLD = float(os.getenv("OFFLINE_RELATIONSHIP_V4_CONFLICT_THRESHOLD", "0.18"))
