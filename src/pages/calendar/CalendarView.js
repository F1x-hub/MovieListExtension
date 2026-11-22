// Pure rendering for the calendar page (no data loading), so it can be reused and checked in isolation.
import { i18n } from '../../shared/i18n/I18n.js';

const DATE_LOCALES = { ru: 'ru-RU', en: 'en-US' };

function t(key) {
    return i18n.get(`calendar.${key}`);
}

function dateLocale() {
    return DATE_LOCALES[i18n.currentLocale] || i18n.currentLocale || 'en-US';
}

function capitalize(value) {
    return value ? value.charAt(0).toLocaleUpperCase(dateLocale()) + value.slice(1) : value;
}

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

export function formatCountdown(days) {
    if (days === 0) return { text: t('today'), isToday: true };
    if (days === 1) return { text: t('tomorrow'), isToday: false };
    // Intl picks the plural category (one / few / many / other) for the reader's language.
    const category = new Intl.PluralRules(dateLocale()).select(days);
    const template = i18n.get(`calendar.in_days_${category}`);
    const text = (template.startsWith('calendar.') ? t('in_days_other') : template).replace('{n}', days);
    return { text, isToday: false };
}

/** "YYYY-MM" month key as "January 2027", the month name in the page language. */
export function formatMonthTitle(monthKey) {
    const match = /^(\d{4})-(\d{2})$/.exec(String(monthKey || ''));
    if (!match) return String(monthKey || '');
    const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
    const month = new Intl.DateTimeFormat(dateLocale(), { month: 'long' }).format(date);
    return `${capitalize(month)} ${match[1]}`;
}

function formatWeekday(date) {
    return new Intl.DateTimeFormat(dateLocale(), { weekday: 'short' }).format(date);
}

function renderChevron() {
    return `<svg class="calendar-month-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polyline points="6 9 12 15 18 9"></polyline>
    </svg>`;
}

function renderEpisode(episode, dateString, now) {
    const { text, isToday } = formatCountdown(getDaysUntil(dateString, now));
    const label = episode.isMovie
        ? t('movie_premiere')
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
    const totalEpisodes = Object.values(dayGroups).reduce((sum, episodes) => sum + episodes.length, 0);

    const daysHtml = Object.entries(dayGroups).map(([dateString, episodes]) => {
        const date = parseLocalDate(dateString);
        const isToday = getDaysUntil(dateString, now) === 0;
        return `
            <div class="calendar-day-group">
                <div class="calendar-day-label">
                    <span class="calendar-day-num${isToday ? ' today' : ''}">${String(date.getDate()).padStart(2, '0')}</span>
                    <span class="calendar-day-week">${escapeHtml(formatWeekday(date))}</span>
                </div>
                <div class="calendar-day-episodes">${episodes.map(episode => renderEpisode(episode, dateString, now)).join('')}</div>
            </div>
        `;
    }).join('');

    return `
        <section class="calendar-month" data-month="${escapeHtml(monthKey)}">
            <button class="calendar-month-header${isOpen ? ' open' : ''}" type="button" aria-expanded="${isOpen}">
                <span class="calendar-month-name">
                    ${escapeHtml(formatMonthTitle(monthKey))}
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

function renderCalendarIcon() {
    return `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                <rect x="3" y="4" width="18" height="18" rx="2"></rect>
                <line x1="16" y1="2" x2="16" y2="6"></line>
                <line x1="8" y1="2" x2="8" y2="6"></line>
                <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>`;
}

export function renderEmptyState() {
    return `
        <div class="calendar-empty">
            ${renderCalendarIcon()}
            <strong>${escapeHtml(t('empty_title'))}</strong>
            <span>${escapeHtml(t('empty_message'))}</span>
        </div>
    `;
}

/** A signed-out visitor has no lists, so the page asks to sign in instead of saying the lists are empty. */
export function renderSignedOutState() {
    return `
        <div class="calendar-empty calendar-signed-out">
            ${renderCalendarIcon()}
            <strong>${escapeHtml(t('signed_out_title'))}</strong>
            <span>${escapeHtml(t('signed_out_message'))}</span>
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
            <strong>${escapeHtml(t('error_title'))}</strong>
            <span>${escapeHtml(message || t('error_fallback'))}</span>
        </div>
    `;
}
