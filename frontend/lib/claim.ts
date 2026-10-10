"use client";

import { useEffect, useState } from "react";

export interface ClaimStatus {
  code: string;
  status: "claimed" | "redeemed";
  redeemed_at: string | null;
  language: string;
  name: string;
  locality: string;
  offer: string[];
  review: { rating: number; body: string } | null;
  google_review_url: string | null;
}

const EVERY_MS = 6000;
const STOP_AFTER_MS = 20 * 60 * 1000;

/** A personal code's status, re-checked every few seconds while the customer waits at the counter, so the review
 *  form appears the moment staff redeem it. Stops once redeemed, after 20 minutes, or while the tab is hidden. */
export function useClaimStatus(code: string | null) {
  const [data, setData] = useState<ClaimStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const started = Date.now();
    const tick = async () => {
      if (stop) return;
      if (document.visibilityState === "visible") {
        try {
          const r = await fetch(`/api/public/claims/${encodeURIComponent(code)}`, { cache: "no-store" });
          const body = await r.json();
          if (!r.ok) return setError(body.detail ?? "This code does not exist.");
          setData(body);
          if (body.status === "redeemed") return;
        } catch {
          // a dropped connection is retried on the next tick
        }
      }
      if (Date.now() - started < STOP_AFTER_MS) timer = setTimeout(tick, EVERY_MS);
    };
    tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [code]);

  return { data, error };
}
