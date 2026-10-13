"use client";

import { Check, Hash, ImageSquare, LockSimple, Plus, WarningCircle, X } from "@phosphor-icons/react";
import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";
import { useBusiness } from "@/lib/business";
import type { Asset, Fact, Photo } from "@/lib/types";
import { ChannelPreview } from "./previews";
import { Button, CHANNEL_LABEL, LANG_LABEL } from "./ui";

// Mirrors the server's sounds_human check (backend/app/domain/facts.py AI_CLICHES) so the owner sees it while
// typing. The server check is the one that counts.
const MACHINE = [
  "elevate", "indulge", "treat yourself", "don't miss out", "unleash", "unlock", "embark", "delve", "look no further",
  "game-changer", "nestled", "vibrant", "tantalizing", "mouth-watering", "culinary journey", "fuel your", "step into",
  "symphony", "like never before", "next level", "level up", "must-try", "irresistible", "curated", "seamless",
  "delightful", "exquisite", "awaits you", "your go-to", "hidden gem", "ultimate", "epic", "amazing",
];
const machineWords = (t: string) => {
  const low = t.toLowerCase().replace(/’/g, "'");
  const hits = MACHINE.filter((w) => new RegExp(`(^|[^\\w])${w.replace(/[-']/g, "\\$&")}($|[^\\w])`).test(low));
  if (/[—–]/.test(t)) hits.push("long dash");
  if (/!.*!/.test(t)) hits.push("two exclamation marks");
  return hits;
};
// Same as the server's CHANNEL_LIMITS (backend/app/domain/facts.py).
const LIMIT: Record<string, { headline: number; body: number }> = {
  instagram_post: { headline: 80, body: 2200 },
  instagram_story: { headline: 60, body: 160 },
  poster: { headline: 40, body: 160 },
  whatsapp: { headline: 60, body: 1024 },
};

/** Exact approved wording becomes a fact slot again; anything else stays literal and the guard judges it. */
function toSlots(text: string, facts: Fact[], lang: string) {
  let out = text;
  for (const f of [...facts].sort((a, b) => (b.display[lang as "en"]?.length ?? 0) - (a.display[lang as "en"]?.length ?? 0))) {
    const d = f.display[lang as "en"];
    if (d) out = out.split(d).join(`{{${f.key}}}`);
  }
  return out;
}

/** Full-screen editor for one post: live preview on the left, the words, hashtags and photo on the right.
 *  The offer box and call to action are locked; saving runs every check again before the post can go out. */
