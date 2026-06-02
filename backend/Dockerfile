FROM python:3.11-slim

WORKDIR /app

# Slim runtime: skip writing .pyc files and disable pip's compile step so
# the image doesn't carry hundreds of MB of __pycache__ duplicates.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Install ONLY what we need at runtime. gcc + libpq-dev were used to build
# psycopg2 from source, but requirements.txt pins psycopg2-binary which
# ships prebuilt wheels — dropping those build tools removes ~300 MB from
# the final image.
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps first (better layer caching). --no-compile skips
# the per-package bytecode compilation step Pip does by default, which
# is the biggest single source of bloat in a Python image.
COPY requirements.txt .
RUN pip install --no-cache-dir --no-compile -r requirements.txt

# Copy application code
COPY . .

# Make sure stale local SQLite/.env files from the host don't leak in
RUN rm -f .env lodge_lms.db 2>/dev/null || true

# Create runtime dirs
RUN mkdir -p uploads/id_proofs logs backups

EXPOSE 8000

# Health check - use the actual endpoint (/api/health) and give the app
# enough time to boot (DB connect + create_all + seed = ~10-20s on cold start).
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
    CMD curl -fsS http://localhost:8000/api/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
