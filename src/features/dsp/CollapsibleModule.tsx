import { useState, type ReactNode } from "react";

/**
 * Collapsible DSP module wrapper: title, bypass switch, primary summary,
 * reset, and an expandable advanced section. Normal users see concise
 * summaries; power users expand. Keyboard-accessible via native button
 * semantics; state is announced.
 */
export function CollapsibleModule({
	id,
	title,
	summary,
	enabled,
	onToggleEnabled,
	enableLabel,
	note,
	onReset,
	defaultOpen = false,
	children,
}: {
	id: string;
	title: string;
	/** One-line concise state, e.g. "Off" or "Width 100%". */
	summary: string;
	enabled: boolean;
	onToggleEnabled: (on: boolean) => void;
	enableLabel: string;
	/** Honesty note, shown inside the expanded body. */
	note?: string;
	onReset?: () => void;
	defaultOpen?: boolean;
	children: ReactNode;
}) {
	const [open, setOpen] = useState(defaultOpen);
	return (
		<section
			aria-labelledby={`${id}-heading`}
			className="rounded-xl border border-line bg-surface p-3"
		>
			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={() => setOpen((v) => !v)}
					aria-expanded={open}
					aria-controls={`${id}-body`}
					className="flex min-w-0 flex-1 items-center gap-2 text-left"
				>
					<span
						aria-hidden="true"
						className="text-xs text-muted transition-transform"
						style={{ transform: open ? "rotate(90deg)" : undefined }}
					>
						▶
					</span>
					<h2 id={`${id}-heading`} className="truncate text-sm font-semibold">
						{title}
					</h2>
				</button>
				<span
					className="truncate text-xs text-muted"
					aria-label={`${title} status`}
				>
					{summary}
				</span>
				<label className="flex shrink-0 items-center gap-1 text-xs">
					<input
						type="checkbox"
						checked={enabled}
						onChange={(e) => onToggleEnabled(e.target.checked)}
						aria-label={enableLabel}
					/>
					On
				</label>
				{onReset ? (
					<button
						type="button"
						onClick={onReset}
						className="shrink-0 text-xs text-muted hover:text-ink"
					>
						Reset
					</button>
				) : null}
			</div>
			{open ? (
				<div id={`${id}-body`} className="mt-2">
					{note ? <p className="mb-2 text-xs text-muted">{note}</p> : null}
					{children}
				</div>
			) : null}
		</section>
	);
}
