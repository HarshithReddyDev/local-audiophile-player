import { useState } from "react";
import { libraryService } from "../../library/library-service";
import { useDspStore } from "../../state/dsp-store";
import { useEQStore } from "../../state/eq-store";
import { useIEMStore } from "../../state/iem-store";
import { useSettingsStore } from "../../state/settings-store";

function download(name: string, text: string): void {
	const blob = new Blob([text], { type: "application/json;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * Backup & restore: device profiles (with DSP layers), EQ presets
 * (parametric + graphic), and safe app settings. Import validates and
 * never overwrites existing records — collisions are skipped and
 * reported. Catalog data is canonical and therefore never exported.
 */
export function BackupControls() {
	const [status, setStatus] = useState<string | null>(null);

	const exportProfiles = (): void => {
		const profiles = Object.values(useIEMStore.getState().profiles);
		download(
			"iem-profiles.json",
			JSON.stringify(
				{ kind: "iem-player-device-profiles", version: 1, profiles },
				null,
				2,
			),
		);
		setStatus(`Exported ${profiles.length} device profiles.`);
	};

	const exportEq = (): void => {
		const eq = useEQStore.getState();
		const dsp = useDspStore.getState();
		download(
			"eq-backup.json",
			JSON.stringify(
				{
					kind: "iem-player-eq-backup",
					version: 1,
					profile: {
						version: 1,
						preamp: eq.profile.preamp,
						enabled: eq.profile.enabled,
						bands: eq.profile.bands.map(
							({ type, frequency, gain, q, enabled }) => ({
								type,
								frequency,
								gain,
								q,
								enabled,
							}),
						),
					},
					presets: eq.presets,
					graphic: dsp.graphic,
					graphicPresets: dsp.graphicPresets,
				},
				null,
				2,
			),
		);
		setStatus("Exported EQ profile, presets, and graphic banks.");
	};

	const exportSettings = (): void => {
		const settings = useSettingsStore.getState();
		const dsp = useDspStore.getState();
		download(
			"app-settings.json",
			JSON.stringify(
				{
					kind: "iem-player-settings",
					version: 1,
					settings: {
						theme: settings.theme,
						preservePitch: settings.preservePitch,
						outputDeviceId: settings.outputDeviceId,
					},
					replayGainMode: dsp.replayGainMode,
				},
				null,
				2,
			),
		);
		setStatus(
			"Exported safe settings (theme, pitch, output, ReplayGain mode).",
		);
	};

	const importProfiles = async (file: File): Promise<void> => {
		setStatus(null);
		try {
			const parsed: unknown = JSON.parse(await file.text());
			const list = Array.isArray(parsed)
				? parsed
				: (parsed as { profiles?: unknown }).profiles;
			const result = await libraryService.importDeviceProfiles(list ?? parsed);
			const parts = [
				`Added ${result.added}, skipped ${result.skipped} existing.`,
				...result.errors,
			];
			setStatus(parts.join(" "));
		} catch {
			setStatus("That file is not valid JSON.");
		}
	};

	const importEq = async (file: File): Promise<void> => {
		setStatus(null);
		try {
			const parsed = JSON.parse(await file.text()) as {
				profile?: unknown;
				presets?: unknown;
				graphic?: unknown;
				graphicPresets?: unknown;
			};
			let notes: string[] = [];
			if (parsed.profile !== undefined) {
				const { parseProfile } = await import("../../dsp/types");
				const profile = parseProfile(parsed.profile);
				if (profile) {
					useEQStore
						.getState()
						.loadBands(profile.bands, profile.preamp, profile.enabled);
					notes.push("profile applied");
				} else {
					notes.push("profile invalid, skipped");
				}
			}
			if (Array.isArray(parsed.presets)) {
				let added = 0;
				for (const item of parsed.presets) {
					const { parseProfile } = await import("../../dsp/types");
					if (typeof item !== "object" || item === null) continue;
					const record = item as { name?: unknown; data?: unknown };
					if (typeof record.name !== "string") continue;
					const data = parseProfile(record.data);
					if (!data) continue;
					const { serializeProfile } = await import("../../dsp/types");
					const id = useEQStore
						.getState()
						.importPreset(record.name, serializeProfile(data), {
							origin: "user",
						});
					if (id) added += 1;
				}
				notes.push(`${added} presets added`);
			}
			if (parsed.graphic !== undefined || parsed.graphicPresets !== undefined) {
				const { sanitizeGraphic } = await import("../../dsp/graphic");
				const dsp = useDspStore.getState();
				if (parsed.graphic && typeof parsed.graphic === "object") {
					dsp.setGraphic(sanitizeGraphic(parsed.graphic as never));
					notes.push("graphic banks applied");
				}
				if (Array.isArray(parsed.graphicPresets)) {
					let added = 0;
					for (const item of parsed.graphicPresets) {
						if (typeof item !== "object" || item === null) continue;
						const record = item as { name?: unknown; graphic?: unknown };
						if (typeof record.name !== "string") continue;
						try {
							dsp.setGraphic(sanitizeGraphic(record.graphic as never));
							if (dsp.saveGraphicPreset(record.name)) added += 1;
						} catch {
							// Malformed entry skipped.
						}
					}
					notes.push(`${added} graphic presets added`);
				}
			}
			setStatus(
				notes.length > 0
					? `EQ backup applied: ${notes.join(", ")}.`
					: "Nothing usable in that file.",
			);
		} catch {
			setStatus("That file is not valid JSON.");
		}
	};

	const importSettings = async (file: File): Promise<void> => {
		setStatus(null);
		try {
			const parsed = JSON.parse(await file.text()) as {
				settings?: {
					theme?: unknown;
					preservePitch?: unknown;
					outputDeviceId?: unknown;
				};
				replayGainMode?: unknown;
			};
			const settings = useSettingsStore.getState();
			if (parsed.settings && typeof parsed.settings === "object") {
				const { theme, preservePitch, outputDeviceId } = parsed.settings;
				if (theme === "dark" || theme === "light" || theme === "system") {
					settings.setTheme(theme);
				}
				if (typeof preservePitch === "boolean")
					settings.setPreservePitch(preservePitch);
				if (outputDeviceId === null || typeof outputDeviceId === "string") {
					settings.setOutputDeviceId(outputDeviceId);
				}
			}
			if (
				parsed.replayGainMode === "off" ||
				parsed.replayGainMode === "track" ||
				parsed.replayGainMode === "album"
			) {
				useDspStore.getState().setReplayGainMode(parsed.replayGainMode);
			}
			setStatus("Settings applied where valid; anything unknown was ignored.");
		} catch {
			setStatus("That file is not valid JSON.");
		}
	};

	return (
		<div className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3 text-sm">
			<div className="flex flex-wrap gap-2">
				<button
					type="button"
					onClick={exportProfiles}
					className="rounded-full border border-line px-3 py-1 text-xs hover:bg-elevated"
				>
					Export device profiles
				</button>
				<button
					type="button"
					onClick={exportEq}
					className="rounded-full border border-line px-3 py-1 text-xs hover:bg-elevated"
				>
					Export EQ backup
				</button>
				<button
					type="button"
					onClick={exportSettings}
					className="rounded-full border border-line px-3 py-1 text-xs hover:bg-elevated"
				>
					Export settings
				</button>
				<FileButton
					label="Import profiles"
					accept=".json"
					onFile={(f) => void importProfiles(f)}
				/>
				<FileButton
					label="Import EQ backup"
					accept=".json"
					onFile={(f) => void importEq(f)}
				/>
				<FileButton
					label="Import settings"
					accept=".json"
					onFile={(f) => void importSettings(f)}
				/>
			</div>
			<p className="text-xs text-muted">
				Backups are plain JSON on your device. Imports validate everything and
				skip existing records instead of overwriting them.
			</p>
			{status ? (
				<p role="status" className="text-xs text-accent">
					{status}
				</p>
			) : null}
		</div>
	);
}

function FileButton({
	label,
	accept,
	onFile,
}: {
	label: string;
	accept: string;
	onFile: (file: File) => void;
}) {
	return (
		<label className="cursor-pointer rounded-full border border-line px-3 py-1 text-xs hover:bg-elevated">
			{label}
			<input
				type="file"
				accept={accept}
				className="sr-only"
				aria-label={label}
				onChange={(e) => {
					const file = e.target.files?.[0];
					e.target.value = "";
					if (file) onFile(file);
				}}
			/>
		</label>
	);
}
