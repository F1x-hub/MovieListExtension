const DEFAULT_CATALOG_SORT_VALUES = Object.freeze(['popularity.desc', 'vote_average.desc', 'primary_release_date.desc']);

const KEYWORD_COPY = Object.freeze({ 207317: 'home.season.newyear' });

class CatalogPage {
    constructor() {
        this.elements = {
            title: document.getElementById('catalogTitle'),
            description: document.getElementById('catalogDescription'),
            count: document.getElementById('catalogCount'),
            grid: document.getElementById('catalogGrid'),
            status: document.getElementById('catalogStatus'),
            empty: document.getElementById('catalogEmpty'),
            error: document.getElementById('catalogError'),
            errorMessage: document.getElementById('catalogErrorMessage'),
            retry: document.getElementById('catalogRetry'),
            emptyReset: document.getElementById('catalogEmptyReset'),
            reset: document.getElementById('catalogReset'),
            loadMore: document.getElementById('catalogLoadMore'),
            loadMoreButton: document.getElementById('catalogLoadMoreButton'),
            sentinel: document.getElementById('catalogSentinel'),
            progress: document.getElementById('catalogProgress'),
            sort: document.getElementById('catalogSort'),
            yearFrom: document.getElementById('catalogYearFrom'),
            yearTo: document.getElementById('catalogYearTo'),
            genre: document.getElementById('catalogGenre'),
            country: document.getElementById('catalogCountry')
        };

        this.selectControls = {
            sort: window.SortControl?.enhance(this.elements.sort),
            genre: window.SortControl?.enhance(this.elements.genre)
        };
        this.yearRangeControl = RangeControl.enhance(this.elements.yearFrom, this.elements.yearTo, this.getYearRangeLabels());

        this.state = this.readStateFromUrl();
        this.catalogService = new CatalogService();
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
        this.renderer = new HomeRenderer({ ratingEnricher: this.ratingEnricher });
        this.seenCatalogKeys = new Set();
        this.currentPage = 0;
        this.totalPages = 1;
        this.totalResults = 0;
        this.isLoading = false;
        this.autoLoadCount = 0;
        this.maxAutoLoads = 2;
        this.observer = null;
        this.statusKey = '';
        this.errorKey = '';
        this.renderedLocale = null;
    }

    /* Catalogue text lives in the `catalog` locale group; I18n shows the key itself if one is missing. */
    t(key) {
        return window.i18n?.get?.(`catalog.${key}`) ?? key;
    }

    getLocale() {
        return window.i18n?.currentLocale || 'ru';
    }

    getYearRangeLabels() {
        return { fromLabel: this.t('year_from'), toLabel: this.t('year_to') };
    }

    async init() {
        await window.i18n?.init?.();
        this.applyLocale();
        this.initNavigation();
        this.bindEvents();
        this.bindLocaleChanges();
        this.renderHeader();
        this.syncControlsFromState();
        this.setupObserver();
        await this.loadFirstPage();
    }

    /* Static markup carries data-i18n; text set from code is rendered again from the saved keys. */
    applyLocale() {
        this.renderedLocale = this.getLocale();
        window.i18n?.translatePage?.();
        this.yearRangeControl?.updateOptions?.(this.getYearRangeLabels());
        this.setLoadingState(this.isLoading);
        this.setStatus(this.statusKey);
        if (this.errorKey) this.elements.errorMessage.textContent = this.t(this.errorKey);
        if (this.totalResults > 0) this.elements.count.textContent = this.formatCount(this.totalResults);
    }

    bindLocaleChanges() {
        const refresh = () => {
            if (this.getLocale() === this.renderedLocale) return;
            this.applyLocale();
            this.renderHeader();
        };
        window.i18n?.onLocaleChange?.(refresh);
        // Settings saves the language from its own page and announces it to every open page.
        if (typeof chrome === 'undefined') return;
        chrome.runtime?.onMessage?.addListener?.(message => {
            if (message?.type !== 'SETTINGS_UPDATED' || !message.settings?.language) return;
            if (message.settings.language === this.renderedLocale) return;
            const localeId = this.localeRefreshId = (this.localeRefreshId || 0) + 1;
            Promise.resolve(window.i18n?.init?.()).then(() => {
                if (localeId === this.localeRefreshId) refresh();
            });
        });
    }

