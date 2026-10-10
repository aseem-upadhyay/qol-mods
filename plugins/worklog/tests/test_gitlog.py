"""Tests for hooks/gitlog.py and hooks/ghsearch.py. Run: python3 -m unittest discover -s tests"""
import json, os, sys, tempfile, unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "hooks"))
import ghsearch  # noqa: E402
from gitlog import discover, events  # noqa: E402

A, B = "a" * 40, "b" * 40


def reflog(path, *lines):
    """Writes reflog lines: (epoch seconds, message)."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a") as fh:
        for ts, message in lines:
            fh.write(f"{A} {B} Some One <one@example.com> {ts} +0000\t{message}\n")


class EventsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = os.path.join(self.tmp.name, "app")
        self.logs = os.path.join(self.root, ".git", "logs")

    def tearDown(self):
        self.tmp.cleanup()

    def test_commits_by_branch_and_switches_from_head(self):
        reflog(os.path.join(self.logs, "refs", "heads", "feature", "login"),
               (600, "branch: Created from main"), (660, "commit: Fix the login"),
               (720, "commit (amend): Fix the login bug"), (780, "rebase (finish): refs/heads/feature/login onto x"))
        reflog(os.path.join(self.logs, "HEAD"),
               (540, "checkout: moving from main to feature/login"), (900, "checkout: moving from feature/login to 1a2b3c4"),
               (960, "commit: Fix the login"))
        self.assertEqual(events(self.root, 0, 10_000), [
            (9, "feature/login", "checkout", None),
            (10, "feature/login", "other", None),
            (11, "feature/login", "commit", "Fix the login"),
            (12, "feature/login", "commit", "Fix the login bug"),
            (13, "feature/login", "other", None),
            (15, "HEAD", "checkout", None),
        ])

    def test_only_the_window(self):
        reflog(os.path.join(self.logs, "refs", "heads", "main"), (60, "commit: old"), (6000, "commit: new"))
        self.assertEqual(events(self.root, 3000, 9000), [(100, "main", "commit", "new")])

    def test_a_worktrees_switches_count_too(self):
        reflog(os.path.join(self.logs, "..", "worktrees", "wt", "logs", "HEAD"), (120, "checkout: moving from main to wt"))
        self.assertEqual(events(self.root, 0, 1000), [(2, "wt", "checkout", None)])

    def test_no_git_no_events(self):
        self.assertEqual(events(os.path.join(self.tmp.name, "nothing"), 0, 1000), [])

    def test_repos_found_under_a_folder_two_levels_down(self):
        for rel in ("code/one", "code/org/two", "code/org/node_modules/x", "code/.hidden/three"):
            os.makedirs(os.path.join(self.tmp.name, rel, ".git"))
        code = os.path.join(self.tmp.name, "code")
        self.assertEqual(discover([code]), [os.path.join(code, "one"), os.path.join(code, "org", "two")])
        self.assertEqual(discover([os.path.join(code, "one")]), [os.path.join(code, "one")])


class GitHubTest(unittest.TestCase):
    ANSWER = {"viewer": {"login": "me"},
              "authored": {"nodes": [
                  {"number": 9, "title": "Add worklog", "url": "u9", "state": "OPEN", "isDraft": True,
                   "headRefName": "worklog", "repository": {"nameWithOwner": "me/app"}},
                  {}]},
              "reviewed": {"nodes": [
                  {"number": 3, "title": "Their fix", "url": "u3", "state": "MERGED", "isDraft": False,
                   "headRefName": "fix", "repository": {"nameWithOwner": "them/api"},
                   "reviews": {"nodes": [{"author": {"login": "me"}, "submittedAt": "2026-10-07T10:00:00Z"},
                                         {"author": {"login": "them"}, "submittedAt": "2026-10-07T11:00:00Z"}]}}]}}

    def test_the_answer_read(self):
        got = ghsearch.parse(self.ANSWER)
        self.assertEqual(got["authored"], [{"repo": "me/app", "number": 9, "title": "Add worklog", "url": "u9",
                                            "state": "open", "isDraft": True, "branch": "worklog"}])
        self.assertEqual(got["reviewed"][0]["reviewedAt"], ["2026-10-07T10:00:00Z"])

    def test_a_fresh_answer_is_reused_and_a_failure_keeps_the_last(self):
        cache = {"github": {"at": 1000, "since": "2026-10-01", "data": {"login": "me", "authored": [], "reviewed": []}}}
        self.assertEqual(ghsearch.cached(cache, None, "2026-10-05", 1100)["login"], "me")
        # Stale, and no gh to ask: the last answer stands.
        self.assertEqual(ghsearch.cached(cache, None, "2026-10-05", 99_999)["login"], "me")
        self.assertIsNone(ghsearch.cached({}, None, "2026-10-05", 99_999))


if __name__ == "__main__":
    unittest.main()
