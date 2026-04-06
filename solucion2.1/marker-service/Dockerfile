FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    poppler-utils \
    libcairo2 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

RUN useradd -m -u 1001 appuser \
    && chown -R appuser:appuser /app \
    && mkdir -p /home/appuser/.cache/datalab \
    && chown -R appuser:appuser /home/appuser/.cache \
    && mkdir -p /usr/local/lib/python3.11/site-packages/static \
    && chown -R appuser:appuser /usr/local/lib/python3.11/site-packages/static
USER appuser

ENV TORCH_DEVICE=cpu
ENV GRPC_VERBOSITY=ERROR
ENV PYTORCH_ENABLE_MPS_FALLBACK=1

EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD curl -f http://localhost:8001/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
