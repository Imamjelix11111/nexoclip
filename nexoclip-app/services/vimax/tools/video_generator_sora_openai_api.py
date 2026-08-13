import asyncio
import logging
import os
from typing import List

import aiohttp
from PIL import Image

from interfaces.video_output import VideoOutput
from utils.image import pil_to_b64

logger = logging.getLogger(__name__)


def _env_int(name: str, default: int) -> int:
    try:
        return max(0, int(os.environ.get(name, str(default))))
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return max(0.0, float(os.environ.get(name, str(default))))
    except ValueError:
        return default


def _emit_progress(progress, stage: str, message: str, metadata: dict | None = None) -> None:
    if progress is not None:
        progress(stage, message, metadata or {})


# Sora only accepts a fixed set of exact pixel sizes. Map common aspect ratios
# onto the sizes supported by sora-2 / sora-2-pro; unknown ratios fall back to
# landscape 720p (overridable via VIMAX_SORA_VIDEO_SIZE).
_ASPECT_RATIO_TO_SIZE = {
    "16:9": "1280x720",
    "9:16": "720x1280",
    "1:1": "720x1280",
}


def _resolve_size(aspect_ratio: str) -> str:
    override = os.environ.get("VIMAX_SORA_VIDEO_SIZE", "").strip()
    if override:
        return override
    return _ASPECT_RATIO_TO_SIZE.get(aspect_ratio.strip(), "1280x720")


def _parse_size(size: str) -> tuple[int, int]:
    width, height = size.lower().split("x")
    return int(width), int(height)


def _reference_data_uri(image_path: str, size: str) -> str:
    """Load the first-frame image and resize it to the exact video size.

    Sora rejects an input_reference whose dimensions differ from the requested
    ``size`` ("Inpaint image must match the requested width and height"), so the
    reference is resized to match before encoding.
    """
    target = _parse_size(size)
    image = Image.open(image_path).convert("RGB")
    if image.size != target:
        image = image.resize(target, Image.LANCZOS)
    return pil_to_b64(image, mime=True)


