# Reel Studio: full build spec (for a local Claude Code session)

Written 2026-10-13. Everything here runs **locally on the developer's machine**: no cloud server, no GPU. Only the LLM calls go out to a provider API, and the app works with **no keys at all** (rules-only mode).

## 0. Kickoff prompt (paste this into local Claude Code)

> Read `reel-studio/docs/BUILD_SPEC.md` fully, then `reel-studio/docs/PLAN.md` for the research background. Build the product described in the spec inside `reel-studio/`, following the build order in section 14. Some modules already exist on branch `claude/busy-goldberg-4k0z8o` (see section 13); review them, keep what is sound, and fix what is not. Work in small steps, run the tests after each module, and do not stop until the acceptance tests in section 15 pass. Never hard-code API keys. Ask me only when blocked.

## 1. What we are building

A **website that runs locally** (FastAPI backend + a single-page UI at `http://localhost:8000`). A user uploads raw clips (and optionally a music track), picks a **style pack** (baraat, sangeet/Garba, devotional, Diwali ad, cafe/restaurant, ...) and a short brief, and gets a finished **9:16 reel**: beat-synced cuts, speed ramps, transitions, colour grade, Indic-script titles, mixed audio. They can then ask for changes in chat ("faster", "remove shot 3", "warmer") and see QA results and cost.

**Strategy, in one line:** do not compete with CapCut on manual tools. Win on *edit quality for Indian event and venue footage*, measured against a baseline montage and against competitors in blind comparisons.

**Core principle:** the AI never edits video directly. A model (or the rules engine) produces a **validated JSON Timeline**; a deterministic FFmpeg renderer turns it into video. The model never gets a shell or file access.

## 2. Decisions already made

| Topic | Decision |
|---|---|
| Where it runs | Locally. FastAPI on localhost, files under `reel-studio/data/` |
| Platform target | Website first. Mobile app later (wrap or native) |
| Language | Python 3.11+ backend; plain HTML/CSS/JS front end (no build step) |
| Render engine | FFmpeg only for the MVP. HyperFrames/Revideo deferred (see section 12) |
| Title text | FFmpeg `drawtext` (has libharfbuzz+fribidi, so Indic shaping works) with bundled Noto fonts |
| Beat detection | librosa |
| Shot detection | PySceneDetect `ContentDetector` |
| Faces / reframing | OpenCV Haar cascade for the MVP; MediaPipe is a later upgrade |
| Speech models | **Not in the MVP.** Optional later for captions only (Sarvam, Rs 30/h of audio, or faster-whisper) |
| LLM | Gemini primary via `google-genai`; optional OpenAI-compatible provider (Qwen via DashScope, Kimi via Moonshot) |
| Generative video (Kling/Veo) | Not in the MVP |
| Remotion | Not used (source-available licence; paid tier $0.01/render, $100/month min for automated products) |
| OpenChatCut | Study only. AGPL, do not copy code |
| VideoAgent | Reading only. Research code, heavy dependencies |
| Music | User uploads their own track; app also synthesises a **placeholder beat** (our own, licence-free). No commercial songs bundled |
| Speed ramp / transitions | Done in FFmpeg filters (details in section 7) |
| Secrets | `.env` (git-ignored) loaded by `app/config.py`. Never committed |

## 3. Verified vs unverified facts

Verified this session from primary pages: HyperFrames (Apache-2.0, headless Chrome + FFmpeg, Node 22+), remotion-dev/skills install (`npx skills add remotion-dev/skills`), Remotion pricing/licence terms, VideoAgent (MIT, research/demo only, 8GB GPU), vertical-video-editing-skills (MIT, depends on HyperFrames, talking-head oriented), OpenChatCut (AGPL-3.0, early), Gemini video tokens (about 263 tokens/s video, 32 tokens/s audio), Sarvam STT price (Rs 30/h).

**Unverified (third-party blogs only; confirm on the vendor consoles before relying on them):**
- Gemini model ids/prices: `gemini-3.8-flash` ($0.75/$3.75 per 1M until 2026-12-31, then $1.50/$7.50), `gemini-3.1-pro` ($2/$12), `gemini-3.1-flash-lite` ($0.25/$1.50).
- Qwen3-Next-80B (~$0.15/$1.50) and Kimi K2.6 (~$0.95/$3.97) prices.
- Whether the Gemini ids above are exactly what the API accepts. Therefore model ids are **config**, with a **fallback chain** (`MODEL_DIRECTOR=gemini-3.8-flash,gemini-2.5-flash`), and `scripts/list_models.py` prints the ids a key can use.

