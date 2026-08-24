/**
 * MigrationTool
 * Helper for migrating data between schema versions
 */
class MigrationTool {
    constructor(firebaseManager) {
        this.db = firebaseManager.db;
        this.displayLog = true;
    }

    log(message) {
        if (this.displayLog) {
            console.log(`[MigrationTool] ${message}`);
        }
    }

    /**
     * Migrate favorites from 'ratings' collection (isFavorite=true)
     * to new 'favorites' collection.
     * @param {string} userId - ID of user to migrate
     */
    async migrateFavoritesForUser(userId) {
        if (!userId) {
            throw new Error('User ID is required');
        }

        this.log(`Starting migration for user ${userId}...`);

        try {
            // 1. Get all favorite ratings
            const ratingsRef = this.db.collection('ratings');
            const snapshot = await ratingsRef
                .where('userId', '==', userId)
                .where('isFavorite', '==', true)
                .get();

            if (snapshot.empty) {
                this.log('No favorites found in ratings to migrate.');
                return { count: 0, status: 'success' };
            }

            this.log(`Found ${snapshot.size} favorites to migrate.`);

            const favoritesRef = this.db.collection('favorites');
            let batch = this.db.batch();
            let count = 0;
            let totalMigrated = 0;
            const BATCH_SIZE = 450; // Firestore batch limit is 500

            for (const doc of snapshot.docs) {
                const rating = doc.data();
                const movieId = rating.movieId || rating.id;
                
                // Construct favorite document ID
                const docId = `${userId}_${movieId}`;
                const favDocRef = favoritesRef.doc(docId);

                // Construct favorite data
                const favoriteData = {
                    userId: userId,
                    movieId: movieId,
                    movieTitle: rating.movieTitle || rating.name || '',
                    movieTitleRu: rating.movieTitleRu || '',
                    posterPath: rating.posterPath || rating.posterUrl || '',
                    releaseYear: rating.releaseYear || rating.year || null,
                    genres: rating.genres || [],
                    description: rating.description || '',
                    kpRating: rating.kpRating || 0,
                    imdbRating: rating.imdbRating || 0,
                    avgRating: rating.avgRating || 0,
                    // Use existing favoritedAt or createdAt
                    favoritedAt: rating.favoritedAt || rating.createdAt || firebase.firestore.FieldValue.serverTimestamp(),
                    // Store user rating info
                    userRating: rating.rating,
                    notes: rating.comment || '',
                    migratedAt: firebase.firestore.FieldValue.serverTimestamp()
                };

                batch.set(favDocRef, favoriteData);
                count++;

                if (count >= BATCH_SIZE) {
                    await batch.commit();
                    totalMigrated += count;
                    this.log(`Committed batch of ${count}. Total: ${totalMigrated}`);
                    batch = this.db.batch();
                    count = 0;
                }
            }

            if (count > 0) {
                await batch.commit();
                totalMigrated += count;
                this.log(`Committed final batch of ${count}.`);
            }

            this.log(`Migration complete. Successfully migrated ${totalMigrated} favorites.`);
            return { count: totalMigrated, status: 'success' };

        } catch (error) {
            console.error('Migration failed:', error);
            throw new Error(`Migration failed: ${error.message}`, { cause: error });
        }
    }

