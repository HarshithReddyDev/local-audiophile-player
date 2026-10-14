# AGENTS.md — Local-First Browser Music Player

## Project purpose

High-quality, local-first, browser-based music player optimized for audiophile/IEM use.
Parametric EQ, IEM/headphone profiles, client-side AutoEQ/PEQ generation, measurement import,
target curves, advanced visualizations, PWA/offline, large local libraries, high desktop fidelity,
good mobile-browser performance.

## Tech stack (unless research proves better)

- React + TypeScript + Vite, static build, GitHub Pages.
- Web Audio API; AudioWorklet only when measured need justifies it.
- Vitest for unit/numerical tests; Playwright for browser tests.
- TypeScript strict; Biome formatter; Oxlint lint LSP; TypeScript LSP.
- Package manager: pnpm preferred (npm works). Runtime: Node 24 LTS + Bun (MCP runner).

## Architectural principles

1. No required backend.
2. User music files stay local. Never upload user music by default.
3. Never claim "bit-perfect" without proof.
4. Prefer the simplest architecture that satisfies requirements.
5. Do not rewrite working architecture without evidence.
6. Research existing open-source implementations before reinventing components (2-3 approaches, then decide).
7. Static-first: everything must work from a static host under a repo subpath.

## Audio / DSP rules

- Validate DSP mathematically. Never accept DSP because it "sounds right."
- DSP workflow: propose (formulas + refs) → dsp-verifier checks math → implement (pure functions) → Vitest numerical tests → frequency-response regression → browser verification → perf check where needed.
- Filter stability mandatory (pole radius < 1); sample-rate aware (44.1/48/96 kHz); guard DC/Nyquist/extreme Q/gain, NaN/Inf/denormals.
- Test EQ frequency response numerically (magnitude/phase vs recomputed expected, with tolerances).
- Keep real-time audio processing off the main UI thread where necessary. Never block the audio rendering thread.
- Do not introduce WASM merely for complexity points. No Rust/WASM/SharedArrayBuffer/SQLite/OPFS/AudioWorklet/WebCodecs unless: problem stated, simpler native alternative rejected with reasons, browser support sufficient, GitHub Pages compatible, UX/fidelity gain justifies complexity.

## Local-first rules

- Never upload user music by default. Treat local files, metadata, lyrics, covers, measurement imports as untrusted input (XSS/malformed-file hardening).
- Persist locally (IndexedDB/OPFS/localStorage) only where justified; document what is stored and why.
- Do not decode an entire 10,000-track library into RAM. Virtualize lists, index incrementally, stream/decode on demand.

## GitHub Pages constraints

- Static build; correct `base` for repo subpath; client-side routing must work under subpath.
- Relative/worker-safe paths for: JS/CSS assets, Web Workers, AudioWorklet modules, WASM, service worker, PWA manifest + icons.
- GitHub Actions deployment; verify preview build under base path, not just dev root.
- Verification checks must cover base path, worker paths, manifest paths, and caching before release.

## Testing requirements

- Vitest for logic/DSP (numerical assertions with tolerances, regression fixtures).
- Playwright for browser flows: startup, base path, PWA loading, file/directory selection, player/EQ/queue/playlist controls, visualizations, responsive layouts, keyboard/a11y, error states. Prefer real browser behavior over mocks.
- Browser compatibility must be evidence-based (MDN/spec + real test, not assumptions).
- Capability detection for browser-dependent features (File System Access API, etc.).

## Security requirements

- XSS hardening for metadata-driven UI; CSP where applicable; safe WASM loading; least-privilege filesystem permissions.
- Dependency vulnerabilities + supply-chain review on new deps.
- No network call may carry user audio bytes or file paths without explicit user consent.

## License rules

- Prefer permissive licenses (MIT/Apache-2.0/BSD/ISC).
- Do not use GPL/AGPL code without deliberate license review.
- Do not bundle measurement data without license verification. Prefer user import + linking over bundling.
- Record decisions: package/data, version, license, use, risk.

## Agent responsibilities

- Primary (build): owns architecture, task decomposition, final decisions, integration.
- repo-researcher (read-only): GitHub comparisons, reusable implementations, licensing investigation.
- audio-engine-engineer: playback engine, decoding, graph, gapless/queue/crossfade.
- dsp-eq-engineer: PEQ/AutoEQ math + implementation (after verifier sign-off).
- iem-researcher (read-only): measurements, targets, AutoEQ datasets, tuning methods.
- frontend-engineer: React/TS UI, responsive + a11y, base-path-safe routing.
- browser-compat-engineer (read-first): compat matrix, fallbacks, capability detection.
- qa-engineer: tests + Playwright; may write tests, may not rewrite architecture unilaterally.
- dsp-verifier (read-only): independent math check; PASS/FAIL with recomputed values.
- performance-engineer (measure-first): CPU/mem/threads, large-library + mobile perf.
- license-auditor (read-only): license table + risks.
- security-reviewer (read-only): findings with severity + fix.

Specialists must not spawn sub-subagents (`task: deny`); the primary orchestrates.
Read-only agents never modify code unless explicitly requested.

## Coding standards

- TypeScript strict, no implicit any in new code; pure testable DSP core (no DOM/audio globals).
- Biome formatting (run before commit); Oxlint-clean; `tsc --noEmit` clean.
- Small focused modules; explicit error paths; no dead advanced-tech scaffolding.
- Comments explain why, not chain-of-thought; cite DSP formulas to references.

## Verification rules

- Do not invent browser APIs. Verify support before relying on an API.
- Research flow: inspect code → official docs (context7) → 2-3 implementations → licenses → simplest robust choice → implement → test → specialized review → document decision.
- New dependency flow: GitHub source, activity, license, issues, compat, bundle size, maintenance, deps, smaller alternative, recorded decision.
- Use `opencode.json` + `.opencode/agents/` + `.opencode/commands/` as configured; keep MCP set small (context7 docs, playwright for browser tasks only).
- Model: `opencode/muse-spark-1.3-contributor-free` everywhere until another model is verified; do not invent model IDs.

## Commands

- `/research`, `/research-repo`, `/research-dsp`, `/research-browser`, `/review`, `/verify-dsp`, `/test`, `/test-browser`, `/audit-license`, `/performance`, `/architecture-review` — each narrowly scoped (see `.opencode/commands/`).

## External file loading

When you see `@path/to/file` in instructions or tasks, use the Read tool to load it on a need-to-know basis for the current task. Treat loaded content as mandatory when it applies. Useful refs: `@docs/development-environment.md`, `@docs/agent-workflow.md`.
