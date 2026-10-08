"use client";

import { use, useEffect, useRef, useState } from "react";

interface Landing {
  code: string;
  name: string;
  locality: string;
  city: string;
  language: string;
  rendered: { headline: string; body: string; cta: string };
  image_url: string | null;
}

/** What a customer sees after scanning a QR code. Public, mobile-first. */
export default function OfferPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const [data, setData] = useState<Landing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claimed, setClaimed] = useState(false);
  const visited = useRef(false);

  useEffect(() => {
    if (visited.current) return; // count one scan per page load (StrictMode runs effects twice in dev)
    visited.current = true;
    fetch(`/api/public/r/${encodeURIComponent(code)}/visit`, { method: "POST" })
      .then(async (r) => (r.ok ? setData(await r.json()) : setError((await r.json()).detail ?? "This offer is not available.")))
      .catch(() => setError("Could not load the offer. Check your connection."));
  }, [code]);

  async function claim() {
    const r = await fetch(`/api/public/r/${encodeURIComponent(code)}/claim`, { method: "POST" });
    if (r.ok) setClaimed(true);
  }

  if (error) return <main className="mx-auto max-w-md px-5 py-16 text-center text-ink-2">{error}</main>;
  if (!data) return <main className="mx-auto max-w-md px-5 py-16 text-center text-muted">Loading…</main>;

  return (
    <main className="mx-auto min-h-dvh max-w-md bg-surface" lang={data.language}>
      {data.image_url && <img src={data.image_url} alt="" className="aspect-[4/3] w-full object-cover" />}
      <div className="px-5 py-6">
        <p className="text-sm text-muted">
          {data.name}, {data.locality}
        </p>
        <h1 className="mt-2 text-[26px]">{data.rendered.headline}</h1>
        <p className="mt-3 text-[16px] leading-relaxed text-ink-2">{data.rendered.body}</p>
        {data.rendered.cta && <p className="mt-3 font-medium">{data.rendered.cta}</p>}

        <div className="mt-8 rounded-lg border border-line p-5 text-center">
          {claimed ? (
            <>
              <p className="text-sm text-muted">Show this at the counter</p>
              <p className="mt-2 font-receipt text-[32px] tracking-[0.2em] text-ink">{data.code}</p>
            </>
          ) : (
            <button onClick={claim} className="h-12 w-full rounded-md bg-leaf text-[16px] font-medium text-white hover:bg-leaf-ink">
              Get my code
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
