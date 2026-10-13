"use client";

import { Camera, Check, PencilSimple, Prohibit, Sparkle, X } from "@phosphor-icons/react";
import clsx from "clsx";
import { useState } from "react";
import { Shell } from "@/components/shell";
import { Button, LANG_LABEL, PageHeader, SectionHeading, Skeleton, stagger } from "@/components/ui";
import { api, useResource } from "@/lib/api";
import { useBusiness, useWorkspace } from "@/lib/business";
import { resolveColour } from "@/lib/colors";
import { applyTheme, brandTheme, THEMES, themeFor } from "@/lib/theme";
import type { Overview } from "@/lib/types";

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
  const [palette, setPalette] = useState<{ name: string; hex: string }[]>(
    (dna.palette ?? []).map((n: string) => ({ name: n, hex: resolveColour(n, dna.palette_hex) ?? "#999999" })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = "mt-1.5 w-full rounded-[var(--radius-md)] bg-surface px-4 py-3 text-[15px] shadow-[inset_0_0_0_1.5px_var(--color-ink)] outline-none focus:shadow-[inset_0_0_0_1.5px_var(--color-ink),0_0_0_3px_var(--color-marker)]";

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`/businesses/${slug}/brand`, {
        method: "PUT",
        json: {
          dna: {
            ...dna,
            voice: commas(f.voice),
            do: lines(f.do),
            avoid: lines(f.avoid),
            banned_words: commas(f.banned).map((w) => w.toLowerCase()),
            imagery: f.imagery.trim(),
            palette: palette.map((c) => c.name.trim()).filter(Boolean),
            palette_hex: Object.fromEntries(palette.filter((c) => c.name.trim()).map((c) => [c.name.trim(), c.hex])),
          },
        },
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
            <span className="text-sm font-medium">How it sounds</span> <span className="text-[13px] text-muted">words, separated by commas</span>
            <input className={box} value={f.voice} onChange={(e) => setF({ ...f, voice: e.target.value })} />
          </label>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium">Always</span> <span className="text-[13px] text-muted">one per line</span>
              <textarea rows={4} className={box} value={f.do} onChange={(e) => setF({ ...f, do: e.target.value })} />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Never</span> <span className="text-[13px] text-muted">one per line</span>
              <textarea rows={4} className={box} value={f.avoid} onChange={(e) => setF({ ...f, avoid: e.target.value })} />
            </label>
          </div>
          <label className="block">
            <span className="text-sm font-medium">Words the checks block</span> <span className="text-[13px] text-muted">separated by commas</span>
            <input className={box} value={f.banned} onChange={(e) => setF({ ...f, banned: e.target.value })} />
          </label>
          <div>
            <span className="text-sm font-medium">Brand colours</span> <span className="text-[13px] text-muted">name each one, then tap the swatch to pick the exact colour</span>
            <div className="mt-2 space-y-2">
              {palette.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="color"
                    value={c.hex}
                    onChange={(e) => setPalette(palette.map((x, j) => (j === i ? { ...x, hex: e.target.value } : x)))}
                    className="h-11 w-14 shrink-0 cursor-pointer rounded-[var(--radius-sm)] border-0 bg-transparent p-0"
                    aria-label={`Colour for ${c.name || "this colour"}`}
                  />
                  <input
                    value={c.name}
                    onChange={(e) => {
                      const name = e.target.value;
                      setPalette(palette.map((x, j) => (j === i ? { name, hex: resolveColour(name) ?? x.hex } : x)));
                    }}
                    className={box.replace("mt-1.5 ", "")}
                    placeholder="e.g. deep maroon"
                  />
                  <button onClick={() => setPalette(palette.filter((_, j) => j !== i))} className="press rounded-[var(--radius-sm)] p-2 text-ink-2 hover:bg-sunken" aria-label="Remove colour">
                    <X size={16} aria-hidden />
                  </button>
                </div>
              ))}
              {palette.length < 5 && (
                <Button size="sm" variant="ghost" onClick={() => setPalette([...palette, { name: "", hex: "#c8352a" }])}>
                  + Add a colour
                </Button>
              )}
            </div>
          </div>
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

// Shown to the owner so they know the checks, not just the prompt, keep posts from sounding generated.
const MACHINE_WORDS = ["elevate", "indulge", "treat yourself", "unlock", "nestled", "vibrant", "irresistible", "look no further", "long dashes"];

/** Colours for the app and the posts, and the copyright mark on post pictures. Each change saves at once. */
function LookPanel({ slug, dna, onSaved }: { slug: string; dna: Record<string, any>; onSaved: () => void }) {
  const { business, reload } = useWorkspace();
  const [busy, setBusy] = useState<string | null>(null);
  const brandOwn = brandTheme({ palette: dna.palette ?? [], palette_hex: dna.palette_hex ?? {} });
  const auto = themeFor({ ...business, palette: dna.palette ?? [], palette_hex: dna.palette_hex ?? {}, theme: null });
  const current = dna.theme ?? null;
  const watermark = dna.watermark !== false;

  async function save(patch: Record<string, unknown>, key: string) {
    setBusy(key);
    try {
      await api(`/businesses/${slug}/brand`, { method: "PUT", json: { dna: { ...dna, ...patch } } });
      await reload();
      onSaved();
    } finally {
      setBusy(null);
    }
  }

  const option = (id: string | null, name: string, t = id === "brand" ? brandOwn! : id ? THEMES.find((x) => x.id === id)! : auto) => {
    const on = current === id;
    return (
      <button
        key={id ?? "auto"}
        onClick={() => {
          applyTheme(t);
          save({ theme: id }, id ?? "auto");
        }}
        disabled={busy !== null}
        aria-pressed={on}
        className={clsx("press flex w-full min-w-0 flex-col items-stretch gap-2 rounded-[var(--radius-md)] p-3 text-left", on ? "bg-surface ring-2 ring-ink" : "ring-1 ring-line hover:ring-ink/40")}
      >
        <span className="grid h-8 w-full grid-cols-4 overflow-hidden rounded-[3px] ring-1 ring-ink/10" aria-hidden>
          {[t.paper, t.marker, t.pen, t.brand].map((c, i) => (
            <span key={i} className="block h-full w-full" style={{ backgroundColor: c }} />
          ))}
        </span>
        <span className="truncate text-[14px] font-semibold">{busy === (id ?? "auto") ? "Saving…" : name}</span>
      </button>
    );
  };

  return (
    <section className="rise-in mb-12" aria-labelledby="look-h">
      <SectionHeading id="look-h" title="Look" sub="The app and your posts take these colours. Auto uses your brand colours when it can read them, otherwise the closest theme for your kind of business." />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {option(null, `Auto: ${auto.name}`)}
        {brandOwn && option("brand", "Your brand colours")}
        {THEMES.map((t) => option(t.id, t.name))}
      </div>
      <label className="mt-6 flex max-w-[680px] cursor-pointer items-start gap-4 rounded-[var(--radius-md)] p-4 ring-1 ring-line">
        <input
          type="checkbox"
          checked={watermark}
          disabled={busy !== null}
          onChange={(e) => save({ watermark: e.target.checked }, "watermark")}
          className="mt-1 h-5 w-5 shrink-0 accent-[var(--color-ink)]"
        />
        <span>
          <span className="block text-[16px] font-semibold">Copyright mark on post pictures</span>
          <span className="block text-[14px] text-ink-2">
            A faint “© {business.name}” repeated across each photo, plus a small one in the corner. It stays on downloads, so others cannot easily reuse your pictures.
          </span>
        </span>
      </label>
    </section>
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
      {data && <LookPanel slug={business.slug} dna={dna} onSaved={reload} />}

      {!data ? (
        <Skeleton className="h-80" />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <section className="night rise-in flex flex-col justify-between rounded-[var(--radius-lg)] p-7 md:p-10 lg:col-span-7" aria-label="Voice">
            <p className="text-sm text-marker">The voice</p>
            <p className="mt-3 text-[34px] font-semibold leading-[1.05] tracking-[-0.035em] md:text-[46px]">
              {voice.join(", ").replace(/^\w/, (c) => c.toUpperCase())}.
            </p>
            <dl className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-3">
              {Object.entries(dna.signature_phrases ?? {}).map(([lang, phrases]) => (
                <div key={lang} lang={lang}>
                  <dt className="text-[13px] text-white/50">{LANG_LABEL[lang] ?? lang}</dt>
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
              {(dna.palette ?? []).map((p: string) => {
                const hex = resolveColour(p, dna.palette_hex);
                return (
                  <span key={p} className="inline-flex items-center gap-2.5 rounded-[var(--radius-sm)] py-1 pl-1 pr-3 text-[14px] ring-1 ring-line">
                    <span
                      className="block h-9 w-9 shrink-0 rounded-[3px] ring-1 ring-black/10"
                      style={{ background: hex ?? "repeating-linear-gradient(45deg,#ddd 0 4px,#fff 4px 8px)" }}
                      aria-hidden
                    />
                    <span className="leading-tight">
                      <span className="block font-semibold">{p}</span>
                      <span className="block font-mono text-[12px] uppercase text-muted">{hex ?? "pick a colour"}</span>
                    </span>
                  </span>
                );
              })}
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
            <div className="mt-5 border-t border-line pt-4">
              <p className="text-[14px] text-ink-2">
                <span className="font-semibold text-ink">Never sounds like a robot.</span> Every post is checked for phrases that give away generated copy, such as{" "}
                {MACHINE_WORDS.map((w, i) => (
                  <span key={w}>
                    <span className="line-through decoration-kumkum/60">{w}</span>
                    {i < MACHINE_WORDS.length - 1 ? ", " : "."}
                  </span>
                ))}{" "}
                The writer has to say it plainly instead.
              </p>
              {dna.voice_note && <p className="mt-1 text-[13px] text-muted">{dna.voice_note}</p>}
            </div>
            {banned.length > 0 && (
              <div className="mt-5 border-t border-line pt-4">
                <p className="flex items-center gap-1.5 text-[13px] text-muted">
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
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {examples.map((e, i) => (
              <figure key={i} className="rise-in rounded-[var(--radius-lg)] bg-surface p-6 shadow-[var(--shadow-soft)] ring-1 ring-line/80" style={stagger(i)} lang={e.lang}>
                <figcaption className="text-[13px] text-muted">{LANG_LABEL[e.lang] ?? e.lang}</figcaption>
                <p className="mt-2 text-[21px] font-semibold leading-tight tracking-tight">{e.headline}</p>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{e.body}</p>
              </figure>
            ))}
          </div>
        </section>
      )}

      <section className="mt-16" aria-labelledby="learn-h">
        <SectionHeading id="learn-h" title="What Counterpart has learned" sub="From past campaigns and your edits. Rules apply to every new post." />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {data?.learnings.map((m, i) => (
            <article key={m.id} className="rise-in flex gap-4 rounded-[var(--radius-lg)] bg-surface p-5 shadow-[var(--shadow-soft)] ring-1 ring-line/80" style={stagger(Math.min(i, 6))}>
              <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-lg)] ${m.kind === "brand_rule" ? "bg-ink text-marker" : "bg-pen-soft text-pen-ink"}`}>
                {m.kind === "brand_rule" ? <Prohibit size={18} aria-hidden /> : <Sparkle size={18} weight="fill" aria-hidden />}
              </span>
              <div className="min-w-0">
                <p className="text-[13px] text-muted">
                  <span className="font-medium text-ink-2">{m.kind === "brand_rule" ? "Brand rule" : "Learning"}</span>
                  {", "}
                  {m.created_by === "seed" ? "from past campaigns" : m.created_by === "agent" ? "learned by Counterpart" : "from you"}
                  {m.confidence !== null && `, ${Math.round(m.confidence * 100)}% confident`}
                </p>
                <p className="mt-1 text-[15px] leading-snug">{m.content}</p>
                {m.status === "proposed" && <p className="mt-2 text-[13px] font-medium text-turmeric">Waiting for your OK</p>}
              </div>
            </article>
          ))}
        </div>
      </section>
    </Shell>
  );
}
