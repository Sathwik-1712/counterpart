"use client";

import { ArrowClockwise, Eye, EyeSlash, Globe, GoogleLogo, ImageSquare, Sparkle, UploadSimple } from "@phosphor-icons/react";
import clsx from "clsx";
import { useRef, useState } from "react";
import { Spotlight } from "@/components/motion";
import { SOURCE_LABEL } from "@/components/photo-picker";
import { Shell } from "@/components/shell";
import { Button, PageHeader, SectionHeading, Skeleton, stagger } from "@/components/ui";
import { api, useResource } from "@/lib/api";
import { useBusiness } from "@/lib/business";
import type { Photo } from "@/lib/types";

/** Shrink big phone photos in the browser before upload (the server re-encodes again). */
async function toDataUrl(file: File, max = 2000): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.88);
}

function PhotoCard({ p, i, onToggle }: { p: Photo; i: number; onToggle: () => void }) {
  const hidden = p.status === "hidden";
  return (
    <Spotlight className="rise-in mb-4 break-inside-avoid overflow-hidden rounded-[var(--radius-lg)] bg-surface shadow-[var(--shadow-soft)] ring-1 ring-line/80" style={stagger(Math.min(i, 10))}>
      <div className="group relative">
        <img src={p.url} alt={p.caption || "Photo of the business"} loading="lazy" className={clsx("w-full transition-[filter] duration-500", hidden && "grayscale")} />
        <button
          onClick={onToggle}
          className="press absolute right-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-white/95 px-3 py-1.5 text-[13px] font-medium text-ink opacity-0 shadow-[var(--shadow-soft)] transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        >
          {hidden ? <Eye size={13} aria-hidden /> : <EyeSlash size={13} aria-hidden />}
          {hidden ? "Use in posts" : "Don't use"}
        </button>
      </div>
      <div className="relative z-10 p-4">
        <p className="text-[13px] text-muted">
          <span className="font-medium text-ink-2">{SOURCE_LABEL[p.source]}</span>
          {p.attribution && p.source === "google" ? `, ${p.attribution.replace(/^Google Maps,?\s*/, "")}` : ""}
        </p>
        {p.caption === null ? (
          <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-2">
            <Sparkle size={13} weight="fill" className="text-pen" aria-hidden /> Being read…
          </p>
        ) : (
          p.caption && <p className="mt-1 text-sm leading-snug">{p.caption}</p>
        )}
        {p.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {p.tags.slice(0, 5).map((t) => (
              <span key={t} className="rounded-[var(--radius-sm)] bg-sunken px-2 py-0.5 text-[12px] text-ink-2">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </Spotlight>
  );
}

export default function PhotosPage() {
  const business = useBusiness();
  const { data, reload } = useResource<{ photos: Photo[]; website: string | null; google_available: boolean }>(
    `/businesses/${business.slug}/photos`,
    (e) => e.type.startsWith("photos."),
  );
  const [site, setSite] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const website = site ?? data?.website ?? "";
  const active = data?.photos.filter((p) => p.status === "active") ?? [];
  const hidden = data?.photos.filter((p) => p.status === "hidden") ?? [];

  async function upload(files: FileList | File[]) {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!list.length) return;
    setBusy("upload");
    setNote(null);
    let ok = 0;
    const problems: string[] = [];
    for (const f of list) {
      try {
        await api(`/businesses/${business.slug}/photos`, { method: "POST", json: { data_url: await toDataUrl(f) } });
        ok++;
      } catch (e) {
        problems.push(`${f.name}: ${e instanceof Error ? e.message : e}`);
      }
    }
    setBusy(null);
    setNote({ ok: problems.length === 0, text: `${ok} photo${ok === 1 ? "" : "s"} added.${problems.length ? ` ${problems.join(" ")}` : " Counterpart is reading them now."}` });
    reload();
  }

  async function importFrom(google: boolean) {
    setBusy(google ? "google" : "website");
    setNote(null);
    try {
      await api(`/businesses/${business.slug}/photos/import`, { method: "POST", json: { website: google ? null : website.trim() || null, google } });
      setNote({ ok: true, text: google ? "Looking for photos on your Google Maps listing. They appear here as they arrive." : "Looking through your website. Photos appear here as they arrive." });
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Shell>
      <PageHeader
        title="Photos"
        sub={`Real photos of ${business.name}. Each post picks the best match automatically, and you can swap any post's picture.`}
      />

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-12" aria-label="Add photos">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            upload(e.dataTransfer.files);
          }}
          className={clsx(
            "night rise-in flex flex-col justify-between rounded-[var(--radius-lg)] p-7 transition-transform duration-500 lg:col-span-5",
            drag && "scale-[1.015] ring-2 ring-marker",
          )}
        >
          <div>
            <UploadSimple size={28} className="text-marker" aria-hidden />
            <p className="mt-4 text-[34px] font-bold leading-none [font-stretch:90%]">Add photos from your phone</p>
            <p className="mt-3 max-w-[38ch] text-[15px] text-white/75">Your products, your counter, your space. Phone photos are perfect; natural light works best. Or drop them here.</p>
          </div>
          <div className="mt-8">
            <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && upload(e.target.files)} />
            <Button variant="light" size="lg" onClick={() => input.current?.click()} disabled={busy !== null}>
              {busy === "upload" ? "Uploading…" : "Choose photos"}
            </Button>
          </div>
        </div>

        <div className="rise-in space-y-4 lg:col-span-7" style={stagger(1)}>
          <div className="rounded-[var(--radius-lg)] bg-surface p-6 shadow-[var(--shadow-soft)] ring-1 ring-line/80">
            <p className="flex items-center gap-2 text-[16px] font-semibold tracking-tight">
              <Globe size={18} className="text-pen" aria-hidden /> From your website
            </p>
            <p className="mt-1 text-sm text-ink-2">Counterpart looks through your site and gallery pages for photos of the business.</p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <input
                value={website}
                onChange={(e) => setSite(e.target.value)}
                placeholder="yourbusiness.in"
                inputMode="url"
                aria-label="Website address"
                className="h-11 w-full shrink-0 rounded-[var(--radius-md)] sm:w-auto sm:flex-1 bg-surface px-4 text-[15px] shadow-[inset_0_0_0_1.5px_var(--color-ink)] outline-none focus:shadow-[inset_0_0_0_1.5px_var(--color-ink),0_0_0_3px_var(--color-marker)]"
              />
              <Button variant="primary" onClick={() => importFrom(false)} disabled={busy !== null || !website.trim()}>
                {busy === "website" ? "Starting…" : "Find photos"}
              </Button>
            </div>
          </div>
          {data?.google_available && (
            <div className="rounded-[var(--radius-lg)] bg-surface p-6 shadow-[var(--shadow-soft)] ring-1 ring-line/80">
            <div className="flex flex-wrap items-center gap-3">
              <p className="flex flex-1 items-center gap-2 text-[16px] font-semibold tracking-tight">
                <GoogleLogo size={18} className="text-pen" aria-hidden /> From your Google Maps listing
              </p>
              <Button onClick={() => importFrom(true)} disabled={busy !== null || !data?.google_available}>
                {busy === "google" ? "Starting…" : "Find photos"}
              </Button>
            </div>
            <p className="mt-1 text-sm text-ink-2">
              {data?.google_available
                ? `Searches Google Maps for “${business.name}, ${business.locality}” and credits each photographer.`
                : "Not switched on for this server yet (it needs a Google Maps key)."}
            </p>
          </div>
          )}
          {note && (
            <p className={clsx("pop rounded-[var(--radius-md)] px-4 py-3 text-sm", note.ok ? "bg-pen-soft text-pen-ink" : "bg-kumkum-soft text-kumkum")} role="status">
              {note.text}
            </p>
          )}
        </div>
      </section>

      <section className="mt-14" aria-labelledby="lib-h">
        <SectionHeading
          id="lib-h"
          title="Used in posts"
          sub={data ? `${active.length} photo${active.length === 1 ? "" : "s"}` : undefined}
          aside={
            <Button variant="ghost" size="sm" onClick={() => reload()}>
              <ArrowClockwise size={14} aria-hidden /> Refresh
            </Button>
          }
        />
        {!data ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Skeleton className="h-56" />
            <Skeleton className="h-72" />
            <Skeleton className="h-60" />
          </div>
        ) : active.length === 0 ? (
          <div className="flex flex-col items-center rounded-[var(--radius-lg)] border border-dashed border-line-strong px-6 py-14 text-center">
            <ImageSquare size={36} weight="light" className="text-muted" aria-hidden />
            <p className="mt-3 text-[16px] font-medium">No photos yet</p>
            <p className="mt-1 max-w-[46ch] text-sm text-muted">Add a few and every new post will use a real photo of your place. Until then, posts get an AI picture, labelled as such.</p>
          </div>
        ) : (
          <div className="columns-1 gap-4 sm:columns-2 lg:columns-3 xl:columns-4">
            {active.map((p, i) => (
              <PhotoCard key={p.id} p={p} i={i} onToggle={() => api(`/photos/${p.id}`, { method: "PATCH", json: { status: "hidden" } }).then(reload)} />
            ))}
          </div>
        )}
      </section>

      {hidden.length > 0 && (
        <details className="mt-12">
          <summary className="cursor-pointer text-[17px] font-semibold tracking-tight">Set aside ({hidden.length})</summary>
          <p className="mt-1 text-sm text-muted">Blurry shots, logos, menus and anything you chose not to use. Bring any back with “Use in posts”.</p>
          <div className="mt-5 columns-2 gap-4 lg:columns-4 xl:columns-5">
            {hidden.map((p, i) => (
              <PhotoCard key={p.id} p={p} i={i} onToggle={() => api(`/photos/${p.id}`, { method: "PATCH", json: { status: "active" } }).then(reload)} />
            ))}
          </div>
        </details>
      )}
    </Shell>
  );
}
