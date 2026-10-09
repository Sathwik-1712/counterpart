import { Check } from "@phosphor-icons/react";
import clsx from "clsx";
import { STEPS } from "@/lib/journey";
import { stagger } from "./ui";

/** The five steps of a campaign, with the current one highlighted. Steps link to their section on the page. */
export function JourneyTrack({ step, notes }: { step: number; notes?: Partial<Record<string, string>> }) {
  return (
    <ol className="grid grid-cols-5 border-y border-ink" aria-label="Campaign progress">
      {STEPS.map((s, i) => {
        const done = i < step;
        const now = i === step;
        return (
          <li key={s.key} aria-current={now ? "step" : undefined} className={clsx("relative min-w-0 border-ink", i > 0 && "border-l")}>
            <a
              href={`#${s.key}`}
              className={clsx("rise-in flex h-full flex-col gap-1 px-2.5 py-3 transition-colors md:px-4", now ? "bg-marker" : "hover:bg-ink/[0.04]")}
              style={stagger(i)}
            >
              <span className="flex items-center justify-between gap-2">
                <span className={clsx("font-mono text-[12px] font-semibold", now ? "text-ink" : "text-muted")}>{String(i + 1).padStart(2, "0")}</span>
                {done && (
                  <span className="stamp-in inline-flex h-5 w-5 items-center justify-center rounded-full bg-pen text-white" style={stagger(i)}>
                    <Check size={11} weight="bold" aria-label="done" />
                  </span>
                )}
              </span>
              <span className={clsx("truncate text-[17px] font-bold [font-stretch:90%] md:text-[20px]", !done && !now && "text-muted")}>{s.label}</span>
              <span className={clsx("hidden truncate text-[12px] md:block", now ? "text-ink" : "text-muted")}>{notes?.[s.key] ?? s.who}</span>
            </a>
          </li>
        );
      })}
    </ol>
  );
}

/** A small five-segment version for lists. */
export function JourneyMini({ step, className }: { step: number; className?: string }) {
  return (
    <span className={clsx("flex items-center gap-[3px]", className)} aria-label={step >= 5 ? "Finished" : `Step ${step + 1} of 5: ${STEPS[step].label}`}>
      {STEPS.map((s, i) => (
        <span
          key={s.key}
          className={clsx(
            "h-2 flex-1 rounded-[1px]",
            i < step ? "bg-ink" : i === step ? "bg-marker ring-1 ring-ink" : "bg-line",
          )}
        />
      ))}
    </span>
  );
}
