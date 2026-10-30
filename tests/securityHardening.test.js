const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// Slice one `match /path {` block so assertions cannot be satisfied by another collection.
function block(source, header) {
    const start = source.indexOf(header);
    assert.ok(start >= 0, `missing rules block: ${header}`);
    let depth = 0;
    for (let i = source.indexOf('{', start + header.length); i < source.length; i += 1) {
        if (source[i] === '{') depth += 1;
        if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(`unterminated rules block: ${header}`);
}

const firestore = read('rules/firestore.rules');
const storage = read('rules/storage.rules');

// Approval cannot be skipped by omitting the field: isApprovedUser() treats a missing
// approvalStatus as a legacy approval, so the create rule must demand 'pending'.
const users = block(firestore, 'match /users/{userId}');
assert.match(users, /allow create: if isOwner\(userId\)[\s\S]*request\.resource\.data\.get\('approvalStatus', null\) == 'pending'/);
assert.doesNotMatch(users, /!\('approvalStatus' in request\.resource\.data\)/);

// List entries belong to the signed-in user and cannot be handed to another one.
assert.match(firestore, /function isOwnListEntryCreate\(\)[\s\S]*request\.resource\.data\.userId == request\.auth\.uid/);
assert.match(firestore, /function isOwnListEntryChange\(\)[\s\S]*request\.resource\.data\.userId == resource\.data\.userId/);
for (const name of ['watchlist/{watchlistId}', 'watching/{watchingId}', 'favorites/{favoriteId}', 'collections/{collectionId}']) {
    const entry = block(firestore, `match /${name}`);
    assert.match(entry, /allow create: if isOwnListEntryCreate\(\) \|\| isAdmin\(\);/, name);
    assert.match(entry, /allow update: if isOwnListEntryChange\(\) \|\| isAdmin\(\);/, name);
    assert.doesNotMatch(entry, /allow create: if isApprovedUser\(\);/, name);
}

// Guests may still report, but only a bounded payload.
const reports = block(firestore, 'match /reports/{reportId}');
assert.match(reports, /allow create: if isValidReportPayload\(request\.resource\.data\)/);
const payload = block(firestore, 'function isValidReportPayload(data)');
for (const field of ['text', 'photoUrl', 'photoPath', 'status', 'createdAt', 'userId', 'pageUrl']) {
    assert.match(payload, new RegExp(`'${field}'`), `report field ${field}`);
}
assert.match(payload, /data\.text\.size\(\) <= 5000/);
assert.match(payload, /data\.status == 'pending'/);
assert.match(payload, /data\.userId == request\.auth\.uid/);

// Storage: no open write on the bucket.
const reportFiles = block(storage, 'match /reports/{reportId}/{fileName}');
assert.match(reportFiles, /allow create: if fileName\.matches\('photo\\\\\..\{1,20\}'\)/);
assert.match(reportFiles, /request\.resource\.size <= 5 \* 1024 \* 1024/);
assert.match(reportFiles, /contentType\.matches\('image\/\(png\|jpe\?g\|webp\|gif\)'\)/);
assert.match(reportFiles, /allow update: if false;/);
assert.match(reportFiles, /allow delete: if isAdmin\(\);/);
assert.doesNotMatch(storage, /allow write: if true/);
assert.doesNotMatch(storage, /reports\/\{allPaths=\*\*\}/);
const icons = block(storage, 'match /collection_icons/{userId}/{allPaths=**}');
assert.match(icons, /allow create, update: if request\.auth != null && request\.auth\.uid == userId && isValidProfileImage\(\);/);

// No credentials in tracked configuration or scripts.
const spotifyConfig = read('src/shared/config/spotify.config.js');
assert.doesNotMatch(spotifyConfig, /CLIENT_(ID|SECRET)\s*:/);
assert.match(spotifyConfig, /TOKEN_PROXY_URL: 'https:\/\/us-central1-movielistdb-13208\.cloudfunctions\.net\/spotifyToken'/);
const background = read('src/background/background.js');
assert.doesNotMatch(background, /CLIENT_SECRET|btoa\(SPOTIFY/);
for (const file of ['scripts/backfill.js', 'scripts/cleanup-test-ratings.js']) {
    const script = read(file);
    assert.doesNotMatch(script, /backfill_runner_bot|BackfillPassword/, file);
    assert.match(script, /process\.env\.BACKFILL_RUNNER_PASSWORD/, file);
}

// The 'ended' handlers once called getSavedKey(), which never existed (ReferenceError).
assert.doesNotMatch(read('content-scripts/player-cleaner.js'), /getSavedKey/);

// Only extension pages may change the display mode.
const settingsHandler = background.slice(background.indexOf("message?.type !== 'SETTINGS_UPDATED'") - 200,
    background.indexOf('updateExtensionAction(message.settings.displayMode);'));
assert.match(settingsHandler, /sender\.id !== chrome\.runtime\.id/);

console.log('Security hardening contract tests passed');
