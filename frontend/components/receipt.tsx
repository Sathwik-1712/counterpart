"use client";

import clsx from "clsx";
import { useEffect, useState } from "react";
import { api, useLedgerEvents } from "@/lib/api";
import { useBusiness } from "@/lib/business";
import type { LedgerEvent } from "@/lib/types";

const ACTOR: Record<LedgerEvent["actor"], string> = { agent: "Counterpart", owner: "You", system: "System", customer: "Customer" };

/** The agent's work log, printed like a counter receipt. Newest at the top. */
export function Receipt({ campaignId, className }: { campaignId?: string; className?: string }) {
  const business = useBusiness();
  const [events, setEvents] = useState<LedgerEvent[]>([]);
  const [freshIds, setFreshIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    const q = new URLSearchParams({ limit: "40", ...(campaignId ? { campaign_id: campaignId } : {}) });
    api<LedgerEvent[]>(`/businesses/${business.slug}/ledger?${q}`).then(setEvents).catch(() => {});
  }, [campaignId, business.slug]);

  useLedgerEvents((e) => {
    if (campaignId && e.campaign_id !== campaignId) return;
    setEvents((prev) => (prev.some((p) => p.id === e.id) ? prev : [e, ...prev].slice(0, 80)));
    setFreshIds((s) => new Set(s).add(e.id));
  });

  return (
    <aside className={clsx("flex min-h-0 flex-col", className)} aria-label="Activity log">
      <div className="receipt-edge" />
      <div className="min-h-0 flex-1 overflow-y-auto bg-receipt px-4 pb-6 font-receipt text-[12px] leading-[1.55] text-ink-2">
        <p className="pt-2 text-center text-ink">{business.name.toUpperCase()} · WORK LOG</p>
        <p className="border-b border-dashed border-line-strong pb-2 text-center text-muted">
          {new Date().toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
        </p>
        {events.length === 0 && <p className="py-6 text-center text-muted">Nothing printed yet.</p>}
        <ol>
          {events.map((e) => (
            <li key={e.id} className={clsx("border-b border-dashed border-line py-2", freshIds.has(e.id) && "print-in")}>
              <div className="flex justify-between gap-2 text-muted">
                <span>{ACTOR[e.actor]}</span>
                <time dateTime={e.created_at}>
                  {new Date(e.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                </time>
              </div>
              <p className={clsx("break-words", e.type.includes("failed") || e.summary.includes("blocked") ? "text-kumkum" : "text-ink")}>
                {e.summary}
              </p>
              {Boolean(e.payload?.saved_output) && <p className="text-turmeric">Saved output (replayed)</p>}
            </li>
          ))}
        </ol>
      </div>
    </aside>
  );
}
