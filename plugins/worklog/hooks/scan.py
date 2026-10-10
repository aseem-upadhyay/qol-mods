#!/usr/bin/env python3
"""What the user worked on, day by day, from Claude Code's transcripts (SPEC.md §5, §6).

Usage:
  scan.py --projects DIR --cache FILE --from DAY --to DAY
          [--home DIR] [--idle-gap MIN] [--lead-in MIN] [--max-unattended MIN]
          [--day-start HH:MM] [--exclude PATH,PATH] [--include-non-repo]
          [--temp PATH,PATH]

A DAY is a date (2026-10-09) or a whole number of days from today (-1 for
yesterday, 0 for today), today being the day `--day-start` says it is now.

Every transcript under DIR that was written to since the window opened is
read, subagents included. Each record is an activity event in its session's
folder and branch at that minute: a human event (a typed prompt or command,
an interrupt, a message queued while Claude worked, a permission the user
answered) or an agent event (everything Claude did). Folders resolve to
their repo, a worktree's to its main checkout, by reading .git on disk (no
git commands run). Folders outside any repo, under a temp folder, or under
an excluded path are left out.

Per-file results are cached by (size, mtime), so only files that changed
are read again.

Prints one JSON object:
  {"today": "YYYY-MM-DD",
   "days": [{"date", "totalMin", "unattendedMin", "hours": [24 ints],
             "repos": [{"name", "slug", "root", "minutes", "hours",
                        "groups": [{"branch", "isDefault", "pr", "minutes",
                                    "rawMin", "unattendedMin", "first", "last",
                                    "what", "spans", "aloneSpans", "sessions"}]}]}],
   "warnings": [...]}
`minutes` are the allocated shares, whole minutes that add up to the day's
`totalMin`; `rawMin` is the group's own attended time before overlaps were
split; `first` and `last` are local "HH:MM"; `spans` and `aloneSpans` are the
minutes attended and left to Claude, as [from, to) minutes after the day's
start; a repo's `hours` are its attended minutes in each hour.
"""
import argparse, bisect, contextlib, datetime, fcntl, glob, json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from facts import facts_of, folders, pick_asks, relative  # noqa: E402
from timeline import AGENT, HUMAN, Rules, allocate, attended  # noqa: E402

PARSER_VERSION = 6
# Raise PARSER_VERSION whenever what read_file keeps changes: the cache is keyed by it.
DAY_MIN = 24 * 60
TEMP_ROOTS = ("/tmp/", "/private/tmp/", "/var/folders/", "/private/var/folders/")
MARKER = re.compile(
    r"^\s*(?:<command-message>|<command-args>|<local-command-(?:stdout|stderr|caveat)>"
    r"|<task-notification>|<system-reminder>|<bash-(?:input|stdout|stderr)>|Caveat:"
    r"|Stop hook feedback)")
REMOTE = re.compile(r"[:/]([^/:\s]+)/([^/\s]+?)(?:\.git)?/?$")
TITLES_SHOWN = 3
ASKS_SHOWN = 3
COMMITS_SHOWN = 6
FILES_SHOWN = 5
FOLDERS_SHOWN = 4
# Titles a session has before it is named, which say nothing.
PLACEHOLDER_TITLES = frozenset(("new session", "untitled"))


# -- reading one transcript

def minute_of(stamp):
    try:
        return int(datetime.datetime.fromisoformat(str(stamp).replace("Z", "+00:00")).timestamp()) // 60
    except (ValueError, TypeError):
        return None


def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(b.get("text", "") for b in content
                         if isinstance(b, dict) and b.get("type") == "text")
    return ""


