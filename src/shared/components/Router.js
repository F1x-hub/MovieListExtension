/**
 * Simple SPA Router for Movie Rating Extension
 * Handles navigation between pages without opening new tabs
 */
class Router {
    constructor() {
        this.routes = new Map();
        this.currentRoute = '';
        this.container = null;
        this.init();
    }

    init() {
        // Create main container for SPA content
        this.createMainContainer();
        
        // Set up initial route based on current page
        this.setupInitialRoute();
        
        // Listen for browser back/forward buttons
        window.addEventListener('popstate', (e) => {
            if (e.state && e.state.route) {
                this.navigateTo(e.state.route, false);
            }
        });
    }

    createMainContainer() {
        // Check if we're in a page that should use SPA routing
        const body = document.body;
        
        // Create main app container
        let appContainer = document.getElementById('app-container');
        if (!appContainer) {
            appContainer = document.createElement('div');
            appContainer.id = 'app-container';
            appContainer.className = 'app-container';
            
            // Move existing content to the container
            const existingContent = Array.from(body.children).filter(child => 
                !child.classList.contains('nav-header') && 
                child.tagName !== 'SCRIPT'
            );
            
            existingContent.forEach(child => {
                appContainer.appendChild(child);
            });
            
            body.appendChild(appContainer);
        }
        
        this.container = appContainer;
    }

    setupInitialRoute() {
        // Determine current route based on URL
        const path = window.location.pathname;
        
        if (path.includes('search.html') || path.includes('src/pages/search/')) {
            this.currentRoute = 'search';
        } else if (path.includes('ratings.html') || path.includes('src/pages/ratings/')) {
            this.currentRoute = 'ratings';
        } else {
            this.currentRoute = 'search'; // Default to search
        }
    }

    // Register a route with its content loader
    addRoute(name, contentLoader) {
        this.routes.set(name, contentLoader);
    }

    // Navigate to a specific route
    async navigateTo(routeName, updateHistory = true) {
        if (!this.routes.has(routeName)) {
            console.warn(`Route '${routeName}' not found`);
            return;
        }

        // Show loading state
        this.showLoading();

        try {
            // Get the content loader for this route
            const contentLoader = this.routes.get(routeName);
            
            // Load the content
            const content = await contentLoader();
            
            // Update the container
            this.container.innerHTML = content;
            
            // Update browser history
            if (updateHistory) {
                const url = this.getUrlForRoute(routeName);
                window.history.pushState({ route: routeName }, '', url);
            }
            
            // Update current route
            this.currentRoute = routeName;
            
            // Update navigation active state
            this.updateNavigationState(routeName);
            
            // Initialize page-specific functionality
            await this.initializeRoute(routeName);
            
        } catch (error) {
            console.error('Error loading route:', error);
            this.showError('Failed to load page');
        } finally {
            this.hideLoading();
        }
    }

    getUrlForRoute(routeName) {
        const baseUrl = window.location.origin + window.location.pathname.replace(/\/[^\/]*\.html$/, '');
        
        switch (routeName) {
            case 'search':
                return chrome.runtime.getURL('src/pages/search/search.html');
            case 'ratings':
                return chrome.runtime.getURL('src/pages/ratings/ratings.html');
            default:
                return chrome.runtime.getURL('src/pages/search/search.html');
        }
    }

    updateNavigationState(routeName) {
        // Update navigation active state
        const navLinks = document.querySelectorAll('.nav-link');
        navLinks.forEach(link => {
            link.classList.remove('active');
            if (link.dataset.page === routeName) {
                link.classList.add('active');
            }
        });
    }

    async initializeRoute(routeName) {
        // Initialize page-specific functionality
        switch (routeName) {
            case 'search':
                await this.initializeSearchPage();
                break;
            case 'ratings':
                await this.initializeRatingsPage();
                break;
        }
    }

    async initializeSearchPage() {
        // Wait for DOM to be ready
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Initialize search page functionality
        if (typeof SearchPageManager !== 'undefined') {
            window.searchPageManager = new SearchPageManager();
        } else {
            // Load search.js dynamically if needed
            await this.loadScript('search.js');
            if (typeof SearchPageManager !== 'undefined') {
                window.searchPageManager = new SearchPageManager();
            }
        }
    }

