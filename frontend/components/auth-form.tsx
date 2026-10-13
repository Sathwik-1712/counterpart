"use client";

import { ArrowRight, Eye, EyeSlash, LockKey } from "@phosphor-icons/react";
import clsx from "clsx";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "./ui";

interface Showcase {
  headline: string;
  offer: string | null;
  name: string;
  language: string;
  image_url: string;
}


const SPOTS = ["left-[0%] top-[6%] -rotate-[5deg]", "left-[50%] top-[0%] rotate-[4deg]", "left-[25%] top-[22%] -rotate-[1deg]"];

function Showcase() {
  const [posts, setPosts] = useState<Showcase[]>([]);
  useEffect(() => {
    fetch("/api/public/showcase")
      .then((r) => (r.ok ? r.json() : []))
      .then(setPosts)
      .catch(() => {});
  }, []);
  return (
    <div className="relative h-[330px]" aria-hidden>
      {posts.map((p, i) => (
        <div
          key={p.image_url}
          className={clsx("fan-in absolute w-[40%] max-w-[230px]", SPOTS[i])}
          style={{ "--i": i } as React.CSSProperties}
        >
          <div className="overflow-hidden rounded-[var(--radius-sm)] bg-white p-1.5 shadow-[var(--shadow-float)] ring-1 ring-ink/10">
            <div className="relative aspect-square">
              <img src={p.image_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.35),transparent_40%,transparent_55%,rgba(0,0,0,0.55))]" />
              <p className="absolute left-3 right-3 top-3 text-[17px] font-bold leading-tight text-white [font-stretch:90%]" lang={p.language}>
                {p.headline}
              </p>
              {p.offer && (
                <p className="absolute bottom-3 left-3 rounded-[var(--radius-sm)] bg-white px-2.5 py-1.5 text-[13px] font-semibold text-ink" lang={p.language}>
                  {p.offer}
                </p>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState<"form" | "demo" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const signup = mode === "signup";

  async function go(action: "login" | "signup" | "demo") {
    setBusy(action === "demo" ? "demo" : "form");
    setError(null);
    try {
      const r = await fetch(`/api/session/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: action === "demo" ? "{}" : JSON.stringify({ email: email.trim(), password }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.detail ?? "Something went wrong. Try again.");
      if (action === "demo") {
        try {
          localStorage.setItem("cp_business", "kaapi-kone");
        } catch {}
      }
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.href = action === "signup" ? "/onboarding" : next && next.startsWith("/") ? next : "/";
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  return (
    <main className="grid grid-cols-1 min-h-dvh lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
      <section className="relative hidden flex-col justify-between overflow-hidden border-r border-ink px-12 py-10 lg:flex">
        <div className="flex items-center gap-2.5">
          <img src="/icon.svg" alt="" className="h-9 w-9" />
          <span className="text-[20px] font-bold [font-stretch:90%]">Counterpart</span>
        </div>
        <div>
          <h1 className="rise-in max-w-[14ch] text-[64px] leading-[0.92] xl:text-[76px]">
            The marketing employee <span className="hl hl-in">behind your counter.</span>
          </h1>
          <ol className="mt-10 grid max-w-[620px] grid-cols-5 border-y border-ink">
            {[
              ["Brief", "You say the offer"],
              ["Offer", "You lock the details"],
              ["Posts", "Written and checked"],
              ["Share", "Links and QR codes"],
              ["Results", "Counted at the counter"],
            ].map(([t, d], i) => (
              <li key={t} className={clsx("rise-in px-3 py-3", i > 0 && "border-l border-ink")} style={{ "--i": i + 2 } as React.CSSProperties}>
                <span className="font-mono text-[12px] font-semibold text-muted">{String(i + 1).padStart(2, "0")}</span>
                <span className="block text-[19px] font-bold [font-stretch:90%]">{t}</span>
                <span className="block text-[12px] leading-snug text-muted">{d}</span>
              </li>
            ))}
          </ol>
          <p className="rise-in mt-6 max-w-[54ch] text-[16px] text-ink-2" style={{ "--i": 7 } as React.CSSProperties}>
            Tell it the offer in your own words. It writes the posts in English, ಕನ್ನಡ and हिन्दी, checks every one against what you locked, and counts who actually walks in.
          </p>
        </div>
        <Showcase />
      </section>

      <section className="flex items-center justify-center px-5 py-12 md:px-10">
        <div className="w-full max-w-[420px]">
          <div className="mb-10 flex items-center gap-2.5 lg:hidden">
            <img src="/icon.svg" alt="" className="h-9 w-9" />
            <span className="text-[17px] font-semibold tracking-tight">Counterpart</span>
          </div>
          <h2 className="rise-in text-[44px]">{signup ? "Create your account" : "Welcome back"}</h2>
          <p className="rise-in mt-2 text-[15px] text-ink-2" style={{ "--i": 1 } as React.CSSProperties}>
            {signup ? "Set up your business in about two minutes." : "Sign in to your business."}
          </p>

          <form
            className="rise-in mt-8 space-y-4"
            style={{ "--i": 2 } as React.CSSProperties}
            onSubmit={(e) => {
              e.preventDefault();
              go(mode);
            }}
          >
            <label className="block">
              <span className="text-sm font-medium">Email</span>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1.5 h-12 w-full rounded-[var(--radius-md)] bg-surface px-4 text-[15px] shadow-[inset_0_0_0_1.5px_var(--color-ink)] outline-none transition-shadow focus:shadow-[inset_0_0_0_1.5px_var(--color-ink),0_0_0_3px_var(--color-marker)]"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Password</span>
              <span className="relative mt-1.5 block">
                <input
                  type={show ? "text" : "password"}
                  required
                  minLength={8}
                  autoComplete={signup ? "new-password" : "current-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-12 w-full rounded-[var(--radius-md)] bg-surface pl-4 pr-12 text-[15px] shadow-[inset_0_0_0_1.5px_var(--color-ink)] outline-none transition-shadow focus:shadow-[inset_0_0_0_1.5px_var(--color-ink),0_0_0_3px_var(--color-marker)]"
                />
                <button type="button" onClick={() => setShow(!show)} className="absolute right-2 top-2 rounded-[var(--radius-sm)] p-2 text-muted hover:text-ink" aria-label={show ? "Hide password" : "Show password"}>
                  {show ? <EyeSlash size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
                </button>
              </span>
              {signup && <span className="mt-1.5 block text-[13px] text-muted">At least 8 characters.</span>}
            </label>
            {error && (
              <p className="pop rounded-[var(--radius-md)] bg-kumkum-soft px-3.5 py-2.5 text-sm text-kumkum" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy !== null} trailing={<ArrowRight size={15} weight="bold" />}>
              {busy === "form" ? (signup ? "Creating…" : "Signing in…") : signup ? "Create account" : "Sign in"}
            </Button>
          </form>

          <div className="rise-in my-6 flex items-center gap-3 text-[13px] text-muted" style={{ "--i": 3 } as React.CSSProperties}>
            <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
          </div>
          <div className="rise-in" style={{ "--i": 4 } as React.CSSProperties}>
            <Button variant="secondary" size="lg" className="w-full" onClick={() => go("demo")} disabled={busy !== null}>
              {busy === "demo" ? "Opening the demo…" : "Try the demo business"}
            </Button>
            <p className="mt-2 text-center text-[13px] text-muted">Kaapi Kone, a sample café with past campaigns and synthetic results.</p>
          </div>

          <p className="mt-10 text-center text-sm text-ink-2">
            {signup ? "Already have an account? " : "New to Counterpart? "}
            <Link href={signup ? "/login" : "/signup"} className="font-semibold text-ink underline decoration-ink/30 underline-offset-4 hover:decoration-ink">
              {signup ? "Sign in" : "Create an account"}
            </Link>
          </p>
          <p className="mt-6 flex items-center justify-center gap-1.5 text-[13px] text-muted">
            <LockKey size={13} aria-hidden /> Your sign-in is kept on the server, never in the page.
          </p>
        </div>
      </section>
    </main>
  );
}
