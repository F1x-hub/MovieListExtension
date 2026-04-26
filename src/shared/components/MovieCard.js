/**
 * Reusable Movie Card Component
 * Creates a consistent movie card UI across all pages
 */
class MovieCard {
    /**
     * Create a movie card element
     * @param {Object} data - Movie data object
     * @param {Object} options - Configuration options for the card
     * @returns {HTMLElement} - The movie card element
     */
    static create(data, options = {}) {
        const {
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
            showGenres = true, // New option
            showDescription = true, // New option
            animeStyle = false, // New: Use anime-style card design
            watchingProgress = null,
            availableCollections = [], // New: List of all custom collections
            movieCollections = []      // New: List of collection IDs this movie is in
        } = options;

        // Extract data with fallbacks
        const movie = data.movie || {};
        const isEnglish = window.i18n?.currentLocale === 'en';
        
        // Prefer English title if in English mode
        const title = (isEnglish && movie.alternativeName) 
            ? movie.alternativeName 
            : (movie.name || data.movieTitle || window.i18n?.get('movie_card.unknown_movie') || 'Unknown Movie');

        const posterUrl = movie.posterUrl || '/icons/icon48.png';
        const year = movie.year || data.releaseYear || '';
        
        // Localize genres if possible
        const rawGenres = movie.genres || [];
        const genres = rawGenres.map(genre => {
            // Find key in locale for this genre
            if (window.i18n) {
                const genreEntry = Object.entries(window.i18n.locales.ru.random.genres).find(([key, val]) => val.toLowerCase() === genre.toLowerCase());
                if (genreEntry) {
                    return window.i18n.get(`random.genres.${genreEntry[0]}`);
                }
            }
            return genre;
        });

        const description = movie.description || '';
        const rating = data.rating || 0;
        const averageRating = data.averageRating || 0;
        const ratingsCount = data.ratingsCount || 0;
        const kinopoiskRating = movie.kpRating || 0;
        const imdbRating = movie.imdbRating || 0;
        
        // User info
        const userId = data.userId;
        const userDisplayName = data.userDisplayName || data.userName;
        const userEmail = data.userEmail;
        const userPhoto = data.userPhoto;
        
        const isWatching = options.isWatching || data.isWatching || false;
        const isWatched = options.isWatched || data.isWatched || false;
        const isInWatchlist = options.isInWatchlist || data.isInWatchlist || false;
        const isFavorite = data.isFavorite || options.isFavorite || false;

        // Truncate description
        const truncatedDescription = description.length > 150 
            ? description.substring(0, 150) + '...' 
            : description;

        const isLoading = title === 'Loading...' || title === window.i18n?.get('movie_card.unknown_movie');

        // Create card element
        const card = document.createElement('div');
        card.className = `movie-card-component fade-in${animeStyle ? ' anime-style' : ''}${isLoading ? ' mc-is-loading' : ''}`;
        card.dataset.movieId = movie.kinopoiskId || data.movieId;
        if (data.id) card.dataset.ratingId = data.id;

        const detailsUrl = movie.kinopoiskId || data.movieId 
            ? chrome.runtime.getURL(`src/pages/movie-details/movie-details.html?movieId=${movie.kinopoiskId || data.movieId}`)
            : '#';

        // Build card HTML
        card.innerHTML = `
            <a href="${detailsUrl}" class="mc-poster-container ${isLoading ? 'mc-skeleton' : ''}" data-action="view-details" data-movie-id="${movie.kinopoiskId || data.movieId}">
                <img src="${posterUrl}" 
                     alt="${this.escapeHtml(title)}" 
                     class="mc-poster" 
                     decoding="async"
                     onerror="Utils.handlePosterError(this)">
                ${animeStyle ? '<div class="mc-poster-overlay"></div>' : ''}
            </a>
            
            ${showThreeDotMenu ? `
                    <button class="mc-menu-btn" data-menu="true" data-action="stop-propagation" title="Options">
                        <span class="mc-menu-icon">⋮</span>
                    </button>
                    <div class="mc-menu-dropdown" data-action="stop-propagation">
                        ${showFavorite ? `
                            <button class="mc-menu-item" data-action="toggle-favorite" 
                                    data-rating-id="${data.id}"
                                    data-movie-id="${movie.kinopoiskId || data.movieId}" 
                                    data-is-favorite="${isFavorite}"
                                    ${isFavorite ? 'style="background-color: #c0c0c0; color: #000;"' : ''}>
                                <span class="mc-menu-item-icon">${isFavorite ? '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>' : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>'}</span>
                                <span class="mc-menu-item-text" ${isFavorite ? 'style="font-weight: 500;"' : ''}>${isFavorite ? window.i18n?.get('movie_card.remove_favorite') : window.i18n?.get('movie_card.add_favorite')}</span>
                            </button>
                        ` : ''}
                        ${showWatching ? `
                            <button class="mc-menu-item" data-action="toggle-watching"
                                    data-movie-id="${movie.kinopoiskId || data.movieId}"
                                    data-is-watching="${isWatching}"
                                    ${isWatching ? 'style="background-color: #c0c0c0; color: #000;"' : ''}>
                                <span class="mc-menu-item-icon"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg></span>
                                <span class="mc-menu-item-text" ${isWatching ? 'style="font-weight: 500;"' : ''}>${isWatching ? window.i18n?.get('movie_card.remove_watching') : window.i18n?.get('movie_card.add_watching')}</span>
                            </button>
                        ` : ''}
                        ${showWatched ? `
                            <button class="mc-menu-item" data-action="toggle-watched"
                                    data-movie-id="${movie.kinopoiskId || data.movieId}"
                                    data-is-watched="${isWatched}"
                                    ${isWatched ? 'style="background-color: #c0c0c0; color: #000;"' : ''}>
                                <span class="mc-menu-item-icon"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg></span>
                                <span class="mc-menu-item-text" ${isWatched ? 'style="font-weight: 500;"' : ''}>${isWatched ? window.i18n?.get('movie_card.remove_watched') : window.i18n?.get('movie_card.add_watched')}</span>
                            </button>
                        ` : ''}
                        ${showWatchlist ? `
                            <button class="mc-menu-item" data-action="toggle-watchlist"
                                    data-movie-id="${movie.kinopoiskId || data.movieId}"
                                    data-is-in-watchlist="${isInWatchlist}"
                                    ${isInWatchlist ? 'style="background-color: #c0c0c0; color: #000;"' : ''}>
                                <span class="mc-menu-item-icon">${isInWatchlist ? '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>' : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>'}</span>
                                <span class="mc-menu-item-text" ${isInWatchlist ? 'style="font-weight: 500;"' : ''}>${isInWatchlist ? window.i18n?.get('movie_card.remove_watchlist') : window.i18n?.get('movie_card.add_watchlist')}</span>
                            </button>
                        ` : ''}
                        ${showEditRating ? `
                            <button class="mc-menu-item" data-action="edit-rating"
                                    data-movie-id="${movie.kinopoiskId || data.movieId}"
                                    data-rating="${rating}"
                                    data-comment="${this.escapeHtml(data.comment || '')}">
                                <span class="mc-menu-item-icon"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></span>
                                <span class="mc-menu-item-text">${window.i18n?.get('movie_card.edit_rating')}</span>
                            </button>
                        ` : ''}
                        ${showAddToCollection ? `
                            <button class="mc-menu-item" data-action="add-to-collection"
                                    data-movie-id="${movie.kinopoiskId || data.movieId}">
                                <span class="mc-menu-item-icon"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg></span>
                                <span class="mc-menu-item-text">${window.i18n?.get('movie_card.add_collection')}</span>
                            </button>
                        ` : ''}
                        ${showRemoveFromWatching ? `
                            <button class="mc-menu-item" data-action="remove-from-watching"
                                    data-movie-id="${movie.kinopoiskId || data.movieId}">
                                <span class="mc-menu-item-icon"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></span>
                                <span class="mc-menu-item-text">Удалить из "Смотрю"</span>
                            </button>
                        ` : ''}
                        ${showRemoveFromWatched ? `
                            <button class="mc-menu-item" data-action="remove-from-watched"
                                    data-movie-id="${movie.kinopoiskId || data.movieId}">
                                <span class="mc-menu-item-icon"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></span>
                                <span class="mc-menu-item-text">Удалить из "Просмотрено"</span>
                            </button>
                        ` : ''}
                        ${showRemoveFromWatchlist ? `
                            <button class="mc-menu-item" data-action="remove-from-watchlist"
                                    data-movie-id="${movie.kinopoiskId || data.movieId}">
                                <span class="mc-menu-item-icon"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></span>
                                <span class="mc-menu-item-text">${window.i18n?.get('movie_card.remove')}</span>
                            </button>
                        ` : ''}
                        ${showRemoveFromBookmarks ? `
                            <button class="mc-menu-item" data-action="remove-from-bookmarks"
                                    data-movie-id="${movie.kinopoiskId || data.movieId}">
                                <span class="mc-menu-item-icon"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></span>
                                <span class="mc-menu-item-text">Удалить из закладок</span>
                            </button>
                        ` : ''}
                        ${availableCollections.length > 0 ? `
                        <div class="mc-menu-divider" style="height: 1px; background: rgba(255,255,255,0.1); margin: 4px 0;"></div>
                        <div class="mc-menu-collections">
                            ${availableCollections.map(col => {
                                const isInCollection = movieCollections.includes(col.id);
                                const isCustomIcon = col.icon && (col.icon.startsWith('data:') || col.icon.startsWith('https://') || col.icon.startsWith('http://'));
                                const iconHtml = isCustomIcon 
                                    ? `<img src="${col.icon}" style="width: 16px; height: 16px; object-fit: cover; border-radius: 4px;">`
                                    : (col.icon || '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>'); // Default folder icon if none
                                    
                                return `
                                    <button class="mc-menu-item" data-action="toggle-collection"
                                            data-movie-id="${movie.kinopoiskId || data.movieId}"
                                            data-collection-id="${col.id}">
                                        <span class="mc-menu-item-icon">${iconHtml}</span>
                                        <span class="mc-menu-item-text" style="${isInCollection ? 'font-weight: 500; color: #fff;' : ''}">
                                            ${col.name}
                                        </span>
                                        ${isInCollection ? '<span style="margin-left: auto; font-weight: bold; color: var(--accent-color, #4CAF50);"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></span>' : ''}
                                    </button>
                                `;
                            }).join('')}
                        </div>
                    ` : ''}
                    </div>
                ` : ''}
            
            <div class="mc-content">
                <div class="mc-title-row">
                    <a href="${detailsUrl}" class="mc-title mc-title-link ${isLoading ? 'mc-skeleton' : ''}" 
                        title="${this.escapeHtml(title)}"
                        data-action="view-details"
                        data-movie-id="${movie.kinopoiskId || data.movieId}">
                        ${isLoading ? '' : this.escapeHtml(title)}
                    </a>
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
                         data-movie-id="${movie.kinopoiskId || data.movieId}"
                         title="Нажмите, чтобы продолжить просмотр"
                         style="margin-top: 6px; font-size: 13px; color: #4da6ff; font-weight: 500; display: flex; align-items: center; gap: 5px; cursor: pointer; transition: opacity 0.2s;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polygon points="10 8 16 12 10 16 10 8"></polygon></svg>
                        <span>${this.escapeHtml(watchingProgress)}</span>
                    </div>
                ` : ''}
                
