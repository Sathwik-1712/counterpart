// Optional basic auth for the owner workspace when deployed. Customer-facing
// QR pages (/r/...) and their public API stay open.
import { NextResponse, type NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const password = process.env.DEMO_PASSWORD;
  if (!password) return NextResponse.next();

  const header = req.headers.get("authorization") ?? "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    const [user, pass] = atob(encoded).split(":");
    if (user === (process.env.DEMO_USER ?? "owner") && pass === password) return NextResponse.next();
  }
  return new NextResponse("Sign in required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Counterpart"' },
  });
}

export const config = {
  matcher: ["/((?!r/|api/public/|_next/|favicon|fonts/).*)"],
};
