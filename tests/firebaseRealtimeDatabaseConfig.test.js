const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync(require.resolve('../src/shared/firestore.js'), 'utf8');
const sdkSource = fs.readFileSync(require.resolve('../libs/firebase-database-compat.js'), 'utf8');

assert.strictEqual(source.includes('movielistdb-13208-watchrooms-staging.firebaseio.com'), false, 'Staging URL must stay outside tracked source');
assert.match(source, /globalThis\.MOVIELIST_RUNTIME_CONFIG\?\.databaseURL/);
assert.match(source, /getRealtimeDatabase\(\)/);
assert.match(source, /Realtime Database SDK is not loaded/);
assert.match(source, /Realtime Database URL is not configured/);
assert.match(source, /this\.rtdb = firebase\.database\(\)/);
assert.match(sdkSource, /firebase-database-compat/);

const constructorSection = source.slice(source.indexOf('constructor()'), source.indexOf('init()'));
assert.strictEqual(constructorSection.includes('firebase.database()'), false, 'RTDB must stay lazy outside room flows');

const runtimeTemplate = fs.readFileSync(require.resolve('../src/shared/config/firebase.runtime.example.js'), 'utf8');
assert.strictEqual(runtimeTemplate.includes('firebaseio.com'), false, 'Tracked runtime config must not name a live database');

console.log('firebaseRealtimeDatabaseConfig.test.js: staging RTDB configuration is lazy and explicit');
