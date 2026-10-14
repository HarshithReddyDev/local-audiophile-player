import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// Base path for static hosting. Local dev and root hosting use "/".
// GitHub Pages project sites set VITE_BASE=/<repo>/ in the deploy workflow,
// so the same build works under a repository subpath with no code changes.
const base = process.env.VITE_BASE ?? "/";

export default defineConfig({
	base,
	plugins: [
		react(),
		tailwindcss(),
		VitePWA({
			registerType: "autoUpdate",
			injectRegister: "auto",
			// Keep the service worker, scope, and manifest aligned with the base
			// so the PWA installs and serves offline under a subpath.
			base,
			scope: base,
			manifest: {
				name: "Local IEM Player",
				short_name: "IEM Player",
				description: "Local-first browser music player for IEM listening",
				start_url: base,
				scope: base,
				display: "standalone",
				background_color: "#0b0e14",
				theme_color: "#0b0e14",
				icons: [
					{
						src: "icons/icon-192.png",
						sizes: "192x192",
						type: "image/png",
						purpose: "any",
					},
					{
						src: "icons/icon-512.png",
						sizes: "512x512",
						type: "image/png",
						purpose: "any",
					},
					{
						src: "icons/icon-maskable-512.png",
						sizes: "512x512",
						type: "image/png",
						purpose: "maskable",
					},
				],
			},
			workbox: {
				// Offline application shell only. User music files live on the
				// device filesystem and are never cached by the service worker.
				// The generated catalog chunk (tens of MB, content-hashed) is
				// fetched on demand when opening Devices — not precached, so
				// installs stay lean. Offline Devices falls back to the seed.
				globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
				globIgnores: ["**/generated-*.js"],
				navigateFallback: "index.html",
				cleanupOutdatedCaches: true,
			},
			devOptions: {
				enabled: false,
			},
		}),
	],
	build: {
		sourcemap: true,
	},
	preview: {
		port: 4173,
		strictPort: true,
	},
});
