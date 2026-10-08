"use client";

import { ArrowLeft, Broadcast, ChartLineUp, Check, ImagesSquare, LockSimple, Quotes } from "@phosphor-icons/react";
import clsx from "clsx";
import Link from "next/link";
import { use, useMemo, useState } from "react";
import { AgentStatus } from "@/components/agent-status";
import { AssetCard } from "@/components/asset-card";
import { Composer } from "@/components/composer";
import { ExperimentPanel } from "@/components/experiment-panel";
import { FactsCard } from "@/components/facts-card";
import { InboxList } from "@/components/inbox";
import { Shell } from "@/components/shell";
import { CHANNEL_LABEL, Empty, SectionHeading, Skeleton, stagger, StatusPill } from "@/components/ui";
import { api, useResource } from "@/lib/api";
import { useBusiness } from "@/lib/business";
import type { CampaignDetail, Channel } from "@/lib/types";

const CHANNEL_ORDER: Channel[] = ["instagram_post", "instagram_story", "poster", "whatsapp"];

function Steps({ data }: { data: CampaignDetail }) {
  const locked = data.facts.find((f) => f.status === "locked");
  const draft = data.facts.find((f) => f.status === "draft");
  const assets = data.assets.filter((a) => a.status !== "rejected");
  const checked = assets.filter((a) => ["valid", "live", "approved"].includes(a.status)).length;
  const live = assets.filter((a) => a.status === "live").length;
  const scans = assets.reduce((n, a) => n + (a.outcomes?.scan ?? 0), 0);
  const redeemed = assets.reduce((n, a) => n + (a.outcomes?.redeem ?? 0), 0);
  const steps = [
    { label: "Offer", icon: LockSimple, done: !!locked, note: locked ? `Locked, version ${locked.version}` : draft ? "Waiting for you to lock" : "Being written down" },
    { label: "Posts", icon: ImagesSquare, done: checked > 0, note: assets.length ? `${checked} of ${assets.length} passed the checks` : locked ? "Being written" : "After the offer is locked" },
    { label: "Live", icon: Broadcast, done: live > 0, note: live ? `${live} live with tracking codes` : checked ? "Waiting for your approval" : "After you approve" },
    { label: "Results", icon: ChartLineUp, done: redeemed > 0, note: live ? `${scans} scans, ${redeemed} redeemed` : "Counted at the counter" },
  ];
  const current = steps.findIndex((s) => !s.done);
  return (
    <ol className="grid grid-cols-2 gap-2 md:grid-cols-4" aria-label="Progress">
      {steps.map((s, i) => {
        const Icon = s.icon;
        const now = i === current;
        return (
          <li
            key={s.label}
            aria-current={now ? "step" : undefined}
            className={clsx(
              "rise-in flex items-start gap-3 rounded-[18px] p-3.5 ring-1",
              s.done ? "bg-surface ring-line/80" : now ? "forest ring-transparent shadow-[var(--shadow-lift)]" : "bg-transparent ring-line",
            )}
            style={stagger(i + 1)}
          >
            <span
              className={clsx(
                "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                s.done ? "bg-leaf text-white" : now ? "bg-white/15 text-mint" : "bg-sunken text-muted",
              )}
            >
              {s.done ? <Check size={16} weight="bold" aria-hidden /> : <Icon size={17} aria-hidden />}
            </span>
            <span className="min-w-0 leading-tight">
              <span className={clsx("block text-[15px] font-semibold", !s.done && !now && "text-muted")}>{s.label}</span>
              <span className={clsx("mt-0.5 block text-xs", now ? "text-white/70" : "text-muted")}>{s.note}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function LoadingCampaign() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-12 w-2/3" />
      <Skeleton className="h-5 w-1/2" />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <Skeleton className="aspect-square" />
        <Skeleton className="aspect-square" />
      </div>
    </div>
  );
}

export default function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const business = useBusiness();
  const { data, error, reload } = useResource<CampaignDetail>(`/campaigns/${id}`, (e) => e.campaign_id === id);
  const [channel, setChannel] = useState<Channel | "all">("all");
  const [sent, setSent] = useState<string | null>(null);

  const locked = data?.facts.find((f) => f.status === "locked");
  const assets = useMemo(
    () =>
      (data?.assets ?? [])
        .filter((a) => a.status !== "rejected" && (channel === "all" || a.channel === channel))
        .sort((a, b) => CHANNEL_ORDER.indexOf(a.channel) - CHANNEL_ORDER.indexOf(b.channel)),
    [data, channel],
  );
  const channels = CHANNEL_ORDER.filter((c) => data?.assets.some((a) => a.channel === c));
  const ready = (data?.assets ?? []).filter((a) => a.status === "valid").length;
  const blocked = (data?.assets ?? []).filter((a) => a.status === "invalid").length;

  async function tell(text: string) {
    await api(`/campaigns/${id}/agent`, { method: "POST", json: { message: text } });
    setSent(text);
  }

  if (error) return <Shell campaignId={id}><p className="text-kumkum">{error}</p></Shell>;
  if (!data) return <Shell campaignId={id}><LoadingCampaign /></Shell>;
  const c = data.campaign;
  const hasPosts = data.assets.length > 0;

  const TELL_SUGGESTIONS = ["Write a calmer headline", "Add a Hindi version", "Make it weekends only"];
  const tellBox = (
    <div className="rounded-[var(--radius-lg)] bg-surface/70 p-5 ring-1 ring-line/80">
      <h2 className="text-[16px] tracking-tight">Tell Counterpart</h2>
      <p className="mb-3 mt-0.5 text-xs text-muted">Changes to the offer come back to you to lock again.</p>
      <Composer rows={2} placeholder="“Make it Sunday only, Saturday has a private booking.”" submitLabel="Send" onSubmit={tell} suggestions={TELL_SUGGESTIONS} className="text-ink" />
      {sent && <p className="mt-3 text-sm text-ink-2">On it: “{sent}”. Follow along in the work log.</p>}
    </div>
  );

  return (
    <Shell campaignId={id}>
      <Link href="/campaigns" className="press mb-6 inline-flex items-center gap-1.5 rounded-full bg-surface px-3.5 py-1.5 text-sm text-ink-2 shadow-[var(--shadow-soft)] ring-1 ring-line/80 hover:text-ink">
        <ArrowLeft size={14} aria-hidden /> Campaigns
      </Link>
      <header className="mb-10 space-y-6">
        <div className="rise-in">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[34px] tracking-[-0.035em] md:text-[48px]">{c.name}</h1>
            <StatusPill status={c.status} />
          </div>
          {c.brief && (
            <p className="mt-4 flex max-w-[72ch] gap-2.5 text-[15px] text-ink-2 md:text-base">
              <Quotes size={20} weight="fill" className="mt-0.5 shrink-0 text-leaf/60" aria-hidden />
              <span>{c.brief}</span>
            </p>
          )}
        </div>
        <Steps data={data} />
      </header>

      <AgentStatus campaignId={id} />

      {data.inbox.length > 0 && (
        <section className="mb-12">
          <SectionHeading title="Needs you" />
          <InboxList items={data.inbox} onChange={reload} showCampaignLink={false} />
        </section>
      )}

      {!hasPosts ? (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-6">
            <Empty icon={<ImagesSquare size={17} aria-hidden />}>
              {locked ? "Counterpart is writing the posts. They appear here as each one passes its checks." : "Posts are written as soon as you lock the offer."}
            </Empty>
            {tellBox}
          </div>
          <FactsCard campaignId={id} versions={data.facts} onChange={reload} />
        </div>
      ) : (
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section aria-labelledby="posts-h">
            <SectionHeading
              id="posts-h"
              title="Posts"
              sub={[ready > 0 && `${ready} ready to approve`, blocked > 0 && `${blocked} blocked by checks`].filter(Boolean).join(", ") || undefined}
              aside={
                channels.length > 1 && (
                  <div className="no-scrollbar flex max-w-full gap-1 overflow-x-auto rounded-full bg-sunken p-1" role="tablist" aria-label="Channel">
                    {(["all", ...channels] as const).map((ch) => (
                      <button
                        key={ch}
                        role="tab"
                        aria-selected={channel === ch}
                        onClick={() => setChannel(ch)}
                        className={clsx("press shrink-0 rounded-full px-3.5 py-1.5 text-[13px]", channel === ch ? "bg-surface font-medium text-ink shadow-[var(--shadow-soft)]" : "text-ink-2 hover:text-ink")}
                      >
                        {ch === "all" ? `All ${data.assets.filter((a) => a.status !== "rejected").length}` : CHANNEL_LABEL[ch]}
                      </button>
                    ))}
                  </div>
                )
              }
            />
            <div className="grid gap-5 md:grid-cols-2">
              {assets.map((a, i) => (
                <AssetCard key={a.id} asset={a} i={i} facts={locked?.facts ?? []} business={business.name} onChange={reload} />
              ))}
            </div>
            {data.experiments.length > 0 && (
              <section className="mt-16">
                <SectionHeading title="What's working" sub="Each variant gets its own code, so redemptions show which message brought people in." />
                <div className="space-y-4">
                  {data.experiments.map((e) => (
                    <ExperimentPanel key={e.experiment.id} exp={e} />
                  ))}
                </div>
              </section>
            )}
          </section>
          <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
            <FactsCard campaignId={id} versions={data.facts} onChange={reload} compact />
            {tellBox}
          </aside>
        </div>
      )}
    </Shell>
  );
}
