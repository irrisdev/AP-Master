import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Spinner } from './Spinner.tsx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    size?: 'sm' | 'md';
    /** Shows a spinner and blocks further clicks while a request is in flight. */
    loading?: boolean;
    children: ReactNode;
}

export function Button({
    variant = 'secondary',
    size = 'md',
    loading = false,
    disabled,
    className = '',
    children,
    ...rest
}: ButtonProps) {
    return (
        <button
            type="button"
            className={`btn btn--${variant} btn--${size} ${className}`.trim()}
            disabled={disabled === true || loading}
            aria-busy={loading || undefined}
            {...rest}
        >
            {loading ? <Spinner size="sm" /> : null}
            {children}
        </button>
    );
}
