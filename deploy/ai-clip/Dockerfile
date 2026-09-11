FROM python:3.13-slim-bookworm

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg libgl1 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY nexoclip-app/services/ai-clip/requirements.txt nexoclip-app/services/ai-clip/requirements-local.txt ./
RUN pip install --no-cache-dir -r requirements-local.txt
COPY nexoclip-app/services/ai-clip/ ./
RUN useradd --create-home --uid 10001 app \
 && mkdir -p /data/output \
 && chown -R app:app /app /data/output

ENV LOCAL_WHISPER_DEVICE=cpu LOCAL_OUTPUT_DIR=/tmp/output PYTHONUNBUFFERED=1
USER 1001:1001
EXPOSE 4175
CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "4175"]
