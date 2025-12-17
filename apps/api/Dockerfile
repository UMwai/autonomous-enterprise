# Autonomous Enterprise API Dockerfile
FROM python:3.12-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Create app user
RUN useradd -m -s /bin/bash appuser

# Set working directory
WORKDIR /app

# Install uv for fast Python package management
RUN pip install uv

# Copy dependency files
COPY pyproject.toml uv.lock* ./

# Install Python dependencies
RUN uv sync --frozen || uv sync

# Copy application code
COPY . .

# Change ownership to app user
RUN chown -R appuser:appuser /app

# Switch to app user
USER appuser

# Expose API port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Run the API server
CMD ["uv", "run", "uvicorn", "ae_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
