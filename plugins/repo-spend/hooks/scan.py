#!/usr/bin/env python3
"""Sum what Claude Code has spent on one repo, from its transcripts.

Usage:
  scan.py <projects-dir> <repo-slug-prefix> <cache-file> <archive-file> [exclude-session-id]
  scan.py --sweep <projects-dir> <cache-dir> <archive-dir>

Every ~/.claude/projects/<slug>* folder whose slug starts with the repo's
(the repo itself and each of its worktrees) is read. Per session:
  - a `cost-state` record (Claude Code's own /cost ledger) wins when present;
  - otherwise the cost is estimated from each assistant message's usage,
    deduplicated by message id, priced with pricing.py, subagents included.
Per-file results are cached by (size, mtime, PRICES_UPDATED), so only changed
files re-read.

Claude Code deletes old logs (cleanupPeriodDays, 30 days by default). Once
every log of a session is gone, the session moves out of the cache into the
archive: a durable file of weekly totals (dollars, sessions, tokens per model)
that keeps counting for good. The cache can be deleted at any time; the
archive is the only record of those sessions, so it is never thrown away.

Prints one JSON object:
  {"usd", "sessions", "estimatedUsd", "today", "week", "since", "unpriced": [model, ...]}
where "since" is the epoch ms of the oldest message counted (null when none),
so the total can say how far back it reaches, and "unpriced" names models that
used tokens but have no row in PRICES (their tokens count as $0, so the total
is a floor).

--sweep does the same for every repo in the projects folder, at most once
every SWEEP_EVERY, so a repo nobody opens for a month still has its sessions
archived before Claude Code deletes their logs.
"""
import contextlib, datetime, fcntl, json, os, sys, time

# Prices live in pricing.py, a copy of the repository's shared/pricing.py
# (scripts/sync-shared.py keeps them the same). Only sessions WITHOUT a
# cost-state record use them; Claude Code's own ledger wins wherever it exists.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pricing import PRICES_UPDATED, message_cost, tokens_in  # noqa: E402

WORKTREE = "--claude-worktrees-"
# Token counts per model, in this order, in the cache; named in the archive.
TOKEN_KINDS = ("input", "output", "cacheRead", "cacheWrite")
UNDATED = "undated"


def oldest(msgs):
    """The earliest message timestamp (epoch s) among `msgs`, 0 when none has one."""
    return min((m[1] for m in msgs.values() if m[1] > 0), default=0)


def week_of(ts):
    """The week `ts` (epoch s) falls in, as its Monday's local date: "2026-10-05"."""
    if not ts:
        return UNDATED
    day = datetime.date.fromtimestamp(ts)
    return (day - datetime.timedelta(days=day.weekday())).isoformat()


def add_tokens(into, tok):
    """Adds {week: {model: [counts]}} `tok` into `into`, in place."""
    for week, models in tok.items():
        for model, counts in models.items():
            row = into.setdefault(week, {}).setdefault(model, [0] * len(TOKEN_KINDS))
            for i, n in enumerate(counts):
                row[i] += n


def scan_file(path):
    """-> {"ledger": float|None, "msgs": {msg_id: [usd, epoch_s, unpriced_model]},
    "first": epoch_s of the oldest message, 0 when none,
    "tok": {week: {model: [input, output, cache read, cache write]}}}

    unpriced_model is "" when the message was priced (or used no tokens)."""
    ledger = None
    msgs = {}
    usage = {}
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
            usage[mid] = (week_of(ts), model, u)
    tok = {}
    for week, model, u in usage.values():
        counts = [u.get(k) or 0 for k in (
            "input_tokens", "output_tokens",
            "cache_read_input_tokens", "cache_creation_input_tokens")]
        if any(counts):
            add_tokens(tok, {week: {model or "unknown": counts}})
    return {"ledger": ledger, "msgs": msgs, "first": oldest(msgs), "tok": tok}


# The cache is rebuilt from the logs on disk when it is missing or unreadable.
# Since 0.4.0 it no longer holds the only record of deleted logs (the archive
# does), but an older cache still might, so load_cache migrates it forward.
CACHE_VERSION = 6


def load_cache(cache_path):
    """The cache as the current version reads it. A v4 cache gains each entry's
    "first" (a folded entry's is its newest message, the best left); a v5 one
    re-reads the logs still on disk, for their token counts."""
    try:
        with open(cache_path) as fh:
            cache = json.load(fh)
    except (OSError, ValueError):
        return {"v": CACHE_VERSION, "files": {}}
    if cache.get("v") == 4:
        for hit in cache.get("files", {}).values():
            hit.setdefault("first", oldest(hit.get("msgs", {})))
        cache["v"] = 5
    if cache.get("v") == 5:
        for hit in cache.get("files", {}).values():
            if not hit.get("gone"):
                hit.pop("k", None)
            hit.setdefault("tok", {})
        cache["v"] = CACHE_VERSION
    if cache.get("v") != CACHE_VERSION:
        return {"v": CACHE_VERSION, "files": {}}
    return cache


