import type { ReactNode } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, CircleAlert, Info, Minus, Plus, X } from 'lucide-react';
import { cn } from '@/lib/cn';

type Tone = 'info' | 'caution' | 'error';

const toneClass: Record<Tone, string> = {
    info: 'border-rule bg-surface-2 text-ink',
    caution: 'border-caution/40 bg-caution/10 text-ink',
    error: 'border-loss/40 bg-loss/10 text-ink',
};

const toneIcon: Record<Tone, ReactNode> = {
    info: <Info className="h-4 w-4 text-ink-muted" aria-hidden />,
    caution: <AlertTriangle className="h-4 w-4 text-caution" aria-hidden />,
    error: <CircleAlert className="h-4 w-4 text-loss" aria-hidden />,
};

/**
 * Inline message. Errors say what went wrong and what to do; they are announced to screen readers.
 */
export function Notice({
    tone = 'info',
    title,
    children,
    action,
    className,
}: {
    tone?: Tone;
    title?: ReactNode;
    children?: ReactNode;
    action?: ReactNode;
    className?: string;
}) {
    return (
        <div
            role={tone === 'error' ? 'alert' : 'status'}
            className={cn('flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border px-4 py-3 text-base', toneClass[tone], className)}
        >
            <span className="mt-1">{toneIcon[tone]}</span>
            <div className="min-w-0 flex-1">
                {title && <p className="font-semibold">{title}</p>}
                {children && <div className={cn('text-ink-muted', title && 'mt-0.5')}>{children}</div>}
            </div>
            {action && <div className="shrink-0">{action}</div>}
        </div>
    );
}

/** Grey placeholder block shown while content loads. */
export function Skeleton({ className }: { className?: string }) {
    return <div className={cn('animate-pulse rounded bg-surface-2', className)} aria-hidden />;
}

/** Placeholder for a loading table or list. */
export function SkeletonRows({ rows = 6, label = 'Loading' }: { rows?: number; label?: string }) {
    return (
        <div role="status" aria-label={label} className="space-y-3 p-4">
            {Array.from({ length: rows }, (_, index) => (
                <div key={index} className="flex items-center gap-4">
                    <Skeleton className="h-4 flex-[3]" />
                    <Skeleton className="h-4 flex-1" />
                    <Skeleton className="h-4 flex-1" />
                </div>
            ))}
        </div>
    );
}

/** An empty screen is an invitation to act: say what this is for and offer a next step. */
export function EmptyState({
    icon,
    title,
    children,
    actions,
    className,
}: {
    icon?: ReactNode;
    title: ReactNode;
    children?: ReactNode;
    actions?: ReactNode;
    className?: string;
}) {
    return (
        <div className={cn('rounded-lg border border-dashed border-rule-strong px-6 py-10 text-center', className)}>
            {icon && <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-ink-muted">{icon}</div>}
            <p className="text-lg font-semibold text-ink">{title}</p>
            {children && <div className="mx-auto mt-1 max-w-xl text-base text-ink-muted">{children}</div>}
            {actions && <div className="mt-5 flex flex-wrap justify-center gap-2">{actions}</div>}
        </div>
    );
}

export type ChangeKind = 'new' | 'added' | 'cut' | 'exited' | 'unchanged';

/** Map 13F movement names (initiated / increased / decreased / liquidated) to display kinds. */
export function changeKindFromAction(action: string | null | undefined): ChangeKind {
    switch ((action || '').toLowerCase()) {
        case 'initiated':
        case 'new':
            return 'new';
        case 'increased':
        case 'added':
        case 'buy':
            return 'added';
        case 'decreased':
        case 'reduced':
        case 'sell':
            return 'cut';
        case 'liquidated':
        case 'exited':
        case 'sold out':
            return 'exited';
        default:
            return 'unchanged';
    }
}

const changeConfig: Record<ChangeKind, { label: string; icon: ReactNode; className: string }> = {
    new: { label: 'New', icon: <Plus className="h-3.5 w-3.5" aria-hidden />, className: 'bg-gain/10 text-gain' },
    added: { label: 'Added', icon: <ArrowUp className="h-3.5 w-3.5" aria-hidden />, className: 'bg-gain/10 text-gain' },
    cut: { label: 'Cut', icon: <ArrowDown className="h-3.5 w-3.5" aria-hidden />, className: 'bg-loss/10 text-loss' },
    exited: { label: 'Sold out', icon: <X className="h-3.5 w-3.5" aria-hidden />, className: 'bg-loss/10 text-loss' },
    unchanged: { label: 'No change', icon: <Minus className="h-3.5 w-3.5" aria-hidden />, className: 'bg-surface-2 text-ink-muted' },
};

/** Bought / sold badge: icon + word + color, so color is never the only signal. */
export function ChangeBadge({ kind, label }: { kind: ChangeKind; label?: string }) {
    const config = changeConfig[kind];
    return (
        <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-sm font-medium whitespace-nowrap', config.className)}>
            {config.icon}
            {label ?? config.label}
        </span>
    );
}

/** Colors a signed number: gain for positive, loss for negative, muted for zero. */
export function signedClass(value: number | null | undefined): string {
    if (!value) return 'text-ink-muted';
    return value > 0 ? 'text-gain' : 'text-loss';
}
