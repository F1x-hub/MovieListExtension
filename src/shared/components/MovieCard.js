/**
 * Reusable Movie Card Component
 * Creates a consistent movie card UI across all pages
 */
class MovieCard {
    static normalizeRating(value) {
        const numeric = Number(value);
        return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
    }

    static formatRating(value) {
        return Number.parseFloat(Number(value).toFixed(1));
    }

    /** Provider ratings read the way the sites print them: 7.0, not 7. */
    static formatProviderRating(value) {
        return Number(value).toFixed(1);
    }

    /** A collection icon in the card menu, at the menu's 16px icon size. */
    static collectionIconHtml(icon) {
        if (typeof CollectionService !== 'undefined' && typeof CollectionService.renderIconHtml === 'function') {
            return CollectionService.renderIconHtml(icon, { size: 16 });
        }
        return '<svg data-icon="FOLDER" aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M2 9V6A2 2 0 0 1 4 4H7.6A2 2 0 0 1 9 4.6L10.4 6H16A2 2 0 0 1 18 8V9Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9V14A2 2 0 0 0 5 16H15A2 2 0 0 0 17 14V9"/></svg>';
    }

    /**
     * The four bookmark statuses in the card menu, keyed by the stored status value.
     * A film has at most one of them; `statusMenuItemHtml` draws an item and
     * `setStatusButtons` repaints a rendered card, so both always agree.
     */
    static STATUS_MENU_ITEMS = {
        favorite: {
            action: 'toggle-favorite',
            attribute: 'data-is-favorite',
            labels: ['movie_card.remove_favorite', 'movie_card.add_favorite'],
            icon: '<svg data-icon="HEART" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 16.6L4.2 10.8A3.9 3.9 0 0 1 9.7 5.3L10 5.6L10.3 5.3A3.9 3.9 0 0 1 15.8 10.8Z"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M10 5.6L10 16.6L15.8 10.8C17.13 9.25 17.04 6.94 15.6 5.5C14.16 4.06 11.85 3.97 10.3 5.3L10 5.6Z"/></svg>',
            activeIcon: '<svg data-icon="HEART_FILLED" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 16.6L4.2 10.8A3.9 3.9 0 0 1 9.7 5.3L10 5.6L10.3 5.3A3.9 3.9 0 0 1 15.8 10.8Z"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M10 16.6L4.2 10.8A3.9 3.9 0 0 1 9.7 5.3L10 5.6L10.3 5.3A3.9 3.9 0 0 1 15.8 10.8Z"/></svg>'
        },
        watching: {
            action: 'toggle-watching',
            attribute: 'data-is-watching',
            labels: ['movie_card.remove_watching', 'movie_card.add_watching'],
            icon: '<svg data-icon="EYE" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2 10C3.8 6.6 6.6 5 10 5C13.4 5 16.2 6.6 18 10C16.2 13.4 13.4 15 10 15C6.6 15 3.8 13.4 2 10Z"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M10 7.5A2.5 2.5 0 1 0 10 12.5A2.5 2.5 0 1 0 10 7.5Z"/></svg>',
            activeIcon: '<svg data-icon="EYE_FILLED" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2 10C3.8 6.6 6.6 5 10 5C13.4 5 16.2 6.6 18 10C16.2 13.4 13.4 15 10 15C6.6 15 3.8 13.4 2 10Z"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M2 10C3.8 6.6 6.6 5 10 5C13.4 5 16.2 6.6 18 10C16.2 13.4 13.4 15 10 15C6.6 15 3.8 13.4 2 10ZM10 7.6A2.4 2.4 0 1 0 10 12.4A2.4 2.4 0 1 0 10 7.6Z"/></svg>'
        },
        watched: {
            action: 'toggle-watched',
            attribute: 'data-is-watched',
            labels: ['movie_card.remove_watched', 'movie_card.add_watched'],
            icon: '<svg data-icon="WATCHED" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 3H14A3 3 0 0 1 17 6V14A3 3 0 0 1 14 17H6A3 3 0 0 1 3 14V6A3 3 0 0 1 6 3Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6.6 10.2L9 12.6L13.4 7.6"/></svg>',
            activeIcon: '<svg data-icon="WATCHED_FILLED" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M6 2H14A4 4 0 0 1 18 6V14A4 4 0 0 1 14 18H6A4 4 0 0 1 2 14V6A4 4 0 0 1 6 2ZM5.2 10.2L6.6 8.8L9 11.2L12.6 6.9L14.1 8.3L9 14.1Z"/></svg>'
        },
        plan_to_watch: {
            action: 'toggle-watchlist',
            attribute: 'data-is-in-watchlist',
            labels: ['movie_card.remove_watchlist', 'movie_card.add_watchlist'],
            icon: '<svg data-icon="BOOKMARK" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5A2 2 0 0 1 7 3H13A2 2 0 0 1 15 5V17L10 13.6L5 17Z"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M10 3L10 13.6L15 17L15 5C15 3.9 14.1 3 13 3L10 3Z"/></svg>',
            activeIcon: '<svg data-icon="BOOKMARK_FILLED" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5A2 2 0 0 1 7 3H13A2 2 0 0 1 15 5V17L10 13.6L5 17Z"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M5 5A2 2 0 0 1 7 3H13A2 2 0 0 1 15 5V17L10 13.6L5 17Z"/></svg>'
        }
    };

    static ACTIVE_STATUS_BACKGROUND = '#c0c0c0';
    static ACTIVE_STATUS_COLOR = '#000';

    static statusIconHtml(status, isActive) {
        const item = MovieCard.STATUS_MENU_ITEMS[status];
        return isActive ? item.activeIcon : item.icon;
    }

    static statusLabel(status, isActive) {
        const item = MovieCard.STATUS_MENU_ITEMS[status];
        return window.i18n?.get(item.labels[isActive ? 0 : 1]) || '';
    }

    /** One status item of the card menu (favorite, watching, watched or plan to watch). */
    static statusMenuItemHtml(status, isActive, { movieId = '', ratingId } = {}) {
        const item = MovieCard.STATUS_MENU_ITEMS[status];
        const active = Boolean(isActive);
        const ratingAttribute = ratingId === undefined ? '' : ` data-rating-id="${MovieCard.escapeHtml(ratingId || '')}"`;
        const activeStyle = active
            ? ` style="background-color: ${MovieCard.ACTIVE_STATUS_BACKGROUND}; color: ${MovieCard.ACTIVE_STATUS_COLOR};"`
            : '';
        return `
                            <button class="mc-menu-item" data-action="${item.action}"${ratingAttribute}
                                    data-movie-id="${MovieCard.escapeHtml(movieId || '')}"
                                    ${item.attribute}="${active}"${activeStyle}>
                                <span class="mc-menu-item-icon">${MovieCard.statusIconHtml(status, active)}</span>
                                <span class="mc-menu-item-text"${active ? ' style="font-weight: 500;"' : ''}>${MovieCard.statusLabel(status, active)}</span>
                            </button>`;
    }

    /** Repaints every status item inside `root` (a card) for the given status, or none for null. */
    static setStatusButtons(root, status) {
        if (!root?.querySelectorAll) return;
        for (const [value, item] of Object.entries(MovieCard.STATUS_MENU_ITEMS)) {
            root.querySelectorAll(`[data-action="${item.action}"]`).forEach(button => {
                const isActive = value === status;
                button.setAttribute(item.attribute, String(isActive));
                button.style.backgroundColor = isActive ? MovieCard.ACTIVE_STATUS_BACKGROUND : '';
                button.style.color = isActive ? MovieCard.ACTIVE_STATUS_COLOR : '';
                const icon = button.querySelector('.mc-menu-item-icon');
                if (icon) icon.innerHTML = MovieCard.statusIconHtml(value, isActive);
                const text = button.querySelector('.mc-menu-item-text');
                if (text) {
                    text.textContent = MovieCard.statusLabel(value, isActive);
                    text.style.fontWeight = isActive ? '500' : '';
                }
            });
        }
    }

