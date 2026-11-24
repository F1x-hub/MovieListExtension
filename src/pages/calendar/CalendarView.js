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
    return `<svg data-icon="CHEVRON_DOWN" class="calendar-month-chevron" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 7.5L10 12.5L15 7.5"/></svg>`;
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
    return `<svg data-icon="CALENDAR" aria-hidden="true" width="40" height="40" viewBox="0 0 20 20" fill="none"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M5 3H15A3 3 0 0 1 18 6V8H2V6A3 3 0 0 1 5 3Z"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M5 1H7V4H5ZM13 1H15V4H13Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8V15A2 2 0 0 0 5 17H15A2 2 0 0 0 17 15V8"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M11.75 11H13.25A0.75 0.75 0 0 1 14 11.75V13.25A0.75 0.75 0 0 1 13.25 14H11.75A0.75 0.75 0 0 1 11 13.25V11.75A0.75 0.75 0 0 1 11.75 11Z"/></svg>`;
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
            <svg data-icon="WARNING" aria-hidden="true" width="40" height="40" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 3.2L17.4 16H2.6Z"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M10 3.2L17.4 16H2.6ZM10 7H10A1 1 0 0 1 11 8V10.6A1 1 0 0 1 10 11.6H10A1 1 0 0 1 9 10.6V8A1 1 0 0 1 10 7ZM10 12.45A1.15 1.15 0 1 0 10 14.75A1.15 1.15 0 1 0 10 12.45Z"/></svg>
            <strong>${escapeHtml(t('error_title'))}</strong>
            <span>${escapeHtml(message || t('error_fallback'))}</span>
        </div>
    `;
}
