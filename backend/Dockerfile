# ════════════════════════════════════════════════════════════════════
# Backend Dockerfile — FastAPI application
# Python 3.12-slim for security and performance
# ════════════════════════════════════════════════════════════════════
FROM python:3.12-slim

WORKDIR /app

# Prevent .pyc files and enable unbuffered output
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Install only runtime OS deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies (cached layer)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Remove any host-side credentials and SQLite files
RUN rm -f .env lodge_lms.db lodge_lms_test.db 2>/dev/null || true

# Create runtime directories
RUN mkdir -p uploads/id_proofs logs backups

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
    CMD curl -fsS http://localhost:8000/api/health || exit 1

# Use multiple workers in production; override with --workers 1 for dev
CMD ["uvicorn", "app.main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "2", \
     "--loop", "uvloop", \
     "--http", "httptools"]
