const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const manifestPath = path.join(dist, 'manifest.json');

function fail(message) {
    console.error(`[release] ${message}`);
    process.exit(1);
}

function run(command, args) {
    const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false });
    if (result.status !== 0) fail(`${command} failed with exit code ${result.status}`);
}

if (process.platform === 'win32') {
    run('cmd.exe', ['/d', '/c', 'npm', 'run', 'build']);
} else {
    run('npm', ['run', 'build']);
}

if (!fs.existsSync(manifestPath)) fail('dist/manifest.json is missing after build.');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) fail('manifest version is not a stable semver value.');
const releaseRef = process.env.GITHUB_REF_NAME || '';
if (releaseRef && /^v\d+\.\d+\.\d+$/.test(releaseRef) && releaseRef.slice(1) !== manifest.version) {
    fail(`tag ${releaseRef} does not match manifest version ${manifest.version}.`);
}

// The local TMDB file is intentionally copied for development by the existing
// build, but it must never enter a public release archive.
const localTmdbConfig = path.join(dist, 'src', 'shared', 'config', 'tmdb.config.js');
if (fs.existsSync(localTmdbConfig)) fs.rmSync(localTmdbConfig, { force: true });
const localTmdbSourceMap = `${localTmdbConfig}.map`;
if (fs.existsSync(localTmdbSourceMap)) fs.rmSync(localTmdbSourceMap, { force: true });

const forbiddenNames = ['serviceAccountKey.json', 'tmdb.config.js', '.env', '.firebase'];
const files = [];
function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(fullPath);
        else files.push(path.relative(dist, fullPath).replaceAll(path.sep, '/'));
    }
}
walk(dist);
const forbidden = files.filter(file => forbiddenNames.some(name => file.includes(name)));
if (forbidden.length > 0) fail(`forbidden files found in dist: ${forbidden.join(', ')}`);

const assetName = `MovieList-extension-${manifest.version}.zip`;
const assetPath = path.join(root, assetName);
if (fs.existsSync(assetPath)) fs.rmSync(assetPath, { force: true });

// Windows ships bsdtar. It creates a real ZIP when the archive name ends in .zip.
run('tar', ['-a', '-c', '-f', assetPath, '-C', dist, '.']);

const updaterProject = path.join(root, 'native-host', 'Updater', 'MovieListUpdater.csproj');
if (fs.existsSync(updaterProject)) {
    run('dotnet', ['publish', updaterProject, '--configuration', 'Release']);
    const publishedUpdater = path.join(
        root,
        'native-host',
        'Updater',
        'bin',
        'Release',
        'net10.0-windows',
        'win-x64',
        'publish',
        'MovieListUpdater.exe'
    );
    if (!fs.existsSync(publishedUpdater)) fail('Published updater executable is missing.');
    fs.copyFileSync(publishedUpdater, path.join(root, 'MovieListSetup.exe'));
}

const digest = crypto.createHash('sha256').update(fs.readFileSync(assetPath)).digest('hex');
const size = fs.statSync(assetPath).size;
console.log(JSON.stringify({ version: manifest.version, assetName, assetPath, sha256: digest, size }, null, 2));
