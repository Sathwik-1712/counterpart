"use client";

import { ArrowDownRight, ArrowRight, ArrowUpRight, ChatCircleText, ClipboardText, ForkKnife, Globe, GoogleLogo, InstagramLogo, Plus, SealCheck, Star, WhatsappLogo } from "@phosphor-icons/react";
import clsx from "clsx";
import { useState } from "react";
import { GoogleLink, needsReply, ReplyBox, type ReviewRow, VisitSummary, type Visits } from "@/components/review-desk";
import { ReviewImport } from "@/components/review-import";
import { Shell } from "@/components/shell";
import { Button, LANG_LABEL, PageHeader, SectionHeading, SEGMENT_LABEL, Skeleton, stagger, timeAgo } from "@/components/ui";
import { api, useResource } from "@/lib/api";
import { useBusiness } from "@/lib/business";

interface Theme { theme: string; recent: number; previous: number; sentiment: number | null; quotes: { id: string; text: string; language?: string }[] }
interface Customers {
  themes: Theme[];
  recent: (ReviewRow & { segment: string | null; occurred_at: string; sentiment: number | null; themes: string[] })[];
  visits: Visits;
  instagram_comments: Record<string, number>; // count per category ("unread" until the model has read them)
  google_review_url: string | null;
  insights: { kind: string; key: string; period_start: string | null; period_end: string | null; data: Record<string, any> }[];
  language_mix: { language: string; n: number; sentiment: number | null }[];
}

const human = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const mood = (s: number | null) => (s === null ? "No mood yet" : s > 0.3 ? "Warm" : s < 0 ? "Unhappy" : "Mixed");
const SOURCE: Record<string, { icon: typeof GoogleLogo; label: string }> = {
  google_review: { icon: GoogleLogo, label: "Google review" },
  instagram_comment: { icon: InstagramLogo, label: "Instagram comment" },
  whatsapp: { icon: WhatsappLogo, label: "WhatsApp" },
  zomato_review: { icon: ForkKnife, label: "Zomato review" },
  website_review: { icon: Globe, label: "From your website" },
  pasted_review: { icon: ClipboardText, label: "Added by you" },
  visit_review: { icon: SealCheck, label: "Verified visit" },
};
const FILTERS = [
  { key: "all", label: "All" },
  { key: "visits", label: "Verified visits" },
  { key: "instagram", label: "Instagram" },
  { key: "reply", label: "Needs a reply" },
] as const;
// What an Instagram comment is, as read by Counterpart. Yellow = the owner should answer it.
const CATEGORY: Record<string, { label: string; plural: string; tone: string }> = {
  praise: { label: "Praise", plural: "praise", tone: "bg-pen-soft text-pen-ink" },
  complaint: { label: "Complaint", plural: "complaints", tone: "bg-kumkum-soft text-kumkum" },
  question: { label: "Question", plural: "questions", tone: "bg-marker-soft text-ink" },
  suggestion: { label: "Suggestion", plural: "suggestions", tone: "bg-sunken text-ink-2" },
  mention: { label: "Tagged a friend", plural: "tagged a friend", tone: "bg-sunken text-ink-2" },
};

function Trend({ t, light }: { t: Theme; light?: boolean }) {
  const delta = t.recent - t.previous;
  const bad = delta > 0 && (t.sentiment ?? 0) < 0;
  const Icon = delta > 0 ? ArrowUpRight : delta < 0 ? ArrowDownRight : ArrowRight;
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-0.5 text-[13px] font-medium tabular-nums",
        light ? "bg-white/12 text-white" : bad ? "bg-kumkum-soft text-kumkum" : delta > 0 ? "bg-pen-soft text-pen-ink" : "bg-sunken text-ink-2",
      )}
    >
      <Icon size={12} weight="bold" aria-hidden />
      {delta > 0 ? `up ${delta}` : delta < 0 ? `down ${-delta}` : "steady"}
    </span>
  );
}

