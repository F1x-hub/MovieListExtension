const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'content-scripts', 'player-cleaner.js'),
    'utf8'
);
const roomBridgeSource = source.slice(
    source.indexOf('let roomSyncSubscriptionId'),
    source.indexOf('function createListenerScope')
);
const roomCommandSource = source.slice(
    source.indexOf('async function executeRoomSyncCommand'),
    source.indexOf("window.addEventListener('message'")
);

assert.match(source, /type: 'ROOM_SYNC_PROBE_RESULT'/);
assert.match(source, /type: 'ROOM_SYNC_COMMAND_RESULT'/);
assert.match(source, /type: 'ROOM_SYNC_TELEMETRY'/);
assert.match(source, /event\.source === window\.parent && event\.data\?\.type === 'ROOM_SYNC_PROBE'/);
assert.match(source, /video\.currentTime = targetMs \/ 1000/);
assert.match(source, /kind === 'timeupdate' && now - lastRoomSyncTimeupdateAt < 750/);
assert.match(source, /function setPermanentVideo\(video\)/);
assert.match(source, /if \(!roomSyncSubscriptionId\) return;/);
assert.match(source, /setPermanentVideo\(siteVideo\);/);
assert.match(source, /clearRoomSyncTelemetry\(\);/);
assert.match(source, /\[RoomSyncTrace\] telemetry-emitted/);
assert.match(source, /\[RoomSyncTrace\] subscription-received/);
assert.doesNotMatch(source, /ROOM_SYNC_[A-Z_]+[\s\S]{0,400}(?:currentSrc|lastRealSource|\.src)/);
assert.match(roomBridgeSource, /const ROOM_SYNC_TIMELINE_ACTIONS = new Set\(\['play', 'pause', 'seek'\]\)/);
assert.match(roomBridgeSource, /if \(!ROOM_SYNC_TIMELINE_ACTIONS\.has\(action\)\)/);
assert.doesNotMatch(roomCommandSource, /\b(?:audio(?:Track)?|subtitle(?:Track)?|quality|volume|playbackRate)\b/i);

console.log('roomSyncBridgeContract.test.js: native bridge keeps player preferences local');