Competition check (marketing pages only, quality unknown): WeddingEditor.ai, FotoOwl, Short AI, Revid, Pippit, CapCut auto features. No India-specific auto-editor for sangeet/haldi/baraat footage was found (absence of search results is not proof).

## 4. Local setup (document in README, make a script for it)

Requirements: Python 3.11+, FFmpeg 6+ with libx264, libharfbuzz, libfribidi, libfreetype (check with `ffmpeg -version`; `scripts/check_env.py` must verify and print fixes). Windows: install FFmpeg with `winget install Gyan.FFmpeg`; macOS: `brew install ffmpeg`; Ubuntu: `apt install ffmpeg`. Then:

```
cd reel-studio
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env     # add GEMINI_API_KEY later; optional
python scripts/check_env.py
uvicorn app.main:app --reload --port 8000
```

Fonts live in `assets/fonts/` (Noto Sans Bold for Latin, Devanagari, Telugu, Tamil, Gujarati, Kannada, Malayalam, Bengali, Gurmukhi; SIL OFL). On Windows, ffmpeg `drawtext` font paths need escaping (`C\:/...`); write a helper that converts paths and uses `textfile=` for all text to avoid quoting problems.

## 5. Repository layout (inside `reel-studio/`)

```
app/
  main.py            FastAPI app, routes, static files
  config.py          .env loading, settings, model/price tables      [exists]
  schemas.py         pydantic contracts: Shot, Analysis, Timeline...  [exists]
  util.py            safe subprocess runner, ffprobe                  [exists]
  jobs.py            thread-pool job runner, project store (JSON)
  cost.py            token/cost ledger per project
  analysis/
    video.py         proxy, shot detect, sampling, scoring, windows   [exists]
    audio.py         beats, downbeats, energy, best start, drop; synthetic grid + placeholder beat [exists]
    pipeline.py      orchestrates analysis                            [exists]
  styles/            *.json style packs + loader                      [exists]
  director/
    rules.py         deterministic director (must be good on its own)
    llm.py           provider interface, model router, retries, cost
    director.py      builds prompts, calls LLM, validates, falls back to rules
    tagger.py        optional Flash-Lite shot tagging from keyframes
    validator.py     checks and repairs any Timeline
    revise.py        chat revisions -> param changes / timeline ops
    review.py        optional AI reviewer on a contact sheet
  render/
    ffmpeg_render.py Timeline -> filter graph -> mp4 (draft/final)
    grades.py        grade presets
    text.py          overlay filters, fonts, safe zones
  qa/checks.py       deterministic quality checks + score
web/                 index.html, app.js, style.css
tests/               pytest (synthetic footage, mocks for the LLM)
scripts/             check_env.py, list_models.py, make_demo_footage.py, benchmark.py, fetch_test_footage.py
assets/fonts/        Noto fonts + NOTICE.txt                           [exists]
docs/                PLAN.md (research), BUILD_SPEC.md (this file)
```

## 6. Analysis pipeline (local, no LLM)

Implemented in `app/analysis/`; review and keep.

1. **Probe** each clip with ffprobe (duration, size after rotation, fps, audio).
2. **Proxy**: short side 360px, 10 fps, no audio (fast analysis).
3. **Shots**: ContentDetector (threshold 27, min 8 frames); long continuous takes are split into pieces of at most 8 s; discard shots under 0.6 s.
4. **Sampling** every 0.25 s on the proxy: sharpness (Laplacian variance on a 320px-wide frame, `clip((log1p(v)-3)/4, 0, 1)`), exposure (`1-|mean-125|/125`), motion (mean abs frame diff / 25), saturation, Haar faces (normalised centre/area), a bokeh ratio (centre sharpness / whole-frame sharpness) used to detect close-ups without faces.
5. **Sample score** = `0.30*sharp + 0.20*exposure + 0.25*motion + 0.10*saturation + 0.15*min(1, faces/2)`, times 0.8 if sharp < 0.2.
6. **Shot score** = `0.7*mean(sample scores) + 0.3*best window score`. **Best windows** for 1.5 s, 2.5 s, 4 s via a sliding window.
7. **Shot scale**: `close` if largest face area > 4% of frame or (no faces and bokeh > 2.5); `medium` if > 1.2%; else `wide`.
8. **subject_x** (0..1): face centre if faces appear in at least 25% of samples, else motion centroid clipped to 0.25..0.75. Used for 9:16 cropping.
9. **Keyframe** JPEG (384px wide) from the best window; used by the UI and the LLM.
10. **Music** (`audio.py`): librosa `beat_track` -> beats; accent phase picks downbeats (1 in 4); per-second RMS energy; `start_offset` = the downbeat whose window of the target length has the highest mean energy; `drop_time` = biggest energy rise. No music supplied -> synthetic grid at the style's BPM and a generated placeholder beat (`write_placeholder_beat`).

