// Owner pages need a session; without one, send people to sign in. Customer-facing QR pages (/r/..., /c/...), staff phone pages (/k/..., PIN-gated by the API), the sign-in
// pages and the API (which answers 401 itself) stay open.
import { NextResponse, type NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  if (req.cookies.get("cp_rt")?.value) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = req.nextUrl.pathname === "/" ? "" : `?next=${encodeURIComponent(req.nextUrl.pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!r/|k/|c/|login|signup|api/|_next/|files/|favicon|icon|fonts/).*)"],
};
