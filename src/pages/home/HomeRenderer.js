/**
 * HomeRenderer - Presentation Layer for Home Page
 * Pure DOM generation and template rendering with zero service dependencies.
 */

// Cards visible on the first slider page load eagerly; later slides are lazy.
const HOME_FEATURED_EAGER_COUNT = 5;
const HOME_GRID_SKELETON_COUNT = 6;

class HomeRenderer {
    constructor(options = {}) {
        this.navigationOptions = options;
        this.ratingEnricher = options.ratingEnricher || null;
        this.personalTierStates = new WeakMap();
    }

    /**
     * Localized Home text with a Russian fallback (the page's original copy).
     * @param {string} key
     * @param {string} fallback
     * @param {Object} [params]
     * @returns {string}
     */
    t(key, fallback, params = null) {
        const fullKey = `home.${key}`;
        const value = (typeof window !== 'undefined' && window.i18n?.get) ? window.i18n.get(fullKey) : null;
        let text = value && value !== fullKey ? value : fallback;
        if (params) {
            Object.entries(params).forEach(([name, replacement]) => {
                text = text.replace(`{${name}}`, String(replacement));
            });
        }
        return text;
    }

    bindMovieCardNavigation(container, options = {}) {
        if (typeof Utils !== 'undefined' && Utils.bindMovieCardNavigation) {
            Utils.bindMovieCardNavigation(container, { ...this.navigationOptions, ...options });
        }
    }

    /**
     * Placeholder cards shown while discovery data loads, so sections keep
     * their height instead of popping in and shifting the page.
     * @param {HTMLElement} container
     * @param {number} [count]
     */
    renderGridSkeleton(container, count = HOME_GRID_SKELETON_COUNT) {
        if (!container) return;
        container.setAttribute('aria-busy', 'true');
        container.innerHTML = Array.from({ length: count }, () => `
            <div class="home-skeleton-card" aria-hidden="true">
                <div class="home-skeleton-poster"></div>
                <div class="home-skeleton-line"></div>
                <div class="home-skeleton-line home-skeleton-line--short"></div>
            </div>
        `).join('');
    }

    renderFeaturedSkeleton(container, count = HOME_FEATURED_EAGER_COUNT) {
        if (!container) return;
        container.setAttribute('aria-busy', 'true');
        container.innerHTML = Array.from({ length: count }, () => (
            '<div class="featured-card featured-card--skeleton" aria-hidden="true"><div class="featured-poster home-skeleton-block"></div></div>'
        )).join('');
    }

    /**
     * Show skeletons in every discovery section.
     * @param {HTMLElement} featuredContainer
     * @param {Object} elements
     */
    renderDiscoverySkeletons(featuredContainer, elements = {}) {
        this.renderFeaturedSkeleton(featuredContainer);
        [elements.filmsGrid, elements.seriesGrid, elements.cartoonsGrid, elements.tvShowsGrid]
            .forEach(grid => this.renderGridSkeleton(grid));
    }

    /**
     * Inline discovery failure: personal sections stay usable while the
     * provider-backed sections offer a retry.
     * @param {HTMLElement} featuredContainer
     * @param {Object} elements
     * @param {Function} onRetry
     */
    renderDiscoveryError(featuredContainer, elements = {}, onRetry = null) {
        if (featuredContainer) {
            featuredContainer.innerHTML = '';
            featuredContainer.removeAttribute('aria-busy');
        }
        const grids = [elements.filmsGrid, elements.seriesGrid, elements.cartoonsGrid, elements.tvShowsGrid].filter(Boolean);
        grids.forEach((grid, index) => {
            grid.removeAttribute('aria-busy');
            if (index > 0) {
                grid.innerHTML = '';
                return;
            }
            grid.innerHTML = `
                <div class="home-section-message" role="alert">
                    <p>${this.escapeHtml(this.t('discovery_error', 'Не удалось загрузить подборки'))}</p>
                    <button type="button" class="home-section-retry">${this.escapeHtml(this.t('retry', 'Повторить'))}</button>
                </div>
            `;
            const retry = grid.querySelector('.home-section-retry');
            if (retry && typeof onRetry === 'function') retry.addEventListener('click', onRetry);
        });
    }

    /**
     * Render items in the Featured Hero Slider
     * @param {Array} items
     * @param {HTMLElement} container
     */
    renderFeaturedSlider(items = [], container) {
        if (!container) return;
        container.removeAttribute('aria-busy');
        if (!Array.isArray(items) || items.length === 0) {
            container.innerHTML = '';
            return;
        }

        container.innerHTML = items.map((item, index) => this.renderFeaturedSlide(item, index, items.length)).join('');

        this.bindMovieCardNavigation(container);
        this.ratingEnricher?.observe?.(container);
    }