    async initializeRatingsPage() {
        // Wait for DOM to be ready
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Initialize ratings page functionality
        if (typeof RatingsPageManager !== 'undefined') {
            window.ratingsPage = new RatingsPageManager();
        } else {
            // Load ratings.js dynamically if needed
            await this.loadScript('ratings.js');
            if (typeof RatingsPageManager !== 'undefined') {
                window.ratingsPage = new RatingsPageManager();
            }
        }
    }

    async loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    showLoading() {
        if (this.container) {
            this.container.innerHTML = `
                <div class="route-loading">
                    <div class="loading-spinner"></div>
                    <p>Loading...</p>
                </div>
            `;
        }
    }

    hideLoading() {
        // Loading will be hidden when content is loaded
    }

    showError(message) {
        if (this.container) {
            this.container.innerHTML = `
                <div class="route-error">
                    <div class="error-icon">⚠️</div>
                    <h3>Error</h3>
                    <p>${message}</p>
                    <button onclick="window.router.navigateTo('search')" class="btn btn-primary">
                        Go to Search
                    </button>
                </div>
            `;
        }
    }

    // Get current route
    getCurrentRoute() {
        return this.currentRoute;
    }

    // Check if router is available
    static isAvailable() {
        // Router is available on extension pages but not in popup
        return !window.location.pathname.includes('popup.html') && !window.location.pathname.includes('src/popup/');
    }
}

