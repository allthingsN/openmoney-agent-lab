"""offers: a sandbox of the OpenMoney offers layer — fictional plans, real mechanics.

Results come back in a fixed, neutral order (by offer id). Sponsored offers are labelled; payment never moves them.
"""

from __future__ import annotations

import json
import re
from typing import Annotated, Literal

try:
    from lab.mcpkit import Env, ToolError, ToolServer, stdio_main
except ImportError:
    from mcpkit import Env, ToolError, ToolServer, stdio_main

DISCLOSURE = "Sponsored: the provider pays OpenMoney if you choose this offer. It does not change the order."


def _load(env: Env) -> list[dict]:
    if "offers" not in env.state:
        env.state["offers"] = json.loads((env.data_dir / "offers.json").read_text())["offers"]
    return env.state["offers"]


def _resolve_prices(o: dict, lines: int | None) -> dict:
    o = json.loads(json.dumps(o))
    if o["category"] == "mobile_plan":
        n = str(lines or 1)
        by = o["price"]["monthly_by_lines"]
        if n not in by:
            o["price_for_lines"] = {"lines": int(n), "available": False}
        else:
            promo = o["price"].get("promo")
            o["price_for_lines"] = {
                "lines": int(n),
                "available": True,
                "monthly": by[n],
                "promo": ({"monthly": promo["monthly_by_lines"][n], "months": promo["months"]}
                          if promo and n in promo.get("monthly_by_lines", {}) else None),
                "autopay_discount_monthly": o["price"].get("autopay_discount_per_line", 0) * int(n),
                "taxes_monthly": o.get("taxes_monthly_by_lines", {}).get(n),
            }
    if o.get("sponsored"):
        o["disclosure"] = DISCLOSURE
    return o


def build(env: Env) -> ToolServer:
    srv = ToolServer("offers", "OpenMoney offers sandbox: fictional home-internet and mobile plans. "
                               "Send needs, never personal details. Region is a ZIP3 (first three digits).")

    def check_zip3(zip3: str) -> str:
        if not re.fullmatch(r"\d{3}", zip3 or ""):
            raise ToolError("zip3 must be exactly the first 3 digits of a ZIP code (e.g. '951'). "
                            "Full ZIP codes are personal data and are not accepted.")
        return zip3

    @srv.tool(read_only=True)
    def list_categories() -> dict:
        """List offer categories in the catalog."""
        cats = sorted({o["category"] for o in _load(env)})
        return {"categories": cats}

    @srv.tool(read_only=True)
    def search_offers(category: Literal["home_internet", "mobile_plan"],
                      zip3: Annotated[str, "First 3 digits of the ZIP code, e.g. '951'"],
                      lines: Annotated[int, "Mobile only: number of lines"] = 1,
                      query: Annotated[str, "Optional free-text needs, e.g. '500 Mbps, no cap'. No personal data."] = "") -> dict:
        """Search the catalog. Returns summaries in neutral order. Availability varies by area: confirm with
        check_availability before recommending, and read full terms with get_offer."""
        check_zip3(zip3)
        out = []
        for o in sorted(_load(env), key=lambda x: x["id"]):
            if o["category"] != category:
                continue
            s = {"offer_id": o["id"], "provider": o["provider"], "name": o["name"], "headline": o["headline"],
                 "sponsored": bool(o.get("sponsored"))}
            if o.get("sponsored"):
                s["disclosure"] = DISCLOSURE
            out.append(s)
        return {"category": category, "zip3": zip3, "count": len(out), "offers": out,
                "note": "Order is neutral (by id). Headlines are the provider's own words; read get_offer for terms."}

    @srv.tool(read_only=True)
    def get_offer(offer_id: str, lines: Annotated[int, "Mobile only: number of lines to price"] = 1) -> dict:
        """Full terms for one offer: regular and promo prices, discounts, fees, equipment, taxes, contract,
        speeds/data caps (internet) or data/hotspot/roaming (mobile)."""
        for o in _load(env):
            if o["id"] == offer_id:
                r = _resolve_prices(o, lines)
                r.pop("availability", None)
                return r
        raise ToolError(f"Unknown offer_id: {offer_id}")

    @srv.tool(read_only=True)
    def check_availability(offer_id: str, zip3: Annotated[str, "First 3 digits of the ZIP code"]) -> dict:
        """Check whether an offer is sold in an area (ZIP3)."""
        check_zip3(zip3)
        for o in _load(env):
            if o["id"] == offer_id:
                z = o.get("availability", {}).get("zip3", [])
                return {"offer_id": offer_id, "zip3": zip3, "available": "*" in z or zip3 in z}
        raise ToolError(f"Unknown offer_id: {offer_id}")

    return srv


if __name__ == "__main__":
    stdio_main(build)
