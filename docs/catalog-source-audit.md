# Catalog source audit (2026-09-14, re-audited live 2026-09-15)

Method: targeted fetches of license/readme/schema files (research, no
data acquired beyond the documented consumer snapshot); everything else
classified by absence-of-grant reasoning, which is stated explicitly per
source. "No explicit redistribution grant" always resolves to DO NOT
BUNDLE — silence is never read as permission.

## Verified by fetch

### OPRA (opra-project/OPRA) — code MIT, dataset CC BY-SA 4.0 → B
- Repo: https://github.com/opra-project/OPRA, main @
  `0b88ecd4e2bef7cf69fd5b50f1d06fb586c10865` (2026-07-01).
- `LICENSE.md` (fetched 2026-09-14, re-fetched 2026-09-15): `Dataset:`
  CC BY-SA 4.0 full text + `Code:` MIT. Posture **unchanged** across
  both audits.
- `README` FAQ (re-fetched 2026-09-15): code MIT; manufacturer, product,
  and EQ data CC BY-SA 4.0; two-level attribution — browser-level OPRA
  logo + description + repository link, preset-level creator credited
  prominently + OPRA link. (This app renders the Sources & licenses tab
  with description + link instead of the logo image: no image rights
  taken; the deviation is documented in `catalog-data-licenses.md` §3.)
- `THIRD_PARTY_LICENSES.md` (re-fetched 2026-09-15): AutoEq MIT
  2018–2022 — the documented upstream caveat (many EQ records derive
  from AutoEq contributor measurements) stands; chains preserved.
- `schemas/eq_info.json` (re-fetched 2026-09-15): `author`/`details`/
  `link`, `type: parametric_eq` only, 7 band types, truncate-if-limited
  guidance — matches the adapter exactly.
- Data structure: `vendors/{vendor}/products/{product}/eq/{dir}/info.json`
  plus the documented consumer JSONL dump (the frozen snapshot's source).
- Classification: **B** — bundle EQ presets + product names/types with
  per-record attribution + ShareAlike notice + creator chains intact.
  Vendor blurbs and logos NOT taken (image/text rights unclear). Product
  names/types only. Rtings-linked records excluded (restrictive upstream
  terms). If OPRA terms ever change, the legal-watch test
  (`opra-poc.test.ts`: manifest license id, registry status, record
   counts) fails until the registry + docs are deliberately updated.

### AutoEq (jaakkopasanen/AutoEq) — code MIT, data NOT cleared
- Repo: https://github.com/jaakkopasanen/AutoEq (README fetched 2026-09-14)
- `LICENSE`: MIT, covering "this software and associated documentation
  files", copyright Jaakko Pasanen 2018–2022 (fetched 2026-09-14).
- README confirms `measurements/` aggregates oratory1990, crinacle,
  InnerFidelity, Rtings, and legacy headphone.com data, and `results/`
  holds pre-computed EQ settings.
- No statement anywhere grants redistribution of the contributed
  third-party measurements. MIT-on-code ≠ MIT-on-data.
- Classification: code ideas **A** (already used, nothing copied);
  measurements/results **E**; repo/app links **D**.

## Classified by absence of grant (no bundling)

### oratory1990 preset/measurement list — E (data), D (link)
- A Reddit wiki index of presets/measurements. Publicly viewable; no
  license grant found for redistribution. Link allowed; data banned.

### crinacle database — E (data), D (link)
- Publicly viewable database/graph tool. No redistribution grant for the
  underlying numeric data. Link allowed; data banned.

### InnerFidelity (via Stereophile) — E (data), D (link)
- Commercial editorial measurement archive. No redistribution grant.
  Link allowed; data banned.

### Rtings — E (data), D (link)
- Commercial lab; terms restrict scraping/redistribution. Link allowed;
  data banned. (Classified on business-model + known-terms basis; full
  ToS re-read recommended before any future change of posture.)

### Harman-style target curves — E
- Research-data curves with no redistribution grant. The app's existing
  posture (no bundled third-party targets) is correct and unchanged.

### Product images/artwork — E across the board
- No source reviewed grants image redistribution. Catalog ships no
  images; neutral placeholders only. No hotlinking (breaks offline,
  leeches bandwidth, dodges the rights question).

## Unverifiable from this environment

(none currently — OPRA was verified by live fetch 2026-09-14 and
re-verified 2026-09-15; see "Verified by fetch" above. This section is
kept so future audits have a place for sources that cannot be checked.)

## Approved for bundling

### A — in-repo authored content only
Tutorial preset, own code/math/docs (project MIT). Everything else below
is metadata or links.

### C — manufacturer product metadata (facts + official links)
Make/model/type/driver-connectivity facts and manufacturer root-domain
links. No descriptions copied, no images, no measurements. Each record
carries `redistribution: "metadata-only"` provenance. This is the only
class the seed expands with.

### D — outbound links only (no data)
AutoEq repo + autoeq.app, oratory1990 list, crinacle DB, InnerFidelity
archive, Rtings graphs. Presented as "where to look", never fetched.

## Standing rules for future additions
1. Verify the DATA license, not the code license.
2. Silence = E. Marketing "open" language ≠ grant.
3. CC BY-SA = B with attribution UI + ShareAlike notice, creator fields
   intact, derivatives marked (OPRA is the live example).
4. Re-audit annually or when a source changes terms; record the date.
