import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { openSettings } from "./fixtures";

/**
 * Genuine screenshot capture for docs/assets/screenshots + README.
 * Deterministic fictional fixtures (tagged WAVs, CSV measurement, M3U);
 * no personal data. Desktop shots run on wide viewports, mobile shots
 * only when narrow. Keep assertions light — these documents, not gates.
 */

const SHOT_DIR = "docs/assets/screenshots";

function infoChunk(fields: [string, string][]): Buffer {
	const parts: Buffer[] = [];
	for (const [id, text] of fields) {
		const raw = Buffer.from(`${text}\0`, "latin1");
		const body =
			raw.length % 2 === 1 ? Buffer.concat([raw, Buffer.from([0])]) : raw;
		const head = Buffer.alloc(8);
		head.write(id, 0, "ascii");
		head.writeUInt32LE(body.length, 4);
		parts.push(head, body);
	}
	const body = Buffer.concat(parts);
	const list = Buffer.alloc(12);
	list.write("LIST", 0, "ascii");
	list.writeUInt32LE(body.length + 4, 4);
	list.write("INFO", 8, "ascii");
	return Buffer.concat([list, body]);
}

interface DemoTrack {
	file: string;
	title: string;
	artist: string;
	album: string;
	genre: string;
	year: string;
	track: string;
	freq: number;
	seconds: number;
}

const DEMO: DemoTrack[] = [
	{
		file: "drive.wav",
		title: "Midnight Drive",
		artist: "Neon Coast",
		album: "Afterglow",
		genre: "Electronic",
		year: "2024",
		track: "1",
		freq: 440,
		seconds: 8,
	},
	{
		file: "horizon.wav",
		title: "Glass Horizon",
		artist: "Neon Coast",
		album: "Afterglow",
		genre: "Electronic",
		year: "2024",
		track: "2",
		freq: 523,
		seconds: 10,
	},
	{
		file: "ultra.wav",
		title: "Ultraviolet",
		artist: "Neon Coast",
		album: "Afterglow",
		genre: "Electronic",
		year: "2024",
		track: "3",
		freq: 659,
		seconds: 9,
	},
	{
		file: "lanterns.wav",
		title: "Paper Lanterns",
		artist: "Paper Lanterns",
		album: "Paper Lanterns",
		genre: "Indie",
		year: "2023",
		track: "1",
		freq: 392,
		seconds: 11,
	},
	{
		file: "ember.wav",
		title: "Ember Line",
		artist: "Paper Lanterns",
		album: "Paper Lanterns",
		genre: "Indie",
		year: "2023",
		track: "2",
		freq: 330,
		seconds: 8,
	},
	{
		file: "harvest.wav",
		title: "Harvest Static",
		artist: "Copper Field",
		album: "Harvest Static",
		genre: "Rock",
		year: "2022",
		track: "1",
		freq: 262,
		seconds: 12,
	},
	{
		file: "copper.wav",
		title: "Copper Sky",
		artist: "Copper Field",
		album: "Harvest Static",
		genre: "Rock",
		year: "2022",
		track: "2",
		freq: 294,
		seconds: 9,
	},
	{
		file: "field9.wav",
		title: "Field Recording No. 9",
		artist: "Copper Field",
		album: "Harvest Static",
		genre: "Rock",
		year: "2022",
		track: "3",
		freq: 196,
		seconds: 30,
	},
];

function writeTaggedWav(path: string, t: DemoTrack): void {
	const sr = 8000;
	const n = sr * t.seconds;
	const data = Buffer.alloc(n * 2);
	for (let i = 0; i < n; i++) {
		data.writeInt16LE(
			Math.round(Math.sin((2 * Math.PI * t.freq * i) / sr) * 20000),
			i * 2,
		);
	}
	const fmt = Buffer.alloc(24);
	fmt.write("fmt ", 0, "ascii");
	fmt.writeUInt32LE(16, 4);
	fmt.writeUInt16LE(1, 8);
	fmt.writeUInt16LE(1, 10);
	fmt.writeUInt32LE(sr, 12);
	fmt.writeUInt32LE(sr * 2, 16);
	fmt.writeUInt16LE(2, 20);
	fmt.writeUInt16LE(16, 22);
	const dh = Buffer.alloc(8);
	dh.write("data", 0, "ascii");
	dh.writeUInt32LE(data.length, 4);
	const info = infoChunk([
		["INAM", t.title],
		["IART", t.artist],
		["IPRD", t.album],
		["IGNR", t.genre],
		["ICRD", t.year],
		["ITRK", t.track],
	]);
	const riff = Buffer.alloc(12);
	riff.write("RIFF", 0, "ascii");
	riff.writeUInt32LE(4 + fmt.length + info.length + dh.length + data.length, 4);
	riff.write("WAVE", 8, "ascii");
	writeFileSync(path, Buffer.concat([riff, fmt, info, dh, data]));
}

