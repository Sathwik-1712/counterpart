/* Channel previews. Text is the exact rendered copy (owner-approved fact wording);
   the picture never carries offer text, so what you see here is what customers get. */
import clsx from "clsx";
import type { Asset } from "@/lib/types";

type Rendered = NonNullable<NonNullable<Asset["revision"]>["rendered"]>;

const BACKDROP = "bg-[linear-gradient(160deg,#6d4c3b,#2b211c)]"; // stand-in until a picture is generated

function Picture({ url, className, children }: { url: string | null; className?: string; children?: React.ReactNode }) {
  return (
    <div className={clsx("relative overflow-hidden", !url && BACKDROP, className)}>
      {url && <img src={url} alt="" className="absolute inset-0 h-full w-full object-cover" />}
      {children}
    </div>
  );
}

export function WhatsAppPreview({ r, business }: { r: Rendered; business: string }) {
  return (
    <div className="rounded-md bg-[#e9e4da] p-3">
      <div className="max-w-[92%] rounded-lg rounded-tl-none bg-[#d9fdd3] px-3 py-2 text-[14px] leading-snug text-[#111b21] shadow-[0_1px_0_rgba(0,0,0,0.08)]">
        <p className="mb-1 text-xs font-semibold text-[#1f7a4d]">{business}</p>
        {r.headline && <p className="font-semibold">{r.headline}</p>}
        <p className="whitespace-pre-line">{r.body}</p>
        {r.cta && <p className="mt-1">{r.cta}</p>}
      </div>
    </div>
  );
}

export function InstagramPreview({ r, image, business }: { r: Rendered; image: string | null; business: string }) {
  return (
    <div className="overflow-hidden rounded-md border border-line bg-white">
      <p className="px-3 py-2 text-[13px] font-semibold">{business.toLowerCase().replace(/\s+/g, "")}</p>
      <Picture url={image} className="aspect-square">
        <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/45 to-transparent p-4">
          <p className="font-display text-[22px] font-semibold leading-tight text-white">{r.headline}</p>
        </div>
      </Picture>
      <div className="space-y-1 px-3 py-2 text-[13px] leading-snug">
        <p>{r.body}</p>
        {r.cta && <p className="font-medium">{r.cta}</p>}
        {r.hashtags.length > 0 && <p className="text-[#00376b]">{r.hashtags.join(" ")}</p>}
      </div>
    </div>
  );
}

export function StoryPreview({ r, image }: { r: Rendered; image: string | null }) {
  return (
    <Picture url={image} className="mx-auto aspect-[9/16] max-w-[220px] rounded-md">
      <div className="absolute inset-0 flex flex-col justify-between bg-gradient-to-b from-black/50 via-transparent to-black/60 p-4 text-white">
        <p className="font-display text-[20px] font-semibold leading-tight">{r.headline}</p>
        <div className="space-y-2 text-[13px] leading-snug">
          <p>{r.body}</p>
          {r.cta && <p className="rounded-md bg-white px-3 py-1.5 text-center font-medium text-ink">{r.cta}</p>}
        </div>
      </div>
    </Picture>
  );
}

export function PosterPreview({ r, image, code }: { r: Rendered; image: string | null; code: string | null }) {
  return (
    <div className="mx-auto aspect-[3/4] max-w-[260px] overflow-hidden rounded-md border border-line bg-white">
      <Picture url={image} className="h-[56%]" />
      <div className="flex h-[44%] flex-col justify-between p-3">
        <div>
          <p className="font-display text-[19px] font-semibold leading-tight">{r.headline}</p>
          <p className="mt-1 text-[12px] leading-snug text-ink-2">{r.body}</p>
        </div>
        <div className="flex items-end justify-between gap-2">
          <p className="text-[12px] font-medium">{r.cta}</p>
          {code ? (
            <img src={`/api/public/qr/${code}.png`} alt={`QR code ${code}`} className="h-14 w-14" />
          ) : (
            <span className="text-[10px] text-muted">QR added when live</span>
          )}
        </div>
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
      return <WhatsAppPreview r={r} business={business} />;
    case "instagram_post":
      return <InstagramPreview r={r} image={asset.image_url} business={business} />;
    case "instagram_story":
      return <StoryPreview r={r} image={asset.image_url} />;
    case "poster":
      return <PosterPreview r={r} image={asset.image_url} code={code} />;
  }
}
