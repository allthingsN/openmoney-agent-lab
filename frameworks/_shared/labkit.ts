/**
 * labkit: the few things every lab agent shares, kept out of the framework code. TypeScript port of labkit.py.
 *
 * - loadSpec()  — the agent's job: model, prompts, MCP servers, skills (from agent.json)
 * - calculate() — the one native tool every agent defines in its own framework's style
 * - emit()      — optional telemetry to the lab (native tool calls, the final answer). No-op outside the lab.
 * - final()     — report the final answer
 *
 * Node built-ins only. The same file is copied next to every TypeScript framework's agent.
 */

import { readFileSync } from "node:fs";

export interface McpServerSpec {
  name: string;
  transport: "http" | "stdio";
  url?: string;
  command?: string;
  args?: string[];
}

export interface Spec {
  agent_id: string;
  run_id: string;
  framework: string;
  model: string;
  max_tokens: number;
  max_turns: number;
  system_prompt: string;
  prompt: string;
  mcp_servers: McpServerSpec[];
  skills: { mode: "mcp" | "native"; names: string[]; dir: string };
  native_tools: string[];
  events_url?: string;
  events_token?: string;
  workdir?: string;
  [key: string]: unknown;
}

let SPEC: Spec | undefined;

export function loadSpec(path?: string): Spec {
  const p = path ?? process.argv[2] ?? process.env.LAB_SPEC ?? "agent.json";
  SPEC = JSON.parse(readFileSync(p, "utf8")) as Spec;
  return SPEC;
}

