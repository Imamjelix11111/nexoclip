# AI Storyboard (ViMax) engine as a standalone service.
# Runs web/server.mjs (Node), which spawns the Python agent internally and
# exposes the HTTP + SSE API the Next app proxies to.
FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

# System libs: ffmpeg/libgl for moviepy+opencv, Node 20 for the web server.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg libgl1 curl ca-certificates gnupg \
 && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python dependencies (locked). We only need the deps, not to build the project
# itself — the agent runs as `python main_agent.py`.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project

# Web server dependencies.
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci --omit=dev

# Application code (host .venv / node_modules / working dirs excluded via .dockerignore).
COPY . .

ENV VIMAX_WEB_HOST=0.0.0.0 \
    VIMAX_WEB_PORT=4173 \
    VIMAX_PYTHON_CMD=/app/.venv/bin/python \
    PATH="/app/.venv/bin:${PATH}"

EXPOSE 4173
CMD ["node", "web/server.mjs"]
