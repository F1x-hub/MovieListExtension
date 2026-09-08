const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'dist', 'manifest.json'), 'utf8'));
const assetName = `MovieList-extension-${manifest.version}.zip`;
const assetPath = path.join(root, assetName);
const privateKey = process.env.UPDATE_SIGNING_PRIVATE_KEY;
const updaterSource = fs.readFileSync(
    path.join(root, 'native-host', 'Updater', 'Program.cs'),
    'utf8'
);
const updaterVersionMatch = updaterSource.match(
    /private const string UpdaterVersion = "(\d+\.\d+\.\d+)";/
);

if (!privateKey) {
    throw new Error('UPDATE_SIGNING_PRIVATE_KEY is required to create a signed release.');
}
if (!fs.existsSync(assetPath)) throw new Error(`Release asset is missing: ${assetName}`);

const embeddedPublicKeyMatch = updaterSource.match(
    /private const string ReleasePublicKey = """([\s\S]*?)""";/
);
if (!embeddedPublicKeyMatch) throw new Error('Embedded updater public key is missing.');
if (!updaterVersionMatch) throw new Error('Updater version is missing.');

const normalizePem = (value) => value.replace(/\s+/g, '');
const embeddedPublicKey = embeddedPublicKeyMatch[1].trim();
const derivedPublicKey = crypto.createPublicKey(privateKey)
    .export({ type: 'spki', format: 'pem' })
    .toString()
    .trim();
if (normalizePem(embeddedPublicKey) !== normalizePem(derivedPublicKey)) {
    throw new Error('UPDATE_SIGNING_PRIVATE_KEY does not match the public key embedded in Program.cs.');
}

const asset = fs.readFileSync(assetPath);
const publicKeyHash = crypto.createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest();
let extensionId = '';
for (const value of publicKeyHash.subarray(0, 16)) {
    extensionId += String.fromCharCode(97 + (value >> 4));
    extensionId += String.fromCharCode(97 + (value & 0x0f));
}
const metadata = {
    schemaVersion: 1,
    extensionId,
    version: manifest.version,
    assetName,
    assetUrl: `https://github.com/F1x-hub/MovieListExtension/releases/download/v${manifest.version}/${assetName}`,
    sha256: crypto.createHash('sha256').update(asset).digest('hex'),
    size: asset.length,
    minUpdaterVersion: updaterVersionMatch[1],
    publishedAt: new Date().toISOString()
};
const metadataText = `${JSON.stringify(metadata, null, 2)}\n`;
const signer = crypto.createSign('RSA-SHA256');
signer.update(Buffer.from(metadataText, 'utf8'));
signer.end();
const signature = signer.sign({
    key: privateKey,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST
}).toString('base64');

fs.writeFileSync(path.join(root, 'update.json'), metadataText, 'utf8');
fs.writeFileSync(path.join(root, 'update.json.sig'), `${signature}\n`, 'utf8');
console.log(`Created signed metadata for v${manifest.version}`);