    /**
     * Bookmarks and community documents keep whatever poster URL was saved:
     * Kinopoisk `orig` (~220 KB) or TMDB `original` (~1 MB). Cards need ~300px.
     * @param {string} url
     * @returns {string}
     */
    getCardPosterUrl(url) {
        if (typeof url !== 'string' || !url) return '';
        if (url.includes('image.tmdb.org/t/p/original/')) {
            return url.replace('/t/p/original/', '/t/p/w342/');
        }
        if (/^https:\/\/avatars\.mds\.yandex\.net\/get-kinopoisk-image\//.test(url)) {
            return url.replace(/\/(?:orig|x1000|600x900|1000x1500)$/, '/300x450');
        }
        return url;
    }

    /**
     * Short "where you stopped" label for a Continue watching card.
     * @param {Object} progress
     * @param {string} type
     * @returns {string}
     */
    formatWatchProgress(progress, type = '') {
        if (!progress) return '';
        const season = progress.season;
        const episode = progress.episode;
        const isMovie = type === 'movie' || type === 'film';
        if (!isMovie && (season || episode)) {
            if (season && episode) return this.t('progress.season_episode', '{season} сезон, {episode} серия', { season, episode });
            if (episode) return this.t('progress.episode', '{episode} серия', { episode });
            return this.t('progress.season', '{season} сезон', { season });
        }
        const seconds = Math.floor(Number(progress.timestamp) || 0);
        if (seconds <= 0) return '';
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const rest = String(seconds % 60).padStart(2, '0');
        const time = hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
        return this.t('progress.time', 'Остановились на {time}', { time });
    }

    renderPersonalSkeleton(container) {
        if (!container) return;
        const current = this.personalTierStates.get(container);
        if (current?.mode === 'content') return;
        if (current?.mode === 'skeleton') {
            current.sections.forEach((section, kind) => {
                this.patchPersonalHeaderText(section, this.getPersonalSectionHeader(kind));
            });
            return;
        }
        this.resetPersonalTier(container);
        container.setAttribute('aria-busy', 'true');
        const sections = new Map();
        ['watching', 'watchlist'].forEach(kind => {
            const section = this.createPersonalSection(kind);
            const count = section.node.querySelector('.section-count-badge');
            count.textContent = '—';
            count.setAttribute('aria-hidden', 'true');
            this.renderGridSkeleton(section.grid);
            sections.set(kind, section);
            container.appendChild(section.node);
        });
        this.personalTierStates.set(container, { mode: 'skeleton', sections });
    }

    resetPersonalTier(container) {
        if (!container) return;
        this.personalTierStates.delete(container);
        if (container.childNodes.length) container.replaceChildren();
        if (container.hasAttribute('aria-busy')) container.removeAttribute('aria-busy');
    }

    getPersonalSectionHeader(kind, total = 0) {
        const watching = kind === 'watching';
        return {
            icon: watching
                ? '<svg class="section-header-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>'
                : '<svg class="section-header-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>',
            title: watching ? this.t('continue_watching', 'Продолжить просмотр') : this.t('watchlist', 'Буду смотреть'),
            total,
            href: watching ? '../bookmarks/bookmarks.html?filter=watching' : '../bookmarks/bookmarks.html?filter=plan_to_watch',
            linkText: watching ? this.t('see_all.watching', 'Все просмотры') : this.t('see_all.watchlist', 'Все закладки')
        };
    }

    createPersonalSection(kind) {
        const node = document.createElement('div');
        node.className = 'category-section home-personal-category';
        const header = this.getPersonalSectionHeader(kind);
        node.innerHTML = `${this.renderSectionHeader(header)}<div class="grid-container" id="home-${kind}-grid"></div>`;
        return { node, grid: node.querySelector('.grid-container'), cards: new Map(), header };
    }

    patchPersonalHeaderText(section, header) {
        if (header.title !== section.header.title) {
            section.node.querySelector('h2').firstChild.nodeValue = `${header.title} `;
        }
        if (header.linkText !== section.header.linkText) {
            section.node.querySelector('.section-see-all span').textContent = header.linkText;
        }
        section.header = header;
    }

