import { expect, test } from "@playwright/test";

test.describe("app shell", () => {
	test("loads with empty library state and player shell", async ({ page }) => {
		await page.goto("./");
		await expect(page).toHaveTitle(/Local IEM Player/);
		await expect(
			page.getByRole("heading", { name: "Your library is empty" }),
		).toBeVisible();
		// Player shell renders with transport disabled until a track loads.
		await expect(
			page.getByRole("button", { name: "Play", exact: true }),
		).toBeDisabled();
		await expect(
			page
				.getByRole("main")
				.getByRole("button", { name: "Choose audio files" }),
		).toBeVisible();
	});

	test("base path assets resolve", async ({ page }) => {
		await page.goto("./");
		// Manifest + icons must load under the configured base path ("/" locally,
		// "/<repo>/" in CI) — the classic GitHub Pages breakage.
		const manifest = page.locator('link[rel="manifest"]');
		await expect(manifest).toHaveAttribute("href", /.webmanifest$/);
		const manifestUrl = await manifest.getAttribute("href");
		expect(manifestUrl).not.toBeNull();
		const manifestResponse = await page.request.get(manifestUrl ?? "");
		expect(manifestResponse.ok()).toBe(true);
		const iconResponse = await page.request.get("./icons/icon-192.png");
		expect(iconResponse.ok()).toBe(true);
	});

	test("settings view opens and theme can change", async ({ page }) => {
		await page.goto("./");
		await page.getByRole("button", { name: "Settings" }).first().click();
		await expect(
			page.getByRole("heading", { name: "Appearance" }),
		).toBeVisible();
		await expect(page.getByText("Parametric EQ")).toBeVisible();
		const theme = page.getByLabel("Theme", { exact: false });
		await theme.selectOption("light");
		await expect(page.locator("html.light")).toHaveCount(1);
	});

	test("layout adapts to viewport", async ({ page }) => {
		await page.goto("./");
		const width = page.viewportSize()?.width ?? 1280;
		if (width < 768) {
			await expect(page.getByRole("banner")).toBeVisible();
		} else {
			await expect(page.getByRole("banner")).toHaveCount(0);
			await expect(
				page.getByRole("navigation", { name: "Primary" }),
			).toBeVisible();
		}
	});

	test("keyboard shortcut toggles playback safely", async ({ page }) => {
		await page.goto("./");
		// Space with no track must not throw or change state visibly.
		await page.keyboard.press("Space");
		await expect(
			page.getByRole("button", { name: "Play", exact: true }),
		).toBeDisabled();
	});
});
