# Player features

Local + cloud playback, library, queue, playlists, search, and transport
in one place. DSP specifics live in `docs/audio-engine.md` and
`docs/dsp.md`; device layers in `docs/device-profiles.md`.

## Playback

Dual-deck engine (gapless snap via preload swap, equal-power crossfade
0.5–12 s on the audio clock), playback rate 0.25–2× with optional pitch
preservation (browser `preservesPitch`; off = tape effect), per-deck
remote-URL support for cloud tracks. MediaSession (title/artist/album/
artwork, play/pause/stop/prev/next/seek actions, position state),
background-tab resync, rapid-action race guards. Gapless is
preload-swap gapless — not claimed sample-perfect.

## Library

Local files/folders (File System Access where supported) plus cloud
accounts (Drive/OneDrive/Dropbox/Box — see `docs/cloud-music.md`).
Stable FNV identity, incremental scan→diff→apply, background
revalidation with explicit permission states, IndexedDB persistence
(additive migrations only), artwork cache with content-hash dedupe.
Embedded lyrics (USLT/synced) and ReplayGain tags are read at import;
`.lrc` sidecars match by directory + stem. Views: tracks, albums,
artists, genres, recent, favorites, sources. Sort: title, artist, album,
year, duration, date added, source, format. Search covers
title/artist/album/album-artist/genre.

## Queue

Enqueue, play-next, remove, reorder, clear, save-as-playlist.
Deterministic shuffle (explicit permutation, current-first, no repeats
until exhausted), repeat off/all/one with the specified next/previous
matrix. Queue + transport modes persist across reloads.

## Playlists

Manual playlists (create/rename/reorder/remove/delete), save-queue-as-
playlist, smart playlists (recently/most/never played, favorites,
5-star, recently added, long tracks, FLAC, lossless — derived, never
stored), CUE sheet import (virtual segment tracks sharing one file's
bytes, bounded auto-advance between segments, seek precision is
browser-dependent), playlist-file import (M3U/M3U8/CSV/JSON with
match review — see `docs/playlist-import.md`).

## Lyrics

Embedded USLT/plain/synced tags plus `.lrc` sidecars and manual attach.
Now Playing → Lyrics tab with synchronized auto-scroll (toggleable) and
reduced-motion respect. No network lyric services, ever.

## Visualizations & analysis

Now Playing → Visuals: spectrum bars, waveform, and peak meter from a
lazily tapped AnalyserNode. Cheap by design (one small canvas, ~64
bins): rAF only while visible and playing, paused in background tabs,
single static frame under prefers-reduced-motion. The tap observes only
— the audio path is untouched. Now Playing → Info: container, codec,
sample rate, channels, bit depth, bitrate, duration, size, ReplayGain
tags, render rate — unknowns labeled unknown, never guessed. Peak/
loudness estimates are not computed (would require a full decode) and
the panel says so.

## Cloud parity

Cloud tracks play, seek (where the provider permits ranges), queue,
shuffle, crossfade, take EQ/DSP, publish MediaSession, and persist in
playlists/history exactly like local tracks — one engine, one chain.
Offline they show metadata with an unavailable state; nothing is
deleted for being unreachable. Details: `docs/cloud-music.md`.

## Settings

Sections: Appearance, Audio (crossfade, EQ/DSP status, IEM profile,
output device, render rate, pitch preservation, ReplayGain mode),
Music library, Cloud music sources, Connected services (playlist
import), Backup & restore (device profiles, EQ backup, safe settings —
validated import that skips existing records), Keyboard shortcuts,
Privacy, About. Backup files are plain local JSON.

## Keyboard

Space/K play-pause, ←/→ seek 5 s, Ctrl/⌘+←/→ previous/next, M mute,
Q queue, E EQ, F library, L Now Playing. Inactive while typing or when
a control already handles the key.

## PWA / offline

Installed shell plays local files fully offline (service-worker cached
app + IndexedDB library). Cloud tracks need a network by nature and say
so instead of failing silently.
