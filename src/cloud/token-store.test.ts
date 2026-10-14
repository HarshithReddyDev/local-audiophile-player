import { afterEach, describe, expect, it, vi } from "vitest";
import {
	clearTokens,
	getAccessToken,
	getRefreshToken,
	isRemembered,
	storeAccessToken,
	storeRefreshToken,
} from "./token-store";

afterEach(() => {
	vi.unstubAllGlobals();
	clearTokens("k1");
	clearTokens("k2");
});

describe("token store boundaries", () => {
	it("serves live access tokens and drops expired ones", () => {
		storeAccessToken("k1", "at-live", 3600);
		expect(getAccessToken("k1")).toBe("at-live");
		storeAccessToken("k2", "at-old", -10);
		expect(getAccessToken("k2")).toBeNull();
		clearTokens("k1");
		expect(getAccessToken("k1")).toBeNull();
	});

	it("keeps refresh tokens in memory unless remembered", () => {
		// No localStorage in node: memory only, never remembered.
		storeRefreshToken("k1", "rt1", false);
		expect(getRefreshToken("k1")).toBe("rt1");
		expect(isRemembered("k1")).toBe(false);
	});

	it("persists remembered refresh tokens to localStorage only", () => {
		const backing = new Map<string, string>();
		vi.stubGlobal("localStorage", {
			getItem: (k: string) => backing.get(k) ?? null,
			setItem: (k: string, v: string) => void backing.set(k, v),
			removeItem: (k: string) => void backing.delete(k),
		});
		storeRefreshToken("k1", "rt1", true);
		expect(isRemembered("k1")).toBe(true);
		// Access tokens never touch localStorage.
		storeAccessToken("k1", "at1", 3600);
		const dumped = [...backing.values()].join("\n");
		expect(dumped).not.toContain("at1");
		expect(dumped).toContain("rt1");
		clearTokens("k1");
		expect(getRefreshToken("k1")).toBeNull();
		expect(isRemembered("k1")).toBe(false);
	});
});
