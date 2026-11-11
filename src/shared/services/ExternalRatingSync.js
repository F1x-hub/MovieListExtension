/**
 * ExternalRatingSync mirrors extension ratings to the user's accounts on other
 * movie sites (IMDb, Kinopoisk).
 *
 * Neither site has a public personal rating API: each provider reads the
 * current score and uses the site's GraphQL mutations to change it.
 * Authentication is the browser's own session on that site; the extension never
 * reads, copies or stores cookie values.
 *
 * The background service worker owns the network calls (host permissions);
 * pages only call ExternalRatingSync.requestSync().
 */
class ExternalRatingSync {
    // Overridden by providers.
    static PROVIDER = '';
    static SIGN_IN_URL = '';
    static MAX_ATTEMPTS = 5;
    static MAX_QUEUE = 200;

    static get SETTINGS_KEY() { return `integrations_${this.PROVIDER}`; }
    static get QUEUE_KEY() { return `integrations_${this.PROVIDER}_queue`; }
    static get RETRY_ALARM() { return `${this.PROVIDER}-rating-sync-retry`; }

    /** Whole stars 1-10 on both sites. */
    static normalizeRating(value) {
        const rating = Math.round(Number(value));
        return Number.isInteger(rating) && rating >= 1 && rating <= 10 ? rating : null;
    }

    constructor({ chromeApi = globalThis.chrome, fetchImpl = (...args) => globalThis.fetch(...args) } = {}) {
        this.chrome = chromeApi;
        this.fetch = fetchImpl;
        this.syncChain = Promise.resolve();
    }

    get keys() {
        return this.constructor;
    }

    // --- Provider hooks -----------------------------------------------------------

    /** @returns {Promise<boolean>} */
    async isSignedIn() { return false; }
    /** Provider title ID for a sync request, or null when unknown. */
    async resolveTitleId() { return null; }
    async getPersonalRating() { throw new Error('not implemented'); }
    async setRating() { throw new Error('not implemented'); }
    async removeRating() { throw new Error('not implemented'); }
    /** Cookie change that may mean the user just signed in. */
    isSessionCookie() { return false; }

    // --- Settings and status ------------------------------------------------------

    async getSettings() {
        const stored = await this.chrome.storage.local.get(this.keys.SETTINGS_KEY);
        const settings = stored[this.keys.SETTINGS_KEY] || {};
        return { enabled: settings.enabled === true, pendingConnect: settings.pendingConnect === true };
    }

    async saveSettings(patch) {
        const next = { ...(await this.getSettings()), ...patch };
        await this.chrome.storage.local.set({ [this.keys.SETTINGS_KEY]: next });
        return next;
    }

    /** Session check that never throws; failures are logged for diagnostics. */
    async checkSignedIn() {
        try {
            return await this.isSignedIn();
        } catch (error) {
            console.warn(`[${this.keys.PROVIDER} sync] Sign-in check failed:`, error.message);
            return false;
        }
    }

    async getStatus() {
        const [settings, signedIn, queue] = await Promise.all([this.getSettings(), this.checkSignedIn(), this.readQueue()]);
        let { enabled, pendingConnect } = settings;
        // Completes a sign-in started from the settings toggle.
        if (pendingConnect && signedIn) {
            ({ enabled, pendingConnect } = await this.saveSettings({ enabled: true, pendingConnect: false }));
            void this.flushQueue();
        }
        return { provider: this.keys.PROVIDER, enabled, pendingConnect, signedIn, connected: enabled && signedIn, pending: queue.length };
    }

    /**
     * Turns the integration on. Without a session the sign-in page opens and the
     * toggle completes once the user is signed in.
     */
    async connect() {
        if (await this.checkSignedIn()) {
            await this.saveSettings({ enabled: true, pendingConnect: false });
            void this.flushQueue();
            return this.getStatus();
        }
        await this.saveSettings({ enabled: false, pendingConnect: true });
        await this.chrome.tabs.create({ url: this.keys.SIGN_IN_URL });
        return this.getStatus();
    }