function Rating({ n }: { n: number }) {
  return (
    <span className="inline-flex gap-0.5 text-pen" aria-label={`${n} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={13} weight={i <= n ? "fill" : "regular"} className={i <= n ? "" : "text-line-strong"} aria-hidden />
      ))}
    </span>
  );
}

export default function CustomersPage() {
  const business = useBusiness();
  const { data, reload } = useResource<Customers>(`/businesses/${business.slug}/customers`, (e) => e.type.startsWith("customers."));
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const shown = (data?.recent ?? []).filter((r) =>
    filter === "visits" ? r.source === "visit_review" : filter === "instagram" ? r.source === "instagram_comment" : filter === "reply" ? needsReply(r) : true,
  );
  const ig = data?.instagram_comments ?? {};
  const igTotal = Object.values(ig).reduce((n, v) => n + v, 0);
  const fixFirst = (data?.themes ?? []).filter((t) => (t.sentiment ?? 0) < -0.1 && t.recent > 0).sort((a, b) => b.recent - a.recent).slice(0, 3);
  const events = data?.insights.filter((i) => i.kind === "event") ?? [];
  const segments = data?.insights.filter((i) => i.kind === "segment") ?? [];
  const [top, ...others] = data?.themes ?? [];
  const featured = others.slice(0, 4);
  const more = others.slice(4).filter((t) => t.recent > 0).slice(0, 10);
  const mentions = (n: number) => `${n} ${n === 1 ? "mention" : "mentions"}`;
  const total = data?.language_mix.reduce((n, l) => n + l.n, 0) ?? 0;

  async function injectDemo() {
    setBusy(true);
    try {
      await api(`/businesses/${business.slug}/demo/new-reviews`, { method: "POST" });
      await reload();
    } finally {
      setBusy(false);
    }
  }

  if (data && total === 0)
    return (
      <Shell>
        <PageHeader title="What customers are saying" />
        <div className="night rise-in rounded-[var(--radius-lg)] p-8 md:p-12">
          <ChatCircleText size={34} className="text-marker" aria-hidden />
          <p className="mt-4 max-w-[24ch] text-[30px] font-semibold leading-tight tracking-[-0.03em]">Your customers' words will show up here.</p>
          <p className="mt-3 max-w-[60ch] text-[15px] text-white/70">
            Counterpart reads reviews and messages in every language they were written in, groups them into topics, and writes campaigns that answer what people actually say.
          </p>
          <div className="mt-8">
            <ReviewImport onDone={reload} dark />
          </div>
        </div>
      </Shell>
    );

  return (
    <Shell>
      <PageHeader
        title="What customers are saying"
        sub={data ? `${total} reviews and messages, read in every language they were written in. Topics compare the last 14 days with the 14 before.` : undefined}
        aside={
          business.is_demo && (
            <Button onClick={injectDemo} disabled={busy} trailing={<Plus size={13} weight="bold" />}>
              {busy ? "Adding…" : "Add demo reviews"}
            </Button>
          )
        }
      />

      {!data ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Skeleton className="h-72 lg:row-span-2" />
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
        </div>
      ) : (
        <section aria-labelledby="topics-h">
          <h2 id="topics-h" className="sr-only">
            Topics
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {top && (
              <article className="night rise-in flex flex-col justify-between rounded-[var(--radius-lg)] p-7 md:col-span-2 lg:col-span-1 lg:row-span-2">
                <div>
                  <p className="text-sm text-marker">Most talked about</p>
                  <p className="mt-2 text-[34px] font-semibold leading-none tracking-[-0.035em]">{human(top.theme)}</p>
                  <div className="mt-4 flex items-center gap-3 text-sm text-white/70">
                    <span className="text-[44px] font-semibold leading-none tracking-tight text-white tabular-nums">{top.recent}</span>
                    <span>
                      {top.recent === 1 ? "mention" : "mentions"}
                      <br />
                      {mood(top.sentiment).toLowerCase()} overall
                    </span>
                    <Trend t={top} light />
                  </div>
                </div>
                {top.quotes[0] && (
                  <blockquote className="mt-10 text-[19px] leading-snug tracking-tight text-white/95" lang={top.quotes[0].language}>
                    “{top.quotes[0].text}”
                  </blockquote>
                )}
              </article>
            )}
            {featured.map((t, i) => (
              <article key={t.theme} className="rise-in flex flex-col rounded-[var(--radius-lg)] bg-surface p-5 shadow-[var(--shadow-soft)] ring-1 ring-line/80" style={stagger(i + 1)}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[17px] font-semibold tracking-tight">{human(t.theme)}</p>
                    <p className={clsx("text-[13px]", (t.sentiment ?? 0) < 0 ? "text-kumkum" : "text-muted")}>
                      {mentions(t.recent)}, {mood(t.sentiment).toLowerCase()}
                    </p>
                  </div>
                  <Trend t={t} />
                </div>
                {t.quotes[0] && (
                  <p className="mt-4 line-clamp-3 text-[14px] leading-relaxed text-ink-2" lang={t.quotes[0].language}>
                    “{t.quotes[0].text}”
                  </p>
                )}
              </article>
            ))}
          </div>
          {more.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="mr-1 text-sm text-muted">Also mentioned</span>
              {more.map((t) => (
                <span key={t.theme} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-surface px-3 py-1 text-[13px] ring-1 ring-line">
                  {human(t.theme)} <span className="tabular-nums text-muted">{t.recent}</span>
                </span>
              ))}
            </div>
          )}
        </section>
      )}

      <div className="mt-16 grid grid-cols-1 gap-12 lg:grid-cols-12">
        <section className="lg:col-span-7" aria-labelledby="who-h">
          <SectionHeading id="who-h" title="Who comes in" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {segments.map((s, i) => (
              <article key={s.key} className="rise-in rounded-[var(--radius-lg)] bg-surface p-5 shadow-[var(--shadow-soft)] ring-1 ring-line/80" style={stagger(i)}>
                <p className="text-[40px] font-semibold leading-none tracking-[-0.04em] tabular-nums">
                  {Math.round((s.data.share ?? 0) * 100)}
                  <span className="text-[20px] text-muted">%</span>
                </p>
                <p className="mt-2 text-[16px] font-semibold tracking-tight">{s.data.name}</p>
                <p className="text-sm text-muted">{s.data.peak}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {(s.data.motivations ?? []).map((m: string) => (
                    <span key={m} className="rounded-[var(--radius-sm)] bg-sunken px-2.5 py-0.5 text-[13px] text-ink-2">
                      {m}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
        <section className="lg:col-span-5" aria-labelledby="upcoming-h">
          <SectionHeading id="upcoming-h" title="Coming up" />
          <ol className="space-y-3">
            {events.map((e, i) => {
              const d = e.period_start ? new Date(e.period_start) : null;
              return (
                <li key={e.key} className="rise-in flex items-center gap-4 rounded-[var(--radius-lg)] bg-surface p-4 shadow-[var(--shadow-soft)] ring-1 ring-line/80" style={stagger(i)}>
                  <span className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-[var(--radius-lg)] bg-ink text-white">
                    <span className="text-[20px] font-semibold leading-none tabular-nums">{d ? d.getDate() : "?"}</span>
                    <span className="mt-0.5 text-[12px] uppercase tracking-wide text-marker">{d ? d.toLocaleDateString("en-IN", { month: "short" }) : ""}</span>
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[15px] font-medium leading-snug">{e.data.name}</span>
                    <span className="block text-sm text-muted">{e.data.hook}</span>
                  </span>
                </li>
              );
            })}
          </ol>
          {data && (
            <div className="mt-6 flex flex-wrap gap-6 rounded-[var(--radius-lg)] bg-surface/60 p-5 ring-1 ring-line/80">
              <p className="w-full text-[13px] text-muted">Messages by language</p>
              {data.language_mix.map((l) => (
                <div key={l.language}>
                  <p className="text-[24px] font-semibold leading-none tracking-tight tabular-nums">{l.n}</p>
                  <p className="mt-1 text-[13px] text-muted">{LANG_LABEL[l.language] ?? { "kn-Latn": "Kannada in English letters", "hi-Latn": "Hindi in English letters", other: "Other languages" }[l.language] ?? l.language}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="mt-16" aria-labelledby="visits-h">
        <SectionHeading id="visits-h" title="Reviews from visits" sub="Asked automatically after a code is redeemed, on the customer's phone or on WhatsApp. Every one is a real visit, so nobody can fake them." />
        {data && <VisitSummary v={data.visits} fixFirst={fixFirst} />}
        <div className="mt-5">{data && <GoogleLink url={data.google_review_url} onSaved={reload} />}</div>
      </section>

      <section className="mt-16" aria-labelledby="reviews-h">
        <SectionHeading id="reviews-h" title="Latest reviews and messages" sub={business.is_demo ? "Synthetic demo data, labelled as such" : "Newest first, in the language they were written in"} />
        <div className="no-scrollbar mb-5 flex gap-1 overflow-x-auto" role="tablist" aria-label="Show">
          {FILTERS.map((f) => (
            <button key={f.key} role="tab" aria-selected={filter === f.key} onClick={() => setFilter(f.key)} className={clsx("press shrink-0 rounded-[var(--radius-sm)] px-3 py-1.5 text-[14px] font-semibold", filter === f.key ? "bg-ink text-white" : "text-ink-2 hover:bg-sunken")}>
              {f.label}
            </button>
          ))}
        </div>
        {igTotal > 0 && (filter === "all" || filter === "instagram") && (
          <p className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-ink-2">
            <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
              <InstagramLogo size={15} aria-hidden /> {igTotal} Instagram comment{igTotal === 1 ? "" : "s"}
            </span>
            {Object.entries(CATEGORY).filter(([k]) => ig[k]).map(([k, c]) => (
              <span key={k} className={clsx("rounded-[var(--radius-sm)] px-2 py-0.5 text-[13px] tabular-nums", c.tone)}>
                {ig[k]} {ig[k] === 1 && k !== "praise" && k !== "mention" ? c.label.toLowerCase() : c.plural}
              </span>
            ))}
            {ig.unread ? <span className="text-[13px] text-muted">{ig.unread} still being read</span> : null}
            {ig.spam ? <span className="text-[13px] text-muted">{ig.spam} spam hidden</span> : null}
          </p>
        )}
        {!shown.length && <p className="text-[15px] text-ink-2">{filter === "reply" ? "Nothing waiting for a reply." : "No reviews here yet."}</p>}
        <div className="columns-1 gap-4 md:columns-2 xl:columns-3">
          {shown.slice(0, 24).map((r, i) => {
            const src = SOURCE[r.source] ?? { icon: ChatCircleText, label: human(r.source) };
            const Icon = src.icon;
            return (
              <article key={r.id} className="rise-in mb-4 break-inside-avoid rounded-[var(--radius-lg)] bg-surface p-5 shadow-[var(--shadow-soft)] ring-1 ring-line/80" style={stagger(Math.min(i, 8))}>
                <div className="mb-3 flex items-center gap-2 text-[13px] text-muted">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-sunken text-ink">
                    <Icon size={14} aria-hidden />
                  </span>
                  <span>{src.label}</span>
                  {r.category && CATEGORY[r.category] && (
                    <span className={clsx("rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[12px] font-semibold", CATEGORY[r.category].tone)}>{CATEGORY[r.category].label}</span>
                  )}
                  <span className="flex-1" />
                  {r.rating ? <Rating n={r.rating} /> : null}
                </div>
                <p className={clsx("leading-relaxed text-ink", r.body.length < 70 ? "text-[17px] tracking-tight" : "text-[15px]")} lang={r.language}>
                  {r.body}
                </p>
                {r.translation && <p className="mt-1.5 text-[14px] italic text-ink-2">“{r.translation}”</p>}
                {!r.body && r.source === "visit_review" && <p className="text-[14px] text-muted">Stars only, no comment.</p>}
                <p className="mt-3 text-[13px] text-muted">
                  {r.source === "visit_review"
                    ? `Came in through “${r.campaign ?? "a campaign"}”${r.via === "whatsapp" ? ", on WhatsApp" : ""}`
                    : r.source === "instagram_comment"
                      ? `@${r.author ?? "someone"}${r.campaign ? ` on a “${r.campaign}” post` : ""}`
                      : (SEGMENT_LABEL[r.segment ?? ""] ?? "Customer")}
                  , {timeAgo(r.occurred_at)}
                  {r.themes.length ? `, about ${r.themes.map((t) => t.replace(/_/g, " ")).join(", ")}` : ""}
                </p>
                {!business.is_demo || r.source === "visit_review" ? <ReplyBox r={r} onSaved={reload} /> : null}
              </article>
            );
          })}
        </div>
      </section>

      <section className="mt-12" aria-label="Add reviews">
        <ReviewImport onDone={reload} />
      </section>
    </Shell>
  );
}
