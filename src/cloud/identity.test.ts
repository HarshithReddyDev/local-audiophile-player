import { describe, expect, it } from "vitest";
import { cloudAccountId, cloudSourceId, cloudTrackId } from "./identity";

describe("cloud identity", () => {
	it("is stable across reconnects", () => {
		expect(cloudTrackId("google-drive", "a1", "f1")).toBe(
			cloudTrackId("google-drive", "a1", "f1"),
		);
		expect(cloudAccountId("one-drive", "u9")).toBe(
			cloudAccountId("one-drive", "u9"),
		);
	});

	it("never uses filenames, paths, or URLs", () => {
		const a = cloudTrackId("dropbox", "a1", "id:abc");
		const b = cloudTrackId("dropbox", "a1", "id:abc");
		expect(a).toBe(b);
		expect(a).toMatch(/^trk-[0-9a-f]{8}$/);
		// Different file, same name → different id.
		expect(cloudTrackId("dropbox", "a1", "id:abd")).not.toBe(a);
		// Same file id, different account → different id.
		expect(cloudTrackId("dropbox", "a2", "id:abc")).not.toBe(a);
		// Same file id, different provider → different id.
		expect(cloudTrackId("box", "a1", "id:abc")).not.toBe(a);
	});

	it("derives source ids from the committed account id", () => {
		const account = cloudAccountId("box", "u1");
		expect(cloudSourceId(account)).toBe(`src-${account}`);
	});
});
