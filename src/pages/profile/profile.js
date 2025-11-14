/**
 * Profile Page Manager
 * Handles the user profile page functionality
 */
class ProfilePageManager {
    constructor() {
        this.currentUser = null;
        this.userProfile = null;
        this.profileService = null;
        this.userService = null;
        this.isLoading = false;
        this.photoFile = null;
        this.photoPreview = null;
        
        this.init();
    }

    async init() {
        this.initializeElements();
        this.setupEventListeners();
        await this.setupFirebase();
        await this.loadProfile();
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
            editProfileBtn: document.getElementById('editProfileBtn'),

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

            // Error messages
            firstNameError: document.getElementById('firstNameError'),
            lastNameError: document.getElementById('lastNameError'),
            usernameError: document.getElementById('usernameError'),
            bioError: document.getElementById('bioError'),
            passwordError: document.getElementById('passwordError')
        };
    }

    setupEventListeners() {
        if (this.elements.editProfileBtn) {
            this.elements.editProfileBtn.addEventListener('click', () => this.openEditModal());
        }
        
        this.viewingOtherUser = false;

        if (this.elements.viewAllRatingsBtn) {
            this.elements.viewAllRatingsBtn.addEventListener('click', () => {
                if (window.navigation) {
                    window.navigation.navigateToPage('ratings');
                } else {
                    window.location.href = chrome.runtime.getURL('src/pages/ratings/ratings.html');
                }
            });
        }

        if (this.elements.retryBtn) {
            this.elements.retryBtn.addEventListener('click', () => this.loadProfile());
        }

        if (this.elements.editProfileModalClose) {
            this.elements.editProfileModalClose.addEventListener('click', () => this.closeEditModal());
        }

        if (this.elements.cancelEditBtn) {
            this.elements.cancelEditBtn.addEventListener('click', () => this.closeEditModal());
        }

        if (this.elements.editProfileModal) {
            this.elements.editProfileModal.addEventListener('click', (e) => {
                if (e.target === this.elements.editProfileModal) {
                    this.closeEditModal();
                }
            });
        }

        if (this.elements.photoInput) {
            this.elements.photoInput.addEventListener('change', (e) => this.handlePhotoChange(e));
        }

        if (this.elements.removePhotoBtn) {
            this.elements.removePhotoBtn.addEventListener('click', () => this.handleRemovePhoto());
        }

        if (this.elements.bioInput) {
            this.elements.bioInput.addEventListener('input', () => this.updateBioCharCount());
        }

        if (this.elements.togglePasswordBtn) {
            this.elements.togglePasswordBtn.addEventListener('click', () => this.togglePasswordFields());
        }

        if (this.elements.editProfileForm) {
            this.elements.editProfileForm.addEventListener('submit', (e) => this.handleFormSubmit(e));
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

        this.showLoading(true);
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

            this.userProfile = { ...profile, stats };
            this.displayProfile();
            this.displayStatistics(stats);
            await this.loadRecentRatings(targetUserId);

            this.showLoading(false);
        } catch (error) {
            console.error('Error loading profile:', error);
            this.showError('Failed to load profile. Please try again.');
            this.showLoading(false);
        }
    }

    displayProfile() {
        if (!this.userProfile) return;

        const profile = this.userProfile;
        const firstName = profile.firstName || '';
        const lastName = profile.lastName || '';
        const fullName = [firstName, lastName].filter(Boolean).join(' ') || profile.displayName || 'User';
        const username = profile.username || this.userService.generateUsernameFromEmail(profile.email);
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
            if (this.elements.profilePhotoImg) {
                this.elements.profilePhotoImg.src = photoURL;
                this.elements.profilePhotoImg.style.display = 'block';
            }
            if (this.elements.profilePhotoPlaceholder) {
                this.elements.profilePhotoPlaceholder.style.display = 'none';
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
            const joinDate = this.profileService.formatJoinDate(profile.createdAt);
            this.elements.joinDateText.textContent = `Участник с ${joinDate}`;
            this.elements.profileJoinDate.style.display = 'flex';
        } else if (this.elements.profileJoinDate) {
            this.elements.profileJoinDate.style.display = 'none';
        }

        if (this.elements.profileFavoriteGenre && profile.favoriteGenre) {
            this.elements.favoriteGenreText.textContent = `Любимый жанр: ${profile.favoriteGenre}`;
            this.elements.profileFavoriteGenre.style.display = 'flex';
        } else if (this.elements.profileFavoriteGenre) {
            this.elements.profileFavoriteGenre.style.display = 'none';
        }

        if (this.elements.editProfileBtn) {
            if (this.viewingOtherUser) {
                this.elements.editProfileBtn.style.display = 'none';
            } else {
                this.elements.editProfileBtn.style.display = 'block';
            }
        }
    }

    displayStatistics(stats) {
        if (!stats) return;

        if (this.elements.statTotalRatings) {
            this.elements.statTotalRatings.textContent = stats.totalRatings || 0;
        }
        if (this.elements.statAverageRating) {
            this.elements.statAverageRating.textContent = (stats.averageRating || 0).toFixed(1);
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
                        ⭐ ${rating.rating}/10
                    </div>
                </div>
            `;
        }).join('');

        this.elements.recentRatingsList.innerHTML = ratingsHTML;

        const cards = this.elements.recentRatingsList.querySelectorAll('.recent-rating-card');
        cards.forEach(card => {
            card.addEventListener('click', () => {
                const movieId = card.getAttribute('data-movie-id');
                if (movieId) {
                    const url = chrome.runtime.getURL(`src/pages/search/search.html?movieId=${movieId}`);
                    window.location.href = url;
                }
            });
        });
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

        const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
        if (!validTypes.includes(file.type)) {
            this.showToast('Invalid file type. Use JPG, PNG, or WEBP.', 'error');
            return;
        }

        if (file.size > 5 * 1024 * 1024) {
            this.showToast('File size must be less than 5MB.', 'error');
            return;
        }

        this.photoFile = file;
        const reader = new FileReader();
        reader.onloadend = () => {
            this.photoPreview = reader.result;
            this.updatePhotoPreview();
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
            } else if (!this.photoPreview && this.userProfile.photoPath) {
                await firebaseManager.deleteProfilePhoto(this.userProfile.photoPath);
                photoURL = '';
                photoPath = '';
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
                photoPath
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
        this.clearErrors();
        if (this.elements.passwordFields) {
            this.elements.passwordFields.style.display = 'none';
        }
        if (this.elements.photoInput) {
            this.elements.photoInput.value = '';
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

