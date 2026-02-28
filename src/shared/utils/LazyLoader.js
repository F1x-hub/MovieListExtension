/**
 * LazyLoader — utility for on-demand loading of scripts and stylesheets.
 * Features: deduplication cache, timeout (10s default), retry logic (2 retries default).
 */
class LazyLoader {
    static _cache = new Map(); // src -> Promise

    /**
     * Dynamically load a script file.
     * @param {string} src - Script URL (relative or absolute)
     * @param {Object} [options]
     * @param {number} [options.timeout=10000] - Timeout in ms
     * @param {number} [options.retries=2] - Number of retry attempts on failure
     * @returns {Promise<void>}
     */
    static loadScript(src, { timeout = 10000, retries = 2 } = {}) {
        if (this._cache.has(src)) {
            return this._cache.get(src);
        }

        const promise = this._loadWithRetry(src, 'script', timeout, retries);
        this._cache.set(src, promise);

        // On permanent failure, remove from cache so it can be retried later
        promise.catch(() => this._cache.delete(src));
        return promise;
    }

    /**
     * Dynamically load a CSS stylesheet.
     * @param {string} href - Stylesheet URL
     * @param {Object} [options]
     * @param {number} [options.timeout=10000] - Timeout in ms
     * @param {number} [options.retries=2] - Number of retry attempts on failure
     * @returns {Promise<void>}
     */
    static loadCSS(href, { timeout = 10000, retries = 2 } = {}) {
        if (this._cache.has(href)) {
            return this._cache.get(href);
        }

        const promise = this._loadWithRetry(href, 'css', timeout, retries);
        this._cache.set(href, promise);
        promise.catch(() => this._cache.delete(href));
        return promise;
    }

    /**
     * Internal: load with retry logic.
     */
    static async _loadWithRetry(url, type, timeout, retries) {
        let lastError;
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                await this._load(url, type, timeout);
                return; // success
            } catch (err) {
                lastError = err;
                if (attempt < retries) {
                    // Wait briefly before retrying (exponential backoff: 500ms, 1000ms)
                    await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
                    console.warn(`[LazyLoader] Retry ${attempt + 1}/${retries} for ${url}`);
                }
            }
        }
        throw lastError;
    }

    /**
     * Internal: single load attempt with timeout.
     */
    static _load(url, type, timeout) {
        return new Promise((resolve, reject) => {
            let element;
            let timer;

            if (type === 'script') {
                element = document.createElement('script');
                element.src = url;
                element.async = true;
            } else {
                element = document.createElement('link');
                element.rel = 'stylesheet';
                element.href = url;
            }

            const cleanup = () => {
                clearTimeout(timer);
                element.onload = null;
                element.onerror = null;
            };

            element.onload = () => {
                cleanup();
                resolve();
            };

            element.onerror = () => {
                cleanup();
                element.remove();
                reject(new Error(`[LazyLoader] Failed to load ${type}: ${url}`));
            };

            timer = setTimeout(() => {
                cleanup();
                element.remove();
                reject(new Error(`[LazyLoader] Timeout loading ${type}: ${url} (${timeout}ms)`));
            }, timeout);

            document.head.appendChild(element);
        });
    }

    /**
     * Check if a resource has already been loaded.
     * @param {string} url
     * @returns {boolean}
     */
    static isLoaded(url) {
        return this._cache.has(url);
    }
}
