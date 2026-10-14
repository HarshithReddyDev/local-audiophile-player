import { defineConfig, devices } from "@playwright/test";

// Mirrors the Vite base path so e2e runs validate GitHub Pages subpaths.
// CI sets VITE_BASE to /<repo>/ and builds with it before serving preview.
const basePath = process.env.VITE_BASE ?? "/";
// "localhost" intentionally: `vite preview` binds the localhost name, which
// may resolve to ::1 while 127.0.0.1 refuses connections on some systems.
const baseURL = "http://localhost:4173" + (basePath === "/" ? "" : basePath);

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: true,
	// Bounded workers: each worker is a full browser doing audio decode against
	// one preview server. Unlimited workers starve each other into timeouts
	// (observed flake); 4 keeps suites fast and stable. Override locally with
	// --workers=N.
	workers: 4,
	forbidOnly: !!process.env.CI,
	// One retry absorbs environmental flakes (parallel browsers contending
	// for media/IO on shared runners); real product bugs fail consistently
	// and still surface. Traces capture the first attempt.
	retries: 1,
	reporter: "list",
	use: {
		baseURL,
		trace: "on-first-retry",
	},
	webServer: [
		{
			command: "pnpm preview --port 4173 --strictPort",
			url: baseURL,
			reuseExistingServer: !process.env.CI,
			timeout: 120_000,
		},
		{
			// Source-serving dev server for dsp-offline.spec.ts, which
			// imports the shipped DSP modules directly into an
			// OfflineAudioContext for acoustic verification.
			command: "pnpm dev --port 5174 --strictPort",
			url: "http://localhost:5174",
			reuseExistingServer: !process.env.CI,
			timeout: 120_000,
		},
	],
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
			// Offline DSP renders import dev-server sources; they run in
			// the dedicated dsp-offline project only.
			testIgnore: ["e2e/dsp-offline.spec.ts"],
		},
		{
			name: "mobile",
			use: { ...devices["Pixel 7"] },
			testIgnore: ["e2e/dsp-offline.spec.ts"],
		},
		{
			name: "dsp-offline",
			use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:5174" },
			testMatch: ["e2e/dsp-offline.spec.ts"],
		},
		{
			// Core shell on Gecko: timing-sensitive transition specs stay on
			// Chromium (see docs/playback-engine.md for the measured matrix).
			name: "firefox",
			use: { ...devices["Desktop Firefox"] },
			testMatch: [
				"e2e/app.spec.ts",
				"e2e/playback.spec.ts",
				"e2e/library-persistence.spec.ts",
				"e2e/eq.spec.ts",
			],
		},
	],
});
