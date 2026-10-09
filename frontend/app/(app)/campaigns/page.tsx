"use client";

import { ArrowRight, Megaphone, Plus } from "@phosphor-icons/react";
import clsx from "clsx";
import Link from "next/link";
import { useMemo, useState } from "react";
import { JourneyMini } from "@/components/journey";
import { CountUp } from "@/components/motion";
import { Shell } from "@/components/shell";
import { CHANNEL_LABEL, Empty, PageHeader, Skeleton, stagger } from "@/components/ui";
import { useResource } from "@/lib/api";
import { useBusiness } from "@/lib/business";
import { nextAction, stepOfSummary } from "@/lib/journey";
import type { CampaignSummary, Overview, ResultRow, Results } from "@/lib/types";

type Row = CampaignSummary & {
  step: number;
  opened: number;
  claimed: number;
  redeemed: number;
  conversion: number | null;
  best: ResultRow | null;
};

const FILTERS = [
  { id: "all", label: "All" },
  { id: "you", label: "Needs you" },
  { id: "live", label: "Live" },
  { id: "done", label: "Finished" },
] as const;
const SORTS = [
  { id: "new", label: "Newest" },
  { id: "redeemed", label: "Most redeemed" },
  { id: "conversion", label: "Best conversion" },
] as const;

const pct = (x: number | null) => (x === null ? "–" : `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`);

/** The numbers every campaign is judged on, left to right in the order a customer moves:
 *  posts live (reach) → links opened (interest) → codes claimed (intent) → redeemed at the counter (sales). */
function Totals({ rows }: { rows: Row[] }) {
  const live = rows.reduce((n, r) => n + (r.live ?? 0), 0);
  const opened = rows.reduce((n, r) => n + r.opened, 0);
  const claimed = rows.reduce((n, r) => n + r.claimed, 0);
  const redeemed = rows.reduce((n, r) => n + r.redeemed, 0);
  const cells = [
    { n: live, label: "posts live", note: "reach" },
    { n: opened, label: "links opened", note: "interest" },
    { n: claimed, label: "codes claimed", note: "intent" },
    { n: redeemed, label: "redeemed at the counter", note: "sales", hero: true },
  ];
  return (
    <section aria-label="All campaigns at a glance" className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-lg)] bg-ink ring-1 ring-ink lg:grid-cols-5">
      {cells.map((c, i) => (
        <div key={c.label} className={clsx("rise-in p-5", c.hero ? "bg-marker" : "bg-surface")} style={stagger(i)}>
          <p className="font-mono text-[12px] font-semibold uppercase text-muted">{c.note}</p>
          <p className="sign tabular mt-1 text-[56px]">
            <CountUp value={c.n} />
          </p>
          <p className="mt-1 text-[14px] text-ink-2">{c.label}</p>
        </div>
      ))}
      <div className="rise-in col-span-2 bg-ink p-5 text-white lg:col-span-1" style={stagger(4)}>
        <p className="font-mono text-[12px] font-semibold uppercase text-white/50">conversion</p>
        <p className="sign tabular mt-1 text-[56px] text-marker">{opened ? pct(redeemed / opened) : "–"}</p>
        <p className="mt-1 text-[14px] text-white/70">{opened ? "of people who opened a link came in" : "shows once links are opened"}</p>
      </div>
    </section>
  );
}

function Metric({ n, label, strong }: { n: number | string; label: string; strong?: boolean }) {
  return (
    <span className="block text-right">
      <span className={clsx("sign tabular block text-[26px]", strong && "text-pen")}>{n}</span>
      <span className="block text-[12px] text-muted lg:hidden">{label}</span>
    </span>
  );
}

