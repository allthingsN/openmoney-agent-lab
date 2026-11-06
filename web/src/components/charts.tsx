import { useState } from "react";

export interface BarRow {
  id: string;
  label: string;
  color: string;
  value: number | null;
  display: string;
  sub?: string;
}

/** A small horizontal bar chart: one row per agent, colored by framework, value labels in ink. */
export function Bars({ title, unit, rows, better = "lower", note }: { title: string; unit?: string; rows: BarRow[]; better?: "lower" | "higher"; note?: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const vals = rows.map((r) => r.value).filter((v): v is number => v !== null && Number.isFinite(v));
  const max = Math.max(...vals, 0) || 1;
  const best = vals.length > 1 ? (better === "lower" ? Math.min(...vals) : Math.max(...vals)) : null;
  return (
    <figure className="bars" aria-label={title}>
      <figcaption className="bars-head">
        <span className="bars-title">{title}</span>
        <span className="bars-unit">{unit}{unit ? " · " : ""}{better === "lower" ? "lower is better" : "higher is better"}</span>
      </figcaption>
      <div className="bars-body" role="table" aria-label={`${title} by agent`}>
        {rows.map((r) => {
          const w = r.value === null ? 0 : Math.max(0.5, (r.value / max) * 100);
          const isBest = best !== null && r.value === best;
          return (
            <div key={r.id} role="row" className={`bars-row ${hover === r.id ? "is-hover" : ""}`}
              onMouseEnter={() => setHover(r.id)} onMouseLeave={() => setHover(null)} title={`${r.label}: ${r.display}${r.sub ? " — " + r.sub : ""}`}>
              <span role="cell" className="bars-label">{r.label}</span>
              <span role="cell" className="bars-track">
                {r.value !== null && <span className="bars-fill" style={{ width: `${w}%`, background: r.color }} />}
              </span>
              <span role="cell" className={`bars-val ${isBest ? "is-best" : ""}`}>{r.display}{isBest && <span className="bars-best" aria-label="best">◆</span>}</span>
            </div>
          );
        })}
      </div>
      {note && <p className="bars-note">{note}</p>}
    </figure>
  );
}

/** A thin stacked bar of parts (e.g. tokens in · cached · out). */
export function Stack({ parts, height = 6 }: { parts: Array<{ value: number; color: string; label: string }>; height?: number }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <span className="stackbar" style={{ height }} role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(", ")}>
      {parts.filter((p) => p.value > 0).map((p) => (
        <span key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} title={`${p.label}: ${p.value.toLocaleString()}`} />
      ))}
    </span>
  );
}
