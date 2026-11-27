import {
    averageScore,
    compareScores,
    computeDecades,
    computeGenres,
    countFilms,
    fillDecades,
    selectFilms,
    sortFilms
} from './ProfileInsights.js';
import { countryName } from '../../shared/data/countries.js';

// Two full rows on a wide page, then four more at a time: a genre holds over a hundred films.
const FILMS_SHOWN = 14;
const FILMS_STEP = 28;
// A shorter list needs neither an order nor a way to narrow it.
const TOOLS_FROM = 4;
const ORDERS = ['best', 'worst', 'recent', 'gap'];
const SCORES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
// What the Catalogue can filter by (`catalog.html`): TMDB genres, or a category of its own.
const CATALOG_GENRES = {
    'боевик': 28, 'приключения': 12, 'комедия': 35, 'криминал': 80, 'драма': 18, 'фэнтези': 14,
    'ужасы': 27, 'детектив': 9648, 'мелодрама': 10749, 'фантастика': 878, 'триллер': 53
};
const CATALOG_CATEGORIES = { 'мультфильм': 'cartoons', 'аниме': 'anime' };

/**
 * Genres and release years of «Статистика» and the panel under them: a press on a
 * genre or a decade shows its films, a second press or Escape closes. Bars inside
 * narrow a genre to one score and a decade to one year. Everything is counted from
 * the ratings and films the view has already loaded. The «Страны» section
 * (ProfileCountriesPanel) opens a country in the same panel; a country, like a genre,
 * is laid out by score.
 */
export class ProfileTastePanel {
    /** @param {import('./ProfileInsightsView.js').ProfileInsightsView} view Texts, markup helpers and data */
    constructor(view) {
        this.view = view;
        this.escape = view.escape;
        this.data = view.data;
        this.choice = null;
    }

    t(key, params) { return this.view.t(key, params); }

    tn(key, n, params) { return this.view.tn(key, n, params); }

    render(body) {
        const { ratings, movies } = this.data;
        body.innerHTML = `
            <div class="insight-taste__groups">
                <div class="insight-taste__genres">
                    <h3 class="insight-subtitle">${this.escape(this.t('genres_title'))}</h3>
                    ${this.renderGenres(computeGenres(ratings, movies))}
                </div>
                <div class="insight-taste__decades">
                    <h3 class="insight-subtitle">${this.escape(this.t('decades_title'))}</h3>
                    ${this.renderDecades(fillDecades(computeDecades(ratings, movies)))}
                </div>
                <div class="insight-films" id="insightTasteFilms"></div>
            </div>`;
        this.bind(body);
    }

    /** The panel, its openers and their events; the countries section calls it for its own body. */
    bind(body) {
        this.panel = body.querySelector('.insight-films');
        this.openers = [...body.querySelectorAll('[data-taste]')];
        body.addEventListener('click', event => this.onClick(event));
        body.addEventListener('change', event => {
            if (event.target.matches('.insight-sort select')) this.setOrder(event.target.value);
        });
        body.addEventListener('keydown', event => {
            if (event.key !== 'Escape' || event.defaultPrevented || !this.choice) return;
            const opener = this.openers.find(button => button.getAttribute('aria-expanded') === 'true');
            this.close();
            opener?.focus();
        });
    }

    destroy() {
        this.sortControl?.destroy();
        this.sortControl = null;
    }

    renderGenres(genres) {
        if (!genres.length) return `<p class="taste-empty">${this.escape(this.t('genres_empty'))}</p>`;
        const max = genres[0].count;
        return `<ul class="insight-genres">${genres.map((genre, index) => `
            <li>
                <button type="button" class="insight-genres__row${index ? '' : ' is-top'}" data-taste="genre" data-value="${this.escape(genre.name)}" aria-expanded="false" aria-controls="insightTasteFilms">
                    <span class="insight-genres__name">${this.escape(genre.name)}</span>
                    <span class="insight-genres__bar" aria-hidden="true"><i style="width: ${(genre.count / max) * 100}%"></i></span>
                    <span class="insight-genres__count">${this.escape(genre.count)}</span>
                    <span class="insight-genres__average">${this.escape(this.t('genre_average', { n: this.view.formatScore(genre.average) }))}</span>
                </button>
            </li>`).join('')}</ul>`;
    }

    renderDecades(decades) {
        if (!decades.length) return `<p class="taste-empty">${this.escape(this.t('decades_empty'))}</p>`;
        const max = Math.max(...decades.map(item => item.count));
        return `<ul class="insight-decades">${decades.map(({ decade, count }) => `
            <li class="insight-decades__item">
                <button type="button" class="insight-decades__button${count === max ? ' is-top' : ''}" data-taste="decade" data-value="${decade}" aria-expanded="false" aria-controls="insightTasteFilms"${count ? '' : ' disabled'}>
                    <span class="insight-decades__count">${count || ''}</span>
                    <span class="insight-decades__bar" aria-hidden="true"><i style="height: ${(count / max) * 100}%"></i></span>
                    <span class="insight-decades__label">${this.escape(decade)}<span>${this.escape(this.t('decade_suffix'))}</span></span>
                </button>
            </li>`).join('')}</ul>`;
    }

