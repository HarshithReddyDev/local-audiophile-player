import { useEffect, useRef, useState } from "react";
import { usePlayerStore } from "../../state/player-store";
import { getPlaybackEngine } from "../player/use-playback";

interface AnalyserLike {
	fftSize: number;
	frequencyBinCount: number;
	getByteFrequencyData(array: Uint8Array): void;
	getByteTimeDomainData(array: Uint8Array): void;
}

function getAnalyser(): AnalyserLike | null {
	const node = getPlaybackEngine()?.getAnalyser() as AnalyserLike | null;
	if (!node || typeof node.getByteFrequencyData !== "function") return null;
	return node;
}

/**
 * Spectrum bars + waveform + peak meter from a lazily tapped AnalyserNode.
 * Background policy: AUDIO CONTINUES while hidden; only UI work stops.
 * One small canvas, ~64 spectrum bins, rAF only while visible, playing,
 * and the page is shown. Hidden tabs draw one static frame and stop.
 * Honors prefers-reduced-motion with a single frame + note.
 */
export function Visualizer() {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const wrapRef = useRef<HTMLDivElement>(null);
	const playing = usePlayerStore((s) => s.status === "playing");
	const [visible, setVisible] = useState(true);
	const [reducedMotion] = useState(
		() =>
			typeof window !== "undefined" &&
			typeof window.matchMedia === "function" &&
			window.matchMedia("(prefers-reduced-motion: reduce)").matches,
	);
	const [peak, setPeak] = useState(0);

	useEffect(() => {
		const wrap = wrapRef.current;
		if (!wrap || typeof IntersectionObserver === "undefined") return;
		const observer = new IntersectionObserver(
			(entries) => {
				const entry = entries[0];
				setVisible(entry ? entry.isIntersecting : true);
			},
			{ threshold: 0.1 },
		);
		observer.observe(wrap);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const context = canvas.getContext("2d");
		if (!context) return;
		const analyser = getAnalyser();
		if (!analyser) return;
		const bins = new Uint8Array(analyser.frequencyBinCount);
		const wave = new Uint8Array(analyser.frequencyBinCount);
		let raf = 0;
		let stopped = false;
		let lastPeak = 0;

		const draw = (): void => {
			if (stopped) return;
			// Background tabs: audio continues, UI work stops. Draw nothing
			// more until visible again (the effect re-runs on visibility).
			if (typeof document !== "undefined" && document.hidden) return;
			analyser.getByteFrequencyData(bins);
			analyser.getByteTimeDomainData(wave);
			const width = canvas.width;
			const height = canvas.height;
			context.clearRect(0, 0, width, height);
			// Spectrum: 64 log-ish bars across the lower 3/5.
			const bars = 64;
			const barArea = Math.floor(height * 0.6);
			const barWidth = width / bars;
			context.fillStyle = "currentColor";
			const usable = Math.floor(bins.length * 0.72);
			for (let i = 0; i < bars; i++) {
				const idx = Math.floor((i / bars) ** 1.6 * usable);
				const value = (bins[idx] ?? 0) / 255;
				const barHeight = Math.max(1, value * barArea);
				context.globalAlpha = 0.85;
				context.fillRect(
					i * barWidth + 1,
					barArea - barHeight,
					Math.max(1, barWidth - 2),
					barHeight,
				);
			}
			context.globalAlpha = 1;
			// Waveform strip below.
			const waveTop = barArea + 6;
			const waveHeight = height - waveTop - 4;
			context.strokeStyle = "currentColor";
			context.globalAlpha = 0.6;
			context.beginPath();
			const step = Math.max(1, Math.floor(wave.length / width));
			for (let x = 0; x < width; x++) {
				const v =
					((wave[Math.min(wave.length - 1, x * step)] ?? 128) - 128) / 128;
				const y = waveTop + waveHeight / 2 + v * (waveHeight / 2);
				if (x === 0) context.moveTo(x, y);
				else context.lineTo(x, y);
			}
			context.stroke();
			context.globalAlpha = 1;
			// Peak estimate from the time domain (display only).
			let peakValue = 0;
			for (let i = 0; i < wave.length; i += 4) {
				const v = Math.abs(((wave[i] ?? 128) - 128) / 128);
				if (v > peakValue) peakValue = v;
			}
			lastPeak = Math.max(peakValue, lastPeak * 0.985);
			setPeak(lastPeak);
			// Loop only while the page is shown, the visualizer is on-screen,
			// and audio is playing. Hidden/paused states keep one static frame.
			if (
				!reducedMotion &&
				playing &&
				visible &&
				(typeof document === "undefined" || !document.hidden)
			) {
				raf = requestAnimationFrame(draw);
			}
		};

		if (reducedMotion) {
			draw();
		} else if (
			visible &&
			playing &&
			(typeof document === "undefined" || !document.hidden)
		) {
			raf = requestAnimationFrame(draw);
		} else {
			draw();
		}
		// Stop the loop when the tab hides; restart handled by effect deps
		// via a visibility listener below.
		const onVis = (): void => {
			if (typeof document !== "undefined" && document.hidden) {
				cancelAnimationFrame(raf);
			} else if (!reducedMotion && visible && playing && !stopped) {
				raf = requestAnimationFrame(draw);
			}
		};
		if (typeof document !== "undefined") {
			document.addEventListener("visibilitychange", onVis);
		}
		return () => {
			stopped = true;
			cancelAnimationFrame(raf);
			if (typeof document !== "undefined") {
				document.removeEventListener("visibilitychange", onVis);
			}
		};
	}, [playing, visible, reducedMotion]);

	return (
		<div ref={wrapRef} className="flex w-full flex-col gap-1">
			<canvas
				ref={canvasRef}
				width={600}
				height={180}
				role="img"
				aria-label={`Spectrum and waveform visualizer, current peak ${Math.round(peak * 100)} percent`}
				className="w-full rounded-lg border border-line bg-abyss text-accent"
			/>
			<div
				className="h-1.5 overflow-hidden rounded-full bg-elevated"
				role="meter"
				aria-label="Peak level"
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={Math.round(peak * 100)}
			>
				<div
					className="h-full bg-accent"
					style={{ width: `${Math.round(peak * 100)}%` }}
				/>
			</div>
			<p className="text-[11px] text-muted">
				{reducedMotion
					? "Single frame (reduced motion is on)."
					: "Live while visible and playing; paused in background tabs."}{" "}
				Analyser tap only — the audio path is untouched.
			</p>
		</div>
	);
}
