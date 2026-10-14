import { describe, expect, it } from "vitest";
import {
	DRIVE_SCOPES_BROAD,
	DRIVE_SCOPES_NARROW,
	GoogleDriveProvider,
} from "./drive";
import type { FetchImpl } from "./oauth";
import { storeAccessToken } from "./token-store";

function json(payload: unknown, status = 200) {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => payload,
		text: async () => JSON.stringify(payload),
	};
}

const SONG = {
	id: "f1",
	name: "Artist - Song.mp3",
	mimeType: "audio/mpeg",
	size: "1234",
	modifiedTime: "2024-01-01T00:00:00.000Z",
	md5Checksum: "abc",
	capabilities: { canDownload: true },
	webContentLink: "https://drive.google.com/uc?id=f1&export=download",
};

/** Fixture transport answering the documented Drive v3 shapes. */
function fixtureFetch(): FetchImpl {
	return (async (input: string) => {
		const url = new URL(input);
		if (url.pathname.endsWith("/about")) {
			return json({ user: { permissionId: "perm1", displayName: "Ada" } });
		}
		const fileMatch = /\/files\/([^/]+)$/.exec(url.pathname);
		if (fileMatch) {
			const id = fileMatch[1];
			// The real API returns every requested field; the fixture
			// answers the full record regardless of the fields mask.
			if (id === "f1") return json(SONG);
			if (id === "locked") {
				return json({
					id: "locked",
					name: "Locked.mp3",
					mimeType: "audio/mpeg",
					capabilities: { canDownload: false },
				});
			}
			return json({}, 404);
		}
		return json({
			files: [
				{
					id: "fld1",
					name: "Music",
					mimeType: "application/vnd.google-apps.folder",
				},
				SONG,
				{ id: "f2", name: "notes.txt", mimeType: "text/plain" },
			],
		});
	}) as FetchImpl;
}

function authedProvider(): GoogleDriveProvider {
	const fetchImpl = fixtureFetch();
	const provider = new GoogleDriveProvider({
		fetchImpl,
		loadScript: async () => undefined,
		popupToken: async () => ({ accessToken: "gis-token", expiresIn: 3600 }),
	});
	provider.setAccountKey("drive-acct");
	storeAccessToken("drive-acct", "gis-token", 3600);
	return provider;
}

describe("google drive provider", () => {
	it("requests the narrow scope by default, broad only on demand", () => {
		const provider = new GoogleDriveProvider();
		expect(provider.scopesFor({})).toEqual(DRIVE_SCOPES_NARROW);
		expect(provider.scopesFor({ broadAccess: true })).toEqual(
			DRIVE_SCOPES_BROAD,
		);
		expect(provider.capabilities.directMediaUrl).toBe("cookie-authenticated");
	});

	it("refuses to connect without a user-supplied client id", async () => {
		const provider = new GoogleDriveProvider();
		await expect(provider.connect({})).rejects.toMatchObject({
			code: "NOT_CONFIGURED",
		});
	});

	it("lists folders and files with stable fields", async () => {
		const provider = authedProvider();
		const fetchImpl = fixtureFetch();
		const listing = await provider.listChildren("root", null, fetchImpl);
		expect(listing.items.map((i) => i.name)).toEqual([
			"Music",
			"Artist - Song.mp3",
			"notes.txt",
		]);
		expect(listing.items[0]?.kind).toBe("folder");
		expect(listing.items[1]).toMatchObject({ id: "f1", revision: "abc" });
	});

	it("search keeps audio and folders, drops the rest", async () => {
		const provider = authedProvider();
		const fetchImpl = fixtureFetch();
		// Folders pass through (navigate into them); non-audio files drop.
		const listing = await provider.searchFiles("song", null, fetchImpl);
		expect(listing?.items.map((i) => i.name)).toEqual([
			"Music",
			"Artist - Song.mp3",
		]);
		expect(await provider.searchFiles("   ", null, fetchImpl)).toBeNull();
	});

	it("resolves playback to the documented browser link", async () => {
		const provider = authedProvider();
		const resolved = await provider.resolvePlaybackSource("f1", {
			fetchImpl: fixtureFetch(),
		});
		expect(resolved.kind).toBe("url");
		expect(resolved.url).toContain("drive.google.com");
		expect(resolved.supportsRange).toBe(true);
		// webContentLink carries no token and no expiry of its own.
		expect(resolved.url).not.toContain("gis-token");
		expect(resolved.expiresAt).toBe(0);
	});

	it("refuses files the user cannot download", async () => {
		const provider = authedProvider();
		await expect(
			provider.resolvePlaybackSource("locked", { fetchImpl: fixtureFetch() }),
		).rejects.toMatchObject({ code: "ACCESS_DENIED" });
	});

	it("maps missing files to null metadata and auth failures loudly", async () => {
		const provider = authedProvider();
		const fetchImpl = fixtureFetch();
		await expect(provider.getMetadata("gone", fetchImpl)).resolves.toBeNull();
		const failing: FetchImpl = (async () => json({}, 401)) as FetchImpl;
		const denied = new GoogleDriveProvider({ fetchImpl: failing });
		denied.setAccountKey("drive-acct");
		storeAccessToken("drive-acct", "t", 3600);
		await expect(
			denied.listChildren("root", null, failing),
		).rejects.toMatchObject({
			code: "AUTH_REQUIRED",
		});
	});

	it("requires a token for every call", async () => {
		const provider = new GoogleDriveProvider({ fetchImpl: fixtureFetch() });
		provider.setAccountKey("drive-nobody");
		await expect(
			provider.listChildren("root", null, fixtureFetch()),
		).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
	});
});
