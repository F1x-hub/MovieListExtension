const DEFAULT_CATALOG_SORT_OPTIONS = Object.freeze([
    Object.freeze({ value: 'popularity.desc', label: 'Популярные' }),
    Object.freeze({ value: 'vote_average.desc', label: 'По рейтингу' }),
    Object.freeze({ value: 'primary_release_date.desc', label: 'Новые фильмы' })
]);

class CatalogSelect {
    constructor(select) {
        this.select = select;
        this.root = document.createElement('div');
        this.root.className = 'catalog-select';
        this.root.dataset.catalogSelect = select.id;

        this.trigger = document.createElement('button');
        this.trigger.type = 'button';
        this.trigger.className = 'catalog-select__trigger';
        this.trigger.id = `${select.id}Trigger`;
        this.trigger.setAttribute('aria-haspopup', 'listbox');
        this.trigger.setAttribute('aria-expanded', 'false');

        this.triggerText = document.createElement('span');
        this.triggerText.className = 'catalog-select__value';
        this.trigger.appendChild(this.triggerText);

        this.triggerIcon = document.createElement('span');
        this.triggerIcon.className = 'catalog-select__chevron';
        this.triggerIcon.setAttribute('aria-hidden', 'true');
        this.trigger.appendChild(this.triggerIcon);

        this.menu = document.createElement('div');
        this.menu.className = 'catalog-select__menu';
        this.menu.id = `${select.id}Menu`;
        this.menu.setAttribute('role', 'listbox');
        this.menu.hidden = true;
        this.trigger.setAttribute('aria-controls', this.menu.id);

        const label = Array.from(document.querySelectorAll('label'))
            .find(candidate => candidate.htmlFor === select.id);
        if (label) {
            if (!label.id) label.id = `${select.id}Label`;
            this.trigger.setAttribute('aria-labelledby', label.id);
            label.setAttribute('for', this.trigger.id);
        }

        const parent = select.parentElement;
        parent.insertBefore(this.root, select);
        this.root.append(this.trigger, this.menu, select);
        select.classList.add('catalog-select__native');
        select.tabIndex = -1;
        select.setAttribute('aria-hidden', 'true');

        this.onDocumentPointerDown = event => {
            if (!this.root.contains(event.target)) this.close();
        };
        this.trigger.addEventListener('click', () => this.toggle());
        this.trigger.addEventListener('keydown', event => this.handleTriggerKeydown(event));
        this.menu.addEventListener('click', event => {
            const option = event.target.closest('[role="option"]');
            if (option) this.selectValue(option.dataset.value);
        });
        this.menu.addEventListener('keydown', event => this.handleMenuKeydown(event));
        document.addEventListener('pointerdown', this.onDocumentPointerDown);
        this.syncFromNative();
    }

    static enhance(select) {
        if (!select || select.dataset.customSelectEnhanced === 'true') return null;
        select.dataset.customSelectEnhanced = 'true';
        return new CatalogSelect(select);
    }

    setOptions(options = []) {
        const normalized = options
            .map(option => ({
                value: String(option?.value || ''),
                label: String(option?.label || '')
            }))
            .filter(option => option.value && option.label);
        const currentValue = this.select.value;

        this.select.replaceChildren(...normalized.map(option => {
            const element = document.createElement('option');
            element.value = option.value;
            element.textContent = option.label;
            return element;
        }));
        this.select.value = normalized.some(option => option.value === currentValue)
            ? currentValue
            : (normalized[0]?.value || '');
        this.menu.replaceChildren(...normalized.map((option, index) => {
            const element = document.createElement('button');
            element.type = 'button';
            element.className = 'catalog-select__option';
            element.dataset.value = option.value;
            element.id = `${this.select.id}Option${index}`;
            element.setAttribute('role', 'option');
            element.textContent = option.label;
            return element;
        }));
        this.syncFromNative();
    }

    syncFromNative() {
        const options = Array.from(this.select.options || []);
        const selected = options.find(option => option.value === this.select.value) || options[0];
        if (!selected) {
            this.triggerText.textContent = 'Выбрать';
            return;
        }
        this.select.value = selected.value;
        this.triggerText.textContent = selected.textContent.trim();
        this.menu.querySelectorAll('[role="option"]').forEach(option => {
            const isSelected = option.dataset.value === selected.value;
            option.classList.toggle('is-selected', isSelected);
            option.setAttribute('aria-selected', String(isSelected));
        });
    }

    selectValue(value, { dispatchChange = true } = {}) {
        const option = Array.from(this.select.options || []).find(item => item.value === value);
        if (!option) return;
        this.select.value = option.value;
        this.syncFromNative();
        this.close(true);
        if (dispatchChange) this.select.dispatchEvent(new Event('change', { bubbles: true }));
    }

    toggle() {
        if (this.menu.hidden) this.open();
        else this.close();
    }

