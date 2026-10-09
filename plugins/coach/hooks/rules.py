"""What coach makes of the measurements (SPEC.md §9.1–9.5): topic switches,
the habits and their evidence, features and levels, tips and notices.

Every finding carries evidence: the session and prompt it came from, so the
person can judge it. Selection against the person's own choices (dismissed
tips, the habit they're on) happens in hooks/select.ts.
"""
import datetime

from extract import (C_IN, C_MODEL, C_OUT, C_OUTPUT, C_READ, C_REQ, C_SUB, C_TS, C_UNCACHED, C_WRITE,
                     C_W1H)
from metrics import in_window, is_big, prompts_of
from pricing import PRICES, SUCCESSOR, family, price_for, price_key

SWITCH_CONTEXT = 100_000
IDLE_MS = 45 * 60 * 1000
FRESH_WINDOW_MS = 4 * 3600 * 1000
LONG_REQUEST_MS = 10 * 60 * 1000
PARALLEL_MS = 10 * 60 * 1000

HABITS = (
    # id, target, minimum sample
    ("fresh-start", 0.7, 3),
    ("point-to-place", 0.5, 5),
    ("say-done", 0.4, 5),
    ("check-work", 0.6, 5),
    ("plan-big", 0.5, 2),
)

FEATURES = (
    ("claude-md", 1), ("at-mention", 1), ("image", 1), ("interrupt", 1), ("fresh-start", 1),
    ("ask-checks", 1),
    ("plan-mode", 2), ("rewind", 2), ("model-choice", 2), ("subagents", 2), ("commands-skills", 2),
    ("mcp", 2), ("allow-rules", 2), ("compact", 2),
    ("hooks", 3), ("parallel", 3), ("worktrees", 3), ("headless", 3), ("automation", 3),
    ("plugins", 3), ("workflows", 3),
)
FEATURE_LEVEL = dict(FEATURES)


def title(s):
    return s.get("title") or s.get("lead") or "Untitled session"


def evidence(detector, s, r, usd=None, **numbers):
    return {
        "id": f"{detector}:{r['id']}", "detector": detector, "session": s["id"],
        "project": s["name"], "root": s.get("root") or s.get("cwd") or "", "title": title(s),
        "at": r["at"], "excerpt": r.get("excerpt"),
        "usd": round(usd, 4) if usd is not None else None, "numbers": numbers,
    }


# -- topic switches (H1) and opening prompts

def switches(sessions):
    """-> (openings, stale, fresh): the prompts that open a topic, the topic
    changes made inside a big session, and the times a topic got a fresh one."""
    openings, stale, fresh = [], [], []
    by_project = {}
    for s in sessions.values():
        ps = prompts_of(s)
        for k, r in enumerate(ps):
            if k == 0 or r["afterClear"]:
                openings.append(r)
                if r["afterClear"]:
                    fresh.append(r["at"])
                continue
            if r["ctx0"] < SWITCH_CONTEXT or r["flags"].get("cont"):
                continue
            prev = ps[k - 1]
            idle = r["at"] - prev["end"] >= IDLE_MS
            before = {a for p in ps[max(0, k - 3):k] for a in p["areas"]}
            mine = set(r["areas"])
            if idle or (before and mine and not (before & mine)):
                stale.append(r)
                openings.append(r)
        by_project.setdefault(s["name"], []).append(s)
    for group in by_project.values():
        ends = sorted((r["end"], r["ctxMax"], s["id"]) for s in group for r in s["requests"])
        for s in group:
            ps = prompts_of(s)
            if not ps:
                continue
            t0 = ps[0]["at"]
            before = [e for e in ends if e[2] != s["id"] and e[0] <= t0 and t0 - e[0] <= FRESH_WINDOW_MS]
            if before and max(before)[1] >= SWITCH_CONTEXT:
                fresh.append(t0)
    return openings, stale, fresh


def carried(s, r):
    """What re-reading the earlier topic's context cost from switch `r` to the
    end of its session, at cache-read prices."""
    total = 0.0
    for c in s["calls"]:
        if c[C_SUB] or c[C_REQ] < r["i"]:
            continue
        p = price_for(c[C_MODEL])
        if p:
            total += r["ctx0"] * p[2] / 1e6
    return total * s["scale"]


