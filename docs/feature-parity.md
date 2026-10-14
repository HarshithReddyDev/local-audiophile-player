# Feature parity matrix

Independent implementation throughout — no proprietary code, UI, text,
or assets from any product below. "Parity" means equivalent user-facing
functionality, verified in this repo; browser limits are stated, not
worked around.

Status key: **DONE** · **PARTIAL** (works with stated limits) ·
**BROWSER-LIMITED** (capability ceiling, UI says so) ·
**NOT APPLICABLE** (no honest browser equivalent) · **PLANNED**.

| Feature | Poweramp | Poweramp EQ | Wavelet | Our player | Browser limit | Status |
|---|---|---|---|---|---|---|
| Parametric EQ (peaking/shelf/pass/notch) | Yes | Yes | AutoEq import | 12-band editor + drag graph + presets | None | DONE |
| Graphic EQ 5–32 bands | to 32 | to 32 | 9 + GraphicEQ | 5/10/15/20/31/32 layouts, constant-Q documented | None | DONE |
| Bass / treble | Yes | Yes | Bass tuner | Shelves + turnover + tuner w/ sub + resonance | None | DONE |
| Preamp + headroom estimate | Yes | Yes | Auto preamp | Manual + AutoEQ + RG, peak readout, one-click compensation | None | DONE |
| Peak limiter | Yes | Yes | Limiter | Sample-peak safety limiter, ceiling, bypass | No true-peak (no oversampling) | PARTIAL |
| Compressor + GR meter | Yes | Yes | — | Threshold/ratio/knee/attack/release/makeup + live meter | Curve is the browser node's | DONE |
| Balance / mono / swap / solo | Yes | Yes | — | 2×2 matrix, all modes, local + cloud | None | DONE |
| Stereo width | — | — | — | Mid-side 0–1.5, mono-cancellation warning | None | DONE |
| Virtualizer purpose | — | — | Yes | Crossfeed + width as labeled imaging aids, never room simulation | No HRTF/personalization | PARTIAL |
| Reverb | — | — | — | Generated-IR convolver, mix/decay/damping/size/predelay, default off | Synthetic ambience only (labeled) | DONE |
| Equal loudness | — | — | ISO-based | Relative approximate compensation, no SPL claims | No calibration, no ISO contour | PARTIAL |
| Device profiles (per-device DSP) | Yes | Yes | AutoEq presets | Global→device layers, capture/apply/backup | Manual selection (no HW detection) | DONE |
| AutoEQ headphone fitting | via presets | via presets | Yes | Built-in optimizer + 6k-device catalog + apply-to-profile | None | DONE |
| Device database UX | — | AutoEq list | AutoEq list | 6,229 devices, presets, Use-device, favorites | None | DONE |
| Preset import/export | Yes | Yes | GraphicEQ | Native/GraphicEQ/APO-txt/CSV + backup/restore | No proprietary binaries (by policy) | DONE |
| ReplayGain | Yes | — | — | Tag read, track/album/off, peak guard, single apply point | Tags only (no scanning) | DONE |
| Playback speed + pitch hold | Yes | — | — | 0.25–2×, preservesPitch toggle | Browser-implemented | DONE |
| Crossfade / gapless | Yes | — | — | Equal-power crossfade, preload-swap gapless (not sample-perfect) | No sample-perfect claim | DONE |
| Output / resampling info | Yes | Yes | — | Render rate, device select where supported | No exclusive/bit-perfect/DAC | BROWSER-LIMITED |
| Lyrics (synced) | Yes | — | — | Embedded + .lrc, synced scroll, local only | No lyric services (by policy) | DONE |
| CUE sheets | Yes | — | — | Parse, virtual tracks, bounded auto-advance | Seek precision is browser-dependent | PARTIAL |
| Visualizations | Yes | — | — | Spectrum/waveform/peak, pausable, reduced-motion aware | Analyser-tap only; mobile-cheap defaults | DONE |
| Track analysis | Yes | — | — | Tags + render rate; unknowns labeled | No full-decode estimates | PARTIAL |
| Smart playlists | Yes | — | — | 9 deterministic rules, derived not stored | Metadata-only rules | DONE |
| Cloud-file playback | — | — | — | Drive/OneDrive/Dropbox/Box through one chain | Provider OAuth setup per user | DONE |
| Global search | Yes | — | — | Per-section search + filters + smart rules (no unified palette) | Large-library perf by design | PARTIAL |
| Playlist export | Yes | — | — | M3U export (local paths; remote/cue as best-effort refs) | Re-import matches by filename | DONE |
| Playlist import/migration | — | — | — | M3U/M3U8/CSV/JSON + match review + CUE | No streaming-audio download (by policy) | DONE |
| System-wide EQ | — | **Yes** | **Yes** | Not possible in-browser; UI + docs state this | OS/app boundary | NOT APPLICABLE |
| True-peak limiting | Claimed | Claimed | — | Labeled sample-peak instead | No oversampling chain | BROWSER-LIMITED |
| Bit-perfect / exclusive / DVC | Yes | Yes | — | Not claimed anywhere | Browser mixer owns output | NOT APPLICABLE |
| Auto hardware detection | Yes | Yes | Yes | Manual selection | No Web API for it | NOT APPLICABLE |
| ISO-226 calibrated loudness | — | — | Yes | Approximate relative mode; full ISO planned pending reference data | Licensed data + SPL calibration | PLANNED |
| Streaming-service playback | — | Via apps | — | Never (local-first policy) | Policy, not browser | NOT APPLICABLE |

Competitor columns describe publicly known product capabilities at a
high level (marketing/docs level, 2026); no competitor internals were
used. Anything marked DONE above is covered by unit tests plus
Chromium/mobile e2e in this repo.
