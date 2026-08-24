/**
 * Administrative CLI Backfill Script for Movie Ratings Denormalization
 * 
 * Usage:
 *   node scripts/backfill.js
 * 
 * Purpose:
 *   Traverses all documents in the `/ratings` collection, groups them by `movieId`,
 *   and updates/denormalizes `/movies/{movieId}` documents with:
 *     - hasCommunityRating: true
 *     - lastRatingUpdatedAt: Latest rating timestamp
 *     - avgRating, ratingsSum, ratingsCount
 */

const https = require('https');

const API_KEY = 'AIzaSyC6PI4cBRzn6KLVJ6ikensKus6LaulabO4';

function post(url, data) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const req = https.request(urlObj, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
        });
        req.on('error', reject);
        req.write(JSON.stringify(data));
        req.end();
    });
}

function patch(url, data, token) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const req = https.request(urlObj, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
        });
        req.on('error', reject);
        req.write(JSON.stringify(data));
        req.end();
    });
}

async function getAuthToken() {
    const email = 'backfill_runner_bot@movielist.com';
    const password = 'BackfillPassword123!';

    const signInUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`;
    let res = await post(signInUrl, { email, password, returnSecureToken: true });

    if (res.body.idToken) {
        console.log('[Backfill] Authenticated with Firebase Auth successfully.');
        return res.body.idToken;
    }

    const signUpUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`;
    res = await post(signUpUrl, { email, password, returnSecureToken: true });

    if (res.body.idToken) {
        console.log('[Backfill] Created new authenticated runner user.');
        return res.body.idToken;
    }

    throw new Error(`[Backfill] Auth failed: ${JSON.stringify(res.body)}`);
}

async function getAllDocuments(collectionId) {
    const firestoreUrl = 'https://firestore.googleapis.com/v1/projects/movielistdb-13208/databases/(default)/documents:runQuery';
    let docs = [];

    const query = {
        structuredQuery: {
            from: [{ collectionId }],
            limit: 500
        }
    };
    const res = await post(firestoreUrl, query);
    if (Array.isArray(res.body)) {
        res.body.forEach(item => {
            if (item.document) docs.push(item.document);
        });
    }
    return docs;
}

async function updateMovieDoc(movieId, fieldsToUpdate, idToken) {
    const docPath = `projects/movielistdb-13208/databases/(default)/documents/movies/${movieId}`;
    
    const updateMask = [];
    const fields = {};

    for (const [key, val] of Object.entries(fieldsToUpdate)) {
        updateMask.push(`updateMask.fieldPaths=${key}`);
        if (typeof val === 'boolean') {
            fields[key] = { booleanValue: val };
        } else if (typeof val === 'number') {
            if (Number.isInteger(val)) {
                fields[key] = { integerValue: val };
            } else {
                fields[key] = { doubleValue: val };
            }
        } else if (val instanceof Date || (typeof val === 'string' && val.includes('T'))) {
            const iso = val instanceof Date ? val.toISOString() : val;
            fields[key] = { timestampValue: iso };
        }
    }

    const url = `https://firestore.googleapis.com/v1/${docPath}?${updateMask.join('&')}`;
    return await patch(url, { fields }, idToken);
}

async function run() {
    console.log('=== STARTING MANUAL FIRESTORE DENORMALIZATION BACKFILL ===');
    const idToken = await getAuthToken();

    const ratingsDocs = await getAllDocuments('ratings');
    console.log(`[Backfill] Fetched ${ratingsDocs.length} rating documents from Firestore.`);

    const ratedMoviesMap = new Map();
    ratingsDocs.forEach(d => {
        const f = d.fields || {};
        const movieId = f.movieId ? String(f.movieId.integerValue || f.movieId.stringValue) : '';
        const createdAt = f.createdAt ? (f.createdAt.timestampValue || f.createdAt.stringValue) : null;
        const updatedAt = f.updatedAt ? (f.updatedAt.timestampValue || f.updatedAt.stringValue) : null;
        const rating = f.rating ? Number(f.rating.integerValue || f.rating.doubleValue || 0) : 0;

        if (movieId) {
            if (!ratedMoviesMap.has(movieId)) {
                ratedMoviesMap.set(movieId, { ratingsSum: 0, ratingsCount: 0, maxDate: 0 });
            }
            const item = ratedMoviesMap.get(movieId);
            item.ratingsSum += rating;
            item.ratingsCount += 1;
            const rDate = new Date(updatedAt || createdAt || 0).getTime();
            if (rDate > item.maxDate) {
                item.maxDate = rDate;
            }
        }
    });

    console.log(`[Backfill] Processing ${ratedMoviesMap.size} unique rated movies...`);

    let updatedCount = 0;
    for (const [movieId, stats] of ratedMoviesMap.entries()) {
        const avgRating = stats.ratingsCount > 0 ? Math.round((stats.ratingsSum / stats.ratingsCount) * 10) / 10 : 0;
        const maxRatingDate = stats.maxDate > 0 ? new Date(stats.maxDate).toISOString() : new Date().toISOString();

        const updates = {
            hasCommunityRating: stats.ratingsCount > 0,
            ratingsSum: stats.ratingsSum,
            ratingsCount: stats.ratingsCount,
            avgRating: avgRating,
            lastRatingUpdatedAt: maxRatingDate
        };

        const res = await updateMovieDoc(movieId, updates, idToken);
        if (res.status === 200) {
            updatedCount++;
        } else {
            console.error(`[Backfill] Failed to update movie ${movieId}: status ${res.status}`, res.body);
        }
    }

    console.log(`=== BACKFILL COMPLETE: Updated ${updatedCount}/${ratedMoviesMap.size} movies in Firestore ===`);
}

run();
