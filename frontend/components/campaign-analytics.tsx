"use client";

import { ArrowSquareOut, ArrowsClockwise, InstagramLogo, Lightbulb, PaperPlaneTilt, Sparkle, WhatsappLogo } from "@phosphor-icons/react";
import clsx from "clsx";
import { useState } from "react";
import { api, useResource } from "@/lib/api";
import { useBusiness } from "@/lib/business";
import type { Analytics, Asset, FunnelGroup } from "@/lib/types";
import { CountUp } from "./motion";
import { Button, CHANNEL_LABEL, LANG_LABEL, segmentLabel, Skeleton, stagger } from "./ui";

const pct = (x: number | null | undefined, d = 0) => (x == null ? "–" : `${(x * 100).toFixed(x < 0.1 && x > 0 ? 1 : d)}%`);

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
      {t.bills > 0 && (
        <p className="col-span-2 bg-surface px-4 py-3 text-[14px] text-ink-2 md:col-span-5 md:px-5">
          <span className="font-semibold text-ink">₹{t.sales.toLocaleString("en-IN")}</span> in sales from {t.bills} redeemed bill{t.bills === 1 ? "" : "s"}
          {t.average_bill != null && <>, about ₹{t.average_bill.toLocaleString("en-IN")} each</>}. Staff type the bill when they redeem.
        </p>
      )}
    </div>
  );
}

/** A round number at or above n, for chart scales (1, 2, 5, 10, 20, 50 ...). */
function niceMax(n: number) {
  if (n <= 5) return 5;
  const p = 10 ** Math.floor(Math.log10(n));
  return [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * p).find((m) => m >= n)!;
}

/** Opens and redemptions per day, side by side on one labelled scale. A redemption is counted on the day it
 *  happened, which is often a day after the person opened the link. */
