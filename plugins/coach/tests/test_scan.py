"""End-to-end tests for hooks/scan.py (SPEC.md §5, §8). Run: python3 -m unittest discover -s tests"""
import datetime
import fcntl
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

HERE = os.path.dirname(__file__)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "hooks"))
import beginner  # noqa: E402
import metrics  # noqa: E402
from transcripts import MINUTE, Session  # noqa: E402

SCAN = os.path.join(HERE, "..", "hooks", "scan.py")


def utc(*args):
    return int(datetime.datetime(*args, tzinfo=datetime.timezone.utc).timestamp() * 1000)


class ScanTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.projects = os.path.join(self.tmp.name, "projects")
        self.data = os.path.join(self.tmp.name, "data")
        os.makedirs(self.projects)

    def tearDown(self):
        self.tmp.cleanup()

    def run_scan(self, *extra, now=beginner.NOW, tz="UTC", python=sys.executable):
        out = subprocess.run(
            [python, SCAN, "--projects", self.projects, "--data", self.data, "--home", "/home/me",
             "--config-dir", "/home/me/.claude", "--now", str(now), *extra],
            check=True, capture_output=True, text=True, env=dict(os.environ, TZ=tz)).stdout
        return [json.loads(line) for line in out.splitlines() if line.strip()]

    def report(self, *extra, **kw):
        return self.run_scan(*extra, **kw)[-1]["report"]

    # -- the beginner's month

    def test_the_beginners_month(self):
        beginner.build(self.projects)
        r = self.report()
        self.assertEqual([w["week"] for w in r["weeks"]], ["2026-09-14", "2026-09-21", "2026-09-28"])
        self.assertEqual(r["previous"]["week"], "2026-09-28")
        self.assertEqual(r["current"]["week"], "2026-10-05")
        self.assertIsNone(r["recent"])
        prev = r["previous"]
        self.assertEqual(prev["volume"]["prompts"], 18)
        self.assertTrue(prev["frozen"])
        self.assertFalse(r["current"]["frozen"])
        for habit in ("fresh-start", "point-to-place", "say-done", "check-work"):
            self.assertTrue(prev["habits"][habit]["eligible"], habit)
            self.assertTrue(prev["habits"][habit]["evidence"], habit)
        self.assertEqual(prev["context"]["stale"], 2)
        self.assertEqual(prev["context"]["fresh"], 1)
        self.assertEqual(prev["safety"]["bypassSessions"], 1)
        self.assertEqual([n["id"] for n in prev["notices"]], ["bypass"])
        self.assertIn("newer-model", [t["id"] for t in prev["tips"]])
        self.assertEqual(r["level"], 0)
        self.assertEqual(r["upNext"]["feature"], "claude-md")
        md = {c["project"]: c for c in r["suggestions"]["claudeMd"]}
        self.assertEqual([l["text"] for l in md["my-app"]["lines"]],
                         ["- Test: `pnpm test` (one file: `pnpm test <path>`)", "- Use `pnpm`, not `npm`."])
        self.assertEqual(md["my-app"]["pointers"]["files"], ["src/app/routes.ts"])
        self.assertFalse(md["my-app"]["hasClaudeMd"])
        self.assertEqual([l["source"] for l in md["All projects"]["lines"]], ["S6"])
        skills = r["suggestions"]["skills"]
        self.assertEqual([s["name"] for s in skills], ["release-notes"])
        self.assertEqual(skills[0]["template"],
                         "Write release notes for <version> from the merged prs grouped by area with a one-line summary at the top")
        self.assertEqual(skills[0]["followUps"][0]["text"], "also link each pr")
        self.assertEqual(skills[0]["location"], "/work/my-app/.claude/skills/release-notes/")

    def test_progress_comes_before_the_report(self):
        beginner.build(self.projects)
        messages = self.run_scan("--progress")
        self.assertIn("progress", messages[0])
        self.assertEqual(messages[-2]["progress"][0], messages[-2]["progress"][1])
        self.assertIn("report", messages[-1])

    def test_the_report_stays_small(self):
        beginner.build(self.projects)
        self.report()
        self.assertLess(os.path.getsize(os.path.join(self.data, "report.json")), 200_000)

    # -- weeks

    def test_weeks_are_local_time(self):
        # Monday 03:00 UTC is Sunday evening in Los Angeles: the week before.
        s = Session("s", "/work/a", utc(2026, 9, 28, 3))
        s.prompt("tidy up the readme", minutes=0)
        s.answer()
        s.write(self.projects)
        now = utc(2026, 10, 7, 12)
        weeks = lambda tz: {w["week"]: w["prompts"] for w in self.report(now=now, tz=tz)["history"]}
        self.assertEqual(weeks("UTC").get("2026-09-28"), 1)
        shutil.rmtree(self.data)
        self.assertEqual(weeks("America/Los_Angeles").get("2026-09-21"), 1)

    def test_weeks_can_start_on_sunday(self):
        s = Session("s", "/work/a", utc(2026, 9, 27, 12))  # a Sunday
        s.prompt("tidy up the readme", minutes=0)
        s.answer()
        s.write(self.projects)
        r = self.report("--week-start", "sunday", now=utc(2026, 10, 7, 12))
        self.assertIn("2026-09-27", [w["week"] for w in r["history"]])

    def test_finished_weeks_outlive_their_logs(self):
        beginner.build(self.projects)
        first = self.report()
        week0 = next(w for w in first["history"] if w["week"] == "2026-09-14")
        for name in os.listdir(os.path.join(self.projects, "-work-my-app")):
            if name.startswith("w0-"):
                path = os.path.join(self.projects, "-work-my-app", name)
                shutil.rmtree(path) if os.path.isdir(path) else os.remove(path)
        again = self.report()
        kept = next(w for w in again["history"] if w["week"] == "2026-09-14")
        self.assertEqual(kept["prompts"], week0["prompts"])
        self.assertEqual(kept["usd"], week0["usd"])

    def test_new_definitions_recompute_weeks_whose_logs_remain(self):
        beginner.build(self.projects)
        self.report()
        path = os.path.join(self.data, "history.json")
        with open(path) as fh:
            history = json.load(fh)
        for row in history["weeks"].values():
            row["metricsVersion"] = 0
            row["volume"]["prompts"] = 999
        history["weeks"]["2026-09-14"]["sessionIds"].append("gone-session")
        with open(path, "w") as fh:
            json.dump(history, fh)
        r = self.report()
        by_week = {w["week"]: w for w in r["history"]}
        self.assertEqual(by_week["2026-09-21"]["metricsVersion"], metrics.METRICS_VERSION)
        self.assertNotEqual(by_week["2026-09-21"]["prompts"], 999)
        # A week with a session whose log is gone keeps its old row.
        self.assertEqual(by_week["2026-09-14"]["metricsVersion"], 0)

    def test_a_broken_history_is_restored_from_its_backup(self):
        beginner.build(self.projects)
        self.report()
        self.report()  # writes history.json.bak
        with open(os.path.join(self.data, "history.json"), "w") as fh:
            fh.write("{not json")
        r = self.report()
        self.assertTrue(r["restored"])
        self.assertTrue(any(n.startswith("history.json.broken-") for n in os.listdir(self.data)))

    # -- reading

    def test_another_scan_holding_the_lock_gets_the_last_report(self):
        beginner.build(self.projects)
        self.report()
        with open(os.path.join(self.data, "scan.lock"), "w") as held:
            fcntl.flock(held, fcntl.LOCK_EX)
            started = time.time()
            last = self.run_scan()[-1]
            self.assertTrue(last["busy"])
            self.assertEqual(last["report"]["previous"]["week"], "2026-09-28")
            self.assertLess(time.time() - started, 10)

    def test_excluded_projects_are_never_read(self):
        beginner.build(self.projects)
        secret = Session("x", "/work/client-a", beginner.day(2, 1))
        secret.prompt("the secret client work", minutes=0)
        secret.answer()
        secret.write(self.projects)
        r = self.report("--exclude", "/work/client-a")
        self.assertEqual(r["previous"]["volume"]["sessions"], 10)
        with open(os.path.join(self.data, "scan-cache.json")) as fh:
            cache = fh.read()
        self.assertNotIn("secret client", cache)

    def test_unreadable_lines_are_skipped(self):
        s = Session("s", "/work/a", utc(2026, 9, 29, 9))
        s.prompt("tidy up the readme", minutes=0)
        s.answer()
        path = s.write(self.projects)
        with open(path, "a") as fh:
            fh.write("{broken json\n\x00\x01\n")
        r = self.report(now=utc(2026, 10, 7, 12))
        self.assertEqual(r["previous"]["volume"]["prompts"], 1)

    def test_a_ledger_sets_the_session_cost(self):
        s = Session("s", "/work/a", utc(2026, 9, 29, 9))
        s.prompt("tidy up the readme", minutes=0)
        s.call(out=1000)
        s.call(out=1000)
        s.ledger(7.0)
        s.write(self.projects)
        r = self.report(now=utc(2026, 10, 7, 12))
        self.assertAlmostEqual(r["previous"]["cost"]["usd"], 7.0, places=3)
        self.assertFalse(r["previous"]["cost"]["estimated"])

    def test_subagent_costs_count_toward_their_prompt(self):
        s = Session("s", "/work/a", utc(2026, 9, 29, 9))
        s.prompt("explore the repo and summarize it", minutes=0)
        s.call()
        s.subagent("agent-1", calls=3, ctx=100_000)
        s.write(self.projects)
        r = self.report(now=utc(2026, 10, 7, 12))
        row = r["previous"]
        self.assertEqual(row["usage"]["callsPerPrompt"], 4)
        self.assertGreater(row["cost"]["perPrompt"]["median"], 3 * 100_000 * 0.2 / 1e6)

    def test_rescans_reuse_the_cache(self):
        beginner.build(self.projects)
        a = self.report()
        b = self.report()
        a.pop("generatedAt")
        b.pop("generatedAt")
        self.assertEqual(a, b)

    def test_grading_samples_whole_prompts_from_the_logs(self):
        beginner.build(self.projects)
        messages = self.run_scan("--grade-week", "2026-09-28")
        grading = next(m["grading"] for m in messages if "grading" in m)
        self.assertEqual(grading["week"], "2026-09-28")
        texts = [p["text"] for p in grading["prompts"]]
        self.assertIn("fix the login thing its broken again", texts)
        vague = next(p for p in grading["prompts"] if p["text"].startswith("fix the login"))
        self.assertEqual(vague["next"], ["it still doesn't work, same error"])
        self.assertLessEqual(len(grading["prompts"]), 20)

    def test_runs_on_the_oldest_supported_python(self):
        python = "/usr/bin/python3"
        if not os.path.exists(python):
            self.skipTest("no /usr/bin/python3")
        version = subprocess.run([python, "-c", "import sys; print(sys.version_info[:2] >= (3, 9))"],
                                 capture_output=True, text=True).stdout.strip()
        if version != "True":
            self.skipTest("/usr/bin/python3 is older than 3.9")
        beginner.build(self.projects)
        r = self.report(python=python)
        self.assertEqual(r["previous"]["week"], "2026-09-28")


