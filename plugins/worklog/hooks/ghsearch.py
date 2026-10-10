"""PR titles and states, the PRs the user reviewed and their open PRs, from
GitHub through the user's own `gh` login (SPEC.md §5.3). One read-only
GraphQL search per scan, kept for ten minutes. Anything that goes wrong (no
gh, signed out, offline, slow) leaves the rest of the scan as it was.
"""
import json, os, shutil, subprocess

QUERY = (
    "query($authored:String!,$reviewed:String!){viewer{login}"
    " authored:search(query:$authored,type:ISSUE,first:100){nodes{...pr}}"
    " reviewed:search(query:$reviewed,type:ISSUE,first:50){nodes{...pr"
    " ... on PullRequest{reviews(last:30){nodes{author{login} submittedAt}}}}}}"
    " fragment pr on PullRequest{number title url state isDraft headRefName repository{nameWithOwner}}")
# A standup never waits on the network longer than this.
TIMEOUT_S = 5
FRESH_S = 10 * 60
PLACES = ("/opt/homebrew/bin/gh", "/usr/local/bin/gh", "/usr/bin/gh")


def find_gh(given=None):
    """The gh to run: `given`, else the one on PATH, else a usual place.
    An app started from the dock may not have Homebrew on its PATH."""
    if given:
        return given if os.path.exists(given) else None
    return shutil.which("gh") or next((p for p in PLACES if os.path.exists(p)), None)


def _pr(n):
    return {
        "repo": n["repository"]["nameWithOwner"],
        "number": n["number"],
        "title": n.get("title") or "",
        "url": n.get("url") or "",
        "state": str(n.get("state") or "").lower(),
        "isDraft": bool(n.get("isDraft")),
        "branch": n.get("headRefName") or "",
    }


def parse(data):
    """The search's answer as {"login", "authored": [pr], "reviewed": [pr + reviewedAt]}."""
    login = data["viewer"]["login"]
    authored = [_pr(n) for n in data["authored"]["nodes"] if n and "number" in n]
    reviewed = []
    for n in data["reviewed"]["nodes"]:
        if not n or "number" not in n:
            continue
        times = [r["submittedAt"] for r in ((n.get("reviews") or {}).get("nodes") or [])
                 if r and (r.get("author") or {}).get("login") == login and r.get("submittedAt")]
        reviewed.append({**_pr(n), "reviewedAt": times})
    return {"login": login, "authored": authored, "reviewed": reviewed}


def fetch(gh, since):
    """The user's PRs updated since `since` (YYYY-MM-DD), and those they
    reviewed, or None."""
    argv = [gh, "api", "graphql", "-f", f"query={QUERY}",
            "-f", f"authored=is:pr author:@me updated:>={since}",
            "-f", f"reviewed=is:pr reviewed-by:@me -author:@me updated:>={since}"]
    try:
        run = subprocess.run(argv, capture_output=True, text=True, timeout=TIMEOUT_S)
    except (OSError, subprocess.SubprocessError):
        return None
    if run.returncode != 0:
        return None
    try:
        return parse(json.loads(run.stdout)["data"])
    except (ValueError, KeyError, TypeError):
        return None


def cached(cache, gh, since, now):
    """The search, from `cache` while one reaching at least as far back is
    under ten minutes old; a fresh one stored there otherwise. A failed
    fetch falls back to whatever the cache holds, however old."""
    hit = cache.get("github")
    if hit and now - hit.get("at", 0) < FRESH_S and hit.get("since", "9999") <= since:
        return hit["data"]
    data = fetch(gh, since) if gh else None
    if data is not None:
        cache["github"] = {"at": now, "since": since, "data": data}
        return data
    return hit["data"] if hit else None