    /** Stops syncing; the site session itself is left untouched. */
    async disconnect() {
        await this.serializeSync(async () => {
            await this.saveSettings({ enabled: false, pendingConnect: false });
            await this.chrome.storage.local.remove(this.keys.QUEUE_KEY);
        });
        return this.getStatus();
    }

    async handleCookieChange(changeInfo) {
        if (changeInfo?.removed || !this.isSessionCookie(changeInfo?.cookie)) return;
        const settings = await this.getSettings();
        if (settings.pendingConnect) await this.getStatus();
    }

    // --- Sync ---------------------------------------------------------------------

    /**
     * Syncs one rating change. rating === null removes the site rating.
     * @returns {Promise<{status: 'synced'|'skipped'|'queued'|'failed', reason?: string}>}
     */
    sync(request = {}) {
        return this.serializeSync(() => this.syncRating(request));
    }

    // Keep direct syncs and retries in order while they read and write site state.
    serializeSync(operation) {
        const result = this.syncChain.then(operation);
        this.syncChain = result.catch(() => {});
        return result;
    }

    async syncRating(request) {
        const settings = await this.getSettings();
        if (!settings.enabled) return { status: 'skipped', reason: 'disabled' };

        const titleId = await this.resolveTitleId(request);
        if (!titleId) return { status: 'skipped', reason: 'no_title_id' };

        const rating = request.rating ?? null;
        const value = rating === null ? null : ExternalRatingSync.normalizeRating(rating);
        if (rating !== null && value === null) return { status: 'skipped', reason: 'invalid_rating' };

        const job = { titleId, rating: value, attempts: 0 };
        try {
            const result = await this.runJob(job);
            // The current score supersedes any queued attempt for the same title.
            await this.dropQueued(titleId);
            return result;
        } catch (error) {
            console.warn(`[${this.keys.PROVIDER} sync] Rating sync failed:`, error.message);
            if (error.authFailed) {
                await this.saveSettings({ enabled: false, pendingConnect: false });
                return { status: 'failed', reason: 'signed_out' };
            }
            if (error.retryable === false) {
                await this.dropQueued(titleId);
                return { status: 'failed', reason: error.message };
            }
            await this.enqueue({ ...job, attempts: 1 });
            return { status: 'queued', reason: error.message };
        }
    }

    async runJob({ titleId, rating }) {
        if (rating === null) {
            await this.removeRating(titleId);
        } else {
            if (await this.getPersonalRating(titleId) === rating) {
                return { status: 'skipped', reason: 'already_rated' };
            }
            await this.setRating(titleId, rating);
        }
        return { status: 'synced' };
    }

