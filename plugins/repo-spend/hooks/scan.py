#!/usr/bin/env python3
"""Sum what Claude Code has spent on one repo, from its transcripts.

Usage:
  scan.py <projects-dir> <repo-root> <cache-dir> <data-dir> [live-session-id]

Every log in every ~/.claude/projects folder is read, because a session
launched in one repo can do its work in another (SPEC.md §4):
  - a turn that edits files goes to the repos it edited, split by edit count;
  - any other message goes to the repo its `cwd` was in;
  - a message with neither goes to the repo the session was launched in.
Folders resolve to repos by reading .git on disk (repos.py), so a deleted
worktree still lands on its repo. Per session, a `cost-state` record (Claude
Code's own /cost ledger) wins when present and is split by the estimates'
shares; otherwise the cost is estimated from each assistant message's usage,
deduplicated by message id, priced with pricing.py, subagents included.

Files, all under v2/ so 0.4.0 and older keep theirs untouched (SPEC.md §7):
  <cache-dir>/v2/folders/<project-folder>.json  one cache per project folder,
      by (size, mtime, PRICES_UPDATED), so only changed logs are re-read and
      only changed folders rewritten
  <cache-dir>/v2/roots.json                     folder -> repo
  <data-dir>/v2/<repo-slug>.json                the archive: weekly totals of
      sessions whose logs Claude Code has deleted (cleanupPeriodDays), the
      only record of them, so it is never thrown away
  <data-dir>/v2/.imported                       the one-time copy from 0.4.0 is done

Prints one JSON object:
  {"usd", "sessions", "estimatedUsd", "today", "week", "since", "unpriced": [model, ...], "live"}
where "since" is the epoch ms of the oldest message counted (null when none),
"unpriced" names models that used tokens but have no row in PRICES (their
tokens count as $0, so the total is a floor), and "live" is the share of the
live session's cost that belongs to this repo, 0 to 1. The live session is
left out of the rest: the band reads its cost from Claude Code directly.

--sweep, which archived every repo once a day before 0.5, is no longer
needed: every scan reads every log. It exits 0 and does nothing.
"""
import contextlib, datetime, fcntl, json, os, re, sys, time

# Prices live in pricing.py and folder-to-repo in repos.py, copies of the
# repository's shared/ files (scripts/sync-shared.py keeps them the same).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pricing import PRICES_UPDATED, message_cost, tokens_in  # noqa: E402
from repos import find_root  # noqa: E402

WORKTREE = "--claude-worktrees-"
# Token counts per model, in this order, in the cache; named in the archive.
TOKEN_KINDS = ("input", "output", "cacheRead", "cacheWrite")
UNDATED = "undated"
# The tools that change a file, and the input naming it. Reads, searches and
# shell commands never move cost: they say little about where the work was.
EDIT_TOOLS = {"Edit": "file_path", "MultiEdit": "file_path", "Write": "file_path",
              "NotebookEdit": "notebook_path"}
FOLDER_VERSION = 1
ARCHIVE_VERSION = 1
# How long an archived session's id is remembered, so a log that comes back
# is not counted twice. Long past that, the id is dropped and only the weeks remain.
KEEP_IDS_DAYS = 90
# A folder found in no repo is looked at again after this long.
RECHECK_S = 86400


def slug_of(path):
    """Claude Code's project-folder name for a path, and a repo's archive name."""
    return re.sub(r"[^A-Za-z0-9]", "-", path)


def week_of(ts):
    """The week `ts` (epoch s) falls in, as its Monday's local date: "2026-10-05"."""
    if not ts:
        return UNDATED
    day = datetime.date.fromtimestamp(ts)
    return (day - datetime.timedelta(days=day.weekday())).isoformat()


def oldest(msgs):
    """The earliest message timestamp (epoch s) among `msgs`, 0 when none has one."""
    return min((m[1] for m in msgs.values() if m[1] > 0), default=0)


def add_counts(row, counts, factor=1.0):
    for i, n in enumerate(counts):
        row[i] += n * factor


# -- reading one log

def is_prompt(d):
    """A user line the person wrote (or a command they ran): it starts a turn.
    Tool results come back as user lines too, and don't."""
    if d.get("isMeta"):
        return False
    content = (d.get("message") or {}).get("content")
    if isinstance(content, str):
        return True
    return isinstance(content, list) and not any(
        isinstance(b, dict) and b.get("type") == "tool_result" for b in content)


