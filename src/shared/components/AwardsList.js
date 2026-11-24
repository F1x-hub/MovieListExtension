/**
 * AwardsList - the one look of awards and nominations: the film page's «Награды» tab
 * and the person page's «Награды» section. The data comes from AwardsParsingService.
 *
 *   AwardsList.render(awards, { mode: 'film' | 'person', i18n, idPrefix, visibleRows })
 *
 * A film's list has a card per ceremony and year («Оскар 2015») and names the people a
 * category went to. A person's list has a card per ceremony with the year and the film
 * on every row. The status of a row is a word and an icon, filled for a win and outlined
 * for a nomination, so it never rests on colour. Cards past `visibleRows` rows wait
 * behind one «Показать остальные» button.
 */
(function (root) {
    'use strict';

    // Every ceremony Kinopoisk keeps (kinopoisk.ru/awards/), in the order the lists use.
    // The Russian names come from Kinopoisk's pages; the English ones are for the English
    // interface. The emblem is a neutral outline drawn in the text colour.
    const CEREMONIES = [
        ['oscar', 'Academy Awards', 'statuette'],
        ['golden_globes', 'Golden Globe Awards', 'globe'],
        ['bafta', 'BAFTA Awards', 'mask'],
        ['cannes', 'Cannes Film Festival', 'laurel'],
        ['venice', 'Venice Film Festival', 'laurel'],
        ['berlin', 'Berlin International Film Festival', 'laurel'],
        ['emmy', 'Emmy Awards', 'trophy'],
        ['sag', 'Screen Actors Guild Awards', 'trophy'],
        ['efa', 'European Film Awards', 'trophy'],
        ['cesar', 'César Awards', 'trophy'],
        ['goya', 'Goya Awards', 'trophy'],
        ['sundance', 'Sundance Film Festival', 'laurel'],
        ['sanseb', 'San Sebastián Film Festival', 'laurel'],
        ['karlovy_vary', 'Karlovy Vary Film Festival', 'laurel'],
        ['miff', 'Moscow International Film Festival', 'laurel'],
        ['asian', 'Asian Film Awards', 'trophy'],
        ['nika', 'Nika Award', 'trophy'],
        ['orel', 'Golden Eagle Award', 'trophy'],
        ['kinotavr', 'Kinotavr', 'laurel'],
        ['saturn', 'Saturn Awards', 'trophy'],
        ['georges', 'Georges Award', 'trophy'],
        ['mtv', 'MTV Movie & TV Awards', 'trophy'],
        ['mtv_russia', 'MTV Russia Movie Awards', 'trophy'],
        ['razzie', 'Golden Raspberry Awards', 'trophy']
    ];
    const RANK = new Map(CEREMONIES.map(([slug], index) => [slug, index]));
    const META = new Map(CEREMONIES.map(([slug, englishName, emblem]) => [slug, { englishName, emblem }]));
    // Awards cached before the ceremony was stored carry only its name.
    const LEGACY_SLUGS = { 'Оскар': 'oscar', 'Золотой глобус': 'golden_globes' };

    const EMBLEMS = {
        statuette: '<svg data-icon="STATUETTE" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" d="M10 1.4L11.47 4.38L14.76 4.85L12.38 7.17L12.94 10.45L10 8.9L7.06 10.45L7.62 7.17L5.24 4.85L8.53 4.38Z"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M9 10H11V13H13A1 1 0 0 1 14 14V15H6V14A1 1 0 0 1 7 13H9ZM5 16H15A1 1 0 0 1 16 17V17A1 1 0 0 1 15 18H5A1 1 0 0 1 4 17V17A1 1 0 0 1 5 16Z"/></svg>',
        globe: '<svg data-icon="AWARD_GLOBE" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 2A5 5 0 1 0 10 12A5 5 0 1 0 10 2Z"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M10 2L10 12C12.76 12 15 9.76 15 7C15 4.24 12.76 2 10 2Z"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M8.4 13H11.6L12.6 15H7.4ZM6 16H14A1 1 0 0 1 15 17V17A1 1 0 0 1 14 18H6A1 1 0 0 1 5 17V17A1 1 0 0 1 6 16Z"/></svg>',
        mask: '<svg data-icon="AWARD_MASK" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4H16V9.4A6 6.6 0 0 1 4 9.4Z"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M10 4L10 16C13.32 16 16 13.04 16 9.4L16 4L10 4ZM12.4 7H13.4A1 1 0 0 1 14.4 8V8A1 1 0 0 1 13.4 9H12.4A1 1 0 0 1 11.4 8V8A1 1 0 0 1 12.4 7Z"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M6.6 7H7.6A1 1 0 0 1 8.6 8V8A1 1 0 0 1 7.6 9H6.6A1 1 0 0 1 5.6 8V8A1 1 0 0 1 6.6 7Z"/></svg>',
        laurel: '<svg data-icon="LAUREL" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M11.82 2.5A2.3 1.2 52 1 1 14.66 6.12A2.3 1.2 52 1 1 11.82 2.5ZM8.18 2.5A2.3 1.2 128 1 1 5.34 6.12A2.3 1.2 128 1 1 8.18 2.5ZM15.93 4.87A2.3 1.2 86 1 1 16.25 9.46A2.3 1.2 86 1 1 15.93 4.87ZM4.07 4.87A2.3 1.2 94 1 1 3.75 9.46A2.3 1.2 94 1 1 4.07 4.87ZM18.01 9.13A2.3 1.2 120 1 1 15.71 13.11A2.3 1.2 120 1 1 18.01 9.13ZM1.99 9.13A2.3 1.2 60 1 1 4.29 13.11A2.3 1.2 60 1 1 1.99 9.13ZM17.35 13.83A2.3 1.2 154 1 1 13.22 15.84A2.3 1.2 154 1 1 17.35 13.83ZM2.65 13.83A2.3 1.2 26 1 1 6.78 15.84A2.3 1.2 26 1 1 2.65 13.83ZM14.65 17.04A2.3 1.2 184 1 1 10.07 16.72A2.3 1.2 184 1 1 14.65 17.04ZM5.35 17.04A2.3 1.2 -4 1 1 9.93 16.72A2.3 1.2 -4 1 1 5.35 17.04Z"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M10 6.4L11 8.62L13.42 8.89L11.62 10.53L12.12 12.91L10 11.7L7.88 12.91L8.38 10.53L6.58 8.89L9 8.62Z"/></svg>',
        trophy: '<svg data-icon="TROPHY" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 3H14V8A4 4 0 0 1 6 8Z"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M10 3L10 12C12.21 12 14 10.21 14 8L14 3L10 3Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 5H2.6V5.6A3.6 3.6 0 0 0 6.2 9.2M14 5H17.4V5.6A3.6 3.6 0 0 1 13.8 9.2M10 12V16M6 17H14"/></svg>'
    };
    const STATUS_ICONS = {
        win: '<svg data-icon="TROPHY_FILLED" class="award-status__icon" aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 3H14V8A4 4 0 0 1 6 8Z"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M6 3H14V8A4 4 0 0 1 6 8Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 5H2.6V5.6A3.6 3.6 0 0 0 6.2 9.2M14 5H17.4V5.6A3.6 3.6 0 0 1 13.8 9.2M10 12V16M6 17H14"/></svg>',
        nomination: '<svg data-icon="TROPHY" class="award-status__icon" aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 3H14V8A4 4 0 0 1 6 8Z"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M10 3L10 12C12.21 12 14 10.21 14 8L14 3L10 3Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 5H2.6V5.6A3.6 3.6 0 0 0 6.2 9.2M14 5H17.4V5.6A3.6 3.6 0 0 1 13.8 9.2M10 12V16M6 17H14"/></svg>'
    };

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function translate(i18n, key) {
        const value = i18n?.get?.(key);
        return typeof value === 'string' ? value : key;
    }

    function pluralCategory(locale, count) {
        try {
            return new Intl.PluralRules(locale || 'ru').select(count);
        } catch {
            return 'other';
        }
    }

    function pluralTemplate(i18n, key, count) {
        const forms = i18n?.get?.(key);
        if (!forms || typeof forms !== 'object') return '{count}';
        return forms[pluralCategory(i18n.currentLocale, count)] || forms.other || forms.many || '{count}';
    }

    /** A plural phrase with the number in bold: «<strong>7</strong> побед». */
    function countHtml(i18n, key, count) {
        return escapeHtml(pluralTemplate(i18n, key, count)).replace('{count}', `<strong>${count}</strong>`);
    }

    function countText(i18n, key, count) {
        return pluralTemplate(i18n, key, count).replace('{count}', String(count));
    }

    function slugOf(award) {
        if (award?.slug) return String(award.slug).toLowerCase();
        const match = String(award?.ceremonyPath || award?.nominationUrl || '').match(/^\/awards\/([a-z0-9_-]+)\//i);
        if (match) return match[1].toLowerCase();
        return LEGACY_SLUGS[String(award?.name || '').trim()] || null;
    }

    function rankOf(slug) {
        return RANK.has(slug) ? RANK.get(slug) : RANK.size;
    }

    function ceremonyName(group, i18n) {
        const englishName = META.get(group.slug)?.englishName;
        if (i18n?.currentLocale === 'en' && englishName) return englishName;
        return group.name || englishName || translate(i18n, 'awards.nomination');
    }

    function normalize(award, index) {
        const recipients = (Array.isArray(award?.recipients) ? award.recipients : [])
            .filter(person => person && String(person.name || '').trim())
            .map(person => ({ name: String(person.name).trim(), kinopoiskId: Number(person.kinopoiskId) > 0 ? Number(person.kinopoiskId) : null }));
        // Awards parsed before the people were read from the film's page kept them as text.
        if (!recipients.length && typeof award?.recipient === 'string') {
            award.recipient.split(',').map(name => name.trim()).filter(Boolean)
                .forEach(name => recipients.push({ name, kinopoiskId: null }));
        }
        const year = Number(award?.year);
        return {
            index,
            slug: slugOf(award),
            name: String(award?.name || '').trim(),
            year: Number.isInteger(year) && year > 0 ? year : null,
            category: String(award?.nominationName || '').replace(/\s+/g, ' ').trim(),
            url: typeof award?.nominationUrl === 'string' ? award.nominationUrl : null,
            win: award?.win === true,
            recipients,
            films: (Array.isArray(award?.films) ? award.films : [])
                .filter(film => film && String(film.title || '').trim() && Number(film.kinopoiskId) > 0),
            categoryWinner: award?.win !== true && award?.categoryWinner ? String(award.categoryWinner) : null
        };
    }

    function summarize(awards) {
        const list = Array.isArray(awards) ? awards : [];
        const ceremonies = new Set(list.map(award => slugOf(award) || String(award?.name || '').trim()).filter(Boolean));
        const wins = list.filter(award => award?.win === true).length;
        return { wins, nominations: list.length - wins, ceremonies: ceremonies.size, total: list.length };
    }

    /** «7 побед · 6 номинаций» as markup with bold numbers; parts that are zero are left out. */
    function summaryHtml(awards, i18n, { withCeremonies = false } = {}) {
        const { wins, nominations, ceremonies } = summarize(awards);
        const parts = [];
        if (wins) parts.push(countHtml(i18n, 'awards.wins', wins));
        if (nominations) parts.push(countHtml(i18n, 'awards.nominations', nominations));
        if (withCeremonies && ceremonies > 1) parts.push(escapeHtml(countText(i18n, 'awards.ceremonies', ceremonies)));
        return parts.join('<span class="awards-summary__separator" aria-hidden="true"> · </span>');
    }

    /**
     * Film mode: one group per ceremony and year, ordered by ceremony and then by the
     * latest year; wins come first. Person mode: one group per ceremony, rows from the
     * latest year, wins first within a year. The input array is never reordered.
     */
    function groupAwards(awards, mode = 'film') {
        const groups = new Map();
        (Array.isArray(awards) ? awards : []).forEach((award, index) => {
            const row = normalize(award, index);
            const ceremonyKey = row.slug || row.name.toLocaleLowerCase('ru-RU');
            const key = mode === 'film' ? `${ceremonyKey}\u0000${row.year ?? ''}` : ceremonyKey;
            let group = groups.get(key);
            if (!group) {
                group = { key, slug: row.slug, name: row.name, year: mode === 'film' ? row.year : null, rows: [], wins: 0, nominations: 0, firstIndex: index };
                groups.set(key, group);
            }
            group.rows.push(row);
            if (row.win) group.wins += 1;
            else group.nominations += 1;
        });

        const list = [...groups.values()];
        list.forEach(group => {
            group.rows.sort((a, b) => (mode === 'person' ? (b.year ?? 0) - (a.year ?? 0) : 0)
                || Number(b.win) - Number(a.win)
                || a.index - b.index);
        });
        return list.sort((a, b) => rankOf(a.slug) - rankOf(b.slug)
            || (mode === 'film' ? (b.year ?? 0) - (a.year ?? 0) : b.wins - a.wins)
            || a.name.localeCompare(b.name, 'ru')
            || a.firstIndex - b.firstIndex);
    }

    function renderStatus(row, i18n) {
        return row.win
            ? `<span class="award-status award-status--win">${STATUS_ICONS.win}<span>${escapeHtml(translate(i18n, 'awards.win'))}</span></span>`
            : `<span class="award-status award-status--nomination">${STATUS_ICONS.nomination}<span>${escapeHtml(translate(i18n, 'awards.nomination'))}</span></span>`;
    }

    function renderPeople(row) {
        return row.recipients.map(person => (person.kinopoiskId
            ? `<a class="award-row__link" href="../person-details/person-details.html?personKey=${encodeURIComponent(`kp:${person.kinopoiskId}`)}">${escapeHtml(person.name)}</a>`
            : escapeHtml(person.name))).join(', ');
    }

    function renderFilms(row) {
        return row.films.map(film => `<a class="award-row__link" href="../movie-details/movie-details.html?movieId=${encodeURIComponent(film.kinopoiskId)}">${escapeHtml(film.title)}</a>`).join(', ');
    }

    function renderRowView(row, mode, i18n) {
        const details = [];
        if (mode === 'person') {
            const films = renderFilms(row);
            if (films) details.push(`<span class="award-row__meta award-row__films">${films}</span>`);
        } else {
            const people = renderPeople(row);
            if (people) details.push(`<span class="award-row__meta award-row__people">${people}</span>`);
            const winner = row.categoryWinner
                ? translate(i18n, 'awards.category_winner').replace('{name}', row.categoryWinner)
                : '';
            details.push(`<span class="award-row__meta award-category-winner"${winner ? '' : ' hidden'}>${escapeHtml(winner)}</span>`);
        }
        const attributes = [
            `class="award-row${row.win ? ' award-row--win' : ''}"`,
            `data-award-index="${row.index}"`,
            `data-award-win="${row.win}"`,
            row.url ? `data-award-nomination-url="${escapeHtml(row.url)}"` : ''
        ].filter(Boolean).join(' ');
        return `<li ${attributes}>${mode === 'person' ? `<span class="award-row__year">${row.year ?? '—'}</span>` : ''}<div class="award-row__body"><span class="award-row__category">${escapeHtml(row.category || translate(i18n, 'awards.nomination'))}</span>${details.join('')}</div>${renderStatus(row, i18n)}</li>`;
    }

    /** One row again, after a late lookup filled in who won a category. */
    function renderRow(award, index, options = {}) {
        return renderRowView(normalize(award, index), options.mode === 'person' ? 'person' : 'film', options.i18n || root.i18n);
    }

    function renderGroup(group, mode, i18n, id) {
        const parts = [];
        if (group.wins) parts.push(countText(i18n, 'awards.wins', group.wins));
        if (group.nominations) parts.push(countText(i18n, 'awards.nominations', group.nominations));
        const emblem = EMBLEMS[META.get(group.slug)?.emblem] || EMBLEMS.trophy;
        const year = mode === 'film' && group.year ? ` <span class="award-group__year">${group.year}</span>` : '';
        return `<section class="award-group"${group.slug ? ` data-ceremony="${escapeHtml(group.slug)}"` : ''} aria-labelledby="${id}">
            <header class="award-group__header">
                <span class="award-group__emblem">${emblem}</span>
                <div class="award-group__heading">
                    <h3 class="award-group__title" id="${id}">${escapeHtml(ceremonyName(group, i18n))}${year}</h3>
                    <span class="award-group__summary">${escapeHtml(parts.join(' · '))}</span>
                </div>
            </header>
            <ul class="award-group__rows">${group.rows.map(row => renderRowView(row, mode, i18n)).join('')}</ul>
        </section>`;
    }

    function render(awards, options = {}) {
        const list = Array.isArray(awards) ? awards : [];
        if (!list.length) return '';
        const mode = options.mode === 'person' ? 'person' : 'film';
        const i18n = options.i18n || root.i18n;
        const prefix = String(options.idPrefix || 'awards').replace(/[^\w-]/g, '');
        const visibleRows = Number(options.visibleRows) > 0 ? Number(options.visibleRows) : (mode === 'person' ? 12 : 8);
        const groups = groupAwards(list, mode);

        let shownRows = 0;
        let shownGroups = 0;
        while (shownGroups < groups.length && (shownGroups === 0 || shownRows < visibleRows)) {
            shownRows += groups[shownGroups].rows.length;
            shownGroups += 1;
        }
        const restRows = list.length - shownRows;
        const renderAll = (part, offset) => part.map((group, index) => renderGroup(group, mode, i18n, `${prefix}-group-${offset + index}`)).join('');
        const more = translate(i18n, 'awards.show_more').replace('{count}', restRows);
        const less = translate(i18n, 'awards.show_less');

        return `<div class="awards-list awards-list--${mode}">
            <p class="awards-summary">${summaryHtml(list, i18n, { withCeremonies: true })}</p>
            <div class="awards-groups">${renderAll(groups.slice(0, shownGroups), 0)}</div>
            ${shownGroups < groups.length ? `
            <div class="awards-groups" id="${prefix}-more" hidden>${renderAll(groups.slice(shownGroups), shownGroups)}</div>
            <button type="button" class="btn btn-secondary awards-toggle" data-action="toggle-awards" aria-expanded="false" aria-controls="${prefix}-more" data-label-more="${escapeHtml(more)}" data-label-less="${escapeHtml(less)}">${escapeHtml(more)}</button>
            ` : ''}
        </div>`;
    }

    function toggle(button) {
        const doc = button?.ownerDocument;
        const target = doc?.getElementById(button.getAttribute('aria-controls'));
        if (!target) return;
        const expand = button.getAttribute('aria-expanded') !== 'true';
        target.hidden = !expand;
        button.setAttribute('aria-expanded', String(expand));
        button.textContent = expand ? button.dataset.labelLess : button.dataset.labelMore;
    }

    const api = { CEREMONIES, render, renderRow, groupAwards, summarize, summaryHtml, slugOf, ceremonyName, toggle };
    root.AwardsList = api;

    if (typeof document !== 'undefined' && !root.__awardsListToggleBound) {
        root.__awardsListToggleBound = true;
        document.addEventListener('click', event => {
            const button = event.target?.closest?.('[data-action="toggle-awards"]');
            if (button) toggle(button);
        });
    }
})(typeof window !== 'undefined' ? window : globalThis);
