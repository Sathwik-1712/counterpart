from app.config import Settings
from app.providers.openai_compat import OpenAICompatChat, OpenAICompatImage
from app.providers.ratelimit import RpmLimiter
from app.providers.replay import ReplayCache
from app.providers.router import ModelRouter

# Agnes list prices (USD per 1M tokens) from the HR26 brief; currently $0 on the platform.
AGNES_PRICE_IN, AGNES_PRICE_OUT = 0.05, 0.15


def build_router(s: Settings) -> ModelRouter:
    """Wire providers from settings. Swapping a model is a config change, not a code change."""
    llms, images = {}, {}
    if s.agnes_api_key:
        key = s.agnes_api_key.get_secret_value()
        llms["agnes"] = OpenAICompatChat(
            name="agnes", base_url=s.agnes_base_url, api_key=key, model=s.agnes_text_model,
            limiter=RpmLimiter(s.agnes_text_rpm), price_in=AGNES_PRICE_IN, price_out=AGNES_PRICE_OUT,
        )
        images["agnes"] = OpenAICompatImage(
            name="agnes", base_url=s.agnes_base_url, api_key=key, model=s.agnes_image_model,
            limiter=RpmLimiter(s.agnes_image_rpm),
        )
    if s.gemini_api_key:
        key = s.gemini_api_key.get_secret_value()
        for model in (m.strip() for m in s.gemini_models.split(",") if m.strip()):
            llms[model] = OpenAICompatChat(name=model, base_url=s.gemini_base_url, api_key=key, model=model,
                                           limiter=RpmLimiter(s.gemini_rpm), structured_output=True)
    if s.alt_llm_base_url and s.alt_llm_api_key and s.alt_llm_model:
        llms["alt"] = OpenAICompatChat(
            name="alt", base_url=s.alt_llm_base_url, api_key=s.alt_llm_api_key.get_secret_value(),
            model=s.alt_llm_model, limiter=RpmLimiter(s.alt_llm_rpm),
        )

    def chain(v: str) -> list[str]:
        return [x.strip() for x in v.split(",") if x.strip()]

    return ModelRouter(
        llms=llms,
        images=images,
        roles={
            "reasoning": chain(s.role_reasoning),
            "generation": chain(s.role_generation),
            "verification": chain(s.role_verification),
            "image": chain(s.role_image),
        },
        replay=ReplayCache(s.replay_dir),
        replay_mode=s.replay_mode,
    )
