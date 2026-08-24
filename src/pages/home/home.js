/**
 * HomePage - Main Dashboard Orchestrator for Movie Rating Extension
 * Coordinates HomeDataController, HomeRenderer, and FeaturedSliderController.
 */
class HomePage {
    constructor() {
        // DOM Elements
        this.loader = document.getElementById('loader');
        this.errorScreen = document.getElementById('error-screen');
        this.errorMessage = document.getElementById('error-message');
        this.retryBtn = document.getElementById('retry-btn');
        this.contentContainer = document.getElementById('content');

        // UI State Manager
        this.page = Utils.createPageStateManager({
            loader: this.loader,
            errorScreen: this.errorScreen,
            errorMessage: this.errorMessage,
            contentContainer: this.contentContainer,
            onRetry: () => this.init(),
            onBack: () => window.history.back()
        });

        // Section Containers
        this.featuredSlider = document.getElementById('featured-slider');
        this.sliderPagination = document.getElementById('slider-pagination');
        this.personalTierSection = document.getElementById('personal-tier');
        this.dashboardSection = document.getElementById('dashboard-section');

        // Category Grids
        this.categoryElements = {
            filmsGrid: document.getElementById('films-grid'),
            seriesGrid: document.getElementById('series-grid'),
            cartoonsGrid: document.getElementById('cartoons-grid'),
            tvShowsGrid: document.getElementById('tvShows-grid'),
            tvShowsTitle: document.getElementById('tvShows-title')
        };

        // Subsystems
        this.dataController = new HomeDataController();
        this.ratingEnricher = typeof MovieRatingsEnrichmentService !== 'undefined'
            ? new MovieRatingsEnrichmentService({
                kinopoiskService: this.dataController.kinopoiskService,
                navigationService: this.dataController.homeMovieNavigationService,
                // The fallback is a bounded public HTML parse, not a KP API
                // call, and runs only when the search card has no rating.
                enableDetailFallback: true
            })
            : null;
        this.renderer = new HomeRenderer({
            resolveMovie: (item) => this.dataController.resolveHomeMovie(item),
            ratingEnricher: this.ratingEnricher,
            onResolveFailure: (item) => {
                console.warn('[HomePage] Home card could not be resolved:', {
                    tmdbId: item.tmdbId || null,
                    title: item.title || item.name || null,
                    year: item.year || null
                });
            }
        });
        this.sliderController = new FeaturedSliderController({
            sliderElement: this.featuredSlider,
            paginationElement: this.sliderPagination,
            gap: 20
        });

        this.bindEvents();
    }

    bindEvents() {
        if (this.retryBtn) {
            this.retryBtn.addEventListener('click', () => this.init());
        }

        // Listen for cross-tab or in-page auth state changes
        window.addEventListener('authStateChanged', (event) => {
            console.log('HomePage: Auth state changed, refreshing personal tier & dashboard', event.detail);
            const isAuth = event.detail?.isAuthenticated ?? !!event.detail?.user;
            const user = isAuth ? (event.detail?.user || this.dataController.getCurrentUser()) : false;
            this.updatePersonalTier(user);
            this.updateDashboard(user);
        });
    }

    async init() {
        try {
            if (window.i18n?.init) await window.i18n.init();
            globalThis.quotaTracker?.resetForNewPageLoad();
            this.page.showContent();
            // Progressive rendering: display content container without full-screen blocking overlay
            if (this.contentContainer) this.contentContainer.style.display = 'block';
            if (this.loader) this.loader.style.display = 'none';
            if (this.errorScreen) this.errorScreen.style.display = 'none';

            // 1. Fetch & Render Discovery Showcase progressively
            console.log('HomePage: Loading discovery showcase data...');
            const discoveryPromise = this.dataController.fetchDiscoveryShowcase();
            const authPromise = this.dataController.ensureAuthReady(350);

            const discovery = await discoveryPromise;
            this.renderer.renderFeaturedSlider(discovery.featured, this.featuredSlider);
            this.sliderController.init(discovery.featured);
            this.renderer.renderCategoryGrids(discovery, this.categoryElements);

            // 2. Fetch & Render Personal Tier and Dashboard once Auth state is determined
            const currentUser = await authPromise;
            await Promise.allSettled([
                this.updatePersonalTier(currentUser),
                this.updateDashboard(currentUser)
            ]);
            globalThis.quotaTracker?.logSummary('Home page load');
        } catch (error) {
            console.error('HomePage Init Error:', error);
            this.page.showError(error, {
                context: { operation: 'home-load', category: 'provider' }
            });
        }
    }

    async updatePersonalTier(userParam = null) {
        try {
            const personalData = await this.dataController.fetchPersonalData(userParam);
            this.renderer.renderPersonalTier(
                personalData,
                this.personalTierSection,
                () => this.handleAuthModal()
            );
        } catch (error) {
            console.warn('HomePage: Error updating personal tier:', error);
        }
    }

    async updateDashboard(userParam = null) {
        try {
            const dashboardData = await this.dataController.fetchDashboardData(userParam);
            this.renderer.renderDashboard(dashboardData, this.dashboardSection);
        } catch (error) {
            console.warn('HomePage: Error updating dashboard:', error);
        }
    }

    handleAuthModal() {
        const nav = window.navigationInstance || window.navigation;
        if (nav?.showAuthModal) {
            nav.showAuthModal('login');
        } else {
            const navSignIn = document.getElementById('navSignInBtn');
            if (navSignIn) navSignIn.click();
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    if (typeof Navigation !== 'undefined') {
        window.navigationInstance = new Navigation();
        console.log('HomePage: Navigation initialized');
    } else {
        console.error('HomePage: Navigation class not found');
    }

    window.homePage = new HomePage();
    window.homePage.init();
});
