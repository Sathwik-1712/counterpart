/* The posts customers see. The picture never carries text: the headline and body are the model's, and the offer
   box and call to action are drawn here from the locked facts, so the wording is exactly what the owner approved.
   Sizes are in container units, so the same layout exports as a crisp 1080px PNG. */
"use client";

import clsx from "clsx";
import type { ReactNode } from "react";
import { usePostStyle } from "@/lib/post-style";
import type { Asset } from "@/lib/types";

type Rendered = NonNullable<NonNullable<Asset["revision"]>["rendered"]>;

/** A faint, tiled copyright mark across the photo plus a clear one in the corner: small enough not to spoil the
 *  picture, spread out enough that it cannot simply be cropped off. Owners can switch it off on the Brand page. */
function Watermark({ name }: { name?: string }) {
  const { watermark } = usePostStyle();
  if (!watermark || !name) return null;
  const mark = `© ${name}`;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div className="absolute left-1/2 top-1/2 grid w-[180%] -translate-x-1/2 -translate-y-1/2 -rotate-[24deg] grid-cols-4 gap-x-[8cqw] gap-y-[11cqw] whitespace-nowrap text-[2.4cqw] font-semibold uppercase tracking-[0.18em] text-white/[0.14]">
        {Array.from({ length: 28 }, (_, i) => (
          <span key={i} className={i % 8 >= 4 ? "translate-x-[9cqw]" : ""}>
            {mark}
          </span>
        ))}
      </div>
      <span className="absolute bottom-[1.6cqw] right-[2.4cqw] text-[2.3cqw] font-semibold text-white/80 [text-shadow:0_1px_2px_rgba(0,0,0,0.55)]">{mark}</span>
    </div>
  );
}

function Picture({ url, className, children, mark }: { url: string | null; className?: string; children?: ReactNode; mark?: string }) {
  return (
    <div className={clsx("relative overflow-hidden bg-[radial-gradient(120%_90%_at_20%_15%,#3a3830_0%,#16150f_70%)]", className)}>
      {url && <img src={url} alt="" className="absolute inset-0 h-full w-full object-cover" crossOrigin="anonymous" />}
      {url && <Watermark name={mark} />}
      {children}
    </div>
  );
}

function OfferBox({ lines, className, light = true }: { lines: string[]; className?: string; light?: boolean }) {
  if (!lines.length) return null;
  const [lead, ...rest] = lines;
  return (
    <div className={clsx("rounded-[3cqw] px-[4cqw] py-[3cqw]", light ? "bg-white/95 text-[#18181b]" : "bg-[#f4f4f3] text-[#18181b]", className)}>
      <p className="text-[5.2cqw] font-semibold leading-tight tracking-tight">{lead}</p>
      {rest.length > 0 && <p className="mt-[1cqw] text-[3.3cqw] leading-snug text-[#3f3f46]">{rest.join(" · ")}</p>}
    </div>
  );
}

function Cta({ text, code }: { text: string; code: string | null }) {
  return (
    <div className="flex items-center gap-[2cqw]">
      <span className="rounded-[var(--radius-sm)] bg-[var(--color-brand)] px-[4cqw] py-[1.8cqw] text-[3.4cqw] font-semibold text-white">{text}</span>
      {code && <span className="rounded-[var(--radius-sm)] bg-black/55 px-[3cqw] py-[1.8cqw] font-receipt text-[3.2cqw] text-white">{code}</span>}
    </div>
  );
}

function Brand({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-[1.5cqw] rounded-[var(--radius-sm)] bg-black/35 px-[3cqw] py-[1.2cqw] text-[3cqw] font-medium text-white backdrop-blur-sm">
      <span className="h-[1.6cqw] w-[1.6cqw] rounded-full bg-[#ffd43b]" aria-hidden />
      {name}
    </span>
  );
}

