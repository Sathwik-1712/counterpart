import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Locally stored creatives are served by the backend (STORAGE_BACKEND=local).
  async rewrites() {
    return [{ source: "/files/:path*", destination: `${process.env.BACKEND_URL ?? "http://localhost:8000"}/files/:path*` }];
  },
};

export default config;