def flags_of(d):
    """HUMAN, AGENT or 0 for one record (SPEC.md §5.1)."""
    kind = d.get("type")
    if kind == "assistant" or kind == "system":
        return AGENT
    if kind == "queue-operation":
        # The user typing while Claude works; tagged text is a task's notice queued for it.
        text = d.get("content")
        typed = isinstance(text, str) and not text.lstrip().startswith("<")
        return HUMAN if d.get("operation") == "enqueue" and typed else 0
    if kind != "user":
        return 0
    decision = d.get("permissionDecision")
    if isinstance(decision, dict) and str(decision.get("source", "")).startswith("user"):
        return HUMAN
    content = (d.get("message") or {}).get("content")
    if isinstance(content, list) and any(
            isinstance(b, dict) and b.get("type") == "tool_result" for b in content):
        return AGENT
    if (d.get("isSidechain") or d.get("isMeta") or d.get("isCompactSummary")
            or d.get("isVisibleInTranscriptOnly")):
        return AGENT
    origin = d.get("origin")
    if isinstance(origin, dict) and origin.get("kind") not in (None, "human"):
        return AGENT
    text = text_of(content)
    if not text.strip() or MARKER.search(text):
        return AGENT
    # What's left was typed: a prompt, a slash command (<command-name>), a
    # desktop action (<create-pr-command>) or an interrupt.
    return HUMAN


def read_file(path):
    """One transcript's activity: streams, titles, entrypoints, PR links and facts."""
    acts = {}      # (cwd, branch, sid) -> {minute: flags}
    titles, entries, prs, facts = {}, {}, [], []
    pr_titles = {}  # sid -> the title of the PR it last asked gh to create
    where = {}     # sid -> (cwd, branch) as of the last record that said
    # A record's gitBranch is the branch as its turn started, and Claude
    # usually makes the branch and opens the PR in one turn: a PR link waits
    # for the session's next prompt, which carries the branch the turn left.
    awaiting = {}  # sid -> [link]
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            try:
                d = json.loads(line)
            except ValueError:
                continue
            if not isinstance(d, dict):
                continue
            sid = d.get("sessionId") or ""
            if isinstance(d.get("cwd"), str):
                where[sid] = (d["cwd"], d.get("gitBranch") or "")
            kind = d.get("type")
            if (kind == "custom-title" and d.get("customTitle")
                    and str(d["customTitle"]).strip().lower() not in PLACEHOLDER_TITLES):
                titles[sid] = str(d["customTitle"])
            if d.get("entrypoint"):
                entries[sid] = str(d["entrypoint"])
            at = minute_of(d.get("timestamp"))
            if at is None:
                continue
            if kind == "pr-link" and d.get("prNumber"):
                awaiting.setdefault(sid, []).append(
                    [sid, at, d.get("prNumber"), d.get("prUrl") or "", d.get("prRepository") or "",
                     pr_titles.pop(sid, None)])
                continue
            flags = flags_of(d)
            for fact, value in facts_of(d, flags == HUMAN):
                if fact == "prtitle":
                    pr_titles[sid] = value
                else:
                    facts.append([sid, at, fact, value])
            if not flags or sid not in where:
                continue
            if flags == HUMAN and kind == "user" and awaiting.get(sid):
                prs.extend(link + list(where[sid]) for link in awaiting.pop(sid))
            key = where[sid] + (sid,)
            m = acts.setdefault(key, {})
            m[at] = m.get(at, 0) | flags
    # No prompt came after: the branch the session ended on.
    for sid, links in awaiting.items():
        if sid in where:
            prs.extend(link + list(where[sid]) for link in links)
    return {
        "streams": [[c, b, s, sorted(m.items())] for (c, b, s), m in acts.items()],
        "titles": titles,
        "entries": entries,
        "prs": prs,
        "facts": facts,
    }


# -- the cache

@contextlib.contextmanager
def locked(path):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path + ".lock", "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def load_cache(path):
    try:
        with open(path) as fh:
            cache = json.load(fh)
        if cache.get("v") == PARSER_VERSION:
            return cache
    except (OSError, ValueError):
        pass
    return {"v": PARSER_VERSION, "files": {}, "roots": {}}


def save_cache(path, cache):
    tmp = path + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(cache, fh, separators=(",", ":"))
    os.replace(tmp, path)


