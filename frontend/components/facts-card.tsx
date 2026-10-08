"use client";

import { Lock, LockOpen } from "lucide-react";
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
          <Button variant="primary" size="sm" onClick={lock} disabled={busy}>
            <Lock size={14} aria-hidden />
            {busy ? "Locking…" : "Lock these facts"}
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
                {langs.map((l) => (
                  <td key={l} className="py-2 pr-4">
                    {f.display[l] ?? <span className="text-kumkum">missing</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
