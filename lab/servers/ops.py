"""ops: an incident simulator — alerts, metrics, logs, changes, and the actions an on-call engineer can take.

The simulated clock advances with each call. Turning the faulty flag back down fixes the errors a few minutes later;
rolling back an unrelated deploy changes nothing (and is recorded as an unneeded action).
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal

try:
    from lab.mcpkit import Env, ToolError, ToolServer, stdio_main
except ImportError:
    from mcpkit import Env, ToolError, ToolServer, stdio_main

FMT = "%Y-%m-%dT%H:%M:%SZ"


def _t(s: str) -> datetime:
    return datetime.strptime(s, FMT).replace(tzinfo=timezone.utc)


def _s(d: datetime) -> str:
    return d.strftime(FMT)


def build(env: Env) -> ToolServer:
    st = env.state
    if "ops" not in st:
        data = json.loads((env.data_dir / "ops.json").read_text())
        st["ops"] = {"data": data, "now": data["now"], "mitigated_at": None, "actions": []}
    ops = st["ops"]
    data = ops["data"]
    srv = ToolServer("ops", "Fernhill Goods production operations: alerts, metrics, logs, change history, and "
                            "incident actions (flags, rollbacks, paging, status page).")

    def tick(seconds: int = 30) -> datetime:
        now = _t(ops["now"]) + timedelta(seconds=seconds)
        ops["now"] = _s(now)
        return now

    def service(name: str) -> dict:
        if name not in data["services"]:
            raise ToolError(f"Unknown service '{name}'. Known: {', '.join(data['services'])}")
        return data["services"][name]

    def record(kind: str, **kw):
        a = {"type": kind, "at": ops["now"], **kw}
        ops["actions"].append(a)
        return a

    @srv.tool(read_only=True)
    def list_alerts() -> dict:
        """Currently firing alerts."""
        tick()
        firing = [] if ops["mitigated_at"] and _t(ops["now"]) > _t(ops["mitigated_at"]) + timedelta(minutes=3) else None
        alerts = data["alerts"]
        if firing is not None:
            alerts = [a for a in alerts if a["service"] == "search-api"]
        return {"now": ops["now"], "alerts": alerts}

    @srv.tool(read_only=True)
    def get_service(name: Annotated[str, "Service name, e.g. payments-api"]) -> dict:
        """Owner team, tier, dependencies and feature flags of a service."""
        tick()
        s = service(name)
        flags = {f: {"rollout_percent": data["flags"][f]["rollout_percent"]} for f in s["flags"]}
        return {"service": name, **{k: v for k, v in s.items() if k != "flags"}, "flags": flags}

    @srv.tool(read_only=True)
    def query_metrics(service_name: Annotated[str, "Service name"],
                      metric: Literal["error_rate_pct", "p99_latency_ms", "rps"],
                      minutes: Annotated[int, "Window to return, in minutes (max 60)"] = 30) -> dict:
        """A metric for a service in 1-minute points over the last N minutes (ending now)."""
        service(service_name)
        now = tick(60)
        minutes = max(5, min(int(minutes), 60))
        before, during, after = data["metrics"][service_name][metric]
        onset = _t(data["onset"][service_name])
        mit = _t(ops["mitigated_at"]) + timedelta(minutes=2) if ops["mitigated_at"] else None
        pts = []
        for i in range(minutes, -1, -1):
            t = now - timedelta(minutes=i)
            v = before if t < onset else during
            if mit and t >= mit and service_name != "search-api":
                v = after
            if service_name == "search-api" and t >= onset + timedelta(minutes=15):
                v = after
            pts.append({"t": _s(t.replace(second=0)), "v": v})
        cur = pts[-1]["v"]
        return {"service": service_name, "metric": metric, "now": ops["now"], "current": cur, "points": pts}

    @srv.tool(read_only=True)
    def search_logs(service_name: Annotated[str, "Service name"],
                    query: Annotated[str, "Case-insensitive substring to match; empty for all"] = "",
                    level: Annotated[str, "Optional level filter: ERROR, WARN, INFO, DEBUG"] = "",
                    limit: int = 50) -> dict:
        """Search a service's recent logs."""
        service(service_name)
        tick()
        rows = data["logs"].get(service_name, [])
        q = query.lower()
        out = [{"t": t, "level": lv, "msg": m} for t, lv, m in rows
               if (not q or q in m.lower()) and (not level or lv == level.upper())]
        return {"service": service_name, "count": len(out), "lines": out[: max(1, min(limit, 200))]}

    @srv.tool(read_only=True)
    def list_changes(since_minutes: Annotated[int, "Look back this many minutes"] = 90,
                     service_name: Annotated[str, "Optional service filter"] = "") -> dict:
        """Deploys, feature-flag and config changes, newest first."""
        tick()
        cutoff = _t(ops["now"]) - timedelta(minutes=since_minutes)
        rows = [{k: c[k] for k in ("id", "type", "service", "at", "by", "summary")} for c in data["changes"]
                if _t(c["at"]) >= cutoff and (not service_name or c["service"] == service_name)]
        return {"now": ops["now"], "changes": sorted(rows, key=lambda c: c["at"], reverse=True)}

    @srv.tool(read_only=True)
    def get_change(change_id: str) -> dict:
        """Full details of one change."""
        tick()
        for c in data["changes"]:
            if c["id"] == change_id:
                return c
        raise ToolError(f"Unknown change id: {change_id}")

    @srv.tool(destructive=True)
    async def set_feature_flag(flag: Annotated[str, "Flag name, e.g. tax_engine_v2"],
                               rollout_percent: Annotated[int, "0-100"],
                               reason: str) -> dict:
        """Change a feature flag's rollout percentage (takes effect within ~2 minutes)."""
        if flag not in data["flags"]:
            raise ToolError(f"Unknown flag: {flag}")
        ok, why = await env.approve("set_feature_flag", {"flag": flag, "rollout_percent": rollout_percent, "reason": reason})
        if not ok:
            record("denied", action="set_feature_flag", flag=flag)
            raise ToolError(f"A person declined this action. {why}".strip())
        tick()
        f = data["flags"][flag]
        old = f["rollout_percent"]
        f["rollout_percent"] = max(0, min(100, int(rollout_percent)))
        record("set_feature_flag", flag=flag, **{"from": old, "to": f["rollout_percent"]}, reason=reason)
        if flag == "tax_engine_v2" and f["rollout_percent"] <= 10 and not ops["mitigated_at"]:
            ops["mitigated_at"] = ops["now"]
        return {"flag": flag, "from": old, "to": f["rollout_percent"], "effective_in": "about 2 minutes"}

    @srv.tool(destructive=True)
    async def rollback_deploy(change_id: Annotated[str, "Deploy change id, e.g. dep_1234"], reason: str) -> dict:
        """Roll a service back to the version before the given deploy."""
        c = next((c for c in data["changes"] if c["id"] == change_id), None)
        if not c or c["type"] != "deploy":
            raise ToolError(f"{change_id} is not a deploy")
        ok, why = await env.approve("rollback_deploy", {"change_id": change_id, "service": c["service"], "reason": reason})
        if not ok:
            record("denied", action="rollback_deploy", change_id=change_id)
            raise ToolError(f"A person declined this action. {why}".strip())
        tick(120)
        record("rollback_deploy", change_id=change_id, service=c["service"], reason=reason)
        return {"rolled_back": change_id, "service": c["service"], "now_running": c["previous_version"]}

    @srv.tool()
    async def page_team(team: Annotated[str, "Team name, e.g. payments"],
                        urgency: Literal["high", "low"], message: str) -> dict:
        """Page a team's on-call engineer."""
        if team not in data["teams"]:
            raise ToolError(f"Unknown team '{team}'. Teams: {', '.join(data['teams'])}")
        tick()
        record("page_team", team=team, urgency=urgency, message=message)
        return {"paged": team, "urgency": urgency, "ack": "on-call notified"}

    @srv.tool()
    async def post_status_update(severity: Literal["SEV1", "SEV2", "SEV3"],
                                 status: Literal["investigating", "identified", "mitigated", "resolved"],
                                 title: str, body: str) -> dict:
        """Publish an update to the public status page."""
        ok, why = await env.approve("post_status_update", {"severity": severity, "status": status, "title": title, "body": body})
        if not ok:
            record("denied", action="post_status_update")
            raise ToolError(f"A person declined this update. {why}".strip())
        tick()
        record("post_status_update", severity=severity, status=status, title=title, body=body)
        return {"posted": True, "status": status, "at": ops["now"]}

    return srv


if __name__ == "__main__":
    stdio_main(build)
