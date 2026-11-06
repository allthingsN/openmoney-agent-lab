import { useEffect, useState } from "react";
import { api } from "../api";
import { FrameworkGrid } from "../components/FrameworkPicker";
import { I, ServerIcon, SERVER_LABEL } from "../components/icons";
import { Button, Chip, Kicker, SectionHead, Toggle } from "../components/ui";
import { useApp } from "../lib/app";
import { serverColor } from "../lib/colors";
import { go, useRoute } from "../lib/router";
import { KeyGate } from "./Settings";

export function ArenaSetup() {
  const app = useApp();
  const route = useRoute();
  const q = route.query;
  const [task, setTask] = useState<string>(q.get("task") ?? "");
  const [fws, setFws] = useState<string[]>(q.get("fw")?.split(",").filter(Boolean) ?? []);
  const [model, setModel] = useState<string>(q.get("model") ?? "");
  const [trials, setTrials] = useState(1);
  const [interactive, setInteractive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!task && app.tasks.length) setTask(app.tasks[0].id);
  }, [app.tasks, task]);
  useEffect(() => {
    if (!fws.length && app.frameworks.length && !q.get("fw")) setFws(app.frameworks.filter((f) => f.installed).slice(0, 3).map((f) => f.id));
  }, [app.frameworks]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!model && app.upstream) setModel(app.upstream.model);
  }, [app.upstream, model]);

  const start = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.createRun({ kind: "bench", task, frameworks: fws, model, trials, interactive });
      go(`/run/${r.id}`);
    } catch (e) {
      setErr(String((e as Error).message ?? e));
      setBusy(false);
    }
  };
  const agents = fws.length * trials;

  return (
    <div className="page">
      <header className="page-head">
        <Kicker>Arena</Kicker>
        <h1 className="display">Same task. Every framework.</h1>
        <p className="lede">Pick a task, pick the frameworks, and watch them work it side by side — every model call metered by the lab's proxy, every tool call recorded by its servers, every result scored by the same grader.</p>
      </header>

      <section className="setup-section">
        <SectionHead n={1} kicker="Task" title="Choose the job" />
        <div className="task-grid">
          {app.tasks.map((t) => (
            <button key={t.id} className={`task-card ${task === t.id ? "is-on" : ""}`} onClick={() => setTask(t.id)} aria-pressed={task === t.id}>
              <div className="task-card-top">
                <span className="kicker kicker-soft">{t.domain}</span>
                {t.difficulty && <Chip tone="ochre">{t.difficulty}</Chip>}
              </div>
              <h3 className="task-title">{t.title}</h3>
              <p className="task-tag">{t.tagline}</p>
              <div className="task-uses">
                {t.servers.map((s) => <span key={s} className="srv-tag" style={{ ["--srv" as any]: serverColor(s) }}><ServerIcon server={s} size={12} />{SERVER_LABEL[s] ?? s}</span>)}
                {(t.skills ?? []).map((s) => <span key={s} className="skill-tag"><I.skills size={11} /> {s}</span>)}
              </div>
              {t.checks && (
                <ol className="task-checks">
                  {t.checks.map((c, i) => <li key={i}><span className="mono">{(i + 1).toString().padStart(2, "0")}</span>{c}</li>)}
                </ol>
              )}
            </button>
          ))}
        </div>
      </section>

      <section className="setup-section">
        <SectionHead n={2} kicker="Frameworks" title="Who competes" >Each card is one adapter: the framework's own documented agent API, driven by the same spec. Open the code to see exactly how it's built.</SectionHead>
        <FrameworkGrid selected={fws} onChange={setFws} />
      </section>

      <section className="setup-section">
        <SectionHead n={3} kicker="Settings" title="How to run it" />
        <div className="run-settings">
          <label className="field">
            <span className="field-label">Model</span>
            <select className="input" value={model} onChange={(e) => setModel(e.target.value)}>
              {app.models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <span className="field-hint">Every framework calls this model through the metering proxy.</span>
          </label>
          <label className="field">
            <span className="field-label">Trials per framework</span>
            <div className="stepper">
              <button onClick={() => setTrials(Math.max(1, trials - 1))} aria-label="Fewer trials">−</button>
              <span className="mono">{trials}</span>
              <button onClick={() => setTrials(Math.min(5, trials + 1))} aria-label="More trials">+</button>
            </div>
            <span className="field-hint">Repeat runs show variance. Up to 4 agents run at once.</span>
          </label>
          <div className="field">
            <Toggle checked={interactive} onChange={setInteractive} label="Interactive — I approve destructive actions" hint="Writes, rollbacks, pages and status posts wait for your Approve / Decline." />
          </div>
        </div>
      </section>

      <div className="run-cta">
        <KeyGate>
          <div className="run-cta-row">
            <div className="run-cta-sum">
              <span className="mono">{agents}</span> agent{agents === 1 ? "" : "s"} · <span className="mono">{model || "—"}</span>
              {app.frameworks.some((f) => fws.includes(f.id) && !f.installed) && <span className="faint"> · first run installs dependencies</span>}
            </div>
            <Button variant="signal" size="lg" onClick={start} busy={busy} disabled={!task || !fws.length} icon={<I.play size={14} />}>Run the arena</Button>
          </div>
        </KeyGate>
        {err && <div className="callout callout-red"><I.warn size={14} /> {err}</div>}
      </div>
    </div>
  );
}
