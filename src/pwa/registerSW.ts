import { registerSW } from "virtual:pwa-register";

/**
 * Registers the service worker in production only. The worker precaches the
 * application shell (HTML/CSS/JS/icons) for offline use. User music files
 * are never cached: they live on the device filesystem behind picker grants
 * the service worker cannot and must not capture.
 */
export function registerServiceWorker(): void {
	if (!("serviceWorker" in navigator) || !import.meta.env.PROD) return;
	registerSW({ immediate: true });
}
