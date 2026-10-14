# Cloud music sources

Play music stored in your own cloud-storage accounts (Google Drive,
OneDrive, Dropbox, Box) without uploading anything and without a
backend. This is not streaming-catalog playback: the files are yours,
the app only keeps metadata references and streams bytes at play time.

## Concepts

Three states stay explicit everywhere (UI, types, docs):

- **LOCAL FILE** — bytes on this device (`File`, object URLs).
- **REMOTE CLOUD FILE** — bytes in your cloud account. The library
  stores `Track.remote` (provider + account + provider file id +
  revision) and resolves a fresh playable URL at play time. A remote
  track is never a `File` object and never a manufactured fake.
- **IMPORTED METADATA** — playlist text (see `docs/playlist-import.md`).

## Architecture

```
cloud account → browse → metadata references → library tracks
→ resolvePlayable → provider temporary/cookie URL → PlaybackEngine
→ mix → preamp → EQ → tone → dynamics → spatial → limiter → master
  (the full modular chain from docs/audio-engine.md — cloud tracks get
  device layers, ReplayGain, crossfade, and visualizations identically)
```

- **One playback engine.** Providers implement `CloudMusicProvider`
  (`src/cloud/providers.ts`); the engine consumes
  `EngineSource = {kind:"file"} | {kind:"url"}` on the same dual-deck
  pipeline, so EQ, crossfade, rate, Media Session, queue, shuffle, and
  repeat behave identically for local and cloud tracks. There are no
  per-provider players.
- **Fresh URLs per playback.** Temporary URLs are memory-only, never
  persisted, and refreshed on expiry — including one transparent
  mid-playback refresh at the last position before any error banner.
- **Identity.** `cloudTrackId(provider, accountId, providerFileId)` —
  never filenames, paths, or URLs. Reconnecting the same provider
  account restores the same ids, so playlists, history, favorites, and
  ratings reattach by themselves.
- **No mirroring.** Import stores ~200 bytes of JSON per file (verified
  by test: 100 MB claimed remote audio persists as metadata only).
  No audio blobs in IndexedDB, no folder mirroring, no offline cache.
  An explicit "download for offline" feature would be a separate,
  deliberate product decision.

## Providers and playback mechanisms (verified)

| Provider | Auth (no secret) | Browse/search | Playback URL | Seek |
|---|---|---|---|---|
| Google Drive | GIS token client, `drive.file` default; `drive.readonly` only for whole-folder browsing (restricted) | `files.list` (+ Picker per-file grants) | `webContentLink` (cookie-authenticated, documented browser field; `canDownload` checked) | Range documented |
| OneDrive | PKCE code flow, `Files.Read` + `User.Read` | Graph children/search | `@microsoft.graph.downloadUrl` (pre-authenticated, docs-directed for JS apps; ~5 min conservative TTL) | Range documented |
| Dropbox | PKCE code flow, `account_info.read` + `files.metadata.read` + `files.content.read` | `list_folder`/`search_v2` | `get_temporary_link` (~4 h, refreshed) | Range on content links |
| Box | PKCE code flow, `root_readonly` | folder items/search | 302 `Location` preferred, else documented `access_token` pre-auth URL (memory-only, read-only token) | Range documented |

All four work end to end in this build; each needs its own OAuth
client id (see §setup) because a static page cannot ship provider
credentials. Box playback carries an honest caveat (token-bearing URL
in memory only, refreshed per playback).

## Setup (per provider)

1. Create a free OAuth app with the provider (any account):
   - **Google**: Cloud Console → APIs & Services → enable Drive API →
     OAuth client ID, type *Web application*, authorized origin your
     app origin. Note the client ID (no secret needed in the app).
   - **Microsoft**: Entra → App registrations → single-page app
     redirect to your app origin, delegated `Files.Read`, `User.Read`.
   - **Dropbox**: App Console → scoped app, permissions above.
   - **Box**: Developer Console → OAuth 2.0 app, `root_readonly`.
2. Paste the client ID into the provider's setup panel (stays in this
   browser's localStorage).
3. Connect. Drive defaults to per-file access; tick folder browsing
   only if you accept the restricted-scope notice.

