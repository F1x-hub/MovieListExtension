import { activityLevel, computeDailyActivity } from './ProfileInsights.js';

// Narrow columns show the latest weeks only, so cells keep a readable size (profile.css).
const MEDIUM_WEEKS = 27;
const NARROW_WEEKS = 18;
// A month label needs about three columns before the next one starts.
const MIN_LABEL_WEEKS = 3;

/**
 * «Ratings by day»: a year of ratings as a calendar grid, with the ratings of the
 * chosen day listed under it. The grid is one tab stop; arrows move by day and
 * week, Page Up/Down by four weeks, Home/End to its ends. Cells are smaller than
 * a comfortable pointer target, so the previous/next buttons reach every day
 * with ratings too.
 */
export class ProfileActivityCalendar {
    constructor({ container, t, tn, locale, escape, titleOf, movieUrl }) {
        Object.assign(this, { container, t, tn, locale, escape, titleOf, movieUrl });
        this.selected = -1;
    }

    render(ratings) {
        const activity = computeDailyActivity(ratings);
        const header = summary => `
            <div class="profile-section__header profile-section__header--text">
                <h2 class="section-title">${this.escape(this.t('activity_title'))}</h2>
                ${summary ? `<p class="dashboard-section-subtitle">${this.escape(summary)}</p>` : ''}
            </div>`;
        if (!activity.total) {
            this.container.innerHTML = `${header('')}<p class="taste-empty">${this.escape(this.t('activity_empty'))}</p>`;
            return;
        }
        this.weeks = activity.weeks.length;
        this.days = activity.weeks.flat();
        // Days after today close the last week; everything before them is a real day.
        this.lastIndex = this.days.findLastIndex(Boolean);
        this.longDate = new Intl.DateTimeFormat(this.locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        this.shortDate = new Intl.DateTimeFormat(this.locale, { day: 'numeric', month: 'long' });

        const summary = [
            this.tn('activity_year', activity.total),
            this.tn('activity_days', activity.activeDays),
            activity.bestStreak > 1 ? this.tn('activity_streak', activity.bestStreak) : ''
        ].filter(Boolean).join(', ');
        const legend = ['0', '1', '2', '3–4', this.t('activity_level_max')].map((label, level) => `
            <span><i class="activity-cell" data-level="${level}"></i>${this.escape(label)}</span>`).join('');
        const chevron = points => `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="${points}"></polyline></svg>`;

        this.container.innerHTML = `
            ${header(summary)}
            <div class="activity-calendar" style="--weeks: ${this.weeks}">
                <div class="activity-calendar__body">
                    <div class="activity-calendar__months" aria-hidden="true">${this.monthLabels(activity.weeks)}</div>
                    <div class="activity-calendar__weekdays" aria-hidden="true">${this.weekdayLabels()}</div>
                    <div class="activity-calendar__grid" role="grid" aria-label="${this.escape(this.t('activity_grid_label'))}">${this.rows()}</div>
                </div>
            </div>
            <div class="activity-legend">
                <span>${this.escape(this.t('activity_legend'))}</span>${legend}
            </div>
            <div class="activity-day">
                <div class="activity-day__info">
                    <strong class="activity-day__date"></strong>
                    <span class="activity-day__count" aria-live="polite"></span>
                    <div class="activity-day__nav">
                        <button type="button" class="activity-day__button" data-step="-1" aria-label="${this.escape(this.t('activity_previous'))}">${chevron('15 18 9 12 15 6')}</button>
                        <button type="button" class="activity-day__button" data-step="1" aria-label="${this.escape(this.t('activity_next'))}">${chevron('9 18 15 12 9 6')}</button>
                    </div>
                </div>
                <ul class="activity-day__list"></ul>
            </div>
            <div class="activity-tooltip" popover="manual" aria-hidden="true"></div>`;
        this.grid = this.container.querySelector('.activity-calendar__grid');
        this.tooltip = this.container.querySelector('.activity-tooltip');
        this.cells = [];
        this.grid.querySelectorAll('[data-day]').forEach(cell => { this.cells[Number(cell.dataset.day)] = cell; });
        this.bind();
        this.select(this.days.findLastIndex(day => day?.count));
    }

    // ---- Markup -----------------------------------------------------------------

    weekClass(week) {
        const fromEnd = this.weeks - week;
        if (fromEnd > MEDIUM_WEEKS) return ' is-older';
        return fromEnd > NARROW_WEEKS ? ' is-old' : '';
    }

    monthLabels(weeks) {
        const name = new Intl.DateTimeFormat(this.locale, { month: 'short' });
        const month = index => weeks[index][0].date.getMonth();
        const starts = weeks.map((_, index) => index).filter(index => !index || month(index) !== month(index - 1));
        return weeks.map((days, index) => {
            const position = starts.indexOf(index);
            const room = position < 0 ? 0 : (starts[position + 1] ?? weeks.length) - index;
            const label = room >= MIN_LABEL_WEEKS ? name.format(days[0].date).replace('.', '') : '';
            return `<span class="activity-calendar__month${this.weekClass(index)}">${this.escape(label)}</span>`;
        }).join('');
    }

    weekdayLabels() {
        const name = new Intl.DateTimeFormat(this.locale, { weekday: 'short' });
        // 1 January 2024 was a Monday.
        return [0, 1, 2, 3, 4, 5, 6].map(day => `<span>${day % 2 ? '' : this.escape(name.format(new Date(2024, 0, 1 + day)))}</span>`).join('');
    }

    /** Rows are weekdays and columns are weeks, so the reading order matches the grid. */
    rows() {
        return [0, 1, 2, 3, 4, 5, 6].map(weekday => {
            const cells = Array.from({ length: this.weeks }, (_, week) => {
                const index = week * 7 + weekday;
                const day = this.days[index];
                if (!day) return `<span class="activity-cell activity-cell--future${this.weekClass(week)}" aria-hidden="true"></span>`;
                return `<div role="gridcell" class="activity-cell${this.weekClass(week)}" data-day="${index}" data-level="${activityLevel(day.count)}" tabindex="-1" aria-selected="false" aria-label="${this.escape(`${this.longDate.format(day.date)}: ${this.countLabel(day)}`)}"></div>`;
            }).join('');
            return `<div role="row" class="activity-calendar__row">${cells}</div>`;
        }).join('');
    }

    countLabel(day) {
        return day.count ? this.tn('ratings_count', day.count) : this.t('activity_none');
    }

    // ---- The chosen day -----------------------------------------------------------

    select(index, { focus = false } = {}) {
        const cell = this.cells[index];
        if (!cell) return;
        const previous = this.cells[this.selected];
        if (previous) {
            previous.tabIndex = -1;
            previous.setAttribute('aria-selected', 'false');
        }
        this.selected = index;
        cell.tabIndex = 0;
        cell.setAttribute('aria-selected', 'true');
        if (focus) {
            cell.focus({ preventScroll: true });
            cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }

        const day = this.days[index];
        this.container.querySelector('.activity-day__date').textContent = this.longDate.format(day.date);
        this.container.querySelector('.activity-day__count').textContent = this.countLabel(day);
        this.container.querySelector('.activity-day__list').innerHTML = day.ratings.map(rating => this.ratingItem(rating)).join('');
        this.container.querySelectorAll('[data-step]').forEach(button => {
            button.disabled = this.findRated(Number(button.dataset.step)) < 0;
        });
    }

    ratingItem(rating) {
        const { title, posterUrl } = this.titleOf(rating);
        const poster = posterUrl ? `<img src="${this.escape(posterUrl)}" alt="" loading="lazy" decoding="async">` : '';
        return `
            <li>
                <a class="activity-day__film" href="${this.escape(this.movieUrl(rating.movieId))}" title="${this.escape(title)}">
                    <span class="activity-day__poster">${poster}</span>
                    <span class="activity-day__text"><b>${this.escape(title)}</b>${this.escape(this.t('activity_score', { n: Number(rating.rating) || '—' }))}</span>
                </a>
            </li>`;
    }

    isShown(index) {
        return Boolean(this.cells[index]?.checkVisibility());
    }

    /** Nearest shown day with ratings before (-1) or after (1) the chosen one; -1 when there is none. */
    findRated(step) {
        for (let index = this.selected + step; index >= 0 && index <= this.lastIndex; index += step) {
            if (this.days[index].count && this.isShown(index)) return index;
        }
        return -1;
    }

    // ---- Pointer and keyboard --------------------------------------------------------

    bind() {
        this.grid.addEventListener('pointermove', event => this.hover(this.indexAt(event)));
        this.grid.addEventListener('pointerleave', () => this.hideTooltip());
        this.grid.addEventListener('click', event => {
            const index = this.indexAt(event);
            if (index >= 0) this.select(index);
        });
        this.grid.addEventListener('keydown', event => this.handleKey(event));
        this.grid.addEventListener('focusin', event => {
            if (event.target.matches('[data-day]:focus-visible')) this.hover(Number(event.target.dataset.day));
        });
        this.grid.addEventListener('focusout', () => this.hideTooltip());
        this.container.querySelector('.activity-day__nav').addEventListener('click', event => {
            const button = event.target.closest('[data-step]');
            const index = button ? this.findRated(Number(button.dataset.step)) : -1;
            if (index >= 0) this.select(index);
            // A button that just ran out of days loses focus with its disabled state.
            if (button?.disabled) this.container.querySelector('[data-step]:not(:disabled)')?.focus();
        });
    }

    /** Day under the pointer: the gaps between cells belong to the nearest cell. */
    indexAt({ clientX, clientY }) {
        const first = this.cells.find(cell => cell?.checkVisibility());
        if (!first) return -1;
        const box = this.grid.getBoundingClientRect();
        const cell = first.getBoundingClientRect();
        const shownWeeks = this.weeks - Math.floor(Number(first.dataset.day) / 7);
        const gap = shownWeeks > 1 ? (box.width - cell.width * shownWeeks) / (shownWeeks - 1) : 0;
        const clamp = (value, max) => Math.min(max, Math.max(0, value));
        const column = clamp(Math.floor((clientX - box.left + gap / 2) / (cell.width + gap)), shownWeeks - 1);
        const row = clamp(Math.floor((clientY - box.top + gap / 2) / (cell.height + gap)), 6);
        const index = (this.weeks - shownWeeks + column) * 7 + row;
        return this.cells[index] ? index : -1;
    }

    handleKey(event) {
        if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
        if (event.key === 'Escape') {
            this.hideTooltip();
            return;
        }
        const from = this.selected;
        const sameWeek = index => Math.floor(index / 7) === Math.floor(from / 7);
        let target = -1;
        if (event.key === 'ArrowLeft') target = from - 7;
        else if (event.key === 'ArrowRight') target = from + 7;
        else if (event.key === 'ArrowUp' && sameWeek(from - 1)) target = from - 1;
        else if (event.key === 'ArrowDown' && sameWeek(from + 1)) target = from + 1;
        else if (event.key === 'PageUp') target = from - 28;
        else if (event.key === 'PageDown') target = Math.min(this.lastIndex, from + 28);
        else if (event.key === 'Home') target = this.cells.findIndex(cell => cell?.checkVisibility());
        else if (event.key === 'End') target = this.lastIndex;
        // At an edge the key keeps its native meaning, so the page still scrolls.
        if (!this.isShown(target) || target === from) return;
        event.preventDefault();
        this.select(target, { focus: true });
    }

    hover(index) {
        const cell = this.cells[index];
        if (!cell) {
            this.hideTooltip();
            return;
        }
        if (this.hovered !== cell) {
            this.hovered?.classList.remove('is-hovered');
            this.hovered = cell;
            cell.classList.add('is-hovered');
        }
        const day = this.days[index];
        const count = document.createElement('b');
        count.textContent = this.countLabel(day);
        this.tooltip.replaceChildren(count, `, ${this.shortDate.format(day.date)}`);
        if (!this.tooltip.matches(':popover-open')) this.tooltip.showPopover();
        const box = cell.getBoundingClientRect();
        const half = this.tooltip.offsetWidth / 2;
        const left = Math.min(document.documentElement.clientWidth - half - 8, Math.max(half + 8, box.left + box.width / 2));
        this.tooltip.style.left = `${left - half}px`;
        this.tooltip.style.top = `${box.top - this.tooltip.offsetHeight - 8}px`;
    }

    hideTooltip() {
        this.hovered?.classList.remove('is-hovered');
        this.hovered = null;
        if (this.tooltip?.matches(':popover-open')) this.tooltip.hidePopover();
    }
}