    /** The status a rendered card shows, or null when none of its status items is on. */
    static statusFromCard(root) {
        if (!root?.querySelector) return null;
        for (const [value, item] of Object.entries(MovieCard.STATUS_MENU_ITEMS)) {
            if (root.querySelector(`[data-action="${item.action}"][${item.attribute}="true"]`)) return value;
        }
        return null;
    }

    static COLLECTION_CHECK_HTML = '<span class="mc-collection-check" style="margin-left: auto; font-weight: bold; color: var(--accent-color, #4CAF50);"><svg data-icon="CHECK" aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 10.6L8 14.6L16 5.4"/></svg></span>';

    /** One collection item of the card menu, checked when the film is in that collection. */
    static collectionMenuItemHtml(collection, isInCollection, movieId) {
        const inCollection = Boolean(isInCollection);
        return `
                                    <button class="mc-menu-item" data-action="toggle-collection"
                                            data-movie-id="${MovieCard.escapeHtml(movieId || '')}"
                                            data-collection-id="${MovieCard.escapeHtml(collection.id)}"
                                            data-in-collection="${inCollection}">
                                        <span class="mc-menu-item-icon">${MovieCard.collectionIconHtml(collection.icon)}</span>
                                        <span class="mc-menu-item-text" style="${inCollection ? 'font-weight: 500;' : ''}">
                                            ${MovieCard.escapeHtml(collection.name)}
                                        </span>
                                        ${inCollection ? MovieCard.COLLECTION_CHECK_HTML : ''}
                                    </button>`;
    }

    /** Repaints one rendered collection item as checked or unchecked. */
    static setCollectionItemState(button, isInCollection) {
        if (!button) return;
        const inCollection = Boolean(isInCollection);
        button.setAttribute('data-in-collection', String(inCollection));
        button.querySelector('.mc-collection-check')?.remove();
        if (inCollection) button.insertAdjacentHTML('beforeend', MovieCard.COLLECTION_CHECK_HTML);
        const text = button.querySelector('.mc-menu-item-text');
        if (text) text.style.fontWeight = inCollection ? '500' : '';
    }

    static renderCompactRatingBadges({
        kpRating = 0,
        imdbRating = 0,
        userRating = 0,
        showSkeleton = false,
        showUnavailable = false,
        kpPending = false,
        imdbPending = false,
        kpUnavailable = false,
        imdbUnavailable = false
    } = {}) {
        const kp = this.normalizeRating(kpRating);
        const imdb = this.normalizeRating(imdbRating);
        const user = this.normalizeRating(userRating);
        // Each provider keeps its place whatever its state, so a badge never moves when
        // the other provider's rating arrives.
        const providerBadge = (label, value, className, siteName, isLoading, isMissing) => {
            if (value > 0) {
                return `
                <span class="mc-badge ${className}" title="Оценка ${siteName}">
                    <span class="mc-badge-source">${label}</span><span>${this.formatProviderRating(value)}</span>
                </span>`;
            }
            if (isLoading) {
                return `
                <span class="mc-badge mc-badge-loading" aria-label="Загрузка рейтинга ${label}">
                    <span class="mc-rating-skeleton-label">${label}</span><span class="mc-rating-skeleton-value"></span>
                </span>`;
            }
            if (isMissing) {
                return `
                <span class="mc-badge mc-badge-unavailable" title="Оценка ${siteName} не найдена">
                    <span class="mc-badge-source">${label}</span><span>—</span>
                </span>`;
            }
            return '';
        };
        return `
            ${providerBadge('КП', kp, 'mc-badge-kp', 'Кинопоиска', showSkeleton || kpPending, kpUnavailable || showUnavailable)}
            ${providerBadge('IMDb', imdb, 'mc-badge-imdb', 'IMDb', showSkeleton || imdbPending, imdbUnavailable || showUnavailable)}
            ${user > 0 ? `
                <span class="mc-badge mc-badge-user" title="${window.i18n?.get('movie_card.my_rating') || 'Моя оценка'}: ${this.formatRating(user)}">
                    <span class="mc-badge-star"><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg></span> ${this.formatRating(user)}
                </span>
            ` : ''}
        `;
    }

    static updateCompactRatings(card, ratings = {}) {
        const overlay = card?.querySelector?.('.mc-badges-overlay');
        if (!overlay) return false;

        // Missing provider responses must not erase a rating already rendered.
        ratings = {
            ...ratings,
            kpRating: this.normalizeRating(ratings.kpRating) || this.normalizeRating(card.dataset.kpRating),
            imdbRating: this.normalizeRating(ratings.imdbRating) || this.normalizeRating(card.dataset.imdbRating)
        };
        if (ratings.kpRating > 0) card.dataset.kpRating = String(ratings.kpRating);
        if (ratings.imdbRating > 0) card.dataset.imdbRating = String(ratings.imdbRating);
        if (/^tt\d{7,10}$/.test(ratings.imdbId || '')) card.dataset.imdbId = ratings.imdbId;

        const showUnavailable = ratings.showUnavailable ?? (
            ratings.status === 'no-ratings'
            || ratings.status === 'not-found'
            || (Number(ratings.kpRating) <= 0 && Number(ratings.imdbRating) <= 0)
        );

        overlay.innerHTML = this.renderCompactRatingBadges({
            kpRating: ratings.kpRating,
            imdbRating: ratings.imdbRating,
            userRating: ratings.userRating ?? card.dataset.userRating,
            kpPending: ratings.kpState === 'pending' || ratings.kpPending === true,
            imdbPending: ratings.imdbState === 'pending' || ratings.imdbPending === true,
            kpUnavailable: ratings.kpState === 'unavailable' || ratings.kpUnavailable === true,
            imdbUnavailable: ratings.imdbState === 'unavailable' || ratings.imdbUnavailable === true,
            showUnavailable
        });
        overlay.dataset.ratingsLoaded = 'true';
        return true;
    }

