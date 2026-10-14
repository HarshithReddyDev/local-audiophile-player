import { useState } from "react";
import { MeasurementsTab } from "./MeasurementsTab";
import { ProfilePage } from "./ProfilePage";
import { ProfilesTab } from "./ProfilesTab";
import { TargetsTab } from "./TargetsTab";

type IEMTab = "profiles" | "measurements" | "targets";

/** IEM section: profiles, measurements, targets. No remote data required. */
export function IEMView() {
	const [tab, setTab] = useState<IEMTab>("profiles");
	const [openProfileId, setOpenProfileId] = useState<string | null>(null);

	if (openProfileId) {
		return (
			<ProfilePage id={openProfileId} onBack={() => setOpenProfileId(null)} />
		);
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-baseline gap-2">
				<h2 className="text-2xl font-bold tracking-tight">My Devices</h2>
				<p className="text-sm text-muted">
					Your headphones and IEMs, and their sound profiles.
				</p>
			</div>
			<details className="max-w-3xl rounded-xl bg-surface px-3 py-2 text-[13px] text-muted">
				<summary className="cursor-pointer font-medium hover:text-ink">
					How profiles work
				</summary>
				<p className="pt-1">
					A profile pairs one imported measurement (how your earphones measure)
					with one target (how you want them to sound) and can generate a
					matching EQ. Everything stays on this device.
				</p>
			</details>
			<div
				role="tablist"
				aria-label="IEM library"
				className="flex gap-1 self-start rounded-full border border-line p-1"
			>
				{(
					[
						["profiles", "Profiles"],
						["measurements", "Measurements"],
						["targets", "Targets"],
					] as [IEMTab, string][]
				).map(([id, label]) => (
					<button
						key={id}
						type="button"
						role="tab"
						aria-selected={tab === id}
						onClick={() => setTab(id)}
						className={`rounded-full px-3 py-1 text-sm capitalize ${tab === id ? "bg-elevated font-semibold" : "text-muted hover:text-ink"}`}
					>
						{label}
					</button>
				))}
			</div>
			{tab === "profiles" ? <ProfilesTab onOpen={setOpenProfileId} /> : null}
			{tab === "measurements" ? <MeasurementsTab /> : null}
			{tab === "targets" ? <TargetsTab /> : null}
		</div>
	);
}
