"use client";

import { CheckCircle, QrCode, WarningCircle } from "@phosphor-icons/react";
import clsx from "clsx";
import { useRef, useState } from "react";
import { Shell } from "@/components/shell";
import { Button, Empty, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";

/** Staff screen: a customer shows a code, staff type it, the redemption is attributed. */
export default function CounterPage() {
  const [code, setCode] = useState("");
  const [log, setLog] = useState<{ code: string; ok: boolean; msg: string; at: Date }[]>([]);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const last = log[0];
  const redeemed = log.filter((l) => l.ok).length;

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
      input.current?.focus();
    }
  }

  return (
    <Shell>
      <PageHeader title="Counter" sub="Type the code from the customer's phone or poster. Each redemption counts for the message that brought them in." />
      <div className="grid gap-8 lg:grid-cols-12">
        <section className="rise-in lg:col-span-7" aria-label="Redeem a code">
          <div className="night rounded-[var(--radius-xl)] p-6 md:p-10">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-marker">
                <QrCode size={22} aria-hidden />
              </span>
              <div>
                <p className="text-[17px] font-semibold tracking-tight">Redeem a code</p>
                <p className="text-sm text-white/60">Six letters and numbers, printed under “Show this at the counter”.</p>
              </div>
            </div>
            <form onSubmit={redeem} className="mt-8 space-y-3">
              <label htmlFor="code" className="text-[13px] text-white/60">
                Offer code
              </label>
              <input
                id="code"
                ref={input}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="K7QF3M"
                autoCapitalize="characters"
                autoComplete="off"
                autoFocus
                maxLength={12}
                className="h-20 w-full rounded-[var(--radius-md)] bg-white/[0.07] px-6 font-receipt text-[34px] uppercase tracking-[0.3em] text-white outline-none ring-1 ring-white/15 placeholder:text-white/20 focus:ring-2 focus:ring-marker md:text-[40px]"
              />
              <Button type="submit" variant="light" size="lg" className="w-full" disabled={busy || !code.trim()}>
                {busy ? "Checking…" : "Redeem"}
              </Button>
            </form>
            {last && (
              <div
                key={log.length}
                role="status"
                className={clsx("pop mt-6 flex items-center gap-3 rounded-[var(--radius-md)] p-4", last.ok ? "bg-marker/15 text-marker" : "bg-kumkum/20 text-[#ffb4ab]")}
              >
                {last.ok ? <CheckCircle size={26} weight="fill" aria-hidden /> : <WarningCircle size={26} weight="fill" aria-hidden />}
                <div>
                  <p className="font-receipt text-[15px] tracking-widest text-white">{last.code}</p>
                  <p className="text-sm">{last.ok ? "Redeemed. Give the customer their offer." : last.msg}</p>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="lg:col-span-5" aria-labelledby="session-h">
          <div className="mb-5 flex items-end justify-between">
            <h2 id="session-h" className="text-[22px]">
              This shift
            </h2>
            <p className="text-sm text-muted">
              <span className="text-[22px] font-semibold tabular-nums text-ink">{redeemed}</span> redeemed
            </p>
          </div>
          {log.length === 0 ? (
            <Empty icon={<QrCode size={17} aria-hidden />}>Codes you redeem on this screen appear here.</Empty>
          ) : (
            <ul className="overflow-hidden rounded-[var(--radius-lg)] bg-receipt font-receipt text-[13px] shadow-[var(--shadow-soft)] ring-1 ring-line/80">
              {log.map((l, i) => (
                <li key={i} className="print-in flex items-center gap-3 border-b border-dashed border-line px-5 py-3 last:border-0">
                  {l.ok ? <CheckCircle size={16} weight="fill" className="text-pen" aria-hidden /> : <WarningCircle size={16} weight="fill" className="text-kumkum" aria-hidden />}
                  <span className="tracking-widest">{l.code}</span>
                  <span className={clsx("min-w-0 flex-1 truncate", l.ok ? "text-pen-ink" : "text-kumkum")}>{l.msg}</span>
                  <span className="text-muted">{l.at.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Shell>
  );
}
