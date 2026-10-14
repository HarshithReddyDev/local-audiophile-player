# Development environment

Verified 2026-09-11. OpenCode 1.18.30 (Desktop + CLI), docs read at `https://opencode.ai/docs` (Sep 10 2026 rev).
Config syntax below matches that rev: `mcp[type/command/url]`, `permission` wildcards, markdown agents/commands, `lsp`/`formatter` blocks.

## Runtimes (user-local, no sudo needed)

| Tool | Version | Location | Notes |
|---|---|---|---|
| Node | v24.21.0 (LTS Krypton) | `~/.local/node`, linked in `~/.local/bin` | Tarball from nodejs.org; PATH added in `~/.bashrc` |
| npm | 11.19.0 | with Node | — |
| pnpm | 12.4.1 | via corepack | Preferred for Vite/React installs |
| yarn | 1.22.22 | via corepack | Available, not preferred |
| Bun | 1.4.2 | `~/.bun/bin` (official install script) | MCP runner (`bunx`), fast scripts |
| Python | 3.14.7 | system | No pip (not needed for this stack) |
| Git | 2.55.0 | system | — |
| Chrome | 153.0.8010.36 | system | Real-browser fallback |
| Playwright browsers | chromium headless shell 153 + ffmpeg | `~/.cache/ms-playwright` | `npx playwright install chromium` done; launch verified |
| OpenCode CLI | 1.18.30 | `~/.local/node/bin/opencode` | Pinned to match Desktop; `npm i -g opencode-ai@1.18.30` |
| Rust/Cargo | NOT installed | — | Intentionally deferred (no Rust in architecture yet) |

## OpenCode configs (precedence respected)

- Global `~/.config/opencode/opencode.jsonc`: UNTOUCHED (still just `$schema`). Only pre-existing global is `@opencode-ai/plugin@1.18.30`.
- Project `./opencode.json`: model, MCPs, `lsp:true`, `formatter:{biome}`, `permission` gates, per-agent playwright allow. Validated with `opencode debug config`.
- Agents: `.opencode/agents/*.md` (11 subagents). Commands: `.opencode/commands/*.md` (11). Both discovered by `opencode debug config`.
- Project rules: `AGENTS.md`. Collaboration: `docs/agent-workflow.md`.

## MCPs (minimal stack — 2 only)

| MCP | Type | Config | Why |
|---|---|---|---|
| `context7` | remote `https://mcp.context7.com/mcp` | no key needed; optional `CONTEXT7_API_KEY` raises limits (free account at context7.com/dashboard) | ESSENTIAL: React/TS/Vite/Web Audio/PWA docs. Status `connected`. |
| `playwright` | local `bunx @playwright/mcp@0.0.80` (pinned) | no key; needs browsers (chromium installed) | HIGH-VALUE, gated: tools denied globally (`permission.playwright_*: deny`), allowed only for `qa-engineer`, `browser-compat-engineer`, `frontend-engineer`. Status `connected`. |

Context guidance: keep the set small. Playwright exposes ~30 tools — the global deny + per-agent allow is what keeps everyday sessions cheap.

## LSP / formatters

- `lsp: true` — built-ins activate on demand. For this stack that means `typescript` (needs `typescript` dep in the app) and `oxlint` (needs `oxlint` dep). Verified: `typescript-language-server@6.0.0` runs, `oxlint@1.82.0 --lsp` exists, `tsc --noEmit` clean on a strict sample.
- `formatter: {biome:{}}` — main formatter is Biome (`@biomejs/biome@2.5.13` verified, `biome check --write` works). One formatter + one lint (Oxlint) only; ESLint/Prettier deliberately not installed to avoid overlap. Add `biome.json` when the app is scaffolded.

## Agents, permissions, models

- Primary `build` owns architecture/integration. 11 subagents, all `task:* deny` (only primary orchestrates).
- Read-only: `repo-researcher`, `iem-researcher`, `dsp-verifier`, `license-auditor`, `security-reviewer` (`edit:deny`, `bash:deny`).
- Read-first/write-on-assignment: `browser-compat-engineer` (`edit:ask`), `performance-engineer` (`edit:ask`).
- Implementers: `audio-engine-engineer`, `dsp-eq-engineer`, `frontend-engineer`, `qa-engineer` (`edit/bash:allow`, playwright allowed where needed).
- Model everywhere: `opencode/muse-spark-1.3-contributor-free` (verified via `opencode models`). No other model IDs are hardcoded; per-agent override is supported but unused until verified.

## Tool decision table

