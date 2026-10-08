// Server-side proxy to the FastAPI backend. The browser only ever talks to this
// origin; the owner token is attached here and never reaches client code.
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000";
const HOP_BY_HOP = new Set(["connection", "keep-alive", "transfer-encoding", "content-encoding", "content-length"]);

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const url = `${BACKEND}/api/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;

  const headers = new Headers();
  const ct = req.headers.get("content-type");
  if (ct) headers.set("content-type", ct);
  const accept = req.headers.get("accept");
  if (accept) headers.set("accept", accept);
  if (process.env.OWNER_API_TOKEN && path[0] !== "public") {
    headers.set("x-owner-token", process.env.OWNER_API_TOKEN);
  }

  const init: RequestInit & { duplex?: string } = { method: req.method, headers, cache: "no-store" };
  if (!["GET", "HEAD"].includes(req.method)) {
    init.body = req.body;
    init.duplex = "half";
  }

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    return Response.json({ detail: "The Counterpart service is not reachable. Start the backend on " + BACKEND }, { status: 502 });
  }
  const out = new Headers();
  res.headers.forEach((v, k) => !HOP_BY_HOP.has(k) && out.set(k, v));
  return new Response(res.body, { status: res.status, headers: out });
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
