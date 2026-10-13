# AI Reel Editor for Indian Events — Verified Plan (v2)

Date: 2026-10-13. Research notes: items marked **[verified]** were read from the primary repo or official-looking docs this session; **[3rd-party]** means only aggregator/blog sources were found and must be re-checked on the vendor's official page before budgeting.

## 1. Product

**What:** Upload raw footage from an Indian wedding or festival, pick a style pack, get a finished vertical reel, then refine it with chat ("make the baraat entrance faster").
**Who pays:** wedding videographers and photography studios (time saved per delivered reel). Consumers come later.
**Not competing with:** CapCut/InShot on manual editing tools.
**Format:** website first (mobile-friendly PWA). Native apps only after the pipeline is proven.

## 2. Research findings on the ChatGPT-suggested components

| Component | Finding | Verdict |
|---|---|---|
| HyperFrames (heygen-com/hyperframes) | **[verified]** Apache 2.0, ~62k stars, renders by seeking frames in headless Chrome (Puppeteer) and encoding with FFmpeg. Needs Node 22+. Docs do not explicitly confirm arbitrary source-video trimming/compositing; they show video as a timed clip layer. | Use for titles/overlays/motion graphics. Server-side only (cannot run on a phone). Test source-clip compositing in week 1 before depending on it. |
| Remotion skills (remotion-dev/skills) | **[verified]** ~5k stars, skills for create/render/captions/saas etc. Repo page shows no license. Remotion itself is **source-available, not OSI open source**; free for individuals and companies of up to 3 people; Automators tier $0.01/render, $100/month minimum **[verified via remotion.dev]**. | Fine as a free-tier reference while team <= 3, but a paid automated product likely triggers the Automators license. Keep it off the critical path. |
| VideoAgent (HKUDS) | **[verified]** MIT, ~1.9k stars, no tagged releases, README says demos are research/demo only. Needs 8GB GPU, many model downloads (CosyVoice, Whisper, ImageBind...), and a Claude key to power its router. | Read for ideas only. Do not integrate. |
| vertical-video-editing-skills (nopefallacy) | **[verified]** MIT. It is a Claude Code skill that **depends on HyperFrames**, expects a talking-head/voiceover `script.md` input, includes `verify-render.mjs` (ffprobe checks). | Borrow the QA checklist and verify script idea. Its input model (talking head) does not fit event footage. |
| OpenChatCut (LeonSooLab) | **[verified]** AGPL-3.0, 3 stars, 38 commits, early/unstable, Remotion-based. | Architecture reference only. Do not copy code (AGPL). Its "agents only change the timeline through a command layer" idea is exactly right. |
| skills.sh / `npx skills add` | **[verified]** commands exist for HyperFrames and Remotion. These are skills for *coding agents that help build the product*, not runtime features. | Use during development only. |

## 3. Model findings

| Claim | Status |
|---|---|
| Gemini 3.8 Flash $0.75 in / $3.75 out, rising to $1.50 / $7.50 on 1 Jan 2027 | **[3rd-party]** multiple blogs agree; Google's page was unreachable from this sandbox. |
| Gemini 3.1 Pro $2 / $12 (<=200K prompt) | **[3rd-party]** agree; above-200K price disagrees across sources. |
| Gemini 3.1 Flash-Lite $0.25 / $1.50 | **[3rd-party]** agree. |
| Qwen3-Next-80B ~$0.15 / $1.50 | **[3rd-party]**, ChatGPT's $1.20 output looks outdated. |
| Kimi K2.6 ~$0.95 / $3.97 | **[3rd-party]**, ChatGPT's Beijing-region figure differs. |
| Video token rate ~263 tokens/sec, audio 32 tokens/sec | **[verified]** from Google's token docs (may vary by model/`media_resolution`). |

**Impact of the token rate:** 1 hour of footage is about 3,600 x 263 = ~950K tokens (~$0.7 on Flash input, but also over a typical context window), so never send raw hours to an LLM. A 20-minute shoot is ~315K tokens. Hence: analyze locally, send keyframes and metadata.

Rule: put every model behind one interface, store prices in config, and re-check prices monthly. Treat all names above as "to confirm in the vendor console" before the first paid call.

## 4. Additional tools I recommend (not in the ChatGPT plan)

| Need | Tool | Notes |
|---|---|---|
| Source of truth for edits | JSON timeline (OpenTimelineIO-style) with our own schema | LLM outputs this; everything else renders from it |
| Rendering core | **FFmpeg** | cuts, speed ramps, crops, audio mix, export |
| Shot detection | PySceneDetect or TransNetV2 | local, free |
| Beat/tempo | librosa or essentia | local, free; core to Indian reel pacing |
| Auto-reframe to 9:16 | MediaPipe face/pose | keep faces and the couple in frame |
| Indic speech/captions (OPTIONAL, not MVP: only for captions or to avoid cutting through speeches/vows) | **Sarvam** Saarika/Saaras: Rs 30/hour of audio, 22 Indian languages + English **[verified via docs.sarvam.ai]**; alternative: faster-whisper locally | needed for sangeet songs, speeches, Hinglish captions |
| Browser-side proxies/export | **Mediabunny** (MPL-2.0, WebCodecs, zero deps) **[verified]** | make 720p proxies in the browser to cut upload size |
| Open motion library alternative | Revideo (MIT, Motion Canvas fork, WebCodecs, ~8 contributors; last commit date unconfirmed) | evaluate vs HyperFrames; check repo health first |
| Fonts | Noto Sans Devanagari/Telugu/Tamil etc. | test shaping in the renderer early |