| TOOL | TYPE | INSTALL? | REASON | COST | RISK | PROJECT USE |
|---|---|---|---|---|---|---|
| Node 24 LTS + npm/pnpm/yarn | runtime | YES (done) | Vite/TS/Vitest/Playwright all need it | ~200 MB disk | low | everything JS |
| Bun 1.4.2 | runtime | YES (done) | Fast MCP runner + scripts | ~100 MB | low | `bunx` MCP, scripts |
| OpenCode CLI 1.18.30 | tool | YES (done) | Config/MCP/agent verification | small | low | `debug config`, `mcp list` |
| context7 remote MCP | docs | YES (configured) | Up-to-date library docs | ~2 tools context | low; free tier, optional key | `/research`, implementation |
| Playwright MCP 0.0.80 + chromium | browser | YES (configured) | Real UI/regression testing | ~30 tools (gated), ~400 MB browsers, RAM per run | medium CPU/RAM | `/test-browser`, QA only |
| TypeScript LSP + tsc | LSP/check | YES (native) | Types, diagnostics | per-file | low | all TS work |
| Oxlint | lint LSP | YES on scaffold | Fast Rust lint, zero-config | low | low | `oxlint` gate |
| Biome | formatter | YES on scaffold | Fast single formatter | low | low | format gate |
| GitHub MCP | code/PR | NO (deferred) | Token-heavy; unneeded until repo ops | HIGH context | PAT handling | Revisit if agent must drive PRs/Actions; use toolset-limited config then |
| grep.app MCP | code search | NO | Endpoint flaky in 2026, duplicates native websearch | context | unreliable | Use native websearch instead |
| ast-grep MCP | structural search | NO | Native grep/glob + LSP suffice; CLI `sg` if ever needed | process | experimental server | Skip |
| oh-my-openagent (ex oh-my-opencode) 4.19.4 | harness | NO | SUL-1.0 (non-OSI), ~11k token overhead, telemetry on, duplicates native agents/MCPs | HIGH context | license + conflicts | Avoid; cherry-pick ideas only |
| Extra plugins | plugins | NO | Only global `@opencode-ai/plugin` kept | context | compat | None needed |
| ESLint/Prettier | lint/format | NO | Overlaps Oxlint/Biome | dep + config | conflicting rules | Only if scaffold already has their configs |
| Rust/WASM/Worklet/WebCodecs/SQLite/OPFS | adv tech | NO | No measured need yet | complexity + compat | high | Adopt only with evidence per AGENTS.md |

## Auth (env vars, never hardcoded)

- None required today. Optional: `CONTEXT7_API_KEY` (higher docs limits). Deferred (only if GitHub MCP adopted): `GITHUB_PERSONAL_ACCESS_TOKEN`.
- `.env*` reads stay denied by default; secrets go in env/file refs (`{env:VAR}`, `{file:~/.secrets/...}`), never in `opencode.json`.

## How to verify again

From the project dir (PATH must include `~/.local/node/bin`, `~/.bun/bin`, `~/.local/bin`):

```bash
opencode debug config | head -30   # valid JSON, 11 agents, 2 MCPs, 11 commands
opencode mcp list                  # context7 + playwright connected
opencode agent list                # build + subagents
opencode debug skill               # built-in skills
node --version && bun --version && pnpm --version
npx tsc --noEmit && npx oxlint && npx biome check .   # inside app, once scaffolded
npx vitest run                     # unit/numerical
npx playwright test                # browser (chromium installed)
```

Toolchain proof (2026-09-11, scratch `/tmp/opencode-verify`, kept out of the project):
`tsc@5.8.2` strict OK, `oxlint@1.82.0` 0 warnings, `biome@2.5.13` formats,
`vitest@5` passes incl. biquad unity-DC-gain + pole-stability checks, Playwright chromium launch OK.

## Troubleshooting

- `Missing key lsp.<name>.command` → don't use empty `{}` LSP entries; use `"lsp": true` (built-ins) or give an explicit `command`.
- `tools` key warnings → deprecated; use `permission` wildcards (`"playwright_*": "deny"` globally, `"allow"` per agent).
- MCP `connecting...` > 15s → `timeout` is 15s; check network, `bunx` availability, `opencode mcp list` again.
- Playwright can't find browser → `npx playwright install chromium`; system Chrome 153 also present as fallback.
- `opencode: command not found` → `export PATH="$HOME/.local/node/bin:$HOME/.bun/bin:$HOME/.local/bin:$PATH"` (also persisted in `~/.bashrc`).
- Config edits need restart — OpenCode loads config once at startup.
- Desktop vs CLI drift → both pinned 1.18.30; re-run `npm i -g opencode-ai@1.18.30` after Desktop updates.

## Collaboration

See `docs/agent-workflow.md` (primary/subagent split, research → implement → verify flows, mandatory DSP gate, browser-testing and dependency flows). Project constitution: `AGENTS.md`.
