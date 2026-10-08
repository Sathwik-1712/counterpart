import clsx from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";

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
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-3 text-[13px]" : "h-9 px-4 text-sm",
        variant === "primary" && "bg-leaf text-white hover:bg-leaf-ink",
        variant === "secondary" && "border border-line-strong bg-surface text-ink hover:border-ink-2",
        variant === "ghost" && "text-ink-2 hover:bg-line/50 hover:text-ink",
        variant === "danger" && "border border-kumkum/40 bg-surface text-kumkum hover:bg-kumkum-soft",
        className,
      )}
    />
  );
}

const toneClass: Record<Tone, string> = {
  neutral: "bg-line/60 text-ink-2",
  leaf: "bg-leaf-soft text-leaf-ink",
  turmeric: "bg-turmeric-soft text-turmeric",
  kumkum: "bg-kumkum-soft text-kumkum",
};

export function Pill({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-medium", toneClass[tone], className)}>
      {children}
    </span>
  );
}

const STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  valid: { label: "Checked", tone: "leaf" },
  invalid: { label: "Blocked", tone: "kumkum" },
  approved: { label: "Approved", tone: "leaf" },
  live: { label: "Live", tone: "leaf" },
  stale: { label: "Needs update", tone: "turmeric" },
  retired: { label: "Finished", tone: "neutral" },
  rejected: { label: "Rejected", tone: "neutral" },
  planned: { label: "Planned", tone: "neutral" },
  active: { label: "Running", tone: "leaf" },
  concluded: { label: "Finished", tone: "neutral" },
};

export function StatusPill({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, tone: "neutral" as Tone };
  return <Pill tone={s.tone}>{s.label}</Pill>;
}

export function SectionHeading({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-4">
      <h2 className="text-[17px]">{title}</h2>
      {aside}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-dashed border-line-strong px-4 py-6 text-sm text-muted">{children}</p>;
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
  regulars: "Regulars",
  office_goers: "Office-goers",
  families: "Families",
};

export function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
