/**
 * Studio page: one TMDB company and the films and series it made.
 *
 * Opened from the «Студии» row of a film page (`studio.html?id=<tmdb company>&media=tv`).
 * Lists come from TMDB `/discover` and stay TMDB-only until a card is opened, like the
 * catalogue: `HomeMovieNavigationService` resolves the Kinopoisk ID on click, and
 * `MovieRatingsEnrichmentService` writes `data-movie-id` on visible cards. The user's own
 * scores follow those IDs, one batched query per new set of cards.
 */
class StudioPage {
    static SORT_KEY = 'studioTitlesSortV1';
    static MEDIA = ['movie', 'tv'];

    constructor() {
        const byId = id => document.getElementById(id);
        this.elements = {
            loading: byId('studioLoading'),
            error: byId('studioError'),
            errorTitle: byId('studioErrorTitle'),
            errorText: byId('studioErrorText'),
            errorBack: byId('studioErrorBack'),
            errorRetry: byId('studioErrorRetry'),
            content: byId('studioContent'),
            logoWell: byId('studioLogoWell'),
            logo: byId('studioLogo'),
            logoText: byId('studioLogoText'),
            name: byId('studioName'),
            kind: byId('studioKind'),
            facts: byId('studioFacts'),
            description: byId('studioDescription'),
            media: byId('studioMedia'),
            sort: byId('studioSort'),
            note: byId('studioNote'),
            grid: byId('studioGrid'),
            empty: byId('studioEmpty'),
            status: byId('studioStatus'),
            more: byId('studioMore')
        };
        this.tmdbService = typeof TMDBService !== 'undefined' ? new TMDBService() : null;
        this.kinopoiskService = typeof KinopoiskService !== 'undefined' ? new KinopoiskService() : null;
        this.navigationService = typeof HomeMovieNavigationService !== 'undefined'
            ? new HomeMovieNavigationService({ kinopoiskService: this.kinopoiskService })
            : null;
        this.ratingEnricher = typeof MovieRatingsEnrichmentService !== 'undefined'
            ? new MovieRatingsEnrichmentService({
                kinopoiskService: this.kinopoiskService,
                navigationService: this.navigationService,
                tmdbService: this.tmdbService,
                enableDetailFallback: true
            })
            : null;
        this.renderer = typeof HomeRenderer !== 'undefined' ? new HomeRenderer({ ratingEnricher: this.ratingEnricher }) : null;
        this.sortControl = null;

        this.companyId = null;
        this.company = null;
        this.totals = { movie: 0, tv: 0 };
        this.media = 'movie';
        this.sort = this.readStoredSort();
        this.list = { page: 0, totalPages: 0, totalResults: 0, keys: new Set() };
        this.listFailed = null;
        this.loadGeneration = 0;
        this.listGeneration = 0;
        this.isListLoading = false;
        this.requestController = null;

        this.uid = null;
        this.userScores = new Map();
        this.scoreTimer = null;
        this.scoreObserver = null;
        this.renderedLocale = null;
        this.countryNameOf = null;
    }

    t(key, params = null) {
        const fullKey = `studio.${key}`;
        let text = window.i18n?.get?.(fullKey) ?? fullKey;
        if (params && typeof text === 'string') {
            Object.entries(params).forEach(([name, value]) => { text = text.replaceAll(`{${name}}`, String(value)); });
        }
        return text;
    }

    getLocale() {
        return window.i18n?.currentLocale || 'ru';
    }

    /** «20 фильмов»: plural forms are an object in the locale, chosen by Intl.PluralRules. */
    plural(key, count) {
        const forms = window.i18n?.get?.(`studio.${key}`);
        if (!forms || typeof forms !== 'object') return String(count);
        const rule = new Intl.PluralRules(this.getLocale()).select(count);
        const template = forms[rule] || forms.other || forms.many || '';
        return template.replaceAll('{count}', this.formatNumber(count));
    }

    formatNumber(value) {
        return new Intl.NumberFormat(this.getLocale() === 'ru' ? 'ru-RU' : 'en-US').format(value);
    }

    /** «США», not Intl's «Соединенные Штаты»: the shared country names, once they load. */
    countryName(code) {
        if (!/^[A-Z]{2}$/.test(code || '')) return '';
        if (this.countryNameOf) return this.countryNameOf(code, this.getLocale());
        try {
            return new Intl.DisplayNames([this.getLocale()], { type: 'region' }).of(code) || code;
        } catch {
            return code;
        }
    }

