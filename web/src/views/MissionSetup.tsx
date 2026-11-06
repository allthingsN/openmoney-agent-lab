import { useEffect, useState } from "react";
import { api } from "../api";
import { I } from "../components/icons";
import { Button, Glyph, Kicker, SectionHead, Spinner, Toggle } from "../components/ui";
import { useApp } from "../lib/app";
import { deliverableText } from "../lib/format";
import { go } from "../lib/router";
import type { Mission } from "../types";
import { KeyGate } from "./Settings";

export function MissionSetup() {
  const app = useApp();
  const [missions, setMissions] = useState<Mission[] | null>(null);
  const [mid, setMid] = useState<string>("");
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [model, setModel] = useState("");
  const [interactive, setInteractive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.missions().then((r) => {
      setMissions(r.missions);
      if (r.missions[0]) {
        setMid(r.missions[0].id);
        setRoles(Object.fromEntries(r.missions[0].roles.map((x) => [x.role, x.framework])));
      }
    }).catch(() => setMissions([]));
  }, []);
  useEffect(() => {
    if (!model && app.upstream) setModel(app.upstream.model);
  }, [app.upstream, model]);
  const m = missions?.find((x) => x.id === mid);
  const distinct = new Set(Object.values(roles)).size;

  const start = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.createRun({ kind: "mission", mission: mid, roles, model, interactive });
      go(`/run/${r.id}`);
    } catch (e) {
      setErr(String((e as Error).message));
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <Kicker>Mission Control</Kicker>
        <h1 className="display">One goal. A team of agents, each on a different framework.</h1>
        <p className="lede">A planner breaks the goal into tasks on a shared board. Specialists pick them up in parallel, a reviewer can send work back, and the planner assembles the result — graded like everything else in the lab.</p>
      </header>
      {!missions ? <Spinner /> : !m ? <p className="faint">No missions found in missions/.</p> : (
        <>
          <section className="setup-section mission-intro">
            <div>
              <SectionHead n={1} kicker="The mission" title={m.title}>{m.tagline}</SectionHead>
              <p className="brief-text">{m.brief}</p>
            </div>
            <div>
              <Kicker tone="soft">Deliverables</Kicker>
              <ol className="deliv-list">
                {m.deliverables.map((d, i) => {
                  const t = deliverableText(d);
                  return <li key={i}><span className="mono deliv-n">{(i + 1).toString().padStart(2, "0")}</span><span><span className="mono">{t.head}</span><span className="deliv-body">{t.body}</span></span></li>;
                })}
              </ol>
            </div>
          </section>
          <section className="setup-section">
            <SectionHead n={2} kicker="The team" title="Assign a framework to every role" aside={<span className="faint small">{distinct} framework{distinct === 1 ? "" : "s"} on this team</span>}>
              Defaults come from the mission file. Mix freely — the board and the tools are the same for everyone.
            </SectionHead>
            <ol className="role-grid">
              {m.roles.map((r, i) => {
                const fw = roles[r.role] ?? r.framework;
                return (
                  <li key={r.role} className="role-card" style={{ ["--lane" as any]: app.color(fw) }}>
                    <div className="role-card-top">
                      <span className="mono faint">{(i + 1).toString().padStart(2, "0")}</span>
                      <Glyph fw={fw} size={30} />
                      <div>
                        <div className="role-card-title">{r.title}</div>
                        <div className="faint small mono">{r.role}</div>
                      </div>
                    </div>
                    <p className="role-does">{r.does}</p>
                    <label className="field">
                      <span className="sr-only">Framework for {r.title}</span>
                      <select className="input" value={fw} onChange={(e) => setRoles({ ...roles, [r.role]: e.target.value })}>
                        {app.frameworks.map((f) => <option key={f.id} value={f.id}>{f.name}{f.installed ? "" : " (installs on first run)"}</option>)}
                      </select>
                    </label>
                  </li>
                );
              })}
            </ol>
          </section>
          <section className="setup-section">
            <SectionHead n={3} kicker="Settings" title="How to run it" />
            <div className="run-settings">
              <label className="field">
                <span className="field-label">Model</span>
                <select className="input" value={model} onChange={(e) => setModel(e.target.value)}>
                  {app.models.map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
              </label>
              <div className="field">
                <Toggle checked={interactive} onChange={setInteractive} label="Interactive — I approve the plan" hint="The mission pauses after planning so you can approve, reject or add a note. You can comment on tasks and send work back at any time." />
              </div>
            </div>
          </section>
          <div className="run-cta">
            <KeyGate>
              <div className="run-cta-row">
                <div className="run-cta-sum">{m.roles.length} roles · <span className="mono">{model}</span> · each task runs as its own agent</div>
                <Button variant="signal" size="lg" busy={busy} onClick={start} icon={<I.play size={14} />}>Start the mission</Button>
              </div>
            </KeyGate>
            {err && <div className="callout callout-red"><I.warn size={14} /> {err}</div>}
          </div>
        </>
      )}
    </div>
  );
}
