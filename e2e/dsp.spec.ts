import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { openTuning, writeSineWav } from "./fixtures";

async function importOne(page: Page, stamp: string): Promise<void> {
	const path = join(tmpdir(), `dsp-${stamp}.wav`);
	writeSineWav(path, 440, 8);
	await page.goto("./");
	await page.setInputFiles("input[type='file']", [path]);
	await expect(
		page.getByRole("button", { name: /Play dsp-/ }).first(),
	).toBeVisible({ timeout: 15_000 });
}

test.describe("DSP deck", () => {
	test("graphic mode, module toggles, and behavioral preset", async ({
		page,
	}) => {
		await importOne(page, `deck-${Date.now()}`);
		const status = page.locator("footer").getByRole("status");
		await expect(status).toContainText("Playing", { timeout: 15_000 });

		// Graphic mode: layout switch + slider move + flatten.
		await openTuning(page, "EQ");
		await page.getByRole("tab", { name: "Graphic" }).click();
		await expect(
			page.getByRole("slider", { name: /1 kilohertz band gain/ }),
		).toBeVisible();
		const slider = page.getByRole("slider", { name: /1 kilohertz band gain/ });
		await slider.fill("6");
		await expect(slider).toHaveValue("6");
		await page
			.getByRole("combobox", { name: "Graphic EQ layout" })
			.selectOption("31");
		await expect(
			page.getByRole("slider", { name: /31\.5 hertz band gain/ }),
		).toBeVisible();
		await page.getByRole("button", { name: "Flatten", exact: true }).click();
		await expect(
			page.getByRole("slider", { name: /31\.5 hertz band gain/ }),
		).toHaveValue("0");

		// DSP workspace: per-module tabs (Tone/Dynamics/Spatial/Loudness).
		// Each expanded module exposes its enable control in the body
		// (the collapsed header carries a quick toggle with the same label).
		await openTuning(page, "Tone");
		await page
			.getByRole("button", { name: /Bass \/ Treble/ })
			.first()
			.click();
		await expect(
			page
				.locator("#tone-body")
				.getByRole("checkbox", { name: "Enable bass", exact: true }),
		).toBeVisible();
		await openTuning(page, "Dynamics");
		await expect(
			page.getByRole("button", { name: /Compressor/ }),
		).toBeVisible();
		await page
			.getByRole("button", { name: /Compressor/ })
			.first()
			.click();
		await expect(
			page
				.locator("#dynamics-body")
				.getByRole("checkbox", { name: "Enable compressor", exact: true }),
		).toBeVisible();
		await openTuning(page, "Spatial");
		for (const [heading, body, name] of [
			["Channels & Stereo", "spatial", "Enable channel processing"],
			["Reverb", "reverb", "Enable reverb"],
		] as [string, string, string][]) {
			await page
				.getByRole("button", { name: new RegExp(heading) })
				.first()
				.click();
			await expect(
				page
					.locator(`#${body}-body`)
					.getByRole("checkbox", { name, exact: true }),
			).toBeVisible();
		}
		await openTuning(page, "Loudness");
		await page
			.getByRole("button", { name: /Equal Loudness/ })
			.first()
			.click();
		await expect(
			page
				.locator("#loudness-body")
				.getByRole("checkbox", { name: "Enable equal loudness", exact: true }),
		).toBeVisible();
		await openTuning(page, "Dynamics");
		await page
			.getByRole("button", { name: /Peak Safety Limiter/ })
			.first()
			.click();
		await expect(
			page.locator("#limiter-body").getByRole("checkbox", {
				name: "Enable peak safety limiter",
				exact: true,
			}),
		).toBeVisible();
		// Compressor on + threshold drag; meter area appears.
		await page
			.getByRole("button", { name: /Compressor/ })
			.first()
			.click();
		await page
			.locator("#dynamics-body")
			.getByRole("checkbox", { name: "Enable compressor" })
			.check();
		await page.getByRole("slider", { name: "Threshold" }).fill("-12");
		// Behavioral preset applies a documented starting point.
		await page.getByRole("button", { name: "Mono", exact: true }).click();
		await openTuning(page, "Spatial");
		await page
			.getByRole("button", { name: /Channels & Stereo/ })
			.first()
			.click();
		await expect(
			page
				.locator("#spatial-body")
				.getByRole("checkbox", { name: "Enable channel processing" }),
		).toBeChecked();
		// Playback survives the whole session (no engine teardown).
		await expect(status).toContainText("Playing");
	});

	test("device layer banner and limiter honesty copy", async ({ page }) => {
		await importOne(page, `layer-${Date.now()}`);
		await openTuning(page, "DSP");
		await expect(page.getByText("About this DSP chain")).toBeVisible();
		await page.getByText("About this DSP chain").click();
		await page.getByRole("button", { name: /Peak Safety Limiter/ }).click();
		await expect(page.getByText(/NOT a true-peak limiter/)).toBeVisible();
		await expect(
			page.getByText(/only inside this player/i).first(),
		).toBeVisible();
	});

	test("now playing info, lyrics, and visuals tabs", async ({ page }) => {
		await importOne(page, `np-${Date.now()}`);
		const status = page.locator("footer").getByRole("status");
		await expect(status).toContainText("Playing", { timeout: 15_000 });
		// Open Now Playing via the player bar artwork/title button.
		await page
			.getByRole("button", { name: /Open now playing|Now playing/ })
			.first()
			.click();
		await page.getByRole("tab", { name: "Lyrics" }).click();
		await expect(page.getByText(/No embedded lyrics/)).toBeVisible();
		await page.getByRole("tab", { name: "Visuals" }).click();
		await expect(page.getByRole("img", { name: /visualizer/i })).toBeVisible();
		await page.getByRole("tab", { name: "Info" }).click();
		await expect(page.getByText("Container")).toBeVisible();
		await expect(page.getByText(/not computed/)).toBeVisible();
	});

	test("playlist exports to M3U download", async ({ page }) => {
		await importOne(page, `m3u-${Date.now()}`);
		await page.getByRole("button", { name: "Playlists", exact: true }).click();
		await page
			.getByPlaceholder("New playlist from current queue…")
			.fill("M3U Test");
		await page.getByRole("button", { name: "Save queue as playlist" }).click();
		// Saving opens the playlist directly.
		await expect(page.getByRole("heading", { name: "M3U Test" })).toBeVisible({
			timeout: 10_000,
		});
		const download = page.waitForEvent("download");
		await page
			.getByRole("button", { name: /Export playlist .* as M3U/ })
			.click();
		const file = await download;
		expect(file.suggestedFilename()).toMatch(/\.m3u$/);
	});

	test("smart playlist rule and CUE import validation", async ({ page }) => {
		await importOne(page, `smart-${Date.now()}`);
		await page.getByRole("button", { name: "Playlists", exact: true }).click();
		await page.getByRole("button", { name: "Recently added" }).click();
		await expect(
			page.getByRole("button", { name: /Play dsp-smart-/ }),
		).toBeVisible();
		// CUE without its audio in the library fails safe with guidance.
		const cue = join(tmpdir(), `missing-${Date.now()}.cue`);
		const { writeFileSync } = await import("node:fs");
		writeFileSync(
			cue,
			'FILE "ghost.flac" WAVE\n  TRACK 01 AUDIO\n    INDEX 01 00:00:00\n',
		);
		await page.setInputFiles("input[aria-label='Import CUE sheet']", [cue]);
		await expect(page.getByText(/not in the library yet/)).toBeVisible({
			timeout: 10_000,
		});
	});
});
