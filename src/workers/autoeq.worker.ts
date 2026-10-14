/**
 * AutoEQ Web Worker: runs the pure optimizer off the main thread.
 * Protocol: {id, type:'start', input, options} → progress* → result|error.
 * Cancellation is cooperative (checked between bands/sweeps) plus
 * client-side termination; stale ids are never applied (see client).
 */

import type { FittingOptions } from "../dsp/autoeq";
import { fitPEQ } from "../dsp/autoeq";
import type { AutoEQInput } from "../iem/types";

export interface WorkerStart {
	id: string;
	type: "start";
	input: AutoEQInput;
	options: Partial<FittingOptions>;
}

export interface WorkerCancel {
	id: string;
	type: "cancel";
}

export interface WorkerProgress {
	id: string;
	type: "progress";
	stage: string;
	done: number;
	total: number;
}

export interface WorkerResult {
	id: string;
	type: "result";
	result: import("../dsp/autoeq").FitResult;
}

export interface WorkerFailure {
	id: string;
	type: "error";
	message: string;
}

const cancelled = new Set<string>();

self.onmessage = (event: MessageEvent<WorkerStart | WorkerCancel>) => {
	const message = event.data;
	if (message.type === "cancel") {
		cancelled.add(message.id);
		return;
	}
	const { id, input, options } = message;
	try {
		const result = fitPEQ(input, options, {
			shouldCancel: () => cancelled.has(id),
			onProgress: (stage, done, total) => {
				const progress: WorkerProgress = {
					id,
					type: "progress",
					stage,
					done,
					total,
				};
				self.postMessage(progress);
			},
		});
		const done: WorkerResult = { id, type: "result", result };
		self.postMessage(done);
	} catch (error) {
		const failure: WorkerFailure = {
			id,
			type: "error",
			message: error instanceof Error ? error.message : "Fitting failed.",
		};
		self.postMessage(failure);
	} finally {
		cancelled.delete(id);
	}
};
