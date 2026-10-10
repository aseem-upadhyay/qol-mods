"""What a session did, as facts read straight from its records (SPEC.md §6.6):
what the user asked, the commits and PRs Claude made, the files it changed,
and the checks it ran. Nothing is inferred by a model; each fact is quoted
or counted from the transcript, so a summary can say where it came from.
"""
import os, re

# git's own line for a commit it made: "[main 81b1368] Add the scanner".
COMMIT = re.compile(r"^\[([^\]\s]+)(?: \(root-commit\))? ([0-9a-f]{7,40})\] (.+)$", re.M)
# `gh pr create` run as a command (on one line of shell, see shell_lines).
PR_CREATE = re.compile(r"(?:^|[;&|(])\s*gh\s+pr\s+create\b(.*)")
TITLE = re.compile(r"""(?:--title|-t)(?:\s+|=)("(?:[^"\\]|\\.)*"|'[^']*'|[^\s"']+)""")
TEST = re.compile(
    r"(?:^|[;&|(]|\n|\s)(?:pytest|python3?\s+-m\s+(?:pytest|unittest)|(?:npm|yarn|pnpm|bun)\s+(?:run\s+)?test"
    r"|npx\s+(?:jest|vitest)|jest|vitest|go\s+test|cargo\s+test|claude\s+plugin\s+test|rspec|phpunit|mix\s+test)\b")
# `git commit` run as a command, its options and message after it (one line of shell).
COMMIT_CMD = re.compile(r"(?:^|[;&|(])\s*git(?:\s+-C\s+\S+)?\s+commit\b(.*)")
MESSAGE = re.compile(r"""(?:^|\s)(?:-[a-zA-Z]*m|--message)(?:\s+|=)("(?:[^"\\]|\\.)*"|'[^']*'|[^\s"']+)""")
# Where a here-document starts, and its terminator; not a here-string (<<<).
HEREDOC_START = re.compile(r"""(?<!<)<<(?!<)-?\s*(['"]?)(\w+)\1""")
SCRIPT = re.compile(r"\s*(?:cd\s+\S+\s*&&\s*)?(?:python3?|node|bun|deno|ruby|perl|bash\s+-c|sh\s+-c)\b")
EDIT_TOOLS = frozenset(("Edit", "Write", "MultiEdit", "NotebookEdit"))
COMMAND = re.compile(r"^\s*(?:<command-name>|<[a-z][a-z-]*-command>|\[Request interrupted by user)")
# Replies that carry no news of their own: "yes", "go ahead", "thanks".
CHATTER = re.compile(
    r"^(?:y|yes|yep|no|nope|ok(?:ay)?|sure|continue|go(?: ahead)?|proceed|thanks?(?: you)?|ty|lgtm|do it|done|"
    r"looks good|sounds good|perfect|great|nice)[\s.!]*$", re.I)
ASK_CHARS = 160
ASK_MIN_CHARS = 12