ARCHIVE_VERSION = 1
# How long an archived session's id is remembered, so a log that comes back
# (or a run that stopped between writing the archive and the cache) is not
# counted twice. Long past that, the id is dropped and only the weeks remain.
KEEP_IDS_DAYS = 90


def load_archive(path):
    try:
        with open(path) as fh:
            archive = json.load(fh)
    except FileNotFoundError:
        return {"v": ARCHIVE_VERSION, "weeks": {}, "archived": {}}
    except ValueError:
        # Never overwrite history: keep the unreadable file beside a new one.
        broken = f"{path}.broken-{int(time.time())}"
        os.replace(path, broken)
        print(f"repo-spend: unreadable archive moved to {broken}", file=sys.stderr)
        return {"v": ARCHIVE_VERSION, "weeks": {}, "archived": {}}
    if archive.get("v") != ARCHIVE_VERSION:
        # A newer repo-spend wrote it: leave it alone rather than lose it.
        raise SystemExit(f"repo-spend: {path} is archive v{archive.get('v')}, "
                         f"this version reads v{ARCHIVE_VERSION}; update repo-spend")
    archive.setdefault("weeks", {})
    archive.setdefault("archived", {})
    return archive


def write_json(path, data, **kw):
    """Writes `data` to `path` atomically: readers see the old file or the new."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(data, fh, **kw)
    os.replace(tmp, path)


def new_session():
    return {"ledger": None, "msgs": {}, "first": 0, "tok": {}}


def merge(s, hit):
    """Adds one log's cached results into session `s` (main log or subagent)."""
    if hit["main"] and hit["ledger"] is not None:
        s["ledger"] = hit["ledger"]
    s["msgs"].update(hit["msgs"])
    if hit.get("first") and (not s["first"] or hit["first"] < s["first"]):
        s["first"] = hit["first"]
    add_tokens(s["tok"], hit.get("tok", {}))


def cost_of(s):
    """-> (cost, estimate) of a session, or None when it spent nothing at all."""
    est = sum(m[0] for m in s["msgs"].values())
    if est == 0 and s["ledger"] is None and not any(m[2] for m in s["msgs"].values()):
        return None
    return (s["ledger"] if s["ledger"] is not None else est), est


def archive_session(archive, s):
    """Adds a session whose logs are all gone to the archive's weekly totals.
    Its cost is spread over the weeks its messages fall in, scaled to the
    ledger where one exists, as the today and 7-day figures are."""
    found = cost_of(s)
    if found is None:
        return
    cost, est = found
    estimated = s["ledger"] is None
    weeks = archive["weeks"]

    def bucket(week):
        return weeks.setdefault(week, {
            "usd": 0.0, "estimatedUsd": 0.0, "sessions": 0, "first": 0,
            "unpriced": [], "tokens": {}})

    def spend(week, usd):
        b = bucket(week)
        b["usd"] += usd
        if estimated:
            b["estimatedUsd"] += usd

    if est:
        for c, ts, _ in s["msgs"].values():
            spend(week_of(ts), c * cost / est)
    else:
        spend(week_of(s["first"] or oldest(s["msgs"])), cost)
    for _, ts, model in s["msgs"].values():
        b = bucket(week_of(ts))
        if ts and (not b["first"] or ts < b["first"]):
            b["first"] = ts
        if estimated and model and model not in b["unpriced"]:
            b["unpriced"].append(model)
    home = bucket(week_of(s["first"]))
    home["sessions"] += 1
    if s["first"] and (not home["first"] or s["first"] < home["first"]):
        home["first"] = s["first"]
    for week, models in s["tok"].items():
        named = bucket(week)["tokens"]
        for model, counts in models.items():
            row = named.setdefault(model, dict.fromkeys(TOKEN_KINDS, 0))
            for kind, n in zip(TOKEN_KINDS, counts):
                row[kind] += n


