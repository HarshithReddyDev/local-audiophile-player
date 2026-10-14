# Architecture (Phase 4: advanced playback)

## Current pipeline

```
Local file (File/Blob, never uploaded)
  → LibraryScanner (tags via music-metadata, chunked with UI yields)
  → LibraryService (stable ids, diff, artwork cache, history, queue persist)
  → LibraryRepository (IndexedDB via idb; sole IDB touchpoint)
  → library-store (UI/runtime state hydrated from the repository)
  → player-store (queue + shuffle-order model, transport state, xfade prefs)
  → use-playback controller (sole engine owner: preload, fades, races, MediaSession)
  → PlaybackEngine
      deckA/deckB elements → per-deck gains → mix Gain → DSP (preamp → PEQ → limiter) → master Gain → destination
  → UI (PlayerBar, TrackList, QueuePanel, EQView, IEMView, …) reads stores only
```

IEM data flows beside playback, never through it: curve files → parser →
`LibraryService` (measurements/targets/profiles in IndexedDB v2) → iem
store → profile page graphs. AutoEQ reads profiles and writes
`PEQProfile`s through a Web Worker; the engine cannot distinguish fitted
from hand-made EQ. Validation corpus, reports, and figures live in
`tests/autoeq/`.
Details: `docs/measurements.md`, `docs/targets.md`, `docs/iem-profiles.md`,
`docs/measurement-data-licenses.md`, `docs/autoeq.md`,
`docs/autoeq-research.md`, `docs/autoeq-validation.md`,
`docs/autoeq-validation-corpus.md`.

React components never touch media elements. All engine output flows through
subscribed events into the player store.

## Module boundaries

- `src/types/library.ts` — serializable domain models. `Track` carries no
  `File`; bytes live in `AudioFileReference`-style registry (`files: Map` in
  the library store) so tracks can move to IndexedDB unchanged.
- `src/state/` — three Zustand stores for UI/runtime state only. The
  persistent database owns durable data; `LibraryService` syncs it into the
  stores. Only preferences persist to localStorage now (transport prefs);
  library data lives in IndexedDB.
- `src/db/` — `idb`-backed repository (tracks, sources, artwork Blobs,
  playlists, favorites, ratings, history/stats), versioned migrations,
  handle-permission helpers, FNV stable identity, refcounted artwork cache.
- `src/library/library-service.ts` — orchestration: restore, incremental
  ingest (`scan → diff → apply`), file resolution for playback, history
  events, artwork URLs. UI never calls IndexedDB directly.
- `src/audio/engine/playback-engine.ts` — the only DOM-audio module.
  Dual decks with per-deck gains into mix → master; preload + equal-power
  crossfade scheduled on the audio clock. Injectable element/graph factories
  keep it unit-testable in Node (no jsdom). Full detail:
  `docs/playback-engine.md`.
- `src/library/scanner.ts` — import abstraction (`scanFiles`,
  `scanDirectory`, `refresh`-ready). Persistence plugs in behind it later.
- `src/library/metadata.ts` — tag parsing with filename fallback; dynamically
  imported so the parser stays out of the initial chunk. Duration always comes
  from the media element (`loadedmetadata`), not tags.
- `src/features/*` — one folder per user-facing area, each with its
  components + hooks. `use-playback.ts` is the single wiring point and also
  publishes MediaSession metadata.

## Future DSP insertion point

Volume today is owned by the **master gain node** (element volume stays 1);
rate stays on the element. Later stages slot between source and master with
no caller changes:

```
Source → [Preamp → EQ → Limiter → Analyzer] → Master → destination
```

No Worklet/WASM/SharedArrayBuffer until measured need (AGENTS.md §Audio/DSP).

## Browser constraints (verified, not assumed)

- Playback formats = whatever the browser decodes (no decoder stack).
- `showDirectoryPicker` behind `supportsDirectoryPicker()`; file input +
  drag-and-drop are the universal fallback. Picker grant ≠ offline access:
  the service worker precaches the app shell only, never user files.
- AudioContext starts suspended (autoplay policy); the engine resumes it
  inside the user-gesture play path. Programmatic import (e.g. synthetic
  file inputs) still plays because headless/test Chromium allows it and real
  usage always follows a click.
- `play()` interrupted by a superseding `load()` surfaces AbortError, which
  the engine deliberately does not report (the newer load owns the element).

## Local-first model

Stored in IndexedDB (private, on-device): track metadata, folder handles,
artwork thumbnails, playlists, favorites, ratings, play history/stats.
Stored in localStorage: theme, transport prefs, selected IEM profile id.
Never stored or sent anywhere: audio bytes. Relative paths stay on device
inside the local database. Full details: `docs/library-persistence.md`.

## GitHub Pages constraints

- Single `base` constant in `vite.config.ts` from `VITE_BASE` (default `/`).
  The deploy workflow derives `/<repo>/` (or `/` for `*.github.io` sites).
- No router library: views are state, so there are no deep links to rewrite
  and no 404 fallback hacks needed. PWA `scope`, `start_url`, and manifest
  icons all derive from the same base.
- Icons are committed binaries generated by dependency-free
  `scripts/generate-icons.mjs` (RGBA PNGs + SVG source).
- CI verifies the Pages build: shell, manifest, icons, service worker exist
  and no absolute asset URL escapes the base path.

## Decisions intentionally postponed

Worker-based bulk tagging (scanner interface is worker-compatible),
list virtualization (10k grouping measures 13 ms — not yet needed), router
(state views cover all navigation), auth/accounts (never planned), any DSP
beyond transport.
