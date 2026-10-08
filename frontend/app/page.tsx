"use client";

import { ArrowRight } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Composer } from "@/components/composer";
import { FindingsList, InboxList } from "@/components/inbox";
import { Shell } from "@/components/shell";
import { Card, SectionHeading, Skeleton, StatusPill } from "@/components/ui";
import { api, BUSINESS, useResource } from "@/lib/api";
import type { Overview } from "@/lib/types";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function Today() {
  const router = useRouter();
  const { data, error, reload } = useResource<Overview>(`/businesses/${BUSINESS}`);
  const current = data?.campaigns.filter((c) => !c.is_historical) ?? [];
  const owner = (data?.business.profile as { owner?: { name?: string } } | undefined)?.owner?.name;

  async function newBrief(text: string) {
    const c = await api<{ id: string }>(`/businesses/${BUSINESS}/campaigns`, { method: "POST", json: { brief: text } });
    router.push(`/campaigns/${c.id}`);
  }

  return (
    <Shell>
      <header className="mb-8 max-w-[760px]">
        <p className="text-sm text-muted">
          {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
        </p>
        <h1 className="mt-2 text-[32px] md:text-[44px]">
          {greeting()}
          {owner ? `, ${owner}` : ""}. What should customers hear next?
        </h1>
      </header>

      <div className="max-w-[760px]">
        <Composer
          placeholder="Say it the way you'd tell a regular: “20% off filter coffee with any snack this weekend, mornings only, dine-in.”"
          submitLabel="Start campaign"
          onSubmit={newBrief}
        />
        <p className="mt-2 text-xs text-muted">Counterpart writes the offer down, checks the margin, and asks you before anything reaches customers.</p>
      </div>

      {error && <p className="mt-6 text-sm text-kumkum">{error}</p>}

      <div className="mt-14 grid gap-12 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section>
          <SectionHeading title="Needs you" aside={data && data.inbox.length > 0 && <span className="text-sm text-muted">{data.inbox.length} waiting</span>} />
          {data ? <InboxList items={data.inbox} onChange={reload} /> : <Skeleton className="h-28" />}
        </section>
        <section>
          <SectionHeading title="Counterpart noticed" />
          {data ? <FindingsList findings={data.findings} /> : <Skeleton className="h-28" />}
        </section>
      </div>

      <section className="mt-14">
        <SectionHeading
          title="Campaigns"
          aside={
            <Link href="/campaigns" className="press inline-flex items-center gap-1 rounded-full text-sm text-leaf hover:text-leaf-ink">
              All campaigns <ArrowRight size={14} aria-hidden />
            </Link>
          }
        />
        {!data ? (
          <Skeleton className="h-24" />
        ) : current.length === 0 ? (
          <p className="text-sm text-muted">No campaign running yet. Tell Counterpart what you want to promote.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {current.slice(0, 6).map((c) => (
              <Link key={c.id} href={`/campaigns/${c.id}`} className="group">
                <Card as="div" className="press h-full p-5 group-hover:shadow-[var(--shadow-lift)]">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-semibold leading-snug">{c.name}</p>
                    <StatusPill status={c.status} />
                  </div>
                  <dl className="mt-6 grid grid-cols-2 gap-3">
                    <div>
                      <dt className="text-xs text-muted">Posts</dt>
                      <dd className="text-[22px] font-semibold tabular-nums tracking-tight">{c.assets}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">Redeemed</dt>
                      <dd className="text-[22px] font-semibold tabular-nums tracking-tight">{c.redemptions}</dd>
                    </div>
                  </dl>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </Shell>
  );
}
