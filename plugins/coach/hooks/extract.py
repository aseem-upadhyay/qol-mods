"""One transcript in, the facts coach measures out (SPEC.md §6).

extract() reads a session's main transcript (<slug>/<session>.jsonl) or one
of its subagents' (<slug>/<session>/subagents/**.jsonl) in a single pass and
returns plain JSON data, which scan.py caches by the file's size and mtime.
Prompt text never leaves this module whole: it becomes flags, hashes and,
only while excerpts are on, short scrubbed cuts.
"""
import datetime
import json
import os

import patterns as P
from pricing import cache_writes, message_parts, price_for

# Any change to what this module returns bumps it, which re-reads every log.
PARSER_VERSION = 1

EDIT_TOOLS = frozenset(("Edit", "Write", "MultiEdit", "NotebookEdit"))
AGENT_TOOLS = frozenset(("Agent", "Task"))
SEARCH_TOOLS = frozenset(("Grep", "Glob", "Read", "LS"))
AUTOMATION_TOOLS = frozenset(("CronCreate", "ScheduleWakeup", "RemoteTrigger"))
SEARCH_COMMAND = ("ls", "find", "grep", "rg", "cat", "head", "tail", "tree", "fd")

# Claude Code's own commands; any other /name is the user's or a plugin's.
BUILTIN_COMMANDS = frozenset("""
add-dir agents artifacts bashes branch bug btw clear color compact config context copy cost desktop
diff doctor effort exit export extra-usage fast feedback files fork goal help hooks ide init
install-github-app install-slack-app keybindings login logout mcp memory migrate-installer mobile
model output-style permissions plan plugin plugins powerup pr-comments privacy-settings release-notes
reload-plugins remote-control remote-env rename resume review rewind sandbox security-review session
skills stats status statusline stickers tasks terminal-setup theme todos upgrade usage vim loop
schedule workflows
""".split())
COMMAND_FEATURES = {"rewind": "rewind", "model": "model-choice", "compact": "compact",
                    "clear": "fresh-start", "loop": "automation", "schedule": "automation"}

# One model call per row, fields by index, to keep the cache small.
(C_TS, C_IN, C_OUT, C_CTX, C_UNCACHED, C_READ, C_WRITE, C_OUTPUT, C_MODEL, C_FAST, C_REWARM,
 C_REQ, C_SUB, C_EFFORT, C_W1H) = range(15)
BACKGROUND = -1    # a call no prompt started: a background task's turn

REWARM_MIN_TOKENS = 20_000
SHORT_TTL_MS = 5 * 60 * 1000
LONG_TTL_MS = 60 * 60 * 1000
ORIENTATION_CALLS = 10
EXPLORE_WINDOW = 15
FOLLOW_UP_MS = 30 * 60 * 1000
RESULT_HEAD = 2000


def ms(stamp):
    try:
        return int(datetime.datetime.fromisoformat(
            str(stamp).replace("Z", "+00:00")).timestamp() * 1000)
    except (ValueError, TypeError):
        return 0


