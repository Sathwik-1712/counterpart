"use client";

import { ArrowRight, Check, MapPin, Storefront } from "@phosphor-icons/react";
import { use, useEffect, useRef, useState } from "react";

interface Landing {
  code: string;
  name: string;
  locality: string;
  city: string;
  language: string;
  rendered: { headline: string; body: string; cta: string; offer?: string[] };
  image_url: string | null;
}

const CLAIM: Record<string, string> = { en: "Get my code", kn: "ನನ್ನ ಕೋಡ್ ಪಡೆಯಿರಿ", hi: "मेरा कोड पाएँ" };

/** What a customer sees after scanning a QR code. Public, mobile-first. */
export default function OfferPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const [data, setData] = useState<Landing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claimed, setClaimed] = useState(false);
  const [busy, setBusy] = useState(false);
  const visited = useRef(false);

  useEffect(() => {
    if (visited.current) return; // count one scan per page load (StrictMode runs effects twice in dev)
    visited.current = true;
    fetch(`/api/public/r/${encodeURIComponent(code)}/visit`, { method: "POST" })
      .then(async (r) => (r.ok ? setData(await r.json()) : setError((await r.json()).detail ?? "This offer is not available.")))
      .catch(() => setError("Could not load the offer. Check your connection."));
  }, [code]);

  async function claim() {
    setBusy(true);
    try {
      const r = await fetch(`/api/public/r/${encodeURIComponent(code)}/claim`, { method: "POST" });
      if (r.ok) setClaimed(true);
      else setError("Could not get your code. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (error)
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
        <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-sunken text-ink-2">
          <Storefront size={26} aria-hidden />
        </span>
        <p className="mt-4 text-[17px] font-semibold">{error}</p>
        <p className="mt-1 text-sm text-muted">Ask at the counter, they will help you.</p>
      </main>
    );
  if (!data)
    return (
      <main className="mx-auto min-h-dvh max-w-md" aria-busy>
        <div className="skeleton aspect-[4/5] w-full rounded-none" />
        <div className="space-y-3 p-6">
          <div className="skeleton h-5 w-3/4" />
          <div className="skeleton h-5 w-1/2" />
          <div className="skeleton h-28 w-full" />
        </div>
      </main>
    );

  const r = data.rendered;
  const [lead, ...details] = r.offer ?? [];

  return (
    <main className="mx-auto min-h-dvh max-w-md bg-paper md:my-8 md:min-h-0 md:overflow-hidden md:rounded-[var(--radius-xl)] md:shadow-[var(--shadow-float)]" lang={data.language}>
      <div className="night relative aspect-[4/5] w-full overflow-hidden">
        {data.image_url && <img src={data.image_url} alt="" className="absolute inset-0 h-full w-full object-cover" />}
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(8,20,13,0.45)_0%,transparent_30%,transparent_45%,rgba(8,20,13,0.85)_100%)]" />
        <p className="absolute left-5 top-5 inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-black/35 px-3.5 py-1.5 text-[13px] font-medium text-white backdrop-blur-md">
          <span className="h-2 w-2 rounded-full bg-marker" aria-hidden />
          {data.name}
        </p>
        <h1 className="rise-in absolute inset-x-5 bottom-12 text-[34px] leading-[1.05] tracking-[-0.035em] text-white">{r.headline}</h1>
      </div>

      <div className="relative -mt-7 rounded-t-[28px] bg-paper px-5 pb-10 pt-7">
        {r.body && <p className="rise-in text-[17px] leading-relaxed text-ink-2">{r.body}</p>}

        {lead && (
          <section className="night rise-in mt-6 rounded-[var(--radius-lg)] p-5" style={{ "--i": 1 } as React.CSSProperties} aria-label="The offer">
            <p className="text-[28px] font-semibold leading-tight tracking-[-0.03em]">{lead}</p>
            {details.length > 0 && (
              <ul className="mt-3 space-y-1.5 text-[15px] text-white/85">
                {details.map((d) => (
                  <li key={d} className="flex gap-2">
                    <Check size={15} weight="bold" className="mt-1 shrink-0 text-marker" aria-hidden />
                    {d}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <div className="mt-6">
          {claimed ? (
            <div className="pop overflow-hidden rounded-[var(--radius-lg)] bg-surface shadow-[var(--shadow-lift)] ring-1 ring-line/80" role="status">
              <div className="px-6 pb-5 pt-6 text-center">
                <p className="text-sm text-muted">{r.cta}</p>
                <p className="mt-3 font-receipt text-[44px] font-medium leading-none tracking-[0.18em] text-ink">{data.code}</p>
              </div>
              <div className="perforation" aria-hidden />
              <p className="flex items-center justify-center gap-1.5 px-6 py-4 text-sm text-ink-2">
                <MapPin size={15} className="text-pen" aria-hidden />
                {data.name}, {data.locality}
              </p>
            </div>
          ) : (
            <button
              onClick={claim}
              disabled={busy}
              className="press group flex h-16 w-full items-center justify-between rounded-full bg-pen pl-7 pr-2 text-[17px] font-semibold text-white shadow-[var(--shadow-lift)] hover:bg-pen-ink disabled:opacity-60"
            >
              {busy ? "…" : (CLAIM[data.language] ?? CLAIM.en)}
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-white/15 transition-transform duration-300 group-hover:translate-x-0.5">
                <ArrowRight size={18} weight="bold" aria-hidden />
              </span>
            </button>
          )}
        </div>

        {!claimed && (
          <p className="mt-8 flex items-center gap-1.5 text-[13px] text-muted">
            <MapPin size={13} aria-hidden />
            {data.name}, {data.locality}, {data.city}
          </p>
        )}
      </div>
    </main>
  );
}
