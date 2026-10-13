"""Data contracts. The Timeline is the single source of truth: the director (rules or LLM)
produces it, the validator checks it, the renderer consumes it. Nothing else touches ffmpeg."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

TransitionType = Literal["cut", "dissolve", "flash", "whip", "dip"]
GradeName = Literal["clean", "warm_festive", "cinematic", "golden_devotional", "food_appetising", "vivid_dance", "cool_night"]
FitMode = Literal["crop", "blurfill"]
TextScript = Literal["latin", "devanagari", "telugu", "tamil", "gujarati", "kannada", "malayalam", "bengali", "gurmukhi"]


# ---------------------------------------------------------------- analysis
class Window(BaseModel):
    start: float  # seconds, source time
    duration: float
    score: float


class Shot(BaseModel):
    id: str
    clip_id: str
    clip_path: str  # original file
    proxy_path: str
    start: float
    end: float
    width: int
    height: int
    fps: float
    has_audio: bool
    sharpness: float = 0.0  # 0..1
    exposure: float = 0.0  # 0..1 (1 = well exposed)
    motion: float = 0.0  # 0..1
    saturation: float = 0.0  # 0..1
    face_count: float = 0.0  # mean faces per sample
    face_area: float = 0.0  # mean fraction of frame covered by largest face
    face_x: Optional[float] = None  # 0..1 horizontal centre of faces
    subject_x: float = 0.5  # 0..1 horizontal centre to keep when cropping to 9:16
    score: float = 0.0  # 0..1 overall
    scale: Literal["close", "medium", "wide"] = "wide"
    windows: list[Window] = Field(default_factory=list)  # best windows for 1.5/2.5/4s
    keyframe: str = ""  # path to jpg used for UI + LLM
    tags: list[str] = Field(default_factory=list)  # filled by tagger (LLM) or empty
    llm_note: str = ""
    highlight: float = 0.0  # 0..1 filled by tagger; 0 = unknown

    @property
    def duration(self) -> float:
        return max(0.0, self.end - self.start)

    @property
    def landscape(self) -> bool:
        return self.width >= self.height


class MusicAnalysis(BaseModel):
    path: Optional[str] = None
    duration: float = 0.0
    tempo: float = 0.0
    beats: list[float] = Field(default_factory=list)  # seconds
    downbeats: list[float] = Field(default_factory=list)  # every 4th beat (best guess phase)
    beat_strength: list[float] = Field(default_factory=list)  # 0..1 per beat
    energy: list[float] = Field(default_factory=list)  # 0..1 per second
    start_offset: float = 0.0  # chosen start inside the song for this reel
    drop_time: Optional[float] = None  # seconds relative to start_offset of biggest energy rise
    synthetic: bool = False  # True when no music was supplied and a grid was synthesised


class Analysis(BaseModel):
    shots: list[Shot]
    music: MusicAnalysis
    clips: list[dict] = Field(default_factory=list)


# ---------------------------------------------------------------- timeline
class Reframe(BaseModel):
    mode: FitMode = "crop"
    x: float = Field(0.5, ge=0, le=1)


class Segment(BaseModel):
    shot_id: str
    source_start: float = Field(ge=0)  # where to start in the source clip, seconds
    duration: float = Field(gt=0.15, le=20)  # OUTPUT duration, seconds
    speed: float = Field(1.0, ge=0.25, le=4.0)  # constant speed (<1 = slow motion)
    ramp: Literal["none", "slow_out", "fast_out"] = "none"  # 1x -> 0.4x, or 0.5x -> 1.3x
    zoom: Literal["none", "push", "pull"] = "none"
    transition_in: TransitionType = "cut"
    transition_duration: float = Field(0.0, ge=0, le=1.0)
    reframe: Reframe = Field(default_factory=Reframe)
    audio_gain: float = Field(0.0, ge=0, le=1)  # keep source audio (speech, dhol) at this level
    note: str = ""


class TextOverlay(BaseModel):
    text: str = Field(min_length=1, max_length=80)
    start: float = Field(ge=0)
    duration: float = Field(gt=0.3, le=8)
    position: Literal["top", "center", "lower"] = "lower"
    script: TextScript = "latin"
    size: Literal["s", "m", "l"] = "m"
    color: str = "#FFFFFF"
    box: bool = False

    @field_validator("color")
    @classmethod
    def _color(cls, v: str) -> str:
        if len(v) != 7 or not v.startswith("#"):
            raise ValueError("color must be #RRGGBB")
        int(v[1:], 16)
        return v


class Music(BaseModel):
    path: Optional[str] = None
    start_offset: float = 0.0
    volume: float = Field(1.0, ge=0, le=1.5)
    fade_in: float = 0.3
    fade_out: float = 1.2


class Timeline(BaseModel):
    version: int = 1
    width: int = 1080
    height: int = 1920
    fps: int = 30
    style: str = "generic_event"
    grade: GradeName = "clean"
    segments: list[Segment]
    overlays: list[TextOverlay] = Field(default_factory=list)
    music: Music = Field(default_factory=Music)
    target_duration: float = 30.0
    director: str = "rules"  # rules | llm:<model>
    rationale: str = ""

    def total_duration(self) -> float:
        total = 0.0
        for i, s in enumerate(self.segments):
            if i == 0:
                total += s.duration
            else:
                total += s.duration - (s.transition_duration if s.transition_in in ("dissolve", "whip", "dip") else 0.0)
        return total

    def starts(self) -> list[float]:
        """Start time of each segment on the output timeline."""
        out, t = [], 0.0
        for i, s in enumerate(self.segments):
            if i > 0 and s.transition_in in ("dissolve", "whip", "dip"):
                t -= s.transition_duration
            out.append(max(0.0, t))
            t += s.duration
        return out


# ---------------------------------------------------------------- style pack
class PacingStage(BaseModel):
    until: float = Field(gt=0, le=1.0)  # fraction of reel
    beats_per_cut: float = Field(gt=0)


class StylePack(BaseModel):
    id: str
    name: str
    description: str
    category: Literal["wedding", "festival", "dance", "ad", "venue"] = "wedding"
    default_bpm: float = 100
    ordering: Literal["chronological", "energy_build", "best_first"] = "best_first"
    pacing: list[PacingStage]
    grade: GradeName = "clean"
    transitions: dict[str, float] = Field(default_factory=lambda: {"cut": 1.0})
    flash_on_drop: bool = True
    zoom_punch: float = Field(0.5, ge=0, le=1)  # probability of push/pull per segment
    slow_mo_rate: float = Field(0.15, ge=0, le=1)  # share of peak segments that get slow motion
    ramp_rate: float = Field(0.1, ge=0, le=1)
    prefer_scale_alternation: bool = True
    music_volume: float = 1.0
    keep_source_audio: bool = False
    title_color: str = "#FFFFFF"
    title_box: bool = False
    music_hint: str = ""
    hook_beats: float = 2.0  # length of the opening hook shot in beats
    ending: Literal["fade", "hold"] = "fade"


# ---------------------------------------------------------------- job params
class Brief(BaseModel):
    style: str = "generic_event"
    duration: float = Field(30.0, ge=8, le=90)
    title: str = ""
    subtitle: str = ""
    end_text: str = ""
    text_script: TextScript = "latin"
    notes: str = ""
    quality: Literal["draft", "final"] = "draft"
    use_llm: bool = True
    # tweakable by revisions
    pace: float = Field(1.0, ge=0.4, le=2.5)  # >1 = more cuts
    zoom_level: float = Field(1.0, ge=0, le=2.0)
    flash_level: float = Field(1.0, ge=0, le=2.0)
    grade: Optional[GradeName] = None
    text_enabled: bool = True
    exclude_shots: list[str] = Field(default_factory=list)
    pin_hook: Optional[str] = None
    seed: int = 7