Known weak points to improve later: Haar faces miss profile/small faces (swap to MediaPipe), and "highlight" detection is heuristic until the LLM tagger or a learned model exists.

## 7. Timeline and renderer

`Timeline` (see `app/schemas.py`): ordered `Segment`s (shot_id, source_start, output duration, speed 0.25..4, ramp `none|slow_out|fast_out`, zoom `none|push|pull`, transition_in `cut|dissolve|flash|whip|dip` + duration, reframe `{mode: crop|blurfill, x}`, audio_gain), `TextOverlay`s, `Music`, `grade`, `target_duration`.

### Renderer algorithm (`render/ffmpeg_render.py`)

One ffmpeg invocation, one `-filter_complex` graph (or chunked if more than ~40 segments):

1. For each segment, a separate input: `-ss <source_start> -t <source_needed> -i <original>`, where `source_needed = duration * speed` (for ramps use the integral below).
2. Per-segment video chain: `fps=30` -> reframe -> speed -> zoom -> `format=yuv420p`.
   - **Reframe crop** (landscape source -> 9:16): `scale=-2:H` then `crop=1080:1920:x=clip(subject_x*iw - 540, 0, iw-1080)`. **Blurfill**: split; background = scale to cover + `boxblur=30:5`; foreground = scale to width 1080; overlay centred. Use blurfill when faces are wide-spread (several faces, `face_count >= 3`) or the subject would be cut off.
   - **Constant speed**: `setpts=PTS/speed`.
   - **Ramp** (time-varying): with source length `S`, start/end speed `s0,s1`, factors `f0=1/s0`, `f1=1/s1`, `b=(f1-f0)/S`, `a=f0`: `setpts='((a*PTS*TB)+(0.5*b*(PTS*TB)*(PTS*TB)))/TB'`; output duration = `S*(f0+f1)/2`. `slow_out`: 1.0 -> 0.4; `fast_out`: 0.5 -> 1.3.
   - **Zoom** (smooth, no zoompan): `scale=w='1080*(1+Z*t/D)':h=-2:eval=frame`, then `crop=1080:1920` centred; push = Z 0..0.07, pull = reversed. Scale up the source slightly first so there is headroom.
3. **Assemble**: fold segments left to right. `cut` -> `concat=n=2`; `dissolve|whip|dip` -> `xfade` (`fade`, `slideleft`, `fadeblack`) with `offset = running_length - transition_duration`; `flash` -> hard cut plus a 0.12 s white `fade=in:color=white` on the first frames of the next segment. Track running length so audio/overlay times match (`Timeline.starts()`).
4. **Grade** (`grades.py`) after assembly: `clean` (`eq` tiny contrast), `warm_festive` (`colorbalance` warm + `eq=saturation=1.15`), `cinematic` (teal/orange via `colorbalance`, contrast 1.08, `vignette`), `golden_devotional` (warm highlights, saturation 1.1), `food_appetising` (warm, saturation 1.25, slight sharpen via `unsharp`), `vivid_dance` (saturation 1.3, contrast 1.1), `cool_night`.
5. **Text overlays** (`text.py`): `drawtext` with `textfile=`, `fontfile=` chosen by `script` (Devanagari -> NotoSansDevanagari-Bold, etc.), fade in/out via `alpha` expression, soft shadow, optional box. **Safe zones** for 1080x1920: avoid the top 14% and bottom 25% of the frame (platform UI). `lower` = y at about 68% height, `center` = 45%, `top` = 18%.
6. **Audio**: music `atrim` from `start_offset`, `afade` in/out, volume, `loudnorm=I=-14:TP=-1.5:LRA=11`. If any segment has `audio_gain > 0` (only for speed 1): `atrim` that source audio, `volume`, `adelay` to its output start, then `amix` with the music. Lower music to 0.55 during those spans (simple volume enable expression) so speech/dhol is audible.
7. **Encode**: `libx264`, `yuv420p`, `-movflags +faststart`, AAC 192k. **draft** = 540x960, `veryfast`, crf 26. **final** = 1080x1920, `medium`, crf 18, fps 30.
8. If a segment's source has no audio, synthesise silence so the graph is valid.

