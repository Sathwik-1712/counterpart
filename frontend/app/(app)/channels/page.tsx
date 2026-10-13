"use client";

import { Check, Copy, InstagramLogo, LinkBreak, Plugs, WarningCircle, WhatsappLogo } from "@phosphor-icons/react";
import clsx from "clsx";
import { useState } from "react";
import { Shell } from "@/components/shell";
import { Button, PageHeader, Skeleton, timeAgo } from "@/components/ui";
import { api, useResource } from "@/lib/api";
import { useBusiness } from "@/lib/business";
import type { ChannelsStatus } from "@/lib/types";

const field =
  "h-11 w-full rounded-[var(--radius-md)] bg-surface px-3.5 text-[15px] shadow-[inset_0_0_0_1.5px_var(--color-line-strong)] outline-none focus:shadow-[inset_0_0_0_1.5px_var(--color-ink)]";

function CopyRow({ label, value }: { label: string; value: string }) {
  const [ok, setOk] = useState(false);
  return (
    <div>
      <p className="text-[13px] font-semibold text-muted">{label}</p>
      <button
        type="button"
        onClick={() => navigator.clipboard?.writeText(value).then(() => setOk(true))}
        className="press mt-1 flex w-full items-center gap-2 rounded-[var(--radius-md)] bg-paper px-3 py-2.5 text-left ring-1 ring-line"
      >
        <span className="min-w-0 flex-1 truncate font-receipt text-[12px]">{value}</span>
        {ok ? <Check size={15} className="text-pen" aria-hidden /> : <Copy size={15} aria-hidden />}
      </button>
    </div>
  );
}

function Tick({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      {ok ? <Check size={16} weight="bold" className="mt-0.5 shrink-0 text-pen" aria-hidden /> : <WarningCircle size={16} className="mt-0.5 shrink-0 text-turmeric" aria-hidden />}
      <span>{children}</span>
    </li>
  );
}

function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="space-y-2 text-[14px] text-ink-2">
      {items.map((s, i) => (
        <li key={i} className="flex gap-3">
          <span className="font-receipt text-[12px] text-muted">{String(i + 1).padStart(2, "0")}</span>
          <span>{s}</span>
        </li>
      ))}
    </ol>
  );
}

function Disconnect({ channel, onDone }: { channel: string; onDone: () => void }) {
  const business = useBusiness();
  const [sure, setSure] = useState(false);
  return sure ? (
    <span className="flex items-center gap-2 text-[14px]">
      Disconnect?
      <Button size="sm" variant="danger" onClick={() => api(`/businesses/${business.slug}/channels/${channel}`, { method: "DELETE" }).then(onDone)}>
        Yes
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setSure(false)}>
        No
      </Button>
    </span>
  ) : (
    <Button size="sm" variant="ghost" onClick={() => setSure(true)}>
      <LinkBreak size={14} aria-hidden /> Disconnect
    </Button>
  );
}

