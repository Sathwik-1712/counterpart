"use client";

import { Check, Lock, LockOpen, WarningCircle } from "@phosphor-icons/react";
import clsx from "clsx";
import { useState } from "react";
import { api } from "@/lib/api";
import type { FactsVersion, Lang } from "@/lib/types";
import { Button, Card, LANG_LABEL, Pill } from "./ui";

/** The offer facts: what customers are told to expect. One locked version at a time. */
export function FactsCard({
  campaignId,
  versions,
  onChange,
  compact = false,
}: {
  campaignId: string;
  versions: FactsVersion[];
  onChange: () => void;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draft = versions.find((v) => v.status === "draft");
  const locked = versions.find((v) => v.status === "locked");
  const shown = draft ?? locked;
  const history = versions.filter((v) => v.status === "superseded");

  if (!shown) {
    return (
      <Card className="p-5">
        <h2 className="text-[17px]">The offer</h2>
        <p className="mt-2 text-sm text-muted">Counterpart is writing the offer down from your brief. It appears here for you to check and lock.</p>
      </Card>
    );
  }
  const langs = Array.from(new Set(shown.facts.flatMap((f) => Object.keys(f.display)))) as Lang[];
  const isDraft = shown.status === "draft";
  const check = shown.wording_check;
  const mismatched = new Set((check?.status === "failed" ? check.issues : []).map((i) => `${i.key}:${i.lang}`));
  const assumed = new Set((check?.assumed ?? []).map((a) => a.key));
  const label = (key: string) => shown.facts.find((f) => f.key === key)?.label ?? key;
  const canLock = !!check && check.status !== "failed";

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

  return (
    <Card className={clsx("overflow-hidden", isDraft && "ring-turmeric/40")} aria-labelledby="facts-h">
      <div className="flex flex-wrap items-center gap-2.5 px-5 pb-3 pt-5">
        {isDraft ? <LockOpen size={18} className="text-turmeric" aria-hidden /> : <Lock size={18} weight="fill" className="text-leaf" aria-hidden />}
        <h2 id="facts-h" className="text-[17px]">
          The offer
        </h2>
        <Pill tone={isDraft ? "turmeric" : "leaf"}>{isDraft ? `Draft ${shown.version}, not locked` : `Locked, version ${shown.version}`}</Pill>
      </div>
      {isDraft && shown.change_reason && !compact && <p className="px-5 pb-2 text-sm text-ink-2">{shown.change_reason}</p>}

      <ul className={clsx("divide-y divide-line px-5", !compact && "md:grid md:grid-cols-2 md:gap-x-8 md:divide-y-0")}>
        {shown.facts.map((f) => (
          <li key={f.key} className={clsx("py-3", !compact && "md:border-t md:border-line")}>
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted">
              {f.label.charAt(0) + f.label.slice(1).toLowerCase()}
              {!f.required && <span className="font-normal">· optional</span>}
            </p>
            {isDraft && assumed.has(f.key) && (
              <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-turmeric-soft px-2 py-0.5 text-xs font-medium text-turmeric">
                <WarningCircle size={13} aria-hidden /> Counterpart assumed this. Check it.
              </p>
            )}
            <div className="mt-1 space-y-1">
              {langs.map((l) => {
                const bad = isDraft && mismatched.has(`${f.key}:${l}`);
                const back = isDraft && l !== "en" ? check?.back_translations[f.key]?.[l] : null;
                return (
                  <div key={l} className="flex gap-2">
                    <span className="w-12 shrink-0 pt-0.5 text-[11px] text-muted">{LANG_LABEL[l] ?? l}</span>
                    <span className="min-w-0">
                      <span className={clsx("text-[14px]", l === "en" && "font-medium", bad && "text-kumkum underline decoration-dotted underline-offset-4")}>
                        {f.display[l] ?? <span className="text-kumkum">missing</span>}
                      </span>
                      {back && !compact && <span className="block text-xs text-muted">reads as “{back}”</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          </li>
        ))}
      </ul>

      {isDraft && check?.status === "failed" && (
        <div className="mx-5 mb-3 rounded-[var(--radius-md)] bg-kumkum-soft p-3 text-sm" role="alert">
          <p className="flex items-center gap-1.5 font-medium text-kumkum">
            <WarningCircle size={15} weight="fill" aria-hidden />A translation says something different from the English
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
        <p className="flex items-center gap-1.5 px-5 pb-1 text-sm text-leaf">
          <Check size={14} weight="bold" aria-hidden />
          Every translation was read back into English and means the same.
        </p>
      )}
      {isDraft && check?.status === "unchecked" && (
        <p className="px-5 pb-1 text-sm text-turmeric">Numbers match across languages, but no model checked the meaning. Read the translations before locking.</p>
      )}

      {Object.values(shown.forbidden_claims).some((v) => v?.length) && !compact && (
        <p className="px-5 pt-2 text-sm text-ink-2">
          <span className="text-muted">Never says: </span>
          {Object.values(shown.forbidden_claims).flat().join(", ")}
        </p>
      )}
      {history.length > 0 && (
        <p className="px-5 pt-2 text-xs text-muted">
          Earlier versions: {history.map((h) => `v${h.version}${h.change_reason ? ` (${h.change_reason})` : ""}`).join("; ")}
        </p>
      )}
      {error && <p className="px-5 pt-2 text-sm text-kumkum">{error}</p>}
      {isDraft ? (
        <div className="px-5 pb-5 pt-4">
          <Button variant="primary" onClick={lock} disabled={busy || !canLock} className="w-full sm:w-auto">
            <Lock size={15} aria-hidden />
            {busy ? "Locking…" : !check ? "Checking wording…" : check.status === "failed" ? "Fix wording to lock" : assumed.size ? "Confirm and lock" : "Lock the offer"}
          </Button>
        </div>
      ) : (
        <div className="pb-4" />
      )}
    </Card>
  );
}