def _text(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text")
    return ""


def unquote(word):
    if len(word) >= 2 and word[0] == word[-1] == '"':
        return re.sub(r'\\(.)', r'\1', word[1:-1])
    if len(word) >= 2 and word[0] == word[-1] == "'":
        return word[1:-1]
    return word


def ask_of(text):
    """A prompt as one line worth quoting, or None for a reply with nothing in it."""
    if not isinstance(text, str) or COMMAND.search(text):
        return None
    # Tagged text is the machinery's (a task's notice, a subagent's report),
    # and a slash command is a command, not an ask.
    if text.lstrip().startswith(("<", "/")):
        return None
    line = " ".join(text.split())
    if len(line) < ASK_MIN_CHARS or CHATTER.match(line):
        return None
    return line if len(line) <= ASK_CHARS else line[:ASK_CHARS - 1].rstrip() + "…"


def shell_lines(command):
    """A Bash command as the shell reads it: [(line, [(column, body)])], each
    here-document's body taken out of the lines and kept beside the line it
    starts on. Text written into a file with `cat > f <<'EOF'` is then never
    read as a `git commit` or a `gh pr create` of its own."""
    lines = (command or "").replace("\\\n", " ").split("\n")
    out, i = [], 0
    while i < len(lines):
        line = lines[i]
        i += 1
        docs = []
        for m in HEREDOC_START.finditer(line):
            body = []
            while i < len(lines) and lines[i].strip() != m.group(2):
                body.append(lines[i])
                i += 1
            i += 1
            docs.append((m.start(), "\n".join(body)))
        out.append((line, docs))
    return out


def pr_title(command):
    """The --title of a `gh pr create` in a Bash command, or None."""
    for line, _ in shell_lines(command):
        m = PR_CREATE.search(line)
        t = TITLE.search(m.group(1)) if m else None
        if t:
            return " ".join(unquote(t.group(1)).split()) or None
    return None


def commit_subjects(command):
    """The subject of each commit a Bash command makes: from -m, from a
    here-document (`-F -`, or `-m "$(cat <<'EOF' …)"`), first line only.
    A command that runs a script is skipped: a `git commit` in it is the
    script's text, not a commit."""
    if SCRIPT.match(command or ""):
        return []
    out = []
    for line, docs in shell_lines(command):
        for m in COMMIT_CMD.finditer(line):
            msg = MESSAGE.search(m.group(1))
            body = unquote(msg.group(1)) if msg else ""
            if not msg or "<<" in body:
                body = next((doc for at, doc in docs if at > m.start()), "")
            subject = next((part.strip() for part in body.splitlines() if part.strip()), "")
            if subject:
                out.append(subject)
    return out


def runs_tests(command):
    """Whether a Bash command runs a test runner, outside any here-document."""
    return any(TEST.search(line) for line, _ in shell_lines(command))


def facts_of(d, is_human):
    """[(kind, value)] for one record: ask, edit, test, commit, or prtitle."""
    kind = d.get("type")
    out = []
    # A queued message is quoted from its own user record once it's taken
    # up; the queue also carries the engine's notices, which aren't the user's.
    if kind == "queue-operation":
        return out
    content = (d.get("message") or {}).get("content")
    if kind == "assistant" and isinstance(content, list):
        for b in content:
            if not isinstance(b, dict) or b.get("type") != "tool_use":
                continue
            name, inp = b.get("name"), b.get("input") or {}
            if name in EDIT_TOOLS:
                path = inp.get("file_path") or inp.get("notebook_path")
                if isinstance(path, str) and path:
                    out.append(("edit", path))
            elif name == "Bash":
                command = inp.get("command") or ""
                if runs_tests(command):
                    out.append(("test", 1))
                out.extend(("commit", subject) for subject in commit_subjects(command))
                title = pr_title(command)
                if title:
                    out.append(("prtitle", title))
    elif kind == "user" and isinstance(content, list):
        for b in content:
            if isinstance(b, dict) and b.get("type") == "tool_result":
                for m in COMMIT.finditer(_text(b.get("content"))):
                    out.append(("commit", m.group(3).strip()))
    if kind == "user" and is_human and not isinstance(d.get("permissionDecision"), dict):
        ask = ask_of(_text(content))
        if ask:
            out.append(("ask", ask))
    return out


def pick_asks(asks, n=3):
    """Up to `n` of the day's prompts, in the order asked: the longest, as the
    ones most likely to say what the work was."""
    seen, unique = set(), []
    for at, text in sorted(asks):
        if text not in seen:
            seen.add(text)
            unique.append((at, text))
    keep = sorted(sorted(unique, key=lambda a: -len(a[1]))[:n])
    return [text for _, text in keep]


TEMP = ("/tmp/", "/private/tmp/", "/var/folders/", "/private/var/folders/")


def relative(path, root, home):
    """A changed file as the repo names it: "hooks/scan.py", a worktree's
    included; outside the repo, from ~. None for scratch files and Claude's
    own (memory, settings), which aren't the work."""
    p = os.path.normpath(path)
    if root and p.startswith(root.rstrip("/") + "/"):
        rel = p[len(root.rstrip("/")) + 1:]
        parts = rel.split("/")
        if parts[:2] == [".claude", "worktrees"] and len(parts) > 3:
            rel = "/".join(parts[3:])
        return rel
    if p.startswith(TEMP) or (home and p.startswith(home.rstrip("/") + "/.claude/")):
        return None
    if home and p.startswith(home.rstrip("/") + "/"):
        return "~/" + p[len(home.rstrip("/")) + 1:]
    return p


FOLDER_DEPTH = 3


def folders(files):
    """Changed files by folder, at most three levels deep, so a long list of
    paths reads as where the work was: [(folder, files)], most files first.
    A file at the top of the repo is in "." ."""
    count = {}
    for path in files:
        folder = os.path.dirname(path)
        parts = folder.split("/") if folder else []
        if parts and parts[0] == "~":
            parts = parts[:FOLDER_DEPTH + 1]
        else:
            parts = parts[:FOLDER_DEPTH]
        key = "/".join(parts) or "."
        count[key] = count.get(key, 0) + 1
    return sorted(count.items(), key=lambda kv: (-kv[1], kv[0]))