export function PostEditor({ asset, facts, onClose, onSaved }: { asset: Asset; facts: Fact[]; onClose: () => void; onSaved: () => void }) {
  const business = useBusiness();
  const r = asset.revision?.rendered;
  const [headline, setHeadline] = useState(r?.headline ?? "");
  const [body, setBody] = useState(r?.body ?? "");
  const [tags, setTags] = useState<string[]>(r?.hashtags ?? []);
  const [tagDraft, setTagDraft] = useState("");
  const [image, setImage] = useState(asset.image_url);
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const visual = asset.channel !== "whatsapp";
  const limit = LIMIT[asset.channel] ?? LIMIT.instagram_post;

  useEffect(() => {
    if (visual)
      api<{ photos: Photo[] }>(`/businesses/${business.slug}/photos`)
        .then((d) => setPhotos(d.photos.filter((p) => p.status === "active")))
        .catch(() => setPhotos([]));
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", esc);
      document.body.style.overflow = "";
    };
  }, [business.slug, visual, onClose]);

  const preview = useMemo<Asset>(
    () => ({ ...asset, image_url: image, revision: asset.revision && r ? { ...asset.revision, rendered: { ...r, headline, body, hashtags: tags } } : asset.revision }),
    [asset, r, image, headline, body, tags],
  );
  const robotic = machineWords(`${headline} ${body}`);
  const digits = /\d/.test(toSlots(`${headline} ${body}`, facts, asset.language).replace(/\{\{\w+\}\}/g, ""));
  const changed = headline !== (r?.headline ?? "") || body !== (r?.body ?? "") || tags.join() !== (r?.hashtags ?? []).join();

  function addTag() {
    const t = tagDraft.trim().replace(/^#+/, "").replace(/\s+/g, "");
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagDraft("");
  }

  async function pickPhoto(p: Photo) {
    setBusy(p.id);
    setError(null);
    try {
      await api(`/assets/${asset.id}/photo`, { method: "POST", json: { photo_id: p.id } });
      setImage(p.url);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    setError(null);
    const seg = (t: string, field: string) => (t.trim() ? [{ text: toSlots(t.trim(), facts, asset.language), sources: [`owner:${field}`] }] : []);
    try {
      await api(`/assets/${asset.id}`, {
        method: "PATCH",
        json: { content: { headline: seg(headline, "headline"), body: seg(body, "body"), cta: [], hashtags: tags } },
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  const field = "mt-1.5 w-full rounded-[var(--radius-md)] bg-surface px-4 py-3 text-[16px] shadow-[inset_0_0_0_1.5px_var(--color-ink)] outline-none focus:shadow-[inset_0_0_0_1.5px_var(--color-ink),0_0_0_3px_var(--color-marker)]";
  const count = (n: number, max: number) => <span className={clsx("tabular-nums", n > max ? "font-semibold text-kumkum" : "text-muted")}>{n}/{max}</span>;

  // Rendered on <body>: an animated ancestor (transform) would otherwise trap a fixed overlay inside the card.
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-paper" role="dialog" aria-modal="true" aria-label="Edit post">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-ink px-4 md:px-8">
        <button onClick={onClose} className="press rounded-[var(--radius-sm)] p-2 hover:bg-sunken" aria-label="Close the editor">
          <X size={20} aria-hidden />
        </button>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[18px] font-bold [font-stretch:90%]">Edit post</p>
          <p className="truncate text-[13px] text-muted">
            {CHANNEL_LABEL[asset.channel]} in {LANG_LABEL[asset.language]}
          </p>
        </div>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={save} disabled={busy !== null || !changed || !headline.trim()} trailing={<Check size={14} weight="bold" />}>
          {busy === "save" ? "Checking…" : "Save and check"}
        </Button>
      </header>

      <div className="grid grid-cols-1 min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_480px] lg:overflow-hidden">
        <div className="flex items-start justify-center bg-sunken/60 p-6 md:p-10 lg:overflow-y-auto">
          <div className="sheet-up w-full max-w-[440px]">
            <div className="overflow-hidden rounded-[var(--radius-md)] bg-white shadow-[var(--shadow-float)] ring-1 ring-ink/10" lang={asset.language}>
              <ChannelPreview asset={preview} business={business.name} />
            </div>
            <p className="mt-3 text-center text-[13px] text-muted">Live preview. This is what customers see.</p>
          </div>
        </div>

        <div className="space-y-7 border-ink p-5 md:p-8 lg:overflow-y-auto lg:border-l">
          <label className="block">
            <span className="flex justify-between text-[14px] font-semibold">
              Headline {count(headline.length, limit.headline)}
            </span>
            <textarea rows={2} lang={asset.language} value={headline} onChange={(e) => setHeadline(e.target.value)} className={clsx(field, "text-[19px] font-semibold")} />
          </label>
          <label className="block">
            <span className="flex justify-between text-[14px] font-semibold">
              Message {count(body.length, limit.body)}
            </span>
            <textarea rows={5} lang={asset.language} value={body} onChange={(e) => setBody(e.target.value)} className={field} />
          </label>

          {(robotic.length > 0 || digits) && (
            <div className="space-y-1.5 rounded-[var(--radius-md)] bg-turmeric-soft p-3.5 text-[14px] text-turmeric" role="status">
              {robotic.length > 0 && (
                <p className="flex gap-2">
                  <WarningCircle size={17} weight="fill" className="mt-0.5 shrink-0" aria-hidden />
                  Sounds machine-written: {robotic.join(", ")}. Say it the way you would to a regular.
                </p>
              )}
              {digits && (
                <p className="flex gap-2">
                  <WarningCircle size={17} weight="fill" className="mt-0.5 shrink-0" aria-hidden />
                  A number that is not in the locked offer will be blocked. Prices, times and dates come from the offer box.
                </p>
              )}
            </div>
          )}

          {asset.channel !== "whatsapp" && (
            <div>
              <p className="flex items-center gap-1.5 text-[14px] font-semibold">
                <Hash size={15} aria-hidden /> Hashtags
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <button key={t} onClick={() => setTags(tags.filter((x) => x !== t))} className="press inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-pen-soft px-2.5 py-1 text-[14px] font-semibold text-pen-ink hover:bg-kumkum-soft hover:text-kumkum" aria-label={`Remove #${t}`}>
                    #{t} <X size={12} aria-hidden />
                  </button>
                ))}
                <span className="inline-flex items-center gap-1">
                  <input
                    value={tagDraft}
                    onChange={(e) => setTagDraft(e.target.value)}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === ",") && (e.preventDefault(), addTag())}
                    placeholder="add tag"
                    className="h-8 w-28 rounded-[var(--radius-sm)] bg-surface px-2.5 text-[14px] shadow-[inset_0_0_0_1.5px_var(--color-line-strong)] outline-none focus:shadow-[inset_0_0_0_1.5px_var(--color-ink)]"
                    aria-label="New hashtag"
                  />
                  <button onClick={addTag} className="press rounded-[var(--radius-sm)] p-1.5 hover:bg-sunken" aria-label="Add hashtag">
                    <Plus size={14} weight="bold" aria-hidden />
                  </button>
                </span>
              </div>
            </div>
          )}

          {visual && (
            <div>
              <p className="flex items-center gap-1.5 text-[14px] font-semibold">
                <ImageSquare size={15} aria-hidden /> Photo
                <span className="font-normal text-muted">changes at once</span>
              </p>
              {photos === null ? (
                <div className="mt-2 grid grid-cols-4 gap-2">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="skeleton aspect-square" />
                  ))}
                </div>
              ) : photos.length === 0 ? (
                <p className="mt-2 text-[14px] text-muted">No photos yet. Add some on the Photos page.</p>
              ) : (
                <div className="mt-2 grid grid-cols-4 gap-2">
                  {photos.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => pickPhoto(p)}
                      disabled={busy !== null}
                      className={clsx("press relative aspect-square overflow-hidden rounded-[var(--radius-sm)]", p.url === image ? "ring-[3px] ring-ink" : "ring-1 ring-line hover:ring-ink/50")}
                      aria-label={p.caption || "Use this photo"}
                    >
                      <img src={p.url} alt="" className="h-full w-full object-cover" />
                      {(p.url === image || busy === p.id) && (
                        <span className="absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-ink text-white">
                          <Check size={11} weight="bold" aria-hidden />
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="rounded-[var(--radius-md)] border border-dashed border-line-strong p-4 text-[14px] text-ink-2">
            <p className="flex items-center gap-1.5 font-semibold text-ink">
              <LockSimple size={15} weight="fill" aria-hidden /> Locked: offer box and “{r?.cta}”
            </p>
            <p className="mt-1">These come from the offer you locked, word for word. To change the offer, tell Counterpart on the campaign page.</p>
          </div>

          {error && (
            <p className="rounded-[var(--radius-md)] bg-kumkum-soft p-3.5 text-[14px] text-kumkum" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
