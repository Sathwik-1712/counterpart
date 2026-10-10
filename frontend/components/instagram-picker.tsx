"use client";

import { X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useBusiness } from "@/lib/business";

interface Media {
  id: string;
  caption?: string;
  media_type: string;
  permalink: string;
  timestamp: string;
  thumbnail_url?: string;
  media_url?: string;
  linked_asset: string | null;
}

/** Pick a post the owner made in the Instagram app, so its reach and engagement count for this Counterpart post. */
export function InstagramPicker({ assetId, onClose, onLinked }: { assetId: string; onClose: () => void; onLinked: () => void }) {
  const business = useBusiness();
  const [media, setMedia] = useState<Media[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ media: Media[] }>(`/businesses/${business.slug}/instagram/recent`)
      .then((r) => setMedia(r.media))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [business.slug]);

  async function pick(m: Media) {
    try {
      await api(`/assets/${assetId}/instagram/link`, { method: "POST", json: { media_id: m.id } });
      onLinked();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 md:items-center md:p-6" onClick={onClose}>
      <div className="sheet-up max-h-[85dvh] w-full max-w-2xl overflow-y-auto rounded-t-[var(--radius-xl)] bg-surface p-5 md:rounded-[var(--radius-xl)]" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Link an Instagram post">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[22px]">Which Instagram post is this?</h2>
          <button onClick={onClose} className="press rounded-full p-2 hover:bg-sunken" aria-label="Close">
            <X size={18} aria-hidden />
          </button>
        </div>
        {error && <p className="mb-3 rounded-[var(--radius-md)] bg-kumkum-soft px-3.5 py-2.5 text-[14px] text-kumkum">{error}</p>}
        {!media && !error && <div className="skeleton h-48 w-full" />}
        {media && media.length === 0 && <p className="text-[15px] text-ink-2">No posts on this account yet.</p>}
        <div className="grid grid-cols-3 gap-2">
          {media?.map((m) => (
            <button key={m.id} onClick={() => pick(m)} disabled={!!m.linked_asset && m.linked_asset !== assetId} className="press group relative aspect-square overflow-hidden rounded-[var(--radius-md)] bg-sunken text-left disabled:opacity-40">
              {(m.thumbnail_url || m.media_url) && <img src={m.thumbnail_url || m.media_url} alt="" className="h-full w-full object-cover" />}
              <span className="absolute inset-x-0 bottom-0 bg-ink/70 px-2 py-1 text-[11px] text-white">
                {new Date(m.timestamp).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                {m.linked_asset && " · linked"}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
