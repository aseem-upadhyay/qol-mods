"""Facts in, weekly rows out (SPEC.md §7 and §8).

build() turns the cached per-file facts into sessions: subagent calls are
attributed to the prompt they ran under, and a session with Claude Code's
own cost ledger has its estimates scaled to it. week_row() measures one
week of them. Habits, tips and the rest of the coaching live in rules.py.
"""
import bisect
import datetime
import os
import statistics

from extract import (BACKGROUND, C_CTX, C_EFFORT, C_IN, C_MODEL, C_OUT, C_READ, C_REQ, C_REWARM,
                     C_SUB, C_TS, C_UNCACHED, C_WRITE, C_FAST)
from pricing import family

METRICS_VERSION = 1
DAY_MS = 24 * 3600 * 1000
WEEK_MS = 7 * DAY_MS
BIG_FILES = 8
BIG_USD = 3.0
BIG_CALLS = 40


def project_name(session):
    root = session.get("root") or session.get("cwd") or ""
    return os.path.basename(root.rstrip("/")) or session.get("project") or "unknown"


def build(entries):
    """entries: [{"sid", "main", "facts"}] -> {session id: session}.

    A session is its main transcript's session facts plus "requests", "calls"
    (main and subagent rows together), "scale" and "name". A subagent whose
    main transcript is gone is dropped: there's no prompt to tie it to."""
    sessions = {}
    subs = {}
    for e in entries:
        f = e["facts"]
        if f.get("main") and f.get("session"):
            s = dict(f["session"])
            s["requests"] = [dict(r) for r in f["requests"]]
            s["calls"] = [list(c) for c in f["calls"]]
            s["unpriced"] = list(f.get("unpriced") or [])
            s["path"] = e.get("path")
            sessions[s["id"]] = s
        else:
            subs.setdefault(e["sid"], []).append(f)
    for sid, facts in subs.items():
        s = sessions.get(sid)
        if s is None:
            continue
        starts = [r["at"] for r in s["requests"]]
        for f in facts:
            for name, hit in (f.get("feats") or {}).items():
                mine = s["feats"].setdefault(name, [0, hit[1], hit[2]])
                mine[0] += hit[0]
                mine[1] = min(mine[1], hit[1]) if mine[1] else hit[1]
                mine[2] = max(mine[2], hit[2])
            for name in f.get("unpriced") or []:
                if name not in s["unpriced"]:
                    s["unpriced"].append(name)
            for row in f["calls"]:
                row = list(row)
                idx = bisect.bisect_right(starts, row[C_TS]) - 1
                row[C_REQ] = idx if idx >= 0 else BACKGROUND
                row[C_SUB] = True
                s["calls"].append(row)
                if idx >= 0:
                    r = s["requests"][idx]
                    r["subUsd"] = r.get("subUsd", 0.0) + row[C_IN] + row[C_OUT]
                    r["subCalls"] = r.get("subCalls", 0) + 1
    for s in sessions.values():
        estimate = sum(c[C_IN] + c[C_OUT] for c in s["calls"])
        ledger = s.get("ledger")
        s["scale"] = ledger / estimate if ledger is not None and estimate > 0 else 1.0
        s["estimated"] = ledger is None
        s["name"] = project_name(s)
        s["calls"].sort(key=lambda c: c[C_TS])
        for r in s["requests"]:
            r["cost"] = (r["usd"] + r.get("subUsd", 0.0)) * s["scale"]
    return sessions


# -- weeks

def week_start(ms_, starts_on="monday"):
    """The local midnight that starts the week holding `ms_`, in epoch ms."""
    day = datetime.datetime.fromtimestamp(ms_ / 1000).date()
    back = day.weekday() if starts_on == "monday" else (day.weekday() + 1) % 7
    first = day - datetime.timedelta(days=back)
    return int(datetime.datetime.combine(first, datetime.time.min).timestamp() * 1000)


def next_week(start_ms):
    """The start of the following week, a local midnight seven days on."""
    day = datetime.datetime.fromtimestamp(start_ms / 1000).date() + datetime.timedelta(days=7)
    return int(datetime.datetime.combine(day, datetime.time.min).timestamp() * 1000)


def week_id(start_ms):
    return datetime.datetime.fromtimestamp(start_ms / 1000).date().isoformat()


def weeks_between(first_ms, now_ms, starts_on):
    """[(start, end)] for every week from the one holding first_ms to now's."""
    out = []
    start = week_start(first_ms, starts_on)
    while start <= now_ms:
        end = next_week(start)
        out.append((start, end))
        start = end
    return out


