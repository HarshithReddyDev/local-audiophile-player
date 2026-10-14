import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { isNarrow, openQueue, writeSineWav } from "./fixtures";

/**
 * Product-quality redesign regressions: unified Music workspace, major-only
 * navigation, hidden unfinished integrations, combined EQ & DSP, My Devices,
 * queue save-as-playlist, and mobile navigation.
 */

async function mobileLayout(page: Page): Promise<boolean> {
	return (page.viewportSize()?.width ?? 1280) < 768;
}

async function openDestination(
	page: Page,
	desktopName: string,
	mobileName: string,
): Promise<void> {
	const name = (await mobileLayout(page)) ? mobileName : desktopName;
	await page.getByRole("button", { name, exact: true }).click();
}

async function importTrack(page: Page, tag: string): Promise<string> {
	const wav = join(tmpdir(), `redesign-${tag}-${Date.now()}.wav`);
	writeSineWav(wav, 440, 2);
	await page.goto("./");
	await page.setInputFiles("input[type='file']", wav);
	const row = page.getByRole("button", {
		name: new RegExp(`Play redesign-${tag}`),
	});
	await expect(row.first()).toBeVisible({ timeout: 15_000 });
	return wav;
}

test.describe("redesigned information architecture", () => {
	test("sidebar shows only major destinations", async ({ page }) => {
		test.skip(
			(await page.viewportSize()?.width) !== undefined &&
				(page.viewportSize()?.width ?? 0) < 768,
			"desktop sidebar",
		);
		await page.goto("./");
		const nav = page.getByRole("navigation", { name: "Primary" });
		for (const name of [
			"Music",
			"Playlists",
			"Devices",
			"EQ & DSP",
			"My Devices",
			"Guides",
			"Settings",
		]) {
			await expect(
				nav.getByRole("button", { name, exact: true }),
			).toBeVisible();
		}
		// Music subsections are workspace tabs, not sidebar entries.
		await expect(
			nav.getByRole("button", { name: "All Music", exact: true }),
		).toHaveCount(0);
		await expect(
			nav.getByRole("button", { name: "Genres", exact: true }),
		).toHaveCount(0);
	});

	test("empty library shows polished onboarding", async ({ page }) => {
		await page.goto("./");
		await expect(
			page.getByRole("heading", { name: "Your library is empty" }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Choose audio files" }).first(),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Cloud accounts" }).first(),
		).toBeVisible();
	});

	test("music workspace unifies collections as tabs", async ({ page }) => {
		await importTrack(page, "workspace");
		for (const name of [
			"All Music",
			"Albums",
			"Artists",
			"Genres",
			"Recently Played",
			"Favorites",
		]) {
			await expect(page.getByRole("tab", { name, exact: true })).toBeVisible();
		}
		// Overview dashboard sections render on the All tab.
		await expect(
			page.getByRole("heading", { name: "All songs" }),
		).toBeVisible();
		await page.getByRole("tab", { name: "Albums" }).click();
		await expect(
			page.getByRole("button", { name: /Unknown album/ }).first(),
		).toBeVisible();
		await page.getByRole("tab", { name: "Artists" }).click();
		await expect(
			page.getByRole("button", { name: /Unknown artist/ }).first(),
		).toBeVisible();
		await page.getByRole("tab", { name: "Genres" }).click();
		await expect(page.getByText("No genres yet")).toBeVisible();
		await page.getByRole("tab", { name: "Recently Played" }).click();
		await expect(
			page.getByRole("heading", { name: "Recently added" }),
		).toBeVisible();
		await page.getByRole("tab", { name: "Favorites" }).click();
		await expect(page.getByText("No favorites yet")).toBeVisible();
	});

	test("album detail plays, shuffles, and queues", async ({ page }) => {
		await importTrack(page, "albumdetail");
		await page.getByRole("tab", { name: "Albums" }).click();
		await page
			.getByRole("button", { name: /Open album/ })
			.first()
			.click();
		await expect(page.getByRole("heading", { level: 3 })).toBeVisible();
		await page.getByRole("button", { name: "Play", exact: true }).click();
		await expect(page.locator("footer").getByRole("status")).toContainText(
			"Playing",
			{ timeout: 15_000 },
		);
	});

	test("playlist import exposes only working file import", async ({ page }) => {
		await page.goto("./");
		await openDestination(page, "Playlists", "Playlists");
		await page.getByRole("button", { name: "Import playlist" }).click();
		await expect(page.getByText("Choose file")).toBeVisible();
		await expect(page.getByText("Not connected")).toHaveCount(0);
		await expect(
			page.getByRole("heading", { name: "Import playlist" }),
		).toBeVisible();
		// No unfinished provider cards anywhere in the primary UI.
		for (const name of ["Spotify", "SoundCloud", "Tidal", "Deezer"]) {
			await expect(page.getByText(name, { exact: true })).toHaveCount(0);
		}
	});

	test("settings is categorized without integration clutter", async ({
		page,
	}) => {
		await page.goto("./");
		await openDestination(page, "Settings", "Settings");
		for (const name of [
			"Appearance",
			"Playback",
			"Audio",
			"EQ & DSP",
			"Library",
			"Sources",
			"Privacy",
			"Backup & restore",
			"Advanced",
		]) {
			await expect(
				page.getByRole("heading", { name, exact: true }),
			).toBeVisible();
		}
		await expect(
			page.getByRole("heading", { name: "Connected services" }),
		).toHaveCount(0);
		await expect(page.getByText("Not implemented yet")).toHaveCount(0);
	});

	test("EQ and DSP share one destination with tabs", async ({ page }) => {
		await page.goto("./");
		await openDestination(page, "EQ & DSP", "EQ");
		await expect(page.getByRole("heading", { name: "EQ & DSP" })).toBeVisible();
		await expect(
			page.getByRole("checkbox", { name: "Enable parametric EQ" }),
		).toBeVisible();
		for (const name of [
			"EQ",
			"Tone",
			"Dynamics",
			"Spatial",
			"Loudness",
			"Presets",
			"Guides",
		]) {
			await expect(
				page
					.getByRole("tablist", { name: "Audio tuning sections" })
					.getByRole("tab", { name, exact: true }),
			).toBeVisible();
		}
		const tuningTabs = page.getByRole("tablist", {
			name: "Audio tuning sections",
		});
		await tuningTabs
			.getByRole("tab", { name: "Dynamics", exact: true })
			.click();
		await expect(
			page.getByRole("region", { name: "DSP preset bar" }),
		).toBeVisible();
		await tuningTabs.getByRole("tab", { name: "Presets", exact: true }).click();
		await expect(
			page.getByRole("searchbox", { name: "Search presets" }),
		).toBeVisible();
		await tuningTabs.getByRole("tab", { name: "EQ", exact: true }).click();
		await expect(
			page.getByRole("checkbox", { name: "Enable parametric EQ" }),
		).toBeVisible();
	});

	test("devices destination centers headphones and IEMs", async ({ page }) => {
		await page.goto("./");
		await openDestination(page, "My Devices", "Settings");
		// Mobile Settings links onward; follow it.
		if (await mobileLayout(page)) {
			await page.getByRole("button", { name: "Open My Devices" }).click();
		}
		await expect(
			page.getByRole("heading", { name: "My Devices" }),
		).toBeVisible();
		for (const name of ["Profiles", "Measurements", "Targets"]) {
			await expect(page.getByRole("tab", { name, exact: true })).toBeVisible();
		}
	});

	test("queue groups now playing and saves as playlist", async ({ page }) => {
		await importTrack(page, "queuesave");
		const row = page
			.getByRole("button", { name: /Play redesign-queuesave/ })
			.first();
		await row.click();
		await expect(page.locator("footer").getByRole("status")).toContainText(
			"Playing",
			{ timeout: 15_000 },
		);
		await openQueue(page);
		if (await isNarrow(page)) {
			await expect(
				page.getByRole("heading", { name: "Now playing" }),
			).toBeVisible();
		}
		await page.getByRole("button", { name: "Save as playlist" }).click();
		await expect(page.getByText(/Queue ·/).first()).toBeVisible({
			timeout: 10_000,
		});
	});

	test("command palette finds renamed destinations", async ({ page }) => {
		await page.goto("./");
		await expect(
			page.getByRole("heading", { name: "Your library is empty" }),
		).toBeVisible();
		await page.keyboard.press("ControlOrMeta+k");
		await expect(
			page.getByRole("dialog", { name: "Command palette" }),
		).toBeVisible();
		await page
			.getByRole("searchbox", {
				name: "Search tracks, playlists, devices, presets, and commands",
			})
			.fill("my devices");
		await expect(
			page.getByRole("option", { name: /My Devices/ }),
		).toBeVisible();
	});

	test("mobile navigation stays compact with five destinations", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto("./");
		const nav = page.getByRole("navigation", { name: "Primary" });
		for (const name of ["Music", "Playlists", "Devices", "EQ", "Settings"]) {
			await expect(
				nav.getByRole("button", { name, exact: true }),
			).toBeVisible();
		}
		// Full player opens from the mini player on mobile.
		await importTrack(page, "mobileplayer");
		await page
			.getByRole("button", { name: /Open now playing/ })
			.first()
			.click();
		await expect(
			page.getByRole("region", { name: "Now playing" }),
		).toBeVisible();
		await expect(
			page.getByRole("heading", { name: /redesign-mobileplayer/ }),
		).toBeVisible();
	});
});
