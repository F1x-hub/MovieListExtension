// Pure rendering for the calendar page (no data loading), so it can be reused and checked in isolation.

const DAYS_RU = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

export function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** "YYYY-MM-DD" as a local calendar date (new Date("YYYY-MM-DD") is UTC midnight). */
export function parseLocalDate(dateString) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateString || ''));
    if (!match) return new Date(dateString);
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function getDaysUntil(dateString, now = new Date()) {
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const target = parseLocalDate(dateString);
    target.setHours(0, 0, 0, 0);
    return Math.round((target - today) / 86400000);
}

function pluralDays(days) {
    const mod10 = days % 10;
    const mod100 = days % 100;
    if (mod10 === 1 && mod100 !== 11) return 'день';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'дня';
    return 'дней';
}

export function formatCountdown(days) {
    if (days === 0) return { text: 'Сегодня', isToday: true };
    if (days === 1) return { text: 'Завтра', isToday: false };
    return { text: `через ${days} ${pluralDays(days)}`, isToday: false };
}

function renderChevron() {
    return `<svg class="calendar-month-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polyline points="6 9 12 15 18 9"></polyline>
    </svg>`;
}

function renderEpisode(episode, dateString, now) {
    const { text, isToday } = formatCountdown(getDaysUntil(dateString, now));
    const label = episode.isMovie
        ? 'Премьера фильма'
        : `${episode.season} × ${String(episode.episode).padStart(2, '0')}${episode.episodeName ? ` · ${episode.episodeName}` : ''}`;
    const href = episode.kinoId
        ? `../movie-details/movie-details.html?movieId=${encodeURIComponent(episode.kinoId)}`
        : (episode.tmdbId ? `../movie-details/movie-details.html?tmdbId=${encodeURIComponent(episode.tmdbId)}&source=calendar` : '');

    return `
        <div class="calendar-episode-row${episode.isMovie ? ' movie-premiere' : ''}">
            <div class="calendar-episode-info">
                ${href
                    ? `<a class="calendar-show-name" href="${escapeHtml(href)}">${escapeHtml(episode.showName)}</a>`
                    : `<span class="calendar-show-name">${escapeHtml(episode.showName)}</span>`}
                <div class="calendar-ep-label">${escapeHtml(label)}</div>
            </div>
            <div class="calendar-countdown${isToday ? ' today-badge' : ''}">${escapeHtml(text)}</div>
        </div>
    `;
}

export function renderMonth(monthKey, dayGroups, isOpen, now = new Date()) {
    const [monthName, year] = monthKey.split('__');
    const totalEpisodes = Object.values(dayGroups).reduce((sum, episodes) => sum + episodes.length, 0);

    const daysHtml = Object.entries(dayGroups).map(([dateString, episodes]) => {
        const date = parseLocalDate(dateString);
        const isToday = getDaysUntil(dateString, now) === 0;
        return `
            <div class="calendar-day-group">
                <div class="calendar-day-label">
                    <span class="calendar-day-num${isToday ? ' today' : ''}">${String(date.getDate()).padStart(2, '0')}</span>
                    <span class="calendar-day-week">${DAYS_RU[date.getDay()]}</span>
                </div>
                <div class="calendar-day-episodes">${episodes.map(episode => renderEpisode(episode, dateString, now)).join('')}</div>
            </div>
        `;
    }).join('');

    return `
        <section class="calendar-month" data-month="${escapeHtml(monthKey)}">
            <button class="calendar-month-header${isOpen ? ' open' : ''}" type="button" aria-expanded="${isOpen}">
                <span class="calendar-month-name">
                    ${escapeHtml(year ? `${monthName} ${year}` : monthName)}
                    <span class="calendar-month-count">${totalEpisodes}</span>
                </span>
                ${renderChevron()}
            </button>
            <div class="calendar-month-body${isOpen ? ' open' : ''}"${isOpen ? '' : ' inert'}>
                <div class="calendar-month-content">${daysHtml}</div>
            </div>
        </section>
    `;
}

/** Months in order; the first one (or any the user opened) is expanded. */
export function renderMonths(grouped, { openMonths = null, now = new Date() } = {}) {
    return Object.entries(grouped)
        .map(([monthKey, dayGroups], index) => renderMonth(
            monthKey,
            dayGroups,
            openMonths ? openMonths.has(monthKey) : index === 0,
            now
        ))
        .join('');
}

export function renderEmptyState() {
    return `
        <div class="calendar-empty">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
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

export function renderErrorState(message) {
    return `
        <div class="calendar-error">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                <line x1="12" y1="9" x2="12" y2="13"></line>
                <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
            <strong>Ошибка загрузки календаря</strong>
            <span>${escapeHtml(message)}</span>
        </div>
    `;
}
