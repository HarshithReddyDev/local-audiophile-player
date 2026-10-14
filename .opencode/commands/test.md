---
description: Run unit and integration tests with failure focus
---

Run the relevant test suite for: $ARGUMENTS

Prefer focused runs first (changed package/spec), then the full suite. Commands (from AGENTS.md):
!`npm run test -- --run 2>&1 | tail -40`

Report failures with file:line, expected vs actual, and suggested fix. For DSP, include numerical deltas and frequency-response regressions.
