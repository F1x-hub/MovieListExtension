/**
 * Builds libs/three.games.min.js: a tree-shaken ES module with only the parts of
 * three.js the extension imports: the 3D games (the Rubik's Cube, chess and
 * Battleship renderers under src/shared/games/) and the film page's announce
 * stamp (src/pages/movie-details/announce-stamp/). The extension has no bundler,
 * so the vendored file is committed; rerun `npm run vendor:three` after upgrading
 * the `three` dependency or importing new names from the bundle in one of those modules.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = 'three.games.min.js';
const IMPORT_PATTERN = /import \{([^}]+)\} from '[^']*three\.games\.min\.js'/g;

function gameModules(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return gameModules(full);
        return entry.name.endsWith('.js') ? [full] : [];
    });
}

const CONSUMER_DIRS = ['src/shared/games', 'src/pages/movie-details/announce-stamp'];

/** Every name a consumer module imports from the vendored bundle, sorted. */
export function importedNames(dirs = CONSUMER_DIRS.map(dir => path.join(root, dir))) {
    const names = new Set();
    [].concat(dirs).flatMap(dir => gameModules(dir)).forEach(file => {
        for (const match of readFileSync(file, 'utf8').matchAll(IMPORT_PATTERN)) {
            match[1].split(',').map(name => name.trim()).filter(Boolean).forEach(name => names.add(name));
        }
    });
    return [...names].sort();
}

function build() {
    const names = importedNames();
    if (!names.length) throw new Error(`No imports from ${BUNDLE} found under ${CONSUMER_DIRS.join(', ')}`);
    const workDir = mkdtempSync(path.join(tmpdir(), 'vendor-three-'));
    const entry = path.join(workDir, 'entry.mjs');
    const threePath = path.join(root, 'node_modules/three/build/three.module.js').split(path.sep).join('/');
    writeFileSync(entry, `export { ${names.join(', ')} } from '${threePath}';\n`);
    const outFile = path.join(root, 'libs', BUNDLE);
    try {
        execFileSync('npx', ['--yes', 'esbuild@0.25.10', entry, '--bundle', '--format=esm', '--minify',
            '--legal-comments=inline', `--outfile=${outFile}`], { stdio: 'inherit', shell: process.platform === 'win32' });
    } finally {
        rmSync(workDir, { recursive: true, force: true });
    }
    const { version } = JSON.parse(readFileSync(path.join(root, 'node_modules/three/package.json'), 'utf8'));
    const code = readFileSync(outFile, 'utf8');
    writeFileSync(outFile, `/* three.js r${version.split('.')[1]} subset for the 3D games (MIT, see three.LICENSE) */\n${code}`);
    console.log(`Wrote ${path.relative(root, outFile)} with ${names.length} exports.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) build();
