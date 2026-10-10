"use client";

import { ArrowCounterClockwise, CheckCircle, CheckSquare, ProhibitInset, SealCheck, Square, WarningCircle } from "@phosphor-icons/react";
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";

export interface CounterCheck {
  code: string;
  kind: "claim" | "post";
  verdict: "ok" | "post_code" | "not_valid" | "used" | "redeemed";
  reason: string | null;
  business: { name: string; slug: string };
  campaign: { id: string; name: string };
  offer: string[];
  checks: string[];
  when: string[];
  post: { channel: string; language: string; headline: string | null } | null;
  bill_amount: number | null;
}

/** The two calls a desk makes. The owner's Counter page sends them signed in; a staff phone sends its PIN session. */
export type DeskCall = (action: "check" | "redeem", body: Record<string, unknown>) => Promise<CounterCheck>;

const OVERRIDES = ["The owner said yes", "Regular customer", "Came in just after the time"];

const TONE = {
  ok: { box: "bg-pen text-white", icon: SealCheck, title: "Valid now" },
  post_code: { box: "bg-marker text-ink", icon: WarningCircle, title: "Post code, not a personal one" },
  not_valid: { box: "bg-kumkum text-white", icon: ProhibitInset, title: "Not valid now" },
  used: { box: "bg-kumkum text-white", icon: ProhibitInset, title: "Already used" },
  redeemed: { box: "bg-ink text-white", icon: CheckCircle, title: "Redeemed" },
} as const;

