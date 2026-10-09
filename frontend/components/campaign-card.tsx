import { ArrowRight, Megaphone } from "@phosphor-icons/react";
import clsx from "clsx";
import Link from "next/link";
import { nextAction, stepOfSummary } from "@/lib/journey";
import type { CampaignSummary } from "@/lib/types";
import { JourneyMini } from "./journey";
import { stagger } from "./ui";

const when = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : null);

/** One line of the campaign ledger: picture, name, where it is in the flow, and the numbers that matter. */
export function CampaignRow({ c, i = 0 }: { c: CampaignSummary; i?: number }) {
  const step = stepOfSummary(c);
  const needsYou = step === 1 || step === 2;
  const dates = [when(c.starts_on), when(c.ends_on)].filter(Boolean).join(" to ");
  return (
    <li className="rise-in" style={stagger(i)}>
      <Link
        href={`/campaigns/${c.id}`}
        className="group grid grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-b border-line py-4 transition-colors hover:bg-ink/[0.025] md:grid-cols-[72px_minmax(0,1.4fr)_minmax(0,1fr)_150px_24px] md:gap-x-6"
      >
        <span className="relative block aspect-square w-full overflow-hidden rounded-[var(--radius-md)] bg-ink">
          {c.cover_url ? (
            <img src={c.cover_url} alt="" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
          ) : (
            <Megaphone size={22} className="absolute inset-0 m-auto text-white/50" aria-hidden />
          )}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[20px] font-bold leading-tight [font-stretch:90%] md:text-[22px]">{c.name}</span>
          <span className="mt-0.5 block truncate text-[13px] text-muted">{dates || (c.is_historical ? "Past campaign" : c.live ? `Running since ${when(c.created_at)}, no end date` : `Started ${when(c.created_at)}`)}</span>
        </span>
        <span className="col-span-3 min-w-0 md:col-span-1">
          <JourneyMini step={step} className="max-w-[220px]" />
          <span className={clsx("mt-1.5 block truncate text-[13px] font-semibold", needsYou ? "text-ink" : "text-muted")}>
            {needsYou && <span className="hl">{nextAction(step)}</span>}
            {!needsYou && (step >= 5 ? "Finished" : nextAction(step))}
          </span>
        </span>
        <span className="col-start-3 row-start-1 flex gap-5 text-right md:col-start-auto md:row-start-auto">
          <span>
            <span className="sign tabular block text-[28px]">{c.live ?? 0}</span>
            <span className="block text-[12px] text-muted">live</span>
          </span>
          <span>
            <span className={clsx("sign tabular block text-[28px]", c.redemptions > 0 && "text-pen")}>{c.redemptions}</span>
            <span className="block text-[12px] text-muted">redeemed</span>
          </span>
        </span>
        <ArrowRight size={18} className="hidden text-muted transition-transform duration-200 group-hover:translate-x-1 group-hover:text-ink md:block" aria-hidden />
      </Link>
    </li>
  );
}

export function CampaignLedger({ campaigns }: { campaigns: CampaignSummary[] }) {
  return (
    <ul className="border-t border-ink">
      {campaigns.map((c, i) => (
        <CampaignRow key={c.id} c={c} i={i} />
      ))}
    </ul>
  );
}
