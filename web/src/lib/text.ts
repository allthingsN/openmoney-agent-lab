import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import ini from "highlight.js/lib/languages/ini";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import typescript from "highlight.js/lib/languages/typescript";
import yaml from "highlight.js/lib/languages/yaml";
import { Marked } from "marked";

hljs.registerLanguage("python", python);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("ini", ini);

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function langFor(path: string): string | null {
  const p = path.toLowerCase();
  if (p.endsWith(".py")) return "python";
  if (p.endsWith(".ts") || p.endsWith(".tsx") || p.endsWith(".js") || p.endsWith(".mjs")) return "typescript";
  if (p.endsWith(".json")) return "json";
  if (p.endsWith(".md")) return "markdown";
  if (p.endsWith(".sh") || p.endsWith(".env.example") || p.endsWith(".gitignore")) return "bash";
  if (p.endsWith(".yaml") || p.endsWith(".yml")) return "yaml";
  if (p.endsWith(".toml") || p.endsWith(".ini") || p.endsWith(".cfg")) return "ini";
  return null;
}

export function highlight(code: string, lang: string | null): string {
  if (!lang || !hljs.getLanguage(lang) || code.length > 250_000) return escapeHtml(code);
  try {
    return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(code);
  }
}

// Agent-written markdown is untrusted: raw HTML is shown as text, links can't run script.
const md = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
    link({ href, title, tokens }) {
      const safe = /^(https?:|mailto:|#|\/)/i.test(href ?? "") ? href : "#";
      const inner = this.parser.parseInline(tokens);
      return `<a href="${escapeHtml(safe ?? "#")}"${title ? ` title="${escapeHtml(title)}"` : ""} target="_blank" rel="noreferrer noopener">${inner}</a>`;
    },
    image({ text }) {
      return `<span class="md-img">[image: ${escapeHtml(text || "")}]</span>`;
    },
    code({ text, lang }) {
      const l = lang && hljs.getLanguage(lang) ? lang : null;
      return `<pre class="code"><code>${highlight(text, l)}</code></pre>`;
    },
  },
});

export function renderMarkdown(src: string): string {
  try {
    return md.parse(src, { async: false }) as string;
  } catch {
    return `<pre>${escapeHtml(src)}</pre>`;
  }
}

// --------------------------------------------------------------------------------------------- iCalendar
export interface IcsEvent {
  summary: string;
  start: Date | null;
  end: Date | null;
  allDay: boolean;
  location?: string;
  description?: string;
}

function parseIcsDate(v: string): { d: Date | null; allDay: boolean } {
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/);
  if (!m) return { d: null, allDay: false };
  const [, y, mo, da, h, mi, se, z] = m;
  if (!h) return { d: new Date(+y, +mo - 1, +da), allDay: true };
  const d = z ? new Date(Date.UTC(+y, +mo - 1, +da, +h, +mi, +(se || 0))) : new Date(+y, +mo - 1, +da, +h, +mi, +(se || 0));
  return { d, allDay: false };
}

export function parseIcs(src: string): IcsEvent[] {
  const lines = src.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const out: IcsEvent[] = [];
  let cur: IcsEvent | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "BEGIN:VEVENT") cur = { summary: "", start: null, end: null, allDay: false };
    else if (line === "END:VEVENT" && cur) {
      out.push(cur);
      cur = null;
    } else if (cur) {
      const i = line.indexOf(":");
      if (i < 0) continue;
      const key = line.slice(0, i).split(";")[0].toUpperCase();
      const val = line.slice(i + 1).replace(/\\n/g, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";");
      if (key === "SUMMARY") cur.summary = val;
      else if (key === "DTSTART") {
        const p = parseIcsDate(val);
        cur.start = p.d;
        cur.allDay = p.allDay;
      } else if (key === "DTEND") cur.end = parseIcsDate(val).d;
      else if (key === "LOCATION") cur.location = val;
      else if (key === "DESCRIPTION") cur.description = val;
    }
  }
  return out.sort((a, b) => (a.start?.getTime() ?? 0) - (b.start?.getTime() ?? 0));
}
