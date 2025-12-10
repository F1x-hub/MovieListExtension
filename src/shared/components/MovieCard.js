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
            showUserInfo = false,
            showEditRating = false,
            showAddToCollection = false,
            showRemoveFromWatchlist = false,
            showThreeDotMenu = true,
            showAverageRating = true
        } = options;

        // Extract data with fallbacks
        const movie = data.movie || {};
        const posterUrl = movie.posterUrl || '/icons/icon48.png';
        const title = movie.name || data.movieTitle || 'Unknown Movie';
        const year = movie.year || data.releaseYear || '';
        const genres = movie.genres || [];
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
        
        // Truncate description
        const truncatedDescription = description.length > 150 
            ? description.substring(0, 150) + '...' 
            : description;

        // Create card element
        const card = document.createElement('div');
        card.className = 'movie-card-component fade-in';
        card.dataset.movieId = movie.kinopoiskId || data.movieId;
        if (data.id) card.dataset.ratingId = data.id;

        // Build card HTML
        card.innerHTML = `
            <div class="mc-poster-container">
                <img src="${posterUrl}" 
                     alt="${this.escapeHtml(title)}" 
                     class="mc-poster" 
                     onerror="this.src='/icons/icon48.png'">
                
                ${showThreeDotMenu ? `
                    <button class="mc-menu-btn" data-menu="true" title="Options">
                        <span class="mc-menu-icon">⋮</span>
                    </button>
                    <div class="mc-menu-dropdown">
                        ${showFavorite ? `
                            <button class="mc-menu-item" data-action="toggle-favorite" 
                                    data-rating-id="${data.id}" 
                                    data-is-favorite="${data.isFavorite === true}">
                                <span class="mc-menu-item-icon">${data.isFavorite ? '💔' : '❤️'}</span>
                                <span class="mc-menu-item-text">${data.isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}</span>
                            </button>
                        ` : ''}
                        ${showEditRating ? `
                            <button class="mc-menu-item" data-action="edit-rating"
                                    data-movie-id="${movie.kinopoiskId || data.movieId}"
                                    data-rating="${rating}"
                                    data-comment="${this.escapeHtml(data.comment || '')}">
                                <span class="mc-menu-item-icon">✏️</span>
                                <span class="mc-menu-item-text">Edit Rating</span>
                            </button>
                        ` : ''}
                        ${showAddToCollection ? `
                            <button class="mc-menu-item" data-action="add-to-collection"
                                    data-movie-id="${movie.kinopoiskId || data.movieId}">
                                <span class="mc-menu-item-icon">📁</span>
                                <span class="mc-menu-item-text">Add to Collection</span>
                            </button>
                        ` : ''}
                        ${showRemoveFromWatchlist ? `
                            <button class="mc-menu-item" data-action="remove-from-watchlist"
                                    data-movie-id="${movie.kinopoiskId || data.movieId}">
                                <span class="mc-menu-item-icon">🗑️</span>
                                <span class="mc-menu-item-text">Удалить</span>
                            </button>
                        ` : ''}
                    </div>
                ` : ''}
                
                ${showWatchlist ? `
                    <button class="mc-watchlist-btn" 
                            data-action="toggle-watchlist"
                            data-movie-id="${movie.kinopoiskId || data.movieId}" 
                            title="Add to Watchlist">
                        🔖
                    </button>
                ` : ''}
            </div>
            
            <div class="mc-content">
                <div class="mc-title-row">
                    <h3 class="mc-title mc-title-clickable" 
                        title="${this.escapeHtml(title)}"
                        data-action="view-details"
                        data-movie-id="${movie.kinopoiskId || data.movieId}">
                        ${this.escapeHtml(title)}
                    </h3>
                    ${year ? `<span class="mc-year">${year}</span>` : ''}
                </div>
                
                ${genres.length > 0 ? `
                    <div class="mc-genres">
                        ${genres.slice(0, 3).map(genre => 
                            `<span class="mc-genre-tag">${this.escapeHtml(genre)}</span>`
                        ).join('')}
                    </div>
                ` : ''}
                
                ${description ? `
                    <p class="mc-description">${this.escapeHtml(truncatedDescription)}</p>
                ` : ''}
                
                <div class="mc-ratings-row">
                    ${kinopoiskRating > 0 ? `
                        <div class="mc-rating-item">
                            <div class="mc-rating-label">Kinopoisk</div>
                            <div class="mc-rating-value mc-rating-kp">${kinopoiskRating.toFixed(1)}</div>
                        </div>
                    ` : ''}
                    ${imdbRating > 0 ? `
                        <div class="mc-rating-item">
                            <div class="mc-rating-label">IMDb</div>
                            <div class="mc-rating-value mc-rating-imdb">${imdbRating.toFixed(1)}</div>
                        </div>
                    ` : ''}
                    ${showAverageRating ? `
                    <div class="mc-rating-item">
                        <div class="mc-rating-label">Avg Rating</div>
                        <div class="mc-rating-value mc-rating-avg">
                            ${ratingsCount > 0 ? averageRating.toFixed(1) + '/10' : 'N/A'}
                        </div>
                    </div>
                    ` : ''}
                </div>
                
                ${showUserInfo && userId ? `
                    <div class="mc-user-info">
                        <img src="${userPhoto || '/icons/icon48.png'}" 
                             alt="${this.escapeHtml(userDisplayName || userEmail || 'User')}" 
                             class="mc-user-avatar" 
                             onerror="this.src='/icons/icon48.png'">
                        <span class="mc-user-name clickable-username" data-user-id="${userId}">
                            ${this.escapeHtml(userDisplayName || userEmail?.split('@')[0] || 'User')}
                        </span>
                        ${rating > 0 ? `<span class="mc-user-rating"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg> ${rating}/10</span>` : ''}
                    </div>
                ` : rating > 0 && !showUserInfo ? `
                    <div class="mc-my-rating">
                        <span class="mc-rating-icon">⭐</span>
                        <span class="mc-rating-text">My Rating: ${rating}/10</span>
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
            menuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                // Close other open menus
                document.querySelectorAll('.mc-menu-dropdown.active').forEach(menu => {
                    if (menu !== menuDropdown) {
                        menu.classList.remove('active');
                    }
                });
                menuDropdown.classList.toggle('active');
            });

            // Close menu when clicking outside
            document.addEventListener('click', (e) => {
                if (!card.contains(e.target)) {
                    menuDropdown.classList.remove('active');
                }
            });
        }

        // Menu items will be handled by parent page through event delegation
        // The parent should listen for clicks on elements with data-action attributes
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
