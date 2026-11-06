import { useCallback, useEffect, useRef, useState } from "react";
import { eventsUrl, type RunSource } from "../api";
import type { LabEvent } from "../types";
import { emptyRun, reduceAll, type RunState } from "./reduce";

export type StreamStatus = "connecting" | "open" | "closed" | "error";

export interface RunStream {
  state: RunState;
  status: StreamStatus;
  /** Events with ts greater than this arrived after the history burst — those get entrance motion. */
  freshTs: number;
  live: boolean;
  now: () => number;
}

/**
 * Subscribes to a run's SSE stream (history first, then live), batches events per animation frame and folds them
 * through the shared reducer. Reconnects with ?after=<last seq> so nothing is lost or doubled.
 */
export function useRunStream(src: RunSource | null): RunStream {
  const [state, setState] = useState<RunState>(emptyRun);
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const [freshTs, setFreshTs] = useState<number>(Infinity);
  const queue = useRef<LabEvent[]>([]);
  const lastSeq = useRef(-1);
  const lastTs = useRef(0);
  const lastRecv = useRef(0);
  const ended = useRef(false);
  const key = src ? `${src.type}:${src.id}:${src.speed ?? 0}` : "";

  useEffect(() => {
    if (!src) return;
    setState(emptyRun());
    setStatus("connecting");
    setFreshTs(Infinity);
    queue.current = [];
    lastSeq.current = -1;
    lastTs.current = 0;
    ended.current = false;
    let es: EventSource | null = null;
    let raf = 0;
    let timer: number | undefined;
    let freshTimer: number | undefined;
    let retry: number | undefined;
    let first = true;
    let disposed = false;

    const flush = () => {
      raf = 0;
      timer = undefined;
      const batch = queue.current;
      if (!batch.length) return;
      queue.current = [];
      setState((s) => reduceAll(s, batch));
    };
    const schedule = () => {
      if (raf || timer) return;
      if (document.hidden) timer = window.setTimeout(flush, 120);
      else raf = requestAnimationFrame(flush);
    };

    const open = () => {
      if (disposed) return;
      es = new EventSource(eventsUrl(src, lastSeq.current));
      es.onopen = () => setStatus("open");
      es.onmessage = (m) => {
        let ev: LabEvent;
        try {
          ev = JSON.parse(m.data);
        } catch {
          return;
        }
        if (ev.type === "ping") return;
        if (first) {
          first = false;
          freshTimer = window.setTimeout(() => setFreshTs(lastTs.current || Date.now() / 1000), 350);
        }
        if (typeof ev.seq === "number") lastSeq.current = Math.max(lastSeq.current, ev.seq);
        if (typeof ev.ts === "number") lastTs.current = Math.max(lastTs.current, ev.ts);
        lastRecv.current = performance.now();
        queue.current.push(ev);
        if (ev.type === "stream.end") {
          ended.current = true;
          es?.close();
          setStatus("closed");
          if (first || freshTimer === undefined) setFreshTs(lastTs.current);
        }
        schedule();
      };
      es.onerror = () => {
        es?.close();
        if (ended.current || disposed) return;
        setStatus("error");
        retry = window.setTimeout(open, 1500);
      };
    };
    open();
    return () => {
      disposed = true;
      es?.close();
      if (raf) cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
      if (freshTimer) clearTimeout(freshTimer);
      if (retry) clearTimeout(retry);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const live = status !== "closed" && !state.streamEnded;
  const speed = src?.speed ?? 0;
  const isResult = src?.type === "result";
  const now = useCallback(() => {
    const lt = lastTs.current || state.lastTs || 0;
    if (!live) return state.lastTs ?? lt;
    if (isResult) {
      const dt = Math.min(2, (performance.now() - lastRecv.current) / 1000);
      return lt + dt * Math.max(speed, 1);
    }
    return Math.max(lt, Date.now() / 1000);
  }, [live, isResult, speed, state.lastTs]);

  return { state, status, freshTs, live, now };
}

/** Re-render every `ms` while `active` — drives the live time axis and elapsed counters. */
export function useTicker(active: boolean, ms = 250): number {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setT((x) => x + 1), ms);
    return () => clearInterval(id);
  }, [active, ms]);
  return t;
}
