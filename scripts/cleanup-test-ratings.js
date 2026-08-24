const https = require('https');

const API_KEY = 'AIzaSyC6PI4cBRzn6KLVJ6ikensKus6LaulabO4';

function post(url, data) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const req = https.request(urlObj, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
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

function del(url, token) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const req = https.request(urlObj, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        req.on('error', reject);
        req.end();
    });
}

async function getAuthToken() {
    const email = 'backfill_runner_bot@movielist.com';
    const password = 'BackfillPassword123!';

    const signInUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`;
    let res = await post(signInUrl, { email, password, returnSecureToken: true });

    if (res.body.idToken) {
        console.log('[Cleanup] Authenticated with Firebase Auth successfully.');
        return res.body.idToken;
    }

    const signUpUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`;
    res = await post(signUpUrl, { email, password, returnSecureToken: true });

    if (res.body.idToken) {
        console.log('[Cleanup] Created new authenticated runner user.');
        return res.body.idToken;
    }

    throw new Error(`[Cleanup] Auth failed: ${JSON.stringify(res.body)}`);
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

async function run() {
    console.log('=== SEARCHING FOR TEST/UNKNOWN RATINGS TO CLEAN UP ===');
    const idToken = await getAuthToken();

    const ratingsDocs = await getAllDocuments('ratings');
    console.log(`[Cleanup] Total ratings in DB: ${ratingsDocs.length}`);

    let deletedCount = 0;

    for (const doc of ratingsDocs) {
        const docName = doc.name; // full path: projects/.../documents/ratings/docId
        const fields = doc.fields || {};

        const comment = fields.comment ? fields.comment.stringValue : '';
        const userName = fields.userName ? fields.userName.stringValue : '';
        const name = fields.name ? fields.name.stringValue : '';
        const rating = fields.rating ? (fields.rating.integerValue || fields.rating.doubleValue) : null;
        const movieId = fields.movieId ? (fields.movieId.integerValue || fields.movieId.stringValue) : null;

        console.log(`Inspecting doc: ${docName.split('/').pop()} -> comment: "${comment}", userName: "${userName}", movieId: ${movieId}`);

        // Check if this matches "Test Rating" or "Unknown Movie" or bad test data
        const isTestRating = (comment && comment.trim().toLowerCase().includes('test rating')) ||
                             name === 'Unknown Movie' ||
                             (userName === 'Unknown User' && comment && comment.toLowerCase().includes('test'));

        if (isTestRating) {
            console.log(`Deleting test rating doc: ${docName}...`);
            const deleteUrl = `https://firestore.googleapis.com/v1/${docName}`;
            const res = await del(deleteUrl, idToken);
            console.log(`Delete status for ${docName.split('/').pop()}:`, res);
            deletedCount++;
        }
    }

    console.log(`=== CLEANUP COMPLETE: Deleted ${deletedCount} test rating(s) from database ===`);
}

run().catch(console.error);