@contextlib.contextmanager
def locked(path, wait=True):
    """Holds `path`.lock while scans of the same repo (other sessions, the
    sweep) would otherwise read and write its files at the same time.
    Yields False instead of waiting when `wait` is off and someone holds it."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path + ".lock", "w") as fh:
        try:
            fcntl.flock(fh, fcntl.LOCK_EX | (0 if wait else fcntl.LOCK_NB))
        except BlockingIOError:
            yield False
            return
        yield True


def scan_repo(projects, prefix, cache_path, archive_path, exclude=""):
    # The lock sits by the cache, so the archive's folder holds archives only.
    with locked(cache_path):
        return _scan_repo(projects, prefix, cache_path, archive_path, exclude)


def _scan_repo(projects, prefix, cache_path, archive_path, exclude):
    cache = load_cache(cache_path)
    files = cache["files"]
    archive = load_archive(archive_path)
    archived = archive["archived"]
    seen = set()
    on_disk = set()  # sessions with at least one log still on disk

    try:
        slugs = os.listdir(projects)
    except FileNotFoundError:
        slugs = []  # a first-ever session: Claude Code has not written a log yet
    for slug in slugs:
        # The repo's own folder and its Claude worktrees' folders.
        if not (slug == prefix or slug.startswith(prefix + WORKTREE)):
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
                on_disk.add(sid)
                hit = files.get(path)
                if not hit or hit.get("k") != key:
                    files[path] = {"k": key, "sid": sid, "main": is_main, **scan_file(path)}

    # Logs Claude Code has deleted. A session moves to the archive once all of
    # its logs are gone; until then (a subagent log outliving its main one,
    # say) what is left of it stays here, still counting.
    gone = {}
    for path, hit in files.items():
        if path not in seen and hit["sid"] != exclude:
            gone.setdefault(hit["sid"], []).append(path)
    now = time.time()
    archive_changed = False
    for sid, paths in gone.items():
        if sid in on_disk:
            for path in paths:
                files[path]["gone"] = True
            continue
        if sid not in archived:
            s = new_session()
            for path in paths:
                merge(s, files[path])
            archive_session(archive, s)
            archived[sid] = int(now)
            archive_changed = True
        for path in paths:
            del files[path]
    for sid, at in list(archived.items()):
        if at < now - KEEP_IDS_DAYS * 86400 and sid not in on_disk:
            del archived[sid]
            archive_changed = True

    # The archive first: should the cache write never happen, the session's
    # id in the archive keeps it from being counted (or archived) twice.
    if archive_changed:
        archive["updated"] = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
        for b in archive["weeks"].values():
            b["usd"] = round(b["usd"], 6)
            b["estimatedUsd"] = round(b["estimatedUsd"], 6)
        archive["weeks"] = dict(sorted(archive["weeks"].items()))
        write_json(archive_path, archive, indent=1)
    write_json(cache_path, cache)

    sessions = {}
    for hit in files.values():
        if hit["sid"] != exclude and hit["sid"] not in archived:
            merge(sessions.setdefault(hit["sid"], new_session()), hit)

    day0 = datetime.datetime.now().replace(
        hour=0, minute=0, second=0, microsecond=0).timestamp()
    total = estimated = today = week = 0.0
    count = 0
    since = 0
    unpriced = set()
    for s in sessions.values():
        found = cost_of(s)
        if found is None:
            continue
        cost, est = found
        count += 1
        if s["first"] and (not since or s["first"] < since):
            since = s["first"]
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
    # Archived weeks count toward the total only: their logs are long gone,
    # older than today and the last 7 days with Claude Code's default cleanup.
    for b in archive["weeks"].values():
        total += b["usd"]
        estimated += b["estimatedUsd"]
        count += b["sessions"]
        unpriced.update(b["unpriced"])
        if b["first"] and (not since or b["first"] < since):
            since = b["first"]
    return {
        "usd": round(total, 4), "sessions": count,
        "estimatedUsd": round(estimated, 4),
        "today": round(today, 4), "week": round(week, 4),
        "since": round(since * 1000) if since else None,
        "unpriced": sorted(unpriced),
    }


SWEEP_EVERY = 20 * 3600


def sweep(projects, cache_dir, archive_dir):
    """Scans every repo in the projects folder, at most once every SWEEP_EVERY
    (across all sessions), so each one's deleted logs reach its archive."""
    stamp = os.path.join(cache_dir, ".last-sweep")
    with locked(stamp, wait=False) as mine:
        if not mine:
            return {"repos": 0, "skipped": "another sweep is running"}
        try:
            if time.time() - os.path.getmtime(stamp) < SWEEP_EVERY:
                return {"repos": 0, "skipped": "swept recently"}
        except OSError:
            pass
        try:
            slugs = [s for s in os.listdir(projects)
                     if os.path.isdir(os.path.join(projects, s))]
        except FileNotFoundError:
            slugs = []
        prefixes = sorted({s.split(WORKTREE)[0] for s in slugs})
        failed = []
        for prefix in prefixes:
            try:
                scan_repo(projects, prefix,
                          os.path.join(cache_dir, prefix + ".json"),
                          os.path.join(archive_dir, prefix + ".json"))
            except (Exception, SystemExit) as error:  # one bad repo stops none of the rest
                failed.append(prefix)
                print(f"repo-spend: sweep of {prefix} failed: {error}", file=sys.stderr)
        with open(stamp, "w") as fh:
            fh.write(datetime.datetime.now().astimezone().isoformat(timespec="seconds") + "\n")
        return {"repos": len(prefixes), "failed": failed}


def main():
    if sys.argv[1] == "--sweep":
        print(json.dumps(sweep(*sys.argv[2:5])))
        return
    projects, prefix, cache_path, archive_path = sys.argv[1:5]
    exclude = sys.argv[5] if len(sys.argv) > 5 else ""
    print(json.dumps(scan_repo(projects, prefix, cache_path, archive_path, exclude)))


if __name__ == "__main__":
    main()
