"""The patterns coach reads prompts and commands with (SPEC.md, Appendix B).

Starting points, tuned on a labelled set: every list here has a test per
entry in tests/test_patterns.py. English only for now.
"""
import re
import shlex
import zlib

# -- B.1 Machine markers: text that starts with one of these is not a prompt.

MARKER = re.compile(
    r"^\s*(?:<command-name>|<command-message>|<command-args>"
    r"|<local-command-(?:stdout|stderr|caveat)>|<task-notification>|<system-reminder>"
    r"|<bash-(?:input|stdout|stderr)>|Caveat:|Stop hook feedback|\[Request interrupted by user"
    r"|<[a-z][a-z-]*-command>)")
INTERRUPT = re.compile(r"^\s*\[Request interrupted by user(?: for tool use)?\]")
COMMAND_NAME = re.compile(r"<command-name>\s*/?([^<\s]+)\s*</command-name>")
COMMAND_WRAPPER = re.compile(r"^\s*<([a-z][a-z-]*)-command>")


def plain(text):
    """Curly quotes as straight ones, so "doesn’t" reads like "doesn't"."""
    return (text or "").replace("’", "'").replace("‘", "'").replace(
        "“", '"').replace("”", '"')


# -- B.2 Cues, matched at the start of a prompt.

CORRECTION = re.compile(
    r"^\W*(?:no\b|nope\b|wrong\b|not (?:quite|what|that)\b|that'?s (?:not|wrong)\b"
    r"|you (?:didn'?t|forgot|missed|broke)\b|still (?:not|broken|failing|the same)\b"
    r"|it (?:still|doesn'?t|didn'?t)\b|(?:doesn'?t|didn'?t) work\b|same (?:error|issue|problem)\b"
    r"|why did you\b|i (?:meant|said)\b|actually,? (?:i|we|it|that|the)\b"
    r"|your (?:response|answer) (?:above|was)\b)", re.I)
UNDO = re.compile(r"^\W*(?:undo\b|revert\b|roll ?back\b|go back to\b|put it back\b)", re.I)
POLLING = re.compile(
    r"^\W*(?:is it done\b|check again\b|any updates?\b|status\??\s*$|still running\b|has it finished\b)",
    re.I)
CONTINUATION = re.compile(
    r"^\W*(?:it\b|this\b|that\b|these\b|those\b|also\b|again\b|still\b|same\b|continue\b"
    r"|go ahead\b|yes\b|yep\b|ok\b|okay\b|do it\b|looks good\b|and\b)", re.I)

# -- B.3 Prompt checks.

EXTENSIONS = (r"ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|swift|rb|php|c|cc|cpp|h|hpp|cs|md"
              r"|json|ya?ml|toml|css|scss|html|sql|sh|txt|ini|cfg|lock|env")
PATH = re.compile(r"(?:[\w.~-]+/[\w./-]+|\b[\w-]+(?:\.[\w-]+)*\.(?:%s)\b)" % EXTENSIONS)
AT_MENTION = re.compile(r"(?:^|\s)@[\w./-]+")
IDENTIFIER = re.compile(
    r"`[^`\n]+`"
    r"|\b(?=\w{6,}\b)[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+\b"      # camelCase
    r"|\b(?=\w{6,}\b)[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+\b"       # PascalCase
    r"|\b(?=\w{6,}\b)[a-z0-9]+(?:_[a-z0-9]+)+\b")               # snake_case
DONE = re.compile(
    r"\b(?:done when|should (?:now )?(?:show|return|pass|print|work)|make sure|until|so that"
    r"|expect(?:ed|s)?|tests? pass(?:es)?|verify|acceptance)\b", re.I)
VAGUE = re.compile(
    r"\b(?:fix (?:it|this|that)|make it work|(?:doesn'?t|not) work(?:ing)?|broken(?: again)?"
    r"|do the thing|same as before|clean (?:it|this) up)\b", re.I)
LOG_LINE = re.compile(
    r"^\s+at |File \".*\", line \d+|^Traceback|^\d{4}-\d\d-\d\d|^\[?(?:INFO|WARN|WARNING|ERROR|DEBUG)\b"
    r"|^\s*\$ |^\s*>\s")
ASKS_CHECKS = re.compile(
    r"\b(?:run|add|write|check|make sure|verify)\b.{0,30}?\b(?:tests?|build|lint|typecheck|type-check|tsc)\b",
    re.I)


