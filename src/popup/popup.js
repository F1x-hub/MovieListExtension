import { i18n } from '../shared/i18n/I18n.js';

/**
 * PopupManager - Main controller for the Movie Rating Extension popup
 * Handles authentication, search, and rating feed display
 */
class PopupManager {
    constructor() {
        this.feedGeneration = 0;
        this.renderGeneration = 0;
        this.searchGeneration = 0;
        this.authGeneration = 0;
        this.feedRevision = 0;
        this.activeUserId = null;
        this.currentUserProfile = null;
        this.popupMenus = new Map();
        this.disposed = false;
        
        this.ratings = [];
        this.searchTimeout = null;
        this.ratingsLoaded = false;
        this.isLoadingRatings = false; // true only during initial load / force refresh
        this.currentFilter = 'all';    // 'all' or 'my'
        this.tooltipTimeout = null;
        this.lockedTooltip = null;
        
        // Pagination state
        this.lastDocId = null;
        this.lastDoc = null; // Store actual document snapshot for better pagination
        this.hasMore = true;
        this.isLoadingMore = false;      // true only while a pagination fetch is in flight
        this.isBackgroundRefreshing = false; // true during background cache refresh (does NOT block scroll)
        this.ITEMS_PER_PAGE = 10;
        this.observer = null;
        this.consecutiveAutoLoads = 0;
        this.MAX_CONSECUTIVE_AUTO_LOADS = 2;
        this.lastLoadMoreTime = 0;
        this.MIN_LOAD_MORE_INTERVAL_MS = 300;
        this.isCircuitBreakerTripped = false;
        this.updateStateListenerRegistered = false;
        this.updateActionInFlight = false;
        this.updatePlaybackDialogOpen = false;
        
        // Start initialization
        this.start();
    }

    initializeSurface() {
        document.body.classList.add('popup-page');
        let isSidePanel = new URL(window.location.href).searchParams.get('view') === 'sidepanel';
        if (window.location.protocol === 'chrome-extension:' && chrome.extension?.getViews) {
            isSidePanel = !chrome.extension.getViews({ type: 'popup' }).includes(window);
        }
        document.body.classList.toggle('popup-page--sidepanel', isSidePanel);
        document.documentElement.classList.toggle('popup-document--sidepanel', isSidePanel);
    }

    debug(...args) {
        try {
            if (localStorage.getItem('popup_debug') === '1') console.debug('[Popup]', ...args);
        } catch { /* Diagnostics are optional when storage is unavailable. */ }
    }

    getFeedContext() {
        return {
            generation: this.feedGeneration || 0,
            filter: this.currentFilter,
            userId: this.activeUserId || firebaseManager.getCurrentUser()?.uid || null
        };
    }

    isFeedContextCurrent(context) {
        const userId = this.activeUserId || firebaseManager.getCurrentUser()?.uid || null;
        return !this.disposed && context.generation === (this.feedGeneration || 0)
            && context.filter === this.currentFilter && context.userId === userId;
    }

    invalidateFeed(clear = false) {
        this.feedGeneration = (this.feedGeneration || 0) + 1;
        this.renderGeneration = (this.renderGeneration || 0) + 1;
        this.isLoadingRatings = false;
        this.isLoadingMore = false;
        this.isBackgroundRefreshing = false;
        this.closePopupMenus();
        this.unlockTooltip();
        this.hideTrigger();
        if (clear) {
            this.popupMenus?.forEach(menu => menu.remove());
            this.popupMenus?.clear();
            document.querySelectorAll('body > .average-score-tooltip').forEach(tooltip => tooltip.remove());
            this.ratings = [];
            this.ratingsLoaded = false;
            this.lastDocId = null;
            this.lastDoc = null;
            this.hasMore = true;
            this.elements.feedContent?.replaceChildren();
        }
    }

    syncAccessibleLabels() {
        document.documentElement.lang = i18n.currentLocale;
        const backToTop = document.getElementById('backToTopButton');
        if (backToTop) {
            const label = i18n.get('popup.content.back_to_top');
            backToTop.setAttribute('aria-label', label);
            backToTop.title = label;
        }
        document.querySelectorAll('[title][data-i18n]').forEach(element => {
            if (element.getAttribute('data-i18n').startsWith('[aria-label]')) {
                element.title = element.getAttribute('aria-label');
            }
        });
        document.querySelectorAll('.toggle-password').forEach(button => {
            const revealed = button.getAttribute('aria-pressed') === 'true';
            const label = i18n.get(revealed ? 'popup.auth.password_hide' : 'popup.auth.password_show');
            button.setAttribute('aria-label', label);
            button.title = label;
        });
        this.elements.filterAllRatings?.setAttribute('aria-pressed', String(this.currentFilter === 'all'));
        this.elements.filterMyRatings?.setAttribute('aria-pressed', String(this.currentFilter === 'my'));
    }

    positionOverlay(overlay, anchor, preferAbove = false) {
        const rect = anchor.getBoundingClientRect();
        overlay.style.position = 'fixed';
        const width = overlay.offsetWidth || 190;
        const height = overlay.offsetHeight || 80;
        const margin = 8;
        const below = rect.bottom + 6;
        const above = rect.top - height - 6;
        const top = (preferAbove && above >= margin) || below + height > window.innerHeight - margin
            ? Math.max(margin, above) : below;
        overlay.style.left = `${Math.max(margin, Math.min(rect.right - width, window.innerWidth - width - margin))}px`;
        overlay.style.top = `${Math.min(top, Math.max(margin, window.innerHeight - height - margin))}px`;
    }

    closePopupMenus(restoreFocus = false) {
        if (restoreFocus) this.activeMenuButton?.focus();
        this.popupMenus?.forEach(menu => { menu.hidden = true; menu.style.display = 'none'; });
        document.querySelectorAll('.rating-menu-btn').forEach(button => button.setAttribute('aria-expanded', 'false'));
        this.activeMenuButton = null;
    }

    safeImageUrl(value) {
        const fallback = typeof IconUtils !== 'undefined'
            ? IconUtils.getCurrentThemeIconPath(48) : chrome.runtime.getURL('src/shared/assets/icons/app/icon48.png');
        if (typeof value !== 'string' || !value.trim()) return fallback;
        try {
            const url = new URL(value, window.location.href);
            if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
            if (url.origin === window.location.origin && url.pathname.startsWith('/src/shared/assets/')) return url.href;
        } catch { /* Untrusted image values fall back to the application icon. */ }
        return fallback;
    }

    bindImageFallback(image, source, alt = '') {
        const fallback = this.safeImageUrl('');
        const normalized = this.safeImageUrl(source);
        this.imageFallbackHandlers ||= new WeakMap();
        const previous = this.imageFallbackHandlers.get(image);
        if (previous) image.removeEventListener('error', previous);
        delete image.dataset.fallbackApplied;
        image.alt = alt;
        image.decoding = 'async';
        const handler = () => {
            if (image.dataset.fallbackApplied === 'true') return;
            image.dataset.fallbackApplied = 'true';
            if (image.classList.contains('rating-poster')) image.classList.add('rating-poster--fallback');
            image.src = fallback;
        };
        this.imageFallbackHandlers.set(image, handler);
        image.addEventListener('error', handler);
        if (image.classList.contains('rating-poster')) {
            image.classList.toggle('rating-poster--fallback', normalized.includes('/src/shared/assets/icons/app/'));
        }
        image.src = normalized;
    }

    movieDetailsUrl(movieId) {
        const id = String(movieId ?? '');
        return /^\d+$/.test(id) && Number(id) > 0
            ? chrome.runtime.getURL(`src/pages/movie-details/movie-details.html?movieId=${encodeURIComponent(id)}`) : null;
    }

    profileUrl(userId) {
        return userId ? chrome.runtime.getURL(`src/pages/profile/profile.html?userId=${encodeURIComponent(userId)}`) : null;
    }

    bindNavigationLink(link) {
        link.target = '_blank';
        link.rel = 'noopener';
        link.addEventListener('click', event => {
            if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            chrome.tabs.create({ url: link.href });
        });
    }

    isAuthContextCurrent(userId, generation) {
        const user = firebaseManager.getCurrentUser();
        return !this.disposed && this.authGeneration === generation && (!user || user.uid === userId);
    }

    compactProfile(profile) {
        const result = {};
        for (const field of ['displayName', 'username', 'displayNameFormat', 'firstName', 'lastName', 'photoURL']) {
            if (typeof profile?.[field] === 'string') result[field] = profile[field];
        }
        return result;
    }

    isSearchContextCurrent(query, generation) {
        return !this.disposed && this.searchGeneration === generation
            && this.elements.searchInput.value.trim() === query && !this.elements.searchLayer.hidden;
    }

    showSearchMessage(key) {
        const message = document.createElement('div');
        message.className = 'search-result-empty';
        message.setAttribute('role', 'status');
        message.textContent = i18n.get(key);
        this.elements.searchResults.replaceChildren(message);
        this.elements.searchResults.hidden = false;
        this.elements.searchResults.style.display = 'block';
        this.elements.searchInput.setAttribute('aria-expanded', 'true');
    }

    showSuccess(message) {
        const status = this.elements.errorMessage;
        if (!status) return;
        const text = status.querySelector('#popupStatusText');
        if (text) text.textContent = message;
        status.dataset.kind = 'success';
        status.setAttribute('role', 'status');
        status.hidden = false;
        status.style.display = 'flex';
    }

    dispose() {
        this.disposed = true;
        this.invalidateFeed();
        this.searchGeneration++;
        clearTimeout(this.searchTimeout);
        this.activeDialog?.close(false);
        this.observer?.disconnect();
        this.popupMenus?.forEach(menu => menu.remove());
        document.querySelectorAll('body > .average-score-tooltip').forEach(tooltip => tooltip.remove());
        document.removeEventListener('click', this.dismissClickListener);
        document.removeEventListener('keydown', this.dismissKeyListener);
        window.removeEventListener('resize', this.overlayScrollListener);
        window.removeEventListener('authStateChanged', this.authListener);
        window.removeEventListener('profileUpdated', this.profileListener);
        if (this.languageListener) chrome.storage.onChanged.removeListener?.(this.languageListener);
    }

    renderFeedState(kind) {
        const state = document.createElement('div');
        state.className = 'feed-state' + (kind === 'empty' ? ' empty-state' : '');
        state.dataset.state = kind;
        state.setAttribute('role', kind === 'error' ? 'alert' : 'status');
        const title = document.createElement('h3');
        title.className = 'feed-state__title';
        const text = document.createElement('p');
        text.className = 'feed-state__text';
        const prefix = this.currentFilter === 'my' ? 'empty_my' : 'empty_all';
        title.textContent = i18n.get(kind === 'loading' ? 'popup.content.loading'
            : kind === 'error' ? 'popup.content.load_failed' : 'popup.content.' + prefix + '_title');
        text.textContent = kind === 'empty' ? i18n.get('popup.content.' + prefix + '_text') : '';
        state.append(title, text);
        if (kind !== 'loading') {
            const actions = document.createElement('div');
            actions.className = 'feed-state__actions';
            const action = document.createElement(kind === 'error' ? 'button' : 'a');
            if (kind === 'error') action.type = 'button';
            action.className = 'btn btn-primary ' + (kind === 'error' ? 'feed-state-retry' : 'feed-state-search');
            action.textContent = i18n.get(kind === 'error' ? 'popup.content.retry' : 'popup.content.find_movie');
            if (kind === 'error') action.addEventListener('click', () => this.forceRefreshRatings());
            else {
                action.href = chrome.runtime.getURL('src/pages/search/search.html');
                this.bindNavigationLink(action);
            }
            actions.append(action);
            state.append(actions);
        }
        this.elements.feedContent.replaceChildren(state);
        this.hideTrigger();
    }

    commitRatingsPage(result, context) {
        if (!this.isFeedContextCurrent(context)) return false;
        if (result?.isSuperseded) throw new Error('Ratings result superseded');
        if (result?.criticalError) throw new Error('Ratings read paused');
        this.ratings = Array.isArray(result?.ratings) ? result.ratings : [];
        this.lastDocId = result.lastDocId || null;
        this.lastDoc = result.lastDoc || null;
        this.hasMore = result.hasMore ?? this.ratings.length === this.ITEMS_PER_PAGE;
        this.ratingsLoaded = true;
        this.feedRevision++;
        this.renderRatings();
        this.showMainContent();
        if (result.isStale) this.showError(i18n.get('popup.content.stale_data'));
        return true;
    }

    observeBackgroundRefresh(promise, context, revision) {
        if (!promise) return;
        this.isBackgroundRefreshing = true;
        promise.then(result => {
            if (!this.isFeedContextCurrent(context) || this.feedRevision !== revision || this.isLoadingMore || result?.isSuperseded) return;
            const scrollTop = this.elements.feedContent.scrollTop;
            this.commitRatingsPage(result, context);
            this.elements.feedContent.scrollTop = scrollTop;
        }).catch(error => {
            if (this.isFeedContextCurrent(context) && this.feedRevision === revision) {
                this.showError(i18n.get('popup.content.stale_data'));
            }
            this.debug('Background ratings refresh unavailable', error);
        }).finally(() => {
            if (this.isFeedContextCurrent(context)) this.isBackgroundRefreshing = false;
        });
    }

