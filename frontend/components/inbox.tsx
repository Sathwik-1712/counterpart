"use client";

import { ArrowUpRight, CalendarBlank, Check, Lightbulb, LockSimple, Megaphone, WarningCircle } from "@phosphor-icons/react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import type { Finding, InboxItem } from "@/lib/types";
import { Button, Empty, stagger, timeAgo } from "./ui";

const EFFECT: Record<string, string> = {
  lock_facts: "These offer details become fixed. Every message will use exactly this wording.",
  publish_assets: "These pieces go live and each gets its own tracking code.",
};

const ICON: Record<string, typeof LockSimple> = { lock_facts: LockSimple, publish_assets: Megaphone };

export function InboxList({ items, onChange, showCampaignLink = true }: { items: InboxItem[]; onChange?: () => void; showCampaignLink?: boolean }) {
  if (!items.length)
    return (
      <Empty icon={<Check size={17} weight="bold" aria-hidden />}>
        Nothing needs you right now. Counterpart will ask before anything reaches customers.
      </Empty>
    );
  return (
    <ul className="space-y-3">
      {items.map((i, n) => (
        <InboxRow key={i.id} item={i} n={n} onChange={onChange} showCampaignLink={showCampaignLink} />
      ))}
    </ul>
  );
}

function InboxRow({ item, n, onChange, showCampaignLink }: { item: InboxItem; n: number; onChange?: () => void; showCampaignLink: boolean }) {
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tool = item.payload.tool;
  const approval = item.kind === "approval";
  const Icon = (tool && ICON[tool]) || Lightbulb;

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
    <li className="rise-in rounded-[var(--radius-lg)] bg-surface p-5 shadow-[var(--shadow-soft)] ring-1 ring-line/80 md:p-6" style={stagger(n)}>
      <div className="flex gap-4">
        <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] ${approval ? "bg-turmeric-soft text-turmeric" : "bg-leaf-soft text-leaf-ink"}`}>
          <Icon size={20} weight="duotone" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted">
            <span className={approval ? "font-medium text-turmeric" : "font-medium text-leaf-ink"}>{approval ? "Needs your OK" : "Suggestion"}</span>
            <span className="px-1.5">·</span>
            {timeAgo(item.created_at)}
          </p>
          <p className="mt-1 text-[16px] font-semibold leading-snug tracking-tight">{item.title}</p>
          {item.body && <p className="mt-1.5 text-sm text-ink-2">{item.body}</p>}
          {tool && EFFECT[tool] && <p className="mt-1.5 text-sm text-muted">{EFFECT[tool]}</p>}
          {item.payload.evidence?.length ? (
            <ul className="mt-3 space-y-1.5 text-sm text-ink-2">
              {item.payload.evidence.map((e, i) => (
                <li key={i} className="flex gap-2">
                  <Check size={14} className="mt-1 shrink-0 text-leaf" aria-hidden />
                  {e}
                </li>
              ))}
            </ul>
          ) : null}
          {error && <p className="mt-2 text-sm text-kumkum">{error}</p>}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {approval ? (
              <>
                <Button variant="accent" onClick={() => decide(true)} disabled={busy !== null} trailing={<Check size={13} weight="bold" />}>
                  {busy === "approve" ? "Approving…" : "Approve"}
                </Button>
                <Button variant="ghost" onClick={() => decide(false)} disabled={busy !== null}>
                  {busy === "decline" ? "Declining…" : "Decline"}
                </Button>
              </>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => decide(false)} disabled={busy !== null}>
                Dismiss
              </Button>
            )}
            <span className="flex-1" />
            {showCampaignLink && item.campaign_id && (
              <Link href={`/campaigns/${item.campaign_id}`} className="press inline-flex items-center gap-1 rounded-full px-2 text-sm font-medium text-leaf hover:text-leaf-ink">
                Open the campaign <ArrowUpRight size={13} aria-hidden />
              </Link>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

/** "Dasara holidays starts Sun 11 Oct." → day 11, month Oct. */
function eventDate(message: string) {
  const m = message.match(/starts \w{3} (\d{1,2}) (\w{3})/);
  return m ? { day: m[1], month: m[2], name: message.split(" starts ")[0] } : null;
}

export function FindingsList({ findings }: { findings: Finding[] }) {
  if (!findings.length) return <Empty>Nothing unusual in your reviews, calendar or campaigns.</Empty>;
  return (
    <ul className="grid gap-3">
      {findings.map((f, i) => {
        const ev = f.kind === "event_upcoming" ? eventDate(f.message) : null;
        const urgent = f.priority === 1;
        return (
          <li key={i} className="rise-in flex items-center gap-4 rounded-[var(--radius-lg)] bg-surface p-4 shadow-[var(--shadow-soft)] ring-1 ring-line/80" style={stagger(i + 1)}>
            {ev ? (
              <span className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-[14px] bg-forest text-white">
                <span className="text-[20px] font-semibold leading-none tabular-nums">{ev.day}</span>
                <span className="mt-0.5 text-[11px] uppercase tracking-wide text-mint">{ev.month}</span>
              </span>
            ) : (
              <span className={`inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-[14px] ${urgent ? "bg-kumkum-soft text-kumkum" : "bg-turmeric-soft text-turmeric"}`}>
                <WarningCircle size={22} weight="duotone" aria-hidden />
              </span>
            )}
            <div className="min-w-0">
              <p className="text-[15px] font-medium leading-snug">{ev ? ev.name : f.message}</p>
              <p className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                {ev ? (
                  <>
                    <CalendarBlank size={12} aria-hidden /> Coming up, a good moment for a campaign
                  </>
                ) : urgent ? (
                  "Worth a look today"
                ) : (
                  "Counterpart is keeping an eye on this"
                )}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
