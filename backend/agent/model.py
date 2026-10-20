"""Which model the agent runs on (D13, D23, D24).

MODEL_PROVIDER=auto picks, in order:
  1. Vertex AI on Google Cloud, when GOOGLE_GENAI_USE_ENTERPRISE=true
     (or the older GOOGLE_GENAI_USE_VERTEXAI=true)
  2. the Gemini API, when GOOGLE_API_KEY is set
  3. the scripted stub model, in development and test only
  4. nothing: the feedback page uses the backup form (F5)

Switching to the real model is a .env change: paste GOOGLE_API_KEY (or set the
Vertex AI variables) and restart.
"""

import logging
import os
from dataclasses import dataclass
from functools import lru_cache
from typing import Literal

from google.adk.models.base_llm import BaseLlm

from app.config import Settings, get_settings

log = logging.getLogger(__name__)

Provider = Literal["gemini", "vertex", "stub", "none"]


@dataclass(frozen=True)
class ModelChoice:
    provider: Provider
    name: str
    configured: bool
    detail: str


def resolve(settings: Settings | None = None) -> ModelChoice:
    s = settings or get_settings()
    wanted = s.model_provider
    if wanted == "auto":
        if s.use_vertex:
            wanted = "vertex"
        elif s.google_api_key:
            wanted = "gemini"
        elif s.is_dev:
            wanted = "stub"
        else:
            wanted = "none"

    if wanted == "gemini":
        ok = bool(s.google_api_key)
        return ModelChoice("gemini", s.model_name, ok, "Gemini API key set" if ok else "GOOGLE_API_KEY is empty")
    if wanted == "vertex":
        ok, detail = _vertex_ready(s)
        return ModelChoice("vertex", s.model_name, ok, detail)
    if wanted == "stub":
        if not s.is_dev:
            return ModelChoice("none", "", False, "The stub model only runs locally and in tests")
        return ModelChoice("stub", "stub", True, "Scripted stub model (no credentials)")
    return ModelChoice("none", "", False, "No model configured; the backup form is used")


def _vertex_ready(s: Settings) -> tuple[bool, str]:
    if not s.google_cloud_project:
        return False, "GOOGLE_CLOUD_PROJECT is empty"
    if not s.google_cloud_location:
        return False, "GOOGLE_CLOUD_LOCATION is empty"
    if s.google_application_credentials:
        os.environ.setdefault("GOOGLE_APPLICATION_CREDENTIALS", s.google_application_credentials)
    found, detail = _google_credentials()
    return found, detail if not found else f"Vertex AI, project {s.google_cloud_project}, {s.google_cloud_location}"


@lru_cache
def _google_credentials() -> tuple[bool, str]:
    """Application Default Credentials: gcloud login, a key file, or the VM's service account."""
    try:
        import google.auth

        google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
        return True, "Google Cloud credentials found"
    except Exception as exc:
        return False, f"No Google Cloud credentials ({type(exc).__name__}); run gcloud auth application-default login"


def build_model(choice: ModelChoice) -> BaseLlm | str:
    """The model object or name to give the LlmAgent."""
    s = get_settings()
    if choice.provider == "stub":
        from agent.stub import StubLlm

        return StubLlm()
    # google-genai reads these from the process environment.
    os.environ.pop("GOOGLE_GENAI_USE_VERTEXAI", None)  # deprecated name; set the new one only
    if choice.provider == "vertex":
        os.environ["GOOGLE_GENAI_USE_ENTERPRISE"] = "true"
        os.environ["GOOGLE_CLOUD_PROJECT"] = s.google_cloud_project
        os.environ["GOOGLE_CLOUD_LOCATION"] = s.google_cloud_location
        if s.google_application_credentials:
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = s.google_application_credentials
    elif choice.provider == "gemini":
        os.environ["GOOGLE_GENAI_USE_ENTERPRISE"] = "false"
        os.environ["GOOGLE_API_KEY"] = s.google_api_key
    return choice.name
