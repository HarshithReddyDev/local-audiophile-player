import { useEffect, useState } from "react";
import { useDspStore } from "../../state/dsp-store";
import { useEQStore } from "../../state/eq-store";
import { useIEMStore } from "../../state/iem-store";
import { useSettingsStore } from "../../state/settings-store";
import { GuidesView } from "../guides/GuidesView";
import { LearnLink } from "../guides/LearnLink";
import { PresetLibrary } from "../presets/PresetLibrary";
import { type DspFocus, DspView } from "./DspView";
import { EQView } from "./EQView";

export type TuningTab = "eq" | "dsp";
export type WorkspaceTab =
	| "eq"
	| "tone"
	| "dynamics"
	| "spatial"
	| "loudness"
	| "presets"
	| "guides";

const TABS: { id: WorkspaceTab; label: string; guide: string }[] = [
	{ id: "eq", label: "EQ", guide: "eq-basics" },
	{ id: "tone", label: "Tone", guide: "dsp" },
	{ id: "dynamics", label: "Dynamics", guide: "dsp" },
	{ id: "spatial", label: "Spatial", guide: "dsp" },
	{ id: "loudness", label: "Loudness", guide: "dsp" },
	{ id: "presets", label: "Presets", guide: "eq-iem" },
	{ id: "guides", label: "Guides", guide: "getting-started" },
];

const FOCUS_FOR_TAB: Partial<Record<WorkspaceTab, DspFocus>> = {
	tone: "tone",
	dynamics: "dynamics",
	spatial: "spatial",
	loudness: "loudness",
};

/**
 * Combined "EQ & DSP" destination: EQ, per-module DSP tabs, the built-in
 * preset library, and guides share one home. Presentation only — stores,
 * math, and persistence are unchanged.
 */
export function AudioTuningView({
	tab,
	onTab,
	onOpenDevices,
	onOpenGuide,
}: {
	tab: TuningTab;
	onTab: (t: TuningTab) => void;
	onOpenDevices?: () => void;
	onOpenGuide?: (guideId: string) => void;
}) {
	const [workspace, setWorkspace] = useState<WorkspaceTab>(
		tab === "dsp" ? "tone" : "eq",
	);
	// Follow route changes between EQ and DSP (sidebar/mobile nav) without
	// clobbering the user's sub-tab while they work inside DSP.
	useEffect(() => {
		if (tab === "eq") setWorkspace("eq");
		else setWorkspace((w) => (w === "eq" ? "tone" : w));
	}, [tab]);

	const eqOn = useEQStore((s) => s.profile.enabled);
	const eqBands = useEQStore(
		(s) => s.profile.bands.filter((b) => b.enabled).length,
	);
	const dspOff = useDspStore((s) => s.masterBypass || s.comparing);
	const activeDeviceName = useDspStore((s) => s.activeDeviceName);
	const selectedProfileId = useSettingsStore((s) => s.selectedIemProfileId);
	const profileName = useIEMStore((s) =>
		selectedProfileId != null
			? (s.profiles[selectedProfileId]?.name ?? null)
			: null,
	);
	const deviceLabel = activeDeviceName ?? profileName ?? "Global";
	const activeTab = TABS.find((t) => t.id === workspace) ?? TABS[0]!;

	const select = (id: WorkspaceTab) => {
		setWorkspace(id);
		onTab(id === "eq" ? "eq" : "dsp");
	};

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-baseline gap-2">
				<h2 className="text-2xl font-bold tracking-tight">EQ &amp; DSP</h2>
				<p className="text-sm text-muted" role="status">
					{deviceLabel} · EQ {eqOn ? `on (${eqBands})` : "off"} · DSP{" "}
					{dspOff ? "bypassed" : "on"}
				</p>
				<span className="flex-1" />
				<LearnLink
					guideId={activeTab.guide}
					onOpenGuide={onOpenGuide}
					label={`Learn: ${activeTab.label}`}
				/>
				{onOpenDevices ? (
					<button
						type="button"
						onClick={onOpenDevices}
						className="rounded-full border border-line px-3.5 py-1.5 text-sm text-muted transition-colors hover:bg-elevated hover:text-ink"
					>
						Devices →
					</button>
				) : null}
			</div>
			<div
				role="tablist"
				aria-label="Audio tuning sections"
				className="flex gap-1 self-start overflow-x-auto rounded-full border border-line p-1"
			>
				{TABS.map(({ id, label }) => (
					<button
						key={id}
						type="button"
						role="tab"
						aria-selected={workspace === id}
						onClick={() => select(id)}
						className={`shrink-0 rounded-full px-4 py-1.5 text-sm transition-colors ${
							workspace === id
								? "bg-elevated font-semibold text-ink"
								: "text-muted hover:text-ink"
						}`}
					>
						{label}
					</button>
				))}
			</div>
			{workspace === "eq" ? (
				<EQView onOpenGuide={onOpenGuide} />
			) : workspace === "presets" ? (
				<PresetLibrary />
			) : workspace === "guides" ? (
				<GuidesView initialGuideId="eq-basics" />
			) : (
				<DspView
					focus={FOCUS_FOR_TAB[workspace] ?? "all"}
					onOpenGuide={onOpenGuide}
				/>
			)}
		</div>
	);
}
