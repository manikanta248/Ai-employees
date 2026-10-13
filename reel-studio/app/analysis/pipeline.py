from __future__ import annotations

from pathlib import Path
from typing import Callable, Optional

from ..schemas import Analysis, MusicAnalysis, Shot
from .audio import analyze_music, synthetic_grid
from .video import analyze_clip, save_keyframe

Progress = Callable[[str, float], None]


def analyze_project(
    clips: list[Path],
    music: Optional[Path],
    workdir: Path,
    target_duration: float,
    default_bpm: float,
    progress: Optional[Progress] = None,
) -> Analysis:
    progress = progress or (lambda msg, frac: None)
    shots: list[Shot] = []
    clip_infos: list[dict] = []
    n = max(1, len(clips))
    kdir = workdir / "keyframes"
    kdir.mkdir(exist_ok=True)
    for i, path in enumerate(clips):
        progress(f"Analysing {path.name}", 0.05 + 0.6 * i / n)
        cid = f"c{i:02d}"
        try:
            clip_shots, info = analyze_clip(cid, str(path), workdir)
        except Exception as e:  # one unreadable clip must not kill the job
            clip_infos.append({"id": cid, "name": path.name, "error": str(e)})
            continue
        for s in clip_shots:
            s.keyframe = save_keyframe(s, kdir / f"{s.id}.jpg")
        shots.extend(clip_shots)
        clip_infos.append({"id": cid, "name": path.name, "duration": info["duration"], "width": info["width"], "height": info["height"], "fps": info["fps"], "shots": len(clip_shots)})
    if not shots:
        raise ValueError("No usable video found in the uploaded clips")
    progress("Analysing music", 0.7)
    if music:
        m = analyze_music(str(music), target_duration)
    else:
        m = synthetic_grid(default_bpm, target_duration + 10)
    return Analysis(shots=shots, music=m, clips=clip_infos)
