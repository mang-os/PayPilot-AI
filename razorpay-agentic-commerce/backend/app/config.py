"""
Central configuration. Everything here is overridable via environment
variables / .env, so the same code runs against SQLite locally and
Postgres in docker-compose without any code changes.
"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # --- Database ---
    # Defaults to a local SQLite file so `uvicorn app.main:app` works with
    # zero setup. docker-compose overrides this with a Postgres URL.
    DATABASE_URL: str = "sqlite:///./dev.db"

    # --- Merchant / commerce rules ---
    CURRENCY: str = "INR"
    TAX_RATE: float = 0.18  # illustrative flat GST-style rate, not tax advice

    # --- Razorpay (Test Mode) ---
    RAZORPAY_KEY_ID: str = ""
    RAZORPAY_KEY_SECRET: str = ""
    RAZORPAY_WEBHOOK_SECRET: str = "dev_webhook_secret_change_me"
    # If real Razorpay keys aren't set, the Razorpay service runs in MOCK
    # mode: it generates realistic-looking fake order IDs instead of
    # calling out to Razorpay. Webhook signature verification is NEVER
    # mocked - it always does the real HMAC check. This lets the whole
    # agentic flow (including the "never trust frontend success, only
    # trust the verified webhook" rule) be demoed and tested without
    # live credentials, while keeping the one security-critical check real.
    @property
    def RAZORPAY_MOCK_MODE(self) -> bool:
        return not (self.RAZORPAY_KEY_ID and self.RAZORPAY_KEY_SECRET)

    # --- LLM orchestrator ---
    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-4o-mini"
    LLM_MAX_TOOL_ITERATIONS: int = 4
    # If no OPENAI_API_KEY is set, the orchestrator falls back to a
    # deterministic FakeLLMClient (keyword search over the catalog) so
    # /agent-commerce/query still works out of the box for local testing
    # and the demo script, without requiring an API key.
    @property
    def LLM_MOCK_MODE(self) -> bool:
        return not self.OPENAI_API_KEY

    # --- Policy / risk defaults used when seeding demo agents ---
    DEFAULT_AGENT_TXN_LIMIT: float = 10000.0
    DEFAULT_AGENT_DAILY_LIMIT: float = 25000.0

    # --- Idempotency ---
    IDEMPOTENCY_WINDOW_MINUTES: int = 60

    # --- Simulated failure injection (for the demo script only) ---
    # When set, razorpay_service.create_order raises RazorpayTimeoutError
    # on the Nth call within a process, so the failure-recovery path can
    # be demonstrated on demand instead of waiting for a real timeout.
    SIMULATE_RAZORPAY_TIMEOUT_ONCE: bool = False


settings = Settings()