# -- helpers

def median(values):
    return float(statistics.median(values)) if values else 0.0


def p90(values):
    if not values:
        return 0.0
    ordered = sorted(values)
    return float(ordered[min(len(ordered) - 1, int(0.9 * len(ordered)))])


def usd(session, row):
    return (row[C_IN] + row[C_OUT]) * session["scale"]


def is_big(r):
    """A big change: many files, or a long or costly run that changed something."""
    return r["edited"] >= BIG_FILES or (r["edited"] > 0 and (r["cost"] >= BIG_USD or r["calls"] >= BIG_CALLS))


def prompts_of(session):
    return [r for r in session["requests"] if r["kind"] == "prompt"]


def in_window(at, start, end):
    return start <= at < end


def local_day(ms_):
    return datetime.datetime.fromtimestamp(ms_ / 1000).date().isoformat()


def week_row(sessions, start, end, ctx):
    """One week's measurements. `ctx` carries the threshold, the openings and
    stale switches rules.py found, and what suggest.py knows of repeats."""
    threshold = ctx["thresholdK"] * 1000
    reqs = [(s, r) for s in sessions.values() for r in s["requests"] if in_window(r["at"], start, end)]
    counted = [(s, r) for s, r in reqs if not r["local"]]
    prompts = [r for _, r in reqs if r["kind"] == "prompt"]
    calls = [(s, c) for s in sessions.values() for c in s["calls"] if in_window(c[C_TS], start, end)]
    active = {s["id"]: s for s, _ in reqs}

    total = in_usd = out_usd = fast = rewarm = 0.0
    rewarm_events = 0
    by_model, by_project, efforts = {}, {}, {}
    read = write = uncached = 0
    contexts = []
    families = set()
    for s, c in calls:
        scale = s["scale"]
        cost = (c[C_IN] + c[C_OUT]) * scale
        total += cost
        in_usd += c[C_IN] * scale
        out_usd += c[C_OUT] * scale
        by_model[c[C_MODEL]] = by_model.get(c[C_MODEL], 0.0) + cost
        by_project[s["name"]] = by_project.get(s["name"], 0.0) + cost
        if c[C_FAST]:
            fast += cost
        if c[C_REWARM]:
            rewarm += c[C_REWARM] * scale
            rewarm_events += 1
        read += c[C_READ]
        write += c[C_WRITE]
        uncached += c[C_UNCACHED]
        if not c[C_SUB]:
            contexts.append(c[C_CTX])
        if c[C_EFFORT]:
            efforts[c[C_EFFORT]] = efforts.get(c[C_EFFORT], 0) + 1
        if family(c[C_MODEL]):
            families.add(family(c[C_MODEL]))
    effort_total = sum(efforts.values())

    unpriced = sorted({m for s in active.values() for m in s.get("unpriced", [])})
    compactions = {"auto": 0, "manual": 0, "unknown": 0}
    api_errors = 0
    oversized = 0
    bypass = 0
    ended_badly = 0
    for s in sessions.values():
        for at, trigger in s["compactions"]:
            if in_window(at, start, end):
                key = trigger if trigger in compactions else "unknown"
                compactions[key] += 1
        api_errors += sum(1 for at in s["apiErrors"] if in_window(at, start, end))
    for s in active.values():
        mine = [c[C_CTX] for c in s["calls"] if not c[C_SUB] and in_window(c[C_TS], start, end)]
        if mine and max(mine) >= threshold:
            oversized += 1
        if any(r["mode"] == "bypassPermissions" for r in prompts_of(s) if in_window(r["at"], start, end)):
            bypass += 1
        last = s["requests"][-1] if s["requests"] else None
        if last is not None and in_window(last["at"], start, end) and (last["interrupted"] or last["apiErrors"]):
            ended_badly += 1

    openings = [r for r in ctx["openings"] if in_window(r["at"], start, end)]
    code = [r for _, r in counted if r["edited"] > 0]
    big = [r for _, r in counted if is_big(r)]
    features = {}
    for _, r in reqs:
        for name in r["feats"]:
            features[name] = features.get(name, 0) + 1
    for s in sessions.values():
        for name, hit in s["feats"].items():
            if hit[2] >= start and hit[1] < end:
                features[name] = features.get(name, 0) + 1
    if len(families) >= 2:
        features["model-choice"] = features.get("model-choice", 0) + 1

    days = {local_day(r["at"]) for _, r in reqs}
    per_day = {}
    for s, c in calls:
        day = local_day(c[C_TS])
        per_day[day] = per_day.get(day, 0.0) + (c[C_IN] + c[C_OUT]) * s["scale"]
    memory = {"discoveryEpisodes": 0, "discoverySteps": 0, "wrongToolFirst": 0, "repeatedCorrections": 0}
    for _, r in reqs:
        memory["discoveryEpisodes"] += len(r["discovery"])
        memory["discoverySteps"] += sum(d[1] for d in r["discovery"])
        memory["wrongToolFirst"] += len(r["subs"])
    repeats = ctx.get("repeats", {})
    memory["repeatedCorrections"] = sum(1 for _, r in reqs if r["id"] in repeats.get("corrections", ()))

    top = sorted(by_project.items(), key=lambda kv: -kv[1])
    by_project_top = dict(top[:5])
    if len(top) > 5:
        by_project_top["other"] = sum(v for _, v in top[5:])
    stamps = [r["at"] for _, r in reqs] + [c[C_TS] for _, c in calls]
    return {
        "week": week_id(start), "start": start, "end": end, "frozen": False,
        "firstAt": min(stamps) if stamps else None,
        "metricsVersion": METRICS_VERSION,
        "coverage": {"partial": False, "firstLogAt": None},
        "versionsSeen": sorted({v for s in active.values() for v in s.get("versions", [])})[:8],
        "volume": {
            "sessions": len(active), "prompts": len(prompts),
            "commands": sum(1 for _, r in counted if r["kind"] == "command"),
            "activeDays": len(days),
        },
        "cost": {
            "usd": round(total, 4), "inputUsd": round(in_usd, 4), "outputUsd": round(out_usd, 4),
            "byModel": {k: round(v, 4) for k, v in sorted(by_model.items(), key=lambda kv: -kv[1])},
            "byProject": {k: round(v, 4) for k, v in by_project_top.items()},
            "byDay": {k: round(v, 4) for k, v in sorted(per_day.items())},
            "unpriced": unpriced, "estimated": any(s["estimated"] for s in active.values()),
            "perPrompt": {"median": round(median([r["cost"] for _, r in counted]), 4),
                          "p90": round(p90([r["cost"] for _, r in counted]), 4)},
            "fastUsd": round(fast, 4), "rewarmUsd": round(rewarm, 4), "rewarmEvents": rewarm_events,
        },
        "usage": {
            "callsPerPrompt": median([r["calls"] + r.get("subCalls", 0) for _, r in counted]),
            "contextPerCall": {"median": median(contexts), "p90": p90(contexts)},
            "cacheHitRate": round(read / (read + write + uncached), 4) if read + write + uncached else 0.0,
            "effortShare": {k: round(v / effort_total, 3) for k, v in efforts.items()} if effort_total else {},
            "families": sorted(families),
        },
        "context": {
            "oversizedSessions": oversized, "compactions": compactions,
            "fresh": sum(1 for at in ctx["fresh"] if in_window(at, start, end)),
            "stale": sum(1 for r in ctx["stale"] if in_window(r["at"], start, end)),
        },
        "together": {
            "interrupts": sum(1 for _, r in counted if r["interrupted"]),
            "rejections": sum(r["rejections"] for _, r in counted),
            "classifierBlocks": sum(r["blocks"] for _, r in counted),
            "corrections": sum(1 for r in prompts if r["corrected"]),
            "apiErrors": api_errors, "endedBadly": ended_badly,
        },
        "work": {
            "codePrompts": len(code), "checked": sum(1 for r in code if r["checked"]),
            "commits": sum(1 for _, r in counted if r["committed"]),
            "bigChanges": len(big), "bigChangesPlanned": sum(1 for r in big if r["plan"]),
        },
        "prompts": {
            "opening": len(openings),
            "namesPlace": sum(1 for r in openings if r["flags"].get("place")),
            "saysDone": sum(1 for r in openings if r["flags"].get("done")),
            "vague": sum(1 for r in openings if r["flags"].get("vague")),
            "bigPastes": sum(1 for r in prompts if r["flags"].get("paste")),
            "images": sum(1 for r in prompts if r["images"]),
            "medianWords": median([r["words"] for r in prompts]),
        },
        "features": features,
        "safety": {"bypassSessions": bypass},
        "memory": memory,
        "repeats": {"prompts": sum(1 for r in prompts if r["id"] in repeats.get("prompts", ())),
                    "clusters": len({repeats["prompts"][r["id"]] for r in prompts
                                     if r["id"] in repeats.get("prompts", {})})},
        "habits": {}, "tips": [], "notices": [], "evidence": {},
        "sessionIds": sorted(active),
    }
