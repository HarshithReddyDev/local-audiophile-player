/**
 * Audio output introspection: what the browser genuinely exposes.
 * - Sample rate: AudioContext.sampleRate (the actual render rate).
 * - Output selection: HTMLMediaElement.setSinkId (Chromium-only).
 * Device labels require a prior media permission; without one the list
 * shows anonymized entries and says so — never fabricated names.
 * There is deliberately no exclusive-mode / bit-perfect / DAC control:
 * browsers do not expose any of it (see docs/audio-engine.md).
 */

export interface AudioOutputDevice {
	deviceId: string;
	label: string;
}

export function supportsOutputSelection(): boolean {
	try {
		return (
			typeof Audio !== "undefined" &&
			typeof (Audio.prototype as unknown as Record<string, unknown>)
				.setSinkId === "function"
		);
	} catch {
		return false;
	}
}

export async function listAudioOutputs(): Promise<{
	devices: AudioOutputDevice[];
	labelsHidden: boolean;
}> {
	try {
		if (
			typeof navigator === "undefined" ||
			!navigator.mediaDevices?.enumerateDevices
		) {
			return { devices: [], labelsHidden: true };
		}
		const all = await navigator.mediaDevices.enumerateDevices();
		const outputs = all.filter((d) => d.kind === "audiooutput");
		const labelsHidden = outputs.every((d) => !d.label);
		return {
			devices: outputs.map((d, i) => ({
				deviceId: d.deviceId,
				label: d.label || `Output device ${i + 1}`,
			})),
			labelsHidden,
		};
	} catch {
		return { devices: [], labelsHidden: true };
	}
}