Test the renderer with synthetic clips from `lavfi` (`testsrc2`, `mandelbrot`, `life`) so no real footage is needed in CI.

## 8. Directors

### 8.1 Rules director (`director/rules.py`): must be good without any LLM

Inputs: Analysis, StylePack, Brief. Output: Timeline.

1. **Grid**: reel beats = `music.beats` shifted by `-start_offset`, clipped to `[0, D]`. D snapped down to a whole number of bars (4 beats), at most the requested duration.
2. **Cut plan** from the style's `pacing` stages: for each stage (`until` fraction, `beats_per_cut`), cut on beats; divide `beats_per_cut` by `brief.pace`. The first shot is the **hook**: `hook_beats` long, starting at beat 0. If `music.drop_time` exists, force a cut exactly on it, and give that segment a `flash` transition if `flash_on_drop`. Last segment: at least 4 beats, with fade-out (`ending: fade`).
3. **Shot selection** (greedy per slot):
   - Pool = shots not in `exclude_shots`, ordered per `ordering`: `chronological` (clip order then time), `energy_build` (sort by `score + 0.5*motion` ascending, then place the single best shot first as the hook), `best_first` (descending score, hook = best).
   - `pin_hook` overrides the hook.
   - For each slot choose the best unused shot, maximising `score` with penalties: same clip as the previous slot (-0.15), same `scale` as the previous slot (-0.10 when `prefer_scale_alternation`), too short for the slot unless slow motion can fill it. Allow reusing a shot only after all shots are used, with a different window.
   - Source start = the best window for that slot length (choose the window nearest the slot duration); clamp inside the shot.
4. **Per-segment effects**:
   - `speed`: if the style's `slow_mo_rate` hits and the slot is in the peak and the shot has `motion > 0.35`, speed 0.5 (needs source length `duration*0.5` available); else 1.0.
   - `ramp`: with probability `ramp_rate`, on peak-stage segments with motion > 0.5 and at least 1.2 s source: `slow_out` or `fast_out`.
   - `zoom`: with probability `zoom_punch * brief.zoom_level`, alternate push and pull.
   - `transition_in`: sample from the style's weights; `flash` only at the drop or the start of the peak, scaled by `flash_level`; `whip`/`dissolve` duration 0.2 / 0.4 s (snap to a beat fraction); never dissolve inside the peak stage with 1-beat cuts; never two flashes in a row.
   - `reframe`: for landscape sources: `x = subject_x`; blurfill if `face_count >= 3`.
   - `audio_gain`: 0 unless `keep_source_audio`.
5. **Text**: only what the user typed: `title` at t=0.4 s for 2.6 s (`lower` or `center`), `subtitle` after it, `end_text` in the last 3 s. Script from `brief.text_script`.
6. **Determinism**: seed from `brief.seed` so revisions are reproducible; "regenerate" bumps the seed.

Also record `rationale` text per slot (shot id, score, reason) for the UI.

### 8.2 LLM director (`director/director.py`)

1. Build compact JSON context (no raw video): style pack, brief, music `{tempo, drop_time, bars}`, and for each shot `{id, duration, score, motion, faces, scale, best_window, tags}`. Attach up to `MAX_KEYFRAMES` keyframe JPEGs, each labelled with its shot id.
2. Ask the model for **JSON only**, using a response schema (Gemini `response_mime_type="application/json"` + `response_schema`). Output schema:
   ```
   { "hook_shot_id": str,
     "slots": [ { "shot_id": str, "beats": number, "speed": number, "ramp": "none|slow_out|fast_out",
                  "zoom": "none|push|pull", "transition": "cut|dissolve|flash|whip|dip", "why": str } ],
     "grade": str, "overlays": [ { "text": str, "start": number, "duration": number, "position": str } ] }
   ```
