# Use the official slim image for smaller footprint
FROM python:3.11-slim

# Set a working directory
WORKDIR /app

# Install build tools & libpq (for asyncpg) 
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      gcc \
      libpq-dev && \
    rm -rf /var/lib/apt/lists/*

# Copy and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy app code
COPY . .

# Move into the app directory
WORKDIR /app/app

# Make /app/static point at the local real static assets
RUN ln -s /app/app/static /app/static

# Make /app/templates point at the local real templates
RUN ln -s /app/app/templates /app/templates

# Expose the port FastAPI listens on
EXPOSE 8000

# In production we don’t want reload—just run Gunicorn
CMD ["gunicorn", \
     "-k", "uvicorn.workers.UvicornWorker", \
     "-w", "4", \
     "-b", "0.0.0.0:8000", \
     "main:app"]
