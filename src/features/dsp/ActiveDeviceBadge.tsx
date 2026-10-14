import { useDspStore } from "../../state/dsp-store";
import { useEQStore } from "../../state/eq-store";

/**
 * One-line active-configuration status: device (or global), EQ state,
 * effective preamp. Rendered in the player bar and full player so users
 * never forget DSP is active.
 */
export function ActiveDeviceBadge({
	onOpenDevices,
}: {
	onOpenDevices?: () => void;
}) {
	const activeDeviceName = useDspStore((s) => s.activeDeviceName);
	const eqEnabled = useEQStore((s) => s.profile.enabled);
	const eqPreamp = useEQStore((s) => s.profile.preamp);
	const masterBypass = useDspStore((s) => s.masterBypass);
	const comparing = useDspStore((s) => s.comparing);

	const state =
		masterBypass || comparing ? "BYPASSED" : eqEnabled ? "EQ ON" : "EQ OFF";
	const label = activeDeviceName ?? "Global";
	const preampText = `${eqPreamp > 0 ? "+" : ""}${eqPreamp.toFixed(1)} dB`;

	const inner = (
		<>
			<span className="max-w-36 truncate font-medium text-ink">{label}</span>
			<span aria-hidden="true" className="text-muted">
				•
			</span>
			<span
				className={masterBypass || comparing ? "font-medium text-accent" : ""}
			>
				{state}
			</span>
			<span aria-hidden="true" className="text-muted">
				•
			</span>
			<span className="tabular-nums">{preampText}</span>
		</>
	);

	const className =
		"flex min-w-0 items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[11px] text-muted transition-colors hover:bg-elevated hover:text-ink";
	if (!onOpenDevices) {
		return (
			<span
				className={className}
				role="status"
				aria-label={`Active audio configuration: ${label}, ${state}, preamp ${preampText}`}
			>
				{inner}
			</span>
		);
	}
	return (
		<button
			type="button"
			onClick={onOpenDevices}
			className={className}
			aria-label={`Active audio configuration: ${label}, ${state}, preamp ${preampText}. Change device.`}
		>
			{inner}
		</button>
	);
}