    /** POSTs a GraphQL body and returns `data`, classifying failures for the queue. */
    async postGraphql(url, body, headers) {
        const response = await this.fetch(url, {
            method: 'POST',
            credentials: 'include',
            headers: { 'content-type': 'application/json', ...headers },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(10000)
        });
        if (!response.ok) {
            const error = new Error(`${this.keys.PROVIDER} returned HTTP ${response.status}`);
            error.retryable = response.status >= 500 || response.status === 429;
            error.authFailed = response.status === 401 || response.status === 403;
            throw error;
        }
        const payload = await response.json();
        if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
            throw ExternalRatingSync.graphqlError(payload.errors.map(item => item?.message).filter(Boolean).join('; '));
        }
        return payload?.data || null;
    }

    static graphqlError(message) {
        const error = new Error(message || 'GraphQL error');
        error.authFailed = /auth|sign.?in|login|unauthori[sz]ed|forbidden/i.test(error.message);
        error.retryable = false;
        return error;
    }

    // --- Retry queue --------------------------------------------------------------

    async readQueue() {
        const stored = await this.chrome.storage.local.get(this.keys.QUEUE_KEY);
        return Array.isArray(stored[this.keys.QUEUE_KEY]) ? stored[this.keys.QUEUE_KEY] : [];
    }

    /** Called from serialized sync operations. */
    async updateQueue(mutator) {
        try {
            const next = mutator(await this.readQueue()).slice(-this.keys.MAX_QUEUE);
            await this.chrome.storage.local.set({ [this.keys.QUEUE_KEY]: next });
        } catch (error) {
            console.warn(`[${this.keys.PROVIDER} sync] Queue update failed:`, error);
        }
    }

    async enqueue(job) {
        // Only the latest value per title matters.
        await this.updateQueue(queue => [...queue.filter(item => item.titleId !== job.titleId), job]);
        this.chrome.alarms?.create(this.keys.RETRY_ALARM, { delayInMinutes: 1 });
    }

    dropQueued(titleId) {
        return this.updateQueue(queue => queue.filter(item => item.titleId !== titleId));
    }

    async flushQueue() {
        for (const job of await this.readQueue()) {
            await this.serializeSync(() => this.retryJob(job));
        }
        if ((await this.getSettings()).enabled && (await this.readQueue()).length > 0) {
            this.chrome.alarms?.create(this.keys.RETRY_ALARM, { delayInMinutes: 5 });
        }
    }

    async retryJob(job) {
        if (!(await this.getSettings()).enabled) return;
        // A direct sync may have replaced or removed this job since the snapshot.
        const current = (await this.readQueue()).find(item => item.titleId === job.titleId);
        if (!current || current.rating !== job.rating || current.attempts !== job.attempts) return;

        try {
            await this.runJob(current);
        } catch (error) {
            if (error.authFailed) {
                await this.saveSettings({ enabled: false, pendingConnect: false });
                return;
            }
            const attempts = (current.attempts || 0) + 1;
            if (error.retryable !== false && attempts < this.keys.MAX_ATTEMPTS) {
                await this.updateQueue(queue => queue.map(item => item.titleId === current.titleId ? { ...item, attempts } : item));
                return;
            }
        }
        await this.dropQueued(current.titleId);
    }

    // --- Page-side helpers (no network, just messages to the background) ---------

    static send(message) {
        try {
            if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return Promise.resolve(null);
            return chrome.runtime.sendMessage(message).catch(() => null);
        } catch {
            return Promise.resolve(null);
        }
    }

    /** Fire-and-forget: the extension rating is already saved; sites are best effort. */
    static requestSync({ kinopoiskId, movie = null, imdbId = null, rating = null }) {
        return ExternalRatingSync.send({
            type: 'EXTERNAL_SYNC_RATING',
            kinopoiskId: kinopoiskId ? String(kinopoiskId) : null,
            imdbId: imdbId || ImdbRatingSync.extractImdbId(movie),
            rating
        });
    }
}

class ImdbRatingSync extends ExternalRatingSync {
    static PROVIDER = 'imdb';
    static ENDPOINT = 'https://api.graphql.imdb.com/';
    static SIGN_IN_URL = 'https://www.imdb.com/registration/signin';
    static COOKIE_URL = 'https://www.imdb.com/';
    // Amazon/IMDb sign-in cookies; any of them means a signed-in browser session.
    static SESSION_COOKIES = ['at-main', 'sess-at-main'];
    static ID_MAP_KEY = 'integrations_imdb_ids';

    static PERSONAL_RATING_QUERY = 'query TitleUserRating($titleId: ID!) { title(id: $titleId) { id userRating { value } } }';
    static RATE_MUTATION = 'mutation UpdateTitleRating($rating: Int!, $titleId: ID!) {\n  rateTitle(input: {rating: $rating, titleId: $titleId}) {\n    rating {\n      value\n    }\n  }\n}';
    static DELETE_MUTATION = 'mutation DeleteTitleRating($titleId: ID!) {\n  deleteTitleRating(input: {titleId: $titleId}) {\n    date\n  }\n}';

    static isValidImdbId(value) {
        return /^tt\d{7,10}$/.test(String(value || '').trim());
    }

