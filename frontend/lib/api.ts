"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LedgerEvent } from "./types";

export const BUSINESS = process.env.NEXT_PUBLIC_BUSINESS_SLUG ?? "kaapi-kone";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(`/api${path}`, {
    ...rest,
    headers: json !== undefined ? { "content-type": "application/json", ...rest.headers } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {}
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------- live ledger

type Listener = (e: LedgerEvent) => void;
const listeners = new Set<Listener>();
let source: EventSource | null = null;

function ensureSource() {
  if (source || typeof window === "undefined") return;
  source = new EventSource(`/api/businesses/${BUSINESS}/events`);
  source.addEventListener("ledger", (m) => {
    const ev = JSON.parse((m as MessageEvent).data) as LedgerEvent;
    listeners.forEach((l) => l(ev));
  });
  source.onerror = () => {
    source?.close();
    source = null;
    setTimeout(() => listeners.size && ensureSource(), 3000);
  };
}

export function useLedgerEvents(onEvent: Listener) {
  const ref = useRef(onEvent);
  ref.current = onEvent;
  useEffect(() => {
    const l: Listener = (e) => ref.current(e);
    listeners.add(l);
    ensureSource();
    return () => {
      listeners.delete(l);
    };
  }, []);
}

/** Fetch a resource and refetch it whenever the ledger reports a change (debounced). */
export function useResource<T>(path: string | null, filter?: (e: LedgerEvent) => boolean) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async () => {
    if (!path) return;
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [path]);

  useEffect(() => {
    reload();
  }, [reload]);

  useLedgerEvents((e) => {
    if (filter && !filter(e)) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(reload, 250);
  });

  return { data, error, reload };
}
