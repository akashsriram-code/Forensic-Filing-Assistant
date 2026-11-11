"use client";

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { IconButton } from './Button';

/**
 * Modal dialog on the native <dialog> element: focus is trapped, Esc closes, focus returns to the opener, and the
 * page behind is inert. Rendered in the top layer, so no ancestor (sticky or blurred header) can clip it.
 */
export function Dialog({
    open,
    onClose,
    title,
    description,
    children,
    footer,
    size = 'md',
}: {
    open: boolean;
    onClose: () => void;
    title: ReactNode;
    description?: ReactNode;
    children: ReactNode;
    footer?: ReactNode;
    size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
    const ref = useRef<HTMLDialogElement>(null);
    const titleId = useId();
    const descriptionId = useId();

    useEffect(() => {
        const dialog = ref.current;
        if (!dialog) return;
        if (open && !dialog.open) dialog.showModal();
        if (!open && dialog.open) dialog.close();
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const previous = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = previous;
        };
    }, [open]);

    return (
        <dialog
            ref={ref}
            aria-labelledby={titleId}
            aria-describedby={description ? descriptionId : undefined}
            onClose={onClose}
            onCancel={(event) => {
                event.preventDefault();
                onClose();
            }}
            onClick={(event) => {
                // A click on the backdrop lands on the <dialog> element itself.
                if (event.target === event.currentTarget) onClose();
            }}
            className={cn(
                'm-auto max-h-[min(88vh,900px)] w-[calc(100%-2rem)] overflow-hidden rounded-lg border border-rule bg-surface p-0 text-ink shadow-2xl',
                size === 'sm' && 'max-w-md',
                size === 'md' && 'max-w-2xl',
                size === 'lg' && 'max-w-4xl',
                size === 'xl' && 'max-w-6xl'
            )}
        >
            {open && (
                <div className="flex max-h-[min(88vh,900px)] flex-col">
                    <div className="flex items-start justify-between gap-4 border-b border-rule px-5 py-4">
                        <div className="min-w-0">
                            <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
                            {description && <p id={descriptionId} className="mt-1 text-sm text-ink-muted">{description}</p>}
                        </div>
                        <IconButton label="Close" size="sm" onClick={onClose} className="-mr-1">
                            <X className="h-4 w-4" aria-hidden />
                        </IconButton>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
                    {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-rule px-5 py-3">{footer}</div>}
                </div>
            )}
        </dialog>
    );
}
