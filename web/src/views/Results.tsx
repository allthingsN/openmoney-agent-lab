import { useEffect, useState } from "react";
import { api } from "../api";
import { I } from "../components/icons";
import { Empty, Glyph, Kicker, Spinner } from "../components/ui";
import { useApp } from "../lib/app";
import { ago, usd } from "../lib/format";
import { go, href, useRoute } from "../lib/router";
import type { PublishedIndexRow } from "../types";
import { RunView } from "./RunView";

export function Results() {
  const app = useApp();
  const [rows, setRows] = useState<PublishedIndexRow[] | null>(null);
  useEffect(() => {
    api.results().then((r) => setRows(r.benchmarks ?? [])).catch(() => setRows([]));
  }, []);
  return (
    <div className="page">
      <header className="page-head">
        <Kicker>Published results</Kicker>
        <h1 className="display">Runs anyone can replay</h1>
        <p className="lede">Benchmarks committed to the repo with their full event logs and model-call bodies. Replay one at real speed — no key needed — and open any call to see exactly what each framework sent.</p>
      </header>
      {!rows ? <Spinner /> : rows.length === 0 ? (
        <Empty title="Nothing published yet" action={<a className="btn btn-ghost btn-md" href={href("/runs")}><span>See local runs</span></a>}>
          Publish a run with <span className="mono">agent-lab bench --task bill-doctor --frameworks all --publish</span>; it lands in <span className="mono">results/</span> and shows up here.
        </Empty>
      ) : (
        <ol className="results-list">
          {rows.map((r, i) => {
            const board: any[] = Array.isArray(r.leaderboard) ? r.leaderboard : [];
            const agents = r.agents ?? [];
            const fws: string[] = board.length ? board.map((l) => l.framework) : r.frameworks ?? [...new Set(agents.map((a) => a.framework))];
            const scores = board.length
              ? board.map((l) => ({ fw: l.framework, score: l.score_mean as number | null, label: `${l.name}: mean ${Math.round(l.score_mean)} · pass ${Math.round((l.pass_rate ?? 0) * 100)}%` }))
              : agents.map((a) => ({ fw: a.framework, score: a.score, label: a.label }));
            const cost = r.cost_total ?? agents.reduce((s, a) => s + (a.metrics?.cost_usd ?? 0), 0);
            return (
              <li key={r.id}>
                <a className="result-card" href={href(`/results/${r.id}`)}>
                  <span className="mono faint">{(i + 1).toString().padStart(2, "0")}</span>
                  <span className="result-main">
                    <span className="kicker kicker-soft">{r.kind === "mission" ? "Mission" : "Arena"} · {r.model}{r.date ? ` · ${r.date}` : ""}</span>
                    <span className="result-title">{r.title ?? r.id}</span>
                    <span className="faint small">{fws.length} framework{fws.length === 1 ? "" : "s"}{r.trials ? ` × ${r.trials} trial${r.trials === 1 ? "" : "s"}` : ""}{cost ? ` · ${usd(cost, 2)} total` : ""}{r.created ? ` · ${ago(r.created)}` : ""}</span>
                  </span>
                  <span className="result-fws">{fws.slice(0, 10).map((f) => <Glyph key={f} fw={f} size={22} />)}</span>
                  <span className="result-scores">
                    {scores.slice(0, 10).map((x, j) => (
                      <span key={j} className="mini-score" style={{ ["--lane" as any]: app.color(x.fw) }} title={x.label}>{x.score !== null && x.score !== undefined ? Math.round(x.score) : "—"}</span>
                    ))}
                  </span>
                  <span className="result-go"><I.replay size={14} /> Replay</span>
                </a>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export function ResultReplay({ id }: { id: string }) {
  const route = useRoute();
  const speed = Number(route.query.get("speed") ?? "16");
  return (
    <div className="page page-wide">
      <a className="back" href={href("/results")}>← Published results</a>
      <RunView src={{ type: "result", id, speed }} onSpeed={(n) => go(`/results/${id}?speed=${n}`)} />
    </div>
  );
}
