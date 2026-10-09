"use client";

import { ArrowRight, CalendarBlank, Check, Lightbulb, LockSimple, Megaphone, WarningCircle } from "@phosphor-icons/react";
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
    <ul className="divide-y divide-ink/15 border-y border-ink">
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
    <li className="rise-in py-5" style={stagger(n)}>
      <div className="flex gap-4">
        <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] ${approval ? "bg-ink text-marker" : "bg-pen-soft text-pen"}`}>
          <Icon size={20} weight="bold" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-muted">
            <span className={approval ? "font-semibold text-ink" : "font-semibold text-pen"}>{approval ? "Needs your OK" : "Suggestion from Counterpart"}</span>
            <span aria-hidden>·</span>
            {timeAgo(item.created_at)}
          </p>
          <p className="mt-1 text-[19px] font-bold leading-snug [font-stretch:90%]">{item.title}</p>
          {item.body && <p className="mt-1 text-[15px] text-ink-2">{item.body}</p>}
          {tool && EFFECT[tool] && <p className="mt-1 text-[14px] text-muted">{EFFECT[tool]}</p>}
          {item.payload.evidence?.length ? (
            <ul className="mt-3 space-y-1 text-[14px] text-ink-2">
              {item.payload.evidence.map((e, i) => (
                <li key={i} className="flex gap-2">
                  <Check size={14} weight="bold" className="mt-1 shrink-0 text-pen" aria-hidden />
                  {e}
                </li>
              ))}
            </ul>
          ) : null}
          {error && <p className="mt-2 text-sm text-kumkum">{error}</p>}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {approval ? (
              <>
                <Button variant="primary" onClick={() => decide(true)} disabled={busy !== null} trailing={<Check size={14} weight="bold" />}>
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
              <Link href={`/campaigns/${item.campaign_id}`} className="press inline-flex items-center gap-1 text-[14px] font-semibold text-ink underline decoration-ink/30 underline-offset-4 hover:decoration-ink">
                Open the campaign <ArrowRight size={13} weight="bold" aria-hidden />
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
    <ul className="divide-y divide-line border-y border-ink">
      {findings.map((f, i) => {
        const ev = f.kind === "event_upcoming" ? eventDate(f.message) : null;
        const urgent = f.priority === 1;
        return (
          <li key={i} className="rise-in flex items-center gap-4 py-3.5" style={stagger(i + 1)}>
            {ev ? (
              <span className="flex w-12 shrink-0 flex-col items-center text-pen">
                <span className="sign tabular text-[34px]">{ev.day}</span>
                <span className="font-mono text-[12px] font-semibold uppercase">{ev.month}</span>
              </span>
            ) : (
              <span className={`inline-flex h-12 w-12 shrink-0 items-center justify-center ${urgent ? "text-kumkum" : "text-turmeric"}`}>
                <WarningCircle size={26} weight="bold" aria-hidden />
              </span>
            )}
            <div className="min-w-0">
              <p className="text-[16px] font-semibold leading-snug">{ev ? ev.name : f.message}</p>
              <p className="mt-0.5 flex items-center gap-1 text-[13px] text-pen">
                {ev ? (
                  <>
                    <CalendarBlank size={13} aria-hidden /> Coming up. A good moment for a campaign.
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
