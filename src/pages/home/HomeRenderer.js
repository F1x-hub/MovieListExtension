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
        container.setAttribute('aria-busy', 'true');
        container.innerHTML = '<div class="category-section"><div class="grid-container" id="home-personal-skeleton"></div></div>';
        this.renderGridSkeleton(container.querySelector('#home-personal-skeleton'));
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
        const slideLabel = total > 0
            ? ` aria-roledescription="slide" aria-label="${this.escapeHtml(this.t('slider.slide_of', '{index} из {total}: {title}', { index: index + 1, total, title: item.name || item.title || '' }))}"`
            : '';

        return `
            <a href="${linkUrl}" class="featured-card home-hero-animate" style="animation-delay: ${delay}ms" data-slide-index="${index}"${slideLabel} data-action="view-details" data-movie-id="${this.escapeHtml(movieId || '')}" ${tmdbId ? `data-tmdb-id="${tmdbId}"` : ''} data-is-tmdb-only="${item.isTmdbOnly ? 'true' : 'false'}" data-movie-title="${title}" data-movie-original-title="${this.escapeHtml(originalTitle)}" data-movie-english-title="${this.escapeHtml(englishTitle)}"${item.searchTitle ? ` data-movie-search-title="${this.escapeHtml(item.searchTitle)}"` : ''} data-movie-year="${year}" data-media-type="${mediaType}">
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
        container.removeAttribute('aria-busy');

        if (personalData.isAuthenticated && personalData.loadFailed) {
            container.innerHTML = `
                <div class="home-section-message" role="alert">
                    <p>${this.escapeHtml(this.t('personal_error', 'Не удалось загрузить ваши закладки'))}</p>
                    <button type="button" class="home-section-retry">${this.escapeHtml(this.t('retry', 'Повторить'))}</button>
                </div>
            `;
            const retry = container.querySelector('.home-section-retry');
            if (retry && typeof onRetry === 'function') retry.addEventListener('click', onRetry);
            return;
        }

        if (!personalData.isAuthenticated) {
            container.innerHTML = `
                <div class="home-cta-card">
                    <div class="home-cta-content">
                        <div class="home-cta-icon">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
                            </svg>
                        </div>
                        <div class="home-cta-text">
                            <h2>${this.escapeHtml(this.t('cta.title', 'Синхронизируйте просмотр и списки'))}</h2>
                            <p>${this.escapeHtml(this.t('cta.text', 'Сохраняйте фильмы в закладки, продолжайте просмотр с любого места и делитесь оценками с друзьями.'))}</p>
                        </div>
                    </div>
                    <button type="button" class="home-cta-btn" id="homeSignInBtn">${this.escapeHtml(this.t('cta.button', 'Войти / Зарегистрироваться'))}</button>
                </div>
            `;

            const signInBtn = container.querySelector('#homeSignInBtn');
            if (signInBtn && typeof onSignInClick === 'function') {
                signInBtn.addEventListener('click', onSignInClick);
            }
            return;
        }

        if (!personalData.hasContent) {
            container.innerHTML = `
                <div class="home-empty-personal">
                    <p>${this.escapeHtml(this.t('empty_personal', 'У вас пока нет активных просмотров и сохраненных закладок'))}</p>
                    <a href="../catalog/catalog.html?category=films" class="home-explore-btn">${this.escapeHtml(this.t('explore_catalog', 'Найти фильм в каталоге'))}</a>
                </div>
            `;
            return;
        }

        container.innerHTML = '';
        const fragment = document.createDocumentFragment();

        if (personalData.watching && personalData.watching.length > 0) {
            const watchingSection = document.createElement('div');
            watchingSection.className = 'category-section';
            watchingSection.style.marginBottom = '32px';
            watchingSection.innerHTML = `
                ${this.renderSectionHeader({
                    icon: '<svg class="section-header-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>',
                    title: this.t('continue_watching', 'Продолжить просмотр'),
                    total: personalData.watchingTotal ?? personalData.watching.length,
                    href: '../bookmarks/bookmarks.html?filter=watching',
                    linkText: this.t('see_all.watching', 'Все просмотры')
                })}
                <div class="grid-container" id="home-watching-grid"></div>
            `;
            const grid = watchingSection.querySelector('#home-watching-grid');
            this.renderCategoryGrid(personalData.watching, grid, { isWatching: true });
            this.applyWatchProgress(personalData.watching, grid);
            fragment.appendChild(watchingSection);
        }

        if (personalData.watchlist && personalData.watchlist.length > 0) {
            const watchlistSection = document.createElement('div');
            watchlistSection.className = 'category-section';
            watchlistSection.innerHTML = `
                ${this.renderSectionHeader({
                    icon: '<svg class="section-header-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>',
                    title: this.t('watchlist', 'Буду смотреть'),
                    total: personalData.watchlistTotal ?? personalData.watchlist.length,
                    href: '../bookmarks/bookmarks.html?filter=plan_to_watch',
                    linkText: this.t('see_all.watchlist', 'Все закладки')
                })}
                <div class="grid-container" id="home-watchlist-grid"></div>
            `;
            const grid = watchlistSection.querySelector('#home-watchlist-grid');
            this.renderCategoryGrid(personalData.watchlist, grid, { isInWatchlist: true });
            fragment.appendChild(watchlistSection);
        }

        container.appendChild(fragment);
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
            const badge = document.createElement('span');
            badge.className = 'home-progress-badge';
            badge.textContent = label;
            poster.appendChild(badge);
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

        const movieObj = item.movie || item;
        const validMovieId = (typeof Utils !== 'undefined' && Utils.extractKinopoiskId) ? Utils.extractKinopoiskId(movieObj) : (movieObj.kinopoiskId || movieObj.movieId || null);

        // Keep provider ratings separate: TMDB must never be shown as Kinopoisk.
        const displayKpRating = movieObj.kpRating || movieObj.ratingKp || 0;
        const displayImdbRating = movieObj.imdbRating || movieObj.ratingImdb || 0;

        const cardData = {
            movie: {
                kinopoiskId: validMovieId,
                tmdbId: movieObj.tmdbId || null,
                isTmdbOnly: !!movieObj.isTmdbOnly,
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
