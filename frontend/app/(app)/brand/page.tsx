"use client";

import { Camera, Check, PencilSimple, Prohibit, Sparkle, X } from "@phosphor-icons/react";
import { useState } from "react";
import { Shell } from "@/components/shell";
import { Button, LANG_LABEL, PageHeader, SectionHeading, Skeleton, stagger } from "@/components/ui";
import { api, useResource } from "@/lib/api";
import { useBusiness } from "@/lib/business";
import type { Overview } from "@/lib/types";

/** Brand palettes are written as words ("banana-pen green"); show a swatch for the colour word in each. */
const SWATCH: [RegExp, string][] = [
  [/brown|decoction|coffee/i, "#5b3a22"],
  [/brass|gold/i, "#b48a3c"],
  [/green|leaf/i, "#2f6b3f"],
  [/grey|gray|steel|silver/i, "#8b9298"],
  [/cream|ivory|white/i, "#efe8d8"],
  [/red|kumkum/i, "#a8352a"],
  [/yellow|turmeric/i, "#d8a32a"],
  [/blue/i, "#2f5d8a"],
  [/black|charcoal/i, "#1f2321"],
  [/teal|turquoise/i, "#1f7a7a"],
  [/pink|rose/i, "#d77a92"],
  [/orange|saffron|terracotta/i, "#d0702c"],
  [/purple|violet|lavender/i, "#7a5aa8"],
];
const swatch = (name: string) => SWATCH.find(([re]) => re.test(name))?.[1] ?? "#b9bdb6";

const lines = (t: string) => t.split("\n").map((x) => x.trim()).filter(Boolean);
const commas = (t: string) => t.split(",").map((x) => x.trim()).filter(Boolean);

