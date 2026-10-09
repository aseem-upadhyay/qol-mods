"""Builds Claude Code transcripts for coach's tests: only the fields it reads.

    s = Session("s1", "/work/my-app", at)
    s.prompt("fix the login bug in src/auth.ts")
    ids = s.call([("Read", {"file_path": "/work/my-app/src/auth.ts"})])
    s.results(ids)
    s.write(projects)

Times are epoch milliseconds; every record moves the session's clock on.
"""
import datetime
import json
import os
import re

MINUTE = 60 * 1000


def iso(ms):
    return datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).isoformat().replace("+00:00", "Z")


def slug_of(path):
    return re.sub(r"[^A-Za-z0-9]", "-", path)


class Session:
    def __init__(self, sid, cwd, at, model="claude-opus-5-5", entry="cli", version="2.1.293"):
        self.sid = sid
        self.cwd = cwd
        self.t = at
        self.model = model
        self.entry = entry
        self.version = version
        self.rows = []
        self.n = 0
        self.ctx = 20_000
        self.subagents = {}

    def _base(self, kind, **extra):
        self.n += 1
        d = {"type": kind, "uuid": f"{self.sid}-u{self.n}", "sessionId": self.sid, "timestamp": iso(self.t),
             "cwd": self.cwd, "version": self.version, "entrypoint": self.entry, "isSidechain": False}
        d.update(extra)
        return d

    # -- what the person does

    def prompt(self, text, minutes=1, mode="default", images=0, origin="human"):
        self.t += int(minutes * MINUTE)
        content = text if not images else [{"type": "text", "text": text}] + [
            {"type": "image", "source": {"type": "base64", "data": ""}}] * images
        self.rows.append(self._base("user", message={"role": "user", "content": content},
                                    origin={"kind": origin}, permissionMode=mode))
        return self

    def command(self, name, args="", minutes=1):
        self.t += int(minutes * MINUTE)
        text = f"<command-name>/{name}</command-name>\n<command-message>{name}</command-message>\n<command-args>{args}</command-args>"
        self.rows.append(self._base("user", message={"role": "user", "content": text}))
        return self

    def notification(self, text="<task-notification>done</task-notification>"):
        self.t += MINUTE
        self.rows.append(self._base("user", message={"role": "user", "content": text},
                                    origin={"kind": "task-notification"}))
        return self

    def interrupt(self):
        self.t += 1000
        self.rows.append(self._base("user", message={"role": "user", "content": [
            {"type": "text", "text": "[Request interrupted by user]"}]}))
        return self

    # -- what Claude does

    def call(self, tools=(), ctx=None, out=400, seconds=20, model=None, effort=None, w1h=False, fast=False,
             writes=1000, streamed=False):
        """One model call: its usage and tool uses. -> the tool_use ids."""
        self.t += int(seconds * 1000)
        if ctx is not None:
            self.ctx = ctx
        else:
            self.ctx += 3000
        mid = f"msg-{self.sid}-{self.n + 1}"
        content = [{"type": "tool_use", "id": f"tu-{self.sid}-{self.n + 1}-{i}", "name": name, "input": inp}
                   for i, (name, inp) in enumerate(tools)]
        usage = {
            "input_tokens": 50, "cache_read_input_tokens": max(0, self.ctx - 50 - writes),
            "cache_creation_input_tokens": writes, "output_tokens": out,
            "cache_creation": {"ephemeral_5m_input_tokens": 0 if w1h else writes,
                               "ephemeral_1h_input_tokens": writes if w1h else 0},
            "speed": "fast" if fast else "standard",
        }
        message = {"id": mid, "model": model or self.model, "role": "assistant", "content": content, "usage": usage}
        extra = {"effort": effort} if effort else {}
        if streamed:  # Claude Code writes a line per content block, the last with the final count
            first = dict(message, usage=dict(usage, output_tokens=1), content=[{"type": "text", "text": "…"}])
            self.rows.append(self._base("assistant", message=first, **extra))
        self.rows.append(self._base("assistant", message=message, **extra))
        return [c["id"] for c in content]

    def results(self, ids, errors=(), texts=None, denial=None, decision=None):
        self.t += 2000
        blocks = [{"type": "tool_result", "tool_use_id": i, "content": (texts or {}).get(i, "ok"),
                   "is_error": i in errors} for i in ids]
        extra = {}
        if denial:
            extra["toolDenialKind"] = denial
        if decision:
            extra["permissionDecision"] = decision
        self.rows.append(self._base("user", message={"role": "user", "content": blocks}, **extra))
        return self

    def step(self, name, inp, error=False, text="ok", **kw):
        """A call with one tool use, and its result."""
        ids = self.call([(name, inp)], **kw)
        self.results(ids, errors=ids if error else (), texts={ids[0]: text})
        return self

    def bash(self, command, error=False, text="ok", **kw):
        return self.step("Bash", {"command": command}, error=error, text=text, **kw)

    def read(self, path, text="x" * 400, **kw):
        return self.step("Read", {"file_path": os.path.join(self.cwd, path)}, text=text, **kw)

    def edit(self, path, **kw):
        return self.step("Edit", {"file_path": os.path.join(self.cwd, path), "old_string": "a", "new_string": "b"}, **kw)

    def answer(self, **kw):
        self.call(**kw)
        return self

    # -- what the engine writes

    def system(self, subtype, **extra):
        self.t += 1000
        self.rows.append(self._base("system", subtype=subtype, **extra))
        return self

    def compact(self, trigger="auto"):
        return self.system("compact_boundary", content="Conversation compacted", compactMetadata={"trigger": trigger})

    def api_error(self):
        return self.system("api_error", content="API Error")

    def title(self, text):
        self.rows.append({"type": "custom-title", "customTitle": text, "sessionId": self.sid})
        return self

    def ledger(self, usd):
        self.rows.append({"type": "cost-state", "totalCostUSD": usd, "sessionId": self.sid})
        return self

    def subagent(self, name, calls=1, ctx=30_000):
        rows = []
        for i in range(calls):
            self.t += 5000
            rows.append({"type": "assistant", "isSidechain": True, "sessionId": self.sid, "timestamp": iso(self.t),
                         "uuid": f"{self.sid}-{name}-{i}", "message": {
                             "id": f"msg-{self.sid}-{name}-{i}", "model": self.model, "content": [],
                             "usage": {"input_tokens": 10, "cache_read_input_tokens": ctx, "output_tokens": 300,
                                       "cache_creation_input_tokens": 0}}})
        self.subagents[name] = rows
        return self

    # -- on disk

    def write(self, projects, slug=None):
        folder = os.path.join(projects, slug or slug_of(self.cwd))
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, f"{self.sid}.jsonl")
        with open(path, "w") as fh:
            fh.write("\n".join(json.dumps(r) for r in self.rows) + "\n")
        for name, rows in self.subagents.items():
            sub = os.path.join(folder, self.sid, "subagents")
            os.makedirs(sub, exist_ok=True)
            with open(os.path.join(sub, f"{name}.jsonl"), "w") as fh:
                fh.write("\n".join(json.dumps(r) for r in rows) + "\n")
        return path
