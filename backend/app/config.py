from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """All configuration comes from environment variables (or backend/.env).

    Secrets (Agnes key, Supabase service-role key, owner token) live only here,
    on the server. Nothing in this object is ever sent to the browser.
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Postgres. Supabase: use the *session pooler* connection string (IPv4, port 5432).
    database_url: str

    # Agnes (official hackathon platform) — first-class provider.
    agnes_api_key: SecretStr | None = None
    agnes_base_url: str = "https://apihub.agnes-ai.com/v1"
    agnes_text_model: str = "agnes-3.0-flash"
    agnes_image_model: str = "agnes-image-2.5-flash"
    agnes_text_rpm: int = 10
    agnes_image_rpm: int = 10

    # Google Gemini through its OpenAI-compatible endpoint. Each listed model becomes a provider named by its id,
    # so roles can chain several models (the free tier gives each model its own small daily quota).
    gemini_api_key: SecretStr | None = None
    gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta/openai"
    gemini_models: str = ("gemini-3.7-flash,gemini-3.8-flash,gemini-3.6-flash,gemini-3.5-flash,"
                          "gemini-3.5-flash-lite,gemini-3.1-flash-lite")
    gemini_rpm: int = 10

    # Optional second OpenAI-compatible LLM (independent verifier / live model swap).
    alt_llm_base_url: str | None = None
    alt_llm_api_key: SecretStr | None = None
    alt_llm_model: str | None = None
    alt_llm_rpm: int = 30

    # Role -> provider chain; unconfigured names are skipped. Names: Gemini model ids, "agnes", "alt".
    # The writer and the checker start on different models, so a model never checks its own copy.
    # The replay cache sits in front of every chain.
    role_reasoning: str = "gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3.5-flash,agnes"
    role_generation: str = "gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash,gemini-3.5-flash-lite,agnes"
    role_verification: str = "gemini-3.8-flash,gemini-3.6-flash,gemini-3.5-flash,gemini-3.1-flash-lite,agnes"
    role_image: str = "agnes"
    # Reads the business's photos once (caption, tags) so posts can be matched to the right one.
    role_vision: str = "gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3.5-flash"

    # Record/replay of model outputs. Replayed outputs are always labelled in the UI.
    replay_mode: Literal["off", "record", "replay"] = "off"
    replay_dir: Path = REPO_ROOT / "data" / "replay"

    # Generated files. "local" for the MVP; "supabase" when deployed.
    storage_backend: Literal["local", "supabase"] = "local"
    storage_dir: Path = REPO_ROOT / "data" / "storage"
    supabase_url: str | None = None
    # Secret key (sb_secret_...) or legacy service_role key: storage uploads and creating confirmed accounts.
    supabase_service_role_key: SecretStr | None = None
    supabase_bucket: str = "campaign-assets"

    # Accounts (Supabase Auth). The publishable key is not secret, but it is only ever used server-side here.
    supabase_publishable_key: str | None = None
    # "Try the demo" signs in as this account; it is a member of the demo business only.
    demo_email: str = "demo@counterpart.app"
    demo_password: SecretStr | None = None

    # Photos of the business itself. Google Places API (New) key for the business's Google Maps photos (optional;
    # website import and uploads work without it).
    google_maps_api_key: SecretStr | None = None
    # When a business has no usable photos yet, fall back to an AI picture (labelled as such in the UI).
    ai_picture_fallback: bool = True

    # If set, owner routes require the X-Owner-Token header (added server-side by the Next.js proxy).
    owner_api_token: SecretStr | None = None
    # Public origin of the frontend, used to build QR code links.
    public_base_url: str = "http://localhost:3000"
    cors_origins: list[str] = ["http://localhost:3000"]

    # Agent budgets per run.
    agent_max_steps: int = 8
    agent_max_llm_calls: int = 8


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
