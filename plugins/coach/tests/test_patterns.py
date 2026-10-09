"""Tests for hooks/patterns.py (SPEC.md Appendix B). Run: python3 -m unittest discover -s tests"""
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "hooks"))
import patterns as P  # noqa: E402


class Markers(unittest.TestCase):
    def test_machine_text_is_not_a_prompt(self):
        for text in ("<command-name>/model</command-name>", "<local-command-stdout>x</local-command-stdout>",
                     "<task-notification>done</task-notification>", "<system-reminder>x</system-reminder>",
                     "Caveat: the messages below", "Stop hook feedback: [x]", "[Request interrupted by user]",
                     "<create-pr-command>open a PR</create-pr-command>", "<bash-input>ls</bash-input>"):
            self.assertTrue(P.MARKER.search(text), text)
        self.assertFalse(P.MARKER.search("fix the <Button> layout"))

    def test_interrupts_both_ways(self):
        self.assertTrue(P.INTERRUPT.search("[Request interrupted by user]"))
        self.assertTrue(P.INTERRUPT.search("[Request interrupted by user for tool use]"))


class Cues(unittest.TestCase):
    def test_corrections(self):
        for text in ("no, use pnpm", "Nope.", "that's not it", "you forgot the test", "still failing",
                     "it doesn't work", "same error", "why did you delete it", "I meant the other one",
                     "actually, the header", "your response above was too long", "it still doesn’t work"):
            self.assertTrue(P.CORRECTION.search(P.plain(text)), text)
        for text in ("now add dark mode", "notice the header", "write a test"):
            self.assertFalse(P.CORRECTION.search(text), text)

    def test_undo_polling_continuation(self):
        self.assertTrue(P.UNDO.search("revert that"))
        self.assertTrue(P.POLLING.search("is it done yet?"))
        self.assertTrue(P.POLLING.search("status?"))
        self.assertTrue(P.CONTINUATION.search("also add a test"))
        self.assertFalse(P.CONTINUATION.search("now add dark mode"))


class PromptChecks(unittest.TestCase):
    def test_places(self):
        for text in ("look at src/auth/session.ts", "the bug is in session.ts", "use @src/auth",
                     "rename getUserById", "the UserService class", "the user_id column", "the `config` value"):
            self.assertTrue(P.names_place(text), text)
        self.assertFalse(P.names_place("fix the login thing its broken again"))

    def test_done_and_vague(self):
        self.assertTrue(P.DONE.search("Done when the tests pass"))
        self.assertTrue(P.DONE.search("make sure it builds"))
        self.assertTrue(P.is_vague("fix it"))
        self.assertTrue(P.is_vague("its broken again"))
        self.assertFalse(P.is_vague("fix it in src/auth.ts"))
        self.assertFalse(P.is_vague("the date picker crashes when the month changes, fix it please"))

    def test_big_paste(self):
        trace = "\n".join(["Traceback (most recent call last):"] + ['  File "a.py", line 3, in f'] * 200)
        self.assertTrue(P.is_big_paste("here is the error\n" + trace))
        self.assertFalse(P.is_big_paste("a" * 5000))

    def test_question_task(self):
        self.assertEqual(P.question_task("how do I run the tests here?"), "test")
        self.assertEqual(P.question_task("how do we start the app"), "dev")
        self.assertEqual(P.question_task("what's the command to build"), "build")
        self.assertIsNone(P.question_task("how does auth work"))


class Commands(unittest.TestCase):
    def test_tasks_and_normal_form(self):
        cases = {
            "cd apps/web && pnpm test src/a.test.ts 2>&1 | tail -20": ("test", "pnpm test", "apps/web", True),
            "pnpm run test -- --run": ("test", "pnpm run test --run", "", False),
            "npx vitest run src/x.test.ts": ("test", "npx vitest run", "", True),
            "python3 -m pytest tests/test_a.py -k foo -q": ("test", "python3 -m pytest -q", "", True),
            "CI=1 npm test": ("test", "CI=1 npm test", "", False),
            "go test ./...": ("test", "go test ./...", "", False),
            "yarn test > /tmp/out.txt": ("test", "yarn test", "", False),
            "NODE_ENV=test npx jest --config jest.config.js": ("test", "NODE_ENV=test npx jest --config jest.config.js", "", False),
            "pnpm --filter web test src/x.test.ts": ("test", "pnpm --filter web test", "", True),
            "npm run lint": ("lint", "npm run lint", "", False),
            "npx tsc --noEmit": ("typecheck", "npx tsc --noEmit", "", False),
            "make": ("build", "make", "", False),
            "pip install -r requirements.txt": ("install", "pip install -r requirements.txt", "", False),
            "bun run dev": ("dev", "bun run dev", "", False),
        }
        for command, (task, display, folder, had_path) in cases.items():
            got = P.classify(command)
            self.assertIsNotNone(got, command)
            self.assertEqual((got[0], got[1], got[3], got[4]), (task, display, folder, had_path), command)

    def test_not_tasks(self):
        for command in ("git status", "ls -la", "npm install left-pad", "yarn vitest --version", "pnpm add react"):
            self.assertIsNone(P.classify(command), command)

    def test_variants_vote_together(self):
        self.assertEqual(P.classify("pnpm run test")[2], P.classify("pnpm test -- --run")[2])

    def test_checks_and_commits(self):
        self.assertTrue(P.is_check("pnpm test"))
        self.assertTrue(P.is_check("npx tsc"))
        self.assertFalse(P.is_check("pnpm install"))
        self.assertTrue(P.GIT_COMMIT.search('git commit -m "x"'))
        self.assertTrue(P.GIT_COMMIT.search("git -C repo commit -am x"))
        self.assertFalse(P.GIT_COMMIT.search("git log"))


