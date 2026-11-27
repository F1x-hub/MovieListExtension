/**
 * Balancers that find a title by its Kinopoisk ID, with no site search in between:
 * Collaps (the Venom balancer behind KinoGo and Ex-FS), Alloha and Veoveo. A site
 * search can land on a namesake; an ID cannot.
 *
 * Collaps needs nothing but the ID. Alloha and Veoveo also want a partner token. The
 * tokens come from the player list of the aggregator behind kinopoisk.cx, live for
 * months and are kept in storage, so that list is asked only when a balancer says it
 * has no such title, and at most once a day.
 *
 * The aggregator's network blocks an address for half an hour after one request that
 * does not look like a browser's. Its list is therefore read only from an extension
 * page, never from a test, a script or a server.
 */

const KP_BALANCER_STORAGE_KEY = 'kpBalancerAccessV1';
const KP_BALANCER_LIST_URL = 'https://p.linkpp.ink/api/players';
const KP_BALANCER_LIST_TIMEOUT_MS = 6000;
const KP_BALANCER_ASK_GAP_MS = 24 * 60 * 60 * 1000;
// A balancer's "no such title" is not asked again for this long.
const KP_BALANCER_MISS_TTL_MS = 5 * 60 * 1000;
const KP_BALANCER_MISS_LIMIT = 200;

/**
 * `site` is the site a frame is opened in the name of (`movieExtensionSite`): the
 * Referer rules in provider-embed-rules.json carry one entry for each.
 */
const KP_BALANCERS = Object.freeze({
    collaps: Object.freeze({ name: 'Collaps', site: 'https://ex-fs.net' }),
    alloha: Object.freeze({ name: 'Alloha', site: 'https://linkpp.ink' }),
    veoveo: Object.freeze({ name: 'Veoveo', site: 'https://linkpp.ink' })
});

/** Where Alloha and Veoveo answer and the tokens they accept. */
const KpBalancerAccess = {
    // As the aggregator published them on 2026-11-27.
    alloha: { host: 'theatre.stravers.live', token: '5009a7a2d05cb714cc53c8408471e3' },
    veoveo: {
        host: 'player.shortener2.link',
        token: 'eyJhbGciOiJIUzI1NiJ9.eyJ3ZWJTaXRlIjoiODI0IiwiaXNzIjoiYXBpLXdlYm1hc3RlciIsInN1YiI6IjE3MSIsImlhdCI6MTc3ODkxNjIxNSwianRpIjoiNzYxZDk1MjItYjQwZC00ZjZlLWIwNzEtZjJkYTBlNDQyYWEzIiwic2NvcGUiOiJETEUifQ.bI8NVdjVwtlEi2ATHb_tbskI4lB8eU0knEy95GlTrO4'
    },
    askedAt: 0,
    loading: null,
    asking: null,

    // Only hosts the manifest already gives frame scripts and access to: an address on
    // any other domain would open as the balancer's own player, or not be readable.
    shapes: Object.freeze({
        alloha: Object.freeze({
            type: 'alloha',
            host: /(?:^|\.)(?:stravers\.live|allarknow\.online|stloadi\.live)$/,
            token: /^[a-f0-9]{16,64}$/i
        }),
        veoveo: Object.freeze({
            type: 'veoveo',
            host: /(?:^|\.)shortener2\.link$/,
            token: /^[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}$/
        })
    }),

    /** @returns {{host: string, token: string}|null} */
    accept(name, value) {
        const shape = this.shapes[name];
        const host = String(value?.host || '').toLowerCase();
        const token = String(value?.token || '');
        return shape && shape.host.test(host) && shape.token.test(token) ? { host, token } : null;
    },

    /** @returns {boolean} Whether an address or a token changed. */
    apply(state) {
        let changed = false;
        for (const name of Object.keys(this.shapes)) {
            const next = this.accept(name, state?.[name]);
            if (!next || (next.host === this[name].host && next.token === this[name].token)) continue;
            this[name] = next;
            changed = true;
        }
        const askedAt = Number(state?.askedAt);
        if (Number.isFinite(askedAt) && askedAt > this.askedAt && askedAt <= Date.now()) this.askedAt = askedAt;
        return changed;
    },

    load() {
        this.loading ||= (async () => {
            try {
                const stored = await globalThis.chrome?.storage?.local?.get?.(KP_BALANCER_STORAGE_KEY);
                this.apply(stored?.[KP_BALANCER_STORAGE_KEY]);
            } catch { /* The built-in values still work. */ }
        })();
        return this.loading;
    },

    async save() {
        try {
            await globalThis.chrome?.storage?.local?.set?.({ [KP_BALANCER_STORAGE_KEY]: {
                alloha: this.alloha, veoveo: this.veoveo, askedAt: this.askedAt
            } });
        } catch { /* The next page asks again. */ }
    },

    /** Reads the aggregator's list as data: one frame address for each player it names. */
    parseList(payload) {
        const found = {};
        for (const player of Array.isArray(payload?.data) ? payload.data : []) {
            const name = Object.keys(this.shapes).find(key => this.shapes[key].type === String(player?.type || '').toLowerCase());
            if (!name || typeof player.iframeUrl !== 'string') continue;
            try {
                const url = new URL(player.iframeUrl);
                if (url.protocol !== 'https:') continue;
                const entry = this.accept(name, { host: url.hostname, token: url.searchParams.get('token') });
                if (entry) found[name] = entry;
            } catch { /* Not an address. */ }
        }
        return found;
    },

    /**
     * Asks the aggregator which tokens it uses today. Only a balancer's "no such title"
     * leads here, and the gap holds whatever the answer was.
     * @returns {Promise<boolean>} Whether an address or a token changed.
     */
    ask(kinopoiskId) {
        if (this.asking) return this.asking;
        if (Date.now() - this.askedAt < KP_BALANCER_ASK_GAP_MS) return Promise.resolve(false);
        this.askedAt = Date.now();
        this.asking = (async () => {
            try {
                // Before the request, so that another page does not ask as well.
                await this.save();
                const response = await fetch(`${KP_BALANCER_LIST_URL}?kinopoisk=${encodeURIComponent(kinopoiskId)}`, {
                    credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(KP_BALANCER_LIST_TIMEOUT_MS)
                });
                if (!response.ok) return false;
                // Anything but the list (a challenge page, an error) fails to parse here.
                const changed = this.apply(this.parseList(await response.json()));
                if (changed) await this.save();
                return changed;
            } catch {
                return false;
            } finally {
                this.asking = null;
            }
        })();
        return this.asking;
    }
};