# B.5 Repeat exclusions: never a skill, however often typed.
REPEAT_EXCLUDE = re.compile(r"^\W*(?:reply with just\b|https?://\S+\s*$)", re.I)


def words(text):
    return re.findall(r"[\w'’-]+", text or "")


def names_place(text):
    return bool(PATH.search(text) or AT_MENTION.search(text) or IDENTIFIER.search(text))


def is_vague(text):
    return len(words(text)) <= 6 and bool(VAGUE.search(text)) and not names_place(text)


def is_big_paste(text):
    if len(text) <= 4000:
        return False
    lines = [line for line in text.splitlines() if line.strip()]
    return bool(lines) and sum(1 for line in lines if LOG_LINE.search(line)) * 2 >= len(lines)


# -- B.4 Check commands, and B.8 tasks.

PM = r"(?:npm|pnpm|yarn|bun)"
# A package manager, with any workspace or folder selection after it ("pnpm --filter web test").
PMX = r"(?:npm|pnpm|yarn|bun)(?:\s+(?:--filter|-F|--dir|-C|--prefix|-w|--workspace)(?:=|\s+)\S+)*"
TASKS = (
    ("test", re.compile(
        rf"^{PMX} (?:run )?test\b|^(?:npx |pnpm exec |yarn |bunx |(?:uv|poetry|pipenv) run |bundle exec )?"
        r"(?:pytest|jest|vitest|mocha|rspec|phpunit|ctest)\b|^go test\b|^cargo test\b|^swift test\b"
        r"|^xcodebuild\b.*\btest\b|^(?:(?:uv|poetry|pipenv) run )?python3? -m (?:pytest|unittest)\b"
        r"|^claude plugin test\b|^dotnet test\b|^(?:\./)?gradlew? test\b|^mvn test\b|^make test\b")),
    ("typecheck", re.compile(
        rf"^(?:npx |pnpm exec |yarn |bunx )?tsc\b|^{PMX} (?:run )?(?:typecheck|type-check|tsc)\b"
        r"|^(?:(?:uv|poetry|pipenv) run )?(?:mypy|pyright)\b")),
    ("lint", re.compile(
        rf"^{PMX} (?:run )?lint\b|^(?:npx |pnpm exec |yarn |bunx )?eslint\b"
        r"|^(?:(?:uv|poetry|pipenv) run )?(?:ruff(?: check)?|flake8)\b|^golangci-lint\b|^cargo clippy\b"
        r"|^swiftlint\b|^claude plugin validate\b")),
    ("format", re.compile(
        rf"^(?:npx |pnpm exec |yarn |bunx )?prettier\b|^(?:(?:uv|poetry|pipenv) run )?black\b|^gofmt\b"
        rf"|^cargo fmt\b|^{PMX} (?:run )?format\b")),
    ("build", re.compile(
        rf"^{PMX} (?:run )?build\b|^cargo build\b|^go build\b|^xcodebuild\b(?!.*\btest\b)"
        r"|^(?:\./)?gradlew? (?:build|assemble)\b|^mvn (?:package|install)\b|^make(?: build)?\s*$")),
    ("dev", re.compile(
        rf"^{PMX} (?:run )?(?:dev|start|serve)\b|^(?:(?:uv|poetry|pipenv) run )?uvicorn\b|^flask run\b"
        r"|^rails s(?:erver)?\b|^python3? manage\.py runserver\b")),
    # Installing the project's dependencies, not adding a package.
    ("install", re.compile(
        rf"^{PMX} (?:i|install|ci)(?:\s+-\S+)*\s*$|^yarn\s*$|^pip3? install(?:\s+-\S+)* -r\s+\S+"
        r"|^uv (?:sync|pip install -r)\b|^bundle install\b|^poetry install\b|^go mod download\b")),
)
GIT_COMMIT = re.compile(r"\bgit\b(?:\s+-\S+(?:\s+\S+)?)*\s+commit\b")

_PLUMBING = (
    re.compile(r"\s*\d?>&\d"),
    re.compile(r"\s*(?:&>|\d?>>?)\s*\S+"),
    re.compile(r"\s*\|\s*(?:head|tail|grep|tee|less|cat|wc|sort|uniq)\b.*$"),
    re.compile(r"\s*(?:;|&&)\s*echo\b.*$"),
)
_ENV = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=\S*$")
_SELECTOR_FLAGS = {"-k", "-t", "-g", "--grep", "--testNamePattern", "--test-name-pattern", "-run"}
# Flags whose value is a path that belongs to the command, not a target.
_VALUE_FLAGS = {"--config", "-c", "--project", "-p", "--rootDir", "--tsconfig", "--cwd", "--prefix",
                "-C", "--dir", "-r", "--requirement", "--filter", "-F", "--workspace", "-w"}
