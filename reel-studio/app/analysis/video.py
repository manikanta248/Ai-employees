"""Local (no-LLM) video analysis: shot detection, quality/motion/face scoring, best windows.

Everything here runs on a small proxy so it stays cheap. The LLM only ever sees keyframes
and the numbers computed here, never raw video.
"""
from __future__ import annotations

import math
from pathlib import Path

import cv2
import numpy as np

from ..schemas import Shot, Window
from ..util import probe, run

SAMPLE_STEP = 0.25  # seconds between analysed frames
MAX_SHOT = 8.0  # long continuous takes are split into pieces of at most this length
MIN_SHOT = 0.6
_FACE = None


def _face_detector():
    global _FACE
    if _FACE is None:
        _FACE = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    return _FACE


def make_proxy(src: str, dst: str) -> None:
    """Tiny analysis proxy: short side 360px, 10 fps, no audio."""
    vf = "scale=w='if(gt(iw,ih),-2,360)':h='if(gt(iw,ih),360,-2)',fps=10"
    run(["ffmpeg", "-y", "-v", "error", "-i", src, "-an", "-vf", vf, "-c:v", "libx264", "-preset", "ultrafast", "-crf", "30", dst])


def detect_shots(proxy: str, duration: float) -> list[tuple[float, float]]:
    from scenedetect import ContentDetector, detect

    try:
        scenes = detect(proxy, ContentDetector(threshold=27.0, min_scene_len=8), show_progress=False)
        bounds = [(s.get_seconds(), e.get_seconds()) for s, e in scenes]
    except Exception:
        bounds = []
    if not bounds:
        bounds = [(0.0, duration)]
    out: list[tuple[float, float]] = []
    for s, e in bounds:
        length = e - s
        if length <= MAX_SHOT:
            out.append((s, e))
        else:  # split continuous takes into roughly equal pieces
            n = math.ceil(length / MAX_SHOT)
            step = length / n
            out.extend((s + i * step, s + (i + 1) * step) for i in range(n))
    return [(s, e) for s, e in out if e - s >= MIN_SHOT] or [(0.0, duration)]


