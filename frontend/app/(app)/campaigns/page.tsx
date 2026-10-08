"use client";

import { ArrowUpRight, ClockCounterClockwise } from "@phosphor-icons/react";
import Link from "next/link";
import { CampaignCard } from "@/components/campaign-card";
import { Shell } from "@/components/shell";
import { Empty, PageHeader, SectionHeading, Skeleton, stagger, StatusPill } from "@/components/ui";
import { useResource } from "@/lib/api";
import { useBusiness } from "@/lib/business";
import type { Overview } from "@/lib/types";

const when = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "Not scheduled");

export default function Campaigns() {
  const business = useBusiness();
  const { data } = useResource<Overview>(`/businesses/${business.slug}`);
  const current = data?.campaigns.filter((c) => !c.is_historical) ?? [];
  const past = data?.campaigns.filter((c) => c.is_historical) ?? [];
  return (
    <Shell>
      <PageHeader title="Campaigns" sub="Everything Counterpart is running for you, and what earlier campaigns taught it." />

      <section className="mb-16" aria-labelledby="now-h">
        <SectionHeading id="now-h" title="This season" />
        {!data ? (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            <Skeleton className="h-72" />
            <Skeleton className="h-72" />
          </div>
        ) : current.length ? (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {current.map((c, i) => (
              <CampaignCard key={c.id} c={c} i={i} />
            ))}
          </div>
        ) : (
          <Empty>Start one from Today.</Empty>
        )}
      </section>

      <section aria-labelledby="past-h">
        <SectionHeading id="past-h" title="Past campaigns" sub="Imported history, synthetic demo data. Counterpart learns from these." />
        <div className="grid gap-3 md:grid-cols-2">
          {past.map((c, i) => (
            <Link
              key={c.id}
              href={`/campaigns/${c.id}`}
              className="rise-in lift group flex items-center gap-4 rounded-[var(--radius-lg)] bg-surface p-5 shadow-[var(--shadow-soft)] ring-1 ring-line/80"
              style={stagger(i)}
            >
              <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-sunken text-ink-2">
                <ClockCounterClockwise size={20} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold tracking-tight">{c.name}</p>
                <p className="text-xs text-muted">{when(c.starts_on)}</p>
              </div>
              <dl className="flex gap-5 text-right">
                <div>
                  <dd className="text-[18px] font-semibold leading-none tabular-nums">{c.assets}</dd>
                  <dt className="mt-1 text-[11px] text-muted">Pieces</dt>
                </div>
                <div>
                  <dd className="text-[18px] font-semibold leading-none tabular-nums text-leaf">{c.redemptions}</dd>
                  <dt className="mt-1 text-[11px] text-muted">Redeemed</dt>
                </div>
              </dl>
              <span className="hidden sm:block">
                <StatusPill status={c.status} />
              </span>
              <ArrowUpRight size={16} className="shrink-0 text-muted transition-transform duration-300 group-hover:translate-x-0.5 group-hover:text-ink" aria-hidden />
            </Link>
          ))}
        </div>
      </section>
    </Shell>
  );
}
