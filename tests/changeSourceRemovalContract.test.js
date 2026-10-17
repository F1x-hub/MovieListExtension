import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const found = [];
for (const directory of ['src', 'content-scripts']) {
    for (const file of fs.readdirSync(path.join(root, directory), { recursive: true })) {
        if (!/\.(js|html)$/.test(file) || file.endsWith('.min.js')) continue;
        const relative = path.join(directory, file);
        const text = fs.readFileSync(path.join(root, relative), 'utf8');
        if (text.includes('CHANGE_SOURCE')) found.push(relative);
    }
}
assert.deepEqual(found, [], 'The retired, provider-controlled CHANGE_SOURCE message must have no sender, receiver or trusted allowlist entry');
console.log('Retired CHANGE_SOURCE contract: no extension or content-script message path remains.');
