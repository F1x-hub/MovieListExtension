/**
 * ProviderRatingsBackfill fills missing Kinopoisk/IMDb badges on MovieCard cards.
 *
 * Pages such as bookmarks, watchlist or search render cards from stored movie
 * data; a title stored without an IMDb rating kept showing "IMDb —" even though
 * Movie Details showed the rating. This service watches rendered cards, applies
 * ratings already in the shared card cache (movie_card_ratings_v4, kp:<id>)
 * and fetches the rest through the same path Movie Details uses (Kinopoisk
 * GraphQL, hidden page fallback), then stores them back in the shared cache.
 *
 * Enabled per page with <html data-provider-ratings-backfill="true">. Home and
 * catalog have MovieRatingsEnrichmentService instead; the Ratings page patches
 * its own state through select().
 */
class ProviderRatingsBackfill {
    static CACHE_KEY = 'movie_card_ratings_v4';
    static CARD_SELECTOR = '.movie-card-component[data-movie-id]';
    static CONCURRENCY = 3;

    static rating(value) {
        const number = Number(value);
        return Number.isFinite(number) && number > 0 ? number : 0;
    }

    /**
     * Titles that still need provider ratings: a missing KP or IMDb rating,
     * unless the shared cache holds a real recent "no IMDb rating" answer
     * (imdbCheckVersion >= 2). Entries are {kinopoiskId, kpRating, imdbRating, mediaType}.
     */
    static select(entries, cache = {}, seen = new Set(), now = Date.now()) {
        const pending = [];
        for (const entry of Array.isArray(entries) ? entries : []) {
            const kinopoiskId = Number(entry?.kinopoiskId) || 0;
            if (kinopoiskId <= 0 || seen.has(kinopoiskId) || pending.some(item => item.kinopoiskId === kinopoiskId)) continue;
            const kpRating = this.rating(entry.kpRating);
            const imdbRating = this.rating(entry.imdbRating);
            if (kpRating > 0 && imdbRating > 0) continue;
            const record = cache?.[`kp:${kinopoiskId}`];
            const imdbSettled = imdbRating > 0
                || (Number(record?.imdbCheckVersion) >= 2 && Number(record?.imdbRetryAfter) > now);
            if (kpRating > 0 && imdbSettled) continue;
            pending.push({ kinopoiskId, mediaType: entry.mediaType || null });
        }
        return pending;
    }

    /** A cache record usable for badges (unexpired and carrying a rating). */
    static usableRecord(record, now = Date.now()) {
        if (!record || !(Number(record.expiresAt) > now)) return null;
        const kpRating = this.rating(record.kpRating);
        const imdbRating = this.rating(record.imdbRating);
        return kpRating > 0 || imdbRating > 0 ? { kpRating, imdbRating, imdbId: record.imdbId || null } : null;
    }

    constructor({
        root = globalThis.document?.body,
        storage = globalThis.chrome?.storage?.local,
        getRatings = null,
        persist = null,
        updateCard = (card, ratings) => globalThis.MovieCard?.updateCompactRatings?.(card, ratings)
    } = {}) {
        this.root = root;
        this.storage = storage;
        this.getRatings = getRatings || (id => ProviderRatingsBackfill.defaultGetRatings(id));
        this.persist = persist || ((id, record) => ProviderRatingsBackfill.defaultPersist(id, record));
        this.updateCard = updateCard;
        this.seen = new Set();
        this.results = new Map(); // kinopoiskId -> ratings found this page session
        this.timer = null;
        this.running = Promise.resolve();
        this.observer = null;
    }

    static async defaultGetRatings(kinopoiskId) {
        const service = globalThis.firebaseManager?.getKinopoiskService?.();
        if (service?.scrapeMoviePageRatingsOffscreen) {
            return service.scrapeMoviePageRatingsOffscreen(kinopoiskId, {
                requestKey: `card-backfill:${kinopoiskId}`,
                priority: 'below-viewport'
            });
        }
        // Pages without KinopoiskService still get the GraphQL ratings.
        if (typeof globalThis.KinopoiskGraphqlService === 'function') {
            return new globalThis.KinopoiskGraphqlService().getMovieRatings(kinopoiskId);
        }
        return null;
    }

    static async defaultPersist(kinopoiskId, record) {
        if (typeof globalThis.RatingsRefreshService !== 'function') return;
        await new globalThis.RatingsRefreshService({ db: null }).persistCardRatingPatch(kinopoiskId, record);
    }

