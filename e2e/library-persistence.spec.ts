import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

/**
 * Persistence across reload: import two files, favorite one, save a
 * playlist, reload, and verify the library (tracks, album, artist,
 * favorite, playlist) survived while picked files honestly report
 * "Unavailable" until re-selected — then playback heals the record.
 */
function writeSineWav(path: string, frequency: number): void {
	const sampleRate = 8000;
	const samples = sampleRate;
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
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(1, 22);
	header.writeUInt32LE(sampleRate, 24);
	header.writeUInt32LE(sampleRate * 2, 28);
	header.writeUInt16LE(2, 32);
	header.writeUInt16LE(16, 34);
	header.write("data", 36);
	header.writeUInt32LE(data.length, 40);
	writeFileSync(path, Buffer.concat([header, data]));
}

test.describe("library persistence", () => {
	test("import, favorite, playlist, reload, heal, play", async ({ page }) => {
		const stamp = Date.now();
		const wavA = join(tmpdir(), `persist-a-${stamp}.wav`);
		const wavB = join(tmpdir(), `persist-b-${stamp}.wav`);
		writeSineWav(wavA, 440);
		writeSineWav(wavB, 660);

		await page.goto("./");
		await page.setInputFiles("input[type='file']", [wavA, wavB]);
		// The overview shows each track in both a rail and the full list.
		const rowA = page
			.getByRole("button", {
				name: new RegExp(`Play persist-a-${stamp}`),
			})
			.first();
		await expect(rowA).toBeVisible({ timeout: 15_000 });
		await expect(
			page
				.getByRole("button", {
					name: new RegExp(`Play persist-b-${stamp}`),
				})
				.first(),
		).toBeVisible();

		// Favorite the first track.
		await page
			.getByRole("button", {
				name: new RegExp(`Add persist-a-${stamp}.*to favorites`),
			})
			.click();

		// Save the queue as a playlist.
		await page.getByRole("button", { name: "Playlists" }).click();
		await page
			.getByPlaceholder("New playlist from current queue…")
			.fill("Persist Mix");
		await page.getByRole("button", { name: "Save queue as playlist" }).click();
		await expect(
			page.getByRole("heading", { name: "Persist Mix" }),
		).toBeVisible();

		await page.reload();
		await expect(rowA).toBeVisible({ timeout: 15_000 });

		// Album + artist grouping survived.
		await page.getByRole("tab", { name: "Albums" }).click();
		await expect(
			page.getByRole("button", { name: /Unknown album/ }).first(),
		).toBeVisible();
		await page.getByRole("tab", { name: "Artists" }).click();
		await expect(
			page.getByRole("button", { name: /Unknown artist/ }).first(),
		).toBeVisible();

		// Favorite + playlist survived.
		await page.getByRole("tab", { name: "Favorites" }).click();
		await expect(rowA).toBeVisible();
		await page.getByRole("button", { name: "Playlists" }).click();
		await expect(
			page.getByRole("button", { name: /Persist Mix/ }).first(),
		).toBeVisible();

		// Picked files cannot survive reload without re-selection: honest state.
		await page.getByRole("button", { name: "Music", exact: true }).click();
		await page.getByRole("tab", { name: "All Music" }).click();
		await expect(page.getByText("Unavailable").first()).toBeVisible();

		// Re-selecting heals the records and playback works again.
		await page.setInputFiles("input[type='file']", [wavA, wavB]);
		await expect(page.getByText("Unavailable")).toHaveCount(0, {
			timeout: 15_000,
		});
		await rowA.click();
		await expect(page.locator("footer").getByRole("status")).toContainText(
			"Playing",
			{
				timeout: 15_000,
			},
		);
	});

	test("settings shows the music-library section", async ({ page }) => {
		await page.goto("./");
		await page.getByRole("button", { name: "Settings" }).click();
		await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
	});
});