function WhatsApp({ s, onChange }: { s: ChannelsStatus; onChange: () => void }) {
  const business = useBusiness();
  const [pid, setPid] = useState("");
  const [token, setToken] = useState("");
  const [template, setTemplate] = useState(s.whatsapp?.template?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wa = s.whatsapp;

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/businesses/${business.slug}/channels/whatsapp`, {
        method: "PUT",
        json: { phone_number_id: pid.trim(), token: token.trim(), template: template.trim() || null },
      });
      setToken("");
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-[var(--radius-lg)] bg-surface p-5 ring-1 ring-ink md:p-7" aria-labelledby="wa-h">
      <div className="flex flex-wrap items-center gap-3">
        <WhatsappLogo size={26} weight="fill" className="text-[#128c4a]" aria-hidden />
        <h2 id="wa-h" className="flex-1 text-[26px]">
          WhatsApp
        </h2>
        {wa && <Disconnect channel="whatsapp" onDone={onChange} />}
      </div>
      <p className="mt-2 max-w-[70ch] text-[15px] text-ink-2">
        Customers tap <b>Get it on WhatsApp</b> on a post and message you its code. Counterpart replies at once with their personal offer code, which the counter redeems. You see who got the message, who read it, who opened the link and who came in. Replies to customers who wrote to you are free on WhatsApp.
      </p>

      {wa ? (
        <div className="mt-5 grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="space-y-3">
            <p className="text-[18px] font-semibold">
              Connected: <span className="font-receipt">{wa.display}</span>
            </p>
            <ul className="space-y-1.5 text-[14px]">
              <Tick ok={s.webhook.app_secret_set && s.webhook.verify_token_set}>Webhook secrets saved on the server</Tick>
              <Tick ok={s.public_ok}>Public https address for the webhook and customer links</Tick>
              <Tick ok={!!s.webhook.last_message_at}>
                {s.webhook.last_message_at ? `Last customer message ${timeAgo(s.webhook.last_message_at)}` : "No customer message received yet: send your test number a post's code"}
              </Tick>
            </ul>
            <p className="text-[14px] text-ink-2">
              <b className="text-ink">{wa.contacts.reachable}</b> customers can get offers · <b className="text-ink">{wa.contacts.free_now}</b> wrote in the last 24 hours (free to message now)
            </p>
            <p className="text-[13px] text-muted">
              {wa.template ? `Template for everyone else: ${wa.template.name} (Meta charges about ₹0.86 per message in India).` : "Without an approved template, posts only go to customers who wrote in the last 24 hours."}
            </p>
          </div>
          <div className="space-y-3">
            <CopyRow label="Callback URL (paste into Meta's webhook form)" value={s.webhook.url} />
            <p className="text-[13px] text-muted">Verify token: the phrase you saved with set_secret WHATSAPP_VERIFY_TOKEN. Subscribe to the “messages” field.</p>
          </div>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-8 md:grid-cols-2">
          <Steps
            items={[
              <>Log in at <a className="font-semibold text-pen underline" href="https://developers.facebook.com/" target="_blank" rel="noreferrer">developers.facebook.com</a> (first time: <b>Get Started</b> registers you as a developer), then <b>My Apps → Create app</b> with the use case <b>Connect with customers through WhatsApp</b>.</>,
              <>Under <b>WhatsApp → API Setup</b>: add your own phone as a test recipient (up to 5), copy the <b>Phone number ID</b> and generate an <b>access token</b>.</>,
              <>Save the app secret and a verify phrase on the server: <code className="font-receipt text-[12px]">set_secret META_APP_SECRET</code> and <code className="font-receipt text-[12px]">set_secret WHATSAPP_VERIFY_TOKEN</code>.</>,
              <>Under <b>WhatsApp → Configuration</b> paste the callback URL below, type your verify phrase, then subscribe to <b>messages</b>.</>,
            ]}
          />
          <form onSubmit={connect} className="space-y-3">
            <CopyRow label="Callback URL" value={s.webhook.url} />
            {!s.public_ok && <p className="text-[13px] text-turmeric">This is not a public https address yet, so Meta cannot reach it. The go_live command above fixes that.</p>}
            <input className={field} value={pid} onChange={(e) => setPid(e.target.value.replace(/\D/g, ""))} placeholder="Phone number ID" inputMode="numeric" aria-label="Phone number ID" />
            <input className={field} value={token} onChange={(e) => setToken(e.target.value)} placeholder="Access token" type="password" autoComplete="off" aria-label="Access token" />
            <input className={field} value={template} onChange={(e) => setTemplate(e.target.value.toLowerCase())} placeholder="Approved template name (optional)" aria-label="Template name" />
            <Button type="submit" variant="primary" className="w-full" disabled={busy || pid.length < 5 || token.length < 20}>
              {busy ? "Checking with Meta…" : "Connect WhatsApp"}
            </Button>
            {error && <p className="rounded-[var(--radius-md)] bg-kumkum-soft px-3.5 py-2.5 text-[14px] text-kumkum" role="alert">{error}</p>}
          </form>
        </div>
      )}
    </section>
  );
}

function Instagram({ s, onChange }: { s: ChannelsStatus; onChange: () => void }) {
  const business = useBusiness();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ig = s.instagram;

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/businesses/${business.slug}/channels/instagram`, { method: "PUT", json: { token: token.trim() } });
      setToken("");
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-[var(--radius-lg)] bg-surface p-5 ring-1 ring-ink md:p-7" aria-labelledby="ig-h">
      <div className="flex flex-wrap items-center gap-3">
        <InstagramLogo size={26} weight="bold" aria-hidden />
        <h2 id="ig-h" className="flex-1 text-[26px]">
          Instagram
        </h2>
        {ig && <Disconnect channel="instagram" onDone={onChange} />}
      </div>
      <p className="mt-2 max-w-[70ch] text-[15px] text-ink-2">
        Post approved pictures straight to your account, or link posts you made in the app. Counterpart reads each post's reach, likes, comments, saves and shares from Instagram and works out its engagement rate. The caption carries the post's code, so a customer who shows it at the counter is counted for that post.
      </p>
      {ig ? (
        <div className="mt-5 space-y-2">
          <p className="text-[18px] font-semibold">Connected: {ig.username}</p>
          <p className="text-[14px] text-ink-2">{ig.posts_linked} post{ig.posts_linked === 1 ? "" : "s"} tracked. Insights refresh every hour while you look at a campaign; Instagram's own numbers can lag up to 48 hours.</p>
          <p className="text-[13px] text-muted">Post or link from a live Instagram post on its campaign page.</p>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-8 md:grid-cols-2">
          <Steps
            items={[
              <>In the Instagram app, switch the account to <b>Business</b> or <b>Creator</b> (Settings → Account type).</>,
              <>In the same Meta app, add the use case <b>Manage messaging and content on Instagram</b> (API setup with Instagram login).</>,
              <>Under <b>Generate access tokens</b>, add your Instagram account and copy its token.</>,
              <>Paste it here. In test mode only accounts added to the app work; other businesses need Meta's app review.</>,
            ]}
          />
          <form onSubmit={connect} className="space-y-3">
            <input className={field} value={token} onChange={(e) => setToken(e.target.value)} placeholder="Instagram access token" type="password" autoComplete="off" aria-label="Instagram access token" />
            <Button type="submit" variant="primary" className="w-full" disabled={busy || token.length < 20}>
              {busy ? "Checking with Instagram…" : "Connect Instagram"}
            </Button>
            {error && <p className="rounded-[var(--radius-md)] bg-kumkum-soft px-3.5 py-2.5 text-[14px] text-kumkum" role="alert">{error}</p>}
          </form>
        </div>
      )}
    </section>
  );
}