3. Convert to a Timeline: snap slot lengths to the beat grid, fill source windows from the shot's `windows`, clamp. Run `validator.py`.
4. **Fallback**: if the call fails, the JSON is invalid, or validation cannot repair it, use the rules director and record why. **Never** let an LLM failure fail the job.
5. **Model routing**: tagger = `MODEL_TAGGER` (Flash-Lite class), director = `MODEL_DIRECTOR` (Flash class), escalate to `MODEL_ESCALATE` (Pro class) only when validation fails twice or the AI reviewer scores < 60. Try each id in the comma-separated chain until one answers (a 404/invalid-model error moves to the next id).
6. **Prompt rules** (system prompt): you are a senior reel editor; use only given shot ids; cut on beats; hook within the first 2 s; no more than 2 flashes; alternate shot scale; keep the best shot for the climax; do not invent text; output JSON only.
7. Optional second provider `openai_compat` (httpx, `POST {base_url}/chat/completions`, JSON mode, image parts as base64 data URLs) for Qwen/Kimi benchmarking.

### 8.3 Tagger (`director/tagger.py`, optional)

Batch keyframes (about 12 per request) to the cheap model: returns per shot `{tags[], highlight 0..1, note}` (e.g. "couple entrance", "dhol", "dance", "food close-up", "crowd", "ritual"). Stored on the Shot. The director uses `highlight` as a score boost (`score += 0.15*highlight`).

### 8.4 Reviewer (`director/review.py`, optional)

Build a **contact sheet** (one frame per segment, in order, with index numbers) plus QA numbers; ask a model for `{score 0-100, issues:[{segment, problem}], suggestions:[str]}`. If `AUTO_REVIEW=1` and score < 70, run one revision pass using the suggestions. Always show the review in the UI.

## 9. Revisions (`director/revise.py`)

Chat input -> structured ops, applied to `Brief` params or the Timeline, then re-render.

Ops: `pace(multiplier)`, `duration(seconds)`, `zoom(level)`, `flash(level)`, `grade(name)`, `text(on/off)`, `exclude_shot(id)`, `pin_hook(id)`, `remove_segment(index)`, `swap(i,j)`, `set_speed(index,speed)`, `set_transition(index,type)`, `style(id)`, `regenerate()`.

- With an LLM: send the message, the current timeline summary and the op schema; get JSON ops; validate.
- **Without an LLM** (keyword fallback): "faster/energetic/more cuts" -> `pace*1.4`; "slower/calm" -> `pace/1.4`; "shorter/longer" -> duration -/+ 20%; "remove shot N"/"remove clip N" -> `remove_segment`; "no text" -> text off; "warmer" -> `warm_festive`; "cinematic" -> `cinematic`; "more zoom"/"less zoom"; "less flash"; "different/regenerate" -> new seed. Return a clear message listing what was changed, or "I didn't understand" and example phrases.
- Keep a **revision history** (list of `{message, ops, timestamp}`) and allow undo to the previous timeline.

## 10. QA (`qa/checks.py`): deterministic, runs after every render

Return a list of checks `{name, status pass|warn|fail, detail}` and a 0-100 score.

- Output size matches (1080x1920 final, 540x960 draft); duration within +/-0.3 s of `timeline.total_duration()`; has audio stream.
- No black frames longer than 0.3 s (`blackdetect`); no frozen frames (`freezedetect`).
- Loudness integrated in [-18, -10] LUFS (`ebur128`/`loudnorm` measure); peak <= -1 dBFS (`volumedetect`).
- **Cut-on-beat rate**: share of cut points within 60 ms of a beat (target >= 90% when music exists).
- Hook: first segment <= 2.5 s. Minimum segment >= 0.4 s. Max reuse of one shot <= 2.
- Face crop check: for crop reframes, `subject_x` within the visible window.
- Text safe zone: overlays lie inside the safe rectangle (by construction; assert it).
- Two consecutive segments from the same clip with near-identical frames flagged as a jump-cut warning (compare keyframe histograms).

## 11. API and UI

### REST API (FastAPI)

