"use client";

import { use } from "react";
import { StaffGate } from "@/components/staff-gate";

/** Opened by scanning the QR on a customer's screen: the staff phone checks and redeems that code. */
export default function ScannedCode({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  return <StaffGate code={code.toUpperCase()} />;
}
