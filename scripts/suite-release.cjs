// Delivers the locally built MediaPlayerSuiteSetup.exe into the release job.
//
//   node scripts/suite-release.cjs stage <MediaPlayerSuiteSetup.exe> <bundle-version.json>
//     Maintainer machine (GITHUB_TOKEN required): uploads the installer to the
//     prerelease `suite-v<version>` and pins its identity in release/suite.json.
//   node scripts/suite-release.cjs fetch
//     Release job: when the pinned Suite is newer than the published catalog,
//     downloads it, verifies size and SHA-256 against git and exports the
//     MEDIAPLAYER_SUITE_* variables that sign it into components.json.
//
// The staging tag never matches the `v*.*.*` release trigger and a prerelease
// never becomes "latest", so staging cannot change what users download.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const OWNER_REPO = 'F1x-hub/MovieListExtension';
const ASSET_NAME = 'MediaPlayerSuiteSetup.exe';
const DOWNLOAD_ROOT = `https://github.com/${OWNER_REPO}/releases/download/`;
const CATALOG_URL = `https://github.com/${OWNER_REPO}/releases/latest/download/components.json`;
const MAX_ASSET_BYTES = 1024 ** 3;
const root = path.join(__dirname, '..');
const descriptorPath = path.join(root, 'release', 'suite.json');

const stable = value => typeof value === 'string' && /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){2,3}$/.test(value);
function compareVersions(left, right) {
    const a = left.split('.').map(Number), b = right.split('.').map(Number);
    for (let index = 0; index < 4; index += 1) if ((a[index] || 0) !== (b[index] || 0)) return Math.sign((a[index] || 0) - (b[index] || 0));
    return 0;
}

function validateSuiteDescriptor(value) {
    if (value?.schemaVersion !== 1 || !stable(value.version) || value.apiMajor !== 1
        || !/^[A-Za-z0-9._-]{1,128}$/.test(String(value.buildId || ''))
        || !/^[a-f0-9]{64}$/.test(String(value.sha256 || ''))
        || !Number.isSafeInteger(value.size) || value.size <= 0 || value.size > MAX_ASSET_BYTES
        || value.stagingTag !== `suite-v${value.version}` || value.assetName !== ASSET_NAME) {
        throw new Error('release/suite.json is invalid.');
    }
    return value;
}

// Publish only a strictly newer Suite; an equal version keeps the previously
// signed descriptor (generate-component-metadata refuses different bytes).
function shouldPublishSuite(staged, previousCatalog) {
    const previous = previousCatalog?.components?.mediaPlayerSuite;
    return !previous || compareVersions(staged.version, previous.version) > 0;
}

