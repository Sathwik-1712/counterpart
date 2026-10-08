"use client";

import { use, useMemo, useState } from "react";
import { AssetCard } from "@/components/asset-card";
import { Composer } from "@/components/composer";
import { ExperimentPanel } from "@/components/experiment-panel";
import { FactsCard } from "@/components/facts-card";
import { InboxList } from "@/components/inbox";
import { Shell } from "@/components/shell";
import { CHANNEL_LABEL, Empty, SectionHeading, StatusPill } from "@/components/ui";
import { api, useResource } from "@/lib/api";
import type { CampaignDetail, Channel } from "@/lib/types";

const CHANNEL_ORDER: Channel[] = ["whatsapp", "instagram_post", "instagram_story", "poster"];

export default function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, reload } = useResource<CampaignDetail>(`/campaigns/${id}`, (e) => e.campaign_id === id);
  const [channel, setChannel] = useState<Channel | "all">("all");
  const [sent, setSent] = useState<string | null>(null);

  const locked = data?.facts.find((f) => f.status === "locked");
  const assets = useMemo(
    () => (data?.assets ?? []).filter((a) => !["rejected"].includes(a.status) && (channel === "all" || a.channel === channel)),
    [data, channel],
  );
  const channels = CHANNEL_ORDER.filter((c) => data?.assets.some((a) => a.channel === c));
  const counts = (data?.assets ?? []).reduce<Record<string, number>>((m, a) => ({ ...m, [a.status]: (m[a.status] ?? 0) + 1 }), {});

  async function tell(text: string) {
    await api(`/campaigns/${id}/agent`, { method: "POST", json: { message: text } });
    setSent(text);
  }

  if (error) return <Shell campaignId={id}><p className="text-kumkum">{error}</p></Shell>;
  if (!data) return <Shell campaignId={id}><p className="text-muted">Loading…</p></Shell>;
  const c = data.campaign;

  return (
    <Shell campaignId={id}>
      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[26px]">{c.name}</h1>
          <StatusPill status={c.status} />
        </div>
        {c.brief && <p className="mt-2 max-w-[70ch] text-ink-2">“{c.brief}”</p>}
        {c.goal?.statement && (
          <p className="mt-1 text-sm text-muted">
            Goal: {c.goal.statement}
            {c.goal.kpi?.target ? `, ${c.goal.kpi.target} ${c.goal.kpi.metric ?? ""} in ${c.goal.kpi.window_days ?? "?"} days` : ""}
          </p>
        )}
      </header>

      {data.inbox.length > 0 && (
        <section className="mb-8">
          <SectionHeading title="Needs you" />
          <InboxList items={data.inbox} onChange={reload} showCampaignLink={false} />
        </section>
      )}

      <div className="mb-8">
        <FactsCard campaignId={id} versions={data.facts} onChange={reload} />
      </div>

      <section className="mb-8">
        <Composer
          placeholder="Change something, e.g. “Make it Sunday only, Saturday has a private booking.”"
          submitLabel="Tell Counterpart"
          onSubmit={tell}
        />
        {sent && <p className="mt-2 text-sm text-muted">Sent. Counterpart is working on “{sent}”. Follow along in the log.</p>}
      </section>

      <section className="mb-10">
        <SectionHeading
          title="Campaign pieces"
          aside={
            <span className="text-sm text-muted">
              {Object.entries(counts)
                .map(([s, n]) => `${n} ${s === "valid" ? "checked" : s === "invalid" ? "blocked" : s === "stale" ? "need update" : s}`)
                .join(", ")}
            </span>
          }
        />
        {channels.length > 1 && (
          <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Channel">
            {(["all", ...channels] as const).map((ch) => (
              <button
                key={ch}
                role="tab"
                aria-selected={channel === ch}
                onClick={() => setChannel(ch)}
                className={`rounded-md px-3 py-1 text-sm ${channel === ch ? "bg-ink text-white" : "text-ink-2 hover:bg-line/60"}`}
              >
                {ch === "all" ? "All" : CHANNEL_LABEL[ch]}
              </button>
            ))}
          </div>
        )}
        {assets.length === 0 ? (
          <Empty>{locked ? "Counterpart will write the pieces once the plan is set." : "Pieces are written after you lock the offer facts."}</Empty>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {assets.map((a) => (
              <AssetCard key={a.id} asset={a} facts={locked?.facts ?? []} business="Kaapi Kone" onChange={reload} />
            ))}
          </div>
        )}
      </section>

      {data.experiments.length > 0 && (
        <section className="mb-10">
          <SectionHeading title="What's working" />
          <div className="space-y-4">
            {data.experiments.map((e) => (
              <ExperimentPanel key={e.experiment.id} exp={e} />
            ))}
          </div>
        </section>
      )}
    </Shell>
  );
}