                ${showDescription && description ? `
                    <p class="mc-description">${this.escapeHtml(truncatedDescription)}</p>
                ` : ''}
                
                ${animeStyle ? `
                    <${(options.watchingProgress || isWatched) ? 'div' : 'a href="' + detailsUrl + '"'} class="mc-progress-display" data-action="${options.watchingProgress || isWatched ? 'resume-watching' : 'view-details'}" data-movie-id="${movie.kinopoiskId || data.movieId}">
                        ${isWatched ? `
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #4ade80;">
                                    <polyline points="20 6 9 17 4 12"></polyline>
                                </svg>
                                <span class="mc-progress-text" style="color: #4ade80;"> ${window.i18n?.get('movie_card.add_watched') || 'Просмотрено'}</span>
                            ` : options.watchingProgress ? `
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #4ade80;">
                                    <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"></path>
                                    <polyline points="12 6 12 12 16 14"></polyline>
                                </svg>
                                <span class="mc-progress-text">${this.escapeHtml(options.watchingProgress)}</span>
                            ` : `
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #94a3b8;">
                                    <circle cx="12" cy="12" r="10"></circle>
                                    <line x1="12" y1="8" x2="12" y2="12"></line>
                                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                                </svg>
                                <span class="mc-progress-text placeholder">Не смотрели</span>
                            `}
                    </${(options.watchingProgress || isWatched) ? 'div' : 'a'}>
                    
                    <div class="mc-rating-blocks">
                        ${kinopoiskRating > 0 ? `
                            <div class="mc-rating-block">
                                <span class="mc-rating-block-label">КИНОПОИСК</span>
                                <span class="mc-rating-block-value kp">${parseFloat(kinopoiskRating.toFixed(1))}</span>
                            </div>
                        ` : ''}
                        ${imdbRating > 0 ? `
                            <div class="mc-rating-block">
                                <span class="mc-rating-block-label">IMDb</span>
                                <span class="mc-rating-block-value imdb">${parseFloat(imdbRating.toFixed(1))}</span>
                            </div>
                        ` : ''}
                    </div>
                ` : `
                <div class="mc-ratings-row">
                    ${kinopoiskRating > 0 ? `
                        <div class="mc-rating-item">
                            <div class="mc-rating-label">${window.i18n?.get('movie_card.kinopoisk')}</div>
                            <div class="mc-rating-value mc-rating-kp">${parseFloat(kinopoiskRating.toFixed(1))}</div>
                        </div>
                    ` : ''}
                    ${imdbRating > 0 ? `
                        <div class="mc-rating-item">
                            <div class="mc-rating-label">IMDb</div>
                            <div class="mc-rating-value mc-rating-imdb">${parseFloat(imdbRating.toFixed(1))}</div>
                        </div>
                    ` : ''}
                    ${showAverageRating ? `
                    <div class="mc-rating-item">
                        <div class="mc-rating-label">${window.i18n?.get('movie_card.avg_rating')}</div>
                        <div class="mc-rating-value mc-rating-avg">
                            ${ratingsCount > 0 ? parseFloat(averageRating.toFixed(1)) : (window.i18n?.get('movie_card.not_available') || 'N/A')}
                        </div>
                    </div>
                    ` : ''}
                </div>
                `}
                
