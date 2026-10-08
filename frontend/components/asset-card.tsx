"use client";

import { CaretDown, Check, DownloadSimple, PencilSimple, SealCheck, ShareNetwork, WarningOctagon, X } from "@phosphor-icons/react";
import clsx from "clsx";
import { useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Asset, Fact, Validation } from "@/lib/types";
import { ChannelPreview } from "./previews";
import { Button, Card, CHANNEL_LABEL, LANG_LABEL, segmentLabel, StatusPill } from "./ui";

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
        <div className="mt-3 space-y-1.5 rounded-[var(--radius-md)] bg-sunken/60 p-3">
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

export function AssetCard({ asset, facts, business, onChange }: { asset: Asset; facts: Fact[]; business: string; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ headline: "", body: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const postRef = useRef<HTMLDivElement>(null);
  const rev = asset.revision;
  const v = rev?.validation ?? null;
  const code = asset.touchpoints?.[0]?.code;
  const fileName = `kaapi-kone-${asset.channel}-${asset.language}${code ? `-${code}` : ""}.png`;

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

  const picture = asset.channel !== "whatsapp";

  return (
    <Card as="article" className={clsx("rise-in flex flex-col overflow-hidden", asset.status === "invalid" && "ring-kumkum/40", asset.status === "stale" && "ring-turmeric/50")}>
      <div className="flex items-start gap-3 px-4 pb-3 pt-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {CHANNEL_LABEL[asset.channel]} <span className="font-normal text-muted">· {LANG_LABEL[asset.language]}</span>
          </p>
          <p className="truncate text-xs text-muted">
            For {segmentLabel(asset.segment).toLowerCase()}
            {asset.variant && ` · variant ${asset.variant}`}
          </p>
        </div>
        <StatusPill status={asset.status} />
      </div>

      <div className="px-4">
        {editing ? (
          <div className="space-y-3 rounded-[var(--radius-md)] bg-sunken/50 p-3">
            {(["headline", "body"] as const).map((f) => (
              <label key={f} className="block">
                <span className="text-xs font-medium text-ink-2">{f === "headline" ? "Headline" : "Message"}</span>
                <textarea
                  value={draft[f]}
                  onChange={(e) => setDraft({ ...draft, [f]: e.target.value })}
                  rows={f === "body" ? 3 : 2}
                  className="mt-1 w-full resize-y rounded-[var(--radius-md)] bg-surface px-3 py-2 text-[14px] text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] outline-none focus:shadow-[inset_0_0_0_1.5px_var(--color-ink-2)]"
                />
              </label>
            ))}
            <p className="text-xs text-muted">The offer box and “show this at the counter” are added from the locked facts. To change the offer, tell Counterpart.</p>
          </div>
        ) : (
          <div ref={postRef} className={clsx("overflow-hidden", picture ? "rounded-[var(--radius-md)]" : "rounded-[var(--radius-md)]")}>
            <ChannelPreview asset={asset} business={business} />
          </div>
        )}
      </div>

      <div className="mt-auto space-y-3 px-4 pb-4 pt-4">
        {!editing && <GuardSummary v={v} />}
        {code && (
          <p className="text-xs text-ink-2">
            Tracking code <span className="font-receipt text-ink">{code}</span>
            {asset.outcomes && (
              <span className="text-muted">
                {" "}
                · {asset.outcomes.scan ?? 0} scans · {asset.outcomes.redeem ?? 0} redeemed
              </span>
            )}
          </p>
        )}
        {error && <p className="text-sm text-kumkum">{error}</p>}
        <div className="flex flex-wrap items-center gap-2">
          {editing ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" onClick={saveEdit} disabled={busy !== null}>
                {busy === "save" ? "Checking…" : "Save and check"}
              </Button>
            </>
          ) : (
            <>
              {asset.status === "valid" && (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => act("publish", () => api(`/campaigns/${asset.campaign_id}/publish`, { method: "POST", json: { asset_ids: [asset.id] } }))}
                  disabled={busy !== null}
                >
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
                <Button size="sm" variant="secondary" onClick={share} disabled={busy !== null}>
                  <ShareNetwork size={15} aria-hidden /> {busy === "share" ? "Preparing…" : "Share"}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