    async loadCountryNames() {
        try {
            const module = await import('../../shared/data/countries.js');
            this.countryNameOf = typeof module.countryName === 'function' ? module.countryName : null;
        } catch {
            this.countryNameOf = null;
        }
    }

    readStoredSort() {
        try {
            const stored = localStorage.getItem(StudioPage.SORT_KEY);
            return TMDBService.COMPANY_SORTS.includes(stored) ? stored : 'popular';
        } catch {
            return 'popular';
        }
    }

    storeSort(sort) {
        try { localStorage.setItem(StudioPage.SORT_KEY, sort); } catch { /* the order then lasts for this page only */ }
    }

    async init() {
        await Promise.all([window.i18n?.init?.(), this.loadCountryNames()]);
        this.renderedLocale = this.getLocale();
        window.i18n?.translatePage?.();
        if (typeof Navigation !== 'undefined' && !window.navigationInstance) {
            window.navigationInstance = new Navigation();
        }
        this.sortControl = window.SortControl?.enhance?.(this.elements.sort) || null;
        this.bindEvents();
        this.bindLocaleChanges();

        const params = new URLSearchParams(window.location.search);
        const id = Number(params.get('id'));
        if (!Number.isSafeInteger(id) || id <= 0) {
            this.showError('invalid');
            return;
        }
        this.companyId = id;
        this.media = params.get('media') === 'tv' ? 'tv' : 'movie';
        this.elements.sort.value = this.sort;
        this.sortControl?.syncFromNative?.();
        void this.watchUser();
        await this.load();
    }

    bindEvents() {
        window.addEventListener('pagehide', event => {
            if (!event.persisted) this.ratingEnricher?.dispose?.();
        });
        this.elements.errorRetry?.addEventListener('click', () => this.load());
        this.elements.errorBack?.addEventListener('click', () => {
            if (window.history.length > 1) window.history.back();
            else window.location.href = '../home/home.html';
        });
        this.elements.media?.addEventListener('click', event => {
            const button = event.target.closest('[data-media]');
            if (!button || button.disabled || button.dataset.media === this.media) return;
            this.media = button.dataset.media;
            this.writeUrl();
            this.renderMediaChoices();
            void this.loadList({ reset: true });
        });
        this.elements.sort?.addEventListener('change', () => {
            const sort = this.elements.sort.value;
            if (!TMDBService.COMPANY_SORTS.includes(sort) || sort === this.sort) return;
            this.sort = sort;
            this.storeSort(sort);
            void this.loadList({ reset: true });
        });
        this.elements.more?.addEventListener('click', () => {
            if (this.listFailed) void this.loadList({ reset: this.listFailed === 'reset' });
            else void this.loadList({ reset: false });
        });
    }

    bindLocaleChanges() {
        const refresh = () => {
            if (this.getLocale() === this.renderedLocale) return;
            this.renderedLocale = this.getLocale();
            window.i18n?.translatePage?.();
            if (this.company) this.renderHero();
            this.renderMediaChoices();
            this.renderListChrome();
            this.applyUserScores();
        };
        window.i18n?.onLocaleChange?.(refresh);
        if (typeof chrome === 'undefined') return;
        chrome.runtime?.onMessage?.addListener?.(message => {
            if (message?.type !== 'SETTINGS_UPDATED' || !message.settings?.language) return;
            Promise.resolve(window.i18n?.init?.()).then(refresh);
        });
    }

    writeUrl() {
        const url = new URL(window.location.href);
        url.searchParams.set('id', String(this.companyId));
        if (this.media === 'tv') url.searchParams.set('media', 'tv');
        else url.searchParams.delete('media');
        window.history.replaceState({}, document.title, url.toString());
    }

    showLoading() {
        this.elements.loading.hidden = false;
        this.elements.loading.style.display = '';
        this.elements.error.hidden = true;
        this.elements.content.hidden = true;
    }

    showContent() {
        this.elements.loading.hidden = true;
        this.elements.loading.style.display = 'none';
        this.elements.error.hidden = true;
        const wasHidden = this.elements.content.hidden;
        this.elements.content.hidden = false;
        if (wasHidden && typeof Utils !== 'undefined') Utils.revealContent?.(this.elements.content);
    }