export function InstagramPost({ r, image, business, code }: { r: Rendered; image: string | null; business: string; code: string | null }) {
  return (
    <div className="bg-white">
      <Picture url={image} mark={business} className="@container aspect-square w-full">
        <div className="absolute inset-0 flex flex-col justify-between bg-[linear-gradient(180deg,rgba(0,0,0,0.42)_0%,rgba(0,0,0,0)_34%,rgba(0,0,0,0)_52%,rgba(0,0,0,0.6)_100%)] p-[5cqw]">
          <div className="space-y-[3cqw]">
            <Brand name={business} />
            <p className="max-w-[92%] font-display text-[7.6cqw] font-semibold leading-[1.06] tracking-tight text-white [text-shadow:0_1px_12px_rgba(0,0,0,0.35)]">
              {r.headline}
            </p>
          </div>
          <div className="space-y-[2.5cqw]">
            <OfferBox lines={r.offer ?? []} />
            <Cta text={r.cta} code={code} />
          </div>
        </div>
      </Picture>
      {(r.body || r.hashtags.length > 0) && (
        <div className="px-3 py-2.5 text-[13px] leading-snug text-[#18181b]">
          <span className="font-semibold">{business.toLowerCase().replace(/\s+/g, "")}</span> {r.body}
          {r.hashtags.length > 0 && <span className="block pt-1 text-[#00376b]">{r.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")}</span>}
        </div>
      )}
    </div>
  );
}

export function Story({ r, image, business, code }: { r: Rendered; image: string | null; business: string; code: string | null }) {
  return (
    <Picture url={image} mark={business} className="@container aspect-[9/16] w-full">
      <div className="absolute inset-0 flex flex-col justify-between bg-[linear-gradient(180deg,rgba(0,0,0,0.55)_0%,rgba(0,0,0,0)_32%,rgba(0,0,0,0)_50%,rgba(0,0,0,0.75)_100%)] p-[6cqw]">
        <div className="space-y-[3cqw]">
          <Brand name={business} />
          <p className="font-display text-[9.5cqw] font-semibold leading-[1.05] tracking-tight text-white">{r.headline}</p>
          {r.body && <p className="text-[4.6cqw] leading-snug text-white/90">{r.body}</p>}
        </div>
        <div className="space-y-[4cqw]">
          <OfferBox lines={r.offer ?? []} />
          <Cta text={r.cta} code={code} />
        </div>
      </div>
    </Picture>
  );
}

export function Poster({ r, image, business, code }: { r: Rendered; image: string | null; business: string; code: string | null }) {
  return (
    <div className="@container flex aspect-[3/4] w-full flex-col overflow-hidden bg-white">
      <Picture url={image} mark={business} className="h-[54%]">
        <div className="absolute left-[5cqw] top-[5cqw]">
          <Brand name={business} />
        </div>
      </Picture>
      <div className="flex flex-1 flex-col justify-between p-[5cqw]">
        <div>
          <p className="font-display text-[7cqw] font-semibold leading-[1.05] tracking-tight">{r.headline}</p>
          {r.body && <p className="mt-[1.5cqw] text-[3.4cqw] leading-snug text-[#3f3f46]">{r.body}</p>}
        </div>
        <div className="flex items-end justify-between gap-[3cqw]">
          <OfferBox lines={r.offer ?? []} light={false} className="flex-1" />
          {code ? (
            <img src={`/api/public/qr/${code}.png`} alt={`QR code ${code}`} className="h-[22cqw] w-[22cqw]" />
          ) : (
            <span className="w-[22cqw] text-center text-[2.6cqw] text-[#71717a]">QR code added when it goes live</span>
          )}
        </div>
        <p className="mt-[2cqw] text-[3.4cqw] font-semibold text-[var(--color-brand)]">{r.cta}</p>
      </div>
    </div>
  );
}

export function WhatsAppMessage({ r, business, code }: { r: Rendered; business: string; code: string | null }) {
  return (
    <div className="bg-[#efeae2] p-4">
      <div className="max-w-[94%] rounded-2xl rounded-tl-sm bg-white px-3.5 py-2.5 text-[14px] leading-snug text-[#111b21] shadow-[0_1px_0_rgba(0,0,0,0.08)]">
        <p className="mb-1 text-xs font-semibold text-[#128c7e]">{business}</p>
        {r.headline && <p className="font-semibold">{r.headline}</p>}
        {r.body && <p className="mt-1 whitespace-pre-line">{r.body}</p>}
        {(r.offer ?? []).length > 0 && (
          <ul className="mt-2 space-y-0.5">
            {(r.offer ?? []).map((l, i) => (
              <li key={i} className={i === 0 ? "font-semibold" : ""}>
                ✓ {l}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2">
          {r.cta}
          {code && <span className="font-semibold">: {code}</span>}
        </p>
      </div>
    </div>
  );
}

export function ChannelPreview({ asset, business }: { asset: Asset; business: string }) {
  const r = asset.revision?.rendered;
  if (!r) return null;
  const code = asset.touchpoints?.[0]?.code ?? null;
  switch (asset.channel) {
    case "whatsapp":
      return <WhatsAppMessage r={r} business={business} code={code} />;
    case "instagram_post":
      return <InstagramPost r={r} image={asset.image_url} business={business} code={code} />;
    case "instagram_story":
      return <Story r={r} image={asset.image_url} business={business} code={code} />;
    case "poster":
      return <Poster r={r} image={asset.image_url} business={business} code={code} />;
  }
}
