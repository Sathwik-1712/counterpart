"use client";

import {
  BookOpenText,
  CaretUpDown,
  ChartLineUp,
  Check,
  DotsThreeOutline,
  Images,
  Megaphone,
  Plus,
  QrCode,
  Robot,
  SignOut,
  SunHorizon,
  UsersThree,
  X,
} from "@phosphor-icons/react";
import clsx from "clsx";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLedgerEvents } from "@/lib/api";
import { useWorkspace } from "@/lib/business";
import { Receipt } from "./receipt";

const NAV = [
  { href: "/", label: "Today", icon: SunHorizon },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/results", label: "Results", icon: ChartLineUp },
  { href: "/customers", label: "Customers", icon: UsersThree },
  { href: "/photos", label: "Photos", icon: Images },
  { href: "/brand", label: "Brand", icon: BookOpenText },
  { href: "/counter", label: "Counter", icon: QrCode },
];
const MOBILE_MAIN = NAV.filter((n) => ["/", "/campaigns", "/results", "/photos"].includes(n.href));
const MOBILE_MORE = [...NAV.filter((n) => !MOBILE_MAIN.includes(n)), { href: "/agents", label: "Agents", icon: Robot }];

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

async function signOut() {
  await fetch("/api/session/logout", { method: "POST" }).catch(() => {});
  window.location.href = "/login";
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

/** The business badge doubles as the account menu: switch business, add one, sign out. */
function BusinessMenu() {
  const { me, business, select } = useWorkspace();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="press flex items-center gap-2.5 rounded-full py-1 pl-1 pr-2.5 hover:bg-ink/[0.04]"
      >
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-forest text-[13px] font-semibold text-mint">{initials(business.name)}</span>
        <span className="block text-left leading-tight">
          <span className="block max-w-[130px] truncate text-[14px] font-semibold tracking-tight sm:max-w-[160px]">{business.name}</span>
          <span className="block text-[11px] text-muted">{business.is_demo ? "Demo business" : (business.kind ?? business.locality)}</span>
        </span>
        <CaretUpDown size={14} className="text-muted" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="pop absolute left-0 top-12 z-50 w-72 origin-top-left rounded-[20px] bg-surface p-2 shadow-[var(--shadow-float)] ring-1 ring-line">
          <p className="truncate px-3 pb-2 pt-1 text-xs text-muted">{me.user.email}</p>
          {me.businesses.map((b) => (
            <button
              key={b.slug}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                select(b.slug);
              }}
              className="press flex w-full items-center gap-3 rounded-[14px] px-3 py-2 text-left hover:bg-sunken"
            >
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-forest text-[12px] font-semibold text-mint">{initials(b.name)}</span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-[14px] font-medium">{b.name}</span>
                <span className="block text-[11px] text-muted">{b.is_demo ? "Demo business" : `${b.locality}, ${b.city}`}</span>
              </span>
              {b.slug === business.slug && <Check size={15} weight="bold" className="text-leaf" aria-hidden />}
            </button>
          ))}
          <div className="my-1.5 h-px bg-line" />
          <Link href="/onboarding" role="menuitem" className="press flex items-center gap-3 rounded-[14px] px-3 py-2 text-[14px] hover:bg-sunken">
            <Plus size={16} aria-hidden /> Add a business
          </Link>
          <button role="menuitem" onClick={signOut} className="press flex w-full items-center gap-3 rounded-[14px] px-3 py-2 text-[14px] text-ink-2 hover:bg-sunken">
            <SignOut size={16} aria-hidden /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function Shell({ children, campaignId }: { children: ReactNode; campaignId?: string }) {
  const path = usePathname();
  const router = useRouter();
  const { business } = useWorkspace();
  const [more, setMore] = useState(false);
  const working = useAgentWorking();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  useEffect(() => setMore(false), [path]);
  useEffect(() => {
    NAV.forEach((n) => router.prefetch(n.href));
  }, [router]);

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-white">
        Skip to content
      </a>
      <header className="sticky top-0 z-30 px-3 pt-3 md:px-6">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-3 rounded-full bg-white/75 pl-1.5 pr-1.5 shadow-[var(--shadow-soft)] ring-1 ring-ink/[0.07] backdrop-blur-xl">
          <BusinessMenu />
          <nav className="hidden items-center gap-0.5 rounded-full bg-ink/[0.04] p-1 md:flex" aria-label="Main">
            {NAV.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                title={label}
                aria-current={active(href) ? "page" : undefined}
                className={clsx(
                  "press relative inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm",
                  active(href) ? "bg-ink text-white shadow-[var(--shadow-soft)]" : "text-ink-2 hover:bg-white hover:text-ink",
                )}
              >
                <Icon size={16} weight={active(href) ? "fill" : "regular"} aria-hidden />
                <span className="hidden xl:inline">{label}</span>
              </Link>
            ))}
          </nav>
          <span className="flex-1" />
          {business.is_demo && <span className="hidden rounded-full bg-turmeric-soft px-2.5 py-1 text-xs font-medium text-turmeric lg:inline">Demo data</span>}
          <Link
            href="/agents"
            className={clsx(
              "press inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm",
              working ? "bg-forest text-white" : active("/agents") ? "bg-ink text-white" : "text-ink-2 hover:bg-ink/[0.05] hover:text-ink",
            )}
            aria-label={working ? "Counterpart is working. See the agents" : "See what the agents are doing"}
          >
            {working ? <span className="pulse-dot h-2 w-2 rounded-full bg-mint" aria-hidden /> : <Robot size={17} aria-hidden />}
            <span>{working ? "Working" : "Agents"}</span>
          </Link>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1440px] flex-1 gap-8 px-4 md:px-8">
        <main id="main" className="page-in min-w-0 flex-1 pb-32 pt-10 md:pb-20 md:pt-12">
          {children}
        </main>
        {path !== "/agents" && (
          <div className="hidden w-[300px] shrink-0 2xl:block">
            <Receipt campaignId={campaignId} className="sticky top-24 mt-12 h-[calc(100dvh-8rem)] overflow-hidden rounded-[var(--radius-lg)] shadow-[var(--shadow-soft)] ring-1 ring-line/70" />
          </div>
        )}
      </div>

      {more && (
        <div className="fixed inset-0 z-40 bg-forest/30 backdrop-blur-[2px] md:hidden" onClick={() => setMore(false)}>
          <div
            className="sheet-up absolute inset-x-3 bottom-24 rounded-[28px] bg-surface p-3 shadow-[var(--shadow-float)]"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="More"
          >
            <div className="grid grid-cols-2 gap-2">
              {MOBILE_MORE.map(({ href, label, icon: Icon }, i) => (
                <Link
                  key={href}
                  href={href}
                  style={{ "--i": i } as React.CSSProperties}
                  className={clsx("rise-in press flex items-center gap-3 rounded-[18px] p-4 text-[15px] font-medium", active(href) ? "bg-ink text-white" : "bg-sunken/70 text-ink")}
                >
                  <Icon size={20} weight={active(href) ? "fill" : "regular"} aria-hidden />
                  {label}
                </Link>
              ))}
            </div>
            <button onClick={signOut} className="press mt-2 flex w-full items-center justify-center gap-2 rounded-[18px] p-3 text-sm text-ink-2 hover:bg-sunken">
              <SignOut size={16} aria-hidden /> Sign out
            </button>
          </div>
        </div>
      )}

      <nav className="fixed inset-x-3 bottom-3 z-40 flex rounded-full bg-forest/95 p-1.5 shadow-[var(--shadow-float)] ring-1 ring-white/10 backdrop-blur-xl md:hidden" aria-label="Main">
        {MOBILE_MAIN.map(({ href, label, icon: Icon }) => (
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
        <button
          onClick={() => setMore(!more)}
          aria-expanded={more}
          className={clsx("press flex flex-1 flex-col items-center gap-0.5 rounded-full py-1.5 text-[11px]", more || MOBILE_MORE.some((m) => active(m.href)) ? "bg-white text-ink" : "text-white/65")}
        >
          {more ? <X size={19} aria-hidden /> : <DotsThreeOutline size={19} aria-hidden />}
          More
        </button>
      </nav>
    </div>
  );
}
