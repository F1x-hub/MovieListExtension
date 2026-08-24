/**
 * Backfill Script: Calculate and populate topGenres for existing users
 *
 * PURPOSE: Scans all users in Firestore, calculates their top-3 most rated movie genres
 * based on all their rating documents, and updates users/{userId}.topGenres.
 *
 * HOW TO RUN:
 *   Dry Run (Test without writing to Firestore):
 *     node scripts/backfillTopGenres.js --dry-run
 *
 *   Live Run (Performs batched writes to Firestore):
 *     node scripts/backfillTopGenres.js
 *
 * REQUIREMENTS: Firebase Admin SDK credentials in the environment.
 * Set GOOGLE_APPLICATION_CREDENTIALS or put serviceAccountKey.json in project root.
 */

const path = require('path');
module.paths.push(path.join(__dirname, '..', 'functions', 'node_modules'));

let initializeApp, cert, getFirestore, FieldPath, FieldValue;

try {
    const adminApp = require('firebase-admin/app');
    const adminFirestore = require('firebase-admin/firestore');
    initializeApp = adminApp.initializeApp;
    cert = adminApp.cert;
    getFirestore = adminFirestore.getFirestore;
    FieldPath = adminFirestore.FieldPath;
    FieldValue = adminFirestore.FieldValue;
} catch (e) {
    console.error('❌ Could not load firebase-admin modules:', e.message);
    process.exit(1);
}

// ── Credentials Initialization ──────────────────────────────────────────────
const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    path.join(__dirname, '..', 'serviceAccountKey.json');

try {
    const serviceAccount = require(SERVICE_ACCOUNT_PATH);
    initializeApp({
        credential: cert(serviceAccount)
    });
} catch (e) {
    console.error('❌ Could not load service account credentials:', e.message);
    console.error('   Path checked:', SERVICE_ACCOUNT_PATH);
    console.error('   Set GOOGLE_APPLICATION_CREDENTIALS env var or put serviceAccountKey.json in project root.');
    process.exit(1);
}

const db = getFirestore();
const isDryRun = process.argv.includes('--dry-run');

/**
 * Top-3 Genres Calculation Utility
 * NOTE: Keep in sync with client-side genre calculation logic
 */
function calculateTopGenres(genresList, limit = 3) {
    const counts = {};
    for (const genre of genresList) {
        if (!genre) continue;
        const name = typeof genre === 'string' ? genre.trim() : (genre.name ? genre.name.trim() : '');
        if (!name || name.toLowerCase() === 'unknown') continue;
        
        // Capitalize first letter for consistency
        const normalized = name.charAt(0).toUpperCase() + name.slice(1);
        counts[normalized] = (counts[normalized] || 0) + 1;
    }

    return Object.keys(counts)
        .sort((a, b) => counts[b] - counts[a] || a.localeCompare(b, 'ru'))
        .slice(0, limit);
}

