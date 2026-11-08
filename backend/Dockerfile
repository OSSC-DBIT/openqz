# syntax=docker/dockerfile:1.7

# ---------- builder: resolve deps into a venv with uv ----------
FROM python:3.12-slim AS builder
COPY --from=ghcr.io/astral-sh/uv:0.5.11 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy VIRTUAL_ENV=/opt/venv
WORKDIR /src
RUN uv venv /opt/venv
COPY pyproject.toml ./
ARG INSTALL_DEV=false
# Install dependencies only (no app code) so this layer caches well.
RUN INSTALL_DEV=${INSTALL_DEV} python - <<'PY' > /tmp/req.txt
import tomllib, os
p = tomllib.load(open("pyproject.toml", "rb"))["project"]
deps = list(p["dependencies"])
if os.environ.get("INSTALL_DEV") == "true":
    deps += p["optional-dependencies"]["dev"]
print("\n".join(deps))
PY
RUN --mount=type=cache,target=/root/.cache/uv \
    uv pip install --python /opt/venv/bin/python -r /tmp/req.txt

# ---------- runtime ----------
FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PATH="/opt/venv/bin:$PATH"
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 1000 openqz \
    && mkdir -p /data/media && chown -R openqz:openqz /data
COPY --from=builder /opt/venv /opt/venv
WORKDIR /app
COPY --chown=openqz:openqz . .
USER openqz
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
    CMD curl -fsS http://localhost:8000/api/v1/health || exit 1
CMD ["gunicorn", "app.main:app", "-k", "uvicorn.workers.UvicornWorker", \
     "-w", "4", "-b", "0.0.0.0:8000", "--forwarded-allow-ips", "*", "--access-logfile", "-"]
