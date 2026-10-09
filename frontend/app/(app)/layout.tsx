"use client";

import type { ReactNode } from "react";
import { BusinessProvider } from "@/lib/business";

function Loading() {
  return (
    <div className="flex min-h-dvh items-center justify-center" aria-busy>
      <div className="flex flex-col items-center gap-4">
        <img src="/icon.svg" alt="" className="pop h-12 w-12" />
        <div className="h-1 w-32 overflow-hidden rounded-full bg-sunken">
          <div className="loading-bar h-full w-1/3 rounded-full bg-pen" />
        </div>
      </div>
    </div>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return <BusinessProvider fallback={<Loading />}>{children}</BusinessProvider>;
}
