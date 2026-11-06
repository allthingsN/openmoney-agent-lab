import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../api";
import type { Framework, Task, Upstream } from "../types";
import { laneColor } from "./colors";

export type Theme = "ink" | "paper";

interface Ctx {
  theme: Theme;
  setTheme: (t: Theme) => void;
  frameworks: Framework[];
  fw: (id: string) => Framework | undefined;
  color: (fwId: string | undefined, fallback?: string) => string;
  tasks: Task[];
  upstream: Upstream | null;
  models: string[];
  refreshConfig: () => Promise<void>;
  serverDown: boolean;
}

const AppCtx = createContext<Ctx | null>(null);

function initialTheme(): Theme {
  try {
    const t = localStorage.getItem("lab.theme");
    if (t === "ink" || t === "paper") return t;
  } catch {
    /* storage blocked */
  }
  return "ink";
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(initialTheme);
  const [frameworks, setFrameworks] = useState<Framework[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [upstream, setUpstream] = useState<Upstream | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [serverDown, setServerDown] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("lab.theme", theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const refreshConfig = useCallback(async () => {
    try {
      const c = await api.config();
      setUpstream(c.upstream);
      setModels(c.models);
      setServerDown(false);
    } catch {
      setServerDown(true);
    }
  }, []);

  useEffect(() => {
    refreshConfig();
    api.frameworks().then((r) => setFrameworks(r.frameworks)).catch(() => setServerDown(true));
    api.tasks().then((r) => setTasks(r.tasks)).catch(() => {});
  }, [refreshConfig]);

  const byId = useMemo(() => new Map(frameworks.map((f) => [f.id, f])), [frameworks]);
  const fw = useCallback((id: string) => byId.get(id), [byId]);
  const color = useCallback(
    (id: string | undefined, fallback?: string) => laneColor(byId.get(id ?? "")?.color ?? fallback, theme),
    [byId, theme],
  );

  const value = useMemo<Ctx>(
    () => ({ theme, setTheme: setThemeState, frameworks, fw, color, tasks, upstream, models, refreshConfig, serverDown }),
    [theme, frameworks, fw, color, tasks, upstream, models, refreshConfig, serverDown],
  );
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp outside AppProvider");
  return c;
}

export function useReducedMotion(): boolean {
  const [r, setR] = useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  useEffect(() => {
    const m = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!m) return;
    const on = () => setR(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return r;
}
