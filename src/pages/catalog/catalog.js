const DEFAULT_CATALOG_SORT_OPTIONS = Object.freeze([
    Object.freeze({ value: 'popularity.desc', label: 'Популярные' }),
    Object.freeze({ value: 'vote_average.desc', label: 'По рейтингу' }),
    Object.freeze({ value: 'primary_release_date.desc', label: 'Новые фильмы' })
]);

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
        this.yearRangeControl = RangeControl.enhance(this.elements.yearFrom, this.elements.yearTo, {
            fromLabel: 'Год от', toLabel: 'Год до'
        });

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
    }

    async init() {
        await window.i18n?.init?.();
        this.initNavigation();
        this.bindEvents();
        this.renderHeader();
        this.syncControlsFromState();
        this.setupObserver();
        await this.loadFirstPage();
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
            country: params.get('country') || ''
        };
    }

    getCategoryConfig() {
        const categories = window.CATALOG_CATEGORIES || {};
        return categories[this.state.category] || categories.films;
    }

    getSortOptions() {
        return this.getCategoryConfig().sortOptions || DEFAULT_CATALOG_SORT_OPTIONS;
    }

    getQuery(page = 1) {
        return {
            page,
            pageSize: this.getCatalogPageSize(),
            sort: this.state.sort,
            yearFrom: this.state.yearFrom,
            yearTo: this.state.yearTo,
            genre: this.state.genre,
            country: this.state.country
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
        const config = this.getCategoryConfig();
        const sortOptions = this.getSortOptions();
        if (!sortOptions.some(option => option.value === this.state.sort)) {
            this.state.sort = sortOptions[0]?.value || 'popularity.desc';
        }
        this.selectControls?.sort?.setOptions(sortOptions);
        this.elements.title.textContent = config.title;
        this.elements.description.textContent = config.description;
        document.title = `${config.title} | Movie Rating Extension`;

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
        const optional = ['sort', 'yearFrom', 'yearTo', 'genre', 'country'];
        optional.forEach(key => {
            const value = this.state[key];
            if (value && !(key === 'sort' && value === 'popularity.desc')) url.searchParams.set(key, value);
            else url.searchParams.delete(key);
        });
        window.history.pushState({}, document.title, url.toString());
    }

    resetFilters() {
        this.state = { ...this.state, sort: 'popularity.desc', yearFrom: '', yearTo: '', genre: '', country: '' };
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
            this.setStatus(result.isStale ? 'Показана сохранённая версия. Обновление источника временно недоступно.' : '');
        } catch (error) {
            if (generation !== this.requestGeneration) return;
            console.error('[CatalogPage] Failed to load catalogue page:', error);
            if (replace) {
                this.elements.grid.innerHTML = '';
                this.elements.empty.hidden = true;
                this.elements.error.hidden = false;
                this.elements.errorMessage.textContent = this.getErrorMessage(error);
            } else {
                this.setStatus(this.getErrorMessage(error));
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
        this.elements.loadMoreButton.textContent = isLoading ? 'Загрузка…' : 'Загрузить ещё';
    }

    setStatus(message) {
        this.elements.status.textContent = message || '';
    }

    formatCount(value) {
        return value > 0 ? new Intl.NumberFormat('ru-RU').format(value) : '—';
    }

    getErrorMessage(error) {
        if (error?.name === 'AbortError') return 'Загрузка была отменена.';
        if (String(error?.message || '').includes('not configured')) return 'TMDB не настроен для каталога.';
        return 'Не удалось загрузить каталог. Попробуйте ещё раз.';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.catalogPage = new CatalogPage();
    window.catalogPage.init().catch(error => {
        console.error('[CatalogPage] Initialization failed:', error);
    });
});

if (typeof window !== 'undefined') window.CatalogPage = CatalogPage;