    /**
     * Hero cards are wider than grid cards; use the next TMDB size up.
     * @param {string} url
     * @returns {string}
     */
    getFeaturedPosterUrl(url) {
        if (typeof url !== 'string') return '';
        return url.replace(/\/t\/p\/(?:w342|original)\//, '/t/p/w500/');
    }

    /**
     * Generate HTML for a single Hero slider card
     * @param {Object} item
     * @param {number} [index=0]
     * @param {number} [total=0]
     * @returns {string}
     */
    renderFeaturedSlide(item, index = 0, total = 0) {
        const movieId = (typeof Utils !== 'undefined' && Utils.extractKinopoiskId) ? Utils.extractKinopoiskId(item) : (item.kinopoiskId || item.movieId || null);
        const tmdbId = Number(item.tmdbId) || null;
        const originalTitle = item.alternativeName || item.originalTitle || item.originalName || item.original_title || item.original_name || item.nameEn || item.englishName || item.movieTitleEn || '';
        const englishTitle = item.englishTitle || item.nameEn || item.englishName || item.movieTitleEn || item.originalTitle || item.original_title || item.original_name || item.alternativeName || '';
        const title = this.escapeHtml(item.name || item.movieTitle || item.title || this.t('untitled', 'Без названия'));
        const poster = this.escapeHtml(this.getFeaturedPosterUrl(item.posterUrl || item.posterPath || item.poster || '') || '../../shared/assets/icons/app/icon128-black.png');
        const linkUrl = movieId ? chrome.runtime.getURL(`src/pages/movie-details/movie-details.html?movieId=${encodeURIComponent(movieId)}`) : '#';
        const providerBadges = [];
        const kpRating = Number(item.kpRating) || 0;
        const imdbRating = Number(item.imdbRating) || 0;
        if (kpRating > 0) {
            providerBadges.push(`<span class="featured-rating-badge featured-rating-badge--kp" title="${this.escapeHtml(this.t('rating_kp', 'Оценка Кинопоиска'))}">КП ${kpRating.toFixed(1)}</span>`);
        }
        if (imdbRating > 0) {
            providerBadges.push(`<span class="featured-rating-badge featured-rating-badge--imdb" title="${this.escapeHtml(this.t('rating_imdb', 'Оценка IMDb'))}">IMDb ${imdbRating.toFixed(1)}</span>`);
        }
        if (kpRating <= 0) {
            providerBadges.push(`<span class="featured-rating-badge featured-rating-badge--loading" aria-label="${this.escapeHtml(this.t('rating_kp_loading', 'Загрузка рейтинга КП'))}"><span>КП</span><i></i></span>`);
        }
        if (imdbRating <= 0) {
            providerBadges.push(`<span class="featured-rating-badge featured-rating-badge--loading" aria-label="${this.escapeHtml(this.t('rating_imdb_loading', 'Загрузка рейтинга IMDb'))}"><span>IMDb</span><i></i></span>`);
        }
        const ratingBadge = `<div class="featured-badge-overlay">${providerBadges.join('')}</div>`;
        const delay = Math.min(index * 40, 400);
        const isEager = index < HOME_FEATURED_EAGER_COUNT;
        const loadingAttributes = isEager
            ? `loading="eager"${index < 2 ? ' fetchpriority="high"' : ''}`
            : 'loading="lazy"';
        const year = this.escapeHtml(item.year || '');
        const mediaType = this.escapeHtml(item.mediaType || item.type || 'movie');
        const imdbId = /^tt\d{7,10}$/.test(item.imdbId || '') ? item.imdbId : '';
        const ratingAttributes = `${kpRating > 0 ? ` data-kp-rating="${kpRating}"` : ''}${imdbRating > 0 ? ` data-imdb-rating="${imdbRating}"` : ''}${imdbId ? ` data-imdb-id="${imdbId}"` : ''}`;
        const slideLabel = total > 0
            ? ` aria-roledescription="slide" aria-label="${this.escapeHtml(this.t('slider.slide_of', '{index} из {total}: {title}', { index: index + 1, total, title: item.name || item.title || '' }))}"`
            : '';

        return `
            <a href="${linkUrl}" class="featured-card home-hero-animate" style="animation-delay: ${delay}ms" data-slide-index="${index}"${slideLabel} data-action="view-details" data-movie-id="${this.escapeHtml(movieId || '')}" ${tmdbId ? `data-tmdb-id="${tmdbId}"` : ''}${ratingAttributes} data-is-tmdb-only="${item.isTmdbOnly ? 'true' : 'false'}" data-movie-title="${title}" data-movie-original-title="${this.escapeHtml(originalTitle)}" data-movie-english-title="${this.escapeHtml(englishTitle)}"${item.searchTitle ? ` data-movie-search-title="${this.escapeHtml(item.searchTitle)}"` : ''} data-movie-year="${year}" data-media-type="${mediaType}">
                <img class="featured-poster" src="${poster}" alt="${title}" draggable="false" width="256" height="380" ${loadingAttributes} decoding="async">
                ${ratingBadge}
                <div class="featured-overlay">
                    <p class="featured-title">${title}</p>
                </div>
            </a>
        `;
    }

    /**
     * Render a grid of movie cards using MovieCard component
     * @param {Array} items
     * @param {HTMLElement} container
     * @param {Object} [options]
     */
    renderCategoryGrid(items = [], container, options = {}) {
        if (!container) return;

        container.innerHTML = '';
        container.removeAttribute('aria-busy');

        if (!Array.isArray(items) || items.length === 0) {
            container.innerHTML = `<p class="home-section-empty">${this.escapeHtml(this.t('no_data', 'Нет данных'))}</p>`;
            return;
        }

        const fragment = document.createDocumentFragment();
        items.forEach((item, index) => {
            const cardEl = this.createMovieCard(item, options);
            if (cardEl) {
                const delay = Math.min(index * 35, 400);
                cardEl.classList.remove('fade-in');
                cardEl.classList.add('home-card-animate');
                cardEl.style.animationDelay = `${delay}ms`;
                fragment.appendChild(cardEl);
            }
        });

        container.appendChild(fragment);
        this.applyAiringBadges(items, container);

        this.bindMovieCardNavigation(container);
        this.ratingEnricher?.observe?.(container);
    }

    /**
     * Label anime that is coming out now, so a series that premiered years
     * ago but has new episodes this week does not read as an old title.
     * @param {Array<Object>} items
     * @param {HTMLElement} container
     */
    applyAiringBadges(items = [], container) {
        if (!container) return;
        const cards = container.querySelectorAll('.movie-card-component');
        items.forEach((item, index) => {
            if (!item?.airingStatus) return;
            const poster = cards[index]?.querySelector('.mc-poster-container');
            if (!poster) return;
            const label = item.airingStatus === 'new'
                ? this.t('badges.new', 'Новинка')
                : (item.seasonNumber
                    ? this.t('badges.season', '{season} сезон', { season: item.seasonNumber })
                    : this.t('badges.airing', 'Новые серии'));
            const badge = document.createElement('span');
            badge.className = `home-airing-badge home-airing-badge--${item.airingStatus === 'new' ? 'new' : 'airing'}`;
            badge.textContent = label;
            poster.appendChild(badge);
        });
    }

    /**
     * Render all discovery categories
     * @param {Object} discoveryData
     * @param {Object} elements
     */
    renderCategoryGrids(discoveryData = {}, elements = {}) {
        const { filmsGrid, seriesGrid, cartoonsGrid, tvShowsGrid } = elements;

        this.renderCategoryGrid(discoveryData.films, filmsGrid);
        this.renderCategoryGrid(discoveryData.series, seriesGrid);
        this.renderCategoryGrid(discoveryData.cartoons, cartoonsGrid);
        this.renderCategoryGrid(discoveryData.anime || discoveryData.shows || [], tvShowsGrid);
    }

    renderSectionHeader({ icon, title, total, href, linkText }) {
        return `
            <div class="section-header">
                <div class="section-header-title">
                    ${icon}
                    <h2>${this.escapeHtml(title)} <span class="section-count-badge">${Number(total) || 0}</span></h2>
                </div>
                <a href="${href}" class="section-see-all">
                    <span>${this.escapeHtml(linkText)}</span>
                    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
                </a>
            </div>
        `;
    }

    /**
     * Render Personal Tier (CTA banner for guests, Watching / Watchlist for users)
     * @param {Object} personalData
     * @param {HTMLElement} container
     * @param {Function} [onSignInClick]
     */
    renderPersonalTier(personalData = {}, container, onSignInClick, onRetry = null) {
        if (!container) return;
        let state = this.personalTierStates.get(container);
        if (state?.userId && personalData.userId && state.userId !== personalData.userId) {
            this.resetPersonalTier(container);
            state = null;
        }

        if (personalData.isAuthenticated && personalData.loadFailed) {
            // A failed refresh must not discard already usable personal cards.
            if (state?.mode === 'content') return;
            const errorText = this.t('personal_error', 'Не удалось загрузить ваши закладки');
            const retryText = this.t('retry', 'Повторить');
            const textSignature = JSON.stringify([errorText, retryText]);
            if (state?.mode === 'error' && state.textSignature === textSignature) {
                state.onRetry = onRetry;
                return;
            }
            this.resetPersonalTier(container);
            container.innerHTML = `
                <div class="home-section-message" role="alert">
                    <p>${this.escapeHtml(errorText)}</p>
                    <button type="button" class="home-section-retry">${this.escapeHtml(retryText)}</button>
                </div>
            `;
            state = { mode: 'error', onRetry, textSignature, userId: personalData.userId };
            this.personalTierStates.set(container, state);
            const retry = container.querySelector('.home-section-retry');
            if (retry) retry.addEventListener('click', () => state.onRetry?.());
            return;
        }

        if (!personalData.isAuthenticated) {
            const titleText = this.t('cta.title', 'Синхронизируйте просмотр и списки');
            const bodyText = this.t('cta.text', 'Сохраняйте фильмы в закладки, продолжайте просмотр с любого места и делитесь оценками с друзьями.');
            const buttonText = this.t('cta.button', 'Войти / Зарегистрироваться');
            const textSignature = JSON.stringify([titleText, bodyText, buttonText]);
            if (state?.mode === 'guest' && state.textSignature === textSignature) {
                state.onSignInClick = onSignInClick;
                return;
            }
            this.resetPersonalTier(container);
            container.innerHTML = `
                <div class="home-cta-card">
                    <div class="home-cta-content">
                        <div class="home-cta-icon">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
                            </svg>
                        </div>
                        <div class="home-cta-text">
                            <h2>${this.escapeHtml(titleText)}</h2>
                            <p>${this.escapeHtml(bodyText)}</p>
                        </div>
                    </div>
                    <button type="button" class="home-cta-btn" id="homeSignInBtn">${this.escapeHtml(buttonText)}</button>
                </div>
            `;

            state = { mode: 'guest', onSignInClick, textSignature };
            this.personalTierStates.set(container, state);
            const signInBtn = container.querySelector('#homeSignInBtn');
            if (signInBtn) signInBtn.addEventListener('click', () => state.onSignInClick?.());
            return;
        }

        if (!personalData.hasContent) {
            const emptyText = this.t('empty_personal', 'У вас пока нет активных просмотров и сохраненных закладок');
            const exploreText = this.t('explore_catalog', 'Найти фильм в каталоге');
            const textSignature = JSON.stringify([emptyText, exploreText]);
            if (state?.mode === 'empty' && state.textSignature === textSignature) return;
            this.resetPersonalTier(container);
            container.innerHTML = `
                <div class="home-empty-personal">
                    <p>${this.escapeHtml(emptyText)}</p>
                    <a href="../catalog/catalog.html?category=films" class="home-explore-btn">${this.escapeHtml(exploreText)}</a>
                </div>
            `;
            this.personalTierStates.set(container, { mode: 'empty', userId: personalData.userId, textSignature });
            return;
        }

        if (!state || !['content', 'skeleton'].includes(state.mode)) {
            this.resetPersonalTier(container);
            state = { sections: new Map() };
        }
        if (container.hasAttribute('aria-busy')) container.removeAttribute('aria-busy');
        state.mode = 'content';
        state.userId = personalData.userId;
        this.personalTierStates.set(container, state);

        const gridsToObserve = [];
        ['watching', 'watchlist'].forEach((kind, index) => {
            const items = Array.isArray(personalData[kind]) ? personalData[kind] : [];
            let section = state.sections.get(kind);
            if (!items.length) {
                section?.node.remove();
                state.sections.delete(kind);
                return;
            }
            if (!section) {
                section = this.createPersonalSection(kind);
                state.sections.set(kind, section);
            }
            const header = this.getPersonalSectionHeader(kind, personalData[`${kind}Total`] ?? items.length);
            this.patchPersonalHeaderText(section, header);
            const count = section.node.querySelector('.section-count-badge');
            const totalText = String(Number(header.total) || 0);
            if (count.textContent !== totalText) count.textContent = totalText;
            if (count.hasAttribute('aria-hidden')) count.removeAttribute('aria-hidden');
            const options = kind === 'watching' ? { isWatching: true } : { isInWatchlist: true };
            if (this.patchPersonalGrid(items, section, options)) gridsToObserve.push(section.grid);
            // Mount both sections before handing any card to the observer.
            const preceding = index === 0 ? null : state.sections.get('watching')?.node;
            const anchor = preceding ? preceding.nextSibling : container.firstChild;
            if (anchor !== section.node) container.insertBefore(section.node, anchor);
        });
        gridsToObserve.forEach(grid => {
            this.bindMovieCardNavigation(grid);
            if (grid.isConnected) this.ratingEnricher?.observe?.(grid);
        });
    }

    patchPersonalGrid(items, section, options) {
        const { grid, cards } = section;
        const wanted = new Set();
        let newCards = false;
        if (grid.hasAttribute('aria-busy')) {
            grid.replaceChildren();
            grid.removeAttribute('aria-busy');
        }
        items.forEach((item, index) => {
            const data = this.getMovieCardData(item, options);
            const key = String(data.movieId || (data.movie.tmdbId ? `tmdb:${data.movie.type}:${data.movie.tmdbId}` : data.id || index));
            if (wanted.has(key)) return;
            wanted.add(key);
            const signature = JSON.stringify([data, this.t('continue_watching', 'Продолжить просмотр')]);
            let entry = cards.get(key);
            if (!entry || entry.signature !== signature) {
                const node = this.createMovieCard(item, options);
                if (!node) return;
                node.classList.remove('fade-in');
                if (entry) {
                    this.preservePersonalEnrichment(entry, node, data);
                    const active = document.activeElement;
                    const focusedIndex = entry.node.contains(active)
                        ? Array.from(entry.node.querySelectorAll('a, button, [tabindex]')).indexOf(active) : -1;
                    entry.node.replaceWith(node);
                    if (focusedIndex >= 0) node.querySelectorAll('a, button, [tabindex]')[focusedIndex]?.focus({ preventScroll: true });
                } else {
                    node.classList.add('home-card-animate');
                    node.style.animationDelay = `${Math.min(index * 35, 400)}ms`;
                }
                entry = { node, signature, data };
                cards.set(key, entry);
                newCards = true;
            }
            const anchor = grid.children[wanted.size - 1] || null;
            if (anchor !== entry.node) {
                const active = document.activeElement;
                const retainedFocus = entry.node.contains(active);
                if (entry.node.isConnected && entry.node.classList.contains('home-card-animate')) {
                    entry.node.classList.remove('home-card-animate');
                    entry.node.style.removeProperty('animation-delay');
                }
                grid.insertBefore(entry.node, anchor);
                if (retainedFocus) active.focus({ preventScroll: true });
            }
            this.patchWatchProgress(entry.node, options.isWatching
                ? this.formatWatchProgress(item?.watchProgress, item?.type || item?.movie?.type || '') : '');
        });
        cards.forEach((entry, key) => {
            if (!wanted.has(key)) {
                entry.node.remove();
                cards.delete(key);
            }
        });
        return newCards;
    }

    preservePersonalEnrichment(entry, node, data) {
        const previous = entry.data.movie;
        if (!this.samePersonalIdentity(previous, data.movie)) return;
        if (Number(entry.node.dataset.movieId) !== Number(node.dataset.movieId)) return;
        const sameProviderInputs = previous.kpRating === data.movie.kpRating && previous.imdbRating === data.movie.imdbRating;
        const oldOverlay = entry.node.querySelector('.mc-badges-overlay');
        const newOverlay = node.querySelector('.mc-badges-overlay');
        if (!sameProviderInputs || !entry.node.dataset.ratingsState || !oldOverlay || !newOverlay) return;
        newOverlay.replaceWith(oldOverlay);
        ['ratingsState', 'ratingsStatus', 'ratingsEnrichmentKey', 'movieId', 'kpRating', 'imdbRating', 'imdbId'].forEach(key => {
            if (entry.node.dataset[key]) node.dataset[key] = entry.node.dataset[key];
        });
        // In-flight work refers to the old element; re-observe its replacement
        // while keeping any already settled provider badge visible.
        if (node.dataset.ratingsState !== 'ready') node.dataset.ratingsState = 'empty';
    }

    samePersonalIdentity(previous, current) {
        const previousKinopoiskId = Number(previous?.kinopoiskId || previous?.movieId) || 0;
        const currentKinopoiskId = Number(current?.kinopoiskId || current?.movieId) || 0;
        if (previousKinopoiskId > 0 || currentKinopoiskId > 0) {
            return previousKinopoiskId > 0 && previousKinopoiskId === currentKinopoiskId;
        }

        const previousTmdbId = Number(previous?.tmdbId) || 0;
        const currentTmdbId = Number(current?.tmdbId) || 0;
        const isTv = value => ['tv', 'tv-series', 'series', 'mini-series', 'animated-series', 'anime', 'cartoon']
            .includes(String(value || '').toLowerCase());
        return previousTmdbId > 0 && previousTmdbId === currentTmdbId
            && isTv(previous?.mediaType || previous?.type) === isTv(current?.mediaType || current?.type);
    }

    patchWatchProgress(card, label) {
        const poster = card.querySelector('.mc-poster-container');
        if (!poster) return;
        let badge = poster.querySelector('.home-progress-badge');
        if (!label) {
            badge?.remove();
            return;
        }
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'home-progress-badge';
            poster.appendChild(badge);
        }
        if (badge.textContent !== label) badge.textContent = label;
    }

