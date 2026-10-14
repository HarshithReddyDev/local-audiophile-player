import { describe, expect, it } from "vitest";
import { positionStatePayload } from "./use-playback";

describe("position state guards (background/Media Session)", () => {
	it("publishes valid state", () => {
		expect(positionStatePayload(200, 42, 1)).toEqual({
			duration: 200,
			playbackRate: 1,
			position: 42,
		});
	});

	it("clamps position into [0, duration]", () => {
		expect(positionStatePayload(200, -5, 1)?.position).toBe(0);
		expect(positionStatePayload(200, 500, 1)?.position).toBe(200);
	});

	it("rejects null/non-finite/non-positive duration", () => {
		expect(positionStatePayload(null, 1, 1)).toBeNull();
		expect(positionStatePayload(NaN, 1, 1)).toBeNull();
		expect(positionStatePayload(Infinity, 1, 1)).toBeNull();
		expect(positionStatePayload(0, 0, 1)).toBeNull();
		expect(positionStatePayload(-3, 0, 1)).toBeNull();
	});

	it("rejects non-finite position and insane rates", () => {
		expect(positionStatePayload(200, NaN, 1)).toBeNull();
		expect(positionStatePayload(200, 10, NaN)).toBeNull();
		expect(positionStatePayload(200, 10, 0)).toBeNull();
		expect(positionStatePayload(200, 10, -1)).toBeNull();
		expect(positionStatePayload(200, 10, 8)).toBeNull();
	});
});
