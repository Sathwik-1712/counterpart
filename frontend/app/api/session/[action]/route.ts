// Sign up, sign in, try the demo, sign out. Tokens are stored as httpOnly cookies and never returned to the page.
import { NextResponse, type NextRequest } from "next/server";
import { ACCESS, BACKEND, backendHeaders, clearSession, setSession, type Session } from "@/lib/session";

export const dynamic = "force-dynamic";

const ACTIONS: Record<string, string> = { login: "login", signup: "signup", demo: "demo", logout: "logout" };

export async function POST(req: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  const target = ACTIONS[action];
  if (!target) return NextResponse.json({ detail: "Unknown action" }, { status: 404 });

  if (target === "logout") {
    const token = req.cookies.get(ACCESS)?.value;
    if (token) {
      await fetch(`${BACKEND}/api/auth/logout`, { method: "POST", headers: backendHeaders({ authorization: `Bearer ${token}` }) }).catch(() => {});
    }
    const res = NextResponse.json({ ok: true });
    clearSession(res);
    return res;
  }

  let r: Response;
  try {
    r = await fetch(`${BACKEND}/api/auth/${target}`, {
      method: "POST",
      headers: backendHeaders({ "content-type": "application/json" }),
      body: target === "demo" ? "{}" : await req.text(),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ detail: "The Counterpart service is not reachable right now." }, { status: 502 });
  }
  const body = await r.json().catch(() => ({ detail: r.statusText }));
  if (!r.ok) {
    const detail = Array.isArray(body.detail) ? "Check the email address and use a password of at least 8 characters." : body.detail;
    return NextResponse.json({ detail }, { status: r.status });
  }
  const res = NextResponse.json({ ok: true, user: (body as Session).user });
  setSession(req, res, body as Session);
  return res;
}
