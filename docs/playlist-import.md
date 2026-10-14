# Playlist import

**This imports playlist metadata and matches it against your local files.
It does not download streaming audio.** Imported tracks must already exist
in the local library (or stay unresolved); anything unmatched keeps its
metadata in the import record and is never faked into a local track.

## Providers

| Provider | Status | Notes |
|---|---|---|
| Import file (.m3u/.m3u8, .csv, .json) | ✅ Available | Fully local: picker → parse → match. |
| Spotify | ❌ Not connected | Would need `playlist-read-private` via OAuth. Shipping browser-only OAuth requires a client secret in the frontend or per-user developer-app setup — unsafe without a backend, so no integration ships and no tokens are ever requested or stored. Export via a playlist-export tool → Import file. |
| YouTube | ❌ Not connected | Needs Google OAuth client setup + API quota; not provisionable securely from a static page. |
| YouTube Music | ❌ Not connected | No dedicated public playlist API; undocumented endpoints/scraping are out of scope. |
| Apple/Deezer/Tidal/SoundCloud | ❌ Not implemented | Interface-ready (`PlaylistProvider`), no live code. |

The `PlaylistProvider` interface (`listPlaylists`/`fetchPlaylist` with
injected transport) lets future providers plug in without touching the
domain model. Current official authorization requirements could not be
verified from this environment, so per project policy no live OAuth was
built on assumptions.

## Matching

Deterministic, local-only (the library is never uploaded). Normalization:
Unicode NFKD, case, punctuation, featured/joint artists, parenthetical
version tags (compared separately — same song/different version scores
LOW, never silently links). Signals: artist+title base, album, duration
±3 s, ISRC (short-circuits HIGH).

Confidence: **HIGH** (title+artist plus album/duration corroboration, or
ISRC), **MEDIUM** (title+artist only), **LOW** (version mismatch),
**NONE**. Auto-link requires exactly one HIGH candidate — multiple HIGHs
(same song, two albums) stay ambiguous. Everything else goes to review:
pick a candidate, search the library, skip, or keep unresolved. Source
order is always preserved; bulk "accept high-confidence" exists for
obvious cases.

## Re-import & updates

Imports are keyed by (provider, external id); file identity is the file
name, so re-importing an edited file diffs as an update. Update / create
copy / cancel is offered; updates report added/removed/reordered/changed
tracks, preserve manual resolutions, and keep user-added playlist tracks.
Partial failure cannot lose data: resolutions persist per action, and a
failed file parses to an error, never a half-import.

## Persistence & privacy

Additive DB v3 store `playlistImports` (sessions: external metadata +
matches + resolutions + linked playlist id); local playlists carry an
optional `importedFrom` stamp. No tokens, secrets, or audio touch the
database. External text is rendered as text (React-escaped), URLs
restricted to http(s), file parsing is strict with human-readable errors.
Normal playback stays offline; only the import moment (and any future
live provider) needs a network.
