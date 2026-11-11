"use client";

import { useId, useState } from 'react';
import { DEFAULT_RADAR_WATCHLISTS, hydrateEditableWatchlists, type RadarWatchlist } from '@/lib/thirteen-f-radar-core';
import { plural } from '@/lib/format';
import { Button, Dialog, Textarea } from '../ui';
import { buildWatchlistText, parseEditorList } from './radar-api';

/** Edit the tickers in each watchlist category. Applying re-runs the comparison. */
export function WatchlistDialog({
    open,
    watchlists,
    onClose,
    onApply,
}: {
    open: boolean;
    watchlists: RadarWatchlist[];
    onClose: () => void;
    onApply: (next: RadarWatchlist[]) => void;
}) {
    const formId = useId();
    return (
        <Dialog
            open={open}
            onClose={onClose}
            size="lg"
            title="Watchlists"
            description="Each category is a list of stock tickers, separated by commas or new lines. Custom lists work only with the latest pair of quarters."
            footer={
                <>
                    <Button variant="ghost" onClick={onClose}>Cancel</Button>
                    <Button variant="primary" type="submit" form={formId}>Apply and update</Button>
                </>
            }
        >
            {/* Mounted only while open, so each opening starts from the lists in use rather than a stale draft. */}
            {open && <WatchlistEditor formId={formId} watchlists={watchlists} onApply={onApply} />}
        </Dialog>
    );
}

function WatchlistEditor({ formId, watchlists, onApply }: { formId: string; watchlists: RadarWatchlist[]; onApply: (next: RadarWatchlist[]) => void }) {
    const [draft, setDraft] = useState<Record<string, string>>(() => buildWatchlistText(watchlists));

    return (
        <form
            id={formId}
            onSubmit={(event) => {
                event.preventDefault();
                const editedItemsByKey = Object.fromEntries(watchlists.map((watchlist) => [watchlist.key, parseEditorList(draft[watchlist.key] || '')]));
                onApply(hydrateEditableWatchlists(DEFAULT_RADAR_WATCHLISTS, editedItemsByKey));
            }}
            className="grid grid-cols-1 gap-5 md:grid-cols-2"
        >
            {watchlists.map((watchlist) => (
                <Textarea
                    key={watchlist.key}
                    label={watchlist.label}
                    hint={`${plural(parseEditorList(draft[watchlist.key] || '').length, 'ticker')}${watchlist.description ? ` · ${watchlist.description}` : ''}`}
                    value={draft[watchlist.key] || ''}
                    onChange={(event) => setDraft((prev) => ({ ...prev, [watchlist.key]: event.target.value }))}
                    spellCheck={false}
                />
            ))}
        </form>
    );
}
