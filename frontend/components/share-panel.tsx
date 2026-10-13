"use client";

import { ArrowSquareOut, Check, Copy, DeviceMobile, DownloadSimple, InstagramLogo, Storefront, WhatsappLogo } from "@phosphor-icons/react";
import clsx from "clsx";
import { useState } from "react";
import { api } from "@/lib/api";
import type { Asset, ChannelsStatus, ResultRow } from "@/lib/types";
import { postToInstagram } from "./asset-card";
import { CHANNEL_LABEL, LANG_LABEL, segmentLabel, stagger } from "./ui";

const CHANNEL_ICON = { instagram_post: InstagramLogo, instagram_story: DeviceMobile, poster: Storefront, whatsapp: WhatsappLogo } as const;

function CopyButton({ text, label, done = "Copied" }: { text: string; label: string; done?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard?.writeText(text);
        setOk(true);
        setTimeout(() => setOk(false), 1600);
      }}
      className="press inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] px-3 text-[13px] font-semibold shadow-[inset_0_0_0_1.5px_var(--color-ink)] hover:bg-sunken"
    >
      {ok ? <Check size={14} weight="bold" className="text-pen" aria-hidden /> : <Copy size={14} aria-hidden />}
      {ok ? done : label}
    </button>
  );
}

/** The message as customers should receive it, with the post's own tracking link at the end. */
function messageFor(a: Asset, link: string) {
  const r = a.revision?.rendered;
  if (!r) return link;
  const offer = (r.offer ?? []).map((l, i) => (i === 0 ? `*${l}*` : l)).join("\n");
  return [r.headline && `*${r.headline}*`, r.body, offer, `${r.cta}: ${link}`].filter(Boolean).join("\n\n");
}

function captionFor(a: Asset, link: string) {
  const r = a.revision?.rendered;
  if (!r) return link;
  const tags = r.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
  return [r.body, (r.offer ?? []).join(" · "), `Get your code: ${link}`, tags].filter(Boolean).join("\n\n");
}

interface SendResult {
  sent: number;
  template: number;
  skipped: number;
  failed: number;
  errors: string[];
}

/** Send a live post from the business's own WhatsApp number to customers who asked for offers. */
function SendOnWhatsApp({ asset, channels }: { asset: Asset; channels: ChannelsStatus }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<SendResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const c = channels.whatsapp!.contacts;
  return (
    <div className="w-full">
      <button
        disabled={busy || c.reachable === 0}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            setRes(await api<SendResult>(`/assets/${asset.id}/whatsapp/send`, { method: "POST" }));
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
        className="press inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] bg-[#128c4a] px-3 text-[13px] font-semibold text-white hover:brightness-110 disabled:opacity-50"
      >
        <WhatsappLogo size={15} weight="fill" aria-hidden />
        {busy ? "Sending…" : c.reachable ? `Send to ${c.reachable} customer${c.reachable === 1 ? "" : "s"}` : "No WhatsApp customers yet"}
      </button>
      {res && (
        <p className="mt-1.5 text-[13px] text-ink-2">
          Sent {res.sent + res.template}
          {res.template > 0 && ` (${res.template} by paid template)`}
          {res.skipped > 0 && ` · ${res.skipped} skipped: they wrote over 24 hours ago and there is no approved template`}
          {res.failed > 0 && ` · ${res.failed} failed: ${res.errors[0] ?? ""}`}
        </p>
      )}
      {error && <p className="mt-1.5 text-[13px] text-kumkum">{error}</p>}
    </div>
  );
}

/** Put a live Instagram post on the connected account, drawn exactly as its card above shows it. */
function PostOnInstagram({ asset, channels }: { asset: Asset; channels: ChannelsStatus }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permalink, setPermalink] = useState<string | null>(null);
  const done = asset.instagram?.permalink ?? permalink;
  if (asset.instagram || permalink)
    return (
      <a href={done ?? "#"} target="_blank" rel="noreferrer" className="press inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] px-3 text-[13px] font-semibold text-pen hover:bg-pen-soft">
        <InstagramLogo size={15} aria-hidden /> On Instagram <ArrowSquareOut size={13} aria-hidden />
      </a>
    );
  return (
    <div className="w-full">
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            setPermalink((await postToInstagram(asset.id)).permalink ?? "#");
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
        className="press inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] bg-ink px-3 text-[13px] font-semibold text-white hover:bg-ink-2 disabled:opacity-50"
      >
        <InstagramLogo size={15} aria-hidden /> {busy ? "Posting…" : `Post to ${channels.instagram!.username}`}
      </button>
      {error && <p className="mt-1.5 text-[13px] text-kumkum">{error}</p>}
    </div>
  );
}