# -- folders to repos

def slug_of(path):
    return re.sub(r"[^A-Za-z0-9]", "-", path)


def read_text(path):
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            return fh.read()
    except OSError:
        return None


def common_dir(dot_git):
    """The repository's shared .git folder, from a checkout's `.git` (a folder,
    or a worktree's file pointing at its own folder inside the main one)."""
    if os.path.isdir(dot_git):
        return dot_git
    text = read_text(dot_git) or ""
    m = re.match(r"gitdir:\s*(.+)", text.strip())
    if not m:
        return None
    gitdir = m.group(1).strip()
    if not os.path.isabs(gitdir):
        gitdir = os.path.normpath(os.path.join(os.path.dirname(dot_git), gitdir))
    common = (read_text(os.path.join(gitdir, "commondir")) or "").strip()
    if not common:
        return gitdir
    return os.path.normpath(common if os.path.isabs(common) else os.path.join(gitdir, common))


def find_root(cwd, home):
    """The main checkout `cwd` belongs to, or None.

    Walks up from `cwd` to the first folder holding `.git`, so a subfolder or
    a deleted Claude worktree (<repo>/.claude/worktrees/<name>) lands on its
    repo. $HOME itself never counts, so a dotfiles repo doesn't swallow
    everything.
    """
    p = os.path.normpath(cwd)
    while p and p != os.path.dirname(p):
        if p == home:
            return None
        dot_git = os.path.join(p, ".git")
        if os.path.exists(dot_git):
            common = common_dir(dot_git)
            if not common:
                return p
            return os.path.dirname(common) if os.path.basename(common) == ".git" else p
        p = os.path.dirname(p)
    return None


def repo_info(root):
    """Display name, owner/repo slug and default branch, read from .git."""
    git = os.path.join(root, ".git")
    config = read_text(os.path.join(git, "config")) or ""
    slug = None
    section = None
    for line in config.splitlines():
        line = line.strip()
        if line.startswith("["):
            section = line
        elif section == '[remote "origin"]' and line.startswith("url"):
            m = REMOTE.search(line.split("=", 1)[-1].strip())
            if m:
                slug = f"{m.group(1)}/{m.group(2)}"
    head = (read_text(os.path.join(git, "refs", "remotes", "origin", "HEAD")) or "").strip()
    default = head.rsplit("/", 1)[-1] if head.startswith("ref:") else None
    name = slug.split("/", 1)[1] if slug else os.path.basename(root)
    return {"name": name, "slug": slug, "default": default}


def excluded(path, excludes):
    return any(path == e or path.startswith(e.rstrip("/") + "/") for e in excludes)


# -- days