    /** IMDb ID from any movie shape the extension stores (Kinopoisk, TMDB, cache). */
    static extractImdbId(movie) {
        const candidates = [
            movie?.externalId?.imdb,
            movie?.imdbId,
            movie?.imdb_id,
            movie?.identity?.imdbId,
            movie?.external_ids?.imdb_id
        ];
        return candidates.map(value => String(value || '').trim()).find(ImdbRatingSync.isValidImdbId) || null;
    }

    async isSignedIn() {
        if (!this.chrome.cookies?.get) return false;
        for (const name of ImdbRatingSync.SESSION_COOKIES) {
            if (await this.chrome.cookies.get({ url: ImdbRatingSync.COOKIE_URL, name })) return true;
        }
        return false;
    }

    isSessionCookie(cookie) {
        return Boolean(cookie && ImdbRatingSync.SESSION_COOKIES.includes(cookie.name)
            && String(cookie.domain || '').replace(/^\./, '').endsWith('imdb.com'));
    }

    async resolveTitleId({ kinopoiskId = null, imdbId = null }) {
        const stored = await this.chrome.storage.local.get(ImdbRatingSync.ID_MAP_KEY);
        const map = stored[ImdbRatingSync.ID_MAP_KEY] || {};
        if (ImdbRatingSync.isValidImdbId(imdbId)) {
            // Remembered so a later deletion without movie data still finds the title.
            if (kinopoiskId && map[kinopoiskId] !== imdbId) {
                map[kinopoiskId] = imdbId;
                await this.chrome.storage.local.set({ [ImdbRatingSync.ID_MAP_KEY]: map });
            }
            return imdbId;
        }
        return (kinopoiskId && map[kinopoiskId]) || null;
    }

    graphql(query, operationName, variables) {
        return this.postGraphql(ImdbRatingSync.ENDPOINT, { query, operationName, variables }, {
            accept: 'application/graphql+json, application/json',
            'x-imdb-client-name': 'imdb-web-next-localized'
        });
    }

    async getPersonalRating(titleId) {
        const data = await this.graphql(ImdbRatingSync.PERSONAL_RATING_QUERY, 'TitleUserRating', { titleId });
        if (data?.title?.userRating === undefined) throw new Error('IMDb did not return the personal rating');
        return data.title.userRating?.value ?? null;
    }

    async setRating(titleId, rating) {
        const data = await this.graphql(ImdbRatingSync.RATE_MUTATION, 'UpdateTitleRating', { rating, titleId });
        if (data?.rateTitle?.rating?.value !== rating) throw new Error('IMDb did not confirm the rating');
    }

    async removeRating(titleId) {
        await this.graphql(ImdbRatingSync.DELETE_MUTATION, 'DeleteTitleRating', { titleId });
    }
}

class KinopoiskRatingSync extends ExternalRatingSync {
    static PROVIDER = 'kinopoisk';
    static ENDPOINT = 'https://graphql.kinopoisk.ru/graphql/';
    static SIGN_IN_URL = 'https://passport.yandex.ru/auth?retpath=https%3A%2F%2Fwww.kinopoisk.ru%2F';

    static SET_MUTATION = 'mutation MovieSetVote($movieId: Long!, $rate: Int!) {\n  movie {\n    vote {\n      set(input: {movieId: $movieId, rate: $rate}) {\n        error {\n          message\n          __typename\n        }\n        status\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n';
    static REMOVE_MUTATION = 'mutation MovieRemoveVote($movieId: Long!) {\n  movie {\n    vote {\n      remove(input: {movieId: $movieId}) {\n        error {\n          message\n          __typename\n        }\n        status\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n';
    // Kinopoisk only accepts query texts its own site sends ("the query is not
    // allowed" otherwise), so every query here is copied verbatim from kinopoisk.ru.
    static PROFILE_QUERY = 'query UserProfileModerator { userProfile { ...UserId ... on UserProfile { roles { moderator __typename } __typename } __typename } } fragment UserId on UserProfileInterface { id { ottId kpId puid __typename } __typename } ';
    static REQUEST_RULE_ID = 9101;

