"""Settings from the environment (and a git-ignored .env for local, non-secret values).

Secrets (AI Studio key, OAuth client secret, database password) come from Secret Manager in
staging and production (spec v3 D13, D19), mounted as environment variables by Cloud Run.
"""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(BACKEND_DIR.parent / ".env", BACKEND_DIR / ".env"),
        extra="ignore",
    )

    # local | staging | production (D25). Local uses staging configuration.
    app_env: Literal["local", "test", "staging", "production"] = "local"
    database_url: str = "postgresql+asyncpg://feedback:feedback@localhost:5432/feedback"
    secret_key: str = "local-only-secret-change-me"
    app_base_url: str = "http://localhost:3000"
    cookie_secure: bool = False

    # Sign-in (D1). Comma-separated Google Workspace domains allowed to sign in.
    allowed_domains: str = "redadair.com.au"
    google_oauth_client_id: str = ""
    google_oauth_client_secret: str = ""
    # Local stand-in for Google sign-in while the OAuth client is pending (D23). Never in production.
    dev_login: bool = False
    session_hours: int = 12

    # Model (D8)
    model_provider: Literal["auto", "gemini", "vertex", "stub", "none"] = "auto"
    # The newest generally available full Flash model (D36, review item 17): Sig has to pick up nuance,
    # which the Lite tier is weakest at. gemini-3.1-flash-lite is the cheaper fallback by config.
    # (2.5 Flash was retired on 2026-10-20; 2.5 Flash-Lite is closed to new users.)
    model_name: str = "gemini-3.8-flash"
    embedding_model: str = "gemini-embedding-001"
    # Each model call can think for 10 to 40 s on 3.8 Flash (D88); one turn is often two calls.
    agent_turn_timeout_seconds: float = 60.0
    google_api_key: str = ""
    google_genai_use_enterprise: bool = False
    google_genai_use_vertexai: bool = False
    google_cloud_project: str = ""
    google_cloud_location: str = "australia-southeast1"
    google_application_credentials: str = ""
    duplicate_threshold: float = 0.85
    # The chat's duplicate check also looks at items fixed this many days back, so Sig can say a bug was
    # fixed before and the new item is linked to it as a possible regression (D73). 0 switches it off.
    duplicate_fixed_days: int = 183
    # Different people reporting the same open item before the console suggests a priority review (D38).
    priority_review_reporters: int = 3
    # For the cost log (brief §8: under AUD 0.05 per item). AUD per million tokens for model_name;
    # check current prices (3.8 Flash USD 0.75 / 3.75 on 2026-10-26, introductory, reported to rise to
    # 1.50 / 7.50 on 2027-01-01; 3.1 Flash-Lite USD 0.25 / 1.50, i.e. AUD 0.38 / 2.28). At USD 1 = AUD 1.52.
    model_price_input_aud_per_m: float = 1.14
    model_price_output_aud_per_m: float = 5.70
    # Caps on each model call (D36, D88). Gemini 3 can't turn thinking off, and its thinking counts
    # towards max_output_tokens (billed as output): at 1,024 a turn that thought hard came back empty.
    model_max_output_tokens: int = 8192
    model_thinking_level: Literal["low", "medium", "high"] = "low"
    embedding_price_aud_per_m: float = 0.23
    project_confidence_gate: float = 0.7

    # Files (D10). local = a folder; gcs = a private Cloud Storage bucket.
    storage_backend: Literal["local", "gcs"] = "local"
    storage_dir: str = str(BACKEND_DIR / ".uploads")
    gcs_bucket: str = ""
    max_file_mb: int = 10
    max_files_per_item: int = 5
    signed_url_minutes: int = 15

    # Email (D11, D18, D32). smtp = Mailpit locally, or ZeptoMail's SMTP service;
    # gmail = Gmail API with a service account.
    email_backend: Literal["smtp", "gmail", "off"] = "smtp"
    smtp_host: str = "localhost"
    smtp_port: int = 1025
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_starttls: bool = False
    mail_from: str = "Smoke Signal <noreply@redadair.example>"
    gmail_sender: str = ""

    # Scheduled jobs (Cloud Scheduler calls /api/jobs/* with this token in production).
    job_token: str = ""
    timezone: str = "Australia/Sydney"
    digest_hour: int = 8
    release_weekday: int = 4  # Friday
    release_hour: int = 9
    # Resolved items (D92): one "Is it fixed?" reminder, then the worker closes it as Fixed by System;
    # the person who raised it can still reopen it for reopen_days after it closes.
    resolved_reminder_days: int = 3
    resolved_auto_close_days: int = 7
    reopen_days: int = 14

    # Limits
    max_messages_per_session: int = 30
    max_message_chars: int = 2000
    max_agent_turns: int = 12
    max_questions: int = 3
    chat_sessions_per_user_per_hour: int = 20
    # Model spend guards (D36). Days and months run in `timezone`. 0 turns a limit off.
    # When a limit is reached, new chats and messages go to the backup form; nothing is lost.
    daily_tokens_per_user: int = 300_000
    daily_budget_aud: float = 5.0
    monthly_budget_aud: float = 60.0

    @property
    def domains(self) -> list[str]:
        return [d.strip().lower() for d in self.allowed_domains.split(",") if d.strip()]

    @property
    def use_vertex(self) -> bool:
        return self.google_genai_use_enterprise or self.google_genai_use_vertexai

    @property
    def is_dev(self) -> bool:
        return self.app_env in ("local", "test")


@lru_cache
def get_settings() -> Settings:
    return Settings()
