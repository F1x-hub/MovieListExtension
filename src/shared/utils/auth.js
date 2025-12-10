/**
 * AuthManager - Utility class for managing authentication state and tokens
 * Provides helper functions for working with chrome.storage.local auth data
 */
class AuthManager {
    // Storage keys for authentication data
    static STORAGE_KEYS = {
        USER: 'user',
        AUTH_TOKEN: 'authToken',
        AUTH_TOKEN_EXPIRY: 'authTokenExpiry',
        IS_AUTHENTICATED: 'isAuthenticated',
        TOKEN_VALIDATION_TIMESTAMP: 'tokenValidationTimestamp',
        AUTH_TIMESTAMP: 'authTimestamp'
    };

    /**
     * Get stored authentication data from chrome.storage.local
     * @returns {Promise<Object|null>} Auth data object or null if not authenticated
     */
    static async getAuthData() {
        return new Promise((resolve) => {
            chrome.storage.local.get([
                AuthManager.STORAGE_KEYS.USER,
                AuthManager.STORAGE_KEYS.AUTH_TOKEN,
                AuthManager.STORAGE_KEYS.AUTH_TOKEN_EXPIRY,
                AuthManager.STORAGE_KEYS.IS_AUTHENTICATED,
                AuthManager.STORAGE_KEYS.TOKEN_VALIDATION_TIMESTAMP
            ], (result) => {
                if (chrome.runtime.lastError) {
                    console.error('[AuthManager] Error getting auth data:', chrome.runtime.lastError);
                    resolve(null);
                    return;
                }

                // Check if we have minimum required data
                if (!result.user || !result.isAuthenticated) {
                    resolve(null);
                    return;
                }

                resolve({
                    user: result.user,
                    authToken: result.authToken,
                    authTokenExpiry: result.authTokenExpiry,
                    isAuthenticated: result.isAuthenticated,
                    tokenValidationTimestamp: result.tokenValidationTimestamp
                });
            });
        });
    }

    /**
     * Check if stored token is still valid
     * @param {Object} authData - Auth data from getAuthData()
     * @returns {boolean} True if token is valid and not expired
     */
    static isTokenValid(authData) {
        if (!authData || !authData.authToken || !authData.authTokenExpiry) {
            return false;
        }

        const now = Date.now();
        
        // Check if token has expired
        if (now >= authData.authTokenExpiry) {
            console.log('[AuthManager] Token has expired');
            return false;
        }

        // Check if token validation is still valid (within 24 hours)
        const TOKEN_VALIDATION_TTL = 24 * 60 * 60 * 1000; // 24 hours
        if (authData.tokenValidationTimestamp) {
            const timeSinceValidation = now - authData.tokenValidationTimestamp;
            if (timeSinceValidation >= TOKEN_VALIDATION_TTL) {
                console.log('[AuthManager] Token needs re-validation (24h passed)');
                // Token needs validation but might still be usable
                // Let Firebase handle the validation
            }
        }

        return true;
    }

    /**
     * Clear all authentication data from storage
     * @returns {Promise<void>}
     */
    static async clearAuthData() {
        return new Promise((resolve) => {
            chrome.storage.local.remove([
                AuthManager.STORAGE_KEYS.USER,
                AuthManager.STORAGE_KEYS.AUTH_TOKEN,
                AuthManager.STORAGE_KEYS.AUTH_TOKEN_EXPIRY,
                AuthManager.STORAGE_KEYS.IS_AUTHENTICATED,
                AuthManager.STORAGE_KEYS.TOKEN_VALIDATION_TIMESTAMP,
                AuthManager.STORAGE_KEYS.AUTH_TIMESTAMP
            ], () => {
                if (chrome.runtime.lastError) {
                    console.error('[AuthManager] Error clearing auth data:', chrome.runtime.lastError);
                }
                console.log('[AuthManager] Auth data cleared');
                resolve();
            });
        });
    }

    /**
     * Save authentication data to storage
     * @param {Object} user - User object from Firebase
     * @param {string} authToken - Firebase auth token
     * @param {number} authTokenExpiry - Token expiry timestamp
     * @param {number} tokenValidationTimestamp - Last validation timestamp
     * @returns {Promise<void>}
     */
    static async saveAuthData(user, authToken, authTokenExpiry, tokenValidationTimestamp) {
        return new Promise((resolve) => {
            const authData = {
                [AuthManager.STORAGE_KEYS.USER]: {
                    uid: user.uid,
                    email: user.email,
                    displayName: user.displayName,
                    photoURL: user.photoURL
                },
                [AuthManager.STORAGE_KEYS.AUTH_TOKEN]: authToken,
                [AuthManager.STORAGE_KEYS.AUTH_TOKEN_EXPIRY]: authTokenExpiry,
                [AuthManager.STORAGE_KEYS.IS_AUTHENTICATED]: true,
                [AuthManager.STORAGE_KEYS.TOKEN_VALIDATION_TIMESTAMP]: tokenValidationTimestamp,
                [AuthManager.STORAGE_KEYS.AUTH_TIMESTAMP]: Date.now()
            };

            chrome.storage.local.set(authData, () => {
                if (chrome.runtime.lastError) {
                    console.error('[AuthManager] Error saving auth data:', chrome.runtime.lastError);
                } else {
                    console.log('[AuthManager] Auth data saved successfully');
                }
                resolve();
            });
        });
    }

    /**
     * Quick synchronous check if user appears to be authenticated
     * This is a fast check that doesn't validate the token
     * @returns {Promise<boolean>}
     */
    static async isAuthenticated() {
        const authData = await AuthManager.getAuthData();
        return authData !== null && authData.isAuthenticated === true;
    }

    /**
     * Get user info from storage without full auth validation
     * Useful for quick UI updates
     * @returns {Promise<Object|null>}
     */
    static async getUserInfo() {
        const authData = await AuthManager.getAuthData();
        return authData ? authData.user : null;
    }
}

// Make available globally
if (typeof window !== 'undefined') {
    window.AuthManager = AuthManager;
}
