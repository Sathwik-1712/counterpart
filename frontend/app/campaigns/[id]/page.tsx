"use client";

import { ArrowLeft, Check } from "@phosphor-icons/react";
import clsx from "clsx";
import Link from "next/link";
import { use, useMemo, useState } from "react";
import { AssetCard } from "@/components/asset-card";
import { Composer } from "@/components/composer";
import { ExperimentPanel } from "@/components/experiment-panel";
import { FactsCard } from "@/components/facts-card";
import { InboxList } from "@/components/inbox";
import { Shell } from "@/components/shell";
import { CHANNEL_LABEL, Empty, SectionHeading, Skeleton, StatusPill } from "@/components/ui";
import { api, useResource } from "@/lib/api";
import type { CampaignDetail, Channel } from "@/lib/types";

const CHANNEL_ORDER: Channel[] = ["instagram_post", "instagram_story", "poster", "whatsapp"];

function Steps({ data }: { data: CampaignDetail }) {
  const locked = data.facts.some((f) => f.status === "locked");
  const posts = data.assets.length > 0;
  const live = data.assets.some((a) => a.status === "live");
  const results = data.assets.some((a) => (a.outcomes?.redeem ?? 0) > 0);
  const steps = [
    { label: "Offer", done: locked },
    { label: "Posts", done: posts && data.assets.some((a) => ["valid", "live", "approved"].includes(a.status)) },
    { label: "Live", done: live },
    { label: "Results", done: results },
  ];
  const current = steps.findIndex((s) => !s.done);
  return (
    <ol className="flex flex-wrap items-center gap-1.5 text-sm" aria-label="Progress">
      {steps.map((s, i) => (
        <li key={s.label} className="flex items-center gap-1.5">
          <span
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1",
              s.done ? "bg-leaf-soft text-leaf-ink" : i === current ? "bg-ink text-white" : "bg-sunken text-muted",
            )}
            aria-current={i === current ? "step" : undefined}
          >
            {s.done && <Check size={13} weight="bold" aria-hidden />}
            {s.label}
          </span>
          {i < steps.length - 1 && <span className="h-px w-4 bg-line-strong" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}

function LoadingCampaign() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-9 w-2/3" />
      <Skeleton className="h-5 w-1/2" />
      <div className="grid gap-5 md:grid-cols-2">
        <Skeleton className="aspect-square" />
        <Skeleton className="aspect-square" />
      </div>
    </div>
  );
}

export default function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
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

  const side = (
    <div className="space-y-6">
      <FactsCard campaignId={id} versions={data.facts} onChange={reload} compact={hasPosts} />
      <div>
        <h2 className="mb-2 text-[15px]">Tell Counterpart</h2>
        <Composer placeholder="“Make it Sunday only, Saturday has a private booking.”" submitLabel="Send" onSubmit={tell} />
        {sent && <p className="mt-2 text-sm text-muted">On it: “{sent}”. Follow along in the work log.</p>}
      </div>
    </div>
  );

  return (
    <Shell campaignId={id}>
      <Link href="/campaigns" className="press mb-5 inline-flex items-center gap-1.5 rounded-full text-sm text-muted hover:text-ink">
        <ArrowLeft size={14} aria-hidden /> Campaigns
      </Link>
      <header className="mb-8 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[30px] md:text-[36px]">{c.name}</h1>
          <StatusPill status={c.status} />
        </div>
        {c.brief && <p className="max-w-[68ch] text-[15px] text-ink-2">“{c.brief}”</p>}
        <Steps data={data} />
      </header>

      {data.inbox.length > 0 && (
        <section className="mb-10">
          <SectionHeading title="Needs you" />
          <InboxList items={data.inbox} onChange={reload} showCampaignLink={false} />
        </section>
      )}

      {!hasPosts ? (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
          <FactsCard campaignId={id} versions={data.facts} onChange={reload} />
          <div>
            <h2 className="mb-2 text-[15px]">Tell Counterpart</h2>
            <Composer placeholder="“Make it Sunday only, Saturday has a private booking.”" submitLabel="Send" onSubmit={tell} />
            {sent && <p className="mt-2 text-sm text-muted">On it: “{sent}”. Follow along in the work log.</p>}
            <div className="mt-6">
              <Empty>{locked ? "Counterpart is writing the posts. They appear here as each one passes its checks." : "Posts are written as soon as you lock the offer."}</Empty>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section aria-labelledby="posts-h">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 id="posts-h" className="text-[19px]">Posts</h2>
                <p className="mt-0.5 text-sm text-muted">
                  {ready > 0 && `${ready} ready to approve`}
                  {ready > 0 && blocked > 0 && " · "}
                  {blocked > 0 && `${blocked} blocked by checks`}
                </p>
              </div>
              {channels.length > 1 && (
                <div className="flex flex-wrap gap-1 rounded-full bg-sunken p-1" role="tablist" aria-label="Channel">
                  {(["all", ...channels] as const).map((ch) => (
                    <button
                      key={ch}
                      role="tab"
                      aria-selected={channel === ch}
                      onClick={() => setChannel(ch)}
                      className={clsx("press rounded-full px-3 py-1 text-[13px]", channel === ch ? "bg-surface text-ink shadow-[var(--shadow-soft)]" : "text-ink-2 hover:text-ink")}
                    >
                      {ch === "all" ? "All" : CHANNEL_LABEL[ch]}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              {assets.map((a) => (
                <AssetCard key={a.id} asset={a} facts={locked?.facts ?? []} business="Kaapi Kone" onChange={reload} />
              ))}
            </div>
            {data.experiments.length > 0 && (
              <section className="mt-12">
                <SectionHeading title="What's working" />
                <div className="space-y-4">
                  {data.experiments.map((e) => (
                    <ExperimentPanel key={e.experiment.id} exp={e} />
                  ))}
                </div>
              </section>
            )}
          </section>
          <aside className="lg:sticky lg:top-24 lg:self-start">{side}</aside>
        </div>
      )}
    </Shell>
  );
}