_TARGETED = ("test", "lint", "typecheck", "format")


def _split_segments(command):
    return [s.strip() for s in re.split(r"\s*(?:&&|;|\n)\s*", command) if s.strip()]


def _tokens(segment):
    try:
        return shlex.split(segment)
    except ValueError:
        return segment.split()


def strip_plumbing(command):
    """The command without output plumbing (redirects, pipes into head or
    grep, a trailing echo), line by line."""
    lines = []
    for line in (command or "").splitlines():
        for pattern in _PLUMBING:
            line = pattern.sub("", line)
        if line.strip():
            lines.append(line.strip())
    return "\n".join(lines)


def core_command(command):
    """The command after `cd …`, `export …` and environment assignments:
    -> (folder, [tokens]), the first word given as its basename."""
    folder = ""
    for segment in _split_segments(strip_plumbing(command)):
        tokens = _tokens(segment)
        if not tokens:
            continue
        if tokens[0] == "cd" and len(tokens) >= 2:
            folder = tokens[1]
            continue
        if tokens[0] in ("export", "source", ".") or tokens[0].startswith("source"):
            continue
        while tokens and _ENV.match(tokens[0]):
            tokens = tokens[1:]
        if not tokens:
            continue
        tokens[0] = tokens[0].rsplit("/", 1)[-1]
        return folder, tokens
    return folder, []


def classify(command):
    """B.8: -> (task, display, key, folder, had_path) for a test, build or
    similar command; None for anything else. `display` keeps the runner, the
    script, flags and environment assignments, and drops path and test-name
    arguments and output plumbing; `key` also drops flags, so variants of one
    command vote together."""
    cleaned = strip_plumbing(command)
    folder = ""
    for segment in _split_segments(cleaned):
        tokens = _tokens(segment)
        if not tokens:
            continue
        if tokens[0] == "cd" and len(tokens) >= 2:
            folder = tokens[1]
            continue
        env = []
        while tokens and _ENV.match(tokens[0]):
            env.append(tokens[0])
            tokens = tokens[1:]
        if not tokens:
            continue
        tokens[0] = tokens[0].rsplit("/", 1)[-1]
        joined = " ".join(tokens)
        if re.search(r"(?:^|\s)(?:--version|--help|-h|-v)(?:\s|$)", joined):
            continue
        for task, pattern in TASKS:
            if pattern.search(joined):
                kept, had_path, skip = [], False, False
                for i, token in enumerate(tokens):
                    if skip:
                        skip = False
                        continue
                    if token in _SELECTOR_FLAGS:
                        had_path, skip = True, True
                        continue
                    is_value = bool(kept) and kept[-1] in _VALUE_FLAGS
                    if task in _TARGETED and i > 0 and token != "./..." and not is_value and (
                            "::" in token or "/" in token or re.search(r"\.(?:%s)$" % EXTENSIONS, token)):
                        had_path = True
                        continue
                    if token == "--":
                        continue
                    kept.append(token)
                display = " ".join(env + kept)
                key = " ".join(t for t in kept if not t.startswith("-"))
                key = re.sub(rf"^({PM}) run ", r"\1 ", key)
                return task, display, key, folder, had_path
    return None


def is_check(command):
    """B.4: a command that tests, builds, lints or type-checks."""
    hit = classify(command)
    return bool(hit) and hit[0] in ("test", "build", "lint", "typecheck")


# -- B.9 Exploration steps.

EXPLORE_FILE = re.compile(
    r"(?:^|/)(?:package\.json|pnpm-workspace\.yaml|turbo\.json|nx\.json|Makefile|justfile"
    r"|Taskfile\.ya?ml|pyproject\.toml|setup\.cfg|tox\.ini|noxfile\.py|requirements[^/]*\.txt"
    r"|Cargo\.toml|go\.mod|build\.gradle(?:\.kts)?|pom\.xml|Gemfile|Rakefile|README[^/]*"
    r"|CONTRIBUTING[^/]*|Dockerfile|docker-compose[^/]*\.ya?ml|\.gitlab-ci\.yml)$"
    r"|(?:^|/)docs/.*\.md$|(?:^|/)\.github/workflows/[^/]+\.ya?ml$", re.I)