    addFeedRetry() {
        if (this.elements.feedContent.querySelector('.feed-state-retry')) return;
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'btn btn-secondary feed-state-retry';
        retry.textContent = i18n.get('popup.content.retry');
        retry.addEventListener('click', () => this.forceRefreshRatings());
        this.elements.feedContent.append(retry);
    }

    async enrichRenderedRatings(items, context, generation) {
        const current = () => this.isFeedContextCurrent(context) && this.renderGeneration === generation;
        const requests = [this.preloadAverageRatings(items)];
        const ownItems = items.some(item => item.userId === context.userId);
        if (ownItems) requests.push(firebaseManager.getUserService().getUserProfile(context.userId, { throwOnError: true }));
        const results = await Promise.allSettled(requests);
        if (!current()) return;
        const averages = results[0].status === 'fulfilled' ? results[0].value : new Map();
        const profile = results[1]?.status === 'fulfilled' ? results[1].value : null;
        for (const item of items) {
            const card = document.getElementById('rating-' + item.id);
            if (!card) continue;
            const movieId = item.movie?.kinopoiskId || item.movieId;
            const average = averages.get(movieId) || averages.get(Number(movieId));
            const tooltip = document.getElementById('tooltip-' + item.id);
            if (tooltip) tooltip.textContent = i18n.get('popup.rating.average') + ': ' +
                (average?.count > 0 ? String(Number(Number(average.average).toFixed(1))) : i18n.get('popup.rating.no_ratings'));
            if (profile && item.userId === context.userId) {
                card.querySelector('.rating-author-name').textContent = Utils.getDisplayName(profile, firebaseManager.getCurrentUser());
                this.bindImageFallback(card.querySelector('.rating-author-avatar'), profile.photoURL || item.userPhoto);
            }
        }
    }

