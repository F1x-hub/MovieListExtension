/**
 * Loads the data achievements are counted from and stores reached tiers.
 *
 * Some sources are readable only by their owner (reactions the user gave), so
 * progress is recomputed only for the signed-in user. The result is stored on
 * users/{uid} as `achievements` ({id: {tier, at: {tier: ISO date}}}; the cat trail adds `steps`) plus
 * `achievementPoints`, and other users see that stored snapshot.
 *
 * Reads: the ratings snapshot ProfileService already shares, one batched
 * movie-metadata read, and `in`/equality queries that bill only for matches.
 */
import { evaluateAll, computeMetrics, mergeUnlocks, totalPoints } from './AchievementEngine.js';
import { TRAIL_ID, TRAIL_STEPS, trailSteps } from './catTrail.js';

const IN_QUERY_CHUNK = 30;
const chunk = (values, size) => {
    const chunks = [];
    for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
    return chunks;
};

export class AchievementService {
    constructor({ db, profileService }) {
        this.db = db;
        this.profileService = profileService;
    }

    async safe(label, work, fallback) {
        try {
            return await work();
        } catch (error) {
            console.warn(`[Achievements] ${label} unavailable:`, error?.code || error?.message || error);
            return fallback;
        }
    }

    async loadData(uid, profile = {}) {
        const ratings = await this.profileService.getSortedUniqueRatings(uid);
        const movieIds = [...new Set(ratings.map(rating => rating.movieId).filter(Boolean).map(String))];
        const reactableIds = ratings
            .filter(rating => rating?.id && [rating.comment, rating.review].some(text => typeof text === 'string' && text.trim()))
            .map(rating => String(rating.id));
        const documentId = firebase.firestore.FieldPath.documentId();
        const countWhere = (collection, field, value, extra = null) => this.safe(collection, async () => {
            let query = this.db.collection(collection).where(field, '==', value);
            if (extra) query = query.where(extra[0], '==', extra[1]);
            return (await query.get()).size;
        }, 0);

        const [movies, reactionSummaries, reactionsGiven, marathonItems, watchlistCount, watchingCount, collections] = await Promise.all([
            this.safe('movies', () => movieIds.length ? this.profileService.movieCacheService.getBatchCachedMovies(movieIds) : {}, {}),
            this.safe('reactions', async () => {
                const snapshots = await Promise.all(chunk(reactableIds, IN_QUERY_CHUNK).map(part => this.db
                    .collection('commentReactionSummaries').where(documentId, 'in', part).get()));
                return snapshots.flatMap(snapshot => snapshot.docs.map(doc => doc.data()));
            }, []),
            countWhere('commentReactions', 'userId', uid),
            this.safe('marathon', async () => (await this.db.collection('randomMarathons').doc('current')
                .collection('items').where('addedBy', '==', uid).get()).docs.map(doc => doc.data()), []),
            countWhere('favorites', 'userId', uid, ['status', 'plan_to_watch']),
            countWhere('favorites', 'userId', uid, ['status', 'watching']),
            this.safe('collections', async () => (await this.db.collection('users').doc(uid)
                .collection('collections').get()).docs.map(doc => doc.data()), [])
        ]);

        return {
            ratings,
            movies,
            reactionSummaries,
            reactionsGiven,
            marathonItems,
            watchlistCount,
            watchingCount,
            collections,
            catTrail: trailSteps(profile.achievements),
            pinned: Array.isArray(profile.pinnedMovies) ? profile.pinnedMovies : [],
            createdAt: profile.createdAt,
            now: Date.now()
        };
    }

    /**
     * Recomputes the signed-in user's achievements and saves new tiers.
     * @returns {Promise<{results: Array, metrics: Object, stored: Object, unlocked: Array, points: number}>}
     */
    async sync(uid, profile = {}) {
        const data = await this.loadData(uid, profile);
        const metrics = computeMetrics(data);
        const results = evaluateAll(metrics);
        const stored = profile.achievements && typeof profile.achievements === 'object' ? profile.achievements : {};
        const merged = mergeUnlocks(stored, results);
        const points = totalPoints(merged.stored);
        if (merged.changed || Number(profile.achievementPoints) !== points) {
            // Only the entries that changed: a profile read from an old cache must not take back
            // what another tab earned, and petting the cat cannot be recomputed.
            await this.db.collection('users').doc(uid).update({
                ...Object.fromEntries(merged.changedIds.map(id => [`achievements.${id}`, merged.stored[id]])),
                achievementPoints: points,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
        const steps = trailSteps(merged.stored);
        return {
            results, metrics, stored: merged.stored, unlocked: merged.unlocked, points,
            trailStep: steps > trailSteps(stored) ? steps : 0
        };
    }

    /** The last step of the cat trail. @returns {Promise<{stored: Object, points: number}>} */
    async completeTrail(uid, stored = {}) {
        const entry = { tier: 1, at: { 1: new Date().toISOString() }, steps: TRAIL_STEPS };
        const next = { ...stored, [TRAIL_ID]: entry };
        const points = totalPoints(next);
        await this.db.collection('users').doc(uid).update({
            [`achievements.${TRAIL_ID}`]: entry,
            achievementPoints: points,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        return { stored: next, points };
    }
}
