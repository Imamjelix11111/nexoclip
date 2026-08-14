# Private FastAPI ViMax runtime called only by the worker service.
FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg libgl1 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project

COPY . .

ENV VIMAX_RUNTIME_HOST=0.0.0.0 \
    VIMAX_RUNTIME_PORT=4173 \
    VIMAX_TENANTS_ROOT=/app/.tenants \
    PATH="/app/.venv/bin:${PATH}"

EXPOSE 4173
CMD ["uv", "run", "uvicorn", "runtime_api.app:app", "--host", "0.0.0.0", "--port", "4173"]