function seedDir(tag: string): string[] {
	const dir = join(tmpdir(), `shots-${tag}-${Date.now()}`);
	mkdirSync(dir, { recursive: true });
	return DEMO.map((t) => {
		const p = join(dir, t.file);
		writeTaggedWav(p, t);
		return p;
	});
}

async function shot(page: Page, name: string): Promise<void> {
	await page.evaluate(() => document.fonts?.ready);
	await page.waitForTimeout(450);
	await page.screenshot({
		path: `${SHOT_DIR}/${name}`,
		animations: "disabled",
	});
}

async function importSeed(page: Page, tag: string): Promise<void> {
	mkdirSync(SHOT_DIR, { recursive: true });
	await page.goto("./");
	await page.setInputFiles("input[type='file']", seedDir(tag));
	await expect(
		page.getByRole("button", { name: /Play Midnight Drive/ }).first(),
	).toBeVisible({ timeout: 20_000 });
}

async function playFirst(page: Page): Promise<void> {
	await page
		.getByRole("button", { name: /Play Midnight Drive/ })
		.first()
		.click();
	await expect(page.locator("footer").getByRole("status")).toContainText(
		"Playing",
		{ timeout: 15_000 },
	);
}

function isDesktop(page: {
	viewportSize(): { width: number } | null;
}): boolean {
	return (page.viewportSize()?.width ?? 1440) >= 768;
}