    openPopupDialog({ title, body, initialFocus, closeId = '', returnFocus = document.activeElement }) {
        this.activeDialog?.close(false);
        this.closePopupMenus();
        this.closeAvatarDropdown(false);
        this.unlockTooltip();
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay popup-dialog-overlay';
        const content = document.createElement('section');
        content.className = 'modal popup-dialog';
        content.setAttribute('role', 'dialog');
        content.setAttribute('aria-modal', 'true');
        const titleId = 'popup-dialog-title';
        content.setAttribute('aria-labelledby', titleId);
        content.tabIndex = -1;
        const header = document.createElement('div');
        header.className = 'popup-dialog__header';
        const heading = document.createElement('h2');
        heading.className = 'popup-dialog__title';
        heading.id = titleId;
        heading.textContent = title;
        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'popup-dialog__close';
        if (closeId) closeButton.id = closeId;
        closeButton.setAttribute('aria-label', i18n.get('popup.auth.close'));
        closeButton.innerHTML = Icons.CLOSE;
        header.append(heading, closeButton);
        content.append(header, body);
        overlay.append(content);
        const container = document.querySelector('.popup-container');
        const previousInert = Boolean(container?.inert);
        if (container) container.inert = true;
        document.body.append(overlay);
        let closed = false;
        const focusable = () => [...content.querySelectorAll('button, input, textarea, a[href], [tabindex]')]
            .filter(element => !element.disabled && !element.hidden && element.tabIndex >= 0);
        const close = (restoreFocus = true) => {
            if (closed) return;
            closed = true;
            document.removeEventListener('keydown', keydown, true);
            document.removeEventListener('focusin', focusin);
            overlay.remove();
            if (container) container.inert = previousInert;
            if (this.activeDialog?.overlay === overlay) this.activeDialog = null;
            if (restoreFocus && returnFocus?.isConnected && !returnFocus.disabled) returnFocus.focus();
        };
        const keydown = event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopImmediatePropagation();
                close();
            }
            if (event.key !== 'Tab') return;
            const elements = focusable();
            const first = elements[0] || content;
            const last = elements.at(-1) || content;
            if (event.shiftKey && (document.activeElement === first || !content.contains(document.activeElement))) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && (document.activeElement === last || !content.contains(document.activeElement))) {
                event.preventDefault();
                first.focus();
            }
        };
        const focusin = event => { if (!content.contains(event.target)) (focusable()[0] || content).focus(); };
        document.addEventListener('keydown', keydown, true);
        document.addEventListener('focusin', focusin);
        closeButton.addEventListener('click', () => close());
        overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
        this.activeDialog = { overlay, content, close };
        (body.querySelector(initialFocus) || focusable()[0] || content).focus();
        return this.activeDialog;
    }

    showPasswordResetDialog() {
        const body = document.createElement('form');
        body.id = 'passwordResetFormPopup';
        body.className = 'popup-dialog__body';
        body.noValidate = true;
        body.innerHTML = '<p id="passwordResetHelpPopup" class="popup-dialog__help"></p>' +
            '<div class="popup-dialog__field"><label for="passwordResetEmailPopup"></label>' +
            '<input id="passwordResetEmailPopup" class="form-input" type="email" autocomplete="email" required aria-invalid="false" aria-describedby="passwordResetHelpPopup passwordResetStatusPopup"></div>' +
            '<p id="passwordResetStatusPopup" class="popup-dialog__status" role="status" hidden></p>' +
            '<div class="popup-dialog__footer"><button class="btn btn-primary" type="submit" id="passwordResetSubmitPopup"></button></div>';
        body.querySelector('label').textContent = i18n.get('popup.password_reset.email_label');
        body.querySelector('#passwordResetHelpPopup').textContent = i18n.get('popup.password_reset.help');
        const email = body.querySelector('input');
        email.placeholder = i18n.get('popup.password_reset.email_placeholder');
        email.value = this.elements.staticEmail?.value || this.elements.loginEmail?.value || '';
        const submit = body.querySelector('button');
        submit.textContent = i18n.get('popup.password_reset.request');
        const status = body.querySelector('#passwordResetStatusPopup');
        const dialog = this.openPopupDialog({ title: i18n.get('popup.password_reset.title'), body, initialFocus: '#passwordResetEmailPopup' });
        let pending = false;
        email.addEventListener('input', () => { email.setAttribute('aria-invalid', 'false'); status.hidden = true; });
        body.addEventListener('submit', async event => {
            event.preventDefault();
            if (pending || this.activeDialog !== dialog) return;
            const address = email.value.trim();
            if (!this.isValidEmail(address)) {
                email.setAttribute('aria-invalid', 'true');
                status.className = 'popup-dialog__error';
                status.setAttribute('role', 'alert');
                status.textContent = i18n.get('popup.auth.email_invalid');
                status.hidden = false;
                email.focus();
                return;
            }
            pending = true;
            submit.disabled = true;
            submit.textContent = i18n.get('popup.password_reset.sending');
            body.setAttribute('aria-busy', 'true');
            status.hidden = true;
            try {
                await firebaseManager.sendPasswordResetEmail(address);
                if (this.activeDialog !== dialog) return;
                status.className = 'popup-dialog__status';
                status.setAttribute('role', 'status');
                status.textContent = i18n.get('popup.password_reset.success');
                status.hidden = false;
            } catch (error) {
                if (this.activeDialog !== dialog) return;
                if (error.code === 'auth/user-not-found') {
                    status.className = 'popup-dialog__status';
                    status.setAttribute('role', 'status');
                    status.textContent = i18n.get('popup.password_reset.success');
                    status.hidden = false;
                    return;
                }
                status.className = 'popup-dialog__error';
                status.setAttribute('role', 'alert');
                status.textContent = i18n.get('popup.password_reset.error');
                status.hidden = false;
                this.debug('Password reset unavailable', error);
            } finally {
                pending = false;
                submit.disabled = false;
                submit.textContent = i18n.get('popup.password_reset.request');
                body.setAttribute('aria-busy', 'false');
            }
        });
    }

    async start() {
        this.initializeSurface();
        window.addEventListener('pagehide', () => this.dispose(), { once: true });
        // Initialize theme first
        this.initializeTheme();
        
        this.elements = this.initializeElements();
        this.setupEventListeners();
        this.setupAuthStateListener();
        
        // Initialize i18n BEFORE loading UI
        await this.initI18n();
        void import('../shared/components/WhatsNewDialog.js').then(module => module.showWhatsNew())
            .catch(error => console.warn('[Popup] Release notes unavailable:', error));
        
        // Then initialize UI which might load ratings
        await this.initializeUI();
        
        // Spoiler reveal logic
        if (typeof Utils !== 'undefined') {
            Utils.bindSpoilerReveal(document);
        }

        // Ask the background coordinator for its cached state. The coordinator
        // throttles network checks, so opening the popup does not hit GitHub.
        chrome.runtime.sendMessage({ type: 'GET_UPDATE_STATE' });
    }

    async initI18n() {
        await i18n.init();
        i18n.translatePage();
        this.syncAccessibleLabels();
        this.languageListener = changes => {
            if (!changes.language || this.disposed) return;
            i18n.currentLocale = changes.language.newValue;
            i18n.translatePage();
            this.syncAccessibleLabels();
            if (this.ratingsLoaded) this.renderRatings();
            if (!this.elements.searchLayer.hidden) this.handleSearch({ target: this.elements.searchInput });
        };
        chrome.storage.onChanged.addListener(this.languageListener);
    }

    initializeTheme() {
        if (window.ThemeService) {
            window.ThemeService.applyCurrentTheme();
        }
    }

    applyTheme(theme) {
        return window.ThemeService ? window.ThemeService.applyTheme(theme) : null;
    }

    initializeElements() {
        return {
            // Auth elements
            initialLoading: document.getElementById('initialLoading'),
            authSection: document.getElementById('authSection'),
            mainContent: document.getElementById('mainContent'),
            authStatus: document.getElementById('authStatus'),
            statusText: document.getElementById('statusText'),
            googleLoginBtn: document.getElementById('googleLoginBtn'),
            
            // Header elements (Row 1)
            headerActionsGroup: document.getElementById('headerActionsGroup'),
            refreshBtn: document.getElementById('refreshBtn'),
            openFullBtn: document.getElementById('openFullBtn'),
            userAvatarBtn: document.getElementById('userAvatarBtn'),
            userAvatar: document.getElementById('userAvatar'),
            userAvatarFallback: document.getElementById('userAvatarFallback'),
            avatarDropdown: document.getElementById('avatarDropdown'),
            userName: document.getElementById('userName'),
            profileMenuBtn: document.getElementById('profileMenuBtn'),
            settingsBtn: document.getElementById('settingsBtn'),
            logoutBtn: document.getElementById('logoutBtn'),

            // Controls Bar & Filter Chips (Row 2)
            controlsBar: document.getElementById('controlsBar'),
            chipsLayer: document.getElementById('chipsLayer'),
            filterAllRatings: document.getElementById('filterAllRatings'),
            filterMyRatings: document.getElementById('filterMyRatings'),
            searchToggleBtn: document.getElementById('searchToggleBtn'),
            searchLayer: document.getElementById('searchLayer'),
            searchCloseBtn: document.getElementById('searchCloseBtn'),
            
            // Inline error & field error elements
            authErrorMessage: document.getElementById('authErrorMessage'),
            loginEmailError: document.getElementById('loginEmailError'),
            loginPasswordError: document.getElementById('loginPasswordError'),
            registerFirstNameError: document.getElementById('registerFirstNameError'),
            registerLastNameError: document.getElementById('registerLastNameError'),
            registerEmailError: document.getElementById('registerEmailError'),
            registerPasswordError: document.getElementById('registerPasswordError'),
            registerConfirmPasswordError: document.getElementById('registerConfirmPasswordError'),

            // Submit Buttons
            loginEmailSubmitBtn: document.getElementById('loginEmailSubmitBtn'),
            loginPasswordSubmitBtn: document.getElementById('loginPasswordSubmitBtn'),
            registerInfoSubmitBtn: document.getElementById('registerInfoSubmitBtn'),
            registerFinalSubmitBtn: document.getElementById('registerFinalSubmitBtn'),

            // Login Forms (Step 1 & 2)
            loginEmailForm: document.getElementById('loginEmailForm'),
            loginPasswordForm: document.getElementById('loginPasswordForm'),
            
            // Login Inputs & Containers
            loginEmail: document.getElementById('loginEmail'),
            loginPassword: document.getElementById('loginPassword'),
            staticEmail: document.getElementById('staticEmail'),
            loginStep1: document.getElementById('loginStep1'),
            loginStep2: document.getElementById('loginStep2'),
            loginFooter: document.getElementById('loginFooter'),
            backToEmailBtn: document.getElementById('backToEmailBtn'),
            
            // Registration Forms
            registerInfoForm: document.getElementById('registerInfoForm'),
            registerPasswordForm: document.getElementById('registerPasswordForm'),
            
            // Registration Inputs & Containers
            registerForm: document.getElementById('registerForm'),
            registerEmail: document.getElementById('registerEmail'),
            registerPassword: document.getElementById('registerPassword'),
            registerConfirmPassword: document.getElementById('registerConfirmPassword'),
            registerFirstName: document.getElementById('registerFirstName'),
            registerLastName: document.getElementById('registerLastName'),
            
            staticRegisterEmail: document.getElementById('staticRegisterEmail'),
            staticName: document.getElementById('staticName'),
            staticSurname: document.getElementById('staticSurname'),
            
            registerStep1: document.getElementById('registerStep1'),
            registerStep2: document.getElementById('registerStep2'),
            registerFooter: document.getElementById('registerFooter'),
            backToRegisterInfoBtn: document.getElementById('backToRegisterInfoBtn'),
            googleRegisterBtn: document.getElementById('googleRegisterBtn'),
            
            // Auth Switchers
            showRegisterLink: document.getElementById('showRegisterLink'),
            showLoginLink: document.getElementById('showLoginLink'),
            loginFormSection: document.getElementById('loginFormSection'),
            registerFormSection: document.getElementById('registerFormSection'),
            
            // Search elements
            searchInput: document.getElementById('searchInput'),
            searchResults: document.getElementById('searchResults'),
            searchIconBtn: document.getElementById('searchIconBtn'),
            
            // Feed elements
            feedContent: document.getElementById('feedContent'),
            loading: document.getElementById('loading'),
            errorMessage: document.getElementById('errorMessage'),
            infiniteScrollTrigger: document.getElementById('infiniteScrollTrigger'),

            // Approval Status elements
            approvalStatusSection: document.getElementById('approvalStatusSection'),
            approvalStatusIconWrapper: document.getElementById('approvalStatusIconWrapper'),
            approvalStatusIcon: document.getElementById('approvalStatusIcon'),
            approvalStatusTitle: document.getElementById('approvalStatusTitle'),
            approvalStatusMessage: document.getElementById('approvalStatusMessage'),
            approvalBackToLoginBtn: document.getElementById('approvalBackToLoginBtn'),
            approvalBackBtnText: document.getElementById('approvalBackBtnText')
        };
    }

    setButtonLoading(btn, isLoading, loadingTextKey = null) {
        if (!btn) return;
        if (isLoading) {
            btn.dataset.originalHtml = btn.innerHTML;
            btn.disabled = true;
            const text = (typeof i18n !== 'undefined' && i18n.get && loadingTextKey) ? i18n.get(loadingTextKey) : 'Загрузка...';
            btn.innerHTML = `<span class="app-loader__indicator app-loader__indicator--btn" style="width: 14px; height: 14px; border-width: 2px; margin-right: 6px; display: inline-block; vertical-align: middle;" aria-hidden="true"></span><span class="btn-text">${text}</span>`;
        } else {
            btn.disabled = false;
            if (btn.dataset.originalHtml) {
                btn.innerHTML = btn.dataset.originalHtml;
                delete btn.dataset.originalHtml;
            }
        }
    }

    showAuthError(message, inputElement = null, errorElement = null) {
        this.clearAuthErrors();
        if (errorElement) {
            errorElement.textContent = message;
            errorElement.style.display = 'block';
            errorElement.hidden = false;
        } else if (this.elements.authErrorMessage) {
            this.elements.authErrorMessage.textContent = message;
            this.elements.authErrorMessage.style.display = 'flex';
        } else {
            this.showError(message);
        }
        if (inputElement) {
            inputElement.classList.add('input-error');
            inputElement.setAttribute('aria-invalid', 'true');
            if (errorElement?.id) inputElement.setAttribute('aria-describedby', errorElement.id);
            inputElement.focus();
        }
    }

    clearAuthErrors() {
        if (this.elements.authErrorMessage) {
            this.elements.authErrorMessage.textContent = '';
            this.elements.authErrorMessage.style.display = 'none';
        }
        document.querySelectorAll('.form-input').forEach(input => {
            input.classList.remove('input-error');
            input.setAttribute('aria-invalid', 'false');
        });
        document.querySelectorAll('.field-error-message').forEach(error => {
            error.textContent = '';
            error.style.display = 'none';
        });
        this.hideError();
    }

    setupEventListeners() {
        const on = (element, event, callback) => element?.addEventListener(event, callback);
        on(document.getElementById('popupLogo'), 'click', event => {
            event.preventDefault();
            chrome.tabs.create({ url: chrome.runtime.getURL('src/pages/home/home.html') });
        });
        on(this.elements.googleLoginBtn, 'click', () => this.handleGoogleLogin());
        on(this.elements.googleRegisterBtn, 'click', () => this.handleGoogleLogin());
        on(this.elements.logoutBtn, 'click', () => this.handleLogout());
        on(this.elements.loginEmailForm, 'submit', event => this.handleEmailStep(event));
        on(this.elements.loginPasswordForm, 'submit', event => this.handleEmailLogin(event));
        on(this.elements.backToEmailBtn, 'click', event => this.goToStep1(event));
        on(this.elements.registerInfoForm, 'submit', event => this.handleRegisterStep1(event));
        on(this.elements.registerPasswordForm, 'submit', event => this.handleRegisterFinal(event));
        on(this.elements.backToRegisterInfoBtn, 'click', event => this.goToRegisterStep1(event));
        on(document.getElementById('forgotPasswordBtn'), 'click', () => this.showPasswordResetDialog());
        on(this.elements.approvalBackToLoginBtn, 'click', async event => {
            event.preventDefault();
            const user = firebaseManager.getCurrentUser();
            if (!this.approvalCheckUserId || user?.uid !== this.approvalCheckUserId) {
                this.switchAuthForm('login');
                return;
            }
            const generation = this.authGeneration;
            this.setButtonLoading(this.elements.approvalBackToLoginBtn, true, 'popup.content.loading');
            try {
                if (await this.validateUserApproval(user.uid) && this.isAuthContextCurrent(user.uid, generation)) {
                    this.updateAuthUI(true, user);
                    await this.loadRatings();
                }
            } finally { this.setButtonLoading(this.elements.approvalBackToLoginBtn, false); }
        });
        document.querySelectorAll('.form-input').forEach(input => on(input, 'input', () => {
            input.classList.remove('input-error');
            input.setAttribute('aria-invalid', 'false');
            const error = input.closest('.form-group')?.querySelector('.field-error-message');
            if (error) { error.textContent = ''; error.style.display = 'none'; }
            if (this.elements.authErrorMessage) this.elements.authErrorMessage.style.display = 'none';
        }));
        this.setupAuthSwitching();
        on(this.elements.filterAllRatings, 'click', () => this.setFilter('all'));
        on(this.elements.filterMyRatings, 'click', () => this.setFilter('my'));
        on(this.elements.searchToggleBtn, 'click', () => this.openSearchLayer());
        on(this.elements.searchCloseBtn, 'click', () => this.closeSearchLayer());
        on(this.elements.searchInput, 'input', event => this.handleSearch(event));
        on(this.elements.searchInput, 'keydown', event => {
            if (event.key === 'Enter') { event.preventDefault(); this.openSearchPage(); }
            if (event.key === 'ArrowDown') {
                const first = this.elements.searchResults?.querySelector('a');
                if (first) { event.preventDefault(); first.focus(); }
            }
        });
        on(this.elements.searchIconBtn, 'click', () => this.openSearchPage());
        on(this.elements.userAvatarBtn, 'click', () => this.toggleAvatarDropdown());
        on(this.elements.refreshBtn, 'click', () => this.forceRefreshRatings());
        on(this.elements.openFullBtn, 'click', () => this.openRatingsPage());
        on(this.elements.settingsBtn, 'click', () => {
            this.closeAvatarDropdown();
            chrome.tabs.create({ url: chrome.runtime.getURL('src/pages/settings/settings.html') });
        });
        on(this.elements.profileMenuBtn, 'click', () => {
            this.closeAvatarDropdown();
            const user = firebaseManager.getCurrentUser();
            if (user) this.openUserProfile(user.uid);
        });
        on(document.getElementById('popupStatusDismiss'), 'click', () => this.hideError());
        this.dismissClickListener = event => {
            if (!event.target.closest('#avatarContainer, #avatarDropdown')) this.closeAvatarDropdown(false);
            if (!event.target.closest('.rating-menu, .rating-menu-dropdown')) this.closePopupMenus();
            if (!event.target.closest('.rating-score-badge, .average-score-tooltip')) this.unlockTooltip();
            if (!event.target.closest('#searchLayer, #searchToggleBtn')) this.hideSearchResults();
        };
        this.dismissKeyListener = event => {
            if (event.key !== 'Escape') return;
            if (this.activeMenuButton) { event.preventDefault(); this.closePopupMenus(true); return; }
            if (this.lockedTooltip) { event.preventDefault(); this.unlockTooltip(); return; }
            if (!this.elements.avatarDropdown?.hidden) { this.closeAvatarDropdown(); return; }
            if (this.elements.controlsBar?.classList.contains('search-active')) this.closeSearchLayer();
        };
        document.addEventListener('click', this.dismissClickListener);
        document.addEventListener('keydown', this.dismissKeyListener);
        this.overlayScrollListener = () => {
            this.closePopupMenus();
            this.closeAvatarDropdown(false);
            this.unlockTooltip();
        };
        on(this.elements.feedContent, 'scroll', this.overlayScrollListener);
        const resumePagination = () => {
            this.consecutiveAutoLoads = 0;
            if (this.hasMore && !this.isLoadingMore && !this.isCircuitBreakerTripped) this.showTrigger();
        };
        on(this.elements.feedContent, 'wheel', resumePagination);
        on(this.elements.feedContent, 'touchmove', resumePagination);
        on(this.elements.feedContent, 'keydown', event => {
            if (['PageDown', 'ArrowDown', 'End', ' '].includes(event.key)) resumePagination();
        });
        window.addEventListener('resize', this.overlayScrollListener);
        this.setupPasswordToggles();
        this.setupIntersectionObserver();
    }

    async setFilter(filter) {
        if (!['all', 'my'].includes(filter) || this.currentFilter === filter) return;
        this.currentFilter = filter;
        this.elements.filterAllRatings?.classList.toggle('active', filter === 'all');
        this.elements.filterMyRatings?.classList.toggle('active', filter === 'my');
        this.syncAccessibleLabels();
        this.invalidateFeed(true);
        await this.loadRatings();
    }

    openSearchLayer() {
        this.closeAvatarDropdown(false);
        this.elements.searchLayer.hidden = false;
        this.elements.searchLayer.inert = false;
        this.elements.chipsLayer.inert = true;
        this.elements.chipsLayer.hidden = true;
        this.elements.controlsBar.classList.add('search-active');
        this.elements.searchToggleBtn?.setAttribute('aria-expanded', 'true');
        this.elements.searchInput?.focus();
    }

    closeSearchLayer(restoreFocus = true) {
        clearTimeout(this.searchTimeout);
        this.searchGeneration = (this.searchGeneration || 0) + 1;
        this.elements.controlsBar?.classList.remove('search-active');
        if (this.elements.searchLayer) {
            this.elements.searchLayer.inert = true;
            this.elements.searchLayer.hidden = true;
        }
        if (this.elements.chipsLayer) {
            this.elements.chipsLayer.hidden = false;
            this.elements.chipsLayer.inert = false;
        }
        if (this.elements.searchInput) this.elements.searchInput.value = '';
        this.elements.searchToggleBtn?.setAttribute('aria-expanded', 'false');
        this.hideSearchResults();
        if (restoreFocus) this.elements.searchToggleBtn?.focus();
    }

    toggleAvatarDropdown() {
        const dropdown = this.elements.avatarDropdown;
        if (!dropdown) return;
        if (!dropdown.hidden) {
            this.closeAvatarDropdown();
            return;
        }
        this.closePopupMenus();
        this.unlockTooltip();
        document.body.append(dropdown);
        dropdown.hidden = false;
        dropdown.inert = false;
        dropdown.classList.add('active');
        this.elements.userAvatarBtn?.setAttribute('aria-expanded', 'true');
        this.positionOverlay(dropdown, this.elements.userAvatarBtn);
        dropdown.querySelector('button')?.focus();
    }

    closeAvatarDropdown(restoreFocus = true) {
        const dropdown = this.elements.avatarDropdown;
        if (!dropdown) return;
        const containedFocus = dropdown.contains(document.activeElement);
        dropdown.classList.remove('active');
        dropdown.hidden = true;
        dropdown.inert = true;
        this.elements.userAvatarBtn?.setAttribute('aria-expanded', 'false');
        if (restoreFocus && containedFocus) this.elements.userAvatarBtn?.focus();
    }

    setupScoreBadgeTooltip(ratingDiv, ratingId) {
        const badge = ratingDiv.querySelector('.rating-score-badge');
        const tooltip = document.getElementById(`tooltip-${ratingId}`) || ratingDiv.querySelector('.average-score-tooltip');
        if (!badge || !tooltip) return;
        tooltip.hidden = true;
        tooltip.setAttribute('role', 'tooltip');
        badge.setAttribute('aria-describedby', tooltip.id);
        badge.setAttribute('aria-expanded', 'false');
        const show = () => {
            const clickLocked = this.tooltipClickLocked === tooltip;
            this.unlockTooltip();
            if (clickLocked) this.tooltipClickLocked = tooltip;
            document.body.append(tooltip);
            tooltip.hidden = false;
            tooltip.classList.add('active');
            badge.setAttribute('aria-expanded', 'true');
            this.lockedTooltip = tooltip;
            this.tooltipAnchor = badge;
            this.positionOverlay(tooltip, badge, true);
        };
        badge.addEventListener('click', () => {
            if (this.tooltipClickLocked === tooltip) this.unlockTooltip();
            else { show(); this.tooltipClickLocked = tooltip; }
        });
        badge.addEventListener('mouseenter', () => {
            clearTimeout(this.tooltipTimeout);
            this.tooltipTimeout = setTimeout(show, 220);
        });
        badge.addEventListener('mouseleave', () => {
            clearTimeout(this.tooltipTimeout);
            if (document.activeElement !== badge && this.tooltipClickLocked !== tooltip) this.unlockTooltip();
        });
        badge.addEventListener('focus', show);
        badge.addEventListener('blur', () => this.unlockTooltip());
    }

    unlockTooltip() {
        clearTimeout(this.tooltipTimeout);
        this.tooltipTimeout = null;
        if (this.lockedTooltip) {
            this.lockedTooltip.classList.remove('active');
            this.lockedTooltip.hidden = true;
        }
        this.tooltipAnchor?.setAttribute('aria-expanded', 'false');
        this.lockedTooltip = null;
        this.tooltipClickLocked = null;
        this.tooltipAnchor = null;
    }

    setupIntersectionObserver() {
        const options = {
            root: this.elements.feedContent || null,
            rootMargin: '100px',
            threshold: 0.1
        };
        
        this.observer = new IntersectionObserver((entries) => {
            const entry = entries[0];
            if (entry.isIntersecting && this.hasMore && !this.isLoadingMore && this.ratingsLoaded && !this.isCircuitBreakerTripped) {
                this.debug('Infinite scroll: loading the next page');
                this.loadMoreRatings();
            }
        }, options);
        
        if (this.elements.infiniteScrollTrigger) {
            this.observer.observe(this.elements.infiniteScrollTrigger);
        }
    }

    /** Show the infinite scroll trigger and re-attach the observer so it fires reliably */
    showTrigger() {
        const el = this.elements.infiniteScrollTrigger;
        if (!el || !this.elements.feedContent) return;
        if (this.observer) this.observer.unobserve(el);
        
        // Ensure trigger is located inside feedContent at the very bottom
        if (this.elements.feedContent.lastElementChild !== el) {
            this.elements.feedContent.appendChild(el);
        }

        el.style.display = 'flex';
        if (this.observer) this.observer.observe(el);
    }

    /** Hide the infinite scroll trigger and detach the observer */
    hideTrigger() {
        const el = this.elements.infiniteScrollTrigger;
        if (!el) return;
        if (this.observer) this.observer.unobserve(el);
        el.style.display = 'none';
    }

    setupAuthSwitching() {
        if (this.elements.showRegisterLink) {
            this.elements.showRegisterLink.addEventListener('click', (e) => {
                e.preventDefault();
                this.switchAuthForm('register');
            });
        }

        if (this.elements.showLoginLink) {
            this.elements.showLoginLink.addEventListener('click', (e) => {
                e.preventDefault();
                this.switchAuthForm('login');
            });
        }
    }

    switchAuthForm(target) {
        this.clearAuthErrors();
        if (target === 'register') {
            if (this.elements.approvalStatusSection) {
                this.elements.approvalStatusSection.classList.remove('active');
                this.elements.approvalStatusSection.style.display = 'none';
            }
            this.elements.loginFormSection.classList.remove('active');
            setTimeout(() => {
                this.elements.loginFormSection.style.display = 'none';
                this.elements.registerFormSection.style.display = 'block';
                // Trigger reflow
                void this.elements.registerFormSection.offsetWidth;
                this.elements.registerFormSection.classList.add('active');
                
                // Reset registration steps to 1 just in case
                this.goToRegisterStep1();
                
            }, 200);
        } else if (target === 'login') {
            if (this.elements.approvalStatusSection) {
                this.elements.approvalStatusSection.classList.remove('active');
                this.elements.approvalStatusSection.style.display = 'none';
            }
            this.elements.registerFormSection.classList.remove('active');
            setTimeout(() => {
                this.elements.registerFormSection.style.display = 'none';
                this.elements.loginFormSection.style.display = 'block';
                // Trigger reflow
                void this.elements.loginFormSection.offsetWidth;
                this.elements.loginFormSection.classList.add('active');
                
                // Reset login steps to 1
                this.goToStep1();
                
            }, 200);
        } else if (target === 'approval') {
            this.elements.loginFormSection.classList.remove('active');
            this.elements.registerFormSection.classList.remove('active');
            this.elements.loginFormSection.style.display = 'none';
            this.elements.registerFormSection.style.display = 'none';
            if (this.elements.approvalStatusSection) {
                this.elements.approvalStatusSection.style.display = 'block';
                void this.elements.approvalStatusSection.offsetWidth;
                this.elements.approvalStatusSection.classList.add('active');
            }
        }
    }

    setupPasswordToggles() {
        document.querySelectorAll('.toggle-password').forEach(button => button.addEventListener('click', event => {
            event.preventDefault();
            const input = button.previousElementSibling;
            if (input?.tagName !== 'INPUT') return;
            const reveal = input.type === 'password';
            input.type = reveal ? 'text' : 'password';
            button.setAttribute('aria-pressed', String(reveal));
            button.setAttribute('aria-label', i18n.get(reveal ? 'popup.auth.password_hide' : 'popup.auth.password_show'));
            button.title = button.getAttribute('aria-label');
            button.innerHTML = reveal ? Icons.EYE_OFF : Icons.EYE;
        }));
    }

    setupAuthStateListener() {
        this.authListener = async event => {
            const { user, isAuthenticated } = event.detail;
            const generation = ++this.authGeneration;
            if (!isAuthenticated || !user) { this.updateAuthUI(false, null); return; }
            if (this.activeUserId && this.activeUserId !== user.uid) this.updateAuthUI(false, null);
            if (!await this.validateUserApproval(user.uid) || !this.isAuthContextCurrent(user.uid, generation)) return;
            this.updateAuthUI(true, user);
            if (!this.ratingsLoaded && !this.isLoadingRatings) await this.loadRatings();
        };
        this.profileListener = () => {
            if (!this.activeUserId) return;
            this.loadUserDisplayPreferences(this.activeUserId);
            this.forceRefreshRatings();
        };
        window.addEventListener('authStateChanged', this.authListener);
        window.addEventListener('profileUpdated', this.profileListener);
    }

    async initializeUI() {
        this.checkPendingUpdate();
        const generation = this.authGeneration;
        const authData = await AuthManager.getAuthData();
        if (this.disposed || this.authGeneration !== generation) return;
        const user = authData?.user || (firebaseManager.waitForAuthReady
            ? await firebaseManager.waitForAuthReady(400) : firebaseManager.getCurrentUser());
        if (this.disposed || this.authGeneration !== generation) return;
        if (!user) { this.updateAuthUI(false, null); return; }
        if (!await this.validateUserApproval(user.uid) || !this.isAuthContextCurrent(user.uid, generation)) return;
        this.updateAuthUI(true, user);
        await this.loadRatings();
    }

    checkPendingUpdate() {
        chrome.runtime.sendMessage({ type: 'GET_UPDATE_STATE' }, (response) => {
            if (chrome.runtime.lastError || !response?.success) return;
            this.renderUpdateState(response.state, response.settings);
        });

        // Listen for real-time update messages from background
        if (!this.updateStateListenerRegistered) {
            this.updateStateListenerRegistered = true;
            chrome.runtime.onMessage.addListener((message) => {
                if (message.type === 'UPDATE_STATE_CHANGED') {
                    this.renderUpdateState(message.state, message.settings);
                }
            });
        }
    }

    renderUpdateState(state, settings = {}) {
        if (['failed', 'check_failed', 'up_to_date', 'idle', 'succeeded', 'waiting_for_safe_moment']
            .includes(state?.status)) {
            // A native operation can fail after the popup's original click has
            // returned. Release the local guard so Retry/Update works again.
            this.updateActionInFlight = false;
        }
        const version = state?.availableVersion;
        const deferred = state?.deferredUntil && state.deferredUntil > Date.now();
        if (!version || deferred || ['up_to_date', 'idle', 'succeeded', 'deferred'].includes(state.status)) {
            const banner = document.getElementById('updateBanner');
            if (banner) banner.style.display = 'none';
            return;
        }
        this.showUpdateBanner(version, state.status, settings, state);
    }

    sendUpdateRuntimeMessage(message) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                if (!response?.success) {
                    reject(new Error(response?.error || 'UPDATE_REQUEST_FAILED'));
                    return;
                }
                resolve(response);
            });
        });
    }

    showPlaybackUpdateDialog(version) {
        if (this.updatePlaybackDialogOpen) return Promise.resolve(false);
        this.updatePlaybackDialogOpen = true;
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'update-playback-dialog-overlay';
            overlay.setAttribute('role', 'presentation');

            const dialog = document.createElement('div');
            dialog.className = 'update-playback-dialog';
            dialog.setAttribute('role', 'dialog');
            dialog.setAttribute('aria-modal', 'true');
            dialog.setAttribute('aria-label', i18n.get('settings.updates.playback_warning_title'));

            const title = document.createElement('h3');
            title.textContent = i18n.get('settings.updates.playback_warning_title');
            const text = document.createElement('p');
            text.textContent = i18n.get('settings.updates.playback_warning')
                .replace('{version}', version || 'latest');

            const actions = document.createElement('div');
            actions.className = 'update-playback-dialog-actions';
            const declineBtn = document.createElement('button');
            declineBtn.type = 'button';
            declineBtn.className = 'btn-dismiss';
            declineBtn.textContent = i18n.get('settings.updates.playback_decline_button');
            const confirmBtn = document.createElement('button');
            confirmBtn.type = 'button';
            confirmBtn.className = 'btn-update';
            confirmBtn.textContent = i18n.get('settings.updates.playback_confirm_button');

            let settled = false;
            const previousActiveElement = document.activeElement;
            const getFocusable = () => [declineBtn, confirmBtn].filter(button => !button.disabled);
            const finish = (confirmed) => {
                if (settled) return;
                settled = true;
                this.updatePlaybackDialogOpen = false;
                document.removeEventListener('keydown', onKeyDown);
                overlay.remove();
                if (previousActiveElement && typeof previousActiveElement.focus === 'function'
                    && document.contains(previousActiveElement)) previousActiveElement.focus();
                resolve(confirmed);
            };
            const onKeyDown = (event) => {
                if (event.key === 'Escape') finish(false);
                if (event.key !== 'Tab') return;
                const focusable = getFocusable();
                if (focusable.length === 0) return;
                const currentIndex = focusable.indexOf(document.activeElement);
                const nextIndex = event.shiftKey
                    ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
                    : (currentIndex === -1 || currentIndex === focusable.length - 1 ? 0 : currentIndex + 1);
                event.preventDefault();
                focusable[nextIndex].focus();
            };
            declineBtn.addEventListener('click', () => finish(false));
            confirmBtn.addEventListener('click', () => finish(true));
            overlay.addEventListener('click', (event) => {
                if (event.target === overlay) finish(false);
            });
            document.addEventListener('keydown', onKeyDown);

            actions.append(declineBtn, confirmBtn);
            dialog.append(title, text, actions);
            overlay.appendChild(dialog);
            document.body.appendChild(overlay);
            confirmBtn.focus();
        });
    }

    showUpdateBanner(version, status, settings = {}, state = {}) {
        const banner = document.getElementById('updateBanner');
        const versionEl = document.getElementById('updateVersion');
        const statusEl = document.getElementById('updateStatus');
        const updateBtn = document.getElementById('updateBtn');
        const dismissBtn = document.getElementById('dismissUpdateBtn');

        if (banner && versionEl) {
            const setupRequired = status === 'setup_required';
            const waitingForPlayback = status === 'waiting_for_safe_moment';
            const needsPlaybackConfirmation = waitingForPlayback && state.requiresConfirmation === true;
            // A background check may leave the update waiting for playback.
            // Keep the action available so the user can explicitly confirm an
            // update from the popup instead of being forced to wait for the
            // next automatic retry.
            const busy = ['installing', 'awaiting_confirmation'].includes(status);
            versionEl.textContent = `${i18n.get('popup.update.version')} ${version}`;
            if (statusEl) {
                statusEl.textContent = status === 'installing'
                    ? (i18n.currentLocale === 'ru' ? 'Установка…' : 'Installing…')
                    : status === 'waiting_for_safe_moment'
                        ? (needsPlaybackConfirmation
                            ? (i18n.currentLocale === 'ru' ? 'Нужно подтверждение' : 'Confirmation required')
                            : (i18n.currentLocale === 'ru' ? 'Ожидает завершения просмотра' : 'Waiting for playback to finish'))
                    : status === 'setup_required'
                        ? (i18n.currentLocale === 'ru' ? 'Нужно один раз запустить Setup' : 'Run Setup once')
                    : status === 'failed'
                        ? (i18n.currentLocale === 'ru' ? 'Ошибка обновления' : 'Update failed')
                        : (i18n.currentLocale === 'ru' ? 'Готово к установке' : 'Ready to install');
            }
            banner.style.display = 'flex';
            updateBtn.textContent = setupRequired
                ? (i18n.currentLocale === 'ru' ? 'Подключить обновления' : 'Connect updates')
                : status === 'failed'
                    ? (i18n.currentLocale === 'ru' ? 'Повторить' : 'Retry')
                    : (i18n.currentLocale === 'ru' ? 'Обновить' : 'Update');
            updateBtn.disabled = busy;

            // Update button handler. A manual click always performs an
            // interactive check first so playback can be confirmed explicitly.
            updateBtn.onclick = async () => {
                if (this.updateActionInFlight) return;
                if (setupRequired) {
                    chrome.tabs.create({ url: UpdateService.getSetupUrl() }, () => {
                        if (chrome.runtime.lastError) {
                            console.error('Could not open updater setup:', chrome.runtime.lastError.message);
                        }
                    });
                    return;
                }
                this.updateActionInFlight = true;
                updateBtn.textContent = i18n.currentLocale === 'ru' ? 'Установка...' : 'Installing...';
                updateBtn.disabled = true;

                try {
                    let result = (await this.sendUpdateRuntimeMessage({
                        type: 'CHECK_FOR_UPDATES',
                        force: true,
                        interactive: true
                    })).state;

                    if (['available', 'available_manual', 'deferred'].includes(result.status)) {
                        result = (await this.sendUpdateRuntimeMessage({
                            type: 'APPLY_UPDATE',
                            automatic: false,
                            allowPlayback: false
                        })).state;
                    }

                    if (result.status === 'waiting_for_safe_moment' && result.requiresConfirmation) {
                        const confirmed = await this.showPlaybackUpdateDialog(result.availableVersion);
                        if (!confirmed) {
                            updateBtn.textContent = i18n.currentLocale === 'ru' ? 'Подождать' : 'Wait';
                            updateBtn.disabled = false;
                            this.updateActionInFlight = false;
                            return;
                        }
                        result = (await this.sendUpdateRuntimeMessage({
                            type: 'APPLY_UPDATE',
                            automatic: false,
                            allowPlayback: true
                        })).state;
                    }

                    if (result.status === 'waiting_for_safe_moment') {
                        updateBtn.textContent = i18n.currentLocale === 'ru'
                            ? 'Ожидает завершения просмотра'
                            : 'Waiting for playback to finish';
                        updateBtn.disabled = false;
                    } else if (result.status === 'failed' || result.status === 'check_failed') {
                        updateBtn.textContent = i18n.currentLocale === 'ru' ? 'Ошибка' : 'Error';
                        updateBtn.disabled = false;
                    }
                    if (!['installing', 'queued', 'downloading', 'replacing', 'awaiting_confirmation']
                        .includes(result.status)) this.updateActionInFlight = false;
                    this.checkPendingUpdate();
                } catch (error) {
                    updateBtn.textContent = i18n.currentLocale === 'ru' ? 'Ошибка' : 'Error';
                    updateBtn.disabled = false;
                    this.updateActionInFlight = false;
                    console.error('Update request failed:', error);
                }
            };

            // Dismiss button handler
            dismissBtn.onclick = () => {
                banner.style.display = 'none';
                chrome.runtime.sendMessage({ type: 'DEFER_UPDATE' });
            };
        }
    }

    async loadUserDisplayPreferences(userId) {
        const generation = this.authGeneration;
        const current = () => this.activeUserId === userId && this.isAuthContextCurrent(userId, generation);
        try {
            const cached = await this.getCachedProfile(userId);
            if (!current()) return;
            if (cached) { this.currentUserProfile = cached; this.applyDisplayName(cached); }
            const profile = await firebaseManager.getUserService().getUserProfile(userId, { throwOnError: true });
            if (!current() || !profile) return;
            this.currentUserProfile = this.compactProfile(profile);
            this.applyDisplayName(this.currentUserProfile);
            await this.cacheProfile(userId, profile);
        } catch (error) { this.debug('Profile display preferences unavailable', error); }
    }

    applyDisplayName(profile) {
        if (!profile || !this.activeUserId) return;
        const name = Utils.getDisplayName(profile, firebaseManager.getCurrentUser()) || i18n.get('popup.rating.unknown_user');
        if (this.elements.userName) this.elements.userName.textContent = name;
        if (this.elements.statusText) this.elements.statusText.textContent = i18n.get('popup.header.signed_in_as').replace('{user}', name);
    }

    async getCachedProfile(userId) {
        const key = 'user_profile_' + userId;
        const stored = await new Promise(resolve => chrome.storage.local.get([key], resolve));
        return stored[key] ? this.compactProfile(stored[key]) : null;
    }

    cacheProfile(userId, profile) {
        const generation = this.authGeneration;
        const operation = async () => {
            const stored = await new Promise(resolve => chrome.storage.local.get(['user_profile_index'], resolve));
            if (this.activeUserId !== userId || !this.isAuthContextCurrent(userId, generation)) return;
            const previous = Array.isArray(stored.user_profile_index) ? stored.user_profile_index : [];
            const index = [userId, ...previous.filter(id => id !== userId)].slice(0, 20);
            const removed = previous.filter(id => !index.includes(id)).map(id => 'user_profile_' + id);
            if (removed.length) await chrome.storage.local.remove(removed);
            await chrome.storage.local.set({ ['user_profile_' + userId]: this.compactProfile(profile), user_profile_index: index });
        };
        this.profileCacheWritePromise = (this.profileCacheWritePromise || Promise.resolve()).catch(() => {}).then(operation);
        return this.profileCacheWritePromise;
    }

    updateAuthUI(isAuthenticated, user, showContent = true) {
        if (!isAuthenticated || !user) {
            this.activeUserId = null;
            this.currentUserProfile = null;
            this.invalidateFeed(true);
            this.closeAvatarDropdown(false);
            this.closeSearchLayer(false);
            this.activeDialog?.close(false);
            this.showLoading(false);
            this.hideError();
            this.elements.initialLoading.style.display = 'none';
            this.elements.mainContent.style.display = 'none';
            this.elements.headerActionsGroup.style.display = 'none';
            this.elements.authSection.style.display = 'block';
            this.elements.authStatus.style.display = 'flex';
            this.elements.statusText.textContent = i18n.get('popup.header.not_authenticated');
            if (this.elements.userName) this.elements.userName.textContent = '';
            if (this.elements.userAvatar) { this.elements.userAvatar.removeAttribute('src'); this.elements.userAvatar.style.display = 'none'; }
            this.approvalCheckUserId = null;
            return;
        }
        if (this.activeUserId !== user.uid) {
            this.invalidateFeed(true);
            this.currentUserProfile = null;
            this.closeSearchLayer(false);
            this.closeAvatarDropdown(false);
            this.activeDialog?.close(false);
        }
        this.activeUserId = user.uid;
        this.approvalCheckUserId = null;
        this.elements.authSection.style.display = 'none';
        this.elements.authStatus.style.display = 'none';
        this.elements.headerActionsGroup.style.display = 'flex';
        if (this.elements.userName) this.elements.userName.textContent = user.displayName || i18n.get('popup.rating.unknown_user');
        if (this.elements.userAvatar) {
            if (user.photoURL) {
                this.bindImageFallback(this.elements.userAvatar, user.photoURL, i18n.get('popup.header.avatar_alt'));
                this.elements.userAvatar.style.display = 'block';
                this.elements.userAvatarFallback.style.display = 'none';
            } else {
                this.elements.userAvatar.style.display = 'none';
                this.elements.userAvatarFallback.style.display = 'flex';
            }
        }
        this.loadUserDisplayPreferences(user.uid);
        if (showContent) this.showMainContent();
    }

    async handleGoogleLogin() {
        this.clearAuthErrors();
        this.setButtonLoading(this.elements.googleLoginBtn, true, 'popup.auth.loading_google');
        this.setButtonLoading(this.elements.googleRegisterBtn, true, 'popup.auth.loading_google');

        try {
            await firebaseManager.signInWithGoogle();
            
            // Create/update user profile
            const user = firebaseManager.getCurrentUser();
            const userService = firebaseManager.getUserService();

            // Check if profile exists prior to this sign in to determine if it is a new registration
            const existingProfile = await userService.getUserProfile(user.uid, { throwOnError: true });
            const isNewRegistration = !existingProfile;
            
            await userService.createOrUpdateUserProfile(user.uid, {
                displayName: user.displayName,
                photoURL: user.photoURL,
                email: user.email,
                createdAt: user.metadata?.creationTime
            });
            
            // Approval Gate check
            const isApproved = await this.validateUserApproval(user.uid, isNewRegistration);
            if (!isApproved) {
                return;
            }

            // Hide auth section, show initial loading, prepare for content
            this.elements.authSection.style.display = 'none';
            this.elements.initialLoading.style.display = 'flex';
            this.updateAuthUI(true, user, false);
            
            this.loadRatings();
        } catch (error) {
            this.showAuthError(`${i18n.currentLocale === 'ru' ? 'Ошибка входа через Google' : 'Google login failed'}: ${error.message}`);
        } finally {
            this.setButtonLoading(this.elements.googleLoginBtn, false);
            this.setButtonLoading(this.elements.googleRegisterBtn, false);
        }
    }

    handleRegisterStep1(e) {
        e.preventDefault();
        this.clearAuthErrors();

        const firstName = this.elements.registerFirstName.value.trim();
        const lastName = this.elements.registerLastName.value.trim();
        const email = this.elements.registerEmail.value.trim();
        
        if (!firstName) {
            this.showAuthError(i18n.currentLocale === 'ru' ? 'Пожалуйста, введите имя' : 'Please enter your first name', this.elements.registerFirstName, this.elements.registerFirstNameError);
            return;
        }

        if (!lastName) {
            this.showAuthError(i18n.currentLocale === 'ru' ? 'Пожалуйста, введите фамилию' : 'Please enter your last name', this.elements.registerLastName, this.elements.registerLastNameError);
            return;
        }
        
        if (!email) {
            this.showAuthError(i18n.currentLocale === 'ru' ? 'Пожалуйста, введите ваш email' : 'Please enter your email', this.elements.registerEmail, this.elements.registerEmailError);
            return;
        }

        if (!this.isValidEmail(email)) {
            this.showAuthError(i18n.currentLocale === 'ru' ? 'Пожалуйста, введите корректный адрес электронной почты' : 'Please enter a valid email address', this.elements.registerEmail, this.elements.registerEmailError);
            return;
        }
        
        this.clearAuthErrors();
        
        // Populate static preview fields
        if (this.elements.staticName) this.elements.staticName.value = firstName;
        if (this.elements.staticSurname) this.elements.staticSurname.value = lastName;
        if (this.elements.staticRegisterEmail) this.elements.staticRegisterEmail.value = email;
        
        // Switch views
        this.elements.registerStep1.style.display = 'none';
        
        // Hide Step 1 elements
        const dividers = document.getElementById('registerFormSection').querySelectorAll('.auth-divider');
        dividers.forEach(d => d.style.display = 'none');
        if (this.elements.registerFooter) this.elements.registerFooter.style.display = 'none';
        
        this.elements.registerStep2.style.display = 'block';
        this.elements.registerPassword.focus();
    }
    
    goToRegisterStep1(e) {
        if (e) e.preventDefault();
        this.clearAuthErrors();
        
        this.elements.registerStep2.style.display = 'none';
        this.elements.registerStep1.style.display = 'block';
        
        const dividers = document.getElementById('registerFormSection').querySelectorAll('.auth-divider');
        dividers.forEach(d => d.style.display = 'flex');
        if (this.elements.registerFooter) this.elements.registerFooter.style.display = 'block';
    }

    goToStep1(e) {
        if (e) e.preventDefault();
        this.clearAuthErrors();
        
        this.elements.loginStep2.style.display = 'none';
        this.elements.loginStep1.style.display = 'block';
        
        // Show Google button and footer again
        if (this.elements.googleLoginBtn) this.elements.googleLoginBtn.style.display = 'flex';
        const dividers = document.querySelectorAll('.auth-divider');
        dividers.forEach(d => d.style.display = 'flex');
        
        if (this.elements.loginFooter) this.elements.loginFooter.style.display = 'block';
        
        // Focus email
        this.elements.loginEmail.focus();
    }

    handleEmailStep(e) {
        e.preventDefault();
        this.clearAuthErrors();

        const email = this.elements.loginEmail.value.trim();
        
        if (!email) {
            this.showAuthError(i18n.currentLocale === 'ru' ? 'Пожалуйста, введите ваш email' : 'Please enter your email', this.elements.loginEmail, this.elements.loginEmailError);
            return;
        }
        
        if (!this.isValidEmail(email)) {
            this.showAuthError(i18n.currentLocale === 'ru' ? 'Пожалуйста, введите корректный адрес электронной почты' : 'Please enter a valid email address', this.elements.loginEmail, this.elements.loginEmailError);
            return;
        }
        
        this.clearAuthErrors();
        if (this.elements.staticEmail) {
            this.elements.staticEmail.value = email;
        }
        
        // Switch to Step 2
        this.elements.loginStep1.style.display = 'none';
        
        // Hide Google button and specific footer for clean look in step 2
        if (this.elements.googleLoginBtn) this.elements.googleLoginBtn.style.display = 'none';
        const dividers = document.querySelectorAll('.auth-divider');
        dividers.forEach(d => d.style.display = 'none');
        
        if (this.elements.loginFooter) this.elements.loginFooter.style.display = 'none';
        
        this.elements.loginStep2.style.display = 'block';
        this.elements.loginPassword.focus();
    }

    isValidEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    async handleEmailLogin(e) {
        e.preventDefault();
        this.clearAuthErrors();
        
        const email = this.elements.loginEmail.value.trim();
        const password = this.elements.loginPassword.value;

        if (!password) {
            this.showAuthError(i18n.currentLocale === 'ru' ? 'Пожалуйста, введите пароль' : 'Please enter your password', this.elements.loginPassword, this.elements.loginPasswordError);
            return;
        }

        this.setButtonLoading(this.elements.loginPasswordSubmitBtn, true, 'popup.auth.loading_login');

        try {
            await firebaseManager.signInWithEmail(email, password);
            
            // Create/update user profile
            const user = firebaseManager.getCurrentUser();
            const userService = firebaseManager.getUserService();
            await userService.createOrUpdateUserProfile(user.uid, {
                displayName: user.displayName || user.email.split('@')[0],
                photoURL: user.photoURL,
                email: user.email,
                createdAt: user.metadata?.creationTime
            });
            
            // Approval Gate check (not a new registration screen)
            const isApproved = await this.validateUserApproval(user.uid, false);
            if (!isApproved) {
                return;
            }

            // Reset forms
            if (this.elements.loginEmailForm) this.elements.loginEmailForm.reset();
            if (this.elements.loginPasswordForm) this.elements.loginPasswordForm.reset();
            
            // Hide auth section, show initial loading, prepare for content
            this.elements.authSection.style.display = 'none';
            this.elements.initialLoading.style.display = 'flex';
            this.updateAuthUI(true, user, false);
            
            this.loadRatings();
        } catch (error) {
            this.showAuthError(`${i18n.currentLocale === 'ru' ? 'Ошибка входа' : 'Sign in error'}: ${error.message}`, this.elements.loginPassword, this.elements.loginPasswordError);
        } finally {
            this.setButtonLoading(this.elements.loginPasswordSubmitBtn, false);
        }
    }

    async handleRegisterFinal(e) {
        e.preventDefault();
        this.clearAuthErrors();
        
        const email = this.elements.registerEmail.value.trim();
        const password = this.elements.registerPassword.value;
        const confirmPassword = this.elements.registerConfirmPassword.value;

        if (!password) {
            this.showAuthError(i18n.currentLocale === 'ru' ? 'Придумайте пароль' : 'Please enter a password', this.elements.registerPassword, this.elements.registerPasswordError);
            return;
        }

        if (password.length < 6) {
            this.showAuthError(i18n.get('popup.auth.password_min_length'), this.elements.registerPassword, this.elements.registerPasswordError);
            return;
        }

        if (!confirmPassword) {
            this.showAuthError(i18n.currentLocale === 'ru' ? 'Повторите пароль' : 'Please repeat your password', this.elements.registerConfirmPassword, this.elements.registerConfirmPasswordError);
            return;
        }
        
        if (password !== confirmPassword) {
            this.showAuthError(i18n.get('popup.auth.passwords_dont_match'), this.elements.registerConfirmPassword, this.elements.registerConfirmPasswordError);
            return;
        }

        this.setButtonLoading(this.elements.registerFinalSubmitBtn, true, 'popup.auth.loading_register');

        try {
            await firebaseManager.createUserWithEmail(email, password);
            
            // Create user profile
            const user = firebaseManager.getCurrentUser();
            const userService = firebaseManager.getUserService();
            
            const firstName = this.elements.registerFirstName.value.trim();
            const lastName = this.elements.registerLastName.value.trim();
            const displayName = `${firstName} ${lastName}`.trim() || user.email.split('@')[0];

            await userService.createOrUpdateUserProfile(user.uid, {
                displayName: displayName,
                firstName: firstName,
                lastName: lastName,
                photoURL: user.photoURL,
                email: user.email,
                createdAt: user.metadata?.creationTime
            });
            
            // Reset forms & UI state
            if (this.elements.registerInfoForm) this.elements.registerInfoForm.reset();
            if (this.elements.registerPasswordForm) this.elements.registerPasswordForm.reset();
            if (this.elements.registerForm) this.elements.registerForm.reset();
            this.goToRegisterStep1();
            
            // Approval Gate check (isNewRegistration = true)
            const isApproved = await this.validateUserApproval(user.uid, true);
            if (!isApproved) {
                return;
            }

            // Hide auth section, show initial loading, prepare for content
            this.elements.authSection.style.display = 'none';
            this.elements.initialLoading.style.display = 'flex';
            this.updateAuthUI(true, user, false);
            
            this.loadRatings();
        } catch (error) {
            this.showAuthError(`${i18n.currentLocale === 'ru' ? 'Ошибка регистрации' : 'Registration error'}: ${error.message}`);
        } finally {
            this.setButtonLoading(this.elements.registerFinalSubmitBtn, false);
        }
    }

    showApprovalScreen({ status, isNewRegistration = false }) {
        this.switchAuthForm('approval');
        
        const iconWrapper = this.elements.approvalStatusIconWrapper;
        const iconEl = this.elements.approvalStatusIcon;
        const titleEl = this.elements.approvalStatusTitle;
        const msgEl = this.elements.approvalStatusMessage;
        
        if (status === 'pending') {
            if (iconWrapper) iconWrapper.className = 'approval-status-icon-wrapper status-pending';
            if (iconEl) iconEl.innerHTML = (typeof Icons !== 'undefined' && Icons.CLOCK) ? Icons.CLOCK : '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>';
            
            if (isNewRegistration) {
                if (titleEl) titleEl.textContent = (typeof i18n !== 'undefined' && i18n.get) ? i18n.get('popup.approval.pending_registered_title') : 'Заявка на рассмотрении';
                if (msgEl) msgEl.textContent = (typeof i18n !== 'undefined' && i18n.get) ? i18n.get('popup.approval.pending_registered_msg') : 'Ваш аккаунт успешно создан и ожидает подтверждения администратором. После одобрения вы получите полный доступ к расширению.';
            } else {
                if (titleEl) titleEl.textContent = (typeof i18n !== 'undefined' && i18n.get) ? i18n.get('popup.approval.pending_login_title') : 'Аккаунт ожидает подтверждения';
                if (msgEl) msgEl.textContent = (typeof i18n !== 'undefined' && i18n.get) ? i18n.get('popup.approval.pending_login_msg') : 'Ваша регистрация находится на рассмотрении у администратора. Доступ будет открыт сразу после проверки.';
            }
        } else if (status === 'rejected') {
            if (iconWrapper) iconWrapper.className = 'approval-status-icon-wrapper status-rejected';
            if (iconEl) iconEl.innerHTML = (typeof Icons !== 'undefined' && Icons.SHIELD_ALERT) ? Icons.SHIELD_ALERT : '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
            if (titleEl) titleEl.textContent = (typeof i18n !== 'undefined' && i18n.get) ? i18n.get('popup.approval.rejected_title') : 'Доступ ограничен';
            if (msgEl) msgEl.textContent = (typeof i18n !== 'undefined' && i18n.get) ? i18n.get('popup.approval.rejected_msg') : 'Ваша регистрация была отклонена администратором.';
        }
    }

    async validateUserApproval(userId, isNewRegistration = false) {
        if (!userId) return false;
        const generation = this.authGeneration;
        try {
            const profile = await firebaseManager.getUserService().getUserProfile(userId, { throwOnError: true });
            if (!this.isAuthContextCurrent(userId, generation)) return false;
            if (!profile) throw new Error('Approval profile unavailable');
            if (['pending', 'rejected'].includes(profile.approvalStatus)) {
                await this.handleApprovalBlocked(profile.approvalStatus, isNewRegistration, userId);
                return false;
            }
            if (profile.approvalStatus && profile.approvalStatus !== 'approved') throw new Error('Unknown approval state');
            return true;
        } catch (error) {
            if (!this.isAuthContextCurrent(userId, generation)) return false;
            this.debug('Approval check unavailable', error);
            this.updateAuthUI(false, null);
            this.elements.initialLoading.style.display = 'none';
            this.elements.mainContent.style.display = 'none';
            this.elements.headerActionsGroup.style.display = 'none';
            this.elements.authSection.style.display = 'block';
            this.switchAuthForm('approval');
            this.approvalCheckUserId = userId;
            this.elements.approvalStatusTitle.textContent = i18n.get('popup.approval.unavailable_title');
            this.elements.approvalStatusMessage.textContent = i18n.get('popup.approval.unavailable_msg');
            this.elements.approvalBackBtnText.textContent = i18n.get('popup.approval.retry');
            return false;
        }
    }

    async handleApprovalBlocked(status, isNewRegistration = false, userId = null) {
        const user = firebaseManager.getCurrentUser();
        if (userId && user && user.uid !== userId) return;
        this.updateAuthUI(false, null);
        try {
            await this.profileCacheWritePromise;
            await AuthManager.clearAuthData();
            if (firebaseManager.signOut) await firebaseManager.signOut();
        } catch (error) { this.debug('Blocked account sign out failed', error); }
        if (firebaseManager.getCurrentUser()?.uid && firebaseManager.getCurrentUser().uid !== userId) return;
        this.elements.approvalBackBtnText.textContent = i18n.get('popup.approval.back_to_login');
        this.showApprovalScreen({ status, isNewRegistration });
    }

    async handleLogout() {
        ++this.authGeneration;
        this.updateAuthUI(false, null);
        try {
            await this.profileCacheWritePromise;
            await firebaseManager.getRatingsCacheService().clearCache();
            await AuthManager.clearAuthData();
            await firebaseManager.signOut();
        } catch (error) {
            this.debug('Sign out failed', error);
            this.showError(i18n.get('popup.auth.logout_failed'));
        }
    }

    handleSearch(event) {
        clearTimeout(this.searchTimeout);
        const generation = ++this.searchGeneration;
        const query = event.target.value.trim();
        if (query.length < 2) { this.hideSearchResults(); return; }
        this.showSearchMessage('popup.content.search_loading');
        this.searchTimeout = setTimeout(() => this.performSearch(query, generation), 300);
    }

    async performSearch(query, generation = this.searchGeneration) {
        if (!this.isSearchContextCurrent(query, generation)) return;
        this.showSearchMessage('popup.content.search_loading');
        let failed = false;
        try {
            const result = await firebaseManager.getKinopoiskService().searchMovies(query, 1, 5, { skipOffscreen: true, skipFetchScraper: true });
            if (!this.isSearchContextCurrent(query, generation)) return;
            const movies = (result?.docs || []).map(doc => ({
                kinopoiskId: doc.id || doc.kinopoiskId,
                name: doc.name || doc.alternativeName || i18n.get('popup.rating.unknown_movie'),
                year: doc.year || '', genres: doc.genres || [],
                posterUrl: doc.poster?.previewUrl || doc.poster?.url || doc.posterUrl || ''
            })).filter(movie => this.movieDetailsUrl(movie.kinopoiskId));
            if (movies.length) { this.displaySearchResults(movies); return; }
        } catch (error) { failed = true; this.debug('Search provider unavailable', error); }
        if (!this.isSearchContextCurrent(query, generation)) return;
        try {
            const cached = await firebaseManager.getMovieCacheService().searchCachedMovies(query, 5);
            if (!this.isSearchContextCurrent(query, generation)) return;
            if (failed && !cached?.length) this.showSearchMessage('popup.content.search_error');
            else this.displaySearchResults(cached);
        } catch (error) {
            if (this.isSearchContextCurrent(query, generation)) this.showSearchMessage('popup.content.search_error');
            this.debug('Search cache unavailable', error);
        }
    }

    displaySearchResults(movies) {
        const results = this.elements.searchResults;
        results.replaceChildren();
        const query = this.elements.searchInput.value.toLowerCase().trim();
        for (const movie of movies || []) {
            const href = this.movieDetailsUrl(movie.kinopoiskId || movie.id);
            if (!href) continue;
            const link = document.createElement('a');
            link.className = 'search-result-item';
            link.href = href;
            link.dataset.movieId = String(movie.kinopoiskId || movie.id);
            const name = String(movie.name || i18n.get('popup.rating.unknown_movie'));
            if (name.toLowerCase() === query) link.classList.add('exact-match');
            const poster = document.createElement('img');
            poster.className = 'search-result-poster';
            this.bindImageFallback(poster, movie.posterUrl || movie.poster?.previewUrl);
            const info = document.createElement('div');
            info.className = 'search-result-info';
            const title = document.createElement('h4');
            title.className = 'search-result-title';
            title.textContent = name;
            const meta = document.createElement('p');
            meta.className = 'search-result-meta';
            const genres = (movie.genres || []).slice(0, 2).map(genre => typeof genre === 'object' ? genre.name : genre).filter(Boolean);
            meta.textContent = [movie.year, genres.join(', ')].filter(Boolean).join(' · ');
            info.append(title, meta);
            link.append(poster, info);
            this.bindNavigationLink(link);
            results.append(link);
        }
        if (!results.childElementCount) { this.showSearchMessage('popup.content.search_empty'); return; }
        results.hidden = false;
        results.style.display = 'block';
        this.elements.searchInput.setAttribute('aria-expanded', 'true');
    }


    hideSearchResults() {
        if (!this.elements.searchResults) return;
        this.elements.searchResults.hidden = true;
        this.elements.searchResults.style.display = 'none';
        this.elements.searchInput?.setAttribute('aria-expanded', 'false');
    }

    openSearchPage() {
        const query = this.elements.searchInput.value.trim();
        
        if (query) {
            const encodedQuery = encodeURIComponent(query);
            const url = chrome.runtime.getURL(`src/pages/search/search.html?query=${encodedQuery}`);
            chrome.tabs.create({ url: url });
        } else {
            chrome.tabs.create({ url: chrome.runtime.getURL('src/pages/search/search.html') });
        }
    }

    openMovieDetails(movieId) {
        const url = this.movieDetailsUrl(movieId);
        if (url) chrome.tabs.create({ url });
    }

    openRatingsPage() {
        chrome.tabs.create({ 
            url: chrome.runtime.getURL('src/pages/ratings/ratings.html') 
        });
    }

    openUserProfile(userId) {
        const url = this.profileUrl(userId);
        if (url) chrome.tabs.create({ url });
    }

    openSettings() {
        this.showError('Settings feature coming soon!');
    }

    async loadRatings() {
        if (this.isLoadingRatings || !this.activeUserId || this.disposed) return;
        const context = this.getFeedContext();
        this.isLoadingRatings = true;
        this.consecutiveAutoLoads = 0;
        this.isCircuitBreakerTripped = false;
        this.hideError();
        this.hideTrigger();
        this.showMainContent();
        if (!this.ratings.length) this.renderFeedState('loading');
        try {
            const service = firebaseManager.getRatingsCacheService();
            const result = await service.getCachedRatingsWithBackgroundRefresh(this.ITEMS_PER_PAGE, null,
                context.filter === 'my' ? context.userId : null);
            if (!this.commitRatingsPage(result, context)) return;
            this.observeBackgroundRefresh(result.refreshPromise, context, this.feedRevision);
        } catch (error) {
            if (!this.isFeedContextCurrent(context)) return;
            if (!this.ratings.length) this.renderFeedState('error');
            this.showError(i18n.get('popup.content.load_failed'));
            this.debug('Initial ratings read unavailable', error);
        } finally {
            if (this.isFeedContextCurrent(context)) this.isLoadingRatings = false;
        }
    }

    async loadMoreRatings() {
        if (this.disposed || !this.activeUserId || this.isLoadingRatings || this.isLoadingMore || !this.ratingsLoaded
            || !this.hasMore || this.isCircuitBreakerTripped) return;
        const now = performance.now();
        if (now - this.lastLoadMoreTime < this.MIN_LOAD_MORE_INTERVAL_MS) return;
        if (this.consecutiveAutoLoads >= this.MAX_CONSECUTIVE_AUTO_LOADS) { this.hideTrigger(); return; }
        const context = this.getFeedContext();
        this.consecutiveAutoLoads++;
        this.lastLoadMoreTime = now;
        this.isLoadingMore = true;
        try {
            const result = await firebaseManager.getRatingsCacheService().fetchAndCacheRatings(this.ITEMS_PER_PAGE,
                this.lastDoc || this.lastDocId, context.filter === 'my' ? context.userId : null);
            if (!this.isFeedContextCurrent(context) || result?.isSuperseded) return;
            if (result?.criticalError) { this.isCircuitBreakerTripped = true; throw new Error('Pagination paused'); }
            const startIndex = this.ratings.length;
            const ids = new Set(this.ratings.map(item => item.id));
            this.ratings.push(...(result.ratings || []).filter(item => !ids.has(item.id)));
            this.lastDocId = result.lastDocId || null;
            this.lastDoc = result.lastDoc || null;
            this.hasMore = result.hasMore ?? result.ratings.length === this.ITEMS_PER_PAGE;
            this.feedRevision++;
            this.renderRatings(true, startIndex);
        } catch (error) {
            if (!this.isFeedContextCurrent(context)) return;
            this.isCircuitBreakerTripped = true;
            this.hideTrigger();
            this.showError(i18n.get('popup.content.load_failed'));
            this.addFeedRetry();
            this.debug('Ratings pagination unavailable', error);
        } finally {
            if (this.isFeedContextCurrent(context)) this.isLoadingMore = false;
        }
    }

    async forceRefreshRatings() {
        if (this.isLoadingRatings || !this.activeUserId || this.disposed) return;
        this.invalidateFeed();
        const context = this.getFeedContext();
        this.isLoadingRatings = true;
        this.consecutiveAutoLoads = 0;
        this.isCircuitBreakerTripped = false;
        this.hideError();
        this.showMainContent();
        this.elements.refreshBtn?.setAttribute('aria-busy', 'true');
        if (this.elements.refreshBtn) this.elements.refreshBtn.disabled = true;
        if (!this.ratings.length) this.renderFeedState('loading');
        try {
            const result = await firebaseManager.getRatingsCacheService().fetchAndCacheRatings(this.ITEMS_PER_PAGE, null,
                context.filter === 'my' ? context.userId : null);
            return this.commitRatingsPage(result, context);
        } catch (error) {
            if (!this.isFeedContextCurrent(context)) return;
            if (!this.ratings.length) this.renderFeedState('error');
            else { this.addFeedRetry(); if (this.hasMore) this.showTrigger(); }
            this.showError(i18n.get('popup.content.load_failed'));
            this.debug('Ratings refresh unavailable', error);
            return false;
        } finally {
            if (this.isFeedContextCurrent(context)) this.isLoadingRatings = false;
            // Filter switches may happen while refreshing; they must not leave the button busy.
            if (this.elements.refreshBtn) this.elements.refreshBtn.disabled = false;
            this.elements.refreshBtn?.setAttribute('aria-busy', 'false');
        }
    }

    async renderRatings(append = false, startIndex = 0) {
        const context = this.getFeedContext();
        if (!append) {
            this.renderGeneration++;
            this.closePopupMenus();
            this.unlockTooltip();
            this.popupMenus.forEach(menu => menu.remove());
            this.popupMenus.clear();
            document.querySelectorAll('body > .average-score-tooltip').forEach(tooltip => tooltip.remove());
            this.elements.feedContent.replaceChildren();
        }
        const generation = this.renderGeneration;
        if (!this.ratings.length) { this.renderFeedState('empty'); return; }
        const items = append ? this.ratings.slice(startIndex) : this.ratings.slice();
        for (const item of items) {
            if (document.getElementById('rating-' + item.id)) continue;
            this.elements.feedContent.append(this.createRatingElementSync(item, new Map(), this.currentUserProfile));
        }
        if (this.hasMore && this.ratingsLoaded) this.showTrigger();
        else this.hideTrigger();
        // Cards are already visible. Optional averages/profile requests cannot delay the first paint.
        this.ratingsEnrichment = this.enrichRenderedRatings(items, context, generation)
            .catch(error => this.debug('Optional rating enrichment unavailable', error));
    }

    async preloadAverageRatings(ratingsToLoad = null) {
        const ids = [...new Set((ratingsToLoad || this.ratings).map(item => Number(item.movie?.kinopoiskId || item.movieId)).filter(id => id > 0))];
        const service = firebaseManager.getRatingsCacheService();
        let cached;
        try { cached = await service.getCachedAverageRatings(); } catch (error) { this.debug('Average cache unavailable', error); }
        const map = cached instanceof Map ? new Map(cached) : new Map();
        const missing = ids.filter(id => !map.has(id));
        if (!missing.length) return map;
        try {
            const data = await firebaseManager.getRatingService().getBatchMovieAverageRatings(missing);
            for (const [id, value] of Object.entries(data || {})) map.set(Number(id), value);
            await service.cacheAverageRatings(map);
        } catch (error) { this.debug('Average ratings unavailable', error); }
        return map;
    }

    createRatingElementSync(rating, averageRatingsMap = new Map(), currentUserProfile = null) {
        const card = document.createElement('article');
        card.className = 'rating-item clickable-rating';
        card.id = 'rating-' + rating.id;
        const movie = rating.movie || {};
        const movieId = movie.kinopoiskId || rating.movieId;
        const movieUrl = this.movieDetailsUrl(movieId);
        const title = String(movie.name || i18n.get('popup.rating.unknown_movie'));
        const currentUser = firebaseManager.getCurrentUser();
        const own = currentUser?.uid === rating.userId;
        // Only trusted structure/icons use HTML. Every provider/user field is assigned as text or a safe URL.
        card.innerHTML = '<a class="rating-poster-link"><img class="rating-poster"></a><div class="rating-content">' +
            '<div class="rating-title-row"><a class="rating-movie-link"><h3 class="rating-movie-title"></h3></a></div>' +
            '<div class="rating-header-row"><a class="rating-author-group"><img class="rating-author-avatar"><span class="rating-author-name"></span></a>' +
            '<span class="rating-timestamp"></span><div class="rating-actions-group"><div class="rating-menu">' +
            '<button type="button" class="rating-menu-btn" aria-haspopup="menu" aria-expanded="false">⋮</button>' +
            '<div class="popover-surface rating-menu-dropdown" role="menu" hidden>' +
            '<button type="button" class="menu-item edit-item" role="menuitem" data-action="edit"></button>' +
            '<button type="button" class="menu-item delete-item" role="menuitem" data-action="delete"></button></div></div>' +
            '<button type="button" class="rating-score-badge"><span class="score-star" aria-hidden="true">★</span><span class="score-value"></span>' +
            '<span class="tooltip-surface average-score-tooltip" hidden></span></button></div></div>' +
            '<div class="rating-context-row"><p class="rating-comment-snippet"><span class="comment-text"></span></p>' +
            '<p class="rating-genres-snippet"></p></div></div>';
        for (const link of card.querySelectorAll('.rating-poster-link, .rating-movie-link')) {
            if (movieUrl) { link.href = movieUrl; this.bindNavigationLink(link); }
            else link.removeAttribute('href');
        }
        card.dataset.movieId = String(movieId || '');
        const heading = card.querySelector('.rating-movie-title');
        heading.textContent = title;
        heading.title = title;
        if (movie.year) {
            const year = document.createElement('span');
            year.className = 'rating-movie-year';
            year.textContent = ' (' + String(movie.year) + ')';
            heading.append(year);
        }
        this.bindImageFallback(card.querySelector('.rating-poster'), movie.posterUrl || movie.poster?.previewUrl, title);
        const author = card.querySelector('.rating-author-group');
        const authorUrl = this.profileUrl(rating.userId);
        if (authorUrl) { author.href = authorUrl; this.bindNavigationLink(author); }
        author.querySelector('.rating-author-name').textContent = own && currentUserProfile
            ? Utils.getDisplayName(currentUserProfile, currentUser)
            : String(rating.userName || i18n.get('popup.rating.unknown_user'));
        this.bindImageFallback(author.querySelector('img'), own ? currentUserProfile?.photoURL || currentUser.photoURL || rating.userPhoto : rating.userPhoto);
        card.querySelector('.rating-timestamp').textContent = i18n.formatRelativeTime(rating.createdAt);
        const comment = Utils.normalizeRatingComment(rating.comment);
        card.querySelector('.rating-comment-snippet').hidden = !comment;
        card.querySelector('.comment-text').innerHTML = Utils.parseSpoilers(this.escapeHtml(comment));
        const genres = card.querySelector('.rating-genres-snippet');
        genres.hidden = Boolean(comment);
        genres.textContent = Utils.formatGenres(movie.genres, 2) || i18n.get('popup.rating.no_genres');
        const badge = card.querySelector('.rating-score-badge');
        const score = Number(rating.rating);
        const scoreText = Number.isFinite(score) ? String(Math.max(1, Math.min(10, score))) : '—';
        badge.querySelector('.score-value').textContent = scoreText;
        badge.dataset.ratingId = String(rating.id);
        badge.setAttribute('aria-label', scoreText + ' / 10. ' + i18n.get('popup.rating.average'));
        const tooltip = badge.querySelector('.average-score-tooltip');
        tooltip.id = 'tooltip-' + rating.id;
        const average = averageRatingsMap.get(movieId) || averageRatingsMap.get(Number(movieId));
        tooltip.textContent = i18n.get('popup.rating.average') + ': ' +
            (average?.count ? String(Number(Number(average.average).toFixed(1))) : '…');
        const menu = card.querySelector('.rating-menu-dropdown');
        menu.id = 'popup-menu-' + rating.id;
        const button = card.querySelector('.rating-menu-btn');
        button.setAttribute('aria-controls', menu.id);
        button.setAttribute('aria-label', i18n.get('popup.rating.menu'));
        card.querySelector('.edit-item').textContent = i18n.get('movie_details.edit');
        card.querySelector('.delete-item').textContent = i18n.get('movie_details.delete');
        if (own) this.setupPopupRatingMenu(card, rating.id);
        else card.querySelector('.rating-menu').remove();
        this.setupScoreBadgeTooltip(card, rating.id);
        return card;
    }

    setupPopupRatingMenu(card, ratingId) {
        const button = card.querySelector('.rating-menu-btn');
        const menu = card.querySelector('.rating-menu-dropdown');
        if (!button || !menu) return;
        document.body.append(menu);
        this.popupMenus.set(ratingId, menu);
        const items = [...menu.querySelectorAll('button')];
        const open = () => {
            this.closePopupMenus();
            this.closeAvatarDropdown(false);
            this.unlockTooltip();
            menu.hidden = false;
            menu.style.display = 'flex';
            button.setAttribute('aria-expanded', 'true');
            this.activeMenuButton = button;
            this.positionOverlay(menu, button);
            items[0]?.focus();
        };
        button.addEventListener('click', () => menu.hidden ? open() : this.closePopupMenus(true));
        button.addEventListener('keydown', event => {
            if (event.key === 'ArrowDown') { event.preventDefault(); open(); }
        });
        menu.addEventListener('keydown', event => {
            const index = items.indexOf(document.activeElement);
            let target;
            if (event.key === 'ArrowDown') target = items[(index + 1) % items.length];
            if (event.key === 'ArrowUp') target = items[(index - 1 + items.length) % items.length];
            if (event.key === 'Home') target = items[0];
            if (event.key === 'End') target = items.at(-1);
            if (target) { event.preventDefault(); target.focus(); }
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.closePopupMenus(true); }
            if (event.key === 'Tab') this.closePopupMenus(true);
        });
        for (const item of items) item.addEventListener('click', () => {
            this.closePopupMenus(true);
            if (item.dataset.action === 'edit') this.editPopupRating(ratingId);
            if (item.dataset.action === 'delete') this.deletePopupRating(ratingId);
        });
    }

    async editPopupRating(ratingId) {
        const user = firebaseManager.getCurrentUser();
        const generation = this.authGeneration;
        if (!user) { this.showError(i18n.get('navbar.sign_in')); return; }
        try {
            const doc = await firebaseManager.db.collection('ratings').doc(ratingId).get();
            if (!this.isAuthContextCurrent(user.uid, generation) || this.activeUserId !== user.uid) return;
            if (!doc.exists) { this.showError(i18n.get('popup.rating.save_failed')); return; }
            const data = doc.data();
            if (data.userId && data.userId !== user.uid) return;
            this.showEditRatingModalPopup(ratingId, data);
        } catch (error) {
            if (this.isAuthContextCurrent(user.uid, generation)) this.showError(i18n.get('popup.rating.save_failed'));
            this.debug('Rating editor unavailable', error);
        }
    }

    showEditRatingModalPopup(ratingId, ratingData) {
        const user = firebaseManager.getCurrentUser();
        if (!user) return;
        const generation = this.authGeneration;
        const body = document.createElement('form');
        body.id = 'editRatingFormPopup';
        body.className = 'popup-dialog__body';
        body.innerHTML = '<div class="popup-dialog__field"><label for="editRatingSliderPopup"><span class="rating-label"></span>: <output id="editRatingValuePopup" for="editRatingSliderPopup"></output></label>' +
            '<input type="range" id="editRatingSliderPopup" min="1" max="10" step="1"></div>' +
            '<div class="popup-dialog__field"><label for="editRatingCommentPopup" class="comment-label"></label>' +
            '<textarea id="editRatingCommentPopup" class="form-input" rows="4" maxlength="500" aria-describedby="editCommentCountPopup"></textarea>' +
            '<span id="editCommentCountPopup" class="popup-dialog__count"></span></div>' +
            '<p class="popup-dialog__error" role="alert" hidden></p>' +
            '<div class="popup-dialog__footer"><button type="button" id="cancelEditBtnPopup" class="btn btn-secondary"></button>' +
            '<button type="submit" id="saveEditBtnPopup" class="btn btn-primary"></button></div>';
        body.querySelector('.rating-label').textContent = i18n.get('popup.rating.edit_rating');
        body.querySelector('.comment-label').textContent = i18n.get('popup.rating.edit_comment');
        body.querySelector('#cancelEditBtnPopup').textContent = i18n.get('popup.rating.cancel');
        const save = body.querySelector('#saveEditBtnPopup');
        save.textContent = i18n.get('popup.rating.save');
        const slider = body.querySelector('#editRatingSliderPopup');
        const value = body.querySelector('#editRatingValuePopup');
        slider.value = String(Math.max(1, Math.min(10, Number(ratingData.rating) || 1)));
        value.textContent = slider.value;
        slider.addEventListener('input', () => { value.textContent = slider.value; });
        const comment = body.querySelector('#editRatingCommentPopup');
        comment.value = Utils.normalizeRatingComment(ratingData.comment);
        const count = body.querySelector('#editCommentCountPopup');
        const updateCount = () => { count.textContent = i18n.get('popup.rating.comment_count').replace('{count}', String(comment.value.length)); };
        updateCount();
        comment.addEventListener('input', updateCount);
        const dialog = this.openPopupDialog({ title: i18n.get('popup.rating.edit_title'), body,
            closeId: 'closeEditModalPopup', initialFocus: '#editRatingSliderPopup' });
        body.querySelector('#cancelEditBtnPopup').addEventListener('click', () => dialog.close());
        let pending = false;
        body.addEventListener('submit', async event => {
            event.preventDefault();
            if (pending || this.activeDialog !== dialog || !this.isAuthContextCurrent(user.uid, generation)
                || this.activeUserId !== user.uid) return;
            pending = true;
            save.disabled = true;
            body.setAttribute('aria-busy', 'true');
            const error = body.querySelector('.popup-dialog__error');
            error.hidden = true;
            const newRating = Number(slider.value);
            const newComment = comment.value.trim();
            try {
                const profile = await firebaseManager.getUserService().getUserProfile(user.uid, { throwOnError: true });
                if (!this.isAuthContextCurrent(user.uid, generation) || this.activeUserId !== user.uid) return;
                const name = Utils.getDisplayName(profile, user);
                await firebaseManager.getRatingService().addOrUpdateRating(user.uid, name,
                    profile?.photoURL || user.photoURL || '', ratingData.movieId, newRating, newComment);
                if (!this.isAuthContextCurrent(user.uid, generation) || this.activeUserId !== user.uid) return;
                dialog.close();
                const refreshed = await this.forceRefreshRatings();
                if (this.isAuthContextCurrent(user.uid, generation) && this.activeUserId === user.uid) {
                    (document.getElementById('rating-' + ratingId)?.querySelector('.rating-menu-btn') || this.elements.refreshBtn)?.focus();
                    if (refreshed !== false) this.showSuccess(i18n.get('popup.rating.saved'));
                }
            } catch (failure) {
                if (this.activeDialog === dialog) {
                    error.textContent = i18n.get('popup.rating.save_failed');
                    error.hidden = false;
                    save.focus();
                }
                this.debug('Rating save unavailable', failure);
            } finally {
                pending = false;
                save.disabled = false;
                body.setAttribute('aria-busy', 'false');
            }
        });
    }

    async deletePopupRating(ratingId) {
        const user = firebaseManager.getCurrentUser();
        const generation = this.authGeneration;
        if (!user) return;
        const confirmed = await ConfirmDialog.confirm({
            title: i18n.get('confirm_dialog.delete_rating_title'), message: i18n.get('confirm_dialog.delete_rating_message'),
            confirmLabel: i18n.get('confirm_dialog.delete'), danger: true
        });
        if (!confirmed || !this.isAuthContextCurrent(user.uid, generation) || this.activeUserId !== user.uid) return;
        try {
            await firebaseManager.getRatingService().deleteRating(user.uid, ratingId);
            if (!this.isAuthContextCurrent(user.uid, generation) || this.activeUserId !== user.uid) return;
            const refreshed = await this.forceRefreshRatings();
            if (this.isAuthContextCurrent(user.uid, generation) && this.activeUserId === user.uid) {
                this.elements.refreshBtn?.focus();
                if (refreshed !== false) this.showSuccess(i18n.get('popup.rating.deleted'));
            }
        } catch (error) {
            if (this.isAuthContextCurrent(user.uid, generation)) this.showError(i18n.get('popup.rating.delete_failed'));
            this.debug('Rating delete unavailable', error);
        }
    }


    showLoading(show) {
        this.elements.loading.style.display = show ? 'flex' : 'none';
    }

    hideFeedContentWithFade() {
        return new Promise((resolve) => {
            const feedContent = this.elements.feedContent;
            feedContent.classList.remove('fade-in');
            feedContent.classList.add('fade-out');
            
            setTimeout(() => {
                feedContent.style.display = 'none';
                feedContent.classList.remove('fade-out');
                resolve();
            }, 300);
        });
    }

    showFeedContentWithFade() {
        return new Promise((resolve) => {
            const feedContent = this.elements.feedContent;
            // Restore original display (flex from CSS)
            feedContent.style.display = '';
            feedContent.classList.remove('fade-out');
            feedContent.classList.add('fade-in');
            
            setTimeout(() => {
                resolve();
            }, 50);
        });
    }

    showLoadingWithFade() {
        return new Promise((resolve) => {
            const loading = this.elements.loading;
            loading.style.display = 'flex';
            loading.classList.remove('fade-out');
            loading.classList.add('fade-in');
            
            // Диагностика слоев для определения проблемы с z-index
            // Используем небольшую задержку, чтобы DOM успел обновиться
            setTimeout(() => {
                resolve();
            }, 100);
        });
    }


    hideLoadingWithFade() {
        return new Promise((resolve) => {
            const loading = this.elements.loading;
            loading.classList.remove('fade-in');
            loading.classList.add('fade-out');
            
            setTimeout(() => {
                loading.style.display = 'none';
                loading.classList.remove('fade-out');
                resolve();
            }, 300);
        });
    }

    showMainContent() {
        this.elements.initialLoading.style.display = 'none';
        this.elements.mainContent.style.display = 'flex';
        this.showLoading(false);
    }

    showError(message) {
        const status = this.elements.errorMessage;
        if (!status) return;
        const text = status.querySelector('#popupStatusText');
        if (text) text.textContent = message;
        status.dataset.kind = 'error';
        status.setAttribute('role', 'alert');
        status.hidden = false;
        status.style.display = 'flex';
    }

    hideError() {
        if (!this.elements.errorMessage) return;
        this.elements.errorMessage.hidden = true;
        this.elements.errorMessage.style.display = 'none';
        const text = this.elements.errorMessage.querySelector('#popupStatusText');
        if (text) text.textContent = '';
    }

    compareVersions(v1, v2) {
        const parts1 = v1.split('.').map(Number);
        const parts2 = v2.split('.').map(Number);

        for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
            const p1 = parts1[i] || 0;
            const p2 = parts2[i] || 0;
            if (p1 > p2) return 1;
            if (p1 < p2) return -1;
        }
        return 0;
    }

    escapeHtml(text) {
        return Utils.escapeHtml(text);
    }

    truncateText(text, maxLength = 100) {
        return Utils.truncateText(text, maxLength);
    }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.popupManager = new PopupManager();
});
