interface SliderProps {
	label: string;
	value: number;
	min: number;
	max: number;
	step: number;
	onChange: (value: number) => void;
	/** Spoken/read value, e.g. "1:05 of 3:20". Defaults to the numeric value. */
	textValue?: string;
	disabled?: boolean;
}

/** Accessible native range input. Keyboard support comes free with the label. */
export function Slider({
	label,
	value,
	min,
	max,
	step,
	onChange,
	textValue,
	disabled,
}: SliderProps) {
	return (
		<input
			type="range"
			aria-label={label}
			aria-valuetext={textValue ?? String(value)}
			min={min}
			max={max}
			step={step}
			value={value}
			disabled={disabled}
			onChange={(e) => onChange(Number(e.target.value))}
			className="w-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
		/>
	);
}