/** Step 3: everything the owner needs to put live posts in front of customers, each with its own tracking link. */
export function SharePanel({ assets, rows, channels }: { assets: Asset[]; rows: ResultRow[]; channels?: ChannelsStatus | null }) {
  return (
    <div>
      <ol className="mb-6 grid grid-cols-1 gap-px overflow-hidden rounded-[var(--radius-lg)] bg-ink ring-1 ring-ink md:grid-cols-3">
        {[
          ["Instagram", channels?.instagram
            ? `Post straight to ${channels.instagram.username}. The caption carries the post's code for the counter.`
            : "Download the picture from the post above and paste the caption. The caption carries your link."],
          ["WhatsApp", "Send the message to your customers or your status. Each one has its own link."],
          ["At the counter", "Print the QR code. Each customer gets their own code; staff scan it with a phone or type it on the Counter screen."],
        ].map(([t, d], i) => (
          <li key={t} className="rise-in bg-surface p-5" style={stagger(i)}>
            <p className="font-mono text-[12px] font-semibold text-muted">{String(i + 1).padStart(2, "0")}</p>
            <p className="mt-1 text-[19px] font-bold [font-stretch:90%]">{t}</p>
            <p className="mt-1 text-[14px] text-ink-2">{d}</p>
          </li>
        ))}
      </ol>

      <ul className="divide-y divide-line border-y border-ink">
        {assets.map((a, i) => {
          const code = a.touchpoints?.[0]?.code;
          const row = rows.find((r) => r.asset_id === a.id || r.code === code);
          const link = row?.link ?? (code && typeof window !== "undefined" ? `${window.location.origin}/r/${code}` : "");
          const Icon = CHANNEL_ICON[a.channel];
          if (!code) return null;
          return (
            <li key={a.id} className="rise-in grid grid-cols-1 gap-4 py-5 md:grid-cols-[64px_minmax(0,1fr)_auto] md:items-center" style={stagger(i)}>
              <span className="relative hidden aspect-square w-16 overflow-hidden rounded-[var(--radius-sm)] bg-sunken md:block">
                {a.image_url && a.channel !== "whatsapp" ? (
                  <img src={a.image_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <Icon size={24} className="absolute inset-0 m-auto text-ink-2" aria-hidden />
                )}
              </span>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-x-2 text-[16px] font-semibold">
                  <Icon size={17} className="md:hidden" aria-hidden />
                  {CHANNEL_LABEL[a.channel]} <span className="font-normal text-muted">in {LANG_LABEL[a.language]}, for {segmentLabel(a.segment).toLowerCase()}</span>
                </p>
                <p className="mt-1 flex min-w-0 items-center gap-2 font-mono text-[12px]">
                  <span className="min-w-0 truncate text-pen">{link}</span>
                  <span className="shrink-0 text-muted">code {code}</span>
                </p>
                {row && (
                  <p className="mt-1.5 text-[13px] tabular-nums text-muted">
                    <span className="font-semibold text-ink">{row.scans}</span> opened · <span className="font-semibold text-ink">{row.claims}</span> claimed ·{" "}
                    <span className={clsx("font-semibold", row.redeemed ? "text-pen" : "text-ink")}>{row.redeemed}</span> redeemed
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {a.channel === "whatsapp" && channels?.whatsapp && <SendOnWhatsApp asset={a} channels={channels} />}
                {a.channel === "instagram_post" && channels?.instagram && <PostOnInstagram asset={a} channels={channels} />}
                {a.channel === "whatsapp" || a.channel === "instagram_story" ? (
                  <a
                    href={`https://wa.me/?text=${encodeURIComponent(messageFor(a, link))}`}
                    target="_blank"
                    rel="noreferrer"
                    className="press inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] bg-ink px-3 text-[13px] font-semibold text-white hover:bg-ink-2"
                  >
                    <WhatsappLogo size={15} weight="fill" aria-hidden /> {channels?.whatsapp ? "Forward from my phone" : "Send on WhatsApp"}
                  </a>
                ) : (
                  <CopyButton text={captionFor(a, link)} label="Copy caption" />
                )}
                <CopyButton text={link} label="Copy link" />
                <a
                  href={`/api/public/qr/${code}.png`}
                  download={`qr-${code}.png`}
                  className="press inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] px-3 text-[13px] font-semibold shadow-[inset_0_0_0_1.5px_var(--color-ink)] hover:bg-sunken"
                >
                  <DownloadSimple size={14} aria-hidden /> QR
                </a>
                <a
                  href={`/r/${code}`}
                  target="_blank"
                  rel="noreferrer"
                  className="press inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] px-2.5 text-[13px] font-semibold text-ink-2 hover:bg-sunken hover:text-ink"
                  aria-label="See what customers see"
                >
                  <ArrowSquareOut size={15} aria-hidden /> Preview
                </a>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