def scan_file(path):
    """-> {"ledger": float|None, "launch": first cwd|None,
    "places": [{"cwd"?: folder, "edits"?: {folder: n}}],
    "msgs": {msg_id: [usd, epoch_s, unpriced_model, place_index]},
    "first": epoch_s of the oldest message, 0 when none,
    "tok": {week: {place_index: {model: [input, output, cache read, cache write]}}}}

    A place is where a message's cost goes, still as folders: the turn's
    edited folders when it edited any, else the message's cwd. unpriced_model
    is "" when the message was priced (or used no tokens)."""
    ledger = None
    launch = None
    places, place_at = [], {}
    msgs, usage = {}, {}
    turn = {}       # this turn's messages: id -> (usd, ts, unpriced, cwd, model, usage)
    edits = {}      # this turn's edited folders -> edit calls
    seen_edits = set()

    def place(p):
        key = json.dumps(p, sort_keys=True)
        if key not in place_at:
            place_at[key] = len(places)
            places.append(p)
        return place_at[key]

    def close_turn():
        for mid, (cost, ts, unpriced, cwd, model, u) in turn.items():
            p = {"cwd": cwd} if cwd else {}
            if edits:
                p["edits"] = dict(edits)
            i = place(p)
            msgs[mid] = [cost, ts, unpriced, i]
            usage[mid] = (week_of(ts), i, model, u)
        turn.clear()
        edits.clear()

    with open(path, errors="ignore") as fh:
        for line in fh:
            # Most lines are tool results, often large: skip them unparsed.
            if not ('"cost-state"' in line
                    or ('"usage"' in line and '"assistant"' in line)
                    or ('"user"' in line and '"tool_result"' not in line)):
                continue
            try:
                d = json.loads(line)
            except ValueError:
                continue
            if not isinstance(d, dict):
                continue
            kind = d.get("type")
            if launch is None and d.get("cwd"):
                launch = d["cwd"]
            if kind == "cost-state":
                ledger = float(d.get("totalCostUSD") or 0)
                continue
            if kind == "user":
                if is_prompt(d):
                    close_turn()
                continue
            if kind != "assistant":
                continue
            m = d.get("message") or {}
            content = m.get("content")
            for b in content if isinstance(content, list) else []:
                if not (isinstance(b, dict) and b.get("type") == "tool_use"
                        and b.get("name") in EDIT_TOOLS):
                    continue
                target = (b.get("input") or {}).get(EDIT_TOOLS[b["name"]])
                ident = b.get("id") or json.dumps(b.get("input"), sort_keys=True)
                if isinstance(target, str) and os.path.isabs(target) and ident not in seen_edits:
                    seen_edits.add(ident)
                    folder = os.path.dirname(os.path.normpath(target))
                    edits[folder] = edits.get(folder, 0) + 1
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
            turn[mid] = (cost, ts, unpriced, d.get("cwd") or "", model, u)
    close_turn()

    tok = {}
    for week, i, model, u in usage.values():
        counts = [u.get(k) or 0 for k in (
            "input_tokens", "output_tokens",
            "cache_read_input_tokens", "cache_creation_input_tokens")]
        if any(counts):
            row = tok.setdefault(week, {}).setdefault(str(i), {}).setdefault(
                model or "unknown", [0] * len(TOKEN_KINDS))
            add_counts(row, counts)
    return {"ledger": ledger, "launch": launch, "places": places, "msgs": msgs,
            "first": oldest(msgs), "tok": tok}


# -- files

def read_json(path):
    with open(path) as fh:
        return json.load(fh)


