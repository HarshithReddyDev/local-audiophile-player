/**
 * Channel/spatial math as explicit 2×2 matrices. Every control composes
 * into one matrix `[ [ll, lr], [rl, rr] ]` mapping input (L,R) to output:
 *
 *   outL = ll·inL + lr·inR
 *   outR = rl·inL + rr·inR
 *
 * The engine realizes the composed matrix with splitter → gains → merger,
 * so what the tests assert here is exactly what the user hears. Order is
 * fixed and documented: balance → width → crossfeed → channel mode.
 */

export type ChannelMode =
	| "stereo"
	| "mono"
	| "left-only"
	| "right-only"
	| "swap";

export const CHANNEL_MODES: ChannelMode[] = [
	"stereo",
	"mono",
	"left-only",
	"right-only",
	"swap",
];

export type Matrix2x2 = [[number, number], [number, number]];

export const IDENTITY_MATRIX: Matrix2x2 = [
	[1, 0],
	[0, 1],
];

function multiply(a: Matrix2x2, b: Matrix2x2): Matrix2x2 {
	return [
		[
			a[0]![0] * b[0]![0] + a[0]![1] * b[1]![0],
			a[0]![0] * b[0]![1] + a[0]![1] * b[1]![1],
		],
		[
			a[1]![0] * b[0]![0] + a[1]![1] * b[1]![0],
			a[1]![0] * b[0]![1] + a[1]![1] * b[1]![1],
		],
	];
}

/**
 * Stereo balance, −1 (full left) … +1 (full right), 0 = unity.
 * Unlike a mono pan pot, balance keeps the toward-side at unity and
 * attenuates only the opposite side: center is bit-for-bit unity
 * (verified) and extremes silence the opposite channel (verified).
 */
export function balanceMatrix(pan: number): Matrix2x2 {
	const p = Number.isFinite(pan) ? Math.min(1, Math.max(-1, pan)) : 0;
	const attenuate = Math.cos((Math.abs(p) * Math.PI) / 2);
	const left = p <= 0 ? 1 : attenuate;
	const right = p >= 0 ? 1 : attenuate;
	return [
		[left, 0],
		[0, right],
	];
}

/**
 * Mid-side width, 0 (mono) … 1 (neutral) … 1.5 (extra wide).
 * L = mid + w·side, R = mid − w·side with mid = (L+R)/2, side = (L−R)/2.
 * Width above 1 can cause phase cancellation on mono playback — the UI
 * warns, and the default stays at neutral 1.
 */
export function widthMatrix(width: number): Matrix2x2 {
	const w = Number.isFinite(width) ? Math.min(1.5, Math.max(0, width)) : 1;
	const sum = (1 + w) / 2;
	const diff = (1 - w) / 2;
	return [
		[sum, diff],
		[diff, sum],
	];
}

/**
 * Speaker-like crossfeed, 0 (off) … 0.5. Blends a little of each channel
 * into the other to soften hard-panned headphone imaging. Clearly labeled
 * as an imaging aid, never as room simulation.
 */
export function crossfeedMatrix(amount: number): Matrix2x2 {
	const c = Number.isFinite(amount) ? Math.min(0.5, Math.max(0, amount)) : 0;
	return [
		[1 - c, c],
		[c, 1 - c],
	];
}

export function modeMatrix(mode: ChannelMode): Matrix2x2 {
	switch (mode) {
		case "mono":
			return [
				[0.5, 0.5],
				[0.5, 0.5],
			];
		case "left-only":
			return [
				[1, 0],
				[1, 0],
			];
		case "right-only":
			return [
				[0, 1],
				[0, 1],
			];
		case "swap":
			return [
				[0, 1],
				[1, 0],
			];
		case "stereo":
		default:
			return [
				[1, 0],
				[0, 1],
			];
	}
}

export interface SpatialParams {
	enabled: boolean;
	/** −1…+1, 0 centered. */
	balance: number;
	/** 0…1.5, 1 neutral. */
	width: number;
	/** 0…0.5, 0 off. */
	crossfeed: number;
	mode: ChannelMode;
}

export const SPATIAL_DEFAULTS: SpatialParams = {
	enabled: false,
	balance: 0,
	width: 1,
	crossfeed: 0,
	mode: "stereo",
};

/** Full composed matrix. Identity when neutral (verified by test). */
export function spatialMatrix(params: SpatialParams): Matrix2x2 {
	const balance = Number.isFinite(params.balance)
		? Math.min(1, Math.max(-1, params.balance))
		: 0;
	const width = Number.isFinite(params.width)
		? Math.min(1.5, Math.max(0, params.width))
		: 1;
	const crossfeed = Number.isFinite(params.crossfeed)
		? Math.min(0.5, Math.max(0, params.crossfeed))
		: 0;
	const mode: ChannelMode = CHANNEL_MODES.includes(params.mode)
		? params.mode
		: "stereo";
	if (!params.enabled) return IDENTITY_MATRIX;
	if (balance === 0 && width === 1 && crossfeed === 0 && mode === "stereo") {
		return IDENTITY_MATRIX;
	}
	// Application order: balance → width → crossfeed → mode.
	return multiply(
		modeMatrix(mode),
		multiply(
			crossfeedMatrix(crossfeed),
			multiply(widthMatrix(width), balanceMatrix(balance)),
		),
	);
}

/** Apply a matrix to one stereo frame (test/oracle helper). */
export function applyMatrix(
	matrix: Matrix2x2,
	left: number,
	right: number,
): [number, number] {
	return [
		matrix[0]![0] * left + matrix[0]![1] * right,
		matrix[1]![0] * left + matrix[1]![1] * right,
	];
}
