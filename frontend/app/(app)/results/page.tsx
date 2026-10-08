"use client";

import { ArrowRight, Check, Copy, CursorClick, DeviceMobile, DownloadSimple, InstagramLogo, Link as LinkIcon, QrCode, Storefront, Trophy, WhatsappLogo } from "@phosphor-icons/react";
import clsx from "clsx";
import Link from "next/link";
import { useState } from "react";
import { CountUp, Reveal } from "@/components/motion";
import { Shell } from "@/components/shell";
import { CHANNEL_LABEL, Empty, LANG_LABEL, PageHeader, SectionHeading, segmentLabel, Skeleton, stagger } from "@/components/ui";
import { useResource } from "@/lib/api";
import { useBusiness } from "@/lib/business";
import type { ResultRow, Results } from "@/lib/types";

const CHANNEL_ICON = { instagram_post: InstagramLogo, instagram_story: DeviceMobile, poster: Storefront, whatsapp: WhatsappLogo } as const;
const pct = (x: number | null) => (x === null ? "-" : `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`);

const HOW = [
  { icon: LinkIcon, title: "A link for every post", text: "Each post gets its own short link and QR code when you approve it." },
  { icon: CursorClick, title: "Customers open and claim", text: "Opening counts as a visit. Tapping “Get my code” counts as a claim." },
  { icon: QrCode, title: "Staff redeem at the counter", text: "Typing the code on the Counter screen counts the sale for that exact post." },
];

function CopyLink({ link }: { link: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard?.writeText(link);
        setDone(true);
        setTimeout(() => setDone(false), 1600);
      }}
      className="press inline-flex items-center gap-1.5 rounded-full bg-sunken px-3 py-1.5 text-xs font-medium text-ink hover:bg-line"
      aria-label={`Copy link ${link}`}
    >
      {done ? <Check size={13} weight="bold" className="text-leaf" aria-hidden /> : <Copy size={13} aria-hidden />}
      {done ? "Copied" : "Copy link"}
    </button>
  );
}

function Funnel({ t }: { t: Results["totals"] }) {
  const max = Math.max(t.scans, t.claims, t.redeemed, 1);
  const rows = [
    { label: "Opened the link", n: t.scans, tone: "bg-forest" },
    { label: "Claimed a code", n: t.claims, tone: "bg-leaf" },
    { label: "Redeemed at the counter", n: t.redeemed, tone: "bg-mint" },
  ];
  return (
    <div className="space-y-4">
      {t.redeemed > t.scans && (
        <p className="text-xs text-muted">Some codes were redeemed from printed posters or shared messages without opening the link, so redemptions can be higher than visits.</p>
      )}
      {rows.map((r, i) => (
        <div key={r.label}>
          <div className="mb-1.5 flex items-baseline justify-between text-sm">
            <span className="text-ink-2">{r.label}</span>
            <span className="text-[17px] font-semibold tabular-nums">
              <CountUp value={r.n} />
            </span>
          </div>
          <div className={clsx("grow-x h-3 rounded-full", r.tone)} style={{ width: `${r.n ? Math.max(3, (r.n / max) * 100) : 1.5}%`, ...stagger(i) }} />
        </div>
      ))}
    </div>
  );
}

function PostRow({ r, best, i }: { r: ResultRow; best: boolean; i: number }) {
  const Icon = CHANNEL_ICON[r.channel];
  return (
    <li className="rise-in flex flex-wrap items-center gap-x-5 gap-y-3 rounded-[var(--radius-lg)] bg-surface p-4 shadow-[var(--shadow-soft)] ring-1 ring-line/80 md:flex-nowrap" style={stagger(Math.min(i, 8))}>
      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sunken text-ink">
        <Icon size={19} aria-hidden />
      </span>
      <div className="min-w-0 flex-1 basis-48">
        <p className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
          {CHANNEL_LABEL[r.channel]} <span className="font-normal text-muted">in {LANG_LABEL[r.language]}</span>
          {best && (
            <span className="inline-flex items-center gap-1 rounded-full bg-leaf-soft px-2 py-0.5 text-[11px] font-medium text-leaf-ink">
              <Trophy size={11} weight="fill" aria-hidden /> Best so far
            </span>
          )}
        </p>
        <p className="truncate text-xs text-muted">
          For {segmentLabel(r.segment).toLowerCase()}
          {r.variant && `, variant ${r.variant}`} <span className="font-receipt text-ink-2">· {r.code}</span>
        </p>
      </div>
      <dl className="flex gap-5 text-right">
        {[
          ["Opened", r.scans],
          ["Claimed", r.claims],
          ["Redeemed", r.redeemed],
        ].map(([l, n]) => (
          <div key={l as string}>
            <dd className="text-[17px] font-semibold leading-none tabular-nums">{n}</dd>
            <dt className="mt-1 text-[11px] text-muted">{l}</dt>
          </div>
        ))}
        <div>
          <dd className={clsx("text-[17px] font-semibold leading-none tabular-nums", r.conversion ? "text-leaf" : "text-muted")}>{pct(r.conversion)}</dd>
          <dt className="mt-1 text-[11px] text-muted">Converted</dt>
        </div>
      </dl>
      <div className="flex gap-1.5">
        <CopyLink link={r.link} />
        <a href={`/api/public/qr/${r.code}.png`} download={`qr-${r.code}.png`} className="press inline-flex items-center gap-1.5 rounded-full bg-sunken px-3 py-1.5 text-xs font-medium text-ink hover:bg-line">
          <DownloadSimple size={13} aria-hidden /> QR
        </a>
      </div>
    </li>
  );
}

