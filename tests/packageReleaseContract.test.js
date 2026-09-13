const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('scripts/package-release.js', 'utf8');
const releaseWorkflow = fs.readFileSync('.github/workflows/release.yml', 'utf8');

assert.match(source, /const archiveEntries = fs\.readdirSync\(dist\);/);
assert.match(source, /refusing to publish an empty extension archive/);
assert.match(source, /-C', dist, \.\.\.archiveEntries/);
assert.match(source, /function validateArchive\(archivePath\)/);
assert.match(source, /entries\.includes\('manifest\.json'\)/);
assert.ok(source.includes("entry.startsWith('./')"));
assert.match(source, /\\d\+\(\?:\\\.\\d\+\)\{2,3\}/);
assert.doesNotMatch(releaseWorkflow, /if: github\.ref_name ==/);
assert.match(releaseWorkflow, /npm run test:random-marathon/);
assert.match(releaseWorkflow, /gh release edit \$env:GITHUB_REF_NAME --latest/);
assert.match(releaseWorkflow, /FIREBASE_SERVICE_ACCOUNT/);
assert.match(releaseWorkflow, /firebase-tools@latest deploy --only hosting/);
assert.match(releaseWorkflow, /--config firebase.updates.json/);
assert.ok(
    releaseWorkflow.indexOf('Publish latest extension ZIP to Firebase Hosting')
        < releaseWorkflow.indexOf('Publish release after asset upload'),
    'the Firebase mirror must be ready before the GitHub release is made public'
);

console.log('packageReleaseContract.test.js passed');