                ${showUserInfo && userId ? `
                    <div class="mc-user-info clickable-username" data-user-id="${userId}" title="Перейти в профиль">
                        <img src="${options.userInfoLoading ? 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==' : (userPhoto || '/icons/icon48.png')}" 
                             alt="${this.escapeHtml(userDisplayName || userEmail || 'User')}" 
                             class="mc-user-avatar ${options.userInfoLoading ? 'mc-skeleton' : ''}" 
                             decoding="async"
                             onerror="Utils.handlePosterError(this)">
                        <span class="mc-user-name ${options.userInfoLoading ? 'mc-skeleton' : ''}">
                            ${this.escapeHtml(userDisplayName || userEmail?.split('@')[0] || 'User')}
                        </span>
                        ${rating > 0 ? `<span class="mc-user-rating"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg> ${rating}</span>` : ''}
                        
                        ${data.allRaters && data.allRaters.length > 1 ? `
                            <span class="mc-raters-count">+${data.allRaters.length - 1} ещё</span>
                            <div class="mc-raters-popup">
                                ${data.allRaters.map(r => {
                                    const raterDate = r.createdAt?.seconds ? new Date(r.createdAt.seconds * 1000) : new Date(r.createdAt || Date.now());
                                    const dateStr = raterDate.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
                                    return `
                                    <div class="mc-rater-row clickable-rater" data-user-id="${r.userId}">
                                        <img src="${r.userPhoto || '/icons/icon48.png'}" class="mc-rater-avatar" onerror="Utils.handlePosterError(this)">
                                        <div class="mc-rater-details">
                                            <span class="mc-rater-name">${this.escapeHtml(r.userDisplayName || r.userEmail?.split('@')[0] || 'User')}</span>
                                            <span class="mc-rater-date">${dateStr}</span>
                                        </div>
                                        <span class="mc-rater-score">
                                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                                            ${r.rating}
                                        </span>
                                    </div>
                                    `;
                                }).join('')}
                            </div>
                        ` : ''}
                    </div>
                ` : rating > 0 && !showUserInfo ? `
                    <div class="mc-my-rating">
                        <span class="mc-rating-icon"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg></span>
                        <span class="mc-rating-text">${window.i18n?.get('movie_card.my_rating')}: ${rating}</span>
                    </div>
                ` : ''}
                
