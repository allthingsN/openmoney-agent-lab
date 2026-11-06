"""USD per million tokens. Anthropic first-party list prices as of 2026-10; edit if they change.

Cache writes are priced at 1.25x input (5-minute TTL) and 2x input (1-hour TTL).
"""

PRICES = {
    # model:            (input, output, cache_read)
    "claude-fable-5-1": (10.00, 50.00, 0.25),
    "claude-fable-5": (10.00, 50.00, 0.25),
    "claude-opus-5-5": (4.00, 20.00, 0.20),
    "claude-opus-5": (5.00, 25.00, 0.50),
    "claude-opus-4-8": (5.00, 25.00, 0.50),
    "claude-sonnet-5-5": (2.00, 10.00, 0.20),
    "claude-sonnet-5": (2.00, 10.00, 0.20),
    "claude-sonnet-4-6": (3.00, 15.00, 0.30),
    "claude-haiku-5-5": (0.10, 0.50, 0.01),
    "claude-haiku-4-5": (1.00, 5.00, 0.10),
}


def _key(model: str) -> str | None:
    m = (model or "").removeprefix("anthropic/").removeprefix("anthropic.")
    if m in PRICES:
        return m
    for k in sorted(PRICES, key=len, reverse=True):  # dated or suffixed ids
        if m.startswith(k):
            return k
    return None


def cost(model: str, usage: dict) -> float:
    k = _key(model)
    if not k:
        return 0.0
    i, o, cr = PRICES[k]
    cc = usage.get("cache_creation") or {}
    w5 = cc.get("ephemeral_5m_input_tokens")
    w1 = cc.get("ephemeral_1h_input_tokens") or 0
    if w5 is None:
        w5 = usage.get("cache_creation_input_tokens") or 0
    total = (
        (usage.get("input_tokens") or 0) * i
        + (usage.get("output_tokens") or 0) * o
        + (usage.get("cache_read_input_tokens") or 0) * cr
        + w5 * i * 1.25
        + w1 * i * 2
    )
    return round(total / 1_000_000, 6)