    /**
     * Create a movie card element
     * @param {Object} data - Movie data object
     * @param {Object} options - Configuration options for the card
     * @returns {HTMLElement} - The movie card element
     */
    static create(data, options = {}) {
        const {
            variant = 'standard', // 'standard' | 'search'
            showFavorite = false,
            showWatchlist = false,
            showWatching = false,
            showWatched = false,
            showUserInfo = false,
            showEditRating = false,
            showAddToCollection = false,
            showRemoveFromWatchlist = false,
            showRemoveFromWatching = false, // New option
            showRemoveFromWatched = false, // New option
            showRemoveFromBookmarks = false, // New option for Bookmarks page
            showThreeDotMenu = true,
            showAverageRating = true,
            showUserRating = true,
            showGenres = true, // New option
            showDescription = true, // New option
            animeStyle = false, // New: Use anime-style card design
            watchingProgress = null,
            availableCollections = [], // New: List of all custom collections
            movieCollections = [],     // New: List of collection IDs this movie is in
            showRatingSkeleton = false,
            lazyPoster = false,
            deferPoster = false
        } = options;

        const isSearchVariant = variant === 'search';

        // Extract data with fallbacks
        const movie = data.movie || {};
        const isEnglish = window.i18n?.currentLocale === 'en';
        
        // Prefer a Latin-script title in English mode. Original titles can be
        // Japanese/Chinese/Korean, and TMDB-only cards are already fetched in
        // the interface language, so their `name` is the English title.
        const isLatinTitle = value => typeof value === 'string'
            && /[A-Za-z]/.test(value)
            && !/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(value);
        const englishTitle = isEnglish && !movie.isTmdbOnly
            ? [movie.alternativeName, movie.englishTitle].find(isLatinTitle)
            : null;
        const title = englishTitle
            || movie.name || data.movieTitle || window.i18n?.get('movie_card.unknown_movie') || 'Unknown Movie';

        const fallbackPosterUrl = '/src/shared/assets/icons/app/icon48.png';
        const sourcePosterUrl = movie.posterUrl || '';
        const isPosterDeferred = deferPoster && Boolean(sourcePosterUrl);
        const posterUrl = isPosterDeferred ? fallbackPosterUrl : (sourcePosterUrl || fallbackPosterUrl);
        const posterLoadingAttributes = lazyPoster ? ' loading="lazy" decoding="async"' : '';
        const posterDeferredAttributes = isPosterDeferred
            ? ` data-deferred-poster-url="${this.escapeHtml(sourcePosterUrl)}"`
            : '';
        const year = movie.year || data.releaseYear || '';
        
        // Localize genres if possible
        const rawGenres = Array.isArray(movie.genres) ? movie.genres : [];
        const genres = rawGenres.map(genre => {
            const genreName = typeof Utils !== 'undefined' && Utils.extractGenreName
                ? Utils.extractGenreName(genre)
                : (typeof genre === 'string' ? genre.trim() : (genre?.name ? String(genre.name).trim() : (genre?.genre ? String(genre.genre).trim() : '')));
            if (!genreName) return '';
            // Find key in locale for this genre
            if (window.i18n?.locales?.ru?.random?.genres) {
                const genreEntry = Object.entries(window.i18n.locales.ru.random.genres).find(([key, val]) => val.toLowerCase() === genreName.toLowerCase());
                if (genreEntry) {
                    return window.i18n.get(`random.genres.${genreEntry[0]}`);
                }
            }
            return genreName;
        }).filter(Boolean);

        const description = movie.description || '';
        const rating = data.rating || 0;
        const displayedUserRating = this.normalizeRating(rating);
        const averageRating = data.averageRating || 0;
        const ratingsCount = data.ratingsCount || 0;
        const kinopoiskRating = this.normalizeRating(movie.kpRating || movie.ratingKp || movie.ratingKinopoisk 
            || (typeof movie.rating === 'object' ? movie.rating?.kp : null)
            || (typeof movie.rating === 'number' ? movie.rating : null)
            || data.kpRating || data.ratingKp
            // A number in data.rating is a person's score (displayedUserRating above),
            // never a Kinopoisk rating.
            || (typeof data.rating === 'object' ? data.rating?.kp : null) || 0);

        const imdbRating = this.normalizeRating(movie.imdbRating || movie.ratingImdb 
            || (typeof movie.rating === 'object' ? movie.rating?.imdb : null)
            || data.imdbRating || data.ratingImdb 
            || (typeof data.rating === 'object' ? data.rating?.imdb : null) || 0);

        
        // User info
        const userId = data.userId;
        const userDisplayName = data.userDisplayName || data.userName;
        const userEmail = data.userEmail;
        const userPhoto = data.userPhoto;
        
        const isWatching = options.isWatching || data.isWatching || false;
        const isWatched = options.isWatched || data.isWatched || false;
        const isInWatchlist = options.isInWatchlist || data.isInWatchlist || false;
        const isFavorite = data.isFavorite || options.isFavorite || false;
        const hasReview = data.hasReview === true
            || (typeof data.review === 'string' && data.review.trim().length > 0);

        // Truncate description
        const truncatedDescription = description.length > 150 
            ? description.substring(0, 150) + '...' 
            : description;

        const isLoading = title === 'Loading...' || title === window.i18n?.get('movie_card.unknown_movie');

        // Extract canonical numeric Kinopoisk ID
        const canonicalMovieId = (typeof Utils !== 'undefined' && Utils.extractKinopoiskId)
            ? (Utils.extractKinopoiskId(movie) || Utils.extractKinopoiskId(data))
            : (movie.kinopoiskId || data.movieId || null);

        if (!canonicalMovieId && !isLoading && !movie.isTmdbOnly) {
            console.warn('[MovieCard] No valid Kinopoisk ID found for movie card:', { movie, data });
        }

        // Create card element
        const card = document.createElement('div');
        card.className = `movie-card-component fade-in${isSearchVariant ? ' mc-variant-search' : ''}${animeStyle ? ' anime-style' : ''}${isLoading ? ' mc-is-loading' : ''}`;
        if (canonicalMovieId) card.dataset.movieId = String(canonicalMovieId);
        if (movie.tmdbId) card.dataset.tmdbId = String(movie.tmdbId);
        if (movie.isTmdbOnly) card.dataset.isTmdbOnly = 'true';
        if (kinopoiskRating > 0) card.dataset.kpRating = String(kinopoiskRating);
        if (imdbRating > 0) card.dataset.imdbRating = String(imdbRating);
        const imdbId = movie.imdbId || data.imdbId;
        if (/^tt\d{7,10}$/.test(imdbId || '')) card.dataset.imdbId = imdbId;
        if (displayedUserRating > 0) card.dataset.userRating = String(displayedUserRating);
        card.dataset.movieTitle = title;
        if (movie.alternativeName) card.dataset.movieOriginalTitle = movie.alternativeName;
        if (movie.englishTitle) card.dataset.movieEnglishTitle = movie.englishTitle;
        if (movie.searchTitle) card.dataset.movieSearchTitle = movie.searchTitle;
        if (movie.year || movie.releaseDate) card.dataset.movieYear = String(movie.year || String(movie.releaseDate).slice(0, 4));
        if (movie.mediaType || movie.type) card.dataset.mediaType = String(movie.mediaType || movie.type);
        if (data.id) card.dataset.ratingId = data.id;
        if (hasReview) card.dataset.hasReview = 'true';

        const detailsUrl = canonicalMovieId 
            ? chrome.runtime.getURL(`src/pages/movie-details/movie-details.html?movieId=${canonicalMovieId}`)
            : '#';

        // Build card HTML
        if (isSearchVariant) {
            // The title link below is the card's single keyboard stop; the
            // poster link stays clickable but is skipped by Tab.
            card.innerHTML = `
                <a href="${detailsUrl}" class="mc-poster-container ${isLoading ? 'mc-skeleton' : ''}" tabindex="-1" data-action="view-details"${canonicalMovieId ? ` data-movie-id="${canonicalMovieId}"` : ''} ${movie.tmdbId ? `data-tmdb-id="${movie.tmdbId}"` : ''} data-movie-title="${this.escapeHtml(title)}">
                    <img src="${this.escapeHtml(posterUrl)}"
                         alt="${this.escapeHtml(title)}" 
                         class="mc-poster"${posterLoadingAttributes}${posterDeferredAttributes}>
                    <div class="mc-poster-overlay"></div>
                    
                    <div class="mc-badges-overlay" aria-label="${this.escapeHtml(this.t('ratings_label', 'Рейтинги'))}">${this.renderCompactRatingBadges({ kpRating: kinopoiskRating, imdbRating, userRating: displayedUserRating, showSkeleton: showRatingSkeleton })}</div>
                </a>
                
                ${showThreeDotMenu ? `
                    <button class="mc-menu-btn" data-menu="true" data-action="stop-propagation" aria-label="${window.i18n?.get('movie_card.options') || 'Параметры'}" aria-haspopup="menu" aria-expanded="false" title="Options">
                        <span class="mc-menu-icon"><svg data-icon="MORE_VERTICAL" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M10 2.4A1.6 1.6 0 1 0 10 5.6A1.6 1.6 0 1 0 10 2.4ZM10 8.4A1.6 1.6 0 1 0 10 11.6A1.6 1.6 0 1 0 10 8.4ZM10 14.4A1.6 1.6 0 1 0 10 17.6A1.6 1.6 0 1 0 10 14.4Z"/></svg></span>
                    </button>
                    <div class="mc-menu-dropdown" role="menu" data-action="stop-propagation">
                        ${showFavorite ? MovieCard.statusMenuItemHtml('favorite', isFavorite, { movieId: canonicalMovieId, ratingId: data.id }) : ''}
                        ${showWatching ? MovieCard.statusMenuItemHtml('watching', isWatching, { movieId: canonicalMovieId }) : ''}
                        ${showWatched ? MovieCard.statusMenuItemHtml('watched', isWatched, { movieId: canonicalMovieId }) : ''}
                        ${showWatchlist ? MovieCard.statusMenuItemHtml('plan_to_watch', isInWatchlist, { movieId: canonicalMovieId }) : ''}
                        ${hasReview && canonicalMovieId ? `
                            <button class="mc-menu-item" data-action="open-review"
                                    data-movie-id="${canonicalMovieId}"
                                    data-rating-id="${this.escapeHtml(data.id || '')}">
                                <span class="mc-menu-item-icon">▤</span>
                                <span class="mc-menu-item-text">Читать рецензию</span>
                            </button>
                        ` : ''}
                        ${showEditRating ? `
                            <button class="mc-menu-item" data-action="edit-rating"
                                    data-movie-id="${canonicalMovieId || ''}"
                                    data-rating="${rating}"
                                    data-comment="${this.escapeHtml(Utils.normalizeRatingComment(data.comment))}">
                                <span class="mc-menu-item-icon"><svg data-icon="EDIT" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16L4.8 12.2L12.6 4.4A1.7 1.7 0 0 1 15 4.4L15.6 5A1.7 1.7 0 0 1 15.6 7.4L7.8 15.2Z"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M10.4 6.6L12.6 4.4A1.7 1.7 0 0 1 15 4.4L15.6 5A1.7 1.7 0 0 1 15.6 7.4L13.4 9.6Z"/></svg></span>
                                <span class="mc-menu-item-text">${window.i18n?.get('movie_card.edit_rating')}</span>
                            </button>
                        ` : ''}
                        ${showAddToCollection ? `
                            <button class="mc-menu-item" data-action="add-to-collection"
                                    data-movie-id="${canonicalMovieId || ''}">
                                <span class="mc-menu-item-icon"><svg data-icon="FOLDER" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M2 9V6A2 2 0 0 1 4 4H7.6A2 2 0 0 1 9 4.6L10.4 6H16A2 2 0 0 1 18 8V9Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9V14A2 2 0 0 0 5 16H15A2 2 0 0 0 17 14V9"/></svg></span>
                                <span class="mc-menu-item-text">${window.i18n?.get('movie_card.add_collection')}</span>
                            </button>
                        ` : ''}
                        ${showRemoveFromWatching ? `
                            <button class="mc-menu-item" data-action="remove-from-watching"
                                    data-movie-id="${canonicalMovieId || ''}">
                                <span class="mc-menu-item-icon"><svg data-icon="CLOSE" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5L15 15M15 5L5 15"/></svg></span>
                                <span class="mc-menu-item-text">Удалить из "Смотрю"</span>
                            </button>
                        ` : ''}
                        ${showRemoveFromWatched ? `
                            <button class="mc-menu-item" data-action="remove-from-watched"
                                    data-movie-id="${canonicalMovieId || ''}">
                                <span class="mc-menu-item-icon"><svg data-icon="CLOSE" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5L15 15M15 5L5 15"/></svg></span>
                                <span class="mc-menu-item-text">Удалить из "Просмотрено"</span>
                            </button>
                        ` : ''}
                        ${showRemoveFromWatchlist ? `
                            <button class="mc-menu-item" data-action="remove-from-watchlist"
                                    data-movie-id="${canonicalMovieId || ''}">
                                <span class="mc-menu-item-icon"><svg data-icon="TRASH" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M7 4V3A1 1 0 0 1 8 2H12A1 1 0 0 1 13 3V4H16A1 1 0 0 1 17 5V6A1 1 0 0 1 16 7H4A1 1 0 0 1 3 6V5A1 1 0 0 1 4 4Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 8V15A2 2 0 0 0 7 17H13A2 2 0 0 0 15 15V8M10 10V13"/></svg></span>
                                <span class="mc-menu-item-text">${window.i18n?.get('movie_card.remove')}</span>
                            </button>
                        ` : ''}
                        ${showRemoveFromBookmarks ? `
                            <button class="mc-menu-item" data-action="remove-from-bookmarks"
                                    data-movie-id="${canonicalMovieId || ''}">
                                <span class="mc-menu-item-icon"><svg data-icon="TRASH" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M7 4V3A1 1 0 0 1 8 2H12A1 1 0 0 1 13 3V4H16A1 1 0 0 1 17 5V6A1 1 0 0 1 16 7H4A1 1 0 0 1 3 6V5A1 1 0 0 1 4 4Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 8V15A2 2 0 0 0 7 17H13A2 2 0 0 0 15 15V8M10 10V13"/></svg></span>
                                <span class="mc-menu-item-text">Удалить из закладок</span>
                            </button>
                        ` : ''}
                        ${availableCollections.length > 0 ? `
                        <div class="mc-menu-divider" style="height: 1px; background: rgba(255,255,255,0.1); margin: 4px 0;"></div>
                        <div class="mc-menu-collections">
                            ${availableCollections.map(col => MovieCard.collectionMenuItemHtml(col, movieCollections.includes(col.id), canonicalMovieId)).join('')}
                        </div>
                    ` : ''}
                    </div>
                ` : ''}
                
                <div class="mc-content">
                    <div class="mc-title-row">
                        <a href="${detailsUrl}" class="mc-title mc-title-link ${isLoading ? 'mc-skeleton' : ''}" 
                            title="${this.escapeHtml(title)}"
                            data-action="view-details"
                            data-movie-id="${canonicalMovieId || ''}"
                            ${movie.tmdbId ? `data-tmdb-id="${movie.tmdbId}"` : ''}
                            data-movie-title="${this.escapeHtml(title)}">
                            ${isLoading ? '' : this.escapeHtml(title)}
                        </a>
                        ${hasReview ? '<span class="mc-review-indicator" title="Есть рецензия" aria-label="Есть рецензия">Рецензия</span>' : ''}
                    </div>
                    
                    <div class="mc-meta-subtitle ${isLoading ? 'mc-skeleton' : ''}">
                        ${isLoading ? '' : [
                            year,
                            genres.slice(0, 2).join(', ')
                        ].filter(Boolean).join(' • ')}
                    </div>
                </div>
            `;
        } else {
            // Build standard card HTML
            card.innerHTML = `
            <a href="${detailsUrl}" class="mc-poster-container ${isLoading ? 'mc-skeleton' : ''}" data-action="view-details"${canonicalMovieId ? ` data-movie-id="${canonicalMovieId}"` : ''} ${movie.tmdbId ? `data-tmdb-id="${movie.tmdbId}"` : ''} data-movie-title="${this.escapeHtml(title)}">
                <img src="${this.escapeHtml(posterUrl)}"
                     alt="${this.escapeHtml(title)}" 
                     class="mc-poster"${posterLoadingAttributes}${posterDeferredAttributes}>
                ${animeStyle ? '<div class="mc-poster-overlay"></div>' : ''}
            </a>
            
            ${showThreeDotMenu ? `
                    <button class="mc-menu-btn" data-menu="true" data-action="stop-propagation" aria-label="${window.i18n?.get('movie_card.options') || 'Параметры'}" aria-haspopup="menu" aria-expanded="false" title="Options">
                        <span class="mc-menu-icon">⋮</span>
                    </button>
                    <div class="mc-menu-dropdown" role="menu" data-action="stop-propagation">
                        ${showFavorite ? MovieCard.statusMenuItemHtml('favorite', isFavorite, { movieId: canonicalMovieId, ratingId: data.id }) : ''}
                        ${showWatching ? MovieCard.statusMenuItemHtml('watching', isWatching, { movieId: canonicalMovieId }) : ''}
                        ${showWatched ? MovieCard.statusMenuItemHtml('watched', isWatched, { movieId: canonicalMovieId }) : ''}
                        ${showWatchlist ? MovieCard.statusMenuItemHtml('plan_to_watch', isInWatchlist, { movieId: canonicalMovieId }) : ''}
                        ${hasReview && canonicalMovieId ? `
                            <button class="mc-menu-item" data-action="open-review"
                                    data-movie-id="${canonicalMovieId}"
                                    data-rating-id="${this.escapeHtml(data.id || '')}">
                                <span class="mc-menu-item-icon">▤</span>
                                <span class="mc-menu-item-text">Читать рецензию</span>
                            </button>
                        ` : ''}
                        ${showEditRating ? `
                            <button class="mc-menu-item" data-action="edit-rating"
                                    data-movie-id="${canonicalMovieId || ''}"
                                    data-rating="${rating}"
                                    data-comment="${this.escapeHtml(Utils.normalizeRatingComment(data.comment))}">
                                <span class="mc-menu-item-icon"><svg data-icon="EDIT" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16L4.8 12.2L12.6 4.4A1.7 1.7 0 0 1 15 4.4L15.6 5A1.7 1.7 0 0 1 15.6 7.4L7.8 15.2Z"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M10.4 6.6L12.6 4.4A1.7 1.7 0 0 1 15 4.4L15.6 5A1.7 1.7 0 0 1 15.6 7.4L13.4 9.6Z"/></svg></span>
                                <span class="mc-menu-item-text">${window.i18n?.get('movie_card.edit_rating')}</span>
                            </button>
                        ` : ''}
                        ${showAddToCollection ? `
                            <button class="mc-menu-item" data-action="add-to-collection"
                                    data-movie-id="${canonicalMovieId || ''}">
                                <span class="mc-menu-item-icon"><svg data-icon="FOLDER" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M2 9V6A2 2 0 0 1 4 4H7.6A2 2 0 0 1 9 4.6L10.4 6H16A2 2 0 0 1 18 8V9Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9V14A2 2 0 0 0 5 16H15A2 2 0 0 0 17 14V9"/></svg></span>
                                <span class="mc-menu-item-text">${window.i18n?.get('movie_card.add_collection')}</span>
                            </button>
                        ` : ''}
                        ${showRemoveFromWatching ? `
                            <button class="mc-menu-item" data-action="remove-from-watching"
                                    data-movie-id="${canonicalMovieId || ''}">
                                <span class="mc-menu-item-icon"><svg data-icon="CLOSE" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5L15 15M15 5L5 15"/></svg></span>
                                <span class="mc-menu-item-text">Удалить из "Смотрю"</span>
                            </button>
                        ` : ''}
                        ${showRemoveFromWatched ? `
                            <button class="mc-menu-item" data-action="remove-from-watched"
                                    data-movie-id="${canonicalMovieId || ''}">
                                <span class="mc-menu-item-icon"><svg data-icon="CLOSE" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5L15 15M15 5L5 15"/></svg></span>
                                <span class="mc-menu-item-text">Удалить из "Просмотрено"</span>
                            </button>
                        ` : ''}
                        ${showRemoveFromWatchlist ? `
                            <button class="mc-menu-item" data-action="remove-from-watchlist"
                                    data-movie-id="${canonicalMovieId || ''}">
                                <span class="mc-menu-item-icon"><svg data-icon="TRASH" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M7 4V3A1 1 0 0 1 8 2H12A1 1 0 0 1 13 3V4H16A1 1 0 0 1 17 5V6A1 1 0 0 1 16 7H4A1 1 0 0 1 3 6V5A1 1 0 0 1 4 4Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 8V15A2 2 0 0 0 7 17H13A2 2 0 0 0 15 15V8M10 10V13"/></svg></span>
                                <span class="mc-menu-item-text">${window.i18n?.get('movie_card.remove')}</span>
                            </button>
                        ` : ''}
                        ${showRemoveFromBookmarks ? `
                            <button class="mc-menu-item" data-action="remove-from-bookmarks"
                                    data-movie-id="${canonicalMovieId || ''}">
                                <span class="mc-menu-item-icon"><svg data-icon="TRASH" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M7 4V3A1 1 0 0 1 8 2H12A1 1 0 0 1 13 3V4H16A1 1 0 0 1 17 5V6A1 1 0 0 1 16 7H4A1 1 0 0 1 3 6V5A1 1 0 0 1 4 4Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 8V15A2 2 0 0 0 7 17H13A2 2 0 0 0 15 15V8M10 10V13"/></svg></span>
                                <span class="mc-menu-item-text">Удалить из закладок</span>
                            </button>
                        ` : ''}
                        ${availableCollections.length > 0 ? `
                        <div class="mc-menu-divider" style="height: 1px; background: rgba(255,255,255,0.1); margin: 4px 0;"></div>
                        <div class="mc-menu-collections">
                            ${availableCollections.map(col => MovieCard.collectionMenuItemHtml(col, movieCollections.includes(col.id), canonicalMovieId)).join('')}
                        </div>
                    ` : ''}
                    </div>
                ` : ''}
            
            <div class="mc-content">
                <div class="mc-title-row">
                    <a href="${detailsUrl}" class="mc-title mc-title-link ${isLoading ? 'mc-skeleton' : ''}" 
                        title="${this.escapeHtml(title)}"
                        data-action="view-details"
                        data-movie-id="${canonicalMovieId || ''}"
                        ${movie.tmdbId ? `data-tmdb-id="${movie.tmdbId}"` : ''}
                        data-movie-title="${this.escapeHtml(title)}">
                        ${isLoading ? '' : this.escapeHtml(title)}
                    </a>
                    ${hasReview ? '<span class="mc-review-indicator" title="Есть рецензия" aria-label="Есть рецензия">Рецензия</span>' : ''}
                    ${year ? `<span class="mc-year">${year}</span>` : (isLoading ? '<span class="mc-year mc-skeleton" style="width: 40px; height: 1.2em; border-radius: 4px;"></span>' : '')}
                </div>
                
                ${(showGenres && genres.length > 0) || isLoading ? `
                    <div class="mc-genres ${isLoading ? 'mc-skeleton' : ''}" style="${isLoading ? 'height: 20px; border-radius: 4px;' : ''}">
                        ${isLoading ? '' : genres.slice(0, 3).map(genre => 
                            `<span class="mc-genre-tag">${this.escapeHtml(genre)}</span>`
                        ).join('')}
                    </div>
                ` : ''}

                ${watchingProgress && !animeStyle ? `
                    <div class="mc-progress-info" 
                         data-action="resume-watching"
                         data-movie-id="${canonicalMovieId || ''}"
                         title="Нажмите, чтобы продолжить просмотр"
                         style="margin-top: 6px; font-size: 13px; color: #4da6ff; font-weight: 500; display: flex; align-items: center; gap: 5px; cursor: pointer; transition: opacity 0.2s;">
                        <svg data-icon="PLAY_BOX" aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 3H14A3 3 0 0 1 17 6V14A3 3 0 0 1 14 17H6A3 3 0 0 1 3 14V6A3 3 0 0 1 6 3Z"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M8 7.2C8 6.6 8.7 6.2 9.2 6.6L13 9.3C13.5 9.7 13.5 10.3 13 10.7L9.2 13.4C8.7 13.8 8 13.4 8 12.8Z"/></svg>
                        <span>${this.escapeHtml(watchingProgress)}</span>
                    </div>
                ` : ''}
                
                ${showDescription && description ? `
                    <p class="mc-description">${this.escapeHtml(truncatedDescription)}</p>
                ` : ''}
                
                ${animeStyle ? `
                    <${(options.watchingProgress || isWatched) ? 'div' : 'a href="' + detailsUrl + '"'} class="mc-progress-display" data-action="${options.watchingProgress || isWatched ? 'resume-watching' : 'view-details'}" data-movie-id="${canonicalMovieId || ''}">
                        ${isWatched ? `
                                <svg data-icon="CHECK" style="color: #4ade80;" aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 10.6L8 14.6L16 5.4"/></svg>
                                <span class="mc-progress-text" style="color: #4ade80;"> ${window.i18n?.get('movie_card.add_watched') || 'Просмотрено'}</span>
                            ` : options.watchingProgress ? `
                                <svg data-icon="CLOCK" style="color: #4ade80;" aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 3A7 7 0 1 0 10 17A7 7 0 1 0 10 3Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6V10L12.6 12"/></svg>
                                <span class="mc-progress-text">${this.escapeHtml(options.watchingProgress)}</span>
                            ` : `
                                <svg data-icon="INFO" style="color: #94a3b8;" aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 3H14A3 3 0 0 1 17 6V14A3 3 0 0 1 14 17H6A3 3 0 0 1 3 14V6A3 3 0 0 1 6 3Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 10V13.4"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M10 5.5A1.3 1.3 0 1 0 10 8.1A1.3 1.3 0 1 0 10 5.5Z"/></svg>
                                <span class="mc-progress-text placeholder">Не смотрели</span>
                            `}
                    </${(options.watchingProgress || isWatched) ? 'div' : 'a'}>
                    
                    <div class="mc-rating-blocks">
                        ${kinopoiskRating > 0 ? `
                            <div class="mc-rating-block">
                                <span class="mc-rating-block-label">КИНОПОИСК</span>
                                <span class="mc-rating-block-value kp">${this.formatProviderRating(kinopoiskRating)}</span>
                            </div>
                        ` : ''}
                        ${imdbRating > 0 ? `
                            <div class="mc-rating-block">
                                <span class="mc-rating-block-label">IMDb</span>
                                <span class="mc-rating-block-value imdb">${this.formatProviderRating(imdbRating)}</span>
                            </div>
                        ` : ''}
                    </div>
                ` : (kinopoiskRating > 0 || imdbRating > 0 || (showAverageRating && ratingsCount > 0)) ? `
                <div class="mc-ratings-row">
                    <div class="mc-rating-item">
                        <div class="mc-rating-label">${window.i18n?.get('movie_card.kinopoisk') || 'Кинопоиск'}</div>
                        <div class="mc-rating-value mc-rating-kp ${kinopoiskRating > 0 ? '' : 'mc-rating-none'}">${kinopoiskRating > 0 ? this.formatProviderRating(kinopoiskRating) : '—'}</div>
                    </div>
                    <div class="mc-rating-item">
                        <div class="mc-rating-label">IMDb</div>
                        <div class="mc-rating-value mc-rating-imdb ${imdbRating > 0 ? '' : 'mc-rating-none'}">${imdbRating > 0 ? this.formatProviderRating(imdbRating) : '—'}</div>
                    </div>
                    ${showAverageRating ? `
                    <div class="mc-rating-item">
                        <div class="mc-rating-label">${window.i18n?.get('movie_card.avg_rating') || 'Средняя'}</div>
                        <div class="mc-rating-value mc-rating-avg ${ratingsCount > 0 ? '' : 'mc-rating-none'}">
                            ${ratingsCount > 0 ? parseFloat(averageRating.toFixed(1)) : '—'}
                        </div>
                    </div>
                    ` : ''}
                </div>
                ` : `
                <div class="mc-ratings-row mc-ratings-unreleased">
                    <div class="mc-unreleased-badge" title="${this.escapeHtml((Number.isFinite(parseInt(year, 10)) && parseInt(year, 10) >= new Date().getFullYear()) ? this.t('not_released_title', 'Not released yet') : this.t('no_ratings_title', 'No ratings yet'))}">
                        <svg data-icon="CLOCK" class="mc-unreleased-icon" aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 3A7 7 0 1 0 10 17A7 7 0 1 0 10 3Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6V10L12.6 12"/></svg>
                        <span>${this.escapeHtml((Number.isFinite(parseInt(year, 10)) && parseInt(year, 10) >= new Date().getFullYear()) ? this.t('coming_soon', 'Coming soon') : this.t('no_ratings', 'Awaiting ratings'))}</span>
                    </div>
                </div>
                `}
                
                ${showUserInfo && userId ? `
                    <div class="mc-user-info clickable-username" data-user-id="${this.escapeHtml(userId)}" title="${this.escapeHtml(this.t('open_profile', 'Open profile'))}">
                        <img src="${options.userInfoLoading ? 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==' : this.escapeHtml(this.safeImageUrl(userPhoto))}"
                             alt="${this.escapeHtml(userDisplayName || userEmail || this.t('user_fallback', 'User'))}"
                             class="mc-user-avatar ${options.userInfoLoading ? 'mc-skeleton' : ''}"
                             decoding="async">
                        <span class="mc-user-name ${options.userInfoLoading ? 'mc-skeleton' : ''}">
                            ${this.escapeHtml(userDisplayName || userEmail?.split('@')[0] || this.t('user_fallback', 'User'))}
                        </span>
                        ${rating > 0 ? `<span class="mc-user-rating"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg> ${rating}</span>` : ''}
                        
                        ${data.allRaters && data.allRaters.length > 1 ? `
                            <span class="mc-raters-count">${this.escapeHtml(this.t('more_raters', '+{count} more').replace('{count}', String(data.allRaters.length - 1)))}</span>
                            <div class="mc-raters-popup">
                                <div class="mc-raters-popup-inner">
                                ${data.allRaters.map(r => {
                                    const raterDate = r.createdAt?.seconds ? new Date(r.createdAt.seconds * 1000) : new Date(r.createdAt || Date.now());
                                    const dateStr = Number.isNaN(raterDate.getTime()) ? '' : raterDate.toLocaleDateString(this.dateLocale(), { day: '2-digit', month: '2-digit', year: 'numeric' });
                                    return `
                                    <div class="mc-rater-row clickable-rater" data-user-id="${this.escapeHtml(r.userId)}">
                                        <img src="${this.escapeHtml(this.safeImageUrl(r.userPhoto))}" alt="" class="mc-rater-avatar" decoding="async">
                                        <div class="mc-rater-details">
                                            <span class="mc-rater-name">${this.escapeHtml(r.userDisplayName || r.userEmail?.split('@')[0] || this.t('user_fallback', 'User'))}</span>
                                            <span class="mc-rater-date">${dateStr}</span>
                                        </div>
                                        <span class="mc-rater-score">
                                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                                            ${this.escapeHtml(r.rating)}
                                        </span>
                                    </div>
                                    `;
                                }).join('')}
                                </div>
                            </div>
                        ` : ''}
                    </div>
                ` : rating > 0 && !showUserInfo && showUserRating ? `
                    <div class="mc-my-rating">
                        <span class="mc-rating-icon"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg></span>
                        <span class="mc-rating-text">${window.i18n?.get('movie_card.my_rating')}: ${rating}</span>
                    </div>
                ` : ''}
            </div>
        `;
        }

        // Attach event listeners
        this.attachEventListeners(card);
        // CSP blocks inline onerror handlers, so image fallbacks are bound here
        this.bindImageFallbacks(card);
        if (typeof Utils !== 'undefined') Utils.bindImageReveal?.(card, '.mc-poster, .mc-user-avatar, .mc-rater-avatar');

        return card;
    }

