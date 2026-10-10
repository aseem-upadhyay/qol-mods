"""Tests for hooks/facts.py. Run: python3 -m unittest discover -s tests"""
import os, sys, unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "hooks"))
from facts import ask_of, commit_subjects, facts_of, folders, pick_asks, pr_title, relative, runs_tests  # noqa: E402


def bash(command):
    return {"type": "assistant", "message": {"content": [
        {"type": "tool_use", "name": "Bash", "input": {"command": command}}]}}


class AskTest(unittest.TestCase):
    def test_a_prompt_is_quoted_on_one_line(self):
        self.assertEqual(ask_of("fix the login\n  bug in src/auth.ts"), "fix the login bug in src/auth.ts")

    def test_a_long_prompt_is_cut(self):
        self.assertEqual(len(ask_of("x" * 400)), 160)

    def test_replies_commands_and_notices_are_not_asks(self):
        for text in ["yes", "go ahead", "Thanks!", "short one", "/reload-plugins",
                     "<command-name>/standup</command-name>", "<task-notification> done",
                     "[Request interrupted by user]"]:
            self.assertIsNone(ask_of(text), text)

    def test_the_longest_three_in_the_order_asked(self):
        asks = [(1, "a" * 20), (2, "b" * 50), (3, "c" * 30), (4, "d" * 40), (5, "b" * 50)]
        self.assertEqual(pick_asks(asks), ["b" * 50, "c" * 30, "d" * 40])

    def test_a_queued_message_is_not_quoted_twice(self):
        self.assertEqual(facts_of({"type": "queue-operation", "operation": "enqueue",
                                   "content": "also check the logout path"}, True), [])


class CommitTest(unittest.TestCase):
    def test_messages_from_m_and_from_here_documents(self):
        self.assertEqual(commit_subjects('git commit -m "Fix the login bug"'), ["Fix the login bug"])
        self.assertEqual(commit_subjects("git -C /x commit -am 'Fix it' && git push"), ["Fix it"])
        self.assertEqual(commit_subjects("git add a && git commit -q -F - <<'EOF'\ncoach 0.2.1: previews\n\nbody\nEOF"),
                         ["coach 0.2.1: previews"])
        self.assertEqual(commit_subjects("git commit -m \"$(cat <<'EOF'\nAdd the scanner\n\nCo-Authored-By: x\nEOF\n)\""),
                         ["Add the scanner"])

    def test_text_that_only_mentions_a_commit_is_not_one(self):
        self.assertEqual(commit_subjects("echo 'git commit is fun'"), [])
        self.assertEqual(commit_subjects("python3 - <<'EOF'\nrun('x && git commit -m \"no\"')\nEOF"), [])
        self.assertEqual(commit_subjects("git commit --amend --no-edit"), [])

    def test_a_commit_written_into_a_file_is_text_not_a_commit(self):
        command = ("cat > tests/t.py <<'EOF'\n"
                   "check(\"git add a && git commit -q -F - <<'EOF'\\nx\", [\"coach 0.2.1: previews\"])\n"
                   "EOF\npython3 -m unittest")
        self.assertEqual(commit_subjects(command), [])
        self.assertEqual(pr_title("cat > a.md <<'EOF'\ngh pr create --title nope\nEOF"), None)
        self.assertTrue(runs_tests(command))
        self.assertFalse(runs_tests("cat > a.md <<'EOF'\nrun pytest here\nEOF"))

    def test_a_title_on_a_continued_line(self):
        self.assertEqual(pr_title('git push && gh pr create \\\n  --title "Multi line" \\\n  --body x'), "Multi line")

    def test_gits_own_line_for_a_commit(self):
        record = {"type": "user", "message": {"content": [
            {"type": "tool_result", "content": "[main 81b1368] Give the page a title\n 1 file changed"}]}}
        self.assertEqual(facts_of(record, False), [("commit", "Give the page a title")])


class ToolTest(unittest.TestCase):
    def test_pr_titles_tests_and_edits(self):
        self.assertEqual(pr_title('gh pr create --title "Serve the docs" --body x'), "Serve the docs")
        self.assertEqual(pr_title("git push && gh pr create -t 'Fix it' -b body"), "Fix it")
        self.assertIsNone(pr_title("gh pr create --fill"))
        self.assertEqual(facts_of(bash("cd x && python3 -m unittest discover -s tests"), False), [("test", 1)])
        edit = {"type": "assistant", "message": {"content": [
            {"type": "tool_use", "name": "Edit", "input": {"file_path": "/r/a.py"}}]}}
        self.assertEqual(facts_of(edit, False), [("edit", "/r/a.py")])

    def test_files_group_by_folder_three_levels_deep(self):
        self.assertEqual(folders(["plugins/coach/hooks/a.ts", "plugins/coach/hooks/b.ts",
                                  "plugins/coach/hooks/deep/x/c.ts", "README.md", "~/other/plugins/r/x.md"]),
                         [("plugins/coach/hooks", 3), (".", 1), ("~/other/plugins/r", 1)])

    def test_files_read_as_the_repo_names_them(self):
        self.assertEqual(relative("/h/app/src/a.ts", "/h/app", "/h"), "src/a.ts")
        self.assertEqual(relative("/h/app/.claude/worktrees/wt1/src/a.ts", "/h/app", "/h"), "src/a.ts")
        self.assertEqual(relative("/h/notes/todo.md", "/h/app", "/h"), "~/notes/todo.md")
        self.assertIsNone(relative("/h/.claude/projects/x/memory/m.md", "/h/app", "/h"))
        self.assertIsNone(relative("/private/tmp/scratch/a.py", "/h/app", "/h"))


if __name__ == "__main__":
    unittest.main()
