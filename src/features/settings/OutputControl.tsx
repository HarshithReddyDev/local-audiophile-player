import { useEffect, useState } from "react";
import {
	type AudioOutputDevice,
	listAudioOutputs,
	supportsOutputSelection,
} from "../../audio/output";
import { useSettingsStore } from "../../state/settings-store";
import { getPlaybackEngine } from "../player/use-playback";

/**
 * Output device routing + render-rate readout. Browser-honest: device
 * selection exists only where setSinkId does (Chromium); labels need a
 * prior media permission or they stay anonymized; the sample rate shown
 * is the Web Audio render rate, not a hardware/DAC claim.
 */
export function AudioOutputControl() {
	const outputDeviceId = useSettingsStore((s) => s.outputDeviceId);
	const [devices, setDevices] = useState<AudioOutputDevice[]>([]);
	const [labelsHidden, setLabelsHidden] = useState(true);
	const [supported] = useState(supportsOutputSelection);
	const [sampleRate, setSampleRate] = useState<number | null>(null);
	const [status, setStatus] = useState<string | null>(null);

	useEffect(() => {
		let live = true;
		void listAudioOutputs().then((result) => {
			if (!live) return;
			setDevices(result.devices);
			setLabelsHidden(result.labelsHidden);
		});
		setSampleRate(getPlaybackEngine()?.getSampleRate() ?? null);
		return () => {
			live = false;
		};
	}, []);

	if (!supported) {
		return (
			<div className="rounded-xl border border-line bg-surface p-3">
				<p className="text-sm font-medium">Output device</p>
				<p className="text-xs text-muted">
					Output-device selection is not available in this browser (requires
					setSinkId support). Audio plays through the system default output.
				</p>
				<SampleRateLine sampleRate={sampleRate} />
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3">
			<label className="flex items-center justify-between gap-4">
				<span className="text-sm">
					Output device
					<span className="block text-xs text-muted">
						Browser-controlled routing. Not exclusive mode, not DAC control.
					</span>
				</span>
				<select
					value={outputDeviceId ?? ""}
					onChange={(e) => {
						const id = e.target.value === "" ? null : e.target.value;
						useSettingsStore.getState().setOutputDeviceId(id);
						if (id) {
							void getPlaybackEngine()
								?.setOutputDevice(id)
								.then((ok) => {
									setStatus(
										ok
											? null
											: "That device refused routing — still on default.",
									);
								});
						} else {
							setStatus(null);
						}
					}}
					aria-label="Audio output device"
					className="rounded-md border border-line bg-abyss px-2 py-1 text-sm"
				>
					<option value="">System default</option>
					{devices.map((device) => (
						<option key={device.deviceId} value={device.deviceId}>
							{device.label}
						</option>
					))}
				</select>
			</label>
			{labelsHidden && devices.length > 0 ? (
				<p className="text-xs text-muted">
					Device names stay hidden until a media permission is granted — browser
					privacy rule, not an app limitation.
				</p>
			) : null}
			{status ? (
				<p role="status" className="text-xs text-muted">
					{status}
				</p>
			) : null}
			<SampleRateLine sampleRate={sampleRate} />
		</div>
	);
}

function SampleRateLine({ sampleRate }: { sampleRate: number | null }) {
	return (
		<details className="text-xs text-muted">
			<summary className="cursor-pointer hover:text-ink">
				Render rate:{" "}
				{sampleRate ? `${(sampleRate / 1000).toFixed(1)} kHz` : "unknown yet"}
			</summary>
			<p className="pt-1">
				Resampling, if any, is done by the browser/OS mixer — this app claims no
				bit-perfect or exclusive output.
			</p>
		</details>
	);
}
