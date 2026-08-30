// Kinopoisk API Configuration
// Versioned after the registry migration so a stale pre-fix cooldown cannot
// suppress requests after the proxy has recovered.
const QUOTA_STORAGE_KEY = 'kp_quota_exhausted_until_v2';
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

    // All API traffic must go through the authenticated Firebase proxy.
    PROXY_URL: 'https://us-central1-movielistdb-13208.cloudfunctions.net/kinopoiskProxy',

    // Compatibility surface for old callers. Secrets are server-side only.
    API_KEYS: [],

    // Index of the currently active key
    currentKeyIndex: 0,

    // No client-side API key is ever available.
    get API_KEY() {
        return '';
    },

    // Rotation is performed by kinopoiskProxy in Secret Manager.
    rotateKey() {
        return '';
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
