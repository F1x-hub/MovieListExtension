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
assert.match(source, /Height = 360/);
assert.match(source, /Text = "Готово к подключению\."/);
assert.match(source, /MessageBox\.Show\(\s*this,\s*"Автоматические обновления подключены/);
assert.match(source, /MessageBox\.Show\(this, status\.Text, "Ошибка подключения"/);
assert.match(
    source,
    /Directory\.Delete\(input\.InstallPath, recursive: true\);/,
    'updates must replace the configured folder without creating a backup directory'
);
assert.doesNotMatch(source, /\.backup-/i, 'the updater must not create persistent backup directories');
assert.doesNotMatch(source, /BackupPath/, 'rollback state must not remain in the no-backup updater');
assert.doesNotMatch(source, /Восстановить предыдущую версию/, 'setup must not expose unavailable rollback');

console.log('updaterSetupContract.test.js passed');
