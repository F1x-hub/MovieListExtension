/**
 * HomeRenderer - Presentation Layer for Home Page
 * Pure DOM generation and template rendering with zero service dependencies.
 */
class HomeRenderer {
    constructor(options = {}) {
        this.navigationOptions = options;
        this.ratingEnricher = options.ratingEnricher || null;
    }

    bindMovieCardNavigation(container, options = {}) {
        if (typeof Utils !== 'undefined' && Utils.bindMovieCardNavigation) {
            Utils.bindMovieCardNavigation(container, { ...this.navigationOptions, ...options });
        }
    }

    /**
     * Render items in the Featured Hero Slider
     * @param {Array} items
     * @param {HTMLElement} container
     */
    renderFeaturedSlider(items = [], container) {
        if (!container) return;
        if (!Array.isArray(items) || items.length === 0) {
            container.innerHTML = '';
            return;
        }

        container.innerHTML = items.map((item, index) => this.renderFeaturedSlide(item, index)).join('');

        this.bindMovieCardNavigation(container);
        this.ratingEnricher?.observe?.(container);
    }

    /**
     * Generate HTML for a single Hero slider card
     * @param {Object} item
     * @param {number} [index=0]
     * @returns {string}
     */
    renderFeaturedSlide(item, index = 0) {
        const movieId = (typeof Utils !== 'undefined' && Utils.extractKinopoiskId) ? Utils.extractKinopoiskId(item) : (item.kinopoiskId || item.movieId || null);
        const tmdbId = item.tmdbId || null;
        const originalTitle = item.alternativeName || item.originalTitle || item.originalName || item.original_title || item.original_name || item.nameEn || item.englishName || item.movieTitleEn || '';
        const englishTitle = item.englishTitle || item.nameEn || item.englishName || item.movieTitleEn || item.originalTitle || item.original_title || item.original_name || item.alternativeName || '';
        const title = this.escapeHtml(item.name || item.movieTitle || item.title || 'Без названия');
        const poster = item.posterUrl || item.posterPath || item.poster || '../../shared/assets/icons/app/icon128-black.png';
        const linkUrl = movieId ? chrome.runtime.getURL(`src/pages/movie-details/movie-details.html?movieId=${movieId}`) : '#';
        const providerBadges = [];
        const kpRating = Number(item.kpRating) || 0;
        const imdbRating = Number(item.imdbRating) || 0;
        if (kpRating > 0) {
            providerBadges.push(`<span class="featured-rating-badge featured-rating-badge--kp" title="Оценка Кинопоиска">КП ${kpRating.toFixed(1)}</span>`);
        }
        if (imdbRating > 0) {
            providerBadges.push(`<span class="featured-rating-badge featured-rating-badge--imdb" title="Оценка IMDb">IMDb ${imdbRating.toFixed(1)}</span>`);
        }
        if (kpRating <= 0) {
            providerBadges.push('<span class="featured-rating-badge featured-rating-badge--loading" aria-label="Загрузка рейтинга КП"><span>КП</span><i></i></span>');
        }
        if (imdbRating <= 0) {
            providerBadges.push('<span class="featured-rating-badge featured-rating-badge--loading" aria-label="Загрузка рейтинга IMDb"><span>IMDb</span><i></i></span>');
        }
        const ratingBadge = `<div class="featured-badge-overlay">${providerBadges.join('')}</div>`;
        const delay = Math.min(index * 40, 400);

        return `
            <a href="${linkUrl}" class="featured-card home-hero-animate" style="animation-delay: ${delay}ms" data-action="view-details" data-movie-id="${movieId || ''}" ${tmdbId ? `data-tmdb-id="${tmdbId}"` : ''} data-is-tmdb-only="${item.isTmdbOnly ? 'true' : 'false'}" data-movie-title="${title}" data-movie-original-title="${this.escapeHtml(originalTitle)}" data-movie-english-title="${this.escapeHtml(englishTitle)}" data-movie-year="${item.year || ''}" data-media-type="${item.mediaType || item.type || 'movie'}">
                <img class="featured-poster" src="${poster}" alt="${title}" draggable="false">
                ${ratingBadge}
                <div class="featured-overlay">
                    <h3 class="featured-title">${title}</h3>
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

        if (!Array.isArray(items) || items.length === 0) {
            container.innerHTML = '<p style="color:var(--theme-text-secondary); text-align:center; grid-column: 1/-1; padding: 24px 0;">Нет данных</p>';
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

        this.bindMovieCardNavigation(container);
        this.ratingEnricher?.observe?.(container);
    }

    /**
     * Render all discovery categories
     * @param {Object} discoveryData
     * @param {Object} elements
     */
    renderCategoryGrids(discoveryData = {}, elements = {}) {
        const { filmsGrid, seriesGrid, cartoonsGrid, tvShowsGrid, tvShowsTitle } = elements;

        this.renderCategoryGrid(discoveryData.films, filmsGrid);
        this.renderCategoryGrid(discoveryData.series, seriesGrid);
        this.renderCategoryGrid(discoveryData.cartoons, cartoonsGrid);

        const anime = discoveryData.anime || discoveryData.shows || [];
        if (tvShowsTitle) {
            tvShowsTitle.textContent = 'Аниме';
            const seeAllText = document.getElementById('tvShows-see-all-text');
            if (seeAllText) seeAllText.textContent = 'Всё аниме';
        }
        this.renderCategoryGrid(anime, tvShowsGrid);
    }

    /**
     * Render Personal Tier (CTA banner for guests, Watching / Watchlist for users)
     * @param {Object} personalData
     * @param {HTMLElement} container
     * @param {Function} [onSignInClick]
     */
    renderPersonalTier(personalData = {}, container, onSignInClick) {
        if (!container) return;

        if (!personalData.isAuthenticated) {
            container.innerHTML = `
                <div class="home-cta-card">
                    <div class="home-cta-content">
                        <div class="home-cta-icon">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
                            </svg>
                        </div>
                        <div class="home-cta-text">
                            <h3>Синхронизируйте просмотр и списки</h3>
                            <p>Сохраняйте фильмы в закладки, продолжайте просмотр с любого места и делитесь оценками с друзьями.</p>
                        </div>
                    </div>
                    <button class="home-cta-btn" id="homeSignInBtn">Войти / Зарегистрироваться</button>
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
                    <p>У вас пока нет активных просмотров и сохраненных закладок</p>
                    <a href="../search/search.html" class="home-explore-btn">Найти фильм в каталоге</a>
                </div>
            `;
            return;
        }

        container.innerHTML = '';
        const fragment = document.createDocumentFragment();

        if (personalData.watching && personalData.watching.length > 0) {
            const watchingTotal = personalData.watchingTotal ?? personalData.watching.length;
            const watchingSection = document.createElement('div');
            watchingSection.className = 'category-section';
            watchingSection.style.marginBottom = '32px';
            watchingSection.innerHTML = `
                <div class="section-header">
                    <div class="section-header-title">
                        <svg class="section-header-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                        <h2>Продолжить просмотр <span class="section-count-badge">${watchingTotal}</span></h2>
                    </div>
                    <a href="../bookmarks/bookmarks.html?filter=watching" class="section-see-all">
                        <span>Все просмотры</span>
                        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
                    </a>
                </div>
                <div class="grid-container" id="home-watching-grid"></div>
            `;
            const grid = watchingSection.querySelector('#home-watching-grid');
            this.renderCategoryGrid(personalData.watching, grid, { isWatching: true });
            fragment.appendChild(watchingSection);
        }

        if (personalData.watchlist && personalData.watchlist.length > 0) {
            const watchlistTotal = personalData.watchlistTotal ?? personalData.watchlist.length;
            const watchlistSection = document.createElement('div');
            watchlistSection.className = 'category-section';
            watchlistSection.innerHTML = `
                <div class="section-header">
                    <div class="section-header-title">
                        <svg class="section-header-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>
                        <h2>Буду смотреть <span class="section-count-badge">${watchlistTotal}</span></h2>
                    </div>
                    <a href="../bookmarks/bookmarks.html?filter=plan_to_watch" class="section-see-all">
                        <span>Все закладки</span>
                        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
                    </a>
                </div>
                <div class="grid-container" id="home-watchlist-grid"></div>
            `;
            const grid = watchlistSection.querySelector('#home-watchlist-grid');
            this.renderCategoryGrid(personalData.watchlist, grid, { isInWatchlist: true });
            fragment.appendChild(watchlistSection);
        }

        container.appendChild(fragment);
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

        container.innerHTML = `
            <div class="home-dashboard-grid">
                <!-- Personal Stats Box -->
                <div class="home-dashboard-card">
                    <h3>
                        <svg class="dashboard-header-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="18" y1="20" x2="18" y2="10"></line>
                            <line x1="12" y1="20" x2="12" y2="4"></line>
                            <line x1="6" y1="20" x2="6" y2="14"></line>
                        </svg>
                        Ваша активность
                    </h3>
                    <div class="home-stats-grid">
                        <div class="home-stat-box">
                            <div class="home-stat-icon">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                            </div>
                            <div class="home-stat-value">${stats.totalRatings}</div>
                            <div class="home-stat-label">Оценок всего</div>
                        </div>
                        <div class="home-stat-box">
                            <div class="home-stat-icon">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 14 14"></polyline></svg>
                            </div>
                            <div class="home-stat-value">${stats.averageRating}</div>
                            <div class="home-stat-label">Средний балл</div>
                        </div>
                        <div class="home-stat-box">
                            <div class="home-stat-icon">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                            </div>
                            <div class="home-stat-value">${stats.watchingCount}</div>
                            <div class="home-stat-label">В процессе</div>
                        </div>
                        <div class="home-stat-box">
                            <div class="home-stat-icon">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>
                            </div>
                            <div class="home-stat-value">${stats.watchlistCount}</div>
                            <div class="home-stat-label">В закладках</div>
                        </div>
                    </div>
                </div>

                <!-- Community Top -->
                <div class="home-dashboard-card">
                    <h3>
                        <svg class="dashboard-header-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                            <circle cx="9" cy="7" r="4"></circle>
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                            <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                        </svg>
                        Выбор сообщества
                    </h3>
                    <div class="home-community-list" id="home-community-grid">
                        ${communityDocs.length === 0 ? '<p style="color:var(--theme-text-secondary); font-size:13px; padding: 24px 0;">Пока нет оцененных фильмов</p>' : ''}
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
        if (typeof MovieCard === 'undefined' || !MovieCard.create) {
            // Fallback lightweight DOM node if MovieCard is not loaded
            const card = document.createElement('a');
            const movieId = (typeof Utils !== 'undefined' && Utils.extractKinopoiskId) ? Utils.extractKinopoiskId(item) : (item.kinopoiskId || item.movieId || null);
            card.className = 'movie-card';
            card.dataset.action = 'view-details';
            if (item.isTmdbOnly) card.dataset.isTmdbOnly = 'true';
            if (item.tmdbId) card.dataset.tmdbId = String(item.tmdbId);
            card.dataset.movieTitle = item.name || item.title || '';
            if (item.alternativeName || item.originalTitle || item.originalName || item.original_title || item.original_name) {
                card.dataset.movieOriginalTitle = item.alternativeName || item.originalTitle || item.originalName || item.original_title || item.original_name;
            }
            const englishTitle = item.englishTitle || item.nameEn || item.englishName || item.movieTitleEn || item.originalTitle || item.original_title || item.original_name || item.alternativeName;
            if (englishTitle) card.dataset.movieEnglishTitle = englishTitle;
            card.dataset.movieYear = item.year || item.releaseYear || '';
            card.dataset.mediaType = item.mediaType || item.type || 'movie';
            if (movieId) card.dataset.movieId = String(movieId);
            card.href = movieId ? chrome.runtime.getURL(`src/pages/movie-details/movie-details.html?movieId=${movieId}`) : '#';
            card.innerHTML = `
                <img class="card-poster" src="${item.posterUrl || item.poster || ''}" alt="${this.escapeHtml(item.name || '')}">
                <div class="card-info">
                    <h3 class="card-title">${this.escapeHtml(item.name || '')}</h3>
                </div>
            `;
            return card;
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
                posterUrl: movieObj.posterUrl || movieObj.posterPath || movieObj.poster || '',
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
            ...options
        };

        return MovieCard.create(cardData, cardOptions);
    }


    /**
     * Escape special characters for HTML output
     * @param {string} str
     * @returns {string}
     */
    escapeHtml(str) {
        if (!str) return '';
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
