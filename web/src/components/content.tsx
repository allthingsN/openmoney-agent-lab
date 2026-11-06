import { memo, useMemo, useState, type ReactNode } from "react";
import { highlight, langFor, parseIcs, renderMarkdown } from "../lib/text";
import { I } from "./icons";
import { CopyButton, Segmented } from "./ui";

// --------------------------------------------------------------------------------------------- code
export function CodeView({ code, lang, path, maxHeight, wrap }: { code: string; lang?: string | null; path?: string; maxHeight?: number | string; wrap?: boolean }) {
  const l = lang ?? (path ? langFor(path) : null);
  const html = useMemo(() => highlight(code, l), [code, l]);
  const lines = useMemo(() => code.split("\n").length, [code]);
  return (
    <div className={`codeview ${wrap ? "is-wrap" : ""}`} style={{ maxHeight }}>
      <div className="codeview-gutter" aria-hidden>
        {Array.from({ length: Math.min(lines, 5000) }, (_, i) => <span key={i}>{i + 1}</span>)}
      </div>
      <pre className="codeview-pre"><code className="hljs" dangerouslySetInnerHTML={{ __html: html }} /></pre>
    </div>
  );
}

export function Markdown({ src, className = "" }: { src: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(src), [src]);
  return <div className={`md ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

// --------------------------------------------------------------------------------------------- JSON
function contains(v: unknown, q: string, memo: WeakMap<object, boolean>): boolean {
  if (!q) return false;
  if (v === null || typeof v !== "object") return String(v).toLowerCase().includes(q);
  const hit = memo.get(v as object);
  if (hit !== undefined) return hit;
  let r = false;
  if (Array.isArray(v)) r = v.some((x) => contains(x, q, memo));
  else for (const [k, x] of Object.entries(v as object)) if (k.toLowerCase().includes(q) || contains(x, q, memo)) { r = true; break; }
  memo.set(v as object, r);
  return r;
}

function Mark({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const out: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < text.length) {
    const j = lower.indexOf(q, i);
    if (j < 0) { out.push(text.slice(i)); break; }
    if (j > i) out.push(text.slice(i, j));
    out.push(<mark key={k++}>{text.slice(j, j + q.length)}</mark>);
    i = j + q.length;
  }
  return <>{out}</>;
}

function StrVal({ s, q }: { s: string; q: string }) {
  const [open, setOpen] = useState(false);
  const long = s.length > 600;
  const shown = long && !open && !(q && s.toLowerCase().includes(q)) ? s.slice(0, 600) : s;
  return (
    <span className="j-str">
      "<Mark text={shown} q={q} />{shown.length < s.length && "…"}"
      {long && (
        <button className="j-more" onClick={() => setOpen(!open)}>{open ? "less" : `+${(s.length - 600).toLocaleString()} chars`}</button>
      )}
    </span>
  );
}

const JNode = memo(function JNode({ k, v, depth, q, memo, defaultDepth }: { k?: string; v: unknown; depth: number; q: string; memo: WeakMap<object, boolean>; defaultDepth: number }) {
  const isObj = v !== null && typeof v === "object";
  const [open, setOpen] = useState<boolean | null>(null);
  const auto = q ? contains(v, q, memo) : depth < defaultDepth;
  const expanded = open ?? auto;
  const key = k !== undefined ? <span className="j-key"><Mark text={k} q={q} /></span> : null;
  if (!isObj) {
    let val: ReactNode;
    if (typeof v === "string") val = <StrVal s={v} q={q} />;
    else if (typeof v === "number") val = <span className="j-num"><Mark text={String(v)} q={q} /></span>;
    else if (typeof v === "boolean") val = <span className="j-bool">{String(v)}</span>;
    else val = <span className="j-null">null</span>;
    return <div className="j-row">{key}{key && <span className="j-colon">: </span>}{val}</div>;
  }
  const entries: Array<[string, unknown]> = Array.isArray(v) ? v.map((x, i) => [String(i), x]) : Object.entries(v as object);
  const br = Array.isArray(v) ? ["[", "]"] : ["{", "}"];
  return (
    <div className="j-node">
      <button className="j-toggle" onClick={() => setOpen(!expanded)} aria-expanded={expanded}>
        <span className={`j-caret ${expanded ? "is-open" : ""}`}><I.chevron size={10} /></span>
        {key}{key && <span className="j-colon">: </span>}
        <span className="j-br">{br[0]}</span>
        {!expanded && <span className="j-summary">{entries.length} {Array.isArray(v) ? "items" : "keys"}</span>}
        {!expanded && <span className="j-br">{br[1]}</span>}
      </button>
      {expanded && (
        <div className="j-children">
          {entries.slice(0, 2000).map(([ck, cv]) => (
            <JNode key={ck} k={Array.isArray(v) ? undefined : ck} v={cv} depth={depth + 1} q={q} memo={memo} defaultDepth={defaultDepth} />
          ))}
          {entries.length > 2000 && <div className="j-row j-null">… {entries.length - 2000} more</div>}
        </div>
      )}
      {expanded && <span className="j-br">{br[1]}</span>}
    </div>
  );
});

export function JsonView({ value, defaultDepth = 2, maxHeight, title }: { value: unknown; defaultDepth?: number; maxHeight?: number | string; title?: ReactNode }) {
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<"tree" | "raw">("tree");
  const ql = q.trim().toLowerCase();
  const memo = useMemo(() => new WeakMap<object, boolean>(), [value, ql]); // eslint-disable-line react-hooks/exhaustive-deps
  const raw = useMemo(() => (mode === "raw" ? JSON.stringify(value, null, 2) : ""), [value, mode]);
  const hits = useMemo(() => {
    if (!ql) return 0;
    const s = JSON.stringify(value)?.toLowerCase() ?? "";
    let n = 0, i = 0;
    while ((i = s.indexOf(ql, i)) >= 0 && n < 9999) { n++; i += ql.length; }
    return n;
  }, [value, ql]);
  return (
    <div className="jsonview">
      <div className="jsonview-bar">
        {title && <div className="jsonview-title">{title}</div>}
        <label className="search">
          <I.search size={13} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search keys and values" aria-label="Search JSON" />
          {ql && <span className="search-count">{hits}</span>}
        </label>
        <Segmented label="View" value={mode} onChange={setMode} options={[{ value: "tree", label: "Tree" }, { value: "raw", label: "Raw" }]} />
        <CopyButton text={JSON.stringify(value, null, 2)} />
      </div>
      <div className="jsonview-body" style={{ maxHeight }}>
        {mode === "tree" ? <JNode v={value} depth={0} q={ql} memo={memo} defaultDepth={defaultDepth} /> : <CodeView code={raw} lang="json" />}
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------------------------- file tree
interface TreeNode { name: string; path: string; children?: TreeNode[] }

function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", children: [] };
  for (const p of paths) {
    const parts = p.split("/");
    let cur = root;
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join("/");
      if (i === parts.length - 1) cur.children!.push({ name: part, path });
      else {
        let next = cur.children!.find((c) => c.children && c.name === part);
        if (!next) { next = { name: part, path, children: [] }; cur.children!.push(next); }
        cur = next;
      }
    });
  }
  const sort = (n: TreeNode) => {
    n.children?.sort((a, b) => (a.children ? 0 : 1) - (b.children ? 0 : 1) || a.name.localeCompare(b.name));
    n.children?.forEach(sort);
  };
  sort(root);
  return root.children!;
}

export function FileTree({ paths, selected, onSelect, defaultOpen }: { paths: string[]; selected?: string; onSelect: (p: string) => void; defaultOpen?: (dir: string) => boolean }) {
  const tree = useMemo(() => buildTree(paths), [paths]);
  return <ul className="filetree" role="tree">{tree.map((n) => <TreeItem key={n.path} n={n} depth={0} selected={selected} onSelect={onSelect} defaultOpen={defaultOpen} />)}</ul>;
}

function TreeItem({ n, depth, selected, onSelect, defaultOpen }: { n: TreeNode; depth: number; selected?: string; onSelect: (p: string) => void; defaultOpen?: (dir: string) => boolean }) {
  const [open, setOpen] = useState(() => (defaultOpen ? defaultOpen(n.path) : depth < 1) || (selected ?? "").startsWith(n.path + "/"));
  if (n.children) {
    return (
      <li role="treeitem" aria-expanded={open}>
        <button className="ft-row ft-dir" style={{ paddingLeft: 8 + depth * 14 }} onClick={() => setOpen(!open)}>
          <span className={`j-caret ${open ? "is-open" : ""}`}><I.chevron size={10} /></span>
          <I.folder size={13} /> <span>{n.name}</span>
        </button>
        {open && <ul role="group">{n.children.map((c) => <TreeItem key={c.path} n={c} depth={depth + 1} selected={selected} onSelect={onSelect} defaultOpen={defaultOpen} />)}</ul>}
      </li>
    );
  }
  return (
    <li role="treeitem" aria-selected={selected === n.path}>
      <button className={`ft-row ${selected === n.path ? "is-on" : ""}`} style={{ paddingLeft: 22 + depth * 14 }} onClick={() => onSelect(n.path)}>
        <I.file size={13} /> <span>{n.name}</span>
      </button>
    </li>
  );
}

// --------------------------------------------------------------------------------------------- calendar (.ics)
export function IcsCalendar({ src }: { src: string }) {
  const evs = useMemo(() => parseIcs(src), [src]);
  if (!evs.length) return <CodeView code={src} lang="ini" />;
  const days = new Map<string, typeof evs>();
  for (const e of evs) {
    const k = e.start ? e.start.toDateString() : "Undated";
    days.set(k, [...(days.get(k) ?? []), e]);
  }
  const first = evs.find((e) => e.start)?.start;
  // a compact week strip around the events, plus an agenda
  const start = first ? new Date(first.getFullYear(), first.getMonth(), first.getDate() - first.getDay()) : null;
  const last = [...evs].reverse().find((e) => e.start)?.start;
  const weeks = start && last ? Math.min(6, Math.ceil(((last.getTime() - start.getTime()) / 86400000 + 1) / 7)) : 0;
  return (
    <div className="ics">
      {start && (
        <div className="ics-grid" role="grid" aria-label="Calendar">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="ics-dow">{d}</div>)}
          {Array.from({ length: weeks * 7 }, (_, i) => {
            const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
            const list = days.get(day.toDateString()) ?? [];
            return (
              <div key={i} className={`ics-cell ${list.length ? "has-ev" : ""}`} role="gridcell">
                <div className="ics-date">{day.getDate() === 1 || i === 0 ? day.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : day.getDate()}</div>
                {list.slice(0, 3).map((e, j) => <div key={j} className="ics-ev" title={e.summary}>{e.summary}</div>)}
                {list.length > 3 && <div className="ics-more">+{list.length - 3}</div>}
              </div>
            );
          })}
        </div>
      )}
      <ol className="ics-agenda">
        {evs.map((e, i) => (
          <li key={i}>
            <div className="ics-when">
              {e.start ? e.start.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "—"}
              {e.start && !e.allDay && <span> · {e.start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>}
              {e.allDay && <span> · all day</span>}
            </div>
            <div className="ics-what">{e.summary}</div>
            {e.location && <div className="ics-where">{e.location}</div>}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Render any outbox file sensibly by its extension. */
export function FilePreview({ path, content }: { path: string; content: string }) {
  const p = path.toLowerCase();
  const [mode, setMode] = useState<"pretty" | "source">("pretty");
  const pretty = p.endsWith(".md") || p.endsWith(".ics");
  return (
    <div className="filepreview">
      <div className="filepreview-bar">
        <span className="mono filepreview-path">{path}</span>
        <span className="spacer" />
        {pretty && <Segmented label="View" value={mode} onChange={setMode} options={[{ value: "pretty", label: p.endsWith(".ics") ? "Calendar" : "Rendered" }, { value: "source", label: "Source" }]} />}
        <CopyButton text={content} />
      </div>
      {pretty && mode === "pretty" ? (
        p.endsWith(".md") ? <Markdown src={content} className="paper" /> : <IcsCalendar src={content} />
      ) : (
        <CodeView code={content} path={path} wrap />
      )}
    </div>
  );
}
