const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const catalogHtml = fs.readFileSync(
    path.join(__dirname, '../src/pages/catalog/catalog.html'),
    'utf8'
);

const userServiceIndex = catalogHtml.indexOf('shared/services/UserService.js');
const navigationIndex = catalogHtml.indexOf('shared/components/Navigation.js');

assert.ok(userServiceIndex >= 0, 'catalog must load UserService for the admin navigation check');
assert.ok(navigationIndex >= 0, 'catalog must load Navigation');
assert.ok(
    userServiceIndex < navigationIndex,
    'catalog must load UserService before Navigation so firebaseManager can resolve isAdmin'
);

console.log('✅ Catalog navigation dependency contract passed');