    onClick(event) {
        const opener = event.target.closest('[data-taste]');
        if (opener) {
            if (opener.getAttribute('aria-expanded') === 'true') this.close();
            else this.open(opener);
            return;
        }
        const bar = event.target.closest('[data-only]');
        if (bar) {
            const value = Number(bar.dataset.only);
            this.narrow(this.choice.only === value ? null : value);
        } else if (event.target.closest('.insight-strip__reset')) {
            const pressed = this.panel.querySelector('[data-only][aria-pressed="true"]');
            this.narrow(null);
            pressed?.focus({ preventScroll: true });
        } else if (event.target.closest('[data-films-more]')) {
            this.showMore();
        } else if (event.target.closest('[data-films-less]')) {
            this.showLess();
        }
    }

    open(opener) {
        const { taste, value } = opener.dataset;
        this.destroy();
        this.choice = { taste, value: taste === 'decade' ? Number(value) : value, only: null, order: 'best' };
        this.choice.films = selectFilms(this.data.ratings, this.data.movies, { [taste]: this.choice.value });
        this.openers.forEach(button => {
            button.setAttribute('aria-expanded', String(button === opener));
            button.classList.toggle('is-current', button === opener);
        });
        this.panel.dataset.group = taste;
        this.panel.innerHTML = `
            <div class="insight-films__panel">
                <div class="insight-films__head"></div>
                <div>
                    ${this.choice.films.length < TOOLS_FROM ? '' : this.renderTools()}
                    <ul class="insight-films__grid"></ul>
                    <div class="insight-films__actions"></div>
                </div>
            </div>`;
        this.renderHead();
        this.renderFilms();
        const select = this.panel.querySelector('.insight-sort select');
        this.sortControl = select ? window.SortControl?.enhance(select) : null;
        this.panel.classList.add('is-open');
        this.view.revealFilms(this.panel, opener);
    }

    /** A closing panel keeps its films and pointer until it has folded. */
    close() {
        this.choice = null;
        this.openers.forEach(button => button.setAttribute('aria-expanded', 'false'));
        this.panel.classList.remove('is-open');
    }

    get keyName() { return this.choice.taste === 'decade' ? 'year' : 'score'; }

    /** The chosen thing's name: a genre, a decade or a year, a country. */
    choiceName() {
        const { taste, value, only } = this.choice;
        if (taste === 'genre') return value;
        if (taste === 'country') return countryName(value, this.view.i18n?.currentLocale);
        return only === null ? `${value}${this.t('decade_suffix')}` : this.t('taste_year', { n: only });
    }

    get picked() {
        const { films, only } = this.choice;
        return only === null ? films : films.filter(film => film[this.keyName] === only);
    }

    renderHead() {
        const { taste, only, films } = this.choice;
        // A year narrows the whole story; a score only the list: the average of all nines says nothing.
        const base = taste === 'decade' ? this.picked : films;
        const name = this.choiceName();
        const average = averageScore(base);
        const note = taste !== 'decade' && only !== null
            ? this.tn('taste_scored', this.picked.length, { score: only })
            : base.length > 1 && average !== null
                ? this.tn('taste_average', base.length, { average: this.view.formatScore(average) })
                : this.tn('films_count', base.length);
        const link = this.catalogLink();
        // The extension is for friends: only their scores are a comparison worth making.
        const facts = this.renderFact(this.t('taste_others'), compareScores(base, 'others'), base.length);
        this.panel.querySelector('.insight-films__head').innerHTML = `
            <h3 class="insight-films__name">${this.escape(name)}</h3>
            <p class="insight-films__note" role="status">${this.escape(note)}</p>
            ${facts ? `<dl class="insight-facts">${facts}</dl>` : ''}
            ${link ? `<a class="insight-films__link" href="${this.escape(link.href)}">${this.escape(link.text)}</a>` : ''}`;
    }

    renderFact(label, comparison, total) {
        if (!comparison) return '';
        const { average, difference, films } = comparison;
        const gap = { n: this.view.formatScore(Math.abs(difference)) };
        const other = this.data.isOther;
        const side = Math.abs(difference) < 0.05
            ? this.t('taste_same')
            : difference > 0
                ? this.t(other ? 'taste_above_other' : 'taste_above', gap)
                : this.t(other ? 'taste_below_other' : 'taste_below', gap);
        const note = films === total ? side : `${side}, ${this.tn('taste_by_films', films)}`;
        return `
            <div>
                <dt>${this.escape(label)}</dt>
                <dd>${this.escape(this.view.formatScore(average))}</dd>
                <dd class="insight-facts__note">${this.escape(note)}</dd>
            </div>`;
    }

