# Device catalog & preset library

## What is bundled (data v4)

6,229 device entries + 11,289 presets (`src/catalog/seed.ts` schema v1 +
`src/catalog/generated.ts` OPRA bulk layer; data v4 — the UI reports
"catalog data version 4"). Full report: `docs/opra-ingestion-report.md`
(human) + `opra-ingestion-report.json` (machine):

- **21 devices, metadata only**: make/model/type facts plus outbound
  manufacturer links. No measurement data — bundled, sampled, or
  transcribed. `redistribution` is `"metadata-only"`.
- **1 tutorial preset**, authored in-repo from no measurement at all,
  labeled as an editing starting point (`origin: "tutorial"`,
  `deviceId: null`, MIT). It is not a device correction.
- **6,208 OPRA devices** (product identity facts only — no blurbs,
  logos, or artwork) **+ 11,288 OPRA EQ presets** (creators, measurers,
  and targets credited per record): CC BY-SA 4.0 adapted material — see
  `docs/catalog-data-licenses.md` §1/§4. No OPRA measurements exist to
  bundle (OPRA hosts presets, not raw curves); no blurbs, logos, or
  artwork taken. 22 OPRA products merged into 18 seed devices as
  additional presets; seed metadata untouched.
- **0 external measurement links verified**: `measurementRefs` exists in
  the schema and UI, but no per-device link passed verification, so
  records carry none rather than plausible-looking guesses.

By category (OPRA layer): iem 3,927, headphones (type unspecified)
2,157, earbuds 124 — plus the 21 hand-reviewed seed devices across the
full taxonomy. 712 OPRA manufacturers + 9 seed manufacturers. A smaller
legitimate catalog beats a huge legally questionable one; here volume
came only from records that passed every gate (1,301 Rtings-linked and
5 malformed records rejected with reasons). Code license != data
license: no scraped measurement database (AutoEq-style or otherwise) may
be added without per-source redistribution review recorded in provenance.

## Sources, licenses, attribution

Full audit: `docs/catalog-source-audit.md` (re-audited live 2026-09-15,
posture unchanged; fetch evidence recorded). In short: AutoEq code is
MIT but its aggregated third-party measurements carry no redistribution
grant (E for data, D for links); oratory1990/crinacle/InnerFidelity/
Rtings/Harman targets/images are E (data) / D (links); OPRA dataset is
**B** (bundle with attribution + ShareAlike notice + creator chains
intact — LICENSE.md `Dataset:` CC BY-SA 4.0, code MIT, verified
2026-09-14 and re-verified 2026-09-15); only in-repo authored content
is A, manufacturer facts are C.

The Devices → Sources & licenses tab renders every bundled source with
license, attribution, redistribution level, and link (or "unverified").
ShareAlike-adapted OPRA data is declared there with the code/data split
(code stays MIT) — not buried.

## Provenance model

Every device and preset carries `SourceProvenance`: source name + type,
outbound URL (http(s) only; empty when unverifiable rather than
invented), attribution, license (SPDX where known, else plain language),
and a `redistribution` level (`none` | `metadata-only` | `full`).
`validateCatalog` enforces: unique ids, resolvable references, valid PEQ
payloads, valid measurement-ref URLs, complete provenance — and the hard
rule that `manufacturer`/`measurement-derived`/`community` origins
require `redistribution: "full"` for the DATA.

## Catalog vs user state

Catalog records are canonical and read-only. The UI never edits them:
"Import EQ" copies the PEQ into the user's preset library
(`eq-store.importPreset`, deep copy, user-owned, freely
renameable/deletable/favoritable) **along with the catalog attribution,
license, source URL, and original preset id** — the copy stays
attributable after it becomes independently editable, and catalog
updates can never reach into user data. "Create profile" creates an
ordinary local IEM profile prefilled with make/model. Catalog
favorites are local-only (localStorage prefs, never canonical).

## Preset origins

`user` (saved from the editor), `tutorial`, `manufacturer`,
`measurement-derived`, `autoeq`, `community`, `manual`. Origin is
recorded at import and shown in the library; nothing is labeled AutoEQ
unless it came from AutoEQ. The portable file format
(`preset-file.ts`, `{"kind": "iem-player-preset", "schemaVersion": 1,
...}`) carries name/device/origin/attribution/PEQ and fails safe with a
reason on malformed input.

## Full-ingestion data quality (honest limits)

