import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import { useApp, useReducedMotion } from "../lib/app";
import { onColor } from "../lib/colors";
import { I } from "./icons";

export function Kicker({ children, n, tone }: { children: ReactNode; n?: number | string; tone?: "signal" | "soft" }) {
  return (
    <div className={`kicker ${tone === "soft" ? "kicker-soft" : ""}`}>
      {n !== undefined && <span className="kicker-n">{typeof n === "number" ? n.toString().padStart(2, "0") : n}</span>}
      {children}
    </div>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "signal" | "ghost" | "quiet" | "danger";
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
  busy?: boolean;
};

export function Button({ variant = "ghost", size = "md", icon, busy, children, className = "", disabled, ...rest }: BtnProps) {
  return (
    <button className={`btn btn-${variant} btn-${size} ${busy ? "is-busy" : ""} ${className}`} disabled={disabled || busy} {...rest}>
      {busy ? <span className="spinner" aria-hidden /> : icon}
      {children !== undefined && <span>{children}</span>}
    </button>
  );
}

export function IconButton({ label, children, className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button className={`icon-btn ${className}`} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
}

export function Chip({ children, tone, style, title }: { children: ReactNode; tone?: "green" | "ochre" | "blue" | "red" | "signal" | "soft"; style?: CSSProperties; title?: string }) {
  return <span className={`chip ${tone ? "chip-" + tone : ""}`} style={style} title={title}>{children}</span>;
}

export function Glyph({ fw, size = 28, color, glyph, pulse }: { fw?: string; size?: number; color?: string; glyph?: string; pulse?: boolean }) {
  const app = useApp();
  const f = fw ? app.fw(fw) : undefined;
  const c = color ?? app.color(fw);
  const g = glyph ?? f?.glyph ?? (fw ?? "?").slice(0, 2).toUpperCase();
  const fs = g.length >= 3 ? size * 0.34 : g.length === 2 ? size * 0.4 : size * 0.5;
  return (
    <span className={`glyph ${pulse ? "is-pulsing" : ""}`} style={{ width: size, height: size, background: c, color: onColor(c), fontSize: fs, ["--c" as any]: c }} aria-hidden>
      {g}
    </span>
  );
}

export function StatusDot({ status }: { status: string }) {
  return <span className={`status-dot s-${status}`} aria-hidden />;
}

export const STATUS_LABEL: Record<string, string> = {
  queued: "Queued", running: "Running", paused: "Paused", done: "Done", error: "Error", created: "Created",
};

/** A rubber stamp for scores: lands with a slam unless reduced motion. */
export function Stamp({ score, passed, fresh, small, label }: { score: number | null | undefined; passed?: boolean | null; fresh?: boolean; small?: boolean; label?: string }) {
  if (score === null || score === undefined) return null;
  const tone = passed ? "pass" : score >= 50 ? "partial" : "fail";
  return (
    <span className={`stamp stamp-${tone} ${fresh ? "is-fresh" : ""} ${small ? "stamp-sm" : ""}`} role="img" aria-label={`Score ${Math.round(score)} of 100, ${passed ? "passed" : "not passed"}`}>
      <span className="stamp-score">{Math.round(score)}</span>
      <span className="stamp-label">{label ?? (passed ? "PASS" : "FAIL")}</span>
    </span>
  );
}

/** Number that ticks up to its new value. */
export function Counter({ value, format, className = "" }: { value: number; format: (n: number) => string; className?: string }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const raf = useRef(0);
  const [bump, setBump] = useState(false);
  useEffect(() => {
    if (reduced || value === shown) {
      setShown(value);
      from.current = value;
      return;
    }
    const start = performance.now();
    const a = from.current;
    const dur = 420;
    cancelAnimationFrame(raf.current);
    setBump(true);
    const t = window.setTimeout(() => setBump(false), 300);
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      const v = a + (value - a) * e;
      setShown(v);
      if (k < 1) raf.current = requestAnimationFrame(step);
      else from.current = value;
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf.current);
      clearTimeout(t);
      from.current = value;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, reduced]);
  return <span className={`counter ${bump ? "is-bump" : ""} ${className}`}>{format(shown)}</span>;
}

export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <label className={`toggle ${disabled ? "is-disabled" : ""}`} htmlFor={id}>
      <input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden><span className="toggle-thumb" /></span>
      <span className="toggle-text">
        <span className="toggle-label">{label}</span>
        {hint && <span className="toggle-hint">{hint}</span>}
      </span>
    </label>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: ReactNode }>; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} role="radio" aria-checked={o.value === value} className={o.value === value ? "is-on" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function useEscape(on: () => void, active = true) {
  useEffect(() => {
    if (!active) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && on();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [on, active]);
}

function useFocusTrap(ref: React.RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active || !ref.current) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el.querySelector<HTMLElement>("[data-autofocus], button, [href], input, textarea, select");
    first?.focus({ preventScroll: true });
    return () => prev?.focus?.({ preventScroll: true });
  }, [active, ref]);
}

export function Drawer({ open, onClose, title, kicker, children, wide }: { open: boolean; onClose: () => void; title: ReactNode; kicker?: ReactNode; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEscape(onClose, open);
  useFocusTrap(ref, open);
  if (!open) return null;
  return (
    <div className="drawer-root" role="presentation">
      <div className="drawer-scrim" onClick={onClose} />
      <aside ref={ref} className={`drawer ${wide ? "drawer-wide" : ""}`} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : "Details"}>
        <header className="drawer-head">
          <div className="drawer-titles">
            {kicker && <div className="kicker">{kicker}</div>}
            <h2 className="drawer-title">{title}</h2>
          </div>
          <IconButton label="Close" onClick={onClose}><I.close /></IconButton>
        </header>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}

export function Modal({ open, onClose, title, kicker, children, footer, size = "md" }: { open: boolean; onClose: () => void; title: ReactNode; kicker?: ReactNode; children: ReactNode; footer?: ReactNode; size?: "md" | "lg" }) {
  const ref = useRef<HTMLDivElement>(null);
  useEscape(onClose, open);
  useFocusTrap(ref, open);
  if (!open) return null;
  return (
    <div className="modal-root" role="presentation">
      <div className="modal-scrim" onClick={onClose} />
      <div ref={ref} className={`modal modal-${size}`} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : "Dialog"}>
        <header className="modal-head">
          <div>
            {kicker && <div className="kicker">{kicker}</div>}
            <h2 className="modal-title">{title}</h2>
          </div>
          <IconButton label="Close" onClick={onClose}><I.close /></IconButton>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function Empty({ title, children, action }: { title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      {children && <div className="empty-body">{children}</div>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function SectionHead({ n, kicker, title, children, aside }: { n?: number; kicker: ReactNode; title?: ReactNode; children?: ReactNode; aside?: ReactNode }) {
  return (
    <div className="section-head">
      <div className="section-head-main">
        <Kicker n={n}>{kicker}</Kicker>
        {title && <h2 className="section-title">{title}</h2>}
        {children && <p className="section-sub">{children}</p>}
      </div>
      {aside && <div className="section-head-aside">{aside}</div>}
    </div>
  );
}

export function Spinner() {
  return <span className="spinner" role="status" aria-label="Loading" />;
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      className="btn btn-quiet btn-sm"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setOk(true);
          setTimeout(() => setOk(false), 1200);
        }).catch(() => {});
      }}
    >
      {ok ? <I.check size={13} /> : <I.copy size={13} />}
      <span>{ok ? "Copied" : label}</span>
    </button>
  );
}