/** Edit the voice in plain text; saving makes a new version. */
function BrandEditor({ slug, dna, onClose, onSaved }: { slug: string; dna: Record<string, any>; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    voice: (dna.voice ?? []).join(", "),
    do: (dna.do ?? []).join("\n"),
    avoid: (dna.avoid ?? []).join("\n"),
    banned: (dna.banned_words ?? []).join(", "),
    imagery: dna.imagery ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = "mt-1.5 w-full rounded-[var(--radius-md)] bg-surface px-4 py-3 text-[15px] shadow-[inset_0_0_0_1.5px_var(--color-ink)] outline-none focus:shadow-[inset_0_0_0_1.5px_var(--color-ink),0_0_0_3px_var(--color-marker)]";

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`/businesses/${slug}/brand`, {
        method: "PUT",
        json: { dna: { ...dna, voice: commas(f.voice), do: lines(f.do), avoid: lines(f.avoid), banned_words: commas(f.banned).map((w) => w.toLowerCase()), imagery: f.imagery.trim() } },
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-3 backdrop-blur-[2px] md:items-center" onClick={onClose}>
      <div role="dialog" aria-label="Edit brand voice" className="sheet-up flex max-h-[88dvh] w-full max-w-2xl flex-col rounded-[var(--radius-xl)] bg-paper shadow-[var(--shadow-float)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 pb-2 pt-5">
          <p className="text-[19px] font-semibold tracking-tight">Edit the voice</p>
          <button onClick={onClose} className="press rounded-[var(--radius-sm)] p-2 text-ink-2 hover:bg-sunken" aria-label="Close">
            <X size={18} aria-hidden />
          </button>
        </div>
        <div className="space-y-5 overflow-y-auto px-6 pb-4">
          <label className="block">
            <span className="text-sm font-medium">How it sounds</span> <span className="text-xs text-muted">words, separated by commas</span>
            <input className={box} value={f.voice} onChange={(e) => setF({ ...f, voice: e.target.value })} />
          </label>
          <div className="grid gap-5 md:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium">Always</span> <span className="text-xs text-muted">one per line</span>
              <textarea rows={4} className={box} value={f.do} onChange={(e) => setF({ ...f, do: e.target.value })} />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Never</span> <span className="text-xs text-muted">one per line</span>
              <textarea rows={4} className={box} value={f.avoid} onChange={(e) => setF({ ...f, avoid: e.target.value })} />
            </label>
          </div>
          <label className="block">
            <span className="text-sm font-medium">Words the checks block</span> <span className="text-xs text-muted">separated by commas</span>
            <input className={box} value={f.banned} onChange={(e) => setF({ ...f, banned: e.target.value })} />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Pictures should look like</span>
            <textarea rows={2} className={box} value={f.imagery} onChange={(e) => setF({ ...f, imagery: e.target.value })} />
          </label>
          {error && <p className="text-sm text-kumkum">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-6 py-4">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="accent" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save as a new version"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function BrandPage() {
  const business = useBusiness();
  const { data, reload } = useResource<Overview>(`/businesses/${business.slug}`, (e) => e.type.startsWith("memory.") || e.type.startsWith("brand."));
  const [editing, setEditing] = useState(false);
  const dna = data?.brand?.dna ?? {};
  const voice: string[] = dna.voice ?? [];
  const examples: { lang: string; headline: string; body: string }[] = dna.examples ?? [];
  const banned: string[] = dna.banned_words ?? [];

  return (
    <Shell>
      <PageHeader
        title={`How ${business.name} sounds`}
        sub={`Version ${data?.brand?.version ?? "-"}. Counterpart writes every piece with this, and suggests changes when your edits show a pattern.`}
        aside={
          data && (
            <Button onClick={() => setEditing(true)} trailing={<PencilSimple size={13} />}>
              Edit the voice
            </Button>
          )
        }
      />
      {editing && data && <BrandEditor slug={business.slug} dna={dna} onClose={() => setEditing(false)} onSaved={reload} />}

      {!data ? (
        <Skeleton className="h-80" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-12">
          <section className="night rise-in flex flex-col justify-between rounded-[var(--radius-lg)] p-7 md:p-10 lg:col-span-7" aria-label="Voice">
            <p className="text-sm text-marker">The voice</p>
            <p className="mt-3 text-[34px] font-semibold leading-[1.05] tracking-[-0.035em] md:text-[46px]">
              {voice.join(", ").replace(/^\w/, (c) => c.toUpperCase())}.
            </p>
            <dl className="mt-10 grid gap-5 sm:grid-cols-3">
              {Object.entries(dna.signature_phrases ?? {}).map(([lang, phrases]) => (
                <div key={lang} lang={lang}>
                  <dt className="text-xs text-white/50">{LANG_LABEL[lang] ?? lang}</dt>
                  <dd className="mt-1 text-[17px] leading-snug text-white">{(phrases as string[]).join(" / ")}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="rise-in rounded-[var(--radius-lg)] bg-surface p-7 shadow-[var(--shadow-soft)] ring-1 ring-line/80 lg:col-span-5" style={stagger(1)} aria-labelledby="pics-h">
            <div className="flex items-center gap-2">
              <Camera size={18} className="text-pen" aria-hidden />
              <h2 id="pics-h" className="text-[17px] tracking-tight">
                Pictures look like
              </h2>
            </div>
            {dna.imagery && <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{dna.imagery}</p>}
            <div className="mt-6 flex flex-wrap gap-3">
              {(dna.palette ?? []).map((p: string) => (
                <span key={p} className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-sunken py-1 pl-1 pr-3 text-[13px]">
                  <span className="h-6 w-6 rounded-full ring-1 ring-black/10" style={{ background: swatch(p) }} aria-hidden />
                  {p}
                </span>
              ))}
            </div>
            {dna.emoji_policy && <p className="mt-5 text-sm text-muted">Emoji: {dna.emoji_policy}</p>}
          </section>

          <section className="rise-in rounded-[var(--radius-lg)] bg-surface p-7 shadow-[var(--shadow-soft)] ring-1 ring-line/80 lg:col-span-6 lg:self-start" style={stagger(2)} aria-labelledby="do-h">
            <h2 id="do-h" className="text-[17px] tracking-tight">
              Always
            </h2>
            <ul className="mt-4 space-y-3">
              {(dna.do ?? []).map((d: string) => (
                <li key={d} className="flex gap-3 text-[15px]">
                  <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-pen-soft text-pen">
                    <Check size={13} weight="bold" aria-hidden />
                  </span>
                  {d}
                </li>
              ))}
            </ul>
          </section>

          <section className="rise-in rounded-[var(--radius-lg)] bg-surface p-7 shadow-[var(--shadow-soft)] ring-1 ring-line/80 lg:col-span-6 lg:self-start" style={stagger(3)} aria-labelledby="never-h">
            <h2 id="never-h" className="text-[17px] tracking-tight">
              Never
            </h2>
            <ul className="mt-4 space-y-3">
              {(dna.avoid ?? []).map((d: string) => (
                <li key={d} className="flex gap-3 text-[15px]">
                  <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-kumkum-soft text-kumkum">
                    <X size={13} weight="bold" aria-hidden />
                  </span>
                  {d}
                </li>
              ))}
            </ul>
            {banned.length > 0 && (
              <div className="mt-5 border-t border-line pt-4">
                <p className="flex items-center gap-1.5 text-xs text-muted">
                  <Prohibit size={13} aria-hidden /> The checks block these words in every post
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {banned.map((w) => (
                    <span key={w} className="rounded-[var(--radius-sm)] bg-sunken px-2.5 py-0.5 text-[13px] text-ink-2 line-through decoration-kumkum/60">
                      {w}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {examples.length > 0 && (
        <section className="mt-16" aria-labelledby="ex-h">
          <SectionHeading id="ex-h" title="Sounds like this" sub="Counterpart matches these when it writes." />
          <div className="grid gap-4 md:grid-cols-3">
            {examples.map((e, i) => (
              <figure key={i} className="rise-in rounded-[var(--radius-lg)] bg-surface p-6 shadow-[var(--shadow-soft)] ring-1 ring-line/80" style={stagger(i)} lang={e.lang}>
                <figcaption className="text-xs text-muted">{LANG_LABEL[e.lang] ?? e.lang}</figcaption>
                <p className="mt-2 text-[21px] font-semibold leading-tight tracking-tight">{e.headline}</p>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{e.body}</p>
              </figure>
            ))}
          </div>
        </section>
      )}

      <section className="mt-16" aria-labelledby="learn-h">
        <SectionHeading id="learn-h" title="What Counterpart has learned" sub="From past campaigns and your edits. Rules apply to every new post." />
        <div className="grid gap-4 md:grid-cols-2">
          {data?.learnings.map((m, i) => (
            <article key={m.id} className="rise-in flex gap-4 rounded-[var(--radius-lg)] bg-surface p-5 shadow-[var(--shadow-soft)] ring-1 ring-line/80" style={stagger(Math.min(i, 6))}>
              <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-lg)] ${m.kind === "brand_rule" ? "bg-ink text-marker" : "bg-pen-soft text-pen-ink"}`}>
                {m.kind === "brand_rule" ? <Prohibit size={18} aria-hidden /> : <Sparkle size={18} weight="fill" aria-hidden />}
              </span>
              <div className="min-w-0">
                <p className="text-xs text-muted">
                  <span className="font-medium text-ink-2">{m.kind === "brand_rule" ? "Brand rule" : "Learning"}</span>
                  {", "}
                  {m.created_by === "seed" ? "from past campaigns" : m.created_by === "agent" ? "learned by Counterpart" : "from you"}
                  {m.confidence !== null && `, ${Math.round(m.confidence * 100)}% confident`}
                </p>
                <p className="mt-1 text-[15px] leading-snug">{m.content}</p>
                {m.status === "proposed" && <p className="mt-2 text-xs font-medium text-turmeric">Waiting for your OK</p>}
              </div>
            </article>
          ))}
        </div>
      </section>
    </Shell>
  );
}
