"use client";

import { Brain, CheckCircle, Eye, ImageSquare, PenNib, ShieldCheck, UserCircle, WarningCircle } from "@phosphor-icons/react";
import clsx from "clsx";
import { useEffect, useState } from "react";
import { Shell } from "@/components/shell";
import { PageHeader, SectionHeading, Skeleton, stagger, timeAgo } from "@/components/ui";
import { useResource } from "@/lib/api";
import { useBusiness } from "@/lib/business";
import type { AgentInfo, ModelCall } from "@/lib/types";

const ICON: Record<string, typeof Brain> = { reasoning: Brain, generation: PenNib, verification: ShieldCheck, vision: Eye, image: ImageSquare };
const TASK: Record<string, string> = {
  plan: "Deciding the next step",
  draft_offer_facts: "Writing the offer down",
  lock_facts: "Locking the offer",
  set_campaign_plan: "Planning audiences and channels",
  revise_offer_facts: "Updating the offer",
  get_situation: "Reading the situation",
  get_customer_themes: "Reading customer reviews",
  get_brand_and_learnings: "Reading your brand voice",
  decide_experiment: "Picking the A/B winner",
  record_learning: "Remembering what worked",
  recommend: "Writing a suggestion for you",
  generate_copy: "Writing and checking posts",
  validate_assets: "Checking posts",
  generate_visual: "Choosing a picture",
  read_photos: "Reading your photos",
  evaluate_offer: "Checking the margin",
  publish_assets: "Publishing",
  create_experiment: "Setting up an A/B test",
};
const taskLabel = (t: string | null) => (t ? (TASK[t] ?? t.replace(/_/g, " ")) : "Working");

