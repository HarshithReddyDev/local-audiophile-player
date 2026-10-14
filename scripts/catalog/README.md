# Catalog sources — refresh workflow

This directory holds the *inputs* to catalog regeneration. Nothing here
ships to the app directly: every file passes through `ingestRecords` +
`buildCatalogData` (`src/catalog/ingest.ts`), the license gate, and
`validateCatalog` before anything lands in `src/catalog/generated.ts`.

## Adding a source

1. Verify the DATA license first (see `docs/catalog-source-audit.md`).
   Silence is not permission. Third-party origins
   (`manufacturer`, `measurement-derived`, `community`) require
   `"redistribution": "full"` or the record is rejected with a reason.
2. Drop the source JSON here as `<source-name>.json`:
   `{ "devices": [...], "presets": [...] }` (either array optional).
   Device record: `manufacturer` (required), `model` (required),
   `aliases[]`, `deviceType`, `driver: {configuration, connectivity}`,
   `provenance: {source, sourceType, sourceUrl, attribution, license,
   redistribution}`, `releaseYear`, `notes`. Preset record: `name`,
   `peq` (normalized SerializedPEQ), `origin`, `deviceId`,
   `measurementRef`, `targetRef`, `provenance`, `createdAt`.
3. Run the refresh path: `pnpm catalog:check` executes the full pipeline
   over the checked-in example and asserts determinism. For a real
   refresh, load your file through the same functions in a scratch test
   (never hand-edit `generated.ts` rows).
4. On a clean report (zero `problems`, rejections reviewed), emit the
   validated devices/presets into `src/catalog/generated.ts` with stable
   id-sorted formatting, bump `CATALOG_DATA_VERSION` in `seed.ts`, and
   update `docs/device-catalog.md` (counts, sources, dates).

## Rules

- Uncertain duplicates are kept separate and flagged, never merged.
- Nothing is silently dropped: `rejected[]` and `needsReview[]` are part
  of the report and must be read before emitting.
- No measurement numbers without redistribution rights. Metadata-only
  entries and outbound links are the conservative default.
- Keep payloads sane: ingestion refuses >50k records and >500-char
  fields (DoS guard), URLs must be http(s).