function Trend({ daily }: { daily: Analytics["daily"] }) {
  const top = niceMax(Math.max(1, ...daily.map((d) => Math.max(d.scans, d.redeems))));
  const total = daily.reduce((n, d) => n + d.scans + d.redeems, 0);
  const best = [...daily].sort((a, b) => b.redeems - a.redeems)[0];
  const day = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", opts);
  const h = (n: number) => `${(n / top) * 100}%`;
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-[16px] font-bold">Day by day</p>
        <p className="flex items-center gap-3 text-[13px] text-ink-2">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[2px] bg-pen-soft ring-1 ring-inset ring-pen/40" aria-hidden /> opened
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[2px] bg-pen" aria-hidden /> redeemed
          </span>
        </p>
      </div>
      <p className="text-[14px] text-ink-2">
        {total && best?.redeems ? `Most redemptions: ${day(best.date, { weekday: "long", day: "numeric", month: "short" })}, ${best.redeems}.` : "Fills in as people open the links."}
      </p>
      <div className="mt-4 flex gap-2">
        <div className="relative h-48 w-7 shrink-0 text-right text-[11px] tabular-nums text-muted" aria-hidden>
          {[top, top / 2, 0].map((v, i) => (
            <span key={i} className="absolute right-0 -translate-y-1/2" style={{ top: `${(1 - v / top) * 100}%` }}>
              {v}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="relative h-48" role="img" aria-label={daily.map((d) => `${d.date}: ${d.scans} opened, ${d.redeems} redeemed`).join("; ")}>
            {[0, 0.5, 1].map((f) => (
              <span key={f} className={clsx("absolute inset-x-0 border-t", f === 0 ? "border-ink" : "border-dashed border-line")} style={{ bottom: `${f * 100}%` }} aria-hidden />
            ))}
            <div className="absolute inset-0 flex items-end gap-[6%] px-1">
              {daily.map((d, i) => (
                <div key={d.date} className="flex h-full min-w-0 max-w-16 flex-1 items-end justify-center gap-[3px]" title={`${day(d.date, { weekday: "short", day: "numeric", month: "short" })}: ${d.scans} opened, ${d.claims} claimed, ${d.redeems} redeemed`}>
                  {(["scans", "redeems"] as const).map((k) => (
                    <div key={k} className="relative flex h-full w-1/2 flex-col items-center justify-end">
                      {d[k] > 0 && <span className={clsx("mb-0.5 text-[11px] font-semibold tabular-nums", k === "scans" ? "text-ink-2" : "text-pen")}>{d[k]}</span>}
                      <div
                        className={clsx("w-full origin-bottom rounded-t-[2px]", k === "scans" ? "bg-pen-soft ring-1 ring-inset ring-pen/30" : "bg-pen")}
                        style={{ height: h(d[k]), minHeight: d[k] ? 2 : 0, animation: `grow-y 600ms ${i * 40}ms both` }}
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-1.5 flex gap-[6%] px-1">
            {daily.map((d) => (
              <span key={d.date} className="min-w-0 max-w-16 flex-1 truncate text-center text-[12px] leading-tight text-muted">
                {day(d.date, { weekday: "short" }).slice(0, 2)}
                <br />
                <span className="tabular-nums">{day(d.date, { day: "numeric", month: "short" })}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Link opens by hour of day, all 24 hours, busiest hour in the strong colour. */
function Hours({ hours }: { hours: Analytics["hours"] }) {
  const max = Math.max(1, ...hours.map((h) => h.scans));
  const total = hours.reduce((n, h) => n + h.scans, 0);
  const peak = [...hours].sort((a, b) => b.scans - a.scans)[0];
  const at = (h: number) => `${h % 12 || 12} ${h < 12 ? "am" : "pm"}`;
  return (
    <div>
      <p className="text-[16px] font-bold">Best time to post</p>
      <p className="text-[14px] text-ink-2">
        {peak.scans ? `Most opens around ${at(peak.hour)} (${peak.scans} of ${total}). Share about an hour before.` : "Shows once people open links."}
      </p>
      <div className="mt-4 flex h-32 items-end gap-[2px] border-b border-ink" role="img" aria-label={hours.map((h) => `${at(h.hour)}: ${h.scans} opened`).join("; ")}>
        {hours.map((h) => (
          <div
            key={h.hour}
            title={`${at(h.hour)}: ${h.scans} opened, ${h.redeems} redeemed`}
            className={clsx("min-w-0 flex-1 rounded-t-[2px]", h.hour === peak.hour && peak.scans ? "bg-pen" : "bg-pen-soft ring-1 ring-inset ring-pen/30")}
            style={{ height: `${(h.scans / max) * 100}%`, minHeight: h.scans ? 2 : 0 }}
          />
        ))}
      </div>
      <div className="relative mt-1 h-4 text-[11px] text-muted" aria-hidden>
        {[0, 6, 12, 18].map((h) => (
          <span key={h} className="absolute -translate-x-1/2" style={{ left: `${((h + 0.5) / 24) * 100}%` }}>
            {h === 0 ? "12 am" : h === 12 ? "noon" : at(h)}
          </span>
        ))}
      </div>
    </div>
  );
}

const LABEL: Record<string, (k: string) => string> = {
  channel: (k) => CHANNEL_LABEL[k] ?? k,
  language: (k) => LANG_LABEL[k] ?? k,
  segment: (k) => segmentLabel(k),
};

/** Conversion per group, all groups on one scale from 0% (labelled below, so 26% is never drawn as most of a bar
 *  unless the axis says so). The light band is where the real rate likely is (90%), so a
 *  group with few opens shows a wide band instead of looking certain. */
function Breakdown({ title, dim, rows }: { title: string; dim: "channel" | "language" | "segment"; rows: FunnelGroup[] }) {
  const top = Math.min(1, Math.max(0.2, ...rows.map((r) => Math.max(r.conversion ?? 0, r.likely?.[1] ?? 0))));
  const scale = Math.ceil(top * 10) / 10; // nearest 10% above the highest value, so small rates stay readable
  const w = (x: number) => `${Math.min(100, (x / scale) * 100)}%`;
  return (
    <div>
      <p className="mb-2 text-[16px] font-bold">{title}</p>
      <ul className="divide-y divide-line border-y border-line">
        {rows.map((r) => (
          <li key={r.key} className="py-2.5">
            <div className="flex items-baseline justify-between gap-2 text-[14px]">
              <span className="truncate font-semibold">{LABEL[dim](r.key)}</span>
              <span className="shrink-0 tabular-nums text-ink-2">
                {r.redeems} of {r.scans} · <span className="font-semibold text-ink">{pct(r.conversion)}</span>
              </span>
            </div>
            <div className="relative mt-1.5 h-2 rounded-full bg-sunken">
              {r.likely && <div className="absolute inset-y-0 rounded-full bg-pen/25" style={{ left: w(r.likely[0]), width: `calc(${w(r.likely[1])} - ${w(r.likely[0])})` }} />}
              <div className="grow-x absolute inset-y-0 left-0 rounded-full bg-pen" style={{ width: w(r.conversion ?? 0) }} />
            </div>
            {r.likely && (
              <p className="mt-1 text-[12px] text-muted">
                likely {pct(r.likely[0])} to {pct(r.likely[1])}
              </p>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-1.5 flex justify-between text-[11px] tabular-nums text-muted" aria-hidden>
        <span>0%</span>
        <span>{Math.round(scale * 100)}%</span>
      </p>
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
      <ul className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
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

/** Numbers from the channels themselves: Instagram's reach and engagement, WhatsApp's delivery and reads. */
function ChannelNumbers({ data, labels }: { data: Analytics; labels: Record<string, string> }) {
  const business = useBusiness();
  const [syncing, setSyncing] = useState(false);
  const ch = data.channels;
  if (!ch) return null;
  const ig = Object.entries(ch.instagram);
  const wa = Object.entries(ch.whatsapp);
  if (!ig.length && !wa.length) {
    if (!ch.instagram_connected && !ch.whatsapp_connected)
      return (
        <p className="text-[14px] text-ink-2">
          Connect WhatsApp and Instagram on the <a href="/channels" className="font-semibold underline underline-offset-4">Channels</a> page to see reach, engagement, deliveries and reads here.
        </p>
      );
    return <p className="text-[14px] text-ink-2">Post to Instagram or send on WhatsApp from the posts above; their numbers appear here.</p>;
  }
  const n = (x?: number) => (x == null ? "–" : x.toLocaleString("en-IN"));
  return (
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
      {ig.length > 0 && (
        <div>
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-2 text-[16px] font-bold">
              <InstagramLogo size={18} aria-hidden /> Instagram
            </p>
            <Button
              size="sm"
              variant="ghost"
              disabled={syncing}
              onClick={async () => {
                setSyncing(true);
                try {
                  await api(`/businesses/${business.slug}/instagram/sync`, { method: "POST" });
                } finally {
                  setSyncing(false);
                }
              }}
            >
              <ArrowsClockwise size={14} aria-hidden /> {syncing ? "Reading…" : "Refresh"}
            </Button>
          </div>
          <p className="text-[13px] text-muted">Engagement rate = (likes + comments + saves + shares) ÷ people reached. Instagram's numbers can lag up to 48 hours.</p>
          <table className="mt-2 w-full border-t border-ink text-[14px]">
            <thead>
              <tr className="border-b border-ink text-right text-[12px] text-muted">
                <th className="py-1.5 text-left font-semibold">Post</th>
                <th className="py-1.5 font-semibold">Reached</th>
                <th className="hidden py-1.5 font-semibold sm:table-cell">Likes</th>
                <th className="hidden py-1.5 font-semibold sm:table-cell">Saves</th>
                <th className="hidden py-1.5 font-semibold sm:table-cell">Shares</th>
                <th className="py-1.5 font-semibold">Engagement</th>
              </tr>
            </thead>
            <tbody>
              {ig.map(([id, m]) => (
                <tr key={id} className="border-b border-line text-right tabular-nums">
                  <td className="max-w-0 truncate py-2 pr-2 text-left">
                    <a href={m.permalink ?? "#"} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 font-semibold hover:text-pen">
                      <span className="truncate">{labels[id] || "Post"}</span> <ArrowSquareOut size={12} className="shrink-0" aria-hidden />
                    </a>
                  </td>
                  <td className="py-2">{n(m.reach)}</td>
                  <td className="hidden py-2 sm:table-cell">{n(m.likes)}</td>
                  <td className="hidden py-2 sm:table-cell">{n(m.saved)}</td>
                  <td className="hidden py-2 sm:table-cell">{n(m.shares)}</td>
                  <td className="py-2 font-semibold text-pen">{m.metrics_at ? pct(m.engagement_rate, 1) : "waiting"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {wa.length > 0 && (
        <div>
          <p className="flex items-center gap-2 text-[16px] font-bold">
            <WhatsappLogo size={18} aria-hidden /> WhatsApp
          </p>
          <p className="text-[13px] text-muted">From WhatsApp's own receipts. Clicked = opened the link in that message. Claimed and redeemed count codes asked for on WhatsApp.</p>
          <ul className="mt-2 space-y-4">
            {wa.map(([id, w]) => {
              const steps = [
                ["Sent", w.sent],
                ["Delivered", w.delivered],
                ["Read", w.read],
                ["Clicked", w.clicked],
                ["Claimed", w.claimed_on_whatsapp ?? 0],
                ["Redeemed", w.redeemed_from_whatsapp ?? 0],
              ] as const;
              const top = Math.max(1, ...steps.map((x) => x[1]));
              return (
                <li key={id}>
                  <p className="truncate text-[14px] font-semibold">{labels[id] || "Post"}</p>
                  <div className="mt-1.5 grid grid-cols-6 gap-1">
                    {steps.map(([label, v]) => (
                      <div key={label} className="text-center">
                        <div className="flex h-16 items-end rounded-[2px] bg-sunken">
                          <div className="w-full rounded-[2px] bg-pen" style={{ height: `${(v / top) * 100}%`, minHeight: v ? 2 : 0 }} />
                        </div>
                        <p className="mt-1 text-[14px] font-semibold tabular-nums">{v}</p>
                        <p className="text-[11px] text-muted">{label}</p>
                      </div>
                    ))}
                  </div>
                  {w.failed > 0 && <p className="mt-1 text-[12px] text-kumkum">{w.failed} could not be delivered.</p>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
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
              {busy ? "Simulating…" : data.simulated > 0 ? "Simulate again (replaces the simulated results)" : "Simulate customers for this campaign (demo)"}
            </Button>
          )}
        </div>
      )}

      <Funnel t={t} />
      <Tips tips={data.tips} campaignId={campaignId} />

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Trend daily={data.daily.slice(-10)} />
        <Hours hours={data.hours} />
      </div>

      {t.scans > 0 && (
        <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
          <Breakdown title="By channel" dim="channel" rows={data.by.channel} />
          <Breakdown title="By language" dim="language" rows={data.by.language} />
          <Breakdown title="By audience" dim="segment" rows={data.by.segment} />
        </div>
      )}

      <ChannelNumbers data={data} labels={Object.fromEntries(data.posts.map((p) => [p.asset_id, p.headline || p.code]))} />

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
                            {data.ratings?.[p.asset_id] && (
                              <span className="font-semibold text-ink"> · ★ {data.ratings[p.asset_id].average} from {data.ratings[p.asset_id].n} visit{data.ratings[p.asset_id].n === 1 ? "" : "s"}</span>
                            )}
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

