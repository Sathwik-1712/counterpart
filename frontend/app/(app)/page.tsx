"use client";

import { ArrowRight, Check } from "@phosphor-icons/react";
import clsx from "clsx";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CampaignLedger } from "@/components/campaign-card";
import { Composer } from "@/components/composer";
import { FestivalCard } from "@/components/festival-card";
import { FindingsList, InboxList } from "@/components/inbox";
import { InstagramPost } from "@/components/previews";
import { Shell } from "@/components/shell";
import { Empty, SectionHeading, Skeleton, stagger } from "@/components/ui";
import { api, useResource } from "@/lib/api";
import { useBusiness } from "@/lib/business";
import { nextAction, stepOfSummary } from "@/lib/journey";
import type { CampaignDetail, Festival, Overview } from "@/lib/types";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

const DEAL = ["left-[0%] top-[8%] -rotate-[6deg]", "left-[24%] top-[0%] rotate-[1.5deg]", "left-[46%] top-[12%] rotate-[6deg]"];

/** The latest real posts, dealt onto the counter like printed photos. */
function PostStack({ campaignId, name }: { campaignId: string; name: string }) {
  const business = useBusiness();
  const { data } = useResource<CampaignDetail>(`/campaigns/${campaignId}`, (e) => e.campaign_id === campaignId);
  const posts = (data?.assets ?? [])
    .filter((a) => a.channel === "instagram_post" && a.image_url && a.revision?.rendered && a.status !== "rejected")
    .slice(0, 3);
  if (!posts.length) return null;
  return (
    <Link href={`/campaigns/${campaignId}`} className="group relative block h-full min-h-[400px]" aria-label={`Open ${name}`}>
      {posts.map((a, i) => (
        <div
          key={a.id}
          className={`fan-in absolute w-[52%] max-w-[260px] overflow-hidden rounded-[var(--radius-md)] bg-white p-1.5 pb-0 shadow-[var(--shadow-float)] ring-1 ring-ink/10 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:-translate-y-1.5 ${DEAL[i]}`}
          style={stagger(i)}
        >
          <div className="overflow-hidden rounded-[3px]">
            <InstagramPost r={a.revision!.rendered!} image={a.image_url} business={business.name} code={a.touchpoints?.[0]?.code ?? null} />
          </div>
        </div>
      ))}
      <span className="absolute bottom-0 right-0 z-30 inline-flex items-center gap-2 bg-ink px-3.5 py-2 text-[14px] font-semibold text-white">
        Latest: {name}
        <ArrowRight size={14} weight="bold" className="transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
      </span>
    </Link>
  );
}