## 5. Music and licensing (the biggest risk)

- Bollywood/regional hits need label licences. Royalty-free libraries do not cover them (my reading, confirm with a lawyer).
- Hoopr Smash is a label-cleared Bollywood/regional licensing marketplace with a video-editor integration precedent (Illusto, 2023) **[3rd-party]**; API terms and price unverified, so contact them.
- MVP options: (a) user uploads own music and takes responsibility under ToS, (b) royalty-free Indian-flavoured library, (c) export a silent/stem edit so the user adds audio in Instagram.
- Privacy: wedding footage contains identifiable faces. Add consent text, retention limits (auto-delete originals in N days), encryption at rest, and a DPDP Act review.

## 6. Architecture

1. **Web (Next.js PWA):** upload, brief, style pack picker, timeline preview, chat revisions, export. Browser makes 720p proxies (Mediabunny) before upload.
2. **Analysis workers (Python):** scene detect, beats, faces, blur/exposure scoring, ASR. Outputs a per-shot metadata JSON. No LLM yet.
3. **Director (LLM):** receives metadata plus a few keyframes per shot plus the style pack. Returns a schema-validated JSON timeline. Flash-Lite-class for classification, Flash-class as director, Pro-class only on retry.
4. **Validator:** rejects out-of-range or unknown operations. The model never gets a shell or file access.
5. **Renderer:** FFmpeg for ~80% of operations; HyperFrames (or Revideo) for titles/overlays; compositing stitched in FFmpeg. Server-side workers with a job queue.
6. **QA:** deterministic checks (ffprobe, black frames, loudness, face-crop, safe zones), then optional LLM review, then human rating logged.
7. **Storage:** PostgreSQL (projects, timelines, versions, costs), object storage for media.

## 7. Style packs (the moat)

Hand-craft packs first, one at a time: Baraat entrance, Haldi/Mehendi, Sangeet/Garba, Devotional (Ganesh/Navratri), Diwali ad. Each pack defines pacing curve, transition set, typography and fonts, color grade, sound-design cues, and shot-selection rules. The LLM chooses and parameterizes a pack; it does not invent a style.

## 8. Roadmap

| Phase | Weeks | Deliverable | Exit test |
|---|---|---|---|
| 0 | 1-2 | Hand-edit ~10 reels for 3-5 real studios; test price; test HyperFrames source-clip compositing and Indic font shaping | At least 2 studios say they'd pay |
| 1 | 3-5 | CLI: footage -> analysis -> JSON timeline -> FFmpeg render, one style pack, no LLM (rules only) | Output beats a plain montage in blind review |
| 2 | 6-8 | Add LLM director, validator, QA checks, benchmark Gemini tiers vs one cheaper model on identical footage; log tokens/cost/corrections | Cost per reel measured, not estimated |
| 3 | 9-12 | Web app MVP: upload, brief, preview, chat revisions, export; 3 style packs | A studio finishes a real delivery with it |
| 4 | 13-16 | Private beta, payments (UPI/Razorpay), music licensing decision, privacy/retention | Retention and willingness to pay |
| 5 | later | Mobile wrapper or native; Veo/Kling inserts only if users ask | — |

## 9. Cost (to be replaced by measured numbers in Phase 2)

LLM cost per reel is small only if raw video is not sent. Expect compute (render workers), storage, and egress to dominate. Record per reel: tokens in/out, ASR minutes, render seconds, retries, human corrections. Target gross margin is set after that data exists.

## 10. Open items to confirm before building

1. Google's official pricing page for the Gemini model names and prices.
2. Remotion's current license text if it is used commercially.
3. Revideo repo health and HyperFrames source-video compositing behaviour.
4. Hoopr (or similar) licence terms, or the decision to go bring-your-own-music.
5. Legal review: AGPL avoidance, music rights, DPDP compliance.

## 11. Competition check (added 2026-10-13)

Search found existing products, mostly vendor marketing pages that I could not open to judge quality: WeddingEditor.ai (raw footage -> highlight reel/teaser for videographers), FotoOwl (reels from photographers' galleries), Short AI, Revid, Pippit (Indian wedding reel templates), beat-sync apps, plus CapCut/Premiere/Resolve. I found no India-specific auto-editor for sangeet/haldi/baraat footage, but absence in search is not proof.

**Gate before building:** run 5 real Indian event footage sets through WeddingEditor.ai, Short AI and CapCut auto features, and compare with a hand edit. Build only if competitors are clearly worse on Indian footage (pacing, music sync, Indic text, 9:16 framing) and studios say they would switch.