## OAuth and tokens

- Browser-safe flows only: Google Identity Services token client;
  PKCE authorization-code for Microsoft/Dropbox/Box. No client
  secrets exist client-side; none are stored.
- **Access tokens: process memory only.** Never IndexedDB,
  localStorage, or URLs (Box's documented query-param delivery is the
  single exception, memory-only and per-playback).
- **Refresh tokens: memory by default**, localStorage only with
  explicit "remember this connection". Never stored: authorization
  codes, PKCE verifiers (sessionStorage round-trip only).
- OAuth state is validated; mismatches fail closed with a plain
  sentence. Server-side revocation is attempted on disconnect;
  local state clears regardless.

## Privacy

- Cloud authorization grants access to that cloud account only.
- **Nothing local ever goes to a provider**: no filenames, hashes,
  paths, library contents, or matching queries. Provider search
  queries contain only what you type in the cloud browser.
- Local files are never uploaded anywhere (unchanged guarantee).

## Behavior notes

- **Offline**: cloud tracks show metadata and stay in playlists/
  history; playback reports unavailability. Local music is unaffected.
- **Disconnect** clears auth + transient URLs, marks tracks
  unavailable, preserves everything else. **Remove source** additionally
  drops the source record; references stay and recover on reconnect.
- **Refresh** revalidates known files (added/removed/renamed/modified
  via provider ids/revisions); transient network failures never count
  as deletions.
- **Formats**: support is the browser's verdict (`canPlayType`) crossed
  with provider MIME/extension — `supported` / `possibly-supported` /
  `unsupported`. Nothing is transcoded (no backend). Unsupported files
  are skipped at import with a count, never silently.
- **Large folders**: paged listing, bounded recursive collect (5,000
  files per add, cancellable, progress shown, UI yields between pages).

## Provider terms audit (2026-09-15)

Verified against current official documentation before implementing
(full references inline in `src/cloud/*.ts`):

- **Google Drive API v3** (`manage-downloads`, `api-specific-auth`,
  Picker guides): `files.get?alt=media` (header auth — unsuitable for
  media elements), `webContentLink` (documented browser field),
  Range headers, `drive.file` non-sensitive vs `drive.readonly`
  restricted, GIS token client for browser apps. No required
  attribution for API use.
- **Microsoft Graph v1.0** (`driveitem-get-content`): pre-authenticated
  `downloadUrl` directed for JavaScript apps (no CORS preflight),
  minutes-long expiry, Range support; least-privilege `Files.Read`.
- **Dropbox API v2** (official endpoint reference): OAuth PKCE,
  `list_folder`/`search_v2`/`get_current_account`,
  `get_temporary_link` (~4 h streaming links). Docs pages are JS-heavy;
  endpoint shapes are long-stable; re-verify at each provider update.
- **Box Platform API 2024.0** (OpenAPI-verified): `GET
  /files/{id}/content` with Range support, documented `access_token`
  pre-authentication for browser sharing (scope-down guidance
  followed via `root_readonly`), 302 `Location` download URLs.
- No scraping, no undocumented endpoints, no trademark logos shipped
  (text badges only).

## Files

`src/cloud/`: `model.ts`, `identity.ts`, `audio-formats.ts`,
`oauth.ts`, `token-store.ts`, `providers.ts`, `registry.ts`,
`cloud-store.ts`, `cloud-service.ts`, `drive.ts`, `onedrive.ts`,
`dropbox.ts`, `box.ts`. UI: `src/features/cloud/` (sources, browser,
badges) + Library sources tab + Settings section. Seams:
`libraryService.resolvePlayable`, engine `loadSource`/`preloadSource`.

## Tests

Unit (fixtures, no network): identity, formats, OAuth vectors (RFC
7636), token boundaries, all four providers, service
(import/disconnect/reconnect/status mapping), engine URL decks,
100 MB no-download proof. E2E (`e2e/cloud-sources.spec.ts`): full
OneDrive loop against mocked documented endpoints with a synthesized
WAV — connect, browse, add, badge, play, seek, disconnect,
unavailable state, reconnect recovery.
