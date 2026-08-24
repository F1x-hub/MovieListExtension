/**
 * Backfill Script: Set lastRatingUpdatedAt for movies missing this field
 *
 * PURPOSE: The ratings page queries movies WHERE hasCommunityRating=true
 * ORDER BY lastRatingUpdatedAt. Firestore silently excludes documents
 * that are missing the ordered field. This script fixes those documents
 * so all rated movies appear in the ratings page.
 *
 * HOW TO RUN:
 *   node scripts/backfill-lastRatingUpdatedAt.js
 *
 * REQUIREMENTS: Firebase Admin SDK credentials in the environment.
 * Set GOOGLE_APPLICATION_CREDENTIALS or use the service account JSON below.
 */

const admin = require('firebase-admin');
const path = require('path');

// ── Credentials ──────────────────────────────────────────────────────────────
// Option A: set GOOGLE_APPLICATION_CREDENTIALS env var to path of service account JSON
// Option B: provide the path directly below
const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    path.join(__dirname, '..', 'serviceAccountKey.json');

try {
    const serviceAccount = require(SERVICE_ACCOUNT_PATH);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
} catch (e) {
    console.error('❌ Could not load service account credentials.');
    console.error('   Set GOOGLE_APPLICATION_CREDENTIALS env var or put serviceAccountKey.json in project root.');
    process.exit(1);
}

const db = admin.firestore();

async function backfillLastRatingUpdatedAt() {
    console.log('🔍 Scanning movies collection for documents missing lastRatingUpdatedAt...\n');

    const moviesRef = db.collection('movies');
    
    // Fetch all movies with hasCommunityRating: true
    const snapshot = await moviesRef.where('hasCommunityRating', '==', true).get();
    
    console.log(`📊 Total hasCommunityRating=true documents: ${snapshot.size}`);
    
    let needsUpdate = 0;
    let alreadyHasField = 0;
    const updates = [];
    
    snapshot.forEach(doc => {
        const data = doc.data();
        if (data.lastRatingUpdatedAt == null) {
            needsUpdate++;
            // Use updatedAt as fallback, then lastUpdated (ISO string), then now
            let fallbackTimestamp = null;
            if (data.updatedAt) {
                fallbackTimestamp = data.updatedAt; // already a Firestore Timestamp
            } else if (data.lastUpdated) {
                try {
                    fallbackTimestamp = admin.firestore.Timestamp.fromDate(new Date(data.lastUpdated));
                } catch {
                    fallbackTimestamp = admin.firestore.Timestamp.now();
                }
            } else {
                fallbackTimestamp = admin.firestore.Timestamp.now();
            }
            updates.push({ ref: doc.ref, id: doc.id, name: data.name, fallbackTimestamp });
        } else {
            alreadyHasField++;
        }
    });
    
    console.log(`✅ Already has lastRatingUpdatedAt: ${alreadyHasField}`);
    console.log(`⚠️  Missing lastRatingUpdatedAt: ${needsUpdate}`);
    
    if (updates.length === 0) {
        console.log('\n🎉 No documents need updating. All rated movies have lastRatingUpdatedAt set.');
        process.exit(0);
    }
    
    console.log(`\n🔧 Backfilling ${updates.length} documents...`);
    
    // Process in batches of 500 (Firestore batch limit)
    const BATCH_SIZE = 500;
    let successCount = 0;
    let failCount = 0;
    
    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
        const chunk = updates.slice(i, i + BATCH_SIZE);
        const batch = db.batch();
        
        chunk.forEach(({ ref, fallbackTimestamp }) => {
            batch.update(ref, {
                lastRatingUpdatedAt: fallbackTimestamp
            });
        });
        
        try {
            await batch.commit();
            successCount += chunk.length;
            console.log(`  ✅ Batch ${Math.floor(i/BATCH_SIZE)+1}: updated ${chunk.length} docs (total: ${successCount}/${updates.length})`);
            
            // Log details for first batch
            if (i === 0) {
                chunk.slice(0, 5).forEach(u => {
                    console.log(`     - [${u.id}] "${u.name || 'unknown'}" → lastRatingUpdatedAt set`);
                });
                if (chunk.length > 5) console.log(`     ... and ${chunk.length - 5} more`);
            }
        } catch (err) {
            failCount += chunk.length;
            console.error(`  ❌ Batch ${Math.floor(i/BATCH_SIZE)+1} failed:`, err.message);
        }
    }
    
    console.log(`\n📋 Summary:`);
    console.log(`   Updated: ${successCount}`);
    console.log(`   Failed:  ${failCount}`);
    
    if (successCount > 0) {
        console.log('\n✅ Backfill complete. Rated movies should now appear in the ratings page.');
        console.log('   If movies still missing, also run the Firestore index check below:\n');
        console.log('   Required Firestore composite index:');
        console.log('   Collection: movies');
        console.log('   Fields: hasCommunityRating (ASC) + lastRatingUpdatedAt (DESC)');
    }
    
    process.exit(failCount > 0 ? 1 : 0);
}

backfillLastRatingUpdatedAt().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
