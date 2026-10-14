# Agent workflow

Primary agent: `build` (architect/implementer). Owns architecture, decomposition, final decisions, integration.

Subagents (`.opencode/agents/`): `repo-researcher`, `audio-engine-engineer`, `dsp-eq-engineer`,
`iem-researcher`, `frontend-engineer`, `browser-compat-engineer`, `qa-engineer`, `dsp-verifier`,
`performance-engineer`, `license-auditor`, `security-reviewer`.
`task: deny` on all specialists — only the primary orchestrates. Read-only agents never edit unless asked.

## Standard research flow (any unfamiliar problem)

1. Inspect existing code (`@` the files).
2. Official docs via context7 (resolve-library-id → query-docs).
3. 2-3 open-source implementations (via `repo-researcher` / `/research-repo`).
4. Licenses (`license-auditor` / `/audit-license` when reuse/bundling is on the table).
5. Simplest robust choice → implement → test → specialized review → record decision.

## Implementation flow

1. Primary decomposes; assigns at most one owner per file/area.
2. Owner implements per AGENTS.md coding standards (strict TS, pure DSP core, Biome-clean).
3. `tsc --noEmit`, oxlint, Biome check, Vitest focused then full.
4. `/review` for quality/security/perf/architecture fit.
5. Browser-affected changes: `/test-browser` via `qa-engineer` + playwright (real behavior, base-path aware).

## DSP verification flow (mandatory)

1. `dsp-eq-engineer` proposes algorithm with formulas + references (`/research-dsp`).
2. `dsp-verifier` independently recomputes and returns PASS/FAIL (`/verify-dsp`, subtask).
3. Implement pure functions only; Vitest numerical tests (coefficients, magnitude/phase vs expected, tolerances).
4. Frequency-response regression fixtures; edge cases (DC/Nyquist/extreme Q/gain, 44.1/48/96 kHz).
5. Browser graph check + perf check where needed. Never approve on listening impressions alone.

## Browser testing flow

- `qa-engineer` owns specs; `browser-compat-engineer` owns the support matrix + fallbacks.
- Matrix first (MDN/spec sources), capability detection in code, Playwright proof in CI/local.
- Cover: startup, base path, PWA, file/dir pickers, transport, EQ, queue/playlists, visualizations, responsive, keyboard/a11y, error states.

## Dependency flow

GitHub source → activity → license → issues → compat → bundle size → maintenance → deps →
smaller alternative → recorded decision (`/research-repo` + `/audit-license`). No copy-paste without clearance.

## Review flow

`/architecture-review` for proposals; `/review` for diffs; `security-reviewer` for untrusted-input surface;
`performance-engineer` for measured before/after. Findings use BLOCKER / SHOULD-FIX / NIT with file:line.

## Model routing

All agents use `opencode/muse-spark-1.3-contributor-free` (the only verified model here).
Per-agent `model` overrides are supported by OpenCode but unused until another model ID is verified via `opencode models`. Do not invent model IDs.