def day_bounds(first, last, day_start):
    """[(date, start minute, end minute)] for each local day, `day_start`
    minutes after local midnight. Worked out per day, so DST days come out
    23 or 25 hours long."""
    out = []
    d = first
    while d <= last + datetime.timedelta(days=1):
        start = datetime.datetime.combine(d, datetime.time()) + datetime.timedelta(minutes=day_start)
        out.append((d.isoformat(), int(start.timestamp()) // 60))
        d += datetime.timedelta(days=1)
    return [(out[i][0], out[i][1], out[i + 1][1]) for i in range(len(out) - 1)]


def whole(shares, total):
    """Float minutes rounded to whole ones that still add up to `total`
    (largest remainder)."""
    floors = {k: int(v) for k, v in shares.items()}
    left = total - sum(floors.values())
    for k in sorted(shares, key=lambda k: shares[k] - floors[k], reverse=True)[:max(0, left)]:
        floors[k] += 1
    return floors


def parse_day(text, today):
    """A date, or a whole number of days from `today`."""
    if re.fullmatch(r"[+-]?\d+", text.strip()):
        return today + datetime.timedelta(days=int(text))
    return datetime.date.fromisoformat(text.strip())


def runs(minutes, start):
    """Minutes as [[from, to)] runs, counted from `start`: [[358, 412], [431, 460]]."""
    out = []
    for m in sorted(minutes):
        if out and m - start == out[-1][1]:
            out[-1][1] += 1
        else:
            out.append([m - start, m - start + 1])
    return out


def hhmm(minute):
    return datetime.datetime.fromtimestamp(minute * 60).strftime("%H:%M")


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--projects", required=True)
    ap.add_argument("--cache", required=True)
    ap.add_argument("--from", dest="first", required=True)
    ap.add_argument("--to", dest="last", required=True)
    ap.add_argument("--home", default=os.path.expanduser("~"))
    ap.add_argument("--idle-gap", type=int, default=15)
    ap.add_argument("--lead-in", type=int, default=5)
    ap.add_argument("--max-unattended", type=int, default=30)
    ap.add_argument("--day-start", default="04:00")
    ap.add_argument("--exclude", default="")
    ap.add_argument("--include-non-repo", action="store_true")
    # Leave the user's own prompts out of what's reported.
    ap.add_argument("--no-asks", dest="asks", action="store_false")
    # Folders whose work never counts: scratch repos Claude makes and drops.
    ap.add_argument("--temp", default=",".join(TEMP_ROOTS))
    args = ap.parse_args(argv)

    rules = Rules(args.idle_gap, args.lead_in, args.max_unattended)
    h, _, mm = args.day_start.partition(":")
    day_start = int(h or 0) * 60 + int(mm or 0)
    today = (datetime.datetime.now() - datetime.timedelta(minutes=day_start)).date()
    first = parse_day(args.first, today)
    last = parse_day(args.last, today)
    days = day_bounds(first, last, day_start)
    home = os.path.normpath(args.home)
    excludes = [os.path.normpath(os.path.expanduser(e.strip())) for e in args.exclude.split(",") if e.strip()]
    excluded_slugs = [slug_of(e) for e in excludes]
    # Activity a day before the window can still carry a span into it.
    lo = days[0][1] - DAY_MIN
    hi = days[-1][2] + rules.lead_in
    temp = tuple(t for t in args.temp.split(",") if t)
    warnings = []

    # 1. Read every transcript written to since `lo`, from the cache when unchanged.
    files = glob.glob(os.path.join(args.projects, "*", "*.jsonl"))
    files += glob.glob(os.path.join(args.projects, "*", "*", "subagents", "**", "*.jsonl"), recursive=True)
    with locked(args.cache):
        cache = load_cache(args.cache)
        seen = set()
        parsed = []
        for path in files:
            folder = os.path.relpath(path, args.projects).split(os.sep, 1)[0]
            if any(folder.startswith(s) for s in excluded_slugs):
                continue
            try:
                st = os.stat(path)
            except OSError:
                continue
            seen.add(path)
            if st.st_mtime // 60 < lo:
                continue
            hit = cache["files"].get(path)
            if not hit or hit.get("size") != st.st_size or hit.get("mtime") != st.st_mtime:
                try:
                    hit = {"size": st.st_size, "mtime": st.st_mtime, **read_file(path)}
                except OSError as error:
                    warnings.append(f"could not read {path}: {error}")
                    continue
                cache["files"][path] = hit
            parsed.append(hit)
        cache["files"] = {p: v for p, v in cache["files"].items() if p in seen}

        # 2. Folders to repos. A folder resolved once keeps its repo after it's deleted.
        roots = cache["roots"]

        def root_of(cwd):
            if cwd in roots:
                return roots[cwd]
            root = find_root(cwd, home)
            if root:
                roots[cwd] = root
            return root

        activity = {}   # sid -> {minute: flags}, every place the session was
        places = {}     # sid -> [(minute, (root, branch))]
        titles, unattended_sessions, links, first_links = {}, set(), {}, {}
        for hit in parsed:
            titles.update(hit["titles"])
            for sid, entry in hit["entries"].items():
                if entry.startswith("sdk"):
                    unattended_sessions.add(sid)
        for hit in parsed:
            for cwd, branch, sid, pairs in hit["streams"]:
                if cwd.startswith(temp) or excluded(cwd, excludes):
                    continue
                root = root_of(cwd)
                if root is None:
                    if not args.include_non_repo:
                        continue
                    root = ""
                elif excluded(root, excludes):
                    continue
                key = (root, branch if root else "")
                act = activity.setdefault(sid, {})
                where = places.setdefault(sid, [])
                for at, flags in pairs:
                    if at < lo or at >= hi:
                        continue
                    if sid in unattended_sessions:
                        flags = AGENT
                    act[at] = act.get(at, 0) | flags
                    where.append((at, key))
            # A PR is linked again each time its status is checked, from
            # whatever branch the session is on by then: its first link wins.
            for sid, at, number, url, slug, title, cwd, branch in hit["prs"]:
                pr = url or f"{slug}#{number}"
                if pr not in first_links or at < first_links[pr][0]:
                    first_links[pr] = (at, number, url, slug, title, cwd, branch)
        # A branch with several PRs shows its latest.
        for at, number, url, slug, title, cwd, branch in first_links.values():
            root = root_of(cwd) if cwd else None
            if root is None:
                continue
            key = (root, branch)
            if key not in links or links[key]["at"] < at:
                links[key] = {"at": at, "number": number, "url": url, "repo": slug, "title": title}
        save_cache(args.cache, cache)

    # 3. Whether the user was there is a session's question, asked across its
    # branch switches; each minute then goes to the repo and branch the
    # session was on at the time.
    seen_by, alone_by, active_by = {}, {}, {}   # (root, branch) -> set of minutes
    mine, mine_active = {}, {}                  # (root, branch, sid) -> set of minutes
    placed = {}                                 # sid -> (stamps, [(minute, key)])

    def place_in(sid, m):
        stamps, where = placed[sid]
        return where[max(0, bisect.bisect_right(stamps, m) - 1)][1]

    for sid, act in activity.items():
        if not act:
            continue
        seen, alone = attended(act, rules)
        where = sorted(places[sid], key=lambda p: p[0])
        placed[sid] = ([p[0] for p in where], where)

        def place(m, sid=sid):
            return place_in(sid, m)

        for m in seen:
            key = place(m)
            seen_by.setdefault(key, set()).add(m)
            mine.setdefault(key + (sid,), set()).add(m)
        for m in alone:
            alone_by.setdefault(place(m), set()).add(m)
        for m, key in where:
            active_by.setdefault(key, set()).add(m)
            mine_active.setdefault(key + (sid,), set()).add(m)
    infos = {}

    # 4. Facts go where their session was at the time, by day.
    starts = [d[1] for d in days]
    found = {}   # (day index, key) -> {"asks", "commits", "edits", "tests"}
    for hit in parsed:
        for sid, at, fact, value in hit["facts"]:
            if sid not in placed or not days[0][1] <= at < days[-1][2]:
                continue
            if fact == "ask" and (not args.asks or sid in unattended_sessions):
                continue
            key = place_in(sid, at)
            f = found.setdefault((bisect.bisect_right(starts, at) - 1, key),
                                 {"asks": [], "commits": [], "edits": {}, "tests": 0})
            if fact == "ask":
                f["asks"].append((at, value))
            elif fact == "commit":
                f["commits"].append((at, value))
            elif fact == "edit":
                f["edits"][value] = f["edits"].get(value, 0) + 1
            elif fact == "test":
                f["tests"] += 1
    out_days = []
    for index, (date, start, end) in enumerate(days):
        def within(minutes):
            return {m for m in minutes if start <= m < end}
        day_seen = {k: within(v) for k, v in seen_by.items()}
        day_seen = {k: v for k, v in day_seen.items() if v}
        day_alone = {k: within(v) - day_seen.get(k, set()) for k, v in alone_by.items()}
        shares, union = allocate(day_seen)
        minutes = whole(shares, len(union))
        all_alone = set().union(*day_alone.values()) - union if day_alone else set()
        hours = [0] * 24
        for m in union:
            hours[min(23, (m - start) // 60)] += 1

        repos, repo_seen = {}, {}
        for key in set(day_seen) | {k for k, v in day_alone.items() if v}:
            root, branch = key
            if root not in infos:
                infos[root] = repo_info(root) if root else {"name": "Other", "slug": None, "default": None}
            info = infos[root]
            active = sorted(within(active_by.get(key, set()))
                            | day_seen.get(key, set()) | day_alone.get(key, set()))
            sessions = []
            for (r, b, sid), mins in mine_active.items():
                if (r, b) != key:
                    continue
                own = within(mins)
                if own:
                    sessions.append({"id": sid, "title": titles.get(sid),
                                     "min": len(within(mine.get(key + (sid,), set()))), "active": len(own)})
            sessions.sort(key=lambda s: (-s["min"], -s["active"]))
            # Titles of the sessions the user spent time in, before ones that only passed by.
            what = []
            for s in sorted(sessions, key=lambda s: s["min"] == 0):
                if s["title"] and s["title"] not in what:
                    what.append(s["title"])
            link = links.get(key)
            default = info["default"]
            f = found.get((index, key), {"asks": [], "commits": [], "edits": {}, "tests": 0})
            commits = list(dict.fromkeys(v for _, v in sorted(f["commits"])))
            files = {}
            for path, n in f["edits"].items():
                rel = relative(path, root, home)
                if rel:
                    files[rel] = files.get(rel, 0) + n
            top = sorted(files.items(), key=lambda kv: (-kv[1], kv[0]))
            dirs = folders(files)
            group = {
                "branch": branch,
                "isDefault": bool(branch) and (branch == default if default else branch in ("main", "master")),
                "pr": {k: link[k] for k in ("number", "url", "repo", "title")} if link else None,
                "minutes": minutes.get(key, 0),
                "rawMin": len(day_seen.get(key, ())),
                "unattendedMin": len(day_alone.get(key, ())),
                "first": hhmm(active[0]),
                "last": hhmm(active[-1] + 1),
                "what": what[:TITLES_SHOWN],
                "asks": pick_asks(f["asks"], ASKS_SHOWN),
                "commits": commits[:COMMITS_SHOWN],
                "commitCount": len(commits),
                "files": [[p, n] for p, n in top[:FILES_SHOWN]],
                "fileCount": len(top),
                "dirs": [[d, n] for d, n in dirs[:FOLDERS_SHOWN]],
                "dirCount": len(dirs),
                "tests": f["tests"],
                "spans": runs(day_seen.get(key, ()), start),
                "aloneSpans": runs(day_alone.get(key, ()), start),
                "sessions": [{"id": s["id"], "title": s["title"], "min": s["min"]} for s in sessions],
            }
            repo = repos.setdefault(root, {"name": info["name"], "slug": info["slug"], "root": root,
                                           "minutes": 0, "hours": [0] * 24, "groups": []})
            mine_now = repo_seen.setdefault(root, set())
            for m in day_seen.get(key, ()):
                if m not in mine_now:
                    mine_now.add(m)
                    repo["hours"][min(23, (m - start) // 60)] += 1
            repo["minutes"] += group["minutes"]
            repo["groups"].append(group)
        ordered = sorted(repos.values(), key=lambda r: (-r["minutes"], r["name"]))
        for repo in ordered:
            repo["groups"].sort(key=lambda g: (-g["minutes"], -g["unattendedMin"], g["branch"]))
        out_days.append({"date": date, "totalMin": len(union), "unattendedMin": len(all_alone),
                         "hours": hours, "repos": ordered})
    json.dump({"today": today.isoformat(), "days": out_days, "warnings": warnings}, sys.stdout, separators=(",", ":"))
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
