/**
 * In-app audio guides: user-oriented help, not developer docs.
 * Structured for accordions/tables/callouts in GuidesView; mirrored by
 * docs/user-guide/*.md for the public site. No DSP math changes here.
 */

export interface GuideSection {
	heading: string;
	paragraphs?: string[];
	bullets?: string[];
	table?: { head: string[]; rows: string[][] };
	callout?: { kind: "tip" | "warning" | "note"; text: string };
}

export interface Guide {
	id: string;
	title: string;
	category: string;
	summary: string;
	sections: GuideSection[];
}

export const GUIDE_CATEGORIES = [
	"Getting Started",
	"EQ",
	"DSP",
	"Devices",
	"AutoEQ",
	"Measurements",
	"Playback",
	"Formats",
	"Playlists",
	"Cloud Music",
	"Troubleshooting",
	"Privacy",
] as const;

/** Pending guide for contextual "Learn" links (set before navigating). */
let pendingGuideId: string | null = null;
export function requestGuide(id: string): void {
	pendingGuideId = id;
}
export function consumePendingGuide(): string | null {
	const id = pendingGuideId;
	pendingGuideId = null;
	return id;
}

export const GUIDES: Guide[] = [
	{
		id: "getting-started",
		title: "Getting Started",
		category: "Getting Started",
		summary: "From zero to music in twelve steps.",
		sections: [
			{
				heading: "Twelve steps",
				bullets: [
					"1. Add music: Music → Add files (or drag & drop audio files anywhere).",
					"2. Browse Music: All, Albums, Artists, Genres, Recently Played, Favorites.",
					"3. Play a track: hover a row and press Play, or double-click.",
					"4. Open Now Playing: tap the player bar for artwork, progress, queue, lyrics.",
					"5. Select a device: Devices → pick your headphone/IEM (or stay on Global).",
					"6. Load an EQ preset: EQ & DSP → Presets → Use.",
					"7. Adjust EQ: small moves first; watch the headroom hint under Preamp.",
					"8. Save a profile: Devices → save the current sound to that device.",
					"9. Use AutoEQ if a measurement exists for your device.",
					"10. Use A/B comparison to judge changes at matched loudness.",
					"11. Create playlists from any track row's More menu.",
					"12. Add cloud sources (optional) in Settings → Sources.",
				],
			},
			{
				heading: "Where things live",
				bullets: [
					"Music: your library. Playlists: your collections. Devices: your gear + catalog.",
					"EQ & DSP: tuning, presets, and these guides. Settings: behavior, appearance, privacy.",
				],
			},
		],
	},
	{
		id: "eq-basics",
		title: "EQ Basics",
		category: "EQ",
		summary: "Frequency, gain, Q, filters, preamp, and clipping.",
		sections: [
			{
				heading: "What is EQ?",
				paragraphs: [
					"An equalizer applies frequency-dependent gain: it makes chosen frequency regions louder or quieter while leaving the rest alone. In this player EQ is parametric (you choose frequency, gain, and width per band) or graphic (fixed bands, slider per band).",
				],
			},
			{
				heading: "Frequency",
				paragraphs: [
					"Frequency is measured in Hz (and kHz = 1,000 Hz). Low numbers are bass, high numbers are treble. The boundaries below are practical landmarks, not absolute physiological categories — hearing varies by person and level.",
				],
				table: {
					head: ["Range", "Common name", "What lives there"],
					rows: [
						["20–60 Hz", "Sub-bass", "Rumble, kick-drum weight"],
						["60–250 Hz", "Bass", "Bass guitar, warmth, boom"],
						["250–500 Hz", "Lower mids", "Body, boxiness"],
						["500 Hz–2 kHz", "Midrange", "Vocals, guitars, presence core"],
						["2–6 kHz", "Presence", "Clarity, harshness, sibilance edge"],
						["6–12 kHz", "Treble", "Detail, air start, hiss"],
						["12 kHz+", "Air", "Sparkle, openness"],
					],
				},
			},
			{
				heading: "Gain",
				paragraphs: [
					"Gain is measured in dB. Positive gain boosts a region; negative gain cuts it; 0 dB means no change. Negative gain is often the cleaner tool: cutting a peak avoids adding energy (and clipping risk) the way boosting does.",
				],
			},
			{
				heading: "Q (width)",
				paragraphs: [
					"Q sets how wide a peaking adjustment is. Low Q (e.g. 0.5–1) is broad and musical; high Q (e.g. 4+) is narrow and surgical. Broad changes first, narrow only for specific resonances. No single Q is always best.",
				],
			},
			{
				heading: "Peak filter",
				paragraphs: [
					"A peak (peaking) filter has three controls: center frequency (where), gain (how much), Q (how wide). It is the workhorse for most corrections — for example, −3 dB at 3 kHz with Q 1.2 gently relaxes harshness.",
				],
			},
			{
				heading: "Shelf filters",
				paragraphs: [
					"A low shelf lifts or cuts everything below its turnover frequency; a high shelf does the same above its turnover. Use shelves for broad bass/treble shaping (e.g. +3 dB low shelf at 120 Hz) instead of stacking many peaks.",
				],
			},
			{
				heading: "Graphic EQ",
				paragraphs: [
					"Graphic EQ gives you fixed frequency bands with one slider each. In this player the graphic path uses constant-Q bands. Difference from parametric: faster to sketch a curve, less precise about exact frequencies and widths. Both feed the same engine.",
				],
			},
			{
				heading: "Preamp (headroom)",
				paragraphs: [
					"EQ boosts add energy. If your EQ can add a +5 dB peak, a negative preamp/headroom of about −5 dB keeps the peak from exceeding digital full scale. The EQ screen shows the chain's peak boost and a suggested preamp — one tap applies it.",
				],
				callout: {
					kind: "note",
					text: "The peak estimate is a static curve maximum, not true-peak metering. It is a safety margin, not a loudness certificate.",
				},
			},
			{
				heading: "Clipping",
				paragraphs: [
					"Digital audio clips when the signal exceeds 0 dBFS: the waveform tops are chopped off, which sounds harsh. Boosting many bands without headroom is the usual cause. Fix order: lower preamp first, then reduce boosts, and keep the peak safety limiter on as a backstop.",
				],
				bullets: [
					"Watch: Peak boost readout + suggested preamp in EQ.",
					"Backstop: peak safety limiter (sample-peak, not true-peak).",
				],
			},
		],
	},
	{
		id: "eq-iem",
		title: "EQing an IEM (and Manual EQ)",
		category: "EQ",
		summary: "Step-by-step device EQ, manual technique, and common mistakes.",
		sections: [
			{
				heading: "How to EQ an IEM",
				bullets: [
					"1. Select the device in Devices (or stay on Global for speakers).",
					"2. Load a measurement if one is available for your exact model.",
					"3. Choose a target curve to compare against.",
					"4. Run AutoEQ to fit a correction.",
					"5. Inspect the result: fit range, residual error, band count.",
					"6. Set the recommended preamp (AutoEQ reports one).",
					"7. Listen to familiar reference tracks.",
					"8. A/B against the uncorrected sound at matched loudness.",
					"9. Adjust gently — usually broad, small trims, not a rebuild.",
					"10. Save the profile to the device.",
				],
				callout: {
					kind: "note",
					text: "EQ preference is subjective. Measurements guide you; your ears decide.",
				},
			},
			{
				heading: "How to EQ manually",
				bullets: [
					"Start flat and start small (±1–2 dB moves).",
					"Use broad changes (low Q) before narrow ones.",
					"Don't chase every tiny measurement wiggle — smooth trends matter more.",
					"Prefer cuts over boosts where practical; they cost no headroom.",
					"Change one band at a time, then A/B.",
					"Use 2–3 reference tracks you know intimately.",
					"Keep listening levels safe; louder always sounds 'better' at first.",
				],
			},
			{
				heading: "Common mistakes",
				bullets: [
					"Excessive boosts (e.g. +10 dB shelves) with no preamp compensation.",
					"Extreme Q values that ring or sound hollow.",
					"Chasing measurement noise instead of audible trends.",
					"Ignoring preamp/headroom, then blaming the limiter.",
					"Stacking multiple profiles (device + global + preset) unknowingly.",
					"Judging by loudness instead of matched-level A/B.",
					"Assuming every measurement rig/source is interchangeable.",
					"Changing many bands at once, so nothing is learnable.",
					"Trusting the graph over listening.",
					"Forgetting which device profile is active.",
				],
			},
		],
	},
	{
		id: "autoeq",
		title: "AutoEQ & Smoothing",
		category: "AutoEQ",
		summary: "Measurement → target → compensation → fitted PEQ.",
		sections: [
			{
				heading: "How AutoEQ works here",
				paragraphs: [
					"AutoEQ fits a small set of parametric bands that move a headphone measurement toward a target curve. The chain is: measurement → target → smoothing → compensation (target minus smoothed measurement) → constrained fitting → PEQ plus a recommended preamp.",
				],
				callout: {
					kind: "note",
					text: "AutoEQ is an approximation. Fit range, smoothing, rig differences, and unit variation all limit it — inspect and listen before saving.",
				},
			},
			{
				heading: "Fit range and HF treatment",
				paragraphs: [
					"The fit is clamped to measured data — never extrapolated beyond it. High frequencies are the least reliable region (coupler and placement effects dominate), so fits are deliberately conservative there.",
				],
			},
			{
				heading: "Smoothing: Off / Light / Moderate",
				paragraphs: [
					"Smoothing preprocesses a derived copy of the measurement before fitting; the raw measurement is never modified. More smoothing suppresses narrow detail and fits broad trends; less smoothing preserves more structure but can chase noise. Default is Off — add smoothing only when the fit looks spiky.",
				],
			},
			{
				heading: "Residual error and preamp",
				paragraphs: [
					"Residual error is what remains after the fit — lower is closer, but inaudible decimal-chasing is not the goal. The generated preamp offsets the largest positive correction so the result doesn't clip; always apply it.",
				],
			},
			{
				heading: "Quick tips",
				bullets: [
					"Choose the correct device and verify the measurement (source, channel, rig).",
					"Inspect the fit range and residual before saving.",
					"Check the generated preamp — apply it.",
					"Listen on reference tracks before saving the profile.",
				],
			},
		],
	},
	{
		id: "devices",
		title: "Devices, Profiles & Measurements",
		category: "Devices",
		summary: "Catalog, profiles, measurements, targets, presets, AutoEQ.",
		sections: [
			{
				heading: "Concepts",
				table: {
					head: ["Term", "Meaning"],
					rows: [
						["Catalog", "The searchable device database with measurements."],
						["Device profile", "Your saved sound for one device (EQ + DSP)."],
						["Measurement", "A recorded frequency curve of a device on a rig."],
						["Target", "The curve you compare/fit against."],
						["Preset", "A saved EQ/DSP configuration, portable and shareable."],
						["AutoEQ", "A fitted correction from measurement to target."],
					],
				},
			},
			{
				heading: "Global → device",
				paragraphs: [
					"Without a device selected you edit the Global profile. Selecting a device switches the active tuning to that device's profile: a catalog preset you copied, an AutoEQ result, or your manual edits. Switching back to Global restores the global sound. Each profile is independent.",
				],
			},
			{
				heading: "Measurements differ",
				paragraphs: [
					"Measurements from different sources and rigs can differ audibly — couplers, tips, seal, and units all matter. Prefer measurements from one trusted source for comparisons, and never treat any single curve as universally 'correct'.",
				],
				callout: {
					kind: "warning",
					text: "A curve is a measurement of one unit on one rig, not a verdict on your ears.",
				},
			},
		],
	},
	{
		id: "dsp",
		title: "DSP Guide",
		category: "DSP",
		summary: "Every processor: what, when, when not, mistakes, safety.",
		sections: [
			{
				heading: "Signal path (actual implementation)",
				paragraphs: [
					"Source → ReplayGain + preamp → EQ (parametric or graphic) → tone shelves → dynamics → spatial → reverb (parallel wet branch) → peak safety limiter → output. Volume lives after everything on the master gain.",
				],
			},
			{
				heading: "Preamp — what it does",
				paragraphs: [
					"A flat gain trim before the EQ bands. Its job is headroom: offset the largest EQ boost so peaks stay under 0 dBFS.",
				],
				bullets: [
					"Use when: any EQ/DSP stage adds net positive gain.",
					"Don't use as: a volume knob (use Volume for that).",
					"Mistake: positive preamp on top of big boosts.",
					"Safety: negative preamp is the primary clipping defense; the limiter is the backstop.",
				],
			},
			{
				heading: "Bass / Treble — shelving tone",
				paragraphs: [
					"Broad shelves with visible turnover points: bass affects everything below its turnover, treble everything above. A bass shelf differs from a narrow PEQ bass peak — the shelf tilts the whole region, the peak targets one area. Start with ±1–3 dB.",
				],
				bullets: [
					"Use when: a recording or device needs a broad tilt.",
					"Don't: stack a shelf plus an identical PEQ boost unknowingly.",
					"Mistake: +12 dB bass shelf with no preamp change.",
				],
			},
			{
				heading: "Bass Tuner",
				paragraphs: [
					"Controlled low-frequency shaping: amount (lift), center (where), sub emphasis (deep extension), resonance (tightness). It is tone shaping, not automatic IEM correction — it knows nothing about your device.",
				],
			},
			{
				heading: "Compressor",
				paragraphs: [
					"Reduces dynamic range: signals above the threshold are turned down by the ratio, with attack (how fast), release (how fast it lets go), knee (how gradual the onset is), and makeup gain (output trim). The gain-reduction meter shows live dB reduction.",
				],
				bullets: [
					"Music uses: gentle leveling of uneven recordings, night listening.",
					"Speech uses: podcast/voice consistency (low threshold, moderate ratio).",
					"Don't: high ratio + low threshold + fast attack on music — it pumps and flattens.",
					"Safety: makeup gain adds level — recheck headroom after raising it.",
				],
			},
			{
				heading: "Peak safety limiter",
				paragraphs: [
					"The peak safety limiter is a sample-peak backstop against EQ-boost overshoot, with an adjustable ceiling (−12…0 dBFS). It is NOT a true-peak limiter (no oversampling), so inter-sample overs are still possible — proper preamp gain staging comes first.",
				],
			},
			{
				heading: "Balance / Mono / Swap / Solo",
				paragraphs: [
					"Balance pans left–right. Mono sums both channels (single-earbud listening, compatibility checks). Swap exchanges channels (cable/routing tests). Left-only and Right-only isolate one channel (driver/imbalance troubleshooting). Accessibility and testing are the main uses — leave them neutral for normal listening.",
				],
			},
			{
				heading: "Stereo width",
				paragraphs: [
					"Width above 100% exaggerates side information; below narrows toward mono. Extreme widening can sound unnatural and cancel in mono playback (phase interaction) — check mixes in mono mode if you widen.",
				],
			},
			{
				heading: "Crossfeed",
				paragraphs: [
					"Headphone crossfeed blends a little of each channel into the other, softening extreme left/right separation that headphones exaggerate versus speakers. It is an imaging aid, not room simulation, and entirely preference-dependent.",
				],
			},
			{
				heading: "Reverb",
				paragraphs: [
					"Adds artificial room ambience from a locally generated impulse (no files): room size, decay, damping (brightness), mix (wet amount), pre-delay. Default is OFF — critical listening usually wants none. A little mix (5–15%) is plenty for the effect.",
				],
			},
			{
				heading: "Relative loudness",
				paragraphs: [
					"Approximate compensation for low listening levels (ears hear less bass/treble when quiet). It fades to zero at the reference level. Browser volume is not calibrated SPL, so no absolute loudness claim is possible — treat it as a tasteful tilt, not a certified calibration.",
				],
			},
			{
				heading: "Quick tips",
				bullets: [
					"Start flat. Use small changes. Keep headroom (apply the suggested preamp).",
					"A/B at matched loudness — louder always flatters.",
					"Don't chase every measurement wiggle with narrow bands.",
				],
			},
		],
	},
	{
		id: "replaygain",
		title: "ReplayGain & Loudness",
		category: "Playback",
		summary: "Track/album gain, preamp interaction, clipping protection.",
		sections: [
			{
				heading: "Track vs album gain",
				paragraphs: [
					"ReplayGain reads loudness tags and applies one gain offset: track mode equalizes songs with each other; album mode preserves the album's internal balance and equalizes albums with each other. Off disables it entirely.",
				],
			},
			{
				heading: "Preamp interaction",
				paragraphs: [
					"ReplayGain and your manual preamp are added once at the single gain point before EQ — never double-applied. Large positive ReplayGain values eat headroom exactly like EQ boosts, so the limiter and preamp readout account for them.",
				],
			},
		],
	},
	{
		id: "playback",
		title: "Playback",
		category: "Playback",
		summary: "Queue, crossfade, rate, background, Media Session, shortcuts.",
		sections: [
			{
				heading: "Queue, shuffle, repeat",
				paragraphs: [
					"The queue is the playback order. Shuffle reorders upcoming items; repeat cycles off → all → one (repeat-one affects natural endings only — manual Next always advances). Removing the current item advances into whatever slid into its place.",
				],
			},
			{
				heading: "Crossfade and rate",
				paragraphs: [
					"Crossfade blends track endings into beginnings with an equal-power curve (0.5–12 s) using the preloaded standby deck. Playback rate (0.25–2×) changes speed; Preserve pitch keeps musical pitch while changing tempo, or gives the classic tape effect when off.",
				],
			},
			{
				heading: "Background playback",
				paragraphs: [
					"After you press play, audio continues when you switch tabs, minimize, or lock the screen (where the browser and OS permit). The app never pauses audio because the page hid — hiding only slows visualizers and timers. Lock-screen transport uses the OS media controls via Media Session where supported.",
				],
				callout: {
					kind: "note",
					text: "OS lock-screen behavior varies: some mobile browsers restrict background audio or artwork. Playback state always resyncs when you return.",
				},
			},
			{
				heading: "Keyboard shortcuts",
				table: {
					head: ["Key", "Action"],
					rows: [
						["Space / K", "Play / pause"],
						["← / →", "Seek 5 s"],
						["Ctrl+← / Ctrl+→", "Previous / next track"],
						["M", "Mute"],
						["Q", "Queue"],
						["E", "EQ & DSP"],
						["Ctrl/⌘+K", "Command palette"],
					],
				},
			},
		],
	},
	{
		id: "formats",
		title: "File Formats",
		category: "Formats",
		summary: "What plays, what tags, container vs codec.",
		sections: [
			{
				heading: "Support reality",
				paragraphs: [
					"A container (e.g. MP4/M4A, Ogg, WAV) holds audio encoded with a codec (e.g. AAC, Vorbis, Opus, FLAC, MP3). The browser — not this app — decides which codecs decode. Chromium-family browsers cover MP3, AAC/M4A, Vorbis, Opus, WAV, and usually FLAC; Safari and Firefox differ by version and OS.",
				],
			},
			{
				heading: "Metadata",
				paragraphs: [
					"Title/artist/album/artwork come from file tags when present, falling back to filenames. Some formats carry richer tags than others; missing artwork or duration usually means the file lacks the tag, not a bug.",
				],
				callout: {
					kind: "note",
					text: "No universal compatibility is claimed. If a file won't decode, the player banner says so and auto-advance skips to the next playable item.",
				},
			},
		],
	},
	{
		id: "playlists",
		title: "Playlists & Import",
		category: "Playlists",
		summary: "Local playlists, file import, and external matching.",
		sections: [
			{
				heading: "Local playlists",
				paragraphs: [
					"Playlists are ordered lists of your library tracks with a name, artwork collage, and count. Add tracks from any More menu; reorder and remove inside the playlist detail.",
				],
			},
			{
				heading: "Importing external playlists",
				paragraphs: [
					"File import (M3U and similar) and supported Spotify transfers read external playlist metadata and match each entry against your local library: matched (confident), ambiguous (several candidates — you pick), unmatched (no local equivalent).",
				],
				callout: {
					kind: "note",
					text: "The app never downloads streaming audio. Import matches metadata to files you already have.",
				},
			},
		],
	},
	{
		id: "cloud",
		title: "Cloud Music",
		category: "Cloud Music",
		summary: "Sources, remote playback, auth, privacy.",
		sections: [
			{
				heading: "How it works",
				paragraphs: [
					"A cloud source is an opt-in connection (e.g. storage providers) whose file metadata appears alongside your library. Remote playback streams via short-lived temporary URLs obtained at play time — cloud audio is not downloaded into your local library automatically.",
				],
			},
			{
				heading: "Auth, reconnect, privacy",
				bullets: [
					"Authentication uses each provider's OAuth flow; tokens stay in your browser.",
					"Expired sessions or URLs trigger one transparent refresh, then a clear error.",
					"Disconnecting a source removes its tracks from view; local files are untouched.",
					"Cloud is strictly opt-in — nothing contacts a provider until you connect one.",
				],
			},
		],
	},
	{
		id: "measurements",
		title: "Measurements",
		category: "Measurements",
		summary: "Curves, rigs, channels, and why sources differ.",
		sections: [
			{
				heading: "Concepts",
				table: {
					head: ["Term", "Meaning"],
					rows: [
						["Measurement", "A recorded frequency curve of a device."],
						["Source", "Who measured it and where it is published."],
						["Channel", "Left, right, or averaged earpiece data."],
						["Rig", "The coupler/fixture the measurement was taken on."],
						["Frequency curve", "Gain vs frequency — the raw observation."],
						["Target", "The reference curve you compare against."],
					],
				},
			},
			{
				heading: "Why sources differ",
				paragraphs: [
					"Measurements from different sources and rigs may differ: couplers, tips, seal, insertion depth, and unit variation all move the curve — especially in the treble. No single curve is universally 'correct'; use one trusted source per comparison and let listening decide.",
				],
			},
		],
	},
	{
		id: "privacy",
		title: "Privacy",
		category: "Privacy",
		summary: "Local-first guarantees.",
		sections: [
			{
				heading: "Guarantees",
				bullets: [
					"Your local music stays local — files are never uploaded for matching or playback.",
					"Cloud services are opt-in and only contacted after you connect them.",
					"External APIs are used only when explicitly needed (e.g. an authorized cloud fetch).",
					"Auth data (tokens) is stored locally in your browser; disconnect wipes the session.",
					"No analytics, no tracking, no account, no backend.",
				],
			},
		],
	},
	{
		id: "troubleshooting",
		title: "Troubleshooting",
		category: "Troubleshooting",
		summary: "Actionable fixes for common problems.",
		sections: [
			{
				heading: "Playback doesn't start",
				bullets: [
					"Check the banner text: missing file (re-import or reconnect the folder) vs unsupported codec (try another browser).",
					"Autoplay policies require one user gesture — press play once after loading.",
					"Remote track failing? Reconnect the cloud source (sessions rotate).",
				],
			},
			{
				heading: "Audio is too quiet",
				bullets: [
					"Check Volume, mute, and OS/browser volume — then preamp (large negative values are quiet by design).",
					"ReplayGain track mode on quiet-tagged files lowers level; compare with Off.",
					"Heavy compression with no makeup gain reduces level; raise makeup slightly.",
				],
			},
			{
				heading: "Audio clips / distorts",
				bullets: [
					"Apply the suggested preamp in EQ (peak boost readout).",
					"Reduce the largest boosts before raising anything else.",
					"Keep the peak safety limiter on; lower its ceiling for extra margin.",
					"Check compressor makeup gain — it adds level after compression.",
				],
			},
			{
				heading: "EQ sounds different / isn't active",
				bullets: [
					"Confirm EQ enabled (not just bands enabled) and DSP not bypassed/A-B comparing.",
					"Check the active device badge — you may be editing Global while listening to a device profile.",
					"Graphic vs parametric: only the selected mode is live.",
				],
			},
			{
				heading: "Wrong device profile",
				bullets: [
					"Open Devices and verify which profile is active; use Back to global to reset.",
					"Catalog imports are copies — re-import after catalog updates if needed.",
				],
			},
			{
				heading: "Cloud source unavailable",
				bullets: [
					"Reconnect the source (tokens expire). Check network and provider status.",
					"Mid-playback failures refresh once automatically; persistent errors need reconnect.",
				],
			},
			{
				heading:
					"Playlist track unmatched / Lyrics missing / CUE doesn't appear",
				bullets: [
					"Unmatched: the local library lacks that recording — check spelling/metadata or add the file.",
					"Lyrics: only embedded or sidecar lyrics display; instrumental tracks show none.",
					"CUE: the sheet must parse with valid track times and an accessible audio file.",
				],
			},
			{
				heading: "Background playback stopped",
				bullets: [
					"This app never pauses on page hide. If audio stopped, the OS/browser suspended it (common on mobile lock screens) or the stream URL expired (cloud) — return to the tab and press play.",
					"Keep one audible tab; some browsers throttle fully-muted or backgrounded contexts aggressively.",
				],
			},
			{
				heading: "Media Session / output selection unavailable",
				bullets: [
					"Media Session keys depend on OS/browser support — in-app transport always works.",
					"Output-device selection is Chromium-only (setSinkId); other browsers use the system output.",
				],
			},
		],
	},
];

export function guideById(id: string): Guide | null {
	return GUIDES.find((g) => g.id === id) ?? null;
}
