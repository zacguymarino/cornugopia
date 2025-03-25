FROM python:3.11

WORKDIR /app

# Upgrade pip and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && pip install -r requirements.txt

# Copy application code
COPY app/ /app/

EXPOSE 8000

# Start Gunicorn with Uvicorn workers
#CMD ["gunicorn", "-k", "uvicorn.workers.UvicornWorker", "-w", "4", "-b", "0.0.0.0:8000", "main:app", "--reload"]
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
