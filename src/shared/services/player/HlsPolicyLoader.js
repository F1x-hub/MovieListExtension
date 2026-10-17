/** Controlled, non-progressive hls.js 1.6.15 transport. No caller network hooks. */
(function(global) {
    'use strict';

    function newStats() {
        return {
            aborted: false, loaded: 0, retry: 0, total: 0, chunkCount: 0, bwEstimate: 0,
            loading: { start: 0, first: 0, end: 0 },
            parsing: { start: 0, end: 0 },
            buffering: { start: 0, first: 0, end: 0 }
        };
    }

    function forProfile(profile = 'remote', { localManifestUrl } = {}) {
        // Decode before URL dot-segment normalization so encoded separators
        // cannot turn an in-directory URL into a sibling backend request.
        const scopeUrl = value => {
            const url = new global.URL(value);
            const path = new global.URL(decodeURIComponent(url.pathname), url.origin);
            if (path.origin !== url.origin) throw new Error('Invalid scoped path');
            return { origin: url.origin, pathname: path.pathname };
        };
        let localScope = null;
        if (profile === 'local') {
            try {
                const initial = global.UrlPolicy.check(localManifestUrl, { kind: 'manifest', profile });
                if (initial.ok) {
                    const normalized = scopeUrl(initial.url);
                    const directory = new global.URL('.', normalized.origin + normalized.pathname).pathname;
                    if (directory !== '/') localScope = { origin: normalized.origin, directory };
                }
            } catch { /* invalid or absent session scope fails closed */ }
        }
        const inScope = url => {
            if (profile !== 'local') return true;
            if (!localScope) return false;
            const normalized = scopeUrl(url);
            return normalized.origin === localScope.origin && normalized.pathname.startsWith(localScope.directory);
        };
        return class HlsPolicyLoader {
            static movieExtensionPolicyLoader = true;

            constructor() {
                this.context = null;
                this.stats = newStats();
                this._active = false;
                this._used = false;
                this._destroyed = false;
                this._timers = [];
                this._controller = null;
                this._callbacks = null;
                this._response = null;
            }

            _clearTimers() {
                this._timers.forEach(timer => global.clearTimeout(timer));
                this._timers = [];
            }

            _finish() {
                this._active = false;
                this._clearTimers();
                const callbacks = this._callbacks;
                this._callbacks = null;
                return callbacks;
            }

            _error(code, text) {
                if (!this._active) return;
                const callbacks = this._finish();
                this._controller?.abort();
                callbacks.onError({ code, text }, this.context, null, this.stats);
            }

            _timeout() {
                if (!this._active) return;
                const callbacks = this._finish();
                this.stats.aborted = true;
                this._controller?.abort();
                callbacks.onTimeout(this.stats, this.context, null);
            }

            abort() {
                if (!this._active) return;
                const callbacks = this._finish();
                this.stats.aborted = true;
                this._controller?.abort();
                callbacks.onAbort?.(this.stats, this.context, null);
            }

            destroy() {
                this._destroyed = true;
                this._finish();
                if (this._controller && !this.stats.loading.end) {
                    this.stats.aborted = true;
                    this._controller.abort();
                }
                this.context = this._response = this._controller = null;
            }

            load(context, config, callbacks) {
                if (this._used || this._destroyed) throw new Error('Loader can only be used once.');
                this._used = true;
                this._active = true;
                this.context = context;
                this._callbacks = callbacks;
                this.stats.loading.start = global.performance.now();

                let checked;
                let kind;
                try {
                    kind = global.UrlPolicy?.kindOf(context);
                    checked = kind && global.UrlPolicy.check(context.url, { kind, profile });
                    if (checked?.ok && !inScope(checked.url)) checked = null;
                } catch { checked = null; }
                if (!checked?.ok) {
                    this._error(0, 'POLICY_VIOLATION');
                    return;
                }

                this._controller = new global.AbortController();
                const policy = config.loadPolicy || {};
                const finiteDelay = value => Number.isFinite(value) && value > 0;
                const totalMs = finiteDelay(policy.maxLoadTimeMs) ? policy.maxLoadTimeMs : config.timeout;
                const firstMs = finiteDelay(policy.maxTimeToFirstByteMs) ? policy.maxTimeToFirstByteMs : totalMs;
                if (finiteDelay(totalMs)) this._timers.push(global.setTimeout(() => this._timeout(), totalMs));
                const firstTimer = finiteDelay(firstMs)
                    ? global.setTimeout(() => this._timeout(), firstMs) : null;
                if (firstTimer !== null) this._timers.push(firstTimer);

                // A promise boundary also catches synchronous fetch/header failures.
                Promise.resolve().then(() => {
                    if (!this._active) return null;
                    const headers = new global.Headers(context.headers || {});
                    if (Number.isFinite(context.rangeEnd) && context.rangeEnd > 0) {
                        headers.set('Range', `bytes=${context.rangeStart || 0}-${context.rangeEnd - 1}`);
                    }
                    return global.fetch(checked.url, {
                        method: 'GET', mode: 'cors', credentials: 'omit', redirect: 'manual',
                        signal: this._controller.signal, headers
                    });
                }).then(async response => {
                    if (!this._active) return;
                    global.clearTimeout(firstTimer);
                    let final;
                    try {
                        final = global.UrlPolicy.check(response.url, { kind, profile });
                        if (final?.ok && !inScope(final.url)) final = null;
                    } catch { final = null; }
                    if (response.type === 'opaqueredirect' || response.redirected
                        || (response.status >= 300 && response.status < 400)
                        || !final?.ok || final.url !== checked.url) {
                        this._error(0, 'POLICY_VIOLATION');
                        return;
                    }
                    this._response = response;
                    if (!response.ok) {
                        this._error(response.status, 'HTTP_ERROR');
                        return;
                    }
                    this.stats.loading.first = Math.max(global.performance.now(), this.stats.loading.start);
                    const range = /^(?:bytes\s+)?(\d+)-(\d+)\/\d+$/.exec(response.headers.get('Content-Range') || '');
                    const length = range ? Number(range[2]) - Number(range[1]) + 1
                        : Number(response.headers.get('Content-Length'));
                    if (Number.isFinite(length) && length > 0) this.stats.total = length;
                    const data = context.responseType === 'arraybuffer' ? await response.arrayBuffer()
                        : context.responseType === 'json' ? await response.json() : await response.text();
                    if (!this._active) return;
                    this.stats.loading.end = Math.max(global.performance.now(), this.stats.loading.first);
                    const loaded = typeof data === 'string' ? data.length : data?.byteLength;
                    if (Number.isFinite(loaded)) this.stats.loaded = this.stats.total = loaded;
                    this._clearTimers();
                    this._callbacks.onProgress?.(this.stats, context, data, response);
                    // hls.js is allowed to destroy/abort the loader inside onProgress.
                    if (!this._active) return;
                    const completed = this._finish();
                    completed.onSuccess({ url: final.url, data, code: response.status }, this.stats, context, response);
                }).catch(() => {
                    this._error(0, 'NETWORK_ERROR');
                });
            }

            getResponseHeader(name) {
                return this._response?.headers.get(name) ?? null;
            }

            getCacheAge() {
                const age = Number.parseFloat(this.getResponseHeader('Age'));
                return Number.isFinite(age) ? age : null;
            }
        };
    }

    global.HlsPolicyLoader = Object.freeze({ forProfile });
})(typeof window !== 'undefined' ? window : globalThis);
