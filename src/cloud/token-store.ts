/**
 * Token storage with a hard privacy boundary.
 *
 * - Access tokens: process memory ONLY. Never IndexedDB, never
 *   localStorage, never URLs. They die with the page.
 * - Refresh tokens: memory by default; persisted to localStorage ONLY
 *   when the user explicitly opts into "remember this connection".
 * - NEVER stored anywhere: client secrets (none exist client-side),
 *   authorization codes, PKCE verifiers (sessionStorage round-trip only).
 */

import type { CloudProviderId } from "./model";

interface AccessEntry {
	token: string;
	/** Epoch ms when the token should be considered expired (0 = unknown). */
	expiresAt: number;
}

const access = new Map<string, AccessEntry>();
const refreshMemory = new Map<string, string>();

const REFRESH_KEY = "cloud-refresh-tokens";
const REMEMBER_KEY = "cloud-remember";

function prefs(): Storage | null {
	try {
		return typeof localStorage !== "undefined" ? localStorage : null;
	} catch {
		return null;
	}
}

/** Skew guard: treat tokens as expired 60s early. */
const EXPIRY_SKEW_MS = 60_000;

export function storeAccessToken(
	accountKey: string,
	token: string,
	expiresInSec: number,
): void {
	access.set(accountKey, {
		token,
		expiresAt:
			expiresInSec > 0
				? Date.now() + expiresInSec * 1000 - EXPIRY_SKEW_MS
				: expiresInSec < 0
					? Date.now() - 1
					: 0,
	});
}

/** Live access token, or null when missing/expired (caller re-auths). */
export function getAccessToken(accountKey: string): string | null {
	const entry = access.get(accountKey);
	if (!entry) return null;
	if (entry.expiresAt !== 0 && entry.expiresAt <= Date.now()) {
		access.delete(accountKey);
		return null;
	}
	return entry.token;
}

export function clearAccessToken(accountKey: string): void {
	access.delete(accountKey);
}

export function isRemembered(accountKey: string): boolean {
	try {
		const raw = prefs()?.getItem(REMEMBER_KEY);
		if (!raw) return false;
		const list = JSON.parse(raw) as unknown;
		return Array.isArray(list) && list.includes(accountKey);
	} catch {
		return false;
	}
}

export function storeRefreshToken(
	accountKey: string,
	token: string,
	remember: boolean,
): void {
	refreshMemory.set(accountKey, token);
	const store = prefs();
	if (!store) return;
	if (remember) {
		let list: string[] = [];
		try {
			const raw = store.getItem(REMEMBER_KEY);
			const parsed = raw ? (JSON.parse(raw) as unknown) : [];
			if (Array.isArray(parsed))
				list = parsed.filter((x) => typeof x === "string");
		} catch {
			list = [];
		}
		if (!list.includes(accountKey)) {
			list.push(accountKey);
			try {
				store.setItem(REMEMBER_KEY, JSON.stringify(list));
			} catch {
				// Quota/privacy mode: memory keeps working for this session.
			}
		}
		try {
			store.setItem(`${REFRESH_KEY}:${accountKey}`, token);
		} catch {
			// Memory keeps working for this session.
		}
	} else {
		try {
			store.removeItem(`${REFRESH_KEY}:${accountKey}`);
		} catch {
			// Non-fatal.
		}
	}
}

/** Refresh token from memory, else from localStorage when remembered. */
export function getRefreshToken(accountKey: string): string | null {
	const live = refreshMemory.get(accountKey);
	if (live) return live;
	if (!isRemembered(accountKey)) return null;
	try {
		return prefs()?.getItem(`${REFRESH_KEY}:${accountKey}`) ?? null;
	} catch {
		return null;
	}
}

/** Move tokens from a pending login key to the committed account key. */
export function rekeyTokens(fromKey: string, toKey: string): void {
	const entry = access.get(fromKey);
	if (entry) {
		access.delete(fromKey);
		access.set(toKey, entry);
	}
	const refresh = refreshMemory.get(fromKey);
	if (refresh) {
		refreshMemory.delete(fromKey);
		refreshMemory.set(toKey, refresh);
	}
	try {
		const store = prefs();
		const persisted = store?.getItem(`${REFRESH_KEY}:${fromKey}`);
		if (persisted) {
			store?.removeItem(`${REFRESH_KEY}:${fromKey}`);
			store?.setItem(`${REFRESH_KEY}:${toKey}`, persisted);
		}
		const raw = store?.getItem(REMEMBER_KEY);
		if (raw) {
			const parsed = JSON.parse(raw) as unknown;
			if (Array.isArray(parsed) && parsed.includes(fromKey)) {
				store?.setItem(
					REMEMBER_KEY,
					JSON.stringify(parsed.map((x) => (x === fromKey ? toKey : x))),
				);
			}
		}
	} catch {
		// Memory is already moved; persistence best-effort.
	}
}

/** Forget everything for one account (disconnect). */
export function clearTokens(accountKey: string): void {
	access.delete(accountKey);
	refreshMemory.delete(accountKey);
	try {
		const store = prefs();
		store?.removeItem(`${REFRESH_KEY}:${accountKey}`);
		const raw = store?.getItem(REMEMBER_KEY);
		if (raw) {
			const parsed = JSON.parse(raw) as unknown;
			if (Array.isArray(parsed)) {
				store?.setItem(
					REMEMBER_KEY,
					JSON.stringify(parsed.filter((x) => x !== accountKey)),
				);
			}
		}
	} catch {
		// Memory is already clear; persistence best-effort.
	}
}

/** OAuth client ids are user-supplied developer credentials, stored locally. */
export function getClientId(provider: CloudProviderId): string | null {
	try {
		const value = prefs()?.getItem(`cloud-client-id:${provider}`);
		return value && value.trim() !== "" ? value.trim() : null;
	} catch {
		return null;
	}
}

export function setClientId(provider: CloudProviderId, clientId: string): void {
	try {
		if (clientId.trim() === "")
			prefs()?.removeItem(`cloud-client-id:${provider}`);
		else prefs()?.setItem(`cloud-client-id:${provider}`, clientId.trim());
	} catch {
		// Non-fatal: the id simply won't survive reload.
	}
}
