import { fetchCalendarEpisodes } from '../../shared/services/CalendarService.js';

const DAYS_RU = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

function escapeHtml(value = '') {
    const div = document.createElement('div');
    div.textContent = value;
    return div.innerHTML;
}

function getDaysUntil(dateString) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const target = new Date(dateString);
    target.setHours(0, 0, 0, 0);

    return Math.round((target - today) / 86400000);
}

function formatCountdown(days) {
    if (days === 0) {
        return { text: 'Сегодня', isToday: true };
    }

    if (days === 1) {
        return { text: '1 день', isToday: false };
    }

    if (days >= 2 && days <= 4) {
        return { text: `${days} дня`, isToday: false };
    }

    return { text: `${days} дней`, isToday: false };
}

function renderChevron() {
    return `<svg class="calendar-month-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="6 9 12 15 18 9"></polyline>
    </svg>`;
}

function renderMonth(monthKey, dayGroups, isFirstMonth) {
    const [monthName, year] = monthKey.split('__');
    const totalEpisodes = Object.values(dayGroups).reduce((sum, episodes) => sum + episodes.length, 0);
    const isOpen = isFirstMonth;

    const daysHtml = Object.entries(dayGroups).map(([dateString, episodes]) => {
        const date = new Date(dateString);
        const dayNumber = String(date.getDate()).padStart(2, '0');
        const dayWeek = DAYS_RU[date.getDay()];
        const isToday = getDaysUntil(dateString) === 0;

        const episodeRows = episodes.map((episode) => {
            const { text, isToday: countdownToday } = formatCountdown(getDaysUntil(dateString));
            const episodeLabel = episode.isMovie 
                ? 'Премьера фильма'
                : `${episode.season} x ${String(episode.episode).padStart(2, '0')}${episode.episodeName ? ` - ${episode.episodeName}` : ''}`;

            return `
                <div class="calendar-episode-row${episode.isMovie ? ' movie-premiere' : ''}">
                    <div class="calendar-episode-info">
                        <span class="calendar-show-name" data-kinoid="${episode.kinoId || ''}">${escapeHtml(episode.showName)}</span>
                        <div class="calendar-ep-label">${escapeHtml(episodeLabel)}</div>
                    </div>
                    <div class="calendar-countdown${countdownToday ? ' today-badge' : ''}">${text}</div>
                </div>
            `;
        }).join('');

        return `
            <div class="calendar-day-group">
                <div class="calendar-day-label">
                    <span class="calendar-day-num${isToday ? ' today' : ''}">${dayNumber}</span>
                    <span class="calendar-day-week">${dayWeek}</span>
                </div>
                <div class="calendar-day-episodes">${episodeRows}</div>
            </div>
        `;
    }).join('');

    return `
        <section class="calendar-month">
            <button class="calendar-month-header${isOpen ? ' open' : ''}" type="button">
                <span class="calendar-month-name">
                    ${year ? `${monthName} ${year}` : monthName}
                    <span class="calendar-month-count">${totalEpisodes}</span>
                </span>
                ${renderChevron()}
            </button>
            <div class="calendar-month-body${isOpen ? ' open' : ''}">
                ${daysHtml}
            </div>
        </section>
    `;
}

function renderEmptyState() {
    return `
        <div class="calendar-empty">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="3" y="4" width="18" height="18" rx="2"></rect>
                <line x1="16" y1="2" x2="16" y2="6"></line>
                <line x1="8" y1="2" x2="8" y2="6"></line>
                <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
            <strong>Нет предстоящих дат</strong>
            <span>Добавьте фильмы или сериалы в списки «Смотрю» или «Буду смотреть», и они появятся здесь автоматически.</span>
        </div>
    `;
}

function renderErrorState(message) {
    return `
        <div class="calendar-error">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                <line x1="12" y1="9" x2="12" y2="13"></line>
                <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
            <strong>Ошибка загрузки календаря</strong>
            <span>${escapeHtml(message)}</span>
        </div>
    `;
}

function bindInteractions(container) {
    container.querySelectorAll('.calendar-month-header').forEach((header) => {
        header.addEventListener('mousedown', () => {
            const body = header.nextElementSibling;
            const isOpen = header.classList.toggle('open');
            body.classList.toggle('open', isOpen);
        });
    });

    container.querySelectorAll('.calendar-show-name').forEach((element) => {
        element.addEventListener('mousedown', (event) => {
            event.preventDefault();

            const kinoId = element.dataset.kinoid;
            if (!kinoId) {
                return;
            }

            window.location.href = chrome.runtime.getURL(`src/pages/movie-details/movie-details.html?movieId=${encodeURIComponent(kinoId)}`);
        });
    });
}

function ensureNavigationState() {
    if (window.navigation && typeof window.navigation.updateActivePage === 'function') {
        window.navigation.updateActivePage('calendar');
        return;
    }

    if (typeof Navigation !== 'undefined') {
        window.navigation = new Navigation('calendar');
    }
}

async function init() {
    ensureNavigationState();

    const content = document.getElementById('calendarContent');
    const loading = document.getElementById('calendarLoading');
    const totalBadge = document.getElementById('calendarTotal');

    try {
        const { grouped, total } = await fetchCalendarEpisodes();

        if (loading) {
            loading.remove();
        }

        if (!total) {
            content.innerHTML = renderEmptyState();
            return;
        }

        totalBadge.textContent = total;

        const html = Object.entries(grouped)
            .map(([monthKey, dayGroups], index) => renderMonth(monthKey, dayGroups, index === 0))
            .join('');

        content.innerHTML = html;
        bindInteractions(content);
    } catch (error) {
        console.error('[Calendar]', error);

        if (loading) {
            loading.innerHTML = renderErrorState(error.message || 'Не удалось получить данные');
        } else {
            content.innerHTML = renderErrorState(error.message || 'Не удалось получить данные');
        }
    }
}

document.addEventListener('DOMContentLoaded', init);
