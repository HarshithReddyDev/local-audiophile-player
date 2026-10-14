import { describe, expect, it } from "vitest";
import {
	exportPresetFile,
	importPresetFile,
	PresetFileError,
} from "./preset-file";

const PEQ = {
	version: 1,
	preamp: -2,
	enabled: true,
	bands: [{ type: "peaking", frequency: 1000, gain: 3, q: 1, enabled: true }],
} as const;

describe("preset files", () => {
	it("round-trips with metadata", () => {
		const text = exportPresetFile({
			name: "My preset",
			deviceName: "Example",
			origin: "tutorial",
			attribution: "in-repo",
			peq: { ...PEQ, bands: [...PEQ.bands] },
			exportedAt: 123,
		});
		const parsed = importPresetFile(text);
		expect(parsed).toMatchObject({
			schemaVersion: 1,
			kind: "iem-player-preset",
			name: "My preset",
			deviceName: "Example",
			origin: "tutorial",
		});
		expect(parsed.peq.bands).toHaveLength(1);
	});

	it("fails safe with reasons on malformed input", () => {
		const cases: [string, RegExp][] = [
			["not json{{{", /valid JSON/],
			["[]", /JSON object/],
			[JSON.stringify({ kind: "nope" }), /Not an IEM Player preset/],
			[
				JSON.stringify({ kind: "iem-player-preset", schemaVersion: 99 }),
				/Unsupported preset version/,
			],
			[
				JSON.stringify({ kind: "iem-player-preset", schemaVersion: 1 }),
				/missing a name/,
			],
			[
				JSON.stringify({
					kind: "iem-player-preset",
					schemaVersion: 1,
					name: "x",
					peq: { version: 1 },
				}),
				/malformed/,
			],
		];
		for (const [text, pattern] of cases) {
			expect(() => importPresetFile(text), text).toThrowError(PresetFileError);
			expect(() => importPresetFile(text), text).toThrowError(pattern);
		}
	});
});
