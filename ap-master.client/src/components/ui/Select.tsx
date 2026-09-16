import { useId } from 'react';
import type { SelectHTMLAttributes } from 'react';

export interface SelectOption {
    value: string;
    label: string;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
    label: string;
    options: SelectOption[];
}

export function Select({ label, options, ...rest }: SelectProps) {
    const id = useId();
    return (
        <div className="field field--inline">
            <label className="field__label" htmlFor={id}>
                {label}
            </label>
            <select id={id} className="field__control" {...rest}>
                {options.map((option) => (
                    <option key={option.value} value={option.value}>
                        {option.label}
                    </option>
                ))}
            </select>
        </div>
    );
}
