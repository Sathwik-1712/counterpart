"use client";

import { Check, GoogleLogo, InstagramLogo, PaperPlaneTilt, PencilSimple, SealCheck, Sparkle, Star, WhatsappLogo } from "@phosphor-icons/react";
import clsx from "clsx";
import { useState } from "react";
import { api } from "@/lib/api";
import { useBusiness } from "@/lib/business";
import { Button } from "./ui";

export interface Visits {
  n: number;
  average: number | null;
  stars: number[]; // count of 1 to 5 stars
  waiting: number; // 3 stars or fewer with no reply yet
}

export interface ReviewRow {
  id: string;
  source: string;
  language: string;
  rating: number | null;
  body: string;
  translation: string | null;
  reply: string | null;
  replied_at: string | null;
  claim_code: string | null;
  campaign: string | null;
  via: string | null;
  category: string | null; // Instagram comments: praise, complaint, question, suggestion, mention
  author: string | null; // Instagram username of the commenter
}

/** A review the owner should answer: a low rating, or an Instagram question or complaint. */
export const needsReply = (r: ReviewRow) => !r.reply && ((r.rating ?? 5) <= 3 || r.category === "question" || r.category === "complaint");

/** Stars from people who actually came in (their code was redeemed), last 90 days. */
export function VisitSummary({ v, fixFirst }: { v: Visits; fixFirst: { theme: string; recent: number }[] }) {
  const top = Math.max(1, ...v.stars);
  return (
    <div className="grid grid-cols-1 gap-6 rounded-[var(--radius-lg)] bg-surface p-5 ring-1 ring-ink md:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] md:p-7">
      <div>
        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-muted">
          <SealCheck size={15} weight="fill" className="text-pen" aria-hidden /> Verified visits, 90 days
        </p>
        <p className="sign mt-1 text-[64px] leading-none">{v.average ?? "–"}</p>
        <p className="mt-1 flex items-center gap-1 text-[14px] text-ink-2">
          <Star size={14} weight="fill" className="text-[#f5a400]" aria-hidden /> from {v.n} review{v.n === 1 ? "" : "s"}
        </p>
      </div>
      <div className="space-y-1">
        {[5, 4, 3, 2, 1].map((s) => (
          <div key={s} className="flex items-center gap-2 text-[13px] tabular-nums">
            <span className="w-3 text-right text-muted">{s}</span>
            <div className="h-2 flex-1 rounded-full bg-sunken">
              <div className={clsx("h-full rounded-full", s >= 4 ? "bg-pen" : s === 3 ? "bg-turmeric" : "bg-kumkum")} style={{ width: `${(v.stars[s - 1] / top) * 100}%` }} />
            </div>
            <span className="w-6 text-right text-ink-2">{v.stars[s - 1]}</span>
          </div>
        ))}
      </div>
      <div>
        <p className="text-[14px] font-bold">Fix first</p>
        {fixFirst.length ? (
          <ul className="mt-1 space-y-1 text-[14px]">
            {fixFirst.map((t) => (
              <li key={t.theme} className="flex justify-between gap-2">
                <span>{t.theme.replace(/_/g, " ")}</span>
                <span className="tabular-nums text-kumkum">{t.recent} unhappy mention{t.recent === 1 ? "" : "s"}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-[14px] text-ink-2">No topic is pulling reviews down right now.</p>
        )}
        {v.waiting > 0 && <p className="mt-2 text-[13px] font-semibold text-kumkum">{v.waiting} low rating{v.waiting === 1 ? "" : "s"} waiting for your reply</p>}
      </div>
    </div>
  );
}

/** The business's own Google "Ask for reviews" link, offered to every reviewer after they review. */
export function GoogleLink({ url, onSaved }: { url: string | null; onSaved: () => void }) {
  const business = useBusiness();
  const [value, setValue] = useState(url ?? "");
  const [state, setState] = useState<string | null>(null);
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row sm:items-end"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api(`/businesses/${business.slug}/review-link`, { method: "PUT", json: { url: value.trim() } });
          setState(value.trim() ? "Saved. Every reviewer now sees it." : "Removed.");
          onSaved();
        } catch (err) {
          setState(err instanceof Error ? err.message : String(err));
        }
      }}
    >
      <label className="block flex-1">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-muted">
          <GoogleLogo size={14} aria-hidden /> Your Google review link (free: Google Business Profile → Ask for reviews)
        </span>
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="https://g.page/r/…/review" className="mt-1 h-11 w-full rounded-[var(--radius-md)] bg-surface px-3.5 text-[15px] outline-none ring-1 ring-line-strong focus:ring-ink" />
      </label>
      <Button type="submit" variant="secondary">
        Save
      </Button>
      {state && <p className="text-[13px] text-ink-2 sm:w-56">{state}</p>}
    </form>
  );
}

