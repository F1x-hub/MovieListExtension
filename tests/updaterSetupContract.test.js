const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sourcePath = path.join(__dirname, '..', 'native-host', 'Updater', 'Program.cs');
const source = fs.readFileSync(sourcePath, 'utf8').replace(/\r\n?/g, '\n');
const projectSource = fs.readFileSync(
    path.join(__dirname, '..', 'native-host', 'Updater', 'MovieListUpdater.csproj'),
    'utf8'
).replace(/\r\n?/g, '\n');
const metadataScript = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'generate-update-metadata.js'),
    'utf8'
).replace(/\r\n?/g, '\n');

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
    /MoveWithRetry\(input\.InstallPath, recoveryPath\);/,
    'updates must move the current folder to a single temporary recovery location before replacement'
);
assert.match(source, /private static string GetRecoveryPath\(/);
assert.match(source, /CleanupOperationArtifacts\(state\);/);
assert.match(source, /private const string ApplyMutexName/);
assert.match(source, /private const string UpdaterVersion = "1\.1\.3";/);
assert.match(projectSource, /<InvariantGlobalization>false<\/InvariantGlobalization>/);
assert.match(source, /private const string SetupMutexName/);
assert.match(source, /private const string RecoveryRunOnceName/);
assert.match(source, /private const string RecoveryRunOncePath/);
assert.match(source, /"--recover"/);
assert.match(source, /private static int RecoverOperationAtLogon\(/);
assert.match(source, /RegisterRecoveryRunOnce\(state\.OperationId\)/);
assert.match(source, /private static void RetryCleanup\(/);
assert.match(source, /CleanupPending/);
assert.match(source, /"recovery_required"/);
assert.match(source, /private static bool IsRecoverableStaleOperation/);
assert.match(source, /private static Version\? ReadUpdaterVersion/);
assert.match(source, /interruptionMessage/);
assert.match(source, /UPDATE_REPLACEMENT_FAILED/);
assert.match(source, /var validatedMetadata = ParseAndValidateMetadata\(input\.MetadataText, config\);/);
assert.match(source, /VerifySignature\(Encoding\.UTF8\.GetBytes\(input\.MetadataText\), input\.Signature\)/);
assert.match(source, /RegisterNativeMessagingHost\("Microsoft\\\\Edge"/);
assert.doesNotMatch(source, /\.backup-/i, 'the updater must not create persistent versioned backup directories');
assert.doesNotMatch(source, /Восстановить предыдущую версию/, 'setup must not expose unavailable rollback');
assert.match(metadataScript, /updaterVersionMatch/);
assert.match(metadataScript, /minUpdaterVersion: updaterVersionMatch\[1\]/);

console.log('updaterSetupContract.test.js passed');
