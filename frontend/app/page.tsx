"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Composer } from "@/components/composer";
import { FindingsList, InboxList } from "@/components/inbox";
import { Shell } from "@/components/shell";
import { SectionHeading, StatusPill } from "@/components/ui";
import { api, BUSINESS, useResource } from "@/lib/api";
import type { Overview } from "@/lib/types";

export default function Today() {
  const router = useRouter();
  const { data, error, reload } = useResource<Overview>(`/businesses/${BUSINESS}`);
  const current = data?.campaigns.filter((c) => !c.is_historical) ?? [];

  async function newBrief(text: string) {
    const c = await api<{ id: string }>(`/businesses/${BUSINESS}/campaigns`, { method: "POST", json: { brief: text } });
    router.push(`/campaigns/${c.id}`);
  }

  return (
    <Shell>
      <header className="mb-6">
        <p className="text-sm text-muted">
          {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
        </p>
        <h1 className="mt-1 text-[28px]">What would you like customers to hear?</h1>
      </header>

      <Composer
        placeholder="Say it the way you'd tell a regular, e.g. “20% off filter coffee with any snack this weekend, mornings only, dine-in.”"
        submitLabel="Start campaign"
        onSubmit={newBrief}
      />

      {error && <p className="mt-6 text-sm text-kumkum">{error}</p>}

      <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_280px]">
        <section>
          <SectionHeading title="Needs you" aside={data && <span className="text-sm text-muted">{data.inbox.length} waiting</span>} />
          {data && <InboxList items={data.inbox} onChange={reload} />}
        </section>
        <section>
          <SectionHeading title="Counterpart noticed" />
          {data && <FindingsList findings={data.findings} />}
        </section>
      </div>

      <section className="mt-10">
        <SectionHeading title="Campaigns" aside={<Link href="/campaigns" className="text-sm text-leaf hover:underline">All campaigns</Link>} />
        {current.length === 0 ? (
          <p className="text-sm text-muted">No campaign running. Tell Counterpart what you want to promote.</p>
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {current.slice(0, 5).map((c) => (
              <li key={c.id}>
                <Link href={`/campaigns/${c.id}`} className="flex items-center gap-3 py-3 hover:bg-surface/60">
                  <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                  <span className="text-sm text-muted">{c.assets} pieces</span>
                  <span className="w-24 text-right text-sm text-muted">{c.redemptions} claimed</span>
                  <StatusPill status={c.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Shell>
  );
}