def avg_call_cost(s):
    main = [c for c in s["calls"] if not c[C_SUB]]
    if not main:
        return 0.0
    return sum(r["cost"] for r in s["requests"]) / len(main)


def _habit(done, total, target, minimum, impact, ev):
    value = done / total if total else None
    return {"value": round(value, 3) if value is not None else None, "sample": total,
            "target": target, "min": minimum,
            "eligible": total >= minimum and value is not None and value < target,
            "impactUsd": round(impact, 4), "evidence": ev, "done": done, "total": total}


def habits(sessions, start, end, openings, stale, fresh, row):
    """-> ({habit id: status}, {evidence id: evidence}) for one week."""
    owner = {r["id"]: s for s in sessions.values() for r in s["requests"]}
    after = {}
    for s in sessions.values():
        ps = prompts_of(s)
        for k, r in enumerate(ps):
            after[r["id"]] = ps[k + 1:]
    out, ev = {}, {}

    def keep(e):
        ev[e["id"]] = e
        return [e["id"]]

    # H1 fresh-start
    st = [r for r in stale if in_window(r["at"], start, end)]
    fr = [t for t in fresh if in_window(t, start, end)]
    costs = [(carried(owner[r["id"]], r), r) for r in st]
    ids = []
    if costs:
        cost, r = max(costs, key=lambda x: x[0])
        s = owner[r["id"]]
        ids = keep(evidence("fresh-start", s, r, usd=cost, contextK=round(r["ctx0"] / 1000),
                            promptsAfter=1 + len(after.get(r["id"], []))))
    out["fresh-start"] = _habit(len(fr), len(fr) + len(st), 0.7, 3, sum(c for c, _ in costs), ids)

    week_openings = [r for r in openings if in_window(r["at"], start, end)]
    # H2 point-to-place
    filework = [r for r in week_openings if r["read"] or r["edited"]]
    missing = [r for r in filework if not r["flags"].get("place")]
    impact = sum(r["search"] * avg_call_cost(owner[r["id"]]) for r in missing)
    ids = []
    if missing:
        r = max(missing, key=lambda x: x["search"])
        if r["search"] > 0:
            ids = keep(evidence("point-to-place", owner[r["id"]], r, steps=r["search"]))
    out["point-to-place"] = _habit(len(filework) - len(missing), len(filework), 0.5, 5, impact, ids)

    # H3 say-done
    no_done = [r for r in week_openings if not r["flags"].get("done")]
    worst = [r for r in no_done if r["run"] >= 2]
    impact = sum(r["cost"] + sum(p["cost"] for p in after.get(r["id"], [])[:r["run"]]) for r in worst)
    ids = []
    if worst:
        r = max(worst, key=lambda x: x["run"])
        ids = keep(evidence("say-done", owner[r["id"]], r, corrections=r["run"]))
    out["say-done"] = _habit(len(week_openings) - len(no_done), len(week_openings), 0.4, 5, impact, ids)

    # H4 check-work
    code = [r for s in sessions.values() for r in s["requests"]
            if in_window(r["at"], start, end) and not r["local"] and r["edited"] > 0]
    unchecked = [r for r in code if not r["checked"] and r["corrected"]]
    follow = [(after[r["id"]][0]["cost"] if after.get(r["id"]) else 0.0, r) for r in unchecked]
    ids = []
    if follow:
        cost, r = max(follow, key=lambda x: x[0])
        ids = keep(evidence("check-work", owner[r["id"]], r, usd=cost, files=r["edited"]))
    out["check-work"] = _habit(sum(1 for r in code if r["checked"]), len(code), 0.6, 5,
                               sum(c for c, _ in follow), ids)

    # H5 plan-big
    big = [r for s in sessions.values() for r in s["requests"]
           if in_window(r["at"], start, end) and not r["local"] and is_big(r)]
    unplanned = [r for r in big if not r["plan"]]
    ids = []
    if unplanned:
        r = max(unplanned, key=lambda x: x["cost"])
        ids = keep(evidence("plan-big", owner[r["id"]], r, usd=r["cost"], files=r["edited"]))
    out["plan-big"] = _habit(len(big) - len(unplanned), len(big), 0.5, 2,
                             sum(r["cost"] for r in unplanned if r["corrected"]), ids)
    return out, ev