function CampaignTable({ rows }: { rows: Row[] }) {
  const cols = "lg:grid-cols-[minmax(0,2.2fr)_repeat(5,minmax(64px,0.55fr))_minmax(0,1.1fr)_20px]";
  return (
    <div className="border-t border-ink">
      <div className={clsx("hidden gap-4 border-b border-ink py-2 text-[12px] font-semibold text-muted lg:grid", cols)}>
        <span>Campaign</span>
        <span className="text-right">Live</span>
        <span className="text-right">Opened</span>
        <span className="text-right">Claimed</span>
        <span className="text-right">Redeemed</span>
        <span className="text-right">Conversion</span>
        <span>Working best</span>
        <span />
      </div>
      <ul>
        {rows.map((r, i) => {
          const needsYou = r.step === 1 || r.step === 2;
          return (
            <li key={r.id} className="rise-in" style={stagger(Math.min(i, 10))}>
              <Link href={`/campaigns/${r.id}`} className={clsx("group grid grid-cols-5 items-center gap-x-4 gap-y-3 border-b border-line py-4 transition-colors hover:bg-ink/[0.025]", cols)}>
                <span className="col-span-5 flex min-w-0 items-center gap-4 lg:col-span-1">
                  <span className="relative block h-14 w-14 shrink-0 overflow-hidden rounded-[var(--radius-md)] bg-ink">
                    {r.cover_url ? (
                      <img src={r.cover_url} alt="" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                    ) : (
                      <Megaphone size={20} className="absolute inset-0 m-auto text-white/50" aria-hidden />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[19px] font-bold leading-tight [font-stretch:90%]">{r.name}</span>
                    <JourneyMini step={r.step} className="mt-1.5 max-w-[180px]" />
                    <span className={clsx("mt-1 block truncate text-[13px]", needsYou ? "font-semibold text-ink" : "text-muted")}>
                      {needsYou ? <span className="hl">{nextAction(r.step)}</span> : r.step >= 5 ? "Finished" : nextAction(r.step)}
                    </span>
                  </span>
                </span>
                <Metric n={r.live ?? 0} label="live" />
                <Metric n={r.opened} label="opened" />
                <Metric n={r.claimed} label="claimed" />
                <Metric n={r.redeemed} label="redeemed" strong={r.redeemed > 0} />
                <Metric n={pct(r.conversion)} label="conversion" />
                <span className="col-span-5 min-w-0 text-[13px] text-ink-2 lg:col-span-1">
                  {r.best ? (
                    <>
                      <span className="font-semibold text-ink">{CHANNEL_LABEL[r.best.channel]}</span>
                      {r.best.variant && ` (version ${r.best.variant})`}, {r.best.redeemed} redeemed
                    </>
                  ) : (
                    <span className="text-muted">{r.is_historical ? "Imported totals" : r.live ? "No redemptions yet" : "Not live yet"}</span>
                  )}
                </span>
                <ArrowRight size={16} className="hidden text-muted transition-transform duration-200 group-hover:translate-x-1 group-hover:text-ink lg:block" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function Campaigns() {
  const business = useBusiness();
  const { data } = useResource<Overview>(`/businesses/${business.slug}`);
  const { data: results } = useResource<Results>(`/businesses/${business.slug}/results`, (e) => e.type.startsWith("outcome.") || e.type === "assets.published");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [sort, setSort] = useState<(typeof SORTS)[number]["id"]>("new");

  const rows = useMemo<Row[]>(() => {
    const by = new Map<string, ResultRow[]>();
    for (const p of results?.posts ?? []) by.set(p.campaign_id, [...(by.get(p.campaign_id) ?? []), p]);
    return (data?.campaigns ?? []).map((c) => {
      const posts = by.get(c.id) ?? [];
      const opened = posts.reduce((n, p) => n + p.scans, 0);
      const claimed = posts.reduce((n, p) => n + p.claims, 0);
      // Past campaigns carry imported totals without per-post rows.
      const redeemed = posts.length ? posts.reduce((n, p) => n + p.redeemed, 0) : c.redemptions;
      const best = [...posts].sort((a, b) => b.redeemed - a.redeemed || (b.conversion ?? 0) - (a.conversion ?? 0))[0];
      return { ...c, step: stepOfSummary(c), opened, claimed, redeemed, conversion: opened ? redeemed / opened : null, best: best && best.redeemed > 0 ? best : null };
    });
  }, [data, results]);

  const shown = rows
    .filter((r) => (filter === "you" ? r.step === 1 || r.step === 2 : filter === "live" ? (r.live ?? 0) > 0 && r.step < 5 : filter === "done" ? r.step >= 5 : true))
    .sort((a, b) => (sort === "redeemed" ? b.redeemed - a.redeemed : sort === "conversion" ? (b.conversion ?? -1) - (a.conversion ?? -1) : +new Date(b.created_at) - +new Date(a.created_at)));
  const count = (id: (typeof FILTERS)[number]["id"]) =>
    rows.filter((r) => (id === "you" ? r.step === 1 || r.step === 2 : id === "live" ? (r.live ?? 0) > 0 && r.step < 5 : id === "done" ? r.step >= 5 : true)).length;

  return (
    <Shell>
      <PageHeader
        title="Campaigns"
        sub="Every campaign, measured the same way: who saw it, who opened the link, who claimed a code, who came in."
        aside={
          <Link href="/" className="press inline-flex h-11 items-center gap-2 rounded-[var(--radius-sm)] bg-ink px-4 text-[15px] font-semibold text-white hover:bg-ink-2">
            <Plus size={16} weight="bold" aria-hidden /> New campaign
          </Link>
        }
      />

      {!data ? (
        <Skeleton className="h-40" />
      ) : rows.length === 0 ? (
        <Empty>No campaigns yet. Start one from Today.</Empty>
      ) : (
        <>
          <Totals rows={rows.filter((r) => !r.is_historical)} />

          <div className="mt-12 flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-1" role="tablist" aria-label="Show">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  role="tab"
                  aria-selected={filter === f.id}
                  onClick={() => setFilter(f.id)}
                  className={clsx("press rounded-[var(--radius-sm)] px-3 py-1.5 text-[14px] font-semibold", filter === f.id ? "bg-ink text-white" : "text-ink-2 hover:bg-sunken")}
                >
                  {f.label} <span className={filter === f.id ? "text-white/60" : "text-muted"}>{count(f.id)}</span>
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-[14px] text-muted">
              Sort
              <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="h-9 rounded-[var(--radius-sm)] bg-surface px-2 text-[14px] font-semibold text-ink shadow-[inset_0_0_0_1.5px_var(--color-ink)] outline-none">
                {SORTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-4">{shown.length ? <CampaignTable rows={shown} /> : <Empty>Nothing here.</Empty>}</div>
          {business.is_demo && rows.some((r) => r.is_historical) && <p className="mt-4 text-[13px] text-muted">Finished campaigns are imported history (synthetic demo data). Counterpart learns from them.</p>}
        </>
      )}
    </Shell>
  );
}
