# Use Python 3.11 slim base image
FROM python:3.11-slim

# Install git and dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Set working directory in the container
WORKDIR /app

# Copy requirements file first to take advantage of Docker layer caching
COPY backend/requirements.txt /app/backend/requirements.txt

# Install python dependencies
RUN pip install --no-cache-dir -r backend/requirements.txt

# Copy the backend codebase
COPY backend /app/backend

# Set PYTHONPATH so python can resolve modules correctly
ENV PYTHONPATH=/app

# Expose default port (Render will override PORT dynamically)
ENV PORT=8000
EXPOSE 8000

# Set working directory to backend so relative paths '../db.sqlite3' and '../chroma_db'
# resolve to /app/db.sqlite3 and /app/chroma_db respectively
WORKDIR /app/backend

# Run uvicorn server binding to 0.0.0.0
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
