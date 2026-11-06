// Framework brand colors range from #000 to #FF9900. Lanes keep each framework's hue but nudge lightness so every lane
// reads on both the ink (dark) and ledger-paper (light) grounds.

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return [128, 128, 128];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

const cache = new Map<string, string>();

export function laneColor(hex: string | undefined, theme: "ink" | "paper"): string {
  const k = `${hex}|${theme}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const [r, g, b] = hexToRgb(hex || "#888888");
  let [h, s, l] = rgbToHsl(r, g, b);
  if (theme === "ink") {
    if (s < 0.12) l = l < 0.08 ? 0.9 : Math.max(0.72, 1 - l); // black-ish brands invert to near-white
    else l = Math.max(l, 0.58);
  } else {
    if (s < 0.12) l = Math.min(l, 0.2);
    else l = Math.min(Math.max(l, 0.3), 0.5);
  }
  const out = hslToHex(h, s, l);
  cache.set(k, out);
  return out;
}

/** Text color that reads on top of a filled swatch of `hex`. */
export function onColor(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.6 ? "#16150F" : "#FBF9F4";
}

export function withAlpha(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

// Tool servers get fixed semantic-ish hues so "where did the call go" reads the same in every lane.
export const SERVER_COLORS: Record<string, string> = {
  files: "#2E7DB8",
  offers: "#B8862B",
  ops: "#C9579A",
  skills: "#7B5CC4",
  board: "#2F8F62",
  native: "#7D786E",
  toolbox: "#3A8F95",
  custom: "#B0457E",
};

export function serverColor(s: string): string {
  return SERVER_COLORS[s] ?? "#7D786E";
}
