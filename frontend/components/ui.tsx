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
  variant?: "primary" | "accent" | "secondary" | "ghost" | "danger" | "light" | "marker";
  size?: "sm" | "md" | "lg";
  /** An icon at the right edge that nudges forward on hover. */
  trailing?: ReactNode;
}) {
  return (
    <button
      {...props}
      className={clsx(
        "press group inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius-sm)] font-semibold disabled:cursor-not-allowed disabled:opacity-45",
        size === "sm" && "h-8 px-3 text-[13px]",
        size === "md" && "h-10 px-4 text-[14px]",
        size === "lg" && "h-12 px-5 text-[15px]",
        variant === "primary" && "bg-ink text-white hover:bg-ink-2",
        variant === "accent" && "bg-pen text-white hover:bg-pen-ink",
        variant === "marker" && "bg-marker text-ink shadow-[inset_0_0_0_1.5px_var(--color-ink)] hover:bg-[#ffcb05]",
        variant === "light" && "bg-white text-ink hover:bg-marker",
        variant === "secondary" && "bg-surface text-ink shadow-[inset_0_0_0_1.5px_var(--color-ink)] hover:bg-sunken",
        variant === "ghost" && "text-ink-2 hover:bg-ink/[0.06] hover:text-ink",
        variant === "danger" && "bg-surface text-kumkum shadow-[inset_0_0_0_1.5px_rgb(194_54_27/0.5)] hover:bg-kumkum-soft",
        className,
      )}
    >
      {children}
      {trailing && (
        <span className="ml-0.5 inline-flex transition-transform duration-200 ease-out group-hover:translate-x-0.5" aria-hidden>
          {trailing}
        </span>
      )}
    </button>
  );
}

const toneClass: Record<Tone, string> = {
  neutral: "bg-sunken text-ink-2",
  leaf: "bg-pen-soft text-pen-ink",
  turmeric: "bg-turmeric-soft text-turmeric",
  kumkum: "bg-kumkum-soft text-kumkum",
};

export function Pill({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-1 whitespace-nowrap rounded-[3px] px-2 py-0.5 text-[13px] font-semibold", toneClass[tone], className)}>
      {children}
    </span>
  );
}

const STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  valid: { label: "Ready for you", tone: "turmeric" },
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
      {(status === "live" || status === "active") && <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-kumkum" aria-hidden />}
      {s.label}
    </Pill>
  );
}

/** Counterpart's mark on checked work: a crooked pen-blue rubber stamp. */
export function Stamp({ children, className, tone = "pen", i = 0 }: { children: ReactNode; className?: string; tone?: "pen" | "kumkum" | "ink"; i?: number }) {
  return (
    <span
      className={clsx("stamp stamp-in", tone === "pen" ? "text-pen" : tone === "kumkum" ? "text-kumkum" : "text-ink", className)}
      style={{ "--i": i } as CSSProperties}
    >
      {children}
    </span>
  );
}

export function Card({
  children,
  className,
  as: As = "section",
  ...rest
}: { children: ReactNode; className?: string; as?: "section" | "article" | "div" } & HTMLAttributes<HTMLElement>) {
  return (
    <As {...rest} className={clsx("rounded-[var(--radius-lg)] bg-surface ring-1 ring-line", className)}>
      {children}
    </As>
  );
}

/** A plain bordered plate for the few elements that should feel like objects on the counter. */
export function Bezel({ children, className, inner, style }: { children: ReactNode; className?: string; inner?: string; style?: CSSProperties }) {
  return (
    <div className={clsx("rounded-[var(--radius-xl)] ring-1 ring-ink/15", className)} style={style}>
      <div className={clsx("h-full overflow-hidden rounded-[var(--radius-xl)]", inner)}>{children}</div>
    </div>
  );
}

export function SectionHeading({ title, aside, sub, className, id, n }: { title: string; aside?: ReactNode; sub?: ReactNode; className?: string; id?: string; n?: number }) {
  return (
    <div className={clsx("mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-ink pb-2.5", className)}>
      <div className="flex items-baseline gap-3">
        {n !== undefined && <span className="font-mono text-[12px] font-semibold text-muted">{String(n).padStart(2, "0")}</span>}
        <div>
          <h2 id={id} className="text-[26px] md:text-[30px]">
            {title}
          </h2>
          {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
        </div>
      </div>
      {aside}
    </div>
  );
}

export function PageHeader({ title, sub, aside }: { title: ReactNode; sub?: ReactNode; aside?: ReactNode }) {
  return (
    <header className="rise-in mb-10 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="max-w-[780px]">
        <h1 className="text-[44px] md:text-[64px]">{title}</h1>
        {sub && <p className="mt-3 max-w-[60ch] text-[16px] text-ink-2 md:text-[17px]">{sub}</p>}
      </div>
      {aside}
    </header>
  );
}

export function Empty({ children, action, icon }: { children: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex items-start gap-4 rounded-[var(--radius-lg)] border border-dashed border-line-strong px-5 py-5 text-[15px] text-ink-2">
      {icon && <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-sunken text-ink-2">{icon}</span>}
      <div>
        <p className="max-w-[56ch]">{children}</p>
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("skeleton", className)} aria-hidden />;
}

/** A metric with the number as the hero, in condensed signboard figures. */
export function Stat({ label, value, tone, className }: { label: string; value: ReactNode; tone?: "leaf" | "light"; className?: string }) {
  return (
    <div className={className}>
      <p className={clsx("sign tabular text-[44px]", tone === "leaf" && "text-pen", tone === "light" && "text-white")}>{value}</p>
      <p className={clsx("mt-1.5 text-[13px]", tone === "light" ? "text-white/65" : "text-muted")}>{label}</p>
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