class Speed(unittest.TestCase):
    def test_a_month_of_heavy_use_scans_fast(self):
        with tempfile.TemporaryDirectory() as tmp:
            projects = os.path.join(tmp, "projects")
            at = utc(2026, 9, 1, 9)
            for i in range(120):
                s = Session(f"s{i}", f"/work/p{i % 4}", at + i * 5 * 3600 * 1000)
                for j in range(15):
                    s.prompt(f"change {j} in src/mod{j}.ts", minutes=3)
                    s.read(f"src/mod{j}.ts")
                    s.edit(f"src/mod{j}.ts")
                    s.bash("pnpm test")
                s.write(projects)
            started = time.time()
            subprocess.run([sys.executable, SCAN, "--projects", projects, "--data", os.path.join(tmp, "data"),
                            "--home", "/home/me", "--now", str(utc(2026, 10, 1, 9))],
                           check=True, capture_output=True, env=dict(os.environ, TZ="UTC"))
            first = time.time() - started
            started = time.time()
            subprocess.run([sys.executable, SCAN, "--projects", projects, "--data", os.path.join(tmp, "data"),
                            "--home", "/home/me", "--now", str(utc(2026, 10, 1, 9))],
                           check=True, capture_output=True, env=dict(os.environ, TZ="UTC"))
            again = time.time() - started
        self.assertLess(first, 30)
        self.assertLess(again, first)


if __name__ == "__main__":
    unittest.main()
