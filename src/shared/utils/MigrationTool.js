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
            throw new Error(`Migration failed: ${error.message}`);
        }
    }
}

// Attach to window for use in console
if (typeof firebaseManager !== 'undefined') {
    window.migrationTool = new MigrationTool(firebaseManager);
} else {
    // If firebaseManager not ready yet, wait for it? 
    // Usually we instantiate this where needed or after load.
    window.addEventListener('firebaseManagerReady', () => {
         if (typeof firebaseManager !== 'undefined') {
            window.migrationTool = new MigrationTool(firebaseManager);
         }
    });
}
