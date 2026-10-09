"use client";

import { CalendarBlank, Prohibit } from "@phosphor-icons/react";
import clsx from "clsx";
import type { Festival } from "@/lib/types";
import { LANG_LABEL } from "./ui";

const when = (f: Festival) => {
  const n = f.starts_in_days;
  if (n == null) return f.dates[0]?.label ?? null;
  return n < 0 ? "On now" : n === 0 ? "Starts today" : n === 1 ? "Starts tomorrow" : `In ${n} days`;
};

/** A festival as the owner should know it for marketing: the greeting in each language (hand-checked), what it
 *  means, the customs people actually follow, ideas for an angle, and what to avoid. */
export function FestivalCard({ f, compact = false, onUse }: { f: Festival; compact?: boolean; onUse?: (idea: string) => void }) {
  return (
    <article className="rise-in overflow-hidden rounded-[var(--radius-lg)] bg-surface ring-1 ring-ink">
      <div className="border-b border-ink bg-marker-soft p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[24px]">{f.name}</h3>
          {when(f) && (
            <span className="inline-flex items-center gap-1.5 text-[14px] font-semibold">
              <CalendarBlank size={15} aria-hidden /> {when(f)}
            </span>
          )}
        </div>
        {f.dates[0] && <p className="mt-1 text-[13px] text-ink-2">{f.dates[0].label}</p>}
        <ul className="mt-4 space-y-1.5">
          {Object.entries(f.greetings).map(([lang, g]) => (
            <li key={lang} className="flex items-baseline gap-3">
              <span className="w-16 shrink-0 text-[13px] text-muted">{LANG_LABEL[lang] ?? lang}</span>
              <span className="text-[19px] font-semibold leading-snug" lang={lang}>
                {g}
              </span>
            </li>
          ))}
          {Object.entries(f.sayings).map(([lang, g]) => (
            <li key={`s-${lang}`} className="flex items-baseline gap-3">
              <span className="w-16 shrink-0 text-[13px] text-muted">Saying</span>
              <span className="text-[17px] leading-snug" lang={lang}>
                “{g}”
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className={clsx("grid gap-5 p-5", !compact && "md:grid-cols-2")}>
        <div>
          <p className="text-[15px] text-ink-2">{f.meaning}</p>
          {!compact && (
            <ul className="mt-3 space-y-1.5 text-[14px]">
              {f.customs.map((c) => (
                <li key={c} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-pen" aria-hidden />
                  {c}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="text-[14px] font-semibold">Ideas for your posts</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {f.angles.map((a) =>
              onUse ? (
                <li key={a}>
                  <button onClick={() => onUse(`${a} (${f.name})`)} className="press rounded-[var(--radius-sm)] px-3 py-1.5 text-left text-[14px] font-semibold text-pen ring-1 ring-pen/40 hover:bg-pen-soft">
                    {a}
                  </button>
                </li>
              ) : (
                <li key={a} className="rounded-[var(--radius-sm)] bg-pen-soft px-3 py-1.5 text-[14px] text-pen-ink">
                  {a}
                </li>
              ),
            )}
          </ul>
          {!compact && f.avoid.length > 0 && (
            <p className="mt-4 flex gap-2 text-[14px] text-ink-2">
              <Prohibit size={16} className="mt-0.5 shrink-0 text-kumkum" aria-hidden />
              <span>
                <span className="font-semibold text-ink">Avoid: </span>
                {f.avoid.join("; ")}.
              </span>
            </p>
          )}
        </div>
      </div>
    </article>
  );
}