    /**
     * Migrate/Denormalize avgRating, ratingsSum, and ratingsCount to movies collection.
     * @param {boolean} dryRun - If true, only calculates and logs without performing Firestore writes.
     */
    async migrateMovieAvgRatings(dryRun = true) {
        this.log(`Starting avgRating migration (dryRun = ${dryRun})...`);

        try {
            const ratingsSnapshot = await this.db.collection('ratings').get();
            this.log(`Fetched ${ratingsSnapshot.size} total ratings documents.`);

            // Group ratings by movieId
            const movieStatsMap = new Map();

            const getTimestamp = (dateObj) => {
                if (!dateObj) return 0;
                if (dateObj.toDate) return dateObj.toDate().getTime();
                if (dateObj.toMillis) return dateObj.toMillis();
                if (dateObj.seconds) return dateObj.seconds * 1000;
                return new Date(dateObj).getTime() || 0;
            };

            ratingsSnapshot.forEach(doc => {
                const ratingData = doc.data();
                const movieId = ratingData.movieId;
                if (!movieId) return;

                const ratingVal = Number(ratingData.rating);
                if (isNaN(ratingVal)) return;

                const ratingTime = getTimestamp(ratingData.createdAt || ratingData.updatedAt);

                if (!movieStatsMap.has(movieId)) {
                    movieStatsMap.set(movieId, {
                        ratingsSum: 0,
                        ratingsCount: 0,
                        maxRatingTime: ratingTime,
                        ratings: []
                    });
                }

                const stats = movieStatsMap.get(movieId);
                stats.ratingsSum += ratingVal;
                stats.ratingsCount += 1;
                if (ratingTime > stats.maxRatingTime) {
                    stats.maxRatingTime = ratingTime;
                }
                stats.ratings.push(ratingVal);
            });

            this.log(`Grouped ratings for ${movieStatsMap.size} unique movies.`);

            const results = [];
            movieStatsMap.forEach((stats, movieId) => {
                const avgRating = stats.ratingsCount > 0 
                    ? Math.round((stats.ratingsSum / stats.ratingsCount) * 10) / 10 
                    : 0;

                results.push({
                    movieId,
                    ratingsSum: stats.ratingsSum,
                    ratingsCount: stats.ratingsCount,
                    avgRating,
                    maxRatingDate: stats.maxRatingTime ? new Date(stats.maxRatingTime) : new Date(),
                    hasCommunityRating: stats.ratingsCount > 0,
                    sampleRatings: stats.ratings
                });
            });

            if (dryRun) {
                this.log(`=== DRY-RUN RESULTS (${results.length} movies) ===`);
                const preview = results.slice(0, 20);
                console.table(preview.map(r => ({
                    'Movie ID': r.movieId,
                    'Ratings Sum': r.ratingsSum,
                    'Ratings Count': r.ratingsCount,
                    'Avg Rating': r.avgRating,
                    'hasCommunityRating': r.hasCommunityRating,
                    'Sample Ratings': r.sampleRatings.join(', ')
                })));

                return {
                    dryRun: true,
                    totalMoviesProcessed: results.length,
                    totalRatingsProcessed: ratingsSnapshot.size,
                    previewResults: preview,
                    allResults: results
                };
            }

            // Perform actual Firestore Batch Write
            this.log(`Executing Firestore Batch Write for ${results.length} movies...`);
            const moviesRef = this.db.collection('movies');
            let batch = this.db.batch();
            let count = 0;
            let totalUpdated = 0;
            const BATCH_SIZE = 400; // Firestore limit is 500

            for (const item of results) {
                const movieDocRef = moviesRef.doc(item.movieId.toString());
                batch.set(movieDocRef, {
                    kinopoiskId: Number(item.movieId),
                    ratingsSum: item.ratingsSum,
                    ratingsCount: item.ratingsCount,
                    avgRating: item.avgRating,
                    hasCommunityRating: item.ratingsCount > 0,
                    lastRatingUpdatedAt: firebase.firestore.Timestamp.fromDate(item.maxRatingDate),
                    lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });

                count++;

                if (count >= BATCH_SIZE) {
                    await batch.commit();
                    totalUpdated += count;
                    this.log(`Committed batch of ${count} movies. Total: ${totalUpdated}`);
                    batch = this.db.batch();
                    count = 0;
                }
            }

            if (count > 0) {
                await batch.commit();
                totalUpdated += count;
                this.log(`Committed final batch of ${count} movies.`);
            }

            this.log(`Migration complete! Updated ${totalUpdated} movie documents.`);
            return {
                dryRun: false,
                status: 'success',
                totalUpdated
            };

        } catch (error) {
            console.error('AvgRating migration failed:', error);
            throw new Error(`AvgRating migration failed: ${error.message}`, { cause: error });
        }
    }

    /**
     * Inspect user approval statuses across all documents in 'users' collection.
     * @returns {Promise<Object>} Statistics of approvalStatus distribution
     */
    async getUserApprovalStats() {
        this.log('Inspecting user approval statuses...');
        try {
            const usersSnapshot = await this.db.collection('users').get();
            this.log(`Fetched ${usersSnapshot.size} total user documents.`);

            let approved = 0;
            let pending = 0;
            let rejected = 0;
            let unmigrated = 0;
            const unmigratedUsers = [];

            usersSnapshot.forEach(doc => {
                const data = doc.data() || {};
                const status = data.approvalStatus;

                if (status === 'approved') {
                    approved++;
                } else if (status === 'pending') {
                    pending++;
                } else if (status === 'rejected') {
                    rejected++;
                } else {
                    unmigrated++;
                    unmigratedUsers.push({
                        id: doc.id,
                        email: data.email || 'no-email',
                        displayName: data.displayName || 'Unnamed'
                    });
                }
            });

            const summary = {
                total: usersSnapshot.size,
                approved,
                pending,
                rejected,
                unmigrated,
                unmigratedUsers
            };

            this.log('=== User Approval Status Breakdown ===');
            if (typeof console.table === 'function') {
                console.table({
                    'Approved': { count: approved },
                    'Pending': { count: pending },
                    'Rejected': { count: rejected },
                    'Unmigrated (missing field)': { count: unmigrated },
                    'Total Users': { count: usersSnapshot.size }
                });
            } else {
                this.log(`Approved: ${approved}, Pending: ${pending}, Rejected: ${rejected}, Unmigrated: ${unmigrated}, Total: ${usersSnapshot.size}`);
            }

            return summary;
        } catch (error) {
            console.error('Error checking user approval stats:', error);
            throw new Error(`Failed to get user approval stats: ${error.message}`, { cause: error });
        }
    }

