"""Copy locally stored images (data/storage) to Supabase Storage under the same keys, before switching
STORAGE_BACKEND to supabase. Safe to run again: uploads overwrite.

    uv run python -m scripts.upload_storage
"""

import asyncio
import mimetypes

from app.config import get_settings
from app.storage import SupabaseStorage


async def main() -> None:
    s = get_settings()
    if not (s.supabase_url and s.supabase_service_role_key):
        raise SystemExit("Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env.")
    store = SupabaseStorage(s.supabase_url, s.supabase_service_role_key.get_secret_value(), s.supabase_bucket)
    await store.ensure_bucket()
    files = [p for p in s.storage_dir.rglob("*") if p.is_file()]
    for i, p in enumerate(files, 1):
        key = p.relative_to(s.storage_dir).as_posix()
        await store.put(key, p.read_bytes(), mimetypes.guess_type(p.name)[0] or "application/octet-stream")
        print(f"{i}/{len(files)} {key}")
    print("Done. Set STORAGE_BACKEND=supabase and restart.")


if __name__ == "__main__":
    asyncio.run(main())
