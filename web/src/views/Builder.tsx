import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { CodeView, FileTree } from "../components/content";
import { FrameworkGrid } from "../components/FrameworkPicker";
import { I, ServerIcon } from "../components/icons";
import { Button, CopyButton, Glyph, Kicker, SectionHead, Spinner, Toggle } from "../components/ui";
import { useApp } from "../lib/app";
import { serverColor } from "../lib/colors";
import { ago } from "../lib/format";
import { go, href } from "../lib/router";
import type { BuildSummary, BuildTree, CatalogEntry, CustomTool, Design } from "../types";
import { RunView } from "./RunView";
import { KeyGate } from "./Settings";

type Step = "describe" | "review" | "frameworks" | "code" | "test" | "publish";
const STEPS: Array<{ id: Step; label: string }> = [
  { id: "describe", label: "Describe" },
  { id: "review", label: "Review the design" },
  { id: "frameworks", label: "Pick frameworks" },
  { id: "code", label: "Read the code" },
  { id: "test", label: "Test run" },
  { id: "publish", label: "Publish" },
];

const EXAMPLES = [
  "I run a small bakery. Every Friday I export my week of sales as a CSV. I want an agent that tells me which items sold best and worst, flags days where sales dropped more than 20% vs the same weekday last week, and drafts next week's baking quantities with a 10% buffer, saved as a file I can print.",
  "Read the meeting transcripts I drop in inbox/, and write a one-page summary for each with decisions, owners and due dates, then a combined list of every open action item sorted by due date.",
  "Our household bills are a mess. Go through the PDFs-as-text in inbox/, find every subscription we pay for, flag duplicates and price increases, and draft cancellation emails for the ones we don't use.",
  "Watch the changelog pages of the five libraries we depend on (URLs in notes/deps.md) and write a weekly digest of breaking changes, with what we'd need to change in our code.",
];

const DESIGN_HINTS = [
  "Reading your description…",
  "Writing the agent's instructions…",
  "Choosing tools from the catalog…",
  "Writing custom tools for the deterministic parts…",
  "Writing skills with the expert procedure…",
  "Making sample files so you can try it right away…",
  "Deciding what a good result looks like…",
];

