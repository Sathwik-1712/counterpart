"use client";

import { ClipboardText, Globe } from "@phosphor-icons/react";
import clsx from "clsx";
import { useState } from "react";
import { api } from "@/lib/api";
import { useBusiness } from "@/lib/business";
import { Button } from "./ui";

/** Bring in reviews the owner already has: from their own website, or pasted from wherever they collected them.
 *  Counterpart keeps a review only if it appears word for word in what it read, so nothing is made up. */
export function ReviewImport({ onDone, dark }: { onDone: () => void; dark?: boolean }) {
  const business = useBusiness();
  const [mode, setMode] = useState<"website" | "paste">("website");
  const [website, setWebsite] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setNote(null);
    try {
      const out = await api<{ added: number; found: number; skipped: number }>(`/businesses/${business.slug}/reviews/import`, {
        method: "POST",
        json: mode === "website" ? { website: website.trim() || null } : { text },
      });
      setNote(
        out.added
          ? `Added ${out.added} review${out.added === 1 ? "" : "s"}.${out.skipped ? ` Left out ${out.skipped}: already added, or not found word for word.` : ""}`
          : out.found
            ? "Nothing new: those reviews are already here."
            : mode === "website"
              ? "No customer reviews found on that site. Try pasting them instead."
              : "No reviews found in that text.",
      );
      if (out.added) {
        setText("");
        onDone();
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not import.");
    } finally {
      setBusy(false);
    }
  }

  const tab = (id: "website" | "paste", label: string, Icon: typeof Globe) => (
    <button
      type="button"
      onClick={() => setMode(id)}
      aria-pressed={mode === id}
      className={clsx(
        "press inline-flex h-9 items-center gap-2 rounded-[var(--radius-sm)] px-3 text-[14px] font-semibold",
        mode === id ? (dark ? "bg-white text-ink" : "bg-ink text-white") : dark ? "text-white/80 hover:bg-white/10" : "text-ink-2 hover:bg-sunken",
      )}
    >
      <Icon size={16} aria-hidden /> {label}
    </button>
  );

  return (
    <div className={clsx("rounded-[var(--radius-lg)] p-5 md:p-6", dark ? "bg-white/[0.06] ring-1 ring-white/15" : "bg-surface ring-1 ring-ink")}>
      <p className={clsx("text-[18px] font-bold", dark && "text-white")}>Add reviews you already have</p>
      <p className={clsx("mt-1 max-w-[62ch] text-[14px]", dark ? "text-white/70" : "text-ink-2")}>
        From your own website, or paste them from your Google listing, Zomato page or WhatsApp. Counterpart sorts them into topics in every language and keeps only words customers actually wrote.
      </p>
      <div className="mt-4 flex flex-wrap gap-1">
        {tab("website", "From my website", Globe)}
        {tab("paste", "Paste reviews", ClipboardText)}
      </div>
      <div className="mt-3">
        {mode === "website" ? (
          <input
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="yourshop.in (leave empty to use the site from sign-up)"
            className="h-11 w-full rounded-[var(--radius-sm)] bg-white px-3 text-[15px] text-ink ring-1 ring-line outline-none focus:ring-2 focus:ring-ink"
            aria-label="Website address"
          />
        ) : (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            placeholder={"One review per paragraph. Any language.\n\nBest masala dosa in Jayanagar, always crisp.\n\nಕಾಫಿ ತುಂಬಾ ಚೆನ್ನಾಗಿದೆ."}
            className="w-full rounded-[var(--radius-sm)] bg-white p-3 text-[15px] text-ink ring-1 ring-line outline-none focus:ring-2 focus:ring-ink"
            aria-label="Paste reviews"
          />
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant={dark ? "marker" : "primary"} onClick={run} disabled={busy || (mode === "paste" && !text.trim())}>
          {busy ? (mode === "website" ? "Reading your site…" : "Reading…") : "Add reviews"}
        </Button>
        {note && <p className={clsx("text-[14px]", dark ? "text-white/80" : "text-ink-2")}>{note}</p>}
      </div>
    </div>
  );
}
