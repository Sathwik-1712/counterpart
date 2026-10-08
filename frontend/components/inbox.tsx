"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import type { Finding, InboxItem } from "@/lib/types";
import { Button, Empty, Pill, timeAgo } from "./ui";

const EFFECT: Record<string, string> = {
  lock_facts: "These offer details become fixed. Every message will use exactly this wording.",
  publish_assets: "These pieces go live and each gets its own tracking code.",
};

export function InboxList({ items, onChange, showCampaignLink = true }: { items: InboxItem[]; onChange?: () => void; showCampaignLink?: boolean }) {
  if (!items.length) return <Empty>Nothing needs you right now.</Empty>;
  return (
    <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
      {items.map((i) => (
        <InboxRow key={i.id} item={i} onChange={onChange} showCampaignLink={showCampaignLink} />
      ))}
    </ul>
  );
}

function InboxRow({ item, onChange, showCampaignLink }: { item: InboxItem; onChange?: () => void; showCampaignLink: boolean }) {
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tool = item.payload.tool;

  async function decide(approve: boolean) {
    setBusy(approve ? "approve" : "decline");
    setError(null);
    try {
      await api(`/inbox/${item.id}/decision`, { method: "POST", json: { approve } });
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <Pill tone={item.kind === "approval" ? "turmeric" : "neutral"}>{item.kind === "approval" ? "Needs your OK" : "Suggestion"}</Pill>
          <span className="text-xs text-muted">{timeAgo(item.created_at)}</span>
        </div>
        <p className="font-medium">{item.title}</p>
        {item.body && <p className="mt-1 text-sm text-ink-2">{item.body}</p>}
        {tool && EFFECT[tool] && <p className="mt-1 text-sm text-ink-2">{EFFECT[tool]}</p>}
        {item.payload.evidence?.length ? (
          <ul className="mt-2 list-disc pl-5 text-sm text-ink-2">
            {item.payload.evidence.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        ) : null}
        {showCampaignLink && item.campaign_id && (
          <Link href={`/campaigns/${item.campaign_id}`} className="mt-2 inline-block text-sm text-leaf underline-offset-2 hover:underline">
            Open the campaign
          </Link>
        )}
        {error && <p className="mt-2 text-sm text-kumkum">{error}</p>}
      </div>
      <div className="flex shrink-0 gap-2">
        {item.kind === "approval" ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => decide(false)} disabled={busy !== null}>
              {busy === "decline" ? "Declining…" : "Decline"}
            </Button>
            <Button size="sm" variant="primary" onClick={() => decide(true)} disabled={busy !== null}>
              {busy === "approve" ? "Approving…" : "Approve"}
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => decide(false)} disabled={busy !== null}>
            Dismiss
          </Button>
        )}
      </div>
    </li>
  );
}

const FINDING_TONE: Record<number, "kumkum" | "turmeric" | "neutral"> = { 1: "kumkum", 2: "turmeric", 3: "neutral" };

export function FindingsList({ findings }: { findings: Finding[] }) {
  if (!findings.length) return <Empty>Nothing unusual in your reviews, calendar or campaigns.</Empty>;
  return (
    <ul className="space-y-2">
      {findings.map((f, i) => (
        <li key={i} className="flex items-start gap-3 text-sm">
          <span
            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
              FINDING_TONE[f.priority] === "kumkum" ? "bg-kumkum" : FINDING_TONE[f.priority] === "turmeric" ? "bg-turmeric" : "bg-line-strong"
            }`}
            aria-hidden
          />
          <span className="text-ink">{f.message}</span>
        </li>
      ))}
    </ul>
  );
}
