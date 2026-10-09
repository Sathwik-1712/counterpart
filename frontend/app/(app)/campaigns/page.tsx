"use client";

import { Plus } from "@phosphor-icons/react";
import Link from "next/link";
import { CampaignLedger } from "@/components/campaign-card";
import { Shell } from "@/components/shell";
import { Empty, PageHeader, SectionHeading, Skeleton } from "@/components/ui";
import { useResource } from "@/lib/api";
import { useBusiness } from "@/lib/business";
import { STEPS } from "@/lib/journey";
import type { Overview } from "@/lib/types";

export default function Campaigns() {
  const business = useBusiness();
  const { data } = useResource<Overview>(`/businesses/${business.slug}`);
  const current = data?.campaigns.filter((c) => !c.is_historical) ?? [];
  const past = data?.campaigns.filter((c) => c.is_historical) ?? [];
  return (
    <Shell>
      <PageHeader
        title="Campaigns"
        sub={`Each campaign moves through the same steps: ${STEPS.map((s) => s.label.toLowerCase()).join(", ")}. The bar shows where each one is.`}
        aside={
          <Link href="/" className="press inline-flex h-11 items-center gap-2 rounded-[var(--radius-sm)] bg-ink px-4 text-[15px] font-semibold text-white hover:bg-ink-2">
            <Plus size={16} weight="bold" aria-hidden /> New campaign
          </Link>
        }
      />

      <section className="mb-16" aria-labelledby="now-h">
        <SectionHeading id="now-h" title="Running now" className="border-b-0" />
        {!data ? <Skeleton className="h-48" /> : current.length ? <CampaignLedger campaigns={current} /> : <Empty>Nothing running. Start one from Today.</Empty>}
      </section>

      {past.length > 0 && (
        <section aria-labelledby="past-h">
          <SectionHeading id="past-h" title="Past campaigns" className="border-b-0" sub={business.is_demo ? "Imported history (synthetic demo data). Counterpart learns from these." : "Counterpart learns from these."} />
          <CampaignLedger campaigns={past} />
        </section>
      )}
    </Shell>
  );
}
