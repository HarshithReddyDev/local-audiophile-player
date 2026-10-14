import { expect, test } from "@playwright/test";

/**
 * Cloud music E2E with the network boundary mocked — no live accounts.
 * Intercepts the documented Microsoft identity + Graph endpoints, drives
 * the real OAuth-PKCE → browse → add → play → seek → disconnect →
 * reconnect loop, and serves a synthesized WAV as the "remote" bytes.
 */
function wavBytes(seconds = 6): Buffer {
	const sampleRate = 8000;
	const samples = sampleRate * seconds;
	const data = Buffer.alloc(samples * 2);
	for (let i = 0; i < samples; i++) {
		const v = Math.round(
			Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 16000,
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
	return Buffer.concat([header, data]);
}

test.describe("cloud music (mocked provider)", () => {
	test("connect, browse, add, play, seek, disconnect, reconnect", async ({
		page,
	}) => {
		// User-supplied OAuth client id (stays in localStorage, as designed).
		await page.addInitScript(() => {
			window.localStorage.setItem("cloud-client-id:one-drive", "e2e-client-id");
		});

		// OAuth authorize: capture state, send the browser back with a code.
		await page.route("**/oauth2/v2.0/authorize*", async (route) => {
			const url = new URL(route.request().url());
			const redirect = new URL(url.searchParams.get("redirect_uri") ?? "");
			redirect.searchParams.set("oauth", "callback");
			redirect.searchParams.set("code", "e2e-code");
			redirect.searchParams.set("state", url.searchParams.get("state") ?? "");
			await route.fulfill({
				status: 302,
				headers: { location: redirect.toString() },
				body: "",
			});
		});
		await page.route("**/oauth2/v2.0/token", async (route) => {
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					access_token: "e2e-access",
					expires_in: 3600,
					refresh_token: "e2e-refresh",
					scope: "Files.Read User.Read",
				}),
			});
		});
		await page.route("**/graph.microsoft.com/v1.0/me*", async (route) => {
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({ id: "e2e-user", displayName: "E2E User" }),
			});
		});
		await page.route(
			(url) =>
				url.href.includes("/drive/") &&
				url.href.includes("/children") &&
				url.host.endsWith("graph.microsoft.com"),
			async (route) => {
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify({
						value: [
							{ id: "e2e-folder", name: "Music", folder: {} },
							{
								id: "e2e-song",
								name: "E2E Artist - E2E Song.mp3",
								file: { mimeType: "audio/mpeg" },
								size: 96000,
								cTag: "c1",
							},
						],
					}),
				});
			},
		);
		await page.route(
			(url) =>
				url.href.includes("/drive/items/e2e-song") &&
				url.host.endsWith("graph.microsoft.com"),
			async (route) => {
				const url = new URL(route.request().url());
				if ((url.searchParams.get("$select") ?? "").includes("downloadUrl")) {
					await route.fulfill({
						status: 200,
						contentType: "application/json",
						body: JSON.stringify({
							id: "e2e-song",
							file: { mimeType: "audio/mpeg" },
							"@microsoft.graph.downloadUrl": "https://e2e.cloud/audio.wav",
						}),
					});
				} else {
					await route.fulfill({
						status: 200,
						contentType: "application/json",
						body: JSON.stringify({
							id: "e2e-song",
							name: "E2E Artist - E2E Song.mp3",
							file: { mimeType: "audio/mpeg" },
							size: 96000,
							cTag: "c1",
						}),
					});
				}
			},
		);
		await page.route("https://e2e.cloud/audio.wav", async (route) => {
			await route.fulfill({
				status: 200,
				contentType: "audio/wav",
				body: wavBytes(),
			});
		});

		await page.goto("./");
		// Fresh profile: the library is empty, so cloud setup lives in
		// Settings → Sources.
		await page.getByRole("button", { name: "Settings", exact: true }).click();
		await expect(page.getByRole("heading", { name: "Sources" })).toBeVisible();

		// Connect the mocked OneDrive account.
		const card = page.locator("div", { hasText: "OneDrive" }).first();
		await expect(card).toBeVisible();
		await page
			.getByRole("button", { name: "Connect", exact: true })
			.first()
			.click();
		// The OAuth round-trip reloads the app onto the default view;
		// return to Settings to see the connected account.
		await page.getByRole("button", { name: "Settings", exact: true }).click();
		await expect(page.getByText("E2E User").first()).toBeVisible({
			timeout: 20_000,
		});

		// Browse to the song and add it to the library.
		await page.getByRole("button", { name: "Browse" }).first().click();
		await page.getByRole("button", { name: "Open OneDrive" }).click();
		await page
			.getByRole("checkbox", { name: "Select E2E Artist - E2E Song.mp3" })
			.check();
		await page.getByRole("button", { name: "Add to library" }).click();
		await expect(page.getByText(/Added 1, updated 0/)).toBeVisible({
			timeout: 10_000,
		});

		// Back to the library: the remote row carries a provider badge.
		// (Cloud accounts live under Settings → Sources.)
		await page.getByRole("button", { name: "← Sources" }).click();
		await page.getByRole("button", { name: "Music", exact: true }).click();
		await page
			.getByPlaceholder("Search tracks, albums, artists, genres…")
			.fill("E2E Song");
		const row = page.getByRole("button", {
			name: /Play E2E Song by E2E Artist/,
		});
		await expect(row.first()).toBeVisible({ timeout: 10_000 });
		await expect(
			page.getByText("OneDrive", { exact: true }).first(),
		).toBeVisible();

		// Play the remote bytes through the real engine + DSP chain.
		await row.first().click();
		const status = page.locator("footer").getByRole("status");
		await expect(status).toContainText("Playing", { timeout: 20_000 });
		const seek = page.getByRole("slider", { name: "Seek" });
		await expect(seek).toBeEnabled({ timeout: 10_000 });
		await seek.fill("2");
		await expect(status).toContainText("Playing");

		// Disconnect: the record stays, flagged unavailable.
		await page.getByRole("button", { name: "Settings", exact: true }).click();
		await page.getByRole("button", { name: "Disconnect" }).first().click();
		await page.getByRole("button", { name: "Music", exact: true }).click();
		await expect(page.getByText("Unavailable").first()).toBeVisible({
			timeout: 10_000,
		});

		// Reconnect the same account: the reference recovers in place.
		// (Reconnect reloads the app onto the default view; return to
		// Settings to see the connected account.)
		await page.getByRole("button", { name: "Settings", exact: true }).click();
		await page.getByRole("button", { name: "Reconnect" }).first().click();
		await page.getByRole("button", { name: "Settings", exact: true }).click();
		await expect(page.getByText("E2E User").first()).toBeVisible({
			timeout: 20_000,
		});
		await page.getByRole("button", { name: "Music", exact: true }).click();
		await expect(page.getByText("Unavailable")).toHaveCount(0);
	});
});
