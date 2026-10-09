#!/usr/bin/env python3
"""coach's scanner: every Claude Code transcript in, one weekly report out.

Usage: scan.py --projects DIR --data DIR [--config-dir DIR] [--home DIR]
               [--exclude PATHS] [--threshold-k N] [--week-start monday|sunday]
               [--excerpts on|off] [--grade-week YYYY-MM-DD] [--now MS] [--full]
               [--progress]

Reads every <projects>/<slug>/**/*.jsonl, caches each file's facts by its
size and mtime in <data>/scan-cache.json, freezes each finished week into
<data>/history.json (so a week outlives Claude Code deleting its logs), and
prints NDJSON on stdout:
  {"progress": [done, total]}  while reading, with --progress
  {"grading": {...}}            with --grade-week: that week's sampled prompts
  {"report": {...}}             last; also kept in <data>/report.json
When another session holds the lock it prints the last report with
"busy": true instead of scanning. SPEC.md has the full picture.
"""
import argparse
import fcntl
import json
import os
import random
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import extract as X  # noqa: E402
import metrics as M  # noqa: E402
import patterns as P  # noqa: E402
import rules as R  # noqa: E402
import suggest as S  # noqa: E402
from pricing import PRICES_UPDATED  # noqa: E402

CACHE_VERSION = 1
HISTORY_VERSION = 1
FREEZE_AFTER_MS = 6 * 3600 * 1000
LOCK_WAIT_S = 3.0
SUMMARY_WEEKS = 26
FULL_WEEKS = 6          # full rows kept in the report, for the pane's week-by-week view
GRADING_SAMPLE = 20


