import { i18n } from '../../shared/i18n/I18n.js';
import { fetchCalendarEpisodes, readCalendarSnapshot } from '../../shared/services/CalendarService.js';
import { escapeHtml, renderMonths, renderEmptyState, renderSignedOutState, renderErrorState } from './CalendarView.js';

const PROGRESS_RENDER_INTERVAL_MS = 400;
const AUTH_READY_TIMEOUT_MS = 10000;

function ensureNavigationState() {
    if (window.navigation && typeof window.navigation.updateActivePage === 'function') {
        window.navigation.updateActivePage('calendar');
        return;
    }

    if (typeof Navigation !== 'undefined') {
        window.navigation = new Navigation('calendar');
    }
}

function translateStaticPage() {
    i18n.translatePage();
    document.title = i18n.get('calendar.page_title');
}

function createCalendarView(content, totalBadge) {
    let rendered = false;
    let openMonths = null;
    // What is on screen, so a language change can paint it again.
    let lastPaint = null;

    // Toggle months through one delegated listener so re-renders need no re-binding.
    content.addEventListener('click', (event) => {
        const header = event.target.closest('.calendar-month-header');
        if (!header || !content.contains(header)) return;
        const body = header.nextElementSibling;
        const isOpen = header.classList.toggle('open');
        body.classList.toggle('open', isOpen);
        header.setAttribute('aria-expanded', String(isOpen));
        body.inert = !isOpen;
    });

    const rememberOpenMonths = () => {
        if (!rendered) return;
        openMonths = new Set([...content.querySelectorAll('.calendar-month-header.open')]
            .map(header => header.closest('.calendar-month')?.dataset.month)
            .filter(Boolean));
    };

    const paint = (state) => {
        lastPaint = state;
        if (state.kind === 'signed-out') {
            content.innerHTML = renderSignedOutState();
            totalBadge.textContent = '';
            content.setAttribute('aria-busy', 'false');
        } else if (state.kind === 'error') {
            content.innerHTML = renderErrorState();
            content.setAttribute('aria-busy', 'false');
        } else if (!state.data.total) {
            content.innerHTML = renderEmptyState();
            totalBadge.textContent = '';
            content.setAttribute('aria-busy', 'false');
        } else {
            rememberOpenMonths();
            content.innerHTML = renderMonths(state.data.grouped, { openMonths });
            totalBadge.textContent = state.data.total;
            content.setAttribute('aria-busy', String(!state.final));
        }
        rendered = true;
    };

    return {
        get hasContent() { return rendered; },
        render(data, { final = false } = {}) {
            if (!data.total && !final) return;
            paint({ kind: 'data', data, final });
        },
        signedOut() {
            openMonths = null;
            paint({ kind: 'signed-out' });
        },
        error() {
            if (rendered) return; // keep what is already shown
            paint({ kind: 'error' });
        },
        /** Back to the loading skeleton, for another account's data. */
        reset() {
            rendered = false;
            openMonths = null;
            lastPaint = null;
            totalBadge.textContent = '';
            content.setAttribute('aria-busy', 'true');
            content.innerHTML = `
                <div class="calendar-loading" role="status" aria-label="${escapeHtml(i18n.get('calendar.loading_label'))}">
                    <div class="skeleton-month"></div>
                    <div class="skeleton-month"></div>
                    <div class="skeleton-month"></div>
                </div>`;
        },
        repaint() {
            if (lastPaint) paint(lastPaint);
        }
    };
}

async function init() {
    ensureNavigationState();

    // The language is known before anything is painted.
    await i18n.init();
    translateStaticPage();

    const content = document.getElementById('calendarContent');
    const totalBadge = document.getElementById('calendarTotal');
    const view = createCalendarView(content, totalBadge);
    const manager = window.firebaseManager || null;

    // Each load belongs to one account; a load that an auth change overtook paints nothing.
    let generation = 0;
    let shownUserId;

    const load = async (userId) => {
        const current = ++generation;
        shownUserId = userId;
        if (!userId) {
            view.signedOut();
            return;
        }
        const isCurrent = () => current === generation;

        // 1. Instant paint from the last result while fresh data loads.
        const snapshot = await readCalendarSnapshot({ userId }).catch(() => null);
        if (!isCurrent()) return;
        if (snapshot?.total) view.render(snapshot);

        // 2. Fresh data, painted progressively as titles resolve.
        let lastProgressPaint = 0;
        try {
            const result = await fetchCalendarEpisodes({
                userId,
                onProgress: (partial) => {
                    if (!isCurrent() || snapshot?.total) return; // the snapshot already fills the page; avoid flicker
                    const now = Date.now();
                    if (now - lastProgressPaint < PROGRESS_RENDER_INTERVAL_MS) return;
                    lastProgressPaint = now;
                    view.render(partial);
                }
            });
            if (isCurrent()) view.render(result, { final: true });
        } catch (error) {
            console.error('[Calendar]', error);
            if (isCurrent()) view.error();
        }
    };

    // Signing in or out in another tab reaches this page as authStateChanged.
    window.addEventListener('authStateChanged', (event) => {
        const userId = event.detail?.user?.uid || null;
        if (userId === shownUserId) return;
        view.reset();
        load(userId);
    });

    chrome.runtime?.onMessage?.addListener?.((message) => {
        if (message?.type !== 'SETTINGS_UPDATED' || !message.settings?.language) return;
        i18n.init().then(() => {
            translateStaticPage();
            view.repaint();
        });
    });

    // An unresolved auth state is not a guest session: keep the skeleton until Firebase answers.
    if (manager) {
        await manager.waitForAuthReady?.(AUTH_READY_TIMEOUT_MS);
        const userId = manager.getCurrentUser?.()?.uid || null;
        if (!userId && !manager.isAuthReady) return; // authStateChanged will start the load
        if (shownUserId === undefined) load(userId);
        return;
    }
    // A page without Firebase cannot tell who is signed in; the service falls back to the stored account.
    load(await readStoredUserId());
}

async function readStoredUserId() {
    try {
        const result = await chrome.storage.local.get(['user']);
        return result.user?.uid || null;
    } catch {
        return null;
    }
}

document.addEventListener('DOMContentLoaded', init);