READ_COMMAND = re.compile(r"^(?:cat|head|tail|less|bat)(?:\s+-\S+)*\s+(\S+)\s*$|^sed -n \S+\s+(\S+)\s*$|^jq \S+\s+(\S+)\s*$")
EXPLORE_COMMAND = re.compile(
    rf"^(?:ls(?:\s+-\S+)*(?:\s+[^\s/]+/?)?\s*$|{PM} run\s*$|make (?:help|-n)\b|which \S+\s*$"
    r"|\S+ --version\s*$|(?:grep|rg)\b.*\b(?:scripts|test|jest|vitest|pytest)\b)")
EXPLORE_PATTERN = re.compile(r"\*\.test\.|test_\*|jest\.config|vitest\.config|pytest\.ini|conftest\.py", re.I)
QUESTION = re.compile(
    r"how (?:do|can|should) (?:i|we|you) (run|start|build|test|lint)"
    r"|what(?:'s| is) the (?:command|script) (?:to|for) (run|start|build|test|testing|lint)", re.I)
QUESTION_TASK = {"run": "dev", "start": "dev", "build": "build", "test": "test", "testing": "test",
                 "lint": "lint"}


def question_task(text):
    """The task a prompt asks how to do ("how do I run the tests?" is test)."""
    text = plain(text)
    hit = QUESTION.search(text)
    if not hit:
        return None
    rest = text[hit.start():hit.start() + 80].lower()
    for word, task in (("test", "test"), ("lint", "lint"), ("build", "build")):
        if word in rest:
            return task
    return QUESTION_TASK.get((hit.group(1) or hit.group(2) or "").lower())


# -- B.10 Wrong tool first.

FAILURES = (
    ("wrong-package-manager", re.compile(
        r"ERR_PNPM_(?!NO_SCRIPT)|This project is configured to use \w+|packageManager.*Usage Error"
        r"|Usage Error.*packageManager|Unsupported URL Type \"workspace:\"")),
    ("missing-script", re.compile(
        r"Missing script|Unknown command|ERR_PNPM_NO_SCRIPT|error Command \".*\" not found")),
    ("missing-module", re.compile(r"ModuleNotFoundError: No module named|Cannot find module")),
    ("wrong-version", re.compile(
        r"requires (?:Python|Node|node) (?:>=|version)|Unsupported engine|engine .* is incompatible")),
    ("missing-binary", re.compile(
        r"command not found|not recognized as an internal or external command|env: .*: No such file"
        r"|No such file or directory")),
)
ROLES = ({"npm", "pnpm", "yarn", "bun"}, {"npx", "pnpx", "bunx"}, {"python", "python3", "py"},
         {"pip", "pip3"}, {"docker-compose", "docker"}, {"node", "nodejs"})
PACKAGE_MANAGERS = ROLES[0] | ROLES[1]
INTERPRETERS = ROLES[2] | ROLES[3] | ROLES[5]
PREFIXES = ("uv run", "poetry run", "pipenv run", "bundle exec", "npx", "pnpm exec", "yarn exec",
            ". .venv/bin/activate &&", "source .venv/bin/activate &&", "source venv/bin/activate &&")


def failure_kind(output):
    for kind, pattern in FAILURES:
        if pattern.search(output or ""):
            return kind
    return None


def names_missing(word, output):
    """Whether the error says `word` itself is the missing command."""
    w = re.escape(word)
    return bool(re.search(rf"(?:^|[\s:'\"]){w}: (?:command not found|No such file)"
                          rf"|command not found: {w}\b|'{w}' is not recognized", output or ""))


def pair(failed, worked, output):
    """B.10: -> (from, to, kind) when `worked` is `failed` run with another
    command word in the same role, or with a prefix; None otherwise."""
    kind = failure_kind(output)
    if not kind:
        return None
    _, a = core_command(failed)
    _, b = core_command(worked)
    if not a or not b:
        return None
    raw_failed = " ".join(a)
    raw_worked = " ".join(b)
    for prefix in PREFIXES:
        if raw_worked == f"{prefix} {raw_failed}":
            return (a[0], prefix, "prefix")
    if a[0] == b[0]:
        return None
    if any(a[0] in role and b[0] in role for role in ROLES):
        return (a[0], b[0], "replace")
    if kind == "missing-binary" and names_missing(a[0], output):
        rest_a, rest_b = set(a[1:]), set(b[1:])
        union = rest_a | rest_b
        if not union or len(rest_a & rest_b) / len(union) >= 0.5:
            return (a[0], b[0], "replace")
    return None


