# 0004. Languages: English, Hindi, Telugu, with self-hosted fonts

Status: accepted (Phase 1)

## Decision

- Locale is the first URL segment (`/en`, `/hi`, `/te`), validated; unknown locales are a 404.
- Messages live in `packages/i18n` as JSON. A test enforces identical keys, no empty strings, script correctness (Devanagari / Telugu) and identical placeholders in every language. A missing key throws instead of rendering blank text.
- Fonts are self-hosted (Inter, Noto Sans Devanagari, Noto Sans Telugu, variable). We found that a stock Linux browser has no Devanagari or Telugu font and renders empty boxes; some customer phones may also lack them. Each font file is downloaded only when a page contains that script (unicode-range).
- Indic scripts get a taller line height.

## Not decided yet

Hindi and Telugu strings in this phase were written by the assistant and need review by a native speaker before any real customer sees them (tracked as a pilot gate).