class KpBalancerParser extends BaseParserService {
    /** @param {'collaps'|'alloha'|'veoveo'} balancerId */
    constructor(balancerId) {
        const balancer = KP_BALANCERS[balancerId];
        if (!balancer) throw new Error(`Unknown balancer: ${balancerId}`);
        super({ id: balancerId, name: balancer.name, baseUrl: balancer.site });
        /** @private @type {Map<string, number>} */
        this._misses = new Map();
    }

    static get IDS() {
        return Object.keys(KP_BALANCERS);
    }

    /** @returns {string|null} A real Kinopoisk ID, or null: a name must never stand in for one. */
    static kinopoiskId(value) {
        const id = typeof value === 'number' ? String(value) : value;
        return typeof id === 'string' && /^[1-9]\d{0,9}$/.test(id) ? id : null;
    }

    getSearchCacheKey(_title, _year, options = {}) {
        return `kp_${KpBalancerParser.kinopoiskId(options?.kinopoiskId) || ''}`;
    }

    /**
     * @param {string} title Kept for the result only; the balancer is asked by ID.
     * @param {string|number|null} _year
     * @param {{kinopoiskId?: string|number}} [options]
     */
    async search(title, _year, options = {}) {
        const id = KpBalancerParser.kinopoiskId(options?.kinopoiskId);
        if (!id) return null;
        const missedAt = this._misses.get(id);
        if (missedAt && Date.now() - missedAt < KP_BALANCER_MISS_TTL_MS) return null;

        const url = await this.resolveEmbed(id);
        if (!url) {
            if (this._misses.size >= KP_BALANCER_MISS_LIMIT) this._misses.delete(this._misses.keys().next().value);
            this._misses.set(id, Date.now());
            return null;
        }
        this._misses.delete(id);
        return { url, title: String(title || ''), year: null, parserId: this.id, source: this.id, titleVerified: true };
    }

    async getVideoSources(searchResult) {
        const url = typeof searchResult === 'string' ? searchResult : searchResult?.url;
        return this.ownsEmbed(url) ? [{ name: this.name, url, type: 'iframe', parserId: this.id }] : [];
    }

    clearCache() {
        super.clearCache();
        this._misses.clear();
    }

