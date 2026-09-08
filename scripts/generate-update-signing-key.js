const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const programPath = path.join(root, 'native-host', 'Updater', 'Program.cs');
const privatePath = path.join(root, 'update-signing-private.pem');
const source = fs.readFileSync(programPath, 'utf8');
const keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicKey = keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const privateKey = keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const marker = /private const string ReleasePublicKey = """[\s\S]*?""";/;
if (!marker.test(source)) throw new Error('ReleasePublicKey marker was not found in Program.cs.');

const replacement = `private const string ReleasePublicKey = """\n${publicKey.trim()}\n""";`;
fs.writeFileSync(programPath, source.replace(marker, replacement), 'utf8');
fs.writeFileSync(privatePath, privateKey, { encoding: 'utf8', mode: 0o600 });

const fingerprint = crypto.createHash('sha256').update(publicKey).digest('hex');
console.log(`Updated native updater public key. Fingerprint: ${fingerprint}`);
console.log(`Store the contents of ${privatePath} as the GitHub Actions secret UPDATE_SIGNING_PRIVATE_KEY.`);
