#!/usr/bin/env python3
"""Sum what Claude Code has spent on one repo, from its transcripts.

Usage: scan.py <projects-dir> <repo-slug-prefix> <cache-file> [exclude-session-id]

Every ~/.claude/projects/<slug>* folder whose slug starts with the repo's
(the repo itself and each of its worktrees) is read. Per session:
  - a `cost-state` record (Claude Code's own /cost ledger) wins when present;
  - otherwise the cost is estimated from each assistant message's usage,
    deduplicated by message id, priced with PRICES below, subagents included.
Per-file results are cached by (size, mtime, PRICES_UPDATED), so only changed
files re-read, and a session keeps counting after Claude Code deletes its log.
Prints one JSON object:
  {"usd", "sessions", "estimatedUsd", "today", "week", "since", "unpriced": [model, ...]}
where "since" is the epoch ms of the oldest message counted (null when none),
so the total can say how far back it reaches, and "unpriced" names models that
used tokens but have no row in PRICES (their tokens count as $0, so the total
is a floor).
"""
import json, os, sys, time, datetime

# List prices in $ per million tokens:
#   (input, output, cache read, cache write 5m, cache write 1h)
# Matched by longest model-id prefix. Only sessions WITHOUT a cost-state record
# use this table; Claude Code's own ledger wins wherever it exists. Update it
# when Anthropic's pricing changes (https://claude.com/pricing) and bump the
# plugin version. Checked against Claude Code's cost-state totals for Opus.
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


def price_for(model):
    best = None
    for key in PRICES:
        if model.startswith(key) and (best is None or len(key) > len(best)):
            best = key
    return PRICES.get(best)


def tokens_in(u):
    return sum((u.get(k) or 0) for k in (
        "input_tokens", "output_tokens",
        "cache_read_input_tokens", "cache_creation_input_tokens"))


def message_cost(model, u):
    """-> (usd, priced). An unknown model costs 0 and reports priced=False."""
    p = price_for(model or "")
    if not p:
        return 0.0, False
    cc = u.get("cache_creation") or {}
    w1h = cc.get("ephemeral_1h_input_tokens")
    w5m = cc.get("ephemeral_5m_input_tokens")
    if w1h is None and w5m is None:
        w5m, w1h = u.get("cache_creation_input_tokens", 0) or 0, 0
    total = (
        (u.get("input_tokens") or 0) * p[0]
        + (u.get("output_tokens") or 0) * p[1]
        + (u.get("cache_read_input_tokens") or 0) * p[2]
        + (w5m or 0) * p[3]
        + (w1h or 0) * p[4]
    )
    if u.get("speed") == "fast":
        total *= 2
    return total / 1e6, True


def oldest(msgs):
    """The earliest message timestamp (epoch s) among `msgs`, 0 when none has one."""
    return min((m[1] for m in msgs.values() if m[1] > 0), default=0)


def scan_file(path):
    """-> {"ledger": float|None, "msgs": {msg_id: [usd, epoch_s, unpriced_model]},
    "first": epoch_s of the oldest message, 0 when none}

    unpriced_model is "" when the message was priced (or used no tokens)."""
    ledger = None
    msgs = {}
    with open(path, errors="ignore") as fh:
        for line in fh:
            if '"cost-state"' in line:
                try:
                    d = json.loads(line)
                    if d.get("type") == "cost-state":
                        ledger = float(d.get("totalCostUSD") or 0)
                except ValueError:
                    pass
                continue
            if '"usage"' not in line or '"assistant"' not in line:
                continue
            try:
                d = json.loads(line)
            except ValueError:
                continue
            if d.get("type") != "assistant":
                continue
            m = d.get("message") or {}
            u = m.get("usage")
            mid = m.get("id") or d.get("requestId") or d.get("uuid")
            if not u or not mid:
                continue
            ts = 0
            try:
                ts = datetime.datetime.fromisoformat(
                    d["timestamp"].replace("Z", "+00:00")).timestamp()
            except (KeyError, ValueError, AttributeError):
                pass
            # Streaming writes one line per content block with the same usage;
            # the last one carries the final output count.
            model = m.get("model") or ""
            cost, priced = message_cost(model, u)
            unpriced = model if not priced and tokens_in(u) > 0 else ""
            msgs[mid] = [cost, ts, unpriced]
    return {"ledger": ledger, "msgs": msgs, "first": oldest(msgs)}


# A cache holds sessions whose logs Claude Code has since deleted, so a new
# version migrates the old one (see load_cache) instead of starting over.
CACHE_VERSION = 5


