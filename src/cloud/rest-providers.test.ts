import { describe, expect, it } from "vitest";
import { BoxProvider } from "./box";
import { DropboxProvider } from "./dropbox";
import type { FetchImpl } from "./oauth";
import { OneDriveProvider } from "./onedrive";
import { storeAccessToken } from "./token-store";

function json(
	payload: unknown,
	status = 200,
	headers?: Record<string, string>,
) {
	return {
		ok: status >= 200 && status < 300,
		status,
		headers,
		json: async () => payload,
		text: async () => JSON.stringify(payload),
	};
}

function throwingFetch(): FetchImpl {
	return (async () => {
		throw new Error("must not hit the network");
	}) as FetchImpl;
}

describe("one-drive provider", () => {
	function fixture(): FetchImpl {
		return (async (input: string) => {
			const url = new URL(input, "https://graph.microsoft.com");
			if (url.pathname === "/v1.0/me") {
				return json({ id: "u1", displayName: "Ada" });
			}
			if (url.pathname.endsWith("/children")) {
				return json({
					value: [
						{ id: "fld", name: "Music", folder: {} },
						{
							id: "it1",
							name: "01 Intro.flac",
							file: { mimeType: "audio/flac" },
							size: 999,
							cTag: "c1",
						},
						{ id: "it2", name: "notes.txt" },
					],
				});
			}
			if (url.pathname.includes("/items/it1")) {
				return json({
					id: "it1",
					file: { mimeType: "audio/flac" },
					"@microsoft.graph.downloadUrl": "https://1drv.ms/download/x",
				});
			}
			return json(
				{
					id: "it1",
					name: "01 Intro.flac",
					file: { mimeType: "audio/flac" },
					cTag: "c1",
				},
				200,
			);
		}) as FetchImpl;
	}

	function authed(): OneDriveProvider {
		const provider = new OneDriveProvider({ fetchImpl: fixture() });
		provider.setAccountKey("od-acct");
		storeAccessToken("od-acct", "ms-token", 3600);
		return provider;
	}

	it("exposes least-privilege read scopes and pre-authenticated delivery", () => {
		const provider = new OneDriveProvider({ fetchImpl: throwingFetch() });
		expect(provider.scopesFor({})).toEqual(["Files.Read", "User.Read"]);
		expect(provider.capabilities.directMediaUrl).toBe("pre-authenticated");
		expect(provider.capabilities.rangeRequests).toBe(true);
	});

	it("resolves playback to a short-lived download URL with refresh", async () => {
		const provider = authed();
		const resolved = await provider.resolvePlaybackSource("it1", {
			fetchImpl: fixture(),
		});
		expect(resolved.url).toBe("https://1drv.ms/download/x");
		expect(resolved.url).not.toContain("ms-token");
		expect(resolved.expiresAt).toBeGreaterThan(Date.now());
		expect(typeof resolved.refresh).toBe("function");
	});

	it("reads the stable account id", async () => {
		const provider = authed();
		await expect(provider.getAccount(fixture())).resolves.toMatchObject({
			accountId: "u1",
			accountLabel: "Ada",
		});
	});
});

