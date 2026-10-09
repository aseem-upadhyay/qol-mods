"""List prices for Claude models, and what one message's usage costs at them.

The one copy every mod in this repository prices from. Each plugin ships a
byte-for-byte copy in its own hooks/ folder, since a plugin is installed on
its own: edit this file, then run `python3 scripts/sync-shared.py` to copy
it out. Each plugin's tests fail while its copy differs from this one.
"""

# List prices in $ per million tokens:
#   (input, output, cache read, cache write 5m, cache write 1h)
# Matched by longest model-id prefix. Update it when Anthropic's pricing
# changes (https://claude.com/pricing): a new PRICES_UPDATED makes every
# cache keyed on it re-read the logs. Checked against Claude Code's
# cost-state totals for Opus.
PRICES_UPDATED = "2026-10-09"
PRICES = {
    "claude-fable-5": (10, 50, 1.0, 12.5, 20),
    "claude-fable-5-1": (10, 50, 0.25, 12.5, 20),
    "claude-opus-5-5": (4, 20, 0.2, 5, 8),
    "claude-opus-5": (5, 25, 0.5, 6.25, 10),
    "claude-opus-4": (5, 25, 0.5, 6.25, 10),
    "claude-sonnet-5-5": (2, 10, 0.2, 2.5, 4),
    "claude-sonnet-5": (2, 10, 0.2, 2.5, 4),
    "claude-sonnet-4": (3, 15, 0.3, 3.75, 6),
    "claude-haiku-5-5": (0.1, 0.5, 0.01, 0.125, 0.2),
    "claude-haiku-4": (1, 5, 0.1, 1.25, 2),
}

# A newer model of the same family that is cheaper per token, keyed by the
# PRICES row of the older one. Only rows whose successor really is cheaper
# belong here: claude-sonnet-5 has none, since claude-sonnet-5-5 costs the same.
SUCCESSOR = {
    "claude-fable-5": "claude-fable-5-1",
    "claude-opus-5": "claude-opus-5-5",
    "claude-opus-4": "claude-opus-5-5",
    "claude-sonnet-4": "claude-sonnet-5-5",
    "claude-haiku-4": "claude-haiku-5-5",
}

FAMILIES = ("fable", "opus", "sonnet", "haiku")


def price_key(model):
    """The PRICES row a model id is priced by (longest prefix), or None."""
    best = None
    for key in PRICES:
        if model.startswith(key) and (best is None or len(key) > len(best)):
            best = key
    return best


def price_for(model):
    return PRICES.get(price_key(model or ""))


def family(model):
    """'fable', 'opus', 'sonnet' or 'haiku'; '' for anything else."""
    for name in FAMILIES:
        if f"-{name}-" in f"-{model or ''}-":
            return name
    return ""


def tokens_in(u):
    return sum((u.get(k) or 0) for k in (
        "input_tokens", "output_tokens",
        "cache_read_input_tokens", "cache_creation_input_tokens"))


def cache_writes(u):
    """-> (5-minute writes, 1-hour writes). Usage without the split counts as 5-minute."""
    cc = u.get("cache_creation") or {}
    w1h = cc.get("ephemeral_1h_input_tokens")
    w5m = cc.get("ephemeral_5m_input_tokens")
    if w1h is None and w5m is None:
        return u.get("cache_creation_input_tokens", 0) or 0, 0
    return w5m or 0, w1h or 0


def message_parts(model, u):
    """-> (input usd, output usd, priced). Input covers uncached input, cache
    reads and cache writes. Fast mode doubles both. An unknown model costs 0
    and reports priced=False."""
    p = price_for(model or "")
    if not p:
        return 0.0, 0.0, False
    w5m, w1h = cache_writes(u)
    inp = (
        (u.get("input_tokens") or 0) * p[0]
        + (u.get("cache_read_input_tokens") or 0) * p[2]
        + w5m * p[3]
        + w1h * p[4]
    )
    out = (u.get("output_tokens") or 0) * p[1]
    if u.get("speed") == "fast":
        inp *= 2
        out *= 2
    return inp / 1e6, out / 1e6, True


def message_cost(model, u):
    """-> (usd, priced). An unknown model costs 0 and reports priced=False."""
    inp, out, priced = message_parts(model, u)
    return inp + out, priced
