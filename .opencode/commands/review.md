---
description: Code review for quality, security, perf, and architecture fit
---

Review the changes in scope: $ARGUMENTS

Cover: correctness, architecture fit (see AGENTS.md), local-first and GitHub Pages constraints, security (untrusted files/metadata), performance (main thread, large libraries), license safety of any new dependency. List findings as BLOCKER / SHOULD-FIX / NIT with file:line. Do not rewrite architecture without evidence.
