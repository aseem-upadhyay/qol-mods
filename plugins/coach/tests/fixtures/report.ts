// Written by tests/make_fixtures.py from tests/beginner.py: do not edit by hand.
import type { Report } from '../../types'

const raw = {
 "coverage": {
  "files": 29,
  "logsSince": 1789380000000,
  "sessions": 29,
  "since": 1789380000000
 },
 "current": {
  "best": null,
  "context": {
   "compactions": {
    "auto": 0,
    "manual": 0,
    "unknown": 0
   },
   "fresh": 0,
   "oversizedSessions": 0,
   "stale": 0
  },
  "cost": {
   "byDay": {
    "2026-10-05": 0.3358,
    "2026-10-06": 0.1169
   },
   "byModel": {
    "claude-opus-5": 0.3787,
    "claude-opus-5-5": 0.074
   },
   "byProject": {
    "my-app": 0.4527
   },
   "estimated": true,
   "fastUsd": 0.0,
   "inputUsd": 0.2807,
   "outputUsd": 0.172,
   "perPrompt": {
    "median": 0.0564,
    "p90": 0.2618
   },
   "rewarmEvents": 0,
   "rewarmUsd": 0.0,
   "unpriced": [],
   "usd": 0.4527
  },
  "coverage": {
   "firstLogAt": null,
   "partial": false
  },
  "end": 1791763200000,
  "evidence": {
   "point-to-place:w3-disc-u1": {
    "at": 1791194400000,
    "detector": "point-to-place",
    "excerpt": "the search hook needs tests",
    "id": "point-to-place:w3-disc-u1",
    "numbers": {
     "steps": 3
    },
    "project": "my-app",
    "root": "/work/my-app",
    "session": "w3-disc",
    "title": "the search hook needs tests",
    "usd": null
   }
  },
  "features": {
   "interrupt": 2
  },
  "firstAt": 1791194400000,
  "frozen": false,
  "habits": {
   "check-work": {
    "done": 2,
    "eligible": false,
    "evidence": [],
    "impactUsd": 0,
    "min": 5,
    "sample": 3,
    "target": 0.6,
    "total": 3,
    "value": 0.667
   },
   "fresh-start": {
    "done": 0,
    "eligible": false,
    "evidence": [],
    "impactUsd": 0,
    "min": 3,
    "sample": 0,
    "target": 0.7,
    "total": 0,
    "value": null
   },
   "plan-big": {
    "done": 0,
    "eligible": false,
    "evidence": [],
    "impactUsd": 0,
    "min": 2,
    "sample": 0,
    "target": 0.5,
    "total": 0,
    "value": null
   },
   "point-to-place": {
    "done": 1,
    "eligible": false,
    "evidence": [
     "point-to-place:w3-disc-u1"
    ],
    "impactUsd": 0.0982,
    "min": 5,
    "sample": 2,
    "target": 0.5,
    "total": 2,
    "value": 0.5
   },
   "say-done": {
    "done": 0,
    "eligible": false,
    "evidence": [],
    "impactUsd": 0,
    "min": 5,
    "sample": 3,
    "target": 0.4,
    "total": 3,
    "value": 0.0
   }
  },
  "memory": {
   "discoveryEpisodes": 1,
   "discoverySteps": 3,
   "repeatedCorrections": 0,
   "wrongToolFirst": 1
  },
  "metricsVersion": 1,
  "notices": [],
  "prompts": {
   "bigPastes": 0,
   "images": 0,
   "medianWords": 9.0,
   "namesPlace": 1,
   "opening": 3,
   "saysDone": 0,
   "vague": 0
  },
  "repeats": {
   "clusters": 1,
   "prompts": 1
  },
  "safety": {
   "bypassSessions": 0
  },
  "sessionIds": [
   "w3-disc",
   "w3-fresh",
   "w3-notes"
  ],
  "start": 1791158400000,
  "tips": [
   {
    "category": "cost",
    "conflicts": [],
    "count": 0,
    "evidence": [],
    "family": "tip",
    "id": "newer-model",
    "impactUsd": 0.1426,
    "level": 1,
    "numbers": {
     "model": "claude-opus-5",
     "newer": "claude-opus-5-5",
     "share": 0.837,
     "usd": 0.38
    },
    "score": 0.0285
   }
  ],
  "together": {
   "apiErrors": 0,
   "classifierBlocks": 0,
   "corrections": 0,
   "endedBadly": 0,
   "interrupts": 1,
   "rejections": 0
  },
  "usage": {
   "cacheHitRate": 0.9655,
   "callsPerPrompt": 2.0,
   "contextPerCall": {
    "median": 29000.0,
    "p90": 41000.0
   },
   "effortShare": {},
   "families": [
    "opus"
   ]
  },
  "versionsSeen": [
   "2.1.293"
  ],
  "volume": {
   "activeDays": 2,
   "commands": 0,
   "prompts": 5,
   "sessions": 3
  },
  "week": "2026-10-05",
  "work": {
   "bigChanges": 0,
   "bigChangesPlanned": 0,
   "checked": 2,
   "codePrompts": 3,
   "commits": 0
  }
 },
 "errors": [],
 "evidence": {
  "claude-md-S1:w1-disc-u1": {
   "at": 1789984800000,
   "detector": "claude-md-S1",
   "excerpt": "cover the currency formatter with tests",
   "id": "claude-md-S1:w1-disc-u1",
   "numbers": {
    "failed": 4,
    "of": 24,
    "sessions": 4,
    "steps": 12
   },
   "project": "my-app",
   "root": "/work/my-app",
   "session": "w1-disc",
   "title": "cover the currency formatter with tests",
   "usd": 0.52
  },
  "claude-md-S2:w1-disc-u1": {
   "at": 1789984800000,
   "detector": "claude-md-S2",
   "excerpt": "cover the currency formatter with tests",
   "id": "claude-md-S2:w1-disc-u1",
   "numbers": {
    "sessions": 4,
    "times": 4
   },
   "project": "my-app",
   "root": "/work/my-app",
   "session": "w1-disc",
   "title": "cover the currency formatter with tests",
   "usd": null
  },
  "claude-md-S6:w0-corr-u9": {
   "at": 1789725924000,
   "detector": "claude-md-S6",
   "excerpt": "your answer was too long, keep it short",
   "id": "claude-md-S6:w0-corr-u9",
   "numbers": {
    "sessions": 3,
    "times": 3
   },
   "project": "my-app",
   "root": "/work/my-app",
   "session": "w0-corr",
   "title": "update the header",
   "usd": null
  },
  "skill:w3-notes-u1": {
   "at": 1791280800000,
   "detector": "skill",
   "excerpt": "Write release notes for v1.3.0 from the merged PRs, grouped by area, with a one-line summary at the top",
   "id": "skill:w3-notes-u1",
   "numbers": {
    "count": 5,
    "sessions": 5
   },
   "project": "my-app",
   "root": "/work/my-app",
   "session": "w3-notes",
   "title": "Write release notes for v1.3.0 from the merged PRs, grouped\u2026",
   "usd": null
  }
 },
 "excerpts": true,
 "features": {
  "ask-checks": {
   "count": 2,
   "firstSeen": 1789344000000,
   "lastSeen": 1790589600000
  },
  "interrupt": {
   "count": 2,
   "firstSeen": 1791158400000,
   "lastSeen": 1791205223000
  },
  "plan-mode": {
   "count": 1,
   "firstSeen": 1790553600000,
   "lastSeen": 1790848800000
  }
 },
 "generatedAt": 1791385200000,
 "hints": {
  "clusters": [
   {
    "count": 5,
    "existing": null,
    "id": "skill:project:2384724490",
    "name": "release-notes",
    "signature": [
     18589324,
     517545930,
     643318896,
     2104195679,
     2142603952,
     2323761675,
     2655453981,
     3458754147,
     3568362270,
     3616816488
    ]
   }
  ]
 },
 "history": [
  {
   "correctionsPer10": 2.0,
   "costPerPrompt": 0.2618,
   "discoverySteps": 3,
   "habits": {
    "check-work": 0.182,
    "fresh-start": 0.333,
    "plan-big": 0.0,
    "point-to-place": 0.333,
    "say-done": 0.1
   },
   "interruptsPer10": 0.0,
   "metricsVersion": 1,
   "oversized": 1,
   "partial": false,
   "prompts": 15,
   "repeatedPrompts": 1,
   "sessions": 8,
   "start": 1789344000000,
   "usd": 4.3722,
   "week": "2026-09-14"
  },
  {
   "correctionsPer10": 2.0,
   "costPerPrompt": 0.2618,
   "discoverySteps": 3,
   "habits": {
    "check-work": 0.182,
    "fresh-start": 0.333,
    "plan-big": 0.0,
    "point-to-place": 0.333,
    "say-done": 0.1
   },
   "interruptsPer10": 0.0,
   "metricsVersion": 1,
   "oversized": 1,
   "partial": false,
   "prompts": 15,
   "repeatedPrompts": 1,
   "sessions": 8,
   "start": 1789948800000,
   "usd": 4.3722,
   "week": "2026-09-21"
  },
  {
   "correctionsPer10": 1.67,
   "costPerPrompt": 0.2524,
   "discoverySteps": 3,
   "habits": {
    "check-work": 0.154,
    "fresh-start": 0.333,
    "plan-big": 0.5,
    "point-to-place": 0.3,
    "say-done": 0.083
   },
   "interruptsPer10": 0.0,
   "metricsVersion": 1,
   "oversized": 1,
   "partial": false,
   "prompts": 18,
   "repeatedPrompts": 2,
   "sessions": 10,
   "start": 1790553600000,
   "usd": 6.1408,
   "week": "2026-09-28"
  },
  {
   "correctionsPer10": null,
   "costPerPrompt": 0.0564,
   "discoverySteps": 3,
   "habits": {
    "check-work": 0.667,
    "fresh-start": null,
    "plan-big": null,
    "point-to-place": 0.5,
    "say-done": 0.0
   },
   "interruptsPer10": null,
   "metricsVersion": 1,
   "oversized": 0,
   "partial": false,
   "prompts": 5,
   "repeatedPrompts": 1,
   "sessions": 3,
   "start": 1791158400000,
   "usd": 0.4527,
   "week": "2026-10-05"
  }
 ],
 "level": 0,
 "live": {
  "lastRequestAt": 1791280962000,
  "sessions": {
   "w2-big": [
    1790849040000,
    103000
   ],
   "w2-big2": [
    1790867040000,
    103000
   ],
   "w2-bypass": [
    1790957784000,
    216000
   ],
   "w2-corr": [
    1790935544000,
    35000
   ],
   "w2-notes-b": [
    1790784182000,
    29000
   ],
   "w3-disc": [
    1791194574000,
    44000
   ],
   "w3-fresh": [
    1791205347000,
    32000
   ],
   "w3-notes": [
    1791280982000,
    29000
   ]
  }
 },
 "metricsVersion": 1,
 "parserVersion": 1,
 "previous": {
  "best": "best-prompt:w2-good-u1",
  "context": {
   "compactions": {
    "auto": 0,
    "manual": 0,
    "unknown": 0
   },
   "fresh": 1,
   "oversizedSessions": 1,
   "stale": 2
  },
  "cost": {
   "byDay": {
    "2026-09-28": 0.2618,
    "2026-09-29": 0.5051,
    "2026-09-30": 2.3319,
    "2026-10-01": 1.1974,
    "2026-10-02": 1.8445
   },
   "byModel": {
    "claude-opus-5": 6.0668,
    "claude-opus-5-5": 0.074
   },
   "byProject": {
    "my-app": 6.1408
   },
   "estimated": true,
   "fastUsd": 0.0,
   "inputUsd": 5.3888,
   "outputUsd": 0.752,
   "perPrompt": {
    "median": 0.2524,
    "p90": 0.8887
   },
   "rewarmEvents": 2,
   "rewarmUsd": 1.5525,
   "unpriced": [],
   "usd": 6.1408
  },
  "coverage": {
   "firstLogAt": null,
   "partial": false
  },
  "end": 1791158400000,
  "evidence": {
   "best-prompt:w2-good-u1": {
    "at": 1790776800000,
    "detector": "best-prompt",
    "excerpt": "In src/components/Button.tsx, add a loading prop. Done when the Button tests pass.",
    "id": "best-prompt:w2-good-u1",
    "numbers": {
     "followUps": 0
    },
    "project": "my-app",
    "root": "/work/my-app",
    "session": "w2-good",
    "title": "In src/components/Button.tsx, add a loading prop. Done when\u2026",
    "usd": 0.074
   },
   "check-work:w2-vague-u1": {
    "at": 1790690400000,
    "detector": "check-work",
    "excerpt": "fix the login thing its broken again",
    "id": "check-work:w2-vague-u1",
    "numbers": {
     "files": 1
    },
    "project": "my-app",
    "root": "/work/my-app",
    "session": "w2-vague",
    "title": "fix the login thing its broken again",
    "usd": 0.1274
   },
   "fresh-start:w2-switch-u9": {
    "at": 1790765786000,
    "detector": "fresh-start",
    "excerpt": "now add a dark mode toggle to the settings page",
    "id": "fresh-start:w2-switch-u9",
    "numbers": {
     "contextK": 330,
     "promptsAfter": 3
    },
    "project": "my-app",
    "root": "/work/my-app",
    "session": "w2-switch",
    "title": "refactor the auth middleware in src/auth/middleware.ts",
    "usd": 1.155
   },
   "plan-big:w2-big2-u1": {
    "at": 1790866800000,
    "detector": "plan-big",
    "excerpt": "migrate the tables to the new design system",
    "id": "plan-big:w2-big2-u1",
    "numbers": {
     "files": 9
    },
    "project": "my-app",
    "root": "/work/my-app",
    "session": "w2-big2",
    "title": "migrate the tables to the new design system",
    "usd": 0.5987
   },
   "point-to-place:w2-vague-u1": {
    "at": 1790690400000,
    "detector": "point-to-place",
    "excerpt": "fix the login thing its broken again",
    "id": "point-to-place:w2-vague-u1",
    "numbers": {
     "steps": 7
    },
    "project": "my-app",
    "root": "/work/my-app",
    "session": "w2-vague",
    "title": "fix the login thing its broken again",
    "usd": null
   },
   "say-done:w2-corr-u1": {
    "at": 1790935200000,
    "detector": "say-done",
    "excerpt": "update the header",
    "id": "say-done:w2-corr-u1",
    "numbers": {
     "corrections": 2
    },
    "project": "my-app",
    "root": "/work/my-app",
    "session": "w2-corr",
    "title": "update the header",
    "usd": null
   }
  },
  "features": {
   "ask-checks": 1,
   "plan-mode": 1
  },
  "firstAt": 1790589600000,
  "frozen": true,
  "habits": {
   "check-work": {
    "done": 2,
    "eligible": true,
    "evidence": [
     "check-work:w2-vague-u1"
    ],
    "impactUsd": 0.1594,
    "min": 5,
    "sample": 13,
    "target": 0.6,
    "total": 13,
    "value": 0.154
   },
   "fresh-start": {
    "done": 1,
    "eligible": true,
    "evidence": [
     "fresh-start:w2-switch-u9"
    ],
    "impactUsd": 1.505,
    "min": 3,
    "sample": 3,
    "target": 0.7,
    "total": 3,
    "value": 0.333
   },
   "plan-big": {
    "done": 1,
    "eligible": false,
    "evidence": [
     "plan-big:w2-big2-u1"
    ],
    "impactUsd": 0,
    "min": 2,
    "sample": 2,
    "target": 0.5,
    "total": 2,
    "value": 0.5
   },
   "point-to-place": {
    "done": 3,
    "eligible": true,
    "evidence": [
     "point-to-place:w2-vague-u1"
    ],
    "impactUsd": 0.6822,
    "min": 5,
    "sample": 10,
    "target": 0.5,
    "total": 10,
    "value": 0.3
   },
   "say-done": {
    "done": 1,
    "eligible": true,
    "evidence": [
     "say-done:w2-corr-u1"
    ],
    "impactUsd": 0.1524,
    "min": 5,
    "sample": 12,
    "target": 0.4,
    "total": 12,
    "value": 0.083
   }
  },
  "memory": {
   "discoveryEpisodes": 1,
   "discoverySteps": 3,
   "repeatedCorrections": 0,
   "wrongToolFirst": 1
  },
  "metricsVersion": 1,
  "notices": [
   {
    "id": "bypass",
    "n": 1
   }
  ],
  "prompts": {
   "bigPastes": 0,
   "images": 0,
   "medianWords": 8.0,
   "namesPlace": 3,
   "opening": 12,
   "saysDone": 1,
   "vague": 0
  },
  "repeats": {
   "clusters": 1,
   "prompts": 2
  },
  "safety": {
   "bypassSessions": 1
  },
  "sessionIds": [
   "w2-big",
   "w2-big2",
   "w2-bypass",
   "w2-corr",
   "w2-disc",
   "w2-good",
   "w2-notes",
   "w2-notes-b",
   "w2-switch",
   "w2-vague"
  ],
  "start": 1790553600000,
  "tips": [
   {
    "category": "cost",
    "conflicts": [],
    "count": 0,
    "evidence": [],
    "family": "tip",
    "id": "newer-model",
    "impactUsd": 2.5079,
    "level": 1,
    "numbers": {
     "model": "claude-opus-5",
     "newer": "claude-opus-5-5",
     "share": 0.988,
     "usd": 6.07
    },
    "score": 0.5016
   },
   {
    "category": "safety",
    "conflicts": [],
    "count": 1,
    "evidence": [],
    "family": "tip",
    "id": "bypass-to-auto",
    "impactUsd": null,
    "level": 1,
    "numbers": {
     "sessions": 1
    },
    "score": 0.5
   }
  ],
  "together": {
   "apiErrors": 0,
   "classifierBlocks": 0,
   "corrections": 3,
   "endedBadly": 0,
   "interrupts": 0,
   "rejections": 0
  },
  "usage": {
   "cacheHitRate": 0.9505,
   "callsPerPrompt": 2.5,
   "contextPerCall": {
    "median": 56000.0,
    "p90": 320000.0
   },
   "effortShare": {},
   "families": [
    "opus"
   ]
  },
  "versionsSeen": [
   "2.1.293"
  ],
  "volume": {
   "activeDays": 5,
   "commands": 0,
   "prompts": 18,
   "sessions": 10
  },
  "week": "2026-09-28",
  "work": {
   "bigChanges": 2,
   "bigChangesPlanned": 1,
   "checked": 2,
   "codePrompts": 13,
   "commits": 0
  }
 },
 "recent": null,
 "restored": false,
 "suggestions": {
  "claudeMd": [
   {
    "family": "claude-md",
    "file": "/work/my-app/CLAUDE.md",
    "hasClaudeMd": false,
    "id": "claude-md:my-app",
    "impactUsd": 0.166,
    "level": 1,
    "lines": [
     {
      "evidence": [
       "claude-md-S1:w1-disc-u1"
      ],
      "file": "project",
      "id": "claude-md:my-app:S1:test",
      "numbers": {
       "failed": 4,
       "of": 24,
       "sessions": 4,
       "steps": 12,
       "usd": 0.52
      },
      "source": "S1",
      "text": "- Test: `pnpm test` (one file: `pnpm test <path>`)"
     },
     {
      "evidence": [
       "claude-md-S2:w1-disc-u1"
      ],
      "file": "project",
      "id": "claude-md:my-app:S2:npm>pnpm",
      "machine": false,
      "numbers": {
       "sessions": 4,
       "times": 4
      },
      "source": "S2",
      "text": "- Use `pnpm`, not `npm`."
     }
    ],
    "loadedLines": 0,
    "loadedTokens": 0,
    "notes": [],
    "pointers": {
     "files": [
      "src/app/routes.ts"
     ],
     "tasks": []
    },
    "project": "my-app",
    "root": "/work/my-app",
    "score": 0.5332
   },
   {
    "family": "claude-md",
    "file": "/home/me/.claude/CLAUDE.md",
    "hasClaudeMd": false,
    "id": "claude-md:All projects",
    "impactUsd": 0.0,
    "level": 1,
    "lines": [
     {
      "evidence": [
       "claude-md-S6:w0-corr-u9"
      ],
      "file": "user",
      "id": "claude-md:*:S6:3834099886",
      "numbers": {
       "sessions": 3,
       "times": 3
      },
      "requests": [
       "w0-corr-u9",
       "w2-corr-u9",
       "w1-corr-u9"
      ],
      "source": "S6",
      "text": "- Your answer was too long, keep it short."
     }
    ],
    "loadedLines": 0,
    "loadedTokens": 0,
    "notes": [],
    "pointers": {
     "files": [],
     "tasks": []
    },
    "project": "All projects",
    "root": "/home/me/.claude",
    "score": 0.375
   }
  ],
  "claudeMdCovered": [],
  "skills": [
   {
    "correctedShare": 0.0,
    "count": 5,
    "evidence": [
     "skill:w3-notes-u1"
    ],
    "existing": null,
    "family": "skill",
    "followUps": [
     {
      "count": 4,
      "share": 0.8,
      "text": "also link each pr"
     }
    ],
    "id": "skill:project:2384724490",
    "level": 2,
    "location": "/work/my-app/.claude/skills/release-notes/",
    "name": "release-notes",
    "project": "my-app",
    "scope": "project",
    "score": 0.4833,
    "sessions": 5,
    "signature": [
     18589324,
     517545930,
     643318896,
     2104195679,
     2142603952,
     2323761675,
     2655453981,
     3458754147,
     3568362270,
     3616816488
    ],
    "slots": [
     "<version>"
    ],
    "template": "Write release notes for <version> from the merged prs grouped by area with a one-line summary at the top"
   }
  ],
  "skillsAdopted": []
 },
 "thresholdK": 300,
 "upNext": {
  "feature": "claude-md",
  "reason": "claude-md"
 },
 "weekStart": "monday",
 "weeks": [
  {
   "best": "best-prompt:w0-good-u1",
   "context": {
    "compactions": {
     "auto": 0,
     "manual": 0,
     "unknown": 0
    },
    "fresh": 1,
    "oversizedSessions": 1,
    "stale": 2
   },
   "cost": {
    "byDay": {
     "2026-09-14": 0.2618,
     "2026-09-15": 0.5456,
     "2026-09-16": 2.2149,
     "2026-09-17": 1.1974,
     "2026-09-18": 0.1524
    },
    "byModel": {
     "claude-opus-5": 4.2982,
     "claude-opus-5-5": 0.074
    },
    "byProject": {
     "my-app": 4.3722
    },
    "estimated": true,
    "fastUsd": 0.0,
    "inputUsd": 3.7002,
    "outputUsd": 0.672,
    "perPrompt": {
     "median": 0.2618,
     "p90": 0.5987
    },
    "rewarmEvents": 1,
    "rewarmUsd": 0.345,
    "unpriced": [],
    "usd": 4.3722
   },
   "coverage": {
    "firstLogAt": null,
    "partial": false
   },
   "end": 1789948800000,
   "evidence": {
    "best-prompt:w0-good-u1": {
     "at": 1789567200000,
     "detector": "best-prompt",
     "excerpt": "In src/components/Button.tsx, add a loading prop. Done when the Button tests pass.",
     "id": "best-prompt:w0-good-u1",
     "numbers": {
      "followUps": 0
     },
     "project": "my-app",
     "root": "/work/my-app",
     "session": "w0-good",
     "title": "In src/components/Button.tsx, add a loading prop. Done when\u2026",
     "usd": 0.074
    },
    "check-work:w0-vague-u1": {
     "at": 1789480800000,
     "detector": "check-work",
     "excerpt": "fix the login thing its broken again",
     "id": "check-work:w0-vague-u1",
     "numbers": {
      "files": 1
     },
     "project": "my-app",
     "root": "/work/my-app",
     "session": "w0-vague",
     "title": "fix the login thing its broken again",
     "usd": 0.1274
    },
    "fresh-start:w0-switch-u9": {
     "at": 1789556186000,
     "detector": "fresh-start",
     "excerpt": "now add a dark mode toggle to the settings page",
     "id": "fresh-start:w0-switch-u9",
     "numbers": {
      "contextK": 330,
      "promptsAfter": 3
     },
     "project": "my-app",
     "root": "/work/my-app",
     "session": "w0-switch",
     "title": "refactor the auth middleware in src/auth/middleware.ts",
     "usd": 1.155
    },
    "plan-big:w0-big2-u1": {
     "at": 1789657200000,
     "detector": "plan-big",
     "excerpt": "migrate the tables to the new design system",
     "id": "plan-big:w0-big2-u1",
     "numbers": {
      "files": 9
     },
     "project": "my-app",
     "root": "/work/my-app",
     "session": "w0-big2",
     "title": "migrate the tables to the new design system",
     "usd": 0.5987
    },
    "point-to-place:w0-vague-u1": {
     "at": 1789480800000,
     "detector": "point-to-place",
     "excerpt": "fix the login thing its broken again",
     "id": "point-to-place:w0-vague-u1",
     "numbers": {
      "steps": 7
     },
     "project": "my-app",
     "root": "/work/my-app",
     "session": "w0-vague",
     "title": "fix the login thing its broken again",
     "usd": null
    },
    "say-done:w0-corr-u1": {
     "at": 1789725600000,
     "detector": "say-done",
     "excerpt": "update the header",
     "id": "say-done:w0-corr-u1",
     "numbers": {
      "corrections": 2
     },
     "project": "my-app",
     "root": "/work/my-app",
     "session": "w0-corr",
     "title": "update the header",
     "usd": null
    }
   },
   "features": {
    "ask-checks": 1
   },
   "firstAt": 1789380000000,
   "frozen": true,
   "habits": {
    "check-work": {
     "done": 2,
     "eligible": true,
     "evidence": [
      "check-work:w0-vague-u1"
     ],
     "impactUsd": 0.1594,
     "min": 5,
     "sample": 11,
     "target": 0.6,
     "total": 11,
     "value": 0.182
    },
    "fresh-start": {
     "done": 1,
     "eligible": true,
     "evidence": [
      "fresh-start:w0-switch-u9"
     ],
     "impactUsd": 1.505,
     "min": 3,
     "sample": 3,
     "target": 0.7,
     "total": 3,
     "value": 0.333
    },
    "plan-big": {
     "done": 0,
     "eligible": true,
     "evidence": [
      "plan-big:w0-big2-u1"
     ],
     "impactUsd": 0,
     "min": 2,
     "sample": 2,
     "target": 0.5,
     "total": 2,
     "value": 0.0
    },
    "point-to-place": {
     "done": 3,
     "eligible": true,
     "evidence": [
      "point-to-place:w0-vague-u1"
     ],
     "impactUsd": 0.6822,
     "min": 5,
     "sample": 9,
     "target": 0.5,
     "total": 9,
     "value": 0.333
    },
    "say-done": {
     "done": 1,
     "eligible": true,
     "evidence": [
      "say-done:w0-corr-u1"
     ],
     "impactUsd": 0.1524,
     "min": 5,
     "sample": 10,
     "target": 0.4,
     "total": 10,
     "value": 0.1
    }
   },
   "memory": {
    "discoveryEpisodes": 1,
    "discoverySteps": 3,
    "repeatedCorrections": 0,
    "wrongToolFirst": 1
   },
   "metricsVersion": 1,
   "notices": [],
   "prompts": {
    "bigPastes": 0,
    "images": 0,
    "medianWords": 8.0,
    "namesPlace": 3,
    "opening": 10,
    "saysDone": 1,
    "vague": 0
   },
   "repeats": {
    "clusters": 1,
    "prompts": 1
   },
   "safety": {
    "bypassSessions": 0
   },
   "sessionIds": [
    "w0-big",
    "w0-big2",
    "w0-corr",
    "w0-disc",
    "w0-good",
    "w0-notes",
    "w0-switch",
    "w0-vague"
   ],
   "start": 1789344000000,
   "tips": [
    {
     "category": "cost",
     "conflicts": [],
     "count": 0,
     "evidence": [],
     "family": "tip",
     "id": "newer-model",
     "impactUsd": 2.0168,
     "level": 1,
     "numbers": {
      "model": "claude-opus-5",
      "newer": "claude-opus-5-5",
      "share": 0.983,
      "usd": 4.3
     },
     "score": 0.4034
    }
   ],
   "together": {
    "apiErrors": 0,
    "classifierBlocks": 0,
    "corrections": 3,
    "endedBadly": 0,
    "interrupts": 0,
    "rejections": 0
   },
   "usage": {
    "cacheHitRate": 0.9789,
    "callsPerPrompt": 3.0,
    "contextPerCall": {
     "median": 53000.0,
     "p90": 330000.0
    },
    "effortShare": {},
    "families": [
     "opus"
    ]
   },
   "versionsSeen": [
    "2.1.293"
   ],
   "volume": {
    "activeDays": 5,
    "commands": 0,
    "prompts": 15,
    "sessions": 8
   },
   "week": "2026-09-14",
   "work": {
    "bigChanges": 2,
    "bigChangesPlanned": 0,
    "checked": 2,
    "codePrompts": 11,
    "commits": 0
   }
  },
  {
   "best": "best-prompt:w1-good-u1",
   "context": {
    "compactions": {
     "auto": 0,
     "manual": 0,
     "unknown": 0
    },
    "fresh": 1,
    "oversizedSessions": 1,
    "stale": 2
   },
   "cost": {
    "byDay": {
     "2026-09-21": 0.2618,
     "2026-09-22": 0.5456,
     "2026-09-23": 2.2149,
     "2026-09-24": 1.1974,
     "2026-09-25": 0.1524
    },
    "byModel": {
     "claude-opus-5": 4.2982,
     "claude-opus-5-5": 0.074
    },
    "byProject": {
     "my-app": 4.3722
    },
    "estimated": true,
    "fastUsd": 0.0,
    "inputUsd": 3.7002,
    "outputUsd": 0.672,
    "perPrompt": {
     "median": 0.2618,
     "p90": 0.5987
    },
    "rewarmEvents": 1,
    "rewarmUsd": 0.345,
    "unpriced": [],
    "usd": 4.3722
   },
   "coverage": {
    "firstLogAt": null,
    "partial": false
   },
   "end": 1790553600000,
   "evidence": {
    "best-prompt:w1-good-u1": {
     "at": 1790172000000,
     "detector": "best-prompt",
     "excerpt": "In src/components/Button.tsx, add a loading prop. Done when the Button tests pass.",
     "id": "best-prompt:w1-good-u1",
     "numbers": {
      "followUps": 0
     },
     "project": "my-app",
     "root": "/work/my-app",
     "session": "w1-good",
     "title": "In src/components/Button.tsx, add a loading prop. Done when\u2026",
     "usd": 0.074
    },
    "check-work:w1-vague-u1": {
     "at": 1790085600000,
     "detector": "check-work",
     "excerpt": "fix the login thing its broken again",
     "id": "check-work:w1-vague-u1",
     "numbers": {
      "files": 1
     },
     "project": "my-app",
     "root": "/work/my-app",
     "session": "w1-vague",
     "title": "fix the login thing its broken again",
     "usd": 0.1274
    },
    "fresh-start:w1-switch-u9": {
     "at": 1790160986000,
     "detector": "fresh-start",
     "excerpt": "now add a dark mode toggle to the settings page",
     "id": "fresh-start:w1-switch-u9",
     "numbers": {
      "contextK": 330,
      "promptsAfter": 3
     },
     "project": "my-app",
     "root": "/work/my-app",
     "session": "w1-switch",
     "title": "refactor the auth middleware in src/auth/middleware.ts",
     "usd": 1.155
    },
    "plan-big:w1-big2-u1": {
     "at": 1790262000000,
     "detector": "plan-big",
     "excerpt": "migrate the tables to the new design system",
     "id": "plan-big:w1-big2-u1",
     "numbers": {
      "files": 9
     },
     "project": "my-app",
     "root": "/work/my-app",
     "session": "w1-big2",
     "title": "migrate the tables to the new design system",
     "usd": 0.5987
    },
    "point-to-place:w1-vague-u1": {
     "at": 1790085600000,
     "detector": "point-to-place",
     "excerpt": "fix the login thing its broken again",
     "id": "point-to-place:w1-vague-u1",
     "numbers": {
      "steps": 7
     },
     "project": "my-app",
     "root": "/work/my-app",
     "session": "w1-vague",
     "title": "fix the login thing its broken again",
     "usd": null
    },
    "say-done:w1-corr-u1": {
     "at": 1790330400000,
     "detector": "say-done",
     "excerpt": "update the header",
     "id": "say-done:w1-corr-u1",
     "numbers": {
      "corrections": 2
     },
     "project": "my-app",
     "root": "/work/my-app",
     "session": "w1-corr",
     "title": "update the header",
     "usd": null
    }
   },
   "features": {},
   "firstAt": 1789984800000,
   "frozen": true,
   "habits": {
    "check-work": {
     "done": 2,
     "eligible": true,
     "evidence": [
      "check-work:w1-vague-u1"
     ],
     "impactUsd": 0.1594,
     "min": 5,
     "sample": 11,
     "target": 0.6,
     "total": 11,
     "value": 0.182
    },
    "fresh-start": {
     "done": 1,
     "eligible": true,
     "evidence": [
      "fresh-start:w1-switch-u9"
     ],
     "impactUsd": 1.505,
     "min": 3,
     "sample": 3,
     "target": 0.7,
     "total": 3,
     "value": 0.333
    },
    "plan-big": {
     "done": 0,
     "eligible": true,
     "evidence": [
      "plan-big:w1-big2-u1"
     ],
     "impactUsd": 0,
     "min": 2,
     "sample": 2,
     "target": 0.5,
     "total": 2,
     "value": 0.0
    },
    "point-to-place": {
     "done": 3,
     "eligible": true,
     "evidence": [
      "point-to-place:w1-vague-u1"
     ],
     "impactUsd": 0.6822,
     "min": 5,
     "sample": 9,
     "target": 0.5,
     "total": 9,
     "value": 0.333
    },
    "say-done": {
     "done": 1,
     "eligible": true,
     "evidence": [
      "say-done:w1-corr-u1"
     ],
     "impactUsd": 0.1524,
     "min": 5,
     "sample": 10,
     "target": 0.4,
     "total": 10,
     "value": 0.1
    }
   },
   "memory": {
    "discoveryEpisodes": 1,
    "discoverySteps": 3,
    "repeatedCorrections": 0,
    "wrongToolFirst": 1
   },
   "metricsVersion": 1,
   "notices": [],
   "prompts": {
    "bigPastes": 0,
    "images": 0,
    "medianWords": 8.0,
    "namesPlace": 3,
    "opening": 10,
    "saysDone": 1,
    "vague": 0
   },
   "repeats": {
    "clusters": 1,
    "prompts": 1
   },
   "safety": {
    "bypassSessions": 0
   },
   "sessionIds": [
    "w1-big",
    "w1-big2",
    "w1-corr",
    "w1-disc",
    "w1-good",
    "w1-notes",
    "w1-switch",
    "w1-vague"
   ],
   "start": 1789948800000,
   "tips": [
    {
     "category": "cost",
     "conflicts": [],
     "count": 0,
     "evidence": [],
     "family": "tip",
     "id": "newer-model",
     "impactUsd": 2.0168,
     "level": 1,
     "numbers": {
      "model": "claude-opus-5",
      "newer": "claude-opus-5-5",
      "share": 0.983,
      "usd": 4.3
     },
     "score": 0.4034
    }
   ],
   "together": {
    "apiErrors": 0,
    "classifierBlocks": 0,
    "corrections": 3,
    "endedBadly": 0,
    "interrupts": 0,
    "rejections": 0
   },
   "usage": {
    "cacheHitRate": 0.9789,
    "callsPerPrompt": 3.0,
    "contextPerCall": {
     "median": 53000.0,
     "p90": 330000.0
    },
    "effortShare": {},
    "families": [
     "opus"
    ]
   },
   "versionsSeen": [
    "2.1.293"
   ],
   "volume": {
    "activeDays": 5,
    "commands": 0,
    "prompts": 15,
    "sessions": 8
   },
   "week": "2026-09-21",
   "work": {
    "bigChanges": 2,
    "bigChangesPlanned": 0,
    "checked": 2,
    "codePrompts": 11,
    "commits": 0
   }
  },
  {
   "best": "best-prompt:w2-good-u1",
   "context": {
    "compactions": {
     "auto": 0,
     "manual": 0,
     "unknown": 0
    },
    "fresh": 1,
    "oversizedSessions": 1,
    "stale": 2
   },
   "cost": {
    "byDay": {
     "2026-09-28": 0.2618,
     "2026-09-29": 0.5051,
     "2026-09-30": 2.3319,
     "2026-10-01": 1.1974,
     "2026-10-02": 1.8445
    },
    "byModel": {
     "claude-opus-5": 6.0668,
     "claude-opus-5-5": 0.074
    },
    "byProject": {
     "my-app": 6.1408
    },
    "estimated": true,
    "fastUsd": 0.0,
    "inputUsd": 5.3888,
    "outputUsd": 0.752,
    "perPrompt": {
     "median": 0.2524,
     "p90": 0.8887
    },
    "rewarmEvents": 2,
    "rewarmUsd": 1.5525,
    "unpriced": [],
    "usd": 6.1408
   },
   "coverage": {
    "firstLogAt": null,
    "partial": false
   },
   "end": 1791158400000,
   "evidence": {
    "best-prompt:w2-good-u1": {
     "at": 1790776800000,
     "detector": "best-prompt",
     "excerpt": "In src/components/Button.tsx, add a loading prop. Done when the Button tests pass.",
     "id": "best-prompt:w2-good-u1",
     "numbers": {
      "followUps": 0
     },
     "project": "my-app",
     "root": "/work/my-app",
     "session": "w2-good",
     "title": "In src/components/Button.tsx, add a loading prop. Done when\u2026",
     "usd": 0.074
    },
    "check-work:w2-vague-u1": {
     "at": 1790690400000,
     "detector": "check-work",
     "excerpt": "fix the login thing its broken again",
     "id": "check-work:w2-vague-u1",
     "numbers": {
      "files": 1
     },
     "project": "my-app",
     "root": "/work/my-app",
     "session": "w2-vague",
     "title": "fix the login thing its broken again",
     "usd": 0.1274
    },
    "fresh-start:w2-switch-u9": {
     "at": 1790765786000,
     "detector": "fresh-start",
     "excerpt": "now add a dark mode toggle to the settings page",
     "id": "fresh-start:w2-switch-u9",
     "numbers": {
      "contextK": 330,
      "promptsAfter": 3
     },
     "project": "my-app",
     "root": "/work/my-app",
     "session": "w2-switch",
     "title": "refactor the auth middleware in src/auth/middleware.ts",
     "usd": 1.155
    },
    "plan-big:w2-big2-u1": {
     "at": 1790866800000,
     "detector": "plan-big",
     "excerpt": "migrate the tables to the new design system",
     "id": "plan-big:w2-big2-u1",
     "numbers": {
      "files": 9
     },
     "project": "my-app",
     "root": "/work/my-app",
     "session": "w2-big2",
     "title": "migrate the tables to the new design system",
     "usd": 0.5987
    },
    "point-to-place:w2-vague-u1": {
     "at": 1790690400000,
     "detector": "point-to-place",
     "excerpt": "fix the login thing its broken again",
     "id": "point-to-place:w2-vague-u1",
     "numbers": {
      "steps": 7
     },
     "project": "my-app",
     "root": "/work/my-app",
     "session": "w2-vague",
     "title": "fix the login thing its broken again",
     "usd": null
    },
    "say-done:w2-corr-u1": {
     "at": 1790935200000,
     "detector": "say-done",
     "excerpt": "update the header",
     "id": "say-done:w2-corr-u1",
     "numbers": {
      "corrections": 2
     },
     "project": "my-app",
     "root": "/work/my-app",
     "session": "w2-corr",
     "title": "update the header",
     "usd": null
    }
   },
   "features": {
    "ask-checks": 1,
    "plan-mode": 1
   },
   "firstAt": 1790589600000,
   "frozen": true,
   "habits": {
    "check-work": {
     "done": 2,
     "eligible": true,
     "evidence": [
      "check-work:w2-vague-u1"
     ],
     "impactUsd": 0.1594,
     "min": 5,
     "sample": 13,
     "target": 0.6,
     "total": 13,
     "value": 0.154
    },
    "fresh-start": {
     "done": 1,
     "eligible": true,
     "evidence": [
      "fresh-start:w2-switch-u9"
     ],
     "impactUsd": 1.505,
     "min": 3,
     "sample": 3,
     "target": 0.7,
     "total": 3,
     "value": 0.333
    },
    "plan-big": {
     "done": 1,
     "eligible": false,
     "evidence": [
      "plan-big:w2-big2-u1"
     ],
     "impactUsd": 0,
     "min": 2,
     "sample": 2,
     "target": 0.5,
     "total": 2,
     "value": 0.5
    },
    "point-to-place": {
     "done": 3,
     "eligible": true,
     "evidence": [
      "point-to-place:w2-vague-u1"
     ],
     "impactUsd": 0.6822,
     "min": 5,
     "sample": 10,
     "target": 0.5,
     "total": 10,
     "value": 0.3
    },
    "say-done": {
     "done": 1,
     "eligible": true,
     "evidence": [
      "say-done:w2-corr-u1"
     ],
     "impactUsd": 0.1524,
     "min": 5,
     "sample": 12,
     "target": 0.4,
     "total": 12,
     "value": 0.083
    }
   },
   "memory": {
    "discoveryEpisodes": 1,
    "discoverySteps": 3,
    "repeatedCorrections": 0,
    "wrongToolFirst": 1
   },
   "metricsVersion": 1,
   "notices": [
    {
     "id": "bypass",
     "n": 1
    }
   ],
   "prompts": {
    "bigPastes": 0,
    "images": 0,
    "medianWords": 8.0,
    "namesPlace": 3,
    "opening": 12,
    "saysDone": 1,
    "vague": 0
   },
   "repeats": {
    "clusters": 1,
    "prompts": 2
   },
   "safety": {
    "bypassSessions": 1
   },
   "sessionIds": [
    "w2-big",
    "w2-big2",
    "w2-bypass",
    "w2-corr",
    "w2-disc",
    "w2-good",
    "w2-notes",
    "w2-notes-b",
    "w2-switch",
    "w2-vague"
   ],
   "start": 1790553600000,
   "tips": [
    {
     "category": "cost",
     "conflicts": [],
     "count": 0,
     "evidence": [],
     "family": "tip",
     "id": "newer-model",
     "impactUsd": 2.5079,
     "level": 1,
     "numbers": {
      "model": "claude-opus-5",
      "newer": "claude-opus-5-5",
      "share": 0.988,
      "usd": 6.07
     },
     "score": 0.5016
    },
    {
     "category": "safety",
     "conflicts": [],
     "count": 1,
     "evidence": [],
     "family": "tip",
     "id": "bypass-to-auto",
     "impactUsd": null,
     "level": 1,
     "numbers": {
      "sessions": 1
     },
     "score": 0.5
    }
   ],
   "together": {
    "apiErrors": 0,
    "classifierBlocks": 0,
    "corrections": 3,
    "endedBadly": 0,
    "interrupts": 0,
    "rejections": 0
   },
   "usage": {
    "cacheHitRate": 0.9505,
    "callsPerPrompt": 2.5,
    "contextPerCall": {
     "median": 56000.0,
     "p90": 320000.0
    },
    "effortShare": {},
    "families": [
     "opus"
    ]
   },
   "versionsSeen": [
    "2.1.293"
   ],
   "volume": {
    "activeDays": 5,
    "commands": 0,
    "prompts": 18,
    "sessions": 10
   },
   "week": "2026-09-28",
   "work": {
    "bigChanges": 2,
    "bigChangesPlanned": 1,
    "checked": 2,
    "codePrompts": 13,
    "commits": 0
   }
  }
 ]
}

export const REPORT = raw as unknown as Report
