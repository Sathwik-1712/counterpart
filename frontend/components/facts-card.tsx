"use client";

import { Check, CheckSquare, Lock, LockOpen, SealCheck, Square, WarningCircle } from "@phosphor-icons/react";
import clsx from "clsx";
import { useState } from "react";
import { api } from "@/lib/api";
import type { FactsVersion, Lang } from "@/lib/types";
import { Button, LANG_LABEL } from "./ui";

/** The offer facts, drawn as a coupon: what customers are told to expect. One locked version at a time. */
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
  const [lang, setLang] = useState<Lang>("en");
  const [autopublish, setAutopublish] = useState(true);
  const draft = versions.find((v) => v.status === "draft");
  const locked = versions.find((v) => v.status === "locked");
  const shown = draft ?? locked;
  const history = versions.filter((v) => v.status === "superseded");

  if (!shown) {
    return (
      <section className="rounded-[var(--radius-lg)] bg-surface p-6 shadow-[var(--shadow-soft)] ring-1 ring-line/80">
        <h2 className="text-[19px]">The offer</h2>
        <div className="mt-4 space-y-2.5" aria-hidden>
          <div className="skeleton h-9 w-2/3" />
          <div className="skeleton h-4 w-full" />
          <div className="skeleton h-4 w-4/5" />
        </div>
        <p className="mt-4 text-sm text-muted">Counterpart is writing the offer down from your brief. It appears here for you to check and lock.</p>
      </section>
    );
  }
  const langs = Array.from(new Set(shown.facts.flatMap((f) => Object.keys(f.display)))) as Lang[];
  const active = langs.includes(lang) ? lang : langs[0];
  const isDraft = shown.status === "draft";
  const check = shown.wording_check;
  const issues = check?.status === "failed" ? check.issues : [];
  const mismatched = new Set(issues.map((i) => `${i.key}:${i.lang}`));
  const badLangs = new Set(issues.map((i) => i.lang));
  const assumed = new Set((check?.assumed ?? []).map((a) => a.key));
  const label = (key: string) => shown.facts.find((f) => f.key === key)?.label ?? key;
  const canLock = !!check && check.status !== "failed";
  const [lead, ...rest] = shown.facts;
  const sentence = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

  async function lock() {
    setBusy(true);
    setError(null);
    try {
      await api(`/campaigns/${campaignId}/facts/lock?autopublish=${autopublish}`, { method: "POST" });
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const value = (key: string, l: Lang) => {
    const f = shown.facts.find((x) => x.key === key)!;
    const bad = isDraft && mismatched.has(`${key}:${l}`);
    const back = isDraft && l !== "en" ? check?.back_translations[key]?.[l] : null;
    return (
      <>
        <span className={clsx(bad && "text-kumkum underline decoration-dotted underline-offset-4")}>{f.display[l] ?? <span className="text-kumkum">missing</span>}</span>
        {back && <span className="mt-0.5 block text-[13px] font-normal tracking-normal text-muted">reads as “{back}”</span>}
      </>
    );
  };

  return (
    <section
      className={clsx("rounded-[var(--radius-lg)] bg-surface shadow-[var(--shadow-soft)] ring-1", isDraft ? "ring-turmeric/40" : "ring-line/80")}
      aria-labelledby="facts-h"
    >
      <div className="px-6 pb-5 pt-5">
        <div className="flex items-center gap-2">
          <span className={clsx("inline-flex h-8 w-8 items-center justify-center rounded-full", isDraft ? "bg-turmeric-soft text-turmeric" : "bg-pen-soft text-pen")}>
            {isDraft ? <LockOpen size={16} aria-hidden /> : <Lock size={16} weight="fill" aria-hidden />}
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <h2 id="facts-h" className="text-[16px] tracking-tight">
              The offer
            </h2>
            <p className={clsx("text-[13px]", isDraft ? "text-turmeric" : "text-muted")}>{isDraft ? `Draft ${shown.version}, not locked yet` : `Locked, version ${shown.version}`}</p>
          </div>
        </div>
        {isDraft && shown.change_reason && <p className="mt-3 text-sm text-ink-2">{shown.change_reason}</p>}

        {langs.length > 1 && (
          <div className="mt-4 flex gap-1 rounded-[var(--radius-sm)] bg-sunken p-1" role="tablist" aria-label="Language">
            {langs.map((l) => (
              <button
                key={l}
                role="tab"
                aria-selected={active === l}
                onClick={() => setLang(l)}
                className={clsx(
                  "press relative flex-1 rounded-[var(--radius-sm)] px-2 py-1 text-[13px]",
                  active === l ? "bg-surface font-medium text-ink shadow-[var(--shadow-soft)]" : "text-ink-2 hover:text-ink",
                )}
              >
                {LANG_LABEL[l] ?? l}
                {isDraft && badLangs.has(l) && <span className="absolute right-2 top-1.5 h-1.5 w-1.5 rounded-full bg-kumkum" aria-label="has a wording problem" />}
              </button>
            ))}
          </div>
        )}

        {lead && (
          <div className="mt-5" lang={active}>
            <p className="text-[13px] text-muted">{sentence(lead.label)}</p>
            <p className="mt-1 text-[30px] font-semibold leading-[1.1] tracking-[-0.03em]">{value(lead.key, active)}</p>
            {isDraft && assumed.has(lead.key) && <Assumed />}
          </div>
        )}
        <dl className="mt-4 grid gap-3" lang={active}>
          {rest.map((f) => (
            <div key={f.key}>
              <dt className="text-[13px] text-muted">
                {sentence(f.label)}
                {!f.required && " (optional)"}
              </dt>
              <dd className="text-[15px] font-medium">{value(f.key, active)}</dd>
              {isDraft && assumed.has(f.key) && <Assumed />}
            </div>
          ))}
        </dl>
      </div>

      <div className="perforation mx-0" aria-hidden />

      <div className="space-y-3 px-6 pb-6 pt-5 text-sm">
        {isDraft && check?.status === "failed" && (
          <div className="rounded-[var(--radius-md)] bg-kumkum-soft p-3.5" role="alert">
            <p className="flex items-center gap-1.5 font-medium text-kumkum">
              <WarningCircle size={15} weight="fill" aria-hidden />A translation says something different
            </p>
            <ul className="mt-1.5 space-y-1 text-ink-2">
              {issues.map((i) => (
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
          <p className="flex gap-2 text-pen-ink">
            <SealCheck size={17} weight="fill" className="mt-px shrink-0" aria-hidden />
            Every translation was read back into English and means the same.
          </p>
        )}
        {isDraft && check?.status === "unchecked" && (
          <p className="text-turmeric">Numbers match across languages, but no model checked the meaning. Read the translations before locking.</p>
        )}
        {!isDraft && (
          <p className="flex gap-2 text-ink-2">
            <Check size={16} weight="bold" className="mt-0.5 shrink-0 text-pen" aria-hidden />
            Every post uses exactly this wording. Changing it means locking a new version.
          </p>
        )}
        {Object.values(shown.forbidden_claims).some((v) => v?.length) && !compact && (
          <p className="text-ink-2">
            <span className="text-muted">Never says: </span>
            {Object.values(shown.forbidden_claims).flat().join(", ")}
          </p>
        )}
        {history.length > 0 && (
          <p className="text-[13px] text-muted">
            Earlier versions: {history.map((h) => `v${h.version}${h.change_reason ? ` (${h.change_reason})` : ""}`).join("; ")}
          </p>
        )}
        {error && <p className="text-kumkum">{error}</p>}
        {isDraft && (
          <button
            type="button"
            onClick={() => setAutopublish(!autopublish)}
            aria-pressed={autopublish}
            className="press flex w-full items-start gap-2.5 rounded-[var(--radius-md)] bg-paper p-3 text-left ring-1 ring-line"
          >
            {autopublish ? <CheckSquare size={20} weight="fill" className="mt-px shrink-0 text-pen" aria-hidden /> : <Square size={20} className="mt-px shrink-0" aria-hidden />}
            <span>
              <span className="block font-semibold text-ink">Also approve the posts</span>
              <span className="block text-[13px] text-muted">Posts written for this offer go live by themselves once they pass every check. Untick to approve each one yourself.</span>
            </span>
          </button>
        )}
        {isDraft && (
          <Button variant="accent" size="lg" onClick={lock} disabled={busy || !canLock} className="w-full" trailing={<Lock size={15} weight="bold" />}>
            {busy ? "Locking…" : !check ? "Checking wording…" : check.status === "failed" ? "Fix wording to lock" : assumed.size ? "Confirm and lock" : autopublish ? "Lock the offer and approve" : "Lock the offer"}
          </Button>
        )}
      </div>
    </section>
  );
}

function Assumed() {
  return (
    <p className="mt-1 inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-turmeric-soft px-2 py-0.5 text-[13px] font-medium text-turmeric">
      <WarningCircle size={13} aria-hidden /> Counterpart assumed this. Check it.
    </p>
  );
}
