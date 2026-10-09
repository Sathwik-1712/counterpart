// Brand palettes are written as words ("deep decoction brown", "banana-leaf green"). This turns them into real
// colours: an owner-picked hex wins, then known phrases and specific words, then plain colour words, then any CSS
// colour name, adjusted by modifiers such as "deep" or "pastel". Unknown words return null (the UI asks for a pick).

const PHRASES: Record<string, string> = {
  "banana leaf": "#3f7d3a", "banana-leaf": "#3f7d3a", "filter coffee": "#6b4226", "mango leaf": "#4f7f2a",
  "temple gold": "#c99a2e", "kannada red": "#d7262b", "kannada yellow": "#f6c42b", "diya gold": "#e0a82e",
  "steel grey": "#8b9298", "steel gray": "#8b9298", "sugarcane green": "#7fa650", "midnight blue": "#1f2a5a",
  "pine green": "#2d5a3d", "sun yellow": "#f4c430", "hot pink": "#e8457a", "baby pink": "#f5c6d6",
  "sky blue": "#7cc4e8", "navy blue": "#1f3366", "off white": "#f3efe6", "rose gold": "#c98f84",
};
// Specific words (materials, foods, Indian colour names) beat generic colour words in the same phrase.
const SPECIFIC: Record<string, string> = {
  decoction: "#5b3a22", coffee: "#6b4226", espresso: "#3b2416", mocha: "#7b5139", cocoa: "#5c3a2e", chocolate: "#5a3522",
  caramel: "#b9783a", jaggery: "#8c5a2b", toffee: "#a0662f", cinnamon: "#a1592f", brass: "#b48a3c", copper: "#b8693c",
  bronze: "#a9712f", terracotta: "#c4643f", clay: "#b5694a", rust: "#a8442a", brick: "#a3402e", haldi: "#e3a821",
  turmeric: "#e3a821", saffron: "#f08a24", kesar: "#f08a24", marigold: "#f2a21b", mustard: "#d9a514", kumkum: "#c1272d",
  sindoor: "#d9381e", vermilion: "#d9381e", maroon: "#7a1f2b", burgundy: "#7d2236", wine: "#72213a", plum: "#6e2f5c",
  mehendi: "#6b7b2f", henna: "#8b5a2b", olive: "#77803a", sage: "#9aaa8a", mint: "#9ed9b8", emerald: "#1f8a5b",
  jade: "#3a9b78", teal: "#1f7a7a", peacock: "#14697a", turquoise: "#2bb3b1", aqua: "#5cc8c7", indigo: "#2e3a8c",
  navy: "#1f3366", denim: "#3b5f8f", lavender: "#a99bd6", lilac: "#c3a6d6", mauve: "#b08198", blush: "#f2c4c4",
  rose: "#d77a92", coral: "#f2765a", peach: "#f6b48f", apricot: "#f3a76b", salmon: "#ee8b74", strawberry: "#d8344c",
  cherry: "#b3152c", berry: "#8e2f5c", lemon: "#f2dd4a", butter: "#f3df8b", cream: "#f1e6cc", ivory: "#f4efe1",
  vanilla: "#f3e5b5", beige: "#e3d3b5", sand: "#d8c39a", khaki: "#b9a774", charcoal: "#2f3133", slate: "#5a6670",
  ash: "#a7a9a6", silver: "#b8bcc0", gold: "#c9a227", pistachio: "#a8c686", lime: "#a6d13d", leaf: "#3f7d3a",
  forest: "#235b39", moss: "#6b7d3a", chilli: "#c0281e", tomato: "#e04b2f", paprika: "#c2401f", pomegranate: "#b02840",
  neem: "#5a7d2a", sandalwood: "#c8a27a", chandan: "#c8a27a", tea: "#a8763e", chai: "#a8763e", milk: "#f6f1e7",
};
const BASIC: Record<string, string> = {
  red: "#c8352a", orange: "#e8792a", yellow: "#f2c94c", green: "#3b8a4a", blue: "#2f5d9a", purple: "#7a4ea8",
  violet: "#7a4ea8", pink: "#e27d9b", brown: "#7a4a2a", black: "#1c1c1c", white: "#f7f6f2", grey: "#8a8f93",
  gray: "#8a8f93", tan: "#c9a77c",
};

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgbToHex = (r: number, g: number, b: number) => "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");

export function toHsl(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

export function fromHsl(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

function luminance(hex: string) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Darken (keeping the hue) until the colour reads as text on the given background. */
export function readableOn(hex: string, bg: string, ratio = 4.6): string {
  const [h, s, l0] = toHsl(hex);
  for (let l = l0; l > 0.05; l -= 0.03) {
    const c = fromHsl(h, Math.min(1, s * 1.05), l);
    if (contrast(c, bg) >= ratio) return c;
  }
  return "#16150f";
}

/** A light highlighter tint of the colour, for "needs you" backgrounds with ink text. */
export function highlighter(hex: string): string {
  const [h, s] = toHsl(hex);
  return fromHsl(h, Math.max(0.5, Math.min(0.85, s)), 0.76);
}

export function tint(hex: string, l = 0.93): string {
  const [h, s] = toHsl(hex);
  return fromHsl(h, Math.min(0.6, s), l);
}

function cssColour(word: string): string | null {
  if (typeof document === "undefined" || typeof CSS === "undefined" || !CSS.supports("color", word)) return null;
  const el = document.createElement("span");
  el.style.color = word;
  document.body.appendChild(el);
  const m = getComputedStyle(el).color.match(/\d+/g);
  el.remove();
  return m ? rgbToHex(+m[0], +m[1], +m[2]) : null;
}

/** The colour a palette phrase names, or null if it names none we know. */
export function resolveColour(name: string, picked?: Record<string, string>): string | null {
  if (picked?.[name]) return picked[name];
  const text = name.toLowerCase().trim();
  const hex = text.match(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/);
  if (hex) return hex[0];
  let base: string | null = null;
  for (const [p, v] of Object.entries(PHRASES)) if (text.includes(p)) base = base ?? v;
  const words = text.split(/[^a-z]+/).filter(Boolean);
  base = base ?? words.map((w) => SPECIFIC[w]).find(Boolean) ?? null;
  base = base ?? [...words].reverse().map((w) => BASIC[w]).find(Boolean) ?? null;
  base = base ?? [...words].reverse().map(cssColour).find(Boolean) ?? null;
  if (!base) return null;
  const [h, s, l] = toHsl(base);
  if (/\b(deep|dark|rich)\b/.test(text)) return fromHsl(h, s, Math.max(0.12, l - 0.15));
  if (/\b(light|pale|pastel|soft|baby)\b/.test(text)) return fromHsl(h, s * 0.8, Math.min(0.88, l + 0.2));
  if (/\b(bright|vivid|neon)\b/.test(text)) return fromHsl(h, Math.min(1, s + 0.2), l);
  return base;
}
