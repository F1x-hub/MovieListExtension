/**
 * KodikStreamResolver - resolves a Kodik embed URL to its direct HLS streams.
 *
 * The embed page carries signed request parameters (`urlParams`, `vInfo`).
 * Posting them to the player's `/ftor` endpoint returns one HLS manifest per
 * quality, with lightly obfuscated `src` values. Kodik answers these requests
 * without a Referer, so every request is sent with `no-referrer`: a foreign
 * Referer makes `/ftor` fail.
 *
 * Any parsing or network failure throws; callers keep the Kodik iframe as the
 * fallback player.
 */
class KodikStreamResolver {
    /**
     * @param {Object} [options]
     * @param {(url: string, init?: RequestInit) => Promise<Response>} [options.fetch]
     * @param {number} [options.cacheTTL] - How long resolved manifests are reused
     */
    constructor({ fetch: fetchImpl = null, cacheTTL = KODIK_STREAM_CACHE_TTL_MS } = {}) {
        this._fetch = fetchImpl || ((url, init) => fetch(url, init));
        this.cacheTTL = cacheTTL;
        /** @private @type {Map<string, {data: Array<{height: number, url: string}>, timestamp: number}>} */
        this._cache = new Map();
        /** @private @type {Map<string, Promise<Array<{height: number, url: string}>>>} */
        this._inFlight = new Map();
    }

