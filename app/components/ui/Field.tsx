"use client";

import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

export const controlClass =
    'w-full rounded-md border border-rule-strong bg-surface px-3 text-base text-ink placeholder:text-ink-muted/80 ' +
    'transition-colors hover:border-ink-muted focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-accent ' +
    'disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-loss';

interface FieldShellProps {
    label: ReactNode;
    hint?: ReactNode;
    error?: ReactNode;
    className?: string;
    /** Visually hide the label (it stays available to screen readers). */
    hideLabel?: boolean;
    children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

/** Label linked to its control, hint text and an error message, wired with aria-describedby. */
export function Field({ label, hint, error, className, hideLabel, children }: FieldShellProps) {
    const id = useId();
    const hintId = `${id}-hint`;
    const errorId = `${id}-error`;
    const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

    return (
        <div className={cn('min-w-0', className)}>
            <label htmlFor={id} className={cn('mb-1.5 block text-sm font-medium text-ink', hideLabel && 'sr-only')}>
                {label}
            </label>
            {children({ id, describedBy, invalid: Boolean(error) })}
            {hint && !error && <p id={hintId} className="mt-1.5 text-sm text-ink-muted">{hint}</p>}
            {error && <p id={errorId} className="mt-1.5 text-sm font-medium text-loss">{error}</p>}
        </div>
    );
}

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & Omit<FieldShellProps, 'children'>;

export function Input({ label, hint, error, className, hideLabel, ...rest }: InputProps) {
    return (
        <Field label={label} hint={hint} error={error} className={className} hideLabel={hideLabel}>
            {({ id, describedBy, invalid }) => (
                <input id={id} aria-describedby={describedBy} aria-invalid={invalid || undefined} className={cn(controlClass, 'h-10')} {...rest} />
            )}
        </Field>
    );
}

type TextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> & Omit<FieldShellProps, 'children'>;

export function Textarea({ label, hint, error, className, hideLabel, ...rest }: TextareaProps) {
    return (
        <Field label={label} hint={hint} error={error} className={className} hideLabel={hideLabel}>
            {({ id, describedBy, invalid }) => (
                <textarea id={id} aria-describedby={describedBy} aria-invalid={invalid || undefined} className={cn(controlClass, 'min-h-24 resize-y py-2')} {...rest} />
            )}
        </Field>
    );
}

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> & Omit<FieldShellProps, 'children'>;

export function Select({ label, hint, error, className, hideLabel, children, ...rest }: SelectProps & { children: ReactNode }) {
    return (
        <Field label={label} hint={hint} error={error} className={className} hideLabel={hideLabel}>
            {({ id, describedBy, invalid }) => <SelectControl id={id} aria-describedby={describedBy} aria-invalid={invalid || undefined} {...rest}>{children}</SelectControl>}
        </Field>
    );
}

/** A native select with a visible chevron, for places that supply their own label. */
export function SelectControl({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
    return (
        <div className="relative">
            <select className={cn(controlClass, 'h-10 appearance-none pr-9', className)} {...rest}>
                {children}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden />
        </div>
    );
}
