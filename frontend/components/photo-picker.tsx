"use client";

import { Check, X } from "@phosphor-icons/react";
import clsx from "clsx";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";
import { useBusiness } from "@/lib/business";
import type { Photo } from "@/lib/types";

export const SOURCE_LABEL: Record<Photo["source"], string> = {
  upload: "Uploaded",
  website: "Website",
  google: "Google Maps",
  generated: "AI picture",
};

/** Swap a post's picture for another photo of the business. */
export function PhotoPicker({ assetId, current, onClose, onPicked }: { assetId: string; current: string | null; onClose: () => void; onPicked: () => void }) {
  const business = useBusiness();
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ photos: Photo[] }>(`/businesses/${business.slug}/photos`)
      .then((d) => setPhotos(d.photos.filter((p) => p.status === "active")))
      .catch((e) => setError(String(e)));
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [business.slug, onClose]);

  async function pick(p: Photo) {
    setBusy(p.id);
    try {
      await api(`/assets/${assetId}/photo`, { method: "POST", json: { photo_id: p.id } });
      onPicked();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-3 backdrop-blur-[2px] md:items-center" onClick={onClose}>
      <div role="dialog" aria-label="Choose a photo" className="sheet-up flex max-h-[80dvh] w-full max-w-3xl flex-col rounded-[var(--radius-xl)] bg-surface shadow-[var(--shadow-float)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 pb-3 pt-5">
          <div>
            <p className="text-[18px] font-semibold tracking-tight">Choose a photo</p>
            <p className="text-sm text-muted">The offer box and text stay exactly as they are.</p>
          </div>
          <button onClick={onClose} className="press rounded-[var(--radius-sm)] p-2 text-ink-2 hover:bg-sunken" aria-label="Close">
            <X size={18} aria-hidden />
          </button>
        </div>
        <div className="overflow-y-auto px-6 pb-6">
          {error && <p className="mb-3 text-sm text-kumkum">{error}</p>}
          {photos === null ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="skeleton aspect-square" />
              ))}
            </div>
          ) : photos.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted">
              No photos yet.{" "}
              <Link href="/photos" className="font-medium text-pen">
                Add photos
              </Link>
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {photos.map((p, i) => {
                const on = p.url === current;
                return (
                  <button
                    key={p.id}
                    onClick={() => pick(p)}
                    disabled={busy !== null}
                    style={{ "--i": Math.min(i, 9) } as React.CSSProperties}
                    className={clsx("rise-in press group relative aspect-square overflow-hidden rounded-[var(--radius-lg)] ring-2", on ? "ring-pen" : "ring-transparent hover:ring-line-strong")}
                  >
                    <img src={p.url} alt={p.caption || ""} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                    <span className="absolute inset-x-0 bottom-0 bg-[linear-gradient(transparent,rgba(8,20,13,0.75))] p-2.5 text-left text-[12px] text-white">
                      {SOURCE_LABEL[p.source]}
                      {p.caption ? `: ${p.caption}` : ""}
                    </span>
                    {(on || busy === p.id) && (
                      <span className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-pen text-white">
                        <Check size={14} weight="bold" aria-hidden />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