- `GET /api/health` -> versions, ffmpeg capabilities, whether Gemini/OpenAI-compatible keys are present (booleans only, never the keys).
- `GET /api/styles`.
- `POST /api/projects` -> `{id}`; `POST /api/projects/{id}/clips` (multiple files, streamed to disk, size limit configurable, extension allow-list `.mp4 .mov .m4v .mkv .webm`); `POST /api/projects/{id}/music` (`.mp3 .wav .m4a .aac .flac`).
- `POST /api/projects/{id}/generate` body = `Brief`; returns a job. `GET /api/projects/{id}` -> status, progress message/fraction, analysis summary (shots, tempo, beats), timeline, rationale, QA report, cost ledger, revision history, review.
- `POST /api/projects/{id}/revise` `{message}`; `POST /api/projects/{id}/undo`; `POST /api/projects/{id}/render?quality=final`; `POST /api/projects/{id}/review`.
- `POST /api/projects/{id}/baseline` -> renders the **baseline montage** (equal-length cuts in upload order, centre crop, no beat sync, no effects, same music). Essential for A/B.
- `GET /api/projects/{id}/video?variant=ours|baseline|draft|final` (supports HTTP Range), `GET /api/projects/{id}/keyframe/{shot_id}`.
- Security: random project ids, sanitised filenames, path-traversal checks, no shell, bind to `127.0.0.1` by default.

### UI (single page, `web/`)

Stepper layout: 1) Upload clips + music; 2) Choose style, duration (15/30/45/60 s), title/subtitle/end text + script (Latin, Devanagari, Telugu, Tamil, ...), quality draft/final, "use AI director" toggle (disabled with a note if no key); 3) Progress with stage messages; 4) Result: video player, **A/B toggle between ours and baseline**, shot strip with thumbnails and per-segment info (duration, speed, transition, why), QA checklist with colours, cost panel (tokens by model, estimate in USD, render seconds), review panel, chat box for revisions with history + undo, download button, "Render final" button. Responsive, accessible (labels, focus states, keyboard), light/dark. Show clear errors (never a blank screen).

## 12. Tools considered and where they fit

| Tool | Use |
|---|---|
| FFmpeg | Core renderer (now) |
| librosa / essentia | Beats (librosa now; essentia if beat accuracy needs improvement) |
| PySceneDetect / TransNetV2 | Shot detection (PySceneDetect now) |
| MediaPipe | Better face/pose + subject tracking (upgrade) |
| HyperFrames (Apache-2.0) | Later, for rich animated titles/motion graphics rendered to alpha video and overlaid by FFmpeg. Needs Node 22 + Chrome; test source-clip compositing before depending on it |
| Revideo (MIT) | Alternative to HyperFrames; check repo health first |
| Mediabunny (MPL-2.0) | Later: browser-side proxies/export for a hosted version |
| Sarvam / faster-whisper | Later: captions, avoiding cuts mid-speech |
| OpenTimelineIO | Later: export timeline to editors (FCPXML/EDL) so studios can fine-tune in Premiere/Resolve |
| Agent skills (`npx skills add ...`) | For the *developer's* coding agent only (HyperFrames, vertical-video-editing-skills as QA reference). Not runtime features |

## 13. What already exists in this repo (branch `claude/busy-goldberg-4k0z8o`)

`reel-studio/`: `requirements.txt`, `.env.example`, `.gitignore`, `app/config.py`, `app/schemas.py`, `app/util.py`, `app/analysis/{video,audio,pipeline}.py`, `app/styles/*.json` (8 packs), `assets/fonts/*` (9 Noto Bold fonts + NOTICE), `docs/PLAN.md`, `docs/BUILD_SPEC.md`. **None of it has been run yet**: treat it as a first draft. The repo root is an unrelated project ("Hazir"); the root `.prettierignore` and `eslint.config.mjs` were edited to ignore `reel-studio/` so its CI is unaffected. Do not touch anything outside `reel-studio/` except that.

## 14. Build order (do in this order; run tests after each step)

1. `scripts/check_env.py` + run the existing analysis modules on synthetic footage; fix bugs. Write `scripts/make_demo_footage.py` (several `lavfi` clips with different looks, one with an audio track).
2. `director/validator.py` + `render/` (text, grades, ffmpeg_render) with a hand-written Timeline; verify draft render, then final.
3. `director/rules.py`; end-to-end CLI: `python scripts/benchmark.py --clips ... --music ... --style baraat_entrance` produces `ours.mp4` and `baseline.mp4`.
4. `qa/checks.py`.
5. `jobs.py`, `cost.py`, FastAPI routes, static UI.
6. `director/llm.py`, `director.py`, `tagger.py` with a **mock provider** for tests; real Gemini path behind the key; `scripts/list_models.py`.
7. `revise.py` (keyword fallback first, then LLM ops), undo/history.
8. `review.py`, contact sheet, optional auto-fix.
9. Polish UI, README, error handling, performance pass (parallel clip analysis with a process pool; cache analysis by file hash so revisions do not re-analyse).