    /**
     * Add the playback position to Continue watching cards.
     * @param {Array<Object>} items
     * @param {HTMLElement} grid
     */
    applyWatchProgress(items = [], grid) {
        if (!grid) return;
        const cards = grid.querySelectorAll('.movie-card-component');
        items.forEach((item, index) => {
            const label = this.formatWatchProgress(item?.watchProgress, item?.type || item?.movie?.type || '');
            const poster = cards[index]?.querySelector('.mc-poster-container');
            if (!label || !poster) return;
            this.patchWatchProgress(cards[index], label);
        });
    }

    /**
     * Render Dashboard Block (User statistics + Community Top)
     * @param {Object} dashboardData
     * @param {HTMLElement} container
     */
    renderDashboard(dashboardData = {}, container) {
        if (!container) return;

        if (!dashboardData.isAuthenticated) {
            container.style.display = 'none';
            container.innerHTML = '';
            return;
        }

        const stats = dashboardData.stats || {
            totalRatings: 0,
            averageRating: '—',
            watchingCount: 0,
            watchlistCount: 0
        };

        const communityDocs = dashboardData.communityTop || [];
        const statBox = (icon, value, label) => `
            <div class="home-stat-box">
                <div class="home-stat-icon">${icon}</div>
                <div class="home-stat-value">${this.escapeHtml(value)}</div>
                <div class="home-stat-label">${this.escapeHtml(label)}</div>
            </div>
        `;

        container.innerHTML = `
            <div class="home-dashboard-grid">
                <div class="home-dashboard-card">
                    <h2>
                        <svg class="dashboard-header-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <line x1="18" y1="20" x2="18" y2="10"></line>
                            <line x1="12" y1="20" x2="12" y2="4"></line>
                            <line x1="6" y1="20" x2="6" y2="14"></line>
                        </svg>
                        ${this.escapeHtml(this.t('dashboard.activity', 'Ваша активность'))}
                    </h2>
                    <div class="home-stats-grid">
                        ${statBox('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>', stats.totalRatings, this.t('dashboard.total_ratings', 'Оценок всего'))}
                        ${statBox('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 14 14"></polyline></svg>', stats.averageRating, this.t('dashboard.average_rating', 'Средний балл'))}
                        ${statBox('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>', stats.watchingCount, this.t('dashboard.watching', 'В процессе'))}
                        ${statBox('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>', stats.watchlistCount, this.t('dashboard.watchlist', 'В закладках'))}
                    </div>
                </div>

                <div class="home-dashboard-card">
                    <h2>
                        <svg class="dashboard-header-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                            <circle cx="9" cy="7" r="4"></circle>
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                            <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                        </svg>
                        ${this.escapeHtml(this.t('dashboard.community', 'Выбор сообщества'))}
                    </h2>
                    <div class="home-community-list" id="home-community-grid">
                        ${communityDocs.length === 0 ? `<p class="home-community-empty">${this.escapeHtml(this.t('dashboard.community_empty', 'Пока нет оцененных фильмов'))}</p>` : ''}
                    </div>
                </div>
            </div>
        `;

        const communityGrid = container.querySelector('#home-community-grid');
        if (communityGrid && communityDocs.length > 0) {
            const fragment = document.createDocumentFragment();
            communityDocs.forEach((m, index) => {
                const cardEl = this.createMovieCard(m, { showAverageRating: true });
                if (cardEl) {
                    const delay = Math.min(index * 40, 300);
                    cardEl.classList.add('home-card-animate');
                    cardEl.style.animationDelay = `${delay}ms`;
                    fragment.appendChild(cardEl);
                }
            });
            communityGrid.appendChild(fragment);

            this.bindMovieCardNavigation(communityGrid);
            if (communityGrid.isConnected) this.ratingEnricher?.observe?.(communityGrid);
        }

        container.style.display = 'block';
    }

