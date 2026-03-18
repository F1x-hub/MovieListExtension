import { i18n } from '../../shared/i18n/I18n.js';

/**
 * Profile Page Manager
 * Handles the user profile page functionality
 */
class ProfilePageManager {
    static CACHE_KEY_PREFIX = 'profile_cache_';
    static CACHE_LIFETIME = 24 * 60 * 60 * 1000; // 24 hours

    constructor() {
        this.currentUser = null;
        this.userProfile = null;
        this.profileService = null;
        this.userService = null;
        this.imageCacheService = window.imageCacheService;
        this.isLoading = false;
        this.photoFile = null;
        this.photoPreview = null;
        this.bannerFile = null;
        this.bannerPreview = null;
        
        this.init();
    }

    async init() {
        this.initializeElements();
        this.setupEventListeners();
        
        // Try to load cached profile immediately for instant render
        await this.loadCachedProfile();

        await i18n.init();
        i18n.translatePage();

        await this.setupFirebase();
        await this.loadProfile();
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
                    const currentUid = authResult.user?.uid;
                    if (currentUid && targetUserId && currentUid !== targetUserId) {
                        this.viewingOtherUser = true;
                    } else {
                        this.viewingOtherUser = false;
                    }

                    this.displayProfile();
                    if (cache.stats) {
                        this.displayStatistics(cache.stats);
                    }
                    
                    // Hide loading immediately if we have data
                    this.showLoading(false);
                } else {
                    console.log('ProfilePage: Cache expired for', targetUserId);
                }
            }
        } catch (error) {
            console.error('ProfilePage: Error loading cache', error);
        }
        return false;
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
                this.showLoading(false);
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
            profileFavoriteGenre: document.getElementById('profileFavoriteGenre'),
            favoriteGenreText: document.getElementById('favoriteGenreText'),
            favoriteGenreText: document.getElementById('favoriteGenreText'),
            profileMenu: document.getElementById('profileMenu'),
            profileMenuBtn: document.getElementById('profileMenuBtn'),
            profileDropdown: document.getElementById('profileDropdown'),
            editProfileItem: document.getElementById('editProfileItem'),
            profileCover: document.querySelector('.profile-cover'),

            // Statistics
            statTotalRatings: document.getElementById('statTotalRatings'),
            statAverageRating: document.getElementById('statAverageRating'),
            statFavorites: document.getElementById('statFavorites'),
            statWatchlist: document.getElementById('statWatchlist'),

            // Recent ratings
            recentRatingsList: document.getElementById('recentRatingsList'),
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
            favoriteGenreInput: document.getElementById('favoriteGenreInput'),
            twitterInput: document.getElementById('twitterInput'),
            instagramInput: document.getElementById('instagramInput'),
            facebookInput: document.getElementById('facebookInput'),
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
    }

    setupEventListeners() {
        if (this.elements.profileMenuBtn) {
            this.elements.profileMenuBtn.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                this.toggleMenu();
            });
        }

        if (this.elements.editProfileItem) {
            this.elements.editProfileItem.addEventListener('mousedown', () => {
                this.closeMenu();
                this.openEditModal();
            });
        }

        // Close menu when clicking outside
        document.addEventListener('mousedown', (e) => {
            if (this.elements.profileDropdown && 
                this.elements.profileDropdown.classList.contains('show') && 
                !this.elements.profileMenuBtn.contains(e.target) && 
                !this.elements.profileDropdown.contains(e.target)) {
                this.closeMenu();
            }
        });
        
        this.viewingOtherUser = false;

        if (this.elements.viewAllRatingsBtn) {
            this.elements.viewAllRatingsBtn.addEventListener('mousedown', () => {
                if (window.navigation) {
                    window.navigation.navigateToPage('ratings');
                } else {
                    window.location.href = chrome.runtime.getURL('src/pages/ratings/ratings.html');
                }
            });
        }

        if (this.elements.retryBtn) {
            this.elements.retryBtn.addEventListener('mousedown', () => this.loadProfile());
        }

        if (this.elements.editProfileModalClose) {
            this.elements.editProfileModalClose.addEventListener('mousedown', () => this.closeEditModal());
        }

        if (this.elements.cancelEditBtn) {
            this.elements.cancelEditBtn.addEventListener('mousedown', () => this.closeEditModal());
        }

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

        if (this.elements.removePhotoBtn) {
            this.elements.removePhotoBtn.addEventListener('mousedown', () => this.handleRemovePhoto());
        }

        if (this.elements.bannerInput) {
            this.elements.bannerInput.addEventListener('change', (e) => this.handleBannerChange(e));
        }

        if (this.elements.removeBannerBtn) {
            this.elements.removeBannerBtn.addEventListener('mousedown', () => this.handleRemoveBanner());
        }

        if (this.elements.bioInput) {
            this.elements.bioInput.addEventListener('input', () => this.updateBioCharCount());
        }

        if (this.elements.togglePasswordBtn) {
            this.elements.togglePasswordBtn.addEventListener('mousedown', () => this.togglePasswordFields());
        }

        if (this.elements.editProfileForm) {
            this.elements.editProfileForm.addEventListener('submit', (e) => this.handleFormSubmit(e));
        }

        // Cropper Event Listeners
        if (this.elements.cropperModalClose) {
            this.elements.cropperModalClose.addEventListener('mousedown', () => this.closeCropper());
        }
        if (this.elements.cropperCancelBtn) {
            this.elements.cropperCancelBtn.addEventListener('mousedown', () => this.closeCropper());
        }
        if (this.elements.cropperApplyBtn) {
            this.elements.cropperApplyBtn.addEventListener('mousedown', () => this.applyCrop());
        }
        if (this.elements.cropperTabAvatar) {
            this.elements.cropperTabAvatar.addEventListener('mousedown', () => this.setCropperMode('avatar'));
        }
        if (this.elements.cropperTabBanner) {
            this.elements.cropperTabBanner.addEventListener('mousedown', () => this.setCropperMode('banner'));
        }
        this.setupCropperDragAndDrop();
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

        if (firebaseManager.waitForAuthReady) {
            await firebaseManager.waitForAuthReady();
        }

        this.currentUser = firebaseManager.getCurrentUser();
        
        const urlParams = new URLSearchParams(window.location.search);
        const profileUserId = urlParams.get('userId');
        
        if (!profileUserId && !this.currentUser) {
            this.showError('Please sign in to view your profile');
            return;
        }

        firebaseManager.initializeServices();
        this.userService = firebaseManager.getUserService();
        this.profileService = new ProfileService(firebaseManager);
    }

    async loadProfile() {
        const urlParams = new URLSearchParams(window.location.search);
        const profileUserId = urlParams.get('userId');
        
        const targetUserId = profileUserId || (this.currentUser ? this.currentUser.uid : null);
        
        if (!targetUserId) {
            if (!this.currentUser) {
                this.showError('Please sign in to view your profile');
                return;
            }
        }

        // Only show loading screen if we don't have cached profile
        if (!this.userProfile) {
            this.showLoading(true);
        }
        
        this.viewingOtherUser = profileUserId && this.currentUser && profileUserId !== this.currentUser.uid;

        try {
            const [profile, stats] = await Promise.all([
                this.userService.getUserProfileWithStats(targetUserId),
                this.profileService.getUserStatistics(targetUserId)
            ]);

            if (!profile) {
                this.showError('Profile not found');
                return;
            }

            this.userProfile = { ...profile, stats, uid: targetUserId };
            this.displayProfile();
            this.displayStatistics(stats);
            await this.loadRecentRatings(targetUserId);

            // Save to cache
            try {
                if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                    const cacheKey = `${ProfilePageManager.CACHE_KEY_PREFIX}${targetUserId}`;
                    await chrome.storage.local.set({
                        [cacheKey]: {
                            profile: this.userProfile,
                            stats: stats,
                            timestamp: Date.now()
                        }
                    });
                    console.log('ProfilePage: Saved profile to cache', targetUserId);
                }
            } catch (cacheError) {
                console.warn('ProfilePage: Failed to save cache', cacheError);
            }

            this.showLoading(false);
        } catch (error) {
            console.error('Error loading profile:', error);
            
            // Try to load even expired cache if we are having connection issues
            console.log('ProfilePage: Network error, attempting expired cache fallback...');
            const hasFallback = await this.loadExpiredCacheFallback(targetUserId);
            
            if (!hasFallback) {
                this.showError('Failed to load profile. Please check your connection.');
            }
            this.showLoading(false);
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
                this.elements.profileUsername.textContent = username;
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
                // Try to get from cache first
                this.imageCacheService.getCachedImage(profile.uid || this.currentUser?.uid, 'avatar').then(cachedAvatar => {
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
            let joinDate;
            if (this.profileService && typeof this.profileService.formatJoinDate === 'function') {
                joinDate = this.profileService.formatJoinDate(profile.createdAt);
            } else {
                // Fallback: simple date format
                try {
                    const date = profile.createdAt.toDate ? profile.createdAt.toDate() : new Date(profile.createdAt);
                    joinDate = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                } catch (e) {
                    joinDate = '';
                }
            }
            if (joinDate) {
                this.elements.joinDateText.textContent = `${i18n.get('profile.joined')} ${joinDate}`;
                this.elements.profileJoinDate.style.display = 'flex';
            } else {
                this.elements.profileJoinDate.style.display = 'none';
            }
        } else if (this.elements.profileJoinDate) {
            this.elements.profileJoinDate.style.display = 'none';
        }

        if (this.elements.profileFavoriteGenre && profile.favoriteGenre) {
            this.elements.favoriteGenreText.textContent = `${i18n.get('profile.favorite_genre')}: ${profile.favoriteGenre}`;
            this.elements.profileFavoriteGenre.style.display = 'flex';
        } else if (this.elements.profileFavoriteGenre) {
            this.elements.profileFavoriteGenre.style.display = 'none';
        }

        if (this.elements.profileMenu) {
            if (this.viewingOtherUser) {
                this.elements.profileMenu.style.display = 'none';
            } else {
                this.elements.profileMenu.style.display = 'block';
            }
        }

        if (this.elements.profileCover) {
            if (profile.bannerURL) {
                // Check if imageCacheService is ready
                if (this.imageCacheService && typeof this.imageCacheService.getCachedImage === 'function') {
                    // Try to get from cache first
                    this.imageCacheService.getCachedImage(profile.uid || this.currentUser?.uid, 'banner').then(cachedBanner => {
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
    }

    async loadRecentRatings(userId = null) {
        const targetUserId = userId || (this.currentUser ? this.currentUser.uid : null);
        if (!targetUserId) return;

        try {
            const ratings = await this.profileService.getRecentRatings(targetUserId, 10);
            this.displayRecentRatings(ratings);
        } catch (error) {
            console.error('Error loading recent ratings:', error);
            if (this.elements.recentRatingsList) {
                this.elements.recentRatingsList.innerHTML = '<p style="color: #94a3b8; text-align: center; padding: 20px;">Failed to load recent ratings</p>';
            }
        }
    }

    displayRecentRatings(ratings) {
        if (!this.elements.recentRatingsList) return;

        if (ratings.length === 0) {
            this.elements.recentRatingsList.innerHTML = '<p style="color: #94a3b8; text-align: center; padding: 20px;">No ratings yet. Start rating movies!</p>';
            return;
        }

        const ratingsHTML = ratings.map(rating => {
            const movie = rating.movie || {};
            const movieTitle = movie.name || movie.alternativeName || 'Unknown Movie';
            const movieYear = movie.year ? ` (${movie.year})` : '';
            const posterUrl = movie.posterUrl || '';
            const genres = (movie.genres || []).map(g => g.name || g).join(', ') || 'Unknown';
            const ratingDate = this.profileService.formatDate(rating.createdAt);

            return `
                <div class="recent-rating-card" data-movie-id="${rating.movieId}">
                    <div class="poster">
                        ${posterUrl 
                            ? `<img src="${posterUrl}" alt="${movieTitle}" onerror="this.parentElement.innerHTML='<div class=\\'poster-placeholder\\'>🎬</div>'">`
                            : '<div class="poster-placeholder">🎬</div>'
                        }
                    </div>
                    <div class="info">
                        <div class="title">${movieTitle}${movieYear}</div>
                        <div class="genres">${genres}</div>
                        <div class="date">Оценено: ${ratingDate}</div>
                    </div>
                    <div class="rating">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                ${rating.rating}
                    </div>
                </div>
            `;
        }).join('');

        this.elements.recentRatingsList.innerHTML = ratingsHTML;

        const cards = this.elements.recentRatingsList.querySelectorAll('.recent-rating-card');
        cards.forEach(card => {
            card.addEventListener('mousedown', () => {
                const movieId = card.getAttribute('data-movie-id');
                if (movieId) {
                    const url = chrome.runtime.getURL(`src/pages/movie-details/movie-details.html?movieId=${movieId}`);
                    window.location.href = url;
                }
            });
        });
    }

    toggleMenu() {
        if (this.elements.profileDropdown) {
            this.elements.profileDropdown.classList.toggle('show');
        }
    }

    closeMenu() {
        if (this.elements.profileDropdown) {
            this.elements.profileDropdown.classList.remove('show');
        }
    }

    openEditModal() {
        if (!this.userProfile) return;
        
        if (this.viewingOtherUser) {
            return;
        }

        this.populateEditForm();
        if (this.elements.editProfileModal) {
            this.elements.editProfileModal.style.display = 'flex';
        }

        const isGoogle = this.currentUser && 
            Array.isArray(this.currentUser.providerData) && 
            this.currentUser.providerData.some(p => p.providerId === 'google.com');

        if (this.elements.passwordSection) {
            this.elements.passwordSection.style.display = isGoogle ? 'none' : 'block';
        }
    }

    closeEditModal() {
        if (this.elements.editProfileModal) {
            this.elements.editProfileModal.style.display = 'none';
        }
        this.resetForm();
    }

    populateEditForm() {
        if (!this.userProfile) return;

        const profile = this.userProfile;
        const firstName = profile.firstName || '';
        const lastName = profile.lastName || '';
        const username = profile.username || this.userService.generateUsernameFromEmail(profile.email);
        const bio = profile.bio || '';
        const favoriteGenre = profile.favoriteGenre || '';
        const displayNameFormat = profile.displayNameFormat || 'fullname';
        const socialLinks = profile.socialLinks || { twitter: '', instagram: '', facebook: '' };
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
        if (this.elements.favoriteGenreInput) {
            this.elements.favoriteGenreInput.value = favoriteGenre;
        }
        if (this.elements.twitterInput) {
            this.elements.twitterInput.value = socialLinks.twitter || '';
        }
        if (this.elements.instagramInput) {
            this.elements.instagramInput.value = socialLinks.instagram || '';
        }
        if (this.elements.facebookInput) {
            this.elements.facebookInput.value = socialLinks.facebook || '';
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
            this.showToast('Invalid file type. Use JPG, PNG, WEBP or GIF.', 'error');
            return;
        }

        if (file.size > 5 * 1024 * 1024) {
            this.showToast('File size must be less than 5MB.', 'error');
            return;
        }

        if (file.type === 'image/gif') {
            this.photoFile = file;
            const reader = new FileReader();
            reader.onloadend = () => {
                this.photoPreview = reader.result;
                this.updatePhotoPreview();
                this.showToast(i18n.get('profile.cropper.gif_bypass') || 'GIF image cannot be cropped in browser, using original image.', 'success');
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
            this.showToast('Invalid file type. Use JPG, PNG, WEBP or GIF.', 'error');
            return;
        }

        if (file.size > 5 * 1024 * 1024) {
            this.showToast('File size must be less than 5MB.', 'error');
            return;
        }

        if (file.type === 'image/gif') {
            this.bannerFile = file;
            const reader = new FileReader();
            reader.onloadend = () => {
                this.bannerPreview = reader.result;
                this.updateBannerPreview();
                this.showToast(i18n.get('profile.cropper.gif_bypass') || 'GIF image cannot be cropped in browser, using original image.', 'success');
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
        if (this.elements.cropperModal) {
            this.elements.cropperModal.style.display = 'flex';
        }
        // Wait for image to load to set initial selection
        this.elements.cropperImage.onload = () => {
            this.resetCropperSelection();
        };
    }

    closeCropper() {
        if (this.elements.cropperModal) {
            this.elements.cropperModal.style.display = 'none';
        }
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
            this.dragStartX = e.clientX || e.touches?.[0].clientX;
            this.dragStartY = e.clientY || e.touches?.[0].clientY;
            this.initialCropperData = { ...this.cropperData };
        };

        const pointerMove = (e) => {
            if (!this.isDraggingCropper && !this.isResizingCropper) return;
            e.preventDefault();

            const clientX = e.clientX || e.touches?.[0].clientX;
            const clientY = e.clientY || e.touches?.[0].clientY;
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
                let newH = h;
                let newX = x;
                let newY = y;
                
                if (this.resizeHandle.includes('right')) newW = w + dx;
                if (this.resizeHandle.includes('left')) { newW = w - dx; }
                
                if (newW < 50) newW = 50;
                newH = newW / targetRatio;
                
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
        
        const canvas = document.createElement('canvas');
        canvas.width = cropW;
        canvas.height = cropH;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
        
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
        }
    }

    async handleFormSubmit(e) {
        e.preventDefault();
        this.clearErrors();

        const formData = {
            firstName: this.elements.firstNameInput?.value.trim() || '',
            lastName: this.elements.lastNameInput?.value.trim() || '',
            username: this.elements.usernameInput?.value.trim() || '',
            bio: this.elements.bioInput?.value.trim() || '',
            displayNameFormat: this.elements.displayNameFormatInput?.value || 'fullname',
            favoriteGenre: this.elements.favoriteGenreInput?.value || '',
            socialLinks: {
                twitter: this.elements.twitterInput?.value.trim() || '',
                instagram: this.elements.instagramInput?.value.trim() || '',
                facebook: this.elements.facebookInput?.value.trim() || ''
            }
        };

        const errors = this.validateForm(formData);
        if (Object.keys(errors).length > 0) {
            this.displayErrors(errors);
            return;
        }

        const isUsernameChanged = formData.username !== (this.userProfile.username || '');
        if (isUsernameChanged) {
            const isAvailable = await this.userService.isUsernameAvailable(formData.username, this.currentUser.uid);
            if (!isAvailable) {
                this.showFieldError('Username is already taken. Please choose another.', 'usernameError');
                return;
            }
        }

        const passwordData = this.getPasswordData();
        if (passwordData && passwordData.error) {
            this.showFieldError(passwordData.error, 'passwordError');
            return;
        }

        this.setLoading(true);

        try {
            let photoURL = this.userProfile.photoURL || '';
            let photoPath = this.userProfile.photoPath || '';

            if (this.photoFile) {
                const uploadResult = await firebaseManager.uploadAvatar(this.photoFile);
                photoURL = uploadResult.photoURL;
                photoPath = uploadResult.photoPath;
                // Cache the new avatar immediately
                await this.imageCacheService.cacheImage(this.currentUser.uid, 'avatar', this.photoFile);
            } else if (!this.photoPreview && this.userProfile.photoPath) {
                await firebaseManager.deleteProfilePhoto(this.userProfile.photoPath);
                photoURL = '';
                photoPath = '';
                // Invalidate cache
                await this.imageCacheService.invalidateCache(this.currentUser.uid, 'avatar');
            }

            let bannerURL = this.userProfile.bannerURL || '';
            let bannerPath = this.userProfile.bannerPath || '';

            if (this.bannerFile) {
                const uploadResult = await firebaseManager.uploadBanner(this.bannerFile);
                bannerURL = uploadResult.bannerURL;
                bannerPath = uploadResult.bannerPath;
                // Cache the new banner immediately
                await this.imageCacheService.cacheImage(this.currentUser.uid, 'banner', this.bannerFile);
            } else if (!this.bannerPreview && this.userProfile.bannerPath) {
                await firebaseManager.deleteBanner(this.userProfile.bannerPath);
                bannerURL = '';
                bannerPath = '';
                // Invalidate cache
                await this.imageCacheService.invalidateCache(this.currentUser.uid, 'banner');
            }

            const displayName = [formData.firstName, formData.lastName].filter(Boolean).join(' ') || 
                               this.userProfile.displayName || 'User';

            const updateData = {
                firstName: formData.firstName,
                lastName: formData.lastName,
                username: formData.username,
                usernameLower: formData.username.toLowerCase(),
                displayName,
                bio: formData.bio,
                displayNameFormat: formData.displayNameFormat,
                favoriteGenre: formData.favoriteGenre,
                socialLinks: formData.socialLinks,
                photoURL,
                photoPath,
                bannerURL,
                bannerPath
            };

            await this.userService.updateUserProfile(this.currentUser.uid, updateData);
            await firebaseManager.updateAuthProfile({ displayName, photoURL });

            if (passwordData && passwordData.newPassword) {
                await firebaseManager.changePasswordWithReauth(
                    passwordData.currentPassword,
                    passwordData.newPassword
                );
            }

            this.userProfile = { ...this.userProfile, ...updateData };
            this.displayProfile();
            this.closeEditModal();
            this.showToast('Profile updated successfully!', 'success');

            if (window.navigation && window.navigation.updateUserDisplay) {
                const updatedUser = firebaseManager.getCurrentUser();
                await window.navigation.updateUserDisplay(updatedUser);
            }
        } catch (error) {
            console.error('Error saving profile:', error);
            this.showToast(error.message || 'Failed to save profile. Please try again.', 'error');
        } finally {
            this.setLoading(false);
        }
    }

    validateForm(data) {
        const errors = {};

        if (!data.firstName || data.firstName.trim() === '') {
            errors.firstName = 'First name is required';
        }

        if (!data.lastName || data.lastName.trim() === '') {
            errors.lastName = 'Last name is required';
        }

        if (!data.username || data.username.trim() === '') {
            errors.username = 'Username is required';
        } else if (data.username.length < 3 || data.username.length > 20) {
            errors.username = 'Username must be 3-20 characters';
        } else if (!/^[a-zA-Z0-9_]+$/.test(data.username)) {
            errors.username = 'Username can only contain letters, numbers, and underscores';
        }

        if (data.bio && data.bio.length > 200) {
            errors.bio = 'Bio must be under 200 characters';
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
            return { error: 'New password must be at least 6 characters' };
        }

        if (newPassword !== confirmPassword) {
            return { error: 'Passwords do not match' };
        }

        if (!currentPassword) {
            return { error: 'Current password is required' };
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

    showLoading(show) {
        if (this.elements.loadingSection) {
            this.elements.loadingSection.style.display = show ? 'flex' : 'none';
        }
        if (this.elements.errorState) {
            this.elements.errorState.style.display = 'none';
        }
    }

    showError(message) {
        if (this.elements.errorState) {
            this.elements.errorState.style.display = 'block';
        }
        if (this.elements.errorMessage) {
            this.elements.errorMessage.textContent = message;
        }
        if (this.elements.loadingSection) {
            this.elements.loadingSection.style.display = 'none';
        }
    }

    showToast(message, type = 'success') {
        if (this.elements.profileToast) {
            this.elements.profileToast.textContent = message;
            this.elements.profileToast.className = `toast-message ${type}`;
            this.elements.profileToast.style.display = 'block';

            setTimeout(() => {
                if (this.elements.profileToast) {
                    this.elements.profileToast.style.display = 'none';
                }
            }, 3000);
        }
    }
}

let profilePageManager;

document.addEventListener('DOMContentLoaded', () => {
    profilePageManager = new ProfilePageManager();
    window.profilePageManager = profilePageManager;
});

