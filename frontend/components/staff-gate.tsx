"use client";

import { LockKey } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { RedeemDesk, type CounterCheck, type DeskCall } from "@/components/redeem-desk";
import { Button } from "@/components/ui";
import { ApiError } from "@/lib/api";

const KEY = "cp_counter_token";

function stored(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

async function post(path: string, body: unknown): Promise<CounterCheck> {
  const r = await fetch(`/api${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, typeof data.detail === "string" ? data.detail : "Something went wrong. Try again.");
  return data;
}

/** A staff phone at the counter. Signed in as the owner it just works; otherwise the counter PIN, once. */
export function StaffGate({ code, business }: { code?: string; business?: string }) {
  const [mode, setMode] = useState<"owner" | "staff" | "pin" | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    // The owner's own phone is signed in: use that. Else a staff session, else ask for the PIN.
    fetch("/api/me").then((r) => setMode(r.ok ? "owner" : stored() ? "staff" : "pin"), () => setMode(stored() ? "staff" : "pin"));
  }, []);

  const call: DeskCall = async (action, body) => {
    try {
      const res = mode === "owner" ? await post(`/counter/${action}`, body) : await post(`/public/counter/${action}`, { ...body, token: stored() });
      setName(res.business.name);
      return res;
    } catch (e) {
      if (e instanceof ApiError && mode === "owner" && e.status === 404 && e.message === "not found") {
        setMode(stored() ? "staff" : "pin"); // signed in, but to another business: this code is not theirs
      } else if (e instanceof ApiError && mode === "staff" && e.status === 401) {
        try {
          localStorage.removeItem(KEY); // the owner changed the PIN
        } catch {}
        setMode("pin");
      }
      throw e;
    }
  };

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/public/counter/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pin, code: code ?? null, business: business ?? null }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Could not sign in.");
      try {
        localStorage.setItem(KEY, data.token);
      } catch {}
      setMode("staff");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setPin("");
    }
  }

  return (
    <main className="mx-auto min-h-dvh max-w-md px-4 py-8">
      <div className="mb-6 flex items-center gap-2.5">
        <img src="/icon.svg" alt="" className="h-8 w-8" />
        <div>
          <p className="text-[15px] font-semibold leading-tight">{name ?? "Counter"}</p>
          <p className="text-[12px] text-muted">{mode === "owner" ? "Signed in as the owner" : mode === "staff" ? "Staff phone" : "For staff at the counter"}</p>
        </div>
      </div>
      {mode === null && <div className="skeleton h-48 w-full" />}
      {mode === "pin" && (
        <form onSubmit={signIn} className="space-y-4">
          <div className="rounded-[var(--radius-lg)] bg-marker-soft p-4 ring-1 ring-ink/15">
            <p className="text-[15px] font-semibold">Customer? Show this screen to the staff.</p>
            <p className="mt-0.5 text-[14px] text-ink-2">They redeem your code here.</p>
          </div>
          <label className="block">
            <span className="flex items-center gap-1.5 text-[14px] font-semibold">
              <LockKey size={16} aria-hidden /> Staff: counter PIN
            </span>
            <input
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="off"
              className="mt-1.5 h-14 w-full rounded-[var(--radius-md)] bg-surface px-4 text-center font-receipt text-[26px] tracking-[0.5em] outline-none shadow-[inset_0_0_0_1.5px_var(--color-ink)] focus:shadow-[inset_0_0_0_1.5px_var(--color-ink),0_0_0_3px_var(--color-marker)]"
              aria-label="Counter PIN"
            />
          </label>
          <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy || pin.length < 4}>
            {busy ? "Checking…" : "Use this phone at the counter"}
          </Button>
          {error && (
            <p className="rounded-[var(--radius-md)] bg-kumkum-soft px-3.5 py-2.5 text-[14px] text-kumkum" role="alert">
              {error}
            </p>
          )}
          <p className="text-[13px] text-muted">The owner sets the PIN on the Counter page. This phone stays signed in for 30 days.</p>
        </form>
      )}
      {(mode === "owner" || mode === "staff") && <RedeemDesk key={mode} call={call} initialCode={code} />}
    </main>
  );
}
