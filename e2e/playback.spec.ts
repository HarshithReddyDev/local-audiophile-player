import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

/**
 * Real end-to-end playback: synthesize a 1s 440Hz WAV in-test (no fixtures
 * to commit), import it through the file input, and drive the actual
 * transport — play, time advance, pause, seek — in headless Chromium.
 */
function writeSineWav(path: string, seconds = 1): void {
	const sampleRate = 8000;
	const samples = sampleRate * seconds;
	const data = Buffer.alloc(samples * 2);
	for (let i = 0; i < samples; i++) {
		const v = Math.round(
			Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 32767,
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

test.describe("local file playback", () => {
	test("import, play, pause, seek a generated WAV", async ({ page }) => {
		const wav = join(tmpdir(), `iem-player-test-${Date.now()}.wav`);
		writeSineWav(wav);

		await page.goto("./");
		await page.setInputFiles("input[type='file']", wav);
		const row = page.getByRole("button", { name: /Play iem-player-test-/ });
		await expect(row.first()).toBeVisible({ timeout: 15_000 });

		// Import auto-starts playback of the first track. Scoped to the player
		// footer: the import buttons expose their own progress status.
		const status = page.locator("footer").getByRole("status");
		await expect(status).toContainText("Playing", { timeout: 15_000 });

		// Play and pause via keyboard.
		await page.keyboard.press("Space");
		await expect(status).toContainText("paused", { timeout: 5_000 });
		await page.keyboard.press("Space");
		await expect(status).toContainText("Playing", { timeout: 15_000 });

		// Seek slider becomes usable once duration is known (~1s file).
		const seek = page.getByRole("slider", { name: "Seek" });
		await expect(seek).toBeEnabled({ timeout: 10_000 });
		await seek.fill("0.5");
		await expect(status).toContainText("Playing");

		// Queue contains the track. The queue toggle lives on wider layouts;
		// queue logic itself is covered by store unit tests.
		const queueButton = page.getByRole("button", { name: "Open queue" });
		if (await queueButton.isVisible()) {
			await queueButton.click();
			await expect(
				page.getByRole("dialog", { name: "Play queue" }),
			).toBeVisible();
		}
	});

	test("pause then resume keeps position instead of restarting", async ({
		page,
	}) => {
		const wav = join(tmpdir(), `iem-player-resume-${Date.now()}.wav`);
		writeSineWav(wav, 8);
		await page.goto("./");
		await page.setInputFiles("input[type='file']", wav);
		const status = page.locator("footer").getByRole("status");
		await expect(status).toContainText("Playing", { timeout: 15_000 });

		const seek = page.getByRole("slider", { name: "Seek" });
		await expect(seek).toBeEnabled({ timeout: 10_000 });
		await seek.fill("0.5");
		// Body focus: Space on the slider itself must not drive transport.
		await page.evaluate(() => {
			if (document.activeElement instanceof HTMLElement)
				document.activeElement.blur();
		});
		await page.keyboard.press("Space");
		await expect(status).toContainText("paused", { timeout: 5_000 });
		const pausedAt = Number.parseFloat(await seek.inputValue());
		expect(pausedAt).toBeGreaterThan(0.3);

		// Resume: position must continue, not restart from 0.
		await page.keyboard.press("Space");
		await expect(status).toContainText("Playing", { timeout: 15_000 });
		await page.waitForTimeout(300);
		const resumedAt = Number.parseFloat(await seek.inputValue());
		expect(resumedAt).toBeGreaterThan(pausedAt - 0.25);
	});

	test("Space on a focused transport button toggles exactly once", async ({
		page,
	}) => {
		const wav = join(tmpdir(), `iem-player-key-${Date.now()}.wav`);
		writeSineWav(wav);
		await page.goto("./");
		await page.setInputFiles("input[type='file']", wav);
		const status = page.locator("footer").getByRole("status");
		await expect(status).toContainText("Playing", { timeout: 15_000 });

		// Focus the Play/Pause button: Space must activate it once (pause),
		// not also fire the global shortcut (which would replay).
		await page.getByRole("button", { name: "Pause" }).focus();
		await page.keyboard.press("Space");
		await expect(status).toContainText("paused", { timeout: 5_000 });
	});

	test("clearing the queue stops audio and idles the transport", async ({
		page,
	}) => {
		const wav = join(tmpdir(), `iem-player-clear-${Date.now()}.wav`);
		writeSineWav(wav);
		await page.goto("./");
		await page.setInputFiles("input[type='file']", wav);
		const status = page.locator("footer").getByRole("status");
		await expect(status).toContainText("Playing", { timeout: 15_000 });

		const queueButton = page.getByRole("button", { name: "Open queue" });
		if (!(await queueButton.isVisible())) return; // narrow layout: covered on desktop
		await queueButton.click();
		await page.getByRole("button", { name: "Clear", exact: true }).click();
		await expect(page.getByText(/Queue is empty/)).toBeVisible();
		// Audio stopped: the transport reports idle, never stuck "Playing".
		await expect(status).toContainText("Player idle", { timeout: 5_000 });
	});

	test("deleting a playlist asks first; dismiss keeps it", async ({ page }) => {
		const wav = join(tmpdir(), `iem-player-pl-${Date.now()}.wav`);
		writeSineWav(wav);
		await page.goto("./");
		await page.setInputFiles("input[type='file']", wav);
		const row = page.getByRole("button", {
			name: /Play iem-player-pl-/,
		});
		await expect(row.first()).toBeVisible({ timeout: 15_000 });

		await page.getByRole("button", { name: "Playlists" }).first().click();
		await page
			.getByPlaceholder("New playlist from current queue…")
			.fill("Roadtrip");
		await page.getByRole("button", { name: "Save queue as playlist" }).click();
		await expect(page.getByRole("button", { name: "← Playlists" })).toBeVisible(
			{ timeout: 10_000 },
		);
		await page.getByRole("button", { name: "← Playlists" }).click();

		// Dismiss keeps the playlist.
		page.once("dialog", (dialog) => void dialog.dismiss());
		await page
			.getByRole("button", { name: "Delete playlist Roadtrip" })
			.click();
		await expect(
			page.getByRole("button", { name: "Delete playlist Roadtrip" }),
		).toBeVisible();
		// Accept deletes it irreversibly.
		page.once("dialog", (dialog) => void dialog.accept());
		await page
			.getByRole("button", { name: "Delete playlist Roadtrip" })
			.click();
		await expect(page.getByText("No playlists yet")).toBeVisible({
			timeout: 10_000,
		});
	});
});