                ${showEditRating || showAddToCollection ? `
                    <div class="mc-actions">
                        <!-- Action buttons section - currently empty, kept for future extensions -->
                    </div>
                ` : ''}
            </div>
        `;

        // Attach event listeners
        this.attachEventListeners(card);

        return card;
    }

    /**
     * Attach event listeners to the card
     */
    static attachEventListeners(card) {
        // Three-dot menu toggle
        const menuBtn = card.querySelector('.mc-menu-btn');
        const menuDropdown = card.querySelector('.mc-menu-dropdown');
        
        if (menuBtn && menuDropdown) {
            menuBtn.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                // Close other open menus
                document.querySelectorAll('.mc-menu-dropdown.active').forEach(menu => {
                    if (menu !== menuDropdown) {
                        menu.classList.remove('active');
                    }
                });
                menuDropdown.classList.toggle('active');
            });

            menuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
            });

            // We do NOT stop propagation on menuDropdown because items inside 
            // rely on delegation at the grid level (e.g. toggle-favorite)
            // Instead, we use data-action="stop-propagation" in the template
            // and handle it in the delegation listener.

            // Close menu when clicking outside
            document.addEventListener('mousedown', (e) => {
                if (!card.contains(e.target)) {
                    menuDropdown.classList.remove('active');
                }
            });
        }

        // Menu items will be handled by parent page through event delegation
        // The parent should listen for clicks on elements with data-action attributes
    }

    /**
     * Create a compact detailed movie card for random page
     * Shows all movie info in a two-column layout that fits on screen
     * @param {Object} movie - Full movie data object
     * @param {Object} options - Configuration options
     * @returns {HTMLElement} - The compact movie card element
     */
    static createCompactDetail(movie, options = {}) {
        const {
            onWatch = null // callback when "Watch" button is clicked
        } = options;

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
            } catch (e) {
                return dateStr;
            }
        };

        const formatVotes = (votes) => {
            if (!votes) return '';
            if (votes >= 1000000) return (votes / 1000000).toFixed(1) + 'M';
            if (votes >= 1000) return (votes / 1000).toFixed(0) + 'k';
            return votes.toString();
        };

        // Extract data
        const posterUrl = movie.posterUrl || '/icons/icon48.png';
        const movieName = movie.name || movie.nameRu || 'Неизвестный фильм';
        const movieAltName = movie.alternativeName || movie.nameEn || '';
        const year = movie.year || '';
        const countries = movie.countries?.join(', ') || '';
        const genres = movie.genres?.join(', ') || '';
        const slogan = movie.slogan || '';
        const duration = movie.duration || movie.movieLength || 0;
        const ageRating = movie.ageRating || movie.ratingAgeLimits || '';
        
        const kpRating = movie.kpRating || movie.rating?.kp || 0;
        const imdbRating = movie.imdbRating || movie.rating?.imdb || 0;
        const votes = movie.votes?.kp || movie.votesKp || 0;
        const imdbVotes = movie.votes?.imdb || movie.votesImdb || 0;

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
        const feesUsa = formatCurrency(movie.fees?.usa);
        const feesWorld = formatCurrency(movie.fees?.world);
        const feesRussia = formatCurrency(movie.fees?.russia);

        // Premiere dates
        const premiereRussia = formatDate(movie.premiere?.russia);
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

        // Create card element
        const card = document.createElement('div');
        card.className = 'compact-movie-card';
        card.dataset.movieId = movie.kinopoiskId || movie.id;

        card.innerHTML = `
            <div class="cmc-layout">
                <div class="cmc-poster-section">
                    <img src="${posterUrl}" 
                         alt="${this.escapeHtml(movieName)}" 
                         class="cmc-poster"
                         decoding="async"
                         onerror="Utils.handlePosterError(this)">
                    