    /** @param {'invalid'|'not_found'|'provider'} kind */
    showError(kind) {
        this.elements.loading.hidden = true;
        this.elements.loading.style.display = 'none';
        this.elements.content.hidden = true;
        this.elements.error.hidden = false;
        this.elements.errorTitle.textContent = this.t(kind === 'provider' ? 'error_title' : `error_${kind}_title`);
        this.elements.errorText.textContent = this.t(kind === 'provider' ? 'error_text' : `error_${kind}_text`);
        this.elements.errorRetry.hidden = kind !== 'provider';
        document.title = `${this.t('page_title')} — ${window.i18n?.get?.('app.name') || 'Сеанс'}`;
    }

    /**
     * The studio and the first page of both lists in parallel: the counts decide which
     * tab opens (the requested one when it has titles) and whether the switch shows.
     */
    async load() {
        const generation = ++this.loadGeneration;
        this.requestController?.abort();
        const controller = new AbortController();
        this.requestController = controller;
        this.showLoading();
        if (!this.tmdbService) {
            this.showError('provider');
            return;
        }
        const signal = controller.signal;
        const firstPage = media => this.tmdbService.getCompanyTitlesPage({ companyId: this.companyId, mediaType: media, sort: 'popular', page: 1, signal });
        const [company, movies, series] = await Promise.allSettled([
            this.tmdbService.getCompanyDetails(this.companyId, { signal }),
            firstPage('movie'),
            firstPage('tv')
        ]);
        if (generation !== this.loadGeneration) return;
        if (company.status !== 'fulfilled' || !company.value.name) {
            const status = company.reason?.status;
            if (company.status === 'rejected') console.warn('[StudioPage] Company request failed:', company.reason?.message);
            this.showError(status === 404 || company.status === 'fulfilled' ? 'not_found' : 'provider');
            return;
        }
        this.company = company.value;
        const pages = { movie: movies.status === 'fulfilled' ? movies.value : null, tv: series.status === 'fulfilled' ? series.value : null };
        this.totals = { movie: pages.movie?.totalResults || 0, tv: pages.tv?.totalResults || 0 };
        if (this.totals[this.media] === 0) {
            const other = this.media === 'movie' ? 'tv' : 'movie';
            if (this.totals[other] > 0) this.media = other;
        }
        this.writeUrl();
        this.renderHero();
        this.renderMediaChoices();
        this.showContent();

        if (this.sort === 'popular' && pages[this.media]) {
            this.resetGrid();
            this.takePage(pages[this.media]);
        } else if (this.sort === 'popular') {
            // The list request for this tab failed: say so and offer to try again.
            this.resetGrid();
            this.listFailed = 'reset';
            this.renderListChrome();
        } else {
            await this.loadList({ reset: true });
        }
    }

    renderHero() {
        const company = this.company;
        const appName = window.i18n?.get?.('app.name') || 'Сеанс';
        document.title = `${company.name} — ${appName}`;
        this.elements.name.textContent = company.name;
        const country = this.countryName(company.originCountry);
        this.elements.kind.textContent = [this.t('kind'), country].filter(Boolean).join(' · ');

        const logoUrl = company.logoUrl && typeof MovieCard !== 'undefined' ? MovieCard.safeImageUrl(company.logoUrl, '') : company.logoUrl;
        const { logo, logoText, logoWell } = this.elements;
        logoText.textContent = company.name;
        if (logoUrl) {
            if (logo.getAttribute('src') !== logoUrl) {
                logo.hidden = true;
                logoText.hidden = false;
                logo.onload = () => { logo.hidden = false; logoText.hidden = true; };
                logo.onerror = () => { logo.hidden = true; logoText.hidden = false; };
                logo.src = logoUrl;
            }
            logo.alt = this.t('logo_alt', { name: company.name });
        } else {
            logo.hidden = true;
            logo.removeAttribute('src');
            logoText.hidden = false;
        }
        logoWell.classList.toggle('studio-hero__logo-well--text', !logoUrl);

        const facts = [];
        const fact = (label, valueNode) => {
            const dt = document.createElement('dt');
            dt.textContent = label;
            const dd = document.createElement('dd');
            dd.append(valueNode);
            facts.push(dt, dd);
        };
        if (company.headquarters) fact(this.t('fact_headquarters'), document.createTextNode(company.headquarters));
        if (company.parent && company.parent.tmdbId !== company.tmdbId) {
            const link = document.createElement('a');
            link.href = `studio.html?id=${encodeURIComponent(company.parent.tmdbId)}`;
            link.className = 'studio-hero__link';
            link.textContent = company.parent.name;
            fact(this.t('fact_parent'), link);
        }
        if (company.homepage) {
            const link = document.createElement('a');
            link.href = company.homepage;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.className = 'studio-hero__link';
            try {
                link.textContent = new URL(company.homepage).hostname.replace(/^www\./, '');
            } catch {
                link.textContent = company.homepage;
            }
            fact(this.t('fact_site'), link);
        }
        const counts = [];
        if (this.totals.movie > 0) counts.push(this.plural('count_movies', this.totals.movie));
        if (this.totals.tv > 0) counts.push(this.plural('count_tv', this.totals.tv));
        if (counts.length) fact(this.t('fact_catalog'), document.createTextNode(counts.join(` ${this.t('and')} `)));
        this.elements.facts.replaceChildren(...facts);
        this.elements.facts.hidden = facts.length === 0;

        this.elements.description.textContent = company.description;
        this.elements.description.hidden = !company.description;
    }

