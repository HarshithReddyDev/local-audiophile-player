import { writeFileSync } from "node:fs";
import type { Page } from "@playwright/test";

/** Deterministic sine WAV fixture. No binaries committed to the repo. */
export function writeSineWav(
	path: string,
	frequency: number,
	seconds = 1,
): void {
	const sampleRate = 8000;
	const samples = Math.floor(sampleRate * seconds);
	const data = Buffer.alloc(samples * 2);
	for (let i = 0; i < samples; i++) {
		const v = Math.round(
			Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 32767,
		);
		data.writeInt16LE(v, i * 2);
	}
	const header = Buffer.alloc(44);
	header.write("RIFF", 0);
	header.writeUInt32LE(36 + data.length, 4);
	header.write("WAVE", 8);
	header.write("fmt ", 12);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20); // PCM
	header.writeUInt16LE(1, 22); // mono
	header.writeUInt32LE(sampleRate, 24);
	header.writeUInt32LE(sampleRate * 2, 28);
	header.writeUInt16LE(2, 32);
	header.writeUInt16LE(16, 34);
	header.write("data", 36);
	header.writeUInt32LE(data.length, 40);
	writeFileSync(path, Buffer.concat([header, data]));
}

/** Narrow (mobile) layout uses the compact bottom nav + full-player flows. */
export function isNarrow(page: Page): boolean {
	return (page.viewportSize()?.width ?? 1280) < 768;
}

/** Open Settings from either the desktop sidebar or the mobile bottom nav. */
export async function openSettings(page: Page): Promise<void> {
	await page.getByRole("button", { name: "Settings", exact: true }).click();
}

/**
 * Open the combined EQ & DSP destination on the requested tab.
 * Desktop sidebar labels it "EQ & DSP"; mobile bottom nav shortens to "EQ".
 * Legacy "DSP" maps to the Dynamics tab (compressor, limiter, preset bar).
 */
export async function openTuning(
	page: Page,
	tab:
		| "EQ"
		| "DSP"
		| "Tone"
		| "Dynamics"
		| "Spatial"
		| "Loudness"
		| "Presets"
		| "Guides",
): Promise<void> {
	if (isNarrow(page)) {
		await page.getByRole("button", { name: "EQ", exact: true }).click();
	} else {
		await page.getByRole("button", { name: "EQ & DSP", exact: true }).click();
	}
	const resolved = tab === "DSP" ? "Dynamics" : tab;
	await page
		.getByRole("tablist", { name: "Audio tuning sections" })
		.getByRole("tab", { name: resolved, exact: true })
		.click();
}

/**
 * Open My Devices. Desktop has a direct sidebar entry; mobile goes
 * through Settings, which links onward.
 */
export async function openMyDevices(page: Page): Promise<void> {
	if (isNarrow(page)) {
		await openSettings(page);
		await page.getByRole("button", { name: "Open My Devices" }).click();
	} else {
		await page.getByRole("button", { name: "My Devices", exact: true }).click();
	}
}

/**
 * Open the play queue. Desktop uses the mini-player toggle; mobile opens
 * the full player first (the mini-player toggle is desktop-only, and the
 * full player is the sanctioned mobile queue entry point).
 */
export async function openQueue(page: Page): Promise<void> {
	if (isNarrow(page)) {
		await page
			.getByRole("button", { name: /Open now playing/ })
			.first()
			.click();
		await page
			.getByRole("region", { name: "Now playing" })
			.getByRole("button", { name: "Queue", exact: true })
			.click();
	} else {
		await page.getByRole("button", { name: "Open queue" }).first().click();
	}
}