/** The pipeline every campaign runs through; dots travel along the links while agents work. */
function Pipeline({ live }: { live: Set<string> }) {
  const nodes = [
    { role: "reasoning", label: "Planner" },
    { role: "generation", label: "Writer" },
    { role: "verification", label: "Checker" },
    { role: "owner", label: "You approve" },
  ];
  return (
    <div className="night rise-in overflow-hidden rounded-[var(--radius-lg)] p-6 md:p-8">
      <p className="text-sm text-marker">How a campaign moves</p>
      <ol className="mt-6 grid grid-cols-2 gap-y-6 md:flex md:items-center">
        {nodes.map((n, i) => {
          const Icon = n.role === "owner" ? UserCircle : ICON[n.role];
          const on = live.has(n.role);
          return (
            <li key={n.role} className="flex items-center md:flex-1">
              <div className="flex flex-col items-center gap-2 text-center">
                <span className={clsx("relative inline-flex h-14 w-14 items-center justify-center rounded-[var(--radius-lg)] transition-colors duration-500", on ? "bg-marker text-ink" : "bg-white/10 text-white")}>
                  <Icon size={24} weight={on ? "fill" : "regular"} aria-hidden />
                  {on && <span className="pulse-dot absolute -right-1 -top-1 h-3 w-3 rounded-full bg-marker ring-2 ring-ink" />}
                </span>
                <span className="text-[13px] font-medium">{n.label}</span>
              </div>
              {i < nodes.length - 1 && (
                <span className="relative mx-3 hidden h-px flex-1 bg-white/20 md:block" aria-hidden>
                  <span className="flow-dot absolute -top-[3px] h-[7px] w-[7px] rounded-full bg-marker" style={stagger(i)} />
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <p className="mt-6 max-w-[60ch] text-sm text-white/70">
        The Photo reader works alongside: it reads your photos once so the Writer's posts get a fitting real picture. Nothing reaches customers until you approve it.
      </p>
    </div>
  );
}

export default function AgentsPage() {
  const business = useBusiness();
  const { data, reload } = useResource<{ agents: AgentInfo[]; calls: (ModelCall & { at: number })[] }>(`/businesses/${business.slug}/agents`);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
      reload();
    }, 5000);
    return () => clearInterval(t);
  }, [reload]);
  const live = new Set((data?.agents ?? []).filter((a) => a.last && now / 1000 - a.last.at < 30).map((a) => a.role));

  return (
    <Shell>
      <PageHeader title="Your AI team" sub="Five agents, each with one job and its own model. The one that writes a post is never the one that checks it." />
      <Pipeline live={live} />

      <div className="mt-12">
        <section aria-labelledby="team-h">
          <SectionHeading id="team-h" title="Who does what" />
          {!data ? (
            <Skeleton className="h-64" />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {data.agents.map((a, i) => {
                const Icon = ICON[a.role] ?? Brain;
                const working = live.has(a.role);
                return (
                  <article
                    key={a.role}
                    className={clsx("rise-in flex flex-col rounded-[var(--radius-lg)] p-6 ring-1 transition-shadow duration-500", working ? "bg-surface shadow-[var(--shadow-lift)] ring-pen/40" : "bg-surface shadow-[var(--shadow-soft)] ring-line/80")}
                    style={stagger(i)}
                  >
                    <div className="flex items-start gap-3">
                      <span className={clsx("inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-lg)]", working ? "bg-ink text-marker" : "bg-pen-soft text-pen-ink")}>
                        <Icon size={21} weight="duotone" aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[17px] font-semibold tracking-tight">{a.name}</p>
                        <p className={clsx("flex items-center gap-1.5 text-[13px]", working ? "text-pen-ink" : "text-muted")}>
                          {working ? (
                            <>
                              <span className="typing font-bold" aria-hidden>
                                <span>·</span>
                                <span>·</span>
                                <span>·</span>
                              </span>
                              {taskLabel(a.last?.task ?? null)}
                            </>
                          ) : a.last ? (
                            `Last worked ${timeAgo(new Date(a.last.at * 1000).toISOString())}`
                          ) : (
                            "Waiting for work"
                          )}
                        </p>
                      </div>
                    </div>
                    <p className="mt-4 text-[14px] leading-relaxed text-ink-2">{a.job}</p>
                    <div className="mt-auto pt-5">
                      <p className="mb-1.5 text-[12px] text-muted">Models, in order</p>
                      <div className="flex flex-wrap gap-1.5">
                        {a.models.length ? (
                          a.models.map((m, j) => (
                            <span key={m} className={clsx("rounded-[var(--radius-sm)] px-2.5 py-0.5 font-receipt text-[12px]", j === 0 ? "bg-ink text-white" : "bg-sunken text-ink-2")}>
                              {m}
                            </span>
                          ))
                        ) : (
                          <span className="text-[13px] text-muted">Not configured</span>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          <section className="mt-12" aria-labelledby="calls-h">
            <SectionHeading id="calls-h" title="Recent model calls" sub="Since the server last started. Backups take over when a model is busy or out of quota. For every step the agents take, switch on Log in the top bar." />
            {data && data.calls.length === 0 ? (
              <p className="text-sm text-muted">No model calls yet for this business.</p>
            ) : (
              <ul className="overflow-hidden rounded-[var(--radius-lg)] bg-surface shadow-[var(--shadow-soft)] ring-1 ring-line/80">
                {data?.calls.slice(0, 15).map((c, i) => (
                  <li key={`${c.at}-${i}`} className="flex items-center gap-3 border-b border-line px-5 py-3 text-sm last:border-0">
                    {c.ok ? <CheckCircle size={16} weight="fill" className="shrink-0 text-pen" aria-hidden /> : <WarningCircle size={16} weight="fill" className="shrink-0 text-turmeric" aria-hidden />}
                    <span className="w-28 shrink-0 font-medium">{data.agents.find((a) => a.role === c.role)?.name ?? c.role}</span>
                    <span className="min-w-0 flex-1 truncate text-ink-2">{c.ok ? taskLabel(c.task) : `Moved on: ${c.error ?? "model unavailable"}`}</span>
                    <span className="hidden font-receipt text-[13px] text-muted sm:inline">{c.model}</span>
                    <span className="w-14 shrink-0 text-right text-[13px] tabular-nums text-muted">{(c.latency_ms / 1000).toFixed(1)}s</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </section>

      </div>
    </Shell>
  );
}
