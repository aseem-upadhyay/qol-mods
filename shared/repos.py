"""Folders to repos, by reading .git on disk (no git commands run).

Shared by worklog and repo-spend: scripts/sync-shared.py copies this file into
each plugin's hooks/ folder, so edit it here and run that script.
"""
import os, re


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