test.describe("screenshots", () => {
	test("library workspace", async ({ page }) => {
		test.skip(!isDesktop(page), "desktop screenshot");
		await page.setViewportSize({ width: 1920, height: 1080 });
		await importSeed(page, "lib");
		await shot(page, "music-library-desktop.png");
		await page.getByRole("tab", { name: "Albums" }).click();
		await shot(page, "albums-desktop.png");
		await page.getByRole("tab", { name: "Artists" }).click();
		await shot(page, "artists-desktop.png");
		await page.getByRole("tab", { name: "Genres" }).click();
		await shot(page, "genres-desktop.png");
	});

	test("playback and queue", async ({ page }) => {
		test.skip(!isDesktop(page), "desktop screenshot");
		await page.setViewportSize({ width: 1440, height: 900 });
		await importSeed(page, "play");
		await playFirst(page);
		await page
			.getByRole("button", { name: /Open now playing/ })
			.first()
			.click();
		await expect(
			page.getByRole("region", { name: "Now playing" }),
		).toBeVisible();
		await shot(page, "now-playing-desktop.png");
		await page
			.getByRole("region", { name: "Now playing" })
			.getByRole("button", { name: "Queue", exact: true })
			.click();
		await expect(
			page.getByRole("dialog", { name: "Play queue" }),
		).toBeVisible();
		await shot(page, "queue-desktop.png");
	});

	test("eq and dsp", async ({ page }) => {
		test.skip(!isDesktop(page), "desktop screenshot");
		await page.setViewportSize({ width: 1440, height: 900 });
		await importSeed(page, "eq");
		await playFirst(page);
		await page
			.getByRole("navigation", { name: "Primary" })
			.getByRole("button", { name: "EQ & DSP", exact: true })
			.click();
		// Apply a built-in preset so the graph shows a real curve.
		await page
			.getByRole("tablist", { name: "Audio tuning sections" })
			.getByRole("tab", { name: "Presets", exact: true })
			.click();
		await page.getByRole("searchbox", { name: "Search presets" }).fill("Warm");
		await page
			.locator("li", { hasText: "Adds gentle low-end weight" })
			.getByRole("button", { name: "Use", exact: true })
			.click();
		await page
			.getByRole("tablist", { name: "Audio tuning sections" })
			.getByRole("tab", { name: "EQ", exact: true })
			.click();
		await expect(
			page.getByRole("checkbox", { name: "Enable parametric EQ" }),
		).toBeChecked();
		await shot(page, "parametric-eq-desktop.png");
		await page.getByRole("tab", { name: "Graphic" }).click();
		await shot(page, "graphic-eq-desktop.png");
		await page
			.getByRole("tablist", { name: "Audio tuning sections" })
			.getByRole("tab", { name: "Dynamics", exact: true })
			.click();
		await shot(page, "dsp-workspace-desktop.png");
		await page
			.getByRole("tablist", { name: "Audio tuning sections" })
			.getByRole("tab", { name: "Presets", exact: true })
			.click();
		await page.getByRole("searchbox", { name: "Search presets" }).fill("");
		await shot(page, "preset-browser-desktop.png");
		await page.getByRole("searchbox", { name: "Search presets" }).fill("Warm");
		const card = page.locator("li", {
			hasText: "Adds gentle low-end weight",
		});
		await card.getByRole("button", { name: "Details" }).click();
		await shot(page, "preset-detail-desktop.png");
	});

	test("devices and autoeq", async ({ page }) => {
		test.skip(!isDesktop(page), "desktop screenshot");
		test.setTimeout(120_000);
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto("./");
		await page
			.getByRole("navigation", { name: "Primary" })
			.getByRole("button", { name: "Devices", exact: true })
			.click();
		await expect(
			page.getByRole("button", { name: "Sennheiser HD 600", exact: true }),
		).toBeVisible({ timeout: 30_000 });
		await shot(page, "device-catalog-desktop.png");
		await page
			.getByRole("button", { name: "Sennheiser HD 600", exact: true })
			.click();
		await expect(
			page.getByText(/EQ by oratory1990 via OPRA/).first(),
		).toBeVisible({ timeout: 15_000 });
		await shot(page, "device-detail-desktop.png");
		// My Devices with a saved profile.
		await page
			.getByRole("button", { name: "Create profile", exact: true })
			.click();
		await expect(
			page.getByText(/Profile created for Sennheiser HD 600/),
		).toBeVisible({ timeout: 15_000 });
		await page
			.getByRole("navigation", { name: "Primary" })
			.getByRole("button", { name: "My Devices", exact: true })
			.click();
		await expect(
			page.getByRole("button", { name: /Open profile Sennheiser/ }),
		).toBeVisible({ timeout: 15_000 });
		await shot(page, "my-devices-desktop.png");
		// Measurement import preview + AutoEQ results.
		let rows = "frequency,raw\n";
		for (let i = 0; i < 40; i++) {
			const f = Math.round(20 * (20000 / 20) ** (i / 39) * 10) / 10;
			rows += `${f},${Math.round((6 * Math.exp(-((Math.log10(f) - 3) ** 2) / 0.15) - 2) * 100) / 100}\n`;
		}
		const csv = join(tmpdir(), `shots-meas-${Date.now()}.csv`);
		writeFileSync(csv, rows);
		await page.getByRole("tab", { name: "Measurements" }).click();
		await page.locator('input[data-iem-file="measurement"]').setInputFiles(csv);
		await expect(
			page.getByRole("region", { name: "Import preview" }),
		).toBeVisible();
		await shot(page, "measurement-target-desktop.png");
	});

	test("autoeq results", async ({ page }) => {
		test.skip(!isDesktop(page), "desktop screenshot");
		test.setTimeout(120_000);
		await page.setViewportSize({ width: 1440, height: 900 });
		let rows = "frequency,raw\n";
		for (let i = 0; i < 40; i++) {
			const f = Math.round(20 * (20000 / 20) ** (i / 39) * 10) / 10;
			rows += `${f},${Math.round((6 * Math.exp(-((Math.log10(f) - 3) ** 2) / 0.15) - 2) * 100) / 100}\n`;
		}
		const csv = join(tmpdir(), `shots-ae-${Date.now()}.csv`);
		writeFileSync(csv, rows);
		await page.goto("./");
		await page
			.getByRole("navigation", { name: "Primary" })
			.getByRole("button", { name: "My Devices", exact: true })
			.click();
		await page.getByRole("tab", { name: "Measurements" }).click();
		await page.locator('input[data-iem-file="measurement"]').setInputFiles(csv);
		await expect(
			page.getByRole("region", { name: "Import preview" }),
		).toBeVisible();
		await page.getByRole("button", { name: /Save( \d+ channels)?/ }).click();
		await page.getByRole("tab", { name: "Profiles" }).click();
		await page.getByPlaceholder("My IEM").fill("Demo Studio Buds");
		const selects = page.locator("select");
		await selects.nth(0).selectOption({ index: 1 });
		await selects.nth(1).selectOption({ label: "Flat (0 dB)" });
		await page
			.getByRole("button", { name: "Create profile", exact: true })
			.click();
		await expect(
			page.getByRole("heading", { name: "Demo Studio Buds" }),
		).toBeVisible({ timeout: 15_000 });
		await page
			.getByRole("button", { name: "Generate EQ", exact: true })
			.click();
		await expect(page.getByText(/RMS before/)).toBeVisible({
			timeout: 60_000,
		});
		await shot(page, "autoeq-desktop.png");
	});

	test("guides", async ({ page }) => {
		test.skip(!isDesktop(page), "desktop screenshot");
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto("./");
		await page
			.getByRole("navigation", { name: "Primary" })
			.getByRole("button", { name: "Guides", exact: true })
			.click();
		await page.getByRole("button", { name: /EQ Basics/ }).click();
		await shot(page, "guides-eq-desktop.png");
		await page
			.getByRole("main", { name: "Content" })
			.getByRole("button", { name: "DSP", exact: true })
			.click();
		await page.getByRole("button", { name: /^DSP Guide/ }).click();
		await shot(page, "guides-dsp-desktop.png");
	});

	test("playlists cloud settings", async ({ page }) => {
		test.skip(!isDesktop(page), "desktop screenshot");
		await page.setViewportSize({ width: 1440, height: 900 });
		await importSeed(page, "lists");
		await playFirst(page);
		await page
			.getByRole("button", { name: /Play Glass Horizon/ })
			.first()
			.click();
		await page
			.getByRole("navigation", { name: "Primary" })
			.getByRole("button", { name: "Playlists", exact: true })
			.click();
		await page
			.getByPlaceholder("New playlist from current queue…")
			.fill("Evening Focus");
		await page.getByRole("button", { name: "Save queue as playlist" }).click();
		// Creation opens the detail directly — capture it, then go back.
		await expect(
			page.getByRole("heading", { name: "Evening Focus" }),
		).toBeVisible({ timeout: 15_000 });
		await shot(page, "playlist-detail-desktop.png");
		await page.getByRole("button", { name: "← Playlists" }).click();
		await expect(
			page.getByRole("button", { name: "Open playlist Evening Focus" }),
		).toBeVisible();
		await shot(page, "playlists-desktop.png");
		// Playlist import with a staged file.
		await page
			.getByRole("navigation", { name: "Primary" })
			.getByRole("button", { name: "Playlists", exact: true })
			.click();
		await page.getByRole("button", { name: "Import playlist" }).click();
		const m3u = join(tmpdir(), `shots-${Date.now()}.m3u`);
		writeFileSync(
			m3u,
			`#EXTM3U\n#EXTINF:-1,Neon Coast - Midnight Drive\nMidnight Drive\n#EXTINF:-1,Copper Field - Copper Sky\nCopper Sky\n`,
		);
		await page.getByLabel("Choose playlist file").setInputFiles(m3u);
		await expect(page.getByText("Matched: 0 · Needs review: 2")).toBeVisible({
			timeout: 15_000,
		});
		await shot(page, "playlist-import-desktop.png");
		// Cloud sources (unconfigured provider cards, no personal data).
		await openSettings(page);
		await page
			.getByRole("heading", { name: "Sources" })
			.evaluate((el) => el.scrollIntoView({ block: "start" }));
		await shot(page, "cloud-sources-desktop.png");
		await page
			.getByRole("heading", { name: "Settings" })
			.evaluate((el) => el.scrollIntoView({ block: "start" }));
		await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
		await shot(page, "settings-desktop.png");
	});

	test("mobile flows", async ({ page }) => {
		test.skip(isDesktop(page), "mobile screenshot");
		await importSeed(page, "mob");
		await shot(page, "music-library-mobile.png");
		await playFirst(page);
		await page
			.getByRole("button", { name: /Open now playing/ })
			.first()
			.click();
		await expect(
			page.getByRole("region", { name: "Now playing" }),
		).toBeVisible();
		await shot(page, "now-playing-mobile.png");
		await page.getByRole("button", { name: "Back to library" }).click();
		await page.getByRole("button", { name: "EQ", exact: true }).click();
		await shot(page, "eq-mobile.png");
	});
});
