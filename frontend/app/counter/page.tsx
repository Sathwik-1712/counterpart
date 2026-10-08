"use client";

import { useState } from "react";
import { Shell } from "@/components/shell";
import { Button } from "@/components/ui";
import { api } from "@/lib/api";

/** Staff screen: a customer shows a code, staff type it, the redemption is attributed. */
export default function CounterPage() {
  const [code, setCode] = useState("");
  const [log, setLog] = useState<{ code: string; ok: boolean; msg: string; at: Date }[]>([]);
  const [busy, setBusy] = useState(false);

  async function redeem(e: React.FormEvent) {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (!c) return;
    setBusy(true);
    try {
      await api("/counter/redeem", { method: "POST", json: { code: c } });
      setLog((l) => [{ code: c, ok: true, msg: "Redeemed", at: new Date() }, ...l]);
      setCode("");
    } catch (err) {
      setLog((l) => [{ code: c, ok: false, msg: err instanceof Error ? err.message : "Failed", at: new Date() }, ...l]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <h1 className="mb-1 text-[26px]">Counter</h1>
      <p className="mb-6 text-sm text-muted">Type the code from the customer's phone or poster. Each redemption counts for the message that brought them in.</p>
      <form onSubmit={redeem} className="flex max-w-md gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="e.g. K7QF3M"
          autoCapitalize="characters"
          autoComplete="off"
          aria-label="Offer code"
          className="h-12 flex-1 rounded-md border border-line-strong bg-surface px-4 font-receipt text-lg tracking-widest uppercase outline-none focus:border-ink-2"
        />
        <Button type="submit" variant="primary" className="h-12 px-6" disabled={busy || !code.trim()}>
          Redeem
        </Button>
      </form>
      <ul className="mt-8 max-w-md divide-y divide-line border-y border-line text-sm">
        {log.map((l, i) => (
          <li key={i} className="flex justify-between gap-3 py-2">
            <span className="font-receipt">{l.code}</span>
            <span className={l.ok ? "text-leaf-ink" : "text-kumkum"}>{l.msg}</span>
            <span className="text-muted">{l.at.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
          </li>
        ))}
      </ul>
    </Shell>
  );
}