def say(obj):
    sys.stdout.write(json.dumps(obj, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def slug_of(path):
    return re.sub(r"[^A-Za-z0-9]", "-", path)


def write_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(data, fh, separators=(",", ":"))
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)


def read_json(path):
    try:
        with open(path) as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def lock(data):
    """-> the held lock's file, or None when another scan holds it past the wait."""
    fh = open(os.path.join(data, "scan.lock"), "w")
    deadline = time.time() + LOCK_WAIT_S
    while True:
        try:
            fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return fh
        except OSError:
            if time.time() >= deadline:
                fh.close()
                return None
            time.sleep(0.2)


def root_of(cwd, roots):
    """The project a working folder belongs to: the nearest folder above it
    holding .git, a Claude worktree folded into its repo."""
    if not cwd:
        return ""
    if cwd in roots:
        return roots[cwd]
    marker = "/.claude/worktrees/"
    root = cwd
    if marker in cwd:
        root = cwd.split(marker, 1)[0]
    else:
        here = cwd
        for _ in range(40):
            if os.path.exists(os.path.join(here, ".git")):
                root = here
                break
            parent = os.path.dirname(here)
            if parent == here:
                break
            here = parent
    roots[cwd] = root
    return root


# -- reading

def scan_files(args, cache, excluded):
    projects = args.projects
    try:
        slugs = sorted(os.listdir(projects))
    except OSError:
        slugs = []
    found = []
    for slug in slugs:
        if any(slug.startswith(prefix) for prefix in excluded):
            continue
        root = os.path.join(projects, slug)
        for dirpath, _dirs, names in os.walk(root):
            for name in names:
                if name.endswith(".jsonl"):
                    found.append((slug, root, os.path.join(dirpath, name)))
    files = cache["files"]
    seen = set()
    entries = []
    total = len(found)
    for done, (slug, root, path) in enumerate(found, 1):
        rel = os.path.relpath(path, root)
        sid = rel.split(os.sep)[0]
        sid = sid[:-6] if sid.endswith(".jsonl") else sid
        is_main = os.sep not in rel
        try:
            st = os.stat(path)
        except OSError:
            continue
        key = f"{st.st_size}:{int(st.st_mtime)}"
        seen.add(path)
        hit = files.get(path)
        if args.full or not hit or hit.get("k") != key:
            try:
                facts = X.extract(path, sid, slug, is_main, excerpts=args.excerpts == "on")
            except Exception as e:  # one unreadable file never stops the scan
                cache.setdefault("errors", []).append(f"{os.path.basename(path)}: {type(e).__name__}")
                continue
            hit = {"k": key, "sid": sid, "main": is_main, "slug": slug, "facts": facts}
            files[path] = hit
        entries.append({"sid": hit["sid"], "main": hit["main"], "path": path, "facts": hit["facts"]})
        if args.progress and (done % 25 == 0 or done == total):
            say({"progress": [done, total]})
    for path in [p for p in files if p not in seen]:
        del files[path]
    return entries


def load_cache(data, args):
    cache = read_json(os.path.join(data, "scan-cache.json")) or {}
    want = {"v": CACHE_VERSION, "parser": X.PARSER_VERSION, "prices": PRICES_UPDATED,
            "excerpts": args.excerpts}
    if any(cache.get(k) != v for k, v in want.items()) or not isinstance(cache.get("files"), dict):
        cache = dict(want, files={})
    cache["errors"] = []
    return cache


def load_history(data):
    path = os.path.join(data, "history.json")
    history = read_json(path)
    if history is None and os.path.exists(path):
        os.replace(path, f"{path}.broken-{int(time.time())}")
        history = read_json(path + ".bak")
        if history is not None:
            history["restored"] = True
    if not isinstance(history, dict) or history.get("v") != HISTORY_VERSION:
        history = {"v": HISTORY_VERSION, "weeks": {}}
    return history


def save_history(data, history):
    path = os.path.join(data, "history.json")
    if os.path.exists(path):
        try:
            with open(path, "rb") as a, open(path + ".bak.tmp", "wb") as b:
                b.write(a.read())
            os.replace(path + ".bak.tmp", path + ".bak")
        except OSError:
            pass
    history.pop("restored", None)
    write_json(path, history)


# -- disk facts the features need

def disk_features(sessions, home, config, now):
    """-> {feature: mtime ms} for what lives in files: CLAUDE.md, allow rules, hooks."""
    out = {}
    roots = {s["root"] for s in sessions.values() if s.get("root") and s["last"] >= now - 28 * M.DAY_MS}

    def mtime(path):
        try:
            return int(os.stat(path).st_mtime * 1000)
        except OSError:
            return 0

    for path in [os.path.join(config, "CLAUDE.md")] + [
            os.path.join(r, name) for r in roots for name in ("CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md")]:
        t = mtime(path)
        if t:
            out["claude-md"] = max(out.get("claude-md", 0), t)
    settings = [os.path.join(config, "settings.json"), os.path.join(config, "settings.local.json")] + [
        os.path.join(r, ".claude", name) for r in roots for name in ("settings.json", "settings.local.json")]
    for path in settings:
        data = read_json(path)
        if not isinstance(data, dict):
            continue
        t = mtime(path)
        allow = (data.get("permissions") or {}).get("allow") if isinstance(data.get("permissions"), dict) else None
        if allow:
            out["allow-rules"] = max(out.get("allow-rules", 0), t)
        if data.get("hooks"):
            out["hooks"] = max(out.get("hooks", 0), t)
    return out


# -- weeks

def summary(row):
    prompts = row["volume"]["prompts"]
    per10 = (lambda n: round(10 * n / prompts, 2)) if prompts >= 10 else (lambda n: None)
    return {
        "week": row["week"], "start": row["start"], "partial": row["coverage"]["partial"],
        "metricsVersion": row["metricsVersion"], "usd": row["cost"]["usd"], "prompts": prompts,
        "sessions": row["volume"]["sessions"], "costPerPrompt": row["cost"]["perPrompt"]["median"],
        "correctionsPer10": per10(row["together"]["corrections"]),
        "interruptsPer10": per10(row["together"]["interrupts"]),
        "oversized": row["context"]["oversizedSessions"],
        "discoverySteps": (row.get("memory") or {}).get("discoverySteps", 0),
        "repeatedPrompts": (row.get("repeats") or {}).get("prompts", 0),
        "habits": {k: v.get("value") for k, v in (row.get("habits") or {}).items()},
    }


def full_row(sessions, start, end, ctx, first_at, claude_md):
    row = M.week_row(sessions, start, end, ctx)
    if first_at and first_at > start + M.DAY_MS:
        row["coverage"] = {"partial": True, "firstLogAt": first_at}
    habits, ev = R.habits(sessions, start, end, ctx["openings"], ctx["stale"], ctx["fresh"], row)
    row["habits"] = habits
    row["evidence"].update(ev)
    seen = ctx.get("seen") or {}
    tips, ev = R.tips(sessions, start, end, row, seen, claude_md)
    row["tips"] = tips
    row["evidence"].update(ev)
    row["notices"] = R.notices(sessions, start, end, row)
    best = R.best_prompt(sessions, start, end, ctx["openings"])
    row["best"] = best["id"] if best else None
    if best:
        row["evidence"][best["id"]] = best
    return row


# -- grading input (phase 2: the hooks module grades with $.model.complete)

def grading_input(sessions, row, week):
    """Up to 20 opening prompts of the week, read whole from their logs."""
    start, end = row["start"], row["end"]
    owner = {}
    openings = []
    for s in sessions.values():
        ps = M.prompts_of(s)
        for k, r in enumerate(ps):
            owner[r["id"]] = (s, ps[k + 1:])
            if (k == 0 or r["afterClear"]) and M.in_window(r["at"], start, end) and r["words"] >= 5:
                openings.append(r)
    rng = random.Random(week)
    rng.shuffle(openings)
    by_follow = sorted(openings, key=lambda r: -(r["run"] + (1 if r["next"] is not None else 0)))
    picked = []
    for r in by_follow[:max(3, min(10, GRADING_SAMPLE // 2))] + openings:
        if r not in picked and len(picked) < GRADING_SAMPLE:
            picked.append(r)
    wanted = {}
    for r in picked:
        s, rest = owner[r["id"]]
        follows = [p for p in rest[:3] if p["at"] - r["end"] <= 2 * 3600 * 1000]
        wanted.setdefault(s["path"], {})[r["id"]] = "prompt"
        for p in follows:
            wanted[s["path"]][p["id"]] = r["id"]
    texts = {}
    for path, ids in wanted.items():
        try:
            with open(path, errors="ignore") as fh:
                for line in fh:
                    if '"user"' not in line:
                        continue
                    try:
                        d = json.loads(line)
                    except ValueError:
                        continue
                    if d.get("uuid") in ids:
                        texts[d["uuid"]] = X.text_of((d.get("message") or {}).get("content"))
        except OSError:
            continue
    out = []
    for r in picked:
        s, rest = owner[r["id"]]
        follows = [P.scrub(texts.get(p["id"], ""))[:300] for p in rest[:3]
                   if p["id"] in texts and p["at"] - r["end"] <= 2 * 3600 * 1000]
        if r["id"] in texts:
            out.append({"id": r["id"], "project": s["name"], "text": P.scrub(texts[r["id"]])[:2000],
                        "followUps": len(follows), "corrections": r["run"], "next": follows})
    return {"week": week, "prompts": out}


# -- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--projects", required=True)
    ap.add_argument("--data", required=True)
    ap.add_argument("--config-dir", default=os.path.expanduser("~/.claude"))
    ap.add_argument("--home", default=os.path.expanduser("~"))
    ap.add_argument("--exclude", default="")
    ap.add_argument("--threshold-k", type=int, default=300)
    ap.add_argument("--week-start", choices=("monday", "sunday"), default="monday")
    ap.add_argument("--excerpts", choices=("on", "off"), default="on")
    ap.add_argument("--grade-week", default="")
    ap.add_argument("--now", type=int, default=0)
    ap.add_argument("--full", action="store_true")
    ap.add_argument("--progress", action="store_true")
    args = ap.parse_args()
    now = args.now or int(time.time() * 1000)
    os.makedirs(args.data, mode=0o700, exist_ok=True)

    held = lock(args.data)
    if held is None:
        last = read_json(os.path.join(args.data, "report.json"))
        say({"report": last, "busy": True})
        return 0

    excluded = [slug_of(p.strip().rstrip("/")) for p in args.exclude.split(",") if p.strip()]
    cache = load_cache(args.data, args)
    entries = scan_files(args, cache, excluded)
    errors = list(cache.get("errors") or [])
    cache.pop("errors", None)
    write_json(os.path.join(args.data, "scan-cache.json"), cache)

    sessions = M.build(entries)
    roots = {}
    for s in sessions.values():
        s["root"] = root_of(s.get("cwd") or "", roots)
        s["name"] = M.project_name(s)
    openings, stale, fresh = R.switches(sessions)
    firsts = [s["first"] for s in sessions.values() if s["first"]]
    history = load_history(args.data)
    restored = bool(history.get("restored"))
    frozen = history["weeks"]
    kept = [w.get("firstAt") or w["start"] for w in frozen.values()]
    first_at = min(firsts + kept) if firsts or kept else None
    data_first = min(firsts) if firsts else None

    # Suggestions look at the last 28 days, whatever the week.
    last7 = sum((c[X.C_IN] + c[X.C_OUT]) * s["scale"] for s in sessions.values() for c in s["calls"]
                if c[X.C_TS] >= now - 7 * M.DAY_MS)
    claude_md, covered, md_ev = S.claude_md_cards(sessions, now, args.home, last7)
    logged = sorted({r["command"] for s in sessions.values() for r in s["requests"]
                     if r["command"] and r["command"] not in X.BUILTIN_COMMANDS})
    skills, adopted, sk_ev, repeat_ids = S.skill_cards(sessions, now, args.home, last7, logged)
    corrections = set()
    for card in claude_md:
        for line in card["lines"]:
            if line["source"] == "S4":
                corrections.update(line.get("requests") or [])
    ctx = {"thresholdK": args.threshold_k, "openings": openings, "stale": stale, "fresh": fresh,
           "repeats": {"prompts": repeat_ids, "corrections": corrections}}

    rows = {}
    present = set(sessions)
    weeks = M.weeks_between(first_at, now, args.week_start) if first_at else []
    seen_rows = [w for w in frozen.values()]
    ctx["seen"] = R.features(sessions, seen_rows, {})
    for start, end in weeks:
        wid = M.week_id(start)
        old = frozen.get(wid)
        if old and old.get("frozen"):
            if old.get("metricsVersion") == M.METRICS_VERSION or not set(old.get("sessionIds", [])) <= present:
                rows[wid] = old
                continue
        if data_first is None or end <= data_first:
            if old:
                rows[wid] = old
            continue
        row = full_row(sessions, start, end, ctx, first_at if start <= first_at < end else None, claude_md)
        if now >= end + FREEZE_AFTER_MS:
            row["frozen"] = True
            frozen[wid] = row
        rows[wid] = row
    for wid, row in frozen.items():
        rows.setdefault(wid, row)
    save_history(args.data, history)

    ordered = [rows[k] for k in sorted(rows)]
    current = next((r for r in ordered if r["start"] <= now < r["end"]), None)
    full = [r for r in ordered if r["end"] <= now]
    previous = full[-1] if full else None
    recent = None
    if previous is None or (previous["coverage"]["partial"]
                            and (previous["end"] - (previous["coverage"]["firstLogAt"] or 0)) < 5 * M.DAY_MS):
        recent = full_row(sessions, now - 7 * M.DAY_MS, now, ctx, None, claude_md)
        recent["week"] = "recent"
    seen = R.features(sessions, ordered, disk_features(sessions, args.home, args.config_dir, now))
    lvl = R.level(seen)
    shown = recent or previous or current
    report = {
        "generatedAt": now, "parserVersion": X.PARSER_VERSION, "metricsVersion": M.METRICS_VERSION,
        "weekStart": args.week_start, "thresholdK": args.threshold_k, "excerpts": args.excerpts == "on",
        "coverage": {"since": first_at, "logsSince": data_first,
                     "files": len(entries), "sessions": len(sessions)},
        "current": current, "previous": previous, "recent": recent, "weeks": full[-FULL_WEEKS:],
        "history": [summary(r) for r in ordered[-SUMMARY_WEEKS:]],
        "features": seen, "level": lvl, "upNext": R.up_next(seen, lvl, shown) if shown else None,
        "suggestions": {"claudeMd": claude_md, "claudeMdCovered": covered, "skills": skills,
                        "skillsAdopted": adopted},
        "evidence": {**md_ev, **sk_ev},
        "hints": {"clusters": [{"id": c["id"], "name": c["name"], "count": c["count"],
                                "signature": c["signature"], "existing": (c["existing"] or {}).get("name")}
                               for c in skills[:10]]},
        "live": {
            "lastRequestAt": max((r["at"] for s in sessions.values() for r in s["requests"]), default=None),
            # Each recent session's last activity and context size: the resume-after-break hint.
            "sessions": {s["id"]: [s["last"], s.get("ctxEnd", 0)] for s in sessions.values()
                         if s["last"] >= now - 7 * M.DAY_MS},
        },
        "restored": restored, "errors": errors[:20],
    }
    if args.grade_week:
        row = rows.get(args.grade_week)
        if row:
            say({"grading": grading_input(sessions, row, args.grade_week)})
    write_json(os.path.join(args.data, "report.json"), report)
    say({"report": report})
    held.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
