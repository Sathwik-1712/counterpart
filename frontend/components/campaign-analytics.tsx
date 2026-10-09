"use client";

import { Lightbulb, PaperPlaneTilt, Sparkle } from "@phosphor-icons/react";
import clsx from "clsx";
import { useState } from "react";
import { api, useResource } from "@/lib/api";
import { useBusiness } from "@/lib/business";
import type { Analytics, Asset, FunnelGroup } from "@/lib/types";
import { CountUp } from "./motion";
import { Button, CHANNEL_LABEL, LANG_LABEL, segmentLabel, Skeleton, stagger } from "./ui";

const pct = (x: number | null | undefined, d = 0) => (x == null ? "–" : `${(x * 100).toFixed(x < 0.1 && x > 0 ? 1 : d)}%`);
const hourLabel = (h: number) => `${h % 12 || 12}${h < 12 ? "a" : "p"}`;

/** Opened → claimed → redeemed, with the share that makes it to each next stage between the boxes. */
function Funnel({ t }: { t: Analytics["totals"] }) {
  const stages = [
    { n: t.posts, label: "Posts live", rate: null as number | null, rateLabel: "" },
    { n: t.scans, label: "Opened the link", rate: null, rateLabel: "" },
    { n: t.claims, label: "Claimed a code", rate: t.claim_rate, rateLabel: "claim" },
    { n: t.redeems, label: "Redeemed in store", rate: t.redeem_rate, rateLabel: "come in" },
  ];
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-lg)] bg-ink ring-1 ring-ink md:grid-cols-5">
      {stages.map((s, i) => (
        <div key={s.label} className={clsx("rise-in relative p-4 md:p-5", i === 3 ? "bg-marker" : "bg-surface")} style={stagger(i)}>
          <p className="text-[14px] font-semibold text-ink-2">{s.label}</p>
          <p className="sign tabular mt-2 text-[44px]">
            <CountUp value={s.n} />
          </p>
          {s.rate !== null && (
            <p className="mt-1 text-[13px] text-ink-2">
              <span className="font-semibold text-ink">{pct(s.rate)}</span> {s.rateLabel === "claim" ? "of visitors claim" : "of claims come in"}
            </p>
          )}
        </div>
      ))}
      <div className="rise-in col-span-2 bg-ink p-4 text-white md:col-span-1 md:p-5" style={stagger(4)}>
        <p className="text-[14px] font-semibold text-white/70">Conversion</p>
        <p className="sign tabular mt-2 text-[44px] text-marker">{pct(t.conversion, 1)}</p>
        <p className="mt-1 text-[13px] text-white/70">of people who opened came in</p>
      </div>
    </div>
  );
}

