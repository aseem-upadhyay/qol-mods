"""Tests for hooks/suggest.py (SPEC.md §9.6, §9.7). Run: python3 -m unittest discover -s tests"""
import datetime
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(__file__)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "hooks"))
from transcripts import Session  # noqa: E402

SCAN = os.path.join(HERE, "..", "hooks", "scan.py")
NOW = int(datetime.datetime(2026, 10, 7, 15, tzinfo=datetime.timezone.utc).timestamp() * 1000)
DAY = 24 * 3600 * 1000


def rediscover(sid, root, at, first="npm", fails="ERR_PNPM_BAD_PM This project is configured to use pnpm",
               works="pnpm test"):
    s = Session(sid, root, at)
    s.prompt(f"add a test for widget {sid}", minutes=0)
    s.read("package.json")
    s.bash("ls")
    s.bash(f"{first} test", error=True, text=fails)
    s.bash(works)
    s.edit(f"src/{sid}.test.ts")
    s.answer()
    return s


def notes(sid, root, at, version):
    s = Session(sid, root, at)
    s.prompt(f"Write release notes for v{version} from the merged PRs, grouped by area, with a summary on top",
             minutes=0)
    s.answer()
    return s


class SuggestTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = os.path.join(self.tmp.name, "home")
        self.projects = os.path.join(self.tmp.name, "projects")
        os.makedirs(os.path.join(self.home, ".claude"))

    def tearDown(self):
        self.tmp.cleanup()

    def repo(self, name):
        root = os.path.join(self.tmp.name, "work", name)
        os.makedirs(os.path.join(root, ".git"), exist_ok=True)
        return root

    def scan(self, *extra):
        out = subprocess.run(
            [sys.executable, SCAN, "--projects", self.projects, "--data", os.path.join(self.tmp.name, "data"),
             "--home", self.home, "--config-dir", os.path.join(self.home, ".claude"), "--now", str(NOW), *extra],
            check=True, capture_output=True, text=True, env=dict(os.environ, TZ="UTC")).stdout
        return json.loads(out.strip().splitlines()[-1])["report"]

    def cards(self, report):
        return {c["project"]: c for c in report["suggestions"]["claudeMd"]}

    def three_sessions(self, root):
        for i in range(3):
            rediscover(f"s{i}", root, NOW - (i + 1) * DAY).write(self.projects)

    def test_lines_for_what_claude_rediscovers(self):
        root = self.repo("shop")
        self.three_sessions(root)
        card = self.cards(self.scan())["shop"]
        self.assertEqual([l["text"] for l in card["lines"]], ["- Test: `pnpm test`", "- Use `pnpm`, not `npm`."])
        self.assertEqual(card["file"], os.path.join(root, "CLAUDE.md"))
        self.assertFalse(card["hasClaudeMd"])

    def test_two_sessions_are_not_enough(self):
        root = self.repo("shop")
        for i in range(2):
            rediscover(f"s{i}", root, NOW - (i + 1) * DAY).write(self.projects)
        card = self.cards(self.scan()).get("shop")
        self.assertTrue(card is None or not [l for l in card["lines"] if l["source"] == "S1"])

    def test_what_claude_md_already_says_is_left_out(self):
        root = self.repo("shop")
        self.three_sessions(root)
        with open(os.path.join(root, "CLAUDE.md"), "w") as fh:
            fh.write("# Shop\n\nRun the tests with `pnpm test`.\n")
        card = self.cards(self.scan())["shop"]
        self.assertEqual([l["source"] for l in card["lines"]], ["S2"])
        self.assertTrue(card["hasClaudeMd"])

    def test_imports_count_as_claude_md(self):
        root = self.repo("shop")
        self.three_sessions(root)
        os.makedirs(os.path.join(root, "docs"))
        with open(os.path.join(root, "CLAUDE.md"), "w") as fh:
            fh.write("See @docs/dev.md for how to work here.\n")
        with open(os.path.join(root, "docs", "dev.md"), "w") as fh:
            fh.write("- Test: `pnpm test`\n- Use pnpm, never npm\n")
        report = self.scan()
        self.assertNotIn("shop", self.cards(report))
        covered = {c["source"] for c in report["suggestions"]["claudeMdCovered"]}
        self.assertEqual(covered, {"S1", "S2"})

    def test_a_long_claude_md_gets_no_more_lines(self):
        root = self.repo("shop")
        self.three_sessions(root)
        with open(os.path.join(root, "CLAUDE.md"), "w") as fh:
            fh.write("\n".join(f"- rule {i}" for i in range(400)))
        report = self.scan()
        card = self.cards(report)["shop"]
        self.assertEqual((card["lines"], card["pointers"]["files"]), ([], []))
        self.assertEqual([n["id"] for n in card["notes"]], ["too-long"])
        tips = [t["id"] for t in report["current"]["tips"]]
        self.assertIn("claude-md-too-long", tips)

    def test_a_machine_fact_seen_in_two_projects_goes_to_your_own_claude_md(self):
        for name in ("shop", "blog"):
            root = self.repo(name)
            for i in range(2):
                s = Session(f"{name}{i}", root, NOW - (i + 1) * DAY)
                s.prompt(f"run the script for {name} {i}", minutes=0)
                s.bash("python tools/build.py", error=True, text="bash: python: command not found")
                s.bash("python3 tools/build.py")
                s.write(self.projects)
        cards = self.cards(self.scan())
        lines = [l for l in cards["All projects"]["lines"] if l["source"] == "S2"]
        self.assertEqual([l["text"] for l in lines], ["- Use `python3`; `python` isn't available here."])
        self.assertTrue(lines[0]["machine"])

    def test_a_repeated_prompt_becomes_a_skill(self):
        root = self.repo("shop")
        for i in range(4):
            notes(f"n{i}", root, NOW - (i + 1) * DAY, f"1.{i}.0").write(self.projects)
        skills = self.scan()["suggestions"]["skills"]
        self.assertEqual(len(skills), 1)
        self.assertEqual(skills[0]["name"], "release-notes")
        self.assertEqual(skills[0]["scope"], "project")
        self.assertEqual(skills[0]["count"], 4)
        self.assertIsNone(skills[0]["existing"])

    def test_three_takes_in_one_session_are_not_a_skill(self):
        root = self.repo("shop")
        s = Session("one", root, NOW - DAY)
        for i in range(4):
            s.prompt(f"Write release notes for v1.{i}.0 from the merged PRs, grouped by area, with a summary on top")
            s.answer()
        s.write(self.projects)
        self.assertEqual(self.scan()["suggestions"]["skills"], [])

    def test_a_skill_you_already_have_becomes_a_reminder(self):
        root = self.repo("shop")
        folder = os.path.join(self.home, ".claude", "skills", "notes")
        os.makedirs(folder)
        with open(os.path.join(folder, "SKILL.md"), "w") as fh:
            fh.write("---\nname: notes\n---\nWrite release notes from the merged PRs, grouped by area, with a summary.\n")
        os.utime(os.path.join(folder, "SKILL.md"), (NOW / 1000 - 10 * 86400, NOW / 1000 - 10 * 86400))
        for i in range(4):
            notes(f"n{i}", root, NOW - (i + 1) * DAY, f"1.{i}.0").write(self.projects)
        card = self.scan()["suggestions"]["skills"][0]
        self.assertEqual(card["existing"]["name"], "notes")
        self.assertEqual(card["existing"]["handTyped"], 4)

    def test_without_excerpts_no_words_are_kept(self):
        root = self.repo("shop")
        for i in range(4):
            notes(f"n{i}", root, NOW - (i + 1) * DAY, f"1.{i}.0").write(self.projects)
            s = Session(f"c{i}", root, NOW - (i + 1) * DAY + 3600_000)
            s.prompt("no, use pnpm not npm", minutes=0)
            s.write(self.projects)
        report = self.scan("--excerpts", "off")
        skills = report["suggestions"]["skills"]
        self.assertEqual(len(skills), 1)
        self.assertIsNone(skills[0]["template"])
        self.assertNotIn("shop", self.cards(report))
        with open(os.path.join(self.tmp.name, "data", "scan-cache.json")) as fh:
            self.assertNotIn("release notes", fh.read().lower())


if __name__ == "__main__":
    unittest.main()
