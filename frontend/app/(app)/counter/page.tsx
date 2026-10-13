"use client";

import { Check, Copy, DeviceMobile, QrCode, WhatsappLogo } from "@phosphor-icons/react";
import { useState } from "react";
import { RedeemDesk, type DeskCall } from "@/components/redeem-desk";
import { Shell } from "@/components/shell";
import { Button, Empty, PageHeader, SectionHeading } from "@/components/ui";
import { api, useResource } from "@/lib/api";
import { useBusiness } from "@/lib/business";

interface CounterInfo {
  pin_set: boolean;
  staff_phones: number;
  whatsapp: string | null;
  staff_link: string;
  recent: { at: string; code: string; campaign: string; bill_amount: number | null; outside_rules: string | null }[];
}

const call: DeskCall = (action, body) => api(`/counter/${action}`, { method: "POST", json: body });

const field =
  "h-11 w-full rounded-[var(--radius-md)] bg-surface px-3.5 text-[15px] shadow-[inset_0_0_0_1.5px_var(--color-line-strong)] outline-none focus:shadow-[inset_0_0_0_1.5px_var(--color-ink)]";

function Settings({ info, onChange }: { info: CounterInfo; onChange: () => void }) {
  const business = useBusiness();
  const [pin, setPin] = useState("");
  const [wa, setWa] = useState(info.whatsapp ? `+${info.whatsapp}` : "");
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function save(json: Record<string, string>, what: string) {
    setError(null);
    try {
      await api(`/businesses/${business.slug}/counter`, { method: "PUT", json });
      setSaved(what);
      setPin("");
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-8">
      <section aria-labelledby="staff-h">
        <h2 id="staff-h" className="flex items-center gap-2 text-[20px]">
          <DeviceMobile size={20} aria-hidden /> Staff phones
        </h2>
        <p className="mt-1 text-[14px] text-ink-2">
          Staff don't need an account. Set a PIN, open the staff link on their phone and enter it once. Then they scan the QR on a customer's screen with the phone camera and tap Redeem.
        </p>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save({ pin }, info.pin_set ? "New PIN saved. Staff phones sign in again." : "PIN saved.");
          }}
        >
          <input className={field} inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder={info.pin_set ? "New PIN (4 to 6 digits)" : "Set a PIN (4 to 6 digits)"} aria-label="Counter PIN" />
          <Button type="submit" variant="primary" disabled={pin.length < 4}>
            Save
          </Button>
        </form>
        <p className="mt-2 text-[13px] text-muted">
          {info.pin_set ? `PIN is set · ${info.staff_phones} staff phone${info.staff_phones === 1 ? "" : "s"} signed in` : "No PIN yet, so only you can redeem, from this page."}
        </p>
        {info.pin_set && (
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(info.staff_link).then(() => setCopied(true))}
            className="press mt-3 flex w-full items-center gap-2 rounded-[var(--radius-md)] bg-paper px-3.5 py-2.5 text-left text-[14px] ring-1 ring-line"
          >
            <span className="min-w-0 flex-1 truncate font-receipt text-[12px]">{info.staff_link}</span>
            {copied ? <Check size={16} className="text-pen" aria-hidden /> : <Copy size={16} aria-hidden />}
            <span className="sr-only">Copy the staff link</span>
          </button>
        )}
      </section>

      <section aria-labelledby="wa-h">
        <h2 id="wa-h" className="flex items-center gap-2 text-[20px]">
          <WhatsappLogo size={20} aria-hidden /> Claims on WhatsApp
        </h2>
        <p className="mt-1 text-[14px] text-ink-2">
          With a number here, customers can also get their code by sending you a WhatsApp message with the code already typed in. You get their number and a chat you can reply to.
        </p>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save({ whatsapp: wa }, wa.trim() ? "WhatsApp number saved." : "WhatsApp claims switched off.");
          }}
        >
          <input className={field} inputMode="tel" value={wa} onChange={(e) => setWa(e.target.value)} placeholder="+91 98450 12345" aria-label="WhatsApp number" />
          <Button type="submit" variant="secondary">
            Save
          </Button>
        </form>
      </section>

      {saved && !error && <p className="text-[14px] text-pen">{saved}</p>}
      {error && (
        <p className="rounded-[var(--radius-md)] bg-kumkum-soft px-3.5 py-2.5 text-[14px] text-kumkum" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** The counter: check a customer's code against the locked offer, then redeem it once. */
export default function CounterPage() {
  const business = useBusiness();
  const { data, reload } = useResource<CounterInfo>(`/businesses/${business.slug}/counter`, (e) => e.type === "outcome.redeem");

  return (
    <Shell>
      <PageHeader title="Counter" sub="A customer shows their code. Counterpart checks it against the locked offer: right day, right time, not used before. Each redemption counts for the post that brought them in." />
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-12">
        <section className="rise-in lg:col-span-7" aria-label="Redeem a code">
          <RedeemDesk call={call} onRedeemed={reload} />
          <div className="mt-10">
            <SectionHeading title="Recent redemptions" />
            {!data?.recent.length ? (
              <Empty icon={<QrCode size={17} aria-hidden />}>Redeemed codes appear here, from this page and from staff phones.</Empty>
            ) : (
              <ul className="overflow-hidden rounded-[var(--radius-lg)] bg-receipt font-receipt text-[13px] ring-1 ring-line/80">
                {data.recent.map((r, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-dashed border-line px-5 py-3 last:border-0">
                    <span className="tracking-widest">{r.code}</span>
                    <span className="min-w-0 flex-1 truncate text-ink-2">{r.campaign}</span>
                    {r.bill_amount != null && <span className="tabular-nums">₹{r.bill_amount.toLocaleString("en-IN")}</span>}
                    <span className="text-muted">{new Date(r.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>
                    {r.outside_rules && <span className="w-full text-turmeric">Outside the offer rules: {r.outside_rules}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
        <aside className="lg:col-span-5">{data && <Settings info={data} onChange={reload} />}</aside>
      </div>
    </Shell>
  );
}
