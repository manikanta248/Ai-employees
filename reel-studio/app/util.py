from __future__ import annotations

import json
import subprocess
from pathlib import Path


class FFmpegError(RuntimeError):
    pass


def run(cmd: list[str], timeout: int = 1800) -> subprocess.CompletedProcess:
    """Run a command with a fixed argv (never through a shell)."""
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired as e:
        raise FFmpegError(f"timeout running {cmd[0]}") from e
    if proc.returncode != 0:
        raise FFmpegError(f"{cmd[0]} failed ({proc.returncode}): {proc.stderr[-1500:]}")
    return proc


def probe(path: str | Path) -> dict:
    out = run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)]).stdout
    data = json.loads(out)
    video = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), None)
    audio = next((s for s in data.get("streams", []) if s.get("codec_type") == "audio"), None)
    info = {"duration": float(data.get("format", {}).get("duration", 0) or 0), "has_audio": audio is not None, "has_video": video is not None}
    if video:
        w, h = int(video["width"]), int(video["height"])
        rot = 0
        for sd in video.get("side_data_list", []) or []:
            if "rotation" in sd:
                rot = int(sd["rotation"])
        rot = rot or int(video.get("tags", {}).get("rotate", 0) or 0)
        if abs(rot) in (90, 270):
            w, h = h, w  # ffmpeg auto-rotates on decode
        num, _, den = (video.get("avg_frame_rate") or "30/1").partition("/")
        fps = float(num) / float(den or 1) if float(den or 1) else 30.0
        info.update(width=w, height=h, fps=fps if 1 < fps < 241 else 30.0)
        if not info["duration"]:
            info["duration"] = float(video.get("duration", 0) or 0)
    return info
