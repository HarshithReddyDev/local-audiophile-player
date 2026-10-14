import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
	isNarrow,
	openQueue,
	openSettings,
	openTuning,
	writeSineWav,
} from "./fixtures";

async function importAndPlay(page: Page) {
	const wav = join(tmpdir(), `iem-ux-${Date.now()}.wav`);
	writeSineWav(wav, 440, 4);
	await page.goto("./");
	await page.setInputFiles("input[type='file']", wav);
	const row = page.getByRole("button", { name: /Play iem-ux-/ });
	await expect(row.first()).toBeVisible({ timeout: 15_000 });
	const status = page.locator("footer").getByRole("status");
	await expect(status).toContainText("Playing", { timeout: 15_000 });
	return status;
}

test.describe("consolidated player UX", () => {
	test("mini player shows device status; full player exposes quick audio", async ({
		page,
	}) => {
		await importAndPlay(page);
		// Mini player: active-configuration badge is always visible.
		await expect(
			page.getByRole("button", { name: /Active audio configuration/ }),
		).toBeVisible();
		// Open the full player from the artwork button.
		await page
			.getByRole("button", { name: /Open now playing/ })
			.first()
			.click();
		await expect(
			page.getByRole("region", { name: "Now playing" }),
		).toBeVisible();
		// Quick audio: profile, EQ switch, preamp/bass/treble, limiter, A/B.
		await expect(
			page.getByRole("region", { name: "Quick audio controls" }),
		).toBeVisible();
		await expect(
			page.getByRole("group", {
				name: "A/B comparison: current DSP versus bypassed",
			}),
		).toBeVisible();
		await expect(page.getByRole("button", { name: /More DSP/ })).toBeVisible();
		// The mini player unmounts while Now Playing is open; playback
		// continues visibly via the full-player transport instead.
		await expect(
			page
				.getByRole("region", { name: "Now playing" })
				.getByRole("button", { name: "Pause" }),
		).toBeVisible();
	});

	test("DSP pill bypasses without mutating settings, then restores", async ({
		page,
	}) => {
		// The mini-player pill is desktop-only; mobile bypasses from the
		// full-player quick controls instead.
		test.skip(isNarrow(page), "mini-player DSP pill is desktop-only");
		await importAndPlay(page);
		const pill = page.getByRole("button", { name: /DSP (ON|OFF)/ });
		await expect(pill).toBeVisible();
		await pill.click();
		await expect(page.getByRole("button", { name: "DSP OFF" })).toBeVisible();
		await expect(
			page.getByRole("button", { name: /Active audio configuration/ }),
		).toContainText("BYPASSED");
		await page.getByRole("button", { name: "DSP OFF" }).click();
		await expect(page.getByRole("button", { name: "DSP ON" })).toBeVisible();
	});

	test("A/B compare toggles listening only", async ({ page }) => {
		await importAndPlay(page);
		await openTuning(page, "DSP");
		const compare = page.getByRole("group", {
			name: "A/B comparison: current DSP versus bypassed",
		});
		await expect(compare).toBeVisible();
		await compare.getByRole("button", { name: "B · Bypass" }).click();
		await expect(
			compare.getByText("Comparing bypass — settings untouched"),
		).toBeVisible();
		await compare.getByRole("button", { name: "A · DSP" }).click();
		await expect(
			compare.getByText("Comparing bypass — settings untouched"),
		).toHaveCount(0);
	});

	test("DSP workspace collapses modules and keeps the preset bar", async ({
		page,
	}) => {
		await importAndPlay(page);
		await openTuning(page, "DSP");
		await expect(
			page.getByRole("region", { name: "DSP preset bar" }),
		).toBeVisible();
		// Modules start collapsed with concise summaries: the expanded body
		// is unmounted, only the header quick toggle remains.
		await expect(
			page.getByRole("button", { name: /Peak Safety Limiter/ }),
		).toBeVisible();
		await expect(page.locator("#limiter-body")).toHaveCount(0);
		// Expand, toggle, collapse again.
		await page.getByRole("button", { name: /Peak Safety Limiter/ }).click();
		const enable = page
			.locator("#limiter-body")
			.getByRole("checkbox", { name: "Enable peak safety limiter" });
		await expect(enable).toBeVisible();
		await expect(enable).toBeChecked();
		await enable.uncheck();
		await expect(
			page.getByText("OFF — unprotected", { exact: true }).first(),
		).toBeVisible();
		await page.getByRole("button", { name: /Peak Safety Limiter/ }).click();
		await expect(page.locator("#limiter-body")).toHaveCount(0);
		// Restore protection for a clean slate.
		await page.getByRole("button", { name: /Peak Safety Limiter/ }).click();
		await enable.check();
	});

	test("device quick switcher searches and reports empty states", async ({
		page,
	}) => {
		await importAndPlay(page);
		await openTuning(page, "DSP");
		const search = page.getByRole("searchbox", {
			name: "Search devices and profiles",
		});
		await expect(search).toBeVisible();
		await expect(
			page.getByText("No profiles yet — create one from a device."),
		).toBeVisible();
		await search.fill("zzz-no-such-device");
		await expect(page.getByText("No devices or profiles match.")).toBeVisible();
	});

	test("lyrics and visualizer tabs open from Now Playing", async ({ page }) => {
		await importAndPlay(page);
		await page
			.getByRole("button", { name: /Open now playing/ })
			.first()
			.click();
		await page.getByRole("tab", { name: "Lyrics" }).click();
		await expect(page.getByText(/No embedded lyrics/)).toBeVisible();
		await page.getByRole("tab", { name: "Visuals" }).click();
		await expect(page.getByRole("img", { name: /visualizer/i })).toBeVisible();
	});

	test("command palette finds routes and runs commands", async ({ page }) => {
		await importAndPlay(page);
		await page.keyboard.press("ControlOrMeta+k");
		await expect(
			page.getByRole("dialog", { name: "Command palette" }),
		).toBeVisible();
		await page
			.getByRole("searchbox", {
				name: "Search tracks, playlists, devices, presets, and commands",
			})
			.fill("dsp");
		await expect(
			page.getByRole("option", { name: /DSP.*workspace/i }),
		).toBeVisible();
		await page.keyboard.press("Enter");
		await expect(
			page.getByRole("region", { name: "DSP preset bar" }),
		).toBeVisible();
	});

	test("keyboard shortcuts navigate views", async ({ page }) => {
		await importAndPlay(page);
		await page.keyboard.press("e");
		await expect(
			page.getByRole("heading", { name: /Parametric EQ|Graphic EQ/ }),
		).toBeVisible();
		await page.keyboard.press("v");
		await expect(
			page.getByRole("region", { name: "Now playing" }),
		).toBeVisible();
		await expect(
			page.getByRole("tab", { name: "Visuals", selected: true }),
		).toBeVisible();
		await page.getByRole("button", { name: "Back to library" }).click();
		await expect(page.getByRole("region", { name: "Now playing" })).toHaveCount(
			0,
		);
	});

	test("queue add, reorder affordances, and source badges", async ({
		page,
	}) => {
		await importAndPlay(page);
		await openQueue(page);
		await expect(
			page.getByRole("dialog", { name: "Play queue" }),
		).toBeVisible();
		// Local tracks carry a Local badge in the queue.
		await expect(
			page.getByText("Local", { exact: true }).first(),
		).toBeVisible();
	});

	test("theme switch and DSP bypass persist across reload", async ({
		page,
	}) => {
		await importAndPlay(page);
		await openSettings(page);
		await page.getByLabel("Theme", { exact: false }).selectOption("light");
		await expect(page.locator("html.light")).toHaveCount(1);
		await openTuning(page, "DSP");
		await page.getByRole("checkbox", { name: "Enable DSP chain" }).uncheck();
		await page.reload();
		await expect(page.locator("html.light")).toHaveCount(1);
		if (isNarrow(page)) {
			// No mini-player pill on mobile: bypass state is verified where
			// it is controlled.
			await openTuning(page, "DSP");
			await expect(
				page.getByRole("checkbox", { name: "Enable DSP chain" }),
			).not.toBeChecked();
		} else {
			await expect(page.getByRole("button", { name: "DSP OFF" })).toBeVisible();
		}
	});
});
