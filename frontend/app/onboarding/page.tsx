"use client";

import { ArrowLeft, ArrowRight, Check, GoogleLogo, Globe, LinkSimple, Plus, SealCheck, Sparkle, Trash, UploadSimple } from "@phosphor-icons/react";
import clsx from "clsx";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { api } from "@/lib/api";
import { rememberBusiness } from "@/lib/business";

const KINDS = ["Café", "Restaurant", "Bakery", "Sweet shop", "Salon", "Clothing store", "Grocery", "Gym", "Clinic"];
const LANGS = [
  { code: "en", label: "English" },
  { code: "kn", label: "ಕನ್ನಡ" },
  { code: "hi", label: "हिन्दी" },
] as const;
const STEPS = ["Your business", "Where", "What you sell", "Photos and voice"];
const SETUP = ["Saving your business", "Drafting your brand voice", "Adding photos of your place", "Opening your workspace"];

interface Item {
  name: string;
  price: string;
  cost: string;
}

interface ReadLink {
  name?: string;
  kind?: string;
  city?: string;
  locality?: string;
  phone?: string;
  website?: string;
  languages?: string[];
  offerings: { name: string; price: number }[];
  notes: string[];
}

const field =
  "h-12 w-full rounded-[var(--radius-md)] bg-surface px-4 text-[15px] shadow-[inset_0_0_0_1.5px_var(--color-ink)] outline-none transition-shadow focus:shadow-[inset_0_0_0_1.5px_var(--color-ink),0_0_0_3px_var(--color-marker)]";

function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <span className="mb-1.5 block">
      <span className="text-sm font-medium">{children}</span>
      {hint && <span className="ml-1.5 text-[13px] text-muted">{hint}</span>}
    </span>
  );
}

/** Shrink big phone photos in the browser before upload (the server re-encodes again). */
async function toDataUrl(file: File, max = 2000): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.88);
}

