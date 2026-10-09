// Each business gets its own colours. The roles stay fixed (ink = owner, pen = Counterpart's work, marker = needs
// you), only the hues change, so the app still reads the same way while looking like the owner's shop.
// A theme is built from the brand's own palette colours (when at least two resolve), or picked from the palette
// and voice words, or chosen by the owner on the Brand page.
import { contrast, highlighter, readableOn, resolveColour, tint, toHsl } from "./colors";

export interface Theme {
  id: string;
  name: string;
  paper: string;
  marker: string;
  markerSoft: string;
  pen: string;
  penInk: string;
  penSoft: string;
  /** Accent printed on the posts themselves (call to action, brand dot). */
  brand: string;
  words: RegExp;
}

export const THEMES: Theme[] = [
  { id: "counter", name: "Counter book", paper: "#f3f2ed", marker: "#ffd43b", markerSoft: "#fff3c4", pen: "#2340c4", penInk: "#182d8f", penSoft: "#e3e7f8", brand: "#16150f", words: /$^/ },
  { id: "coffee", name: "Filter coffee", paper: "#f4efe7", marker: "#f2c14e", markerSoft: "#fbecc4", pen: "#7a3e1d", penInk: "#5b2c13", penSoft: "#f1e3d8", brand: "#5b3a22", words: /brown|coffee|decoction|brass|gold|caramel|chocolate|nostalg|heritage|vintage|cafe|café/i },
  { id: "leaf", name: "Banana leaf", paper: "#eff2ea", marker: "#c8e66b", markerSoft: "#ecf6cf", pen: "#1f6b3a", penInk: "#154d29", penSoft: "#dcefe2", brand: "#1f6b3a", words: /green|leaf|fresh|organic|healthy|herb|plant|garden|natural|mint/i },
  { id: "kumkum", name: "Kumkum", paper: "#f5f0ee", marker: "#ffb199", markerSoft: "#ffe3da", pen: "#b3261e", penInk: "#86190f", penSoft: "#f8dfdb", brand: "#b3261e", words: /red|spic|bold|energ|fitness|gym|sport|power|chilli|fire/i },
  { id: "rose", name: "Rose", paper: "#f7f0f1", marker: "#ffc2d1", markerSoft: "#ffe4eb", pen: "#a8325e", penInk: "#7d2144", penSoft: "#f6dfe7", brand: "#a8325e", words: /pink|rose|sweet|cake|bak|beauty|salon|soft|blush|dessert|floral/i },
  { id: "monsoon", name: "Monsoon", paper: "#eef2f3", marker: "#9fe3dc", markerSoft: "#d9f4f1", pen: "#0f5f73", penInk: "#0a4655", penSoft: "#d7e9ee", brand: "#0f5f73", words: /blue|teal|turquoise|calm|clean|clinic|care|cool|aqua|sea|ocean/i },
  { id: "saffron", name: "Saffron", paper: "#f6f0e8", marker: "#ffc56e", markerSoft: "#ffe9c7", pen: "#b4520f", penInk: "#8a3c08", penSoft: "#f7e2d1", brand: "#b4520f", words: /orange|saffron|festiv|tradition|mithai|sweet shop|marigold|turmeric|yellow|terracotta/i },
  { id: "charcoal", name: "Charcoal", paper: "#f1f1ef", marker: "#c9f24d", markerSoft: "#ecfbc4", pen: "#2b2b2b", penInk: "#111111", penSoft: "#e4e4e1", brand: "#111111", words: /black|charcoal|minimal|modern|premium|luxur|cloth|fashion|boutique|sleek|monochrome/i },
];

const byId = (id: string | null | undefined) => THEMES.find((t) => t.id === id);

type BrandLike = { theme?: string | null; palette?: string[]; palette_hex?: Record<string, string>; voice?: string[]; kind?: string | null };

/** A theme made from the brand's own colours: the most saturated one becomes the accent (darkened until it reads
 *  as text), a light tint of it the highlighter, the darkest one the colour printed on posts. */
export function brandTheme(b: BrandLike): Theme | null {
  const colours = (b.palette ?? []).map((p) => resolveColour(p, b.palette_hex)).filter((c): c is string => !!c);
  const vivid = colours.filter((c) => toHsl(c)[1] > 0.2 && toHsl(c)[2] > 0.08 && toHsl(c)[2] < 0.9);
  if (vivid.length < 1 || colours.length < 2) return null;
  const accent = [...vivid].sort((x, y) => toHsl(y)[1] - toHsl(x)[1])[0];
  const darkest = [...colours].sort((x, y) => toHsl(x)[2] - toHsl(y)[2])[0];
  const paper = tint(accent, 0.955);
  const pen = readableOn(accent, paper);
  // A highlighter reads as one when it is warm and light: take the palette colour closest to yellow.
  const hueGap = (c: string) => Math.min(Math.abs(toHsl(c)[0] - 48), 360 - Math.abs(toHsl(c)[0] - 48));
  const second = [...vivid].sort((x, y) => hueGap(x) - hueGap(y))[0] ?? accent;
  const marker = highlighter(second);
  return {
    id: "brand", name: "Your brand colours", paper, marker, markerSoft: tint(second, 0.92), pen,
    penInk: readableOn(pen, paper, 7), penSoft: tint(accent, 0.9),
    brand: contrast(darkest, "#ffffff") >= 4.5 ? darkest : pen, words: /$^/,
  };
}

/** The owner's chosen theme, or their brand's own colours, or the theme that best matches their words. */
export function themeFor(b: BrandLike): Theme {
  if (b.theme === "brand" || !b.theme) {
    const own = brandTheme(b);
    if (own) return own;
  }
  const chosen = byId(b.theme);
  if (chosen) return chosen;
  // Palette words count most, then the kind of business, then the voice.
  const sources: [string, number][] = [[(b.palette ?? []).join(" "), 3], [b.kind ?? "", 2], [(b.voice ?? []).join(" "), 1]];
  let best = THEMES[0];
  let bestScore = 0;
  for (const t of THEMES.slice(1)) {
    const score = sources.reduce((n, [text, w]) => n + (text.match(new RegExp(t.words.source, "gi"))?.length ?? 0) * w, 0);
    if (score > bestScore) [best, bestScore] = [t, score];
  }
  return best;
}

/** Apply a theme to the page by overriding the colour tokens on <html>. */
export function applyTheme(t: Theme) {
  if (typeof document === "undefined") return;
  const s = document.documentElement.style;
  s.setProperty("--color-paper", t.paper);
  s.setProperty("--color-marker", t.marker);
  s.setProperty("--color-marker-soft", t.markerSoft);
  s.setProperty("--color-pen", t.pen);
  s.setProperty("--color-pen-ink", t.penInk);
  s.setProperty("--color-pen-soft", t.penSoft);
  s.setProperty("--color-brand", t.brand);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t.paper);
}
