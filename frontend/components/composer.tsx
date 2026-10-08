"use client";

import clsx from "clsx";
import { ArrowUpRight, Microphone, Sparkle, Stop } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "./ui";

const LANGS = [
  { code: "en-IN", label: "English" },
  { code: "kn-IN", label: "ಕನ್ನಡ" },
  { code: "hi-IN", label: "हिन्दी" },
];

// Minimal typing for the browser Web Speech API (Chrome/Edge/Safari expose it prefixed).
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

function getRecognition(): Recognition | null {
  if (typeof window === "undefined") return null;
  const Ctor = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
  return Ctor ? (new Ctor() as Recognition) : null;
}

export function Composer({
  placeholder,
  submitLabel,
  onSubmit,
  suggestions = [],
  rows = 3,
  className,
}: {
  placeholder: string;
  submitLabel: string;
  onSubmit: (text: string) => Promise<void>;
  /** Ready-made briefs the owner can tap to fill the box. */
  suggestions?: string[];
  rows?: number;
  className?: string;
}) {
  const [text, setText] = useState("");
  const [lang, setLang] = useState("en-IN");
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [supported, setSupported] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const base = useRef("");

  useEffect(() => setSupported(getRecognition() !== null), []);

  function toggleMic() {
    if (listening) {
      rec.current?.stop();
      return;
    }
    const r = getRecognition();
    if (!r) return;
    r.lang = lang;
    r.interimResults = true;
    r.continuous = true;
    base.current = text ? text.trimEnd() + " " : "";
    r.onresult = (e) => {
      let finalText = "";
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      setText(base.current + finalText + interim);
    };
    r.onerror = (e) => setNote(e.error === "not-allowed" ? "Microphone access is blocked for this site." : `Voice input stopped (${e.error}).`);
    r.onend = () => setListening(false);
    rec.current = r;
    setNote(null);
    r.start();
    setListening(true);
  }

  async function submit() {
    if (!text.trim()) return;
    rec.current?.stop();
    setBusy(true);
    setNote(null);
    try {
      await onSubmit(text.trim());
      setText("");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not send.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className}>
      <div className="rounded-[var(--radius-lg)] bg-surface p-4 shadow-[var(--shadow-soft)] ring-1 ring-ink/[0.08] transition-shadow duration-300 focus-within:shadow-[var(--shadow-lift)] focus-within:ring-leaf/50">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && submit()}
          rows={rows}
          placeholder={listening ? "Listening…" : placeholder}
          className="w-full resize-none bg-transparent text-[16px] leading-relaxed text-ink outline-none placeholder:text-muted"
          aria-label={placeholder}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {supported && (
            <>
              <button
                type="button"
                onClick={toggleMic}
                aria-pressed={listening}
                className={clsx(
                  "press inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-[13px] font-medium",
                  listening ? "bg-kumkum text-white" : "bg-sunken text-ink hover:bg-line",
                )}
              >
                {listening ? <Stop size={14} aria-hidden /> : <Microphone size={15} aria-hidden />}
                {listening ? "Stop" : "Speak"}
              </button>
              <select
                value={lang}
                onChange={(e) => setLang(e.target.value)}
                disabled={listening}
                className="h-9 rounded-full bg-sunken px-3 text-[13px] text-ink-2 outline-none"
                aria-label="Spoken language"
              >
                {LANGS.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </>
          )}
          <span className="min-w-0 flex-1 text-xs text-muted">{note ?? (supported ? "" : "Type here. Voice needs Chrome, Edge or Safari.")}</span>
          <Button variant="primary" onClick={submit} disabled={busy || !text.trim()} trailing={<ArrowUpRight size={14} weight="bold" />}>
            {busy ? "Sending…" : submitLabel}
          </Button>
        </div>
      </div>
      {suggestions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {suggestions.map((sug) => (
            <button
              key={sug}
              type="button"
              onClick={() => setText(sug)}
              className="press inline-flex max-w-full items-center gap-1.5 rounded-full bg-white/10 px-3.5 py-1.5 text-[13px] text-current ring-1 ring-current/15 hover:bg-white/20"
            >
              <Sparkle size={13} weight="fill" className="shrink-0 opacity-70" aria-hidden />
              <span className="truncate">{sug}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
