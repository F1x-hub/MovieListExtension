import { fetchCalendarEpisodes, readCalendarSnapshot } from '../../shared/services/CalendarService.js';
import { renderMonths, renderEmptyState, renderErrorState } from './CalendarView.js';

const PROGRESS_RENDER_INTERVAL_MS = 400;

function ensureNavigationState() {
    if (window.navigation && typeof window.navigation.updateActivePage === 'function') {
        window.navigation.updateActivePage('calendar');
        return;
    }

    if (typeof Navigation !== 'undefined') {
        window.navigation = new Navigation('calendar');
    }
}

function createCalendarView(content, totalBadge) {
    let rendered = false;
    let openMonths = null;

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

    return {
        get hasContent() { return rendered; },
        render({ grouped, total }, { final = false } = {}) {
            if (!total) {
                if (!final) return;
                content.innerHTML = renderEmptyState();
                totalBadge.textContent = '';
                rendered = true;
                return;
            }
            rememberOpenMonths();
            content.innerHTML = renderMonths(grouped, { openMonths });
            totalBadge.textContent = total;
            content.setAttribute('aria-busy', String(!final));
            rendered = true;
        },
        error(message) {
            if (rendered) return; // keep what is already shown
            content.innerHTML = renderErrorState(message);
        }
    };
}

async function init() {
    ensureNavigationState();

    const content = document.getElementById('calendarContent');
    const totalBadge = document.getElementById('calendarTotal');
    const view = createCalendarView(content, totalBadge);

    // 1. Instant paint from the last result while fresh data loads.
    const snapshot = await readCalendarSnapshot().catch(() => null);
    if (snapshot?.total) view.render(snapshot);

    // 2. Fresh data, painted progressively as titles resolve.
    let lastPaint = 0;
    try {
        const result = await fetchCalendarEpisodes({
            onProgress: (partial) => {
                if (snapshot?.total) return; // the snapshot already fills the page; avoid flicker
                const now = Date.now();
                if (now - lastPaint < PROGRESS_RENDER_INTERVAL_MS) return;
                lastPaint = now;
                view.render(partial);
            }
        });
        view.render(result, { final: true });
    } catch (error) {
        console.error('[Calendar]', error);
        view.error(error.message || 'Не удалось получить данные');
    }
}

document.addEventListener('DOMContentLoaded', init);
