const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sourcePath = path.join(__dirname, '..', 'native-host', 'Updater', 'Program.cs');
const source = fs.readFileSync(sourcePath, 'utf8').replace(/\r\n?/g, '\n');

assert.match(
    source,
    /var setupRequested = args\.Length == 0\s*\n\s*\|\| args\.Any\(arg => string\.Equals\(arg, "--setup", StringComparison\.OrdinalIgnoreCase\)\);/,
    'double-click launch must select setup mode without requiring a command-line argument'
);
assert.match(
    source,
    /if \(setupRequested\)\s*\n\s*\{[\s\S]*?Application\.Run\(new SetupForm\(\)\);/
);
assert.match(
    source,
    /if \(args\.Length >= 2 && string\.Equals\(args\[0\], "--execute", StringComparison\.OrdinalIgnoreCase\)\)/,
    'background update execution must keep its explicit --execute mode'
);

console.log('updaterSetupContract.test.js passed');
