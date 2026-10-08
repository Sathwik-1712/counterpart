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

    # Optional second OpenAI-compatible LLM (independent verifier / live model swap).
    alt_llm_base_url: str | None = None
    alt_llm_api_key: SecretStr | None = None
    alt_llm_model: str | None = None
    alt_llm_rpm: int = 30

    # Role -> provider chain. Names: "agnes", "alt". The replay cache sits in front of every chain.
    role_reasoning: str = "agnes"
    role_generation: str = "agnes"
    role_verification: str = "agnes"
    role_image: str = "agnes"

    # Record/replay of model outputs. Replayed outputs are always labelled in the UI.
    replay_mode: Literal["off", "record", "replay"] = "off"
    replay_dir: Path = REPO_ROOT / "data" / "replay"

    # Generated files. "local" for the MVP; "supabase" when deployed.
    storage_backend: Literal["local", "supabase"] = "local"
    storage_dir: Path = REPO_ROOT / "data" / "storage"
    supabase_url: str | None = None
    supabase_service_role_key: SecretStr | None = None
    supabase_bucket: str = "campaign-assets"

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
