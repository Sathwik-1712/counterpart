"use client";

import { BookOpenText, Megaphone, QrCode, Receipt as ReceiptIcon, SunHorizon, UsersThree, X } from "@phosphor-icons/react";
import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Receipt } from "./receipt";

const NAV = [
  { href: "/", label: "Today", icon: SunHorizon },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/customers", label: "Customers", icon: UsersThree },
  { href: "/brand", label: "Brand", icon: BookOpenText },
  { href: "/counter", label: "Counter", icon: QrCode },
];

export function Shell({ children, campaignId }: { children: ReactNode; campaignId?: string }) {
  const path = usePathname();
  const [logOpen, setLogOpen] = useState(false);
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
      <header className="sticky top-0 z-30 border-b border-line/80 bg-paper/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-6 px-4 md:px-8">
          <Link href="/" className="flex items-center gap-2.5">
            <img src="/icon.svg" alt="" className="h-8 w-8" />
            <span className="leading-tight">
              <span className="block text-[15px] font-semibold tracking-tight">Counterpart</span>
              <span className="block text-xs text-muted">Kaapi Kone</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {NAV.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                aria-current={active(href) ? "page" : undefined}
                className={clsx(
                  "press rounded-full px-3.5 py-1.5 text-sm",
                  active(href) ? "bg-ink text-white" : "text-ink-2 hover:bg-sunken hover:text-ink",
                )}
              >
                {label}
              </Link>
            ))}
          </nav>
          <span className="flex-1" />
          <button
            onClick={() => setLogOpen(true)}
            className="press inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:text-ink 2xl:hidden"
          >
            <ReceiptIcon size={16} weight="regular" aria-hidden />
            Work log
          </button>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1440px] flex-1 gap-8 px-4 md:px-8">
        <main id="main" className="min-w-0 flex-1 pb-28 pt-8 md:pb-16">
          {children}
        </main>
        <div className="hidden w-[300px] shrink-0 2xl:block">
          <Receipt campaignId={campaignId} className="sticky top-20 mt-8 h-[calc(100dvh-7rem)] overflow-hidden rounded-[var(--radius-lg)] shadow-[var(--shadow-soft)] ring-1 ring-line/70" />
        </div>
      </div>

      {logOpen && (
        <div className="fixed inset-0 z-40 flex justify-end bg-ink/25 2xl:hidden" onClick={() => setLogOpen(false)}>
          <div className="rise-in flex h-full w-[88%] max-w-[360px] flex-col bg-paper shadow-[var(--shadow-lift)]" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Work log">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm font-medium">Work log</span>
              <button onClick={() => setLogOpen(false)} className="press rounded-full p-1.5 text-ink-2 hover:bg-sunken" aria-label="Close work log">
                <X size={18} aria-hidden />
              </button>
            </div>
            <Receipt campaignId={campaignId} className="flex flex-1" />
          </div>
        </div>
      )}

      <nav className="fixed inset-x-3 bottom-3 z-30 flex rounded-full bg-ink/95 p-1.5 shadow-[var(--shadow-lift)] backdrop-blur md:hidden" aria-label="Main">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={active(href) ? "page" : undefined}
            className={clsx("press flex flex-1 flex-col items-center gap-0.5 rounded-full py-1.5 text-[11px]", active(href) ? "bg-white text-ink" : "text-white/70")}
          >
            <Icon size={19} weight={active(href) ? "fill" : "regular"} aria-hidden />
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
