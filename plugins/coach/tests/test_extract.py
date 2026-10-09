"""Tests for hooks/extract.py (SPEC.md §6). Run: python3 -m unittest discover -s tests"""
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(__file__)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "hooks"))
import extract as X  # noqa: E402
from transcripts import MINUTE, Session  # noqa: E402

AT = 1_790_000_000_000
CWD = "/work/my-app"


class ExtractTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.tmp.cleanup()

    def facts(self, session, excerpts=True):
        path = session.write(os.path.join(self.tmp.name, "projects"))
        return X.extract(path, session.sid, "-work-my-app", True, excerpts=excerpts)

    def test_prompts_commands_and_what_is_neither(self):
        s = Session("s", CWD, AT)
        s.prompt("fix the date picker in src/date.ts")
        s.answer()
        s.command("model", "sonnet")
        s.command("port-page", "orders")
        s.answer()
        s.notification()
        s.answer()
        s.prompt("<system-reminder>ignore</system-reminder>")
        s.prompt("another task", origin="peer")
        f = self.facts(s)
        kinds = [(r["kind"], r["command"]) for r in f["requests"]]
        self.assertEqual(kinds, [("prompt", None), ("command", "model"), ("command", "port-page")])
        self.assertTrue(f["requests"][1]["local"])
        self.assertEqual(f["requests"][2]["invoked"], "port-page")
        self.assertIn("commands-skills", f["requests"][2]["feats"])
        # The notification's turn is background: its call belongs to no prompt.
        self.assertEqual(f["calls"][-1][X.C_REQ], X.BACKGROUND)

    def test_streamed_messages_count_once_with_the_last_usage(self):
        s = Session("s", CWD, AT)
        s.prompt("hello there friend")
        s.call(out=900, streamed=True)
        f = self.facts(s)
        self.assertEqual(len(f["calls"]), 1)
        self.assertEqual(f["calls"][0][X.C_OUTPUT], 900)
        self.assertEqual(f["requests"][0]["calls"], 1)

    def test_tool_outcomes(self):
        s = Session("s", CWD, AT)
        s.prompt("refactor src/a.ts and commit")
        s.read("src/a.ts")
        s.edit("src/a.ts")
        s.bash("pnpm test")
        s.bash('git commit -m "x"')
        ids = s.call([("Bash", {"command": "rm -rf build"})])
        s.results(ids, errors=ids, denial="user-rejected")
        ids = s.call([("Bash", {"command": "pnpm lint"})])
        s.results(ids, decision={"decision": "accept", "source": "user_temporary"})
        s.interrupt()
        r = self.facts(s)["requests"][0]
        self.assertEqual((r["read"], r["edited"]), (1, 1))
        self.assertTrue(r["checked"])
        self.assertTrue(r["committed"])
        self.assertEqual(r["rejections"], 1)
        self.assertEqual(r["approvals"], {"Bash: pnpm lint": 1})
        self.assertTrue(r["interrupted"])
        self.assertIn("interrupt", r["feats"])

    def test_a_check_before_the_last_edit_does_not_count(self):
        s = Session("s", CWD, AT)
        s.prompt("change src/a.ts")
        s.bash("pnpm test")
        s.edit("src/a.ts")
        self.assertFalse(self.facts(s)["requests"][0]["checked"])

    def test_corrections_and_follow_ups(self):
        s = Session("s", CWD, AT)
        s.prompt("update the header")
        s.answer()
        s.prompt("no, the other header", minutes=2)
        s.answer()
        s.prompt("still not right", minutes=2)
        s.answer()
        s.prompt("thanks, now the footer", minutes=90)
        reqs = self.facts(s)["requests"]
        self.assertEqual([r["corrected"] for r in reqs], [True, True, False, False])
        self.assertEqual([r["run"] for r in reqs], [2, 1, 0, 0])
        self.assertEqual(reqs[0]["next"], 1)
        self.assertIsNone(reqs[2]["next"])

    def test_how_to_run_the_tests_rediscovered(self):
        s = Session("s", CWD, AT)
        s.prompt("add a test for the date picker")
        s.read("package.json")
        s.bash("ls")
        s.bash("npm test", error=True, text="ERR_PNPM_BAD_PM This project is configured to use pnpm")
        s.bash("pnpm test src/date.test.ts")
        r = self.facts(s)["requests"][0]
        self.assertEqual(r["discovery"], [["test", 3, 1, 100, "found", "pnpm test", "pnpm test", "", True]])
        self.assertEqual(r["subs"], [["npm", "pnpm", "replace", "wrong-package-manager"]])

    def test_going_straight_to_it_is_no_episode(self):
        s = Session("s", CWD, AT)
        s.prompt("add a test for the date picker")
        s.bash("pnpm test")
        self.assertEqual(self.facts(s)["requests"][0]["discovery"], [])

    def test_never_found_is_an_episode_that_gave_up(self):
        s = Session("s", CWD, AT)
        s.prompt("how do I run the tests here?")
        s.read("README.md")
        s.bash("make test", error=True, text="make: *** No rule to make target 'test'.")
        eps = self.facts(s)["requests"][0]["discovery"]
        self.assertEqual([e[4] for e in eps], ["gave-up"])

    def test_files_read_first(self):
        s = Session("s", CWD, AT)
        s.prompt("add pagination to src/orders/Table.tsx")
        s.read("src/app/routes.ts")
        s.read("src/orders/Table.tsx")   # named in the prompt
        s.read("src/api/client.ts")      # edited later
        s.edit("src/api/client.ts")
        s.read("src/late.ts")            # after the first edit
        self.assertEqual([p for p, _ in self.facts(s)["session"]["orientation"]], ["src/app/routes.ts"])

    def test_worktree_paths_fold_into_the_repo(self):
        s = Session("s", "/work/my-app/.claude/worktrees/fix-1", AT)
        s.prompt("tidy up")
        s.step("Read", {"file_path": "/work/my-app/.claude/worktrees/fix-1/src/app/routes.ts"})
        self.assertEqual(self.facts(s)["session"]["orientation"], [["src/app/routes.ts", 0]])

    def test_cache_rewarmed_after_a_break(self):
        s = Session("s", CWD, AT)
        s.prompt("refactor the middleware")
        s.call(ctx=200_000)
        s.prompt("and the tests", minutes=70)
        s.call(ctx=210_000, writes=150_000)
        calls = self.facts(s)["calls"]
        self.assertEqual(calls[0][X.C_REWARM], 0)
        self.assertGreater(calls[1][X.C_REWARM], 0)
        # Written at $5/M on Opus 5.5, read at $0.20/M: what the break cost on top.
        self.assertAlmostEqual(calls[1][X.C_REWARM], 150_000 * (5 - 0.2) / 1e6, places=6)

    def test_an_hour_cache_lasts_an_hour(self):
        s = Session("s", CWD, AT)
        s.prompt("refactor the middleware")
        s.call(ctx=200_000, w1h=True)
        s.prompt("and the tests", minutes=30)
        s.call(ctx=210_000, writes=150_000, w1h=True)
        self.assertEqual(self.facts(s)["calls"][1][X.C_REWARM], 0)

    def test_prompt_facts_and_features(self):
        s = Session("s", CWD, AT)
        s.prompt("look at @src/auth.ts and make sure the tests pass", images=1, mode="plan")
        s.answer()
        s.compact("auto")
        r = self.facts(s)["requests"][0]
        self.assertTrue(r["flags"]["place"])
        self.assertTrue(r["flags"]["done"])
        self.assertTrue(r["flags"]["at"])
        self.assertTrue(r["plan"])
        self.assertTrue(r["compacted"])
        self.assertEqual(sorted(r["feats"]), ["ask-checks", "at-mention", "image", "plan-mode"])

    def test_excerpts_off_keeps_no_words(self):
        s = Session("s", CWD, AT)
        s.prompt("we use pnpm here, write release notes for v1.0.0 from the merged PRs")
        r = self.facts(s, excerpts=False)["requests"][0]
        self.assertIsNone(r["excerpt"])
        self.assertEqual(r["clauses"], [])
        self.assertNotIn("template", r["shape"])
        self.assertNotIn("opener", r["shape"])
        self.assertIsNone(self.facts(s, excerpts=False)["session"]["lead"])

    def test_subagent_files_are_calls_only(self):
        s = Session("s", CWD, AT)
        s.prompt("explore the repo")
        s.subagent("agent-1", calls=2)
        path = s.write(os.path.join(self.tmp.name, "projects"))
        sub = os.path.join(os.path.dirname(path), "s", "subagents", "agent-1.jsonl")
        f = X.extract(sub, "s", "-work-my-app", False)
        self.assertIsNone(f["session"])
        self.assertEqual(len(f["calls"]), 2)
        self.assertTrue(all(c[X.C_SUB] for c in f["calls"]))


if __name__ == "__main__":
    unittest.main()