export default function ResultsPage() {
  const business = useBusiness();
  const { data } = useResource<Results>(`/businesses/${business.slug}/results`, (e) => e.type.startsWith("outcome.") || e.type === "assets.published");
  const groups = new Map<string, ResultRow[]>();
  for (const r of data?.posts ?? []) groups.set(r.campaign_id, [...(groups.get(r.campaign_id) ?? []), r]);
  const t = data?.totals;

  return (
    <Shell>
      <PageHeader title="Results" sub="Every post has its own link and code, so you can see which message actually brought people in." />

      {!data ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <section className="grid gap-4 lg:grid-cols-12" aria-label="Totals">
            <div className="forest rise-in rounded-[var(--radius-lg)] p-7 lg:col-span-5">
              <p className="text-sm text-mint">Conversion</p>
              <p className="mt-2 text-[64px] font-semibold leading-none tracking-[-0.05em]">
                {t?.conversion === null ? "-" : <CountUp value={(t?.conversion ?? 0) * 100} format={(n) => `${n.toFixed(1)}%`} />}
              </p>
              <p className="mt-3 max-w-[34ch] text-sm text-white/70">Of everyone who opened a post's link, the share who redeemed the offer at your counter.</p>
            </div>
            <div className="rise-in rounded-[var(--radius-lg)] bg-surface p-7 shadow-[var(--shadow-soft)] ring-1 ring-line/80 lg:col-span-7" style={stagger(1)}>
              {t && <Funnel t={t} />}
            </div>
          </section>

          <Reveal as="section" className="mt-14">
            <SectionHeading title="How tracking works" />
            <ol className="grid gap-3 md:grid-cols-3">
              {HOW.map(({ icon: Icon, title, text }, i) => (
                <li key={title} className="relative rounded-[var(--radius-lg)] bg-surface/70 p-5 ring-1 ring-line/80">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-[12px] bg-leaf-soft text-leaf-ink">
                    <Icon size={19} aria-hidden />
                  </span>
                  <p className="mt-3 text-[15px] font-semibold tracking-tight">{title}</p>
                  <p className="mt-1 text-sm text-ink-2">{text}</p>
                  {i < HOW.length - 1 && <ArrowRight size={18} className="absolute -right-3 top-1/2 z-10 hidden -translate-y-1/2 rounded-full bg-paper text-muted md:block" aria-hidden />}
                </li>
              ))}
            </ol>
          </Reveal>

          <section className="mt-14" aria-labelledby="posts-h">
            <SectionHeading id="posts-h" title="By post" sub="Copy a link to share it anywhere, or download its QR code for print." />
            {groups.size === 0 ? (
              <Empty icon={<LinkIcon size={17} aria-hidden />}>Nothing is live yet. When you approve a post, its link and QR code appear here and start counting.</Empty>
            ) : (
              <div className="space-y-10">
                {[...groups.entries()].map(([cid, rows]) => {
                  const best = rows.filter((r) => r.scans >= 5).sort((a, b) => (b.conversion ?? 0) - (a.conversion ?? 0))[0];
                  return (
                    <div key={cid}>
                      <Link href={`/campaigns/${cid}`} className="press mb-3 inline-flex items-center gap-1.5 rounded-full text-[17px] font-semibold tracking-tight hover:text-leaf">
                        {rows[0].campaign} <ArrowRight size={15} aria-hidden />
                      </Link>
                      <ul className="space-y-2.5">
                        {rows.map((r, i) => (
                          <PostRow key={r.code} r={r} i={i} best={!!best && best.code === r.code && (best.conversion ?? 0) > 0} />
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </Shell>
  );
}
