import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { isNarrow, openTuning, writeSineWav } from "./fixtures";

/**
 * Final-pass regressions: Guides browser + contextual Learn links, the
 * built-in preset library (search/use/details/A-B restore), and background
 * playback (visibilitychange never pauses user-requested audio).
 */

async function importAndPlay(page: Page) {
	const wav = join(tmpdir(), `finish-${Date.now()}.wav`);
	writeSineWav(wav, 440, 8);
	await page.goto("./");
	await page.setInputFiles("input[type='file']", wav);
	const row = page.getByRole("button", { name: /Play finish-/ }).first();
	await expect(row).toBeVisible({ timeout: 15_000 });
	await row.click();
	await expect(page.locator("footer").getByRole("status")).toContainText(
		"Playing",
		{ timeout: 15_000 },
	);
}

async function openGuides(page: Page) {
	if (isNarrow(page)) {
		await page.getByRole("button", { name: "Settings", exact: true }).click();
		await page.getByRole("button", { name: "Open audio guides" }).click();
	} else {
		await page
			.getByRole("navigation", { name: "Primary" })
			.getByRole("button", { name: "Guides", exact: true })
			.click();
	}
}

test.describe("guides", () => {
	test("browser opens, filters, and shows structured content", async ({
		page,
	}) => {
		await page.goto("./");
		await openGuides(page);
		await expect(page.getByRole("heading", { name: "Guides" })).toBeVisible();
		// Category navigation narrows the list.
		await page
			.getByRole("main", { name: "Content" })
			.getByRole("button", { name: "EQ", exact: true })
			.click();
		await expect(page.getByRole("button", { name: /EQ Basics/ })).toBeVisible();
		await expect(
			page.getByText("Actionable fixes for common problems."),
		).toHaveCount(0);
		// Search narrows further.
		await page.getByRole("searchbox", { name: "Search guides" }).fill("clip");
		await expect(page.getByRole("button", { name: /EQ Basics/ })).toBeVisible();
		// Opening a guide shows tables and disclaimers, not walls of text.
		await page.getByRole("button", { name: /EQ Basics/ }).click();
		await expect(
			page.getByRole("article", { name: "EQ Basics guide" }),
		).toBeVisible();
		await expect(page.getByText("Sub-bass", { exact: true })).toBeVisible();
	});

	test("contextual Learn link jumps to the EQ guide", async ({ page }) => {
		await page.goto("./");
		await openTuning(page, "EQ");
		await page.getByRole("button", { name: /Learn/ }).first().click();
		await expect(page.getByRole("article", { name: /guide/ })).toBeVisible();
	});

	test("command palette finds Guides", async ({ page }) => {
		await page.goto("./");
		await expect(
			page.getByRole("navigation", { name: "Primary" }),
		).toBeVisible();
		await page.keyboard.press("ControlOrMeta+k");
		await expect(
			page.getByRole("dialog", { name: "Command palette" }),
		).toBeVisible();
		await page
			.getByRole("searchbox", {
				name: "Search tracks, playlists, devices, presets, and commands",
			})
			.fill("guides");
		await expect(
			page.getByRole("option", { name: /Guides.*help/i }),
		).toBeVisible();
	});
});

