"""Music analysis (beats, downbeats, energy, best section) and a licence-free placeholder beat."""
from __future__ import annotations

from pathlib import Path

import numpy as np

from ..schemas import MusicAnalysis


def analyze_music(path: str, target_duration: float) -> MusicAnalysis:
    import librosa

    y, sr = librosa.load(path, sr=22050, mono=True, duration=600)
    total = float(len(y) / sr)
    hop = 512
    onset = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    tempo, beat_frames = librosa.beat.beat_track(onset_envelope=onset, sr=sr, hop_length=hop, units="frames")
    tempo = float(np.atleast_1d(tempo)[0])
    beats = librosa.frames_to_time(beat_frames, sr=sr, hop_length=hop)
    if len(beats) < 4:  # no usable beat: fall back to a metronome at the estimated tempo
        tempo = tempo if 60 <= tempo <= 200 else 100.0
        beats = np.arange(0, total, 60.0 / tempo)
    strengths = np.array([onset[min(int(f), len(onset) - 1)] for f in librosa.time_to_frames(beats, sr=sr, hop_length=hop)])
    strengths = strengths / (strengths.max() + 1e-9)
    # downbeat phase = the 1-in-4 phase with the strongest accents
    phase = int(np.argmax([strengths[p::4].sum() for p in range(4)]))
    downbeats = beats[phase::4]

    rms = librosa.feature.rms(y=y, hop_length=sr // 2 if sr >= 2 else hop)[0]  # ~2 values per second
    per_sec = np.array([rms[i : i + 2].mean() for i in range(0, len(rms) - 1, 2)]) if len(rms) > 2 else rms
    energy = per_sec / (per_sec.max() + 1e-9)

    start = _best_start(energy, downbeats, total, target_duration)
    drop = _drop_time(energy, start, target_duration)
    return MusicAnalysis(
        path=path,
        duration=total,
        tempo=tempo,
        beats=[round(float(b), 4) for b in beats],
        downbeats=[round(float(b), 4) for b in downbeats],
        beat_strength=[round(float(s), 3) for s in strengths],
        energy=[round(float(e), 3) for e in energy],
        start_offset=round(start, 4),
        drop_time=drop,
    )


def _best_start(energy: np.ndarray, downbeats: np.ndarray, total: float, dur: float) -> float:
    if total <= dur + 1.0 or len(downbeats) == 0:
        return float(downbeats[0]) if len(downbeats) and total <= dur + 1.0 and downbeats[0] < 2.5 else 0.0
    best, best_t = -1.0, 0.0
    for d in downbeats:
        if d + dur > total:
            break
        lo, hi = int(d), int(d + dur)
        window = energy[lo : max(hi, lo + 1)]
        if len(window) == 0:
            continue
        # reward loud sections, and a start that is not silent
        score = float(window.mean()) + 0.15 * float(window[: max(1, len(window) // 8)].mean())
        if score > best:
            best, best_t = score, float(d)
    return best_t


def _drop_time(energy: np.ndarray, start: float, dur: float) -> float | None:
    lo, hi = int(start), min(len(energy), int(start + dur))
    if hi - lo < 6:
        return None
    seg = energy[lo:hi]
    k = 2
    best, best_i = 0.0, None
    for i in range(k, len(seg) - k):
        rise = seg[i : i + k].mean() - seg[i - k : i].mean()
        if rise > best:
            best, best_i = rise, i
    return float(best_i / 1.0) if best_i is not None and best > 0.08 else None


def synthetic_grid(bpm: float, duration: float) -> MusicAnalysis:
    beat = 60.0 / bpm
    beats = np.arange(0, duration + beat, beat)
    return MusicAnalysis(
        path=None,
        duration=duration,
        tempo=bpm,
        beats=[round(float(b), 4) for b in beats],
        downbeats=[round(float(b), 4) for b in beats[::4]],
        beat_strength=[1.0 if i % 4 == 0 else 0.6 for i in range(len(beats))],
        energy=[0.6] * int(duration + 1),
        start_offset=0.0,
        drop_time=None,
        synthetic=True,
    )


def write_placeholder_beat(path: Path, bpm: float, duration: float, sr: int = 44100) -> None:
    """A simple dhol-style placeholder loop we synthesise ourselves (no licensing issues).
    It exists so test reels have a rhythm; real music should be supplied by the user."""
    import soundfile as sf

    n = int(duration * sr)
    out = np.zeros(n, dtype=np.float32)
    beat = 60.0 / bpm
    rng = np.random.default_rng(3)

    def kick(i: int) -> None:
        t = np.arange(int(0.22 * sr)) / sr
        f = 140 * np.exp(-t * 18) + 45
        wave = np.sin(2 * np.pi * np.cumsum(f) / sr) * np.exp(-t * 11)
        out[i : i + len(wave)] += (wave * 0.9)[: n - i]

    def snare(i: int) -> None:
        t = np.arange(int(0.16 * sr)) / sr
        noise = rng.standard_normal(len(t)) * np.exp(-t * 28)
        tone = np.sin(2 * np.pi * 190 * t) * np.exp(-t * 25)
        wave = (noise * 0.5 + tone * 0.4)
        out[i : i + len(wave)] += wave[: n - i].astype(np.float32)

    def hat(i: int) -> None:
        t = np.arange(int(0.05 * sr)) / sr
        wave = rng.standard_normal(len(t)) * np.exp(-t * 90) * 0.18
        out[i : i + len(wave)] += wave[: n - i].astype(np.float32)

    k = 0
    t = 0.0
    while t < duration:
        i = int(t * sr)
        step = k % 8  # eighth notes, 4/4
        if step in (0, 3, 4):
            kick(i)
        if step in (2, 6):
            snare(i)
        hat(i)
        t += beat / 2
        k += 1
    out = np.tanh(out * 1.2)
    out /= max(1e-6, float(np.abs(out).max())) / 0.8
    sf.write(str(path), out, sr)