    /**
     * Resolve the HLS manifests of one embed, best quality first.
     * @param {string} embedUrl - Kodik `seria`/`video`/`serial` embed URL
     * @param {Object} [options]
     * @param {boolean} [options.forceRefresh] - Ignore the cache (expired stream)
     * @returns {Promise<Array<{height: number, url: string}>>}
     */
    async resolve(embedUrl, { forceRefresh = false } = {}) {
        const pageUrl = KodikStreamResolver.toPageUrl(embedUrl);
        if (!pageUrl) throw new Error('Not a Kodik embed URL');

        const cached = this._cache.get(pageUrl);
        if (!forceRefresh && cached && Date.now() - cached.timestamp < this.cacheTTL) return cached.data;
        const inFlight = this._inFlight.get(pageUrl);
        if (!forceRefresh && inFlight) return inFlight;

        const request = (async () => {
            try {
                const pageResponse = await this._fetch(pageUrl, {
                    credentials: 'omit',
                    referrerPolicy: 'no-referrer'
                });
                if (!pageResponse.ok) throw new Error(`Kodik page failed: ${pageResponse.status}`);
                const info = KodikStreamResolver.parseEmbedPage(await pageResponse.text());

                const ftorUrl = new URL(KODIK_FTOR_PATH, pageUrl).href;
                const ftorResponse = await this._fetch(ftorUrl, {
                    method: 'POST',
                    credentials: 'omit',
                    referrerPolicy: 'no-referrer',
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                        'X-Requested-With': 'XMLHttpRequest'
                    },
                    body: KodikStreamResolver.buildFtorBody(info).toString()
                });
                if (!ftorResponse.ok) throw new Error(`Kodik stream request failed: ${ftorResponse.status}`);
                const streams = KodikStreamResolver.parseLinks(await ftorResponse.json());
                if (streams.length === 0) throw new Error('Kodik returned no streams');
                this._cache.set(pageUrl, { data: streams, timestamp: Date.now() });
                return streams;
            } finally {
                if (this._inFlight.get(pageUrl) === request) this._inFlight.delete(pageUrl);
            }
        })();
        this._inFlight.set(pageUrl, request);
        return request;
    }

    clearCache() {
        this._cache.clear();
        this._inFlight.clear();
    }

    // ─── Static Helpers ───────────────────────────────────────────────

    /**
     * Normalize an embed URL to the page Kodik serves: HTTPS on a Kodik host,
     * without the extension's own Referer-rule marker.
     * @param {string} embedUrl
     * @returns {string|null}
     */
    static toPageUrl(embedUrl) {
        try {
            const value = String(embedUrl || '').trim();
            const parsed = new URL(value.startsWith('//') ? `https:${value}` : value);
            const hostname = parsed.hostname.toLowerCase();
            if (hostname !== 'kodikplayer.com' && !hostname.endsWith('.kodikplayer.com')) return null;
            parsed.protocol = 'https:';
            parsed.searchParams.delete('movieExtensionSite');
            return parsed.toString();
        } catch {
            return null;
        }
    }

    /**
     * Read the signed request parameters from the embed page.
     * @param {string} html
     * @returns {{params: Object, type: string, hash: string, id: string}}
     */
    static parseEmbedPage(html) {
        const source = String(html || '');
        const paramsMatch = source.match(/var\s+urlParams\s*=\s*'([^']+)'/);
        const type = source.match(/vInfo\.type\s*=\s*'([^']+)'/)?.[1];
        const hash = source.match(/vInfo\.hash\s*=\s*'([^']+)'/)?.[1];
        const id = source.match(/vInfo\.id\s*=\s*'([^']+)'/)?.[1];
        if (!paramsMatch || !type || !hash || !id) throw new Error('Kodik embed page has no player parameters');
        let params;
        try {
            params = JSON.parse(paramsMatch[1]);
        } catch {
            throw new Error('Kodik player parameters are not valid JSON');
        }
        if (!params || typeof params !== 'object') throw new Error('Kodik player parameters are missing');
        return { params, type, hash, id };
    }

    /**
     * Form body the Kodik player itself posts to `/ftor`.
     * @param {{params: Object, type: string, hash: string, id: string}} info
     * @returns {URLSearchParams}
     */
    static buildFtorBody({ params, type, hash, id }) {
        const body = new URLSearchParams();
        Object.entries(params || {}).forEach(([key, value]) => {
            if (value !== null && value !== undefined) body.set(key, String(value));
        });
        body.set('type', type);
        body.set('hash', hash);
        body.set('id', id);
        body.set('bad_user', 'false');
        body.set('info', '{}');
        body.set('cdn_is_working', 'true');
        return body;
    }

    /**
     * Kodik shifts letters by 18 within their case and then base64-encodes
     * the URL. Plain URLs (containing `//`) are returned unchanged.
     * @param {string} value
     * @returns {string}
     */
    static decodeSource(value) {
        const text = String(value || '');
        if (text.includes('//')) return text;
        const shifted = text.replace(/[a-zA-Z]/g, char => {
            const limit = char <= 'Z' ? 90 : 122;
            const code = char.charCodeAt(0) + 18;
            return String.fromCharCode(limit >= code ? code : code - 26);
        });
        return KodikStreamResolver.decodeBase64(shifted);
    }

    static decodeBase64(value) {
        if (typeof atob === 'function') return atob(value);
        return Buffer.from(value, 'base64').toString('binary');
    }

    /**
     * HTTPS manifests by quality, best first.
     * @param {Object} response - `/ftor` JSON
     * @returns {Array<{height: number, url: string}>}
     */
    static parseLinks(response) {
        const links = response?.links;
        if (!links || typeof links !== 'object') return [];
        const streams = [];
        Object.entries(links).forEach(([quality, entries]) => {
            const height = Number.parseInt(quality, 10);
            const entry = Array.isArray(entries) ? entries.find(item => item?.src) : null;
            if (!Number.isFinite(height) || height <= 0 || !entry) return;
            let decoded;
            try {
                decoded = KodikStreamResolver.decodeSource(entry.src).trim();
            } catch {
                return;
            }
            try {
                const url = new URL(decoded.startsWith('//') ? `https:${decoded}` : decoded);
                if (url.protocol !== 'https:') return;
                streams.push({ height, url: url.href });
            } catch {
                // Skip a quality whose source does not decode to a URL.
            }
        });
        return streams.sort((left, right) => right.height - left.height);
    }
}

const KODIK_FTOR_PATH = '/ftor';
const KODIK_STREAM_CACHE_TTL_MS = 10 * 60 * 1000;

// Export
if (typeof window !== 'undefined') {
    window.KodikStreamResolver = KodikStreamResolver;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { KodikStreamResolver };
}
