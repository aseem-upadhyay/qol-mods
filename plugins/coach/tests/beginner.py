"""A made-up beginner's month in one project, for the end-to-end tests and the
TS fixtures (tests/make_fixtures.py). Every detector has something to find.

All times are UTC; run with TZ=UTC for stable week boundaries.
"""
import datetime

from transcripts import MINUTE, Session

CWD = "/work/my-app"
HOUR = 60 * MINUTE
DAY = 24 * HOUR
# Wednesday 7 October 2026, 15:00 UTC: the fourth week, two days in.
NOW = int(datetime.datetime(2026, 10, 7, 15, tzinfo=datetime.timezone.utc).timestamp() * 1000)
WEEK0 = int(datetime.datetime(2026, 9, 14, tzinfo=datetime.timezone.utc).timestamp() * 1000)


def day(week, d, hour=10):
    """Monday of `week` (0..3) plus `d` days, at `hour` UTC."""
    return WEEK0 + week * 7 * DAY + d * DAY + hour * HOUR


TASKS = ["add a test for the date picker", "cover the currency formatter with tests",
         "write tests for the cart reducer", "the search hook needs tests"]


def discovery(sid, at, task=0, extra_prompt=None):
    """Claude rediscovers how to run the tests, and tries npm first."""
    s = Session(sid, CWD, at, model="claude-opus-5")
    s.prompt(TASKS[task % len(TASKS)], minutes=0)
    s.read("package.json")
    s.read("src/app/routes.ts")
    s.bash("ls")
    s.bash("npm test", error=True, text="ERR_PNPM_BAD_PM This project is configured to use pnpm")
    s.bash("pnpm test src/date-picker.test.ts")
    s.edit("src/date-picker.test.ts")
    s.bash("pnpm test src/date-picker.test.ts")
    s.answer()
    if extra_prompt:
        s.prompt(extra_prompt, minutes=3)
        s.answer()
    return s


def release_notes(sid, at, version, follow=True):
    s = Session(sid, CWD, at, model="claude-opus-5")
    s.prompt(f"Write release notes for v{version} from the merged PRs, grouped by area, with a one-line summary at the top",
             minutes=0)
    s.bash("gh pr list --state merged --limit 50")
    s.answer(out=1200)
    if follow:
        s.prompt("also link each PR", minutes=2)
        s.answer(out=800)
    return s


def vague_fix(sid, at):
    """No place named: Claude searches, edits without a check, and gets corrected."""
    s = Session(sid, CWD, at, model="claude-opus-5")
    s.prompt("fix the login thing its broken again", minutes=0)
    s.read("src/app/routes.ts")
    s.step("Grep", {"pattern": "login"})
    s.step("Glob", {"pattern": "**/*auth*"})
    s.read("src/auth/session.ts")
    s.read("src/auth/login.ts")
    s.read("src/auth/token.ts")
    s.read("src/api/client.ts")
    s.edit("src/auth/session.ts")
    s.answer()
    s.prompt("it still doesn't work, same error", minutes=4)
    s.read("src/auth/session.ts")
    s.edit("src/auth/session.ts")
    s.answer()
    return s


def topic_switch(sid, at):
    """A big session moves to an unrelated topic after a long break."""
    s = Session(sid, CWD, at, model="claude-opus-5")
    s.prompt("refactor the auth middleware in src/auth/middleware.ts", minutes=0)
    s.read("src/app/routes.ts", ctx=120_000)
    s.read("src/auth/middleware.ts", ctx=180_000)
    s.edit("src/auth/middleware.ts", ctx=240_000)
    s.answer(ctx=320_000)
    s.prompt("now add a dark mode toggle to the settings page", minutes=55)
    s.read("src/settings/page.tsx", ctx=330_000, writes=60_000)
    s.edit("src/settings/page.tsx", ctx=335_000)
    s.answer(ctx=338_000)
    s.prompt("make the toggle remember the choice", minutes=3)
    s.edit("src/settings/page.tsx", ctx=342_000)
    s.answer(ctx=345_000)
    s.prompt("write a migration that adds an index on orders.created_at", minutes=50)
    s.edit("db/migrations/0042_orders_index.sql", ctx=350_000)
    s.answer(ctx=352_000)
    return s


