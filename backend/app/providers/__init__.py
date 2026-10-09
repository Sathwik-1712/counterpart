from app.config import Settings
from app.providers.openai_compat import OpenAICompatChat, OpenAICompatImage
from app.providers.ratelimit import RpmLimiter
from app.providers.replay import ReplayCache
from app.providers.router import ModelRouter

# Agnes list prices (USD per 1M tokens) from the HR26 brief; currently $0 on the platform.
AGNES_PRICE_IN, AGNES_PRICE_OUT = 0.05, 0.15
SECOND_KEY = "@2"  # provider-name suffix for Gemini models on GEMINI_API_KEY_2


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
    gemini = [m.strip() for m in s.gemini_models.split(",") if m.strip()]
    for suffix, secret in (("", s.gemini_api_key), (SECOND_KEY, s.gemini_api_key_2)):
        if secret:
            for model in gemini:
                llms[model + suffix] = OpenAICompatChat(
                    name=model + suffix, base_url=s.gemini_base_url, api_key=secret.get_secret_value(), model=model,
                    limiter=RpmLimiter(s.gemini_rpm), structured_output=True)
    for name, secret, base_url, model, rpm in (
        ("groq", s.groq_api_key, s.groq_base_url, s.groq_model, s.groq_rpm),
        ("cerebras", s.cerebras_api_key, s.cerebras_base_url, s.cerebras_model, s.cerebras_rpm),
    ):
        if secret:
            llms[name] = OpenAICompatChat(name=name, base_url=base_url, api_key=secret.get_secret_value(),
                                          model=model, limiter=RpmLimiter(rpm), strict_messages=True)
    if s.alt_llm_base_url and s.alt_llm_api_key and s.alt_llm_model:
        llms["alt"] = OpenAICompatChat(
            name="alt", base_url=s.alt_llm_base_url, api_key=s.alt_llm_api_key.get_secret_value(),
            model=s.alt_llm_model, limiter=RpmLimiter(s.alt_llm_rpm),
        )

    def chain(v: str, backups: tuple[str, ...] = ()) -> list[str]:
        names = [x.strip() for x in v.split(",") if x.strip()]
        first = [n for n in names if n in gemini]
        return [*first, *(n + SECOND_KEY for n in first), *backups, *(n for n in names if n not in gemini)]

    return ModelRouter(
        llms=llms,
        images=images,
        roles={
            "reasoning": chain(s.role_reasoning, ("groq", "cerebras")),
            "generation": chain(s.role_generation, ("groq", "cerebras")),
            "verification": chain(s.role_verification, ("cerebras", "groq")),
            "image": chain(s.role_image),
            "vision": chain(s.role_vision),
        },
        replay=ReplayCache(s.replay_dir),
        replay_mode=s.replay_mode,
    )
