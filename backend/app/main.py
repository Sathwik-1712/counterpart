from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app import db
from app.api.channels import channels_api, webhook
from app.api.owner import api
from app.api.public import public
from app.api.workspace import accounts
from app.auth import AuthError
from app.config import get_settings
from app.providers import build_router
from app.services import Conflict, NotFound
from app.storage import SupabaseStorage, get_storage


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    await db.open_pool(s.database_url)
    app.state.router = build_router(s)
    storage = get_storage()
    if isinstance(storage, SupabaseStorage):
        await storage.ensure_bucket()
    yield
    await db.close_pool()


app = FastAPI(title="Counterpart API", version="0.1.0", lifespan=lifespan)
_s = get_settings()
app.add_middleware(CORSMiddleware, allow_origins=_s.cors_origins, allow_methods=["*"], allow_headers=["*"])
app.include_router(api)
app.include_router(accounts)
app.include_router(public)
app.include_router(channels_api)
app.include_router(webhook)
if _s.storage_backend == "local":
    _s.storage_dir.mkdir(parents=True, exist_ok=True)
    app.mount("/files", StaticFiles(directory=_s.storage_dir), name="files")


@app.exception_handler(NotFound)
async def not_found(_: Request, e: NotFound) -> JSONResponse:
    return JSONResponse({"detail": str(e)}, status_code=404)


@app.exception_handler(AuthError)
async def auth_error(_: Request, e: AuthError) -> JSONResponse:
    return JSONResponse({"detail": str(e)}, status_code=400)


@app.exception_handler(Conflict)
async def conflict(_: Request, e: Conflict) -> JSONResponse:
    return JSONResponse({"detail": str(e)}, status_code=409)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
