"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/cn';
import { readThemePreference, setThemePreference, subscribeToTheme, type ThemePreference } from '@/lib/theme';

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
    { value: 'system', label: 'Match my system', icon: Monitor },
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
];

/** System / Light / Dark. The choice is remembered on this device and applies on every page. */
export function ThemeMenu() {
    const preference = useSyncExternalStore(subscribeToTheme, readThemePreference, () => 'system' as ThemePreference);
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const menuId = useId();
    const current = OPTIONS.find((option) => option.value === preference) ?? OPTIONS[0];
    const CurrentIcon = current.icon;

    useEffect(() => {
        if (!open) return;
        const close = (event: MouseEvent | KeyboardEvent) => {
            if (event instanceof KeyboardEvent ? event.key === 'Escape' : !ref.current?.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', close);
        document.addEventListener('keydown', close);
        return () => {
            document.removeEventListener('mousedown', close);
            document.removeEventListener('keydown', close);
        };
    }, [open]);

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                aria-label={`Theme: ${current.label}`}
                title="Theme"
                aria-haspopup="true"
                aria-expanded={open}
                aria-controls={menuId}
                onClick={() => setOpen((value) => !value)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
            >
                <CurrentIcon className="h-5 w-5" aria-hidden />
            </button>
            {open && (
                <div id={menuId} role="radiogroup" aria-label="Theme" className="absolute right-0 top-full z-50 mt-2 w-52 rounded-lg border border-rule bg-surface p-1 shadow-lg">
                    {OPTIONS.map((option) => {
                        const Icon = option.icon;
                        const selected = option.value === preference;
                        return (
                            <button
                                key={option.value}
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                onClick={() => {
                                    setThemePreference(option.value);
                                    setOpen(false);
                                }}
                                className={cn(
                                    'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-base transition-colors hover:bg-surface-2',
                                    selected ? 'font-medium text-ink' : 'text-ink-muted'
                                )}
                            >
                                <Icon className="h-4 w-4" aria-hidden />
                                <span className="flex-1">{option.label}</span>
                                {selected && <Check className="h-4 w-4 text-accent" aria-hidden />}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