    open(focusSelected = false) {
        this.menu.hidden = false;
        this.root.classList.add('is-open');
        this.trigger.setAttribute('aria-expanded', 'true');
        if (focusSelected) {
            this.menu.querySelector('.is-selected')?.focus();
        }
    }

    close(restoreFocus = false) {
        this.menu.hidden = true;
        this.root.classList.remove('is-open');
        this.trigger.setAttribute('aria-expanded', 'false');
        if (restoreFocus) this.trigger.focus();
    }

    handleTriggerKeydown(event) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            this.open(true);
        } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            this.toggle();
        } else if (event.key === 'Escape') {
            this.close();
        }
    }

    handleMenuKeydown(event) {
        const options = Array.from(this.menu.querySelectorAll('[role="option"]'));
        const currentIndex = options.indexOf(document.activeElement);
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const direction = event.key === 'ArrowDown' ? 1 : -1;
            const nextIndex = Math.min(options.length - 1, Math.max(0, currentIndex + direction));
            options[nextIndex]?.focus();
        } else if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            options[event.key === 'Home' ? 0 : options.length - 1]?.focus();
        } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            const option = options[currentIndex];
            if (option) this.selectValue(option.dataset.value);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            this.close(true);
        }
    }
}

class CatalogNumberInput {
    constructor(input) {
        this.input = input;
        this.root = document.createElement('div');
        this.root.className = 'catalog-number';
        this.root.dataset.catalogNumber = input.id;

        this.stepper = document.createElement('div');
        this.stepper.className = 'catalog-number__stepper';

        this.incrementButton = this.createButton('Увеличить год', 1, 'is-up');
        this.decrementButton = this.createButton('Уменьшить год', -1, 'is-down');
        this.stepper.append(this.incrementButton, this.decrementButton);

        const parent = input.parentElement;
        parent.insertBefore(this.root, input);
        this.root.append(input, this.stepper);
        input.classList.add('catalog-number__input');
    }

    static enhance(input) {
        if (!input || input.dataset.catalogNumberEnhanced === 'true') return null;
        input.dataset.catalogNumberEnhanced = 'true';
        return new CatalogNumberInput(input);
    }

    createButton(label, delta, modifier) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `catalog-number__button ${modifier}`;
        button.setAttribute('aria-label', label);
        button.addEventListener('click', () => this.step(delta));
        return button;
    }

    step(delta) {
        const min = Number(this.input.min);
        const max = Number(this.input.max);
        const step = Number(this.input.step) || 1;
        const fallback = delta > 0 ? min : max;
        const current = Number(this.input.value);
        const base = Number.isFinite(current) && current !== 0 ? current : fallback;
        const next = Math.min(max, Math.max(min, base + delta * step));

        if (Number.isFinite(next)) {
            this.input.value = String(next);
            this.input.dispatchEvent(new Event('change', { bubbles: true }));
            this.input.focus();
        }
    }
}

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

        this.customSelects = {
            sort: CatalogSelect.enhance(this.elements.sort),
            genre: CatalogSelect.enhance(this.elements.genre)
        };
        this.customNumberInputs = [this.elements.yearFrom, this.elements.yearTo]
            .map(input => CatalogNumberInput.enhance(input));

        this.state = this.readStateFromUrl();
        this.catalogService = new CatalogService();
        this.kinopoiskService = typeof KinopoiskService !== 'undefined' ? new KinopoiskService() : null;
        this.navigationService = typeof HomeMovieNavigationService !== 'undefined'
            ? new HomeMovieNavigationService({ kinopoiskService: this.kinopoiskService })
            : null;
        this.ratingEnricher = typeof MovieRatingsEnrichmentService !== 'undefined'
            ? new MovieRatingsEnrichmentService({
                kinopoiskService: this.kinopoiskService,
                navigationService: this.navigationService
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
        this.customSelects?.sort?.setOptions(sortOptions);
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
        this.elements.genre.value = this.state.genre;
        this.elements.country.value = this.state.country;
        this.customSelects?.sort?.syncFromNative();
        this.customSelects?.genre?.syncFromNative();
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
        if (this.isLoading) return;
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
        this.isLoading = true;
        this.setLoadingState(true);
        if (!replace) this.setStatus('');

        try {
            const result = await this.catalogService.getCategoryPage(
                this.state.category,
                this.getQuery(page),
                { forceRefresh }
            );

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
            this.isLoading = false;
            this.setLoadingState(false);
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
if (typeof window !== 'undefined') window.CatalogSelect = CatalogSelect;
if (typeof globalThis !== 'undefined') globalThis.CatalogSelect = CatalogSelect;
if (typeof window !== 'undefined') window.CatalogNumberInput = CatalogNumberInput;
if (typeof globalThis !== 'undefined') globalThis.CatalogNumberInput = CatalogNumberInput;
