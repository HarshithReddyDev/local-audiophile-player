/**
 * AutoEQ worker client: one worker per fit, terminated on completion or
 * cancel. Generation ids make stale results inapplicable by construction —
 * a superseded fit's worker is dead before its messages could arrive, and
 * any late message with a mismatched id is dropped.
 */

import type { FitResult, FittingOptions } from "../dsp/autoeq";
import type { AutoEQInput } from "../iem/types";
import type {
	WorkerFailure,
	WorkerProgress,
	WorkerResult,
} from "./autoeq.worker";

export interface FitProgress {
	stage: string;
	done: number;
	total: number;
}

export class AutoEQCancelled extends Error {
	constructor() {
		super("Fitting cancelled.");
		this.name = "AutoEQCancelled";
	}
}

export interface FitHandle {
	promise: Promise<FitResult>;
	cancel: () => void;
}

let sequence = 0;

async function defaultCreateWorker(): Promise<Worker> {
	const module = await import("./autoeq.worker?worker");
	const WorkerClass = module.default as new () => Worker;
	return new WorkerClass();
}

export interface FitDeps {
	createWorker?: () => Promise<Worker>;
}

export function runAutoEQFit(
	input: AutoEQInput,
	options: Partial<FittingOptions>,
	onProgress?: (progress: FitProgress) => void,
	deps: FitDeps = {},
): FitHandle {
	const id = `fit-${Date.now().toString(36)}-${(sequence += 1)}`;
	let worker: Worker | null = null;
	let settled = false;

	const cleanup = () => {
		worker?.terminate();
		worker = null;
	};
	const finish = (fn: () => void) => {
		if (settled) return;
		settled = true;
		cleanup();
		fn();
	};
	let doCancel = () => undefined as void;

	const promise = new Promise<FitResult>((resolve, reject) => {
		doCancel = () => {
			finish(() => reject(new AutoEQCancelled()));
		};
		const createWorker = deps.createWorker ?? defaultCreateWorker;
		void createWorker()
			.then((created) => {
				if (settled) return;
				worker = created;
				worker.onmessage = (
					event: MessageEvent<WorkerProgress | WorkerResult | WorkerFailure>,
				) => {
					const message = event.data;
					if (message.id !== id) return; // stale generation: drop
					if (message.type === "progress") {
						onProgress?.({
							stage: message.stage,
							done: message.done,
							total: message.total,
						});
					} else if (message.type === "result") {
						finish(() => resolve(message.result));
					} else {
						finish(() => reject(new Error(message.message)));
					}
				};
				worker.onerror = () => {
					finish(() =>
						reject(
							new Error(
								"Fitting worker failed to start. Web Workers may be unavailable in this browser.",
							),
						),
					);
				};
				worker.postMessage({ id, type: "start", input, options });
			})
			.catch(() => {
				finish(() =>
					reject(
						new Error(
							"Fitting worker failed to start. Web Workers may be unavailable in this browser.",
						),
					),
				);
			});
	});

	return { promise, cancel: () => doCancel() };
}
