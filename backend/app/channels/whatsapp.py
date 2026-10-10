"""WhatsApp Cloud API: customers claim offers by messaging the business, and the business sends posts to people
who asked for them.

Inbound (free): a customer taps "Get it on WhatsApp" on a post, which opens a chat with the post's code typed in.
The webhook reads the code, makes their personal code (the same one the counter redeems) and replies with it.
Replies inside the 24-hour window that a customer's message opens are free on WhatsApp.

Outbound: a live post goes to contacts who wrote in the last 24 hours as a free message, and to others only through
a template the business had approved in Meta (charged by Meta). Every message carries its own link reference, so
link opens are tied back to the message; delivery and read receipts arrive on the same webhook.
"""

import hashlib
import hmac
import logging
import re
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

from app import ledger, services
from app.channels import meta
from app.config import get_settings
from app.db import Conn, connection, fetch_all, fetch_one

log = logging.getLogger(__name__)

WINDOW = timedelta(hours=24)
CODE = re.compile(r"\b[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6,7}\b")
STOP = {"STOP", "UNSUBSCRIBE", "ನಿಲ್ಲಿಸಿ", "रोकें", "बंद"}
START = {"START", "SUBSCRIBE"}
_RANK = {"received": 0, "sent": 1, "delivered": 2, "read": 3, "failed": 4}

ASK_REVIEW = {
    "en": "Thanks for coming to {name}! How was it? Reply with a number from 1 (bad) to 5 (great), and a few words if you like.",
    "kn": "{name}ಗೆ ಬಂದಿದ್ದಕ್ಕೆ ಧನ್ಯವಾದಗಳು! ಹೇಗಿತ್ತು? 1 (ಚೆನ್ನಾಗಿರಲಿಲ್ಲ) ರಿಂದ 5 (ತುಂಬಾ ಚೆನ್ನಾಗಿತ್ತು) ವರೆಗೆ ಒಂದು ಸಂಖ್ಯೆ ಕಳುಹಿಸಿ, ಬೇಕಿದ್ದರೆ ಎರಡು ಮಾತು ಬರೆಯಿರಿ.",
    "hi": "{name} आने के लिए धन्यवाद! कैसा लगा? 1 (खराब) से 5 (बहुत बढ़िया) तक एक नंबर भेजें, चाहें तो दो शब्द भी लिखें।",
}
THANKS = {"en": "Thank you! {name} reads every review.", "kn": "ಧನ್ಯವಾದಗಳು! {name} ಪ್ರತಿಯೊಂದು ಅಭಿಪ್ರಾಯವನ್ನೂ ಓದುತ್ತದೆ.",
          "hi": "धन्यवाद! {name} हर राय पढ़ता है।"}
ON_GOOGLE = {"en": "If you have a minute, you can also post it on Google:", "kn": "ಸಮಯವಿದ್ದರೆ Google ನಲ್ಲೂ ಬರೆಯಿರಿ:",
             "hi": "समय हो तो Google पर भी लिखें:"}
STARS = re.compile(r"^\s*([1-5])(?![\d.])\s*(?:/\s*5)?\s*[-:,.!]*\s*")

TEXT = {
    "your_code": {"en": "Your code", "kn": "ನಿಮ್ಮ ಕೋಡ್", "hi": "आपका कोड"},
    "show": {"en": "Show it at the counter", "kn": "ಕೌಂಟರ್‌ನಲ್ಲಿ ತೋರಿಸಿ", "hi": "काउंटर पर दिखाएँ"},
    "qr": {"en": "QR code", "kn": "QR ಕೋಡ್", "hi": "QR कोड"},
}


def device_for(phone: str) -> str:
    """A stable id for a WhatsApp number, so the same person gets the same personal code back."""
    return "wa-" + hashlib.sha256(phone.encode()).hexdigest()[:24]


