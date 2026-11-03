"""JSON storage helpers for parsed documents and paper analyses."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def write_json(path: str | Path, data: dict[str, Any]) -> Path:
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(destination)
    return destination


def read_json(path: str | Path) -> dict[str, Any]:
    source = Path(path)
    if not source.exists():
        raise FileNotFoundError(f"Input JSON not found: {source}")
    try:
        return json.loads(source.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Input is not valid JSON: {source}: {exc}") from exc
