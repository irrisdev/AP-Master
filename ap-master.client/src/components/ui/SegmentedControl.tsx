import { useRef } from 'react';
import type { KeyboardEvent } from 'react';

export interface SegmentOption<T extends string> {
    value: T;
    label: string;
    /** Optional count shown after the label, e.g. how many items the option would show. */
    count?: number;
}

export interface SegmentedControlProps<T extends string> {
    options: SegmentOption<T>[];
    value: T;
    onChange: (value: T) => void;
    /** Names the group for screen readers, e.g. "Ticket type". */
    label: string;
}

/**
 * One choice from a few, shown side by side: a radio group underneath, so arrow keys
 * move the selection and only the selected option is in the tab order.
 */
export function SegmentedControl<T extends string>({
    options,
    value,
    onChange,
    label,
}: SegmentedControlProps<T>) {
    const buttons = useRef<Partial<Record<T, HTMLButtonElement | null>>>({});

    function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
        const index = options.findIndex((option) => option.value === value);
        let target: number | null = null;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') target = (index + 1) % options.length;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') target = (index - 1 + options.length) % options.length;
        if (event.key === 'Home') target = 0;
        if (event.key === 'End') target = options.length - 1;
        if (target === null) return;

        event.preventDefault();
        const next = options[target].value;
        onChange(next);
        buttons.current[next]?.focus();
    }

    return (
        <div className="segmented" role="radiogroup" aria-label={label} onKeyDown={handleKeyDown}>
            {options.map((option) => {
                const checked = option.value === value;
                return (
                    <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={checked}
                        tabIndex={checked ? 0 : -1}
                        className={`segmented__option ${checked ? 'segmented__option--checked' : ''}`.trim()}
                        ref={(element) => {
                            buttons.current[option.value] = element;
                        }}
                        onClick={() => onChange(option.value)}
                    >
                        {option.label}
                        {option.count !== undefined ? (
                            <span className="segmented__count">{option.count}</span>
                        ) : null}
                    </button>
                );
            })}
        </div>
    );
}
