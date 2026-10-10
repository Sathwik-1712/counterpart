"use client";

import { ArrowSquareOut, Camera, CaretDown, Check, DeviceMobile, DownloadSimple, InstagramLogo, LinkSimple, PencilSimple, SealCheck, ShareNetwork, Sparkle, Storefront, WarningOctagon, WhatsappLogo, X } from "@phosphor-icons/react";
import clsx from "clsx";
import { useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Asset, ChannelsStatus, Fact, Validation } from "@/lib/types";
import { InstagramPicker } from "./instagram-picker";
import { PhotoPicker, SOURCE_LABEL } from "./photo-picker";
import { PostEditor } from "./post-editor";
import { ChannelPreview } from "./previews";
import { Button, CHANNEL_LABEL, LANG_LABEL, segmentLabel, stagger, StatusPill } from "./ui";

const CHANNEL_ICON = { instagram_post: InstagramLogo, instagram_story: DeviceMobile, poster: Storefront, whatsapp: WhatsappLogo } as const;

function GuardSummary({ v }: { v: Validation | null }) {
  const [open, setOpen] = useState(false);
  if (!v) return null;
  const blocking = v.checks.filter((c) => !c.passed && c.severity === "block");
  const l3 =
    v.l3 === "passed" ? "Meaning checked" : v.l3 === "pending" ? "Meaning check waiting" : v.l3 === "failed" ? "Meaning check failed" : "Meaning not checked";
  return (
    <div className="text-sm">
      <button onClick={() => setOpen(!open)} className="flex w-full items-start gap-2 text-left" aria-expanded={open}>
        {v.passed ? (
          <SealCheck size={18} weight="fill" className="mt-px shrink-0 text-pen" aria-hidden />
        ) : (
          <WarningOctagon size={18} weight="fill" className="mt-px shrink-0 text-kumkum" aria-hidden />
        )}
        <span className="min-w-0 flex-1">
          <span className={clsx("block", v.passed ? "text-pen-ink" : "text-kumkum")}>
            {v.passed ? "Matches the locked offer" : blocking[0]?.detail ?? "Blocked"}
          </span>
          <span className="block text-[13px] text-muted">{l3}</span>
        </span>
        <CaretDown size={14} className={clsx("mt-1 shrink-0 text-muted transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div className="mt-3 space-y-1.5 rounded-[var(--radius-md)] bg-sunken/70 p-3.5">
          {v.checks.map((c, i) => (
            <p key={i} className={clsx("flex gap-2", c.passed ? "text-ink-2" : c.severity === "block" ? "text-kumkum" : "text-turmeric")}>
              {c.passed ? <Check size={14} className="mt-1 shrink-0 text-pen" aria-hidden /> : <X size={14} className="mt-1 shrink-0" aria-hidden />}
              {c.detail}
            </p>
          ))}
          {v.back_translation && (
            <p className="border-t border-line pt-2 text-ink-2">
              <span className="text-muted">In plain English: </span>
              {v.back_translation}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

async function renderPng(node: HTMLElement) {
  const { toBlob } = await import("html-to-image");
  const blob = await toBlob(node, { pixelRatio: Math.max(2, 1080 / node.offsetWidth), cacheBust: true });
  if (!blob) throw new Error("Could not render the image.");
  return blob;
}

/** Instagram takes JPEG only: redraw the PNG on white and encode it. */
async function toJpeg(png: Blob) {
  const bmp = await createImageBitmap(png);
  const canvas = Object.assign(document.createElement("canvas"), { width: bmp.width, height: bmp.height });
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.9);
}

/** Post a live Instagram post exactly as drawn on its card (found by `data-post`), from anywhere on the page. */
export async function postToInstagram(assetId: string) {
  const node = document.querySelector<HTMLElement>(`[data-post="${assetId}"]`);
  if (!node) throw new Error("Show this post in the Posts section above (pick “All”), then try again.");
  const data_url = await toJpeg(await renderPng(node));
  return api<{ media_id: string; permalink: string | null }>(`/assets/${assetId}/instagram/publish`, { method: "POST", json: { data_url } });
}

export function AssetCard({ asset, facts, business, onChange, i = 0, channels }: { asset: Asset; facts: Fact[]; business: string; onChange: () => void; i?: number; channels?: ChannelsStatus | null }) {
  const [editing, setEditing] = useState(false);
  const [linking, setLinking] = useState(false);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const postRef = useRef<HTMLDivElement>(null);
  const rev = asset.revision;
  const v = rev?.validation ?? null;
  const code = asset.touchpoints?.[0]?.code;
  const fileName = `${business.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${asset.channel}-${asset.language}${code ? `-${code}` : ""}.png`;

  async function act(name: string, fn: () => Promise<unknown>) {
    setBusy(name);
    setError(null);
    try {
      await fn();
      onChange();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function download() {
    if (!postRef.current) return;
    setBusy("download");
    try {
      const url = URL.createObjectURL(await renderPng(postRef.current));
      Object.assign(document.createElement("a"), { href: url, download: fileName }).click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function share() {
    if (!postRef.current) return;
    setBusy("share");
    try {
      const file = new File([await renderPng(postRef.current)], fileName, { type: "image/png" });
      const text = [rev?.rendered?.headline, rev?.rendered?.body].filter(Boolean).join("\n");
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], text });
      else {
        await navigator.clipboard?.writeText(text);
        await download();
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const ChannelIcon = CHANNEL_ICON[asset.channel];

  return (
    <article
      className={clsx(
        "rise-in flex flex-col rounded-[var(--radius-xl)] bg-surface p-2 shadow-[var(--shadow-soft)] ring-1",
        asset.status === "invalid" ? "ring-kumkum/40" : asset.status === "stale" ? "ring-turmeric/50" : "ring-line/80",
      )}
      style={stagger(i)}
    >
      <div className="flex items-center gap-3 px-3 pb-3 pt-2">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-ink text-white">
          <ChannelIcon size={18} aria-hidden />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[15px] font-semibold">
            {CHANNEL_LABEL[asset.channel]} <span className="font-normal text-muted">in {LANG_LABEL[asset.language]}</span>
          </p>
          <p className="truncate text-[13px] text-muted">
            For {segmentLabel(asset.segment).toLowerCase()}
            {asset.variant && `, variant ${asset.variant}`}
          </p>
        </div>
        <StatusPill status={asset.status} />
      </div>

      <div ref={postRef} data-post={asset.id} className="overflow-hidden rounded-[var(--radius-lg)] ring-1 ring-black/5" lang={asset.language}>
        <ChannelPreview asset={asset} business={business} />
      </div>
      {editing && <PostEditor asset={asset} facts={facts} onClose={() => setEditing(false)} onSaved={onChange} />}
      {asset.channel !== "whatsapp" && asset.image_source && (
        <div className="flex items-center gap-2 px-3 pt-2.5 text-[13px] text-muted">
          {asset.image_source.source === "generated" ? <Sparkle size={13} className="shrink-0 text-turmeric" aria-hidden /> : <Camera size={13} className="shrink-0 text-pen" aria-hidden />}
          <span className="min-w-0 flex-1 truncate">
            {asset.image_source.source === "generated"
              ? "AI picture. Add photos of your place to use real ones."
              : `${SOURCE_LABEL[asset.image_source.source]} photo${asset.image_source.source === "google" && asset.image_source.attribution ? ` (${asset.image_source.attribution})` : ""}`}
          </span>
          {!["live", "retired", "rejected"].includes(asset.status) && (
            <button onClick={() => setPicking(true)} className="press shrink-0 rounded-[var(--radius-sm)] px-2 py-1 font-medium text-pen hover:bg-pen-soft">
              Change photo
            </button>
          )}
        </div>
      )}
      {linking && <InstagramPicker assetId={asset.id} onClose={() => setLinking(false)} onLinked={onChange} />}
      {picking && <PhotoPicker assetId={asset.id} current={asset.image_url} onClose={() => setPicking(false)} onPicked={onChange} />}

      <div className="mt-auto space-y-3 px-3 pb-2 pt-4">
        <GuardSummary v={v} />
        {code && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
            <span className="rounded-[var(--radius-sm)] bg-sunken px-2.5 py-1 font-receipt text-[12px] tracking-wider text-ink">{code}</span>
            {asset.outcomes && (
              <span className="tabular-nums">
                {asset.outcomes.scan ?? 0} scans, {asset.outcomes.redeem ?? 0} redeemed
              </span>
            )}
          </p>
        )}
        {error && <p className="text-sm text-kumkum">{error}</p>}
        <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
          {
            <>
              {asset.status === "valid" && (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => act("publish", () => api(`/campaigns/${asset.campaign_id}/publish`, { method: "POST", json: { asset_ids: [asset.id] } }))}
                  disabled={busy !== null}
                >
                  <Check size={14} weight="bold" aria-hidden />
                  {busy === "publish" ? "Approving…" : "Approve"}
                </Button>
              )}
              {!["live", "retired", "rejected"].includes(asset.status) && (
                <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                  <PencilSimple size={14} aria-hidden /> Edit post
                </Button>
              )}
              <span className="flex-1" />
              <Button size="sm" variant="ghost" onClick={download} disabled={busy !== null} aria-label="Download as image">
                <DownloadSimple size={15} aria-hidden /> {busy === "download" ? "Saving…" : "Download"}
              </Button>
              {asset.status === "live" && asset.channel === "instagram_post" && channels?.instagram && (
                asset.instagram ? (
                  <a href={asset.instagram.permalink ?? "#"} target="_blank" rel="noreferrer" className="press inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] px-2.5 text-[13px] font-semibold text-pen hover:bg-pen-soft">
                    <InstagramLogo size={15} aria-hidden /> On Instagram <ArrowSquareOut size={13} aria-hidden />
                  </a>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={busy !== null}
                      onClick={() => act("instagram", () => postToInstagram(asset.id))}
                    >
                      <InstagramLogo size={15} aria-hidden /> {busy === "instagram" ? "Posting…" : "Post to Instagram"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setLinking(true)} disabled={busy !== null}>
                      <LinkSimple size={14} aria-hidden /> Link one I posted
                    </Button>
                  </>
                )
              )}
              {asset.status === "live" && (
                <Button size="sm" variant="primary" onClick={share} disabled={busy !== null}>
                  <ShareNetwork size={15} aria-hidden /> {busy === "share" ? "Preparing…" : "Share"}
                </Button>
              )}
            </>
          }
        </div>
      </div>
    </article>
  );
}
