"use client";

import { Shell } from "@/components/shell";
import { LANG_LABEL, Pill, SectionHeading } from "@/components/ui";
import { BUSINESS, useResource } from "@/lib/api";
import type { Overview } from "@/lib/types";

export default function BrandPage() {
  const { data } = useResource<Overview>(`/businesses/${BUSINESS}`, (e) => e.type.startsWith("memory.") || e.type.startsWith("brand."));
  const dna = data?.brand?.dna ?? {};

  return (
    <Shell>
      <h1 className="mb-1 text-[26px]">How Kaapi Kone sounds</h1>
      <p className="mb-8 text-sm text-muted">Version {data?.brand?.version ?? "–"}. Counterpart writes every piece with this, and suggests changes when your edits show a pattern.</p>

      <div className="mb-10 grid gap-8 md:grid-cols-2">
        <section>
          <SectionHeading title="Voice" />
          <p className="text-[17px]">{(dna.voice ?? []).join(", ")}</p>
          <h3 className="mt-6 mb-2 text-sm text-muted">Always</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm">{(dna.do ?? []).map((d: string) => <li key={d}>{d}</li>)}</ul>
          <h3 className="mt-6 mb-2 text-sm text-muted">Never</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm">{(dna.avoid ?? []).map((d: string) => <li key={d}>{d}</li>)}</ul>
        </section>
        <section>
          <SectionHeading title="Sign-off lines" />
          <dl className="space-y-3">
            {Object.entries(dna.signature_phrases ?? {}).map(([lang, phrases]) => (
              <div key={lang}>
                <dt className="text-xs text-muted">{LANG_LABEL[lang] ?? lang}</dt>
                <dd className="text-[16px]">{(phrases as string[]).join(" / ")}</dd>
              </div>
            ))}
          </dl>
          <h3 className="mt-6 mb-2 text-sm text-muted">Picture colours</h3>
          <p className="text-sm">{(dna.palette ?? []).join(", ")}</p>
          <h3 className="mt-6 mb-2 text-sm text-muted">Emoji</h3>
          <p className="text-sm">{dna.emoji_policy}</p>
        </section>
      </div>

      <section>
        <SectionHeading title="What Counterpart has learned" />
        <ul className="divide-y divide-line border-y border-line">
          {data?.learnings.map((m) => (
            <li key={m.id} className="py-3">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <Pill tone={m.kind === "brand_rule" ? "leaf" : "neutral"}>{m.kind === "brand_rule" ? "Brand rule" : "Learning"}</Pill>
                {m.status === "proposed" && <Pill tone="turmeric">Waiting for your OK</Pill>}
                {m.confidence !== null && <span className="text-xs text-muted">{Math.round(m.confidence * 100)}% confident</span>}
                <span className="text-xs text-muted">{m.created_by === "seed" ? "from past campaigns" : m.created_by === "agent" ? "learned by Counterpart" : "from you"}</span>
              </div>
              <p className="text-sm">{m.content}</p>
            </li>
          ))}
        </ul>
      </section>
    </Shell>
  );
}