def _sample_frames(proxy: str) -> list[dict]:
    cap = cv2.VideoCapture(proxy)
    fps = cap.get(cv2.CAP_PROP_FPS) or 10.0
    step = max(1, round(fps * SAMPLE_STEP))
    samples: list[dict] = []
    prev_small = None
    idx = 0
    detector = _face_detector()
    while True:
        ok = cap.grab()
        if not ok:
            break
        if idx % step == 0:
            ok, frame = cap.retrieve()
            if not ok:
                break
            h, w = frame.shape[:2]
            scale = 320.0 / max(w, 1)
            small = cv2.resize(frame, (320, max(1, int(h * scale))))
            gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
            lap = cv2.Laplacian(gray, cv2.CV_64F).var()
            mean = float(gray.mean())
            hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
            sat = float(hsv[..., 1].mean()) / 255.0
            motion, mx = 0.0, 0.5
            if prev_small is not None and prev_small.shape == gray.shape:
                diff = cv2.absdiff(gray, prev_small).astype(np.float32)
                motion = float(diff.mean())
                col = diff.mean(axis=0)
                if col.sum() > 1e-3:
                    mx = float((col * np.arange(len(col))).sum() / col.sum() / len(col))
            prev_small = gray
            faces = detector.detectMultiScale(gray, 1.2, 6, minSize=(22, 22))
            fl = [((x + fw / 2) / gray.shape[1], (y + fh / 2) / gray.shape[0], fw * fh / float(gray.shape[0] * gray.shape[1])) for x, y, fw, fh in faces]
            # bokeh heuristic for close-ups without faces: sharp centre, soft border
            hh, ww = gray.shape
            centre = gray[hh // 4 : 3 * hh // 4, ww // 4 : 3 * ww // 4]
            c_var = cv2.Laplacian(centre, cv2.CV_64F).var()
            bokeh = float(c_var / (lap + 1e-6))
            samples.append({"t": idx / fps, "lap": lap, "mean": mean, "sat": sat, "motion": motion, "mx": mx, "faces": fl, "bokeh": bokeh})
        idx += 1
    cap.release()
    return samples


def _norm_sample(s: dict) -> dict:
    sharp = float(np.clip((math.log1p(s["lap"]) - 3.0) / 4.0, 0, 1))
    exposure = float(np.clip(1.0 - abs(s["mean"] - 125.0) / 125.0, 0, 1))
    motion = float(np.clip(s["motion"] / 25.0, 0, 1))
    nfaces = len(s["faces"])
    score = 0.30 * sharp + 0.20 * exposure + 0.25 * motion + 0.10 * s["sat"] + 0.15 * min(1.0, nfaces / 2.0)
    if sharp < 0.2:
        score *= 0.8
    return {**s, "sharp": sharp, "exposure": exposure, "motion_n": motion, "score": float(np.clip(score, 0, 1))}


def _windows(samples: list[dict], start: float, end: float) -> list[Window]:
    pts = [(s["t"], s["score"]) for s in samples if start <= s["t"] < end]
    if not pts:
        return [Window(start=start, duration=max(0.3, end - start), score=0.0)]
    out = []
    for length in (1.5, 2.5, 4.0):
        if end - start < length:
            out.append(Window(start=start, duration=end - start, score=float(np.mean([p[1] for p in pts]))))
            continue
        best, best_t = -1.0, start
        t = start
        while t + length <= end + 1e-6:
            vals = [sc for tt, sc in pts if t <= tt < t + length]
            if vals:
                m = float(np.mean(vals))
                if m > best:
                    best, best_t = m, t
            t += SAMPLE_STEP
        out.append(Window(start=round(best_t, 3), duration=length, score=max(best, 0.0)))
    return out


def analyze_clip(clip_id: str, src: str, workdir: Path) -> tuple[list[Shot], dict]:
    info = probe(src)
    if not info.get("has_video"):
        raise ValueError(f"{Path(src).name} has no video stream")
    proxy = str(workdir / f"{clip_id}_proxy.mp4")
    make_proxy(src, proxy)
    duration = info["duration"] or probe(proxy)["duration"]
    bounds = detect_shots(proxy, duration)
    samples = [_norm_sample(s) for s in _sample_frames(proxy)]
    shots: list[Shot] = []
    for i, (s0, e0) in enumerate(bounds):
        seg = [x for x in samples if s0 <= x["t"] < e0] or samples[-1:] or []
        if not seg:
            continue
        faces_all = [f for x in seg for f in x["faces"]]
        face_frames = [x for x in seg if x["faces"]]
        face_share = len(face_frames) / len(seg)
        largest = [max(f[2] for f in x["faces"]) for x in face_frames]
        face_area = float(np.mean(largest)) if largest else 0.0
        face_x = float(np.average([f[0] for f in faces_all], weights=[f[2] for f in faces_all])) if faces_all else None
        motion_x = float(np.mean([x["mx"] for x in seg]))
        subject_x = face_x if (face_x is not None and face_share >= 0.25) else float(np.clip(motion_x, 0.25, 0.75))
        bokeh = float(np.mean([x["bokeh"] for x in seg]))
        if face_area > 0.04 or (not faces_all and bokeh > 2.5):
            scale = "close"
        elif face_area > 0.012:
            scale = "medium"
        else:
            scale = "wide"
        wins = _windows(samples, s0, e0)
        shot = Shot(
            id=f"{clip_id}_s{i:02d}",
            clip_id=clip_id,
            clip_path=src,
            proxy_path=proxy,
            start=round(s0, 3),
            end=round(e0, 3),
            width=info["width"],
            height=info["height"],
            fps=info["fps"],
            has_audio=info["has_audio"],
            sharpness=float(np.mean([x["sharp"] for x in seg])),
            exposure=float(np.mean([x["exposure"] for x in seg])),
            motion=float(np.mean([x["motion_n"] for x in seg])),
            saturation=float(np.mean([x["sat"] for x in seg])),
            face_count=float(np.mean([len(x["faces"]) for x in seg])),
            face_area=face_area,
            face_x=face_x,
            subject_x=float(np.clip(subject_x, 0.0, 1.0)),
            score=float(np.mean([x["score"] for x in seg]) * 0.7 + max(w.score for w in wins) * 0.3),
            scale=scale,
            windows=wins,
        )
        shots.append(shot)
    return shots, info


def save_keyframe(shot: Shot, dst: Path, width: int = 384) -> str:
    cap = cv2.VideoCapture(shot.proxy_path)
    best = max(shot.windows, key=lambda w: w.score) if shot.windows else None
    t = (best.start + best.duration / 2) if best else (shot.start + shot.end) / 2
    cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000.0)
    ok, frame = cap.read()
    cap.release()
    if not ok:
        return ""
    h, w = frame.shape[:2]
    frame = cv2.resize(frame, (width, max(1, int(h * width / w))))
    cv2.imwrite(str(dst), frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
    return str(dst)
