// Server-side proxy to the FastAPI backend. The browser only ever talks to this origin. The signed-in owner's
// access token (httpOnly cookie) is attached here, and refreshed once when it has expired.
import { NextResponse, type NextRequest } from "next/server";
import { ACCESS, BACKEND, backendHeaders, REFRESH, refreshSession, setSession, type Session } from "@/lib/session";

export const dynamic = "force-dynamic";

const HOP_BY_HOP = new Set(["connection", "keep-alive", "transfer-encoding", "content-encoding", "content-length"]);

async function forward(req: NextRequest, url: string, body: ArrayBuffer | null, token: string | undefined, isPublic: boolean) {
  const headers = backendHeaders();
  const ct = req.headers.get("content-type");
  if (ct) headers.set("content-type", ct);
  const accept = req.headers.get("accept");
  if (accept) headers.set("accept", accept);
  const signature = req.headers.get("x-hub-signature-256"); // Meta signs WhatsApp webhooks; the backend checks it
  if (signature && isPublic) headers.set("x-hub-signature-256", signature);
  if (token && !isPublic) headers.set("authorization", `Bearer ${token}`);
  return fetch(url, { method: req.method, headers, body, cache: "no-store" });
}

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const isPublic = path[0] === "public";
  const url = `${BACKEND}/api/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;
  // Buffer the body so the request can be replayed after a token refresh (uploads are capped server-side).
  const body = ["GET", "HEAD"].includes(req.method) ? null : await req.arrayBuffer();

  let fresh: Session | null = null;
  let res: Response;
  try {
    res = await forward(req, url, body, req.cookies.get(ACCESS)?.value, isPublic);
    const refreshToken = req.cookies.get(REFRESH)?.value;
    if (res.status === 401 && !isPublic && refreshToken) {
      fresh = await refreshSession(refreshToken);
      if (fresh) res = await forward(req, url, body, fresh.access_token, isPublic);
    }
  } catch {
    return Response.json({ detail: "The Counterpart service is not reachable right now. Try again in a moment." }, { status: 502 });
  }

  const out = new Headers();
  res.headers.forEach((v, k) => !HOP_BY_HOP.has(k) && out.set(k, v));
  const response = new NextResponse(res.body, { status: res.status, headers: out });
  if (fresh) setSession(req, response, fresh);
  return response;
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