    initNavigation() {
        if (typeof Navigation !== 'undefined' && !window.navigationInstance) {
            window.navigationInstance = new Navigation();
        }
    }

    readStateFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const category = typeof window.normalizeCatalogCategory === 'function'
            ? window.normalizeCatalogCategory(params.get('category'))
            : (['films', 'series', 'cartoons', 'anime'].includes(params.get('category')) ? params.get('category') : 'films');

        return {
            category,
            sort: params.get('sort') || 'popularity.desc',
            yearFrom: params.get('yearFrom') || '',
            yearTo: params.get('yearTo') || '',
            genre: params.get('genre') || '',
            country: params.get('country') || '',
            // Set by a link such as the New Year sign; it has no control of its own.
            keyword: params.get('keyword') || ''
        };
    }

    getCategoryConfig() {
        const categories = window.CATALOG_CATEGORIES || {};
        return categories[this.state.category] || categories.films;
    }

    getSortOptions() {
        const configured = this.getCategoryConfig()?.sortOptions;
        const values = configured ? configured.map(option => option.value) : DEFAULT_CATALOG_SORT_VALUES;
        return values.map(value => {
            const labelKey = `catalog.sort.${this.getSortLabelKey(value)}`;
            return { value, labelKey, label: window.i18n?.get?.(labelKey) ?? value };
        });
    }

    /* The release-date sort is named after the category: newest films, series, cartoons or anime. */
    getSortLabelKey(value) {
        if (value === 'popularity.desc') return 'popular';
        if (value === 'vote_average.desc') return 'rating';
        return `newest_${this.getCategoryConfig()?.key || 'films'}`;
    }

    getCategoryCopy() {
        const key = this.getCategoryConfig()?.key || 'films';
        return {
            key,
            title: this.t(`categories.${key}.title`),
            description: this.t(`categories.${key}.description`)
        };
    }

    /* A keyword link names its own selection; without a known name the category's stays. */
    getKeywordCopy() {
        const section = this.state.keyword ? KEYWORD_COPY[this.state.keyword] : null;
        if (!section) return null;
        const title = window.i18n?.get?.(`${section}.catalog_title`);
        const description = window.i18n?.get?.(`${section}.catalog_description`);
        return title && description && title !== `${section}.catalog_title` ? { title, description } : null;
    }

    getQuery(page = 1) {
        return {
            page,
            pageSize: this.getCatalogPageSize(),
            sort: this.state.sort,
            yearFrom: this.state.yearFrom,
            yearTo: this.state.yearTo,
            genre: this.state.genre,
            country: this.state.country,
            keyword: this.state.keyword
        };
    }

    getCatalogPageSize() {
        const grid = this.elements.grid;
        const template = grid && typeof window !== 'undefined' && typeof window.getComputedStyle === 'function'
            ? window.getComputedStyle(grid).gridTemplateColumns
            : '';
        const repeatMatch = template.match(/repeat\(\s*(\d+)\s*,/i);
        const columns = repeatMatch
            ? Number(repeatMatch[1])
            : (template && template !== 'none' ? template.split(/\s+/).filter(Boolean).length : 0);

        if (!Number.isInteger(columns) || columns <= 0) return this.catalogService.pageSize;
        return Math.min(30, Math.max(12, columns * 3));
    }

    renderHeader() {
        const sortOptions = this.getSortOptions();
        if (!sortOptions.some(option => option.value === this.state.sort)) {
            this.state.sort = sortOptions[0]?.value || 'popularity.desc';
        }
        this.selectControls?.sort?.setOptions(sortOptions);
        const categoryCopy = this.getCategoryCopy();
        const keywordCopy = this.getKeywordCopy();
        const copy = keywordCopy || categoryCopy;
        // translatePage must not put the films heading back over another category or a keyword.
        [[this.elements.title, 'title'], [this.elements.description, 'description']].forEach(([element, field]) => {
            if (keywordCopy) delete element.dataset.i18n;
            else element.dataset.i18n = `catalog.categories.${categoryCopy.key}.${field}`;
        });
        this.elements.title.textContent = copy.title;
        this.elements.description.textContent = copy.description;
        document.title = `${copy.title} — ${window.i18n?.get?.('app.name') || 'Screening'}`;

        document.querySelectorAll('[data-catalog-category]').forEach(link => {
            link.classList.toggle('is-active', link.dataset.catalogCategory === this.state.category);
            link.setAttribute('aria-current', link.dataset.catalogCategory === this.state.category ? 'page' : 'false');
        });
    }

    syncControlsFromState() {
        this.elements.sort.value = this.state.sort;
        this.elements.yearFrom.value = this.state.yearFrom;
        this.elements.yearTo.value = this.state.yearTo;
        this.yearRangeControl?.syncFromNative();
        this.state.yearFrom = this.elements.yearFrom.value.trim();
        this.state.yearTo = this.elements.yearTo.value.trim();
        this.elements.genre.value = this.state.genre;
        this.elements.country.value = this.state.country;
        this.selectControls?.sort?.syncFromNative();
        this.selectControls?.genre?.syncFromNative();
    }

    bindEvents() {
        // Hidden Kinopoisk pages queued for these cards must not outlive the page.
        window.addEventListener('pagehide', event => {
            if (!event.persisted) this.ratingEnricher?.dispose();
        });

        const reloadFromControls = () => {
            this.state.sort = this.elements.sort.value;
            this.state.yearFrom = this.elements.yearFrom.value.trim();
            this.state.yearTo = this.elements.yearTo.value.trim();
            this.state.genre = this.elements.genre.value;
            this.state.country = this.elements.country.value.trim().toUpperCase();
            this.writeStateToUrl();
            this.renderHeader();
            this.loadFirstPage();
        };

        [this.elements.sort, this.elements.yearFrom, this.elements.yearTo, this.elements.genre, this.elements.country]
            .forEach(control => control?.addEventListener('change', reloadFromControls));

        this.elements.country?.addEventListener('input', () => {
            this.elements.country.value = this.elements.country.value.replace(/[^a-z]/gi, '').slice(0, 2).toUpperCase();
        });

        this.elements.reset?.addEventListener('click', () => this.resetFilters());
        this.elements.emptyReset?.addEventListener('click', () => this.resetFilters());
        this.elements.retry?.addEventListener('click', () => this.loadFirstPage(true));
        this.elements.loadMoreButton?.addEventListener('click', () => this.loadNextPage(false));

        window.addEventListener('popstate', () => {
            this.state = this.readStateFromUrl();
            this.renderHeader();
            this.syncControlsFromState();
            this.loadFirstPage();
        });
    }

    setupObserver() {
        if (!this.elements.sentinel || typeof IntersectionObserver === 'undefined') return;
        this.observer = new IntersectionObserver(entries => {
            if (!entries.some(entry => entry.isIntersecting)) return;
            if (this.autoLoadCount >= this.maxAutoLoads) return;
            this.autoLoadCount += 1;
            this.loadNextPage(true);
        }, { rootMargin: '800px 0px' });
        this.observer.observe(this.elements.sentinel);
    }

    writeStateToUrl() {
        const url = new URL(window.location.href);
        url.searchParams.set('category', this.state.category);
        const optional = ['sort', 'yearFrom', 'yearTo', 'genre', 'country', 'keyword'];
        optional.forEach(key => {
            const value = this.state[key];
            if (value && !(key === 'sort' && value === 'popularity.desc')) url.searchParams.set(key, value);
            else url.searchParams.delete(key);
        });
        window.history.pushState({}, document.title, url.toString());
    }

    resetFilters() {
        this.state = { ...this.state, sort: 'popularity.desc', yearFrom: '', yearTo: '', genre: '', country: '', keyword: '' };
        this.writeStateToUrl();
        this.syncControlsFromState();
        this.loadFirstPage();
    }

    async loadFirstPage(forceRefresh = false) {
        // A new filter/sort supersedes any pending page, including load-more.
        this.requestGeneration = (this.requestGeneration || 0) + 1;
        this.currentPage = 0;
        this.totalPages = 1;
        this.totalResults = 0;
        this.seenCatalogKeys.clear();
        this.autoLoadCount = 0;
        this.elements.grid.innerHTML = this.renderSkeletons();
        this.elements.empty.hidden = true;
        this.elements.error.hidden = true;
        this.errorKey = '';
        this.elements.loadMore.hidden = true;
        this.elements.count.textContent = '—';
        await this.loadPage(1, { replace: true, forceRefresh });
    }

    async loadNextPage(fromObserver) {
        if (this.isLoading || this.currentPage >= this.totalPages) return;
        if (fromObserver && this.autoLoadCount > this.maxAutoLoads) return;
        await this.loadPage(this.currentPage + 1);
    }

    async loadPage(page, { replace = false, forceRefresh = false } = {}) {
        const generation = this.requestGeneration;
        this.isLoading = true;
        this.setLoadingState(true);
        if (!replace) this.setStatus('');

        try {
            const result = await this.catalogService.getCategoryPage(
                this.state.category,
                this.getQuery(page),
                { forceRefresh }
            );

            if (generation !== this.requestGeneration) return;

            if (replace) this.elements.grid.innerHTML = '';
            const newItems = result.items.filter(item => {
                const key = this.getCatalogItemKey(item);
                if (this.seenCatalogKeys.has(key)) return false;
                this.seenCatalogKeys.add(key);
                return true;
            });
            this.appendItems(newItems);

            this.currentPage = Number(result.page) || page;
            this.totalPages = Math.max(this.currentPage, Number(result.totalPages) || this.currentPage);
            this.totalResults = Number(result.totalResults) || this.seenCatalogKeys.size;
            this.elements.count.textContent = this.formatCount(this.totalResults);
            this.elements.empty.hidden = this.seenCatalogKeys.size > 0;
            this.elements.error.hidden = true;
            this.elements.loadMore.hidden = !this.hasMorePages();
            this.setStatus(result.isStale ? 'stale' : '');
        } catch (error) {
            if (generation !== this.requestGeneration) return;
            console.error('[CatalogPage] Failed to load catalogue page:', error);
            if (replace) {
                this.elements.grid.innerHTML = '';
                this.elements.empty.hidden = true;
                this.elements.error.hidden = false;
                this.errorKey = this.getErrorKey(error);
                this.elements.errorMessage.textContent = this.t(this.errorKey);
            } else {
                this.setStatus(this.getErrorKey(error));
                this.elements.loadMore.hidden = false;
            }
        } finally {
            if (generation === this.requestGeneration) {
                this.isLoading = false;
                this.setLoadingState(false);
            }
        }
    }

    appendItems(items) {
        const fragment = document.createDocumentFragment();
        items.forEach((item, index) => {
            const card = this.renderer.createMovieCard(item);
            if (!card) return;
            card.style.animationDelay = `${Math.min(index * 28, 360)}ms`;
            card.classList.add('home-card-animate');
            fragment.appendChild(card);
        });
        this.elements.grid.appendChild(fragment);
        this.renderer.bindMovieCardNavigation(this.elements.grid);
        this.ratingEnricher?.observe?.(this.elements.grid);
    }

    renderSkeletons() {
        return Array.from({ length: 12 }, () => '<div class="catalog-skeleton" aria-hidden="true"></div>').join('');
    }

    getCatalogItemKey(item) {
        const mediaType = String(item?.mediaType || item?.type || 'movie').toLowerCase();
        return `${mediaType}:${Number(item?.tmdbId)}`;
    }

    hasMorePages() {
        return this.currentPage < this.totalPages && this.seenCatalogKeys.size > 0;
    }

    setLoadingState(isLoading) {
        this.elements.progress.hidden = !isLoading;
        this.elements.loadMoreButton.disabled = isLoading;
        this.elements.loadMoreButton.textContent = this.t(isLoading ? 'loading' : 'load_more');
    }

    /* Takes a `catalog` locale key, so a language change can render the same status again. */
    setStatus(key) {
        this.statusKey = key || '';
        this.elements.status.textContent = this.statusKey ? this.t(this.statusKey) : '';
    }

    formatCount(value) {
        return value > 0 ? new Intl.NumberFormat(this.getLocale() === 'ru' ? 'ru-RU' : 'en-US').format(value) : '—';
    }

    getErrorKey(error) {
        if (error?.name === 'AbortError') return 'error_aborted';
        if (String(error?.message || '').includes('not configured')) return 'error_not_configured';
        return 'error_generic';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.catalogPage = new CatalogPage();
    window.catalogPage.init().catch(error => {
        console.error('[CatalogPage] Initialization failed:', error);
    });
});

if (typeof window !== 'undefined') window.CatalogPage = CatalogPage;
