"""Tests for hooks/scan.py, end to end. Run: python3 -m unittest discover -s tests"""
import datetime, json, os, re, shutil, subprocess, sys, tempfile, time, unittest

SCAN = os.path.join(os.path.dirname(__file__), "..", "hooks", "scan.py")
# Days start at 04:00 local: pin the zone so they fall the same everywhere.
ENV = {**os.environ, "TZ": "UTC"}
DAY = "2026-10-07"


def at(hhmm, day=DAY):
    return f"{day}T{hhmm}:00.000Z"


def slug_of(path):
    return re.sub(r"[^A-Za-z0-9]", "-", path)


class ScanTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = os.path.join(self.tmp.name, "home")
        self.projects = os.path.join(self.home, ".claude", "projects")
        self.cache = os.path.join(self.tmp.name, "cache", "worklog.json")
        self.app = self.repo("work/app", origin="git@github.com:me/app.git", head="main")
        self.api = self.repo("work/api")
        self.rows = {}

    def tearDown(self):
        self.tmp.cleanup()

    # -- building a machine

    def repo(self, rel, origin=None, head=None):
        root = os.path.join(self.home, rel)
        git = os.path.join(root, ".git")
        os.makedirs(os.path.join(git, "refs", "remotes", "origin"))
        with open(os.path.join(git, "config"), "w") as fh:
            fh.write("[core]\n\tbare = false\n")
            if origin:
                fh.write(f'[remote "origin"]\n\turl = {origin}\n')
        if head:
            with open(os.path.join(git, "refs", "remotes", "origin", "HEAD"), "w") as fh:
                fh.write(f"ref: refs/remotes/origin/{head}\n")
        return root

    def add(self, sid, kind, when, cwd=None, branch="main", **extra):
        d = {"type": kind, "sessionId": sid, "timestamp": when}
        if cwd is not None:
            d.update(cwd=cwd, gitBranch=branch, entrypoint="cli")
        d.update(extra)
        self.rows.setdefault(sid, {"cwd": cwd, "rows": []})["rows"].append(d)
        if cwd is not None and self.rows[sid]["cwd"] is None:
            self.rows[sid]["cwd"] = cwd

    def prompt(self, sid, when, cwd, branch="main", text="fix the login bug", **extra):
        self.add(sid, "user", when, cwd, branch, origin={"kind": "human"},
                 message={"role": "user", "content": text}, **extra)

    def work(self, sid, when, cwd, branch="main", **extra):
        self.add(sid, "assistant", when, cwd, branch, message={"role": "assistant", "content": []}, **extra)

    def write(self):
        for sid, s in self.rows.items():
            folder = os.path.join(self.projects, slug_of(s["cwd"]))
            os.makedirs(folder, exist_ok=True)
            with open(os.path.join(folder, f"{sid}.jsonl"), "w") as fh:
                fh.write("\n".join(json.dumps(r) for r in s["rows"]) + "\n")

    def scan(self, first=DAY, last=DAY, *extra):
        self.write()
        argv = [sys.executable, SCAN, "--projects", self.projects, "--cache", self.cache,
                "--from", first, "--to", last, "--home", self.home,
                "--temp", os.path.join(self.home, "scratch") + "/", "--github", "off", *extra]
        out = subprocess.run(argv, check=True, capture_output=True, text=True, env=ENV).stdout
        return json.loads(out)

    def reflog(self, root, branch, *lines):
        """Git's record of `branch` in the repo at `root`: (HH:MM on DAY, message)."""
        path = os.path.join(root, ".git", "logs", "refs", "heads", branch)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "a") as fh:
            for hhmm, message in lines:
                ts = int(datetime.datetime.fromisoformat(at(hhmm).replace("Z", "+00:00")).timestamp())
                fh.write(f"{'a' * 40} {'b' * 40} Me <me@example.com> {ts} +0000\t{message}\n")

    def fake_gh(self, answer=None, code=0):
        """A gh that answers every call with `answer`, or fails with `code`."""
        path = os.path.join(self.tmp.name, "gh")
        with open(path, "w") as fh:
            fh.write("#!/bin/sh\n")
            fh.write(f"exit {code}\n" if code else "cat <<'EOF'\n" + json.dumps({"data": answer}) + "\nEOF\n")
        os.chmod(path, 0o755)
        return path

    def day(self, *extra):
        return self.scan(DAY, DAY, *extra)["days"][0]

    def group(self, day, repo, branch):
        for r in day["repos"]:
            if r["name"] == repo:
                for g in r["groups"]:
                    if g["branch"] == branch:
                        return g
        self.fail(f"no {repo} [{branch}] in {json.dumps(day)[:400]}")

    # -- tests

    def test_parallel_sessions_split_the_wall_clock(self):
        src = os.path.join(self.app, "src")
        self.prompt("s1", at("10:00"), src, "feat")
        self.work("s1", at("10:05"), src, "feat")
        self.work("s1", at("10:10"), src, "feat")
        self.prompt("s2", at("10:00"), self.api, "main")
        self.work("s2", at("10:10"), self.api, "main")
        day = self.day()
        # 09:55 to 10:10, both sessions throughout: 16 minutes, half each.
        self.assertEqual(day["totalMin"], 16)
        feat = self.group(day, "app", "feat")
        main = self.group(day, "api", "main")
        self.assertEqual(feat["minutes"] + main["minutes"], 16)
        self.assertEqual(feat["rawMin"], 16)
        self.assertEqual((feat["first"], feat["last"]), ("09:55", "10:11"))
        self.assertFalse(feat["isDefault"])
        self.assertTrue(main["isDefault"])
        app = next(r for r in day["repos"] if r["name"] == "app")
        self.assertEqual((app["slug"], app["root"]), ("me/app", self.app))

    def test_a_branch_switch_keeps_the_user_there(self):
        self.prompt("s1", at("10:00"), self.app, "feat")
        self.work("s1", at("10:05"), self.app, "feat")
        self.work("s1", at("10:10"), self.app, "fix")
        self.work("s1", at("10:20"), self.app, "fix")
        day = self.day()
        fix = self.group(day, "app", "fix")
        self.assertEqual(fix["rawMin"], 11)
        self.assertEqual(fix["unattendedMin"], 0)
        self.assertEqual(day["totalMin"], 26)

    def test_a_long_run_alone_is_capped(self):
        self.prompt("s1", at("10:00"), self.app, "feat")
        for minute in range(5, 60, 5):
            self.work("s1", at(f"10:{minute:02d}"), self.app, "feat")
        self.work("s1", at("11:00"), self.app, "feat")
        day = self.day()
        self.assertEqual(day["totalMin"], 36)
        self.assertEqual(day["unattendedMin"], 30)

    def test_a_deleted_worktree_counts_toward_its_repo(self):
        gone = os.path.join(self.app, ".claude", "worktrees", "wt1")
        self.prompt("s1", at("10:00"), gone, "claude/wt1")
        self.work("s1", at("10:05"), gone, "claude/wt1")
        self.assertEqual(self.group(self.day(), "app", "claude/wt1")["rawMin"], 11)

    def test_a_worktree_elsewhere_counts_toward_its_repo(self):
        wt = os.path.join(self.home, "work", "app-wt")
        own = os.path.join(self.app, ".git", "worktrees", "wt")
        os.makedirs(own)
        os.makedirs(wt)
        with open(os.path.join(own, "commondir"), "w") as fh:
            fh.write("../..\n")
        with open(os.path.join(wt, ".git"), "w") as fh:
            fh.write(f"gitdir: {own}\n")
        self.prompt("s1", at("10:00"), wt, "wt")
        self.assertEqual(self.group(self.day(), "app", "wt")["rawMin"], 6)

    def test_scratch_folders_and_folders_outside_a_repo_are_left_out(self):
        scratch = os.path.join(self.home, "scratch", "probe")
        notes = os.path.join(self.home, "notes")
        os.makedirs(notes)
        self.prompt("s1", at("10:00"), scratch, "main")
        self.prompt("s2", at("11:00"), notes, "")
        self.assertEqual(self.day()["repos"], [])
        day = self.day("--include-non-repo")
        self.assertEqual([r["name"] for r in day["repos"]], ["Other"])
        self.assertEqual(day["totalMin"], 6)

    def test_a_pr_link_names_the_branchs_pr(self):
        self.prompt("s1", at("10:00"), self.app, "feat")
        self.add("s1", "pr-link", at("10:03"), prNumber=7, prUrl="https://github.com/me/app/pull/7",
                 prRepository="me/app")
        self.assertEqual(self.group(self.day(), "app", "feat")["pr"],
                         {"number": 7, "url": "https://github.com/me/app/pull/7", "repo": "me/app", "title": None,
                          "state": None, "isDraft": False})

    def test_a_pr_opened_in_the_turn_that_made_its_branch_goes_to_that_branch(self):
        # Records carry the branch the turn started on; the next prompt carries the new one.
        self.prompt("s1", at("10:00"), self.app, "old")
        self.work("s1", at("10:02"), self.app, "old")
        self.add("s1", "pr-link", at("10:03"), prNumber=6, prUrl="https://github.com/me/app/pull/6",
                 prRepository="me/app")
        self.prompt("s1", at("10:05"), self.app, "new")
        day = self.day()
        self.assertEqual(self.group(day, "app", "new")["pr"]["number"], 6)
        self.assertIsNone(self.group(day, "app", "old")["pr"])

    def test_a_pr_checked_again_from_another_branch_stays_on_its_own(self):
        self.prompt("s1", at("10:00"), self.app, "first")
        self.add("s1", "pr-link", at("10:01"), prNumber=6, prUrl="https://github.com/me/app/pull/6",
                 prRepository="me/app")
        self.prompt("s1", at("10:02"), self.app, "first")
        self.prompt("s1", at("10:10"), self.app, "second")
        self.add("s1", "pr-link", at("10:11"), prNumber=6, prUrl="https://github.com/me/app/pull/6",
                 prRepository="me/app")
        self.add("s1", "pr-link", at("10:12"), prNumber=7, prUrl="https://github.com/me/app/pull/7",
                 prRepository="me/app")
        self.prompt("s1", at("10:13"), self.app, "second")
        day = self.day()
        self.assertEqual(self.group(day, "app", "first")["pr"]["number"], 6)
        self.assertEqual(self.group(day, "app", "second")["pr"]["number"], 7)

    def test_a_headless_run_is_unattended(self):
        self.prompt("s1", at("10:00"), self.app, "main", entrypoint="sdk-cli")
        self.work("s1", at("10:10"), self.app, "main", entrypoint="sdk-cli")
        day = self.day()
        self.assertEqual(day["totalMin"], 0)
        self.assertEqual(day["unattendedMin"], 11)
        self.assertEqual(self.group(day, "app", "main")["minutes"], 0)

    def test_tool_results_and_reminders_are_not_the_user(self):
        self.work("s1", at("10:00"), self.app, "feat")
        self.add("s1", "user", at("10:02"), self.app, "feat",
                 message={"role": "user", "content": [{"type": "tool_result", "content": "ok"}]})
        self.add("s1", "user", at("10:03"), self.app, "feat",
                 message={"role": "user", "content": "<system-reminder>hi</system-reminder>"})
        self.add("s1", "user", at("10:04"), self.app, "feat", origin={"kind": "task-notification"},
                 message={"role": "user", "content": "the task finished"})
        self.assertEqual(self.day()["totalMin"], 0)

    def test_a_message_queued_while_claude_works_is_the_user(self):
        self.work("s1", at("10:00"), self.app, "feat")
        self.add("s1", "queue-operation", at("10:00"), operation="enqueue", content="also do x")
        self.work("s1", at("10:05"), self.app, "feat")
        self.assertEqual(self.day()["totalMin"], 11)

    def test_work_after_midnight_belongs_to_the_evening_before(self):
        self.prompt("s1", at("23:50"), self.app, "feat")
        self.work("s1", at("02:00", "2026-10-08"), self.app, "feat")
        self.prompt("s1", at("02:00", "2026-10-08"), self.app, "feat")
        self.prompt("s1", at("05:00", "2026-10-08"), self.app, "feat")
        days = self.scan(DAY, "2026-10-08")["days"]
        self.assertEqual([d["date"] for d in days], [DAY, "2026-10-08"])
        self.assertEqual(days[0]["totalMin"], 6 + 6)
        self.assertEqual(days[1]["totalMin"], 6)

    def test_excluded_folders_are_never_read(self):
        self.prompt("s1", at("10:00"), self.app, "feat")
        self.prompt("s2", at("10:00"), self.api, "main")
        day = self.day("--exclude", self.api)
        self.assertEqual([r["name"] for r in day["repos"]], ["app"])

    def test_session_titles_say_what(self):
        self.prompt("s1", at("10:00"), self.app, "feat")
        self.add("s1", "custom-title", at("10:01"), customTitle="Fix the login bug")
        self.prompt("s2", at("10:00"), self.app, "feat")
        self.add("s2", "custom-title", at("10:01"), customTitle="New session")
        self.assertEqual(self.group(self.day(), "app", "feat")["what"], ["Fix the login bug"])

    def test_the_cache_picks_up_new_records(self):
        self.prompt("s1", at("10:00"), self.app, "feat")
        self.assertEqual(self.day()["totalMin"], 6)
        self.work("s1", at("10:10"), self.app, "feat")
        self.assertEqual(self.day()["totalMin"], 16)
        self.assertEqual(self.day()["totalMin"], 16)

    def test_days_can_count_back_from_today(self):
        out = self.scan("-1", "0")
        self.assertEqual(len(out["days"]), 2)
        self.assertEqual(out["days"][1]["date"], out["today"])

    def test_spans_say_when_each_branch_was_worked_on(self):
        self.prompt("s1", at("10:00"), self.app, "feat")
        for minute in range(5, 60, 5):
            self.work("s1", at(f"10:{minute:02d}"), self.app, "feat")
        g = self.group(self.day(), "app", "feat")
        # From 04:00: 09:55 is minute 355; attended to 10:30, Claude alone to 10:55.
        self.assertEqual(g["spans"], [[355, 391]])
        self.assertEqual(g["aloneSpans"], [[391, 416]])
        repo = self.day()["repos"][0]
        self.assertEqual((repo["hours"][5], repo["hours"][6]), (5, 31))

    def test_each_branch_says_what_was_asked_committed_changed_and_checked(self):
        self.prompt("s1", at("10:00"), self.app, "feat", text="fix the login bug in src/auth.ts")
        self.add("s1", "assistant", at("10:02"), self.app, "feat", message={"content": [
            {"type": "tool_use", "name": "Edit", "input": {"file_path": os.path.join(self.app, "src/auth.ts")}},
            {"type": "tool_use", "name": "Edit", "input": {"file_path": os.path.join(self.app, "src/auth.ts")}},
            {"type": "tool_use", "name": "Bash", "input": {"command": "npm test"}},
            {"type": "tool_use", "name": "Bash", "input": {"command": 'git commit -qm "Fix the login bug"'}},
            {"type": "tool_use", "name": "Bash", "input": {"command": 'gh pr create --title "Fix login" --body x'}},
        ]})
        self.add("s1", "pr-link", at("10:03"), prNumber=9, prUrl="https://github.com/me/app/pull/9",
                 prRepository="me/app")
        g = self.group(self.day(), "app", "feat")
        self.assertEqual(g["asks"], ["fix the login bug in src/auth.ts"])
        self.assertEqual((g["commits"], g["commitCount"]), (["Fix the login bug"], 1))
        self.assertEqual((g["files"], g["fileCount"]), ([["src/auth.ts", 2]], 1))
        self.assertEqual((g["dirs"], g["dirCount"]), ([["src", 1]], 1))
        self.assertEqual(g["tests"], 1)
        self.assertEqual(g["pr"]["title"], "Fix login")
        self.assertEqual(self.group(self.day("--no-asks"), "app", "feat")["asks"], [])

    def test_a_shared_minute_goes_mostly_to_the_session_typed_in(self):
        # api is prompted once and left to work; app is prompted every five minutes.
        self.prompt("s2", at("09:59"), self.api, "main")
        for minute in range(5, 31, 5):
            self.work("s2", at(f"10:{minute:02d}"), self.api, "main")
        for minute in range(0, 31, 5):
            self.prompt("s1", at(f"10:{minute:02d}"), self.app, "feat")
        day = self.day()
        app, api = self.group(day, "app", "feat"), self.group(day, "api", "main")
        self.assertEqual(day["totalMin"], 37)
        self.assertEqual((app["minutes"], api["minutes"]), (26, 11))
        even = self.day("--split", "even")
        app, api = self.group(even, "app", "feat"), self.group(even, "api", "main")
        self.assertEqual(sorted((app["minutes"], api["minutes"])), [18, 19])

    # -- git (SPEC.md §5.2)

    def test_a_commit_made_outside_claude_counts_as_the_users_time(self):
        self.reflog(self.api, "fix", ("19:00", "commit: Fix the rate limit"))
        self.assertEqual(self.day()["repos"], [])   # api isn't a repo any session was in
        day = self.day("--extra-roots", os.path.join(self.home, "work"))
        g = self.group(day, "api", "fix")
        self.assertEqual((g["rawMin"], g["first"], g["last"]), (6, "18:55", "19:01"))
        self.assertEqual((g["commits"], g["handCommits"], g["sessions"]), (["Fix the rate limit"], ["Fix the rate limit"], []))

    def test_a_commit_claude_made_goes_with_its_session_once(self):
        self.prompt("s1", at("10:00"), self.app, "old")
        self.add("s1", "assistant", at("10:02"), self.app, "old", message={"content": [
            {"type": "tool_use", "name": "Bash", "input": {"command": 'git commit -qm "Add login"'}}]})
        # git says it landed on "new": the turn made the branch, and records carry the turn's first.
        self.reflog(self.app, "new", ("10:03", "branch: Created from old"), ("10:03", "commit: Add login"))
        day = self.day()
        g = self.group(day, "app", "old")
        self.assertEqual((g["commits"], g["handCommits"]), (["Add login"], []))
        self.assertEqual(day["totalMin"], 8)   # 09:55 to 10:02: git added no time of its own

    def test_a_commit_a_session_made_in_another_repo_is_still_claudes(self):
        self.prompt("s1", at("10:00"), self.api, "main")
        self.add("s1", "assistant", at("10:01"), self.api, "main", message={"content": [
            {"type": "tool_use", "name": "Bash", "input": {"command": 'cd ../app && git commit -qm "Add login"'}}]})
        self.prompt("s2", at("08:00"), self.app, "main")   # app is a repo sessions were in
        self.reflog(self.app, "main", ("10:01", "commit: Add login"))
        day = self.day()
        self.assertEqual(self.group(day, "api", "main")["commits"], ["Add login"])
        self.assertEqual(self.group(day, "app", "main")["commits"], [])

    def test_a_branch_switch_by_hand_is_time_too(self):
        os.makedirs(os.path.join(self.app, ".git", "logs"), exist_ok=True)
        ts = int(datetime.datetime.fromisoformat(at("21:00").replace("Z", "+00:00")).timestamp())
        with open(os.path.join(self.app, ".git", "logs", "HEAD"), "w") as fh:
            fh.write(f"{'a' * 40} {'b' * 40} Me <me@example.com> {ts} +0000\tcheckout: moving from main to review\n")
        self.prompt("s1", at("08:00"), self.app, "main")
        self.assertEqual(self.group(self.day(), "app", "review")["rawMin"], 6)

    # -- the archive (SPEC.md §7.2)

    def test_a_settled_day_is_kept_and_read_back_once_its_logs_are_gone(self):
        archive = os.path.join(self.tmp.name, "archive")
        keep = ("--archive", archive, "--today", "2026-10-12")
        self.prompt("s1", at("10:00"), self.app, "feat")
        self.assertEqual(self.day(*keep)["source"], "logs")
        self.assertTrue(os.path.exists(os.path.join(archive, DAY + ".json")))
        shutil.rmtree(self.projects)   # Claude Code deletes the log
        self.rows = {}
        day = self.day(*keep)
        self.assertEqual((day["source"], day["totalMin"]), ("archive", 6))
        self.assertEqual(self.group(day, "app", "feat")["asks"], ["fix the login bug"])
        self.assertEqual(self.group(self.day(*keep, "--no-asks"), "app", "feat")["asks"], [])
        day = self.day(*keep, "--exclude", self.app)
        self.assertEqual((day["repos"], day["totalMin"]), ([], 0))

    def test_a_day_too_new_to_have_settled_is_not_kept(self):
        archive = os.path.join(self.tmp.name, "archive")
        self.prompt("s1", at("10:00"), self.app, "feat")
        self.day("--archive", archive, "--today", "2026-10-08")
        self.assertFalse(os.path.exists(os.path.join(archive, DAY + ".json")))

    # -- GitHub (SPEC.md §5.3)

    ANSWER = {"viewer": {"login": "me"},
              "authored": {"nodes": [
                  {"number": 9, "title": "Add worklog", "url": "u9", "state": "OPEN", "isDraft": True,
                   "headRefName": "worklog", "repository": {"nameWithOwner": "me/app"}},
                  {"number": 7, "title": "Fix it properly", "url": "u7", "state": "MERGED", "isDraft": False,
                   "headRefName": "fix", "repository": {"nameWithOwner": "me/app"}}]},
              "reviewed": {"nodes": [
                  {"number": 3, "title": "Their fix", "url": "u3", "state": "OPEN", "isDraft": False,
                   "headRefName": "x", "repository": {"nameWithOwner": "them/api"},
                   "reviews": {"nodes": [{"author": {"login": "me"}, "submittedAt": DAY + "T12:00:00Z"}]}}]}}

    def test_github_names_the_prs_and_says_what_was_reviewed_and_is_open(self):
        self.prompt("s1", at("10:00"), self.app, "worklog")
        self.prompt("s2", at("11:00"), self.app, "fix")
        self.add("s2", "pr-link", at("11:01"), prNumber=7, prUrl="https://github.com/me/app/pull/7", prRepository="me/app")
        out = self.scan(DAY, DAY, "--github", "on", "--gh", self.fake_gh(self.ANSWER))
        day = out["days"][0]
        self.assertEqual(out["github"], "ok")
        self.assertEqual(self.group(day, "app", "worklog")["pr"],
                         {"number": 9, "url": "u9", "repo": "me/app", "title": "Add worklog", "state": "open", "isDraft": True})
        self.assertEqual(self.group(day, "app", "fix")["pr"]["title"], "Fix it properly")
        self.assertEqual(day["reviews"], [{"repo": "them/api", "number": 3, "title": "Their fix", "url": "u3", "at": "12:00"}])
        self.assertEqual([(p["number"], p["isDraft"]) for p in out["openPrs"]], [(9, True)])

    def test_without_github_the_rest_stands(self):
        self.prompt("s1", at("10:00"), self.app, "worklog")
        out = self.scan(DAY, DAY, "--github", "on", "--gh", self.fake_gh(code=1))
        self.assertEqual((out["github"], out["openPrs"]), ("unavailable", []))
        self.assertIsNone(self.group(out["days"][0], "app", "worklog")["pr"])
        self.assertEqual(self.scan(DAY, DAY)["github"], "off")

    def test_hours_show_when(self):
        self.prompt("s1", at("10:00"), self.app, "feat")
        hours = self.day()["hours"]
        # Hours count from 04:00: 09:55-09:59 in the sixth, 10:00 in the seventh.
        self.assertEqual((hours[5], hours[6]), (5, 1))
        self.assertEqual(sum(hours), 6)


