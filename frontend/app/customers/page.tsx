"use client";

import clsx from "clsx";
import { useState } from "react";
import { Shell } from "@/components/shell";
import { Button, LANG_LABEL, SectionHeading, SEGMENT_LABEL, timeAgo } from "@/components/ui";
import { api, BUSINESS, useResource } from "@/lib/api";

interface Theme { theme: string; recent: number; previous: number; sentiment: number | null; quotes: { id: string; text: string }[] }
interface Customers {
  themes: Theme[];
  recent: { id: string; source: string; language: string; segment: string | null; rating: number | null; body: string; occurred_at: string; sentiment: number | null; themes: string[] }[];
  insights: { kind: string; key: string; period_start: string | null; period_end: string | null; data: Record<string, any> }[];
  language_mix: { language: string; n: number; sentiment: number | null }[];
}

const human = (s: string) => s.replace(/_/g, " ");

function Trend({ t }: { t: Theme }) {
  const delta = t.recent - t.previous;
  const negative = (t.sentiment ?? 0) < 0;
  return (
    <span className={clsx("tabular-nums", delta > 0 && negative ? "text-kumkum" : delta > 0 ? "text-leaf-ink" : "text-muted")}>
      {delta > 0 ? `up ${delta}` : delta < 0 ? `down ${-delta}` : "steady"}
    </span>
  );
}

export default function CustomersPage() {
  const { data, reload } = useResource<Customers>(`/businesses/${BUSINESS}/customers`, (e) => e.type.startsWith("customers."));
  const [busy, setBusy] = useState(false);
  const events = data?.insights.filter((i) => i.kind === "event") ?? [];
  const segments = data?.insights.filter((i) => i.kind === "segment") ?? [];

  async function injectDemo() {
    setBusy(true);
    try {
      await api(`/businesses/${BUSINESS}/demo/new-reviews`, { method: "POST" });
      await reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-[26px]">What customers are saying</h1>
        <Button size="sm" onClick={injectDemo} disabled={busy}>
          {busy ? "Adding…" : "Add demo reviews"}
        </Button>
      </div>

      <section className="mb-10">
        <SectionHeading title="Topics, last 14 days vs the 14 before" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="py-2 pr-4 font-medium">Topic</th>
                <th className="py-2 pr-4 text-right font-medium">Now</th>
                <th className="py-2 pr-4 text-right font-medium">Before</th>
                <th className="py-2 pr-4 font-medium">Change</th>
                <th className="py-2 pr-4 font-medium">Mood</th>
                <th className="py-2 font-medium">Latest words</th>
              </tr>
            </thead>
            <tbody>
              {data?.themes.slice(0, 10).map((t) => (
                <tr key={t.theme} className="border-b border-line align-top">
                  <td className="py-2.5 pr-4 font-medium capitalize">{human(t.theme)}</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums">{t.recent}</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums text-muted">{t.previous}</td>
                  <td className="py-2.5 pr-4"><Trend t={t} /></td>
                  <td className="py-2.5 pr-4 text-ink-2">{t.sentiment === null ? "–" : t.sentiment > 0.3 ? "warm" : t.sentiment < 0 ? "unhappy" : "mixed"}</td>
                  <td className="max-w-[320px] py-2.5 text-ink-2">“{t.quotes[0]?.text}”</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="mb-10 grid gap-10 md:grid-cols-2">
        <section>
          <SectionHeading title="Who comes in" />
          <ul className="divide-y divide-line border-y border-line text-sm">
            {segments.map((s) => (
              <li key={s.key} className="py-2.5">
                <div className="flex justify-between gap-3">
                  <span className="font-medium">{s.data.name}</span>
                  <span className="tabular-nums text-muted">{Math.round((s.data.share ?? 0) * 100)}% of visits</span>
                </div>
                <p className="text-ink-2">{s.data.peak}. Cares about {(s.data.motivations ?? []).join(", ")}.</p>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <SectionHeading title="Coming up" />
          <ul className="divide-y divide-line border-y border-line text-sm">
            {events.map((e) => (
              <li key={e.key} className="py-2.5">
                <div className="flex justify-between gap-3">
                  <span className="font-medium">{e.data.name}</span>
                  <span className="text-muted">
                    {e.period_start && new Date(e.period_start).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                  </span>
                </div>
                <p className="text-ink-2">{e.data.hook}</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">
            Messages by language:{" "}
            {data?.language_mix.map((l) => `${LANG_LABEL[l.language] ?? l.language} ${l.n}`).join(", ")}
          </p>
        </section>
      </div>

      <section>
        <SectionHeading title="Latest reviews and messages" aside={<span className="text-xs text-muted">Synthetic demo data</span>} />
        <ul className="divide-y divide-line border-y border-line text-sm">
          {data?.recent.slice(0, 15).map((r) => (
            <li key={r.id} className="py-3">
              <p className="text-ink">{r.body}</p>
              <p className="mt-1 text-xs text-muted">
                {human(r.source)}, {SEGMENT_LABEL[r.segment ?? ""] ?? "customer"}, {timeAgo(r.occurred_at)}
                {r.themes.length ? `, about ${r.themes.map(human).join(", ")}` : ""}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </Shell>
  );
}
