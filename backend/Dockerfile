# Counterpart API. Build from the repository root so migrations and seed data are included:
#   docker build -f backend/Dockerfile -t counterpart-api .
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.8.22 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONUNBUFFERED=1

WORKDIR /srv/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY backend/app ./app
COPY backend/scripts ./scripts
COPY supabase/migrations /srv/supabase/migrations
COPY data/seed /srv/data/seed

ENV PATH="/srv/backend/.venv/bin:$PATH" STORAGE_BACKEND=supabase
EXPOSE 8000
# Migrations are idempotent; each start applies any new ones before serving.
CMD ["sh", "-c", "python -m scripts.migrate && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers"]
