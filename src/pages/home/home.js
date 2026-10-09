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
                tmdbService: this.dataController.tmdbService,
                // The fallback is a bounded public HTML parse, not a KP API
                // call, and runs only when the search card has no rating.
                enableDetailFallback: true,
                // Per-card traces are diagnostics; enable them with
                // localStorage 'movielist:debug-ratings' = '1'.
                trace: HomePage.isRatingsTraceEnabled()
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

        this.personalGeneration = 0;
        this.dashboardGeneration = 0;
        this.discoveryGeneration = 0;
        this.authGeneration = 0;
        this.personalUid = undefined;
        this.personalSnapshot = null;
        this.personalRequest = null;

        this.bindEvents();
    }

    static isRatingsTraceEnabled() {
        try {
            return window.localStorage?.getItem('movielist:debug-ratings') === '1';
        } catch {
            return false;
        }
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
            ++this.authGeneration;
            this.updatePersonalTier(user);
            this.updateDashboard(user);
        });
        this.personalStorageListener = (changes, area) => {
            const uid = this.personalUid;
            if (area !== 'local' || !uid || !changes[`home_personal_preview_revision_${uid}`]) return;
            ++this.personalGeneration;
            this.personalRequest = null;
            this.dataController.clearFavoriteLists(uid);
            this.updatePersonalTier(uid);
            this.updateDashboard(uid);
        };
        globalThis.chrome?.storage?.onChanged?.addListener(this.personalStorageListener);
        window.addEventListener('pagehide', event => {
            if (event.persisted) return;
            ++this.personalGeneration;
            ++this.dashboardGeneration;
            globalThis.chrome?.storage?.onChanged?.removeListener(this.personalStorageListener);
        });
    }

    async init() {
        try {
            if (window.i18n?.init && !this.i18nReady) {
                await window.i18n.init();
                window.i18n.translatePage?.();
                document.documentElement.lang = window.i18n.currentLocale || 'ru';
                this.i18nReady = true;
                window.i18n.onLocaleChange?.(locale => this.handleLocaleChange(locale));
            }
            globalThis.quotaTracker?.resetForNewPageLoad();
            // Reserve the personal layout before revealing the page, without
            // waiting for Firestore or treating unresolved auth as a guest.
            await this.preparePersonalTier();
            this.page.showContent();
            // Progressive rendering: display content container without full-screen blocking overlay
            if (this.contentContainer) this.contentContainer.style.display = 'block';
            if (this.loader) this.loader.style.display = 'none';
            if (this.errorScreen) this.errorScreen.style.display = 'none';

            // Discovery and personal data load independently: a provider
            // failure must not hide the user's own lists.
            const discoveryTask = this.loadDiscovery();
            const personalTask = this.resolveInitialUser().then(currentUser => currentUser === undefined
                ? null : Promise.allSettled([
                    this.updatePersonalTier(currentUser || false),
                    this.updateDashboard(currentUser || false)
                ]));

            await Promise.allSettled([discoveryTask, personalTask]);
            globalThis.quotaTracker?.logSummary('Home page load');
        } catch (error) {
            console.error('HomePage Init Error:', error);
            this.page.showError(error, {
                context: { operation: 'home-load', category: 'provider' }
            });
        }
    }

    /**
     * A signed-in user must not see the guest banner while Firebase restores
     * the session. Unresolved auth keeps the prepared layout until an event.
     * @returns {Promise<Object|null|undefined>}
     */
    async resolveInitialUser() {
        const authGeneration = this.authGeneration;
        const user = await this.dataController.ensureAuthReady(350);
        if (authGeneration !== this.authGeneration) return undefined;
        const fm = this.dataController.firebaseManager || window.firebaseManager;
        if (!fm) return undefined;
        if (fm.isAuthReady !== false) return user;
        const restored = await this.dataController.ensureAuthReady(5000);
        if (authGeneration !== this.authGeneration || fm.isAuthReady === false) return undefined;
        return restored;
    }

    async preparePersonalTier() {
        const authGeneration = this.authGeneration;
        const fm = this.dataController.firebaseManager || window.firebaseManager;
        const user = this.dataController.getCurrentUser();
        if (fm && fm.isAuthReady !== false) {
            const uid = user?.uid || null;
            this.selectPersonalUid(uid);
            if (!uid) {
                this.renderPersonalData({ isAuthenticated: false });
                return;
            }
            const cached = await this.dataController.getPersonalPreview(uid);
            if (authGeneration === this.authGeneration && uid === this.personalUid && cached
                && !this.personalSnapshot) this.renderPersonalData(cached);
            return;
        }
        let knownUid = user?.uid;
        if (!knownUid) {
            try {
                const stored = await chrome.storage.local.get(['user', 'isAuthenticated']);
                if (stored?.isAuthenticated === true) knownUid = stored.user?.uid;
            } catch {
                // Unknown auth stays neutral; Firebase's eventual event resolves it.
            }
        }
        if (authGeneration === this.authGeneration && knownUid && !this.personalSnapshot) {
            this.renderer.renderPersonalSkeleton(this.personalTierSection);
        }
    }

    selectPersonalUid(uid) {
        if (this.personalUid === uid) return;
        const previousUid = this.personalUid;
        ++this.personalGeneration;
        this.personalRequest = null;
        this.personalSnapshot = null;
        this.personalUid = uid;
        this.dataController.clearFavoriteLists();
        if (previousUid) this.dataController.invalidatePersonalPreview(previousUid);
        // The first confirmed account can reuse its already mounted skeleton.
        if (previousUid !== undefined || !uid) this.renderer.resetPersonalTier(this.personalTierSection);
        if (uid) this.renderer.renderPersonalSkeleton(this.personalTierSection);
    }

    renderPersonalData(data) {
        this.renderer.renderPersonalTier(data, this.personalTierSection,
            () => this.handleAuthModal(),
            () => {
                this.dataController.clearFavoriteLists(this.personalUid);
                return this.updatePersonalTier(this.personalUid || false);
            });
        if (data.isAuthenticated && !data.loadFailed) this.personalSnapshot = data;
    }

    handleLocaleChange(locale) {
        document.documentElement.lang = locale || 'ru';
        // Discovery titles are language-specific, so reload that payload
        // (usually from its own cache) instead of re-rendering old titles.
        this.loadDiscovery();
        if (this.personalSnapshot) this.renderPersonalData(this.personalSnapshot);
        else if (this.personalTierSection?.hasAttribute('aria-busy')) {
            this.renderer.renderPersonalSkeleton(this.personalTierSection);
        }
        if (this.personalUid !== undefined) {
            this.updatePersonalTier(this.personalUid || false);
            this.updateDashboard(this.personalUid || false);
        }
    }

    renderDiscovery(discovery) {
        this.renderer.renderFeaturedSlider(discovery.featured, this.featuredSlider);
        this.sliderController.init(discovery.featured);
        this.renderer.renderCategoryGrids(discovery, this.categoryElements);
    }

    async loadDiscovery() {
        const hasRenderedDiscovery = Boolean(this.featuredSlider?.querySelector('.featured-card:not(.featured-card--skeleton)'));
        if (!hasRenderedDiscovery) {
            this.renderer.renderDiscoverySkeletons(this.featuredSlider, this.categoryElements);
        }

        // Only the latest request may render: a slower response for a
        // previous language must not replace the current titles.
        const generation = ++this.discoveryGeneration;
        try {
            console.log('HomePage: Loading discovery showcase data...');
            const discovery = await this.dataController.fetchDiscoveryShowcase();
            if (generation !== this.discoveryGeneration) return;
            this.renderDiscovery(discovery);
            this.applyBackgroundRefresh(discovery.refreshPromise, generation);
        } catch (error) {
            if (generation !== this.discoveryGeneration) return;
            console.error('HomePage: Discovery load failed:', error);
            this.sliderController.init([]);
            this.renderer.renderDiscoveryError(this.featuredSlider, this.categoryElements, () => this.loadDiscovery());
        }
    }

    /**
     * Stale cache is shown immediately; apply the refreshed payload only while
     * the user is still at the top of the page so cards never jump under them.
     * @param {Promise<Object>|null} refreshPromise
     * @param {number} generation - Discovery request that started the refresh
     */
    applyBackgroundRefresh(refreshPromise, generation) {
        if (!refreshPromise) return;
        refreshPromise
            .then(fresh => {
                if (generation !== this.discoveryGeneration) return;
                const hasCards = ['featured', 'films', 'series', 'cartoons', 'anime']
                    .some(section => Array.isArray(fresh?.[section]) && fresh[section].length > 0);
                if (!hasCards) return;
                const nearTop = (window.scrollY || 0) < 120;
                const focusInDiscovery = this.contentContainer?.contains(document.activeElement)
                    && document.activeElement !== document.body;
                if (!nearTop || focusInDiscovery || this.sliderController.isPointerDown) return;
                this.renderDiscovery(fresh);
            })
            .catch(() => {
                // Background refresh failures are logged by HomeCacheService.
            });
    }

    // Each update takes a generation number and renders only if no newer
    // update started meanwhile, so a slow response for a previous user can
    // never overwrite the current state (e.g. after sign-out).
    async updatePersonalTier(userParam = null) {
        const uid = this.dataController.resolveUid(userParam);
        this.selectPersonalUid(uid);
        if (!uid) {
            this.renderPersonalData({ isAuthenticated: false });
            return;
        }
        if (this.personalRequest?.uid === uid) return this.personalRequest.promise;
        const generation = ++this.personalGeneration;
        const request = { uid, promise: null };
        this.personalRequest = request;
        request.promise = (async () => {
            try {
                if (!this.personalSnapshot) {
                    const cached = await this.dataController.getPersonalPreview(uid);
                    if (generation !== this.personalGeneration) return;
                    if (cached) this.renderPersonalData(cached);
                }
                const revision = await this.dataController.getPersonalRevision(uid);
                let personalData = await this.dataController.fetchPersonalData(uid);
                if (generation !== this.personalGeneration) return;
                if (revision !== await this.dataController.getPersonalRevision(uid)) {
                    if (generation !== this.personalGeneration) return;
                    this.dataController.clearFavoriteLists(uid);
                    this.personalRequest = null;
                    return this.updatePersonalTier(uid);
                }
                if (generation !== this.personalGeneration) return;
                // A failed list cannot erase the accepted preview of that list.
                if (personalData.partialFailure && this.personalSnapshot) {
                    personalData = { ...personalData };
                    for (const list of ['watching', 'watchlist']) {
                        if (personalData[`${list}Failed`]) {
                            personalData[list] = this.personalSnapshot[list];
                            personalData[`${list}Total`] = this.personalSnapshot[`${list}Total`];
                        }
                    }
                    personalData.hasContent = personalData.watching.length > 0 || personalData.watchlist.length > 0;
                }
                this.renderPersonalData(personalData);
                await this.dataController.savePersonalPreview(uid, personalData, revision);
            } catch (error) {
                if (generation !== this.personalGeneration) return;
                console.warn('HomePage: Error updating personal tier:', error);
                this.renderPersonalData({ isAuthenticated: true, userId: uid, loadFailed: true });
            } finally {
                if (this.personalRequest === request) this.personalRequest = null;
            }
        })();
        return request.promise;
    }

    async updateDashboard(userParam = null) {
        const generation = ++this.dashboardGeneration;
        try {
            const dashboardData = await this.dataController.fetchDashboardData(userParam);
            if (generation !== this.dashboardGeneration) return;
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
