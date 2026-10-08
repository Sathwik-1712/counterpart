"""File storage for generated creatives. Metadata lives in Postgres; bytes live here.

local    -> data/storage, served by the API at /files (MVP default: no network dependency)
supabase -> Supabase Storage public bucket (use when deployed; containers have ephemeral disks)
"""

from functools import lru_cache
from pathlib import Path
from typing import Protocol

import httpx

from app.config import Settings, get_settings


class Storage(Protocol):
    async def put(self, key: str, data: bytes, content_type: str) -> str: ...
    def url(self, key: str) -> str: ...


class LocalStorage:
    def __init__(self, root: Path, base_url: str = "/files"):
        self.root, self.base_url = root, base_url.rstrip("/")

    async def put(self, key: str, data: bytes, content_type: str) -> str:
        path = (self.root / key).resolve()
        if not path.is_relative_to(self.root.resolve()):
            raise ValueError("invalid storage key")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return key

    def url(self, key: str) -> str:
        return f"{self.base_url}/{key}"


class SupabaseStorage:
    def __init__(self, url: str, service_key: str, bucket: str):
        self.url_base, self.bucket = url.rstrip("/"), bucket
        # New secret keys (sb_secret_...) are accepted only in the apikey header; legacy JWT keys also as Bearer.
        self._headers = {"apikey": service_key, **({"Authorization": f"Bearer {service_key}"}
                                                   if service_key.startswith("eyJ") else {})}

    async def ensure_bucket(self) -> None:
        async with httpx.AsyncClient(timeout=20) as c:
            r = await c.post(f"{self.url_base}/storage/v1/bucket", headers=self._headers,
                             json={"id": self.bucket, "name": self.bucket, "public": True})
            if r.status_code not in (200, 201, 400, 409):  # 400/409: already exists
                r.raise_for_status()

    async def put(self, key: str, data: bytes, content_type: str) -> str:
        async with httpx.AsyncClient(timeout=60) as c:
            r = await c.post(f"{self.url_base}/storage/v1/object/{self.bucket}/{key}",
                             headers={**self._headers, "Content-Type": content_type, "x-upsert": "true"},
                             content=data)
            r.raise_for_status()
        return key

    def url(self, key: str) -> str:
        return f"{self.url_base}/storage/v1/object/public/{self.bucket}/{key}"


@lru_cache
def get_storage() -> Storage:
    s: Settings = get_settings()
    if s.storage_backend == "supabase":
        if not (s.supabase_url and s.supabase_service_role_key):
            raise RuntimeError("STORAGE_BACKEND=supabase needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")
        return SupabaseStorage(s.supabase_url, s.supabase_service_role_key.get_secret_value(), s.supabase_bucket)
    return LocalStorage(s.storage_dir)
