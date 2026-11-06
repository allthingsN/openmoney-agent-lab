export function usd(n: number | null | undefined, digits?: number): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const d = digits ?? (n === 0 ? 2 : n < 0.01 ? 4 : n < 1 ? 3 : 2);
  return "$" + n.toFixed(d);
}

export function compact(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1) + "M";
  if (a >= 1e4) return Math.round(n / 1e3) + "k";
  if (a >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(Math.round(n));
}

export function int(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return Math.round(n).toLocaleString("en-US");
}

export function secs(s: number | null | undefined): string {
  if (s === null || s === undefined || Number.isNaN(s)) return "—";
  if (s < 10) return s.toFixed(1) + "s";
  if (s < 60) return Math.round(s) + "s";
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}m${r.toString().padStart(2, "0")}s`;
}

export function ms(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  if (n < 1) return n.toFixed(2) + "ms";
  if (n < 1000) return Math.round(n) + "ms";
  return (n / 1000).toFixed(n < 10000 ? 2 : 1) + "s";
}

export function ago(ts: number | null | undefined): string {
  if (!ts) return "";
  const d = Date.now() / 1000 - ts;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  return new Date(ts * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function clock(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString("en-US", { hour12: false });
}

export function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

export function chars(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n >= 1000 ? (n / 1000).toFixed(1) + "k chars" : n + " chars";
}

export function deliverableText(d: string | Record<string, string>): { head: string; body: string } {
  if (typeof d === "string") {
    const m = d.match(/^(\S+)\s+[—-]\s+(.*)$/s);
    return m ? { head: m[1], body: m[2] } : { head: d, body: "" };
  }
  const [k, v] = Object.entries(d)[0] ?? ["", ""];
  const m = k.match(/^(\S+)\s+[—-]\s+(.*)$/s);
  return m ? { head: m[1], body: `${m[2]}: ${v}` } : { head: k, body: v };
}

export function tryJson(s: unknown): unknown {
  if (typeof s !== "string") return s;
  const t = s.trim();
  if (!(t.startsWith("{") || t.startsWith("["))) return s;
  try {
    return JSON.parse(t);
  } catch {
    return s;
  }
}
