// Kinopoisk API Configuration
const QUOTA_STORAGE_KEY = 'kp_quota_exhausted_until';
const QUOTA_COOLDOWN_MS = 6 * 60 * 60 * 1000;
let _quotaExhaustedUntilCache = null;

function _quotaStorage() {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
        return null;
    }
    return chrome.storage.local;
}

function _quotaStorageGet() {
    const storage = _quotaStorage();
    if (!storage) return Promise.resolve(null);

    return new Promise((resolve) => {
        try {
            storage.get([QUOTA_STORAGE_KEY], (result) => {
                resolve(Number(result?.[QUOTA_STORAGE_KEY]) || null);
            });
        } catch {
            resolve(null);
        }
    });
}

function _quotaStorageSet(until) {
    const storage = _quotaStorage();
    if (!storage) return Promise.resolve();

    return new Promise((resolve) => {
        try {
            storage.set({ [QUOTA_STORAGE_KEY]: until }, resolve);
        } catch {
            resolve();
        }
    });
}

function _quotaStorageRemove() {
    const storage = _quotaStorage();
    if (!storage) return Promise.resolve();

    return new Promise((resolve) => {
        try {
            storage.remove([QUOTA_STORAGE_KEY], resolve);
        } catch {
            resolve();
        }
    });
}

async function isQuotaExhausted() {
    const now = Date.now();
    if (_quotaExhaustedUntilCache && now < _quotaExhaustedUntilCache) {
        return true;
    }

    const until = await _quotaStorageGet();
    if (until && now < until) {
        _quotaExhaustedUntilCache = until;
        return true;
    }

    return false;
}

function getQuotaStatus() {
    const until = Number(_quotaExhaustedUntilCache) || null;
    const remainingMs = until ? Math.max(0, until - Date.now()) : 0;
    return {
        exhausted: Boolean(until && remainingMs > 0),
        until,
        remainingMs
    };
}

async function markQuotaExhausted() {
    const until = Date.now() + QUOTA_COOLDOWN_MS;
    _quotaExhaustedUntilCache = until;
    await _quotaStorageSet(until);
    console.warn(`[KinopoiskQuota] Quota marked exhausted until ${new Date(until).toISOString()}`);
}

async function resetQuotaState() {
    _quotaExhaustedUntilCache = null;
    await _quotaStorageRemove();
    console.info('[KinopoiskQuota] Quota state manually reset');
}

const KINOPOISK_CONFIG = {
    // Base URL for Kinopoisk API
    BASE_URL: 'https://api.poiskkino.dev/v1.4',

    // Array of API Keys for rotation
    API_KEYS: [
        'Q6Q938P-CG3M56S-GKJRF4P-J3TSZ6S',
        'ZX91BN3-Q1H4T4X-KEPN3J5-288P8B3',
        'MBE8N48-3084955-KGG56JZ-X0TRYDJ'
        // Add additional keys here
    ],

    // Index of the currently active key
    currentKeyIndex: 0,

    // Get the currently active API key
    get API_KEY() {
        return this.API_KEYS[this.currentKeyIndex] || this.API_KEYS[0];
    },

    // Rotate to the next available key
    rotateKey() {
        this.currentKeyIndex = (this.currentKeyIndex + 1) % this.API_KEYS.length;
        console.log(`Rotated to API Key index: ${this.currentKeyIndex}`);
        return this.API_KEY;
    },

    // Default request parameters
    DEFAULT_LIMIT: 20,
    DEFAULT_PAGE: 1,

    // Cache settings
    CACHE_DURATION: 24 * 60 * 60 * 1000, // 24 hours in milliseconds

    QUOTA_STORAGE_KEY,
    QUOTA_COOLDOWN_MS,
    isQuotaExhausted,
    getQuotaStatus,
    markQuotaExhausted,
    resetQuotaState,

    // Endpoints
    ENDPOINTS: {
        SEARCH: '/movie/search',
        MOVIE: '/movie',
        RANDOM: '/movie/random'
    }
};

const quotaState = { isQuotaExhausted, getQuotaStatus, markQuotaExhausted, resetQuotaState };

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = KINOPOISK_CONFIG;
} else if (typeof globalThis !== 'undefined') {
    globalThis.KINOPOISK_CONFIG = KINOPOISK_CONFIG;
    globalThis.isQuotaExhausted = isQuotaExhausted;
    globalThis.markQuotaExhausted = markQuotaExhausted;
    globalThis.resetQuotaState = resetQuotaState;
    globalThis.kinopoiskQuota = quotaState;
    globalThis.getKinopoiskQuotaStatus = getQuotaStatus;
} else if (typeof window !== 'undefined') {
    window.KINOPOISK_CONFIG = KINOPOISK_CONFIG;
} else {
    self.KINOPOISK_CONFIG = KINOPOISK_CONFIG;
}
