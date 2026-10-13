from __future__ import annotations

import json
from pathlib import Path

from ..schemas import StylePack

_DIR = Path(__file__).parent


def list_styles() -> list[StylePack]:
    return [StylePack(**json.loads(p.read_text(encoding="utf-8"))) for p in sorted(_DIR.glob("*.json"))]


def get_style(style_id: str) -> StylePack:
    p = _DIR / f"{style_id}.json"
    if not p.exists():
        p = _DIR / "generic_event.json"
    return StylePack(**json.loads(p.read_text(encoding="utf-8")))