    /** Localized movie card text with an English fallback. */
    static t(key, fallback = '') {
        const fullKey = `movie_card.${key}`;
        const value = window.i18n?.get?.(fullKey);
        return value && value !== fullKey ? value : fallback;
    }

    static dateLocale() {
        return window.i18n?.currentLocale === 'en' ? 'en-US' : 'ru-RU';
    }

    /**
     * Only http(s), inline image data and extension-relative paths may be used as an
     * image source; user profile fields such as photoURL are otherwise untrusted.
     */
    static safeImageUrl(url, fallback = '/src/shared/assets/icons/app/icon48.png') {
        const value = typeof url === 'string' ? url.trim() : '';
        if (!value) return fallback;
        if (/^(?:https?|chrome-extension):\/\//i.test(value) || /^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(value)) return value;
        if (value.startsWith('/') && !value.startsWith('//')) return value;
        return fallback;
    }

    /**
     * Capture-phase image error handler on a card (or any container): posters fall
     * back to the app poster, avatars to the app icon. Bound once per element, it
     * also covers images whose markup is replaced later (e.g. the user info row).
     */
    static bindImageFallbacks(root) {
        if (!root || typeof root.addEventListener !== 'function' || root.dataset?.imageFallbacksBound === 'true') return;
        if (root.dataset) root.dataset.imageFallbacksBound = 'true';
        root.addEventListener('error', (event) => {
            const img = event.target;
            if (img?.tagName !== 'IMG' || img.dataset?.fallbackApplied === 'true') return;
            const isAvatar = img.classList.contains('mc-user-avatar') || img.classList.contains('mc-rater-avatar');
            if (!isAvatar && !img.classList.contains('mc-poster')) return;
            img.dataset.fallbackApplied = 'true';
            if (isAvatar) {
                img.src = '/src/shared/assets/icons/app/icon48.png';
            } else if (typeof Utils !== 'undefined' && Utils.handlePosterError) {
                Utils.handlePosterError(img);
            }
        }, true);
    }

    /**
     * Attach event listeners to the card
     */
    static setMenuState(menuDropdown, isOpen) {
        if (!menuDropdown) return;

        menuDropdown.classList.toggle('active', isOpen);
        menuDropdown.inert = !isOpen;
        const card = menuDropdown.closest?.('.movie-card-component');
        const menuBtn = card?.querySelector?.('.mc-menu-btn');
        menuBtn?.setAttribute('aria-expanded', String(isOpen));

        if (isOpen) this.fitMenuToClipArea(menuDropdown);
    }

    /**
     * Keeps an open dropdown inside the nearest scroll/clip container
     * (e.g. the horizontal recommendations carousel), which would otherwise
     * cut off the right-anchored menu on narrow cards.
     */
    static fitMenuToClipArea(menuDropdown) {
        if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return;

        menuDropdown.classList.remove('mc-menu-dropdown--align-start');
        menuDropdown.style.maxHeight = '';
        menuDropdown.style.overflowY = '';

        const margin = 8;
        const bounds = {
            left: 0,
            top: 0,
            right: window.innerWidth || document.documentElement.clientWidth || 0,
            bottom: window.innerHeight || document.documentElement.clientHeight || 0
        };
        for (let el = menuDropdown.parentElement; el && el !== document.body; el = el.parentElement) {
            const style = window.getComputedStyle(el);
            if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
            const rect = el.getBoundingClientRect();
            bounds.left = Math.max(bounds.left, rect.left);
            bounds.top = Math.max(bounds.top, rect.top);
            bounds.right = Math.min(bounds.right, rect.right);
            bounds.bottom = Math.min(bounds.bottom, rect.bottom);
            break;
        }
        if (bounds.right <= bounds.left || bounds.bottom <= bounds.top) return;

        const endRect = menuDropdown.getBoundingClientRect();
        if (!endRect.width) return;
        if (endRect.left < bounds.left + margin) {
            menuDropdown.classList.add('mc-menu-dropdown--align-start');
            const startRect = menuDropdown.getBoundingClientRect();
            const endOverflow = bounds.left + margin - endRect.left;
            const startOverflow = Math.max(0, startRect.right - (bounds.right - margin));
            if (startOverflow > endOverflow) {
                menuDropdown.classList.remove('mc-menu-dropdown--align-start');
            }
        }

        const rect = menuDropdown.getBoundingClientRect();
        const available = Math.floor(bounds.bottom - margin - rect.top);
        if (rect.bottom > bounds.bottom - margin && available > 0) {
            menuDropdown.style.maxHeight = `${Math.max(available, 120)}px`;
            menuDropdown.style.overflowY = 'auto';
        }
    }

    static closeOpenMenus(exceptDropdown = null) {
        if (typeof document === 'undefined' || !document.querySelectorAll) return;

        document.querySelectorAll('.mc-menu-dropdown.active').forEach(menu => {
            if (menu !== exceptDropdown) {
                this.setMenuState(menu, false);
            }
        });
    }

    static attachEventListeners(card) {
        const menuBtn = card.querySelector('.mc-menu-btn');
        const menuDropdown = card.querySelector('.mc-menu-dropdown');

        if (!menuBtn || !menuDropdown) return;
        menuDropdown.inert = !menuDropdown.classList.contains('active');

        if (!this._documentMenuListenerBound && typeof document !== 'undefined') {
            this._documentMenuListenerBound = true;

            document.addEventListener('mousedown', (event) => {
                const target = event.target;
                if (target?.closest?.('.mc-menu-btn, .mc-menu-dropdown')) return;
                this.closeOpenMenus();
            });

            document.addEventListener('keydown', (event) => {
                if (event.key !== 'Escape') return;

                const activeMenu = document.querySelector('.mc-menu-dropdown.active');
                if (!activeMenu) return;

                const activeCard = activeMenu.closest?.('.movie-card-component');
                const activeButton = activeCard?.querySelector?.('.mc-menu-btn');
                this.setMenuState(activeMenu, false);
                activeButton?.focus();
            });
        }

        const toggleMenu = (isOpen = !menuDropdown.classList.contains('active')) => {
            this.closeOpenMenus(menuDropdown);
            this.setMenuState(menuDropdown, isOpen);

            if (isOpen) {
                menuDropdown.querySelector('.mc-menu-item')?.focus();
            }
        };

        menuBtn.addEventListener('mousedown', (event) => {
            event.stopPropagation();
        });

        menuBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            toggleMenu();
        });