class DayBoundsTest(unittest.TestCase):
    """Days start at day-start local time, so a day with a clock change is 23 or 25 hours."""

    def setUp(self):
        self.tz = os.environ.get("TZ")
        os.environ["TZ"] = "America/New_York"
        time.tzset()
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "hooks"))
        import scan
        self.day_bounds = scan.day_bounds

    def tearDown(self):
        if self.tz is None:
            os.environ.pop("TZ", None)
        else:
            os.environ["TZ"] = self.tz
        time.tzset()

    def lengths(self, first, last, day_start):
        bounds = self.day_bounds(datetime.date.fromisoformat(first), datetime.date.fromisoformat(last), day_start)
        return [(date, end - start) for date, start, end in bounds]

    def test_the_clocks_going_back_make_a_25_hour_day(self):
        # They go back at 02:00 on 1 November 2026: from 04:00 that's in the day of 31 October.
        self.assertEqual(self.lengths("2026-10-31", "2026-11-01", 240), [("2026-10-31", 1500), ("2026-11-01", 1440)])
        self.assertEqual(self.lengths("2026-11-01", "2026-11-01", 0), [("2026-11-01", 1500)])

    def test_the_clocks_going_forward_make_a_23_hour_day(self):
        self.assertEqual(self.lengths("2026-03-07", "2026-03-08", 240), [("2026-03-07", 1380), ("2026-03-08", 1440)])
        self.assertEqual(self.lengths("2026-03-08", "2026-03-08", 0), [("2026-03-08", 1380)])


if __name__ == "__main__":
    unittest.main()