def best_prompt(sessions, start, end, openings):
    """SPEC.md §10.1: the week's strongest opening prompt (names a place, says
    what done is, no correction, no interrupt), as evidence with its excerpt."""
    owner = {r["id"]: s for s in sessions.values() for r in s["requests"]}
    good = [r for r in openings if in_window(r["at"], start, end) and r.get("excerpt")
            and r["flags"].get("place") and r["flags"].get("done")
            and not r["corrected"] and not r["interrupted"]]
    if not good:
        return None
    r = min(good, key=lambda x: (x["run"] + (1 if x["next"] is not None else 0), x["cost"]))
    return evidence("best-prompt", owner[r["id"]], r, usd=r["cost"], followUps=1 if r["next"] is not None else 0)


# -- features and levels

def features(sessions, rows, fs):
    """-> {feature: {"firstSeen", "lastSeen", "count"}} over everything seen:
    the logs on disk, the frozen weeks before them, and the files on disk."""
    seen = {}

    def hit(name, at, n=1):
        if not at:
            return
        f = seen.setdefault(name, {"firstSeen": at, "lastSeen": at, "count": 0})
        f["firstSeen"] = min(f["firstSeen"], at)
        f["lastSeen"] = max(f["lastSeen"], at)
        f["count"] += n

    for s in sessions.values():
        for r in s["requests"]:
            for name in r["feats"]:
                hit(name, r["at"])
        for name, (n, first, last) in s["feats"].items():
            hit(name, first, n)
            hit(name, last, 0)
        if "--claude-worktrees-" in s["project"] or "/.claude/worktrees/" in (s.get("cwd") or ""):
            hit("worktrees", s["first"])
    for row in rows:
        for name, n in (row.get("features") or {}).items():
            if n:
                hit(name, row["start"], 0)
        for habit, feature in (("fresh-start", "fresh-start"), ("check-work", "ask-checks")):
            h = (row.get("habits") or {}).get(habit) or {}
            if h.get("value") is not None and h.get("sample", 0) >= h.get("min", 1) \
                    and h["value"] >= h.get("target", 1):
                hit(feature, row["start"], 0)
    # Two sessions busy within the same ten minutes
    timeline = sorted((r["at"], s["id"], s["first"], s["last"])
                      for s in sessions.values() for r in s["requests"])
    for (a, sa, _, _), (b, sb, fb, lb) in zip(timeline, timeline[1:]):
        if sa != sb and b - a <= PARALLEL_MS and fb <= a <= lb:
            hit("parallel", b)
    for name in ("claude-md", "allow-rules", "hooks"):
        if fs.get(name):
            hit(name, fs[name], 0)
    return seen


def level(seen):
    """The highest level L where every level up to L is at least 60% adopted."""
    reached = 0
    for lvl in (1, 2, 3):
        names = [n for n, l in FEATURES if l == lvl]
        if sum(1 for n in names if n in seen) / len(names) >= 0.6:
            reached = lvl
        else:
            break
    return reached


def up_next(seen, lvl, row):
    """The feature to suggest next: the first one not yet used at the next
    level that this week's evidence points to; failing that, the first one."""
    target = min(3, lvl + 1)
    evidence_for = {
        "claude-md": row["memory"]["discoveryEpisodes"] > 0 or row["memory"]["wrongToolFirst"] > 0,
        "at-mention": row["prompts"]["opening"] > row["prompts"]["namesPlace"],
        "image": row["prompts"]["images"] == 0 and row["together"]["corrections"] > 0,
        "interrupt": row["together"]["rejections"] > 0,
        "fresh-start": row["context"]["stale"] > 0 or row["context"]["oversizedSessions"] > 0,
        "ask-checks": row["work"]["codePrompts"] > row["work"]["checked"],
        "plan-mode": row["work"]["bigChanges"] > row["work"]["bigChangesPlanned"],
        "compact": row["context"]["oversizedSessions"] > 0,
        "subagents": row["usage"]["contextPerCall"]["p90"] >= 200_000,
        "allow-rules": row["together"]["rejections"] > 0,
        "parallel": row["volume"]["sessions"] >= 5,
    }
    candidates = [n for n, l in FEATURES if l <= target and n not in seen]
    for name in candidates:
        if evidence_for.get(name):
            return {"feature": name, "reason": name}
    return {"feature": candidates[0], "reason": None} if candidates else None


