const assert = require('node:assert/strict');
const fs = require('node:fs');
const { validateSuiteDescriptor, shouldPublishSuite } = require('../scripts/suite-release.cjs');

const staged = { schemaVersion: 1, version: '0.1.1', apiMajor: 1, buildId: 'a'.repeat(64), sha256: 'b'.repeat(64),
    size: 485282533, stagingTag: 'suite-v0.1.1', assetName: 'MediaPlayerSuiteSetup.exe' };
assert.deepEqual(validateSuiteDescriptor(staged), staged);
for (const change of [{ version: '0.1.1-beta' }, { apiMajor: 2 }, { sha256: 'x' }, { size: 0 }, { size: 1024 ** 3 + 1 },
    { stagingTag: 'v0.1.1' }, { stagingTag: 'suite-v0.1.2' }, { assetName: 'other.exe' }, { buildId: '../x' }, { schemaVersion: 2 }])
    assert.throws(() => validateSuiteDescriptor({ ...staged, ...change }), /invalid/, JSON.stringify(change));

const catalog = version => ({ components: { mediaPlayerSuite: { version } } });
assert.equal(shouldPublishSuite(staged, null), true, 'the first catalog publishes the staged Suite');
assert.equal(shouldPublishSuite(staged, { components: {} }), true);
assert.equal(shouldPublishSuite(staged, catalog('0.1.0')), true, 'a newer Suite is published');
assert.equal(shouldPublishSuite(staged, catalog('0.1.1')), false, 'an equal version keeps the signed descriptor');
assert.equal(shouldPublishSuite(staged, catalog('0.2.0')), false, 'an older pin never downgrades');

// The staging tag must never trigger the production release workflow.
const workflow = fs.readFileSync('.github/workflows/release.yml', 'utf8');
assert.match(workflow, /tags:\s*\n\s*- 'v\*\.\*\.\*'/);
assert.doesNotMatch('suite-v0.1.1', /^v/);
assert(workflow.indexOf('node scripts/suite-release.cjs fetch') < workflow.indexOf('node scripts/generate-component-metadata.js'),
    'the Suite must be verified before the catalog is signed');
for (const ignored of ['MediaPlayerSuiteSetup.exe', 'components.json', 'components.json.sig'])
    assert(fs.readFileSync('.gitignore', 'utf8').split(/\r?\n/).includes(ignored), `${ignored} must stay out of git`);
console.log('suiteRelease.test.cjs passed: descriptor validation, newer-only publication, staging tag isolation and signing order');