/** Daily opens (light bars) and redemptions (dark bars), each day labelled with its numbers. */
function Trend({ daily }: { daily: Analytics["daily"] }) {
  const max = Math.max(1, ...daily.map((d) => d.scans));
  const total = daily.reduce((n, d) => n + d.scans, 0);
  const best = [...daily].sort((a, b) => b.redeems - a.redeems)[0];
  const day = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", opts);
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-[16px] font-bold">Day by day</p>
        <p className="flex items-center gap-3 text-[13px] text-ink-2">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[2px] bg-pen-soft ring-1 ring-pen/40" aria-hidden /> opened
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[2px] bg-pen" aria-hidden /> redeemed
          </span>
        </p>
      </div>
      <p className="text-[14px] text-ink-2">
        {total && best?.redeems ? `Best day so far: ${day(best.date, { weekday: "long", day: "numeric", month: "short" })}, ${best.redeems} redeemed.` : "Fills in as people open the links."}
      </p>
      <div className="mt-4 flex h-48 items-end gap-1.5" role="img" aria-label={daily.map((d) => `${d.date}: ${d.scans} opened, ${d.redeems} redeemed`).join("; ")}>
        {daily.map((d, i) => (
          <div key={d.date} className="relative flex h-full min-w-0 flex-1 flex-col justify-end" title={`${day(d.date, { weekday: "short", day: "numeric", month: "short" })}: ${d.scans} opened, ${d.claims} claimed, ${d.redeems} redeemed`}>
            {d.scans > 0 && <span className="mb-1 text-center text-[12px] tabular-nums text-ink-2">{d.scans}</span>}
            <div className="relative w-full origin-bottom rounded-t-[3px] bg-pen-soft ring-1 ring-inset ring-pen/25" style={{ height: `${(d.scans / max) * 82}%`, minHeight: d.scans ? 3 : 0, animation: `grow-y 700ms ${i * 50}ms both` }}>
              <div className="absolute inset-x-0 bottom-0 flex items-start justify-center rounded-t-[2px] bg-pen" style={{ height: d.scans ? `${(d.redeems / d.scans) * 100}%` : 0, minHeight: d.redeems ? 3 : 0 }}>
                {d.redeems > 0 && d.redeems / Math.max(d.scans, 1) * (d.scans / max) > 0.12 && <span className="pt-0.5 text-[12px] font-semibold tabular-nums text-white">{d.redeems}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5 border-t border-ink pt-1.5">
        {daily.map((d) => (
          <span key={d.date} className="min-w-0 flex-1 truncate text-center text-[12px] leading-tight text-muted">
            {day(d.date, { weekday: "short" }).slice(0, 2)}
            <br />
            <span className="tabular-nums">{day(d.date, { day: "numeric" })}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** When people open links, hour by hour: the darker the square, the busier the hour. */
function Hours({ hours }: { hours: Analytics["hours"] }) {
  const max = Math.max(1, ...hours.map((h) => h.scans));
  const peak = [...hours].sort((a, b) => b.scans - a.scans)[0];
  const shown = hours.slice(6, 24);
  return (
    <div>
      <p className="text-[16px] font-bold">Best time to post</p>
      <p className="text-[14px] text-ink-2">{peak.scans ? `Busiest around ${hourLabel(peak.hour)}m. Share about an hour before.` : "Shows once people open links."}</p>
      <div className="mt-3 grid grid-cols-[repeat(18,minmax(0,1fr))] gap-[3px]">
        {shown.map((h) => (
          <div
            key={h.hour}
            className="aspect-square rounded-[2px] ring-1 ring-inset ring-ink/10"
            style={{ background: h.scans ? `color-mix(in srgb, var(--color-pen) ${15 + (h.scans / max) * 85}%, white)` : "var(--color-sunken)" }}
            title={`${hourLabel(h.hour)}m: ${h.scans} opened, ${h.redeems} redeemed`}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[12px] text-muted">
        <span>6 am</span>
        <span>noon</span>
        <span>6 pm</span>
        <span>midnight</span>
      </div>
    </div>
  );
}

const LABEL: Record<string, (k: string) => string> = {
  channel: (k) => CHANNEL_LABEL[k] ?? k,
  language: (k) => LANG_LABEL[k] ?? k,
  segment: (k) => segmentLabel(k),
};

function Breakdown({ title, dim, rows }: { title: string; dim: "channel" | "language" | "segment"; rows: FunnelGroup[] }) {
  const max = Math.max(0.01, ...rows.map((r) => r.conversion ?? 0));
  return (
    <div>
      <p className="mb-2 text-[16px] font-bold">{title}</p>
      <ul className="divide-y divide-line border-y border-line">
        {rows.map((r) => (
          <li key={r.key} className="py-2.5">
            <div className="flex items-baseline justify-between gap-2 text-[14px]">
              <span className="truncate font-semibold">{LABEL[dim](r.key)}</span>
              <span className="shrink-0 tabular-nums text-ink-2">
                {r.redeems}/{r.scans} · <span className="font-semibold text-ink">{pct(r.conversion)}</span>
              </span>
            </div>
            <div className="mt-1.5 h-1.5 rounded-full bg-sunken">
              <div className="grow-x h-full rounded-full bg-pen" style={{ width: `${((r.conversion ?? 0) / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Tips({ tips, campaignId }: { tips: Analytics["tips"]; campaignId: string }) {
  const [sent, setSent] = useState<Record<string, boolean>>({});
  if (!tips.length) return null;
  return (
    <div>
      <p className="flex items-center gap-2 text-[18px] font-bold">
        <Lightbulb size={20} weight="fill" className="text-pen" aria-hidden /> How to do better
      </p>
      <ul className="mt-3 grid gap-3 md:grid-cols-2">
        {tips.map((t, i) => (
          <li key={t.kind + i} className={clsx("rise-in flex flex-col rounded-[var(--radius-md)] p-4 ring-1", t.priority <= 1 ? "bg-marker-soft ring-ink" : "bg-surface ring-line")} style={stagger(i)}>
            <p className="text-[16px] font-bold leading-snug">{t.title}</p>
            <p className="mt-1 flex-1 text-[14px] text-ink-2">{t.detail}</p>
            {t.ask && (
              <div className="mt-3">
                {sent[t.kind] ? (
                  <p className="text-[14px] font-semibold text-pen">Sent to Counterpart. Watch the banner at the top.</p>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    trailing={<PaperPlaneTilt size={13} weight="bold" />}
                    onClick={async () => {
                      await api(`/campaigns/${campaignId}/agent`, { method: "POST", json: { message: t.ask } });
                      setSent({ ...sent, [t.kind]: true });
                    }}
                  >
                    Ask Counterpart to do it
                  </Button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Everything about how this campaign is doing and what to change, in one place. */
export function CampaignAnalytics({ campaignId, assets }: { campaignId: string; assets: Asset[] }) {
  const business = useBusiness();
  const { data, reload } = useResource<Analytics>(`/campaigns/${campaignId}/analytics`, (e) => e.campaign_id === campaignId && (e.type.startsWith("outcome.") || e.type === "assets.published"));
  const [busy, setBusy] = useState(false);
  if (!data) return <Skeleton className="h-72" />;
  const image = Object.fromEntries(assets.map((a) => [a.id, a.image_url]));
  const t = data.totals;

  return (
    <div className="space-y-10">
      {(data.simulated > 0 || business.is_demo) && (
        <div className="flex flex-wrap items-center gap-3 text-[14px]">
          {data.simulated > 0 && (
            <span className="stamp text-turmeric">
              <Sparkle size={12} weight="fill" aria-hidden /> includes {data.simulated} simulated results
            </span>
          )}
          {business.is_demo && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api(`/campaigns/${campaignId}/simulate`, { method: "POST" });
                  await reload();
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Simulating…" : "Simulate a week of customers (demo)"}
            </Button>
          )}
        </div>
      )}

      <Funnel t={t} />
      <Tips tips={data.tips} campaignId={campaignId} />

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Trend daily={data.daily.slice(-14)} />
        <Hours hours={data.hours} />
      </div>

      {t.scans > 0 && (
        <div className="grid gap-8 md:grid-cols-3">
          <Breakdown title="By channel" dim="channel" rows={data.by.channel} />
          <Breakdown title="By language" dim="language" rows={data.by.language} />
          <Breakdown title="By audience" dim="segment" rows={data.by.segment} />
        </div>
      )}

      {data.posts.length > 0 && (
        <div>
          <p className="mb-2 text-[16px] font-bold">Every post, best first</p>
          <div className="overflow-x-auto">
            <table className="w-full border-t border-ink text-[14px]">
              <thead>
                <tr className="border-b border-ink text-left text-[13px] text-muted">
                  <th className="py-2 font-semibold">Post</th>
                  <th className="hidden py-2 text-right font-semibold sm:table-cell">Opened</th>
                  <th className="hidden py-2 text-right font-semibold sm:table-cell">Claimed</th>
                  <th className="hidden py-2 text-right font-semibold sm:table-cell">Redeemed</th>
                  <th className="py-2 text-right font-semibold">Conversion</th>
                </tr>
              </thead>
              <tbody>
                {data.posts.map((p, i) => (
                  <tr key={p.code} className="border-b border-line">
                    <td className="py-2.5 pr-3">
                      <span className="flex min-w-0 items-center gap-3">
                        <span className="w-5 shrink-0 font-mono text-[12px] text-muted">{i + 1}</span>
                        {image[p.asset_id] ? <img src={image[p.asset_id]!} alt="" className="h-10 w-10 shrink-0 rounded-[3px] object-cover" /> : <span className="h-10 w-10 shrink-0 rounded-[3px] bg-sunken" />}
                        <span className="min-w-0">
                          <span className="block font-semibold leading-snug" lang={p.language}>
                            {p.headline || p.code}
                          </span>
                          <span className="block text-[13px] text-muted">
                            {CHANNEL_LABEL[p.channel]} · {LANG_LABEL[p.language]}
                            {p.variant ? ` · version ${p.variant}` : ""}
                          </span>
                          <span className="mt-0.5 block text-[13px] tabular-nums text-ink-2 sm:hidden">
                            {p.scans} opened · {p.claims} claimed · <span className="font-semibold text-ink">{p.redeems} redeemed</span>
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className="hidden py-2.5 text-right tabular-nums sm:table-cell">{p.scans}</td>
                    <td className="hidden py-2.5 text-right tabular-nums sm:table-cell">{p.claims}</td>
                    <td className="hidden py-2.5 text-right font-semibold tabular-nums sm:table-cell">{p.redeems}</td>
                    <td className={clsx("py-2.5 text-right font-semibold tabular-nums", i === 0 && p.redeems > 0 && "text-pen")}>{pct(p.conversion)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

