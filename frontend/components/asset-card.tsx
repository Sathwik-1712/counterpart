"use client";

import { Camera, CaretDown, Check, DeviceMobile, DownloadSimple, InstagramLogo, PencilSimple, SealCheck, ShareNetwork, Sparkle, Storefront, WarningOctagon, WhatsappLogo, X } from "@phosphor-icons/react";
import clsx from "clsx";
import { useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Asset, Fact, Validation } from "@/lib/types";
import { PhotoPicker, SOURCE_LABEL } from "./photo-picker";
import { ChannelPreview } from "./previews";
import { Button, CHANNEL_LABEL, LANG_LABEL, segmentLabel, stagger, StatusPill } from "./ui";

const CHANNEL_ICON = { instagram_post: InstagramLogo, instagram_story: DeviceMobile, poster: Storefront, whatsapp: WhatsappLogo } as const;

/** Owner edits plain text. Exact approved wording becomes a fact slot again;
 *  anything else (e.g. a different discount) stays literal and the guard blocks it. */
function toSlots(text: string, facts: Fact[], lang: string) {
  let out = text;
  for (const f of [...facts].sort((a, b) => (b.display[lang as "en"]?.length ?? 0) - (a.display[lang as "en"]?.length ?? 0))) {
    const d = f.display[lang as "en"];
    if (d) out = out.split(d).join(`{{${f.key}}}`);
  }
  return out;
}

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
          <SealCheck size={18} weight="fill" className="mt-px shrink-0 text-leaf" aria-hidden />
        ) : (
          <WarningOctagon size={18} weight="fill" className="mt-px shrink-0 text-kumkum" aria-hidden />
        )}
        <span className="min-w-0 flex-1">
          <span className={clsx("block", v.passed ? "text-leaf-ink" : "text-kumkum")}>
            {v.passed ? "Matches the locked offer" : blocking[0]?.detail ?? "Blocked"}
          </span>
          <span className="block text-xs text-muted">{l3}</span>
        </span>
        <CaretDown size={14} className={clsx("mt-1 shrink-0 text-muted transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div className="mt-3 space-y-1.5 rounded-[var(--radius-md)] bg-sunken/70 p-3.5">
          {v.checks.map((c, i) => (
            <p key={i} className={clsx("flex gap-2", c.passed ? "text-ink-2" : c.severity === "block" ? "text-kumkum" : "text-turmeric")}>
              {c.passed ? <Check size={14} className="mt-1 shrink-0 text-leaf" aria-hidden /> : <X size={14} className="mt-1 shrink-0" aria-hidden />}
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

export function AssetCard({ asset, facts, business, onChange, i = 0 }: { asset: Asset; facts: Fact[]; business: string; onChange: () => void; i?: number }) {
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState({ headline: "", body: "" });
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

  function startEdit() {
    setDraft({ headline: rev?.rendered?.headline ?? "", body: rev?.rendered?.body ?? "" });
    setEditing(true);
  }

  async function saveEdit() {
    const seg = (t: string, field: string) => (t.trim() ? [{ text: toSlots(t, facts, asset.language), sources: [`owner:${field}`] }] : []);
    const ok = await act("save", () =>
      api(`/assets/${asset.id}`, {
        method: "PATCH",
        json: { content: { headline: seg(draft.headline, "headline"), body: seg(draft.body, "body"), cta: [], hashtags: rev?.rendered?.hashtags ?? [] } },
      }),
    );
    if (ok) setEditing(false);
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
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sunken text-ink">
          <ChannelIcon size={18} aria-hidden />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[14px] font-semibold">
            {CHANNEL_LABEL[asset.channel]} <span className="font-normal text-muted">in {LANG_LABEL[asset.language]}</span>
          </p>
          <p className="truncate text-xs text-muted">
            For {segmentLabel(asset.segment).toLowerCase()}
            {asset.variant && `, variant ${asset.variant}`}
          </p>
        </div>
        <StatusPill status={asset.status} />
      </div>

      {editing ? (
        <div className="space-y-3 rounded-[20px] bg-sunken/70 p-4">
          {(["headline", "body"] as const).map((f) => (
            <label key={f} className="block">
              <span className="text-xs font-medium text-ink-2">{f === "headline" ? "Headline" : "Message"}</span>
              <textarea
                value={draft[f]}
                onChange={(e) => setDraft({ ...draft, [f]: e.target.value })}
                rows={f === "body" ? 4 : 2}
                lang={asset.language}
                className="mt-1.5 w-full resize-y rounded-[var(--radius-md)] bg-surface px-3.5 py-2.5 text-[15px] text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] outline-none focus:shadow-[inset_0_0_0_2px_var(--color-leaf)]"
              />
            </label>
          ))}
          <p className="text-xs text-muted">The offer box and “show this at the counter” come from the locked offer. To change the offer, tell Counterpart.</p>
        </div>
      ) : (
        <div ref={postRef} className="overflow-hidden rounded-[20px] ring-1 ring-black/5" lang={asset.language}>
          <ChannelPreview asset={asset} business={business} />
        </div>
      )}
      {!editing && asset.channel !== "whatsapp" && asset.image_source && (
        <div className="flex items-center gap-2 px-3 pt-2.5 text-xs text-muted">
          {asset.image_source.source === "generated" ? <Sparkle size={13} className="shrink-0 text-turmeric" aria-hidden /> : <Camera size={13} className="shrink-0 text-leaf" aria-hidden />}
          <span className="min-w-0 flex-1 truncate">
            {asset.image_source.source === "generated"
              ? "AI picture. Add photos of your place to use real ones."
              : `${SOURCE_LABEL[asset.image_source.source]} photo${asset.image_source.source === "google" && asset.image_source.attribution ? ` (${asset.image_source.attribution})` : ""}`}
          </span>
          {!["live", "retired", "rejected"].includes(asset.status) && (
            <button onClick={() => setPicking(true)} className="press shrink-0 rounded-full px-2 py-1 font-medium text-leaf hover:bg-leaf-soft">
              Change photo
            </button>
          )}
        </div>
      )}
      {picking && <PhotoPicker assetId={asset.id} current={asset.image_url} onClose={() => setPicking(false)} onPicked={onChange} />}

      <div className="mt-auto space-y-3 px-3 pb-2 pt-4">
        {!editing && <GuardSummary v={v} />}
        {code && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span className="rounded-full bg-sunken px-2.5 py-1 font-receipt text-[12px] tracking-wider text-ink">{code}</span>
            {asset.outcomes && (
              <span className="tabular-nums">
                {asset.outcomes.scan ?? 0} scans, {asset.outcomes.redeem ?? 0} redeemed
              </span>
            )}
          </p>
        )}
        {error && <p className="text-sm text-kumkum">{error}</p>}
        <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
          {editing ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <span className="flex-1" />
              <Button size="sm" variant="accent" onClick={saveEdit} disabled={busy !== null}>
                {busy === "save" ? "Checking…" : "Save and check"}
              </Button>
            </>
          ) : (
            <>
              {asset.status === "valid" && (
                <Button
                  size="sm"
                  variant="accent"
                  onClick={() => act("publish", () => api(`/campaigns/${asset.campaign_id}/publish`, { method: "POST", json: { asset_ids: [asset.id] } }))}
                  disabled={busy !== null}
                >
                  <Check size={14} weight="bold" aria-hidden />
                  {busy === "publish" ? "Publishing…" : "Approve and publish"}
                </Button>
              )}
              {!["live", "retired", "rejected"].includes(asset.status) && (
                <Button size="sm" variant="ghost" onClick={startEdit}>
                  <PencilSimple size={14} aria-hidden /> Edit
                </Button>
              )}
              <span className="flex-1" />
              <Button size="sm" variant="ghost" onClick={download} disabled={busy !== null} aria-label="Download as image">
                <DownloadSimple size={15} aria-hidden /> {busy === "download" ? "Saving…" : "Download"}
              </Button>
              {asset.status === "live" && (
                <Button size="sm" variant="primary" onClick={share} disabled={busy !== null}>
                  <ShareNetwork size={15} aria-hidden /> {busy === "share" ? "Preparing…" : "Share"}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </article>
  );
}
