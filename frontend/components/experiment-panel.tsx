"use client";

import clsx from "clsx";
import type { ExperimentStatus } from "@/lib/types";

const pct = (x: number | undefined, digits = 0) => (x === undefined ? "-" : `${(x * 100).toFixed(digits)}%`);

/** Posterior conversion per arm: dot = mean, line = 90% credible interval.
 *  One row per arm, labelled directly; the leader is highlighted, the rest stay grey. */
export function ExperimentPanel({ exp }: { exp: ExperimentStatus }) {
  const arms = exp.arms.filter((a) => a.mean !== undefined);
  const max = Math.max(0.05, ...arms.map((a) => a.ci90_high ?? 0));
  const scaleMax = (Math.ceil((max * 100) / 10) * 10) / 100;
  const ticks = [0, scaleMax / 2, scaleMax];
  const leader = arms.reduce<(typeof arms)[number] | null>((b, a) => (!b || (a.p_best ?? 0) > (b.p_best ?? 0) ? a : b), null);
  const x = (v: number | undefined) => `${((v ?? 0) / scaleMax) * 100}%`;

  return (
    <section className="rounded-[var(--radius-lg)] bg-surface p-6 shadow-[var(--shadow-soft)] ring-1 ring-line/80" aria-label={`Experiment: ${exp.experiment.hypothesis}`}>
      <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-[17px] tracking-tight">{exp.experiment.hypothesis}</h3>
        <span className="text-xs text-muted">
          {exp.experiment.success_type} per {exp.experiment.trial_type}, prior from {exp.prior.from_campaign_assets} past pieces
        </span>
      </div>

      <div className="grid grid-cols-[72px_1fr] gap-x-4 sm:grid-cols-[72px_1fr_150px]">
        {arms.map((a) => {
          const lead = a === leader && (a.p_best ?? 0) > 0.5;
          const tip = `Variant ${a.variant}: ${a.successes}/${a.trials}, likely rate ${pct(a.mean, 1)} (90%: ${pct(a.ci90_low, 1)} to ${pct(a.ci90_high, 1)}), chance best ${pct(a.p_best)}`;
          return (
            <div key={a.asset_id} className="contents">
              <div className="flex h-10 items-center text-sm">
                <span className="font-medium">Variant {a.variant}</span>
              </div>
              <div className="group relative h-10 outline-none" tabIndex={0} title={tip} aria-label={tip}>
                <div className="absolute inset-y-0 left-0 w-px bg-line" />
                <div
                  className={clsx("absolute top-1/2 h-[2px] -translate-y-1/2 rounded-full", lead ? "bg-pen" : "bg-muted")}
                  style={{ left: x(a.ci90_low), width: `calc(${x(a.ci90_high)} - ${x(a.ci90_low)})` }}
                />
                <div
                  className={clsx("absolute top-1/2 h-[10px] w-[10px] -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface", lead ? "bg-pen" : "bg-ink-2")}
                  style={{ left: x(a.mean) }}
                />
                <div className="pointer-events-none absolute -top-7 z-10 hidden whitespace-nowrap rounded-sm bg-ink px-2 py-1 text-xs text-white group-hover:block group-focus:block" style={{ left: x(a.mean) }}>
                  {pct(a.mean, 1)} likely, {pct(a.p_best)} chance best
                </div>
              </div>
              <div className="col-span-2 flex h-10 items-center justify-end gap-3 text-sm tabular-nums text-ink-2 sm:col-span-1">
                <span>
                  {a.successes}/{a.trials}
                </span>
                <span className={clsx("w-[86px] text-right", lead && "font-medium text-ink")}>
                  {lead ? `Leading, ${pct(a.p_best)}` : `${pct(a.p_best)} best`}
                </span>
              </div>
            </div>
          );
        })}
        <div />
        <div className="relative mt-1 h-5 border-t border-line text-[11px] tabular-nums text-muted">
          {ticks.map((t, i) => (
            <span key={i} className={clsx("absolute top-1", i === 0 ? "" : i === ticks.length - 1 ? "-translate-x-full" : "-translate-x-1/2")} style={{ left: x(t) }}>
              {pct(t)}
            </span>
          ))}
        </div>
      </div>

      <p className={clsx("mt-4 text-sm", exp.decision.winner ? "text-pen-ink" : "text-ink-2")}>
        {exp.experiment.status === "decided"
          ? `Decided. ${exp.decision.reason}`
          : exp.decision.winner
            ? `Ready to decide. ${exp.decision.reason}`
            : exp.decision.reason}
      </p>
    </section>
  );
}
