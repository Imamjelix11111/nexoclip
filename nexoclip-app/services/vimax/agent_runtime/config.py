from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_LLM_MODEL = "openai/gpt-oss-20b:free"
DEFAULT_LLM_MODEL_PROVIDER = "openai"
DEFAULT_LLM_BASE_URL = OPENROUTER_BASE_URL
DEFAULT_IMAGE_MODEL = "google/gemini-3.1-flash-lite-image"
DEFAULT_IMAGE_BASE_URL = OPENROUTER_BASE_URL
DEFAULT_VIDEO_MODEL = "bytedance/seedance-2.0"
DEFAULT_VIDEO_BASE_URL = OPENROUTER_BASE_URL
DEFAULT_EMBEDDING_MODEL = "nvidia/nemotron-3-embed-1b:free"
DEFAULT_EMBEDDING_MODEL_PROVIDER = "openai"
DEFAULT_RERANKER_MODEL = "qwen/qwen3-reranker-8b"


@lru_cache(maxsize=4)
def load_agent_config(workspace_root: str | Path = ".") -> dict[str, Any]:
    path = Path(workspace_root).resolve() / "configs" / "agent.local.yaml"
    if not path.exists():
        return {}
    try:
        payload = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError as exc:
        raise RuntimeError(f"Invalid configs/agent.local.yaml: {exc}") from exc
    if not isinstance(payload, dict):
        raise RuntimeError("configs/agent.local.yaml must be a YAML mapping")
    return payload


def config_value(section: str, key: str, env_names: list[str], default: str = "", workspace_root: str | Path = ".") -> str:
    for env_name in env_names:
        value = os.environ.get(env_name)
        if value:
            return value
    section_payload = load_agent_config(workspace_root).get(section, {})
    if isinstance(section_payload, dict):
        value = section_payload.get(key)
        if isinstance(value, str) and value:
            return value
    return default


def llm_model(workspace_root: str | Path = ".") -> str:
    return config_value("llm", "model", ["VIMAX_LLM_MODEL"], DEFAULT_LLM_MODEL, workspace_root)


def llm_model_provider(workspace_root: str | Path = ".") -> str:
    return DEFAULT_LLM_MODEL_PROVIDER


def llm_base_url(workspace_root: str | Path = ".") -> str:
    return OPENROUTER_BASE_URL


def llm_api_key(workspace_root: str | Path = ".") -> str:
    return os.environ.get("OPENROUTER_API_KEY", "")


def image_model(workspace_root: str | Path = ".") -> str:
    return config_value("image", "model", ["VIMAX_IMAGE_MODEL"], DEFAULT_IMAGE_MODEL, workspace_root)


def image_base_url(workspace_root: str | Path = ".") -> str:
    return OPENROUTER_BASE_URL


def image_api_key(workspace_root: str | Path = ".") -> str:
    return llm_api_key(workspace_root)



def embedding_model(workspace_root: str | Path = ".") -> str:
    return DEFAULT_EMBEDDING_MODEL


def embedding_model_provider(workspace_root: str | Path = ".") -> str:
    return DEFAULT_EMBEDDING_MODEL_PROVIDER


def embedding_base_url(workspace_root: str | Path = ".") -> str:
    return OPENROUTER_BASE_URL


def embedding_api_key(workspace_root: str | Path = ".") -> str:
    return llm_api_key(workspace_root)


def reranker_model(workspace_root: str | Path = ".") -> str:
    return DEFAULT_RERANKER_MODEL


def reranker_base_url(workspace_root: str | Path = ".") -> str:
    return OPENROUTER_BASE_URL


def reranker_api_key(workspace_root: str | Path = ".") -> str:
    return llm_api_key(workspace_root)


def video_model(workspace_root: str | Path = ".") -> str:
    return DEFAULT_VIDEO_MODEL


def video_base_url(workspace_root: str | Path = ".") -> str:
    return OPENROUTER_BASE_URL


def video_api_key(workspace_root: str | Path = ".") -> str:
    return llm_api_key(workspace_root)


def api_provider_from_base_url(base_url: str) -> str:
    normalized = base_url.strip().lower()
    if "openrouter.ai" in normalized:
        return "openrouter"
    if "yunwu.ai" in normalized:
        return "yunwu"
    if "api.openai.com" in normalized:
        return "sora"
    if "generativelanguage.googleapis.com" in normalized:
        return "google"
    return ""


def video_provider(workspace_root: str | Path = ".") -> str:
    """Infer the video API relay/provider from video.base_url.

    This is not a model provider setting. OpenRouter/Yunwu are transport/API
    gateways here, so users should configure base_url and let the adapter pick
    the matching implementation.
    """
    return api_provider_from_base_url(video_base_url(workspace_root))
