import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/** Shared time axis for every lane: same t0/t1, same zoom, scroll positions kept in sync. */
interface Axis {
  t0: number;
  t1: number;
  zoom: number;
  x: (ts: number) => number; // percent of the inner width
  register: (el: HTMLElement | null) => void;
}

const AxisCtx = createContext<Axis | null>(null);

export function AxisProvider({ t0, t1, zoom, children }: { t0: number; t1: number; zoom: number; children: ReactNode }) {
  const els = useRef(new Set<HTMLElement>());
  const syncing = useRef(false);
  const handlers = useRef(new Map<HTMLElement, () => void>());
  const register = useCallback((el: HTMLElement | null) => {
    if (!el || els.current.has(el)) return;
    els.current.add(el);
    const on = () => {
      if (syncing.current) return;
      syncing.current = true;
      for (const o of els.current) if (o !== el && o.isConnected) o.scrollLeft = el.scrollLeft;
      requestAnimationFrame(() => (syncing.current = false));
    };
    handlers.current.set(el, on);
    el.addEventListener("scroll", on, { passive: true });
    // new lanes join at the current scroll position
    const other = [...els.current].find((o) => o !== el && o.isConnected);
    if (other) el.scrollLeft = other.scrollLeft;
  }, []);
  // forget detached elements now and then
  useEffect(() => {
    const id = window.setInterval(() => {
      for (const el of els.current) if (!el.isConnected) {
        el.removeEventListener("scroll", handlers.current.get(el)!);
        els.current.delete(el);
        handlers.current.delete(el);
      }
    }, 5000);
    return () => clearInterval(id);
  }, []);
  // when zoomed and live, keep the newest activity in view if the person hasn't scrolled away
  useEffect(() => {
    if (zoom <= 1) return;
    for (const el of els.current) {
      if (!el.isConnected) continue;
      const nearEnd = el.scrollWidth - el.clientWidth - el.scrollLeft < el.clientWidth * 0.25;
      if (nearEnd) el.scrollLeft = el.scrollWidth;
    }
  }, [t1, zoom]);
  const span = Math.max(t1 - t0, 5);
  const value = useMemo<Axis>(() => ({ t0, t1: t0 + span, zoom, x: (ts) => ((ts - t0) / span) * 100, register }), [t0, span, zoom, register]);
  return <AxisCtx.Provider value={value}>{children}</AxisCtx.Provider>;
}

export function useAxis(): Axis {
  const a = useContext(AxisCtx);
  if (!a) throw new Error("useAxis outside AxisProvider");
  return a;
}

function niceStep(span: number, target: number): number {
  const raw = span / target;
  const steps = [1, 2, 5, 10, 15, 20, 30, 60, 120, 300, 600, 900, 1800, 3600];
  return steps.find((s) => s >= raw) ?? 3600;
}

function label(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m}m${r}s` : `${m}m`;
}

export function AxisRuler() {
  const ax = useAxis();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ax.register(ref.current), [ax]);
  const span = ax.t1 - ax.t0;
  const step = niceStep(span, 8 * ax.zoom);
  const ticks: number[] = [];
  for (let s = 0; s <= span + 0.001; s += step) ticks.push(s);
  return (
    <div className="ruler-scroll" ref={ref}>
      <div className="ruler" style={{ width: `${ax.zoom * 100}%` }} aria-hidden>
        {ticks.map((s) => (
          <span key={s} className="ruler-tick" style={{ left: `${(s / span) * 100}%` }}>{label(s)}</span>
        ))}
      </div>
    </div>
  );
}

export function GridLines() {
  const ax = useAxis();
  const span = ax.t1 - ax.t0;
  const step = niceStep(span, 8 * ax.zoom);
  const out: number[] = [];
  for (let s = step; s < span; s += step) out.push(s);
  return (
    <div className="gridlines" aria-hidden>
      {out.map((s) => <span key={s} style={{ left: `${(s / span) * 100}%` }} />)}
    </div>
  );
}

// --------------------------------------------------------------------------------------------- hover tips
interface Tip { x: number; y: number; content: ReactNode }
const TipCtx = createContext<(t: Tip | null) => void>(() => {});

export function TipProvider({ children }: { children: ReactNode }) {
  const [tip, setTip] = useState<Tip | null>(null);
  return (
    <TipCtx.Provider value={setTip}>
      {children}
      {tip && (
        <div className="hovertip" style={{ left: Math.min(tip.x + 14, window.innerWidth - 300), top: tip.y + 16 }} role="tooltip">
          {tip.content}
        </div>
      )}
    </TipCtx.Provider>
  );
}

export function useTip() {
  const set = useContext(TipCtx);
  return useCallback(
    (content: ReactNode) => ({
      onMouseEnter: (e: React.MouseEvent) => set({ x: e.clientX, y: e.clientY, content }),
      onMouseMove: (e: React.MouseEvent) => set({ x: e.clientX, y: e.clientY, content }),
      onMouseLeave: () => set(null),
      onBlur: () => set(null),
    }),
    [set],
  );
}