    /**
     * Alloha's frame for a series opens on its last episode, and its own menu drops to
     * the first episode when the season is changed under it. It takes the season and
     * episode in the address instead, so the frame opens on the viewer's episode.
     */
    getFrameUrl(source, options = {}) {
        const season = Number(options?.season);
        const episode = Number(options?.episode);
        if (this.id !== 'alloha' || !Number.isInteger(season) || season < 1 || !Number.isInteger(episode) || episode < 1) {
            return source.url;
        }
        try {
            const url = new URL(source.url);
            url.searchParams.set('season', String(season));
            url.searchParams.set('episode', String(episode));
            return url.href;
        } catch {
            return source.url;
        }
    }

    /** Whether an address is this balancer's frame, on a host the extension knows. */
    ownsEmbed(sourceUrl) {
        try {
            const url = new URL(String(sourceUrl || ''));
            if (url.protocol !== 'https:') return false;
            if (this.id === 'collaps') {
                return Boolean(BalancerDomains.domainOf(url.hostname)) && /^\/embed\/kp\/[1-9]\d*$/.test(url.pathname);
            }
            const access = KpBalancerAccess.accept(this.id, { host: url.hostname, token: url.searchParams.get('token') });
            return Boolean(access) && (this.id !== 'veoveo' || url.pathname === '/balancer-api/iframe');
        } catch {
            return false;
        }
    }

    /**
     * @returns {Promise<string|null>} The frame address, or null when the balancer says
     * it has no such title. Anything else it answers is an error, and is not remembered.
     */
    resolveEmbed(id) {
        return this.id === 'collaps' ? this._resolveCollaps(id) : this._resolveWithToken(id);
    }

    /** @private */
    async _answer(url) {
        return this.fetchWithTimeout(url, { credentials: 'omit', cache: 'no-store' });
    }

    /** @private */
    async _resolveCollaps(id) {
        await BalancerDomains.load();
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const url = `https://${BalancerDomains.actualHost}/embed/kp/${id}`;
            const response = await this._answer(url);
            try { await response.body?.cancel?.(); } catch { /* ignore */ }
            if (response.ok) {
                // The base renderer would ask the same question again.
                this._embedChecks.set(url, { timestamp: Date.now(), promise: Promise.resolve(true) });
                return url;
            }
            if (response.status === 404 || response.status === 410) return null;
            // What a domain the balancer has left answers.
            if (response.status === 422 && attempt === 0 && await BalancerDomains.refresh({ force: true })) continue;
            throw new Error(`${this.name} answered ${response.status}`);
        }
        return null;
    }

    /** @private */
    async _resolveWithToken(id) {
        await KpBalancerAccess.load();
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const { host, token } = KpBalancerAccess[this.id];
            const embed = new URL(this.id === 'veoveo' ? `https://${host}/balancer-api/iframe` : `https://${host}/`);
            embed.searchParams.set('kp', id);
            embed.searchParams.set('token', token);
            const probe = new URL(embed);
            // Alloha answers only a request that names a site; the Referer rule reads this mark.
            if (this.id === 'alloha') probe.searchParams.set('movieExtensionSite', new URL(this.baseUrl).hostname);

            const response = await this._answer(probe.href);
            if (response.ok) {
                if (this.id !== 'alloha') {
                    try { await response.body?.cancel?.(); } catch { /* ignore */ }
                    return embed.href;
                }
                // The frame keeps its place in a film by this token, so the address
                // matches the one KinoGo's pages print for the same film.
                const movieToken = /token_movie(?:=|\\u003D)([a-f0-9]{16,64})/i.exec(await response.text())?.[1];
                if (movieToken) {
                    embed.searchParams.delete('kp');
                    embed.searchParams.set('token_movie', movieToken);
                }
                return embed.href;
            }
            try { await response.body?.cancel?.(); } catch { /* ignore */ }
            if (response.status !== 404 && response.status !== 410) throw new Error(`${this.name} answered ${response.status}`);
            // No such title, or a token the balancer no longer takes: the two look the same.
            if (attempt === 0 && await KpBalancerAccess.ask(id)) continue;
            return null;
        }
        return null;
    }
}

if (typeof window !== 'undefined') {
    window.KpBalancerParser = KpBalancerParser;
    window.KpBalancerAccess = KpBalancerAccess;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { KpBalancerParser, KpBalancerAccess };
}