# -- tips (SPEC.md §9.3)

TIP_LEVEL = {
    "rewarm-after-break": 2, "newer-model": 1, "smaller-model": 2, "effort-match": 2,
    "fast-premium": 2, "approvals-to-allowlist": 2, "bypass-to-auto": 1, "undo-with-rewind": 1,
    "screenshot-for-ui": 1, "explore-with-subagent": 2, "compaction-pressure": 2,
    "polling-to-loop": 3, "parallel-worktrees": 3, "claude-md-too-long": 2,
}
TIP_CATEGORY = {
    "rewarm-after-break": "cost", "newer-model": "cost", "smaller-model": "cost", "effort-match": "cost",
    "fast-premium": "cost", "approvals-to-allowlist": "flow", "bypass-to-auto": "safety",
    "undo-with-rewind": "flow", "screenshot-for-ui": "prompt", "explore-with-subagent": "context",
    "compaction-pressure": "context", "polling-to-loop": "automation", "parallel-worktrees": "flow",
    "claude-md-too-long": "setup",
}
TIP_CONFIDENCE = {
    "rewarm-after-break": 1.0, "newer-model": 1.0, "smaller-model": 0.7, "effort-match": 0.5,
    "fast-premium": 1.0, "approvals-to-allowlist": 1.0, "bypass-to-auto": 1.0, "undo-with-rewind": 0.7,
    "screenshot-for-ui": 0.5, "explore-with-subagent": 0.7, "compaction-pressure": 1.0,
    "polling-to-loop": 0.7, "parallel-worktrees": 0.5, "claude-md-too-long": 1.0,
}
TIP_CONFLICTS = {"compaction-pressure": ["fresh-start"], "explore-with-subagent": ["point-to-place"]}


def priced_as(model, uncached, read, write, output, w1h):
    p = PRICES.get(model) or price_for(model)
    if not p:
        return 0.0
    return (uncached * p[0] + read * p[2] + write * (p[4] if w1h else p[3]) + output * p[1]) / 1e6


def _tip(tid, row, impact_usd=None, count=0, threshold=1, ev=None, **numbers):
    week_usd = row["cost"]["usd"]
    if impact_usd is not None:
        impact = min(1.0, impact_usd / max(5.0, 0.1 * week_usd))
    else:
        impact = 0.5 * min(1.0, count / max(1, threshold))
    return {"id": tid, "family": "tip", "level": TIP_LEVEL[tid], "category": TIP_CATEGORY[tid],
            "score": round(impact * TIP_CONFIDENCE[tid], 4),
            "impactUsd": round(impact_usd, 4) if impact_usd is not None else None,
            "count": count, "evidence": ev or [], "numbers": numbers,
            "conflicts": TIP_CONFLICTS.get(tid, [])}