/** Where posts actually go: the business's own WhatsApp number and Instagram account. */
export default function ChannelsPage() {
  const business = useBusiness();
  const { data, reload } = useResource<ChannelsStatus>(`/businesses/${business.slug}/channels`, (e) => e.type.startsWith("channel.") || e.type === "whatsapp.inbound");
  return (
    <Shell>
      <PageHeader title="Channels" sub="Connect your WhatsApp number and Instagram account, so posts reach real customers and the results come back here." />
      {!data ? (
        <Skeleton className="h-96" />
      ) : (
        <div className="space-y-8">
          {(!data.whatsapp || !data.instagram) && (
            <section className="rounded-[var(--radius-lg)] bg-marker-soft p-5 ring-1 ring-ink md:p-7" aria-labelledby="fast-h">
              <h2 id="fast-h" className="text-[22px]">
                Fastest: one command connects both
              </h2>
              <p className="mt-1 max-w-[70ch] text-[15px] text-ink-2">
                Create the Meta app (docs/CHANNELS.md, about 5 minutes, two sign-ins), then run this on the computer running Counterpart. It checks everything with Meta, opens the tunnel, registers the webhook and connects WhatsApp and Instagram to this business.
              </p>
              <div className="mt-3 max-w-xl">
                <CopyRow label="Run in the project folder" value="cd backend && uv run python -m scripts.go_live" />
              </div>
              <p className="mt-2 text-[13px] text-muted">Or connect each one by hand below.</p>
            </section>
          )}
          <p className={clsx("flex items-start gap-2 text-[14px]", data.public_ok ? "text-ink-2" : "text-turmeric")}>
            <Plugs size={18} className="mt-0.5 shrink-0" aria-hidden />
            {data.public_ok ? (
              <span>
                Public address: <span className="font-receipt text-[12px]">{data.public_url}</span>. Customer links, QR codes and the webhook use it.
              </span>
            ) : (
              <span>
                Customer links point at <span className="font-receipt text-[12px]">{data.public_url}</span>, which phones and Meta cannot reach. The go_live command above opens a public address for you.
              </span>
            )}
          </p>
          <WhatsApp s={data} onChange={reload} />
          <Instagram s={data} onChange={reload} />
        </div>
      )}
    </Shell>
  );
}
