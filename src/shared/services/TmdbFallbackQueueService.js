/**
 * Stores administrator-confirmed IMDb mappings separately from the queue of
 * incomplete KP responses. A mapping is the only additional source of an IMDb
 * ID accepted by the TMDB fallback.
 */
class TmdbFallbackQueueService {
    constructor(firebaseManagerInstance = null) {
        this.firebaseManager = firebaseManagerInstance;
        this.queueCollection = 'tmdbFallbackQueue';
        this.mappingCollection = 'tmdbMovieMappings';
    }

    get db() {
        return this.getFirebaseManager()?.db || null;
    }

    getFirebaseManager() {
        return this.firebaseManager ||
            (typeof firebaseManager !== 'undefined' ? firebaseManager : null);
    }

    static isValidImdbId(imdbId) {
        return typeof imdbId === 'string' && /^tt\d{7,10}$/i.test(imdbId.trim());
    }

    async getManualImdbId(kinopoiskId) {
        if (!this.db || !kinopoiskId) return null;

        try {
            const mapping = await this.db.collection(this.mappingCollection)
                .doc(String(kinopoiskId)).get();
            const imdbId = mapping.exists ? mapping.data()?.imdbId?.trim() : null;
            return TmdbFallbackQueueService.isValidImdbId(imdbId) ? imdbId : null;
        } catch (error) {
            console.warn('[TMDB fallback] Could not read manual IMDb mapping:', error.message);
            return null;
        }
    }

    async reportMissingImdb(movie) {
        const kinopoiskId = movie?.kinopoiskId;
        if (!this.db || !kinopoiskId || !this.getFirebaseManager()?.isAuthenticated?.()) return;

        try {
            const queueRef = this.db.collection(this.queueCollection).doc(String(kinopoiskId));
            const existing = await queueRef.get();
            if (existing.exists) return;

            await queueRef.set({
                kinopoiskId: Number(kinopoiskId),
                name: movie.name || '',
                alternativeName: movie.alternativeName || '',
                year: movie.year || null,
                posterUrl: movie.posterUrl || '',
                reason: 'missing_imdb_id',
                status: 'pending',
                reportedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            console.info('[TMDB fallback] queued for manual IMDb mapping:', { kinopoiskId });
        } catch (error) {
            // A concurrent report can win the create race; it is already queued.
            if (error.code !== 'permission-denied' && error.code !== 'already-exists') {
                console.warn('[TMDB fallback] Could not queue missing IMDb ID:', error.message);
            }
        }
    }

    async getPendingItems() {
        if (!this.db) return [];
        const snapshot = await this.db.collection(this.queueCollection)
            .where('status', '==', 'pending')
            .orderBy('reportedAt', 'desc')
            .get();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }

    async saveManualMapping(item, imdbId, adminId) {
        const normalizedImdbId = imdbId?.trim();
        if (!TmdbFallbackQueueService.isValidImdbId(normalizedImdbId)) {
            throw new Error('IMDb ID must use the format tt1234567');
        }
        if (!this.db || !item?.kinopoiskId) throw new Error('Movie queue item is missing');

        const movieId = String(item.kinopoiskId);
        const batch = this.db.batch();
        batch.set(this.db.collection(this.mappingCollection).doc(movieId), {
            kinopoiskId: Number(item.kinopoiskId),
            imdbId: normalizedImdbId,
            confirmedBy: adminId,
            confirmedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        batch.set(this.db.collection(this.queueCollection).doc(movieId), {
            status: 'resolved',
            imdbId: normalizedImdbId,
            resolvedBy: adminId,
            resolvedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        await batch.commit();
    }
}

if (typeof window !== 'undefined') {
    window.TmdbFallbackQueueService = TmdbFallbackQueueService;
}
