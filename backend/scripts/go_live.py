"""Put WhatsApp and Instagram live with one command.

    uv run python -m scripts.go_live          (first time: asks for 5 values from the Meta app; later: no questions)
    uv run python -m scripts.go_live --reset  (ask again)

What you do in Meta first (the only part that needs you):
  1. developers.facebook.com > Log in (first time: Get Started) > My Apps > Create app > use cases "Connect with customers through WhatsApp" and
     "Manage messaging and content on Instagram".
  2. WhatsApp > API Setup: add your phone under "To", press "Generate access token", note the Phone number ID.
  3. Instagram > API setup with Instagram login > Generate access tokens > add your account (Business or Creator).
  4. App settings > Basic: App ID and App secret.

What this does: checks every value with Meta, swaps the 24-hour WhatsApp token for a 60-day one, finds the WhatsApp
Business Account, makes a webhook verify token, opens a free Cloudflare tunnel, points PUBLIC_BASE_URL at it,
registers the webhook with Meta, and connects both channels to your business. Keep it running; Ctrl-C stops the
tunnel. Run it again after a restart: the tunnel gets a new address and the webhook is re-registered.
Values are typed hidden and saved only in backend/.env and the database, never printed.
"""

import asyncio
import getpass
import os
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
ENV = ROOT / ".env"
V = "v25.0"
FB = f"https://graph.facebook.com/{V}"
IG = f"https://graph.instagram.com/{V}"
LOCAL_API = "http://localhost:8000"
CLOUDFLARED = shutil.which("cloudflared") or str(Path.home() / ".local/bin/cloudflared")


def env() -> dict[str, str]:
    out = {}
    for line in ENV.read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip("\"'")
    return out


def save(values: dict[str, str]) -> None:
    lines = [ln for ln in ENV.read_text().splitlines() if ln.split("=", 1)[0].strip() not in values]
    ENV.write_text("\n".join(lines + [f"{k}={v}" for k, v in values.items()]) + "\n")


def ask(label: str, current: str | None, *, hidden: bool = True, reset: bool = False, optional: bool = False) -> str:
    if current and not reset:
        return current
    value = (getpass.getpass if hidden else input)(f"{label}{' (hidden)' if hidden else ''}: ").strip()
    if not value and not optional:
        raise SystemExit("Nothing entered; nothing changed.")
    return value


def fail(msg: str) -> None:
    raise SystemExit(f"\n✗ {msg}\nNothing was connected. Fix that and run the command again.")


def meta_error(r: httpx.Response) -> str:
    try:
        e = r.json().get("error", {})
        return e.get("error_user_msg") or e.get("message") or r.text[:200]
    except ValueError:
        return r.text[:200]


def check_meta(c: httpx.Client, cfg: dict[str, str]) -> dict[str, str]:
    """Every value checked with Meta before anything is saved. -> extra facts learned (number, WABA, username)."""
    app_token = f"{cfg['META_APP_ID']}|{cfg['META_APP_SECRET']}"
    r = c.get(f"{FB}/{cfg['META_APP_ID']}", params={"fields": "name", "access_token": app_token})
    if r.status_code != 200:
        fail(f"App ID or App secret is wrong (Meta said: {meta_error(r)}).")
    print(f"✓ Meta app: {r.json().get('name')}")

    # The API Setup token lasts 24 hours; swap it for a 60-day one (a token that is already long-lived stays as is).
    r = c.get(f"{FB}/oauth/access_token", params={"grant_type": "fb_exchange_token", "client_id": cfg["META_APP_ID"],
                                                 "client_secret": cfg["META_APP_SECRET"], "fb_exchange_token": cfg["WHATSAPP_TOKEN"]})
    if r.status_code == 200 and r.json().get("access_token"):
        cfg["WHATSAPP_TOKEN"] = r.json()["access_token"]
        print(f"✓ WhatsApp token now lasts {int(r.json().get('expires_in', 5_184_000)) // 86400} days")

    wa = {"Authorization": f"Bearer {cfg['WHATSAPP_TOKEN']}"}
    r = c.get(f"{FB}/{cfg['WHATSAPP_PHONE_NUMBER_ID']}", headers=wa, params={"fields": "display_phone_number,verified_name"})
    if r.status_code != 200:
        fail(f"WhatsApp token or Phone number ID is wrong (Meta said: {meta_error(r)}).")
    learned = {"wa_display": r.json().get("display_phone_number", "")}
    print(f"✓ WhatsApp number: {learned['wa_display']}")

    if not cfg.get("WHATSAPP_WABA_ID"):
        r = c.get(f"{FB}/debug_token", params={"input_token": cfg["WHATSAPP_TOKEN"], "access_token": app_token})
        scopes = (r.json().get("data") or {}).get("granular_scopes") or [] if r.status_code == 200 else []
        ids = next((s.get("target_ids") for s in scopes if s.get("scope") == "whatsapp_business_management"), None)
        cfg["WHATSAPP_WABA_ID"] = ids[0] if ids else ask(
            "WhatsApp Business Account ID (shown on the API Setup page)", None, hidden=False)
    print("✓ WhatsApp Business Account found")

    if not cfg.get("INSTAGRAM_TOKEN"):
        print("- Instagram skipped (run with --reset to add it later)")
        return learned
    r = c.get(f"{IG}/me", params={"fields": "user_id,username,account_type", "access_token": cfg["INSTAGRAM_TOKEN"]})
    if r.status_code != 200:
        fail(f"Instagram token is wrong (Instagram said: {meta_error(r)}).")
    me = r.json()
    if me.get("account_type") not in ("BUSINESS", "MEDIA_CREATOR", "CREATOR"):
        fail("That Instagram account is personal. In the Instagram app: Settings > Account type > Business or Creator.")
    learned |= {"ig_user": str(me.get("user_id") or me.get("id")), "ig_name": me.get("username", "")}
    print(f"✓ Instagram: @{learned['ig_name']}")
    return learned