    /** The switch shows only when the studio has both films and series. */
    renderMediaChoices() {
        const both = this.totals.movie > 0 && this.totals.tv > 0;
        this.elements.media.hidden = !both;
        this.elements.media.querySelectorAll('[data-media]').forEach(button => {
            const active = button.dataset.media === this.media;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-pressed', String(active));
            const count = button.querySelector('[data-count-for]');
            if (count) count.textContent = this.formatNumber(this.totals[button.dataset.media] || 0);
        });
    }

    resetGrid() {
        this.list = { page: 0, totalPages: 0, totalResults: 0, keys: new Set() };
        this.listFailed = null;
        this.elements.grid.replaceChildren();
    }

    renderSkeletons() {
        const fragment = document.createDocumentFragment();
        for (let index = 0; index < 12; index += 1) {
            const skeleton = document.createElement('div');
            skeleton.className = 'studio-skeleton';
            skeleton.setAttribute('aria-hidden', 'true');
            fragment.append(skeleton);
        }
        this.elements.grid.replaceChildren(fragment);
    }

    /**
     * The next page of the open tab, or its first page after a change of tab or order.
     * A later request wins: an answer for an earlier tab or order is dropped.
     */
    async loadList({ reset }) {
        if (!reset && (this.isListLoading || this.list.page >= this.list.totalPages)) return;
        const generation = ++this.listGeneration;
        const media = this.media;
        const sort = this.sort;
        const page = reset ? 1 : this.list.page + 1;
        this.isListLoading = true;
        this.listFailed = null;
        if (reset) {
            this.resetGrid();
            this.renderSkeletons();
        }
        this.elements.grid.setAttribute('aria-busy', 'true');
        this.renderListChrome();
        try {
            const result = await this.tmdbService.getCompanyTitlesPage({
                companyId: this.companyId,
                mediaType: media,
                sort,
                page,
                signal: this.requestController?.signal || null
            });
            if (generation !== this.listGeneration) return;
            if (reset) this.elements.grid.replaceChildren();
            this.takePage(result);
        } catch (error) {
            if (generation !== this.listGeneration) return;
            console.warn('[StudioPage] Titles request failed:', error?.message);
            if (reset) this.elements.grid.replaceChildren();
            this.listFailed = reset ? 'reset' : 'more';
        } finally {
            if (generation === this.listGeneration) {
                this.isListLoading = false;
                this.elements.grid.setAttribute('aria-busy', 'false');
                this.renderListChrome();
            }
        }
    }

    takePage(result) {
        this.list.page = Number(result.page) || 1;
        this.list.totalPages = Number(result.totalPages) || 1;
        this.list.totalResults = Number(result.totalResults) || 0;
        const items = (result.items || []).filter(item => {
            const key = `${item.mediaType}:${item.tmdbId}`;
            if (this.list.keys.has(key)) return false;
            this.list.keys.add(key);
            return true;
        });
        this.appendItems(items);
        this.renderListChrome();
    }

    appendItems(items) {
        if (!this.renderer || items.length === 0) return;
        const fragment = document.createDocumentFragment();
        items.forEach(item => {
            const card = this.renderer.createMovieCard(item);
            if (card) fragment.append(card);
        });
        this.elements.grid.append(fragment);
        this.renderer.bindMovieCardNavigation(this.elements.grid);
        this.ratingEnricher?.observe?.(this.elements.grid);
        this.scheduleUserScores();
    }

