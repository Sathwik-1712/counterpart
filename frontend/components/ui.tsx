import clsx from "clsx";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

type Tone = "neutral" | "leaf" | "turmeric" | "kumkum";

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" }) {
  return (
    <button
      {...props}
      className={clsx(
        "press inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-medium disabled:cursor-not-allowed disabled:opacity-45",
        size === "sm" ? "h-8 px-3.5 text-[13px]" : "h-10 px-5 text-sm",
        variant === "primary" && "bg-ink text-white hover:bg-leaf-ink",
        variant === "secondary" && "bg-surface text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:shadow-[inset_0_0_0_1px_var(--color-ink-2)]",
        variant === "ghost" && "text-ink-2 hover:bg-sunken hover:text-ink",
        variant === "danger" && "bg-surface text-kumkum shadow-[inset_0_0_0_1px_rgb(180_35_24/0.35)] hover:bg-kumkum-soft",
        className,
      )}
    />
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

export function StatusPill({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, tone: "neutral" as Tone };
  return <Pill tone={s.tone}>{s.label}</Pill>;
}

export function Card({
  children,
  className,
  as: As = "section",
  ...rest
}: { children: ReactNode; className?: string; as?: "section" | "article" | "div" } & HTMLAttributes<HTMLElement>) {
  return (
    <As {...rest} className={clsx("rounded-[var(--radius-lg)] bg-surface shadow-[var(--shadow-soft)] ring-1 ring-line/70", className)}>
      {children}
    </As>
  );
}

export function SectionHeading({ title, aside, className }: { title: string; aside?: ReactNode; className?: string }) {
  return (
    <div className={clsx("mb-4 flex items-end justify-between gap-4", className)}>
      <h2 className="text-[19px]">{title}</h2>
      {aside}
    </div>
  );
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-lg)] bg-sunken/60 px-5 py-7 text-sm text-muted">
      <p className="max-w-[52ch]">{children}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("skeleton", className)} aria-hidden />;
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