        menuBtn.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                toggleMenu(true);
            } else if (event.key === 'Escape') {
                event.preventDefault();
                toggleMenu(false);
            }
        });

        menuDropdown.addEventListener('keydown', (event) => {
            const items = [...menuDropdown.querySelectorAll('.mc-menu-item')];

            if (event.key === 'Escape') {
                event.preventDefault();
                toggleMenu(false);
                menuBtn.focus();
                return;
            }

            if (!items.length || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;

            event.preventDefault();
            const currentIndex = items.indexOf(document.activeElement);
            const nextIndex = event.key === 'Home'
                ? 0
                : event.key === 'End'
                    ? items.length - 1
                    : (currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
            items[nextIndex].focus();
        });

        menuDropdown.addEventListener('click', (event) => {
            if (event.target.closest?.('.mc-menu-item')) {
                this.setMenuState(menuDropdown, false);
            }
        });
    }

    /**
     * Create a compact detailed movie card for random page
     * Shows all movie info in a two-column layout that fits on screen
     * @param {Object} movie - Full movie data object
     * @param {Object} options - Configuration options
     * @returns {HTMLElement} - The compact movie card element
     */
    static createCompactDetail(movie, options = {}) {
        // options is currently unused but kept for future extensions

        // Helper to get person names by profession
        const getPersonsByProfession = (persons, profession) => {
            if (!persons || !Array.isArray(persons)) return [];
            return persons.filter(p => p.profession === profession || p.enProfession === profession);
        };
        
        const formatPersonNames = (persons) => {
            if (!persons || persons.length === 0) return '';
            return persons.slice(0, 3).map(p => p.name || p.enName || '').filter(n => n).join(', ');
        };

        const formatCurrency = (value) => {
            if (!value) return '';
            const val = value.value || value;
            const currency = value.currency || '$';
            if (typeof val === 'number') {
                return currency + val.toLocaleString('en-US');
            }
            return '';
        };

        const formatDate = (dateStr) => {
            if (!dateStr) return '';
            try {
                const date = new Date(dateStr);
                return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
            } catch {
                return dateStr;
            }
        };

        const formatVotes = (votes) => (votes ? Utils.formatCompactNumber(votes) : '');

        // Extract data
        const posterUrl = (typeof PosterUrl !== 'undefined' ? PosterUrl.safe(movie.posterUrl) : '')
            || '/src/shared/assets/icons/app/icon48.png';
        const movieName = movie.name || movie.nameRu || 'Неизвестный фильм';
        const movieAltName = movie.alternativeName || movie.nameEn || '';
        const year = movie.year || '';
        const countries = typeof Utils !== 'undefined' && Utils.formatCountries
            ? Utils.formatCountries(movie.countries)
            : (Array.isArray(movie.countries) ? movie.countries.map(c => (typeof c === 'string' ? c : (c?.name || c?.country || ''))).filter(Boolean).join(', ') : '');
        const genres = typeof Utils !== 'undefined' && Utils.formatGenres
            ? Utils.formatGenres(movie.genres)
            : (Array.isArray(movie.genres) ? movie.genres.map(g => (typeof g === 'string' ? g : (g?.name || g?.genre || ''))).filter(Boolean).join(', ') : '');
        const slogan = movie.slogan || '';
        const duration = Number(movie.duration || movie.movieLength || 0) || 0;
        const ageRating = movie.ageRating || movie.ratingAgeLimits || '';
        
        const kpRating = Number(movie.kpRating ?? movie.rating?.kp ?? 0) || 0;
        const imdbRating = Number(movie.imdbRating ?? movie.rating?.imdb ?? 0) || 0;
        const votes = Number(movie.votes?.kp ?? movie.votesKp ?? 0) || 0;
        const imdbVotes = Number(movie.votes?.imdb ?? movie.votesImdb ?? 0) || 0;

        // Persons
        const directors = getPersonsByProfession(movie.persons, 'DIRECTOR');
        const writers = getPersonsByProfession(movie.persons, 'WRITER');
        const producers = getPersonsByProfession(movie.persons, 'PRODUCER');
        const operators = getPersonsByProfession(movie.persons, 'OPERATOR');
        const composers = getPersonsByProfession(movie.persons, 'COMPOSER');
        const designers = getPersonsByProfession(movie.persons, 'DESIGNER');
        const editors = getPersonsByProfession(movie.persons, 'EDITOR');

        // Financial
        const budget = formatCurrency(movie.budget);
        const feesWorld = formatCurrency(movie.fees?.world);

        // Premiere dates
        const premiereWorld = formatDate(movie.premiere?.world);

        // Build meta items array (only items with values)
        const metaItems = [];
        if (year) metaItems.push({ label: 'ГОД ПРОИЗВОДСТВА:', value: year });
        if (countries) metaItems.push({ label: 'СТРАНА:', value: countries });
        if (genres) metaItems.push({ label: 'ЖАНР:', value: genres });
        if (slogan) metaItems.push({ label: 'СЛОГАН:', value: `«${slogan}»` });
        if (directors.length > 0) metaItems.push({ label: 'РЕЖИССЁР:', value: formatPersonNames(directors) });
        if (writers.length > 0) metaItems.push({ label: 'СЦЕНАРИЙ:', value: formatPersonNames(writers) });
        if (producers.length > 0) metaItems.push({ label: 'ПРОДЮСЕР:', value: formatPersonNames(producers) });
        if (operators.length > 0) metaItems.push({ label: 'ОПЕРАТОР:', value: formatPersonNames(operators) });
        if (composers.length > 0) metaItems.push({ label: 'КОМПОЗИТОР:', value: formatPersonNames(composers) });
        if (designers.length > 0) metaItems.push({ label: 'ХУДОЖНИК:', value: formatPersonNames(designers) });
        if (editors.length > 0) metaItems.push({ label: 'МОНТАЖ:', value: formatPersonNames(editors) });
        if (budget) metaItems.push({ label: 'БЮДЖЕТ:', value: budget });
        if (feesWorld) metaItems.push({ label: 'СБОРЫ В МИРЕ:', value: feesWorld });
        if (premiereWorld) metaItems.push({ label: 'ПРЕМЬЕРА В МИРЕ:', value: premiereWorld });
        if (ageRating) metaItems.push({ label: 'ВОЗРАСТ:', value: `${ageRating}+` });
        if (duration) {
            const hours = Math.floor(duration / 60);
            const minutes = duration % 60;
            const timeStr = hours > 0 ? `${hours} ч ${minutes} мин` : `${minutes} мин`;
            metaItems.push({ label: 'ВРЕМЯ:', value: timeStr });
        }

        // Canonical ID extraction
        const canonicalMovieId = (typeof Utils !== 'undefined' && Utils.extractKinopoiskId)
            ? (Utils.extractKinopoiskId(movie) || movie.kinopoiskId || movie.id)
            : (movie.kinopoiskId || movie.id);

        // Create card element
        const card = document.createElement('div');
        card.className = 'compact-movie-card';
        if (canonicalMovieId) card.dataset.movieId = String(canonicalMovieId);

        card.innerHTML = `
            <div class="cmc-layout">
                <div class="cmc-poster-section">
                    <img src="${this.escapeHtml(posterUrl)}"
                         alt="${this.escapeHtml(movieName)}" 
                         class="cmc-poster"
                         decoding="async">
                    
                    <div class="cmc-ratings">
                        ${kpRating > 0 ? `
                            <div class="cmc-rating-badge cmc-rating-kp">
                                <span class="cmc-rating-label">Кинопоиск</span>
                                <span class="cmc-rating-value">${this.formatProviderRating(kpRating)}</span>
                                ${votes > 0 ? `<span class="cmc-rating-votes">${formatVotes(votes)} оценок</span>` : ''}
                            </div>
                        ` : ''}
                        ${imdbRating > 0 ? `
                            <div class="cmc-rating-badge cmc-rating-imdb">
                                <span class="cmc-rating-label">IMDb</span>
                                <span class="cmc-rating-value">${this.formatProviderRating(imdbRating)}</span>
                                ${imdbVotes > 0 ? `<span class="cmc-rating-votes">${formatVotes(imdbVotes)} оценок</span>` : ''}
                            </div>
                        ` : ''}
                    </div>
                </div>
                
                <div class="cmc-info">
                    <div class="cmc-header">
                        <h2 class="cmc-title">${this.escapeHtml(movieName)}</h2>
                        ${movieAltName && movieAltName !== movieName ? `<p class="cmc-subtitle">${this.escapeHtml(movieAltName)}</p>` : ''}
                        
                        <button class="cmc-reload-btn" data-action="reload" title="Найти другой фильм">
                            <svg data-icon="REFRESH" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9A7 7 0 0 1 15.6 5.6L17 7M17 3V7H13M17 11A7 7 0 0 1 4.4 14.4L3 13M3 17V13H7"/></svg>
                        </button>
                    </div>
                    
                    <div class="cmc-meta-grid">
                        ${metaItems.map(item => `
                            <div class="cmc-meta-item">
                                <span class="cmc-meta-label">${item.label}</span>
                                <span class="cmc-meta-value" title="${this.escapeHtml(item.value)}">${this.escapeHtml(item.value)}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
            
            <button class="cmc-watch-btn" data-action="watch" data-movie-id="${canonicalMovieId || ''}">
                <svg data-icon="PLAY" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M5 3.9C5 2.9 5.9 2.3 6.7 2.9L16.2 8.9C17 9.5 17 10.5 16.2 11.1L6.7 17.1C5.9 17.7 5 17.1 5 16.1Z"/></svg>
                Смотреть
            </button>
        `;

        // Attach poster error listener (CSP-safe, no inline onerror)
        const posterEl = card.querySelector('.cmc-poster');
        if (posterEl) {
            posterEl.addEventListener('error', () => {
                if (typeof Utils !== 'undefined' && Utils.handlePosterError) {
                    Utils.handlePosterError(posterEl);
                } else {
                    posterEl.src = '/src/shared/assets/icons/app/icon48.png';
                }
            });
        }

        // Attach watch button handler
        const watchBtn = card.querySelector('.cmc-watch-btn');
        if (watchBtn) {
            watchBtn.addEventListener('click', () => {
                const movieId = canonicalMovieId;
                if (movieId) {
                    window.location.href = chrome.runtime.getURL(`src/pages/movie-details/movie-details.html?movieId=${movieId}`);
                }
            });
        }

        return card;
    }

    /**
     * Escape HTML to prevent XSS (generic string escaping primitive)
     */
    static escapeHtml(text) {
        if (text === null || text === undefined) return '';
        // String replacement in every environment: the textContent/innerHTML trick
        // leaves quotes unescaped, which broke out of attribute values.
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
}

// Make available globally and for modules
if (typeof window !== 'undefined') {
    window.MovieCard = MovieCard;
}
if (typeof globalThis !== 'undefined') {
    globalThis.MovieCard = MovieCard;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MovieCard };
}
