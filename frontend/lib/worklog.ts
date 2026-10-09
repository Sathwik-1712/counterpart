"use client";

import { useCallback, useEffect, useState } from "react";

// The work log is a per-viewer preference (off by default), remembered in this browser only.
const KEY = "cp_worklog";
const EVENT = "cp-worklog";

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
}

export function useWorkLog(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(false);
  useEffect(() => {
    setOn(read());
    const sync = () => setOn(read());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const set = useCallback((v: boolean) => {
    try {
      localStorage.setItem(KEY, v ? "on" : "off");
    } catch {}
    setOn(v);
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [on, set];
}
