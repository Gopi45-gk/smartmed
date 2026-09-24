FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Install OS libraries for OpenCV, audio processing, PaddleOCR, and PyTorch
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    libsndfile1 \
    espeak-ng \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install uv for fast, reliable package management
RUN pip install --no-cache-dir uv

# Copy and install python dependencies
COPY requirements.txt .
RUN uv pip install --system --no-cache -r requirements.txt

# Copy backend application source
COPY . /app

EXPOSE 8100

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:8100/api/ai/health || exit 1

CMD ["python3", "server.py"]