async def connect_business(slug: str | None, cfg: dict[str, str], learned: dict[str, str]) -> str:
    """Store both connections on the chosen business (tokens stay server-side)."""
    sys.path.insert(0, str(ROOT))
    from app.config import get_settings
    from app.db import close_pool, connection, fetch_all, jsonb, open_pool

    await open_pool(get_settings().database_url)
    try:
        async with connection() as conn:
            rows = await fetch_all(conn, "select slug, name from businesses where not is_demo order by created_at")
        if not rows:
            fail("No business yet. Sign up in the app first, then run this again.")
        if not slug or slug not in {r["slug"] for r in rows}:
            if len(rows) == 1:
                slug = rows[0]["slug"]
            else:
                for i, r in enumerate(rows, 1):
                    print(f"  {i}. {r['name']} ({r['slug']})")
                pick = await asyncio.to_thread(input, "Which business gets WhatsApp and Instagram? Number: ")
                slug = rows[int(pick) - 1]["slug"]
        async with connection() as conn:
            await conn.execute(
                """insert into channel_accounts (business_id, channel, external_id, display, token, meta)
                   select id, 'whatsapp', %s, %s, %s, %s from businesses where slug = %s
                   on conflict (business_id, channel) do update set external_id = excluded.external_id,
                     display = excluded.display, token = excluded.token, connected_at = now()""",
                (cfg["WHATSAPP_PHONE_NUMBER_ID"], learned["wa_display"], cfg["WHATSAPP_TOKEN"],
                 jsonb({"waba_id": cfg["WHATSAPP_WABA_ID"]}), slug))
            if learned.get("ig_user"):
                await conn.execute(
                    """insert into channel_accounts (business_id, channel, external_id, display, token, token_expires_at)
                       select id, 'instagram', %s, %s, %s, now() + interval '60 days' from businesses where slug = %s
                       on conflict (business_id, channel) do update set external_id = excluded.external_id,
                         display = excluded.display, token = excluded.token""",
                    (learned["ig_user"], f"@{learned['ig_name']}", cfg["INSTAGRAM_TOKEN"], slug))
    finally:
        await close_pool()
    return slug  # type: ignore[return-value]


def open_tunnel() -> tuple[subprocess.Popen[str], str]:
    if not Path(CLOUDFLARED).exists():
        fail("cloudflared is missing. It should be at ~/.local/bin/cloudflared (see docs/CHANNELS.md).")
    p = subprocess.Popen([CLOUDFLARED, "tunnel", "--no-autoupdate", "--url", "http://localhost:3000"],
                         stderr=subprocess.PIPE, stdout=subprocess.DEVNULL, text=True)
    deadline = time.time() + 40
    while time.time() < deadline and p.stderr:
        line = p.stderr.readline()
        if m := re.search(r"https://[a-z0-9-]+\.trycloudflare\.com", line):
            # keep reading its log, or the pipe fills up and the tunnel stalls
            threading.Thread(target=lambda: [None for _ in p.stderr], daemon=True).start()  # type: ignore[union-attr]
            return p, m.group(0)
    p.terminate()
    fail("The tunnel did not start. Check your internet connection.")
    raise AssertionError


