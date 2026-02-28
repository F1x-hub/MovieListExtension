/**
 * MigrationService - Handles migration of data to the new unified bookmarks system
 */
class MigrationService {
    constructor(firebaseManager) {
        this.db = firebaseManager.db;
        this.batchSize = 450;
    }

    /**
     * Run the full migration process
     * @param {string} userId 
     */
    async migrateUser(userId) {
        if (!userId) throw new Error('User ID required');

        console.log(`Starting migration for user ${userId}...`);
        
        const results = {
            favoritesUpdated: 0,
            watchlistMigrated: 0,
            watchingMigrated: 0,
            errors: []
        };

        try {
            // 1. Update existing Favorites (set status = 'favorite')
            results.favoritesUpdated = await this.migrateCollection(
                userId, 
                'favorites', 
                'favorites', 
                'favorite',
                false // Don't delete source since it's the target
            );

            // 2. Migrate Watchlist (set status = 'plan_to_watch')
            results.watchlistMigrated = await this.migrateCollection(
                userId, 
                'watchlist', 
                'favorites', 
                'plan_to_watch',
                true // Delete source after migration
            );

            // 3. Migrate Watching (set status = 'watching')
            // This runs last to overwrite status if movie is in multiple lists (Watching > Plan to Watch)
            results.watchingMigrated = await this.migrateCollection(
                userId, 
                'watching', 
                'favorites', 
                'watching',
                true // Delete source after migration
            );

            console.log('Migration completed:', results);
            return results;
        } catch (error) {
            console.error('Migration failed:', error);
            throw error;
        }
    }

    /**
     * Migrate entries from source collection to target collection
     */
    async migrateCollection(userId, sourceCol, targetCol, statusValue, deleteSource = false) {
        let processedCount = 0;
        const sourceRef = this.db.collection(sourceCol).where('userId', '==', userId);
        const snapshot = await sourceRef.get();

        if (snapshot.empty) return 0;

        const batches = [];
        let batch = this.db.batch();
        let operationCount = 0;

        for (const doc of snapshot.docs) {
            const data = doc.data();
            const docId = doc.id; // usually userId_movieId

            // Prepare target data
            // We use { merge: true } so we only update status/add fields if doc exists
            const targetRef = this.db.collection(targetCol).doc(docId);
            
            const updateData = {
                ...data,
                status: statusValue,
                migratedAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            // Ensure critical fields are present if we are creating new
            if (!updateData.createdAt) {
                updateData.createdAt = data.addedAt || data.favoritedAt || firebase.firestore.FieldValue.serverTimestamp();
            }

            batch.set(targetRef, updateData, { merge: true });
            
            if (deleteSource && sourceCol !== targetCol) {
                const docRef = this.db.collection(sourceCol).doc(docId);
                batch.delete(docRef);
            }

            operationCount++;
            
            // Commit batch if full
            if (operationCount >= this.batchSize) {
                batches.push(batch.commit());
                batch = this.db.batch();
                operationCount = 0;
            }
        }

        if (operationCount > 0) {
            batches.push(batch.commit());
        }

        await Promise.all(batches);
        return snapshot.size;
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MigrationService;
}
if (typeof window !== 'undefined') {
    window.MigrationService = MigrationService;
}
