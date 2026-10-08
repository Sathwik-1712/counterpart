"use client";

import { ArrowRight, ArrowUpRight } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CampaignCard } from "@/components/campaign-card";
import { Composer } from "@/components/composer";
import { FindingsList, InboxList } from "@/components/inbox";
import { InstagramPost } from "@/components/previews";
import { Shell } from "@/components/shell";
import { Empty, SectionHeading, Skeleton, stagger } from "@/components/ui";
import { api, BUSINESS, useResource } from "@/lib/api";
import type { CampaignDetail, Overview } from "@/lib/types";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

const FAN = [
  "left-[3%] top-[15%] -rotate-[7deg] z-10",
  "left-[27%] top-[6%] rotate-[2deg] z-20",
  "left-[50%] top-[17%] rotate-[7deg] z-10",
];

/** The latest real posts, fanned like prints on a counter. */
function PostFan({ campaignId, name }: { campaignId: string; name: string }) {
  const { data } = useResource<CampaignDetail>(`/campaigns/${campaignId}`, (e) => e.campaign_id === campaignId);
  const posts = (data?.assets ?? [])
    .filter((a) => a.channel === "instagram_post" && a.image_url && a.revision?.rendered && a.status !== "rejected")
    .slice(0, 3);
  if (!posts.length) return null;
  return (
    <Link href={`/campaigns/${campaignId}`} className="group relative block h-full min-h-[440px]" aria-label={`Open ${name}`}>
      {posts.map((a, i) => (
        <div
          key={a.id}
          className={`fan-in absolute w-[44%] max-w-[270px] overflow-hidden rounded-[18px] bg-white shadow-[var(--shadow-float)] ring-1 ring-black/5 transition-transform duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:-translate-y-2 ${FAN[i]}`}
          style={stagger(i)}
        >
          <InstagramPost r={a.revision!.rendered!} image={a.image_url} business="Kaapi Kone" code={a.touchpoints?.[0]?.code ?? null} />
        </div>
      ))}
      <span className="absolute bottom-6 right-6 z-30 inline-flex items-center gap-2 rounded-full bg-white/95 py-1.5 pl-4 pr-1.5 text-sm font-medium text-ink shadow-[var(--shadow-lift)]">
        Latest: {name}
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-ink text-white transition-transform duration-300 group-hover:translate-x-0.5">
          <ArrowUpRight size={13} weight="bold" aria-hidden />
        </span>
      </span>
    </Link>
  );
}

export default function Today() {
  const router = useRouter();
  const { data, error, reload } = useResource<Overview>(`/businesses/${BUSINESS}`);
  const current = data?.campaigns.filter((c) => !c.is_historical) ?? [];
  const showcase = current.find((c) => c.cover_url);
  const owner = (data?.business.profile as { owner?: { name?: string } } | undefined)?.owner?.name;
  const events = (data?.findings ?? []).filter((f) => f.kind === "event_upcoming").map((f) => f.message.split(" starts ")[0].replace(/\s*\(.*\)/, ""));
  const suggestions = [...events.slice(0, 2).map((e) => `Something for ${e}`), "Bring regulars back on a slow weekday morning"];

  async function newBrief(text: string) {
    const c = await api<{ id: string }>(`/businesses/${BUSINESS}/campaigns`, { method: "POST", json: { brief: text } });
    router.push(`/campaigns/${c.id}`);
  }

  return (
    <Shell>
      <section className="rise-in rounded-[34px] bg-ink/[0.04] p-1.5 ring-1 ring-ink/[0.06]">
        <div className="forest grid overflow-hidden rounded-[28px] lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          <div className="px-6 pb-8 pt-9 md:px-12 md:pb-12 md:pt-14">
            <p className="text-sm text-white/60">{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</p>
            <h1 className="mt-3 text-[38px] tracking-[-0.04em] text-white md:text-[56px]">
              {greeting()}
              {owner ? `, ${owner}` : ""}.
            </h1>
            <p className="mt-3 max-w-[44ch] text-[16px] text-white/70 md:text-[17px]">What should customers hear next? Say it the way you would tell a regular.</p>
            <Composer
              className="mt-8 text-white"
              placeholder="“15% off filter coffee with any snack this weekend, mornings only, dine-in.”"
              submitLabel="Start campaign"
              onSubmit={newBrief}
              suggestions={suggestions}
            />
            <p className="mt-4 text-xs text-white/50">Counterpart writes the offer down, checks the margin, and asks you before anything reaches customers.</p>
          </div>
          <div className="relative hidden lg:block">{showcase && <PostFan campaignId={showcase.id} name={showcase.name} />}</div>
        </div>
      </section>

      {error && <p className="mt-6 text-sm text-kumkum">{error}</p>}

      <div className="mt-16 grid gap-12 lg:grid-cols-12">
        <section className="lg:col-span-7" aria-labelledby="needs-h">
          <SectionHeading id="needs-h" title="Needs you" sub={data && data.inbox.length > 0 ? `${data.inbox.length} waiting for your decision` : undefined} />
          {data ? <InboxList items={data.inbox} onChange={reload} /> : <Skeleton className="h-32" />}
        </section>
        <section className="lg:col-span-5" aria-labelledby="noticed-h">
          <SectionHeading id="noticed-h" title="Counterpart noticed" />
          {data ? <FindingsList findings={data.findings} /> : <Skeleton className="h-32" />}
        </section>
      </div>

      <section className="mt-16" aria-labelledby="camp-h">
        <SectionHeading
          id="camp-h"
          title="Campaigns"
          aside={
            <Link href="/campaigns" className="press inline-flex items-center gap-1.5 rounded-full px-1 text-sm font-medium text-leaf hover:text-leaf-ink">
              All campaigns <ArrowRight size={14} aria-hidden />
            </Link>
          }
        />
        {!data ? (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            <Skeleton className="h-72" />
            <Skeleton className="h-72" />
          </div>
        ) : current.length === 0 ? (
          <Empty>No campaign running yet. Tell Counterpart what you want to promote.</Empty>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {current.slice(0, 6).map((c, i) => (
              <CampaignCard key={c.id} c={c} i={i} />
            ))}
          </div>
        )}
      </section>
    </Shell>
  );
}
