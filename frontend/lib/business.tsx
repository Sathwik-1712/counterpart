"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError, setLiveBusiness } from "./api";
import { PostStyle } from "./post-style";
import { applyTheme, themeFor } from "./theme";

export interface Biz {
  id: string;
  slug: string;
  name: string;
  locality: string;
  city: string;
  languages: string[];
  is_demo: boolean;
  kind: string | null;
  owner_name: string | null;
  role: string;
  theme: string | null;
  palette: string[];
  palette_hex: Record<string, string>;
  voice: string[];
  watermark: boolean;
}
export interface Me {
  user: { id: string; email: string | null };
  businesses: Biz[];
  features?: { google_photos?: boolean; sarvam?: boolean };
}

const KEY = "cp_business";
const Ctx = createContext<{ me: Me; business: Biz; select: (slug: string) => void; reload: () => Promise<void> } | null>(null);

function remembered(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Loads the signed-in owner and their businesses; children render only once a business is open. */
export function BusinessProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const m = await api<Me>("/me");
      setMe(m);
      if (!m.businesses.length) router.replace("/onboarding");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) router.replace(`/login?next=${encodeURIComponent(path)}`);
      else setError(e instanceof Error ? e.message : String(e));
    }
  }, [router, path]);

  useEffect(() => {
    setSlug(remembered());
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const business = me ? (me.businesses.find((b) => b.slug === slug) ?? me.businesses.find((b) => !b.is_demo) ?? me.businesses[0]) : undefined;
  useEffect(() => setLiveBusiness(business?.slug ?? null), [business?.slug]);
  useEffect(() => {
    if (business) applyTheme(themeFor(business));
  }, [business]);

  const select = useCallback(
    (s: string) => {
      try {
        localStorage.setItem(KEY, s);
      } catch {}
      setSlug(s);
      router.push("/");
    },
    [router],
  );

  if (error)
    return (
      <div className="flex min-h-dvh items-center justify-center p-6 text-center">
        <div>
          <p className="text-[17px] font-semibold">Counterpart could not load your workspace.</p>
          <p className="mt-1 text-sm text-muted">{error}</p>
        </div>
      </div>
    );
  if (!me || !business) return <>{fallback}</>;
  return (
    <Ctx.Provider value={{ me, business, select, reload }}>
      <PostStyle.Provider value={{ watermark: business.watermark !== false }}>{children}</PostStyle.Provider>
    </Ctx.Provider>
  );
}

export function useWorkspace() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWorkspace outside BusinessProvider");
  return v;
}

export const useBusiness = () => useWorkspace().business;

export function rememberBusiness(slug: string) {
  try {
    localStorage.setItem(KEY, slug);
  } catch {}
}