                    <div class="cmc-ratings">
                        ${kpRating > 0 ? `
                            <div class="cmc-rating-badge cmc-rating-kp">
                                <span class="cmc-rating-label">Кинопоиск</span>
                                <span class="cmc-rating-value">${parseFloat(kpRating.toFixed(1))}</span>
                                ${votes > 0 ? `<span class="cmc-rating-votes">${formatVotes(votes)} оценок</span>` : ''}
                            </div>
                        ` : ''}
                        ${imdbRating > 0 ? `
                            <div class="cmc-rating-badge cmc-rating-imdb">
                                <span class="cmc-rating-label">IMDb</span>
                                <span class="cmc-rating-value">${parseFloat(imdbRating.toFixed(1))}</span>
                                ${imdbVotes > 0 ? `<span class="cmc-rating-votes">${formatVotes(imdbVotes)} оценок</span>` : ''}
                            </div>
                        ` : ''}
                    </div>
                </div>
                
                <div class="cmc-info">
                    <div class="cmc-header">
                        <h2 class="cmc-title">${this.escapeHtml(movieName)}</h2>
                        ${movieAltName ? `<p class="cmc-subtitle">${this.escapeHtml(movieAltName)}</p>` : ''}
                        
                        <button class="cmc-reload-btn" data-action="reload" title="Найти другой фильм">
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M23 4v6h-6"></path>
                                <path d="M1 20v-6h6"></path>
                                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                            </svg>
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
            
            <button class="cmc-watch-btn" data-action="watch" data-movie-id="${movie.kinopoiskId || movie.id}">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z"/>
                </svg>
                Смотреть
            </button>
        `;

        // Attach watch button handler
        const watchBtn = card.querySelector('.cmc-watch-btn');
        if (watchBtn) {
            watchBtn.addEventListener('mousedown', () => {
                const movieId = movie.kinopoiskId || movie.id;
                // Navigate to movie details page
                window.location.href = chrome.runtime.getURL(`src/pages/movie-details/movie-details.html?movieId=${movieId}`);
            });
        }

        return card;
    }

    /**
     * Escape HTML to prevent XSS
     */
    static escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Make available globally
window.MovieCard = MovieCard;
