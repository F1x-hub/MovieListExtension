const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const REPOSITORY = 'https://github.com/F1x-hub/MovieListExtension/releases/download/';
const CATALOG_URL = 'https://github.com/F1x-hub/MovieListExtension/releases/latest/download/components.json';
const MAX_ASSET_BYTES = 1024 ** 3;
// Compatibility is the protocol's supported floor, not whichever updater was
// released most recently. Otherwise an independent updater patch needlessly
// prevents the existing Suite broker from accepting future API-v1 updates.
const COMPONENT_MIN_UPDATER_VERSION = '1.1.4';
const stable = value => typeof value === 'string' && /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){2,3}$/.test(value)
    && value.split('.').every(part => Number(part) <= 2147483647);
const compare = (a, b) => {
    const aa = a.split('.').map(Number), bb = b.split('.').map(Number);
    for (let i = 0; i < 4; i += 1) if ((aa[i] || 0) !== (bb[i] || 0)) return Math.sign((aa[i] || 0) - (bb[i] || 0));
    return 0;
};
const publicDer = key => crypto.createPublicKey(key).export({ type: 'spki', format: 'der' });

function validateCatalog(catalog) {
    if (catalog?.schemaVersion !== 1 || catalog.productId !== 'movielist' || catalog.channel !== 'stable'
        || !Number.isFinite(Date.parse(catalog.publishedAt)) || !catalog.components || Array.isArray(catalog.components)) throw new Error('Invalid component catalog.');
    const entries = Object.entries(catalog.components);
    if (!entries.length) throw new Error('Empty component catalog.');
    for (const [id, item] of entries) {
        if (!['extension', 'updater', 'mediaPlayerSuite'].includes(id) || !item || !stable(item.version)) throw new Error('Invalid component identity/version.');
        const name = id === 'extension' ? `MovieList-extension-${item.version}.zip` : id === 'updater' ? 'MovieListSetup.exe' : 'MediaPlayerSuiteSetup.exe';
        const suffix = typeof item.assetUrl === 'string' && item.assetUrl.startsWith(REPOSITORY) ? item.assetUrl.slice(REPOSITORY.length) : '';
        const slash = suffix.indexOf('/');
        if (item.assetName !== name || suffix[0] !== 'v' || !stable(suffix.slice(1, slash)) || suffix.slice(slash + 1) !== name
            || !/^[a-f0-9]{64}$/i.test(item.sha256) || !Number.isSafeInteger(item.size) || item.size <= 0 || item.size > MAX_ASSET_BYTES
            || (item.minUpdaterVersion !== undefined && !stable(item.minUpdaterVersion))
            || (item.apiMajor !== undefined && (id !== 'mediaPlayerSuite' || !Number.isInteger(item.apiMajor) || item.apiMajor < 1 || item.apiMajor > 100))
            || (item.buildId !== undefined && (id !== 'mediaPlayerSuite' || !/^[A-Za-z0-9._-]{1,128}$/.test(item.buildId)))) throw new Error('Invalid component descriptor.');
    }
    return catalog;
}

function verifyCatalog(text, signature, publicKey) {
    if (Buffer.byteLength(text) > 128 * 1024 || signature.length > 4096
        || !crypto.verify('sha256', Buffer.from(text), { key: publicKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
            saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST }, Buffer.from(signature.trim(), 'base64'))) throw new Error('Previous catalog signature is invalid.');
    return validateCatalog(JSON.parse(text));
}

function descriptor(file, name, version, tag, extra = {}) {
    if (!stable(version) || !/^v/.test(tag) || !stable(tag.slice(1))) throw new Error('Invalid version/tag.');
    const size = fs.statSync(file).size;
    if (size <= 0 || size > MAX_ASSET_BYTES) throw new Error('Component asset size is invalid.');
    return { version, assetName: name, assetUrl: `${REPOSITORY}${tag}/${name}`,
        sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), size, ...extra };
}

function buildCatalog(options) {
    const { extensionFile, extensionVersion, updaterFile, updaterVersion, tag, previous,
        suiteFile, suiteVersion, suiteApiMajor, suiteBuildId, publishedAt = new Date().toISOString() } = options;
    if (Boolean(suiteFile) !== Boolean(suiteVersion)) throw new Error('Suite asset and version must be provided together.');
    const components = {
        extension: descriptor(extensionFile, `MovieList-extension-${extensionVersion}.zip`, extensionVersion, tag, { minUpdaterVersion: COMPONENT_MIN_UPDATER_VERSION }),
        updater: descriptor(updaterFile, 'MovieListSetup.exe', updaterVersion, tag)
    };
    if (previous) validateCatalog(previous);
    if (suiteFile) {
        if (!Number.isInteger(suiteApiMajor) || suiteApiMajor < 1) throw new Error('Explicit Suite API major is required.');
        components.mediaPlayerSuite = descriptor(suiteFile, 'MediaPlayerSuiteSetup.exe', suiteVersion, tag,
            { minUpdaterVersion: COMPONENT_MIN_UPDATER_VERSION, apiMajor: suiteApiMajor, ...(suiteBuildId ? { buildId: suiteBuildId } : {}) });
    } else if (previous?.components.mediaPlayerSuite) {
        // Preserve the signed immutable previous descriptor; never point a Suite
        // version at an asset missing from the new extension release.
        components.mediaPlayerSuite = { ...previous.components.mediaPlayerSuite };
    }
    for (const [id, item] of Object.entries(components)) {
        if (previous?.components[id] && compare(item.version, previous.components[id].version) < 0) throw new Error(`Refusing to downgrade ${id}.`);
        if (id === 'mediaPlayerSuite' && suiteFile && previous?.components[id]
            && compare(item.version, previous.components[id].version) === 0 && item.sha256 !== previous.components[id].sha256) throw new Error('Refusing to replace a published Suite version with different bytes.');
    }
    return validateCatalog({ schemaVersion: 1, productId: 'movielist', channel: 'stable', publishedAt, components });
}

