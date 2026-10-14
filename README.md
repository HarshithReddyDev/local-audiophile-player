# Local Audiophile Player

A local-first music player for headphone and IEM enthusiasts, combining library management, advanced EQ/DSP, device presets, and measurement-driven AutoEQ workflows.

Everything runs on-device in the browser: your music files are never uploaded, there is no account, no backend, no analytics, and no tracking. It even works fully offline once installed as a PWA.

![Music library with recently added tracks, albums, and the full song list](docs/assets/screenshots/music-library-desktop.png)

## Contents

- [Highlights](#highlights)
- [Feature overview](#feature-overview)
- [Screenshots](#screenshots)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [Privacy and data handling](#privacy-and-data-handling)
- [Catalog and licensing](#catalog-and-licensing)
- [User guides](#user-guides)
- [Development and contribution](#development-and-contribution)
- [Limitations](#limitations)
- [License](#license)

## Highlights

### Music library and playback

Local file and folder import (including drag & drop), with Music, Albums, Artists, Genres, Recently Played, Recently Added, and Favorites workspaces. Persistent metadata, playlists and smart playlists, queue with shuffle/repeat/crossfade, playback rate with pitch preservation, Now Playing and mini-player, Media Session integration, lyrics (embedded + `.lrc` sidecars), CUE-sheet virtual tracks, spectrum/waveform/peak visualization, and per-track analysis.

### EQ and DSP

Parametric EQ with a draggable response graph, graphic EQ in 10/15/31-band layouts, preamp with automatic headroom suggestions, bass/treble shelves, Bass Tuner, compressor with live gain-reduction metering, peak safety limiter, channel balance/mono/swap/solo, stereo width, crossfeed, generated-impulse reverb, relative loudness compensation, and ReplayGain (track/album). Every processor documents what it does, when to use it, and its limits — in the app under Guides → DSP.

### IEM and headphone profiles

A browsable catalog of **6,229 devices** with EQ presets, per-device sound profiles, measurement and target imports, response-curve visualization, and one-tap copy-to-profile semantics (catalog data is canonical and read-only; your edits always live on an independent copy).

### AutoEQ and measurement tools

Client-side AutoEQ fitting (measurement → target → smoothing → compensation → constrained PEQ + recommended preamp), Phase 8D smoothing options (Off/Light/Moderate, derived-copy only), fit-range and HF-treatment controls, residual metrics, and filter preview before anything is applied.

### Built-in preset library

51 hand-authored starting points — general, music, content, and listening EQ plus tone, dynamics, spatial, and combined DSP presets — with response previews, descriptions, and non-destructive A/B comparison against your current sound.

### Playlist import

Local playlist files (`.m3u/.m3u8`, `.csv`, `.txt`, `.json`) matched against your library with matched / needs-review / unmatched states and manual resolution. Streaming-service transfers are **not** shipped (see Limitations).

### Cloud music sources

Optional adapters for Google Drive, OneDrive, Dropbox, and Box. Only file metadata enters the library; audio streams at play time over short-lived URLs. Setup requires your own OAuth client ID (see Configuration).

### Privacy and local-first storage

IndexedDB for library metadata, artwork, playlists, and profiles; localStorage for small preferences. Plain-JSON backup & restore. Nothing leaves the device unless you connect a cloud source.

### Desktop, mobile, and PWA

Responsive layout (icon sidebar on desktop, bottom nav on mobile), light/dark/system themes, installable PWA with offline support, and background playback with Media Session controls.

## Feature overview

| Feature | Status | Notes |
|---|---|---|
| Local library (files/folders) | Available | Tested with tagged WAV/MP3/M4A/FLAC/Opus fixtures |
| Albums / artists / genres / recents / favorites | Available | Unified Music workspace |
| Playlists + smart playlists | Available | Save queue as playlist; rule-based smart lists |
| Queue / shuffle / repeat / crossfade | Available | Repeat-one affects natural endings only |
| Playback rate + pitch preserve | Available | 0.25–2× |
| Now Playing / mini-player | Available | Lyrics, visualizer, track analysis, Quick DSP |
| Media Session | Browser-dependent | Metadata + transport where the OS/browser supports it |
| Background playback | Browser-dependent | Never paused by the app; OS may suspend on mobile lock screens |
| Lyrics (embedded + `.lrc`) | Available | Local files and sidecars only |
| CUE sheets | Available | Virtual segment tracks |
| Parametric / graphic EQ | Available | 12-band editor; 10/15/31 graphic layouts |
| Bass/treble/tuner/compressor/limiter/spatial/reverb/loudness | Available | See Guides → DSP for safe usage |
| Peak safety limiter | Available | Sample-peak backstop — **not** a true-peak limiter |
| ReplayGain | Available with setup | Requires loudness tags in your files |
| Device catalog (6,229 devices) | Available | Search, filters, favorites; lazy-loaded |
| OPRA device presets (~11.3k) | Available | Canonical, read-only; imports copy |
| Device profiles | Available | Per-device EQ + DSP snapshots |
| Measurement / target import | Available | CSV/TXT curves; curve graphs |
| AutoEQ | Available | On-device fitting with preview + residual metrics |
| Built-in presets (51) | Available | Read-only; A/B preview; favorites |
| Preset import/export | Available | Native JSON, GraphicEQ, Equalizer APO subset, CSV (with loss warnings) |
| Playlist file import + matching | Available | `.m3u/.m3u8/.csv/.txt/.json` |
| Spotify / YouTube / Apple / Deezer / Tidal / SoundCloud transfer | Not currently available | Interfaces exist but no live OAuth ships; use file import |
| Cloud sources (Drive/OneDrive/Dropbox/Box) | Available with setup | Your own OAuth client ID required |
| PWA install + offline | Available | Service worker; catalog chunks lazy-load |
| Output-device selection | Browser-dependent | Chromium `setSinkId` only |
| System-wide EQ of other apps | Not possible | A browser page can only process audio it plays itself |

Honesty notes: this player makes **no** bit-perfect, exclusive-DAC, true-peak-limiting, SPL-calibrated-loudness, or guaranteed lock-screen-playback claims. Details live in the in-app Guides and [`docs/user-guide/`](docs/user-guide/).

## Screenshots

All screenshots are genuine captures of the running app (seeded with fictional demo tracks, a demo measurement, and catalog data — no personal media).

### Library and playback

![Now Playing with artwork, transport, Quick DSP, and progress](docs/assets/screenshots/now-playing-desktop.png)
*Now Playing — large artwork, transport, device/EQ status, Quick DSP, and track info.*

![Album cards with artist, year, and track counts](docs/assets/screenshots/albums-desktop.png)
*Album browsing — hover/tap a card to play.*

![Artist browsing](docs/assets/screenshots/artists-desktop.png) ![Genre browsing](docs/assets/screenshots/genres-desktop.png)
*Artist and genre browsing.*

![Queue dialog showing Now Playing and Up Next with source badges](docs/assets/screenshots/queue-desktop.png)
*Queue — Now Playing plus Up Next, with Local source badges and save-as-playlist.*

### Playlists

![Playlist list with a saved playlist](docs/assets/screenshots/playlists-desktop.png)
*Playlists with smart-playlist shortcuts.*

![Playlist detail with track list and actions](docs/assets/screenshots/playlist-detail-desktop.png)
*Playlist detail — artwork, actions, and track list.*

![Playlist import match review with candidate resolution](docs/assets/screenshots/playlist-import-desktop.png)
*Playlist import — file entries matched against your library; ambiguous rows get manual candidates. Nothing uploads; streaming audio is never downloaded.*

### EQ and DSP

![Parametric EQ with Warm preset curve, preamp headroom readout, and bands](docs/assets/screenshots/parametric-eq-desktop.png)
*Parametric EQ — Warm built-in preset applied: response graph, suggested preamp, and editable bands. The player bar confirms “EQ ON · −2.5 dB”.*

![Graphic EQ sliders](docs/assets/screenshots/graphic-eq-desktop.png)
*Graphic EQ — fixed bands, slider per band.*

![DSP workspace on the Dynamics tab](docs/assets/screenshots/dsp-workspace-desktop.png)
*DSP workspace — per-module tabs (Tone/Dynamics/Spatial/Loudness), device quick-switcher, master bypass, A/B compare, and preset bar.*

### Presets

![Preset browser with search and category filters](docs/assets/screenshots/preset-browser-desktop.png)
*Preset browser — search across 51 built-ins by category.*

![Warm preset details with response preview and A/B controls](docs/assets/screenshots/preset-detail-desktop.png)
*Built-in preset details — bands, preamp, response preview, active modules, provenance, and non-destructive A/B.*

### Devices, measurements, AutoEQ

![Device catalog with search, filters, and preset counts](docs/assets/screenshots/device-catalog-desktop.png)
*Device catalog — 6,229 devices with search, type/maker/source filters.*

![Sennheiser HD 600 detail with OPRA presets and attribution](docs/assets/screenshots/device-detail-desktop.png)
*Device detail — metadata, honest measurement note, and OPRA presets with creator credit (oratory1990 via OPRA, CC BY-SA 4.0).*

![My Devices profile list](docs/assets/screenshots/my-devices-desktop.png)
*My Devices — your saved per-device profiles.*

![Measurement import preview with curve graph](docs/assets/screenshots/measurement-target-desktop.png)
*Measurement import — CSV curve preview before saving; raw data is never modified by smoothing.*

![AutoEQ results with correction curve and residual metrics](docs/assets/screenshots/autoeq-desktop.png)
*AutoEQ — fitted correction against the Flat target with RMS/residual metrics, fit-range and smoothing controls.*

### Guides

![EQ Basics guide with frequency table](docs/assets/screenshots/guides-eq-desktop.png)
*Guides — EQ Basics with the frequency-landmark table (presented as practical landmarks, not absolute categories).*

![DSP guide](docs/assets/screenshots/guides-dsp-desktop.png)
*Guides — the DSP reference, one honest section per processor.*

### Cloud, settings

![Cloud sources with unconfigured provider cards](docs/assets/screenshots/cloud-sources-desktop.png)
*Cloud sources — opt-in providers with explicit setup states. No accounts connected here; nothing is contacted until you set one up.*

![Settings with appearance, playback, and audio sections](docs/assets/screenshots/settings-desktop.png)
*Settings — theme, crossfade, pitch preservation, ReplayGain, background-playback note, EQ/DSP status, output routing, backup & restore, and guides.*

### Mobile

![Mobile library with bottom navigation and mini-player](docs/assets/screenshots/music-library-mobile.png)
*Mobile library — bottom nav, horizontal rails, and the mini-player.*

![Mobile Now Playing](docs/assets/screenshots/now-playing-mobile.png)
*Mobile Now Playing.*

![Mobile EQ](docs/assets/screenshots/eq-mobile.png)
*Mobile EQ & DSP.*

## Getting started

Prerequisites: **Node ≥ 22** and **pnpm** (the repo pins `pnpm@12.4.1` via `packageManager`).

```sh
git clone https://github.com/HarshithReddyDev/local-audiophile-player.git
cd local-audiophile-player
pnpm install
pnpm dev        # development server (http://localhost:5173)
pnpm build      # static production build → dist/
pnpm preview    # serve the production build locally
```

Checks (all must pass; all exist in `package.json`):

```sh
pnpm typecheck      # tsc --noEmit
pnpm lint           # oxlint
pnpm format:check   # biome (pnpm format to fix)
pnpm test           # vitest unit + numerical DSP tests
pnpm test:e2e       # playwright: chromium, mobile, firefox, DSP-offline
pnpm catalog:check  # generated catalog equals pipeline output
```

Deployment is static hosting friendly; GitHub Pages deploys via [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml), which resolves the `VITE_BASE` subpath automatically. Client-side routing is state-driven, so nested paths and refresh work under any subpath.

## Configuration

Optional cloud providers need **your own OAuth client IDs** (PKCE public-client flows):

| Provider | Where to configure | Redirect URL |
|---|---|---|
| Google Drive | Google Cloud Console → OAuth client (Desktop/Web) | Your app origin (e.g. `https://<you>.github.io/<repo>/`) |
| OneDrive | Azure app registration | Same origin |
| Dropbox | Dropbox App Console | Same origin |
| Box | Box developer console | Same origin |

Enter the client ID in the app under Settings → Sources → provider → Set up. Tokens stay in your browser; disconnecting wipes the session. **Client secrets can never be embedded in a static frontend** — that is why only PKCE public-client flows are used, and why some integrations (Spotify streaming transfer, YouTube) are not shipped: they would require a backend or per-user developer-app setup this local-first app deliberately avoids.

No other configuration is needed. Copy [`.env.example`](.env.example) only if you override `VITE_BASE` for a custom deploy.

## Privacy and data handling

- **Local music stays local.** Files are decoded and played in your browser; matching, scanning, and playlist import never upload audio bytes or file paths.
- **Library metadata** (track info, artwork thumbnails, playlists, favorites, play counts) lives in **IndexedDB**; small preferences (theme, volume, EQ/DSP state, favorites flags) live in **localStorage**.
- **Imported presets and device profiles** persist the same way, as plain versioned JSON — exportable at any time via Backup & restore.
- **Cloud sources are opt-in.** Nothing contacts Google/Microsoft/Dropbox/Box until you configure and connect an account; only file metadata enters the library, and audio streams at play time over temporary URLs.
- **No external APIs** are called during ordinary local use. No backend, no account, no analytics, no tracking.
- Full policy: [`docs/user-guide/privacy.md`](docs/user-guide/privacy.md) and in-app Guides → Privacy.

## Catalog and licensing

- **Catalog data v4**: 6,229 devices and ~11.3k OPRA-derived EQ presets, validated by `pnpm catalog:check` (the committed generated layer must equal pipeline output).
- **Attribution is preserved**: every catalog preset carries creator/source/license/provenance; device pages link upstream sources. The dataset is used under **CC BY-SA 4.0** obligations documented in [`docs/catalog-data-licenses.md`](docs/catalog-data-licenses.md) and [`docs/measurement-data-licenses.md`](docs/measurement-data-licenses.md).
- **Code vs data licensing are distinct**: application source is **MIT** ([LICENSE](LICENSE)); measurement/preset data remains under its own licenses (CC BY-SA 4.0 and contributor terms). MIT code does not relicense the data.
- No unverified third-party measurement corpus is bundled: catalog entries are metadata + EQ presets, and the app states where no verified measurement link exists. No competitor code, UI, assets, or branding are used.
- Regeneration: [`scripts/catalog/`](scripts/catalog/) (OPRA ingestion + validation); source registry in [`docs/device-catalog.md`](docs/device-catalog.md).

## User guides

In-app **Guides** (with contextual Learn links from EQ, DSP, AutoEQ, Devices, imports, and cloud) are mirrored as Markdown:

- [Getting started](docs/user-guide/getting-started.md) · [Music library](docs/user-guide/music-library.md) · [Playlists](docs/user-guide/playlists.md) · [Player](docs/user-guide/player.md)
- [EQ](docs/user-guide/eq-guide.md) · [DSP](docs/user-guide/dsp-guide.md) · [AutoEQ](docs/user-guide/autoeq-guide.md) · [Device profiles](docs/user-guide/device-profiles.md) · [Measurements](docs/user-guide/measurements.md) · [Presets](docs/user-guide/presets.md)
- [Cloud music](docs/user-guide/cloud-music.md) · [Playlist import](docs/user-guide/playlist-import.md) · [Troubleshooting](docs/user-guide/troubleshooting.md) · [Privacy](docs/user-guide/privacy.md)

Key distinctions preserved throughout: generic listening presets vs device corrections; catalog presets vs your editable copies; source measurements vs generated AutoEQ output; peak safety limiter vs true-peak limiting; relative loudness vs calibrated SPL; browser background audio vs guaranteed OS behavior; local files vs cloud-backed tracks.

## Development and contribution

- `src/` — app source (`audio/` engine, `dsp/` pure math, `features/` UI, `state/` stores, `catalog/`, `cloud/`, `library/`, `db/`, `import/`). `public/` — PWA assets. `scripts/` — icon generation + catalog pipeline. `e2e/` — Playwright specs (incl. screenshot capture). `docs/` — user guides, architecture, data licenses.
- Architecture: dual-deck `HTMLAudioElement` playback → native Web Audio DSP chain (mix → preamp → PEQ → tone → dynamics → spatial → reverb-parallel → limiter → master); React + Zustand UI; IndexedDB persistence; static build.
- Tests: Vitest for logic/DSP (numerical tolerances, golden fixtures, catalog consistency); Playwright for browser flows (startup, base path, PWA, import, player/EQ/queue/DSP/devices/guides, responsive, a11y, error states); DSP-offline project renders real filters in `OfflineAudioContext`.
- DSP contributions require math verification + numerical tests first (see [`AGENTS.md`](AGENTS.md)); never weaken tests to make a change pass; preserve catalog provenance and validation scripts.

## Limitations

- **Codecs**: playback is limited to what the browser decodes (Chromium covers MP3/AAC/Vorbis/Opus/WAV/usually FLAC; Safari/Firefox vary). Metadata quality depends on file tags.
- **Background playback**: the app never pauses on page hide, but lock-screen/screen-off behavior depends on the OS and browser; mobile browsers may suspend background tabs.
- **Cloud**: temporary URLs expire (one transparent refresh, then a clear error); seeking on remote streams depends on provider Range support; OAuth needs your own client IDs.
- **Outputs**: device selection is Chromium-only; elsewhere the system output is used. Device names stay hidden until a media permission is granted (browser privacy rule).
- **Scope**: a web page cannot EQ other apps or system audio, provide bit-perfect output proofs, exclusive DAC access, true-peak limiting (ours is sample-peak), or SPL-calibrated loudness.
- **Providers**: Spotify/YouTube/Apple/Deezer/Tidal/SoundCloud playlist transfer is not shipped — export to a file and use Import instead.

## License

Application source: **MIT** — see [LICENSE](LICENSE).

Measurement/preset catalog data: **separate licenses** (primarily CC BY-SA 4.0 with contributor attribution) — see [`docs/catalog-data-licenses.md`](docs/catalog-data-licenses.md) and [`docs/measurement-data-licenses.md`](docs/measurement-data-licenses.md).
