import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api";
import { I } from "../components/icons";
import { Button, Chip, Kicker, Segmented } from "../components/ui";
import { useApp } from "../lib/app";
import { href } from "../lib/router";

/** Shows children when a key is configured, otherwise a friendly "add your key" card. */
export function KeyGate({ children, compact }: { children: ReactNode; compact?: boolean }) {
  const app = useApp();
  if (!app.upstream) return null;
  if (app.upstream.configured) return <>{children}</>;
  return (
    <div className={`keygate ${compact ? "is-compact" : ""}`}>
      <span className="keygate-icon"><I.key size={18} /></span>
      <div>
        <div className="keygate-title">Add your key to run agents</div>
        <div className="keygate-body">The lab needs an Anthropic API key (or a LiteLLM proxy in front of Anthropic). It stays in this process; agents only ever see a per-run token. Published results replay without a key.</div>
      </div>
      <a className="btn btn-signal btn-md" href={href("/settings")}><span>Open settings</span></a>
    </div>
  );
}

export function Settings() {
  const app = useApp();
  const u = app.upstream;
  const [provider, setProvider] = useState<"anthropic" | "litellm">("anthropic");
  const [key, setKey] = useState("");
  const [base, setBase] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (!u) return;
    setProvider(u.provider);
    setBase(u.base_url);
    setModel(u.model);
  }, [u]);

  const save = async () => {
    setBusy("save");
    setResult(null);
    try {
      await api.saveConfig({ provider, api_key: key, base_url: provider === "anthropic" ? "https://api.anthropic.com" : base, model });
      await app.refreshConfig();
      setKey("");
      setResult({ ok: true, message: "Saved." });
    } catch (e) {
      setResult({ ok: false, message: String((e as Error).message) });
    } finally {
      setBusy(null);
    }
  };
  const test = async () => {
    setBusy("test");
    setResult(null);
    try {
      setResult(await api.testConfig());
    } catch (e) {
      setResult({ ok: false, message: String((e as Error).message) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page page-narrow">
      <header className="page-head">
        <Kicker>Settings</Kicker>
        <h1 className="display">Where model traffic goes</h1>
        <p className="lede">Every framework talks to the lab's local metering proxy with a per-agent token. The proxy forwards to Anthropic — directly, or through a LiteLLM proxy — with the key you set here.</p>
      </header>
      <div className="settings-status">
        {u?.configured ? (
          <><Chip tone="green"><I.check size={11} /> configured</Chip><span className="faint small">{u.provider} · key <span className="mono">{u.api_key}</span> · from {u.source}</span></>
        ) : (
          <><Chip tone="ochre">not configured</Chip><span className="faint small">Add a key below. Published results replay without one.</span></>
        )}
      </div>
      <div className="settings-form">
        <div className="field">
          <span className="field-label">Provider</span>
          <Segmented label="Provider" value={provider} onChange={setProvider}
            options={[{ value: "anthropic", label: "Anthropic API" }, { value: "litellm", label: "LiteLLM proxy" }]} />
        </div>
        {provider === "litellm" && (
          <label className="field">
            <span className="field-label">Proxy base URL</span>
            <input className="input mono" value={base} onChange={(e) => setBase(e.target.value)} placeholder="https://your-litellm.example.com" />
            <span className="field-hint">Its Anthropic-compatible <span className="mono">/v1/messages</span> endpoint is used.</span>
          </label>
        )}
        <label className="field">
          <span className="field-label">{provider === "anthropic" ? "Anthropic API key" : "LiteLLM key"}</span>
          <input className="input mono" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={u?.configured ? `${u.api_key} (leave blank to keep)` : provider === "anthropic" ? "sk-ant-…" : "sk-…"} />
          <span className="field-hint">Saved to <span className="mono">.lab/config.json</span> (mode 600) on this machine.</span>
        </label>
        <label className="field">
          <span className="field-label">Default model</span>
          <select className="input" value={model} onChange={(e) => setModel(e.target.value)}>
            {app.models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <div className="settings-actions">
          <Button variant="signal" onClick={save} busy={busy === "save"}>Save</Button>
          <Button onClick={test} busy={busy === "test"} disabled={!u?.configured}>Test connection</Button>
        </div>
        {result && <div className={`callout ${result.ok ? "callout-green" : "callout-red"}`}>{result.ok ? <I.check size={14} /> : <I.warn size={14} />} {result.message}</div>}
      </div>
    </div>
  );
}