class VideoGeneratorSoraOpenAIAPI:
    """Video generation via OpenAI's Sora API (``POST /v1/videos``).

    Text-to-video and single first-frame image-to-video are supported. Sora
    accepts at most one reference image (used as the first frame); extra
    reference images are ignored.
    """

    def __init__(
        self,
        api_key: str,
        model: str = "sora-2",
        base_url: str = "https://api.openai.com/v1",
    ):
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")

    async def generate_single_video(
        self,
        prompt: str = "",
        reference_image_paths: List[str] = [],
        aspect_ratio: str = "16:9",
        **kwargs,
    ) -> VideoOutput:
        progress = kwargs.get("progress")
        request_timeout_seconds = _env_float("VIMAX_VIDEO_REQUEST_TIMEOUT_SECONDS", 60.0)
        query_timeout_seconds = _env_float("VIMAX_VIDEO_QUERY_TIMEOUT_SECONDS", 600.0)
        poll_interval_seconds = _env_float("VIMAX_VIDEO_POLL_INTERVAL_SECONDS", 10.0)
        seconds = str(_env_int("VIMAX_SORA_VIDEO_SECONDS", 8))
        size = _resolve_size(aspect_ratio)

        payload: dict = {
            "model": self.model,
            "prompt": prompt,
            "seconds": seconds,
            "size": size,
        }
        reference_image_path = reference_image_paths[0] if reference_image_paths else None
        if len(reference_image_paths) > 1:
            logger.warning("Sora video generation uses only the first reference image; ignoring %d extra image(s)", len(reference_image_paths) - 1)
        if reference_image_path:
            # JSON mode: input_reference is an object, not a raw file. Pass the
            # first-frame image as a base64 data URI via image_url.
            payload["input_reference"] = {"image_url": _reference_data_uri(reference_image_path, size)}

        headers = self._headers()
        timeout = aiohttp.ClientTimeout(total=request_timeout_seconds)
        _emit_progress(progress, "video_create", f"Creating Sora video generation task with {self.model}", {"model": self.model, "seconds": seconds, "size": size, "has_reference": reference_image_path is not None})

        create_status, create_payload = await _post_json(
            f"{self.base_url}/videos",
            headers=headers,
            payload=payload,
            timeout=timeout,
            hard_timeout_seconds=request_timeout_seconds,
        )
        if create_status >= 400:
            raise RuntimeError(f"Sora video create failed with HTTP {create_status}: {create_payload}")
        job_id = create_payload.get("id")
        if not job_id:
            raise RuntimeError(f"Sora video create response missing id: {create_payload}")
        _emit_progress(progress, "video_task_created", "Sora video generation task created", {"model": self.model, "job_id": job_id, "status": create_payload.get("status")})

        poll_url = f"{self.base_url}/videos/{job_id}"
        deadline = asyncio.get_running_loop().time() + query_timeout_seconds if query_timeout_seconds > 0 else None
        last_status = create_payload.get("status")
        last_payload = create_payload
        while deadline is None or asyncio.get_running_loop().time() < deadline:
            await asyncio.sleep(poll_interval_seconds)
            poll_status, poll_payload = await _get_json(
                poll_url,
                headers=headers,
                timeout=timeout,
                hard_timeout_seconds=request_timeout_seconds,
            )
            if poll_status >= 400:
                raise RuntimeError(f"Sora video poll failed with HTTP {poll_status}: {poll_payload}")
            last_payload = poll_payload
            status = poll_payload.get("status")
            last_status = status
            _emit_progress(progress, "video_status", f"Sora video generation status: {status}", {"model": self.model, "job_id": job_id, "status": status, "progress": poll_payload.get("progress")})

            if status == "completed":
                content_url = f"{self.base_url}/videos/{job_id}/content"
                _emit_progress(progress, "video_download_start", "Downloading Sora video output", {"model": self.model, "job_id": job_id})
                download_status, data = await _get_bytes(
                    content_url,
                    headers=headers,
                    timeout=timeout,
                    hard_timeout_seconds=request_timeout_seconds,
                )
                if download_status >= 400:
                    raise RuntimeError(f"Sora video content download failed with HTTP {download_status}: {data[:500]!r}")
                _emit_progress(progress, "video_completed", "Sora video generation completed and downloaded", {"model": self.model, "job_id": job_id})
                return VideoOutput(fmt="bytes", ext="mp4", data=data)
            if status == "failed":
                error = poll_payload.get("error") or poll_payload
                raise RuntimeError(f"Sora video generation failed for job {job_id}: {error}")

        raise RuntimeError(f"Sora video generation timed out after {query_timeout_seconds:g}s for job {job_id}; last_status={last_status}; last_payload={last_payload}")

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }


async def _post_json(url: str, *, headers: dict[str, str], payload: dict, timeout: aiohttp.ClientTimeout, hard_timeout_seconds: float) -> tuple[int, dict]:
    async def request() -> tuple[int, dict]:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(url, headers=headers, json=payload) as response:
                return response.status, await response.json(content_type=None)

    return await asyncio.wait_for(request(), timeout=hard_timeout_seconds + 5)


async def _get_json(url: str, *, headers: dict[str, str], timeout: aiohttp.ClientTimeout, hard_timeout_seconds: float) -> tuple[int, dict]:
    async def request() -> tuple[int, dict]:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(url, headers=headers) as response:
                return response.status, await response.json(content_type=None)

    return await asyncio.wait_for(request(), timeout=hard_timeout_seconds + 5)


async def _get_bytes(url: str, *, headers: dict[str, str], timeout: aiohttp.ClientTimeout, hard_timeout_seconds: float) -> tuple[int, bytes]:
    async def request() -> tuple[int, bytes]:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(url, headers=headers) as response:
                return response.status, await response.read()

    return await asyncio.wait_for(request(), timeout=hard_timeout_seconds + 5)
