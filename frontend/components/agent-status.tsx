"use client";

import { ArrowClockwise, Robot, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { api, useResource } from "@/lib/api";
import { useBusiness } from "@/lib/business";
import type { LedgerEvent } from "@/lib/types";
import { Button } from "./ui";

const RUN_LIMIT_MS = 9 * 60 * 1000; // a little over the server's run time limit

function elapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)} min ${s % 60}s`;
}

/** What Counterpart is doing on this campaign right now, why it stopped, or its last note. */
export function AgentStatus({ campaignId }: { campaignId: string }) {
  const business = useBusiness();
  const { data, reload } = useResource<LedgerEvent[]>(
    `/businesses/${business.slug}/ledger?campaign_id=${campaignId}&limit=15`,
    (e) => e.campaign_id === campaignId,
  );
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!data?.length) return null;
  const marker = data.find((e) => ["agent.started", "agent.finished", "agent.failed"].includes(e.type));
  if (!marker) return null;
  const latest = data[0];
  const started = new Date(marker.created_at).getTime();
  const stale = marker.type === "agent.started" && now - started > RUN_LIMIT_MS;

  async function retry() {
    setBusy(true);
    try {
      await api(`/campaigns/${campaignId}/agent`, { method: "POST", json: { message: "Carry on with the campaign from where you stopped." } });
      await reload();
    } finally {
      setBusy(false);
    }
  }

  if (marker.type === "agent.started" && !stale)
    return (
      <div className="night rise-in mb-10 flex items-center gap-4 rounded-[var(--radius-lg)] p-5" role="status" aria-live="polite">
        <span className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-marker text-ink">
          <Robot size={22} weight="duotone" aria-hidden />
          <span className="pulse-dot absolute -right-1 -top-1 h-3 w-3 rounded-full bg-kumkum ring-2 ring-ink" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold">
            Counterpart is working <span className="font-normal text-white/60">· {elapsed(now - started)}</span>
          </p>
          <p className="truncate text-sm text-white/70">{latest.id !== marker.id ? latest.summary : "Reading the situation"}</p>
        </div>
        <span className="typing hidden text-lg font-bold text-marker sm:block" aria-hidden>
          <span>·</span>
          <span>·</span>
          <span>·</span>
        </span>
      </div>
    );

  if (marker.type === "agent.failed" || stale)
    return (
      <div className="pop mb-10 flex flex-wrap items-center gap-4 rounded-[var(--radius-lg)] bg-turmeric-soft p-5 ring-1 ring-turmeric/30" role="alert">
        <WarningCircle size={26} weight="fill" className="shrink-0 text-turmeric" aria-hidden />
        <div className="min-w-0 flex-1 basis-60">
          <p className="text-[15px] font-semibold text-ink">Counterpart stopped</p>
          <p className="text-sm text-ink-2">{stale ? "The last run did not finish (the server may have restarted). Everything done so far is saved." : marker.summary}</p>
        </div>
        <Button variant="primary" onClick={retry} disabled={busy} trailing={<ArrowClockwise size={14} weight="bold" />}>
          {busy ? "Starting…" : "Try again"}
        </Button>
      </div>
    );

  return (
    <div className="rise-in mb-10 max-w-[80ch] border-l-[3px] border-pen pl-4">
      <p className="text-[13px] font-semibold text-pen">Counterpart&apos;s last note</p>
      <p className="mt-0.5 text-[15px] text-ink-2">{marker.summary}</p>
    </div>
  );
}
