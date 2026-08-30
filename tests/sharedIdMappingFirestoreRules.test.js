const assert = require('assert');
const fs = require('fs');
const path = require('path');

const rules = fs.readFileSync(path.join(__dirname, '..', 'rules', 'firestore.rules'), 'utf8');

assert.match(rules, /function isValidSharedIdMapping\(mappingId, data\)/);
assert.match(rules, /match \/tmdbKinopoiskMappings\/\{mappingId\}/);
assert.match(rules, /allow read: if isAuthenticated\(\);/);
assert.match(rules, /allow create: if isAdmin\(\)[\s\S]*request\.resource\.data\.confirmedBy == request\.auth\.uid/);
assert.match(rules, /allow update: if isAdmin\(\)[\s\S]*request\.resource\.data\.updatedBy == request\.auth\.uid/);
assert.match(rules, /data\.reverseKey == 'kp:' \+ data\.mediaType \+ ':' \+ string\(data\.kpId\)/);
assert.match(rules, /function isValidSharedReverseLock\(reverseKey, data\)/);
assert.match(rules, /function hasSharedReverseLock\(mappingId, mappingData\)/);
assert.match(rules, /match \/tmdbKinopoiskReverseIndex\/\{reverseKey\}/);
assert.match(rules, /allow create: if isAdmin\(\)[\s\S]*hasSharedForwardMapping\(reverseKey, request\.resource\.data\)/);
assert.match(rules, /allow delete: if isAdmin\(\)[\s\S]*!existsAfter\(sharedReversePath\(resource\.data\.reverseKey\)\)/);

console.log('Shared Firestore mapping rules contract passed');
