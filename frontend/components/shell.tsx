"use client";

import clsx from "clsx";
import { BookOpen, Inbox, Megaphone, ReceiptText, ScanLine, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Receipt } from "./receipt";

const NAV = [
  { href: "/", label: "Today", icon: Inbox },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/brand", label: "Brand & memory", icon: BookOpen },
  { href: "/counter", label: "Counter", icon: ScanLine },
];

export function Shell({ children, campaignId }: { children: ReactNode; campaignId?: string }) {
  const path = usePathname();
  const [logOpen, setLogOpen] = useState(false);
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <div className="flex h-dvh flex-col md:flex-row">
      <nav className="hidden w-56 shrink-0 flex-col border-r border-line px-3 py-5 md:flex" aria-label="Main">
        <Link href="/" className="mb-8 px-2">
          <span className="block font-display text-[19px] font-semibold leading-none">Counterpart</span>
          <span className="mt-1 block text-[13px] text-muted">for Kaapi Kone</span>
        </Link>
        <ul className="space-y-0.5">
          {NAV.map(({ href, label, icon: Icon }) => (
            <li key={href}>
              <Link
                href={href}
                className={clsx(
                  "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm",
                  active(href) ? "bg-surface font-medium text-ink shadow-[inset_0_0_0_1px_var(--color-line)]" : "text-ink-2 hover:text-ink",
                )}
              >
                <Icon size={16} strokeWidth={1.75} aria-hidden />
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <main className="min-w-0 flex-1 overflow-y-auto pb-20 md:pb-0">
        <div className="mx-auto max-w-[980px] px-4 py-6 md:px-8 md:py-8">{children}</div>
      </main>

      <Receipt campaignId={campaignId} className="hidden w-[300px] shrink-0 border-l border-line lg:flex" />

      {logOpen && (
        <div className="fixed inset-0 z-40 flex justify-end bg-ink/20 lg:hidden" onClick={() => setLogOpen(false)}>
          <div className="flex h-full w-[86%] max-w-[340px] flex-col bg-paper" onClick={(e) => e.stopPropagation()}>
            <Receipt campaignId={campaignId} className="flex flex-1" />
          </div>
        </div>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface md:hidden" aria-label="Main">
        {NAV.slice(0, 4).map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={clsx("flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]", active(href) ? "text-ink" : "text-muted")}>
            <Icon size={18} strokeWidth={1.75} aria-hidden />
            {label.split(" ")[0]}
          </Link>
        ))}
        <button onClick={() => setLogOpen(true)} className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] text-muted lg:hidden">
          <ReceiptText size={18} strokeWidth={1.75} aria-hidden />
          Log
        </button>
      </nav>
    </div>
  );
}