export default function Onboarding() {
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("");
  const [otherKind, setOtherKind] = useState("");
  const [owner, setOwner] = useState("");
  const [city, setCity] = useState("");
  const [locality, setLocality] = useState("");
  const [langs, setLangs] = useState<string[]>(["en"]);
  const [items, setItems] = useState<Item[]>([{ name: "", price: "", cost: "" }]);
  const [whatsapp, setWhatsapp] = useState("");
  // Start from one link; the form fills itself and the owner checks everything on one page.
  const [mode, setMode] = useState<"link" | "review" | "steps">("link");
  const [link, setLink] = useState("");
  const [reading, setReading] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const [website, setWebsite] = useState("");
  const [google, setGoogle] = useState(true);
  const [googleOn, setGoogleOn] = useState(false);
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ features?: { google_photos?: boolean } }>("/me")
      .then((m) => setGoogleOn(!!m.features?.google_photos))
      .catch(() => {});
  }, []);

  const finalKind = kind === "Other" ? otherKind.trim() : kind;
  const goodItems = items.filter((i) => i.name.trim() && Number(i.price) > 0);
  const valid = [
    name.trim().length >= 2 && finalKind.length >= 2,
    city.trim().length >= 2 && locality.trim().length >= 2 && langs.length > 0,
    goodItems.length > 0,
    true,
  ];

  const review = mode === "review";
  const show = (n: number) => (review ? true : step === n);

  async function readLink(e: React.FormEvent) {
    e.preventDefault();
    setReading(true);
    setError(null);
    try {
      const r = await api<ReadLink>("/onboarding/read-link", { method: "POST", json: { link: link.trim() } });
      if (r.name) setName(r.name);
      if (r.kind) {
        const k = KINDS.find((x) => x.toLowerCase() === r.kind!.toLowerCase());
        setKind(k ?? "Other");
        if (!k) setOtherKind(r.kind);
      }
      if (r.city) setCity(r.city);
      if (r.locality) setLocality(r.locality);
      if (r.phone) setWhatsapp(r.phone);
      if (r.website) setWebsite(r.website);
      if (r.languages?.length) setLangs(r.languages);
      if (r.offerings.length) setItems(r.offerings.map((o) => ({ name: o.name, price: String(o.price), cost: "" })));
      setNotes(r.notes);
      setMode("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReading(false);
    }
  }

  function go(n: number) {
    setDir(n > step ? 1 : -1);
    setStep(n);
    setError(null);
  }

  async function finish() {
    setBusy(true);
    setError(null);
    setPhase(0);
    const timer = setInterval(() => setPhase((p) => Math.min(p + 1, SETUP.length - 2)), 1400);
    try {
      const b = await api<{ slug: string }>("/businesses", {
        method: "POST",
        json: {
          name: name.trim(),
          kind: finalKind,
          owner_name: owner.trim() || null,
          city: city.trim(),
          locality: locality.trim(),
          languages: langs,
          offerings: goodItems.map((i) => ({ name: i.name.trim(), price: Number(i.price), unit_cost: i.cost ? Number(i.cost) : null })),
          website: website.trim() || null,
          whatsapp: whatsapp.trim() || null,
          find_on_google: google && googleOn,
          description: description.trim() || null,
        },
      });
      clearInterval(timer);
      setPhase(2);
      for (const f of files) {
        try {
          await api(`/businesses/${b.slug}/photos`, { method: "POST", json: { data_url: await toDataUrl(f) } });
        } catch {
          // a photo that fails (too small, not an image) is skipped; the rest still go in
        }
      }
      setPhase(SETUP.length - 1);
      rememberBusiness(b.slug);
      setTimeout(() => (window.location.href = "/"), 700);
    } catch (e) {
      clearInterval(timer);
      setBusy(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (busy)
    return (
      <main className="night flex min-h-dvh items-center justify-center px-6">
        <div className="w-full max-w-sm">
          <img src="/icon.svg" alt="" className="pop mb-8 h-12 w-12" />
          <h1 className="text-[30px] tracking-[-0.03em] text-white">Setting up {name || "your business"}</h1>
          <ol className="mt-8 space-y-4">
            {SETUP.map((s, i) => (
              <li key={s} className={clsx("flex items-center gap-3 text-[15px] transition-opacity duration-500", i > phase ? "opacity-35" : "opacity-100")}>
                <span className={clsx("inline-flex h-7 w-7 items-center justify-center rounded-full", i < phase ? "bg-marker text-ink" : "bg-white/10 text-marker")}>
                  {i < phase ? <Check size={14} weight="bold" aria-hidden /> : i === phase ? <span className="pulse-dot h-2 w-2 rounded-full bg-marker" /> : null}
                </span>
                {s}
              </li>
            ))}
          </ol>
        </div>
      </main>
    );

  if (mode === "link")
    return (
      <main className="min-h-dvh px-5 py-8 md:py-14">
        <div className="mx-auto max-w-[620px]">
          <div className="mb-14 flex items-center gap-2.5">
            <img src="/icon.svg" alt="" className="h-9 w-9" />
            <span className="text-[16px] font-semibold tracking-tight">Counterpart</span>
          </div>
          <h1 className="text-[34px] tracking-[-0.035em] md:text-[46px]">Let's set up your business</h1>
          <p className="mt-3 max-w-[52ch] text-[16px] text-ink-2">Paste your website or your Google Maps link. Counterpart reads your name, area, phone and prices from it, and you check everything before anything is saved.</p>
          <form onSubmit={readLink} className="mt-8 space-y-3">
            <label className="block">
              <Label>
                <LinkSimple size={14} className="mr-1 inline" aria-hidden />
                Website or Google Maps link
              </Label>
              <input className={field} value={link} onChange={(e) => setLink(e.target.value)} placeholder="e.g. shearjoy.in or maps.app.goo.gl/…" inputMode="url" autoFocus />
            </label>
            <Button type="submit" variant="primary" size="lg" className="w-full" disabled={reading || link.trim().length < 4} trailing={!reading && <ArrowRight size={15} weight="bold" />}>
              {reading ? "Reading your page…" : "Fill it in for me"}
            </Button>
          </form>
          {reading && <p className="mt-3 text-[14px] text-muted">This takes about 10 to 20 seconds.</p>}
          {error && (
            <p className="pop mt-4 rounded-[var(--radius-md)] bg-kumkum-soft px-3.5 py-2.5 text-sm text-kumkum" role="alert">
              {error}
            </p>
          )}
          <button type="button" onClick={() => { setError(null); setMode("steps"); }} className="press mt-8 text-[15px] font-semibold underline decoration-ink/30 underline-offset-4 hover:decoration-ink">
            No website? Type it in yourself
          </button>
        </div>
      </main>
    );

  return (
    <main className="min-h-dvh px-5 py-8 md:py-14">
      <div className="mx-auto max-w-[620px]">
        <div className="mb-10 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src="/icon.svg" alt="" className="h-9 w-9" />
            <span className="text-[16px] font-semibold tracking-tight">Counterpart</span>
          </div>
          {!review && (
            <span className="text-sm text-muted">
              Step {step + 1} of {STEPS.length}
            </span>
          )}
        </div>

        <ol className={clsx("mb-10 grid grid-cols-4 gap-2", review && "hidden")} aria-label="Progress">
          {STEPS.map((s, i) => (
            <li key={s} className="h-1.5 overflow-hidden rounded-full bg-sunken" aria-current={i === step ? "step" : undefined}>
              <span
                className="block h-full rounded-full bg-pen transition-transform duration-700 ease-[cubic-bezier(0.32,0.72,0,1)]"
                style={{ transform: `scaleX(${i <= step ? 1 : 0})`, transformOrigin: "left" }}
              />
              <span className="sr-only">{s}</span>
            </li>
          ))}
        </ol>

        <div key={step} className={dir > 0 ? "step-in-right" : "step-in-left"}>
          <h1 className="text-[34px] tracking-[-0.035em] md:text-[42px]">{review ? "Check your details" : STEPS[step]}</h1>
          {review && (
            <div className="mt-4 space-y-1.5 text-[15px] text-ink-2">
              {(notes.length ? notes : ["Filled in what your page says. Fix anything that is wrong, and add what is missing."]).map((n) => (
                <p key={n} className="flex gap-2">
                  <SealCheck size={17} weight="fill" className="mt-0.5 shrink-0 text-pen" aria-hidden />
                  {n}
                </p>
              ))}
            </div>
          )}

          {review && <h2 className="mt-14 border-t border-ink pt-6 text-[24px]">{STEPS[0]}</h2>}
          {show(0) && (
            <div className="mt-8 space-y-6">
              <label className="block">
                <Label>Business name</Label>
                <input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Shear Joy Salon" autoFocus={!review} />
              </label>
              <div>
                <Label>What kind of business?</Label>
                <div className="flex flex-wrap gap-2">
                  {[...KINDS, "Other"].map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setKind(k)}
                      aria-pressed={kind === k}
                      className={clsx("press rounded-[var(--radius-sm)] px-4 py-2 text-sm", kind === k ? "bg-ink text-white" : "bg-surface text-ink-2 ring-1 ring-line-strong hover:text-ink")}
                    >
                      {k}
                    </button>
                  ))}
                </div>
                {kind === "Other" && <input className={clsx(field, "mt-3")} value={otherKind} onChange={(e) => setOtherKind(e.target.value)} placeholder="e.g. Flower shop" autoFocus={!review} />}
              </div>
              <label className="block">
                <Label hint="optional">Your first name</Label>
                <input className={field} value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="So Counterpart can greet you" />
              </label>
            </div>
          )}

          {review && <h2 className="mt-14 border-t border-ink pt-6 text-[24px]">{STEPS[1]}</h2>}
          {show(1) && (
            <div className="mt-8 space-y-6">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block">
                  <Label>City</Label>
                  <input className={field} value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Mysuru" autoFocus={!review} />
                </label>
                <label className="block">
                  <Label>Area or street</Label>
                  <input className={field} value={locality} onChange={(e) => setLocality(e.target.value)} placeholder="e.g. Kuvempunagar" />
                </label>
              </div>
              <label className="block">
                <Label hint="optional, customers can claim offers by messaging you">WhatsApp number</Label>
                <input className={field} value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+91 98450 12345" inputMode="tel" />
              </label>
              <div>
                <Label hint="posts are written natively in each">Languages your customers read</Label>
                <div className="flex flex-wrap gap-2">
                  {LANGS.map((l) => {
                    const on = langs.includes(l.code);
                    return (
                      <button
                        key={l.code}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setLangs(on ? langs.filter((x) => x !== l.code) : [...langs, l.code])}
                        className={clsx("press inline-flex items-center gap-2 rounded-[var(--radius-sm)] px-4 py-2 text-[15px]", on ? "bg-pen text-white" : "bg-surface text-ink-2 ring-1 ring-line-strong")}
                      >
                        {on && <Check size={14} weight="bold" aria-hidden />}
                        {l.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {review && <h2 className="mt-14 border-t border-ink pt-6 text-[24px]">{STEPS[2]}</h2>}
          {show(2) && (
            <div className="mt-8">
              <p className="mb-5 text-[15px] text-ink-2">Offers can only use these items and prices, so nothing is ever made up. Cost is optional; with it, Counterpart checks every discount still makes money.</p>
              <div className="space-y-3">
                <div className="hidden grid-cols-[1fr_110px_110px_40px] gap-2 px-1 text-[13px] text-muted sm:grid">
                  <span>Item or service</span>
                  <span>Price (₹)</span>
                  <span>Costs you (₹)</span>
                </div>
                {items.map((it, i) => (
                  <div key={i} className="rise-in grid grid-cols-[1fr_1fr_40px] gap-2 sm:grid-cols-[1fr_110px_110px_40px]">
                    <input
                      className={clsx(field, "col-span-3 sm:col-span-1")}
                      value={it.name}
                      onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                      placeholder={i === 0 ? "e.g. Haircut" : "Another item"}
                      aria-label="Item or service"
                    />
                    <input
                      className={field}
                      inputMode="decimal"
                      value={it.price}
                      onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, price: e.target.value.replace(/[^\d.]/g, "") } : x)))}
                      placeholder="Price"
                      aria-label="Price in rupees"
                    />
                    <input
                      className={field}
                      inputMode="decimal"
                      value={it.cost}
                      onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, cost: e.target.value.replace(/[^\d.]/g, "") } : x)))}
                      placeholder="Cost"
                      aria-label="What it costs you, in rupees (optional)"
                    />
                    <button
                      type="button"
                      onClick={() => setItems(items.length > 1 ? items.filter((_, j) => j !== i) : items)}
                      className="press inline-flex h-12 w-10 items-center justify-center rounded-full text-muted hover:bg-sunken hover:text-kumkum disabled:opacity-30"
                      disabled={items.length === 1}
                      aria-label="Remove item"
                    >
                      <Trash size={16} aria-hidden />
                    </button>
                  </div>
                ))}
              </div>
              <Button variant="ghost" className="mt-3" onClick={() => setItems([...items, { name: "", price: "", cost: "" }])}>
                <Plus size={15} aria-hidden /> Add another
              </Button>
            </div>
          )}

          {review && <h2 className="mt-14 border-t border-ink pt-6 text-[24px]">{STEPS[3]}</h2>}
          {show(3) && (
            <div className="mt-8 space-y-6">
              <div className="rounded-[var(--radius-lg)] bg-surface p-5 ring-1 ring-line/80">
                <p className="text-[15px] font-semibold tracking-tight">Real photos of your place</p>
                <p className="mt-1 text-sm text-ink-2">Posts use photos of your own business, not stock or AI pictures. Counterpart collects them and sets aside blurry shots, logos and menus.</p>
                <label className="mt-4 block">
                  <Label hint="optional">
                    <Globe size={14} className="mr-1 inline" aria-hidden />
                    Your website or online menu
                  </Label>
                  <input className={field} value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="e.g. shearjoy.in" inputMode="url" />
                </label>
                <button
                  type="button"
                  disabled={!googleOn}
                  onClick={() => setGoogle(!google)}
                  aria-pressed={google && googleOn}
                  className={clsx("press mt-4 flex w-full items-center gap-3 rounded-[var(--radius-md)] p-3.5 text-left ring-1", google && googleOn ? "bg-pen-soft ring-pen/40" : "bg-surface ring-line", !googleOn && "opacity-60")}
                >
                  <GoogleLogo size={20} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-medium">Use photos from our Google Maps listing</span>
                    <span className="block text-[13px] text-muted">{googleOn ? "Found by your name and area, with credit to the photographer." : "Not switched on for this server yet. You can add photos later."}</span>
                  </span>
                  {google && googleOn && <SealCheck size={20} weight="fill" className="text-pen" aria-hidden />}
                </button>
                <label className="press mt-4 flex cursor-pointer items-center gap-3 rounded-[var(--radius-md)] border border-dashed border-line-strong p-3.5 hover:bg-sunken/60">
                  <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 12))} />
                  <UploadSimple size={20} className="text-pen" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-medium">{files.length ? `${files.length} photo${files.length === 1 ? "" : "s"} ready to add` : "Add photos from your phone or computer"}</span>
                    <span className="block text-[13px] text-muted">Your products, counter or space. Up to 12 now, more later from the Photos page.</span>
                  </span>
                </label>
                {files.length > 0 && (
                  <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                    {files.map((f, i) => (
                      <img key={i} src={URL.createObjectURL(f)} alt="" className="pop h-16 w-16 shrink-0 rounded-[var(--radius-lg)] object-cover" style={{ "--i": i } as React.CSSProperties} />
                    ))}
                  </div>
                )}
              </div>
              <label className="block">
                <Label hint="optional, helps the voice">What do customers love about you?</Label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="In your own words: what people come back for, how you talk to them."
                  className="w-full rounded-[var(--radius-md)] bg-surface px-4 py-3 text-[15px] shadow-[inset_0_0_0_1.5px_var(--color-ink)] outline-none transition-shadow focus:shadow-[inset_0_0_0_1.5px_var(--color-ink),0_0_0_3px_var(--color-marker)]"
                />
              </label>
            </div>
          )}
        </div>

        {error && (
          <p className="pop mt-6 rounded-[var(--radius-md)] bg-kumkum-soft px-3.5 py-2.5 text-sm text-kumkum" role="alert">
            {error}
          </p>
        )}

        <div className="mt-10 flex items-center gap-3">
          {(review || step === 0) && (
            <Button variant="ghost" size="lg" onClick={() => { setError(null); setMode("link"); }}>
              <ArrowLeft size={15} aria-hidden /> Back
            </Button>
          )}
          {!review && step > 0 && (
            <Button variant="ghost" size="lg" onClick={() => go(step - 1)}>
              <ArrowLeft size={15} aria-hidden /> Back
            </Button>
          )}
          <span className="flex-1" />
          {review ? (
            <div className="flex flex-col items-end gap-2">
              <Button variant="accent" size="lg" onClick={finish} disabled={!valid.every(Boolean)} trailing={<Sparkle size={15} weight="fill" />}>
                Set up my workspace
              </Button>
              {!valid.every(Boolean) && (
                <p className="text-right text-[13px] text-turmeric">
                  Still needed: {[!valid[0] && "name and kind of business", !valid[1] && "city, area and a language", !valid[2] && "at least one item with a price"].filter(Boolean).join(", ")}
                </p>
              )}
            </div>
          ) : step < STEPS.length - 1 ? (
            <Button variant="primary" size="lg" disabled={!valid[step]} onClick={() => go(step + 1)} trailing={<ArrowRight size={15} weight="bold" />}>
              Continue
            </Button>
          ) : (
            <Button variant="accent" size="lg" onClick={finish} trailing={<Sparkle size={15} weight="fill" />}>
              Set up my workspace
            </Button>
          )}
        </div>
      </div>
    </main>
  );
}
