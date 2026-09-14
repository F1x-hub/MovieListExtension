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
assert.match(releaseWorkflow, /Validate Firebase deployment credentials/);
assert.match(releaseWorkflow, /FIREBASE_SERVICE_ACCOUNT is not valid JSON/);
assert.match(releaseWorkflow, /gh release upload \$env:GITHUB_REF_NAME/);
assert.match(releaseWorkflow, /--clobber/);
assert.match(releaseWorkflow, /Resuming existing draft release/);
assert.match(releaseWorkflow, /Updating existing published release/);
assert.ok(
    releaseWorkflow.indexOf('Authenticate Firebase deployment')
        < releaseWorkflow.indexOf('Create draft release with all assets'),
    'Firebase authentication must pass before a GitHub draft is created or updated'
);
assert.match(releaseWorkflow, /firebase-tools@latest deploy --only hosting/);
assert.match(releaseWorkflow, /--config firebase.updates.json/);
assert.match(releaseWorkflow, /Create Firebase Hosting API access token/);
assert.match(releaseWorkflow, /create-google-access-token\.cjs/);
assert.doesNotMatch(releaseWorkflow, /token_format: access_token/);
const tokenScript = fs.readFileSync('scripts/create-google-access-token.cjs', 'utf8');
assert.match(tokenScript, /urn:ietf:params:oauth:grant-type:jwt-bearer/);
assert.match(tokenScript, /MAX_TOKEN_ATTEMPTS = 3/);
assert.match(tokenScript, /response\.status === 408 \|\| response\.status === 429 \|\| response\.status >= 500/);
assert.match(tokenScript, /GITHUB_ENV/);
assert.ok(
    releaseWorkflow.indexOf('Publish latest extension ZIP to Firebase Hosting')
        < releaseWorkflow.indexOf('Publish release after asset upload'),
    'the Firebase mirror must be ready before the GitHub release is made public'
);

console.log('packageReleaseContract.test.js passed');