    catalogLink() {
        const { taste, value, only } = this.choice;
        const page = query => `../catalog/catalog.html?${new URLSearchParams(query)}`;
        if (taste === 'country') return { href: page({ category: 'films', country: value }), text: this.t('country_catalog') };
        if (taste === 'genre') {
            const name = String(value).toLowerCase();
            const category = CATALOG_CATEGORIES[name];
            const genre = CATALOG_GENRES[name];
            if (!category && !genre) return null;
            return { href: page({ category: category || 'films', ...(genre ? { genre } : {}) }), text: this.t('taste_genre_catalog') };
        }
        const from = only ?? value;
        return {
            href: page({ category: 'films', yearFrom: from, yearTo: only ?? value + 9 }),
            text: this.t(only === null ? 'taste_years_catalog' : 'taste_year_catalog')
        };
    }

    renderTools() {
        const { taste, value, films } = this.choice;
        const byScore = taste !== 'decade';
        const keys = byScore ? SCORES : SCORES.map((_, index) => value + index);
        const counts = countFilms(films, this.keyName, keys);
        const max = Math.max(...counts, 1);
        const title = byScore
            ? this.t(this.data.isOther ? 'taste_scores_other' : 'taste_scores')
            : this.t('taste_years');
        const orders = { best: this.t('taste_order_best'), worst: this.t('taste_order_worst'), recent: this.t('taste_order_recent'), gap: this.t('taste_order_gap') };
        return `
            <div class="insight-films__tools">
                <div>
                    <div class="insight-strip__head">
                        <span>${this.escape(title)}</span>
                        <button type="button" class="insight-strip__reset" hidden>${this.escape(this.t(byScore ? 'taste_all_scores' : 'taste_all_years'))}</button>
                    </div>
                    <div class="insight-strip" role="group" aria-label="${this.escape(title)}">${keys.map((key, index) => `
                        <button type="button" class="insight-strip__item" data-only="${key}" aria-pressed="false" aria-label="${this.escape(`${key}: ${this.tn('films_count', counts[index])}`)}"${counts[index] ? '' : ' disabled'}>
                            <span>${counts[index] || ''}</span>
                            <span class="insight-strip__bar"><i style="height: ${(counts[index] / max) * 100}%"></i></span>
                            <span>${key}</span>
                        </button>`).join('')}</div>
                </div>
                <label class="insight-sort">
                    <span>${this.escape(this.t('taste_order'))}</span>
                    <select>${ORDERS.map(order => `<option value="${order}">${this.escape(orders[order])}</option>`).join('')}</select>
                </label>
            </div>`;
    }

    narrow(only) {
        this.choice.only = only;
        this.panel.querySelectorAll('[data-only]').forEach(bar => bar.setAttribute('aria-pressed', String(Number(bar.dataset.only) === only)));
        this.panel.querySelector('.insight-strip__reset').hidden = only === null;
        this.renderHead();
        this.renderFilms();
    }

    setOrder(order) {
        if (!this.choice || !ORDERS.includes(order)) return;
        this.choice.order = order;
        this.renderFilms();
    }

    renderFilms() {
        const { order } = this.choice;
        const films = sortFilms(this.picked, order);
        // The second score shows only in the order it explains.
        const others = film => order === 'gap' && film.others
            ? `<span class="insight-films__score">${this.view.boldNumber('taste_others_score', this.view.formatScore(film.others))}</span>` : '';
        this.panel.querySelector('.insight-films__grid').innerHTML = films
            .map((film, index) => this.view.filmPoster(film, { hidden: index >= FILMS_SHOWN, extra: others(film) })).join('');
        this.renderActions();
    }

    renderActions() {
        const items = [...this.panel.querySelectorAll('.insight-films__grid > li')];
        const rest = items.filter(item => item.hidden).length;
        const step = Math.min(FILMS_STEP, rest);
        const more = rest > step ? this.t('taste_more', { n: step, total: rest }) : this.t('people_more', { n: step });
        const actions = this.panel.querySelector('.insight-films__actions');
        actions.hidden = items.length <= FILMS_SHOWN;
        actions.innerHTML = `
            ${rest ? `<button type="button" class="btn btn-sm btn-outline insight-films__more" data-films-more>${this.escape(more)}</button>` : ''}
            ${items.length - rest > FILMS_SHOWN ? `<button type="button" class="btn btn-sm btn-outline insight-films__more" data-films-less>${this.escape(this.t('taste_less'))}</button>` : ''}`;
    }

    showMore() {
        const next = [...this.panel.querySelectorAll('.insight-films__grid > li[hidden]')].slice(0, FILMS_STEP);
        next.forEach(item => { item.hidden = false; });
        this.renderActions();
        next[0]?.querySelector('a')?.focus({ preventScroll: true });
    }

    showLess() {
        this.panel.querySelectorAll('.insight-films__grid > li').forEach((item, index) => { item.hidden = index >= FILMS_SHOWN; });
        this.renderActions();
        // The list got shorter under a reader deep in it.
        if (this.panel.getBoundingClientRect().top < 0) this.panel.scrollIntoView({ block: 'start' });
        this.panel.querySelector('[data-films-more]')?.focus({ preventScroll: true });
    }
}
