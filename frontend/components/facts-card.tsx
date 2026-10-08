"use client";

import { Check, Lock, LockOpen, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import type { FactsVersion, Lang } from "@/lib/types";
import { Button, LANG_LABEL, Pill } from "./ui";

/** The offer facts: what customers are told to expect. One locked version at a time. */
export function FactsCard({ campaignId, versions, onChange }: { campaignId: string; versions: FactsVersion[]; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draft = versions.find((v) => v.status === "draft");
  const locked = versions.find((v) => v.status === "locked");
  const shown = draft ?? locked;
  const history = versions.filter((v) => v.status === "superseded");

  if (!shown) {
    return (
      <section className="rounded-lg border border-dashed border-line-strong p-5 text-sm text-muted">
        Counterpart is writing down the offer from your brief. It will appear here for you to check and lock.
      </section>
    );
  }
  const langs = Array.from(new Set(shown.facts.flatMap((f) => Object.keys(f.display)))) as Lang[];

  async function lock() {
    setBusy(true);
    setError(null);
    try {
      await api(`/campaigns/${campaignId}/facts/lock`, { method: "POST" });
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const isDraft = shown.status === "draft";
  const check = shown.wording_check;
  const mismatched = new Set((check?.status === "failed" ? check.issues : []).map((i) => `${i.key}:${i.lang}`));
  const label = (key: string) => shown.facts.find((f) => f.key === key)?.label ?? key;
  const canLock = !!check && check.status !== "failed";
  return (
    <section className={`rounded-lg border bg-surface ${isDraft ? "border-turmeric/50" : "border-line"}`} aria-labelledby="facts-h">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
        {isDraft ? <LockOpen size={16} className="text-turmeric" aria-hidden /> : <Lock size={16} className="text-leaf" aria-hidden />}
        <h2 id="facts-h" className="text-[16px]">
          Offer facts
        </h2>
        <Pill tone={isDraft ? "turmeric" : "leaf"}>{isDraft ? `Draft v${shown.version}, not locked` : `Locked v${shown.version}`}</Pill>
        <span className="flex-1" />
        {isDraft && (
          <Button variant="primary" size="sm" onClick={lock} disabled={busy || !canLock}>
            <Lock size={14} aria-hidden />
            {busy ? "Locking…" : !check ? "Checking wording…" : check.status === "failed" ? "Fix wording to lock" : "Lock these facts"}
          </Button>
        )}
      </div>
      {isDraft && shown.change_reason && <p className="px-5 pt-3 text-sm text-ink-2">{shown.change_reason}</p>}
      <div className="overflow-x-auto px-5 py-3">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-1.5 pr-4 font-medium">Fact</th>
              {langs.map((l) => (
                <th key={l} className="py-1.5 pr-4 font-medium">
                  {LANG_LABEL[l] ?? l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.facts.map((f) => (
              <tr key={f.key} className="border-t border-line align-top">
                <td className="py-2 pr-4">
                  <span className="font-medium">{f.label}</span>
                  {!f.required && <span className="ml-1 text-xs text-muted">optional</span>}
                </td>
                {langs.map((l) => {
                  const bad = isDraft && mismatched.has(`${f.key}:${l}`);
                  return (
                    <td key={l} className={`py-2 pr-4 ${bad ? "text-kumkum underline decoration-dotted underline-offset-4" : ""}`}>
                      {f.display[l] ?? <span className="text-kumkum">missing</span>}
                      {isDraft && l !== "en" && check?.back_translations[f.key]?.[l] && (
                        <span className="mt-0.5 block text-xs text-muted">reads as “{check.back_translations[f.key][l]}”</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {isDraft && check?.status === "failed" && (
        <div className="border-t border-line px-5 py-3 text-sm" role="alert">
          <p className="flex items-center gap-1.5 font-medium text-kumkum">
            <TriangleAlert size={14} aria-hidden />
            A translation says something different from the English
          </p>
          <ul className="mt-1.5 space-y-1 text-ink-2">
            {check.issues.map((i) => (
              <li key={`${i.key}:${i.lang}`}>
                {LANG_LABEL[i.lang] ?? i.lang} {label(i.key).toLowerCase()}: “{i.wording}”
                {i.back_translation && <> reads as “{i.back_translation}”</>}. {i.issue}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-muted">Ask Counterpart to correct it, for example “fix the Kannada time”.</p>
        </div>
      )}
      {isDraft && check?.status === "passed" && (
        <p className="flex items-center gap-1.5 border-t border-line px-5 py-2.5 text-sm text-leaf">
          <Check size={14} aria-hidden />
          Every translation was read back into English and means the same.
        </p>
      )}
      {isDraft && check?.status === "unchecked" && (
        <p className="border-t border-line px-5 py-2.5 text-sm text-turmeric">
          Numbers match across languages, but no model checked the meaning. Read the translations before locking.
        </p>
      )}
      {Object.values(shown.forbidden_claims).some((v) => v?.length) && (
        <p className="border-t border-line px-5 py-3 text-sm text-ink-2">
          <span className="text-muted">Never say: </span>
          {Object.values(shown.forbidden_claims).flat().join(", ")}
        </p>
      )}
      {history.length > 0 && (
        <p className="border-t border-line px-5 py-2.5 text-xs text-muted">
          Earlier versions: {history.map((h) => `v${h.version}${h.change_reason ? ` (${h.change_reason})` : ""}`).join("; ")}
        </p>
      )}
      {error && <p className="px-5 pb-3 text-sm text-kumkum">{error}</p>}
    </section>
  );
}
