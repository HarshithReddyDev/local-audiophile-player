import { Slider } from "../../components/ui/Slider";
import { REPLAYGAIN_MODES, type ReplayGainMode } from "../../dsp/replaygain";
import { useDspStore } from "../../state/dsp-store";
import { useEQStore } from "../../state/eq-store";
import { useIEMStore } from "../../state/iem-store";
import { usePlayerStore } from "../../state/player-store";
import type { Theme } from "../../state/settings-store";
import { useSettingsStore } from "../../state/settings-store";
import { CloudSources } from "../cloud/CloudSources";
import { CompareControl } from "../dsp/CompareControl";
import { DSPSummary } from "../dsp/DSPSummary";
import { SourceManager } from "../library/SourceManager";
import { BackupControls } from "./BackupControls";
import { AudioOutputControl } from "./OutputControl";

function EqStatus() {
	const enabled = useEQStore((s) => s.profile.enabled);
	const bands = useEQStore(
		(s) => s.profile.bands.filter((b) => b.enabled).length,
	);
	return (
		<span className="text-[13px] text-muted" role="status">
			{enabled ? `On · ${bands} bands` : "Off"}
		</span>
	);
}

function PreservePitchToggle() {
	const preservePitch = useSettingsStore((s) => s.preservePitch);
	return (
		<input
			type="checkbox"
			checked={preservePitch}
			onChange={(e) =>
				useSettingsStore.getState().setPreservePitch(e.target.checked)
			}
			aria-label="Preserve pitch when changing playback speed"
		/>
	);
}

function ReplayGainSelect() {
	const mode = useDspStore((s) => s.replayGainMode);
	return (
		<select
			value={mode}
			onChange={(e) =>
				useDspStore
					.getState()
					.setReplayGainMode(e.target.value as ReplayGainMode)
			}
			aria-label="ReplayGain mode"
			className="rounded-lg border border-line bg-abyss px-2 py-1 text-sm"
		>
			{REPLAYGAIN_MODES.map((m) => (
				<option key={m} value={m}>
					{m === "off" ? "Off" : m === "track" ? "Track" : "Album"}
				</option>
			))}
		</select>
	);
}

