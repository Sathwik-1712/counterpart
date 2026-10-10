"use client";

import clsx from "clsx";
import { ArrowRight, Microphone, Stop } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useWorkspace } from "@/lib/business";
import { Button } from "./ui";

const MAX_SECONDS = 28; // Sarvam's quick transcription takes clips under 30 seconds

function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}

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
  const { me, business } = useWorkspace();
  // Sarvam reads Kannada and Hindi far better than the browser, so record and send the clip when it is set up.
  const [sarvam, setSarvam] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [transcribing, setTranscribing] = useState(false);

  useEffect(() => {
    const canRecord = typeof window !== "undefined" && "MediaRecorder" in window && !!navigator.mediaDevices?.getUserMedia;
    setSarvam(!!me.features?.sarvam && canRecord);
    setSupported((!!me.features?.sarvam && canRecord) || getRecognition() !== null);
  }, [me.features?.sarvam]);

  useEffect(() => {
    if (!listening || !sarvam) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [listening, sarvam]);
  useEffect(() => {
    if (sarvam && listening && seconds >= MAX_SECONDS) recorder.current?.stop();
  }, [seconds, sarvam, listening]);

  async function recordWithSarvam() {
    if (listening) {
      recorder.current?.stop();
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setNote("Microphone access is blocked for this site.");
      return;
    }
    const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((t) => MediaRecorder.isTypeSupported(t));
    const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const parts: Blob[] = [];
    r.ondataavailable = (e) => e.data.size && parts.push(e.data);
    r.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      setListening(false);
      setTranscribing(true);
      try {
        const clip = new Blob(parts, { type: r.mimeType || "audio/webm" });
        const out = await api<{ transcript: string }>(`/businesses/${business.slug}/speech`, {
          method: "POST",
          json: { data_url: await blobToDataUrl(clip), language: lang.slice(0, 2) },
        });
        if (out.transcript) setText((t) => (t ? t.trimEnd() + " " : "") + out.transcript);
        else setNote("Could not hear anything. Try again a little closer to the phone.");
      } catch (e) {
        setNote(e instanceof Error ? e.message : "Could not turn that into text.");
      } finally {
        setTranscribing(false);
      }
    };
    recorder.current = r;
    setNote(null);
    setSeconds(0);
    r.start();
    setListening(true);
  }

  function toggleMic() {
    if (sarvam) {
      recordWithSarvam();
      return;
    }
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
    if (recorder.current?.state === "recording") recorder.current.stop();
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
      <div className="rounded-[var(--radius-lg)] bg-surface ring-1 ring-ink transition-shadow duration-200 focus-within:shadow-[0_0_0_3px_var(--color-marker)]">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && submit()}
          rows={rows}
          placeholder={listening ? "Listening…" : transcribing ? "Writing down what you said…" : placeholder}
          className="ruled margin-rule block w-full resize-none bg-transparent pl-6 pr-4 pt-[7px] text-[17px] text-ink outline-none placeholder:text-muted md:pl-8"
          aria-label={placeholder}
        />
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2.5">
          {supported && (
            <>
              <button
                type="button"
                onClick={toggleMic}
                disabled={transcribing}
                aria-pressed={listening}
                className={clsx(
                  "press inline-flex h-9 items-center gap-2 rounded-[var(--radius-sm)] px-3 text-[14px] font-semibold",
                  listening ? "bg-kumkum text-white" : "text-ink hover:bg-sunken",
                )}
              >
                {listening ? <Stop size={15} weight="fill" aria-hidden /> : <Microphone size={16} weight="bold" aria-hidden />}
                {listening ? (sarvam ? `Stop · ${MAX_SECONDS - seconds}s` : "Stop") : transcribing ? "Writing…" : "Speak"}
              </button>
              <select
                value={lang}
                onChange={(e) => setLang(e.target.value)}
                disabled={listening}
                className="h-9 rounded-[var(--radius-sm)] bg-transparent px-2 text-[14px] text-ink-2 outline-none hover:bg-sunken"
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
          <span className="min-w-0 flex-1 text-[13px] text-muted">
            {note ?? (!supported ? "Type here. Voice needs Chrome, Edge or Safari." : sarvam && !listening && !transcribing ? "Voice by Sarvam: ಕನ್ನಡ, हिन्दी, English" : "")}
          </span>
          <Button variant="primary" onClick={submit} disabled={busy || !text.trim()} trailing={<ArrowRight size={15} weight="bold" />}>
            {busy ? "Sending…" : submitLabel}
          </Button>
        </div>
      </div>
      {suggestions.length > 0 && (
        <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1.5 text-[14px]">
          <span className="text-muted">Ideas from Counterpart:</span>
          {suggestions.map((sug) => (
            <button
              key={sug}
              type="button"
              onClick={() => setText(sug)}
              className="press max-w-full truncate font-semibold text-pen underline decoration-pen/30 decoration-2 underline-offset-4 hover:decoration-pen"
            >
              {sug}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