def write_json(path, data, **kw):
    """Writes `data` to `path` atomically: readers see the old file or the new."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(data, fh, **kw)
    os.replace(tmp, path)


@contextlib.contextmanager
def locked(path):
    """Holds `path` while another scan (another session's band) would
    otherwise read and write the same files at the same time."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        fcntl.flock(fh, fcntl.LOCK_EX)
        yield


def new_archive():
    return {"v": ARCHIVE_VERSION, "weeks": {}, "archived": {}}


def load_archive(path):
    try:
        archive = read_json(path)
    except FileNotFoundError:
        return new_archive()
    except ValueError:
        # Never overwrite history: keep the unreadable file beside a new one.
        broken = f"{path}.broken-{int(time.time())}"
        os.replace(path, broken)
        print(f"repo-spend: unreadable archive moved to {broken}", file=sys.stderr)
        return new_archive()
    if archive.get("v") != ARCHIVE_VERSION:
        # A newer repo-spend wrote it: leave it alone rather than lose it.
        raise SystemExit(f"repo-spend: {path} is archive v{archive.get('v')}, "
                         f"this version reads v{ARCHIVE_VERSION}; update repo-spend")
    archive.setdefault("weeks", {})
    archive.setdefault("archived", {})
    return archive


class Roots:
    """Folder -> repo root, kept in roots.json. A folder resolved once keeps
    its repo after it is deleted; one in no repo is looked at again daily."""

    def __init__(self, path, home):
        self.path, self.home, self.changed = path, home, False
        try:
            self.folders = read_json(path)["folders"]
        except (OSError, ValueError, KeyError, TypeError):
            self.folders = {}
        self.now = time.time()

    def root(self, folder):
        hit = self.folders.get(folder)
        if hit and (hit[0] or self.now - hit[1] < RECHECK_S):
            return hit[0]
        found = find_root(folder, self.home)
        self.folders[folder] = [found, int(self.now)]
        self.changed = True
        return found

    def repo(self, folder):
        """The repo `folder` is in, as its slug, or None."""
        found = self.root(folder) if folder else None
        return slug_of(found) if found else None

    def save(self):
        if self.changed:
            write_json(self.path, {"v": 1, "folders": self.folders})


# -- sessions

def weights_of(place, roots, launch):
    """Where one place's cost goes: {repo slug: share}, shares adding up to 1."""
    if "key" in place:
        return {place["key"]: 1.0}
    edited = {}
    for folder, n in (place.get("edits") or {}).items():
        repo = roots.repo(folder)
        if repo:
            edited[repo] = edited.get(repo, 0) + n
    if edited:
        total = sum(edited.values())
        return {repo: n / total for repo, n in edited.items()}
    return {roots.repo(place.get("cwd")) or launch: 1.0}


def launch_of(entries, roots):
    """The repo a session was launched in: its main log's first cwd, resolved;
    the folder itself when it is in no repo; the project folder without logs."""
    ordered = sorted(entries, key=lambda e: not e[2]["main"])
    for _folder, _path, e in ordered:
        if e.get("launchKey"):
            return e["launchKey"]
        if e.get("launch"):
            return roots.repo(e["launch"]) or slug_of(e["launch"])
    return ordered[0][0].split(WORKTREE)[0]


def build(entries, roots):
    """One session from its logs' cache entries (main log and subagents)."""
    s = {"ledger": None, "msgs": {}, "tok": [], "first": 0, "copiedFirst": 0,
         "launch": launch_of(entries, roots)}
    for _folder, _path, e in entries:
        if e["main"] and e["ledger"] is not None:
            s["ledger"] = e["ledger"]
        ws = [weights_of(p, roots, s["launch"]) for p in e.get("places", [])]
        launch = {s["launch"]: 1.0}
        for mid, m in e["msgs"].items():
            i = m[3] if len(m) > 3 else -1
            s["msgs"][mid] = (m[0], m[1], m[2], ws[i] if 0 <= i < len(ws) else launch)
        for week, by_place in e.get("tok", {}).items():
            for i, models in by_place.items():
                i = int(i)
                w = ws[i] if 0 <= i < len(ws) else launch
                for model, counts in models.items():
                    s["tok"].append((week, w, model, counts))
        if e.get("first") and (not s["first"] or e["first"] < s["first"]):
            s["first"] = e["first"]
        # 0.4.0 folded some sessions' messages into one total, keeping only the
        # newest time: the entry's "first" still knows when it started.
        if e.get("launchKey") and e.get("first"):
            s["copiedFirst"] = min(filter(None, (s["copiedFirst"], e["first"])))
    return s


def split(s):
    """-> {repo slug: share} for every repo the session spent in, where a share
    is {"usd", "rows": [(usd, ts, unpriced)], "unpriced", "first", "tok"}.
    A ledger is spread over the messages by their estimates, as the today and
    7-day figures are; with nothing priced to spread it by, the launch repo
    takes it all."""
    est = sum(m[0] for m in s["msgs"].values())
    if est == 0 and s["ledger"] is None and not any(m[2] for m in s["msgs"].values()):
        return {}
    scale = s["ledger"] / est if s["ledger"] is not None and est else 1.0
    out = {}

    def share(repo):
        return out.setdefault(repo, {"usd": 0.0, "rows": [], "unpriced": set(),
                                     "first": 0, "tok": {}, "spent": False})

    for usd, ts, unpriced, w in s["msgs"].values():
        for repo, f in w.items():
            sh = share(repo)
            sh["usd"] += usd * f * scale
            sh["rows"].append((usd * f * scale, ts, unpriced))
            if unpriced:
                sh["unpriced"].add(unpriced)
            if ts and (not sh["first"] or ts < sh["first"]):
                sh["first"] = ts
            sh["spent"] = sh["spent"] or usd > 0 or bool(unpriced)
    if est == 0 and s["ledger"] is not None:
        sh = share(s["launch"])
        sh["usd"] += s["ledger"]
        sh["rows"].append((s["ledger"], s["first"], ""))
        sh["first"] = sh["first"] or s["first"]
        sh["spent"] = True
    home = out.get(s["launch"])
    if home and s["copiedFirst"] and (not home["first"] or s["copiedFirst"] < home["first"]):
        home["first"] = s["copiedFirst"]
    for week, w, model, counts in s["tok"]:
        for repo, f in w.items():
            if repo in out:
                row = out[repo]["tok"].setdefault(week, {}).setdefault(
                    model, [0] * len(TOKEN_KINDS))
                add_counts(row, counts, f)
    return {repo: sh for repo, sh in out.items() if sh["spent"]}


def archive_share(archive, sh, estimated):
    """Adds one repo's share of a session whose logs are all gone to that
    repo's weekly totals."""
    weeks = archive["weeks"]

    def bucket(week):
        return weeks.setdefault(week, {
            "usd": 0.0, "estimatedUsd": 0.0, "sessions": 0, "first": 0,
            "unpriced": [], "tokens": {}})

    for usd, ts, unpriced in sh["rows"]:
        b = bucket(week_of(ts))
        b["usd"] += usd
        if estimated:
            b["estimatedUsd"] += usd
            if unpriced and unpriced not in b["unpriced"]:
                b["unpriced"].append(unpriced)
        if ts and (not b["first"] or ts < b["first"]):
            b["first"] = ts
    home = bucket(week_of(sh["first"]))
    home["sessions"] += 1
    for week, models in sh["tok"].items():
        named = bucket(week)["tokens"]
        for model, counts in models.items():
            row = named.setdefault(model, dict.fromkeys(TOKEN_KINDS, 0))
            for kind, n in zip(TOKEN_KINDS, counts):
                row[kind] += round(n)


# -- the one-time copy from 0.4.0 (SPEC.md §8.2)

def load_old_cache(path):
    """0.4.0's cache (v4 to v6), or None."""
    try:
        cache = read_json(path)
    except (OSError, ValueError):
        return None
    if not isinstance(cache, dict) or cache.get("v") not in (4, 5, 6):
        return None
    return cache


def import_old(old_cache_dir, old_data_dir, data_dir, projects, folders, save_folder):
    """Copies 0.4.0's archives, and the cache entries that are the only record
    of logs deleted since its last scan. Reruns from the start if cut short:
    archives are overwritten and entries already copied are skipped."""
    archives = entries = 0
    known = {path for f in folders.values() for path in f["files"]}
    old_archived = {}
    for name in sorted(os.listdir(old_data_dir)) if os.path.isdir(old_data_dir) else []:
        path = os.path.join(old_data_dir, name)
        if not name.endswith(".json") or not os.path.isfile(path):
            continue
        try:
            archive = read_json(path)
        except (OSError, ValueError):
            print(f"repo-spend: {path} is unreadable, not copied", file=sys.stderr)
            continue
        if not isinstance(archive, dict) or archive.get("v") != ARCHIVE_VERSION:
            print(f"repo-spend: {path} is not archive v{ARCHIVE_VERSION}, not copied",
                  file=sys.stderr)
            continue
        write_json(os.path.join(data_dir, name), archive, indent=1)
        old_archived[name[:-5]] = set(archive.get("archived", {}))
        archives += 1

    touched = set()
    for name in sorted(os.listdir(old_cache_dir)) if os.path.isdir(old_cache_dir) else []:
        if not name.endswith(".json"):
            continue
        cache = load_old_cache(os.path.join(old_cache_dir, name))
        if cache is None:
            continue
        slug = name[:-5]
        for path, hit in cache.get("files", {}).items():
            if (os.path.exists(path) or path in known
                    or hit.get("sid") in old_archived.get(slug, ())):
                continue
            rel = os.path.relpath(path, projects)
            folder = rel.split(os.sep)[0] if not rel.startswith("..") else slug
            msgs = {mid: [m[0], m[1] if len(m) > 1 else 0, m[2] if len(m) > 2 else "", 0]
                    for mid, m in hit.get("msgs", {}).items()}
            tok = {week: {"0": models} for week, models in hit.get("tok", {}).items()}
            folders.setdefault(folder, {"v": FOLDER_VERSION, "files": {}})["files"][path] = {
                "k": "imported", "sid": hit.get("sid"), "main": bool(hit.get("main")),
                "ledger": hit.get("ledger"), "launchKey": slug, "places": [{"key": slug}],
                "msgs": msgs, "first": hit.get("first") or oldest(msgs), "tok": tok,
                "gone": True}
            known.add(path)
            touched.add(folder)
            entries += 1
    for folder in touched:
        save_folder(folder)
    return {"archives": archives, "entries": entries}


# -- the scan

def scan(projects, root, cache_dir, data_dir, exclude=""):
    v2_cache = os.path.join(cache_dir, "v2")
    v2_data = os.path.join(data_dir, "v2")
    with locked(os.path.join(v2_cache, "scan.lock")):
        return _scan(projects, slug_of(root), cache_dir, data_dir, v2_cache, v2_data, exclude)


def _scan(projects, me, old_cache_dir, old_data_dir, v2_cache, v2_data, exclude):
    folders_dir = os.path.join(v2_cache, "folders")
    roots = Roots(os.path.join(v2_cache, "roots.json"), os.path.expanduser("~"))
    now = time.time()

    folders = {}
    dirty = set()
    for name in os.listdir(folders_dir) if os.path.isdir(folders_dir) else []:
        if name.endswith(".json"):
            try:
                data = read_json(os.path.join(folders_dir, name))
            except (OSError, ValueError):
                continue
            # Another layout: rebuilt from the logs on disk.
            if data.get("v") == FOLDER_VERSION:
                folders[name[:-5]] = data

    def save_folder(name):
        path = os.path.join(folders_dir, name + ".json")
        if folders.get(name, {}).get("files"):
            write_json(path, folders[name], separators=(",", ":"))
        elif os.path.exists(path):
            os.remove(path)

    marker = os.path.join(v2_data, ".imported")
    if not os.path.exists(marker):
        os.makedirs(v2_data, exist_ok=True)
        copied = import_old(old_cache_dir, old_data_dir, v2_data, projects, folders, save_folder)
        write_json(marker, {"at": datetime.datetime.now().astimezone().isoformat(
            timespec="seconds"), **copied})

    # Every log of every project folder: a session launched anywhere can
    # owe money to this repo.
    try:
        on_disk = [n for n in os.listdir(projects) if os.path.isdir(os.path.join(projects, n))]
    except FileNotFoundError:
        on_disk = []  # a first-ever session: Claude Code has not written a log yet
    seen = set()
    for name in on_disk:
        top = os.path.join(projects, name)
        files = folders.setdefault(name, {"v": FOLDER_VERSION, "files": {}})["files"]
        for dirpath, _dirs, names in os.walk(top):
            for log in names:
                if not log.endswith(".jsonl"):
                    continue
                path = os.path.join(dirpath, log)
                try:
                    st = os.stat(path)
                except OSError:
                    continue
                seen.add(path)
                # A price update re-reads every log still on disk.
                key = f"{st.st_size}:{int(st.st_mtime)}:{PRICES_UPDATED}"
                hit = files.get(path)
                if hit and hit["k"] == key and not hit.get("gone"):
                    continue
                rel = os.path.relpath(path, top)
                files[path] = {"k": key, "sid": rel.split(os.sep)[0].removesuffix(".jsonl"),
                               "main": os.sep not in rel, **scan_file(path)}
                dirty.add(name)
    for name, data in folders.items():
        for path, hit in data["files"].items():
            if path not in seen and not hit.get("gone"):
                hit["gone"] = True
                dirty.add(name)

    sessions = {}
    for name, data in folders.items():
        for path, hit in data["files"].items():
            sessions.setdefault(hit["sid"], []).append((name, path, hit))
    present = {sid for sid, es in sessions.items() if any(not e[2].get("gone") for e in es)}

    archives = {}
    changed = set()

    def archive(repo):
        if repo not in archives:
            archives[repo] = load_archive(os.path.join(v2_data, repo + ".json"))
        return archives[repo]

    mine = archive(me)  # a newer archive version stops the scan, as before

    # Logs Claude Code has deleted. A session moves to the archives (each
    # repo its share) once all of its logs are gone; until then what is left
    # of it stays in the cache, still counting.
    built = {}
    for sid, es in sessions.items():
        if sid in present:
            continue
        s = built[sid] = build(es, roots)
        done = True
        for repo, sh in split(s).items():
            try:
                a = archive(repo)
            except SystemExit as error:  # one repo's newer archive stops none of the rest
                print(error, file=sys.stderr)
                done = False
                continue
            if sid in a["archived"]:
                continue
            archive_share(a, sh, s["ledger"] is None)
            a["archived"][sid] = int(now)
            changed.add(repo)
        if done:
            for name, path, _hit in es:
                del folders[name]["files"][path]
                dirty.add(name)
    for repo, a in archives.items():
        for sid, at in list(a["archived"].items()):
            if at < now - KEEP_IDS_DAYS * 86400 and sid not in present:
                del a["archived"][sid]
                changed.add(repo)

    # The archives first: should a cache write never happen, a session's id
    # in an archive keeps it from being counted (or archived) twice.
    for repo in changed:
        a = archives[repo]
        a["updated"] = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
        for b in a["weeks"].values():
            b["usd"] = round(b["usd"], 6)
            b["estimatedUsd"] = round(b["estimatedUsd"], 6)
        a["weeks"] = dict(sorted(a["weeks"].items()))
        write_json(os.path.join(v2_data, repo + ".json"), a, indent=1)
    for name in dirty | {n for n in folders if n not in on_disk}:
        save_folder(name)

    day0 = datetime.datetime.now().replace(
        hour=0, minute=0, second=0, microsecond=0).timestamp()
    total = estimated = today = week = 0.0
    count = 0
    since = 0
    unpriced = set()
    live = 1.0
    for sid, es in sessions.items():
        # Archived here (now or before), or a log that came back after it was.
        if sid in mine["archived"]:
            continue
        s = built.get(sid) or build(es, roots)
        if sid == exclude:
            est = sum(m[0] for m in s["msgs"].values())
            if est:
                live = sum(m[0] * m[3].get(me, 0) for m in s["msgs"].values()) / est
            continue
        sh = split(s).get(me)
        if sh is None:
            continue
        count += 1
        total += sh["usd"]
        if s["ledger"] is None:
            estimated += sh["usd"]
            unpriced |= sh["unpriced"]
        if sh["first"] and (not since or sh["first"] < since):
            since = sh["first"]
        for usd, ts, _ in sh["rows"]:
            if ts >= day0:
                today += usd
            if ts >= now - 7 * 86400:
                week += usd
    # Archived weeks count toward the total only: their logs are long gone,
    # older than today and the last 7 days with Claude Code's default cleanup.
    for b in mine["weeks"].values():
        total += b["usd"]
        estimated += b["estimatedUsd"]
        count += b["sessions"]
        unpriced.update(b["unpriced"])
        if b["first"] and (not since or b["first"] < since):
            since = b["first"]
    # Last: adding up resolves most folders, and a folder resolved once keeps
    # its repo after the repo is deleted.
    roots.save()
    return {
        "usd": round(total, 4), "sessions": count,
        "estimatedUsd": round(estimated, 4),
        "today": round(today, 4), "week": round(week, 4),
        "since": round(since * 1000) if since else None,
        "unpriced": sorted(unpriced),
        "live": round(live, 4),
    }


def main():
    if sys.argv[1] == "--sweep":
        print(json.dumps({"repos": 0, "skipped": "not needed: every scan reads every repo"}))
        return
    projects, root, cache_dir, data_dir = sys.argv[1:5]
    exclude = sys.argv[5] if len(sys.argv) > 5 else ""
    print(json.dumps(scan(projects, root, cache_dir, data_dir, exclude)))


if __name__ == "__main__":
    main()