def pair_line(source, target, kind):
    if kind == "prefix":
        tool = {"uv run": "Python tools", "poetry run": "Python tools", "pipenv run": "Python tools",
                "bundle exec": "Ruby tools"}.get(target, "commands")
        return f"- Run {tool} through `{target}` (for example `{target} {source}`)."
    if source in INTERPRETERS and target in INTERPRETERS:
        return f"- Use `{target}`; `{source}` isn't available here."
    return f"- Use `{target}`, not `{source}`."


# -- B.6 Instructions, facts and form feedback; B.7 interface words.

INSTRUCTION = re.compile(
    r"\b(?:we|i) (?:use|prefer|don'?t use)\b|\balways\b|\bnever\b|\bdon'?t\b.*\b(?:use|add|write)\b"
    r"|\binstead of\b", re.I)
FACT = re.compile(
    r"\b(?:lives|is|are) (?:in|under|at)\b|\bis located\b|\bour \w+ (?:is|are|uses)\b"
    r"|\bthe (?:api|backend|frontend|server|database|db|app) (?:is|lives|runs)\b", re.I)
FORM = re.compile(
    r"too (?:long|short|verbose)|\bshorter\b|(?:no|without) (?:emojis?|bullet points|headers|headings)"
    r"|don'?t explain|just (?:the|give me) (?:code|answer)|your (?:response|answer) (?:above )?was",
    re.I)
UI_WORDS = re.compile(
    r"\b(?:button|layout|css|style|align(?:ed|ment)?|margin|padding|colou?r|font|looks|screen|page"
    r"|modal|responsive|dark mode)\b", re.I)

# -- B.11 Clause cleanup.

_SENTENCES = re.compile(r"(?<=[.!?])\s+|\n+")
_LEAD = re.compile(
    r"^\W*(?:(?:no|nope|wrong|actually|again|please|i (?:said|meant|told you)|you should|you need to"
    r"|you have to|remember(?: that)?|as i said)\b[\s,:;.!-]*)+", re.I)
_TRAIL = re.compile(r"(?:[\s,]*\b(?:again|please)\b|[\s!.?]+)+$", re.I)
_TOOLS = ("npm", "pnpm", "yarn", "bun", "npx", "pip", "pip3", "uv", "python", "python3", "node",
          "pytest", "jest", "vitest", "git", "make", "cargo", "go", "poetry", "docker", "tsc", "eslint")
_CODE_WORD = re.compile(
    r"(?<![`\w])(%s|(?:[\w.~-]+/[\w./-]+)|[\w-]+\.(?:%s))(?![`\w])" % ("|".join(_TOOLS), EXTENSIONS))


_FENCE = re.compile(r"```.*?(?:```|$)", re.S)
_BULLET = re.compile(r"^\s*(?:[-*\u2022]|\d+[.)])\s+")
_CODE_LINE = re.compile(
    r"^\s*(?:\+|-(?!\s\S)|//|#include|import\s|from\s\S+\simport|def\s|class\s|function\s"
    r"|const\s|let\s|var\s|return\s|<\w|\$\s)")
_QUESTION = re.compile(
    r"^\W*(?:how|what|why|when|where|which|who|can|could|should|would|will|is|are|do|does|did)\b|\?\s*$",
    re.I)


def _prose_lines(text):
    """The lines of `text` that are prose: no fenced code, diff or code lines."""
    for line in _FENCE.sub("\n", text).splitlines():
        if not line.strip() or _CODE_LINE.match(line):
            continue
        symbols = sum(line.count(c) for c in "{}();=<>[]")
        if symbols * 5 > len(line):
            continue
        yield _BULLET.sub("", line)


