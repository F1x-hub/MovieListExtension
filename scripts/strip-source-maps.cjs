const fs = require('node:fs');
const path = require('node:path');

// The last line of a minified script names its map. With the map gone, DevTools
// would report a failed request for it, so the line goes too. A match must start
// a line: the same text inside a string literal is code, not a reference.
const SOURCE_MAP_REFERENCE = /(?:^|\n)[ \t]*\/\/# sourceMappingURL=[^\n]*\s*$/;

/**
 * Removes every source map under `directory` and the trailing references to
 * them in scripts. Returns what was removed, for the release log.
 */
function stripSourceMaps(directory) {
    const removed = { maps: 0, bytes: 0, references: 0 };
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            const nested = stripSourceMaps(fullPath);
            removed.maps += nested.maps;
            removed.bytes += nested.bytes;
            removed.references += nested.references;
        } else if (entry.name.endsWith('.map')) {
            removed.maps += 1;
            removed.bytes += fs.statSync(fullPath).size;
            fs.rmSync(fullPath, { force: true });
        } else if (entry.name.endsWith('.js')) {
            const code = fs.readFileSync(fullPath, 'utf8');
            const stripped = code.replace(SOURCE_MAP_REFERENCE, '\n');
            if (stripped !== code) {
                fs.writeFileSync(fullPath, stripped, 'utf8');
                removed.references += 1;
            }
        }
    }
    return removed;
}

module.exports = { stripSourceMaps };
