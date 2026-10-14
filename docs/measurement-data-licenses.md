# Measurement data licenses (HIGH PRIORITY, verified 2026-09-12)

Rule: a repository's **code license never licenses its data**. Every source
below was checked individually. Verdict: **bundle zero third-party curves.**

| Source | Data | License | Redistribution | Attribution | Bundle? | Notes |
|---|---|---|---|---|---|---|
| jaakkopasanen/AutoEq (code) | MIT build scripts | MIT | yes (code) | yes | n/a (code only) | Format reference only |
| AutoEq `measurements/` (oratory1990, crinacle, Rtings, InnerFidelity, legacy headphone.com) | per-source terms, no blanket grant | **unclear/mixed** | no evidence | required | **NO** | Contributors' data inherits origin terms |
| AutoEq `targets/` (Harman, diffuse-field, …) | research/standard data | **unclear** | no evidence | required | **NO** | Harman data © Harman research; ISO 11904 is a copyrighted standard |
| Harman in-ear target (Olive et al.) | research data | proprietary research | no grant found | required | **NO** | Link users to published papers/tools instead |
| JM-1 / PopAvg-DF (Listener, Headphones.com) | community target | **unreleased/partial** | "still working out if we're going to make all of that public" (2026-06 forum); canal TF explicitly not for release | required | **NO** | Reference the EQ Playground / squig.link Delta project by link |
| Crinacle IEF 2025 / 711 Delta | community target | no explicit data license | no evidence | required | **NO** | Lives on Hangout.Audio graph tool; link only |
| Squiglink community DBs (sl0the et al.) | per-operator exports | per-site terms | varies | required | **NO** | Users export CSV themselves and import here |
| Rtings measurements | Rtings terms of use | restricted | no | required | **NO** | Import path only |
| oratory1990 (reddit wiki) presets | measurement PDFs/CSVs | personal-use framing | no evidence | required | **NO** | Import path only |
| User's own rig files | user-owned | user | yes | n/a | n/a (local) | Primary supported path |
| Built-in Flat (0 dB) | ours (constant) | MIT (this repo) | yes | n/a | **YES** | No data involved |
| Parametric builder output | generated math | MIT (this repo) | yes | n/a | **YES** (as code, not data) | Bass/tilt/offset synthesis |

## Consequences for the app

- `src/iem/builtin-targets.ts` contains only the flat reference. Every other
  curve enters through user import (file stays local) or the parametric
  builder (pure math). The UI links outward for sources; nothing phones home.
- If a target's status changes (explicit CC0/MIT data grant), record it in
  this table with origin URL + grant evidence before bundling.