    /**
     * Migrate legacy users without approvalStatus to 'approved'.
     * Idempotent: only documents where approvalStatus is undefined or null are updated.
     * @param {boolean} dryRun - If true, only calculates and logs without performing writes.
     * @returns {Promise<Object>} Migration result
     */
    async migrateUserApprovalStatuses(dryRun = true) {
        this.log(`Starting user approval migration (dryRun = ${dryRun})...`);

        try {
            const usersSnapshot = await this.db.collection('users').get();
            this.log(`Fetched ${usersSnapshot.size} user documents to inspect.`);

            const unmigratedDocs = [];
            let approvedCount = 0;
            let pendingCount = 0;
            let rejectedCount = 0;

            usersSnapshot.forEach(doc => {
                const data = doc.data() || {};
                const status = data.approvalStatus;

                if (status === undefined || status === null) {
                    unmigratedDocs.push({
                        id: doc.id,
                        email: data.email || '',
                        displayName: data.displayName || ''
                    });
                } else if (status === 'approved') {
                    approvedCount++;
                } else if (status === 'pending') {
                    pendingCount++;
                } else if (status === 'rejected') {
                    rejectedCount++;
                }
            });

            this.log(`Found ${unmigratedDocs.length} users missing approvalStatus (Already approved: ${approvedCount}, pending: ${pendingCount}, rejected: ${rejectedCount}).`);

            if (unmigratedDocs.length === 0) {
                this.log('All user documents already have approvalStatus. Nothing to migrate.');
                return {
                    dryRun,
                    totalScanned: usersSnapshot.size,
                    migratedCount: 0,
                    status: 'already_up_to_date'
                };
            }

            if (dryRun) {
                this.log(`=== DRY-RUN: ${unmigratedDocs.length} users would be updated to approvalStatus: 'approved' ===`);
                if (typeof console.table === 'function') {
                    console.table(unmigratedDocs.slice(0, 20));
                }
                return {
                    dryRun: true,
                    totalScanned: usersSnapshot.size,
                    needsMigration: unmigratedDocs.length,
                    preview: unmigratedDocs.slice(0, 20),
                    status: 'dry_run_complete'
                };
            }

            // Perform batched updates
            this.log(`Executing Firestore Batch Write for ${unmigratedDocs.length} user documents...`);
            const usersRef = this.db.collection('users');
            let batch = this.db.batch();
            let count = 0;
            let totalUpdated = 0;
            const BATCH_SIZE = 400; // Firestore limit is 500

            for (const item of unmigratedDocs) {
                const userDocRef = usersRef.doc(item.id);
                const updatePayload = {
                    approvalStatus: 'approved',
                    approvalMigratedAt: (typeof firebase !== 'undefined' && firebase.firestore)
                        ? firebase.firestore.FieldValue.serverTimestamp()
                        : new Date()
                };
                batch.update(userDocRef, updatePayload);

                count++;

                if (count >= BATCH_SIZE) {
                    await batch.commit();
                    totalUpdated += count;
                    this.log(`Committed batch of ${count} users. Total: ${totalUpdated}`);
                    batch = this.db.batch();
                    count = 0;
                }
            }

            if (count > 0) {
                await batch.commit();
                totalUpdated += count;
                this.log(`Committed final batch of ${count} users.`);
            }

            this.log(`Migration complete! Successfully set approvalStatus: 'approved' on ${totalUpdated} user documents.`);
            return {
                dryRun: false,
                totalScanned: usersSnapshot.size,
                migratedCount: totalUpdated,
                status: 'success'
            };

        } catch (error) {
            console.error('User approval migration failed:', error);
            throw new Error(`User approval migration failed: ${error.message}`, { cause: error });
        }
    }
}

// Attach to window for use in console & UI
if (typeof window !== 'undefined') {
    window.MigrationTool = MigrationTool;
    if (typeof firebaseManager !== 'undefined') {
        window.migrationTool = new MigrationTool(firebaseManager);
    } else {
        window.addEventListener('firebaseManagerReady', () => {
            if (typeof firebaseManager !== 'undefined') {
                window.migrationTool = new MigrationTool(firebaseManager);
            }
        });
    }

    // Convenience helpers in browser console
    window.checkApprovalStats = async () => {
        if (!window.migrationTool && typeof firebaseManager !== 'undefined') {
            window.migrationTool = new MigrationTool(firebaseManager);
        }
        if (window.migrationTool) {
            return await window.migrationTool.getUserApprovalStats();
        }
        console.error('MigrationTool not ready yet');
    };

    window.runApprovalMigration = async (dryRun = true) => {
        if (!window.migrationTool && typeof firebaseManager !== 'undefined') {
            window.migrationTool = new MigrationTool(firebaseManager);
        }
        if (window.migrationTool) {
            return await window.migrationTool.migrateUserApprovalStatuses(dryRun);
        }
        console.error('MigrationTool not ready yet');
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = MigrationTool;
}

