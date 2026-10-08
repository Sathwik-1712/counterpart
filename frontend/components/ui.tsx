import clsx from "clsx";
import type { ButtonHTMLAttributes, CSSProperties, HTMLAttributes, ReactNode } from "react";

type Tone = "neutral" | "leaf" | "turmeric" | "kumkum";

export function Button({
  variant = "secondary",
  size = "md",
  trailing,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "accent" | "secondary" | "ghost" | "danger" | "light";
  size?: "sm" | "md" | "lg";
  /** An icon nested in its own circle at the right edge (button-in-button). */
  trailing?: ReactNode;
}) {
  return (
    <button
      {...props}
      className={clsx(
        "press group inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-medium disabled:cursor-not-allowed disabled:opacity-45",
        size === "sm" && "h-8 px-3.5 text-[13px]",
        size === "md" && "h-10 px-5 text-sm",
        size === "lg" && "h-12 px-6 text-[15px]",
        trailing && (size === "lg" ? "pr-1.5" : "pr-1"),
        variant === "primary" && "bg-ink text-white hover:bg-forest-2",
        variant === "accent" && "bg-leaf text-white hover:bg-leaf-ink",
        variant === "light" && "bg-white text-ink hover:bg-mint",
        variant === "secondary" && "bg-surface text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:shadow-[inset_0_0_0_1px_var(--color-ink-2)]",
        variant === "ghost" && "text-ink-2 hover:bg-sunken hover:text-ink",
        variant === "danger" && "bg-surface text-kumkum shadow-[inset_0_0_0_1px_rgb(180_35_24/0.35)] hover:bg-kumkum-soft",
        className,
      )}
    >
      {children}
      {trailing && (
        <span
          className={clsx(
            "ml-1.5 inline-flex items-center justify-center rounded-full transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 group-hover:-translate-y-px",
            size === "lg" ? "h-9 w-9" : size === "md" ? "h-8 w-8" : "h-6 w-6",
            variant === "secondary" || variant === "ghost" || variant === "light" ? "bg-ink/[0.06]" : "bg-white/15",
          )}
          aria-hidden
        >
          {trailing}
        </span>
      )}
    </button>
  );
}

const toneClass: Record<Tone, string> = {
  neutral: "bg-sunken text-ink-2",
  leaf: "bg-leaf-soft text-leaf-ink",
  turmeric: "bg-turmeric-soft text-turmeric",
  kumkum: "bg-kumkum-soft text-kumkum",
};

export function Pill({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium", toneClass[tone], className)}>
      {children}
    </span>
  );
}

const STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  valid: { label: "Ready to approve", tone: "leaf" },
  invalid: { label: "Blocked", tone: "kumkum" },
  approved: { label: "Approved", tone: "leaf" },
  live: { label: "Live", tone: "leaf" },
  stale: { label: "Needs update", tone: "turmeric" },
  retired: { label: "Finished", tone: "neutral" },
  rejected: { label: "Rejected", tone: "neutral" },
  planned: { label: "Planning", tone: "neutral" },
  active: { label: "Running", tone: "leaf" },
  concluded: { label: "Finished", tone: "neutral" },
};

export function StatusPill({ status, className }: { status: string; className?: string }) {
  const s = STATUS[status] ?? { label: status, tone: "neutral" as Tone };
  return (
    <Pill tone={s.tone} className={className}>
      {status === "live" && <span className="h-1.5 w-1.5 rounded-full bg-leaf" aria-hidden />}
      {s.label}
    </Pill>
  );
}

export function Card({
  children,
  className,
  as: As = "section",
  ...rest
}: { children: ReactNode; className?: string; as?: "section" | "article" | "div" } & HTMLAttributes<HTMLElement>) {
  return (
    <As {...rest} className={clsx("rounded-[var(--radius-lg)] bg-surface shadow-[var(--shadow-soft)] ring-1 ring-line/80", className)}>
      {children}
    </As>
  );
}

/** Double-bezel: a hairline tray holding an inner plate, for the few elements that deserve to feel like objects. */
export function Bezel({ children, className, inner, style }: { children: ReactNode; className?: string; inner?: string; style?: CSSProperties }) {
  return (
    <div className={clsx("rounded-[var(--radius-xl)] bg-ink/[0.035] p-1.5 ring-1 ring-ink/[0.06]", className)} style={style}>
      <div className={clsx("h-full overflow-hidden rounded-[calc(var(--radius-xl)-6px)] shadow-[inset_0_1px_1px_rgba(255,255,255,0.6)]", inner)}>{children}</div>
    </div>
  );
}

export function SectionHeading({ title, aside, sub, className, id }: { title: string; aside?: ReactNode; sub?: ReactNode; className?: string; id?: string }) {
  return (
    <div className={clsx("mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-2", className)}>
      <div>
        <h2 id={id} className="text-[22px] md:text-[24px]">
          {title}
        </h2>
        {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      </div>
      {aside}
    </div>
  );
}

export function PageHeader({ title, sub, aside }: { title: ReactNode; sub?: ReactNode; aside?: ReactNode }) {
  return (
    <header className="rise-in mb-10 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="max-w-[760px]">
        <h1 className="text-[34px] tracking-[-0.035em] md:text-[48px]">{title}</h1>
        {sub && <p className="mt-3 max-w-[60ch] text-[15px] text-ink-2 md:text-base">{sub}</p>}
      </div>
      {aside}
    </header>
  );
}

export function Empty({ children, action, icon }: { children: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex items-start gap-4 rounded-[var(--radius-lg)] border border-dashed border-line-strong bg-surface/60 px-5 py-6 text-sm text-ink-2">
      {icon && <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-leaf-soft text-leaf-ink">{icon}</span>}
      <div>
        <p className="max-w-[52ch]">{children}</p>
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("skeleton", className)} aria-hidden />;
}

/** A metric with the number as the hero. */
export function Stat({ label, value, tone, className }: { label: string; value: ReactNode; tone?: "leaf" | "light"; className?: string }) {
  return (
    <div className={className}>
      <p className={clsx("text-[32px] font-semibold leading-none tracking-[-0.04em] tabular-nums", tone === "leaf" && "text-leaf", tone === "light" && "text-white")}>{value}</p>
      <p className={clsx("mt-1.5 text-xs", tone === "light" ? "text-white/60" : "text-muted")}>{label}</p>
    </div>
  );
}

export const LANG_LABEL: Record<string, string> = { en: "English", kn: "ಕನ್ನಡ", hi: "हिन्दी" };
export const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  instagram_post: "Instagram post",
  instagram_story: "Instagram story",
  poster: "Counter poster",
};
export const SEGMENT_LABEL: Record<string, string> = {
  students: "Students",
  college_students: "College students",
  regulars: "Regulars",
  office_goers: "Office-goers",
  families: "Families",
};

export function segmentLabel(s: string) {
  return SEGMENT_LABEL[s] ?? s.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/** Stagger index for .rise-in and .fan-in children. */
export const stagger = (i: number) => ({ "--i": i }) as CSSProperties;
