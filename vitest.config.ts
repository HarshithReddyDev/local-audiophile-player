import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// Pure Node environment. Audio/DOM behavior is covered by Playwright
		// against a real browser; see e2e/. Engine unit tests inject a fake
		// audio element so no jsdom is required.
		environment: "node",
		include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
	},
});