describe("dropbox provider", () => {
	function fixture(): FetchImpl {
		return (async (input: string) => {
			const url = new URL(input);
			if (url.pathname.endsWith("/users/get_current_account")) {
				return json({ account_id: "dbid:1", name: { display_name: "Ada" } });
			}
			if (url.pathname.endsWith("/files/list_folder")) {
				return json({
					entries: [
						{ ".tag": "folder", id: "id:fld", name: "Music" },
						{
							".tag": "file",
							id: "id:f1",
							name: "Song.ogg",
							size: 42,
							server_modified: "2024-05-01T00:00:00Z",
							rev: "r1",
						},
					],
					cursor: "c1",
					has_more: false,
				});
			}
			if (url.pathname.endsWith("/files/get_temporary_link")) {
				return json({ link: "https://dl.dropboxusercontent.com/x" });
			}
			return json({}, 404);
		}) as FetchImpl;
	}

	function authed(): DropboxProvider {
		const provider = new DropboxProvider({ fetchImpl: fixture() });
		provider.setAccountKey("dbx-acct");
		storeAccessToken("dbx-acct", "dbx-token", 3600);
		return provider;
	}

	it("uses read-only scopes and temporary links", () => {
		const provider = new DropboxProvider({ fetchImpl: throwingFetch() });
		expect(provider.scopesFor({})).toEqual([
			"account_info.read",
			"files.metadata.read",
			"files.content.read",
		]);
		expect(provider.capabilities.directMediaUrl).toBe("temporary-link");
	});

	it("lists folders and resolves temporary playback links", async () => {
		const provider = authed();
		const listing = await provider.listChildren("", null, fixture());
		expect(listing.items.map((i) => i.kind)).toEqual(["folder", "file"]);
		const resolved = await provider.resolvePlaybackSource("id:f1", {
			fetchImpl: fixture(),
		});
		expect(resolved.url).toContain("dl.dropboxusercontent.com");
		expect(resolved.expiresAt).toBeGreaterThan(Date.now());
	});
});

describe("box provider", () => {
	function fixture(): FetchImpl {
		return (async (input: string) => {
			const url = new URL(input);
			if (url.pathname.endsWith("/users/me")) {
				return json({ id: "77", name: "Ada" });
			}
			if (/\/folders\/[^/]+\/items$/.test(url.pathname)) {
				return json({
					entries: [
						{ type: "folder", id: "10", name: "Music" },
						{ type: "file", id: "11", name: "Song.aiff", size: 7, etag: "e1" },
					],
					total_count: 2,
				});
			}
			if (url.pathname.endsWith("/files/11/content")) {
				return json(null, 302, { location: "https://dl.boxcloud.com/x" });
			}
			return json({}, 404);
		}) as FetchImpl;
	}

	function authed(): BoxProvider {
		const provider = new BoxProvider({ fetchImpl: fixture() });
		provider.setAccountKey("box-acct");
		storeAccessToken("box-acct", "box-token", 3600);
		return provider;
	}

	it("requests read-only root scope", () => {
		const provider = new BoxProvider({ fetchImpl: throwingFetch() });
		expect(provider.scopesFor({})).toEqual(["root_readonly"]);
		expect(provider.capabilities.directMediaUrl).toBe("scoped-token-url");
	});

	it("prefers the redirect location over token-bearing URLs", async () => {
		const provider = authed();
		const resolved = await provider.resolvePlaybackSource("11", {
			fetchImpl: fixture(),
		});
		expect(resolved.url).toBe("https://dl.boxcloud.com/x");
		expect(resolved.url).not.toContain("box-token");
	});

	it("falls back to the documented pre-authenticated URL", async () => {
		const noRedirect: FetchImpl = (async (input: string) => {
			const url = new URL(input);
			if (url.pathname.endsWith("/users/me")) return json({ id: "77" });
			return json({}, 200);
		}) as FetchImpl;
		const provider = new BoxProvider({ fetchImpl: noRedirect });
		provider.setAccountKey("box-acct");
		storeAccessToken("box-acct", "box-token", 3600);
		const resolved = await provider.resolvePlaybackSource("11", {
			fetchImpl: noRedirect,
		});
		expect(resolved.url).toContain("access_token=");
	});

	it("maps provider errors to user-facing codes", async () => {
		const failing: FetchImpl = (async () => json({}, 429)) as FetchImpl;
		const provider = new BoxProvider({ fetchImpl: failing });
		provider.setAccountKey("box-acct");
		storeAccessToken("box-acct", "box-token", 3600);
		await expect(
			provider.listChildren("0", null, failing),
		).rejects.toMatchObject({
			code: "RATE_LIMITED",
		});
	});
});