    /**
     * Adapter to create MovieCard element from normalized item data
     * @param {Object} item
     * @param {Object} [options]
     * @returns {HTMLElement}
     */
    createMovieCard(item, options = {}) {
        const movieCardComponent = typeof window !== 'undefined' ? window.MovieCard : null;
        if (!movieCardComponent || typeof movieCardComponent.create !== 'function') {
            throw new Error('[HomeRenderer] MovieCard component must be loaded before rendering cards');
        }

        const cardData = this.getMovieCardData(item, options);
        const cardOptions = {
            variant: 'search',
            showThreeDotMenu: false,
            showAverageRating: true,
            showUserRating: false,
            showDescription: false,
            showRatingSkeleton: true,
            lazyPoster: true,
            ...options
        };

        return movieCardComponent.create(cardData, cardOptions);
    }

    getMovieCardData(item, options = {}) {
        const movieObj = item.movie || item;
        const isPersonalBookmark = options.isWatching === true || options.isInWatchlist === true;
        // Bookmarks uses the top-level movieId as the saved identity. Legacy
        // nested movie/kinopoiskId fields may describe an older, conflicting
        // mapping, so personal Home cards must keep the same source of truth.
        const bookmarkMovieId = isPersonalBookmark
            ? ((typeof Utils !== 'undefined' && Utils.extractKinopoiskId
                ? Utils.extractKinopoiskId({ movieId: item.movieId })
                    || Utils.extractKinopoiskId({ kinopoiskId: item.kinopoiskId })
                : Number(item.movieId || item.kinopoiskId)) || null)
            : null;
        const validMovieId = bookmarkMovieId || ((typeof Utils !== 'undefined' && Utils.extractKinopoiskId)
            ? Utils.extractKinopoiskId(movieObj)
            : (movieObj.kinopoiskId || movieObj.movieId || null));
        const nestedMovieId = (typeof Utils !== 'undefined' && Utils.extractKinopoiskId)
            ? Utils.extractKinopoiskId(movieObj)
            : Number(movieObj.kinopoiskId || movieObj.movieId) || null;
        const hasConflictingNestedIdentity = !!bookmarkMovieId && !!nestedMovieId
            && Number(bookmarkMovieId) !== Number(nestedMovieId);

        // Keep provider ratings separate: TMDB must never be shown as Kinopoisk.
        const displayKpRating = hasConflictingNestedIdentity
            ? (item.kpRating || item.ratingKp || 0)
            : (movieObj.kpRating || movieObj.ratingKp || 0);
        const displayImdbRating = hasConflictingNestedIdentity
            ? (item.imdbRating || item.ratingImdb || 0)
            : (movieObj.imdbRating || movieObj.ratingImdb || 0);

        return {
            movie: {
                kinopoiskId: validMovieId,
                tmdbId: movieObj.tmdbId || null,
                imdbId: movieObj.imdbId || item.imdbId || '',
                isTmdbOnly: !bookmarkMovieId && !!movieObj.isTmdbOnly,
                name: movieObj.name || movieObj.movieTitle || movieObj.title || '',
                alternativeName: movieObj.alternativeName || movieObj.originalTitle || movieObj.originalName || movieObj.original_title || movieObj.original_name || movieObj.movieTitleEn || '',
                englishTitle: movieObj.englishTitle || movieObj.nameEn || movieObj.englishName || movieObj.movieTitleEn || movieObj.originalTitle || movieObj.original_title || movieObj.original_name || movieObj.alternativeName || '',
                searchTitle: movieObj.searchTitle || '',
                posterUrl: this.getCardPosterUrl(movieObj.posterUrl || movieObj.posterPath || movieObj.poster || ''),
                year: movieObj.year || movieObj.releaseYear || '',
                releaseDate: movieObj.releaseDate || movieObj.release_date || '',
                mediaType: movieObj.mediaType || movieObj.type || 'movie',
                type: movieObj.type || movieObj.mediaType || 'movie',
                genres: Array.isArray(movieObj.genres) ? movieObj.genres : [],
                kpRating: displayKpRating,
                imdbRating: displayImdbRating,
                description: movieObj.description || ''
            },
            id: item.id || item.ratingId || null,
            movieId: validMovieId,
            rating: item.rating || 0,
            averageRating: item.avgRating || item.averageRating || 0,
            ratingsCount: item.ratingsCount || 0,
            isWatching: !!options.isWatching,
            isInWatchlist: !!options.isInWatchlist
        };
    }


    /**
     * Escape special characters for HTML output
     * @param {string} str
     * @returns {string}
     */
    escapeHtml(str) {
        if (str === null || str === undefined || str === '') return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
}

if (typeof window !== 'undefined') {
    window.HomeRenderer = HomeRenderer;
}
