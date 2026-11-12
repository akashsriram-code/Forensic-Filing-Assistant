/** Toolbar popup: whether alerts are live, when EDGAR was last checked, and the latest alerts. */
import { formDisplay, lagText, shortCompanyName, shortTime } from './core/copy';
import type { Alert, LiveStatus } from './core/types';

const STATE_LABELS: Record<LiveStatus['state'], string> = {
    live: '● Live',
    offhours: '◐ Off-hours',
    paused: '⏸ Paused',
    setup: '⚠ Setup needed',
    idle: '○ Idle',
    error: '⚠ Reconnecting',
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function renderStatus(status: LiveStatus | undefined): void {
    const state = $('state');
    if (!status) {
        state.textContent = 'Starting…';
        return;
    }
    state.textContent = STATE_LABELS[status.state];
    state.className = `state ${status.state}`;
    const parts: string[] = [];
    if (status.lastPollAt) {
        const ago = Math.max(0, Date.now() - status.lastPollAt);
        parts.push(`Checked ${ago < 1000 ? `${(ago / 1000).toFixed(1)}s` : lagText(ago)} ago`);
    }
    if (status.lastLatencyMs != null) parts.push(`SEC replied in ${status.lastLatencyMs} ms`);
    parts.push(`${status.followCount} follow${status.followCount === 1 ? '' : 's'}`);
    $('checked').textContent = parts.join(' · ');
    $('message').textContent = status.message;
    const unresolved = $('unresolved');
    unresolved.hidden = status.unresolved.length === 0;
    unresolved.textContent = `Couldn't find SEC records for ${status.unresolved.join(', ')}. Follow these by company page instead.`;
}

function renderAlerts(alerts: Alert[] | undefined): void {
    const list = $('alerts');
    const items = (alerts ?? []).slice(0, 20);
    list.replaceChildren(
        ...items.map((alert) => {
            const li = document.createElement('li');
            if (!alert.read) li.className = 'unread';
            const button = document.createElement('button');
            button.type = 'button';
            button.title = 'Open in SCOUT Reader. The right-hand time is how long after the SEC accepted the filing the alert arrived.';
            const time = document.createElement('span');
            time.className = 'muted tabular';
            time.textContent = shortTime(alert.acceptedAt);
            const what = document.createElement('span');
            what.className = 'what';
            what.textContent = `${shortCompanyName(alert.company)} · ${formDisplay(alert.form)}`;
            const lag = document.createElement('span');
            lag.className = 'muted tabular';
            lag.textContent = `${lagText(Math.max(0, alert.caughtAt - alert.acceptedAt))} ↗`;
            button.append(time, what, lag);
            button.addEventListener('click', () => void chrome.runtime.sendMessage({ type: 'open', id: alert.id }));
            li.append(button);
            return li;
        }),
    );
    $('empty').hidden = items.length > 0;
}

async function refresh(): Promise<void> {
    const [{ status }, { alerts }] = await Promise.all([chrome.storage.session.get('status'), chrome.storage.local.get('alerts')]);
    renderStatus(status as LiveStatus | undefined);
    renderAlerts(alerts as Alert[] | undefined);
}

$('options').addEventListener('click', () => void chrome.runtime.openOptionsPage());
$('read').addEventListener('click', () => void chrome.runtime.sendMessage({ type: 'markAllRead' }));
chrome.storage.onChanged.addListener(() => void refresh());
// Keep "Checked 0.4s ago" ticking while the popup is open.
setInterval(() => void refresh(), 500);
void refresh();
