"use client";

import { BookOpenText, Megaphone, QrCode, Receipt as ReceiptIcon, SunHorizon, UsersThree, X } from "@phosphor-icons/react";
import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useLedgerEvents } from "@/lib/api";
import { Receipt } from "./receipt";

const NAV = [
  { href: "/", label: "Today", icon: SunHorizon },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/customers", label: "Customers", icon: UsersThree },
  { href: "/brand", label: "Brand", icon: BookOpenText },
  { href: "/counter", label: "Counter", icon: QrCode },
];

/** True for a short while after the agent writes to the ledger: a real "working" signal, not decoration. */
function useAgentWorking() {
  const [last, setLast] = useState(0);
  const [now, setNow] = useState(0);
  useLedgerEvents((e) => e.actor === "agent" && setLast(Date.now()));
  useEffect(() => {
    if (!last) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(t);
  }, [last]);
  return last > 0 && now - last < 20000;
}

export function Shell({ children, campaignId }: { children: ReactNode; campaignId?: string }) {
  const path = usePathname();
  const [logOpen, setLogOpen] = useState(false);
  const working = useAgentWorking();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  useEffect(() => {
    if (!logOpen) return;
    const close = (e: KeyboardEvent) => e.key === "Escape" && setLogOpen(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [logOpen]);

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-white">
        Skip to content
      </a>
      <header className="sticky top-0 z-30 px-3 pt-3 md:px-6">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-4 rounded-full bg-white/75 pl-2 pr-2 shadow-[var(--shadow-soft)] ring-1 ring-ink/[0.07] backdrop-blur-xl">
          <Link href="/" className="press flex items-center gap-2.5 rounded-full py-1 pl-1 pr-3">
            <img src="/icon.svg" alt="" className="h-9 w-9" />
            <span className="leading-tight">
              <span className="block text-[15px] font-semibold tracking-tight">Counterpart</span>
              <span className="block text-[11px] text-muted">for Kaapi Kone</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-0.5 rounded-full bg-ink/[0.04] p-1 md:flex" aria-label="Main">
            {NAV.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                aria-current={active(href) ? "page" : undefined}
                className={clsx(
                  "press inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm",
                  active(href) ? "bg-ink text-white shadow-[var(--shadow-soft)]" : "text-ink-2 hover:bg-white hover:text-ink",
                )}
              >
                <Icon size={15} weight={active(href) ? "fill" : "regular"} aria-hidden className="hidden lg:block" />
                {label}
              </Link>
            ))}
          </nav>
          <span className="flex-1" />
          <button
            onClick={() => setLogOpen(true)}
            className={clsx(
              "press inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm 2xl:pointer-events-none",
              working ? "bg-forest text-white" : "text-ink-2 hover:bg-ink/[0.05] hover:text-ink",
            )}
            aria-label={working ? "Counterpart is working. Open the work log" : "Open the work log"}
          >
            {working ? <span className="pulse-dot h-2 w-2 rounded-full bg-mint" aria-hidden /> : <ReceiptIcon size={17} aria-hidden />}
            <span className={clsx(!working && "2xl:hidden")}>{working ? "Working" : "Work log"}</span>
          </button>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1440px] flex-1 gap-8 px-4 md:px-8">
        <main id="main" className="min-w-0 flex-1 pb-32 pt-10 md:pb-20 md:pt-12">
          {children}
        </main>
        <div className="hidden w-[300px] shrink-0 2xl:block">
          <Receipt campaignId={campaignId} className="sticky top-24 mt-12 h-[calc(100dvh-8rem)] overflow-hidden rounded-[var(--radius-lg)] shadow-[var(--shadow-soft)] ring-1 ring-line/70" />
        </div>
      </div>

      {logOpen && (
        <div className="fixed inset-0 z-40 flex justify-end bg-forest/30 backdrop-blur-[2px] 2xl:hidden" onClick={() => setLogOpen(false)}>
          <div className="rise-in flex h-full w-[88%] max-w-[380px] flex-col bg-paper shadow-[var(--shadow-float)]" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Work log">
            <div className="flex items-center justify-between px-5 py-4">
              <span className="text-[15px] font-semibold">Work log</span>
              <button onClick={() => setLogOpen(false)} className="press rounded-full p-2 text-ink-2 hover:bg-sunken" aria-label="Close work log">
                <X size={18} aria-hidden />
              </button>
            </div>
            <Receipt campaignId={campaignId} className="flex flex-1" />
          </div>
        </div>
      )}

      <nav className="fixed inset-x-3 bottom-3 z-30 flex rounded-full bg-forest/95 p-1.5 shadow-[var(--shadow-float)] ring-1 ring-white/10 backdrop-blur-xl md:hidden" aria-label="Main">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={active(href) ? "page" : undefined}
            className={clsx("press flex flex-1 flex-col items-center gap-0.5 rounded-full py-1.5 text-[11px]", active(href) ? "bg-white text-ink" : "text-white/65")}
          >
            <Icon size={19} weight={active(href) ? "fill" : "regular"} aria-hidden />
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
