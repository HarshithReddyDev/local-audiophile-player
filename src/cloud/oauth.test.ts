import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudError } from "./model";
import {
	exchangeCode,
	type FetchImpl,
	parseOAuthCallback,
	pkceChallenge,
	refreshAccessToken,
	startOAuth,
	takeOAuthRoundTrip,
} from "./oauth";

/** sessionStorage stub (node has none; the module guards missing storage). */
function installSessionStorage(): Map<string, string> {
	const backing = new Map<string, string>();
	const stub = {
		getItem: (k: string) => backing.get(k) ?? null,
		setItem: (k: string, v: string) => void backing.set(k, v),
		removeItem: (k: string) => void backing.delete(k),
		clear: () => backing.clear(),
		length: 0,
		key: () => null,
	};
	vi.stubGlobal("sessionStorage", stub);
	return backing;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

function okJson(payload: unknown, status = 200) {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => payload,
		text: async () => JSON.stringify(payload),
	};
}

describe("oauth pkce", () => {
	it("derives the RFC 7636 challenge", async () => {
		// RFC 7636 §4.2 test vector (verified against hashlib: the
		// challenge ends "-cM", not "-c" — memory lies, digests don't).
		await expect(
			pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
		).resolves.toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
	});

	it("starts login with state + PKCE and stores the round-trip", async () => {
		installSessionStorage();
		const seen: string[] = [];
		await startOAuth(
			{
				authorizeUrl: "https://provider.example/authorize",
				tokenUrl: "https://provider.example/token",
				clientId: "cid",
				redirectUri: "https://app.example/?oauth=callback",
				scopes: ["a", "b"],
			},
			"acct:pending",
			(url) => seen.push(url),
		);
		expect(seen).toHaveLength(1);
		const url = new URL(seen[0] ?? "");
		expect(url.searchParams.get("client_id")).toBe("cid");
		expect(url.searchParams.get("code_challenge_method")).toBe("S256");
		expect(url.searchParams.get("scope")).toBe("a b");
		const roundTrip = takeOAuthRoundTrip();
		expect(roundTrip?.accountKey).toBe("acct:pending");
		expect(takeOAuthRoundTrip()).toBeNull();
	});

	it("parses callbacks and validates state", async () => {
		expect(
			parseOAuthCallback("https://app.example/?oauth=callback&code=c&state=s"),
		).toEqual({ code: "c", state: "s", error: null });
		expect(
			parseOAuthCallback("https://app.example/?error=access_denied&state=s"),
		).toMatchObject({ error: "access_denied" });

		const fetchImpl: FetchImpl = async () =>
			okJson({ access_token: "at", expires_in: 3600, scope: "a b" });
		const config = {
			authorizeUrl: "https://p.example/a",
			tokenUrl: "https://p.example/t",
			clientId: "cid",
			redirectUri: "https://app.example/",
			scopes: ["a", "b"],
		};
		const roundTrip = { verifier: "v", state: "s", accountKey: "k" };
		const tokens = await exchangeCode(
			config,
			roundTrip,
			{ code: "c", state: "s", error: null },
			fetchImpl,
		);
		expect(tokens.accessToken).toBe("at");
		expect(tokens.scopes).toEqual(["a", "b"]);

		await expect(
			exchangeCode(
				config,
				roundTrip,
				{ code: "c", state: "WRONG", error: null },
				fetchImpl,
			),
		).rejects.toMatchObject({
			name: "CloudError",
			code: "OAUTH_STATE_MISMATCH",
		});
		await expect(
			exchangeCode(
				config,
				roundTrip,
				{ code: null, state: "s", error: "access_denied" },
				fetchImpl,
			),
		).rejects.toMatchObject({ code: "OAUTH_CANCELLED" });
		const denied: FetchImpl = async () => okJson({ error: "x" }, 400);
		await expect(
			exchangeCode(
				config,
				roundTrip,
				{ code: "c", state: "s", error: null },
				denied,
			),
		).rejects.toMatchObject({ code: "OAUTH_EXCHANGE_FAILED" });
		const down: FetchImpl = async () => {
			throw new Error("boom");
		};
		await expect(
			exchangeCode(
				config,
				roundTrip,
				{ code: "c", state: "s", error: null },
				down,
			),
		).rejects.toMatchObject({ code: "NETWORK_ERROR" });
	});

	it("refreshes access tokens without secrets", async () => {
		const fetchImpl: FetchImpl = async (_url, init) => {
			const body = init?.body as URLSearchParams;
			expect(body.get("grant_type")).toBe("refresh_token");
			expect(body.get("client_id")).toBe("cid");
			return okJson({
				access_token: "at2",
				expires_in: 100,
				refresh_token: "rt2",
			});
		};
		const tokens = await refreshAccessToken(
			"https://p.example/t",
			"cid",
			"rt1",
			fetchImpl,
		);
		expect(tokens).toMatchObject({ accessToken: "at2", refreshToken: "rt2" });
		const gone: FetchImpl = async () => okJson({}, 401);
		await expect(
			refreshAccessToken("https://p.example/t", "cid", "rt1", gone),
		).rejects.toMatchObject({
			code: "AUTH_REQUIRED",
		});
	});

	it("never throws raw payloads (CloudError only)", async () => {
		const fetchImpl: FetchImpl = async () => okJson({ nope: true });
		try {
			await exchangeCode(
				{
					authorizeUrl: "https://p.example/a",
					tokenUrl: "https://p.example/t",
					clientId: "cid",
					redirectUri: "https://app.example/",
					scopes: [],
				},
				{ verifier: "v", state: "s", accountKey: "k" },
				{ code: "c", state: "s", error: null },
				fetchImpl,
			);
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(CloudError);
		}
	});
});
