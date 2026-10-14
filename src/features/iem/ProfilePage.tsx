import { useMemo, useState } from "react";
import { compensationCurve } from "../../dsp/curves";
import { libraryService } from "../../library/library-service";
import { allTargets, resolveTarget, useIEMStore } from "../../state/iem-store";
import { useSettingsStore } from "../../state/settings-store";
import { AutoEQPanel } from "./AutoEQPanel";
import { CurveGraph } from "./CurveGraph";

/** Single profile: measurement + target + correction, selection, upkeep. */
export function ProfilePage({
	id,
	onBack,
}: {
	id: string;
	onBack: () => void;
}) {
	const profile = useIEMStore((s) => s.profiles[id]);
	const measurements = useIEMStore((s) => s.measurements);
	const targets = useIEMStore((s) => s.targets);
	const selectedId = useSettingsStore((s) => s.selectedIemProfileId);
	const [renaming, setRenaming] = useState(false);
	const [renameValue, setRenameValue] = useState("");

	const measurement = profile?.measurementId
		? (measurements[profile.measurementId] ?? null)
		: null;
	const target = resolveTarget(targets, profile?.targetId ?? null);
	const correction = useMemo(() => {
		if (!measurement || !target) return null;
		return compensationCurve(
			{ frequencies: measurement.frequencies, gains: measurement.gains },
			{ frequencies: target.frequencies, gains: target.gains },
			128,
			20,
			20000,
		);
	}, [measurement, target]);

	if (!profile) {
		return (
			<div className="flex flex-col gap-2">
				<p className="text-sm text-muted">This profile no longer exists.</p>
				<button
					type="button"
					onClick={onBack}
					className="self-start text-sm text-accent hover:underline"
				>
					← Back to profiles
				</button>
			</div>
		);
	}

	const selected = selectedId === id;
	const targetOptions = allTargets(targets);
	const measurementOptions = Object.values(measurements);

	return (
		<div className="flex max-w-3xl flex-col gap-3">
			<div className="flex flex-wrap items-center gap-2">
				<button
					type="button"
					onClick={onBack}
					className="rounded-full border border-line px-3 py-1 text-sm text-muted hover:bg-elevated hover:text-ink"
				>
					← Profiles
				</button>
				{renaming ? (
					<form
						className="flex items-center gap-1"
						onSubmit={(e) => {
							e.preventDefault();
							void libraryService
								.renameProfile(id, renameValue)
								.then(() => setRenaming(false));
						}}
					>
						<label className="sr-only" htmlFor="rename-profile">
							Rename profile
						</label>
						<input
							id="rename-profile"
							type="text"
							value={renameValue}
							onChange={(e) => setRenameValue(e.target.value)}
							className="w-44 rounded-md border border-line bg-abyss px-2 py-1 text-sm"
						/>
						<button type="submit" className="text-xs text-accent">
							Save
						</button>
					</form>
				) : (
					<>
						<h2 className="text-lg font-semibold">{profile.name}</h2>
						<button
							type="button"
							onClick={() => {
								setRenameValue(profile.name);
								setRenaming(true);
							}}
							aria-label={`Rename profile ${profile.name}`}
							className="text-xs text-muted hover:text-ink"
						>
							Rename
						</button>
					</>
				)}
				<span className="flex-1" />
				{selected ? (
					<span className="text-xs text-accent" role="status">
						● Selected
					</span>
				) : (
					<button
						type="button"
						onClick={() => libraryService.selectProfile(id)}
						className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-ink"
					>
						Select
					</button>
				)}
				<button
					type="button"
					onClick={() =>
						void libraryService.duplicateProfile(id).then(() => onBack())
					}
					aria-label={`Duplicate profile ${profile.name}`}
					className="rounded-full border border-line px-3 py-1 text-xs hover:bg-elevated"
				>
					Duplicate
				</button>
				<button
					type="button"
					onClick={() =>
						void libraryService.deleteProfile(id).then(() => onBack())
					}
					aria-label={`Delete profile ${profile.name}`}
					className="rounded-full border border-line px-3 py-1 text-xs text-muted hover:bg-elevated hover:text-ink"
				>
					Delete
				</button>
			</div>

			<p className="text-sm text-muted">
				{[profile.manufacturer, profile.model].filter(Boolean).join(" ") ||
					"No make/model set"}
			</p>

			<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
				<label className="flex flex-col gap-1 text-xs text-muted">
					Measurement
					<select
						value={profile.measurementId ?? ""}
						onChange={(e) =>
							void libraryService.setProfileTargets(
								id,
								e.target.value || null,
								profile.targetId,
							)
						}
						className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
					>
						<option value="">None</option>
						{measurementOptions.map((m) => (
							<option key={m.id} value={m.id}>
								{m.name} ({m.channel})
							</option>
						))}
					</select>
				</label>
				<label className="flex flex-col gap-1 text-xs text-muted">
					Target
					<select
						value={profile.targetId ?? ""}
						onChange={(e) =>
							void libraryService.setProfileTargets(
								id,
								profile.measurementId,
								e.target.value || null,
							)
						}
						className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
					>
						<option value="">None</option>
						{targetOptions.map((t) => (
							<option key={t.id} value={t.id}>
								{t.name}
							</option>
						))}
					</select>
				</label>
			</div>

			{!measurement || !target ? (
				<p className="rounded-xl border border-line bg-surface p-3 text-sm text-muted">
					{!measurement && !target
						? "Choose a measurement and a target to preview the correction curve."
						: !measurement
							? "Choose a measurement to preview the correction curve."
							: "Choose a target to preview the correction curve."}
				</p>
			) : (
				<CurveGraph
					series={[
						{
							id: "m",
							label: measurement.name,
							color: "accent",
							curve: {
								frequencies: measurement.frequencies,
								gains: measurement.gains,
							},
						},
						{
							id: "t",
							label: target.name,
							color: "muted",
							curve: { frequencies: target.frequencies, gains: target.gains },
						},
						...(correction
							? [
									{
										id: "c",
										label: "Correction (target − measurement)",
										color: "warn" as const,
										curve: correction,
									},
								]
							: []),
					]}
				/>
			)}

			<div className="rounded-xl border border-line bg-surface p-3 text-xs text-muted">
				<p>
					Generated EQ lands here as ordinary editable bands once applied — the
					DSP engine treats fitted and hand-made profiles identically.
				</p>
			</div>

			<AutoEQPanel profileId={id} />
		</div>
	);
}