def clauses(text):
    """B.11: -> [(kind, line)] for the sentences that correct Claude, instruct
    it, state a fact about the project, or give feedback on the reply's form."""
    out = []
    text = plain(text)
    if is_big_paste(text):
        return out
    is_correction = bool(CORRECTION.search(text))
    sentences = [s for line in _prose_lines(text) for s in _SENTENCES.split(line)]
    for sentence in sentences:
        sentence = sentence.strip()
        if not sentence or MARKER.search(sentence) or _QUESTION.search(sentence):
            continue
        if FORM.search(sentence):
            kind = "preference"
        elif INSTRUCTION.search(sentence) or FACT.search(sentence):
            kind = "correction" if is_correction else "instruction"
        elif is_correction and CORRECTION.search(sentence) and _CODE_WORD.search(sentence):
            # A bare "no, the other one" says nothing a CLAUDE.md line could
            # hold: a correction alone counts only when it names something.
            kind = "correction"
        else:
            continue
        line = _TRAIL.sub("", _LEAD.sub("", sentence)).strip()
        if len(words(line)) < 3:
            continue
        line = _CODE_WORD.sub(r"`\1`", line)
        line = line[0].upper() + line[1:]
        out.append((kind, (line + ".")[:120]))
    return out


# -- B.12 Prompt normalization (hooks/normalize.ts implements the same rules).

_URL = re.compile(r"https?://\S+")
_QUOTED = re.compile(r"`[^`]*`|\"[^\"]*\"")
_VERSION = re.compile(r"\bv?\d+\.\d+(?:\.\d+)*(?:[-+][\w.]+)?\b")
_ISSUE = re.compile(r"#\d+\b|\b[A-Z][A-Z0-9]+-\d+\b")
_HEX = re.compile(r"\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{7,}\b")
_NUMBER = re.compile(r"\b\d+\b")
_TOKEN = re.compile(r"<\w+>|[a-z0-9][a-z0-9'_-]*")

STOPWORDS = frozenset("""
a an the and or but if then so to of in on at for from by with as is are was were be been being it
its this that these those i me my we our you your he she they them their what which who whom how
why when where can could should would will shall may might must do does did done have has had not no
yes just also very too please some any all each every there here than into over under about up down
out off again more most such only own same other let lets get got make made use using go going
""".split())


def normalize(text):
    """B.12: -> the prompt's first 60 words, its variable parts as slots."""
    text = plain(text)
    text = _URL.sub(" <url> ", text)
    text = _QUOTED.sub(" <x> ", text)
    text = PATH.sub(" <path> ", text)
    text = _VERSION.sub(" <version> ", text)
    text = _ISSUE.sub(" <n> ", text)
    text = text.lower()
    text = _HEX.sub(" <id> ", text)
    text = _NUMBER.sub(" <n> ", text)
    return _TOKEN.findall(text)[:60]


def stable_hash(text):
    """A hash that is the same in every run (Python's hash() is not)."""
    return zlib.crc32(text.encode("utf-8"))


def grams(tokens, n=3):
    if len(tokens) < n:
        return [stable_hash(" ".join(tokens))] if tokens else []
    return sorted({stable_hash(" ".join(tokens[i:i + n])) for i in range(len(tokens) - n + 1)})


def content_words(text):
    out = []
    for word in re.findall(r"[a-z0-9][a-z0-9_./-]*", plain(text).lower()):
        if word in STOPWORDS:
            continue
        if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
            word = word[:-1]
        out.append(word)
    return out


def jaccard(a, b):
    a, b = set(a), set(b)
    union = a | b
    return len(a & b) / len(union) if union else 0.0


# -- Scrubbing (SPEC.md §13): obvious secrets out of anything stored.

_SECRETS = (
    (re.compile(r"(?i)\b(password|passwd|pwd|token|secret|api[_-]?key)(\s*[:=]\s*)\S+"), r"\1\2[redacted]"),
    (re.compile(r"\bsk-[A-Za-z0-9_-]{16,}"), "[redacted]"),
    (re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}"), "[redacted]"),
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "[redacted]"),
    (re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+"), "[redacted]"),
    (re.compile(r"\b[0-9a-fA-F]{32,}\b"), "[redacted]"),
    (re.compile(r"(?<![\w/])[A-Za-z0-9+/]{32,}={0,2}(?![\w/])"), "[redacted]"),
)


def scrub(text):
    out = text or ""
    for pattern, repl in _SECRETS:
        out = pattern.sub(repl, out)
    return out


def excerpt(text, limit=200):
    """A scrubbed, single-line cut of `text`, at most `limit` characters."""
    flat = re.sub(r"\s+", " ", scrub(plain(text))).strip()
    return flat if len(flat) <= limit else flat[:limit - 1].rstrip() + "…"