OPRA presets carry no rig, calibration, channel, or range metadata
beyond their `details` credit ("Measured by oratory1990" / "Harman
Target") — that paucity is preserved verbatim instead of padded, and the
UI shows exactly what is known. Presets are stored per contributor, never
merged across sources; nothing claims one is "correct". >12-band
payloads are kept whole (the editor truncates per OPRA schema guidance);
out-of-range values are kept as-is (the engine clamps — never silently
repaired). 107 upstream duplicate-directory records are kept separate
under suffixed ids and flagged. One naming overlap with a hand-reviewed
seed id (OPRA "AirPods Pro 2" vs seed "AirPods Pro (2nd generation)")
ships as `apple-airpods-pro-2-2` with its presets, seed untouched,
flagged for maintainer review. The gate suite covers malformed,
duplicate, dangling-ref, seed-collision, determinism, and
generated-file-equality cases with fixtures plus the frozen snapshot.

## Generation pipeline

`src/catalog/ingest.ts` (pure, tested) + `scripts/catalog/` (README,
example source, refresh recipe) + `pnpm catalog:check`:

```
source JSON → normalize → validate → dedupe → license gate →
cross-reference → generated layer → quality report
```

Rules: uncertain duplicates kept separate + flagged (never merged);
seed ids are reserved so generated ids can never duplicate them (naming
overlaps disambiguate + flag); nothing silently dropped
(`rejected[]`/`needsReview[]` must be read); third-party origins without
`"full"` redistribution rejected with reason; dangling preset deviceIds
rejected; outputs deterministic (rerun byte-identical, asserted; the
committed generated file must equal pipeline output, asserted). Input
guards: ≤50k records, ≤500-char fields, http(s) URLs only. The app reads
`FULL_CATALOG` = seed + generated layer; the bulk layer ships as a
lazily-loaded chunk (`loader.ts`) so listeners who never open Devices
never download it, with offline fallback to the seed. No SQLite/WASM/
backend; no new dependencies. Category mapping is an explicit table
(`OPRA_SUBTYPE_MAP`): in_ear→iem, earbuds→earbuds,
true_wireless→tws, over_the_ear/on_ear→headphones (generic — openness is
not in OPRA records, never guessed); unknown subtypes reject the device.
EQ-availability filtering, EQ sorting, EQ counts, and source filtering
all use the same deviceId-scan derivation as the detail view (generated
presets attach without editing seed records), so seed-overlap devices
are found by the OPRA source filter too.

"The catalog may contain product metadata even when no measurement can
legally be bundled." — that is the normal case, stated in the UI
("Measurements come from specific sources and rigs…", offline note,
per-device "no verified external measurement link" text).

## Architecture & performance

Static versioned data (`CATALOG_VERSION` schema, `CATALOG_DATA_VERSION`
content), normalized id references, metadata-only browsing (measurement
arrays never load to list names), memoized search/filter/sort. Measured
on synthetic fixtures: 10,000 devices validate in ~4 ms, search in
~10 ms, ~31 MB heap. At full OPRA scale the generated layer is ~32 MB
source (~6,229 devices / ~11,289 presets once merged) and therefore
ships as a separate lazily-loaded chunk (`loader.ts`, excluded from
service-worker precaching): listeners who never open Devices never
download or parse it, and offline Devices falls back to the seed.
Full-snapshot pipeline regen runs in seconds in-test; rerun
determinism is asserted. No SQLite/WASM/backend — re-measure before
adding any.

## Growing the catalog (maintainer guide)

1. Verify the DATA license (`docs/catalog-source-audit.md` rules).
2. Add source JSON under `scripts/catalog/sources/`, run the refresh
   path, read the whole report.
3. Emit validated records to `src/catalog/generated.ts` (stable
   formatting), bump `CATALOG_DATA_VERSION`, update this doc (counts,
   sources, date). Never hand-edit generated rows.

## OPRA refresh procedure (update model)

1. Fetch a new source snapshot; record revision/date/sha256 in
   `scripts/catalog/opra-snapshot/manifest.json`.
2. Re-verify LICENSE/README/THIRD_PARTY_LICENSES/schemas; if terms
   changed, update the registry + docs first (the legal watch test
   fails until you do — stale assumptions cannot ship silently).
3. Inspect upstream changes (new subtypes? new attribution rules?).
4. Run ingestion; review the whole report (`rejected`/`needsReview`).
5. Diff the generated output against the committed layer.
6. Verify per-record attribution + ShareAlike header intact.
7. Regenerate `src/catalog/generated.ts` + reports deterministically.
8. Run typecheck, lint, unit tests, build, device E2E.
9. Bump `CATALOG_DATA_VERSION`; update this doc + the ingestion report.

Never auto-update production data from a remote source.