function signCatalog(catalog, privateKey, publicKey) {
    if (!privateKey || !publicDer(privateKey).equals(publicDer(publicKey))) throw new Error('Signing key does not match the embedded release key.');
    const text = JSON.stringify(validateCatalog(catalog), null, 2) + '\n';
    const signature = crypto.sign('sha256', Buffer.from(text), { key: privateKey,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST }).toString('base64');
    verifyCatalog(text, signature, publicKey);
    return { text, signature };
}

async function fetchPrevious(publicKey) {
    const response = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(30000), cache: 'no-store' });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Cannot preserve latest catalog: HTTP ${response.status}.`);
    const signature = await fetch(CATALOG_URL + '.sig', { signal: AbortSignal.timeout(30000), cache: 'no-store' });
    if (!signature.ok) throw new Error('Cannot preserve latest catalog signature.');
    return verifyCatalog(await response.text(), await signature.text(), publicKey);
}

async function main() {
    const root = path.join(__dirname, '..');
    const source = fs.readFileSync(path.join(root, 'native-host/Updater/Program.cs'), 'utf8');
    const key = source.match(/private const string ReleasePublicKey = """([\s\S]*?)""";/)?.[1].trim();
    // MovieListUpdater.csproj <Version> is the single updater version source.
    const project = fs.readFileSync(path.join(root, 'native-host/Updater/MovieListUpdater.csproj'), 'utf8');
    const updaterVersion = project.match(/<Version>(\d+(?:\.\d+){2,3})<\/Version>/)?.[1];
    const privateKey = process.env.UPDATE_SIGNING_PRIVATE_KEY;
    if (!key || !updaterVersion || !privateKey) throw new Error('Embedded key/version and UPDATE_SIGNING_PRIVATE_KEY are required.');
    if (!publicDer(privateKey).equals(publicDer(key))) throw new Error('Signing key does not match embedded release key.');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'dist/manifest.json'), 'utf8'));
    const updaterFile = path.join(root, 'MovieListSetup.exe');
    const probe = spawnSync(updaterFile, ['--component-probe'], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    let identity;
    try { identity = JSON.parse(probe.stdout); } catch { throw new Error('Built updater does not implement the component probe.'); }
    if (probe.status !== 0 || identity.productId !== 'movielist' || identity.componentId !== 'updater' || identity.version !== updaterVersion
        || identity.componentProtocolVersion !== 1) throw new Error('Built updater/source version mismatch.');
    let previous;
    if (process.env.COMPONENT_CATALOG_PREVIOUS_PATH || process.env.COMPONENT_CATALOG_PREVIOUS_SIGNATURE_PATH) {
        if (!process.env.COMPONENT_CATALOG_PREVIOUS_PATH || !process.env.COMPONENT_CATALOG_PREVIOUS_SIGNATURE_PATH) throw new Error('Both previous catalog paths are required.');
        previous = verifyCatalog(fs.readFileSync(process.env.COMPONENT_CATALOG_PREVIOUS_PATH, 'utf8'),
            fs.readFileSync(process.env.COMPONENT_CATALOG_PREVIOUS_SIGNATURE_PATH, 'utf8'), key);
    } else previous = await fetchPrevious(key);
    const suiteFile = process.env.MEDIAPLAYER_SUITE_ASSET;
    const suiteVersion = process.env.MEDIAPLAYER_SUITE_VERSION;
    const packagedSuite = path.join(root, 'MediaPlayerSuiteSetup.exe');
    if (suiteFile && (!fs.existsSync(packagedSuite)
        || !crypto.createHash('sha256').update(fs.readFileSync(suiteFile)).digest().equals(
            crypto.createHash('sha256').update(fs.readFileSync(packagedSuite)).digest()))) throw new Error('Packaged Suite asset does not match the explicit input.');
    const catalog = buildCatalog({ extensionFile: path.join(root, `MovieList-extension-${manifest.version}.zip`), extensionVersion: manifest.version,
        updaterFile, updaterVersion, tag: process.env.GITHUB_REF_NAME || `v${manifest.version}`, previous,
        suiteFile: suiteFile ? packagedSuite : undefined, suiteVersion, suiteApiMajor: Number(process.env.MEDIAPLAYER_SUITE_API_MAJOR), suiteBuildId: process.env.MEDIAPLAYER_SUITE_BUILD_ID });
    const signed = signCatalog(catalog, privateKey, key);
    fs.writeFileSync(path.join(root, 'components.json'), signed.text);
    fs.writeFileSync(path.join(root, 'components.json.sig'), signed.signature + '\n');
    console.log(`Created signed component catalog (${Object.keys(catalog.components).join(', ')}).`);
}

if (require.main === module) main().catch(error => { console.error(`[components] ${error.message}`); process.exitCode = 1; });
module.exports = { buildCatalog, signCatalog, verifyCatalog, validateCatalog };
