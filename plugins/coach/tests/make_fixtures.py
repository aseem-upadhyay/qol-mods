#!/usr/bin/env python3
"""Writes the TS tests' fixtures from the Python side, so the two agree:

  tests/fixtures/report.ts     scan.py's report over tests/beginner.py's month
  tests/fixtures/normalize.ts  patterns.normalize() and stable_hash() over
                               tests/fixtures/normalize.json's inputs

Run: python3 plugins/coach/tests/make_fixtures.py
tests/test_fixtures.py fails while either file is out of date.
"""
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "hooks"))

import beginner  # noqa: E402
import patterns as P  # noqa: E402

SCAN = os.path.join(HERE, "..", "hooks", "scan.py")
FIXTURES = os.path.join(HERE, "fixtures")


def report_json():
    with tempfile.TemporaryDirectory() as tmp:
        projects = os.path.join(tmp, "projects")
        beginner.build(projects)
        out = subprocess.run(
            [sys.executable, SCAN, "--projects", projects, "--data", os.path.join(tmp, "data"),
             "--home", "/home/me", "--config-dir", "/home/me/.claude", "--now", str(beginner.NOW)],
            check=True, capture_output=True, text=True, env=dict(os.environ, TZ="UTC")).stdout
    report = json.loads(out.strip().splitlines()[-1])["report"]
    return json.dumps(report, indent=1, sort_keys=True)


def report_ts():
    return ("// Written by tests/make_fixtures.py from tests/beginner.py: do not edit by hand.\n"
            "import type { Report } from '../../types'\n\n"
            f"const raw = {report_json()}\n\n"
            "export const REPORT = raw as unknown as Report\n")


def normalize_ts():
    with open(os.path.join(FIXTURES, "normalize.json")) as fh:
        inputs = json.load(fh)["inputs"]
    cases = []
    for text in inputs:
        tokens = P.normalize(text)
        rare = sorted({P.stable_hash(t) for t in tokens if t not in P.STOPWORDS and not t.startswith("<")})
        cases.append({"text": text, "tokens": tokens, "rare": rare,
                      "hash": P.stable_hash(" ".join(tokens))})
    return ("// Written by tests/make_fixtures.py from tests/fixtures/normalize.json: do not edit by hand.\n"
            f"export const CASES = {json.dumps(cases, indent=1, ensure_ascii=False)}\n")


def main():
    for name, body in (("report.ts", report_ts()), ("normalize.ts", normalize_ts())):
        with open(os.path.join(FIXTURES, name), "w") as fh:
            fh.write(body)
        print("wrote", os.path.join("tests", "fixtures", name))


if __name__ == "__main__":
    main()