    /** Note, empty text, status and the «Показать ещё» button after any list change. */
    renderListChrome() {
        const { note, empty, status, more } = this.elements;
        const shown = this.list.keys.size;
        const loading = this.isListLoading;

        note.hidden = this.sort !== 'rating';
        note.textContent = this.sort === 'rating' ? this.t('rating_note', { count: TMDBService.COMPANY_RATING_MIN_VOTES }) : '';

        const isEmpty = !loading && !this.listFailed && shown === 0;
        empty.hidden = !isEmpty;
        if (isEmpty) {
            const nothingAtAll = this.totals.movie === 0 && this.totals.tv === 0;
            empty.textContent = this.t(nothingAtAll ? 'empty_studio' : (this.sort === 'rating' ? 'empty_rating' : 'empty_list'));
        }

        status.textContent = this.listFailed ? this.t('list_error') : '';

        const remaining = Math.max(0, this.list.totalResults - shown);
        const canMore = !this.listFailed && this.list.page < this.list.totalPages && remaining > 0;
        more.hidden = !(this.listFailed || canMore);
        more.disabled = loading;
        if (this.listFailed) more.textContent = this.t('retry');
        else if (loading && !more.hidden) more.textContent = this.t('loading_more');
        else more.textContent = this.t('show_more', { count: this.formatNumber(Math.min(20, remaining)) });
    }

    async watchUser() {
        const manager = await this.waitForFirebaseManager();
        if (!manager) return;
        const apply = user => {
            const uid = user?.uid || null;
            if (uid === this.uid) return;
            this.uid = uid;
            this.userScores = new Map();
            this.applyUserScores();
            this.scheduleUserScores();
        };
        apply(await manager.waitForAuthReady?.(15000));
        window.addEventListener('authStateChanged', () => apply(manager.getCurrentUser?.()));
        this.observeCardIds();
    }

    waitForFirebaseManager(timeoutMs = 5000) {
        if (window.firebaseManager) return Promise.resolve(window.firebaseManager);
        return new Promise(resolve => {
            const startedAt = Date.now();
            const check = () => {
                if (window.firebaseManager) resolve(window.firebaseManager);
                else if (Date.now() - startedAt >= timeoutMs) resolve(null);
                else setTimeout(check, 50);
            };
            check();
        });
    }

    /** Cards learn their Kinopoisk ID from the rating enrichment, as they come into view. */
    observeCardIds() {
        if (this.scoreObserver || typeof MutationObserver === 'undefined') return;
        this.scoreObserver = new MutationObserver(mutations => {
            const relevant = mutations.some(mutation => (mutation.type === 'childList' && mutation.target === this.elements.grid)
                || (mutation.attributeName === 'data-movie-id' && mutation.target.classList?.contains('movie-card-component')));
            if (relevant) this.scheduleUserScores();
        });
        this.scoreObserver.observe(this.elements.grid, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-movie-id'] });
    }

    scheduleUserScores() {
        clearTimeout(this.scoreTimer);
        this.scoreTimer = setTimeout(() => { void this.loadUserScores(); }, 250);
    }

    getCards() {
        return [...this.elements.grid.querySelectorAll('.movie-card-component')];
    }

    async loadUserScores() {
        const uid = this.uid;
        if (!uid) return;
        const scores = this.userScores;
        let ratingService;
        try {
            ratingService = window.firebaseManager?.getRatingService?.();
        } catch {
            return;
        }
        if (!ratingService?.getUserRatingsForMovies) return;
        const unknown = [...new Set(this.getCards()
            .map(card => Number(card.dataset.movieId))
            .filter(id => Number.isSafeInteger(id) && id > 0 && !scores.has(String(id))))];
        if (unknown.length) {
            try {
                const ratings = await ratingService.getUserRatingsForMovies(uid, unknown);
                unknown.forEach(id => scores.set(String(id), Number(ratings?.get?.(String(id))?.rating) || 0));
            } catch (error) {
                console.warn('[StudioPage] Personal scores failed:', error?.message);
                return;
            }
        }
        // A sign-out or another account owns the scores now.
        if (uid !== this.uid || scores !== this.userScores) return;
        this.applyUserScores();
    }

    applyUserScores() {
        if (typeof MovieCard === 'undefined' || !MovieCard.setUserRating) return;
        this.getCards().forEach(card => {
            const score = this.uid ? Number(this.userScores.get(String(Number(card.dataset.movieId)))) || 0 : 0;
            MovieCard.setUserRating(card, score);
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.studioPage = new StudioPage();
    window.studioPage.init().catch(error => {
        console.error('[StudioPage] Initialization failed:', error);
        window.studioPage.showError('provider');
    });
});

if (typeof window !== 'undefined') window.StudioPage = StudioPage;
