// Written by tests/make_fixtures.py from tests/fixtures/normalize.json: do not edit by hand.
export const CASES = [
 {
  "text": "Write release notes for v2.4.1 from the merged PRs, grouped by area",
  "tokens": [
   "write",
   "release",
   "notes",
   "for",
   "<version>",
   "from",
   "the",
   "merged",
   "prs",
   "grouped",
   "by",
   "area"
  ],
  "rare": [
   18589324,
   2104195679,
   2142603952,
   2323761675,
   2655453981,
   3568362270,
   3616816488
  ],
  "hash": 3077736273
 },
 {
  "text": "fix the bug in src/auth/session.ts, see https://example.com/issues/42",
  "tokens": [
   "fix",
   "the",
   "bug",
   "in",
   "<path>",
   "see",
   "<url>"
  ],
  "rare": [
   898416404,
   1509574496,
   2359559470
  ],
  "hash": 1738610471
 },
 {
  "text": "Rename `getUserById` to \"findUser\" in PROJ-123 and #456",
  "tokens": [
   "rename",
   "<x>",
   "to",
   "<x>",
   "in",
   "<n>",
   "and",
   "<n>"
  ],
  "rare": [
   3650966606
  ],
  "hash": 628627655
 },
 {
  "text": "the deploy failed at commit 3f9a2b7c, retry it 3 times",
  "tokens": [
   "the",
   "deploy",
   "failed",
   "at",
   "commit",
   "<id>",
   "retry",
   "it",
   "<n>",
   "times"
  ],
  "rare": [
   500690572,
   786452963,
   1322528429,
   2453354746,
   2659951479
  ],
  "hash": 4054836522
 },
 {
  "text": "I need to migrate the Orders page to the new layout",
  "tokens": [
   "i",
   "need",
   "to",
   "migrate",
   "the",
   "orders",
   "page",
   "to",
   "the",
   "new",
   "layout"
  ],
  "rare": [
   336246304,
   976907234,
   1810056261,
   2370627505,
   3845127662,
   3874778180
  ],
  "hash": 2190531243
 },
 {
  "text": "Don’t touch the “generated” folder",
  "tokens": [
   "don't",
   "touch",
   "the",
   "<x>",
   "folder"
  ],
  "rare": [
   103882927,
   3970042317,
   4139134450
  ],
  "hash": 87092554
 },
 {
  "text": "run pnpm test -- --watch=false on apps/web",
  "tokens": [
   "run",
   "pnpm",
   "test",
   "watch",
   "false",
   "on",
   "<path>"
  ],
  "rare": [
   336526777,
   734881840,
   1342917158,
   1349952704,
   3632233996
  ],
  "hash": 2519366807
 },
 {
  "text": "UPPER case WORDS and MixedCase too",
  "tokens": [
   "upper",
   "case",
   "words",
   "and",
   "mixedcase",
   "too"
  ],
  "rare": [
   918642429,
   1851776924,
   1904025228,
   2013829380
  ],
  "hash": 1984761587
 },
 {
  "text": "",
  "tokens": [],
  "rare": [],
  "hash": 0
 },
 {
  "text": "Is it done yet?",
  "tokens": [
   "is",
   "it",
   "done",
   "yet"
  ],
  "rare": [
   3951271946
  ],
  "hash": 1148592028
 }
]
