import type { JSX } from "react";
import { useEffect, useState } from "react";
import { I } from "./components/icons";
import { IconButton } from "./components/ui";
import { AppProvider, useApp } from "./lib/app";
import { href, useRoute } from "./lib/router";
import { ArenaSetup } from "./views/Arena";
import { Builder } from "./views/Builder";
import { Home } from "./views/Home";
import { MissionSetup } from "./views/MissionSetup";
import { ResultReplay, Results } from "./views/Results";
import { Runs } from "./views/Runs";
import { RunView } from "./views/RunView";
import { Settings } from "./views/Settings";

const NAV = [
  { to: "/arena", label: "Arena", match: ["arena"] },
  { to: "/mission", label: "Mission Control", match: ["mission"] },
  { to: "/builder", label: "Builder", match: ["builder"] },
  { to: "/results", label: "Results", match: ["results"] },
  { to: "/runs", label: "Runs", match: ["runs", "run"] },
];

function Shell() {
  const app = useApp();
  const route = useRoute();
  const [menu, setMenu] = useState(false);
  const top = route.path[0] ?? "";
  useEffect(() => setMenu(false), [route.path.join("/")]);
  useEffect(() => {
    const titles: Record<string, string> = { arena: "Arena", mission: "Mission Control", builder: "Agent Builder", results: "Results", runs: "Runs", run: "Run", settings: "Settings" };
    document.title = titles[top] ? `${titles[top]} · OpenMoney Agent Lab` : "OpenMoney Agent Lab";
  }, [top]);

  let view: JSX.Element;
  switch (top) {
    case "arena": view = <ArenaSetup />; break;
    case "mission": view = <MissionSetup />; break;
    case "builder": view = <Builder slug={route.path[1]} />; break;
    case "results": view = route.path[1] ? <ResultReplay id={route.path[1]} /> : <Results />; break;
    case "runs": view = <Runs />; break;
    case "run": view = <div className="page page-wide"><a className="back" href={href("/runs")}>← Runs</a><RunView src={{ type: "run", id: route.path[1] }} /></div>; break;
    case "settings": view = <Settings />; break;
    default: view = <Home />;
  }

  return (
    <div className="app">
      <a className="skip" href="#main">Skip to content</a>
      <header className="topbar">
        <a className="brand" href={href("/")} aria-label="OpenMoney Agent Lab home">
          <img src={app.theme === "paper" ? "/mark-light.svg" : "/mark.svg"} width={26} height={26} alt="" />
          <span className="brand-name">OpenMoney <span className="brand-lab">Agent Lab</span></span>
        </a>
        <nav className={`nav ${menu ? "is-open" : ""}`} aria-label="Main">
          {NAV.map((n) => (
            <a key={n.to} href={href(n.to)} className={n.match.includes(top) ? "is-on" : ""} aria-current={n.match.includes(top) ? "page" : undefined}>{n.label}</a>
          ))}
          <a href={href("/settings")} className={`nav-settings ${top === "settings" ? "is-on" : ""}`}>
            <span className={`cfg-dot ${app.upstream?.configured ? "ok" : "no"}`} aria-hidden />
            {app.upstream?.configured ? "Settings" : "Add key"}
          </a>
        </nav>
        <div className="topbar-tools">
          <IconButton label={app.theme === "ink" ? "Switch to ledger paper (light)" : "Switch to ink (dark)"} onClick={() => app.setTheme(app.theme === "ink" ? "paper" : "ink")}>
            {app.theme === "ink" ? <I.sun size={15} /> : <I.moon size={15} />}
          </IconButton>
          <IconButton label="Menu" className="menu-btn" onClick={() => setMenu(!menu)} aria-expanded={menu}><I.menu size={16} /></IconButton>
        </div>
      </header>
      {app.serverDown && (
        <div className="banner" role="alert"><I.warn size={14} /> Can't reach the lab server. Start it with <span className="mono">./lab.sh</span> (or <span className="mono">agent-lab serve</span>) and reload.</div>
      )}
      <main id="main" className="main">{view}</main>
      <footer className="footer">
        <span className="mono">OpenMoney Agent Lab</span>
        <span className="faint">Every number on this page was measured by the lab — the metering proxy, the MCP tool servers and the grader — never reported by a framework.</span>
        <a className="faint" href="/api/docs" target="_blank" rel="noreferrer">API</a>
      </footer>
    </div>
  );
}

export function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
