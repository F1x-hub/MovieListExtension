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
assert.match(releaseWorkflow, /if: github\.ref_name == 'v1\.3\.1'/);
assert.match(releaseWorkflow, /gh release edit \$env:GITHUB_REF_NAME --latest/);

console.log('packageReleaseContract.test.js passed');