def signature_ok(raw: bytes, header: str | None) -> bool:
    secret = get_settings().meta_app_secret
    if secret is None or not header or not header.startswith("sha256="):
        return False
    want = hmac.new(secret.get_secret_value().encode(), raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(want, header.removeprefix("sha256="))


async def account(conn: Conn, business_id: Any) -> dict[str, Any] | None:
    return await fetch_one(conn, "select * from channel_accounts where business_id = %s and channel = 'whatsapp'",
                           (business_id,))


async def check(phone_number_id: str, token: str) -> dict[str, Any]:
    """The number behind a phone number id, checked with Meta before it is saved."""
    d = await meta.graph("GET", meta.url(meta.FB, phone_number_id), token=token,
                         params={"fields": "display_phone_number,verified_name"})
    return {"display": d.get("display_phone_number"), "name": d.get("verified_name")}


async def _send(acct: dict[str, Any], payload: dict[str, Any]) -> str:
    d = await meta.graph("POST", meta.url(meta.FB, f"{acct['external_id']}/messages"), token=acct["token"],
                         json={"messaging_product": "whatsapp", "recipient_type": "individual", **payload})
    return d["messages"][0]["id"]


async def send_text(acct: dict[str, Any], to: str, body: str) -> str:
    return await _send(acct, {"to": to, "type": "text", "text": {"preview_url": True, "body": body[:4000]}})


async def send_template(acct: dict[str, Any], to: str, name: str, lang: str, params: list[str]) -> str:
    return await _send(acct, {"to": to, "type": "template", "template": {
        "name": name, "language": {"code": lang},
        "components": [{"type": "body", "parameters": [{"type": "text", "text": p[:1000]} for p in params]}]}})


async def _record_out(conn: Conn, acct: dict[str, Any], wamid: str | None, to: str, kind: str, body: str, *,
                      asset: dict[str, Any] | None = None, ref: str | None = None, error: str | None = None) -> None:
    await conn.execute(
        """insert into channel_messages (id, business_id, campaign_id, asset_id, phone, direction, kind, body, ref,
                                         status, error)
           values (%s, %s, %s, %s, %s, 'out', %s, %s, %s, %s, %s) on conflict (id) do nothing""",
        (wamid or f"failed-{secrets.token_hex(8)}", acct["business_id"], asset and asset["campaign_id"],
         asset and asset["id"], to, kind, body, ref, "failed" if error else "sent", error))


async def _offer_lines(conn: Conn, campaign_id: Any, lang: str) -> list[str]:
    sheet = await services.locked_sheet(conn, campaign_id)
    return [f.display.get(lang) or f.display.get("en", "") for f in sheet.facts] if sheet else []


# ------------------------------------------------------------------ inbound (webhook)


async def handle(payload: dict[str, Any], router: Any = None) -> None:
    """Process one webhook delivery: customer messages and delivery receipts. Safe to receive twice."""
    for entry in payload.get("entry") or []:
        for change in entry.get("changes") or []:
            if change.get("field") != "messages":
                continue
            v = change.get("value") or {}
            pid = (v.get("metadata") or {}).get("phone_number_id")
            async with connection() as conn:
                acct = await fetch_one(conn, "select * from channel_accounts where channel = 'whatsapp' and external_id = %s",
                                       (pid,))
            if not acct:
                log.warning("WhatsApp webhook for an unknown number id %s", pid)
                continue
            names = {c.get("wa_id"): (c.get("profile") or {}).get("name") for c in v.get("contacts") or []}
            for m in v.get("messages") or []:
                try:
                    await _inbound(acct, m, names.get(m.get("from")), router)
                except Exception:  # one bad message must not stop the rest of the delivery
                    log.exception("WhatsApp message %s failed", m.get("id"))
            for st in v.get("statuses") or []:
                await _status(st)


async def _status(st: dict[str, Any]) -> None:
    new = st.get("status")
    if new not in _RANK:
        return
    at = datetime.fromtimestamp(int(st.get("timestamp") or 0), UTC) if st.get("timestamp") else datetime.now(UTC)
    err = "; ".join(e.get("title") or e.get("message") or "" for e in st.get("errors") or []) or None
    async with connection() as conn:
        row = await fetch_one(conn, "select status from channel_messages where id = %s for update", (st.get("id"),))
        if not row or (_RANK[new] <= _RANK[row["status"]] and new != "failed"):
            return  # receipts can arrive out of order: never step back from read to delivered
        await conn.execute(
            """update channel_messages set status = %s, error = coalesce(%s, error),
                      delivered_at = case when %s in ('delivered', 'read') then coalesce(delivered_at, %s) else delivered_at end,
                      read_at = case when %s = 'read' then %s else read_at end where id = %s""",
            (new, err, new, at, new, at, st.get("id")))


def _text_of(m: dict[str, Any]) -> str:
    kind = m.get("type")
    if kind == "text":
        return (m.get("text") or {}).get("body") or ""
    if kind == "button":
        return (m.get("button") or {}).get("text") or ""
    if kind == "interactive":
        i = m.get("interactive") or {}
        return ((i.get("button_reply") or i.get("list_reply") or {}).get("title")) or ""
    return ""


def stars(text: str) -> tuple[int, str] | None:
    """A review answer: "4", "4/5 lovely", "⭐⭐⭐⭐ good coffee". -> (stars, the words after them)."""
    if m := STARS.match(text):
        return int(m.group(1)), text[m.end():].strip()
    n = sum(text.count(ch) for ch in "⭐★")
    if 1 <= n <= 5:
        return n, text.replace("⭐", "").replace("★", "").strip(" -:,.")
    return None


async def _inbound(acct: dict[str, Any], m: dict[str, Any], name: str | None, router: Any = None) -> None:
    phone, text = m.get("from") or "", _text_of(m).strip()
    async with connection() as conn:
        fresh = await fetch_one(
            conn, """insert into channel_messages (id, business_id, phone, direction, kind, body, status)
                     values (%s, %s, %s, 'in', 'inbound', %s, 'received') on conflict (id) do nothing returning id""",
            (m.get("id"), acct["business_id"], phone, text[:2000]))
        if not fresh:
            return  # Meta retried a message we already answered
        await conn.execute(
            """insert into wa_contacts (business_id, phone, name, last_inbound_at) values (%s, %s, %s, now())
               on conflict (business_id, phone) do update set last_inbound_at = now(),
                 name = coalesce(excluded.name, wa_contacts.name)""", (acct["business_id"], phone, name))
        business = await services.get_business_by_id(conn, acct["business_id"])
        # Asked for a review after their visit? Then a "1" to "5" answer is the review.
        pending = await fetch_one(
            conn, """select cl.code, coalesce(a.language, 'en') as language from claims cl
                     left join assets a on a.id = cl.asset_id
                     where cl.via = 'whatsapp' and cl.device = %s and cl.status = 'redeemed'
                       and cl.review_asked_at > now() - interval '3 days'
                       and not exists (select 1 from customer_interactions ci where ci.claim_code = cl.code)
                     order by cl.review_asked_at desc limit 1""", (device_for(phone),))
    if pending and (got := stars(text)):
        from app import reviews

        saved = await reviews.submit_visit(pending["code"], got[0], got[1], pending["language"])
        lang = pending["language"]
        reply = THANKS.get(lang, THANKS["en"]).format(name=business["name"])
        if saved["google_review_url"]:
            reply += f"\n\n{ON_GOOGLE.get(lang, ON_GOOGLE['en'])} {saved['google_review_url']}"
        await _reply(acct, phone, reply, "review_thanks", None)
        if router is not None:
            await reviews.analyze(router, saved["id"])
        return
    async with connection() as conn:
        word = text.upper().strip(" .!")
        if word in STOP or word in START:
            await conn.execute("update wa_contacts set opted_out_at = %s where business_id = %s and phone = %s",
                               (datetime.now(UTC) if word in STOP else None, acct["business_id"], phone))
            reply, kind, asset = (f"Done. {business['name']} will not send you offers. Send START to get them again."
                                  if word in STOP else f"Welcome back. {business['name']} will send you offers again."), "help", None
        else:
            reply, kind, asset = await _answer(conn, business, phone, text)
        await ledger.record(conn, business["id"], "whatsapp.inbound", f"WhatsApp message from {name or 'a customer'}",
                            actor="customer", campaign_id=asset and asset["campaign_id"],
                            payload={"kind": kind})
    await _reply(acct, phone, reply, kind, asset)


async def _reply(acct: dict[str, Any], phone: str, body: str, kind: str, asset: dict[str, Any] | None) -> None:
    try:
        wamid, error = await send_text(acct, phone, body), None
    except meta.MetaError as e:
        wamid, error = None, str(e)
    async with connection() as conn:
        await _record_out(conn, acct, wamid, phone, kind, body, asset=asset, error=error)


async def ask_review(claim_code: str) -> bool:
    """After a WhatsApp claim is redeemed, ask how it was. Only inside the free 24-hour window: a review request is
    never worth a paid template. -> asked or not."""
    async with connection() as conn:
        cl = await fetch_one(
            conn, """select cl.code, cl.via, cl.device, coalesce(a.language, 'en') as language, c.business_id, b.name
                     from claims cl join campaigns c on c.id = cl.campaign_id join businesses b on b.id = c.business_id
                     left join assets a on a.id = cl.asset_id where cl.code = %s""", (claim_code,))
        if not cl or cl["via"] != "whatsapp":
            return False
        acct = await account(conn, cl["business_id"])
        contacts = await fetch_all(conn, """select phone from wa_contacts where business_id = %s and opted_out_at is null
                                            and last_inbound_at > now() - interval '24 hours'""", (cl["business_id"],))
        phone = next((c["phone"] for c in contacts if device_for(c["phone"]) == cl["device"]), None)
        if not acct or not phone:
            return False
        await conn.execute("update claims set review_asked_at = now() where code = %s", (claim_code,))
    await _reply(acct, phone, ASK_REVIEW.get(cl["language"], ASK_REVIEW["en"]).format(name=cl["name"]), "review_ask", None)
    return True


async def _answer(conn: Conn, business: dict[str, Any], phone: str, text: str) -> tuple[str, str, dict[str, Any] | None]:
    """-> (reply, kind, asset). A post's code gets a personal code; a personal code gets its status."""
    base = get_settings().public_base_url.rstrip("/")
    for code in CODE.findall(text.upper()):
        try:
            it = await services.find_code(conn, code)
        except services.NotFound:
            continue
        if it["business_id"] != business["id"]:
            continue
        asset = await services.get_asset(conn, it["asset_id"]) if it["asset_id"] else None
        lang = (asset or {}).get("language") or "en"
        if it["kind"] == "claim":
            claim = it
        else:
            try:
                claim, _ = await services.claim(conn, code, device=device_for(phone), via="whatsapp")
            except services.NotFound:
                return f"Sorry, that {business['name']} offer has ended.", "help", asset
        if claim["status"] == "redeemed":
            return f"{business['name']}: this code was already used. Thank you for coming in!", "claim_reply", asset
        lines = await _offer_lines(conn, it["campaign_id"], lang)
        t = {k: v.get(lang, v["en"]) for k, v in TEXT.items()}
        return ("\n".join([f"*{business['name']}*", *lines, "", f"{t['your_code']}: *{claim['code']}*",
                           f"{t['show']}. {t['qr']}: {base}/c/{claim['code']}", "", "Reply STOP to stop offers."]),
                "claim_reply", asset)
    return (f"Hi from {business['name']}! Send the code printed on one of our posts (6 letters, like K7QF3M) "
            "and you get your offer code here.", "help", None)


# ------------------------------------------------------------------ outbound (a post to people who asked)


async def broadcast(business: dict[str, Any], asset_id: str) -> dict[str, Any]:
    """Send a live post to everyone who messaged the business and has not opted out. -> counts."""
    base = get_settings().public_base_url.rstrip("/")
    async with connection() as conn:
        acct = await account(conn, business["id"])
        if not acct:
            raise services.Conflict("Connect WhatsApp first, on the Channels page.")
        asset = await services.get_asset(conn, asset_id)
        if asset["status"] != "live":
            raise services.Conflict("Approve the post first; only live posts have a tracked link.")
        tp = await fetch_one(conn, "select code from touchpoints where asset_id = %s", (asset["id"],))
        rev = await services.current_revision(conn, asset["id"])
        rendered = (rev or {}).get("rendered") or {}
        contacts = await fetch_all(conn, """select phone, last_inbound_at from wa_contacts
                                            where business_id = %s and opted_out_at is null""", (business["id"],))
    template = (acct.get("meta") or {}).get("template")
    now = datetime.now(UTC)
    out = {"sent": 0, "template": 0, "skipped": 0, "failed": 0, "errors": []}
    for c in contacts:
        ref = secrets.token_urlsafe(6)
        link = f"{base}/r/{tp['code']}?m={ref}" if tp else base
        in_window = c["last_inbound_at"] and now - c["last_inbound_at"] < WINDOW
        try:
            if in_window:  # free: the customer wrote in the last 24 hours
                body = "\n".join(x for x in [f"*{rendered.get('headline', '')}*", rendered.get("body", ""),
                                             *rendered.get("offer", []), "", link, "", "Reply STOP to stop offers."] if x is not None)
                wamid, kind = await send_text(acct, c["phone"], body), "broadcast"
                out["sent"] += 1
            elif template:  # outside the window only an approved template may go, and Meta charges for it
                body = f"{template['name']}: {rendered.get('headline', '')} {link}"
                wamid = await send_template(acct, c["phone"], template["name"], template.get("language", "en"),
                                            [business["name"], rendered.get("headline", ""), link])
                kind = "template"
                out["template"] += 1
            else:
                out["skipped"] += 1
                continue
            async with connection() as conn:
                await _record_out(conn, acct, wamid, c["phone"], kind, body, asset=asset, ref=ref)
        except meta.MetaError as e:
            out["failed"] += 1
            out["errors"] = (out["errors"] + [str(e)])[:3]
            async with connection() as conn:
                await _record_out(conn, acct, None, c["phone"], "broadcast", "", asset=asset, ref=ref, error=str(e))
    async with connection() as conn:
        await ledger.record(conn, business["id"], "whatsapp.broadcast",
                            f"Sent a post on WhatsApp to {out['sent'] + out['template']} customer(s)",
                            actor="owner", campaign_id=asset["campaign_id"], payload={k: v for k, v in out.items() if k != "errors"})
    return out


async def stats(conn: Conn, asset_ids: list[str]) -> dict[str, dict[str, int]]:
    """Per post: messages sent, delivered, read, and how many of those messages' links were opened."""
    rows = await fetch_all(
        conn, """select m.asset_id::text as asset_id,
                        count(*) filter (where m.status <> 'failed')::int as sent,
                        count(*) filter (where m.status in ('delivered', 'read'))::int as delivered,
                        count(*) filter (where m.status = 'read')::int as read,
                        count(*) filter (where m.status = 'failed')::int as failed,
                        count(*) filter (where exists (
                          select 1 from outcome_events o where o.asset_id = m.asset_id and o.type = 'scan'
                          and o.meta->>'m' = m.ref))::int as clicked
                 from channel_messages m
                 where m.direction = 'out' and m.kind in ('broadcast', 'template') and m.asset_id = any(%s::uuid[])
                 group by m.asset_id""", (asset_ids,))
    claims = await fetch_all(
        conn, """select asset_id::text as asset_id, count(*)::int as n,
                        count(*) filter (where status = 'redeemed')::int as redeemed
                 from claims where via = 'whatsapp' and asset_id = any(%s::uuid[]) group by asset_id""", (asset_ids,))
    out = {r["asset_id"]: {k: v for k, v in r.items() if k != "asset_id"} for r in rows}
    for c in claims:
        out.setdefault(c["asset_id"], {"sent": 0, "delivered": 0, "read": 0, "failed": 0, "clicked": 0})
        out[c["asset_id"]].update({"claimed_on_whatsapp": c["n"], "redeemed_from_whatsapp": c["redeemed"]})
    return out


async def send_review_reply(review: dict[str, Any], body: str) -> bool:
    """Send the owner's reply to a review that came in on WhatsApp, if the free 24-hour window is still open."""
    if not review.get("claim_code"):
        return False
    async with connection() as conn:
        cl = await fetch_one(conn, "select via, device from claims where code = %s", (review["claim_code"],))
        acct = await account(conn, review["business_id"])
        contacts = await fetch_all(conn, """select phone from wa_contacts where business_id = %s
                                            and last_inbound_at > now() - interval '24 hours'""", (review["business_id"],))
    phone = next((c["phone"] for c in contacts if cl and device_for(c["phone"]) == cl["device"]), None)
    if not acct or not cl or cl["via"] != "whatsapp" or not phone:
        return False
    await _reply(acct, phone, body, "review_reply", None)
    return True
