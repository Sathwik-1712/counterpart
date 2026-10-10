"use client";

import { use } from "react";
import { StaffGate } from "@/components/staff-gate";

/** The staff link from the Counter page: type a customer's code on a phone without an account. */
export default function StaffDesk({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  return <StaffGate business={slug} />;
}