/** For a new business: three things that make Counterpart useful, ticked off as they happen. */
function GettingStarted({ campaigns, live }: { campaigns: number; live: number }) {
  const business = useBusiness();
  const { data } = useResource<{ photos: { status: string }[] }>(`/businesses/${business.slug}/photos`, (e) => e.type.startsWith("photos."));
  const photos = data?.photos.filter((p) => p.status === "active").length ?? 0;
  const steps = [
    { done: photos > 0, title: "Add photos of your place", text: photos ? `${photos} photo${photos === 1 ? "" : "s"} ready for posts` : "Real photos make posts look like you", href: "/photos" },
    { done: campaigns > 0, title: "Start your first campaign", text: "Write or say the offer in the notepad", href: null },
    { done: live > 0, title: "Approve and share your posts", text: "Each one gets a link and a QR code that counts visits", href: null },
  ];
  return (
    <div className="h-full rounded-[var(--radius-lg)] bg-surface p-6 ring-1 ring-ink md:p-8">
      <p className="text-[22px] font-bold [font-stretch:90%]">Getting started</p>
      <ol className="mt-4 divide-y divide-line border-t border-line">
        {steps.map((st, i) => {
          const inner = (
            <>
              <span className={clsx("inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-mono text-[12px] font-semibold", st.done ? "bg-pen text-white" : "shadow-[inset_0_0_0_1.5px_var(--color-ink)]")}>
                {st.done ? <Check size={14} weight="bold" aria-hidden /> : i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className={clsx("block text-[16px] font-semibold", st.done && "text-muted line-through decoration-pen decoration-2")}>{st.title}</span>
                <span className="block text-[14px] text-muted">{st.text}</span>
              </span>
              {st.href && !st.done && <ArrowRight size={16} weight="bold" className="text-ink transition-transform duration-200 group-hover:translate-x-1" aria-hidden />}
            </>
          );
          return (
            <li key={st.title} className="rise-in" style={stagger(i + 1)}>
              {st.href ? (
                <Link href={st.href} className="group flex items-center gap-4 py-4">
                  {inner}
                </Link>
              ) : (
                <div className="flex items-center gap-4 py-4">{inner}</div>
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
  const { data: culture } = useResource<{ festivals: Festival[] }>(`/businesses/${business.slug}/culture`);
  const festivals = (culture?.festivals ?? []).filter((f) => (f.starts_in_days ?? 99) <= 30);
  const current = data?.campaigns.filter((c) => !c.is_historical) ?? [];
  const showcase = current.find((c) => c.cover_url);
  const owner = (data?.business.profile as { owner?: { name?: string } } | undefined)?.owner?.name;
  const events = (data?.findings ?? []).filter((f) => f.kind === "event_upcoming").map((f) => f.message.split(" starts ")[0].replace(/\s*\(.*\)/, ""));
  const menu = ((data?.business.profile as { menu?: { name: string }[] } | undefined)?.menu ?? []).map((m) => m.name);
  const suggestions = [
    ...festivals.slice(0, 2).map((f) => `${f.angles[0]} (${f.name.split(" (")[0]})`),
    ...events.filter((e) => !festivals.some((f) => e.toLowerCase().includes(f.key))).slice(0, 1).map((e) => `Something for ${e}`),
    ...(menu[0] ? [`A weekday offer on ${menu[0].toLowerCase()}`] : []),
    "Bring regulars back on a slow day",
  ].slice(0, 3);
  const example = menu[0] ? `15% off ${menu[0].toLowerCase()} on weekdays, 4 to 7 pm, for students.` : "15% off on weekdays, 4 to 7 pm, for students.";
  const live = current.reduce((n, c) => n + (c.live ?? 0), 0);
  const redeemed = current.reduce((n, c) => n + c.redemptions, 0);
  const approvals = data?.inbox.filter((i) => i.kind === "approval") ?? [];
  // Campaigns waiting on the owner that have no inbox item of their own (e.g. posts ready to approve).
  const waiting = current.filter((c) => [1, 2].includes(stepOfSummary(c)) && !approvals.some((a) => a.campaign_id === c.id));

  async function newBrief(text: string) {
    const c = await api<{ id: string }>(`/businesses/${business.slug}/campaigns`, { method: "POST", json: { brief: text } });
    router.push(`/campaigns/${c.id}`);
  }

  const pending = (data?.inbox.length ?? 0) + waiting.length;

  return (
    <Shell>
      <header className="rise-in flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
        <div>
          <p className="font-mono text-[12px] font-semibold text-muted">{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</p>
          <h1 className="mt-2 text-[44px] md:text-[64px]">
            {greeting()}
            {owner ? `, ${owner}` : ""}.
          </h1>
        </div>
        {data && current.length > 0 && (
          <dl className="flex gap-8 pb-2">
            <div>
              <dd className="sign tabular text-[44px]">{live}</dd>
              <dt className="text-[13px] text-muted">posts live</dt>
            </div>
            <div>
              <dd className="sign tabular text-[44px] text-pen">{redeemed}</dd>
              <dt className="text-[13px] text-muted">offers redeemed</dt>
            </div>
          </dl>
        )}
      </header>

      {error && <p className="mt-6 text-sm text-kumkum">{error}</p>}

      {data && pending > 0 && (
        <section className="rise-in mt-8 rounded-[var(--radius-lg)] bg-marker px-5 pb-2 pt-5 ring-1 ring-ink md:px-8 md:pt-7" style={stagger(1)} aria-labelledby="needs-h">
          <h2 id="needs-h" className="text-[30px] md:text-[38px]">
            {pending === 1 ? "One thing needs you" : `${pending} things need you`}
          </h2>
          {waiting.length > 0 && (
            <ul className="mt-4 divide-y divide-ink/15 border-t border-ink">
              {waiting.map((c) => (
                <li key={c.id}>
                  <Link href={`/campaigns/${c.id}#${stepOfSummary(c) === 1 ? "offer" : "posts"}`} className="group flex items-center gap-4 py-4">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[19px] font-bold leading-snug [font-stretch:90%]">{nextAction(stepOfSummary(c))}</span>
                      <span className="block text-[14px] text-ink-2">{c.name}</span>
                    </span>
                    <span className="inline-flex h-10 items-center gap-1.5 rounded-[var(--radius-sm)] bg-ink px-4 text-[14px] font-semibold text-white">
                      Open <ArrowRight size={14} weight="bold" className="transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {data.inbox.length > 0 && (
            <div className={waiting.length ? "" : "mt-4"}>
              <InboxList items={data.inbox} onChange={reload} />
            </div>
          )}
        </section>
      )}

      <section className="mt-12 grid grid-cols-1 gap-10 lg:grid-cols-12" aria-labelledby="new-h">
        <div className="rise-in lg:col-span-7" style={stagger(2)}>
          <h2 id="new-h" className="text-[30px] md:text-[38px]">
            What should customers hear next?
          </h2>
          <p className="mt-2 max-w-[52ch] text-[16px] text-ink-2">Write it the way you would tell a regular. Counterpart writes the offer down, checks your margin and makes the posts. Nothing goes out until you approve it.</p>
          <Composer className="mt-6" placeholder={example} submitLabel="Start campaign" onSubmit={newBrief} suggestions={suggestions} rows={4} />
        </div>
        <div className="hidden lg:col-span-5 lg:block">
          {!data ? <Skeleton className="h-[400px]" /> : showcase ? <PostStack campaignId={showcase.id} name={showcase.name} /> : <GettingStarted campaigns={current.length} live={live} />}
        </div>
      </section>

      <section className="mt-16" aria-labelledby="camp-h">
        <SectionHeading
          id="camp-h"
          title="Your campaigns"
          className="border-b-0"
          aside={
            <Link href="/campaigns" className="press inline-flex items-center gap-1.5 pb-1 text-[14px] font-semibold underline decoration-ink/30 underline-offset-4 hover:decoration-ink">
              All campaigns <ArrowRight size={14} weight="bold" aria-hidden />
            </Link>
          }
        />
        {!data ? (
          <Skeleton className="h-48" />
        ) : current.length === 0 ? (
          <Empty>No campaign running yet. Write your first one in the notepad above.</Empty>
        ) : (
          <CampaignLedger campaigns={current.slice(0, 6)} />
        )}
      </section>

      {festivals.length > 0 && (
        <section className="mt-16" aria-labelledby="fest-h">
          <SectionHeading id="fest-h" title="Festivals coming up" className="border-b-0" sub="Greetings checked by hand in your languages, the customs people follow, and ideas that fit your business." />
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {festivals.slice(0, 2).map((f) => (
              <FestivalCard key={f.key} f={f} compact />
            ))}
          </div>
        </section>
      )}

      <section className="mt-16 max-w-[760px]" aria-labelledby="noticed-h">
        <SectionHeading id="noticed-h" title="Counterpart noticed" className="border-b-0" sub="From your calendar, your reviews and your campaigns." />
        {data ? <FindingsList findings={data.findings.filter((f) => !(f.kind === "event_upcoming" && festivals.some((x) => x.key === f.festival)))} /> : <Skeleton className="h-32" />}
      </section>
    </Shell>
  );
}
