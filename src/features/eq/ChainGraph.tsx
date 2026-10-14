import type { ResponsePoint } from "../../dsp/response";
import { useChainGrid, useChainInput } from "./use-chain";

const W = 640;
const H = 200;
const PAD = { left: 44, right: 12, top: 12, bottom: 24 };
const F_MIN = 20;
const F_MAX = 20000;

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

/**
 * Full static-chain response: PEQ/graphic + tone + tuner + loudness in
 * one curve from the shared response engine. Dynamic/spatial modules
 * (compressor, limiter, width, reverb) have no magnitude response and
 * are excluded — stated below the graph, not hidden. A text summary
 * carries the same numbers for screen readers and keyboard users.
 */
export function ChainGraph() {
	const chain = useChainInput();
	const points: ResponsePoint[] = useChainGrid(chain);
	const peak = Math.max(6, ...points.map((p) => Math.abs(p.db)), 0.001);
	const maxDb = Math.ceil(Math.min(24, peak));
	const path = points
		.map(
			(p, i) =>
				`${i === 0 ? "M" : "L"}${freqToX(p.frequency).toFixed(1)},${dbToY(p.db, maxDb).toFixed(1)}`,
		)
		.join(" ");
	const maxPoint = points.reduce(
		(a, b) => (b.db > a.db ? b : a),
		points[0] ?? { frequency: 1000, db: 0 },
	);
	return (
		<figure className="flex flex-col gap-1">
			<svg
				viewBox={`0 0 ${W} ${H}`}
				role="img"
				aria-label={`Combined static EQ response, peak ${maxPoint.db >= 0 ? "+" : ""}${maxPoint.db.toFixed(1)} decibels near ${Math.round(maxPoint.frequency)} hertz`}
				className="w-full rounded-lg border border-line bg-abyss"
			>
				{[20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].map((f) => (
					<line
						key={f}
						x1={freqToX(f)}
						x2={freqToX(f)}
						y1={PAD.top}
						y2={H - PAD.bottom}
						stroke="currentColor"
						strokeOpacity={0.12}
					/>
				))}
				{[-maxDb, -maxDb / 2, 0, maxDb / 2, maxDb].map((db) => (
					<line
						key={db}
						x1={PAD.left}
						x2={W - PAD.right}
						y1={dbToY(db, maxDb)}
						y2={dbToY(db, maxDb)}
						stroke="currentColor"
						strokeOpacity={db === 0 ? 0.4 : 0.12}
					/>
				))}
				<path d={path} fill="none" stroke="currentColor" strokeWidth={2} />
				<circle
					cx={freqToX(maxPoint.frequency)}
					cy={dbToY(maxPoint.db, maxDb)}
					r={3.5}
					fill="currentColor"
				/>
				<text
					x={W - PAD.right}
					y={H - 8}
					textAnchor="end"
					fontSize={10}
					fill="currentColor"
					opacity={0.6}
				>
					20 Hz – 20 kHz
				</text>
			</svg>
			<figcaption className="text-xs text-muted">
				Peak {maxPoint.db >= 0 ? "+" : ""}
				{maxPoint.db.toFixed(1)} dB near {Math.round(maxPoint.frequency)} Hz.
				Compressor, limiter, width, and reverb shape dynamics/space, not this
				curve.
			</figcaption>
		</figure>
	);
}
