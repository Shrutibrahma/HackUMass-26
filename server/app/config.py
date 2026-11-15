"""All settings come from the environment. Keys never leave the server."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv


# Process environment always wins. These files are local-development fallbacks only;
# ``tokens.env`` lives at the repository root and must remain gitignored.
_HERE = Path(__file__).resolve()
_FINGERTIP_ROOT = _HERE.parents[2]
_REPOSITORY_ROOT = _HERE.parents[3]
for _env_file in (_REPOSITORY_ROOT / ".env", _FINGERTIP_ROOT / ".env", _REPOSITORY_ROOT / "tokens.env"):
    if _env_file.is_file():
        load_dotenv(_env_file, override=False)


def _bool(name: str, default: bool) -> bool:
    v = os.getenv(name)
    if v is None:
        return default
    return v.strip().lower() in {"1", "true", "yes", "on"}


@dataclass
class Settings:
    # Product name (formerly Sign2Speak). Mirrors app/src/brand.ts.
    app_name: str = field(default_factory=lambda: os.getenv("APP_NAME", "Fingertip"))
    # Public base URL, e.g. https://sign2speak.example.com (no trailing slash).
    public_url: str = field(default_factory=lambda: os.getenv("PUBLIC_URL", "http://localhost:8000").rstrip("/"))

    twilio_account_sid: str = field(default_factory=lambda: os.getenv("TWILIO_ACCOUNT_SID", ""))
    twilio_auth_token: str = field(default_factory=lambda: os.getenv("TWILIO_AUTH_TOKEN", ""))
    twilio_number: str = field(default_factory=lambda: os.getenv("TWILIO_NUMBER", ""))
    # Turn off only for local tests. Never in production.
    validate_twilio_signature: bool = field(default_factory=lambda: _bool("VALIDATE_TWILIO_SIGNATURE", True))

    # ElevenLabs voice through ConversationRelay. Format (Twilio docs):
    #   VOICE_ID-MODEL-SPEED_STABILITY_SIMILARITY  (all settings or none)
    # Twilio recommends ElevenLabs v4 for conversational quality and low latency.
    # v3/v4 settings contain stability + similarity (no speed).
    tts_provider: str = field(default_factory=lambda: os.getenv("TTS_PROVIDER", "ElevenLabs"))
    tts_model: str = field(default_factory=lambda: os.getenv("TTS_MODEL", "flash_v2_5"))
    tts_voice_settings: str = field(default_factory=lambda: os.getenv("TTS_VOICE_SETTINGS", ""))
    default_voice_id: str = field(default_factory=lambda: os.getenv("DEFAULT_VOICE_ID", "XrExE9yKIg1WjnnlVkGX"))
    language: str = field(default_factory=lambda: os.getenv("CALL_LANGUAGE", "en-US"))

    gemini_api_key: str = field(default_factory=lambda: os.getenv("GEMINI_API_KEY", ""))
    # Turn analyzer, note parser, reply writer. The server checks the model exists at startup.
    gemini_model: str = field(default_factory=lambda: os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite"))
    # Switch reply writing to gemini-3.8-flash only if reply quality tests fail.
    gemini_reply_model: str = field(default_factory=lambda: os.getenv("GEMINI_REPLY_MODEL", ""))
    gemini_thinking_level: str = field(default_factory=lambda: os.getenv("GEMINI_THINKING_LEVEL", "minimal"))
    # Automatic face-to-tone is experimental: furrowed brows also mark ASL wh-questions.
    face_tone: bool = field(default_factory=lambda: _bool("FACE_TONE", False))
    gemini_timeout_s: float = field(default_factory=lambda: float(os.getenv("GEMINI_TIMEOUT_S", "2.5")))

    # Show it (video -> evidence-linked facts with overlays). See server/app/show.py.
    gemini_video_model: str = field(default_factory=lambda: os.getenv("GEMINI_VIDEO_MODEL", "gemini-3.8-flash"))
    show_fps: float = field(default_factory=lambda: float(os.getenv("SHOW_FPS", "4")))            # overview pass
    show_section_fps: float = field(default_factory=lambda: float(os.getenv("SHOW_SECTION_FPS", "8")))  # transcripts
    show_refine_fps: float = field(default_factory=lambda: float(os.getenv("SHOW_REFINE_FPS", "10")))   # precision
    show_refine_window: float = field(default_factory=lambda: float(os.getenv("SHOW_REFINE_WINDOW", "3")))
    show_timeout_s: float = field(default_factory=lambda: float(os.getenv("SHOW_TIMEOUT_S", "180")))
    show_dir: str = field(default_factory=lambda: os.getenv("SHOW_DIR", "data/shows"))
    show_ttl_hours: float = field(default_factory=lambda: float(os.getenv("SHOW_TTL_HOURS", "24")))
    show_max_mb: int = field(default_factory=lambda: int(os.getenv("SHOW_MAX_MB", "60")))

    # Meet extension only (calls use ConversationRelay): direct ElevenLabs TTS for the Meet mic.
    elevenlabs_api_key: str = field(default_factory=lambda: os.getenv("ELEVENLABS_API_KEY", ""))
    gemini_tts_model: str = field(default_factory=lambda: os.getenv("GEMINI_TTS_MODEL", "gemini-3.8-flash-lite-tts"))
    gemini_tts_voice: str = field(default_factory=lambda: os.getenv("GEMINI_TTS_VOICE", "Kore"))
    elevenlabs_model: str = field(default_factory=lambda: os.getenv("ELEVENLABS_MODEL", "eleven_flash_v2_5"))

    # Optional shared key for the signer app (?key=... once, kept in the browser).
    app_access_key: str = field(default_factory=lambda: os.getenv("APP_ACCESS_KEY", ""))

    # Toll-fraud protection: dial limits for the whole server.
    dial_max_per_min: int = field(default_factory=lambda: int(os.getenv("DIAL_MAX_PER_MIN", "10")))
    max_live_calls: int = field(default_factory=lambda: int(os.getenv("MAX_LIVE_CALLS", "3")))

    ring_timeout_s: int = field(default_factory=lambda: int(os.getenv("RING_TIMEOUT_S", "35")))
    static_dir: str = field(default_factory=lambda: os.getenv("STATIC_DIR", ""))
    log_dir: str = field(default_factory=lambda: os.getenv("LOG_DIR", "logs"))

    @property
    def twilio_ready(self) -> bool:
        return bool(self.twilio_account_sid and self.twilio_auth_token and self.twilio_number)

    @property
    def gemini_ready(self) -> bool:
        return bool(self.gemini_api_key and self.gemini_model)

    @property
    def ws_base(self) -> str:
        if self.public_url.startswith("https://"):
            return "wss://" + self.public_url[len("https://"):]
        return "ws://" + self.public_url[len("http://"):]

    @property
    def expressive_tts(self) -> bool:
        """ElevenLabs v3/v4: no SSML, no speed; natural-language audio tags like [warmly] go in the text."""
        return self.tts_model.lower() in {"v3", "v4", "v4_turbo", "v3_conversational"}

    def voice_string(self, voice_id: str | None) -> str:
        vid = voice_id or self.default_voice_id
        parts = [vid]
        if self.tts_model:
            parts.append(self.tts_model)
        if self.tts_voice_settings:
            values = self.tts_voice_settings.split("_")
            # v3/v4 accept stability + similarity; older models accept speed + both.
            expected = 2 if self.expressive_tts else 3
            if len(values) == expected:
                try:
                    if all(0 <= float(value) <= (2 if i == 0 and expected == 3 else 1)
                           for i, value in enumerate(values)):
                        parts.append(self.tts_voice_settings)
                except ValueError:
                    pass
        return "-".join(parts)


settings = Settings()