def tips(sessions, start, end, row, seen, claude_md):
    """-> ([tip candidate], {evidence id: evidence}) for one week."""
    out, ev = [], {}
    reqs = [(s, r) for s in sessions.values() for r in s["requests"]
            if in_window(r["at"], start, end) and not r["local"]]
    calls = [(s, c) for s in sessions.values() for c in s["calls"] if in_window(c[C_TS], start, end)]

    def keep(e):
        ev[e["id"]] = e
        return [e["id"]]

    # rewarm-after-break
    c = row["cost"]
    if c["rewarmEvents"] >= 2 and c["rewarmUsd"] >= 2:
        worst = max(((s, r) for s, r in reqs if r["rewarm"] > 0), key=lambda x: x[1]["rewarm"], default=None)
        ids = keep(evidence("rewarm-after-break", worst[0], worst[1], usd=worst[1]["rewarm"] * worst[0]["scale"],
                            contextK=round(worst[1]["ctx0"] / 1000))) if worst else []
        out.append(_tip("rewarm-after-break", row, impact_usd=0.9 * c["rewarmUsd"], ev=ids,
                        usd=c["rewarmUsd"], events=c["rewarmEvents"]))

    # newer-model
    week = c["usd"] or 0.0
    for key, newer in SUCCESSOR.items():
        mine = [(s, x) for s, x in calls if price_key(x[C_MODEL]) == key]
        spent = sum((x[C_IN] + x[C_OUT]) * s["scale"] for s, x in mine)
        if not week or spent / week < 0.3:
            continue
        cheaper = sum(priced_as(newer, x[C_UNCACHED], x[C_READ], x[C_WRITE], x[C_OUTPUT], x[C_W1H]) * s["scale"]
                      for s, x in mine)
        if cheaper < spent:
            out.append(_tip("newer-model", row, impact_usd=spent - cheaper, model=key, newer=newer,
                            share=round(spent / week, 3), usd=round(spent, 2)))

    # smaller-model, effort-match
    small = []
    for s, r in reqs:
        if r["edited"] or sum(r["tools"].values()) > 3:
            continue
        mine = [x for x in s["calls"] if x[C_REQ] == r["i"] and not x[C_SUB]]
        output = sum(x[C_OUTPUT] for x in mine)
        if output > 1500 or not mine:
            continue
        small.append((s, r, mine, output))
    top = [(s, r, mine) for s, r, mine, _ in small
           if family(max(r["models"], key=r["models"].get) if r["models"] else "") in ("opus", "fable")]
    if len(top) >= 10:
        saving = 0.0
        for s, r, mine in top:
            sonnet = sum(priced_as("claude-sonnet-5-5", x[C_UNCACHED], x[C_READ], x[C_WRITE], x[C_OUTPUT],
                                   x[C_W1H]) for x in mine) * s["scale"]
            saving += max(0.0, r["cost"] - r.get("subUsd", 0.0) * s["scale"] - sonnet)
        out.append(_tip("smaller-model", row, impact_usd=saving, count=len(top), small=len(top)))
    share = row["usage"]["effortShare"]
    if share.get("max", 0) >= 0.7 and len(small) >= 10:
        high = sorted(o for s, r, _, o in small if r.get("effort") == "high")
        at_max = [(s, r, o) for s, r, _, o in small if r.get("effort") == "max"]
        saving = None
        if high and at_max:
            base = high[len(high) // 2]
            saving = 0.0
            for s, r, o in at_max:
                p = price_for(max(r["models"], key=r["models"].get) if r["models"] else "")
                if p:
                    saving += max(0, o - base) * p[1] / 1e6 * s["scale"]
        out.append(_tip("effort-match", row, impact_usd=saving, count=len(at_max), threshold=10,
                        share=share.get("max", 0), small=len(small)))

    # fast-premium
    if c["fastUsd"] / 2 >= 5:
        out.append(_tip("fast-premium", row, impact_usd=c["fastUsd"] / 2, usd=round(c["fastUsd"] / 2, 2)))

    # approvals-to-allowlist
    approvals = {}
    for _, r in reqs:
        for key, n in r["approvals"].items():
            approvals[key] = approvals.get(key, 0) + n
    if approvals:
        key, n = max(approvals.items(), key=lambda kv: kv[1])
        if n >= 10:
            out.append(_tip("approvals-to-allowlist", row, count=n, threshold=10, command=key))

    # bypass-to-auto (safety: shown whatever the level)
    if row["safety"]["bypassSessions"] > 0:
        out.append(_tip("bypass-to-auto", row, count=row["safety"]["bypassSessions"], threshold=1,
                        sessions=row["safety"]["bypassSessions"]))

    prompts = [(s, r) for s, r in reqs if r["kind"] == "prompt"]
    # undo-with-rewind
    undo = [(s, r) for s, r in prompts if r["flags"].get("undo")]
    if len(undo) >= 2 and "rewind" not in seen:
        out.append(_tip("undo-with-rewind", row, count=len(undo), threshold=2,
                        ev=keep(evidence("undo-with-rewind", *undo[0]))))
    # screenshot-for-ui
    ui = [(s, r) for s, r in prompts if r["flags"].get("ui") and r["corrected"] and not r["images"]]
    if len(ui) >= 2:
        out.append(_tip("screenshot-for-ui", row, count=len(ui), threshold=2,
                        ev=keep(evidence("screenshot-for-ui", *ui[0]))))
    # explore-with-subagent
    grew = [(s, r) for s, r in reqs if r["ctxFirstEdit"] is not None and r["ctxFirstEdit"] - r["ctx0"] >= 100_000]
    if len(grew) >= 3:
        s, r = max(grew, key=lambda x: x[1]["ctxFirstEdit"] - x[1]["ctx0"])
        out.append(_tip("explore-with-subagent", row, count=len(grew), threshold=3,
                        ev=keep(evidence("explore-with-subagent", s, r,
                                         growthK=round((r["ctxFirstEdit"] - r["ctx0"]) / 1000)))))
    # compaction-pressure
    if row["context"]["compactions"]["auto"] >= 2:
        out.append(_tip("compaction-pressure", row, count=row["context"]["compactions"]["auto"], threshold=2))
    # polling-to-loop
    polls = {}
    for s, r in prompts:
        if r["flags"].get("poll"):
            polls[s["id"]] = polls.get(s["id"], 0) + 1
    if polls and max(polls.values()) >= 3 and "automation" not in seen and "monitor" not in seen:
        out.append(_tip("polling-to-loop", row, count=max(polls.values()), threshold=3))
    # parallel-worktrees
    long_ones = [r for _, r in reqs if r["end"] - r["at"] >= LONG_REQUEST_MS]
    if len(long_ones) >= 5 and "parallel" not in seen:
        out.append(_tip("parallel-worktrees", row, count=len(long_ones), threshold=5))
    # claude-md-too-long
    used = {s["name"] for s, _ in reqs}
    for card in claude_md:
        if card["project"] in used and (card["loadedLines"] > 300 or card["loadedTokens"] > 5000):
            # Claude reads all of it on every call, from the cache at best.
            reread = sum(card["loadedTokens"] * (price_for(x[C_MODEL]) or (0, 0, 0))[2] / 1e6 * s["scale"]
                         for s, x in calls if s["name"] == card["project"] and not x[C_SUB])
            out.append(_tip("claude-md-too-long", row, impact_usd=reread, project=card["project"],
                            lines=card["loadedLines"], tokens=card["loadedTokens"]))
            break
    return out, ev


# -- notices (SPEC.md §9.4)

def notices(sessions, start, end, row):
    out = []
    if row["safety"]["bypassSessions"]:
        out.append({"id": "bypass", "n": row["safety"]["bypassSessions"]})
    days = row["cost"]["byDay"]
    if len(days) >= 2:
        values = sorted(days.values())
        typical = values[len(values) // 2]
        day, spent = max(days.items(), key=lambda kv: kv[1])
        if typical > 0 and spent >= 3 * typical and spent >= 5:
            top = None
            for s in sessions.values():
                cost = sum(r["cost"] for r in s["requests"] if in_window(r["at"], start, end)
                           and _day(r["at"]) == day)
                if cost and (top is None or cost > top[0]):
                    top = (cost, s)
            out.append({"id": "cost-spike", "day": day, "usd": round(spent, 2),
                        "ratio": round(spent / typical, 1), "title": title(top[1]) if top else None})
    if row["together"]["apiErrors"] >= 5:
        out.append({"id": "api-errors", "n": row["together"]["apiErrors"]})
    if row["cost"]["unpriced"]:
        out.append({"id": "unpriced", "models": row["cost"]["unpriced"]})
    return out[:3]


def _day(ms_):
    return datetime.datetime.fromtimestamp(ms_ / 1000).date().isoformat()
