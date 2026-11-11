import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost';
type Size = 'md' | 'sm';

const base =
    'inline-flex shrink-0 items-center justify-center gap-2 rounded-md font-medium transition-colors ' +
    'disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap';

const variants: Record<Variant, string> = {
    primary: 'bg-accent text-accent-ink hover:bg-accent/90',
    secondary: 'border border-rule-strong bg-surface text-ink hover:bg-surface-2',
    ghost: 'text-ink hover:bg-surface-2',
};

const sizes: Record<Size, string> = {
    md: 'h-10 px-4 text-base',
    sm: 'h-8 px-3 text-sm',
};

export function buttonClass(variant: Variant = 'secondary', size: Size = 'md', className?: string): string {
    return cn(base, variants[variant], sizes[size], className);
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: Variant;
    size?: Size;
    /** Shows a spinner in place of the icon and disables the button. */
    loading?: boolean;
    icon?: ReactNode;
}

export function Button({ variant = 'secondary', size = 'md', loading = false, icon, className, children, disabled, type = 'button', ...rest }: ButtonProps) {
    return (
        <button type={type} className={buttonClass(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
            {children}
        </button>
    );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    /** Required: icon-only buttons need an accessible name. Also shown as a tooltip. */
    label: string;
    size?: Size;
    children: ReactNode;
}

export function IconButton({ label, size = 'md', className, children, type = 'button', ...rest }: IconButtonProps) {
    return (
        <button
            type={type}
            aria-label={label}
            title={label}
            className={cn(
                'inline-flex shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-60',
                size === 'md' ? 'h-10 w-10' : 'h-8 w-8',
                className
            )}
            {...rest}
        >
            {children}
        </button>
    );
}
