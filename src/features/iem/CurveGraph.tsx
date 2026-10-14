import { useMemo } from "react";
import type { ResponseCurve } from "../../dsp/curves";

const W = 640;
const H = 260;
const PAD = { left: 44, right: 12, top: 12, bottom: 24 };
const F_MIN = 20;
const F_MAX = 20000;

export interface CurveSeries {
	id: string;
	label: string;
	color: "accent" | "muted" | "warn" | "teal";
	curve: ResponseCurve;
}

function freqToX(frequency: number): number {
	const lo = Math.log10(F_MIN);
	const hi = Math.log10(F_MAX);
	const t =
		(Math.log10(Math.min(F_MAX, Math.max(F_MIN, frequency))) - lo) / (hi - lo);
	return PAD.left + t * (W - PAD.left - PAD.right);
}

function dbToY(db: number, maxDb: number): number {
	const t = (db + maxDb) / (2 * maxDb);
	return PAD.top + (1 - t) * (H - PAD.top - PAD.bottom);
}

const STROKE: Record<CurveSeries["color"], string> = {
	accent: "var(--color-accent)",
	muted: "currentColor",
	warn: "#e0a63c",
	teal: "#4fd1a5",
};

/**
 * Read-only multi-series curve graph. Same conventions as the EQ response
 * graph (log frequency, 0 dB reference) so measurement/target/correction
 * read identically everywhere.
 */
export function CurveGraph({ series }: { series: CurveSeries[] }) {
	const maxDb = useMemo(() => {
		let peak = 6;
		for (const s of series) {
			for (const g of s.curve.gains) peak = Math.max(peak, Math.abs(g));
		}
		return Math.ceil(Math.min(30, peak));
	}, [series]);

	const paths = useMemo(
		() =>
			series.map((s) => ({
				...s,
				d: s.curve.frequencies
					.map(
						(f, i) =>
							`${i === 0 ? "M" : "L"}${freqToX(f).toFixed(1)},${dbToY(s.curve.gains[i] ?? 0, maxDb).toFixed(1)}`,
					)
					.join(" "),
			})),
		[series, maxDb],
	);

	return (
		<figure aria-label="Frequency response curves">
			<svg
				viewBox={`0 0 ${W} ${H}`}
				role="img"
				aria-label={`${series.map((s) => s.label).join(", ")}, 20 hertz to 20 kilohertz`}
				className="w-full rounded-xl border border-line bg-abyss"
			>
				{[20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].map((f) => (
					<g key={f}>
						<line
							x1={freqToX(f)}
							y1={PAD.top}
							x2={freqToX(f)}
							y2={H - PAD.bottom}
							stroke="currentColor"
							strokeOpacity={0.12}
						/>
						<text
							x={freqToX(f)}
							y={H - 8}
							textAnchor="middle"
							fontSize="10"
							fill="currentColor"
							opacity={0.6}
						>
							{f >= 1000 ? `${f / 1000}k` : f}
						</text>
					</g>
				))}
				{[-maxDb, -maxDb / 2, 0, maxDb / 2, maxDb].map((db) => (
					<g key={db}>
						<line
							x1={PAD.left}
							y1={dbToY(db, maxDb)}
							x2={W - PAD.right}
							y2={dbToY(db, maxDb)}
							stroke="currentColor"
							strokeOpacity={db === 0 ? 0.5 : 0.12}
							strokeDasharray={db === 0 ? undefined : "3 3"}
						/>
						<text
							x={PAD.left - 5}
							y={dbToY(db, maxDb) + 3}
							textAnchor="end"
							fontSize="10"
							fill="currentColor"
							opacity={0.6}
						>
							{db > 0 ? `+${db}` : db}
						</text>
					</g>
				))}
				{paths.map((s) => (
					<path
						key={s.id}
						d={s.d}
						fill="none"
						stroke={STROKE[s.color]}
						strokeOpacity={s.color === "muted" ? 0.5 : 1}
						strokeWidth={s.color === "accent" ? 2.5 : 1.5}
					/>
				))}
			</svg>
			<figcaption className="mt-1 flex flex-wrap justify-center gap-3 text-[11px] text-muted">
				{series.map((s) => (
					<span key={s.id} className="inline-flex items-center gap-1">
						<span
							aria-hidden="true"
							className="inline-block h-0.5 w-4"
							style={{ background: STROKE[s.color] }}
						/>
						{s.label}
					</span>
				))}
			</figcaption>
		</figure>
	);
}