/**
 * Helper delay function for rate limiting between chunks
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function backfillTopGenres() {
    const startTime = Date.now();
    console.log('🔍 Starting user topGenres backfill scan...');
    if (isDryRun) {
        console.log('🧪 [DRY RUN MODE] No changes will be written to Firestore.\n');
    } else {
        console.log('⚡ [LIVE MODE] Real writes will be executed in Firestore batches.\n');
    }

    const USERS_CHUNK_SIZE = 50; // Cursor pagination chunk size
    const MOVIE_IN_CHUNK_SIZE = 10; // Firestore 'in' limit
    const WRITE_BATCH_LIMIT = 500;

    let processedUsersCount = 0;
    let updatedUsersCount = 0;
    let skippedUsersCount = 0;
    let errorCount = 0;

    let lastDoc = null;
    let currentBatch = db.batch();
    let pendingBatchWrites = 0;

    while (true) {
        let query = db.collection('users')
            .orderBy(FieldPath.documentId())
            .limit(USERS_CHUNK_SIZE);

        if (lastDoc) {
            query = query.startAfter(lastDoc);
        }

        const snapshot = await query.get();
        if (snapshot.empty) break;

        console.log(`📊 Processing users batch of ${snapshot.docs.length} users...`);

        for (const userDoc of snapshot.docs) {
            processedUsersCount++;
            const userId = userDoc.id;
            const shortId = userId.length > 8 ? `${userId.substring(0, 8)}...` : userId;

            try {
                // Fetch all ratings for this user
                const ratingsSnapshot = await db.collection('ratings')
                    .where('userId', '==', userId)
                    .get();

                if (ratingsSnapshot.empty) {
                    skippedUsersCount++;
                    continue;
                }

                // Collect unique movie IDs
                const movieIdsSet = new Set();
                ratingsSnapshot.forEach(doc => {
                    const data = doc.data();
                    if (data.movieId) {
                        movieIdsSet.add(data.movieId.toString());
                    }
                });

                const movieIds = Array.from(movieIdsSet);
                if (movieIds.length === 0) {
                    skippedUsersCount++;
                    continue;
                }

                // Batch fetch movie documents in chunks of 10
                const allGenres = [];
                for (let i = 0; i < movieIds.length; i += MOVIE_IN_CHUNK_SIZE) {
                    const chunk = movieIds.slice(i, i + MOVIE_IN_CHUNK_SIZE);
                    const moviesQuery = await db.collection('movies')
                        .where(FieldPath.documentId(), 'in', chunk)
                        .get();

                    moviesQuery.forEach(mDoc => {
                        const mData = mDoc.data();
                        if (Array.isArray(mData.genres)) {
                            allGenres.push(...mData.genres);
                        }
                    });
                }

                const topGenres = calculateTopGenres(allGenres, 3);

                if (isDryRun) {
                    console.log(`  🧪 [DRY RUN] User [${shortId}]: ${JSON.stringify(topGenres)} (${movieIds.length} movies)`);
                    updatedUsersCount++;
                } else {
                    currentBatch.update(userDoc.ref, {
                        topGenres: topGenres,
                        updatedAt: FieldValue.serverTimestamp()
                    });
                    pendingBatchWrites++;
                    updatedUsersCount++;

                    if (pendingBatchWrites >= WRITE_BATCH_LIMIT) {
                        await currentBatch.commit();
                        console.log(`  ✅ Committed batch of ${pendingBatchWrites} user updates.`);
                        currentBatch = db.batch();
                        pendingBatchWrites = 0;
                    }
                }

            } catch (userErr) {
                errorCount++;
                console.error(`  ❌ Error processing user [${shortId}]:`, userErr.message);
            }
        }

        lastDoc = snapshot.docs[snapshot.docs.length - 1];

        // Rate limiting pause between user chunks
        await sleep(200);

        if (snapshot.docs.length < USERS_CHUNK_SIZE) break;
    }

    // Commit any remaining writes in batch
    if (!isDryRun && pendingBatchWrites > 0) {
        await currentBatch.commit();
        console.log(`  ✅ Committed final batch of ${pendingBatchWrites} user updates.`);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`\n📋 ─── BACKFILL SUMMARY ───`);
    console.log(`   Mode:               ${isDryRun ? 'DRY RUN (no DB writes)' : 'LIVE (Firestore updated)'}`);
    console.log(`   Total Users Scanned:${processedUsersCount}`);
    console.log(`   Users Updated:      ${updatedUsersCount}`);
    console.log(`   Users Skipped (0):  ${skippedUsersCount}`);
    console.log(`   Errors Encountered: ${errorCount}`);
    console.log(`   Execution Time:     ${duration}s`);
    console.log(`────────────────────────────\n`);

    process.exit(errorCount > 0 ? 1 : 0);
}

backfillTopGenres().catch(err => {
    console.error('Fatal error during backfill script execution:', err);
    process.exit(1);
});
