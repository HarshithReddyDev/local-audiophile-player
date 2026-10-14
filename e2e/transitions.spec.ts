import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { writeSineWav } from "./fixtures";

/**
 * Transition behavior with real audio: gapless auto-advance through the
 * preload path, and equal-power crossfade completion. Timing bounds are
 * deliberately generous — they prove functional continuity (no stalls,
 * no errors, no dead air from reloads), not sample accuracy, which the
 * architecture honestly cannot guarantee (see docs/playback-engine.md).
 */
async function importTwo(
	page: Page,
	stamp: string,
	seconds: number,
): Promise<void> {
	const a = join(tmpdir(), `tr-${stamp}-a.wav`);
	const b = join(tmpdir(), `tr-${stamp}-b.wav`);
	writeSineWav(a, 440, seconds);
	writeSineWav(b, 554, seconds);
	await page.goto("./");
	await page.setInputFiles("input[type='file']", [a, b]);
	await expect(
		page.getByRole("button", { name: /Play tr-/ }).first(),
	).toBeVisible({
		timeout: 15_000,
	});
}

test.describe("track transitions", () => {
	test("auto-advance plays the next track without stalling", async ({
		page,
	}) => {
		await importTwo(page, `gap-${Date.now()}`, 1.5);
		const status = page.locator("footer").getByRole("status");
		await expect(status).toContainText("Playing", { timeout: 15_000 });
		const first = await status.innerText();
		const started = Date.now();
		// The 1.5s first track ends; the preloaded second must take over.
		await expect(status).not.toContainText(first, { timeout: 12_000 });
		const elapsed = Date.now() - started;
		await expect(status).toContainText("Playing", { timeout: 5_000 });
		expect(elapsed).toBeLessThan(12_000);
		await expect(page.getByRole("alert")).toHaveCount(0);
	});

	test("crossfade completes into the next track", async ({ page }) => {
		await importTwo(page, `xfade-${Date.now()}`, 5);
		const status = page.locator("footer").getByRole("status");
		await expect(status).toContainText("Playing", { timeout: 15_000 });

		await page.getByRole("button", { name: "Settings" }).click();
		await page.getByRole("checkbox", { name: "Enable crossfade" }).check();
		const duration = page.getByRole("slider", { name: "Crossfade duration" });
		await duration.fill("2");

		// Back to the library; the 5s track crosses into the fade window.
		await page.getByRole("button", { name: "Music", exact: true }).click();
		const first = await status.innerText();
		await expect(status).not.toContainText(first, { timeout: 15_000 });
		await expect(status).toContainText("Playing", { timeout: 5_000 });
		await expect(page.getByRole("alert")).toHaveCount(0);
	});
});