export function Builder({ slug }: { slug?: string }) {
  const app = useApp();
  const [step, setStep] = useState<Step>("describe");
  const [desc, setDesc] = useState("");
  const [design, setDesign] = useState<Design | null>(null);
  const [catalog, setCatalog] = useState<Record<string, CatalogEntry>>({});
  const [builds, setBuilds] = useState<BuildSummary[] | null>(null);
  const [fws, setFws] = useState<string[]>([]);
  const [tree, setTree] = useState<BuildTree | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [readCode, setReadCode] = useState(false);
  const [testRun, setTestRun] = useState<string | null>(null);
  const [designModel, setDesignModel] = useState("");

  useEffect(() => {
    api.builds().then((r) => { setBuilds(r.builds); setCatalog(r.catalog); }).catch(() => setBuilds([]));
  }, [tree]);
  useEffect(() => {
    if (!fws.length && app.frameworks.length) setFws(app.frameworks.filter((f) => f.installed).slice(0, 2).map((f) => f.id));
  }, [app.frameworks]); // eslint-disable-line react-hooks/exhaustive-deps

  // open an existing build
  useEffect(() => {
    if (!slug) {
      setTree(null);
      setDesign(null);
      setStep("describe");
      return;
    }
    setBusy("load");
    api.getBuild(slug).then((t) => {
      setTree(t);
      setDesign(t.design);
      setDesc(t.design.description ?? "");
      const built = Object.keys(t.files).filter((p) => p.startsWith("frameworks/")).map((p) => p.split("/")[1]);
      setFws([...new Set(built)]);
      setReadCode(true);
      setStep("code");
    }).catch((e) => setErr(String(e.message))).finally(() => setBusy(null));
  }, [slug]);

  useEffect(() => {
    if (busy !== "design") return;
    const t0 = Date.now();
    const id = window.setInterval(() => setElapsed((Date.now() - t0) / 1000), 250);
    return () => clearInterval(id);
  }, [busy]);

  const runDesign = async () => {
    setBusy("design");
    setErr(null);
    setElapsed(0);
    try {
      const r = await api.design(desc, designModel || undefined);
      setDesign(r.design);
      setReadCode(false);
      setStep("review");
    } catch (e) {
      setErr(String((e as Error).message));
    } finally {
      setBusy(null);
    }
  };

  const doBuild = async () => {
    if (!design) return;
    setBusy("build");
    setErr(null);
    try {
      const t = await api.build(design, fws);
      setTree(t);
      setStep("code");
      if (slug !== t.slug) window.history.replaceState(null, "", href(`/builder/${t.slug}`));
    } catch (e) {
      setErr(String((e as Error).message));
    } finally {
      setBusy(null);
    }
  };

  const hasCustom = (design?.custom_tools.length ?? 0) > 0;
  const problems = design?.custom_tools.flatMap((t) => (t.problems ?? []).map((p) => `${t.name}: ${p}`)) ?? [];
  const reachable = (s: Step): boolean => {
    if (s === "describe") return true;
    if (s === "review" || s === "frameworks") return !!design;
    return !!tree;
  };

  return (
    <div className="page builder">
      <header className="page-head">
        <Kicker>Agent Builder</Kicker>
        <h1 className="display">Describe the job. Get an agent on every framework.</h1>
        <p className="lede">Say what you want in plain English. Claude designs the agent — instructions, tools, skills, sample files and what success looks like. You review it, pick frameworks, and the lab writes a runnable project for each, then tests them side by side.</p>
      </header>
      <div className="builder-layout">
        <nav className="steps" aria-label="Builder steps">
          <ol>
            {STEPS.map((s, i) => (
              <li key={s.id}>
                <button className={`${step === s.id ? "is-on" : ""} ${reachable(s.id) ? "" : "is-locked"}`} disabled={!reachable(s.id)} onClick={() => setStep(s.id)} aria-current={step === s.id ? "step" : undefined}>
                  <span className="mono">{(i + 1).toString().padStart(2, "0")}</span>
                  <span>{s.label}</span>
                </button>
              </li>
            ))}
          </ol>
          {design && <div className="steps-agent"><Kicker tone="soft">Building</Kicker><div className="steps-agent-name">{design.name}</div><div className="faint small mono">{design.slug}</div></div>}
        </nav>
        <div className="builder-main">
          {err && <div className="callout callout-red"><I.warn size={14} /> <span>{err}</span></div>}
          {busy === "load" && <div className="lanes-wait"><Spinner /> Opening {slug}…</div>}

          {step === "describe" && busy !== "load" && (
            <section>
              <SectionHead n={1} kicker="Describe" title="What should your agent do?" />
              <div className={`describe ${busy === "design" ? "is-busy" : ""}`}>
                <textarea className="input describe-input" rows={7} value={desc} onChange={(e) => setDesc(e.target.value)}
                  placeholder="e.g. Every Monday, read the support tickets in inbox/, group them by root cause, and draft a short report for the team with the three things to fix first." aria-label="Describe the job" disabled={busy === "design"} />
                {busy === "design" && (
                  <div className="designing" role="status" aria-live="polite">
                    <span className="designing-pulse" aria-hidden />
                    <span>{DESIGN_HINTS[Math.min(DESIGN_HINTS.length - 1, Math.floor(elapsed / 9))]}</span>
                    <span className="mono faint">{Math.floor(elapsed)}s</span>
                  </div>
                )}
              </div>
              <div className="examples">
                <span className="kicker kicker-soft">Try one</span>
                {EXAMPLES.map((e, i) => <button key={i} className="example" onClick={() => setDesc(e)} disabled={busy === "design"}>{e.slice(0, 92)}…</button>)}
              </div>
              <div className="builder-cta">
                <KeyGate compact>
                  <Button variant="signal" size="lg" onClick={runDesign} busy={busy === "design"} disabled={desc.trim().length < 20} icon={<I.spark size={14} />}>Design my agent</Button>
                  <select className="input input-auto" value={designModel || app.upstream?.model || ""} onChange={(e) => setDesignModel(e.target.value)} aria-label="Model that designs the agent" disabled={busy === "design"}>
                    {app.models.map((m) => <option key={m}>{m}</option>)}
                  </select>
                  <span className="faint small">One model call; usually under a minute.</span>
                </KeyGate>
              </div>
              <PreviousBuilds builds={builds} />
            </section>
          )}

          {step === "review" && design && (
            <DesignEditor design={design} catalog={catalog} onChange={setDesign} readCode={readCode} setReadCode={setReadCode}
              onNext={() => setStep("frameworks")} problems={problems} />
          )}

          {step === "frameworks" && design && (
            <section>
              <SectionHead n={3} kicker="Frameworks" title="Build it on…">Every framework gets the identical agent: the same instructions, tools and skills, in that framework's own idiom — the same adapter the Arena measures.</SectionHead>
              <FrameworkGrid selected={fws} onChange={setFws} />
              <div className="builder-cta">
                {hasCustom && !readCode && <span className="callout callout-ochre small"><I.warn size={13} /> Confirm you've read the generated tool code in step 2 first.</span>}
                {problems.length > 0 && <span className="callout callout-red small"><I.warn size={13} /> Fix the flagged tool code first ({problems.length}).</span>}
                <Button variant="signal" size="lg" onClick={doBuild} busy={busy === "build"} disabled={!fws.length || (hasCustom && !readCode) || problems.length > 0} icon={<I.code size={14} />}>
                  Generate {fws.length} project{fws.length === 1 ? "" : "s"}
                </Button>
              </div>
            </section>
          )}

          {step === "code" && tree && <CodeStep tree={tree} onNext={() => setStep("test")} />}

          {step === "test" && tree && design && (
            <TestStep slug={tree.slug} design={design} built={fws} runId={testRun} onRun={setTestRun} onNext={() => setStep("publish")} />
          )}

          {step === "publish" && tree && <PublishStep tree={tree} />}
        </div>
      </div>
    </div>
  );
}

function PreviousBuilds({ builds }: { builds: BuildSummary[] | null }) {
  if (!builds) return null;
  if (!builds.length) return null;
  return (
    <div className="prev-builds">
      <SectionHead kicker="Your agents" title="Previous builds" />
      <ol className="build-list">
        {builds.map((b, i) => (
          <li key={b.slug}>
            <a href={href(`/builder/${b.slug}`)} className="build-row">
              <span className="mono faint">{(i + 1).toString().padStart(2, "0")}</span>
              <span className="build-row-main">
                <span className="build-row-name">{b.name}</span>
                <span className="faint small">{b.summary}</span>
              </span>
              <span className="build-row-fws">{b.frameworks.map((f) => <Glyph key={f} fw={f} size={20} />)}</span>
              <span className="faint small">{ago(b.modified)}</span>
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}

// --------------------------------------------------------------------------------------------- review
function DesignEditor({ design, catalog, onChange, readCode, setReadCode, onNext, problems }: {
  design: Design; catalog: Record<string, CatalogEntry>; onChange: (d: Design) => void; readCode: boolean; setReadCode: (v: boolean) => void; onNext: () => void; problems: string[];
}) {
  const [checking, setChecking] = useState(false);
  const timer = useRef<number>();
  const set = <K extends keyof Design>(k: K, v: Design[K]) => onChange({ ...design, [k]: v });
  const codeSig = design.custom_tools.map((t) => t.code + t.name).join("\u0000");
  // re-run the server's static checks when tool code changes
  useEffect(() => {
    if (!design.custom_tools.length) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      setChecking(true);
      try {
        const r = await api.check(design);
        onChange({ ...design, custom_tools: design.custom_tools.map((t, i) => ({ ...t, problems: r.design.custom_tools[i]?.problems ?? [] })) });
      } catch {
        /* keep the old flags */
      } finally {
        setChecking(false);
      }
    }, 700);
    return () => window.clearTimeout(timer.current);
  }, [codeSig]); // eslint-disable-line react-hooks/exhaustive-deps

  const setTool = (i: number, t: CustomTool) => set("custom_tools", design.custom_tools.map((x, j) => (j === i ? t : x)));
  return (
    <section className="design">
      <SectionHead n={2} kicker="Review" title="The design — edit anything">Nothing runs until you build and test it. Read the generated tool code; it's the only code here the lab didn't write.</SectionHead>

      <div className="dform">
        <div className="dgroup">
          <Kicker n="A" tone="soft">Identity</Kicker>
          <div className="dgrid-2">
            <label className="field"><span className="field-label">Name</span><input className="input" value={design.name} onChange={(e) => set("name", e.target.value)} /></label>
            <label className="field"><span className="field-label">Folder</span><input className="input mono" value={design.slug} onChange={(e) => set("slug", e.target.value)} /></label>
          </div>
          <label className="field"><span className="field-label">Summary</span><input className="input" value={design.summary} onChange={(e) => set("summary", e.target.value)} /></label>
        </div>

        <div className="dgroup">
          <Kicker n="B" tone="soft">Instructions</Kicker>
          <label className="field"><span className="field-label">System prompt</span><textarea className="input mono-ish" rows={9} value={design.system_prompt} onChange={(e) => set("system_prompt", e.target.value)} /></label>
          <label className="field"><span className="field-label">Sample request</span><textarea className="input" rows={3} value={design.sample_prompt} onChange={(e) => set("sample_prompt", e.target.value)} /></label>
        </div>

        <div className="dgroup">
          <Kicker n="C" tone="soft">Tools from the catalog</Kicker>
          <div className="catalog">
            {Object.entries(catalog).map(([k, c]) => {
              const on = design.catalog_tools.includes(k);
              const locked = k === "files";
              return (
                <label key={k} className={`cat-card ${on ? "is-on" : ""}`} style={{ ["--srv" as any]: serverColor(k) }}>
                  <input type="checkbox" checked={on} disabled={locked} onChange={(e) => set("catalog_tools", e.target.checked ? [...design.catalog_tools, k] : design.catalog_tools.filter((x) => x !== k))} />
                  <span className="cat-icon"><ServerIcon server={k} size={16} /></span>
                  <span className="cat-text">
                    <span className="cat-title">{c.title}{locked && <span className="faint small"> · always on</span>}</span>
                    <span className="cat-desc">{c.description}</span>
                    <span className="cat-tools mono">{c.tools.join(" · ")}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="dgroup">
          <div className="dgroup-head">
            <Kicker n="D" tone="soft">Custom tools · generated code</Kicker>
            {checking && <span className="faint small"><span className="spinner" /> checking</span>}
            <Button size="sm" variant="quiet" icon={<I.plus size={12} />} onClick={() => set("custom_tools", [...design.custom_tools, { name: "new_tool", description: "", parameters: [], code: "return 'ok'" }])}>Add tool</Button>
          </div>
          {design.custom_tools.length === 0 && <p className="faint">None — the catalog tools cover this job.</p>}
          {design.custom_tools.map((t, i) => <ToolEditor key={i} t={t} onChange={(nt) => setTool(i, nt)} onRemove={() => set("custom_tools", design.custom_tools.filter((_, j) => j !== i))} />)}
        </div>

        <div className="dgroup">
          <div className="dgroup-head">
            <Kicker n="E" tone="soft">Skills</Kicker>
            <Button size="sm" variant="quiet" icon={<I.plus size={12} />} onClick={() => set("skills", [...design.skills, { name: "new-skill", description: "", body: "" }])}>Add skill</Button>
          </div>
          {design.skills.map((s, i) => (
            <div key={i} className="ditem">
              <div className="dgrid-2">
                <label className="field"><span className="field-label">Name</span><input className="input mono" value={s.name} onChange={(e) => set("skills", design.skills.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /></label>
                <label className="field"><span className="field-label">When to use it</span><input className="input" value={s.description} onChange={(e) => set("skills", design.skills.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} /></label>
              </div>
              <label className="field"><span className="field-label">SKILL.md body</span><textarea className="input mono-ish" rows={7} value={s.body} onChange={(e) => set("skills", design.skills.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)))} /></label>
              <button className="linkish small danger-text" onClick={() => set("skills", design.skills.filter((_, j) => j !== i))}><I.trash size={12} /> remove skill</button>
            </div>
          ))}
        </div>

        <div className="dgroup">
          <div className="dgroup-head">
            <Kicker n="F" tone="soft">Sample workspace files</Kicker>
            <Button size="sm" variant="quiet" icon={<I.plus size={12} />} onClick={() => set("workspace_files", [...design.workspace_files, { path: "inbox/new.txt", content: "" }])}>Add file</Button>
          </div>
          {design.workspace_files.map((f, i) => (
            <details key={i} className="ditem ditem-file">
              <summary><I.file size={12} /> <span className="mono">{f.path}</span> <span className="faint small">{f.content.length.toLocaleString()} chars</span></summary>
              <label className="field"><span className="field-label">Path</span><input className="input mono" value={f.path} onChange={(e) => set("workspace_files", design.workspace_files.map((x, j) => (j === i ? { ...x, path: e.target.value } : x)))} /></label>
              <label className="field"><span className="field-label">Content</span><textarea className="input mono" rows={8} value={f.content} onChange={(e) => set("workspace_files", design.workspace_files.map((x, j) => (j === i ? { ...x, content: e.target.value } : x)))} /></label>
              <button className="linkish small danger-text" onClick={() => set("workspace_files", design.workspace_files.filter((_, j) => j !== i))}><I.trash size={12} /> remove file</button>
            </details>
          ))}
        </div>

        <div className="dgroup">
          <div className="dgroup-head">
            <Kicker n="G" tone="soft">Success criteria · the judge checks these</Kicker>
            <Button size="sm" variant="quiet" icon={<I.plus size={12} />} onClick={() => set("success_criteria", [...design.success_criteria, ""])}>Add</Button>
          </div>
          <ol className="criteria-edit">
            {design.success_criteria.map((c, i) => (
              <li key={i}>
                <span className="mono faint">{(i + 1).toString().padStart(2, "0")}</span>
                <textarea className="input" rows={2} value={c} onChange={(e) => set("success_criteria", design.success_criteria.map((x, j) => (j === i ? e.target.value : x)))} />
                <button className="icon-btn" aria-label="Remove criterion" onClick={() => set("success_criteria", design.success_criteria.filter((_, j) => j !== i))}><I.trash size={13} /></button>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="builder-cta">
        {design.custom_tools.length > 0 && (
          <label className="readcode">
            <input type="checkbox" checked={readCode} onChange={(e) => setReadCode(e.target.checked)} />
            <span>I've read the generated tool code and I'm OK running it on my machine.</span>
          </label>
        )}
        {problems.length > 0 && <div className="callout callout-red small"><I.warn size={13} /> {problems.length} problem{problems.length > 1 ? "s" : ""} in tool code: {problems.slice(0, 2).join("; ")}</div>}
        <Button variant="signal" size="lg" onClick={onNext} icon={<I.arrow size={14} />}>Next: pick frameworks</Button>
      </div>
    </section>
  );
}

function ToolEditor({ t, onChange, onRemove }: { t: CustomTool; onChange: (t: CustomTool) => void; onRemove: () => void }) {
  const [edit, setEdit] = useState(false);
  const probs = t.problems ?? [];
  return (
    <div className={`ditem tool-ed ${probs.length ? "has-problems" : ""}`}>
      <div className="dgrid-2">
        <label className="field"><span className="field-label">Tool name</span><input className="input mono" value={t.name} onChange={(e) => onChange({ ...t, name: e.target.value })} /></label>
        <label className="field"><span className="field-label">Description the model sees</span><input className="input" value={t.description} onChange={(e) => onChange({ ...t, description: e.target.value })} /></label>
      </div>
      <div className="params">
        <span className="field-label">Parameters</span>
        <table className="ptable">
          <tbody>
            {t.parameters.map((p, i) => (
              <tr key={i}>
                <td><input className="input input-sm mono" value={p.name} aria-label="Parameter name" onChange={(e) => onChange({ ...t, parameters: t.parameters.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} /></td>
                <td>
                  <select className="input input-sm" value={p.type} aria-label="Type" onChange={(e) => onChange({ ...t, parameters: t.parameters.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)) })}>
                    {["string", "integer", "number", "boolean"].map((x) => <option key={x}>{x}</option>)}
                  </select>
                </td>
                <td className="ptable-desc"><input className="input input-sm" value={p.description ?? ""} aria-label="Description" onChange={(e) => onChange({ ...t, parameters: t.parameters.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)) })} /></td>
                <td><label className="small"><input type="checkbox" checked={p.required !== false} onChange={(e) => onChange({ ...t, parameters: t.parameters.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)) })} /> req</label></td>
                <td><button className="icon-btn" aria-label="Remove parameter" onClick={() => onChange({ ...t, parameters: t.parameters.filter((_, j) => j !== i) })}><I.x size={12} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="linkish small" onClick={() => onChange({ ...t, parameters: [...t.parameters, { name: "arg", type: "string", description: "", required: true }] })}><I.plus size={11} /> parameter</button>
      </div>
      <div className="field">
        <div className="field-row">
          <span className="field-label">Python body (standard library only; <span className="mono">WORKSPACE</span> is the workspace folder)</span>
          <span className="spacer" />
          <button className="linkish small" onClick={() => setEdit(!edit)}>{edit ? "Done editing" : "Edit code"}</button>
        </div>
        {edit ? (
          <textarea className="input mono code-input" rows={Math.min(30, t.code.split("\n").length + 2)} value={t.code} spellCheck={false} onChange={(e) => onChange({ ...t, code: e.target.value })} />
        ) : (
          <CodeView code={t.code} lang="python" maxHeight={380} />
        )}
      </div>
      {probs.length > 0 ? (
        <ul className="problems">{probs.map((p, i) => <li key={i}><I.warn size={12} /> {p}</li>)}</ul>
      ) : <div className="ok-line small"><I.shield size={12} /> Static checks pass: allowlisted imports only, no eval/exec/open/system calls.</div>}
      <button className="linkish small danger-text" onClick={onRemove}><I.trash size={12} /> remove tool</button>
    </div>
  );
}

// --------------------------------------------------------------------------------------------- code
// never show files that hold keys (a person may have created .env in the project folder to run it)
const SECRET = /(^|\/)\.env(\.(?!example$)[^/]*)?$/;

function CodeStep({ tree, onNext }: { tree: BuildTree; onNext: () => void }) {
  const paths = useMemo(() => Object.keys(tree.files).filter((p) => !SECRET.test(p)), [tree]);
  const hidden = Object.keys(tree.files).filter((p) => SECRET.test(p));
  const [sel, setSel] = useState<string>(() => paths.find((p) => p === "README.md") ?? paths[0]);
  const fwDirs = useMemo(() => [...new Set(paths.filter((p) => p.startsWith("frameworks/")).map((p) => p.split("/")[1]))], [paths]);
  return (
    <section>
      <SectionHead n={4} kicker="Code" title="Your project" aside={<div className="pathline"><span className="mono small"><bdi>{tree.path}</bdi></span><CopyButton text={tree.path} label="Copy path" /></div>}>
        {paths.length} files{hidden.length ? ` (${hidden.join(", ")} hidden — it holds a key)` : ""}. Each <span className="mono">frameworks/&lt;id&gt;/</span> folder is a complete agent; they share <span className="mono">servers/</span>, <span className="mono">skills/</span> and <span className="mono">agent.json</span>.
      </SectionHead>
      <div className="fw-jump">
        {fwDirs.map((f) => {
          const entry = paths.find((p) => p.startsWith(`frameworks/${f}/agent.`)) ?? paths.find((p) => p.startsWith(`frameworks/${f}/`));
          return <button key={f} className={`fw-jump-btn ${sel.startsWith(`frameworks/${f}/`) ? "is-on" : ""}`} onClick={() => entry && setSel(entry)}><Glyph fw={f} size={18} /> {f}</button>;
        })}
      </div>
      <div className="codebrowser">
        <div className="codebrowser-tree">
          <FileTree paths={paths} selected={sel} onSelect={setSel} defaultOpen={(d) => !d.includes("/") || d.startsWith("frameworks/") && d.split("/").length < 2} />
        </div>
        <div className="codebrowser-main">
          <div className="codebrowser-bar"><span className="mono small">{sel}</span><span className="spacer" /><CopyButton text={tree.files[sel] ?? ""} /></div>
          <CodeView code={tree.files[sel] ?? ""} path={sel} maxHeight="70vh" />
        </div>
      </div>
      <div className="builder-cta">
        <Button variant="signal" size="lg" onClick={onNext} icon={<I.play size={13} />}>Next: test them side by side</Button>
      </div>
    </section>
  );
}

// --------------------------------------------------------------------------------------------- test
function TestStep({ slug, design, built, runId, onRun, onNext }: { slug: string; design: Design; built: string[]; runId: string | null; onRun: (id: string) => void; onNext: () => void }) {
  const app = useApp();
  const [prompt, setPrompt] = useState(design.sample_prompt);
  const [sel, setSel] = useState<string[]>(built);
  const [model, setModel] = useState(app.upstream?.model ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const src = useMemo(() => (runId ? { type: "run" as const, id: runId } : null), [runId]);
  const start = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.createRun({ kind: "build", slug, frameworks: sel, prompt, model });
      onRun(r.id);
    } catch (e) {
      setErr(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section>
      <SectionHead n={5} kicker="Test" title="Run them side by side">Same live view as the Arena. A model judge scores each against your success criteria.</SectionHead>
      <div className="test-form">
        <label className="field"><span className="field-label">Request</span><textarea className="input" rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} /></label>
        <div className="test-row">
          <div className="fw-mini" role="group" aria-label="Frameworks to test">
            {built.map((f) => (
              <label key={f} className={`fw-mini-item ${sel.includes(f) ? "is-on" : ""}`}>
                <input type="checkbox" checked={sel.includes(f)} onChange={(e) => setSel(e.target.checked ? [...sel, f] : sel.filter((x) => x !== f))} />
                <Glyph fw={f} size={20} /> {app.fw(f)?.name ?? f}
              </label>
            ))}
          </div>
          <select className="input input-auto" value={model} onChange={(e) => setModel(e.target.value)} aria-label="Model">
            {app.models.map((m) => <option key={m}>{m}</option>)}
          </select>
          <KeyGate compact>
            <Button variant="signal" onClick={start} busy={busy} disabled={!sel.length || !prompt.trim()} icon={<I.play size={13} />}>{runId ? "Run again" : "Start test run"}</Button>
          </KeyGate>
        </div>
        {err && <div className="callout callout-red"><I.warn size={14} /> {err}</div>}
      </div>
      {src && (
        <div className="test-run">
          <div className="test-run-bar"><Kicker tone="soft">Test run</Kicker><a className="linkish small mono" href={href(`/run/${src.id}`)}>{src.id} <I.external size={11} /></a></div>
          <RunView src={src} embedded />
        </div>
      )}
      <div className="builder-cta">
        <Button variant={runId ? "signal" : "ghost"} size="lg" onClick={onNext} icon={<I.arrow size={14} />}>Next: publish</Button>
      </div>
    </section>
  );
}

// --------------------------------------------------------------------------------------------- publish
function PublishStep({ tree }: { tree: BuildTree }) {
  const [repo, setRepo] = useState(tree.slug);
  const [priv, setPriv] = useState(true);
  const safeRepo = /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)?$/.test(repo.trim()) ? repo.trim() : tree.slug;
  const commands = [
    `cd "${tree.path}"`,
    `git init -b main && git add -A && git commit -m "${tree.slug}: built with the OpenMoney Agent Lab"`,
    `gh repo create ${safeRepo} ${priv ? "--private" : "--public"} --source . --push`,
  ].join("\n");
  return (
    <section>
      <SectionHead n={6} kicker="Publish" title="Take it with you">The project runs anywhere with Python 3.11+ and uv: <span className="mono">cp .env.example .env</span>, add a key, <span className="mono">python3 run.py &lt;framework&gt;</span>.</SectionHead>
      <ol className="publish">
        <li>
          <span className="mono pub-n">01</span>
          <div className="pub-main">
            <div className="pub-title">Download a zip</div>
            <div className="faint small">Everything except virtualenvs, node_modules and any <span className="mono">.env</span> file.</div>
          </div>
          <a className="btn btn-signal btn-md" href={`/api/builder/${tree.slug}/zip`} download><I.download size={13} /><span>{tree.slug}.zip</span></a>
        </li>
        <li>
          <span className="mono pub-n">02</span>
          <div className="pub-main">
            <div className="pub-title">It's already on disk</div>
            <div className="mono small pub-path">{tree.path}</div>
          </div>
          <CopyButton text={tree.path} label="Copy path" />
        </li>
        <li>
          <span className="mono pub-n">03</span>
          <div className="pub-main">
            <div className="pub-title">Put it on GitHub</div>
            <div className="faint small">Run these in your own terminal (needs <span className="mono">git</span> and the <span className="mono">gh</span> CLI). The lab never runs commands for a web request. <span className="mono">.gitignore</span> already leaves out <span className="mono">.env</span>.</div>
            <div className="gh-form">
              <label className="field"><span className="field-label">Repository</span><input className="input mono" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/name or name" /></label>
              <Toggle checked={priv} onChange={setPriv} label="Private" />
            </div>
            <pre className="mono small pub-cmds">{commands}</pre>
            {!priv && <div className="callout callout-ochre small"><I.warn size={13} /> Public: anyone can see the code, the sample files and the agent's instructions.</div>}
          </div>
          <CopyButton text={commands} label="Copy commands" />
        </li>
      </ol>
      <div className="builder-cta">
        <a className="btn btn-ghost btn-md" href={href("/builder")} onClick={() => go("/builder")}><I.plus size={13} /><span>Build another agent</span></a>
        <span className="faint small">This build stays in the lab: open <a className="mono" href={href(`/builder/${tree.slug}`)}>#/builder/{tree.slug}</a> to test it again on other frameworks.</span>
      </div>
    </section>
  );
}