/** Type or scan a code, see whether the offer applies right now, tick what to check by eye, redeem once. */
export function RedeemDesk({ call, initialCode, onRedeemed }: { call: DeskCall; initialCode?: string; onRedeemed?: (c: CounterCheck) => void }) {
  const [code, setCode] = useState(initialCode ?? "");
  const [check, setCheck] = useState<CounterCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bill, setBill] = useState("");
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [override, setOverride] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const started = useRef(false);

  async function look(c: string) {
    const clean = c.trim().toUpperCase();
    if (!clean) return;
    setBusy(true);
    setError(null);
    try {
      setCheck(await call("check", { code: clean }));
      setTicked(new Set());
      setOverride(null);
      setBill("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (initialCode && !started.current) {
      started.current = true;
      look(initialCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCode]);

  async function redeem() {
    if (!check) return;
    setBusy(true);
    setError(null);
    try {
      const done = await call("redeem", {
        code: check.code,
        bill_amount: bill ? Number(bill) : null,
        outside_rules: check.verdict === "not_valid" ? override : null,
      });
      setCheck(done);
      onRedeemed?.(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function next() {
    setCheck(null);
    setCode("");
    setError(null);
    setTimeout(() => input.current?.focus(), 0);
  }

  if (!check)
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          look(code);
        }}
        className="space-y-3"
      >
        <label htmlFor="desk-code" className="block text-[14px] font-semibold">
          Customer's code
        </label>
        <input
          id="desk-code"
          ref={input}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
          placeholder="K7QF3MA"
          autoCapitalize="characters"
          autoComplete="off"
          autoFocus
          maxLength={12}
          className="h-20 w-full rounded-[var(--radius-md)] bg-surface px-5 font-receipt text-[30px] uppercase tracking-[0.25em] outline-none shadow-[inset_0_0_0_1.5px_var(--color-ink)] placeholder:text-ink/15 focus:shadow-[inset_0_0_0_1.5px_var(--color-ink),0_0_0_3px_var(--color-marker)] md:text-[36px]"
        />
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy || code.trim().length < 4}>
          {busy ? "Checking…" : "Check code"}
        </Button>
        {error && (
          <p className="pop rounded-[var(--radius-md)] bg-kumkum-soft px-3.5 py-2.5 text-[14px] text-kumkum" role="alert">
            {error}
          </p>
        )}
        <p className="text-[13px] text-muted">Faster: scan the QR on the customer's screen with this phone's camera.</p>
      </form>
    );

  const tone = TONE[check.verdict];
  const Icon = tone.icon;
  const allTicked = check.checks.every((_, i) => ticked.has(i));
  const canRedeem = check.verdict === "ok" || check.verdict === "post_code" || (check.verdict === "not_valid" && !!override);

  return (
    <div className="pop overflow-hidden rounded-[var(--radius-lg)] bg-surface ring-1 ring-ink" role="status" aria-live="polite">
      <div className={clsx("flex items-start gap-3 px-5 py-4", tone.box)}>
        <Icon size={30} weight="fill" className="shrink-0" aria-hidden />
        <div className="min-w-0">
          <p className="text-[22px] font-bold leading-tight tracking-tight">{tone.title}</p>
          <p className="mt-0.5 font-receipt text-[14px] tracking-[0.2em] opacity-80">{check.code}</p>
        </div>
      </div>

      <div className="space-y-5 px-5 py-5">
        {check.reason && check.verdict !== "redeemed" && <p className="text-[15px] font-medium">{check.reason}</p>}

        <div>
          <p className="text-[13px] font-semibold text-muted">{check.verdict === "redeemed" ? "Give them" : "The offer"}</p>
          <ul className="mt-1 space-y-0.5 text-[18px] font-semibold leading-snug">
            {check.offer.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
          <p className="mt-1 text-[13px] text-muted">{check.campaign.name}</p>
        </div>

        {check.checks.length > 0 && check.verdict !== "used" && check.verdict !== "redeemed" && (
          <div>
            <p className="text-[13px] font-semibold text-muted">Check with your own eyes</p>
            <ul className="mt-1.5 space-y-1.5">
              {check.checks.map((c, i) => {
                const on = ticked.has(i);
                return (
                  <li key={c}>
                    <button
                      type="button"
                      onClick={() => setTicked((t) => (t.has(i) ? new Set([...t].filter((x) => x !== i)) : new Set([...t, i])))}
                      aria-pressed={on}
                      className={clsx("press flex w-full items-center gap-2.5 rounded-[var(--radius-md)] px-3 py-2.5 text-left text-[15px] ring-1", on ? "bg-pen-soft ring-pen/40" : "bg-paper ring-line")}
                    >
                      {on ? <CheckSquare size={20} weight="fill" className="text-pen" aria-hidden /> : <Square size={20} aria-hidden />}
                      {c}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {check.verdict === "not_valid" && (
          <div>
            <p className="text-[13px] font-semibold text-muted">Redeem anyway? Pick why (it is kept in the log)</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {OVERRIDES.map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => setOverride(override === o ? null : o)}
                  aria-pressed={override === o}
                  className={clsx("press rounded-[var(--radius-sm)] px-3 py-1.5 text-[14px]", override === o ? "bg-ink text-white" : "bg-paper ring-1 ring-line-strong")}
                >
                  {o}
                </button>
              ))}
            </div>
          </div>
        )}

        {canRedeem && (
          <label className="block">
            <span className="text-[13px] font-semibold text-muted">What did they pay? Optional, shows sales per post</span>
            <span className="mt-1 flex h-12 items-center rounded-[var(--radius-md)] bg-paper px-4 shadow-[inset_0_0_0_1.5px_var(--color-line-strong)] focus-within:shadow-[inset_0_0_0_1.5px_var(--color-ink)]">
              <span className="mr-1 text-[17px] text-muted">₹</span>
              <input
                inputMode="decimal"
                value={bill}
                onChange={(e) => setBill(e.target.value.replace(/[^\d.]/g, ""))}
                placeholder="Bill amount"
                className="h-full min-w-0 flex-1 bg-transparent text-[17px] outline-none"
                aria-label="Bill amount in rupees"
              />
            </span>
          </label>
        )}

        {error && (
          <p className="pop rounded-[var(--radius-md)] bg-kumkum-soft px-3.5 py-2.5 text-[14px] text-kumkum" role="alert">
            {error}
          </p>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          {canRedeem && (
            <Button variant={check.verdict === "ok" ? "accent" : "primary"} size="lg" className="flex-1" onClick={redeem} disabled={busy || (check.checks.length > 0 && !allTicked)}>
              {busy ? "Redeeming…" : check.checks.length > 0 && !allTicked ? "Tick the checks first" : check.verdict === "ok" ? "Redeem" : "Redeem anyway"}
            </Button>
          )}
          <Button variant={check.verdict === "redeemed" ? "primary" : "secondary"} size="lg" className={clsx(!canRedeem && "flex-1")} onClick={next} trailing={<ArrowCounterClockwise size={15} weight="bold" />}>
            {check.verdict === "redeemed" ? "Next customer" : "Another code"}
          </Button>
        </div>
      </div>
    </div>
  );
}
