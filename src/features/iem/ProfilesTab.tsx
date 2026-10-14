import { useState } from "react";
import { libraryService } from "../../library/library-service";
import { allTargets, useIEMStore } from "../../state/iem-store";
import { useSettingsStore } from "../../state/settings-store";

export function ProfilesTab({ onOpen }: { onOpen: (id: string) => void }) {
	const profiles = useIEMStore((s) => s.profiles);
	const measurements = useIEMStore((s) => s.measurements);
	const [name, setName] = useState("");
	const [manufacturer, setManufacturer] = useState("");
	const [model, setModel] = useState("");
	const [measurementId, setMeasurementId] = useState("");
	const [targetId, setTargetId] = useState("builtin-flat");
	const list = Object.values(profiles).sort(
		(a, b) => b.createdAt - a.createdAt,
	);
	const measurementList = Object.values(measurements);
	const targetList = allTargets(useIEMStore((s) => s.targets));

	const create = () => {
		void libraryService
			.createProfile({
				name,
				manufacturer,
				model,
				measurementId: measurementId || null,
				targetId: targetId || null,
			})
			.then((id) => {
				setName("");
				setManufacturer("");
				setModel("");
				onOpen(id);
			});
	};

	return (
		<div className="flex flex-col gap-4">
			<form
				className="grid grid-cols-1 gap-2 rounded-xl border border-line bg-surface p-3 sm:grid-cols-2"
				onSubmit={(e) => {
					e.preventDefault();
					create();
				}}
			>
				<label className="flex flex-col gap-1 text-xs text-muted">
					Profile name
					<input
						type="text"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="My IEM"
						className="rounded-md border border-line bg-abyss px-2 py-1.5 text-sm text-ink"
					/>
				</label>
				<label className="flex flex-col gap-1 text-xs text-muted">
					Manufacturer
					<input
						type="text"
						value={manufacturer}
						onChange={(e) => setManufacturer(e.target.value)}
						className="rounded-md border border-line bg-abyss px-2 py-1.5 text-sm text-ink"
					/>
				</label>
				<label className="flex flex-col gap-1 text-xs text-muted">
					Model
					<input
						type="text"
						value={model}
						onChange={(e) => setModel(e.target.value)}
						className="rounded-md border border-line bg-abyss px-2 py-1.5 text-sm text-ink"
					/>
				</label>
				<label className="flex flex-col gap-1 text-xs text-muted">
					Measurement
					<select
						value={measurementId}
						onChange={(e) => setMeasurementId(e.target.value)}
						className="rounded-md border border-line bg-abyss px-2 py-1.5 text-sm text-ink"
					>
						<option value="">None yet</option>
						{measurementList.map((m) => (
							<option key={m.id} value={m.id}>
								{m.name}
							</option>
						))}
					</select>
				</label>
				<label className="flex flex-col gap-1 text-xs text-muted">
					Target
					<select
						value={targetId}
						onChange={(e) => setTargetId(e.target.value)}
						className="rounded-md border border-line bg-abyss px-2 py-1.5 text-sm text-ink"
					>
						{targetList.map((t) => (
							<option key={t.id} value={t.id}>
								{t.name}
							</option>
						))}
					</select>
				</label>
				<span className="flex items-end">
					<button
						type="submit"
						className="rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-accent-ink"
					>
						Create profile
					</button>
				</span>
			</form>

			{list.length === 0 ? (
				<p className="py-4 text-center text-sm text-muted">No profiles yet.</p>
			) : (
				<ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
					{list.map((p) => (
						<ProfileCard key={p.id} id={p.id} onOpen={() => onOpen(p.id)} />
					))}
				</ul>
			)}
		</div>
	);
}

function ProfileCard({ id, onOpen }: { id: string; onOpen: () => void }) {
	const profile = useIEMStore((s) => s.profiles[id]);
	const selectedId = useSettingsStore((s) => s.selectedIemProfileId);
	const [status, setStatus] = useState<string | null>(null);
	if (!profile) return null;
	const selected = selectedId === id;
	const run = (task: () => Promise<unknown>, done: string): void => {
		void task().then((ok) => {
			setStatus(ok ? done : "That didn't work — try again.");
		});
	};
	return (
		<li className="flex flex-col gap-1 rounded-xl border border-line bg-surface p-3">
			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={onOpen}
					className="min-w-0 flex-1 text-left"
					aria-label={`Open profile ${profile.name}`}
				>
					<span className="block truncate text-sm font-medium">
						{profile.name}
						{selected ? (
							<span className="ml-2 text-xs text-accent">● selected</span>
						) : null}
					</span>
					<span className="block truncate text-xs text-muted">
						{[profile.manufacturer, profile.model].filter(Boolean).join(" ") ||
							"No make/model"}
						{profile.dsp ? " · DSP layer" : profile.eq ? " · EQ only" : ""}
					</span>
				</button>
				<button
					type="button"
					onClick={() => libraryService.selectProfile(selected ? null : id)}
					aria-label={
						selected
							? `Deselect profile ${profile.name}`
							: `Apply profile ${profile.name}`
					}
					className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-ink"
				>
					{selected ? "Deselect" : "Apply"}
				</button>
			</div>
			<div className="flex flex-wrap items-center gap-1 pl-1">
				<button
					type="button"
					onClick={() =>
						run(
							() => libraryService.captureDeviceDsp(id),
							"Current DSP saved into this profile.",
						)
					}
					aria-label={`Save current DSP to profile ${profile.name}`}
					className="rounded-md px-2 py-1 text-xs text-muted hover:bg-elevated hover:text-ink"
				>
					Save current DSP
				</button>
				{profile.dsp ? (
					<button
						type="button"
						onClick={() =>
							run(
								() => libraryService.clearProfileDsp(id),
								"DSP layer cleared (legacy EQ kept).",
							)
						}
						aria-label={`Clear DSP layer of profile ${profile.name}`}
						className="rounded-md px-2 py-1 text-xs text-muted hover:bg-elevated hover:text-ink"
					>
						Clear DSP layer
					</button>
				) : null}
			</div>
			{status ? (
				<p role="status" className="pl-1 text-xs text-muted">
					{status}
				</p>
			) : null}
			<div className="flex justify-end">
				<button
					type="button"
					onClick={() => void libraryService.deleteProfile(id)}
					aria-label={`Delete profile ${profile.name}`}
					className="rounded-md px-2 py-1 text-xs text-muted hover:bg-elevated hover:text-ink"
				>
					Delete
				</button>
			</div>
		</li>
	);
}
