"""Settings loaded from environment / .env. No secrets are ever hard-coded."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv(ROOT / ".env")


def _csv(name: str, default: str) -> list[str]:
    return [m.strip() for m in os.environ.get(name, default).split(",") if m.strip()]


# Indicative USD per 1M tokens (input, output). UNVERIFIED third-party figures from
# Oct 2026 research; edit freely. Only used for the cost estimate shown in the UI.
DEFAULT_PRICES = {
    "gemini-3.8-flash": [0.75, 3.75],
    "gemini-3.1-pro": [2.00, 12.00],
    "gemini-3.1-flash-lite": [0.25, 1.50],
    "gemini-2.5-flash": [0.30, 2.50],
    "gemini-2.5-flash-lite": [0.10, 0.40],
    "gemini-2.5-pro": [1.25, 10.00],
}


@dataclass
class Settings:
    gemini_api_key: str = field(default_factory=lambda: os.environ.get("GEMINI_API_KEY", ""))
    model_director: list[str] = field(default_factory=lambda: _csv("MODEL_DIRECTOR", "gemini-3.8-flash,gemini-2.5-flash"))
    model_tagger: list[str] = field(default_factory=lambda: _csv("MODEL_TAGGER", "gemini-3.1-flash-lite,gemini-2.5-flash-lite"))
    model_escalate: list[str] = field(default_factory=lambda: _csv("MODEL_ESCALATE", "gemini-3.1-pro,gemini-2.5-pro"))
    provider_director: str = field(default_factory=lambda: os.environ.get("PROVIDER_DIRECTOR", "gemini"))
    compat_key: str = field(default_factory=lambda: os.environ.get("OPENAI_COMPAT_API_KEY", ""))
    compat_base_url: str = field(default_factory=lambda: os.environ.get("OPENAI_COMPAT_BASE_URL", ""))
    compat_model: str = field(default_factory=lambda: os.environ.get("OPENAI_COMPAT_MODEL", ""))
    max_keyframes: int = field(default_factory=lambda: int(os.environ.get("MAX_KEYFRAMES", "24")))
    auto_review: bool = field(default_factory=lambda: os.environ.get("AUTO_REVIEW", "0") == "1")
    data_dir: Path = field(default_factory=lambda: (ROOT / os.environ.get("DATA_DIR", "./data")).resolve())
    fonts_dir: Path = ROOT / "assets" / "fonts"
    prices: dict = field(default_factory=lambda: _load_prices())

    @property
    def llm_enabled(self) -> bool:
        if self.provider_director == "openai_compat":
            return bool(self.compat_key and self.compat_base_url and self.compat_model)
        return bool(self.gemini_api_key)


def _load_prices() -> dict:
    prices = dict(DEFAULT_PRICES)
    p = ROOT / "prices.json"
    if p.exists():
        prices.update(json.loads(p.read_text(encoding="utf-8")))
    return prices


def get_settings() -> Settings:
    s = Settings()
    s.data_dir.mkdir(parents=True, exist_ok=True)
    return s