## 15. Acceptance tests (must pass before calling it done)

- `pytest` passes with no network and no API keys (uses synthetic footage and a mock LLM).
- From a clean checkout, `check_env.py` and `uvicorn` start; the UI loads; upload 5 synthetic clips, generate a 15 s draft in under 60 s on a 4-core laptop, play it in the browser.
- Rendered output: 540x960 (draft) or 1080x1920 (final), H.264/AAC, `+faststart`, duration within 0.3 s of the plan, loudness in range, **cut-on-beat rate >= 90%** on a track with clear beats.
- Hindi/Devanagari and Telugu titles render correctly (visually inspect a frame: conjuncts and matras shaped properly, not boxes).
- Every style pack renders without error and yields different pacing/grade (assert on the timeline, not just on success).
- Revisions: "faster" increases segment count; "shorter" reduces duration; "remove shot 2" removes one segment; undo restores the previous timeline.
- LLM failure paths: invalid JSON, unknown shot id, timeout, 404 model id: all fall back to rules with a recorded reason; the job still succeeds.
- Security: path traversal in filenames rejected; the API never returns key values; no shell usage (`shell=True` forbidden: add a test that greps the source).
- With a real key (manual test): the LLM director returns a valid timeline for 20 shots; token usage and USD estimate appear in the cost panel.

## 16. Quality benchmark (the product's real test)

`scripts/benchmark.py` runs the same footage + music + brief through: (a) baseline montage, (b) rules director, (c) LLM director (if key), and writes a folder of mp4s plus a `report.json` (QA scores, cost, timings). Use it to run **blind A/B reviews** with real editors/studios and against competitors (WeddingEditor.ai, Short AI, CapCut auto-edit) using 5 Indian event footage sets. For development, `scripts/fetch_test_footage.py` may download a short list of **openly licensed** clips (e.g. Wikimedia Commons / Pexels / Pixabay: record each licence and URL in `data/footage_licences.csv`; never commit footage). Internet videos are for testing only. Do **not** scrape Instagram/YouTube; platform terms forbid it and Indian law on AI-training copyright is unsettled (DPIIT Dec 2025 working paper proposes a mandatory licence; ANI v OpenAI pending).

Ideas to try after the baseline works, measured by the benchmark: best-of-N candidate edits scored by a learned/heuristic quality score; motion-to-beat alignment via optical flow (put spins/dhol hits on beats); climax selection from crowd energy/smiles/audio swells; key-people priority by face clustering; retention feedback from Instagram insights (with studio consent).

## 17. Costs (to be replaced by measured numbers)

Local rendering costs nothing beyond electricity. LLM cost depends on keyframes, not video length: about 24 keyframes at 384 px plus about 3k tokens of JSON per director call, so expect cents per reel (reviews and retries add more). Record tokens in/out per call in `cost.py`; prices come from `config.DEFAULT_PRICES`, overridable with `prices.json`, and are unverified.

## 18. Legal, privacy, ethics checklist

- Music: only user-provided or our synthetic placeholder; show a notice that the user is responsible for the rights to uploaded music. Label-cleared sources (e.g. Hoopr) are a later business decision.
- Footage may show identifiable faces: keep everything local, add "delete project" and an auto-delete option, never upload media to any service except downscaled keyframes to the chosen LLM when AI mode is on (state this clearly in the UI and get consent via the toggle).
- Licences: Noto fonts (OFL) bundled with NOTICE; avoid AGPL code (OpenChatCut); Remotion not used.
- India DPDP Act review before any hosted/multi-user version.

## 19. Open items for the owner

1. Add `GEMINI_API_KEY` to `.env`; run `scripts/list_models.py` and put the real model ids in `.env`.
2. Choose how to source test footage (own clips, or licensed Pexels/Pixabay/Commons clips).
3. Decide the music policy for the first beta (bring-your-own vs a licensed library).
4. Find 3-5 wedding studios for the blind comparison and the pricing test.
5. Legal review before any scraping or hosted launch.
