const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('functions/index.js', 'utf8');
const helper = source.match(/function getWatchRoomStagingDatabase\(\) \{[\s\S]*?\n\}/)?.[0] || '';
const trigger = source.match(/exports\.cleanupExpiredWatchRoomsStaging = onSchedule\([\s\S]*?\n\);/)?.[0] || '';

assert.match(source, /require\("firebase-functions\/v2\/scheduler"\)/);
assert.match(source, /require\("\.\/watchRoomCleanup"\)/);
assert.match(helper, /WATCH_ROOM_STAGING_DATABASE_URL\.value\(\)/);
assert.match(helper, /getDatabaseWithUrl\(url, app\)/);
assert.match(trigger, /schedule:\s*"15 4 \* \* \*"/);
assert.match(trigger, /timeZone:\s*"Asia\/Tbilisi"/);
assert.match(trigger, /region:\s*"us-central1"/);
assert.match(trigger, /timeoutSeconds:\s*120/);
assert.match(trigger, /maxInstances:\s*1/);
assert.match(trigger, /retryCount:\s*1/);
assert.match(trigger, /maxRetrySeconds:\s*300/);
assert.match(trigger, /getRealtimeDatabase:\s*getWatchRoomStagingDatabase/);

console.log('watchRoomCleanupTrigger.test.cjs: scheduled cleanup trigger remains bounded and uses the staging RTDB factory');