def text_of(content):
    """The text of a message's content: a string, or its text blocks joined."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(b.get("text", "") for b in content
                         if isinstance(b, dict) and b.get("type") == "text")
    return ""


def result_text(block):
    content = block.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(b.get("text", "") for b in content
                         if isinstance(b, dict) and b.get("type") == "text")
    return ""


def relative(path, cwd):
    """`path` relative to the session's folder, a worktree's prefix folded."""
    path = path or ""
    marker = "/.claude/worktrees/"
    if marker in path:
        tail = path.split(marker, 1)[1]
        path = tail.split("/", 1)[1] if "/" in tail else ""
    elif cwd and (path == cwd or path.startswith(cwd.rstrip("/") + "/")):
        path = path[len(cwd.rstrip("/")) + 1:]
    return path.lstrip("/")


def area(path):
    parts = [p for p in path.split("/") if p]
    return "/".join(parts[:2]) if len(parts) > 1 else (parts[0] if parts else "")


class _Request:
    __slots__ = ("d", "last_edit", "first_edit_seen", "checks_after", "order0")

    def __init__(self, d):
        self.d = d
        self.last_edit = -1
        self.first_edit_seen = False
        self.checks_after = []
        self.order0 = 0


def _flags(text):
    return {
        "place": P.names_place(text),
        "done": bool(P.DONE.search(text)),
        "vague": P.is_vague(text),
        "paste": P.is_big_paste(text),
        "cont": bool(P.CONTINUATION.search(text)),
        "corr": bool(P.CORRECTION.search(text)),
        "undo": bool(P.UNDO.search(text)),
        "poll": bool(P.POLLING.search(text)),
        "ui": bool(P.UI_WORDS.search(text)),
        "form": bool(P.FORM.search(text)),
        "checks": bool(P.ASKS_CHECKS.search(text)),
        "at": bool(P.AT_MENTION.search(text)),
        "rx": bool(P.REPEAT_EXCLUDE.search(text)) or len(P.words(text)) < 3,
    }


class Extractor:
    def __init__(self, sid, project, is_main, is_workflow, excerpts):
        self.sid = sid
        self.project = project
        self.is_main = is_main
        self.is_workflow = is_workflow
        self.excerpts = excerpts
        self.requests = []       # _Request, in order
        self.current = None      # the open _Request, or None between turns
        self.calls = {}          # message id -> call row (a list)
        self.call_order = []
        self.call_req = {}       # message id -> request index (or BACKGROUND)
        self.call_sub = {}       # message id -> True for sidechain calls
        self.call_effort = {}
        self.tool_uses = {}      # tool_use id -> dict
        self.order = 0           # tool uses so far in the session
        self.first_edit_order = None
        self.session = {
            "id": sid, "project": project, "cwd": "", "title": None, "first": 0, "last": 0,
            "entry": None, "versions": [], "ledger": None, "modes": [], "compactions": [],
            "apiErrors": [], "feats": {}, "orientation": [], "ctxEnd": 0, "lead": None,
        }
        self.first_prompt = None
        self.edited = set()
        self.orientation = {}    # tool_use id -> relative path
        self.orientation_tokens = {}
        self.after_clear = False
        # Discovery (§9.6 S1)
        self.explore = []        # [(order, tokens, request index, tool_use id)]
        self.explore_tokens = {}
        self.failed = {}
        self.first_fail = {}
        self.succeeded = set()
        self.asked = {}
        # Wrong tool first (§9.6 S2)
        self.bash = []           # [(tool_use id, command, ok, head, request index, paired)]
        self.unpriced = set()

    # -- helpers

    def feat(self, name, at):
        f = self.session["feats"].setdefault(name, [0, at, at])
        f[0] += 1
        f[1] = min(f[1], at) if f[1] else at
        f[2] = max(f[2], at)

    def req_feat(self, name):
        if self.current is not None and name not in self.current.d["feats"]:
            self.current.d["feats"].append(name)

    def req_index(self):
        return self.current.d["i"] if self.current is not None else BACKGROUND

    def close(self):
        self.current = None

    def open(self, kind, at, uuid, text, command=None, mode=None, images=0):
        self.close()
        d = {
            "id": uuid or f"{self.sid}:{len(self.requests)}", "i": len(self.requests), "kind": kind,
            "command": command, "local": False, "at": at, "end": at, "words": 0, "chars": 0,
            "flags": {}, "q": None, "excerpt": None, "clauses": [], "shape": None, "mode": mode,
            "images": images, "afterClear": False, "tools": {}, "search": 0, "areas": [],
            "edited": 0, "read": 0, "checked": False, "committed": False, "interrupted": False,
            "rejections": 0, "blocks": 0, "approvals": {}, "plan": mode == "plan", "apiErrors": 0,
            "compacted": False, "invoked": None, "checkRuns": [], "discovery": [], "subs": [],
            "feats": [], "corrected": False, "run": 0, "next": None, "ctxFirstEdit": None,
            "calls": 0, "ctx0": 0, "ctxMax": 0, "usd": 0.0, "in": 0.0, "out": 0.0, "models": {},
            "fast": 0.0, "rewarm": 0.0, "effort": None, "subUsd": 0.0, "subCalls": 0,
        }
        r = _Request(d)
        r.order0 = self.order
        self.requests.append(r)
        self.current = r
        if kind == "prompt":
            self._prompt_facts(d, text)
        if mode == "plan":
            self.req_feat("plan-mode")
        if images:
            self.req_feat("image")
        return r

    def _prompt_facts(self, d, text):
        text = P.plain(text)
        d["words"] = len(P.words(text))
        d["chars"] = len(text)
        d["flags"] = _flags(text)
        d["q"] = P.question_task(text)
        if self.after_clear:
            d["afterClear"] = True
            self.after_clear = False
        if d["flags"]["at"]:
            self.req_feat("at-mention")
        if d["flags"]["checks"]:
            self.req_feat("ask-checks")
        tokens = P.normalize(text)
        if len(tokens) >= 4:
            opener = " ".join(tokens[:6])
            rare = sorted({P.stable_hash(t) for t in tokens
                           if t not in P.STOPWORDS and not t.startswith("<")})
            d["shape"] = {"openerHash": P.stable_hash(opener),
                          "open3": P.stable_hash(" ".join(tokens[:3])), "grams": P.grams(tokens),
                          "rare": rare, "len": len(tokens)}
            if self.excerpts:
                d["shape"]["opener"] = opener
                d["shape"]["template"] = " ".join(tokens)[:400]
        if self.excerpts:
            d["excerpt"] = P.excerpt(text)
            d["clauses"] = [[k, line] for k, line in P.clauses(text)]
        if self.first_prompt is None:
            self.first_prompt = text.lower()
            self.session["lead"] = P.excerpt(text, 60) if self.excerpts else None
        if d["q"]:
            self.asked.setdefault(d["q"], d["i"])

    # -- records

    def record(self, d):
        at = ms(d.get("timestamp"))
        if at:
            s = self.session
            s["first"] = min(s["first"], at) if s["first"] else at
            s["last"] = max(s["last"], at)
        before = self.current
        self._dispatch(d, at)
        # A record extends its request; the next prompt starts one of its own.
        if at and before is not None and self.current is before:
            before.d["end"] = max(before.d["end"], at)

    def _dispatch(self, d, at):
        kind = d.get("type")
        if kind == "assistant":
            self.assistant(d, at)
        elif kind == "user":
            self.user(d, at)
        elif kind == "system":
            self.system(d, at)
        elif kind == "custom-title":
            self.session["title"] = d.get("customTitle") or self.session["title"]
        elif kind == "cost-state" and self.is_main:
            try:
                self.session["ledger"] = float(d.get("totalCostUSD") or 0)
            except (TypeError, ValueError):
                pass

    def note_meta(self, d):
        s = self.session
        if d.get("cwd") and not s["cwd"]:
            s["cwd"] = d["cwd"]
        version = d.get("version")
        if version and version not in s["versions"] and len(s["versions"]) < 8:
            s["versions"].append(version)
        entry = d.get("entrypoint")
        if entry and not s["entry"]:
            s["entry"] = entry
            if entry == "sdk-cli":
                self.feat("headless", ms(d.get("timestamp")))

    def system(self, d, at):
        sub = d.get("subtype")
        if sub == "compact_boundary":
            meta = d.get("compactMetadata") or {}
            trigger = meta.get("trigger") if isinstance(meta, dict) else None
            self.session["compactions"].append([at, trigger or "unknown"])
            if self.current is not None:
                self.current.d["compacted"] = True
        elif sub == "api_error":
            self.session["apiErrors"].append(at)
            if self.current is not None:
                self.current.d["apiErrors"] += 1
        elif sub == "stop_hook_summary":
            self.feat("hooks", at)
        elif sub == "local_command":
            content = str(d.get("content") or "").strip()
            if content.startswith("/"):
                self.command_feature(content[1:].split()[0] if len(content) > 1 else "", at)

    def command_feature(self, name, at):
        if not name:
            return
        if name in COMMAND_FEATURES:
            self.feat(COMMAND_FEATURES[name], at)
            self.req_feat(COMMAND_FEATURES[name])
        elif name not in BUILTIN_COMMANDS:
            self.feat("commands-skills", at)
            self.req_feat("commands-skills")
            if ":" in name:
                self.feat("plugins", at)
                self.req_feat("plugins")

    def user(self, d, at):
        self.note_meta(d)
        content = (d.get("message") or {}).get("content")
        blocks = content if isinstance(content, list) else []
        results = [b for b in blocks if isinstance(b, dict) and b.get("type") == "tool_result"]
        if results:
            for b in results:
                self.tool_result(b, d, at)
            return
        if d.get("isSidechain") or d.get("isCompactSummary") or d.get("isVisibleInTranscriptOnly"):
            return
        text = text_of(content)
        if P.INTERRUPT.search(text):
            if self.current is not None:
                self.current.d["interrupted"] = True
                self.req_feat("interrupt")
            self.feat("interrupt", at)
            return
        origin = d.get("origin")
        origin_kind = origin.get("kind") if isinstance(origin, dict) else None
        if origin_kind == "task-notification":
            self.close()     # a background task's turn: its calls aren't the last prompt's
            return
        command = P.COMMAND_NAME.search(text)
        if command:
            name = command.group(1).lstrip("/")
            if d.get("isMeta"):
                self.command_feature(name, at)
                return
            r = self.open("command", at, d.get("uuid"), text, command=name)
            self.command_feature(name, at)
            if name == "clear":
                self.after_clear = True
            if name not in BUILTIN_COMMANDS:
                r.d["invoked"] = name
            return
        if d.get("isMeta"):
            return
        if origin_kind not in (None, "human"):
            return
        wrapper = P.COMMAND_WRAPPER.search(text)
        if wrapper:
            self.open("command", at, d.get("uuid"), text, command=wrapper.group(1))
            return
        if not text.strip() or P.MARKER.search(text):
            return
        images = max(sum(1 for b in blocks if isinstance(b, dict) and b.get("type") == "image"),
                     len(d.get("imagePasteIds") or []))
        mode = d.get("permissionMode")
        if mode and mode not in self.session["modes"]:
            self.session["modes"].append(mode)
        self.open("prompt", at, d.get("uuid"), text, mode=mode, images=images)

    def assistant(self, d, at):
        self.note_meta(d)
        m = d.get("message") or {}
        model = m.get("model") or ""
        if d.get("isApiErrorMessage") or model == "<synthetic>":
            return
        mid = m.get("id") or d.get("requestId") or d.get("uuid")
        if not mid:
            return
        for field, name in (("attributionSkill", "commands-skills"), ("attributionPlugin", "plugins"),
                            ("attributionMcpServer", "mcp")):
            if d.get(field):
                self.feat(name, at)
                self.req_feat(name)
        if d.get("attributionSkill") and self.current is not None and not self.current.d["invoked"]:
            self.current.d["invoked"] = str(d.get("attributionSkill"))
        is_sub = bool(d.get("isSidechain")) or not self.is_main
        usage = m.get("usage")
        if mid not in self.calls:
            self.calls[mid] = None
            self.call_order.append(mid)
            self.call_req[mid] = self.req_index()
            self.call_sub[mid] = is_sub
        if usage:
            self.calls[mid] = (at, model, usage)
        effort = d.get("perTurnEffort") or d.get("effort")
        if effort:
            self.call_effort[mid] = effort
        if is_sub:
            return
        for block in m.get("content") or []:
            if isinstance(block, dict) and block.get("type") == "tool_use":
                self.tool_use(block, d, at, mid)

    # -- tools

    def tool_use(self, block, d, at, mid):
        tid = block.get("id")
        if not tid or tid in self.tool_uses:
            return
        name = str(block.get("name") or "")
        inp = block.get("input") if isinstance(block.get("input"), dict) else {}
        self.order += 1
        order = self.order
        r = self.current
        info = {"name": name, "input": inp, "req": self.req_index(), "order": order, "mid": mid,
                "command": None, "path": None}
        self.tool_uses[tid] = info
        if r is not None:
            tools = r.d["tools"]
            tools[name] = tools.get(name, 0) + 1
        cwd = self.session["cwd"]
        if name in AGENT_TOOLS:
            self.feat("subagents", at)
            self.req_feat("subagents")
        elif name == "Skill":
            self.feat("commands-skills", at)
            self.req_feat("commands-skills")
            if r is not None and not r.d["invoked"]:
                r.d["invoked"] = str(inp.get("skill") or inp.get("name") or "") or None
        elif name.startswith("mcp__"):
            self.feat("mcp", at)
            self.req_feat("mcp")
            if name.startswith("mcp__scheduled-tasks__"):
                self.feat("automation", at)
                self.req_feat("automation")
        elif name == "Workflow":
            self.feat("workflows", at)
            self.req_feat("workflows")
        elif name in AUTOMATION_TOOLS:
            self.feat("automation", at)
            self.req_feat("automation")
        elif name == "Monitor":
            self.feat("monitor", at)
            self.req_feat("monitor")
        elif name == "ExitPlanMode":
            self.feat("plan-mode", at)
            if r is not None:
                r.d["plan"] = True
                self.req_feat("plan-mode")
        # Reads, searches and edits
        path = None
        if name == "Read":
            path = relative(str(inp.get("file_path") or ""), cwd)
        elif name == "Bash":
            command = str(inp.get("command") or "")
            info["command"] = command
            _, tokens = P.core_command(command)
            hit = P.READ_COMMAND.match(" ".join(tokens)) if tokens else None
            if hit:
                path = relative(next(g for g in hit.groups() if g), cwd)
        if path:
            info["path"] = path
            if r is not None:
                r.d["read"] += 1
                if path not in r.d["areas"] and len(r.d["areas"]) < 12:
                    r.d["areas"].append(area(path))
            if order <= ORIENTATION_CALLS and self.first_edit_order is None:
                self.orientation[tid] = path
        if name in EDIT_TOOLS:
            target = relative(str(inp.get("file_path") or inp.get("notebook_path") or ""), cwd)
            info["path"] = target
            if r is not None and area(target) and area(target) not in r.d["areas"] \
                    and len(r.d["areas"]) < 12:
                r.d["areas"].append(area(target))
        # Search steps before the request's first edit (H2)
        if r is not None and not r.first_edit_seen:
            is_search = name in SEARCH_TOOLS
            if name == "Bash" and info["command"]:
                _, tokens = P.core_command(info["command"])
                is_search = bool(tokens) and tokens[0] in SEARCH_COMMAND
            if is_search:
                r.d["search"] += 1
        # Exploration steps (S1)
        explores = False
        if path and P.EXPLORE_FILE.search(path):
            explores = True
        elif name == "Bash" and info["command"]:
            _, tokens = P.core_command(info["command"])
            explores = bool(tokens) and bool(P.EXPLORE_COMMAND.match(" ".join(tokens)))
        elif name in ("Grep", "Glob"):
            pattern = str(inp.get("pattern") or "") + " " + str(inp.get("glob") or "")
            explores = bool(P.EXPLORE_PATTERN.search(pattern)) or \
                bool(P.EXPLORE_FILE.search(pattern.strip()))
        if explores:
            self.explore.append([order, 0, info["req"], tid])

    def tool_result(self, block, d, at):
        tid = block.get("tool_use_id")
        info = self.tool_uses.get(tid)
        if info is None:
            return
        is_error = bool(block.get("is_error"))
        text = result_text(block)
        tokens = len(text) // 4
        r = self.requests[info["req"]].d if info["req"] >= 0 else None
        denial = d.get("toolDenialKind")
        if r is not None:
            if denial == "user-rejected":
                r["rejections"] += 1
            elif denial == "automode-blocked":
                r["blocks"] += 1
            decision = d.get("permissionDecision")
            if isinstance(decision, dict) and str(decision.get("source") or "").startswith("user"):
                key = info["name"]
                if info["command"]:
                    _, words = P.core_command(info["command"])
                    key = "Bash: " + " ".join(words[:2])
                r["approvals"][key] = r["approvals"].get(key, 0) + 1
        if tid in self.orientation:
            self.orientation_tokens[tid] = tokens
        for step in self.explore:
            if step[3] == tid:
                step[1] = tokens
        name = info["name"]
        if name in EDIT_TOOLS and not is_error:
            target = info.get("path") or ""
            self.edited.add(target)
            if self.first_edit_order is None:
                self.first_edit_order = info["order"]
            if info["req"] >= 0:
                req = self.requests[info["req"]]
                edited = req.d.setdefault("_edited", [])
                if target not in edited:
                    edited.append(target)
                req.last_edit = max(req.last_edit, info["order"])
                if not req.first_edit_seen:
                    req.first_edit_seen = True
                    req.d["ctxFirstEdit"] = info["mid"]   # resolved to a token count in finish()
        if name == "Bash" and info["command"]:
            self.bash_result(info, tid, not is_error, text[:RESULT_HEAD], tokens)

    def bash_result(self, info, tid, ok, head, tokens):
        command = info["command"]
        idx = info["req"]
        req = self.requests[idx] if idx >= 0 else None
        if ok and P.GIT_COMMIT.search(command) and req is not None:
            req.d["committed"] = True
        hit = P.classify(command)
        if hit and req is not None:
            task, display, key, folder, had_path = hit
            req.d["checkRuns"].append([task, display, key, folder, ok, had_path])
            if task in ("test", "build", "lint", "typecheck"):
                req.checks_after.append(info["order"])
        if hit:
            self.discovery_step(hit, ok, info)
        # Wrong tool first: a success right after up to 3 failures may pair with one of them.
        if ok:
            for prev in reversed(self.bash[-3:]):
                if prev[2] or prev[5]:
                    continue
                found = P.pair(prev[1], command, prev[3])
                if found and req is not None:
                    req.d["subs"].append([found[0], found[1], found[2], P.failure_kind(prev[3])])
                    prev[5] = True
                    break
        self.bash.append([tid, command, ok, head if not ok else "", idx, False])

    def discovery_step(self, hit, ok, info):
        task, display, key, folder, had_path = hit
        if task in self.succeeded:
            return
        idx = info["req"]
        if not ok:
            self.failed[task] = self.failed.get(task, 0) + 1
            self.first_fail.setdefault(task, idx)
            return
        recent = [s for s in self.explore if s[0] >= info["order"] - EXPLORE_WINDOW]
        failed = self.failed.get(task, 0)
        steps = len(recent) + failed
        if steps >= 2 or failed >= 1 or task in self.asked:
            starts = [s[2] for s in recent if s[2] >= 0]
            for extra in (self.first_fail.get(task), self.asked.get(task), idx):
                if extra is not None and extra >= 0:
                    starts.append(extra)
            start = min(starts) if starts else idx
            if start >= 0:
                self.requests[start].d["discovery"].append(
                    [task, steps, failed, sum(s[1] for s in recent), "found", display, key, folder,
                     had_path])
        self.succeeded.add(task)
        self.explore = []

    # -- end of file

    def finish(self):
        self.close()
        rows = []
        prev_at = None
        prev_long = False
        for mid in self.call_order:
            got = self.calls.get(mid)
            if not got:
                continue
            at, model, u = got
            inp, out, priced = message_parts(model, u)
            if not priced and any(u.get(k) for k in ("input_tokens", "output_tokens")):
                self.unpriced.add(model)
            w5m, w1h = cache_writes(u)
            writes = w5m + w1h
            read = u.get("cache_read_input_tokens") or 0
            uncached = u.get("input_tokens") or 0
            ctx = uncached + read + writes
            sub = self.call_sub.get(mid, False)
            rewarm = 0.0
            if not sub:
                ttl = LONG_TTL_MS if prev_long else SHORT_TTL_MS
                if prev_at is not None and at - prev_at > ttl and writes >= REWARM_MIN_TOKENS:
                    p = price_for(model)
                    if p:
                        rewarm = max(0.0, (w5m * p[3] + w1h * p[4] - writes * p[2]) / 1e6)
                        if u.get("speed") == "fast":
                            rewarm *= 2
                prev_at = at
                prev_long = w1h > 0 or prev_long
            rows.append([at, round(inp, 8), round(out, 8), ctx, uncached, read, writes,
                         u.get("output_tokens") or 0, model, u.get("speed") == "fast",
                         round(rewarm, 8), self.call_req.get(mid, BACKGROUND), sub,
                         self.call_effort.get(mid), w1h > 0])
        # Per-request totals from the main transcript's own calls
        by_mid = {}
        for mid, row in zip([m for m in self.call_order if self.calls.get(m)], rows):
            by_mid[mid] = row
        for row in rows:
            idx = row[C_REQ]
            if idx < 0 or row[C_SUB]:
                if idx >= 0 and row[C_SUB]:
                    d = self.requests[idx].d
                    d["subUsd"] += row[C_IN] + row[C_OUT]
                    d["subCalls"] += 1
                continue
            d = self.requests[idx].d
            d["calls"] += 1
            if d["calls"] == 1:
                d["ctx0"] = row[C_CTX]
            d["ctxMax"] = max(d["ctxMax"], row[C_CTX])
            usd = row[C_IN] + row[C_OUT]
            d["usd"] += usd
            d["in"] += row[C_IN]
            d["out"] += row[C_OUT]
            d["models"][row[C_MODEL]] = d["models"].get(row[C_MODEL], 0.0) + usd
            if row[C_FAST]:
                d["fast"] += usd
            d["rewarm"] += row[C_REWARM]
        efforts = {}
        for row in rows:
            if row[C_REQ] >= 0 and not row[C_SUB] and row[C_EFFORT]:
                efforts.setdefault(row[C_REQ], {}).setdefault(row[C_EFFORT], 0)
                efforts[row[C_REQ]][row[C_EFFORT]] += 1
        main_rows = [row for row in rows if not row[C_SUB]]
        if main_rows:
            self.session["ctxEnd"] = main_rows[-1][C_CTX]
        for r in self.requests:
            d = r.d
            first_edit = d.get("ctxFirstEdit")
            d["ctxFirstEdit"] = by_mid[first_edit][C_CTX] if first_edit in by_mid else None
            d["checked"] = r.last_edit >= 0 and any(o > r.last_edit for o in r.checks_after)
            d["edited"] = len(d.pop("_edited", []))
            if d["kind"] == "command" and d["calls"] == 0:
                d["local"] = True
            e = efforts.get(d["i"])
            if e:
                d["effort"] = max(e, key=e.get)
            for k in ("usd", "in", "out", "fast", "rewarm", "subUsd"):
                d[k] = round(d[k], 8)
            d["models"] = {k: round(v, 8) for k, v in d["models"].items()}
        self._follow_ups()
        self._gave_up()
        self._orientation()
        reqs = [r.d for r in self.requests]
        return {
            "v": PARSER_VERSION, "main": self.is_main, "workflow": self.is_workflow,
            "session": self.session if self.is_main else None,
            "requests": reqs if self.is_main else [], "calls": rows,
            "unpriced": sorted(m for m in self.unpriced if m),
        }

    def _follow_ups(self):
        prompts = [r.d for r in self.requests if r.d["kind"] == "prompt"]
        for a, b in zip(prompts, prompts[1:]):
            if b["at"] - a["end"] <= FOLLOW_UP_MS:
                a["next"] = b["i"]
                if b["flags"].get("corr"):
                    a["corrected"] = True
        # How many corrections in a row followed each prompt
        for i, a in enumerate(prompts):
            run = 0
            prev = a
            for b in prompts[i + 1:]:
                if b["at"] - prev["end"] > FOLLOW_UP_MS or not b["flags"].get("corr"):
                    break
                run += 1
                prev = b
            a["run"] = run

    def _gave_up(self):
        for task in set(self.failed) | set(self.asked):
            if task in self.succeeded:
                continue
            failed = self.failed.get(task, 0)
            steps = len(self.explore) + failed
            if steps >= 2 or failed >= 1 or task in self.asked:
                candidates = [x for x in (self.first_fail.get(task), self.asked.get(task)) if x is not None]
                starts = [s[2] for s in self.explore if s[2] >= 0] + [c for c in candidates if c >= 0]
                if starts:
                    self.requests[min(starts)].d["discovery"].append(
                        [task, steps, failed, sum(s[1] for s in self.explore), "gave-up", None, None,
                         "", False])

    def _orientation(self):
        named = self.first_prompt or ""
        out = []
        for tid, path in self.orientation.items():
            if not path or path in self.edited:
                continue
            base = os.path.basename(path).lower()
            if base and (base in named or path.lower() in named):
                continue
            out.append([path, self.orientation_tokens.get(tid, 0)])
        self.session["orientation"] = out


def extract(path, sid, project, is_main, excerpts=True):
    """-> the file's facts as plain data (see Extractor.finish)."""
    is_workflow = "/subagents/workflows/" in path.replace(os.sep, "/")
    x = Extractor(sid, project, is_main, is_workflow, excerpts)
    with open(path, errors="ignore") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                d = json.loads(line)
            except ValueError:
                continue
            if isinstance(d, dict):
                x.record(d)
    out = x.finish()
    if is_workflow and out["calls"]:
        out["feats"] = {"workflows": [1, out["calls"][0][C_TS], out["calls"][-1][C_TS]]}
    return out
