"""What a repo's own git says happened, read from its reflogs on disk (SPEC.md
§5.2): the commits made on this machine and the branch switches, each with
its branch and minute. No git command runs: reflogs are plain text under
.git/logs, one line per move of a branch or of HEAD.
"""
import glob, os, re

# "<old sha> <new sha> Name <email> 1791521794 +0530\t<message>"
ENTRY = re.compile(r"^[0-9a-f]{40} [0-9a-f]{40} .*? <[^>]*> (\d+) [+-]\d{4}\t(.*)$")
COMMIT = re.compile(r"^(?:commit(?: \((?:initial|amend|merge)\))?|cherry-pick): (.+)$")
CHECKOUT = re.compile(r"^checkout: moving from .+ to (\S+)$")
SHA = re.compile(r"^[0-9a-f]{7,40}$")
SKIP_DIRS = frozenset(("node_modules", ".git", "vendor", "dist", "build", ".venv", "venv"))


def entries(path, lo, hi):
    """(epoch seconds, message) for each line of a reflog in [lo, hi)."""
    try:
        fh = open(path, encoding="utf-8", errors="replace")
    except OSError:
        return
    with fh:
        for line in fh:
            m = ENTRY.match(line.rstrip("\n"))
            if m and lo <= int(m.group(1)) < hi:
                yield int(m.group(1)), m.group(2)


def events(root, lo, hi):
    """What happened in the repo at `root` between epoch seconds `lo` and `hi`:
    [(minute, branch, kind, subject)]. A branch's own reflog gives its commits
    ("commit", with the subject) and its other moves ("other": created,
    reset, rebased, pulled); HEAD's, the main checkout's and each worktree's,
    gives the switches between branches ("checkout")."""
    git = os.path.join(root, ".git")
    if not os.path.isdir(git):
        return []
    out = []
    heads = os.path.join(git, "logs", "refs", "heads")
    for dirpath, _, names in os.walk(heads):
        for name in names:
            path = os.path.join(dirpath, name)
            branch = os.path.relpath(path, heads).replace(os.sep, "/")
            for ts, message in entries(path, lo, hi):
                c = COMMIT.match(message)
                if c:
                    out.append((ts // 60, branch, "commit", c.group(1).strip()))
                else:
                    out.append((ts // 60, branch, "other", None))
    for head in [os.path.join(git, "logs", "HEAD")] + glob.glob(os.path.join(git, "worktrees", "*", "logs", "HEAD")):
        for ts, message in entries(head, lo, hi):
            m = CHECKOUT.match(message)
            if m:
                target = m.group(1)
                out.append((ts // 60, "HEAD" if SHA.match(target) else target, "checkout", None))
    return sorted(out, key=lambda e: e[0])


def discover(paths):
    """The repos under each folder of `paths`: the folder itself when it is
    one, else its children and grandchildren that are, for work done in
    repos Claude was never opened in."""
    found = []

    def is_repo(p):
        return os.path.isdir(os.path.join(p, ".git"))

    def children(p):
        try:
            with os.scandir(p) as it:
                return sorted(e.path for e in it
                              if e.is_dir(follow_symlinks=False) and not e.name.startswith(".")
                              and e.name not in SKIP_DIRS)
        except OSError:
            return []

    for p in paths:
        if is_repo(p):
            found.append(p)
            continue
        for child in children(p):
            if is_repo(child):
                found.append(child)
                continue
            found.extend(g for g in children(child) if is_repo(g))
    return found
