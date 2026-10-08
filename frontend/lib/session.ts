// Server-only session helpers. Supabase Auth tokens live in httpOnly cookies set by this Next.js server; browser
// code never sees them. The backend verifies the access token on every owner request.
import type { NextRequest, NextResponse } from "next/server";

export const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000";
export const ACCESS = "cp_at";
export const REFRESH = "cp_rt";

export interface Session {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: { id: string; email: string | null };
}

/** Secure cookies only over https: Safari (and any browser on a LAN address) drops them on plain http. */
function isHttps(req: NextRequest) {
  return (req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "")) === "https";
}

export function setSession(req: NextRequest, res: NextResponse, s: Session) {
  const secure = isHttps(req);
  res.cookies.set(ACCESS, s.access_token, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: s.expires_in });
  res.cookies.set(REFRESH, s.refresh_token, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
}

export function clearSession(res: NextResponse) {
  res.cookies.set(ACCESS, "", { path: "/", maxAge: 0 });
  res.cookies.set(REFRESH, "", { path: "/", maxAge: 0 });
}

export function backendHeaders(extra?: HeadersInit): Headers {
  const h = new Headers(extra);
  if (process.env.OWNER_API_TOKEN) h.set("x-owner-token", process.env.OWNER_API_TOKEN);
  return h;
}

export async function refreshSession(refreshToken: string): Promise<Session | null> {
  try {
    const r = await fetch(`${BACKEND}/api/auth/refresh`, {
      method: "POST",
      headers: backendHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ refresh_token: refreshToken }),
      cache: "no-store",
    });
    return r.ok ? ((await r.json()) as Session) : null;
  } catch {
    return null;
  }
}
