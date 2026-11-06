import { useEffect, useState } from "react";
import { api } from "../api";
import { useApp } from "../lib/app";
import type { Framework } from "../types";
import { CodeView } from "./content";
import { I } from "./icons";
import { Chip, Glyph, Modal, Spinner } from "./ui";

export function FrameworkGrid({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  const app = useApp();
  const [view, setView] = useState<Framework | null>(null);
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const all = app.frameworks;
  return (
    <>
      <div className="fw-bar">
        <span className="faint small">{selected.length} of {all.length} selected</span>
        <button className="linkish small" onClick={() => onChange(all.filter((f) => f.installed).map((f) => f.id))}>Installed</button>
        <button className="linkish small" onClick={() => onChange(all.map((f) => f.id))}>All</button>
        <button className="linkish small" onClick={() => onChange([])}>None</button>
      </div>
      <div className="fw-grid" role="group" aria-label="Frameworks">
        {all.map((f) => {
          const on = selected.includes(f.id);
          const c = app.color(f.id);
          return (
            <div key={f.id} className={`fw-card ${on ? "is-on" : ""}`} style={{ ["--lane" as any]: c }}>
              <button className="fw-card-main" role="checkbox" aria-checked={on} onClick={() => toggle(f.id)}>
                <span className="fw-check" aria-hidden>{on && <I.check size={12} />}</span>
                <Glyph fw={f.id} size={36} />
                <span className="fw-names">
                  <span className="fw-name">{f.name.replace(/\s*\(no framework\)/, "")}{/no framework/.test(f.name) && <span className="faint"> · baseline</span>}</span>
                  <span className="fw-vendor">{f.vendor} · {f.language === "typescript" ? "TypeScript" : "Python"}</span>
                </span>
              </button>
              <p className="fw-summary">{f.summary}</p>
              <div className="fw-foot">
                <span className="mono small">{f.loc} LOC</span>
                {f.installed ? <Chip tone="green">installed</Chip> : <Chip tone="ochre" title="Installs automatically on first run">installs on first run</Chip>}
                {f.skills === "native" && <Chip tone="blue" title="Skills loaded the framework's own way">native skills</Chip>}
                <span className="spacer" />
                <button className="linkish small" onClick={() => setView(f)}><I.code size={12} /> view code</button>
              </div>
            </div>
          );
        })}
      </div>
      {view && <SourceModal fw={view} onClose={() => setView(null)} />}
    </>
  );
}

export function SourceModal({ fw, onClose }: { fw: Framework; onClose: () => void }) {
  const [files, setFiles] = useState<Record<string, string> | null>(null);
  const [cur, setCur] = useState<string | null>(null);
  useEffect(() => {
    api.frameworkSource(fw.id).then((r) => setFiles(r.files)).catch(() => setFiles({}));
  }, [fw.id]);
  const names = Object.keys(files ?? {});
  const sel = cur ?? names[0];
  return (
    <Modal open onClose={onClose} kicker={`${fw.vendor} · ${fw.language} · ${fw.loc} lines`} title={fw.name} size="lg">
      <p className="lede-sm">{fw.summary}</p>
      {fw.packages && <p className="faint small">Packages: <span className="mono">{fw.packages}</span></p>}
      {!files ? <Spinner /> : (
        <>
          {names.length > 1 && (
            <div className="file-tabs" role="tablist">{names.map((n) => <button key={n} role="tab" aria-selected={n === sel} className={n === sel ? "is-on" : ""} onClick={() => setCur(n)}>{n}</button>)}</div>
          )}
          {sel && <CodeView code={files[sel]} path={sel} maxHeight="60vh" />}
        </>
      )}
      {fw.notes && (
        <details className="notes" open>
          <summary>What we found building this adapter</summary>
          <p>{fw.notes}</p>
        </details>
      )}
    </Modal>
  );
}
