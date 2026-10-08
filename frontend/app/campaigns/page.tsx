"use client";

import Link from "next/link";
import { Shell } from "@/components/shell";
import { SectionHeading, StatusPill } from "@/components/ui";
import { BUSINESS, useResource } from "@/lib/api";
import type { CampaignSummary, Overview } from "@/lib/types";

function Table({ rows }: { rows: CampaignSummary[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted">
            <th className="py-2 pr-4 font-medium">Campaign</th>
            <th className="py-2 pr-4 font-medium">When</th>
            <th className="py-2 pr-4 text-right font-medium">Pieces</th>
            <th className="py-2 pr-4 text-right font-medium">Claimed</th>
            <th className="py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="border-b border-line">
              <td className="py-2.5 pr-4">
                <Link href={`/campaigns/${c.id}`} className="font-medium hover:underline">
                  {c.name}
                </Link>
              </td>
              <td className="py-2.5 pr-4 text-ink-2">
                {c.starts_on ? new Date(c.starts_on).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "Not scheduled"}
              </td>
              <td className="py-2.5 pr-4 text-right tabular-nums">{c.assets}</td>
              <td className="py-2.5 pr-4 text-right tabular-nums">{c.redemptions}</td>
              <td className="py-2.5">
                <StatusPill status={c.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Campaigns() {
  const { data } = useResource<Overview>(`/businesses/${BUSINESS}`);
  const current = data?.campaigns.filter((c) => !c.is_historical) ?? [];
  const past = data?.campaigns.filter((c) => c.is_historical) ?? [];
  return (
    <Shell>
      <h1 className="mb-6 text-[26px]">Campaigns</h1>
      <section className="mb-10">
        <SectionHeading title="This season" />
        {current.length ? <Table rows={current} /> : <p className="text-sm text-muted">Start one from Today.</p>}
      </section>
      <section>
        <SectionHeading title="Past campaigns" aside={<span className="text-xs text-muted">Imported history, synthetic demo data</span>} />
        <Table rows={past} />
      </section>
    </Shell>
  );
}
