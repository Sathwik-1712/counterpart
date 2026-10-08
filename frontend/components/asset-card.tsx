"use client";

import clsx from "clsx";
import { Check, ChevronDown, Pencil, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import type { Asset, Fact, Validation } from "@/lib/types";
import { ChannelPreview } from "./previews";
import { Button, CHANNEL_LABEL, LANG_LABEL, Pill, SEGMENT_LABEL, StatusPill } from "./ui";

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
  const l3 = v.l3 === "passed" ? "Meaning checked" : v.l3 === "pending" ? "Meaning check pending" : v.l3 === "failed" ? "Meaning check failed" : "Meaning check skipped";
  return (
    <div className="text-sm">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 text-left" aria-expanded={open}>
        {v.passed ? <ShieldCheck size={16} className="text-leaf" aria-hidden /> : <ShieldAlert size={16} className="text-kumkum" aria-hidden />}
        <span className={v.passed ? "text-leaf-ink" : "text-kumkum"}>
          {v.passed ? "Matches the locked offer" : blocking[0]?.detail ?? "Blocked"}
        </span>
        <span className="flex-1" />
        <span className="text-xs text-muted">{l3}</span>
        <ChevronDown size={14} className={clsx("text-muted transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div className="mt-2 space-y-1.5 border-l-2 border-line pl-3">
          {v.checks.map((c, i) => (
            <p key={i} className={clsx("flex gap-2", c.passed ? "text-ink-2" : c.severity === "block" ? "text-kumkum" : "text-turmeric")}>
              {c.passed ? <Check size={14} className="mt-0.5 shrink-0 text-leaf" aria-hidden /> : <X size={14} className="mt-0.5 shrink-0" aria-hidden />}
              {c.detail}
            </p>
          ))}
          {v.back_translation && (
            <p className="pt-1 text-ink-2">
              <span className="text-muted">In plain English: </span>
              {v.back_translation}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function AssetCard({ asset, facts, business, onChange }: { asset: Asset; facts: Fact[]; business: string; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ headline: "", body: "", cta: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rev = asset.revision;
  const v = rev?.validation ?? null;
  const code = asset.touchpoints?.[0]?.code;

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

  function startEdit() {
    const r = rev?.rendered;
    setDraft({ headline: r?.headline ?? "", body: r?.body ?? "", cta: r?.cta ?? "" });
    setEditing(true);
  }

  async function saveEdit() {
    const seg = (t: string, field: string) => (t.trim() ? [{ text: toSlots(t, facts, asset.language), sources: [`owner:${field}`] }] : []);
    const ok = await act("save", () =>
      api(`/assets/${asset.id}`, {
        method: "PATCH",
        json: {
          content: { headline: seg(draft.headline, "headline"), body: seg(draft.body, "body"), cta: seg(draft.cta, "cta"), hashtags: rev?.rendered?.hashtags ?? [] },
        },
      }),
    );
    if (ok) setEditing(false);
  }

  return (
    <article className={clsx("flex flex-col rounded-lg border bg-surface", asset.status === "invalid" ? "border-kumkum/40" : asset.status === "stale" ? "border-turmeric/50" : "border-line")}>
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5 text-sm">
        <span className="font-medium">{CHANNEL_LABEL[asset.channel]}</span>
        <span className="text-muted">{LANG_LABEL[asset.language]}</span>
        <span className="text-muted">{SEGMENT_LABEL[asset.segment] ?? asset.segment}</span>
        {asset.variant && <Pill>Variant {asset.variant}</Pill>}
        <span className="flex-1" />
        <StatusPill status={asset.status} />
      </header>

      <div className="flex-1 p-4">
        {editing ? (
          <div className="space-y-2">
            {(["headline", "body", "cta"] as const).map((f) => (
              <label key={f} className="block text-xs text-muted">
                {f === "cta" ? "Call to action" : f[0].toUpperCase() + f.slice(1)}
                <textarea
                  value={draft[f]}
                  onChange={(e) => setDraft({ ...draft, [f]: e.target.value })}
                  rows={f === "body" ? 4 : 1}
                  className="mt-1 w-full resize-y rounded-md border border-line-strong px-2.5 py-1.5 text-[14px] text-ink outline-none focus:border-ink-2"
                />
              </label>
            ))}
            <p className="text-xs text-muted">Offer details must match the locked facts word for word. To change the offer, tell Counterpart instead.</p>
          </div>
        ) : (
          <ChannelPreview asset={asset} business={business} />
        )}
      </div>

      <footer className="space-y-3 border-t border-line px-4 py-3">
        {!editing && <GuardSummary v={v} />}
        {rev?.features?.angle && !editing && <p className="text-xs text-muted">Angle: {rev.features.angle}</p>}
        {code && (
          <p className="text-xs text-ink-2">
            Code <span className="font-receipt text-ink">{code}</span>
            {asset.outcomes && (
              <span className="text-muted">
                , {asset.outcomes.scan ?? 0} scans, {asset.outcomes.redeem ?? 0} claimed
              </span>
            )}
          </p>
        )}
        {error && <p className="text-sm text-kumkum">{error}</p>}
        <div className="flex flex-wrap gap-2">
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
              {!["live", "retired", "rejected"].includes(asset.status) && (
                <Button size="sm" variant="ghost" onClick={startEdit}>
                  <Pencil size={13} aria-hidden /> Edit
                </Button>
              )}
              {asset.status === "valid" && (
                <Button size="sm" variant="primary" onClick={() => act("publish", () => api(`/campaigns/${asset.campaign_id}/publish`, { method: "POST", json: { asset_ids: [asset.id] } }))} disabled={busy !== null}>
                  {busy === "publish" ? "Publishing…" : "Approve and publish"}
                </Button>
              )}
            </>
          )}
        </div>
      </footer>
    </article>
  );
}