    start() {
        if (!this.root || typeof MutationObserver === 'undefined') return this;
        this.observer = new MutationObserver(() => this.schedule());
        this.observer.observe(this.root, { childList: true, subtree: true });
        this.schedule();
        return this;
    }

    stop() {
        this.observer?.disconnect();
        this.observer = null;
        if (this.timer) clearTimeout(this.timer);
    }

    schedule(delay = 300) {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.timer = null;
            this.running = this.running.then(() => this.scan()).catch(error => {
                console.warn('[ProviderRatingsBackfill] Scan failed:', error?.message || error);
            });
        }, delay);
    }

    cards() {
        return Array.from(this.root?.querySelectorAll?.(ProviderRatingsBackfill.CARD_SELECTOR) || [])
            .filter(card => !card.classList?.contains('mc-is-loading'));
    }

    cardEntry(card) {
        return {
            kinopoiskId: Number(card.dataset.movieId) || 0,
            kpRating: card.dataset.kpRating,
            imdbRating: card.dataset.imdbRating,
            mediaType: card.dataset.mediaType || null
        };
    }

    apply(kinopoiskId, ratings) {
        for (const card of this.cards()) {
            if (Number(card.dataset.movieId) !== kinopoiskId) continue;
            const entry = this.cardEntry(card);
            const kpMissing = ProviderRatingsBackfill.rating(entry.kpRating) <= 0 && ratings.kpRating > 0;
            const imdbMissing = ProviderRatingsBackfill.rating(entry.imdbRating) <= 0 && ratings.imdbRating > 0;
            if (kpMissing || imdbMissing) this.updateCard(card, ratings);
        }
    }

    async readCache() {
        if (!this.storage?.get) return {};
        try {
            const stored = await this.storage.get(ProviderRatingsBackfill.CACHE_KEY);
            return stored?.[ProviderRatingsBackfill.CACHE_KEY] || {};
        } catch {
            return {};
        }
    }

    async scan() {
        const entries = this.cards().map(card => this.cardEntry(card));
        // Ratings found earlier this session go to re-rendered cards right away.
        for (const [kinopoiskId, ratings] of this.results) this.apply(kinopoiskId, ratings);

        const cache = await this.readCache();
        for (const entry of entries) {
            const record = ProviderRatingsBackfill.usableRecord(cache[`kp:${entry.kinopoiskId}`]);
            if (record) this.apply(entry.kinopoiskId, record);
        }

        const fresh = this.cards().map(card => this.cardEntry(card));
        const pending = ProviderRatingsBackfill.select(fresh, cache, this.seen);
        if (pending.length === 0) return;
        pending.forEach(({ kinopoiskId }) => this.seen.add(kinopoiskId));

        const queue = [...pending];
        const worker = async () => {
            while (queue.length > 0) {
                const { kinopoiskId } = queue.shift();
                try {
                    const found = await this.getRatings(kinopoiskId);
                    if (!found) continue;
                    const ratings = {
                        kpRating: ProviderRatingsBackfill.rating(found.kpRating),
                        imdbRating: ProviderRatingsBackfill.rating(found.imdbRating),
                        imdbId: found.imdbId || null
                    };
                    if (ratings.kpRating > 0 || ratings.imdbRating > 0) {
                        this.results.set(kinopoiskId, ratings);
                        this.apply(kinopoiskId, ratings);
                    }
                    await this.persist(kinopoiskId, {
                        ...ratings,
                        votes: { kp: Number(found.kpVotes) || 0, imdb: Number(found.imdbVotes) || 0 },
                        imdbChecked: found.imdbAnswered !== false
                    });
                } catch (error) {
                    console.warn('[ProviderRatingsBackfill] Rating fetch failed:', kinopoiskId, error?.message || error);
                }
            }
        };
        await Promise.all(Array.from({ length: ProviderRatingsBackfill.CONCURRENCY }, worker));
    }
}

if (typeof globalThis !== 'undefined') globalThis.ProviderRatingsBackfill = ProviderRatingsBackfill;
if (typeof module !== 'undefined' && module.exports) module.exports = ProviderRatingsBackfill;

if (typeof document !== 'undefined' && document.documentElement?.dataset?.providerRatingsBackfill === 'true') {
    const startBackfill = () => { globalThis.providerRatingsBackfill ||= new ProviderRatingsBackfill().start(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startBackfill, { once: true });
    else startBackfill();
}
