const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createReleaseNotes } = require('../scripts/create-release-notes.cjs');

const readme = `<details open><summary><strong>Unreleased</strong></summary>Pending work</details>
<details><summary><strong>1.3.7</strong> — better controls</summary>\n### Features\n\n- Improved controls.\n</details>
<details><summary><strong>1.3.6</strong> — old release</summary>Old notes</details>`;
const notes = createReleaseNotes('v1.3.7', readme);
assert.match(notes, /^\*\*1\.3\.7\*\* — better controls\n\n### Features/);
assert.match(notes, /Improved controls\./);
assert.match(notes, /compare\/v1\.3\.6\.\.\.v1\.3\.7/);
assert.doesNotMatch(notes, /Pending work|Old notes|<details|<summary/);
assert.throws(() => createReleaseNotes('1.3.8', readme), /No README changelog/);
assert.throws(() => createReleaseNotes('latest', readme), /Expected a three-component/);
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const actual = createReleaseNotes(manifest.version, fs.readFileSync('README.md', 'utf8'));
// A patch release may contain fixes only; it needs at least one standard section.
assert.match(actual, /^### (?:Features|Fixes|Refactor|Docs)$/m);
assert.doesNotMatch(actual, /<details|<summary/);
console.log('Release notes: exact changelog version, curated body and previous-version comparison passed.');