export async function emit(type: string, data: Record<string, unknown> = {}): Promise<void> {
  const url = SPEC?.events_url;
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SPEC?.events_token}` },
      body: JSON.stringify({ type, data }),
      signal: AbortSignal.timeout(5000),
    });
    await res.arrayBuffer();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) { // telemetry must never break the agent
    console.error(`[labkit] telemetry failed: ${e}`);
  }
}

export async function final(text: string): Promise<void> {
  await emit("agent.final", { text });
  console.log("\n===== FINAL ANSWER =====\n" + text);
}

// ---- calculate: safe arithmetic (Python semantics: int/float, //, %, **, round half-even) ----------------------

export const CALCULATE_DESCRIPTION =
  "Evaluate an arithmetic expression exactly, e.g. '12*(65-5) + 99' or 'round(1452/1024, 2)'. " +
  "Supports + - * / // % **, parentheses, and round, min, max, abs, sum, sqrt, ceil, floor.";

type Num = { v: number; int: boolean };
type Val = Num | Val[];

const num = (v: number, int: boolean): Num => ({ v, int });
const asNum = (x: Val): Num => {
  if (Array.isArray(x)) throw new Error("expected a number, got a list");
  return x;
};
const items = (x: Val): Val[] => {
  if (!Array.isArray(x)) throw new Error(`'${x.int ? "int" : "float"}' object is not iterable`);
  return x;
};

function halfEven(x: number, digits: number): number {
  // Round like Python: on the exact decimal value of the double, ties to even.
  if (!Number.isFinite(x)) return x;
  if (digits < 0) {
    const f = 10 ** -digits;
    return halfEven(x / f, 0) * f;
  }
  if (Math.abs(x) >= 1e21 || digits > 60) return x;
  const exact = Math.abs(x).toFixed(100);
  const [ip, fp] = exact.split(".");
  const keep = ip + fp.slice(0, digits);
  const rest = fp.slice(digits);
  let k = BigInt(keep);
  const cmp = rest[0] > "5" || (rest[0] === "5" && /[1-9]/.test(rest.slice(1))) ? 1 : rest[0] === "5" ? 0 : -1;
  if (cmp > 0 || (cmp === 0 && k % 2n === 1n)) k += 1n;
  const s = k.toString().padStart(digits + 1, "0");
  const out = Number(digits ? `${s.slice(0, -digits)}.${s.slice(-digits)}` : s);
  return x < 0 ? -out : out;
}

function pyFloor(a: number, b: number): number {
  if (b === 0) throw new Error("division by zero");
  return Math.floor(a / b);
}

function pyMod(a: number, b: number): number {
  if (b === 0) throw new Error("division by zero");
  const r = a % b;
  return r !== 0 && r < 0 !== b < 0 ? r + b : r;
}

const BINOPS: Record<string, (a: Num, b: Num) => Num> = {
  "+": (a, b) => num(a.v + b.v, a.int && b.int),
  "-": (a, b) => num(a.v - b.v, a.int && b.int),
  "*": (a, b) => num(a.v * b.v, a.int && b.int),
  "/": (a, b) => {
    if (b.v === 0) throw new Error("division by zero");
    return num(a.v / b.v, false);
  },
  "//": (a, b) => num(pyFloor(a.v, b.v), a.int && b.int),
  "%": (a, b) => num(pyMod(a.v, b.v), a.int && b.int),
  "**": (a, b) => {
    if (a.v === 0 && b.v < 0) throw new Error("0.0 cannot be raised to a negative power");
    const v = a.v ** b.v;
    if (Number.isNaN(v)) throw new Error("math domain error");
    return num(v, a.int && b.int && b.v >= 0);
  },
};

const FUNCS: Record<string, (...a: Val[]) => Val> = {
  round: (x, nd) => {
    const n = asNum(x);
    if (nd === undefined) return num(halfEven(n.v, 0), true);
    const d = asNum(nd);
    if (!d.int) throw new Error("'float' object cannot be interpreted as an integer");
    return num(n.int && d.v >= 0 ? n.v : halfEven(n.v, d.v), n.int);
  },
  min: (...a) => pick(a, (x, y) => x < y),
  max: (...a) => pick(a, (x, y) => x > y),
  abs: (x) => { const n = asNum(x); return num(Math.abs(n.v), n.int); },
  sum: (...a) => (a.length === 1 ? items(a[0]) : a).map(asNum).reduce((s, n) => BINOPS["+"](s, n), num(0, true)),
  sqrt: (x) => {
    const n = asNum(x);
    if (n.v < 0) throw new Error("math domain error");
    return num(Math.sqrt(n.v), false);
  },
  ceil: (x) => num(Math.ceil(asNum(x).v), true),
  floor: (x) => num(Math.floor(asNum(x).v), true),
};

function pick(args: Val[], better: (x: number, y: number) => boolean): Num {
  const xs = (args.length === 1 ? items(args[0]) : args).map(asNum);
  if (!xs.length) throw new Error("arg is an empty sequence");
  return xs.reduce((best, x) => (better(x.v, best.v) ? x : best));
}

function parse(src: string): Val {
  const toks = src.match(/\d[\d_]*\.?[\d_]*(?:[eE][+-]?\d+)?|\.\d[\d_]*(?:[eE][+-]?\d+)?|\*\*|\/\/|[A-Za-z_]\w*|\S/g) ?? [];
  let i = 0;
  const peek = () => toks[i];
  const take = (t?: string) => {
    if (t !== undefined && toks[i] !== t) throw new Error(`invalid syntax: expected '${t}' near '${toks[i] ?? "end"}'`);
    return toks[i++];
  };
  const expr = (): Val => {
    let left = term();
    while (peek() === "+" || peek() === "-") { const op = take(); left = BINOPS[op](asNum(left), asNum(term())); }
    return left;
  };
  const term = (): Val => {
    let left = unary();
    while (["*", "/", "//", "%"].includes(peek())) { const op = take(); left = BINOPS[op](asNum(left), asNum(unary())); }
    return left;
  };
  const unary = (): Val => {
    if (peek() === "-") { take(); const n = asNum(unary()); return num(-n.v, n.int); }
    if (peek() === "+") { take(); return asNum(unary()); }
    return power();
  };
  const power = (): Val => {
    const base = atom();
    if (peek() !== "**") return base;
    take();
    return BINOPS["**"](asNum(base), asNum(unary()));
  };
  const list = (close: string): Val[] => {
    const out: Val[] = [];
    while (peek() !== close) {
      out.push(expr());
      if (peek() !== close) take(",");
    }
    take(close);
    return out;
  };
  const atom = (): Val => {
    const t = take();
    if (t === undefined) throw new Error("invalid syntax: unexpected end of expression");
    if (/^\.?\d/.test(t)) {
      const clean = t.replace(/_/g, "");
      return num(Number(clean), !/[.eE]/.test(clean));
    }
    if (t === "(") {
      const inner = list(")");
      const tuple = inner.length !== 1 || toks[i - 2] === ",";
      return tuple ? inner : inner[0];
    }
    if (t === "[") return list("]");
    if (/^[A-Za-z_]/.test(t) && peek() === "(" && t in FUNCS) {
      take("(");
      return FUNCS[t](...list(")"));
    }
    throw new Error("only arithmetic is allowed");
  };
  const out = expr();
  if (i < toks.length) throw new Error(`invalid syntax near '${toks[i]}'`);
  return out;
}

function pyStr(x: Val): string {
  if (Array.isArray(x)) return `[${x.map(pyStr).join(", ")}]`;
  const { v, int } = x;
  if (int) return Number.isSafeInteger(v) ? String(v) : BigInt(Math.trunc(v)).toString();
  if (!Number.isFinite(v)) return Number.isNaN(v) ? "nan" : v > 0 ? "inf" : "-inf";
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-4 || a >= 1e16)) {
    return v.toExponential().replace(/e([+-])(\d)$/, "e$10$2");
  }
  const s = String(v);
  return Number.isInteger(v) ? `${s}.0` : s;
}

/** Drop thousands separators ("1,234.50") but keep argument commas ("round(x, 2)", "max(100,200)"). */
function stripGrouping(s: string): string {
  return s.replace(/(?<![\d.])\d{1,3}(?:,\d{3})+(?:\.\d+)?(?!\d)/g, (m, at: number) => {
    const depth = [...s.slice(0, at)].reduce((d, c) => d + (c === "(" || c === "[" ? 1 : c === ")" || c === "]" ? -1 : 0), 0);
    return depth === 0 || m.includes(".") ? m.replace(/,/g, "") : m;
  });
}

/** Evaluate an arithmetic expression and report it to the lab as a native tool call. */
export async function calculate(expression: string): Promise<string> {
  const t0 = performance.now();
  let out: string;
  let error = false;
  try {
    const expr = stripGrouping(expression.replace(/\$/g, ""));
    let value = parse(expr);
    if (!Array.isArray(value) && !value.int) value = num(halfEven(value.v, 10), false);
    out = pyStr(value);
  } catch (e) {
    out = `Error: ${e instanceof Error ? e.message : e}`;
    error = true;
  }
  await emit("tool.end", {
    server: "native", name: "calculate", args: { expression }, result: out,
    ms: Math.round((performance.now() - t0) * 100) / 100, error,
  });
  return out;
}
