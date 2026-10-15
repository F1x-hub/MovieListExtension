const fs = require('node:fs');
const path = require('node:path');

function createReleaseNotes(tag, readme) {
    const version = String(tag).replace(/^v/, '');
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Expected a three-component release version');
    const releases = Array.from(readme.matchAll(/<details(?: open)?>\s*<summary><strong>(\d+\.\d+\.\d+)<\/strong>(.*?)<\/summary>([\s\S]*?)<\/details>/g));
    const index = releases.findIndex(release => release[1] === version);
    if (index < 0) throw new Error(`No README changelog entry for ${version}`);
    const [, , subtitle, body] = releases[index];
    const previous = releases[index + 1]?.[1];
    const comparison = previous ? `\n\n**Full Changelog**: [v${previous}...v${version}](https://github.com/F1x-hub/MovieListExtension/compare/v${previous}...v${version})` : '';
    return `**${version}**${subtitle}\n\n${body.trim()}${comparison}\n`;
}

if (require.main === module) {
    const root = path.resolve(__dirname, '..');
    const [tag, output = 'release-notes.md'] = process.argv.slice(2);
    const notes = createReleaseNotes(tag, fs.readFileSync(path.join(root, 'README.md'), 'utf8'));
    fs.writeFileSync(path.resolve(root, output), notes, 'utf8');
    console.log(`Prepared changelog release notes for ${tag}`);
}

module.exports = { createReleaseNotes };
