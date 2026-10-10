"use client";

import { MapPin, Storefront } from "@phosphor-icons/react";
import { use } from "react";
import { ReviewForm } from "@/components/review-form";
import { useClaimStatus } from "@/lib/claim";

const SHOW: Record<string, string> = { en: "Show this at the counter", kn: "ಕೌಂಟರ್‌ನಲ್ಲಿ ಇದನ್ನು ತೋರಿಸಿ", hi: "काउंटर पर यह दिखाएँ" };
const STAFF_SCAN: Record<string, string> = { en: "Staff scan this code", kn: "ಸಿಬ್ಬಂದಿ ಈ ಕೋಡ್ ಸ್ಕ್ಯಾನ್ ಮಾಡುತ್ತಾರೆ", hi: "स्टाफ़ यह कोड स्कैन करेगा" };
const USED: Record<string, string> = { en: "Used", kn: "ಬಳಸಲಾಗಿದೆ", hi: "इस्तेमाल हो चुका" };

/** A customer's personal code, opened from the WhatsApp reply: the offer, the code and the QR staff scan. */
export default function CodePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const { data, error } = useClaimStatus(code);

  if (error)
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
        <Storefront size={28} className="text-ink-2" aria-hidden />
        <p className="mt-4 text-[17px] font-semibold">{error}</p>
      </main>
    );
  if (!data) return <main className="mx-auto min-h-dvh max-w-md p-6"><div className="skeleton h-96 w-full" /></main>;
  const used = data.status === "redeemed";
  const t = (m: Record<string, string>) => m[data.language] ?? m.en;
  return (
    <main className="mx-auto min-h-dvh max-w-md px-5 py-8" lang={data.language}>
      <p className="text-[15px] font-semibold">{data.name}</p>
      <section className="night mt-4 rounded-[var(--radius-lg)] p-5" aria-label="The offer">
        {data.offer.map((o, i) => (
          <p key={o} className={i === 0 ? "text-[26px] font-semibold leading-tight" : "mt-1.5 text-[15px] text-white/85"}>
            {o}
          </p>
        ))}
      </section>
      <div className="mt-5 overflow-hidden rounded-[var(--radius-lg)] bg-surface text-center shadow-[var(--shadow-lift)] ring-1 ring-line/80">
        <div className="px-6 pb-5 pt-6">
          <p className="text-sm text-muted">{t(SHOW)}</p>
          <p className={`mt-3 font-receipt text-[38px] font-medium leading-none tracking-[0.16em] ${used ? "text-muted line-through" : ""}`}>{data.code}</p>
          {used ? (
            <p className="stamp mx-auto mt-5 text-kumkum">{t(USED)}</p>
          ) : (
            <>
              <img src={`/api/public/claims/${data.code}/qr.png`} alt="" className="mx-auto mt-5 h-40 w-40" />
              <p className="mt-1 text-[13px] text-muted">{t(STAFF_SCAN)}</p>
            </>
          )}
        </div>
        <div className="perforation" aria-hidden />
        <p className="flex items-center justify-center gap-1.5 px-6 py-4 text-sm text-ink-2">
          <MapPin size={15} className="text-pen" aria-hidden />
          {data.name}, {data.locality}
        </p>
      </div>
      {used && (
        <div className="mt-5">
          <ReviewForm code={data.code} language={data.language} existing={data.review} googleUrl={data.google_review_url} />
        </div>
      )}
    </main>
  );
}
