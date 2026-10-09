"""The TS fixtures are the Python side's output, and pricing.py is the shared copy.
Run: python3 -m unittest discover -s tests"""
import os
import sys
import unittest

HERE = os.path.dirname(__file__)
sys.path.insert(0, HERE)
import make_fixtures  # noqa: E402


class FixturesTest(unittest.TestCase):
    def test_the_ts_fixtures_are_current(self):
        for name, body in (("report.ts", make_fixtures.report_ts()), ("normalize.ts", make_fixtures.normalize_ts())):
            with open(os.path.join(HERE, "fixtures", name)) as fh:
                self.assertEqual(fh.read(), body, f"tests/fixtures/{name} is stale: run python3 tests/make_fixtures.py")

    def test_pricing_is_the_shared_copy(self):
        # Only in the repository: an installed plugin has no shared/ beside it.
        shared = os.path.join(HERE, "..", "..", "..", "shared", "pricing.py")
        if not os.path.exists(shared):
            self.skipTest("no shared/ folder")
        with open(shared, "rb") as a, open(os.path.join(HERE, "..", "hooks", "pricing.py"), "rb") as b:
            self.assertEqual(a.read(), b.read(), "hooks/pricing.py differs: run python3 scripts/sync-shared.py")


if __name__ == "__main__":
    unittest.main()
