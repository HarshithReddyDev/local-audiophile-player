/**
 * Browser-safe OAuth for public SPA clients (no backend, no secrets).
 *
 * Two shapes, per provider documentation:
 * - PKCE authorization-code flow (OneDrive/Microsoft identity platform,
 *   Dropbox, Box): redirect to the provider, return with ?code=&state=,
 *   exchange the code with the verifier via fetch (CORS-enabled token
 *   endpoints, no client secret for public clients).
 * - Token-client flow (Google Identity Services): a loaded Google script
 *   returns an access token directly; see drive.ts.
 *
 * This module holds the shared PKCE machinery plus callback parsing and
 * state validation. Transport (fetch) and navigation are injected so every
 * path is unit-testable with fixtures. Persisted: nothing. The PKCE
 * verifier and OAuth state live in sessionStorage only for the duration
 * of one authorization round-trip — never IndexedDB, never long-term.
 */

import { CloudError } from "./model";

export type FetchImpl = (
	input: string,
	init?: {
		method?: string;
		headers?: Record<string, string>;
		body?: string | URLSearchParams;
		signal?: AbortSignal;
		redirect?: RequestRedirect;
	},
) => Promise<{
	ok: boolean;
	status: number;
	headers?: { get(name: string): string | null } | Record<string, string>;
	json(): Promise<unknown>;
	text(): Promise<string>;
}>;

/**
 * Window-bound fetch as a FetchImpl. Never pass bare `fetch` as a
 * callback — detached from window it throws "Illegal invocation".
 */
export const defaultFetch: FetchImpl = (input, init) => {
	const nativeInit: RequestInit = {};
	if (init?.method !== undefined) nativeInit.method = init.method;
	if (init?.headers !== undefined) nativeInit.headers = init.headers;
	if (init?.body !== undefined) nativeInit.body = init.body;
	if (init?.signal !== undefined) nativeInit.signal = init.signal;
	if (init?.redirect !== undefined) nativeInit.redirect = init.redirect;
	return fetch(input, nativeInit);
};

/** Read a response header across native and fixture transports. */
export function getHeader(
	res: {
		headers?: { get(name: string): string | null } | Record<string, string>;
	},
	name: string,
): string | null {
	const headers = res.headers;
	if (!headers) return null;
	if (typeof (headers as { get?: unknown }).get === "function") {
		return (headers as { get(name: string): string | null }).get(name);
	}
	const record = headers as Record<string, string>;
	for (const key of Object.keys(record)) {
		if (key.toLowerCase() === name.toLowerCase()) return record[key] ?? null;
	}
	return null;
}

export interface OAuthConfig {
	authorizeUrl: string;
	tokenUrl: string;
	clientId: string;
	redirectUri: string;
	scopes: string[];
	/** Extra authorize params (e.g. resource, prompt). */
	extraAuthorizeParams?: Record<string, string>;
}

const VERIFIER_KEY = "cloud-oauth-verifier";
const STATE_KEY = "cloud-oauth-state";
const ACCOUNT_KEY = "cloud-oauth-account";

function session(): Storage | null {
	try {
		return typeof sessionStorage !== "undefined" ? sessionStorage : null;
	} catch {
		return null;
	}
}

export function randomToken(bytes = 32): string {
	const out = new Uint8Array(bytes);
	if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
		crypto.getRandomValues(out);
	} else {
		for (let i = 0; i < out.length; i++)
			out[i] = Math.floor(Math.random() * 256);
	}
	let binary = "";
	for (const b of out) binary += String.fromCharCode(b);
	return btoa(binary)
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replaceAll("=", "");
}

export async function pkceChallenge(verifier: string): Promise<string> {
	if (typeof crypto !== "undefined" && "subtle" in crypto) {
		const digest = await crypto.subtle.digest(
			"SHA-256",
			new TextEncoder().encode(verifier),
		);
		let binary = "";
		for (const b of new Uint8Array(digest)) binary += String.fromCharCode(b);
		return btoa(binary)
			.replaceAll("+", "-")
			.replaceAll("/", "_")
			.replaceAll("=", "");
	}
	// Non-secure contexts (tests, file://): challenge == verifier (plain).
	return verifier;
}

/** Pending round-trip context, kept in sessionStorage only. */
export interface OAuthRoundTrip {
	verifier: string;
	state: string;
	accountKey: string;
}

/** Begin login: persist the round-trip, then navigate to the provider. */
export async function startOAuth(
	config: OAuthConfig,
	accountKey: string,
	navigate: (url: string) => void,
): Promise<void> {
	const verifier = randomToken();
	const state = randomToken(16);
	const store = session();
	store?.setItem(VERIFIER_KEY, verifier);
	store?.setItem(STATE_KEY, state);
	store?.setItem(ACCOUNT_KEY, accountKey);
	const challenge = await pkceChallenge(verifier);
	const params = new URLSearchParams({
		client_id: config.clientId,
		redirect_uri: config.redirectUri,
		response_type: "code",
		scope: config.scopes.join(" "),
		state,
		code_challenge: challenge,
		code_challenge_method: "S256",
		...config.extraAuthorizeParams,
	});
	navigate(`${config.authorizeUrl}?${params.toString()}`);
}

