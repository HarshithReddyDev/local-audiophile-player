# Playback engine (Phase 4)

## Architecture

```
deckA element → deckA gain ─┐
                             ├→ mix Gain → master Gain → destination
deckB element → deckB gain ─┘
```

Two `HTMLAudioElement` decks; one active, one standby. Each deck has its own
`MediaElementSource → GainNode` chain into a shared `mix` gain, then a
`master` gain (output volume/mute), then destination. Volume lives only on
master; rate is set on both elements; mute never loses the volume level.

**Phase 5 insertion:** preamp → EQ → limiter → analyzer slot between `mix`
and `master` (`getMixNode()`/`getMasterNode()`). Decks are untouched by DSP
work. No Worklet/WASM/SAB introduced — nothing in this phase needed them.

## Playback states

Exactly one `status` holds: `idle → loading ⇄ playing ⇄ paused → ended`,
plus `ready` (restored queue entry, press play) and `error`. `seeking` is an
orthogonal boolean (matches platform element semantics), so contradictory
`loading + playing` combinations are unrepresentable.

## Queue persistence

`meta["queue-state"]`: `{version, trackIds, index, repeat, shuffle,
crossfadeEnabled, crossfadeDuration}` — no playback position (deliberate).
Saved on every queue/transport change; restored after library hydration with
unknown ids dropped and the index clamped (`parseQueueState` rejects malformed
shapes to a fresh queue — migration-safe). Restored entries start `ready`,
never auto-playing (autoplay needs a gesture anyway).

## Next/previous semantics

| Situation | Behavior |
|---|---|
| repeat off, natural end | `ended`, stay |
| repeat off, manual next at end | `ended` (no silent wrap) |
| repeat one, natural end | replay same (time reset) |
| repeat one, manual next | advance (one affects endings only) |
| repeat all | wrap both directions |
| previous, time > 3s | restart current (no queue move) |
| previous, at start | `null` → controller seeks 0 |
| missing target, auto-advance | skip forward, bounded by queue length |
| missing target, direct play | error banner guiding re-import/reconnect |

Unit-tested per row in `player-store.test.ts`.

## Shuffle model

Explicit permutation of stable queue ids, current first, consumed
front-to-back: no repeats until exhaustion; previous walks the pointer back;
repeat-all reshuffles at exhaustion. Enqueued items join the unplayed tail;
enqueue-next splices right after current (its name promises position);
moves need no remapping (ids are stable); removals filter the order.
Deterministic under an injectable RNG (`setShuffleRng`/`seededRng`).

## Gapless strategy (honest)

Preload lookahead of exactly one: on `loadedmetadata` and when remaining <
20s, the upcoming queue id (peeked, never mutating) resolves and stages on
the standby deck. Natural end swaps instantly (`activatePreload`) when the
staged key matches; otherwise a resolving load plays (small setup gap).

What is guaranteed: no full teardown/rebuild between tracks, bounded to two
elements + two object URLs, preload failures surface as `preloaderror`
without touching the active track. What is NOT claimed: sample-accurate
continuity — browsers expose no sample-perfect handover for media elements
(the dual-element boundary may carry a small setup gap; measured functional
transition, not waveform joins). A future AudioBuffer pipeline could close
that gap at the cost of whole-file decode + rewritten seek/rate semantics —
explicitly deferred (see §Advanced-technology gate).

## Crossfade

Off by default (gapless snap is untouched when disabled). When enabled:
0.5–12 s (UI slider, persisted), equal-power curves
(`out=cos(t·π/2)`, `in=sin(t·π/2)`, so out²+in²=1 — unit-tested incl.
endpoints and clamping) scheduled with `setValueCurveAtTime` on the audio
clock; bookkeeping via timer only. Trigger: remaining ≤ duration while the
staged key matches the peeked next id (repeat-one self-transitions excluded).
Seek/pause/manual-load cancel the fade and snap gains back; a cancel landing
mid-`play()` stops the standby and settles the promise as incomplete.

## Preload policy

One standby deck max; staging starts on metadata + 20 s threshold; results
dropped if the queue moved while resolving; one retry guard per queue
position for failures. Measured: three 30 s tracks + staged preload ≈
9.5 MB JS heap — elements stream, nothing holds decoded buffers.

## AudioContext lifecycle

One context, created lazily on first load, resumed inside the play path
(sticky user activation covers auto-advance and fade starts). Never
suspended for backgrounding (the element must keep rendering). If creation
is unavailable the engine drives elements directly (volume/rate fallback).
`destroy()` pauses both decks, revokes URLs, closes the context.

## Media Session

Handlers: play, pause, stop, previoustrack, nexttrack, seekbackward,
seekforward (offset-aware), seekto. Metadata (title/artist/album + lazy
artwork) and throttled `setPositionState` (play/pause/seek/metadata + 5 s
buckets — never per tick). Everything capability-guarded (`setPositionState`
missing on Safari → silent no-op).

Measured support: Chromium 153 full · Firefox 155 (metadata, seekto,
positionState; no folder picker) · mobile Chromium emu full suite green ·
Safari untested (no binary; paths guarded).

## Background playback

Documented, not promised: the element + service worker keep rendering with
the tab hidden or screen locked where the OS allows; `timeupdate` throttles
in background tabs, so the controller resyncs from the engine clock on
`visibilitychange`. OS-specific background kills (mobile battery savers)
are outside web control.

## Rapid-action races

`playTrack` takes a generation token; async continuations from superseded
resolves are dropped — rapid A→B→C→D clicks leave only D authoritative
(e2e-proven, zero error banners). Engine `load()` revokes standby preloads
so stale URLs can't win. Crossfade cancel-while-starting is settled, not
orphaned (regression-tested).

## Errors

Manual selection failure → banner, queue intact. Auto-advance failure →
bounded skip loop, then `ended`. Element errors during a `loading` auto
transition retrigger advance instead of sticking. AbortError from a
superseded `play()` stays silent. Missing files guide to re-import/reconnect.

## AV sync

The engine clock is authoritative: UI time comes from `timeupdate` snapshots
plus visibility resync. Sliders are native labeled ranges (full
keyboard/touch); seeking sets the flag via element `seeking`/`seeked`
events. No `setInterval` clock anywhere.

## Advanced-technology gate (this phase)

Needed nothing beyond two elements + scheduled gains: no WebCodecs,
AudioWorklet, SharedArrayBuffer, WASM/Rust, ring buffers, or full-decode
pipelines. Sample-perfect gapless would justify an AudioBuffer path; the
measured functional transition meets the requirement, so it stays deferred
with the tradeoff recorded above.
