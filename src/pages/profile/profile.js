import { i18n } from '../../shared/i18n/I18n.js';

// Movie metadata comes from shared Firestore documents that any approved user may
// edit, so image URLs are limited to the same schemes MovieCard.safeImageUrl allows.
function safeImageUrl(url) {
    const value = typeof url === 'string' ? url.trim() : '';
    if (/^(?:https?|chrome-extension):\/\//i.test(value)) return value;
    if (/^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(value)) return value;
    if (value.startsWith('/') && !value.startsWith('//')) return value;
    return '';
}

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Profile Page Manager
 * Handles the user profile page functionality
 */
class ProfilePageManager {
    static CACHE_KEY_PREFIX = 'profile_cache_';
    static CACHE_LIFETIME = 24 * 60 * 60 * 1000; // 24 hours
    // Index of cached profiles (uid -> timestamp) so old entries can be evicted and
    // sign-out can remove them without listing the whole storage area.
    static CACHE_INDEX_KEY = 'profile_cache_index';
    static MAX_CACHED_PROFILES = 20;
    // Only what the page renders (plus the own storage paths the editor needs);
    // e-mail, admin/approval flags and preferences are never written to disk.
    static CACHED_PROFILE_FIELDS = [
        'uid', 'firstName', 'lastName', 'displayName', 'username', 'bio', 'photoURL',
        'bannerURL', 'displayNameFormat', 'topGenres', 'socialLinks', 'stats'
    ];
    static OWN_CACHED_PROFILE_FIELDS = ['photoPath', 'bannerPath'];

    /** JSON-safe subset of a profile document for chrome.storage. */
    static toCachedProfile(profile, { isOwn = false } = {}) {
        const fields = isOwn
            ? [...ProfilePageManager.CACHED_PROFILE_FIELDS, ...ProfilePageManager.OWN_CACHED_PROFILE_FIELDS]
            : ProfilePageManager.CACHED_PROFILE_FIELDS;
        const cached = {};
        for (const field of fields) {
            if (profile?.[field] !== undefined) cached[field] = profile[field];
        }
        // A Firestore Timestamp is stored as {seconds, nanoseconds} and lost toDate(),
        // which rendered "Invalid Date"; keep the join date as an ISO string.
        const createdAt = ProfilePageManager.toDate(profile?.createdAt);
        if (createdAt) cached.createdAt = createdAt.toISOString();
        return cached;
    }

    /** Date from a Firestore Timestamp, a cached {seconds} object, a string or a number. */
    static toDate(value) {
        if (!value) return null;
        let date = null;
        if (typeof value.toDate === 'function') date = value.toDate();
        else if (typeof value === 'object' && Number.isFinite(value.seconds)) date = new Date(value.seconds * 1000);
        else if (typeof value === 'string' || typeof value === 'number') date = new Date(value);
        else if (value instanceof Date) date = value;
        return date && !Number.isNaN(date.getTime()) ? date : null;
    }

    async saveProfileCache(targetUserId, profile, stats) {
        try {
            if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
            const storage = chrome.storage.local;
            const cacheKey = `${ProfilePageManager.CACHE_KEY_PREFIX}${targetUserId}`;
            const isOwn = targetUserId === this.currentUser?.uid;
            const now = Date.now();

            const indexResult = await storage.get([ProfilePageManager.CACHE_INDEX_KEY]);
            const index = { ...(indexResult[ProfilePageManager.CACHE_INDEX_KEY] || {}), [targetUserId]: now };
            const ordered = Object.entries(index).sort((a, b) => b[1] - a[1]);
            const kept = ordered.slice(0, ProfilePageManager.MAX_CACHED_PROFILES);
            const evicted = ordered.slice(ProfilePageManager.MAX_CACHED_PROFILES)
                .map(([uid]) => `${ProfilePageManager.CACHE_KEY_PREFIX}${uid}`);

            await storage.set({
                [cacheKey]: {
                    profile: ProfilePageManager.toCachedProfile(profile, { isOwn }),
                    stats,
                    timestamp: now
                },
                [ProfilePageManager.CACHE_INDEX_KEY]: Object.fromEntries(kept)
            });
            if (evicted.length > 0) await storage.remove(evicted);
        } catch (cacheError) {
            console.warn('ProfilePage: Failed to save cache', cacheError);
        }
    }

    constructor() {
        this.currentUser = null;
        this.userProfile = null;
        this.profileService = null;
        this.userService = null;
        this.imageCacheService = window.imageCacheService;
        this.progressService = typeof ProgressService !== 'undefined' ? new ProgressService() : null;
        this.isLoading = false;
        this.photoFile = null;
        this.photoPreview = null;
        this.bannerFile = null;
        this.bannerPreview = null;
        
        // Infinite scroll state for recent ratings
        this.ratingsOffset = 0;
        this.ratingsLimit = 10;
        this.hasMoreRatings = true;
        this.isLoadingMoreRatings = false;
        this.ratingsObserver = null;
        this.ratingsUserId = null;

        this.viewingOtherUser = false;
        this.firebaseReady = false;
        this.profileLoadId = 0;
        this.modalReturnFocus = new Map();

        this.init();
    }

    async init() {
        this.initializeElements();
        this.setupEventListeners();
        
        // Try to load cached profile immediately for instant render
        await this.loadCachedProfile();

        await i18n.init();
        i18n.translatePage();
        this.translateExtras();
// The cached render ran before the locale loaded; repaint its dynamic text.
        if (this.userProfile) {
            this.displayProfile();
            if (this.userProfile.stats) this.displayStatistics(this.userProfile.stats);
        }

        await this.setupFirebase();
        await this.loadProfile();
    }

    /** Page language and the second localized attribute of elements whose data-i18n sets another. */
    translateExtras() {
        document.documentElement.lang = i18n.currentLocale || 'en';
        [
            [this.elements.removeBannerBtn, 'title', 'profile.edit_modal.remove_banner'],
            [this.elements.removePhotoBtn, 'title', 'profile.edit_modal.remove_photo'],
            [this.elements.cropperSelection, 'aria-label', 'profile.cropper.selection_label']
        ].forEach(([element, attribute, key]) => {
            if (element) element.setAttribute(attribute, i18n.get(key));
        });
    }

    async loadCachedProfile() {
        try {
            if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;

            // Determine target user ID without waiting for Auth
            const urlParams = new URLSearchParams(window.location.search);
            let targetUserId = urlParams.get('userId');

            // If no ID in URL, try to get current user from storage (stored by AuthManager)
            if (!targetUserId) {
                const result = await chrome.storage.local.get(['user']);
                if (result.user && result.user.uid) {
                    targetUserId = result.user.uid;
                }
            }

            if (!targetUserId) return;

            // Load profile cache
            const cacheKey = `${ProfilePageManager.CACHE_KEY_PREFIX}${targetUserId}`;
            const result = await chrome.storage.local.get([cacheKey]);
            const cache = result[cacheKey];

            if (cache && cache.profile) {
                // Check expiry
                if (Date.now() - (cache.timestamp || 0) < ProfilePageManager.CACHE_LIFETIME) {
                    console.log('ProfilePage: Using cached profile for', targetUserId);
                    this.userProfile = cache.profile;
                    
                    // Determine viewingOtherUser from stored auth state
                    const authResult = await chrome.storage.local.get(['user']);
                    this.viewingOtherUser = ProfilePageManager.isOtherUser(urlParams.get('userId'), authResult.user?.uid);

                    this.displayProfile();
                    if (cache.stats) {
                        this.displayStatistics(cache.stats);
                    }
                    
                    // Hide loading immediately if we have data
                    if (this.page) {
                        this.page.showContent();
                    }
                } else {
                    console.log('ProfilePage: Cache expired for', targetUserId);
                }
            }
        } catch (error) {
            console.error('ProfilePage: Error loading cache', error);
        }
        return false;
    }

    /** A `userId` URL parameter names another user unless it is the signed-in user's own ID. */
    static isOtherUser(profileUserId, currentUid) {
        return Boolean(profileUserId) && profileUserId !== currentUid;
    }

    static getProfileUserIdParam() {
        return new URLSearchParams(window.location.search).get('userId');
    }

    async loadExpiredCacheFallback(targetUserId) {
        try {
            if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
            const cacheKey = `${ProfilePageManager.CACHE_KEY_PREFIX}${targetUserId}`;
            const result = await chrome.storage.local.get([cacheKey]);
            const cache = result[cacheKey];

            if (cache && cache.profile) {
                console.log('ProfilePage: Using EXPIRED cache fallback due to connection error for', targetUserId);
                this.userProfile = cache.profile;
                this.displayProfile();
                if (cache.stats) {
                    this.displayStatistics(cache.stats);
                }
                if (this.page) {
                    this.page.showContent();
                }
                return true;
            }
        } catch (error) {
            console.error('ProfilePage: Error loading expired cache fallback', error);
        }
        return false;
    }

    initializeElements() {
        this.elements = {
            // Profile header
            profilePhoto: document.getElementById('profilePhoto'),
            profilePhotoImg: document.getElementById('profilePhotoImg'),
            profilePhotoPlaceholder: document.getElementById('profilePhotoPlaceholder'),
            profileInitials: document.getElementById('profileInitials'),
            profileName: document.getElementById('profileName'),
            profileUsername: document.getElementById('profileUsername'),
            profileBio: document.getElementById('profileBio'),
            profileJoinDate: document.getElementById('profileJoinDate'),
            joinDateText: document.getElementById('joinDateText'),
            profileTopGenres: document.getElementById('profileTopGenres'),
            topGenresContainer: document.getElementById('topGenresContainer'),
            profileMenu: document.getElementById('profileMenu'),
profileCover: document.querySelector('.profile-cover'),

            // Statistics
            statTotalRatings: document.getElementById('statTotalRatings'),
            statAverageRating: document.getElementById('statAverageRating'),
            statFavorites: document.getElementById('statFavorites'),
            statWatchlist: document.getElementById('statWatchlist'),

            statCards: Array.from(document.querySelectorAll('#profileStats .stat-card')),

            // Personal dashboard
            profileDashboard: document.getElementById('profileDashboard'),
            tasteTitle: document.getElementById('tasteTitle'),
            tasteSubtitle: document.getElementById('tasteSubtitle'),
            continueWatchingSection: document.getElementById('continueWatchingSection'),
            continueWatchingContent: document.getElementById('continueWatchingContent'),
            profileTasteGenres: document.getElementById('profileTasteGenres'),
            ratingDistribution: document.getElementById('ratingDistribution'),

            // Recent ratings
            recentRatingsList: document.getElementById('recentRatingsList'),
            recentRatingsSentinel: document.getElementById('recentRatingsSentinel'),
            recentRatingsLoader: document.getElementById('recentRatingsLoader'),
            viewAllRatingsBtn: document.getElementById('viewAllRatingsBtn'),

            // Loading and error states
            loadingSection: document.getElementById('loadingSection'),
            errorState: document.getElementById('errorState'),
            errorMessage: document.getElementById('errorMessage'),
            retryBtn: document.getElementById('retryBtn'),

            // Edit Profile Modal
            editProfileModal: document.getElementById('editProfileModal'),
            editProfileModalClose: document.getElementById('editProfileModalClose'),
            editProfileForm: document.getElementById('editProfileForm'),
            photoPreview: document.getElementById('photoPreview'),
            photoPreviewImg: document.getElementById('photoPreviewImg'),
            photoPlaceholder: document.getElementById('photoPlaceholder'),
            photoInitials: document.getElementById('photoInitials'),
            photoInput: document.getElementById('photoInput'),
            removePhotoBtn: document.getElementById('removePhotoBtn'),
            bannerPreview: document.getElementById('bannerPreview'),
            bannerPreviewImg: document.getElementById('bannerPreviewImg'),
            bannerPlaceholder: document.getElementById('bannerPlaceholder'),
            bannerInput: document.getElementById('bannerInput'),
            removeBannerBtn: document.getElementById('removeBannerBtn'),
            firstNameInput: document.getElementById('firstNameInput'),
            lastNameInput: document.getElementById('lastNameInput'),
            usernameInput: document.getElementById('usernameInput'),
            bioInput: document.getElementById('bioInput'),
            bioCharCount: document.getElementById('bioCharCount'),
            displayNameFormatInput: document.getElementById('displayNameFormatInput'),
passwordSection: document.getElementById('passwordSection'),
            togglePasswordBtn: document.getElementById('togglePasswordBtn'),
            passwordFields: document.getElementById('passwordFields'),
            currentPasswordInput: document.getElementById('currentPasswordInput'),
            newPasswordInput: document.getElementById('newPasswordInput'),
            confirmPasswordInput: document.getElementById('confirmPasswordInput'),
            cancelEditBtn: document.getElementById('cancelEditBtn'),
            saveProfileBtn: document.getElementById('saveProfileBtn'),
            saveBtnText: document.getElementById('saveBtnText'),
            saveBtnLoading: document.getElementById('saveBtnLoading'),
            profileToast: document.getElementById('profileToast'),

            // Cropper elements
            cropperModal: document.getElementById('cropperModal'),
            cropperModalClose: document.getElementById('cropperModalClose'),
            cropperTabs: document.getElementById('cropperTabs'),
            cropperTabAvatar: document.getElementById('cropperTabAvatar'),
            cropperTabBanner: document.getElementById('cropperTabBanner'),
            cropperImage: document.getElementById('cropperImage'),
            cropperSelection: document.getElementById('cropperSelection'),
            cropperCancelBtn: document.getElementById('cropperCancelBtn'),
            cropperApplyBtn: document.getElementById('cropperApplyBtn'),
            cropperContainer: document.getElementById('cropperContainer'),

            // Error messages
            firstNameError: document.getElementById('firstNameError'),
            lastNameError: document.getElementById('lastNameError'),
            usernameError: document.getElementById('usernameError'),
            bioError: document.getElementById('bioError'),
            passwordError: document.getElementById('passwordError')
        };

        // UI State Manager
        this.page = Utils.createPageStateManager({
            loader: this.elements.loadingSection,
            errorScreen: this.elements.errorState,
            errorMessage: this.elements.errorMessage,
            contentContainer: document.getElementById('profileContent')
        });
    }

    setupEventListeners() {
        // Use centralized menu delegation
        Utils.bindTabsAndMenus(document);
        
        // Image fallbacks (inline onerror is blocked by the extension CSP)
        document.addEventListener('error', (e) => {
            if (e.target && e.target === this.elements.profilePhotoImg) {
                this.handleAvatarLoadError();
                return;
            }
            if (e.target && e.target.tagName === 'IMG' && e.target.closest('.recent-rating-card .poster, .continue-watching-item .poster')) {
                const posterContainer = e.target.parentElement;
                if (posterContainer) {
                    const placeholderSvg = (typeof Icons !== 'undefined' && Icons.MOVIE_CLAPPER) ? Icons.MOVIE_CLAPPER : '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line></svg>';
                    posterContainer.innerHTML = `<div class="poster-placeholder">${placeholderSvg}</div>`;
                }
            }
        }, true);
        
        // Buttons react to `click` (not `mousedown`) so Enter and Space work as well.
        const onClick = (element, handler) => {
            if (element) element.addEventListener('click', handler);
        };

onClick(document.getElementById('headerEditBtn'), () => this.openEditModal());


        onClick(this.elements.viewAllRatingsBtn, () => {
            if (window.navigation) {
                window.navigation.navigateToPage('ratings');
            } else {
                window.location.href = chrome.runtime.getURL('src/pages/ratings/ratings.html');
            }
        });
        onClick(this.elements.retryBtn, () => this.loadProfile());
        onClick(this.elements.editProfileModalClose, () => this.closeEditModal());
        onClick(this.elements.cancelEditBtn, () => this.closeEditModal());

        // Backdrop dismissal stays on mousedown: a text selection that ends on the
        // backdrop must not close the dialog.
        if (this.elements.editProfileModal) {
            this.elements.editProfileModal.addEventListener('mousedown', (e) => {
                if (e.target === this.elements.editProfileModal) {
                    this.closeEditModal();
                }
            });
        }

        if (this.elements.photoInput) {
            this.elements.photoInput.addEventListener('change', (e) => this.handlePhotoChange(e));
        }
        onClick(this.elements.removePhotoBtn, () => this.handleRemovePhoto());

        if (this.elements.bannerInput) {
            this.elements.bannerInput.addEventListener('change', (e) => this.handleBannerChange(e));
        }
        onClick(this.elements.removeBannerBtn, () => this.handleRemoveBanner());

        if (this.elements.bioInput) {
            this.elements.bioInput.addEventListener('input', () => this.updateBioCharCount());
        }

        onClick(this.elements.togglePasswordBtn, () => this.togglePasswordFields());

        if (this.elements.editProfileForm) {
            this.elements.editProfileForm.addEventListener('submit', (e) => this.handleFormSubmit(e));
        }

        // Cropper Event Listeners
        onClick(this.elements.cropperModalClose, () => this.closeCropper());
        onClick(this.elements.cropperCancelBtn, () => this.closeCropper());
        onClick(this.elements.cropperApplyBtn, () => this.applyCrop());
        onClick(this.elements.cropperTabAvatar, () => this.setCropperMode('avatar'));
        onClick(this.elements.cropperTabBanner, () => this.setCropperMode('banner'));
        this.setupCropperDragAndDrop();

        document.addEventListener('keydown', (e) => this.handleModalKeydown(e));
    }

    // --- MODAL FOCUS ---
    isModalOpen(modal) {
        return Boolean(modal) && modal.style.display !== 'none';
    }

    /** The cropper opens on top of the edit dialog, so it owns the keyboard while visible. */
    getTopModal() {
        if (this.isModalOpen(this.elements.cropperModal)) return this.elements.cropperModal;
        if (this.isModalOpen(this.elements.editProfileModal)) return this.elements.editProfileModal;
        return null;
    }

    showModal(modal, initialFocus) {
        if (!modal) return;
        if (!this.isModalOpen(modal)) {
            this.modalReturnFocus.set(modal, document.activeElement);
        }
        modal.style.display = 'flex';
        const target = initialFocus || modal.querySelector(FOCUSABLE_SELECTOR);
        if (target && typeof target.focus === 'function') target.focus();
    }

    hideModal(modal) {
        if (!modal) return;
        modal.style.display = 'none';
        const returnFocus = this.modalReturnFocus.get(modal);
        this.modalReturnFocus.delete(modal);
        if (returnFocus && returnFocus.isConnected && typeof returnFocus.focus === 'function') {
            returnFocus.focus();
        }
    }

    handleModalKeydown(e) {
        const modal = this.getTopModal();
        if (!modal) return;

        if (e.key === 'Escape') {
            e.preventDefault();
            if (modal === this.elements.cropperModal) {
                this.closeCropper();
            } else {
                this.closeEditModal();
            }
            return;
        }

        if (e.key !== 'Tab') return;
        const focusable = Array.from(modal.querySelectorAll(FOCUSABLE_SELECTOR))
            .filter(el => el.getClientRects().length > 0 || el.classList.contains('profile-file-input'));
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!modal.contains(document.activeElement)) {
            e.preventDefault();
            first.focus();
        } else if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }

    async setupFirebase() {
        if (typeof firebaseManager === 'undefined') {
            await new Promise((resolve) => {
                const checkFirebase = setInterval(() => {
                    if (typeof firebaseManager !== 'undefined' && firebaseManager.isInitialized) {
                        clearInterval(checkFirebase);
                        resolve();
                    }
                }, 100);
            });
        }

        firebaseManager.initializeServices();
        this.userService = firebaseManager.getUserService();
        this.profileService = new ProfileService(firebaseManager);

        // Subscribe before waiting: a sign-in restored after the wait below (or in
        // another tab) must still load the profile instead of leaving the sign-in error.
        window.addEventListener('authStateChanged', (e) => {
            this.handleAuthStateChanged(e.detail?.user || null);
        });

        if (firebaseManager.waitForAuthReady) {
            // A stored session means Firebase is restoring a sign-in; give it longer
            // than the default 1 s before treating the visitor as signed out.
            const storedUid = await this.getStoredUserId();
            await firebaseManager.waitForAuthReady(storedUid ? 5000 : 1000);
        }

        this.currentUser = firebaseManager.getCurrentUser();
        this.firebaseReady = true;
    }

    async getStoredUserId() {
        try {
            if (typeof chrome === 'undefined' || !chrome.storage?.local) return null;
            const result = await chrome.storage.local.get(['user']);
            return result.user?.uid || null;
        } catch {
            return null;
        }
    }

    async handleAuthStateChanged(user) {
        // Until setup finishes, setupFirebase() reads the settled user itself.
        if (!this.firebaseReady) return;

        const previousUid = this.currentUser?.uid || null;
        const nextUid = user?.uid || null;
        if (previousUid === nextUid) return;

        this.currentUser = user;
        if (!user) {
            this.showSignInRequired();
            return;
        }
        await this.loadProfile();
    }

    showSignInRequired() {
        this.profileLoadId++;
        this.userProfile = null;
        this.closeCropper();
        this.closeEditModal();
        this.page.showError(i18n.get('profile.sign_in_required'));
    }

    async loadProfile() {
        // Profiles are readable only by signed-in users (Firestore rules), so another
        // user's profile needs a sign-in as well.
        if (!this.currentUser) {
            this.showSignInRequired();
            return;
        }
        if (!this.userService || !this.profileService) return;

        const profileUserId = ProfilePageManager.getProfileUserIdParam();
        const targetUserId = profileUserId || this.currentUser.uid;
        const loadId = ++this.profileLoadId;

        // Only show loading screen if we don't have this user's profile on screen yet
        if (!this.userProfile || this.userProfile.uid !== targetUserId) {
            this.page.showLoader();
        }
        
        this.viewingOtherUser = ProfilePageManager.isOtherUser(profileUserId, this.currentUser.uid);

        try {
            // Read failures must throw: swallowed errors turned a lost connection into
            // "Profile not found" and zero counters that were then cached for 24 hours.
            // An explicit (re)load reads fresh ratings; statistics and the recent
            // ratings pages then share that single read.
            this.profileService.invalidateUserRatings?.(targetUserId);
            const [profile, stats] = await Promise.all([
                this.userService.getUserProfileWithStats(targetUserId, { throwOnError: true }),
                this.profileService.getUserStatistics(targetUserId, { throwOnError: true })
            ]);
            if (loadId !== this.profileLoadId) return;

            if (!profile) {
                this.page.showError(i18n.get('profile.not_found'));
                return;
            }

            this.userProfile = { ...profile, stats, uid: targetUserId };
            this.displayProfile();
            this.displayStatistics(stats);
            this.page.showContent();

            await Promise.allSettled([
                this.loadRecentRatings(targetUserId),
                this.viewingOtherUser ? Promise.resolve() : this.loadPersonalDashboard(targetUserId)
            ]);
            if (loadId !== this.profileLoadId) return;

            await this.saveProfileCache(targetUserId, this.userProfile, stats);
        } catch (error) {
            if (loadId !== this.profileLoadId) return;
            console.error('Error loading profile:', error);
            
            // Try to load even expired cache if we are having connection issues
            const hasFallback = await this.loadExpiredCacheFallback(targetUserId);
            if (loadId !== this.profileLoadId) return;

            if (hasFallback) {
                Utils.showToast(i18n.get('profile.offline_cache'), 'info');
                // Replaces the list spinner with the failure message and its retry button.
                this.loadRecentRatings(targetUserId);
            } else {
                this.page.showError(i18n.get('profile.load_failed'));
            }
        }
    }

    displayProfile() {
        if (!this.userProfile) return;

        const profile = this.userProfile;
        const firstName = profile.firstName || '';
        const lastName = profile.lastName || '';
        const fullName = [firstName, lastName].filter(Boolean).join(' ') || profile.displayName || 'User';
        // Fallback for username if userService is not ready
        const username = profile.username || (this.userService ? this.userService.generateUsernameFromEmail(profile.email) : profile.email?.split('@')[0] || 'user');
        const photoURL = profile.photoURL || '';
        const displayNameFormat = profile.displayNameFormat || 'fullname';
        const isUsernameFirst = displayNameFormat === 'username';

        if (this.elements.profileName) {
            if (isUsernameFirst) {
                this.elements.profileName.textContent = username;
            } else {
                this.elements.profileName.textContent = fullName;
            }
        }

        if (this.elements.profileUsername) {
            if (isUsernameFirst) {
                this.elements.profileUsername.textContent = fullName;
            } else {
                this.elements.profileUsername.textContent = username ? `@${username.replace(/^@/, '')}` : '';
            }
        }

        if (this.elements.profileBio) {
            if (profile.bio) {
                this.elements.profileBio.textContent = profile.bio;
                this.elements.profileBio.style.display = 'block';
            } else {
                this.elements.profileBio.style.display = 'none';
            }
        }

        if (photoURL) {
            // Check if imageCacheService is ready
            if (this.imageCacheService && typeof this.imageCacheService.getCachedImage === 'function') {
                // Try to get from cache first, passing photoURL to check if the URL has changed
                this.imageCacheService.getCachedImage(profile.uid || this.currentUser?.uid, 'avatar', photoURL).then(cachedAvatar => {
                    if (cachedAvatar) {
                        if (this.elements.profilePhotoImg) {
                            this.elements.profilePhotoImg.src = cachedAvatar;
                            this.elements.profilePhotoImg.style.display = 'block';
                        }
                        if (this.elements.profilePhotoPlaceholder) {
                            this.elements.profilePhotoPlaceholder.style.display = 'none';
                        }
                    } else {
                        // Fallback to URL and cache it
                        if (this.elements.profilePhotoImg) {
                            this.elements.profilePhotoImg.src = photoURL;
                            this.elements.profilePhotoImg.style.display = 'block';
                        }
                        if (this.elements.profilePhotoPlaceholder) {
                            this.elements.profilePhotoPlaceholder.style.display = 'none';
                        }
                        this.imageCacheService.fetchAndCache(profile.uid || this.currentUser?.uid, 'avatar', photoURL);
                    }
                }).catch(err => {
                    console.warn('ProfilePage: Avatar cache error, falling back to URL', err);
                    if (this.elements.profilePhotoImg) {
                        this.elements.profilePhotoImg.src = photoURL;
                        this.elements.profilePhotoImg.style.display = 'block';
                    }
                    if (this.elements.profilePhotoPlaceholder) {
                        this.elements.profilePhotoPlaceholder.style.display = 'none';
                    }
                });
            } else {
                // imageCacheService not ready, use URL directly
                if (this.elements.profilePhotoImg) {
                    this.elements.profilePhotoImg.src = photoURL;
                    this.elements.profilePhotoImg.style.display = 'block';
                }
                if (this.elements.profilePhotoPlaceholder) {
                    this.elements.profilePhotoPlaceholder.style.display = 'none';
                }
            }
        } else {
            if (this.elements.profilePhotoImg) {
                this.elements.profilePhotoImg.style.display = 'none';
            }
            if (this.elements.profilePhotoPlaceholder && this.elements.profileInitials) {
                this.elements.profileInitials.textContent = 
                    (firstName[0] || '').toUpperCase() + (lastName[0] || '').toUpperCase() || 'U';
                this.elements.profilePhotoPlaceholder.style.display = 'flex';
            }
        }

        if (this.elements.profileJoinDate && profile.createdAt) {
            // Check if profileService is ready for date formatting
            const createdDate = ProfilePageManager.toDate(profile.createdAt);
            const joinDate = createdDate
                ? createdDate.toLocaleDateString(i18n.currentLocale === 'ru' ? 'ru-RU' : 'en-US', { month: 'long', year: 'numeric' })
                : '';
            if (joinDate) {
                this.elements.joinDateText.textContent = `${i18n.get('profile.joined')} ${joinDate}`;
                this.elements.profileJoinDate.style.display = 'flex';
            } else {
                this.elements.profileJoinDate.style.display = 'none';
            }
        } else if (this.elements.profileJoinDate) {
            this.elements.profileJoinDate.style.display = 'none';
        }

        if (this.elements.profileTopGenres && this.elements.topGenresContainer) {
            const topGenres = Array.isArray(profile.topGenres) ? profile.topGenres : [];
            if (topGenres.length > 0) {
                this.elements.topGenresContainer.innerHTML = topGenres
                    .map(genre => `<span class="profile-genre-badge">${Utils.escapeHtml(genre)}</span>`)
                    .join('');
                this.elements.profileTopGenres.style.display = 'flex';
            } else {
                this.elements.profileTopGenres.style.display = 'none';
            }
        }

        this.applyViewerMode(isUsernameFirst ? username : fullName);

        if (this.elements.profileCover) {
            if (profile.bannerURL) {
                // Check if imageCacheService is ready
                if (this.imageCacheService && typeof this.imageCacheService.getCachedImage === 'function') {
                    // Try to get from cache first, passing bannerURL to check if the URL has changed
                    this.imageCacheService.getCachedImage(profile.uid || this.currentUser?.uid, 'banner', profile.bannerURL).then(cachedBanner => {
                        if (cachedBanner) {
                            this.elements.profileCover.style.backgroundImage = `url('${cachedBanner}')`;
                            this.elements.profileCover.classList.add('has-banner');
                        } else {
                            // Fallback to URL and cache it
                            this.elements.profileCover.style.backgroundImage = `url('${profile.bannerURL}')`;
                            this.elements.profileCover.classList.add('has-banner');
                            this.imageCacheService.fetchAndCache(profile.uid || this.currentUser?.uid, 'banner', profile.bannerURL);
                        }
                    }).catch(err => {
                        console.warn('ProfilePage: Banner cache error, falling back to URL', err);
                        this.elements.profileCover.style.backgroundImage = `url('${profile.bannerURL}')`;
                        this.elements.profileCover.classList.add('has-banner');
                    });
                } else {
                    // imageCacheService not ready, use URL directly
                    this.elements.profileCover.style.backgroundImage = `url('${profile.bannerURL}')`;
                    this.elements.profileCover.classList.add('has-banner');
                }
            } else {
                this.elements.profileCover.style.backgroundImage = '';
                this.elements.profileCover.classList.remove('has-banner');
            }
        }
    }

    /**
     * Own profile and another user's profile share the markup; everything addressed
     * to the viewer (edit action, continue watching, links to the viewer's own
     * lists, "my taste" copy) is switched here for both cached and network renders.
     */
    applyViewerMode(displayName = '') {
        const isOther = Boolean(this.viewingOtherUser);

        if (this.elements.profileMenu) {
            this.elements.profileMenu.style.display = isOther ? 'none' : 'flex';
        }

        this.elements.continueWatchingSection?.toggleAttribute('hidden', isOther);
        this.elements.profileDashboard?.classList.toggle('profile-dashboard--single', isOther);

        const tasteKeys = isOther
            ? ['profile.taste.title_other', 'profile.taste.subtitle_other']
            : ['profile.taste.title', 'profile.taste.subtitle'];
        [this.elements.tasteTitle, this.elements.tasteSubtitle].forEach((element, index) => {
            if (!element) return;
            // translatePage() re-reads data-i18n, so the key has to change too.
            element.setAttribute('data-i18n', tasteKeys[index]);
            element.textContent = i18n.get(tasteKeys[index]);
        });

        // Ratings and Bookmarks only show the signed-in user's own data, so another
        // user's counters are not links there.
        this.elements.statCards.forEach(card => {
            if (isOther) {
                if (card.hasAttribute('href')) {
                    card.dataset.href = card.getAttribute('href');
                    card.removeAttribute('href');
                }
                card.classList.replace('stat-card--link', 'stat-card--static');
            } else {
                if (!card.hasAttribute('href') && card.dataset.href) {
                    card.setAttribute('href', card.dataset.href);
                }
                card.classList.replace('stat-card--static', 'stat-card--link');
            }
        });

        if (this.elements.viewAllRatingsBtn) {
            this.elements.viewAllRatingsBtn.style.display = isOther ? 'none' : '';
        }

        document.title = isOther && displayName
            ? i18n.get('profile.page_title_other').replace('{name}', displayName)
            : i18n.get('profile.page_title');
    }

    /**
     * A broken avatar URL (deleted file, expired Google photo, bad cache entry) falls
     * back to the initials instead of a broken-image icon.
     */
    handleAvatarLoadError() {
        const img = this.elements.profilePhotoImg;
        if (!img || !img.getAttribute('src')) return;
        img.removeAttribute('src');
        img.style.display = 'none';
        const profile = this.userProfile || {};
        if (this.elements.profileInitials) {
            this.elements.profileInitials.textContent =
                ((profile.firstName || '')[0] || '').toUpperCase() + ((profile.lastName || '')[0] || '').toUpperCase() || 'U';
        }
        if (this.elements.profilePhotoPlaceholder) {
            this.elements.profilePhotoPlaceholder.style.display = 'flex';
        }
        const uid = profile.uid || this.currentUser?.uid;
        if (uid && this.imageCacheService?.invalidateCache) {
            this.imageCacheService.invalidateCache(uid, 'avatar');
        }
    }

    displayStatistics(stats) {
        if (!stats) return;

        if (this.elements.statTotalRatings) {
            this.elements.statTotalRatings.textContent = stats.totalRatings || 0;
        }
        if (this.elements.statAverageRating) {
            this.elements.statAverageRating.textContent = parseFloat((stats.averageRating || 0).toFixed(1));
        }
        if (this.elements.statFavorites) {
            this.elements.statFavorites.textContent = stats.favoritesCount || 0;
        }
        if (this.elements.statWatchlist) {
            this.elements.statWatchlist.textContent = stats.watchlistCount || 0;
        }

        this.renderTasteProfile(stats);
    }

    async loadPersonalDashboard(userId) {
        const section = this.elements.continueWatchingSection;
        if (this.viewingOtherUser) {
            section?.setAttribute('hidden', '');
            return;
        }
        section?.removeAttribute('hidden');
        if (!userId || !this.profileService) return;

        try {
            const watching = this.profileService.favoriteService
                ? await this.profileService.favoriteService.getFavorites(userId, 'watching', 'updatedAt', 'desc')
                : [];
            const progress = this.progressService ? await this.progressService.getAllProgress() : {};
            this.renderContinueWatching(watching, progress);
        } catch (error) {
            console.warn('ProfilePage: Could not load personal dashboard:', error);
            this.renderContinueWatching([], {});
        }
    }

    renderContinueWatching(watchingItems = [], progressMap = {}) {
        const container = this.elements.continueWatchingContent;
        if (!container) return;

        const items = (Array.isArray(watchingItems) ? watchingItems : [])
            .map(item => {
                const movieId = item.movieId || item.id;
                const progress = progressMap[String(movieId)] || null;
                return { ...item, movieId, progress };
            })
            .filter(item => item.movieId)
            .sort((a, b) => {
                const aUpdated = Number(a.progress?.updatedAt || 0);
                const bUpdated = Number(b.progress?.updatedAt || 0);
                return bUpdated - aUpdated;
            })
            .slice(0, 3);

        if (items.length === 0) {
            container.innerHTML = `
                <div class="dashboard-empty-state">
                    <span class="dashboard-empty-state__mark">+</span>
                    <div>
                        <strong>${Utils.escapeHtml(i18n.get('profile.continue_watching.empty_title'))}</strong>
                        <span>${Utils.escapeHtml(i18n.get('profile.continue_watching.empty_text'))}</span>
                    </div>
                </div>`;
            return;
        }

        container.innerHTML = `<div class="continue-watching-items">${items.map(item => this.createContinueWatchingHTML(item)).join('')}</div>`;
    }

    /**
     * Viewing progress as stored, without invented values: null when nothing has
     * been played or the duration is unknown, 100 when the provider confirmed
     * completion, otherwise the real share (at least 1% once playback started).
     */
    static getProgressPercent(progress = {}) {
        if (progress.completed) return 100;
        const duration = Number(progress.duration || 0);
        const timestamp = Number(progress.timestamp || 0);
        if (!(duration > 0) || !(timestamp > 0)) return null;
        return Math.min(100, Math.max(1, Math.round((timestamp / duration) * 100)));
    }

    /** Season/episode label in the interface language (ProgressService labels are Russian-only). */
    static getEpisodeLabel(progress = {}) {
        const parts = [];
        if (Number.isFinite(progress.season)) {
            parts.push(i18n.get('profile.continue_watching.season').replace('{n}', progress.season));
        } else if (progress.seasonLabel) {
            parts.push(String(progress.seasonLabel));
        }
        if (Number.isFinite(progress.episode)) {
            parts.push(i18n.get('profile.continue_watching.episode').replace('{n}', progress.episode));
        } else if (progress.episodeLabel) {
            parts.push(String(progress.episodeLabel));
        }
        return parts.join(' · ');
    }

    createContinueWatchingHTML(item) {
        const movieId = encodeURIComponent(item.movieId);
        const title = item.movieTitleRu || item.movieTitle || item.name || i18n.get('profile.unknown_title');
        const posterUrl = safeImageUrl(item.posterPath || item.posterUrl || '');
        const progress = item.progress || {};
        const percent = ProfilePageManager.getProgressPercent(progress);
        const episodeLabel = ProfilePageManager.getEpisodeLabel(progress);
        const metaParts = [episodeLabel];
        if (progress.completed) metaParts.push(i18n.get('profile.continue_watching.completed'));
        const meta = metaParts.filter(Boolean).join(' · ') || i18n.get('profile.continue_watching.start_here');
        const safeTitle = Utils.escapeHtml(title);
        const safePoster = Utils.escapeHtml(posterUrl);
        const moviePlaceholder = (typeof Icons !== 'undefined' && Icons.MOVIE_CLAPPER) ? Icons.MOVIE_CLAPPER : '';
        const poster = safePoster
            ? `<img src="${safePoster}" alt="${safeTitle}" loading="lazy" decoding="async">`
            : `<div class="poster-placeholder">${moviePlaceholder}</div>`;
        const progressLabel = Utils.escapeHtml(i18n.get('profile.continue_watching.progress'));
        const progressMarkup = percent === null
            ? ''
            : `<div class="continue-watching-progress" role="progressbar" aria-label="${progressLabel}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><span style="width: ${percent}%"></span></div>
                    <span class="continue-watching-percent" aria-hidden="true">${percent}%</span>`;

        return `
            <a class="continue-watching-item" href="${Utils.escapeHtml(chrome.runtime.getURL(`src/pages/movie-details/movie-details.html?movieId=${movieId}`))}" data-movie-id="${Utils.escapeHtml(movieId)}">
                <div class="poster">${poster}</div>
                <div class="continue-watching-info">
                    <span class="continue-watching-eyebrow">${Utils.escapeHtml(i18n.get('profile.continue_watching.eyebrow'))}</span>
                    <h3 class="continue-watching-title">${safeTitle}</h3>
                    <p class="continue-watching-meta">${Utils.escapeHtml(meta)}</p>
                    ${progressMarkup}
                </div>
                <span class="continue-watching-action" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                </span>
            </a>`;
    }

    renderTasteProfile(stats = {}) {
        const genresContainer = this.elements.profileTasteGenres;
        const topGenres = Array.isArray(this.userProfile?.topGenres) ? this.userProfile.topGenres : [];

        if (genresContainer) {
            genresContainer.innerHTML = topGenres.length > 0
                ? topGenres.slice(0, 4).map(genre => `<span class="taste-genre-chip">${Utils.escapeHtml(genre)}</span>`).join('')
                : `<span class="taste-empty">${Utils.escapeHtml(i18n.get(this.viewingOtherUser ? 'profile.taste.empty_other' : 'profile.taste.empty'))}</span>`;
        }

        this.renderRatingDistribution(stats.ratingDistribution || []);
    }

    renderRatingDistribution(distribution = []) {
        const container = this.elements.ratingDistribution;
        if (!container) return;

        const values = Array.isArray(distribution) ? distribution : [];
        const maxCount = Math.max(...values.map(item => Number(item.count || 0)), 0);
        if (maxCount === 0) {
            const emptyKey = this.viewingOtherUser ? 'profile.taste.distribution_empty_other' : 'profile.taste.distribution_empty';
            container.innerHTML = `<span class="taste-empty">${Utils.escapeHtml(i18n.get(emptyKey))}</span>`;
            return;
        }

        container.innerHTML = values.slice().reverse().map(item => {
            const rating = Number(item.rating || 0);
            const count = Number(item.count || 0);
            const width = count > 0 ? Math.max(8, Math.round((count / maxCount) * 100)) : 0;
            return `
                <div class="rating-distribution__row">
                    <span>${rating}</span>
                    <div class="rating-distribution__bar"><span style="width: ${width}%"></span></div>
                    <span class="rating-distribution__count">${count}</span>
                </div>`;
        }).join('');
    }

    async loadRecentRatings(userId = null) {
        const targetUserId = userId || (this.currentUser ? this.currentUser.uid : null);
        if (!targetUserId) return;

        this.ratingsUserId = targetUserId;
        this.ratingsOffset = 0;
        this.ratingsLimit = 10;
        this.hasMoreRatings = true;
        this.isLoadingMoreRatings = false;

        try {
            const ratings = await this.profileService.getRecentRatings(targetUserId, this.ratingsLimit, 0, { throwOnError: true });
            if (this.ratingsUserId !== targetUserId) return;
            this.displayRecentRatings(ratings);
            this.ratingsOffset = ratings.length;
            if (ratings.length < this.ratingsLimit) {
                this.hasMoreRatings = false;
            } else {
                this.setupRatingsInfiniteScroll();
            }
        } catch (error) {
            if (this.ratingsUserId !== targetUserId) return;
            console.error('Error loading recent ratings:', error);
            this.hasMoreRatings = false;
            this.renderRecentRatingsError(() => this.loadRecentRatings(targetUserId));
        }
    }

    /** Replaces the list with a failure message and a retry button. */
    renderRecentRatingsError(onRetry) {
        const list = this.elements.recentRatingsList;
        if (!list) return;
        list.innerHTML = `
            <div class="recent-ratings-error" role="alert">
                <span>${Utils.escapeHtml(i18n.get('profile.recent_ratings_failed'))}</span>
                <button type="button" class="btn-view-all recent-ratings-retry">${Utils.escapeHtml(i18n.get('profile.try_again'))}</button>
            </div>`;
        list.querySelector('.recent-ratings-retry')?.addEventListener('click', () => {
            list.innerHTML = `
                <div class="app-loader app-loader--inline app-loader--compact" role="status">
                    <div class="app-loader__indicator" aria-hidden="true"></div>
                </div>`;
            onRetry();
        });
    }

    setupRatingsInfiniteScroll() {
        if (this.ratingsObserver) {
            this.ratingsObserver.disconnect();
        }

        const sentinel = this.elements.recentRatingsSentinel || document.getElementById('recentRatingsSentinel');
        if (sentinel && 'IntersectionObserver' in window) {
            this.ratingsObserver = new IntersectionObserver((entries) => {
                if (entries[0].isIntersecting && this.hasMoreRatings && !this.isLoadingMoreRatings) {
                    this.loadMoreRecentRatings();
                }
            }, {
                rootMargin: '250px'
            });
            this.ratingsObserver.observe(sentinel);
        }

        if (!this.ratingsScrollHandler) {
            this.ratingsScrollHandler = () => {
                if (this.hasMoreRatings && !this.isLoadingMoreRatings) {
                    const scrollPosition = window.innerHeight + window.scrollY;
                    const threshold = document.body.offsetHeight - 500;
                    if (scrollPosition >= threshold) {
                        this.loadMoreRecentRatings();
                    }
                }
            };
            window.addEventListener('scroll', this.ratingsScrollHandler, { passive: true });
        }
    }

    async loadMoreRecentRatings() {
        if (!this.ratingsUserId || !this.hasMoreRatings || this.isLoadingMoreRatings) return;

        this.isLoadingMoreRatings = true;
        if (this.elements.recentRatingsLoader) {
            this.elements.recentRatingsLoader.style.display = 'block';
        }

        try {
            const requestedUserId = this.ratingsUserId;
            const newRatings = await this.profileService.getRecentRatings(requestedUserId, this.ratingsLimit, this.ratingsOffset, { throwOnError: true });
            if (this.ratingsUserId !== requestedUserId) return;
            if (newRatings.length < this.ratingsLimit) {
                this.hasMoreRatings = false;
            }

            if (newRatings.length > 0) {
                this.ratingsOffset += newRatings.length;
                this.appendRecentRatings(newRatings);
            }
        } catch (error) {
            // hasMoreRatings stays true, so the next scroll retries this page.
            console.error('Error loading more recent ratings:', error);
        } finally {
            this.isLoadingMoreRatings = false;
            if (this.elements.recentRatingsLoader) {
                this.elements.recentRatingsLoader.style.display = 'none';
            }
        }
    }

    createRatingCardHTML(rating, ratedPrefix) {
        // Title, genres and poster come from shared movie documents that any approved
        // user can edit: every value is escaped and the poster URL scheme is checked.
        const movie = rating.movie || {};
        const movieId = rating.movieId ?? '';
        const movieTitle = movie.name || movie.alternativeName || i18n.get('profile.unknown_title');
        const movieYear = movie.year ? ` (${movie.year})` : '';
        const posterUrl = safeImageUrl(movie.posterUrl);
        const genres = (Array.isArray(movie.genres) ? movie.genres : []).map(g => g?.name || g).filter(Boolean).join(', ') || i18n.get('profile.ui.unknown_genres');
        const ratingDate = this.profileService.formatDate(rating.createdAt);
        const href = chrome.runtime.getURL(`src/pages/movie-details/movie-details.html?movieId=${encodeURIComponent(movieId)}`);
        const placeholderSvg = (typeof Icons !== 'undefined' && Icons.MOVIE_CLAPPER) ? Icons.MOVIE_CLAPPER : '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line></svg>';
        const safeTitle = Utils.escapeHtml(movieTitle);

        return `
            <a href="${Utils.escapeHtml(href)}" class="recent-rating-card" data-movie-id="${Utils.escapeHtml(movieId)}">
                <div class="poster">
                    ${posterUrl 
                        ? `<img src="${Utils.escapeHtml(posterUrl)}" alt="${safeTitle}" loading="lazy" decoding="async">`
                        : `<div class="poster-placeholder">${placeholderSvg}</div>`
                    }
                </div>
                <div class="info">
                    <div class="title">${safeTitle}${Utils.escapeHtml(movieYear)}</div>
                    <div class="genres">${Utils.escapeHtml(genres)}</div>
                    <div class="date">${Utils.escapeHtml(ratedPrefix)}${Utils.escapeHtml(ratingDate)}</div>
                </div>
                <div class="rating">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                    <span>${Utils.escapeHtml(rating.rating)}</span>
                </div>
            </a>
        `;
    }

    displayRecentRatings(ratings) {
        if (!this.elements.recentRatingsList) return;

        if (ratings.length === 0) {
            const emptyText = i18n.get(this.viewingOtherUser ? 'profile.ui.ratings_empty_other' : 'profile.ui.ratings_empty');
            this.elements.recentRatingsList.innerHTML = `<p class="recent-ratings-empty">${Utils.escapeHtml(emptyText)}</p>`;
            return;
        }

        const ratedPrefix = i18n.get('profile.ui.rated_prefix');
        
        // Deduplicate ratings array by movieId
        const uniqueRatings = [];
        const seenMovieIds = new Set();
        for (const rating of ratings) {
            const movieId = String(rating.movieId || rating.id);
            if (!seenMovieIds.has(movieId)) {
                seenMovieIds.add(movieId);
                uniqueRatings.push(rating);
            }
        }

        const ratingsHTML = uniqueRatings.map(rating => this.createRatingCardHTML(rating, ratedPrefix)).join('');
        this.elements.recentRatingsList.innerHTML = ratingsHTML;
    }

    appendRecentRatings(ratings) {
        if (!this.elements.recentRatingsList || ratings.length === 0) return;

        const ratedPrefix = i18n.get('profile.ui.rated_prefix');
        const existingMovieIds = new Set(
            Array.from(this.elements.recentRatingsList.querySelectorAll('.recent-rating-card'))
                .map(el => el.getAttribute('data-movie-id'))
                .filter(Boolean)
        );

        const newUniqueRatings = [];
        for (const rating of ratings) {
            const movieId = String(rating.movieId || rating.id);
            if (!existingMovieIds.has(movieId)) {
                existingMovieIds.add(movieId);
                newUniqueRatings.push(rating);
            }
        }

        if (newUniqueRatings.length === 0) return;

        const tempContainer = document.createElement('div');
        tempContainer.innerHTML = newUniqueRatings.map(rating => this.createRatingCardHTML(rating, ratedPrefix)).join('');

        const fragment = document.createDocumentFragment();
        const newCards = Array.from(tempContainer.children);
        newCards.forEach(card => fragment.appendChild(card));

        this.elements.recentRatingsList.appendChild(fragment);
    }

    openEditModal() {
        if (!this.userProfile) return;
        
        if (this.viewingOtherUser) {
            return;
        }

        this.populateEditForm();

        const isGoogle = this.currentUser && 
            Array.isArray(this.currentUser.providerData) && 
            this.currentUser.providerData.some(p => p.providerId === 'google.com');

        if (this.elements.passwordSection) {
            this.elements.passwordSection.style.display = isGoogle ? 'none' : 'block';
        }

        this.showModal(this.elements.editProfileModal, this.elements.firstNameInput);
    }

    closeEditModal() {
        this.hideModal(this.elements.editProfileModal);
        this.resetForm();
    }

    populateEditForm() {
        if (!this.userProfile) return;

        const profile = this.userProfile;
        const firstName = profile.firstName || '';
        const lastName = profile.lastName || '';
        const username = profile.username || this.userService.generateUsernameFromEmail(profile.email);
        const bio = profile.bio || '';
        const displayNameFormat = profile.displayNameFormat || 'fullname';
const photoURL = profile.photoURL || '';
        const bannerURL = profile.bannerURL || '';

        if (this.elements.firstNameInput) {
            this.elements.firstNameInput.value = firstName;
        }
        if (this.elements.lastNameInput) {
            this.elements.lastNameInput.value = lastName;
        }
        if (this.elements.usernameInput) {
            this.elements.usernameInput.value = username;
        }
        if (this.elements.bioInput) {
            this.elements.bioInput.value = bio;
            this.updateBioCharCount();
        }
        if (this.elements.displayNameFormatInput) {
            this.elements.displayNameFormatInput.value = displayNameFormat;
        }

        this.photoPreview = photoURL;
        this.updatePhotoPreview();

        this.bannerPreview = bannerURL;
        this.updateBannerPreview();
    }

    updatePhotoPreview() {
        if (this.photoPreview) {
            if (this.elements.photoPreviewImg) {
                this.elements.photoPreviewImg.src = this.photoPreview;
                this.elements.photoPreviewImg.style.display = 'block';
            }
            if (this.elements.photoPlaceholder) {
                this.elements.photoPlaceholder.style.display = 'none';
            }
            if (this.elements.removePhotoBtn) {
                this.elements.removePhotoBtn.style.display = 'block';
            }
        } else {
            if (this.elements.photoPreviewImg) {
                this.elements.photoPreviewImg.style.display = 'none';
            }
            if (this.elements.photoPlaceholder) {
                const firstName = this.elements.firstNameInput?.value || '';
                const lastName = this.elements.lastNameInput?.value || '';
                if (this.elements.photoInitials) {
                    this.elements.photoInitials.textContent = 
                        (firstName[0] || '').toUpperCase() + (lastName[0] || '').toUpperCase() || 'U';
                }
                this.elements.photoPlaceholder.style.display = 'flex';
            }
            if (this.elements.removePhotoBtn) {
                this.elements.removePhotoBtn.style.display = 'none';
            }
        }
    }

    handlePhotoChange(e) {
        const file = e.target.files?.[0];
        if (!file) return;

        const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (!validTypes.includes(file.type)) {
            Utils.showToast(i18n.get('profile.edit_modal.file_type_invalid'), 'error');
            return;
        }

        if (file.size > 5 * 1024 * 1024) {
            Utils.showToast(i18n.get('profile.edit_modal.file_too_large'), 'error');
            return;
        }

        if (file.type === 'image/gif') {
            this.photoFile = file;
            const reader = new FileReader();
            reader.onloadend = () => {
                this.photoPreview = reader.result;
                this.updatePhotoPreview();
                Utils.showToast(i18n.get('profile.cropper.gif_bypass'), 'info');
            };
            reader.readAsDataURL(file);
            return;
        }

        const reader = new FileReader();
        reader.onloadend = () => {
            this.openCropper(reader.result, 'avatar', file.type);
        };
        reader.readAsDataURL(file);
    }

    handleRemovePhoto() {
        this.photoFile = null;
        this.photoPreview = null;
        if (this.elements.photoInput) {
            this.elements.photoInput.value = '';
        }
        this.updatePhotoPreview();
    }

    updateBannerPreview() {
        if (this.bannerPreview) {
            if (this.elements.bannerPreviewImg) {
                this.elements.bannerPreviewImg.src = this.bannerPreview;
                this.elements.bannerPreviewImg.style.display = 'block';
            }
            if (this.elements.bannerPlaceholder) {
                this.elements.bannerPlaceholder.style.display = 'none';
            }
            if (this.elements.removeBannerBtn) {
                this.elements.removeBannerBtn.style.display = 'block';
            }
        } else {
            if (this.elements.bannerPreviewImg) {
                this.elements.bannerPreviewImg.style.display = 'none';
            }
            if (this.elements.bannerPlaceholder) {
                this.elements.bannerPlaceholder.style.display = 'flex';
            }
            if (this.elements.removeBannerBtn) {
                this.elements.removeBannerBtn.style.display = 'none';
            }
        }
    }

    handleBannerChange(e) {
        const file = e.target.files?.[0];
        if (!file) return;

        const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (!validTypes.includes(file.type)) {
            Utils.showToast(i18n.get('profile.edit_modal.file_type_invalid'), 'error');
            return;
        }

        if (file.size > 5 * 1024 * 1024) {
            Utils.showToast(i18n.get('profile.edit_modal.file_too_large'), 'error');
            return;
        }

        if (file.type === 'image/gif') {
            this.bannerFile = file;
            const reader = new FileReader();
            reader.onloadend = () => {
                this.bannerPreview = reader.result;
                this.updateBannerPreview();
                Utils.showToast(i18n.get('profile.cropper.gif_bypass'), 'info');
            };
            reader.readAsDataURL(file);
            return;
        }

        const reader = new FileReader();
        reader.onloadend = () => {
            this.openCropper(reader.result, 'banner', file.type);
        };
        reader.readAsDataURL(file);
    }

    handleRemoveBanner() {
        this.bannerFile = null;
        this.bannerPreview = null;
        if (this.elements.bannerInput) {
            this.elements.bannerInput.value = '';
        }
        this.updateBannerPreview();
    }

    // --- CROPPER LOGIC ---
    openCropper(dataUrl, mode, fileType) {
        this.cropperFileType = fileType;
        this.currentCropperMode = mode;
        if (this.elements.cropperImage) {
            this.elements.cropperImage.src = dataUrl;
        }
        if (this.elements.cropperTabs) {
            this.elements.cropperTabs.style.display = 'flex';
        }
        this.setCropperMode(mode);
        this.showModal(this.elements.cropperModal, this.elements.cropperSelection);
        // Wait for image to load to set initial selection
        this.elements.cropperImage.onload = () => {
            this.resetCropperSelection();
        };
    }

    closeCropper() {
        this.hideModal(this.elements.cropperModal);
        if (this.elements.photoInput) this.elements.photoInput.value = '';
        if (this.elements.bannerInput) this.elements.bannerInput.value = '';
    }

    setCropperMode(mode) {
        this.currentCropperMode = mode;
        if (this.elements.cropperTabAvatar) {
            this.elements.cropperTabAvatar.classList.toggle('active', mode === 'avatar');
        }
        if (this.elements.cropperTabBanner) {
            this.elements.cropperTabBanner.classList.toggle('active', mode === 'banner');
        }
        if (this.elements.cropperSelection) {
            this.elements.cropperSelection.classList.toggle('mode-banner', mode === 'banner');
        }
        if (this.elements.cropperImage && this.elements.cropperImage.complete) {
            this.resetCropperSelection();
        }
    }

    resetCropperSelection() {
        const img = this.elements.cropperImage;
        const container = this.elements.cropperContainer;
        if (!img || !container) return;
        
        const imgRect = img.getBoundingClientRect();
        
        let targetRatio = this.currentCropperMode === 'avatar' ? 1 : 3; // 3:1 for banner, giving it more height than 16:3
        
        let sizeW = imgRect.width * 0.8;
        let sizeH = sizeW / targetRatio;
        
        if (sizeH > imgRect.height * 0.8) {
            sizeH = imgRect.height * 0.8;
            sizeW = sizeH * targetRatio;
        }
        
        this.cropperData = {
            x: (imgRect.width - sizeW) / 2,
            y: (imgRect.height - sizeH) / 2,
            w: sizeW,
            h: sizeH
        };
        
        this.updateCropperDOM();
    }

    updateCropperDOM() {
        if (!this.elements.cropperSelection) return;
        this.elements.cropperSelection.style.left = `${this.cropperData.x}px`;
        this.elements.cropperSelection.style.top = `${this.cropperData.y}px`;
        this.elements.cropperSelection.style.width = `${this.cropperData.w}px`;
        this.elements.cropperSelection.style.height = `${this.cropperData.h}px`;
    }

    setupCropperDragAndDrop() {
        if (!this.elements.cropperSelection || !this.elements.cropperContainer) return;
        
        this.isDraggingCropper = false;
        this.isResizingCropper = false;
        this.resizeHandle = null;
        this.dragStartX = 0;
        this.dragStartY = 0;

        const selection = this.elements.cropperSelection;

        const pointerDown = (e) => {
            if (e.target.classList.contains('cropper-handle')) {
                this.isResizingCropper = true;
                this.resizeHandle = e.target.className.replace('cropper-handle ', '').trim();
            } else if (e.target === selection || selection.contains(e.target)) {
                this.isDraggingCropper = true;
            } else {
                return;
            }
            e.preventDefault();
            // `||` treated a pointer at x/y = 0 as missing and produced NaN.
            this.dragStartX = e.touches?.[0]?.clientX ?? e.clientX;
            this.dragStartY = e.touches?.[0]?.clientY ?? e.clientY;
            this.initialCropperData = { ...this.cropperData };
        };

        const pointerMove = (e) => {
            if (!this.isDraggingCropper && !this.isResizingCropper) return;
            e.preventDefault();

            const clientX = e.touches?.[0]?.clientX ?? e.clientX;
            const clientY = e.touches?.[0]?.clientY ?? e.clientY;
            const dx = clientX - this.dragStartX;
            const dy = clientY - this.dragStartY;
            const imgRect = this.elements.cropperImage.getBoundingClientRect();
            
            let targetRatio = this.currentCropperMode === 'avatar' ? 1 : 3;

            if (this.isDraggingCropper) {
                let newX = this.initialCropperData.x + dx;
                let newY = this.initialCropperData.y + dy;
                
                // bounds
                newX = Math.max(0, Math.min(newX, imgRect.width - this.cropperData.w));
                newY = Math.max(0, Math.min(newY, imgRect.height - this.cropperData.h));
                
                this.cropperData.x = newX;
                this.cropperData.y = newY;
            } else if (this.isResizingCropper) {
                let { x, y, w, h } = this.initialCropperData;
                
                let newW = w;
                let newX = x;
                let newY = y;
                
                if (this.resizeHandle.includes('right')) newW = w + dx;
                if (this.resizeHandle.includes('left')) { newW = w - dx; }
                
                if (newW < 50) newW = 50;
                let newH = newW / targetRatio;
                
                if (this.resizeHandle.includes('left')) {
                    newX = x + (w - newW);
                }
                if (this.resizeHandle.includes('top')) {
                    newY = y + (h - newH);
                }
                
                if (newX < 0) { newW += newX; newX = 0; newH = newW / targetRatio; if(this.resizeHandle.includes('top')) newY = y + (h - newH); }
                if (newY < 0) { newH += newY; newY = 0; newW = newH * targetRatio; if(this.resizeHandle.includes('left')) newX = x + (w - newW); }
                if (newX + newW > imgRect.width) { newW = imgRect.width - newX; newH = newW / targetRatio; if(this.resizeHandle.includes('top')) newY = y + (h - newH); }
                if (newY + newH > imgRect.height) { newH = imgRect.height - newY; newW = newH * targetRatio; if(this.resizeHandle.includes('left')) newX = x + (w - newW); }

                this.cropperData = { x: newX, y: newY, w: newW, h: newH };
            }
            this.updateCropperDOM();
        };

        const pointerUp = () => {
            this.isDraggingCropper = false;
            this.isResizingCropper = false;
        };

        selection.addEventListener('mousedown', pointerDown);
        selection.addEventListener('touchstart', pointerDown, {passive: false});
        document.addEventListener('mousemove', pointerMove);
        document.addEventListener('touchmove', pointerMove, {passive: false});
        document.addEventListener('mouseup', pointerUp);
        document.addEventListener('touchend', pointerUp);

        // Keyboard: arrows move the selection (Shift = 1 px), + / - resize it.
        selection.setAttribute('tabindex', '0');
        selection.setAttribute('role', 'group');
        selection.addEventListener('keydown', (e) => this.handleCropperKeydown(e));

        window.addEventListener('resize', () => {
            if (this.isModalOpen(this.elements.cropperModal)) this.resetCropperSelection();
        });
    }

    handleCropperKeydown(e) {
        if (!this.cropperData || !this.elements.cropperImage) return;
        const step = e.shiftKey ? 1 : 10;
        const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
        let resize = 0;
        if (e.key === '+' || e.key === '=') resize = step;
        else if (e.key === '-' || e.key === '_') resize = -step;
        if (!moves[e.key] && resize === 0) return;
        e.preventDefault();

        const imgRect = this.elements.cropperImage.getBoundingClientRect();
        const ratio = this.currentCropperMode === 'avatar' ? 1 : 3;
        let { x, y, w, h } = this.cropperData;
        if (resize !== 0) {
            // Resize around the centre, within the image and at least 50 px wide.
            const maxW = Math.min(imgRect.width, imgRect.height * ratio);
            const newW = Math.max(50, Math.min(maxW, w + resize * 2));
            const newH = newW / ratio;
            x += (w - newW) / 2;
            y += (h - newH) / 2;
            w = newW;
            h = newH;
        } else {
            x += moves[e.key][0];
            y += moves[e.key][1];
        }
        this.cropperData = {
            x: Math.max(0, Math.min(x, imgRect.width - w)),
            y: Math.max(0, Math.min(y, imgRect.height - h)),
            w,
            h
        };
        this.updateCropperDOM();
    }

    static CROP_MAX_SIZE = {
        avatar: { width: 512, height: 512 },
        banner: { width: 1500, height: 500 }
    };

    /** Output size of a crop: never upscaled, at most CROP_MAX_SIZE for the mode. */
    static getCropOutputSize(mode, cropW, cropH) {
        const max = ProfilePageManager.CROP_MAX_SIZE[mode] || ProfilePageManager.CROP_MAX_SIZE.banner;
        const scale = Math.min(1, max.width / cropW, max.height / cropH);
        return {
            width: Math.max(1, Math.round(cropW * scale)),
            height: Math.max(1, Math.round(cropH * scale))
        };
    }

    applyCrop() {
        if (!this.elements.cropperImage) return;
        const img = this.elements.cropperImage;
        const naturalW = img.naturalWidth;
        const naturalH = img.naturalHeight;
        const rect = img.getBoundingClientRect();
        
        const scaleX = naturalW / rect.width;
        const scaleY = naturalH / rect.height;
        
        const cropX = this.cropperData.x * scaleX;
        const cropY = this.cropperData.y * scaleY;
        const cropW = this.cropperData.w * scaleX;
        const cropH = this.cropperData.h * scaleY;
        
        // The avatar and banner are shown small everywhere (cards, navigation, the
        // 7-day base64 image cache), so the crop is scaled down to the display size
        // instead of keeping the photo's full resolution.
        const { width: outputW, height: outputH } = ProfilePageManager.getCropOutputSize(this.currentCropperMode, cropW, cropH);
        const canvas = document.createElement('canvas');
        canvas.width = outputW;
        canvas.height = outputH;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, outputW, outputH);
        
        // Note: Canvas toDataURL doesn't support outputting 'image/gif'. It will output PNG.
        // If we strictly need to keep GIF animations, we cannot crop it via Canvas API.
        // But we will at least use the original mime type or PNG fallback.
        const outputMime = this.cropperFileType === 'image/gif' ? 'image/png' : (this.cropperFileType || 'image/jpeg');
        const outputExt = outputMime.split('/')[1] === 'jpeg' ? 'jpg' : outputMime.split('/')[1];

        const dataUrl = canvas.toDataURL(outputMime, 0.9);
        const file = this.dataURLtoFile(dataUrl, `cropped-${this.currentCropperMode}-${Date.now()}.${outputExt}`);
        
        if (this.currentCropperMode === 'avatar') {
            this.photoFile = file;
            this.photoPreview = dataUrl;
            this.updatePhotoPreview();
        } else {
            this.bannerFile = file;
            this.bannerPreview = dataUrl;
            this.updateBannerPreview();
        }
        
        this.closeCropper();
    }

    dataURLtoFile(dataurl, filename) {
        let arr = dataurl.split(','), mime = arr[0].match(/:(.*?);/)[1],
            bstr = atob(arr[1]), n = bstr.length, u8arr = new Uint8Array(n);
        while(n--){
            u8arr[n] = bstr.charCodeAt(n);
        }
        return new File([u8arr], filename, {type:mime});
    }
    // --- END CROPPER LOGIC ---

    updateBioCharCount() {
        if (this.elements.bioInput && this.elements.bioCharCount) {
            const length = this.elements.bioInput.value.length;
            this.elements.bioCharCount.textContent = length;
        }
    }

    togglePasswordFields() {
        if (this.elements.passwordFields) {
            const isVisible = this.elements.passwordFields.style.display !== 'none';
            this.elements.passwordFields.style.display = isVisible ? 'none' : 'block';
            this.elements.togglePasswordBtn?.setAttribute('aria-expanded', String(!isVisible));
        }
    }

    async handleFormSubmit(e) {
        e.preventDefault();
        // A second Enter/click while the first save is still checking or uploading
        // would upload the images and write the profile twice.
        if (this.isLoading) return;
        if (!this.currentUser || !this.userProfile || this.viewingOtherUser) return;
        this.clearErrors();

        const formData = {
            firstName: this.elements.firstNameInput?.value.trim() || '',
            lastName: this.elements.lastNameInput?.value.trim() || '',
            username: this.elements.usernameInput?.value.trim() || '',
            bio: this.elements.bioInput?.value.trim() || '',
            displayNameFormat: this.elements.displayNameFormatInput?.value || 'fullname',
            socialLinks: this.userProfile?.socialLinks || {}
        };

        const errors = this.validateForm(formData);
        if (Object.keys(errors).length > 0) {
            this.displayErrors(errors);
            return;
        }

        const passwordData = this.getPasswordData();
        if (passwordData && passwordData.error) {
            this.showFieldError(passwordData.error, 'passwordError');
            return;
        }

        this.setLoading(true);
        const uid = this.currentUser.uid;
        const previous = this.userProfile;
        const uploadedObjects = [];
        let profileSaved = false;

        try {
            // 1. Checks without side effects come first, so a taken username or a
            // wrong current password never leaves a half-saved profile.
            if (formData.username !== (previous.username || '')) {
                let isAvailable;
                try {
                    isAvailable = await this.userService.isUsernameAvailable(formData.username, uid, { throwOnError: true });
                } catch {
                    this.showFieldError(i18n.get('profile.edit_modal.username_check_failed'), 'usernameError');
                    return;
                }
                if (!isAvailable) {
                    this.showFieldError(i18n.get('profile.edit_modal.username_taken'), 'usernameError');
                    return;
                }
            }

            if (passwordData && passwordData.newPassword) {
                try {
                    await firebaseManager.reauthenticateWithPassword(passwordData.currentPassword);
                } catch (error) {
                    this.showFieldError(this.describeSaveError(error), 'passwordError');
                    return;
                }
            }

            // 2. New images get their own object names. The previous files stay valid
            // until the profile document points elsewhere and are deleted afterwards.
            const staleObjects = [];
            let photoURL = previous.photoURL || '';
            let photoPath = previous.photoPath || '';
            if (this.photoFile) {
                const upload = await firebaseManager.uploadAvatar(this.photoFile, { versioned: true });
                uploadedObjects.push(upload.photoPath);
                photoURL = upload.photoURL;
                photoPath = upload.photoPath;
                if (previous.photoPath && previous.photoPath !== photoPath) staleObjects.push(previous.photoPath);
            } else if (!this.photoPreview && photoURL) {
                // Also removes photos that are not stored in Storage, such as the
                // Google account photo (they have no photoPath).
                if (previous.photoPath) staleObjects.push(previous.photoPath);
                photoURL = '';
                photoPath = '';
            }

            let bannerURL = previous.bannerURL || '';
            let bannerPath = previous.bannerPath || '';
            if (this.bannerFile) {
                const upload = await firebaseManager.uploadBanner(this.bannerFile, { versioned: true });
                uploadedObjects.push(upload.bannerPath);
                bannerURL = upload.bannerURL;
                bannerPath = upload.bannerPath;
                if (previous.bannerPath && previous.bannerPath !== bannerPath) staleObjects.push(previous.bannerPath);
            } else if (!this.bannerPreview && bannerURL) {
                if (previous.bannerPath) staleObjects.push(previous.bannerPath);
                bannerURL = '';
                bannerPath = '';
            }

            const displayName = [formData.firstName, formData.lastName].filter(Boolean).join(' ') ||
                               previous.displayName || 'User';

            const updateData = {
                firstName: formData.firstName,
                lastName: formData.lastName,
                username: formData.username,
                usernameLower: formData.username.toLowerCase(),
                displayName,
                bio: formData.bio,
                displayNameFormat: formData.displayNameFormat,
                socialLinks: formData.socialLinks,
                photoURL,
                photoPath,
                bannerURL,
                bannerPath
            };

            // 3. The profile document is the commit point.
            await this.userService.updateUserProfile(uid, updateData);
            profileSaved = true;

            await this.syncProfileImageCache(uid, {
                avatar: this.photoFile ? { file: this.photoFile, url: photoURL } : (photoURL ? null : { removed: true }),
                banner: this.bannerFile ? { file: this.bannerFile, url: bannerURL } : (bannerURL ? null : { removed: true })
            });

            this.userProfile = { ...previous, ...updateData };
            this.displayProfile();
            this.photoFile = null;
            this.bannerFile = null;
            this.photoPreview = photoURL || null;
            this.bannerPreview = bannerURL || null;

            try {
                await firebaseManager.updateAuthProfile({ displayName, photoURL: photoURL || null });
            } catch (authProfileError) {
                // Navigation reads the Firestore profile; the Auth copy is cosmetic.
                console.warn('ProfilePage: Could not update the Auth profile:', authProfileError);
            }

            const deletions = await Promise.allSettled(staleObjects.map(path => firebaseManager.deleteProfilePhoto(path)));
            deletions.forEach(result => {
                if (result.status === 'rejected') console.warn('ProfilePage: Could not delete an old profile image:', result.reason);
            });

            let passwordError = null;
            if (passwordData && passwordData.newPassword) {
                try {
                    await firebaseManager.updatePassword(passwordData.newPassword);
                } catch (error) {
                    passwordError = error;
                }
            }

            if (passwordError) {
                // The profile is saved; keep the dialog open so only the password can be retried.
                const reason = this.describeSaveError(passwordError);
                this.showFieldError(reason, 'passwordError');
                Utils.showToast(i18n.get('profile.edit_modal.password_not_changed').replace('{reason}', reason), 'error');
            } else {
                this.closeEditModal();
                Utils.showToast(i18n.get('profile.edit_modal.saved'), 'success');
            }

            if (window.navigation && window.navigation.updateUserDisplay) {
                const updatedUser = firebaseManager.getCurrentUser();
                await window.navigation.updateUserDisplay(updatedUser);
            }
        } catch (error) {
            console.error('Error saving profile:', error);
            if (!profileSaved && uploadedObjects.length > 0) {
                // Nothing references the new uploads; do not leave them in Storage.
                await Promise.allSettled(uploadedObjects.map(path => firebaseManager.deleteProfilePhoto(path)));
            }
            Utils.showToast(this.describeSaveError(error), 'error');
        } finally {
            this.setLoading(false);
        }
    }

    async syncProfileImageCache(uid, changes) {
        const cache = this.imageCacheService;
        if (!cache) return;
        for (const [type, change] of Object.entries(changes)) {
            if (!change) continue;
            try {
                if (change.removed) {
                    await cache.invalidateCache(uid, type);
                } else {
                    await cache.cacheImage(uid, type, change.file, change.url);
                }
            } catch (error) {
                console.warn(`ProfilePage: Could not update the cached ${type}:`, error);
            }
        }
    }

    /** Localized text for Firebase errors instead of raw SDK messages. */
    describeSaveError(error) {
        const code = String(error?.code || '');
        if (['auth/wrong-password', 'auth/invalid-credential', 'auth/invalid-login-credentials'].includes(code)) {
            return i18n.get('profile.edit_modal.wrong_password');
        }
        if (code === 'auth/too-many-requests') return i18n.get('profile.edit_modal.too_many_requests');
        if (code === 'auth/weak-password') return i18n.get('profile.edit_modal.weak_password');
        if (code === 'auth/network-request-failed' || code === 'unavailable'
            || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
            return i18n.get('profile.edit_modal.network_error');
        }
        return i18n.get('profile.edit_modal.save_failed');
    }

    validateForm(data) {
        const errors = {};

        if (!data.firstName || data.firstName.trim() === '') {
            errors.firstName = i18n.get('profile.edit_modal.first_name_required');
        }

        if (!data.lastName || data.lastName.trim() === '') {
            errors.lastName = i18n.get('profile.edit_modal.last_name_required');
        }

        if (!data.username || data.username.trim() === '') {
            errors.username = i18n.get('profile.edit_modal.username_required');
        } else if (data.username.length < 3 || data.username.length > 20) {
            errors.username = i18n.get('profile.edit_modal.username_length');
        } else if (!/^[a-zA-Z0-9_]+$/.test(data.username)) {
            errors.username = i18n.get('profile.edit_modal.username_chars');
        }

        if (data.bio && data.bio.length > 200) {
            errors.bio = i18n.get('profile.edit_modal.bio_too_long');
        }

        return errors;
    }

    getPasswordData() {
        const isVisible = this.elements.passwordFields?.style.display !== 'none';
        if (!isVisible) return null;

        const currentPassword = this.elements.currentPasswordInput?.value || '';
        const newPassword = this.elements.newPasswordInput?.value || '';
        const confirmPassword = this.elements.confirmPasswordInput?.value || '';

        if (!newPassword && !confirmPassword) {
            return null;
        }

        if (newPassword.length < 6) {
            return { error: i18n.get('profile.edit_modal.password_too_short') };
        }

        if (newPassword !== confirmPassword) {
            return { error: i18n.get('profile.edit_modal.password_mismatch') };
        }

        if (!currentPassword) {
            return { error: i18n.get('profile.edit_modal.current_password_required') };
        }

        return { currentPassword, newPassword };
    }

    displayErrors(errors) {
        Object.keys(errors).forEach(key => {
            const errorElement = this.elements[`${key}Error`];
            if (errorElement) {
                errorElement.textContent = errors[key];
            }
        });
    }

    clearErrors() {
        Object.keys(this.elements).forEach(key => {
            if (key.endsWith('Error') && this.elements[key]) {
                this.elements[key].textContent = '';
            }
        });
    }

    showFieldError(message, elementId) {
        if (elementId && this.elements[elementId]) {
            this.elements[elementId].textContent = message;
        } else if (this.elements.usernameError) {
            this.elements.usernameError.textContent = message;
        }
    }

    resetForm() {
        this.photoFile = null;
        this.photoPreview = this.userProfile?.photoURL || null;
        this.bannerFile = null;
        this.bannerPreview = this.userProfile?.bannerURL || null;
        this.clearErrors();
        if (this.elements.passwordFields) {
            this.elements.passwordFields.style.display = 'none';
        }
        this.elements.togglePasswordBtn?.setAttribute('aria-expanded', 'false');
        // Typed passwords must not survive closing the dialog.
        [this.elements.currentPasswordInput, this.elements.newPasswordInput, this.elements.confirmPasswordInput]
            .forEach(input => { if (input) input.value = ''; });
        if (this.elements.photoInput) {
            this.elements.photoInput.value = '';
        }
        if (this.elements.bannerInput) {
            this.elements.bannerInput.value = '';
        }
    }

    setLoading(loading) {
        this.isLoading = loading;
        if (this.elements.saveProfileBtn) {
            this.elements.saveProfileBtn.disabled = loading;
        }
        if (this.elements.saveBtnText) {
            this.elements.saveBtnText.style.display = loading ? 'none' : 'block';
        }
        if (this.elements.saveBtnLoading) {
            this.elements.saveBtnLoading.style.display = loading ? 'block' : 'none';
        }
    }

    // showLoading, showError, showToast removed in favor of this.page and Utils.showToast
}

let profilePageManager;

document.addEventListener('DOMContentLoaded', () => {
    profilePageManager = new ProfilePageManager();
    window.profilePageManager = profilePageManager;
});
