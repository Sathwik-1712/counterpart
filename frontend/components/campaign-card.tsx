import { ArrowUpRight, Megaphone } from "@phosphor-icons/react";
import Link from "next/link";
import type { CampaignSummary } from "@/lib/types";
import { StatusPill, stagger } from "./ui";

/** A running campaign, led by its own picture. */
export function CampaignCard({ c, i = 0 }: { c: CampaignSummary; i?: number }) {
  return (
    <Link
      href={`/campaigns/${c.id}`}
      className="rise-in lift group flex flex-col overflow-hidden rounded-[var(--radius-lg)] bg-surface shadow-[var(--shadow-soft)] ring-1 ring-line/80"
      style={stagger(i)}
    >
      <div className="forest relative aspect-[16/10] overflow-hidden">
        {c.cover_url ? (
          <img src={c.cover_url} alt="" className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:scale-[1.04]" />
        ) : (
          <Megaphone size={40} weight="light" className="absolute left-6 top-6 text-white/40" aria-hidden />
        )}
        <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_45%,rgba(8,20,13,0.78)_100%)]" />
        <p className="absolute inset-x-5 bottom-4 text-[19px] font-semibold leading-tight tracking-tight text-white">{c.name}</p>
        <span className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-ink opacity-0 transition-all duration-300 group-hover:opacity-100">
          <ArrowUpRight size={16} weight="bold" aria-hidden />
        </span>
      </div>
      <div className="flex items-center gap-5 px-5 py-4">
        <dl className="flex flex-1 gap-6">
          {[
            ["Posts", c.assets],
            ["Live", c.live ?? 0],
            ["Redeemed", c.redemptions],
          ].map(([label, v]) => (
            <div key={label as string}>
              <dd className="text-[20px] font-semibold leading-none tracking-tight tabular-nums">{v}</dd>
              <dt className="mt-1 text-xs text-muted">{label}</dt>
            </div>
          ))}
        </dl>
        <StatusPill status={c.status} />
      </div>
    </Link>
  );
}
