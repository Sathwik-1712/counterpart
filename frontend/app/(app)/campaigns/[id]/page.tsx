"use client";

import { ArrowDown, ArrowLeft, Check, ImagesSquare, LinkSimple } from "@phosphor-icons/react";
import clsx from "clsx";
import Link from "next/link";
import { use, useMemo, useState } from "react";
import { AgentStatus } from "@/components/agent-status";
import { AssetCard } from "@/components/asset-card";
import { Composer } from "@/components/composer";
import { ExperimentPanel } from "@/components/experiment-panel";
import { FactsCard } from "@/components/facts-card";
import { InboxList } from "@/components/inbox";
import { JourneyTrack } from "@/components/journey";
import { CampaignAnalytics } from "@/components/campaign-analytics";
import { FestivalCard } from "@/components/festival-card";
import { SharePanel } from "@/components/share-panel";
import { Shell } from "@/components/shell";
import { Button, CHANNEL_LABEL, Empty, SectionHeading, Skeleton, StatusPill } from "@/components/ui";
import { api, useResource } from "@/lib/api";
import { useBusiness } from "@/lib/business";
import { nextAction, STEPS, stepOfDetail } from "@/lib/journey";
import type { CampaignDetail, Channel, ChannelsStatus, Results } from "@/lib/types";

const CHANNEL_ORDER: Channel[] = ["instagram_post", "instagram_story", "poster", "whatsapp"];