/** Round-trip recovered from storage (null when none is in flight). */
export function takeOAuthRoundTrip(): OAuthRoundTrip | null {
	const seen = peekOAuthRoundTrip();
	if (!seen) return null;
	const store = session();
	store?.removeItem(VERIFIER_KEY);
	store?.removeItem(STATE_KEY);
	store?.removeItem(ACCOUNT_KEY);
	return seen;
}

/** Inspect the pending round-trip without consuming it (boot routing). */
export function peekOAuthRoundTrip(): OAuthRoundTrip | null {
	const store = session();
	if (!store) return null;
	const verifier = store.getItem(VERIFIER_KEY);
	const state = store.getItem(STATE_KEY);
	const accountKey = store.getItem(ACCOUNT_KEY);
	if (!verifier || !state || !accountKey) return null;
	return { verifier, state, accountKey };
}

export interface OAuthCallback {
	code: string | null;
	state: string | null;
	error: string | null;
}

/** Parse ?code=&state= (or ?error=) from the return URL. */
export function parseOAuthCallback(url: string): OAuthCallback {
	let params: URLSearchParams;
	try {
		params = new URL(url).searchParams;
	} catch {
		return { code: null, state: null, error: "invalid_url" };
	}
	return {
		code: params.get("code"),
		state: params.get("state"),
		error: params.get("error"),
	};
}

export interface TokenResponse {
	accessToken: string;
	/** Seconds until expiry (0 when the provider omits it). */
	expiresIn: number;
	/** Refresh token when issued AND the caller opts into persistence. */
	refreshToken: string | null;
	scopes: string[];
}

/**
 * Exchange an authorization code for tokens. Throws CloudError with
 * OAUTH_STATE_MISMATCH / OAUTH_CANCELLED / OAUTH_EXCHANGE_FAILED —
 * never raw provider payloads.
 */
export async function exchangeCode(
	config: OAuthConfig,
	roundTrip: OAuthRoundTrip,
	callback: OAuthCallback,
	fetchImpl: FetchImpl,
): Promise<TokenResponse> {
	if (callback.error) {
		throw new CloudError("OAUTH_CANCELLED", "Authorization was not granted.");
	}
	if (!callback.code || callback.state !== roundTrip.state) {
		throw new CloudError(
			"OAUTH_STATE_MISMATCH",
			"Authorization response did not match this request. Try connecting again.",
		);
	}
	let payload: unknown;
	try {
		const res = await fetchImpl(config.tokenUrl, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				client_id: config.clientId,
				grant_type: "authorization_code",
				code: callback.code,
				redirect_uri: config.redirectUri,
				code_verifier: roundTrip.verifier,
			}),
		});
		if (!res.ok) {
			throw new CloudError(
				"OAUTH_EXCHANGE_FAILED",
				"The provider refused the authorization code.",
			);
		}
		payload = await res.json();
	} catch (error) {
		if (error instanceof CloudError) throw error;
		throw new CloudError(
			"NETWORK_ERROR",
			"Could not reach the provider token endpoint.",
		);
	}
	const body = payload as Record<string, unknown>;
	const accessToken =
		typeof body["access_token"] === "string" ? body["access_token"] : "";
	if (!accessToken) {
		throw new CloudError(
			"OAUTH_EXCHANGE_FAILED",
			"The provider refused the authorization code.",
		);
	}
	const expiresIn =
		typeof body["expires_in"] === "number" ? body["expires_in"] : 0;
	const refreshToken =
		typeof body["refresh_token"] === "string" ? body["refresh_token"] : null;
	const scope =
		typeof body["scope"] === "string"
			? body["scope"].split(" ").filter(Boolean)
			: config.scopes;
	return { accessToken, expiresIn, refreshToken, scopes: scope };
}

/** Refresh an access token (PKCE public clients send no secret). */
export async function refreshAccessToken(
	tokenUrl: string,
	clientId: string,
	refreshToken: string,
	fetchImpl: FetchImpl,
): Promise<TokenResponse> {
	let payload: unknown;
	try {
		const res = await fetchImpl(tokenUrl, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				client_id: clientId,
				grant_type: "refresh_token",
				refresh_token: refreshToken,
			}),
		});
		if (!res.ok) {
			throw new CloudError(
				"AUTH_REQUIRED",
				"Cloud authorization expired. Reconnect the source.",
			);
		}
		payload = await res.json();
	} catch (error) {
		if (error instanceof CloudError) throw error;
		throw new CloudError(
			"NETWORK_ERROR",
			"Could not reach the provider token endpoint.",
		);
	}
	const body = payload as Record<string, unknown>;
	const accessToken =
		typeof body["access_token"] === "string" ? body["access_token"] : "";
	if (!accessToken) {
		throw new CloudError(
			"AUTH_REQUIRED",
			"Cloud authorization expired. Reconnect the source.",
		);
	}
	return {
		accessToken,
		expiresIn: typeof body["expires_in"] === "number" ? body["expires_in"] : 0,
		refreshToken:
			typeof body["refresh_token"] === "string"
				? body["refresh_token"]
				: refreshToken,
		scopes:
			typeof body["scope"] === "string"
				? body["scope"].split(" ").filter(Boolean)
				: [],
	};
}

/** Default redirect target: app root (subpath-safe), OAuth result in query. */
export function defaultRedirectUri(): string {
	if (typeof window === "undefined") return "";
	const base = import.meta.env.BASE_URL ?? "/";
	const root = new URL(base, window.location.origin);
	root.searchParams.set("oauth", "callback");
	return root.toString();
}
