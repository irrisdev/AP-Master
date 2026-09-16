import { useId } from 'react';
import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';

interface FieldShellProps {
    id: string;
    label: string;
    hint?: ReactNode;
    error?: string;
    /** Hide the label visually but keep it for screen readers. */
    hideLabel?: boolean;
    children: ReactNode;
}

function FieldShell({ id, label, hint, error, hideLabel, children }: FieldShellProps) {
    return (
        <div className={`field ${error ? 'field--invalid' : ''}`.trim()}>
            <label className={hideLabel ? 'visually-hidden' : 'field__label'} htmlFor={id}>
                {label}
            </label>
            {children}
            <div className="field__footer">
                {error ? (
                    <span className="field__error" id={`${id}-error`}>
                        {error}
                    </span>
                ) : null}
                {hint ? (
                    <span className="field__hint" id={`${id}-hint`}>
                        {hint}
                    </span>
                ) : null}
            </div>
        </div>
    );
}

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
    label: string;
    hint?: ReactNode;
    error?: string;
    hideLabel?: boolean;
}

export function TextField({ label, hint, error, hideLabel, ...rest }: TextFieldProps) {
    const id = useId();
    return (
        <FieldShell id={id} label={label} hint={hint} error={error} hideLabel={hideLabel}>
            <input
                id={id}
                className="field__control"
                aria-invalid={error ? true : undefined}
                aria-describedby={describedBy(id, error, hint)}
                {...rest}
            />
        </FieldShell>
    );
}

export interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
    label: string;
    hint?: ReactNode;
    error?: string;
    hideLabel?: boolean;
}

export function TextArea({ label, hint, error, hideLabel, ...rest }: TextAreaProps) {
    const id = useId();
    return (
        <FieldShell id={id} label={label} hint={hint} error={error} hideLabel={hideLabel}>
            <textarea
                id={id}
                className="field__control field__control--area"
                aria-invalid={error ? true : undefined}
                aria-describedby={describedBy(id, error, hint)}
                {...rest}
            />
        </FieldShell>
    );
}

function describedBy(id: string, error?: string, hint?: ReactNode): string | undefined {
    const ids = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean);
    return ids.length > 0 ? ids.join(' ') : undefined;
}