class WrongToolFirst(unittest.TestCase):
    def test_real_pairs(self):
        self.assertEqual(P.pair("npm test", "pnpm test", "ERR_PNPM_BAD_PM This project is configured to use pnpm"),
                         ("npm", "pnpm", "replace"))
        self.assertEqual(P.pair("python x.py", "python3 x.py", "bash: python: command not found"),
                         ("python", "python3", "replace"))
        self.assertEqual(P.pair("pytest", "uv run pytest", "ModuleNotFoundError: No module named 'foo'"),
                         ("pytest", "uv run", "prefix"))
        self.assertEqual(P.pair("cd web && npm test", "cd web && pnpm test", "This project is configured to use pnpm"),
                         ("npm", "pnpm", "replace"))

    def test_false_pairs_from_the_authors_logs(self):
        # Appendix C: what looser rules wrongly paired.
        self.assertIsNone(P.pair("mkdir -p a", "cd a", "mkdir: a: File exists"))
        self.assertIsNone(P.pair("ls file.pdf", "markitdown file.pdf", "markitdown: command not found"))
        self.assertIsNone(P.pair("npm test", "pnpm test", "1 test failed"))

    def test_lines(self):
        self.assertEqual(P.pair_line("npm", "pnpm", "replace"), "- Use `pnpm`, not `npm`.")
        self.assertEqual(P.pair_line("python", "python3", "replace"), "- Use `python3`; `python` isn't available here.")
        self.assertEqual(P.pair_line("pytest", "uv run", "prefix"),
                         "- Run Python tools through `uv run` (for example `uv run pytest`).")


class Clauses(unittest.TestCase):
    def test_kept_and_cleaned(self):
        self.assertEqual(P.clauses("no, use pnpm not npm"), [("correction", "Use `pnpm` not `npm`.")])
        self.assertEqual(P.clauses("the API lives in services/api"),
                         [("instruction", "The API lives in `services/api`.")])
        self.assertEqual(P.clauses("your answer was too long, keep it short"),
                         [("preference", "Your answer was too long, keep it short.")])
        self.assertEqual(P.clauses("* we use pnpm here"), [("instruction", "We use `pnpm` here.")])

    def test_dropped(self):
        for text in ("no, that's wrong", "Actually I meant the other file", "how do we use this?",
                     "+import may NEVER escape its root", "```\nalways use x\n```"):
            self.assertEqual(P.clauses(text), [], text)


class Normalize(unittest.TestCase):
    def test_slots(self):
        self.assertEqual(P.normalize("Write release notes for v2.4.1 from PR #123 in `apps/web`, see https://x.com/a"),
                         ["write", "release", "notes", "for", "<version>", "from", "pr", "<n>", "in", "<x>", "see",
                          "<url>"])

    def test_vectors_match_the_ts_fixture(self):
        here = os.path.dirname(__file__)
        with open(os.path.join(here, "fixtures", "normalize.json")) as fh:
            inputs = json.load(fh)["inputs"]
        with open(os.path.join(here, "fixtures", "normalize.ts")) as fh:
            body = fh.read()
        cases = json.loads(body[body.index("["):body.rindex("]") + 1])
        self.assertEqual([c["text"] for c in cases], inputs, "run tests/make_fixtures.py")
        for c in cases:
            self.assertEqual(P.normalize(c["text"]), c["tokens"], c["text"])

    def test_stable_hash_is_crc32(self):
        self.assertEqual(P.stable_hash("hello"), 907060870)


class Scrub(unittest.TestCase):
    def test_secrets_go(self):
        text = "token=abc123 sk-abcdefghijklmnopqrstuv ghp_abcdefghijklmnopqrstuvwxyz AKIAABCDEFGHIJKLMNOP"
        self.assertEqual(P.scrub(text), "token=[redacted] [redacted] [redacted] [redacted]")
        self.assertIn("[redacted]", P.scrub("eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4"))
        self.assertEqual(P.scrub("fix src/auth/session.ts"), "fix src/auth/session.ts")

    def test_excerpts_are_short_and_flat(self):
        self.assertEqual(P.excerpt("a\n\n b"), "a b")
        self.assertEqual(len(P.excerpt("word " * 100)), 200)
        self.assertEqual(P.excerpt("x" * 500), "[redacted]")  # one long run looks like a secret


if __name__ == "__main__":
    unittest.main()