function DspMasterToggle() {
	const masterBypass = useDspStore((s) => s.masterBypass);
	return (
		<label className="flex items-center gap-2 text-sm">
			<input
				type="checkbox"
				checked={!masterBypass}
				onChange={(e) =>
					useDspStore.getState().setMasterBypass(!e.target.checked)
				}
				aria-label="Enable DSP chain"
			/>
			<span
				role="status"
				className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
					masterBypass
						? "border-accent/50 text-accent"
						: "border-line text-muted"
				}`}
			>
				{masterBypass ? "DSP BYPASSED" : "DSP ON"}
			</span>
		</label>
	);
}

function Section({
	id,
	title,
	children,
}: {
	id: string;
	title: string;
	children: React.ReactNode;
}) {
	return (
		<section aria-labelledby={id} className="flex flex-col gap-2">
			<h2 id={id} className="text-base font-semibold tracking-tight">
				{title}
			</h2>
			{children}
		</section>
	);
}

function Row({
	label,
	hint,
	control,
	action,
}: {
	label: string;
	hint?: string;
	control?: React.ReactNode;
	action?: React.ReactNode;
}) {
	return (
		<div className="flex items-center justify-between gap-4 rounded-2xl bg-surface px-4 py-3">
			<span className="min-w-0 text-[14px]">
				<span className="font-medium">{label}</span>
				{hint ? (
					<span className="block text-[13px] text-muted">{hint}</span>
				) : null}
			</span>
			<span className="flex shrink-0 items-center gap-2">
				{control}
				{action}
			</span>
		</div>
	);
}

/**
 * Settings, organized by category. Concise rows up front; expert detail
 * lives behind disclosures, and unfinished integrations are not listed.
 */
export function SettingsView({
	onOpenMusic,
	onOpenTuning,
	onOpenDevices,
	onOpenPlaylists,
	onOpenGuides,
}: {
	onOpenMusic?: (() => void) | undefined;
	onOpenTuning?: ((t: "eq" | "dsp") => void) | undefined;
	onOpenDevices?: (() => void) | undefined;
	onOpenPlaylists?: (() => void) | undefined;
	onOpenGuides?: (() => void) | undefined;
}) {
	const theme = useSettingsStore((s) => s.theme);
	const selectedIemProfileId = useSettingsStore((s) => s.selectedIemProfileId);
	const selectedProfileName = useIEMStore((s) =>
		selectedIemProfileId
			? (s.profiles[selectedIemProfileId]?.name ?? null)
			: null,
	);
	const crossfadeEnabled = usePlayerStore((s) => s.crossfadeEnabled);
	const crossfadeDuration = usePlayerStore((s) => s.crossfadeDuration);

	return (
		<div className="flex max-w-2xl flex-col gap-7">
			<h2 className="text-2xl font-bold tracking-tight">Settings</h2>

			<Section id="appearance-heading" title="Appearance">
				<Row
					label="Theme"
					hint="System follows your OS setting."
					control={
						<select
							value={theme}
							onChange={(e) =>
								useSettingsStore.getState().setTheme(e.target.value as Theme)
							}
							aria-label="Theme"
							className="rounded-lg border border-line bg-abyss px-2 py-1.5 text-sm"
						>
							<option value="system">System</option>
							<option value="dark">Dark</option>
							<option value="light">Light</option>
						</select>
					}
				/>
			</Section>

			<Section id="playback-heading" title="Playback">
				<div className="flex flex-col gap-2">
					<div className="rounded-2xl bg-surface px-4 py-3">
						<label className="flex items-center justify-between gap-4">
							<span className="text-[14px]">
								<span className="font-medium">Crossfade</span>
								<span className="block text-[13px] text-muted">
									Smooth overlap between tracks. Off means gapless.
								</span>
							</span>
							<input
								type="checkbox"
								checked={crossfadeEnabled}
								onChange={(e) =>
									usePlayerStore
										.getState()
										.setCrossfade(e.target.checked, crossfadeDuration)
								}
								aria-label="Enable crossfade"
							/>
						</label>
						{crossfadeEnabled ? (
							<div className="mt-2">
								<Slider
									label="Crossfade duration"
									value={crossfadeDuration}
									min={0.5}
									max={12}
									step={0.5}
									textValue={`${crossfadeDuration.toFixed(1)} seconds`}
									onChange={(v) =>
										usePlayerStore.getState().setCrossfade(true, v)
									}
								/>
							</div>
						) : null}
					</div>
					<Row
						label="Preserve pitch with speed"
						hint="Off gives the classic tape effect when rate changes."
						control={<PreservePitchToggle />}
					/>
					<Row
						label="ReplayGain"
						hint="Track/album loudness tags, applied before EQ."
						control={<ReplayGainSelect />}
					/>
					<div className="rounded-2xl bg-surface px-4 py-3 text-[13px] text-muted">
						Background playback: audio keeps playing when you switch tabs or
						minimize. Lock-screen controls use Media Session where supported.
					</div>
				</div>
			</Section>

			<Section id="audio-heading" title="Audio">
				<div className="flex flex-col gap-2">
					<Row
						label="Parametric EQ"
						hint="Bands, preamp, and presets live in EQ & DSP."
						control={<EqStatus />}
						action={
							onOpenTuning ? (
								<button
									type="button"
									onClick={() => onOpenTuning("eq")}
									aria-label="Open EQ & DSP"
									className="rounded-full border border-line px-3 py-1 text-[13px] transition-colors hover:bg-elevated"
								>
									Open
								</button>
							) : undefined
						}
					/>
					<AudioOutputControl />
					<Row
						label="Device profile"
						hint={
							selectedProfileName ??
							"None selected — pick one under My Devices."
						}
						control={
							<span className="text-[13px] text-muted" role="status">
								{selectedIemProfileId ? "Selected" : "Not set"}
							</span>
						}
						action={
							onOpenDevices ? (
								<button
									type="button"
									onClick={onOpenDevices}
									aria-label="Open My Devices"
									className="rounded-full border border-line px-3 py-1 text-[13px] transition-colors hover:bg-elevated"
								>
									Open
								</button>
							) : undefined
						}
					/>
				</div>
			</Section>

			<Section id="dsp-heading" title="EQ & DSP">
				<div className="flex flex-col gap-2 rounded-2xl bg-surface px-4 py-3">
					<label className="flex items-center justify-between gap-4">
						<span className="text-[14px]">
							<span className="font-medium">DSP chain</span>
							<span className="block text-[13px] text-muted">
								Bypass pauses listening only — settings are kept.
							</span>
						</span>
						<DspMasterToggle />
					</label>
					<DSPSummary compact />
					<div className="flex flex-wrap items-center gap-2">
						<CompareControl />
						{onOpenTuning ? (
							<button
								type="button"
								onClick={() => onOpenTuning("dsp")}
								aria-label="Open full DSP controls"
								className="text-[13px] font-medium text-accent hover:underline"
							>
								Open full controls →
							</button>
						) : null}
					</div>
				</div>
			</Section>

			<Section id="library-heading" title="Library">
				<div className="flex flex-col gap-2">
					<SourceManager />
					<Row
						label="Playlist import"
						hint="Import .m3u, .csv, or .json files matched to your library."
						action={
							onOpenPlaylists ? (
								<button
									type="button"
									onClick={onOpenPlaylists}
									aria-label="Open playlist import"
									className="rounded-full border border-line px-3 py-1 text-[13px] transition-colors hover:bg-elevated"
								>
									Open
								</button>
							) : undefined
						}
					/>
					{onOpenMusic ? (
						<Row
							label="Your music"
							hint="Browse tracks, albums, artists, and genres."
							action={
								<button
									type="button"
									onClick={onOpenMusic}
									aria-label="Open music library"
									className="rounded-full border border-line px-3 py-1 text-[13px] transition-colors hover:bg-elevated"
								>
									Open
								</button>
							}
						/>
					) : null}
				</div>
			</Section>

			<Section id="cloud-sources-heading" title="Sources">
				<CloudSources />
			</Section>

			<Section id="privacy-heading" title="Privacy">
				<div className="rounded-2xl bg-surface px-4 py-3 text-sm">
					<p>
						<strong>Local-first:</strong> your music files never leave this
						device. Playlists, favorites, and settings are stored on-device — no
						audio uploaded, no analytics.
					</p>
					<details className="mt-1 text-[13px] text-muted">
						<summary className="cursor-pointer hover:text-ink">
							Storage details
						</summary>
						<p className="pt-1">
							Track metadata, artwork thumbnails, playlists, favorites, and play
							counts live in IndexedDB; small preferences live in localStorage.
							Cloud sources are strictly opt-in: connecting one grants access to
							that account only, and only file metadata enters the library.
						</p>
					</details>
				</div>
			</Section>

			<Section id="backup-heading" title="Backup & restore">
				<BackupControls />
			</Section>

			{onOpenGuides ? (
				<Section id="guides-heading" title="Help & guides">
					<Row
						label="Audio guides"
						hint="EQ, DSP, AutoEQ, devices, playback, and troubleshooting."
						action={
							<button
								type="button"
								onClick={onOpenGuides}
								aria-label="Open audio guides"
								className="rounded-full border border-line px-3 py-1 text-[13px] transition-colors hover:bg-elevated"
							>
								Open
							</button>
						}
					/>
				</Section>
			) : null}

			<Section id="advanced-heading" title="Advanced">
				<div className="flex flex-col gap-2 rounded-2xl bg-surface px-4 py-3 text-sm">
					<details>
						<summary className="cursor-pointer font-medium">
							Keyboard shortcuts
						</summary>
						<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 pt-2 text-[13px]">
							<dt className="font-mono">Space / K</dt>
							<dd className="text-muted">Play / pause</dd>
							<dt className="font-mono">← / →</dt>
							<dd className="text-muted">Seek 5 seconds</dd>
							<dt className="font-mono">Ctrl/⌘ + ← / →</dt>
							<dd className="text-muted">Previous / next track</dd>
							<dt className="font-mono">M</dt>
							<dd className="text-muted">Mute</dd>
							<dt className="font-mono">Q</dt>
							<dd className="text-muted">Open / close queue</dd>
							<dt className="font-mono">E</dt>
							<dd className="text-muted">Go to EQ &amp; DSP</dd>
							<dt className="font-mono">F</dt>
							<dd className="text-muted">Go to library</dd>
							<dt className="font-mono">L</dt>
							<dd className="text-muted">Open Now Playing lyrics</dd>
							<dt className="font-mono">V</dt>
							<dd className="text-muted">Open Now Playing visualizer</dd>
							<dt className="font-mono">Ctrl/⌘ + K</dt>
							<dd className="text-muted">Command palette</dd>
						</dl>
					</details>
					<details>
						<summary className="cursor-pointer font-medium">About</summary>
						<p className="pt-2 text-[13px] text-muted">
							Local IEM Player 0.1.0 — local-first audiophile player. It
							processes only audio it plays itself; it cannot EQ other apps,
							browser tabs, or system audio.
						</p>
					</details>
				</div>
			</Section>
		</div>
	);
}
