import { describe, expect, it } from "vitest";
import { clamp, formatBytes, formatTime } from "./time";

describe("formatTime", () => {
	it("formats seconds", () => {
		expect(formatTime(0)).toBe("0:00");
		expect(formatTime(65)).toBe("1:05");
		expect(formatTime(3599)).toBe("59:59");
	});

	it("formats hours", () => {
		expect(formatTime(3600)).toBe("1:00:00");
		expect(formatTime(3661)).toBe("1:01:01");
	});

	it("handles missing input", () => {
		expect(formatTime(null)).toBe("–:––");
		expect(formatTime(undefined)).toBe("–:––");
		expect(formatTime(Number.NaN)).toBe("–:––");
		expect(formatTime(-5)).toBe("0:00");
	});
});

describe("clamp", () => {
	it("clamps", () => {
		expect(clamp(0.5, 0, 1)).toBe(0.5);
		expect(clamp(-1, 0, 1)).toBe(0);
		expect(clamp(2, 0, 1)).toBe(1);
		expect(clamp(Number.NaN, 0, 1)).toBe(0);
	});
});

describe("formatBytes", () => {
	it("formats", () => {
		expect(formatBytes(0)).toBe("0 B");
		expect(formatBytes(512)).toBe("512 B");
		expect(formatBytes(1536)).toBe("1.5 KB");
		expect(formatBytes(4_200_000)).toBe("4.0 MB");
	});
});
