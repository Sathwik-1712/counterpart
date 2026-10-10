"use client";

import { GoogleLogo, Star } from "@phosphor-icons/react";
import clsx from "clsx";
import { useState } from "react";

const T = {
  ask: { en: "How was it?", kn: "ಹೇಗಿತ್ತು?", hi: "कैसा लगा?" },
  sub: { en: "Your stars and a few words go straight to the owner.", kn: "ನಿಮ್ಮ ಅಭಿಪ್ರಾಯ ನೇರವಾಗಿ ಮಾಲೀಕರಿಗೆ ತಲುಪುತ್ತದೆ.", hi: "आपकी राय सीधे मालिक तक पहुँचती है।" },
  placeholder: { en: "What did you like? What could be better? (optional)", kn: "ಏನು ಇಷ್ಟವಾಯಿತು? ಏನು ಉತ್ತಮವಾಗಬಹುದು? (ಐಚ್ಛಿಕ)", hi: "क्या अच्छा लगा? क्या बेहतर हो सकता है? (वैकल्पिक)" },
  send: { en: "Send review", kn: "ಕಳುಹಿಸಿ", hi: "भेजें" },
  thanks: { en: "Thank you! The owner reads every review.", kn: "ಧನ್ಯವಾದಗಳು! ಮಾಲೀಕರು ಪ್ರತಿಯೊಂದನ್ನೂ ಓದುತ್ತಾರೆ.", hi: "धन्यवाद! मालिक हर राय पढ़ते हैं।" },
  google: { en: "Also post it on Google", kn: "Google ನಲ್ಲೂ ಬರೆಯಿರಿ", hi: "Google पर भी लिखें" },
  edit: { en: "Change my review", kn: "ಬದಲಾಯಿಸಿ", hi: "बदलें" },
} as const;

type Lang = "en" | "kn" | "hi";

/** Shown once the customer's code has been redeemed: a review of the visit they just made. Everyone sees the same
 *  thanks and the same Google link, whatever they rated (asking only happy customers is review gating). */
export function ReviewForm({ code, language, existing, googleUrl }: { code: string; language: string; existing: { rating: number; body: string } | null; googleUrl: string | null }) {
  const lang: Lang = language === "kn" || language === "hi" ? language : "en";
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [comment, setComment] = useState(existing?.body ?? "");
  const [done, setDone] = useState(!!existing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [google, setGoogle] = useState(googleUrl);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/public/claims/${encodeURIComponent(code)}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rating, comment, language: lang }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Could not send. Try again.");
      setGoogle(data.google_review_url ?? google);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <div className="pop rounded-[var(--radius-lg)] bg-surface p-5 text-center ring-1 ring-line/80" role="status">
        <p className="flex justify-center gap-1 text-marker" aria-label={`${rating} of 5`}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Star key={n} size={22} weight={n <= rating ? "fill" : "regular"} className={n <= rating ? "text-[#f5a400]" : "text-line-strong"} aria-hidden />
          ))}
        </p>
        <p className="mt-2 text-[16px] font-semibold">{T.thanks[lang]}</p>
        {google && (
          <a href={google} target="_blank" rel="noreferrer" className="press mt-4 inline-flex h-11 items-center gap-2 rounded-full bg-ink px-5 text-[15px] font-semibold text-white">
            <GoogleLogo size={17} weight="bold" aria-hidden /> {T.google[lang]}
          </a>
        )}
        <button onClick={() => setDone(false)} className="mt-3 block w-full text-[13px] text-muted underline underline-offset-4">
          {T.edit[lang]}
        </button>
      </div>
    );

  return (
    <div className="rise-in rounded-[var(--radius-lg)] bg-surface p-5 ring-1 ring-ink" lang={lang}>
      <p className="text-[22px] font-semibold tracking-tight">{T.ask[lang]}</p>
      <p className="mt-0.5 text-[14px] text-ink-2">{T.sub[lang]}</p>
      <div className="mt-4 flex justify-between gap-1" role="radiogroup" aria-label="Stars">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n} of 5`}
            onClick={() => setRating(n)}
            className={clsx("press flex h-14 flex-1 items-center justify-center rounded-[var(--radius-md)] ring-1", n <= rating ? "bg-[#fff4d6] ring-[#f5a400]" : "bg-paper ring-line")}
          >
            <Star size={28} weight={n <= rating ? "fill" : "regular"} className={n <= rating ? "text-[#f5a400]" : "text-muted"} aria-hidden />
          </button>
        ))}
      </div>
      <textarea
        rows={3}
        value={comment}
        onChange={(e) => setComment(e.target.value.slice(0, 1000))}
        placeholder={T.placeholder[lang]}
        className="mt-3 w-full rounded-[var(--radius-md)] bg-paper px-3.5 py-3 text-[15px] outline-none ring-1 ring-line focus:ring-ink"
      />
      {error && <p className="mt-2 text-[14px] text-kumkum">{error}</p>}
      <button onClick={send} disabled={!rating || busy} className="press mt-3 h-12 w-full rounded-full bg-pen text-[16px] font-semibold text-white disabled:opacity-40">
        {busy ? "…" : T.send[lang]}
      </button>
    </div>
  );
}
