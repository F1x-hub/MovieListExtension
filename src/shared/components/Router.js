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
        window.location.origin + window.location.pathname.replace(/\/[^/]*\.html$/, '');
        
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
                    <button onmousedown="window.router.navigateTo('search')" class="btn btn-primary">
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