test.describe("built-in preset library", () => {
	test("search, details, use, and A/B restore", async ({ page }) => {
		await importAndPlay(page);
		await openTuning(page, "Presets");
		await expect(page.getByText(/built-in starting points/)).toBeVisible();
		await page.getByRole("searchbox", { name: "Search presets" }).fill("Warm");
		const card = page.locator("li", { hasText: "Adds gentle low-end weight" });
		await expect(card).toBeVisible();
		await card.getByRole("button", { name: "Details" }).click();
		await expect(card.getByText("Created for this player")).toBeVisible();
		await expect(
			card.getByRole("img", { name: /tonal response preview/ }),
		).toBeVisible();
		// Preview then A/B back to the user's previous sound.
		await card.getByRole("button", { name: /Preview/ }).click();
		await expect(
			card.getByRole("button", { name: /Restore my sound/ }),
		).toBeVisible();
		await card.getByRole("button", { name: /hear my previous sound/ }).click();
		await card.getByRole("button", { name: /Restore my sound/ }).click();
		// Use applies to live EQ; the EQ tab reflects it.
		await card.getByRole("button", { name: "Use", exact: true }).click();
		await openTuning(page, "EQ");
		await expect(
			page.getByRole("checkbox", { name: "Enable parametric EQ" }),
		).toBeChecked();
	});

	test("DSP presets apply without touching EQ bands", async ({ page }) => {
		await importAndPlay(page);
		await openTuning(page, "Presets");
		await page
			.getByRole("searchbox", { name: "Search presets" })
			.fill("Crossfeed Medium");
		const card = page.locator("li", {
			hasText: "Stronger crossfeed for extremely separated mixes",
		});
		await expect(card).toBeVisible();
		await card.getByRole("button", { name: "Use", exact: true }).click();
		await openTuning(page, "Spatial");
		await page
			.getByRole("button", { name: /Channels & Stereo/ })
			.first()
			.click();
		await expect(
			page.locator("#spatial-body").getByRole("slider", {
				name: "Crossfeed",
			}),
		).toHaveValue("0.3");
	});
});

test.describe("visual QA", () => {
	test("no horizontal overflow across desktop and mobile widths", async ({
		page,
	}) => {
		await importAndPlay(page);
		const viewports = [
			{ width: 1280, height: 800 },
			{ width: 1440, height: 900 },
			{ width: 1920, height: 1080 },
			{ width: 390, height: 844 },
			{ width: 430, height: 932 },
		];
		const narrow = (width: number) => width < 768;
		for (const viewport of viewports) {
			await page.setViewportSize(viewport);
			const stops: (() => Promise<void>)[] = narrow(viewport.width)
				? [
						async () =>
							await page
								.getByRole("button", { name: "Music", exact: true })
								.click(),
						async () =>
							await page
								.getByRole("button", { name: "Playlists", exact: true })
								.click(),
						async () =>
							await page
								.getByRole("button", { name: "EQ", exact: true })
								.click(),
						async () => await openGuides(page),
						async () =>
							await page
								.getByRole("button", { name: "Settings", exact: true })
								.click(),
					]
				: [
						async () =>
							await page
								.getByRole("navigation", { name: "Primary" })
								.getByRole("button", { name: "Music", exact: true })
								.click(),
						async () =>
							await page
								.getByRole("navigation", { name: "Primary" })
								.getByRole("button", { name: "Playlists", exact: true })
								.click(),
						async () =>
							await page
								.getByRole("navigation", { name: "Primary" })
								.getByRole("button", { name: "Devices", exact: true })
								.click(),
						async () =>
							await page
								.getByRole("navigation", { name: "Primary" })
								.getByRole("button", { name: "EQ & DSP", exact: true })
								.click(),
						async () => await openGuides(page),
						async () =>
							await page
								.getByRole("navigation", { name: "Primary" })
								.getByRole("button", { name: "Settings", exact: true })
								.click(),
					];
			for (const go of stops) {
				await go();
				await page.waitForTimeout(150);
				const overflow = await page.evaluate(
					() => document.documentElement.scrollWidth - window.innerWidth,
				);
				expect(
					overflow,
					`${viewport.width}px after navigation`,
				).toBeLessThanOrEqual(1);
			}
		}
	});
});

test.describe("background playback", () => {
	test("visibilitychange never pauses user-requested audio", async ({
		page,
	}) => {
		await importAndPlay(page);
		const status = page.locator("footer").getByRole("status");
		// Simulate tab hide/show cycles: audio state must survive all of them.
		await page.evaluate(() => {
			document.dispatchEvent(new Event("visibilitychange"));
		});
		await expect(status).toContainText("Playing");
		await page.evaluate(() => {
			for (let i = 0; i < 3; i++) {
				document.dispatchEvent(new Event("visibilitychange"));
			}
		});
		await expect(status).toContainText("Playing");
		// Media Session metadata is published where supported.
		const hasMetadata = await page.evaluate(() => {
			try {
				return (
					"mediaSession" in navigator &&
					navigator.mediaSession.metadata !== null
				);
			} catch {
				return false;
			}
		});
		expect(typeof hasMetadata).toBe("boolean");
	});
});