/** Draft a reply in the customer's language, edit it, keep it; on WhatsApp or Instagram it can go to the customer directly. */
export function ReplyBox({ r, onSaved }: { r: ReviewRow; onSaved: () => void }) {
  const [text, setText] = useState(r.reply ?? "");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  if (r.reply && !open)
    return (
      <div className="mt-3 border-l-[3px] border-pen pl-3">
        <p className="text-[12px] font-semibold text-pen">Your reply</p>
        <p className="text-[14px] text-ink-2" lang={r.language}>{r.reply}</p>
        <button onClick={() => setOpen(true)} className="mt-1 text-[12px] text-muted underline underline-offset-4">Edit</button>
      </div>
    );
  if (!open)
    return (
      <div className="mt-3 flex gap-1.5">
        <Button size="sm" variant="secondary" disabled={busy !== null} onClick={async () => {
          setBusy("draft");
          try {
            setText((await api<{ reply: string }>(`/reviews/${r.id}/reply/draft`, { method: "POST" })).reply);
            setOpen(true);
          } catch (e) {
            setNote(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(null);
          }
        }}>
          <Sparkle size={13} aria-hidden /> {busy === "draft" ? "Writing…" : "Draft a reply"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
          <PencilSimple size={13} aria-hidden /> Write my own
        </Button>
        {note && <p className="text-[12px] text-kumkum">{note}</p>}
      </div>
    );

  const instagram = r.source === "instagram_comment";
  const direct = r.via === "whatsapp" || instagram;

  async function save(send: boolean) {
    setBusy(send ? "send" : "save");
    try {
      const res = await api<{ sent_on_whatsapp: boolean }>(`/reviews/${r.id}/reply`, {
        method: "PUT",
        json: { reply: text, send_whatsapp: send && !instagram, send_instagram: send && instagram },
      });
      setNote(!send ? "Saved." : instagram ? "Posted under their comment on Instagram." : res.sent_on_whatsapp ? "Sent on WhatsApp." : "Saved. Not sent: their 24-hour WhatsApp window has closed.");
      setOpen(false);
      onSaved();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-3">
      <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} lang={r.language} className="w-full rounded-[var(--radius-md)] bg-paper px-3 py-2 text-[14px] outline-none ring-1 ring-line focus:ring-ink" />
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {r.via === "whatsapp" && (
          <Button size="sm" variant="primary" disabled={!text.trim() || busy !== null} onClick={() => save(true)}>
            <WhatsappLogo size={13} aria-hidden /> {busy === "send" ? "Sending…" : "Send on WhatsApp"}
          </Button>
        )}
        {instagram && (
          <Button size="sm" variant="primary" disabled={!text.trim() || busy !== null} onClick={() => save(true)}>
            <InstagramLogo size={13} aria-hidden /> {busy === "send" ? "Posting…" : "Reply on Instagram"}
          </Button>
        )}
        <Button size="sm" variant={direct ? "secondary" : "primary"} disabled={!text.trim() || busy !== null} onClick={() => save(false)}>
          <Check size={13} aria-hidden /> {busy === "save" ? "Saving…" : direct ? "Just save" : "Save reply"}
        </Button>
        {!direct && (
          <Button size="sm" variant="ghost" onClick={() => navigator.clipboard?.writeText(text)}>
            <PaperPlaneTilt size={13} aria-hidden /> Copy (to paste on Google)
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
      {note && <p className="mt-1 text-[12px] text-ink-2">{note}</p>}
    </div>
  );
}
