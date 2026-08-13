import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import yaml

from agent_runtime.config import (
    OPENROUTER_BASE_URL,
    embedding_api_key,
    embedding_base_url,
    embedding_model,
    embedding_model_provider,
    image_api_key,
    image_base_url,
    image_model,
    llm_api_key,
    llm_base_url,
    llm_model,
    llm_model_provider,
    load_agent_config,
    reranker_api_key,
    reranker_base_url,
    reranker_model,
    video_api_key,
    video_base_url,
    video_model,
    video_provider,
)


class AgentConfigTests(unittest.TestCase):
    def setUp(self):
        load_agent_config.cache_clear()

    def tearDown(self):
        load_agent_config.cache_clear()

    def test_only_llm_and_image_models_can_be_selected(self):
        with tempfile.TemporaryDirectory() as tmp:
            config_dir = Path(tmp) / "configs"
            config_dir.mkdir()
            (config_dir / "agent.local.yaml").write_text(yaml.safe_dump({
                "llm": {"model": "selected-llm", "base_url": "https://api.openai.com/v1", "api_key": "legacy-key"},
                "image": {"model": "selected-image", "base_url": "https://yunwu.ai", "api_key": "legacy-key"},
                "video": {"model": "legacy-video"},
                "embedding": {"model": "legacy-embedding"},
                "reranker": {"model": "legacy-reranker"},
            }), encoding="utf-8")
            with patch.dict(os.environ, {"OPENROUTER_API_KEY": "openrouter-key"}, clear=True):
                self.assertEqual(llm_model(tmp), "selected-llm")
                self.assertEqual(image_model(tmp), "selected-image")
                self.assertEqual(video_model(tmp), "bytedance/seedance-2.0")
                self.assertEqual(embedding_model(tmp), "nvidia/nemotron-3-embed-1b:free")
                self.assertEqual(reranker_model(tmp), "qwen/qwen3-reranker-8b")

    def test_all_services_are_locked_to_openrouter_and_shared_key(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {
            "OPENROUTER_API_KEY": "openrouter-key",
            "VIMAX_LLM_BASE_URL": "https://api.openai.com/v1",
            "VIMAX_VIDEO_API_KEY": "legacy-key",
        }, clear=True):
            self.assertEqual(llm_model_provider(tmp), "openai")
            self.assertEqual(embedding_model_provider(tmp), "openai")
            self.assertEqual(llm_base_url(tmp), OPENROUTER_BASE_URL)
            self.assertEqual(image_base_url(tmp), OPENROUTER_BASE_URL)
            self.assertEqual(video_base_url(tmp), OPENROUTER_BASE_URL)
            self.assertEqual(embedding_base_url(tmp), OPENROUTER_BASE_URL)
            self.assertEqual(reranker_base_url(tmp), OPENROUTER_BASE_URL)
            self.assertEqual(video_provider(tmp), "openrouter")
            self.assertEqual(llm_api_key(tmp), "openrouter-key")
            self.assertEqual(image_api_key(tmp), "openrouter-key")
            self.assertEqual(video_api_key(tmp), "openrouter-key")
            self.assertEqual(embedding_api_key(tmp), "openrouter-key")
            self.assertEqual(reranker_api_key(tmp), "openrouter-key")


if __name__ == "__main__":
    unittest.main()
