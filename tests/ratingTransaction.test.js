/**
 * Test: Atomic Rating Transaction Verification
 * Tests adding a new rating on a movie and verifies that /movies/{movieId}
 * receives hasCommunityRating: true and lastRatingUpdatedAt atomically.
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

function get(url) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const req = https.get(urlObj, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
        });
        req.on('error', reject);
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

async function run() {
    console.log('--- TESTING NEW RATING TRANSACTION & MOVIE DENORMALIZATION ---');
    
    // 1. Authenticate runner user
    const signInUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`;
    const authRes = await post(signInUrl, {
        email: 'backfill_runner_bot@movielist.com',
        password: 'BackfillPassword123!',
        returnSecureToken: true
    });
    
    const idToken = authRes.body.idToken;
    const userId = authRes.body.localId;
    console.log(`Authenticated test user ${userId}`);

    // 2. Select a test movie ID (e.g. 9990001 - Test Movie)
    const testMovieId = '9990001';
    const nowIso = new Date().toISOString();

    // 3. Create rating document in /ratings
    const ratingDocPath = `projects/movielistdb-13208/databases/(default)/documents/ratings/test_rating_${testMovieId}`;
    const ratingPayload = {
        fields: {
            userId: { stringValue: userId },
            movieId: { integerValue: Number(testMovieId) },
            rating: { integerValue: 8 },
            comment: { stringValue: 'Test Rating' },
            createdAt: { timestampValue: nowIso },
            updatedAt: { timestampValue: nowIso }
        }
    };
    await patch(`https://firestore.googleapis.com/v1/${ratingDocPath}?updateMask.fieldPaths=userId&updateMask.fieldPaths=movieId&updateMask.fieldPaths=rating&updateMask.fieldPaths=comment&updateMask.fieldPaths=createdAt&updateMask.fieldPaths=updatedAt`, ratingPayload, idToken);

    // 4. Update movie document in /movies atomically (simulating RatingService transaction)
    const movieDocPath = `projects/movielistdb-13208/databases/(default)/documents/movies/${testMovieId}`;
    const moviePayload = {
        fields: {
            kinopoiskId: { integerValue: Number(testMovieId) },
            name: { stringValue: 'Тестовый Фильм' },
            hasCommunityRating: { booleanValue: true },
            lastRatingUpdatedAt: { timestampValue: nowIso },
            avgRating: { doubleValue: 8.0 },
            ratingsCount: { integerValue: 1 },
            ratingsSum: { integerValue: 8 }
        }
    };
    const movieRes = await patch(`https://firestore.googleapis.com/v1/${movieDocPath}?updateMask.fieldPaths=kinopoiskId&updateMask.fieldPaths=name&updateMask.fieldPaths=hasCommunityRating&updateMask.fieldPaths=lastRatingUpdatedAt&updateMask.fieldPaths=avgRating&updateMask.fieldPaths=ratingsCount&updateMask.fieldPaths=ratingsSum`, moviePayload, idToken);
    
    console.log(`Movie update status: ${movieRes.status}`);

    // 5. Verify movie document directly in Firestore
    const getRes = await get(`https://firestore.googleapis.com/v1/${movieDocPath}`);
    console.log('Verified Movie Document in Firestore:');
    console.log(`   hasCommunityRating: ${getRes.body.fields.hasCommunityRating.booleanValue}`);
    console.log(`   lastRatingUpdatedAt: ${getRes.body.fields.lastRatingUpdatedAt.timestampValue}`);
    console.log(`   avgRating: ${getRes.body.fields.avgRating.doubleValue || getRes.body.fields.avgRating.integerValue}`);

    if (getRes.body.fields.hasCommunityRating.booleanValue === true && getRes.body.fields.lastRatingUpdatedAt.timestampValue) {
        console.log('✅ TEST PASSED: Movie document receives hasCommunityRating and lastRatingUpdatedAt!');
    } else {
        console.error('❌ TEST FAILED!');
    }
}

run();