def big_change(sid, at, plan=False, what="the forms"):
    s = Session(sid, CWD, at, model="claude-opus-5")
    s.prompt(f"migrate {what} to the new design system", minutes=0, mode="plan" if plan else "default")
    s.read("src/app/routes.ts")
    for i in range(9):
        s.edit(f"src/forms/form{i}.tsx", ctx=60_000 + i * 5000)
    s.answer()
    return s


def good_prompt(sid, at):
    s = Session(sid, CWD, at, model="claude-opus-5-5")
    s.prompt("In src/components/Button.tsx, add a loading prop. Done when the Button tests pass.", minutes=0)
    s.read("src/components/Button.tsx")
    s.edit("src/components/Button.tsx")
    s.bash("pnpm test src/components/Button.test.tsx")
    s.answer()
    return s


def corrections(sid, at):
    s = Session(sid, CWD, at, model="claude-opus-5")
    s.prompt("update the header", minutes=0)
    s.read("src/app/routes.ts")
    s.edit("src/components/Header.tsx")
    s.answer()
    s.prompt("no, use pnpm not npm when you run things", minutes=2)
    s.answer()
    s.prompt("your answer was too long, keep it short", minutes=2)
    s.answer()
    return s


def build(projects):
    sessions = []
    for week in range(3):
        sessions += [
            discovery(f"w{week}-disc", day(week, 0), task=week),
            release_notes(f"w{week}-notes", day(week, 1), f"1.{week}.0", follow=week != 2),
            vague_fix(f"w{week}-vague", day(week, 1, 14)),
            topic_switch(f"w{week}-switch", day(week, 2)),
            # A fresh session soon after the big one: the habit done right.
            good_prompt(f"w{week}-good", day(week, 2, 14)),
            big_change(f"w{week}-big", day(week, 3), plan=week == 2),
            big_change(f"w{week}-big2", day(week, 3, 15), what="the tables"),
            corrections(f"w{week}-corr", day(week, 4)),
        ]
    # Extra repeats so the release-notes prompt clears the skill threshold.
    sessions.append(release_notes("w2-notes-b", day(2, 2, 16), "1.2.1"))
    # Turned-off permission checks, and a break long enough to re-send the cache.
    bypass = Session("w2-bypass", CWD, day(2, 4, 15), model="claude-opus-5")
    bypass.prompt("clean up unused imports in src/", minutes=0, mode="bypassPermissions")
    bypass.edit("src/index.ts", ctx=210_000)
    bypass.answer(ctx=212_000)
    bypass.prompt("and in tests/ too", minutes=75)
    bypass.edit("tests/setup.ts", ctx=215_000, writes=210_000)
    bypass.answer(ctx=216_000)
    bypass.title("Unused imports")
    sessions.append(bypass)
    # This week so far: a fresh start after a big session, and an interrupt.
    now_week = discovery("w3-disc", day(3, 0), task=3)
    sessions.append(now_week)
    fresh = Session("w3-fresh", CWD, day(3, 0, 13), model="claude-opus-5-5")
    fresh.prompt("add pagination to the orders table in src/orders/Table.tsx", minutes=0)
    fresh.edit("src/orders/Table.tsx")
    fresh.interrupt()
    fresh.prompt("go ahead, but keep the page size at 20", minutes=1)
    fresh.edit("src/orders/Table.tsx")
    fresh.bash("pnpm test src/orders")
    fresh.answer()
    sessions.append(fresh)
    sessions.append(release_notes("w3-notes", day(3, 1), "1.3.0"))
    for s in sessions:
        s.write(projects)
    return sessions
