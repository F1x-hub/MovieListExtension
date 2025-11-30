/**
 * Migration Script for Favorites System
 * Adds isFavorite and favoritedAt fields to existing ratings
 * 
 * IMPORTANT: Run this script once through Firebase Console or locally
 * After running, delete this file or keep it for reference
 */

// This script should be run in a Node.js environment with Firebase Admin SDK
// Or through Firebase Console > Functions > Run migration function

async function migrateRatingsForFavorites() {
    const admin = require('firebase-admin');
    
    // Initialize Firebase Admin (if not already initialized)
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.applicationDefault()
        });
    }
    
    const db = admin.firestore();
    const ratingsRef = db.collection('ratings');
    
    console.log('Starting migration: Adding isFavorite and favoritedAt fields to ratings...');
    
    try {
        const snapshot = await ratingsRef.get();
        const batch = db.batch();
        let count = 0;
        let batchCount = 0;
        const BATCH_SIZE = 500; // Firestore batch limit
        
        for (const doc of snapshot.docs) {
            const data = doc.data();
            
            // Only update if fields don't exist or are undefined
            if (data.isFavorite === undefined || data.favoritedAt === undefined) {
                const updates = {};
                
                if (data.isFavorite === undefined) {
                    updates.isFavorite = false;
                }
                
                if (data.favoritedAt === undefined) {
                    updates.favoritedAt = null;
                }
                
                if (Object.keys(updates).length > 0) {
                    batch.update(doc.ref, updates);
                    count++;
                    batchCount++;
                    
                    // Commit batch if we reach the limit
                    if (batchCount >= BATCH_SIZE) {
                        await batch.commit();
                        console.log(`Migrated ${count} ratings...`);
                        batchCount = 0;
                    }
                }
            }
        }
        
        // Commit remaining updates
        if (batchCount > 0) {
            await batch.commit();
        }
        
        console.log(`Migration completed! Updated ${count} ratings.`);
        return { success: true, count };
    } catch (error) {
        console.error('Migration error:', error);
        throw error;
    }
}

// Alternative: Run in browser console (for development/testing)
// This version uses the client-side Firebase SDK
async function migrateRatingsForFavoritesClient() {
    if (typeof firebase === 'undefined' || !firebase.firestore) {
        console.error('Firebase is not loaded. Please load Firebase SDK first.');
        return;
    }
    
    const db = firebase.firestore();
    const ratingsRef = db.collection('ratings');
    
    console.log('Starting migration: Adding isFavorite and favoritedAt fields to ratings...');
    console.warn('WARNING: This will update all ratings. Make sure you have proper permissions.');
    
    try {
        const snapshot = await ratingsRef.get();
        const batch = db.batch();
        let count = 0;
        let batchCount = 0;
        const BATCH_SIZE = 500;
        
        for (const doc of snapshot.docs) {
            const data = doc.data();
            
            if (data.isFavorite === undefined || data.favoritedAt === undefined) {
                const updates = {};
                
                if (data.isFavorite === undefined) {
                    updates.isFavorite = false;
                }
                
                if (data.favoritedAt === undefined) {
                    updates.favoritedAt = null;
                }
                
                if (Object.keys(updates).length > 0) {
                    batch.update(doc.ref, updates);
                    count++;
                    batchCount++;
                    
                    if (batchCount >= BATCH_SIZE) {
                        await batch.commit();
                        console.log(`Migrated ${count} ratings...`);
                        batchCount = 0;
                    }
                }
            }
        }
        
        if (batchCount > 0) {
            await batch.commit();
        }
        
        console.log(`Migration completed! Updated ${count} ratings.`);
        return { success: true, count };
    } catch (error) {
        console.error('Migration error:', error);
        throw error;
    }
}

// Export for Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { migrateRatingsForFavorites };
}

// For browser console usage
if (typeof window !== 'undefined') {
    window.migrateRatingsForFavorites = migrateRatingsForFavoritesClient;
}

// Instructions:
// 1. For Node.js: Run with Firebase Admin SDK
//    node migration-favorites.js
//
// 2. For browser console:
//    - Open browser console on any page with Firebase loaded
//    - Copy and paste the migrateRatingsForFavoritesClient function
//    - Run: await migrateRatingsForFavoritesClient()
//
// 3. For Firebase Console:
//    - Go to Firestore Database
//    - Use the data migration tool
//    - Or create a Cloud Function to run this migration