def fold(msgs):
    """A deleted log's messages, folded into one total (and one row per
    unpriced model), so it keeps counting without keeping every message."""
    last = max((m[1] for m in msgs.values()), default=0)
    folded = {"#total": [sum(m[0] for m in msgs.values()), last, ""]}
    for model in {m[2] for m in msgs.values() if m[2]}:
        folded["#unpriced:" + model] = [0.0, last, model]
    return folded


def load_cache(cache_path):
    """The cache as the current version reads it; a v4 cache gains each
    entry's "first" (a folded entry's is its newest message, the best left)."""
    try:
        with open(cache_path) as fh:
            cache = json.load(fh)
    except (OSError, ValueError):
        return {"v": CACHE_VERSION, "files": {}}
    if cache.get("v") == 4:
        for hit in cache.get("files", {}).values():
            hit.setdefault("first", oldest(hit.get("msgs", {})))
        cache["v"] = CACHE_VERSION
    if cache.get("v") != CACHE_VERSION:
        return {"v": CACHE_VERSION, "files": {}}
    return cache


def main():
    projects, prefix, cache_path = sys.argv[1], sys.argv[2], sys.argv[3]
    exclude = sys.argv[4] if len(sys.argv) > 4 else ""
    cache = load_cache(cache_path)
    files = cache["files"]
    seen = set()

    # session id -> {"ledger", "msgs", "first"} merged across main + subagent files
    sessions = {}

    def merge(sid, is_main, hit):
        s = sessions.setdefault(sid, {"ledger": None, "msgs": {}, "first": 0})
        if is_main and hit["ledger"] is not None:
            s["ledger"] = hit["ledger"]
        s["msgs"].update(hit["msgs"])
        if hit.get("first") and (not s["first"] or hit["first"] < s["first"]):
            s["first"] = hit["first"]

    for slug in os.listdir(projects):
        # The repo's own folder and its Claude worktrees' folders.
        if not (slug == prefix or slug.startswith(prefix + "--claude-worktrees-")):
            continue
        root = os.path.join(projects, slug)
        for dirpath, _dirs, names in os.walk(root):
            for name in names:
                if not name.endswith(".jsonl"):
                    continue
                path = os.path.join(dirpath, name)
                rel = os.path.relpath(path, root)
                sid = rel.split(os.sep)[0].removesuffix(".jsonl")
                is_main = os.sep not in rel
                if sid == exclude:
                    continue  # the live session: the band reads its cost directly
                try:
                    st = os.stat(path)
                except OSError:
                    continue
                # A price update re-reads every log still on disk.
                key = f"{st.st_size}:{int(st.st_mtime)}:{PRICES_UPDATED}"
                seen.add(path)
                hit = files.get(path)
                if not hit or hit.get("k") != key:
                    hit = {"k": key, "sid": sid, "main": is_main, **scan_file(path)}
                    files[path] = hit
                merge(sid, is_main, hit)

    # Claude Code deletes old logs (cleanupPeriodDays, 30 days by default).
    # A session this scan has seen keeps counting after its log is gone, so
    # the total keeps growing instead of rolling off after a month.
    for path, hit in files.items():
        if path in seen or hit["sid"] == exclude:
            continue
        if not hit.get("gone"):
            hit.update(gone=True, msgs=fold(hit["msgs"]))
        merge(hit["sid"], hit["main"], hit)

    tmp = cache_path + ".tmp"
    os.makedirs(os.path.dirname(cache_path), exist_ok=True)
    with open(tmp, "w") as fh:
        json.dump(cache, fh)
    os.replace(tmp, cache_path)

    now = time.time()
    day0 = datetime.datetime.now().replace(
        hour=0, minute=0, second=0, microsecond=0).timestamp()
    total = estimated = today = week = 0.0
    count = 0
    since = 0
    unpriced = set()
    for s in sessions.values():
        est = sum(m[0] for m in s["msgs"].values())
        if est == 0 and s["ledger"] is None and not any(
                m[2] for m in s["msgs"].values()):
            continue
        count += 1
        if s["first"] and (not since or s["first"] < since):
            since = s["first"]
        cost = s["ledger"] if s["ledger"] is not None else est
        total += cost
        if s["ledger"] is None:
            estimated += cost
            unpriced.update(m[2] for m in s["msgs"].values() if m[2])
        # Day/week windows come from message timestamps, scaled to the
        # ledger where one exists so the windows agree with the total.
        scale = cost / est if est else 0
        for c, ts, _ in s["msgs"].values():
            if ts >= day0:
                today += c * scale
            if ts >= now - 7 * 86400:
                week += c * scale
    print(json.dumps({
        "usd": round(total, 4), "sessions": count,
        "estimatedUsd": round(estimated, 4),
        "today": round(today, 4), "week": round(week, 4),
        "since": round(since * 1000) if since else None,
        "unpriced": sorted(unpriced),
    }))


if __name__ == "__main__":
    main()
