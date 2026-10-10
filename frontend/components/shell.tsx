"use client";

import {
  BookOpenText,
  CaretDown,
  ChartLineUp,
  Check,
  DotsThreeOutline,
  Images,
  Megaphone,
  Plugs,
  Plus,
  QrCode,
  Receipt as ReceiptIcon,
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
import { useWorkLog } from "@/lib/worklog";
import { Receipt } from "./receipt";

// Two groups: the work (a campaign's flow) and the business it draws on.
const WORK = [
  { href: "/", label: "Today", icon: SunHorizon },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/results", label: "Results", icon: ChartLineUp },
];
const BUSINESS = [
  { href: "/photos", label: "Photos", icon: Images },
  { href: "/brand", label: "Brand", icon: BookOpenText },
  { href: "/customers", label: "Customers", icon: UsersThree },
  { href: "/channels", label: "Channels", icon: Plugs },
];
const NAV = [...WORK, ...BUSINESS];

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

export function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

function Mark({ className }: { className?: string }) {
  return <img src="/icon.svg" alt="" className={clsx("h-8 w-8", className)} />;
}

/** The business name doubles as the account menu: switch business, add one, sign out. */
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
    <div ref={ref} className="relative min-w-0">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="press flex min-w-0 items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1 text-left hover:bg-ink/[0.05]"
      >
        <span className="min-w-0 leading-none">
          <span className="block max-w-[170px] truncate text-[18px] font-bold [font-stretch:90%]">{business.name}</span>
          <span className="mt-1 block text-[12px] text-muted">{business.is_demo ? "Demo business" : (business.kind ?? business.locality)}</span>
        </span>
        <CaretDown size={13} weight="bold" className={clsx("shrink-0 text-muted transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div role="menu" className="pop absolute left-0 top-12 z-50 w-72 rounded-[var(--radius-lg)] bg-surface p-1.5 shadow-[var(--shadow-float)] ring-1 ring-ink/15">
          <p className="truncate px-3 pb-2 pt-1.5 text-[13px] text-muted">{me.user.email}</p>
          {me.businesses.map((b) => (
            <button
              key={b.slug}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                select(b.slug);
              }}
              className="press flex w-full items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2 text-left hover:bg-sunken"
            >
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-ink text-[12px] font-bold text-marker">{initials(b.name)}</span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-[15px] font-semibold">{b.name}</span>
                <span className="block text-[12px] text-muted">{b.is_demo ? "Demo business" : `${b.locality}, ${b.city}`}</span>
              </span>
              {b.slug === business.slug && <Check size={15} weight="bold" className="text-pen" aria-hidden />}
            </button>
          ))}
          <div className="my-1.5 h-px bg-line" />
          <Link href="/onboarding" role="menuitem" className="press flex items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2 text-[15px] hover:bg-sunken">
            <Plus size={16} aria-hidden /> Add a business
          </Link>
          <button role="menuitem" onClick={signOut} className="press flex w-full items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2 text-[15px] text-ink-2 hover:bg-sunken">
            <SignOut size={16} aria-hidden /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/** Shows or hides the work log beside every page. Off by default; remembered in this browser. */
export function WorkLogToggle({ className }: { className?: string }) {
  const [on, setOn] = useWorkLog();
  return (
    <button
      onClick={() => setOn(!on)}
      aria-pressed={on}
      title={on ? "Hide the work log" : "Show the work log"}
      className={clsx(
        "press inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] px-2.5 text-[14px] font-semibold",
        on ? "bg-pen-soft text-pen-ink" : "text-ink-2 hover:bg-ink/[0.06] hover:text-ink",
        className,
      )}
    >
      <ReceiptIcon size={16} weight={on ? "fill" : "regular"} aria-hidden />
      <span className="hidden md:inline">Log</span>
      <span className={clsx("relative ml-0.5 inline-block h-4 w-7 rounded-full transition-colors", on ? "bg-pen" : "bg-line-strong")} aria-hidden>
        <span className={clsx("absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform", on ? "translate-x-3" : "translate-x-0")} />
      </span>
    </button>
  );
}

/** The work log as a panel on the right, below the header. It pushes the page over on wide screens and covers it
 *  on small ones. Closing it switches the preference off. */
function WorkLogDrawer({ campaignId }: { campaignId?: string }) {
  const [, setOn] = useWorkLog();
  return (
    <aside className="step-in-right fixed bottom-[68px] right-0 top-16 z-30 flex w-full flex-col border-l border-ink bg-receipt sm:w-[360px] lg:bottom-0" aria-label="Work log">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <p className="text-[17px] font-bold">Work log</p>
          <p className="text-[13px] text-muted">{campaignId ? "Everything done on this campaign" : "Everything Counterpart and you did"}</p>
        </div>
        <button onClick={() => setOn(false)} className="press rounded-[var(--radius-sm)] p-2 text-ink-2 hover:bg-sunken" aria-label="Close the work log">
          <X size={18} aria-hidden />
        </button>
      </div>
      <Receipt campaignId={campaignId} className="min-h-0 flex-1" />
    </aside>
  );
}

/** Who is working right now. Links to the agents page. */
function TeamLink({ working, active }: { working: boolean; active: boolean }) {
  return (
    <Link
      href="/agents"
      className={clsx(
        "press inline-flex h-9 items-center gap-2 rounded-[var(--radius-sm)] px-3 text-[14px] font-semibold",
        working ? "bg-pen text-white" : active ? "bg-ink text-white" : "text-ink-2 hover:bg-ink/[0.06] hover:text-ink",
      )}
      aria-label={working ? "Counterpart is working. See the AI team" : "See the AI team"}
    >
      <span className={clsx("h-2 w-2 rounded-full", working ? "pulse-dot bg-marker" : "bg-line-strong")} aria-hidden />
      {working ? "Working" : "AI team"}
    </Link>
  );
}

export function Shell({ children, campaignId, log = true }: { children: ReactNode; campaignId?: string; log?: boolean }) {
  const path = usePathname();
  const router = useRouter();
  const { business } = useWorkspace();
  const [more, setMore] = useState(false);
  const working = useAgentWorking();
  const [showLog] = useWorkLog();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  useEffect(() => setMore(false), [path]);
  useEffect(() => {
    NAV.forEach((n) => router.prefetch(n.href));
  }, [router]);

  const tab = (n: (typeof NAV)[number]) => (
    <Link
      key={n.href}
      href={n.href}
      aria-current={active(n.href) ? "page" : undefined}
      className={clsx(
        "relative flex h-16 items-center px-3 text-[15px] font-semibold transition-colors",
        active(n.href) ? "text-ink after:absolute after:inset-x-3 after:-bottom-px after:h-[3px] after:bg-ink" : "text-muted hover:text-ink",
      )}
    >
      {n.label}
    </Link>
  );

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-[var(--radius-sm)] focus:bg-ink focus:px-4 focus:py-2 focus:text-white">
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-ink bg-paper/95 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-2 px-3 md:px-8">
          <Link href="/" className="shrink-0" aria-label="Counterpart, Today">
            <Mark />
          </Link>
          <span className="mx-1 hidden h-7 w-px bg-line-strong sm:block" aria-hidden />
          <BusinessMenu />
          <nav className="ml-4 hidden items-center lg:flex" aria-label="Main">
            {WORK.map(tab)}
            <span className="mx-2 h-5 w-px bg-line-strong" aria-hidden />
            {BUSINESS.map(tab)}
          </nav>
          <span className="flex-1" />
          {business.is_demo && <span className="stamp hidden text-turmeric xl:inline-flex">Demo data</span>}
          <WorkLogToggle />
          <TeamLink working={working} active={active("/agents")} />
          <Link
            href="/counter"
            className={clsx(
              "press hidden h-9 items-center gap-2 rounded-[var(--radius-sm)] px-3 text-[14px] font-semibold sm:inline-flex",
              active("/counter") ? "bg-ink text-white" : "shadow-[inset_0_0_0_1.5px_var(--color-ink)] hover:bg-sunken",
            )}
          >
            <QrCode size={16} weight="bold" aria-hidden /> Counter
          </Link>
        </div>
      </header>

      <div className={clsx("mx-auto flex w-full max-w-[1440px] flex-1 px-4 transition-[padding] duration-300 md:px-8", log && showLog && "xl:pr-[392px]")}>
        <main id="main" className="page-in min-w-0 flex-1 pb-32 pt-8 md:pb-20 md:pt-12">
          {children}
        </main>
      </div>

      {log && showLog && <WorkLogDrawer campaignId={campaignId} />}

      {more && (
        <div className="fixed inset-0 z-40 bg-ink/30 lg:hidden" onClick={() => setMore(false)}>
          <div
            className="sheet-up absolute inset-x-0 bottom-[68px] border-t border-ink bg-surface p-3"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="More"
          >
            <div className="grid grid-cols-2 gap-1.5">
              {[...BUSINESS, { href: "/counter", label: "Counter", icon: QrCode }].map(({ href, label, icon: Icon }, i) => (
                <Link
                  key={href}
                  href={href}
                  style={{ "--i": i } as React.CSSProperties}
                  className={clsx("rise-in press flex items-center gap-3 rounded-[var(--radius-md)] p-4 text-[16px] font-semibold", active(href) ? "bg-ink text-white" : "bg-sunken text-ink")}
                >
                  <Icon size={20} weight={active(href) ? "fill" : "regular"} aria-hidden />
                  {label}
                </Link>
              ))}
            </div>
            <button onClick={signOut} className="press mt-1.5 flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] p-3 text-sm text-ink-2 hover:bg-sunken">
              <SignOut size={16} aria-hidden /> Sign out
            </button>
          </div>
        </div>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-ink bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="Main">
        {WORK.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={active(href) ? "page" : undefined}
            className={clsx("press relative flex h-[68px] flex-1 flex-col items-center justify-center gap-1 text-[12px] font-semibold", active(href) ? "text-ink" : "text-muted")}
          >
            {active(href) && <span className="absolute inset-x-5 top-0 h-[3px] bg-ink" aria-hidden />}
            <Icon size={22} weight={active(href) ? "fill" : "regular"} aria-hidden />
            {label}
          </Link>
        ))}
        <button
          onClick={() => setMore(!more)}
          aria-expanded={more}
          className={clsx("press relative flex h-[68px] flex-1 flex-col items-center justify-center gap-1 text-[12px] font-semibold", more || [...BUSINESS, { href: "/counter" }].some((m) => active(m.href)) ? "text-ink" : "text-muted")}
        >
          {more ? <X size={22} aria-hidden /> : <DotsThreeOutline size={22} aria-hidden />}
          More
        </button>
      </nav>
    </div>
  );
}