function LoadingCampaign() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-14 w-2/3" />
      <Skeleton className="h-5 w-1/2" />
      <Skeleton className="h-20" />
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
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
  const { data: results } = useResource<Results>(`/businesses/${business.slug}/results`, (e) => e.type.startsWith("outcome.") || e.type === "assets.published");
  const { data: channelStatus } = useResource<ChannelsStatus>(`/businesses/${business.slug}/channels`, (e) => e.type.startsWith("channel."));
  const [channel, setChannel] = useState<Channel | "all">("all");
  const [sent, setSent] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);

  const locked = data?.facts.find((f) => f.status === "locked");
  const visible = useMemo(() => (data?.assets ?? []).filter((a) => a.status !== "rejected"), [data]);
  const assets = useMemo(
    () => visible.filter((a) => channel === "all" || a.channel === channel).sort((a, b) => CHANNEL_ORDER.indexOf(a.channel) - CHANNEL_ORDER.indexOf(b.channel)),
    [visible, channel],
  );
  const channels = CHANNEL_ORDER.filter((c) => visible.some((a) => a.channel === c));
  const ready = visible.filter((a) => a.status === "valid");
  const blocked = visible.filter((a) => a.status === "invalid").length;
  const live = visible.filter((a) => a.status === "live");
  const rows = (results?.posts ?? []).filter((r) => r.campaign_id === id);

  async function tell(text: string) {
    await api(`/campaigns/${id}/agent`, { method: "POST", json: { message: text } });
    setSent(text);
  }

  async function setAuto(on: boolean) {
    await api(`/campaigns/${id}/autopublish`, { method: "PUT", json: { on } });
    reload();
  }

  async function approveAll() {
    setApproving(true);
    try {
      await api(`/campaigns/${id}/publish`, { method: "POST", json: { asset_ids: ready.map((a) => a.id) } });
      reload();
    } finally {
      setApproving(false);
    }
  }

  if (error) return <Shell campaignId={id}><p className="text-kumkum">{error}</p></Shell>;
  if (!data) return <Shell campaignId={id}><LoadingCampaign /></Shell>;
  const c = data.campaign;
  const auto = !!locked && c.autopublish_version === locked.version;
  const step = stepOfDetail(data);
  const target = step < 5 ? STEPS[step].key : "results";
  const redeemed = rows.reduce((n, r) => n + r.redeemed, 0);
  const notes: Record<string, string> = {
    brief: "In your words",
    offer: locked ? `Locked, v${locked.version}` : data.facts.length ? "Waiting for you" : "Being written",
    posts: visible.length ? `${ready.length + live.length} of ${visible.length} passed` : "After the offer",
    share: live.length ? `${live.length} live` : "After you approve",
    results: live.length ? `${redeemed} redeemed` : "Counted at the counter",
  };

  const TELL_SUGGESTIONS = ["Write a calmer headline", "Add a Hindi version", "Make it weekends only"];

  return (
    <Shell campaignId={id}>
      <Link href="/campaigns" className="press mb-6 inline-flex items-center gap-1.5 text-[14px] font-semibold text-ink-2 hover:text-ink">
        <ArrowLeft size={14} weight="bold" aria-hidden /> All campaigns
      </Link>

      <header id="brief" className="rise-in">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="text-[36px] md:text-[52px]">{c.name}</h1>
          <StatusPill status={c.status} />
        </div>
        {c.brief && (
          <blockquote className="mt-4 max-w-[70ch] border-l-[3px] border-ink pl-4 text-[16px] leading-relaxed text-ink-2">
            <span className="mb-0.5 block text-[13px] font-semibold text-muted">Your brief</span>
            {c.brief}
          </blockquote>
        )}
      </header>

      <div className="mt-8">
        <JourneyTrack step={step} notes={notes} />
      </div>

      {step < 5 && (
        <a href={`#${target}`} className="rise-in group mt-5 flex items-center gap-3 text-[19px] font-bold md:text-[21px]" style={{ "--i": 3 } as React.CSSProperties}>
          <span className="text-[14px] font-semibold text-muted">Next:</span>
          <span className="hl hl-in">{nextAction(step, data)}</span>
          <ArrowDown size={18} weight="bold" className="transition-transform duration-200 group-hover:translate-y-0.5" aria-hidden />
        </a>
      )}

      <div className="mt-8">
        <AgentStatus campaignId={id} />
      </div>

      {data.inbox.length > 0 && (
        <section className="mb-12 rounded-[var(--radius-lg)] bg-marker px-5 pb-2 pt-5 ring-1 ring-ink md:px-8" aria-label="Needs you">
          <h2 className="text-[28px]">Needs you</h2>
          <div className="mt-3">
            <InboxList items={data.inbox} onChange={reload} showCampaignLink={false} />
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 gap-12 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-16">
          {live.length > 0 && (
            <section id="results" aria-labelledby="results-h">
              <SectionHeading
                id="results-h"
                title="Performance"
                sub="Who opened, who claimed, who came in, and what to change to get more of them."
                aside={
                  <Link href="/results" className="press pb-1 text-[14px] font-semibold underline decoration-ink/30 underline-offset-4 hover:decoration-ink">
                    All results
                  </Link>
                }
              />
              <CampaignAnalytics campaignId={id} assets={data.assets} />
            </section>
          )}

          {(data.culture?.length ?? 0) > 0 && (
            <section aria-labelledby="culture-h">
              <SectionHeading id="culture-h" title="Festival notes" sub="This campaign touches a festival. The writer uses these greetings and customs, so the posts sound local, not generic." />
              <div className="space-y-4">
                {data.culture!.map((f) => (
                  <FestivalCard key={f.key} f={f} onUse={(idea) => tell(`Use this festival angle in the posts: ${idea}`)} />
                ))}
              </div>
            </section>
          )}

          <section id="offer" aria-labelledby="offer-h">
            <SectionHeading id="offer-h" title="The offer" sub="Every post uses exactly this wording, in every language. Check it, then lock it." />
            <div className="grid grid-cols-1 gap-8 md:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
              <FactsCard campaignId={id} versions={data.facts} onChange={reload} />
              <div className="space-y-4 text-[15px] text-ink-2">
                <p>
                  <span className="font-semibold text-ink">Why lock it?</span> The writer never types prices, times or dates itself. It leaves blanks, and the system fills them from this card. So a post can never promise something you did not offer.
                </p>
                <p>
                  <span className="font-semibold text-ink">Want to change something?</span> Tell Counterpart in plain words, for example “make it weekends only”. It writes a new version for you to lock, and every post is checked again.
                </p>
              </div>
            </div>
          </section>

          <section id="posts" aria-labelledby="posts-h">
            <SectionHeading
              id="posts-h"
              title="Posts"
              sub={
                visible.length
                  ? [ready.length > 0 && `${ready.length} ready for your OK`, live.length > 0 && `${live.length} live`, blocked > 0 && `${blocked} blocked by the checks`].filter(Boolean).join(" · ") || "Being checked"
                  : undefined
              }
              aside={
                ready.length > 1 && (
                  <Button variant="primary" onClick={approveAll} disabled={approving} trailing={<Check size={14} weight="bold" />}>
                    {approving ? "Approving…" : `Approve all ${ready.length}`}
                  </Button>
                )
              }
            />
            {locked && (
              <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px]">
                <span className={clsx("inline-flex items-center gap-1.5 font-semibold", auto ? "text-pen" : "text-ink-2")}>
                  <span className={clsx("h-2 w-2 rounded-full", auto ? "bg-pen" : "bg-line-strong")} aria-hidden />
                  {auto ? "Posts that pass every check go live by themselves" : "Each post waits for your OK"}
                </span>
                <button onClick={() => setAuto(!auto)} className="press font-semibold underline decoration-ink/30 underline-offset-4 hover:decoration-ink">
                  {auto ? "Ask me each time" : "Approve them in advance"}
                </button>
              </div>
            )}
            {channels.length > 1 && (
              <div className="no-scrollbar mb-5 flex max-w-full gap-1 overflow-x-auto" role="tablist" aria-label="Channel">
                {(["all", ...channels] as const).map((ch) => (
                  <button
                    key={ch}
                    role="tab"
                    aria-selected={channel === ch}
                    onClick={() => setChannel(ch)}
                    className={clsx("press shrink-0 rounded-[var(--radius-sm)] px-3 py-1.5 text-[14px] font-semibold", channel === ch ? "bg-ink text-white" : "text-ink-2 hover:bg-sunken hover:text-ink")}
                  >
                    {ch === "all" ? `All ${visible.length}` : CHANNEL_LABEL[ch]}
                  </button>
                ))}
              </div>
            )}
            {!visible.length ? (
              <Empty icon={<ImagesSquare size={17} aria-hidden />}>
                {locked ? "Counterpart is writing the posts. Each one appears here once it passes its checks." : "Posts are written as soon as you lock the offer."}
              </Empty>
            ) : (
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                {assets.map((a, i) => (
                  <AssetCard key={a.id} asset={a} i={i} facts={locked?.facts ?? []} business={business.name} onChange={reload} channels={channelStatus} />
                ))}
              </div>
            )}
          </section>

          <section id="share" aria-labelledby="share-h">
            <SectionHeading id="share-h" title="Share" sub="Every approved post has its own link and QR code, so you can see which one brought people in." />
            {live.length ? (
              <SharePanel assets={live} rows={rows} channels={channelStatus} />
            ) : (
              <Empty icon={<LinkSimple size={17} aria-hidden />}>Approve a post and its link, QR code and WhatsApp message appear here, ready to send.</Empty>
            )}
          </section>

          {live.length === 0 && (
            <section id="results" aria-labelledby="results-h">
              <SectionHeading id="results-h" title="Performance" />
              <Empty>Once posts are live, this shows who opened them, who came in, the best time to post and what to change.</Empty>
            </section>
          )}

          {data.experiments.length > 0 && (
            <section aria-labelledby="ab-h">
              <SectionHeading id="ab-h" title="A/B tests" sub="Each version has its own code, so redemptions show which message brought people in." />
              <div className="space-y-4">
                {data.experiments.map((e) => (
                  <ExperimentPanel key={e.experiment.id} exp={e} labels={Object.fromEntries(data.assets.map((a) => [a.id, a.revision?.rendered?.headline ?? ""]))} />
                ))}
              </div>
            </section>
          )}
        </div>

        <aside className="space-y-6 xl:sticky xl:top-24 xl:self-start" aria-label="Talk to Counterpart">
          <div>
            <h2 className="text-[24px]">Tell Counterpart</h2>
            <p className="mb-3 mt-1 text-[14px] text-muted">Ask for changes in plain words. Offer changes come back to you to lock.</p>
            <Composer rows={3} placeholder="Make it Sunday only, Saturday has a private booking." submitLabel="Send" onSubmit={tell} suggestions={TELL_SUGGESTIONS} />
            {sent && <p className="mt-3 text-[14px] text-pen">On it: “{sent}”. The banner at the top shows progress.</p>}
          </div>
        </aside>
      </div>
    </Shell>
  );
}