def wait_for(c: httpx.Client, url: str, ok, what: str, seconds: int = 60) -> bool:
    deadline = time.time() + seconds
    while time.time() < deadline:
        try:
            if ok(c.get(url, timeout=8)):
                return True
        except httpx.HTTPError:
            pass
        time.sleep(2)
    print(f"… still waiting for {what}")
    return False


def main() -> None:
    reset = "--reset" in sys.argv
    cur = env()
    print(__doc__.split("What this does")[0].strip().split("\n\n", 1)[1] if reset or not cur.get("INSTAGRAM_TOKEN") else "")
    cfg = {
        "META_APP_ID": ask("App ID", cur.get("META_APP_ID"), hidden=False, reset=reset),
        "META_APP_SECRET": ask("App secret", cur.get("META_APP_SECRET"), reset=reset),
        "WHATSAPP_PHONE_NUMBER_ID": ask("WhatsApp Phone number ID", cur.get("WHATSAPP_PHONE_NUMBER_ID"), hidden=False, reset=reset),
        "WHATSAPP_TOKEN": ask("WhatsApp access token", cur.get("WHATSAPP_TOKEN"), reset=reset),
        "INSTAGRAM_TOKEN": ask("Instagram access token (Enter to skip Instagram for now)", cur.get("INSTAGRAM_TOKEN"),
                               reset=reset, optional=True),
        "WHATSAPP_WABA_ID": "" if reset else cur.get("WHATSAPP_WABA_ID", ""),
        "WHATSAPP_VERIFY_TOKEN": cur.get("WHATSAPP_VERIFY_TOKEN") or secrets.token_urlsafe(24),
    }
    with httpx.Client(timeout=30) as c:
        learned = check_meta(c, cfg)
        slug = asyncio.run(connect_business(cur.get("CHANNELS_BUSINESS"), cfg, learned))
        print(f"✓ Connected to your business: {slug}")

        tunnel, public = open_tunnel()
        save({**cfg, "CHANNELS_BUSINESS": slug, "PUBLIC_BASE_URL": public})
        print(f"✓ Public address: {public}")
        # The backend reads .env at start: nudge a --reload server, then wait until it answers with the new values.
        (ROOT / "app" / "__init__.py").touch()
        probe = f"{LOCAL_API}/api/public/whatsapp/webhook?hub.mode=subscribe&hub.verify_token={cfg['WHATSAPP_VERIFY_TOKEN']}&hub.challenge=ok"
        if not wait_for(c, probe, lambda r: r.text == "ok", "the backend to restart", 30):
            input("Restart the backend (it must read the new backend/.env), then press Enter… ")
            wait_for(c, probe, lambda r: r.text == "ok", "the backend", 60)
        wait_for(c, f"{public}/api/health", lambda r: r.status_code == 200, "the tunnel to reach this laptop", 60)

        hook = f"{public}/api/public/whatsapp/webhook"
        app_token = f"{cfg['META_APP_ID']}|{cfg['META_APP_SECRET']}"
        r = c.post(f"{FB}/{cfg['META_APP_ID']}/subscriptions", params={
            "object": "whatsapp_business_account", "callback_url": hook, "verify_token": cfg["WHATSAPP_VERIFY_TOKEN"],
            "fields": "messages", "access_token": app_token})
        app_ok = r.status_code == 200
        r = c.post(f"{FB}/{cfg['WHATSAPP_WABA_ID']}/subscribed_apps", headers={"Authorization": f"Bearer {cfg['WHATSAPP_TOKEN']}"},
                   json={"override_callback_uri": hook, "verify_token": cfg["WHATSAPP_VERIFY_TOKEN"]})
        waba_ok = r.status_code == 200
        if app_ok and waba_ok:
            print("✓ Webhook registered with Meta")
        else:
            print(f"! Meta did not take the webhook automatically ({meta_error(r)}). Do it once by hand: WhatsApp > "
                  f"Configuration > Callback URL {hook} , Verify token: run `grep WHATSAPP_VERIFY_TOKEN backend/.env`, "
                  "then subscribe to 'messages'.")

    print(f"""
Live. Try it now:
  1. On your phone open a live post's link (Results page > Copy link; it now starts with {public}).
  2. Tap "Get it on WhatsApp" and send the message: your personal code comes back in seconds.
  3. Redeem it on the Counter page.
  Instagram: on a campaign, a live Instagram post now has "Post to Instagram".

Keep this window open. Ctrl-C stops the tunnel (customer links stop working until you run this again).""")
    try:
        tunnel.wait()
    except KeyboardInterrupt:
        tunnel.terminate()
        print("\nTunnel stopped.")


if __name__ == "__main__":
    os.chdir(ROOT)
    main()