// Content loaders for each route
const RouteLoaders = {
    async search() {
        return `
            <div class="search-container">
                <!-- Search Section -->
                <div class="search-section">
                    <div class="search-form">
                        <div class="search-input-container">
                            <div class="search-input-wrapper">
                                <input type="text" id="searchInput" class="search-input" placeholder="Search for movies...">
                                <!-- Search History Dropdown -->
                                <div id="searchHistoryDropdown" class="search-history-dropdown" style="display: none;">
                                    <div class="search-history-header">
                                        <span class="history-title">Recent Searches</span>
                                        <button id="clearHistoryBtn" class="clear-history-btn" title="Clear all history">
                                            <span class="clear-icon">🗑️</span>
                                        </button>
                                    </div>
                                    <div id="searchHistoryList" class="search-history-list">
                                        <!-- History items will be populated here -->
                                    </div>
                                    <div id="searchHistoryEmpty" class="search-history-empty" style="display: none;">
                                        <span class="empty-icon">🔍</span>
                                        <span class="empty-text">No recent searches</span>
                                    </div>
                                </div>
                            </div>
                            <button id="searchBtn" class="btn btn-accent">Search</button>
                        </div>
                        
                        <!-- Filters -->
                        <div class="filters" id="filters" style="display: none;">
                            <div class="filter-section">
                                <div class="filter-group year-range-group">
                                    <label class="filter-label">Year Range:</label>
                                    <div class="year-range-inputs">
                                        <input type="number" id="yearFromFilter" class="form-input year-input" placeholder="From" min="1900" max="2030">
                                        <span class="year-separator">—</span>
                                        <input type="number" id="yearToFilter" class="form-input year-input" placeholder="To" min="1900" max="2030">
                                    </div>
                                </div>
                                
                                <div class="filter-group">
                                    <label class="filter-label">Genres:</label>
                                    <div class="checkbox-grid" id="genreCheckboxes"></div>
                                </div>
                                
                                <div class="filter-group">
                                    <label class="filter-label">Countries:</label>
                                    <div class="checkbox-grid" id="countryCheckboxes"></div>
                                </div>
                                
                                <div class="filter-actions">
                                    <button id="clearFiltersBtn" class="btn btn-secondary btn-sm">Clear Filters</button>
                                    <button id="applyFiltersBtn" class="btn btn-accent btn-sm">Apply Filters</button>
                                </div>
                            </div>
                        </div>
                        
                        <button id="toggleFiltersBtn" class="btn btn-outline btn-sm">Filters</button>
                    </div>
                </div>

                <!-- Results Section -->
                <div class="results-section">
                    <div class="results-header" id="resultsHeader" style="display: none;">
                        <h2 class="results-title">Search Results</h2>
                        <div class="results-info" id="resultsInfo"></div>
                    </div>
                    
                    <div class="loading" id="loading" style="display: none;">
                        <div class="loading-spinner"></div>
                        <span>Searching movies...</span>
                    </div>
                    
                    <div class="results-grid" id="resultsGrid">
                        <div class="empty-state">
                            <div class="empty-state-icon">🔍</div>
                            <h3 class="empty-state-title">Search for movies</h3>
                            <p class="empty-state-text">Enter a movie title to start searching</p>
                        </div>
                    </div>
                    
                    <div class="pagination" id="pagination" style="display: none;">
                        <button id="prevPageBtn" class="btn btn-secondary">Previous</button>
                        <span id="pageInfo" class="page-info">Page 1 of 1</span>
                        <button id="nextPageBtn" class="btn btn-secondary">Next</button>
                    </div>
                </div>
            </div>

            <!-- Movie Detail Modal -->
            <div id="movieModal" class="modal-overlay" style="display: none;">
                <div class="modal">
                    <div class="modal-header">
                        <h2 class="modal-title" id="modalTitle">Movie Details</h2>
                        <button class="modal-close" id="modalClose">×</button>
                    </div>
                    <div class="modal-body" id="modalBody">
                        <!-- Movie details will be loaded here -->
                    </div>
                    <div class="modal-footer">
                        <button id="rateMovieBtn" class="btn btn-accent">Rate This Movie</button>
                        <button id="movieDetailBtn" class="btn btn-ghost">Movie Detail</button>
                        <button id="closeModalBtn" class="btn btn-secondary">Close</button>
                    </div>
                </div>
            </div>

            <!-- Rating Modal -->
            <div id="ratingModal" class="modal-overlay" style="display: none;">
                <div class="modal rating-modal">
                    <div class="modal-header rating-header">
                        <div class="rating-header-content">
                            <div class="rating-header-icon">⭐</div>
                            <h2 class="modal-title">Rate This Movie</h2>
                        </div>
                        <button class="modal-close" id="ratingModalClose">×</button>
                    </div>
                    <div class="modal-body">
                        <div class="movie-rating-card" id="movieRatingInfo">
                            <!-- Movie info for rating -->
                        </div>
                        
                        <div class="rating-section">
                            <div class="current-rating-display" id="currentRatingInfo" style="display: none;">
                                <div class="current-rating-header">
                                    <h4>Your Current Rating</h4>
                                </div>
                                <div class="current-rating-content">
                                    <div class="current-rating-score">
                                        <span class="current-score-label">Rating:</span>
                                        <span id="existingRatingValue" class="current-score-value"></span>
                                    </div>
                                    <div class="current-rating-comment" id="existingRatingComment"></div>
                                </div>
                            </div>
                            
                            <form id="ratingForm" class="rating-form-modern">
                                <div class="rating-input-section">
                                    <div class="rating-score-container">
                                        <label class="rating-main-label">Your Rating</label>
                                        <div class="rating-controls-modern">
                                            <div class="rating-slider-container">
                                                <input type="range" id="ratingSlider" class="rating-slider-modern" min="1" max="10" value="5">
                                                <div class="rating-scale">
                                                    <span>1</span><span>2</span><span>3</span><span>4</span><span>5</span>
                                                    <span>6</span><span>7</span><span>8</span><span>9</span><span>10</span>
                                                </div>
                                            </div>
                                            <div class="rating-display-modern">
                                                <div class="rating-number">
                                                    <span id="ratingValue" class="rating-value-large">5</span>
                                                    <span class="rating-max">/10</span>
                                                </div>
                                                <div class="rating-stars" id="ratingStars">★★★★★☆☆☆☆☆</div>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    <div class="rating-comment-container">
                                        <label class="rating-comment-label">Your Review (Optional)</label>
                                        <textarea id="ratingComment" class="rating-comment-input" 
                                                placeholder="Share your thoughts about this movie..." 
                                                maxlength="500"></textarea>
                                        <div class="comment-footer">
                                            <span class="character-counter">
                                                <span id="charCount">0</span>/500 characters
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </form>
                        </div>
                    </div>
                    <div class="modal-footer rating-footer">
                        <button id="cancelRatingBtn" class="btn btn-secondary btn-lg">Cancel</button>
                        <button id="saveRatingBtn" class="btn btn-accent btn-lg rating-save-btn">
                            <span class="btn-icon">💾</span>
                            Save Rating
                        </button>
                    </div>
                </div>
            </div>
        `;
    },

    async ratings() {
        return `
            <main class="ratings-main">
                <div class="ratings-container">
                    <!-- Page Header -->
                    <div class="ratings-header">
                        <h1 class="ratings-title">My Collection</h1>
                        <p class="ratings-subtitle">Manage and explore your movie ratings</p>
                    </div>

                    <!-- View Mode Toggle -->
                    <div class="view-mode-section">
                        <div class="view-mode-toggle">
                            <button class="toggle-btn active" data-mode="my-ratings" id="myRatingsBtn">
                                <span class="toggle-icon">⭐</span>
                                <span>My Ratings Only</span>
                            </button>
                            <button class="toggle-btn" data-mode="all-ratings" id="allRatingsBtn">
                                <span class="toggle-icon">🌟</span>
                                <span>All Ratings</span>
                            </button>
                        </div>
                    </div>

                    <!-- Filters Section -->
                    <div class="filters-section">
                        <div class="filters-header">
                            <h3 class="filters-title">Filters & Search</h3>
                            <button class="clear-filters-btn" id="clearFiltersBtn">
                                <span>🗑️</span>
                                Clear Filters
                            </button>
                        </div>

                        <div class="filters-grid">
                            <!-- Search -->
                            <div class="filter-group">
                                <label class="filter-label">Search Movies</label>
                                <div class="search-input-wrapper">
                                    <input type="text" class="search-input" id="movieSearchInput" placeholder="Search by title...">
                                    <span class="search-icon">🔍</span>
                                </div>
                            </div>

                            <!-- Genre Filter -->
                            <div class="filter-group">
                                <label class="filter-label">Genre</label>
                                <select class="filter-select" id="genreFilter">
                                    <option value="">All Genres</option>
                                    <option value="action">Action</option>
                                    <option value="adventure">Adventure</option>
                                    <option value="animation">Animation</option>
                                    <option value="comedy">Comedy</option>
                                    <option value="crime">Crime</option>
                                    <option value="documentary">Documentary</option>
                                    <option value="drama">Drama</option>
                                    <option value="family">Family</option>
                                    <option value="fantasy">Fantasy</option>
                                    <option value="horror">Horror</option>
                                    <option value="romance">Romance</option>
                                    <option value="sci-fi">Sci-Fi</option>
                                    <option value="thriller">Thriller</option>
                                </select>
                            </div>

                            <!-- Year Filter -->
                            <div class="filter-group">
                                <label class="filter-label">Year</label>
                                <select class="filter-select" id="yearFilter">
                                    <option value="">All Years</option>
                                </select>
                            </div>

                            <!-- My Rating Filter -->
                            <div class="filter-group">
                                <label class="filter-label">My Rating</label>
                                <select class="filter-select" id="myRatingFilter">
                                    <option value="">Any Rating</option>
                                    <option value="9-10">9-10 ⭐⭐⭐⭐⭐</option>
                                    <option value="7-8">7-8 ⭐⭐⭐⭐</option>
                                    <option value="5-6">5-6 ⭐⭐⭐</option>
                                    <option value="3-4">3-4 ⭐⭐</option>
                                    <option value="1-2">1-2 ⭐</option>
                                </select>
                            </div>

                            <!-- Average Rating Filter -->
                            <div class="filter-group">
                                <label class="filter-label">Average Rating</label>
                                <select class="filter-select" id="avgRatingFilter">
                                    <option value="">Any Average</option>
                                    <option value="9-10">9-10 ⭐⭐⭐⭐⭐</option>
                                    <option value="7-8">7-8 ⭐⭐⭐⭐</option>
                                    <option value="5-6">5-6 ⭐⭐⭐</option>
                                    <option value="3-4">3-4 ⭐⭐</option>
                                    <option value="1-2">1-2 ⭐</option>
                                </select>
                            </div>

                            <!-- Sort Options -->
                            <div class="filter-group">
                                <label class="filter-label">Sort By</label>
                                <select class="filter-select" id="sortFilter">
                                    <option value="date-desc">Date Added (Newest)</option>
                                    <option value="date-asc">Date Added (Oldest)</option>
                                    <option value="rating-desc">My Rating (High to Low)</option>
                                    <option value="rating-asc">My Rating (Low to High)</option>
                                    <option value="avg-rating-desc">Avg Rating (High to Low)</option>
                                    <option value="avg-rating-asc">Avg Rating (Low to High)</option>
                                    <option value="title-asc">Title (A-Z)</option>
                                    <option value="title-desc">Title (Z-A)</option>
                                    <option value="year-desc">Year (Newest)</option>
                                    <option value="year-asc">Year (Oldest)</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    <!-- Results Info -->
                    <div class="results-info" id="resultsInfo">
                        <span class="results-count" id="resultsCount">Loading...</span>
                        <span class="results-mode" id="resultsMode"></span>
                    </div>

                    <!-- Loading State -->
                    <div class="loading-section" id="loadingSection">
                        <div class="loading-spinner"></div>
                        <p>Loading your collection...</p>
                    </div>

                    <!-- Movies Grid -->
                    <div class="movies-grid" id="moviesGrid">
                        <!-- Movie cards will be inserted here -->
                    </div>

                    <!-- Empty State -->
                    <div class="empty-state" id="emptyState" style="display: none;">
                        <div class="empty-state-icon">🎬</div>
                        <h3 class="empty-state-title">No movies found</h3>
                        <p class="empty-state-text">Try adjusting your filters or start rating some movies!</p>
                        <button class="empty-state-btn" onclick="window.router?.navigateTo('search')">
                            Search Movies
                        </button>
                    </div>

                    <!-- Error State -->
                    <div class="error-state" id="errorState" style="display: none;">
                        <div class="error-state-icon">⚠️</div>
                        <h3 class="error-state-title">Something went wrong</h3>
                        <p class="error-state-text" id="errorMessage">Failed to load movies</p>
                        <button class="error-state-btn" id="retryBtn">Try Again</button>
                    </div>
                </div>

                <!-- Movie Detail Modal -->
                <div class="modal-overlay" id="movieModal" style="display: none;">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h3 class="modal-title" id="modalTitle">Movie Details</h3>
                            <button class="modal-close" id="modalClose">×</button>
                        </div>
                        <div class="modal-body" id="modalBody">
                            <!-- Movie details will be inserted here -->
                        </div>
                    </div>
                </div>

                <!-- Edit Rating Modal -->
                <div class="modal-overlay" id="editRatingModal" style="display: none;">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h3 class="modal-title">Edit Rating</h3>
                            <button class="modal-close" id="editModalClose">×</button>
                        </div>
                        <div class="modal-body">
                            <div class="edit-rating-form">
                                <div class="form-group">
                                    <label>Your Rating</label>
                                    <div class="rating-input">
                                        <input type="range" min="1" max="10" value="5" id="editRatingSlider">
                                        <span class="rating-value" id="editRatingValue">5</span>/10
                                    </div>
                                </div>
                                <div class="form-group">
                                    <label>Comment (Optional)</label>
                                    <textarea id="editRatingComment" placeholder="Share your thoughts about this movie..." maxlength="500"></textarea>
                                    <div class="character-count">
                                        <span id="editCommentCount">0</span>/500
                                    </div>
                                </div>
                                <div class="form-actions">
                                    <button class="btn-secondary" id="editCancelBtn">Cancel</button>
                                    <button class="btn-primary" id="editSaveBtn">Save Changes</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </main>
        `;
    }
};

// Router disabled - using simple navigation instead
// Initialize router when DOM is loaded
// if (Router.isAvailable()) {
//     document.addEventListener('DOMContentLoaded', () => {
//         window.router = new Router();
//         
//         // Register routes
//         window.router.addRoute('search', RouteLoaders.search);
//         window.router.addRoute('ratings', RouteLoaders.ratings);
//         
//         // Navigate to initial route
//         const initialRoute = window.router.getCurrentRoute();
//         window.router.navigateTo(initialRoute, false);
//     });
// }

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Router;
} else {
    window.Router = Router;
}