    /**
     * Kinopoisk only accepts the session from its own origin (KpAuth), so the
     * worker's own GraphQL requests get kinopoisk.ru Origin/Referer headers.
     * Scoped to requests initiated by this extension; page traffic is untouched.
     */
    static async installRequestRules(chromeApi = globalThis.chrome) {
        const dnr = chromeApi?.declarativeNetRequest;
        if (!dnr?.updateSessionRules) return;
        await dnr.updateSessionRules({
            removeRuleIds: [KinopoiskRatingSync.REQUEST_RULE_ID],
            addRules: [{
                id: KinopoiskRatingSync.REQUEST_RULE_ID,
                priority: 1,
                action: {
                    type: 'modifyHeaders',
                    requestHeaders: [
                        { header: 'origin', operation: 'set', value: 'https://www.kinopoisk.ru' },
                        { header: 'referer', operation: 'set', value: 'https://www.kinopoisk.ru/' }
                    ]
                },
                condition: {
                    urlFilter: '||graphql.kinopoisk.ru/graphql/',
                    initiatorDomains: [chromeApi.runtime.id],
                    resourceTypes: ['xmlhttprequest', 'other']
                }
            }]
        });
    }

    graphql(operationName, query, variables, { write = false } = {}) {
        const headers = { 'service-id': '25', 'x-preferred-language': 'ru' };
        // kinopoisk.ru sends source-id only with vote mutations.
        if (write) headers['source-id'] = '1';
        return this.postGraphql(`${KinopoiskRatingSync.ENDPOINT}?operationName=${operationName}`,
            { operationName, variables, query }, headers);
    }

    /** Asks Kinopoisk itself: no dependence on Yandex cookie names. */
    async isSignedIn() {
        const data = await this.graphql('UserProfileModerator', KinopoiskRatingSync.PROFILE_QUERY, {});
        return Boolean(data?.userProfile?.id?.kpId);
    }

    isSessionCookie(cookie) {
        const domain = String(cookie?.domain || '').replace(/^\./, '');
        return domain.endsWith('kinopoisk.ru') || domain.endsWith('yandex.ru');
    }

    async resolveTitleId({ kinopoiskId = null }) {
        const id = Number(kinopoiskId);
        return Number.isInteger(id) && id > 0 ? id : null;
    }

    static checkVoteResult(result) {
        if (!result) throw new Error('Kinopoisk did not confirm the vote');
        if (result.error) throw ExternalRatingSync.graphqlError(result.error.message || 'Kinopoisk vote error');
    }

    async getPersonalRating(movieId) {
        const { TOUCH_MOVIE_RATING_QUERY } = typeof module !== 'undefined' && module.exports
            ? require('./KinopoiskGraphqlService.js')
            : globalThis.KinopoiskGraphqlService;
        const data = await this.graphql('TouchMovieRating', TOUCH_MOVIE_RATING_QUERY, { movieId, withUserData: true });
        const voting = data?.movie?.userData?.voting;
        if (voting === undefined) throw new Error('Kinopoisk did not return the personal rating');
        return voting?.value ?? null;
    }

    async setRating(movieId, rate) {
        const data = await this.graphql('MovieSetVote', KinopoiskRatingSync.SET_MUTATION, { movieId, rate }, { write: true });
        KinopoiskRatingSync.checkVoteResult(data?.movie?.vote?.set);
    }

    async removeRating(movieId) {
        const data = await this.graphql('MovieRemoveVote', KinopoiskRatingSync.REMOVE_MUTATION, { movieId }, { write: true });
        KinopoiskRatingSync.checkVoteResult(data?.movie?.vote?.remove);
    }
}

if (typeof globalThis !== 'undefined') {
    Object.assign(globalThis, { ExternalRatingSync, ImdbRatingSync, KinopoiskRatingSync });
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ExternalRatingSync, ImdbRatingSync, KinopoiskRatingSync };
}
