import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), '..');
const productionRoots = [
    path.join(rootDir, 'src'),
    path.join(rootDir, 'content-scripts')
];
const forbiddenLabels = [
    'Franchise634649:',
    'IdMappingForceRefresh',
    'IdMappingLookup',
    'SeasonvarIdentity',
    '[playerError]',
    'createHorizontalEpisodeSelector'
];

function collectJavaScriptFiles(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) return collectJavaScriptFiles(entryPath);
        return entry.isFile() && entry.name.endsWith('.js') ? [entryPath] : [];
    });
}

const violations = productionRoots
    .flatMap(collectJavaScriptFiles)
    .flatMap(filePath => {
        const source = fs.readFileSync(filePath, 'utf8');
        return forbiddenLabels
            .filter(label => source.includes(label))
            .map(label => ({ file: path.relative(rootDir, filePath), label }));
    });

assert.deepStrictEqual(
    violations,
    [],
    `Temporary forensic labels must not ship in production source:\n${JSON.stringify(violations, null, 2)}`
);

console.log('✅ Runtime debug cleanup regression check passed');
