# Library persistence (Phase 2)

## Database choice: `idb` over native IndexedDB

`idb@8.0.3` (ISC, 1.19 kB brotli, ~23M downloads/week, zero dependencies) —
a promise wrapper that mirrors the native API instead of replacing it.

| Option | Verdict | Why |
|---|---|---|
| `idb` 8.0.3 | **chosen** | Smallest robust layer; handles/Blobs pass through structured clone untouched; explicit upgrade transactions fit the migration framework; key lookups + bounded index reads cover every query we have |
| Native IDB | rejected | Callback/error boilerplate in every call site; `idb` removes it for 1.2 kB |
| Dexie 4.4.x | rejected | Excellent library, but its query DSL/observables buy nothing here and cost an order of magnitude more bytes for the same key-lookup workload |
| localForage | rejected | Driver abstraction hides transactions; fallback drivers cannot structured-clone `FileSystemHandle`s, risking silent handle corruption |
| SQLite/WASM | rejected | ~1 MB+ WASM payload + OPFS/SyncAccessHandle complexity for key-lookup workloads; violates the AGENTS.md WASM rule without measured need |

Test shim: `fake-indexeddb@6.2.5` (Apache-2.0, dev-only) for real CRUD,
migration, and 10k-track perf tests in Node.

## Schema (DB `iem-player-library`, v1)

Stores (keyPath): `tracks(id)`, `sources(id)`, `artwork(id)`,
`playlists(id)`, `favorites(trackId)`, `ratings(trackId)`,
`history(seq autoIncrement)`, `stats(trackId)`, `meta(key)`.

Indexes: `tracks[by-added, by-source]`, `playlists[by-created]`,
`favorites[by-added]`, `history[by-started, by-track]`,
`stats[by-last-played]`.

Deliberate non-normalizations: playlists embed ordered `trackIds`
(single-record atomic reorder, no join overhead); albums/artists/genres are
derived from the track snapshot via the existing tested grouping code
(`src/library/grouping.ts`) instead of duplicated tables; full-text search
filters the repository snapshot (10k rows ≈ 3 ms measured) while
sorted/limited reads (recents, history) use real indexes. The repository
interface hides this so index-backed search can replace the filter later.

## Migrations

`src/db/migrations.ts`: ordered step functions, index *i* migrates
v(i) → v(i+1); steps guard with `contains()` so re-runs are safe. Never
drop/recreate: add a step and bump `DB_VERSION`. Tested: fresh-init creates
all stores/indexes; reopen preserves data with zero steps running.

## Filesystem handles

Directory handles persist in `sources` via structured clone (native IDB
behavior — verified in Chromium). Audio bytes are never stored; playback
resolves a `File` lazily: session registry → walk the stored handle by the
track's relative path. Picker/drop `File`s cannot persist, so their tracks
restore as `missing` until re-selected.

## Permission model

`queryHandlePermission` (no prompt) vs `requestHandlePermission`
(user gesture only). Statuses: `ready`, `permission-required`,
`permission-denied`, `stale`, `unavailable`, `unsupported`, `no-source`.
Restore auto-revalidates only already-granted sources in the background;
everything else waits for the explicit Reconnect button. Safari (no File
System Access API): picker + drop keep working; folder persistence reports
`unsupported` instead of pretending.

## Identity strategy

`trk-<fnv1a(sourceId + normalizedPath)>`; loose files use
`fnv1a(name + size + mtime)`. Size+mtime stored for change detection and
excluded from the id, so replacing a file keeps history/favorites/playlist
membership. Renames yield new ids; the old record is marked `missing`, never
auto-deleted. Same-slot matches update in place; only a true hash collision
(different slot, same 32-bit hash) earns a `-2` suffix.

## Scanner strategy

`scan()` (enumerate + parse, chunked with UI yields) → `diffScan()`
(pure: added/changed/unchanged/removed over stable ids + stats) →
`applyChanges()` (bulk persist in ≤500-row transactions, one store sync).
Unchanged files skip parsing entirely on revalidation.

## Artwork strategy

Embedded bytes → content-hash id (`art-<fnv-of-bytes>`) → downscale to ≤512px
JPEG via bitmap/canvas (original kept when APIs are missing or corrupt) →
Blob in `artwork` store with `refCount` (same bytes shared across album
tracks). Runtime URLs minted on demand by `TrackArtwork`/`useArtworkUrl`;
revoked when refs hit zero or the library clears. Albums reuse the first
track's `artworkId`. Verdict on the spec question: IndexedDB Blob storage is
sufficient — no OPFS advantage demonstrated.

## Metadata caching

Persisted per track: tags, duration (element-refined), codec-adjacent file
stats (size/mtime/type), source + path, artwork id, addedAt/updatedAt. No
giant blobs, no duplication: genres live on the track, grouping is derived.

## Failure handling

Deleted/moved files → `missing` badge + play-time message guiding re-import
or reconnect (never a crash). Revoked permission → `permission-required`
with Reconnect. Unavailable IDB (private mode) → memory-only mode with an
explicit notice. Quota/corrupt rows → best-effort catch, app stays up.
Corrupt images → original bytes or placeholder. DB blocked (second tab) →
restore retries next launch.

## Browser compatibility

Chromium: full (handles + persistence). Firefox/Safari: full library
persistence (IndexedDB + Blobs are universal); folder handles degrade to
picker/drop with honest `unsupported` status. File System Access types not
in TS DOM lib are described structurally (`scanner.ts`, `handles.ts`).

## Measured performance (10k synthetic tracks, Node + IDB shim)

insert 202 ms · restore 33 ms · search 3 ms · album/artist grouping 13 ms ·
recent-100 3 ms. Algorithmic costs are negligible; real-browser disk numbers
will differ and get measured in Phase 9.
