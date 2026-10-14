# Catalog data licenses

Audit date: 2026-09-14, re-audited live 2026-09-15 (posture unchanged).
Method: primary-source fetches (license/readme/schema/record files)
where possible; absence-of-grant reasoning otherwise. Re-audit annually
or when any source changes terms. Evidence:
`docs/catalog-source-audit.md`. Machine-readable mirror:
`src/catalog/sources.ts` (legal statements live there, not in components).

## 1. Bundled data

- **Catalog metadata** (21 hand-reviewed device records: make/model/type
  facts + manufacturer links): factual, no creative expression copied.
- **Tutorial preset** (`tutorial-gentle-trim`): authored in-repo, MIT.
- **OPRA full ingestion** (6,208 devices + 11,288 EQ presets, snapshot
  main @ `0b88ecd`, 2026-07-01, fetched 2026-09-14; re-audit 2026-09-15):
  CC BY-SA 4.0 adapted material — per-record author + measurer + OPRA
  chains intact, ShareAlike notice in Devices → Sources & licenses, code
  stays MIT. See §4 and `docs/opra-ingestion-report.md`. No OPRA
  measurements exist to bundle (OPRA hosts presets, not raw curves); no
  blurbs, logos, or artwork taken.

## 2. Source/license matrix

| Source | Type | Data | License | Redistribution | Attribution | Derivatives | Bundle? | Evidence |
|---|---|---|---|---|---|---|---|---|
| In-repo authored | preset/code | tutorial PEQ | MIT | full | repo notice | allowed | ✅ | own authorship |
| OPRA dataset | EQ presets, product names/types | parametric EQ, names | CC BY-SA 4.0 (data), MIT (code) | full, share-alike | 2-level (browser + creator) | share-alike | ✅ full ingestion (data v4) | LICENSE.md, README FAQ, THIRD_PARTY_LICENSES.md, schemas, records — verified 2026-09-14, re-verified live 2026-09-15 |
| AutoEq software | algorithms | n/a (ideas) | MIT | full | MIT notice | allowed | ✅ ideas only | fetched LICENSE |
| Manufacturer metadata | facts | make/model/type | facts only | metadata-only | per-record link | allowed | ✅ metadata | per-record provenance |
| AutoEq measurements/results | FR data, EQ | CSVs, results | MIT covers code, data grant absent | unknown → NO | per-source | unclear | ❌ | README lists oratory1990/crinacle/InnerFidelity/Rtings/headphone.com with no data grant |
| oratory1990 | FR data, presets | lists/CSVs | none stated | unknown → NO | oratory1990 | unclear | ❌ (§8) | public list, no license file |
| crinacle | FR data | DB/graphs | none stated | unknown → NO | crinacle | unclear | ❌ (§8) | viewable DB, no grant |
| InnerFidelity | FR data | archive | commercial, none stated | unknown → NO | Stereophile | unclear | ❌ | commercial editorial |
| Rtings | FR data | lab graphs | commercial restrictive | unknown → NO | Rtings | unclear | ❌ | known restrictive terms; re-read before any change |
| Legacy headphone.com | FR data | historic CSVs | none stated | unknown → NO | unknown | unclear | ❌ | unclear provenance |
| squig.link DBs | FR data | per-creator CSVs | none stated | unknown → NO | per-creator | unclear | ❌ | JS shell, no license/API statement found |
| Harman-style targets | target curves | numeric files | research, no grant | unknown → NO | Harman | unclear | ❌ | paper ≠ licensed file |

## 3. Attribution requirements

- OPRA: browser-level OPRA logo/description/repository link is requested
  upstream; this app renders the Sources & licenses tab (description +
  link) instead of the logo image (no image rights taken — text link is
  the conservative equivalent, documented here as a deliberate deviation
  to review). Preset-level: creator credited prominently per row
  ("EQ by {author} via OPRA ({details})") plus the verifiable directory
  URL in provenance.
- Tutorial/in-repo: MIT notice (project LICENSE).
- Manufacturer facts: per-record official link.

## 4. ShareAlike obligations

The OPRA-derived generated records (`src/catalog/generated.ts`) are
Adapted Material under CC BY-SA 4.0: the DATA file carries the license
header + attribution + upstream-caveat note and must be shared under
CC BY-SA 4.0 or a compatible license. Surrounding application CODE
remains MIT (separate work, separate license — the standard
code/data split, stated in the file header). Converted JSON/CSV
normalization counts as adaptation: complied with via licensing, never
by pretending otherwise.

## 5. External-only sources

AutoEq repo/app, oratory1990 list, crinacle DB, InnerFidelity archive,
Rtings graphs, squig.link, Harman target info. Linked, never fetched,
never bundled. The device detail "Measurements" section explains that
sources disagree and nothing implies correctness.

## 6. Rejected sources

AutoEq measurement/result/target data, oratory1990 data (pending §8),
crinacle data (pending §8), InnerFidelity, Rtings, legacy headphone.com,
Harman numeric targets, all product images/artwork, vendor marketing
blurbs. Reasons: §2 matrix; rule: silence is not permission.

## 7. Unresolved sources

- oratory1990 measurement redistribution + derivative EQ rights → §8.
- crinacle database redistribution → §8.
- OPRA upstream contributor grants beyond OPRA's own assertion (accepted
  residual risk, chains preserved, re-audit on change).
- Any manufacturer-published redistributable PEQ pack: none located with
  a grant (surveyed conceptually; facts-only posture stands).

## 8. Permission requests

No one is contacted automatically. Template (adapt per recipient):

> Subject: Permission to redistribute measurements/presets in an open
> local-first music player
>
> Hello {name} — I maintain {app}, a local-first, open-source browser
> music player (MIT code, no backend, no accounts). We would like
> permission to redistribute {specific dataset} covering {scope}, in
> normalized JSON form, hosted on GitHub Pages, for open-source and
> commercial use of the app, with attribution "{credit}" plus a link to
> {source}. Specifically: (1) redistribute the measurement numbers,
> (2) redistribute EQ presets, (3) normalize/convert formats,
> (4) generate and redistribute derived EQ corrections with credit,
> (5) host everything on GitHub Pages. If any of these is not OK, a
> narrower grant (e.g. link-only, or non-commercial) is still useful to
> know about. Thank you for the work — {contact}.

Draft A — oratory1990 (contact: Reddit u/oratory1990, well-known public
handle; verify before sending): measurements + presets, scope "any IEM/
headphone records you hold rights to", credit "oratory1990 + source
link", rights (1)–(5) above.

Draft B — crinacle (contact: published channel on crinacle.com —
unverified here, confirm before sending): database numeric curves,
same rights (1)–(5), credit "crinacle + source link".

## 9. Audit date

2026-09-14 (this file + `docs/catalog-source-audit.md` + registry
`verifiedAt` fields), re-audited live 2026-09-15: LICENSE.md
(`Dataset:` CC BY-SA 4.0 + `Code:` MIT), README FAQ (two-level
attribution), THIRD_PARTY_LICENSES.md (AutoEq MIT), `eq_info.json`
schema — all match the recorded posture, so bulk ingestion proceeds
unchanged. Full report: `docs/opra-ingestion-report.md`.

## 10. Re-audit procedure

1. Re-fetch each registry `licenseUrl`/terms page; diff against the
   recorded grant.
2. Update `verifiedAt`, this file, and the registry in the same change.
3. If a grant narrowed: remove affected records via the pipeline
   (rejected[] documents the removal) and bump `CATALOG_DATA_VERSION`.
4. If OPRA terms change: re-check the upstream-caveat posture first.