function sha256File(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

async function github(method, url, token, body, headers = {}) {
    const response = await fetch(url, { method, body, headers: { Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json', 'User-Agent': 'movielist-suite-release', ...headers } });
    if (!response.ok && response.status !== 404) throw new Error(`${method} ${url}: HTTP ${response.status} ${await response.text()}`);
    return response.status === 404 ? null : response.json();
}

async function stage(installer, bundleVersionFile) {
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error('GITHUB_TOKEN is required to stage the Suite.');
    const bundle = JSON.parse(fs.readFileSync(bundleVersionFile, 'utf8'));
    const size = fs.statSync(installer).size;
    const descriptor = validateSuiteDescriptor({ schemaVersion: 1, version: bundle.version, apiMajor: bundle.apiMajor,
        buildId: bundle.buildId, sha256: sha256File(installer), size, stagingTag: `suite-v${bundle.version}`, assetName: ASSET_NAME });
    const api = `https://api.github.com/repos/${OWNER_REPO}`;
    let release = await github('GET', `${api}/releases/tags/${descriptor.stagingTag}`, token);
    if (!release) {
        release = await github('POST', `${api}/releases`, token, JSON.stringify({
            tag_name: descriptor.stagingTag, target_commitish: 'master', prerelease: true, make_latest: 'false',
            name: `MediaPlayer Suite ${descriptor.version} (staging)`,
            body: 'Staging asset for the next MovieList release. MovieList Hub installs the Suite from the signed component catalog; do not download it from here.'
        }), { 'Content-Type': 'application/json' });
    } else if (!release.prerelease) {
        throw new Error(`${descriptor.stagingTag} exists and is not a prerelease.`);
    }
    const existing = release.assets?.find(asset => asset.name === ASSET_NAME);
    if (existing) {
        if (existing.size !== size) throw new Error('The staged Suite version already has different bytes; build a new version.');
        console.log(`Staged asset already present (${size} bytes).`);
    } else {
        const uploadUrl = release.upload_url.replace(/\{.*$/, '') + `?name=${ASSET_NAME}`;
        await github('POST', uploadUrl, token, fs.readFileSync(installer),
            { 'Content-Type': 'application/octet-stream' });
        console.log(`Uploaded ${ASSET_NAME} (${size} bytes) to ${descriptor.stagingTag}.`);
    }
    fs.mkdirSync(path.dirname(descriptorPath), { recursive: true });
    fs.writeFileSync(descriptorPath, JSON.stringify(descriptor, null, 2) + '\n');
    console.log(`Pinned Suite ${descriptor.version} (${descriptor.sha256}) in release/suite.json.`);
}

async function fetchPreviousCatalog() {
    const response = await fetch(CATALOG_URL, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Cannot read the published catalog: HTTP ${response.status}.`);
    return JSON.parse(await response.text());
}

async function fetchStaged() {
    if (!fs.existsSync(descriptorPath)) {
        console.log('No release/suite.json; the published Suite descriptor is preserved.');
        return;
    }
    const staged = validateSuiteDescriptor(JSON.parse(fs.readFileSync(descriptorPath, 'utf8')));
    if (!shouldPublishSuite(staged, await fetchPreviousCatalog())) {
        console.log(`Suite ${staged.version} is not newer than the published catalog; preserving it.`);
        return;
    }
    const target = path.join(root, ASSET_NAME);
    const url = `${DOWNLOAD_ROOT}${staged.stagingTag}/${ASSET_NAME}`;
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(15 * 60 * 1000) });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()));
            break;
        } catch (error) {
            lastError = error;
            if (attempt === 3) throw new Error(`Cannot download the staged Suite: ${lastError.message}`);
        }
    }
    const size = fs.statSync(target).size;
    if (size !== staged.size || sha256File(target) !== staged.sha256) {
        fs.rmSync(target, { force: true });
        throw new Error('The staged Suite does not match release/suite.json; refusing to sign it.');
    }
    const exports = {
        MEDIAPLAYER_SUITE_ASSET: target,
        MEDIAPLAYER_SUITE_VERSION: staged.version,
        MEDIAPLAYER_SUITE_API_MAJOR: String(staged.apiMajor),
        MEDIAPLAYER_SUITE_BUILD_ID: staged.buildId
    };
    if (!process.env.GITHUB_ENV) throw new Error('GITHUB_ENV is required to pass the Suite to later release steps.');
    fs.appendFileSync(process.env.GITHUB_ENV, Object.entries(exports).map(([key, value]) => `${key}=${value}`).join('\n') + '\n');
    console.log(`Verified Suite ${staged.version} for signing (${size} bytes).`);
}

if (require.main === module) {
    const [command, ...args] = process.argv.slice(2);
    const run = command === 'stage' ? stage(args[0], args[1]) : command === 'fetch' ? fetchStaged()
        : Promise.reject(new Error('Usage: suite-release.cjs stage <installer> <bundle-version.json> | fetch'));
    run.catch(error => { console.error(`[suite-release] ${error.message}`); process.exitCode = 1; });
}

module.exports = { validateSuiteDescriptor, shouldPublishSuite, compareVersions };
