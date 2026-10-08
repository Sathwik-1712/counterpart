"use client";

import { ArrowRight, ArrowUpRight, Check } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CampaignCard } from "@/components/campaign-card";
import { Composer } from "@/components/composer";
import { FindingsList, InboxList } from "@/components/inbox";
import { InstagramPost } from "@/components/previews";
import { Shell } from "@/components/shell";
import { Empty, SectionHeading, Skeleton, stagger } from "@/components/ui";
import { api, useResource } from "@/lib/api";
import { useBusiness } from "@/lib/business";
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
  const business = useBusiness();
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
          <InstagramPost r={a.revision!.rendered!} image={a.image_url} business={business.name} code={a.touchpoints?.[0]?.code ?? null} />
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

/** For a new business: the three things that make Counterpart useful, ticked off as they happen. */
function GettingStarted({ campaigns, live }: { campaigns: number; live: number }) {
  const business = useBusiness();
  const { data } = useResource<{ photos: { status: string }[] }>(`/businesses/${business.slug}/photos`, (e) => e.type.startsWith("photos."));
  const photos = data?.photos.filter((p) => p.status === "active").length ?? 0;
  const steps = [
    { done: photos > 0, title: "Add photos of your place", text: photos ? `${photos} photo${photos === 1 ? "" : "s"} ready for posts` : "Real photos make posts look like you", href: "/photos" },
    { done: campaigns > 0, title: "Start your first campaign", text: "Type or say the offer on the left", href: null },
    { done: live > 0, title: "Approve your first posts", text: "Each gets a link and a QR code that counts visits", href: "/results" },
  ];
  return (
    <div className="flex h-full flex-col justify-center px-10 py-12">
      <p className="text-sm text-mint">Getting started</p>
      <ol className="mt-5 space-y-3">
        {steps.map((st, i) => {
          const inner = (
            <>
              <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${st.done ? "bg-mint text-forest" : "bg-white/10 text-white/70"}`}>
                {st.done ? <Check size={16} weight="bold" aria-hidden /> : <span className="text-sm font-semibold">{i + 1}</span>}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-[16px] font-semibold tracking-tight ${st.done ? "text-white/60 line-through decoration-white/30" : "text-white"}`}>{st.title}</span>
                <span className="block text-sm text-white/60">{st.text}</span>
              </span>
              {st.href && !st.done && <ArrowUpRight size={16} className="text-white/60 transition-transform duration-300 group-hover:translate-x-0.5" aria-hidden />}
            </>
          );
          return (
            <li key={st.title} className="fan-in" style={stagger(i)}>
              {st.href ? (
                <Link href={st.href} className="group flex items-center gap-4 rounded-[20px] bg-white/[0.06] p-4 ring-1 ring-white/10 transition-colors hover:bg-white/[0.1]">
                  {inner}
                </Link>
              ) : (
                <div className="flex items-center gap-4 rounded-[20px] bg-white/[0.06] p-4 ring-1 ring-white/10">{inner}</div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default function Today() {
  const router = useRouter();
  const business = useBusiness();
  const { data, error, reload } = useResource<Overview>(`/businesses/${business.slug}`);
  const current = data?.campaigns.filter((c) => !c.is_historical) ?? [];
  const showcase = current.find((c) => c.cover_url);
  const owner = (data?.business.profile as { owner?: { name?: string } } | undefined)?.owner?.name;
  const events = (data?.findings ?? []).filter((f) => f.kind === "event_upcoming").map((f) => f.message.split(" starts ")[0].replace(/\s*\(.*\)/, ""));
  const menu = ((data?.business.profile as { menu?: { name: string }[] } | undefined)?.menu ?? []).map((m) => m.name);
  const suggestions = [
    ...events.slice(0, 2).map((e) => `Something for ${e}`),
    ...(menu[0] ? [`A weekday offer on ${menu[0].toLowerCase()}`] : []),
    "Bring regulars back on a slow day",
  ].slice(0, 3);
  const example = menu[0] ? `“15% off ${menu[0].toLowerCase()} on weekdays, 4 to 7 pm, for students.”` : "“15% off on weekdays, 4 to 7 pm, for students.”";

  async function newBrief(text: string) {
    const c = await api<{ id: string }>(`/businesses/${business.slug}/campaigns`, { method: "POST", json: { brief: text } });
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
              placeholder={example}
              submitLabel="Start campaign"
              onSubmit={newBrief}
              suggestions={suggestions}
            />
            <p className="mt-4 text-xs text-white/50">Counterpart writes the offer down, checks the margin, and asks you before anything reaches customers.</p>
          </div>
          <div className="relative hidden lg:block">
            {showcase ? <PostFan campaignId={showcase.id} name={showcase.name} /> : data && <GettingStarted campaigns={current.length} live={current.reduce((n, c) => n + (c.live ?? 0), 0)} />}
          </div>
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
