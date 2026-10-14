# OPRA ingestion report (2026-09-15, catalog data v4)

Machine-readable companion: `opra-ingestion-report.json` (repo root).
Per-record review notes: `scripts/catalog/opra-snapshot/ingestion-review.json`.
Frozen source snapshot: `scripts/catalog/opra-snapshot/` (`manifest.json`).

## Source re-audit (Phase 1)

Re-verified live on 2026-09-15 (previous audit 2026-09-14):

- **Repository**: `https://github.com/opra-project/OPRA`, main @
  `0b88ecd4e2bef7cf69fd5b50f1d06fb586c10865` (2026-07-01).
- **LICENSE.md**: `Dataset:`-headed CC BY-SA 4.0 full text + `Code:` MIT —
  posture **unchanged**.
- **README licensing FAQ**: code MIT; manufacturer/product/EQ data
  CC BY-SA 4.0; two-level attribution (browser: OPRA logo + description +
  repository link; preset: creator prominent + OPRA link).
- **THIRD_PARTY_LICENSES.md**: AutoEq MIT 2018–2022 — matches the
  documented upstream caveat.
- **Schema** (`schemas/eq_info.json`): `author`/`details`/`link`,
  `type: parametric_eq` only, 7 band types, truncate-if-limited guidance.
- **Legal watch**: `opra-poc.test.ts` pins `manifest.licenseId`,
  registry status, and record counts — if OPRA terms change, ingestion
  **fails the test run** until the registry + docs are deliberately updated.

## What was inspected

| Scope | Count |
|---|---|
| Snapshot lines | 19,538 |
| Vendors | 714 |
| Products | 6,230 |
| EQ records | 12,594 |

## What was imported

- **6,208 devices** (product identity: manufacturer + model + type facts
  only — no blurbs, logos, or artwork).
- **11,288 EQ presets** (parametric EQ + preamp, full creator chains).
- **22 OPRA products merged into 18 seed devices** — presets attached,
  canonical seed metadata untouched (merge references, not ownership).
- **Measurements bundled: 0.** OPRA hosts presets, not raw curves;
  measurement identity survives only as display-text credit.
- **Targets bundled: 0.** Target identity (e.g. Harman Target) survives
  only as display text. No numeric target files.
- **Images/artwork bundled: 0.**
- Full catalog after merge: **6,229 devices / 11,289 presets**
  (21 seed devices + 1 tutorial preset + generated layer).

## What was rejected

- **1,301 Rtings-linked records** (`author` or `details`) — excluded under
  the restrictive-upstream posture, with no data retained.
- **5 malformed presets** (non-finite `gain_db`), each recorded with
  source identity + field + rule:
  - `64_audio:n8::oratory1990_harman_target` (band 9)
  - `fostex:t_x0::oratory1990_harman_target` (band 9)
  - `sennheiser:momentum_true_wireless::oratory1990_harman_target` (band 6)
  - `tin_hifi:p1::oratory1990_usound_target` (band 7)
  - `tin_hifi:p1::oratory1990_harman_target` (band 5)
- **0 unknown subtypes, 0 dangling EQ, 0 malformed lines.**

## Duplicates kept separate (107)

- **56 device + 50 preset** upstream duplicate-directory cases, each kept
  under a suffixed id (`…-2`) with a review note — never merged, never
  dropped.
- **1 seed naming overlap**: OPRA `apple::airpods_pro_2` ("AirPods Pro 2")
  vs hand-reviewed seed `apple-airpods-pro-2` ("AirPods Pro (2nd
  generation)"). Exact-identity merge did not apply, so the OPRA device
  ships as `apple-airpods-pro-2-2` with its 18 presets; the seed record is
  byte-untouched. Flagged for maintainer review (merge vs alias is a
  deliberate follow-up, not an ingestion guess).

## Manual review (6 notes, all imported with notes)

- 3 presets with >12 bands (kept whole; the editor truncates per OPRA
  schema guidance).
- 2 presets with out-of-range band values (kept as-is; the engine
  clamps — never silently repaired).
- 1 seed-id collision (above).

## Category mapping (explicit, deterministic)

| OPRA subtype | App category |
|---|---|
| `in_ear` | `iem` (3,927) |
| `earbuds` | `earbuds` (124) |
| `true_wireless` | `tws` (none observed in this snapshot) |
| `over_the_ear` / `on_ear` | `headphones` — generic bucket (2,157), never a guessed open/closed split |

Openness is not in OPRA product records, so over/on-ear map to the
generic `headphones` bucket rather than a guessed split. Unknown subtypes
reject the device (0 in this snapshot).

## Provenance, attribution, ShareAlike

- Every preset: `EQ by {author} via OPRA ({details})` + verifiable OPRA
  directory URL + `CC BY-SA 4.0` + `shareAlike: true`.
- The `OPRA → contributor → measurement/preset origin` chain is never
  collapsed into a generic label.
- `src/catalog/generated.ts` carries the CC BY-SA data-license header;
  **application code stays MIT** (code/data split stated in the header and
  in Devices → Sources & licenses).
- User copies ("Import EQ") carry the attribution + license + original
  preset id into the user library and are then independently editable;
  canonical records are never mutated.

## Update procedure (future refreshes)

1. Fetch a new snapshot; record revision/date/sha256 in `manifest.json`.
2. Re-verify LICENSE/README/THIRD_PARTY_LICENSES/schemas; on any change,
   update the registry + docs first (legal watch fails until you do).
3. Run ingestion; read the full review (`rejected`/`needsReview`).
4. Diff the generated output; inspect new rejections.
5. Verify attribution + ShareAlike header intact.
6. Bump `CATALOG_DATA_VERSION`; update this report + `device-catalog.md`.
7. Run typecheck, lint, unit tests, build, and the device E2E suite.

Production data never follows a live source automatically: snapshot →
ingestion → review → generated output, always.
