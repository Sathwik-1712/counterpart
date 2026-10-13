"use client";

import clsx from "clsx";
import type { ExperimentStatus } from "@/lib/types";
import { stagger } from "./ui";

const pct = (x: number | undefined | null, digits = 0) => (x == null || Number.isNaN(x) ? "–" : `${(x * 100).toFixed(digits)}%`);
const LETTERS = "ABCDEFGH";

/** An A/B test in plain terms, three readings top to bottom:
 *  1. who is ahead right now (chance each version is the better one, as one split bar),
 *  2. what actually happened (redeemed out of opened, per version, with the likely range drawn behind it),
 *  3. how much more data is needed before Counterpart decides. */
export function ExperimentPanel({ exp, labels = {} }: { exp: ExperimentStatus; labels?: Record<string, string> }) {
  const arms = exp.arms;
  const minTrials = exp.decision.min_trials ?? 15;
  const threshold = exp.decision.loss_threshold ?? 0.01;
  const noData = arms.every((a) => !a.trials);
  const ranked = [...arms].sort((a, b) => (b.p_best ?? 0) - (a.p_best ?? 0));
  const leader = !noData && (ranked[0]?.p_best ?? 0) > 0.55 ? ranked[0] : null;
  const scaleMax = Math.max(0.1, ...arms.map((a) => (a.trials ? (a.ci90_high ?? 0) : 0)), ...arms.map((a) => (a.trials ? (a.successes ?? 0) / a.trials : 0)));
  const x = (v: number) => `${Math.min(100, (v / scaleMax) * 100)}%`;
  const name = (i: number, a: (typeof arms)[number]) => `Version ${a.variant ?? LETTERS[i]}`;
  const decided = exp.experiment.status === "decided" || !!exp.decision.winner;
  // The decision in shop words: how sure, and what picking the leader now could cost per 100 visitors.
  const top = arms.reduce<(typeof arms)[number] | null>((m, a) => (m == null || (a.expected_loss ?? 1) < (m.expected_loss ?? 1) ? a : m), null);
  const risk = (top?.expected_loss ?? 0) * 100;
  const plain = !top || noData
    ? "Waiting for people to open the links."
    : exp.decision.winner
      ? `${Math.round((top.p_best ?? 0) * 100)}% sure it is the better version. Choosing it now risks losing under ${Math.max(1, Math.round(threshold * 100))} sale per 100 visitors.`
      : `${name(arms.indexOf(top), top)} is ${Math.round((top.p_best ?? 0) * 100)}% likely to be better, which is not sure enough yet. Picking it now could cost about ${risk.toFixed(1)} sales per 100 visitors; Counterpart decides once that drops under ${Math.round(threshold * 100)}. Keep sharing both.`;

  return (
    <section className="rounded-[var(--radius-lg)] bg-surface ring-1 ring-ink" aria-label={`A/B test: ${exp.experiment.hypothesis}`}>
      <div className="border-b border-line p-5 md:p-6">
        <p className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
          <span className={clsx("stamp", decided ? "text-pen" : "text-turmeric")}>{decided ? "Decided" : "Running"}</span>
          Testing {exp.experiment.dimension.replace(/_/g, " ")} · counts {exp.experiment.success_type === "redeem" ? "redemptions" : exp.experiment.success_type} per{" "}
          {exp.experiment.trial_type === "scan" ? "link opened" : exp.experiment.trial_type}
        </p>
        <h4 className="mt-2 text-[20px] leading-tight [font-stretch:90%] md:text-[22px]">{exp.experiment.hypothesis}</h4>
      </div>

      <div className="space-y-7 p-5 md:p-6">
        {/* 1. Chance each version is better */}
        <div>
          <p className="mb-2 text-[14px] font-semibold">Chance each version is the better one</p>
          <div className="flex h-10 overflow-hidden rounded-[var(--radius-sm)] ring-1 ring-ink">
            {arms.map((a, i) => {
              const share = noData ? 1 / arms.length : (a.p_best ?? 0);
              const lead = leader?.asset_id === a.asset_id;
              return (
                <div
                  key={a.asset_id}
                  className={clsx("grow-x flex min-w-0 items-center justify-between gap-2 px-3 text-[13px] font-semibold", i > 0 && "border-l border-ink", lead ? "bg-marker" : i % 2 ? "bg-sunken" : "bg-surface")}
                  style={{ width: `${Math.max(share * 100, 8)}%`, ...stagger(i) }}
                >
                  <span className="truncate">{a.variant ?? LETTERS[i]}</span>
                  <span className="tabular-nums">{pct(share)}</span>
                </div>
              );
            })}
          </div>
          <p className="mt-1.5 text-[13px] text-muted">
            {noData ? "A coin flip until people open the links. Nothing has been measured yet." : leader ? `${name(arms.indexOf(leader), leader)} is ahead.` : "Too close to call."}
          </p>
        </div>

        {/* 2. What happened */}
        <div>
          <p className="mb-3 text-[14px] font-semibold">What happened</p>
          <ul className="space-y-4">
            {arms.map((a, i) => {
              const trials = a.trials ?? 0;
              const wins = a.successes ?? 0;
              const rate = trials ? wins / trials : null;
              const lead = leader?.asset_id === a.asset_id;
              return (
                <li key={a.asset_id}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <p className="min-w-0 text-[15px]">
                      <span className="font-semibold">{name(i, a)}</span>
                      {labels[a.asset_id] && <span className="text-ink-2">: “{labels[a.asset_id]}”</span>}
                    </p>
                    <p className="text-[14px] tabular-nums text-ink-2">
                      <span className="font-semibold text-ink">{wins}</span> redeemed of <span className="font-semibold text-ink">{trials}</span> opened
                      {rate !== null && <span className={clsx("ml-2 font-semibold", lead ? "text-pen" : "text-ink")}>{pct(rate, 1)}</span>}
                    </p>
                  </div>
                  <div className="relative mt-2 h-6 rounded-[3px] bg-sunken" title={trials ? `Likely between ${pct(a.ci90_low, 1)} and ${pct(a.ci90_high, 1)}` : "No data yet"}>
                    {trials > 0 && (
                      <>
                        <div
                          className="absolute inset-y-0 rounded-[3px] border-x-2 border-ink/50 bg-ink/[0.13]"
                          style={{ left: x(a.ci90_low ?? 0), width: `calc(${x(a.ci90_high ?? 0)} - ${x(a.ci90_low ?? 0)})` }}
                          aria-hidden
                        />
                        <div className={clsx("grow-x absolute inset-y-[7px] left-0 rounded-[2px]", lead ? "bg-pen" : "bg-ink")} style={{ width: x(rate ?? 0), ...stagger(i) }} />
                      </>
                    )}
                  </div>
                  {trials > 0 && (
                    <p className="mt-1 text-[13px] text-ink-2">
                      True rate likely between <span className="font-semibold tabular-nums">{pct(a.ci90_low, 0)}</span> and <span className="font-semibold tabular-nums">{pct(a.ci90_high, 0)}</span>
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          {!noData && <p className="mt-3 text-[13px] text-muted">Solid bar: the rate so far. Shaded box: where the real rate most likely sits (9 times in 10). When the boxes overlap a lot, the versions may really be equal.</p>}
        </div>

        {/* 3. Progress to a decision */}
        <div className="border-t border-line pt-5">
          {decided ? (
            <p className="text-[15px] text-pen-ink">
              <span className="font-semibold">Decision: </span>
              {exp.decision.winner ? `${name(arms.findIndex((a) => a.asset_id === exp.decision.winner || a.variant === exp.decision.winner), arms.find((a) => a.asset_id === exp.decision.winner || a.variant === exp.decision.winner) ?? arms[0])} wins. ` : ""}
              {plain}
            </p>
          ) : arms.some((a) => (a.trials ?? 0) < minTrials) ? (
            <>
              <p className="mb-2 text-[14px] font-semibold">Before Counterpart can judge</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {arms.map((a, i) => {
                  const got = Math.min(a.trials ?? 0, minTrials);
                  return (
                    <div key={a.asset_id}>
                      <div className="flex justify-between text-[13px]">
                        <span>{name(i, a)}</span>
                        <span className="tabular-nums text-muted">
                          {got} of {minTrials} link opens
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-sunken">
                        <div className="grow-x h-full rounded-full bg-ink" style={{ width: `${(got / minTrials) * 100}%`, ...stagger(i) }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-[13px] text-muted">Each version needs {minTrials} opened links. Share both versions to get there faster.</p>
            </>
          ) : (
            <>
              <p className="mb-1 text-[14px] font-semibold">Why there is no winner yet</p>
              <p className="text-[15px] text-ink-2">{plain}</p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
