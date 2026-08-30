const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync(require.resolve('../src/shared/firestore.js'), 'utf8');
const sdkSource = fs.readFileSync(require.resolve('../libs/firebase-database-compat.js'), 'utf8');

assert.match(source, /databaseURL:\s*"https:\/\/movielistdb-13208-watchrooms-staging\.firebaseio\.com"/);
assert.strictEqual(source.includes('MOVIELIST_RUNTIME_CONFIG'), false, 'RTDB must not depend on an ignored local runtime config');
assert.match(source, /getRealtimeDatabase\(\)/);
assert.match(source, /Realtime Database SDK is not loaded/);
assert.match(source, /Realtime Database URL is not configured/);
assert.match(source, /this\.rtdb = firebase\.database\(\)/);
assert.match(sdkSource, /firebase-database-compat/);

const constructorSection = source.slice(source.indexOf('constructor()'), source.indexOf('init()'));
assert.strictEqual(constructorSection.includes('firebase.database()'), false, 'RTDB must stay lazy outside room flows');

const movieDetailsHtml = fs.readFileSync(require.resolve('../src/pages/movie-details/movie-details.html'), 'utf8');
assert.strictEqual(movieDetailsHtml.includes('firebase.runtime.js'), false, 'Movie Details must not request an ignored runtime config');

console.log('firebaseRealtimeDatabaseConfig.test.js: staging RTDB configuration is lazy and explicit');
