/**
 * Builds libs/three.rubiks.min.js: a tree-shaken ES module with only the parts of
 * three.js the Rubik's Cube renderer imports. The extension has no bundler, so
 * the vendored file is committed; rerun `npm run vendor:three` after upgrading
 * the `three` dependency or importing new names in RubiksCubeRenderer.js.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const renderer = readFileSync(path.join(root, 'src/shared/games/RubiksCubeRenderer.js'), 'utf8');
const names = renderer.match(/import \{([^}]+)\} from '[^']*three\.rubiks\.min\.js'/)?.[1]
    .split(',').map(name => name.trim()).filter(Boolean);
if (!names?.length) throw new Error('No three.js imports found in RubiksCubeRenderer.js');

const workDir = mkdtempSync(path.join(tmpdir(), 'vendor-three-'));
const entry = path.join(workDir, 'entry.mjs');
const threePath = path.join(root, 'node_modules/three/build/three.module.js').split(path.sep).join('/');
writeFileSync(entry, `export { ${names.join(', ')} } from '${threePath}';\n`);
const outFile = path.join(root, 'libs/three.rubiks.min.js');
try {
    execFileSync('npx', ['--yes', 'esbuild@0.25.10', entry, '--bundle', '--format=esm', '--minify',
        '--legal-comments=inline', `--outfile=${outFile}`], { stdio: 'inherit', shell: process.platform === 'win32' });
} finally {
    rmSync(workDir, { recursive: true, force: true });
}
const { version } = JSON.parse(readFileSync(path.join(root, 'node_modules/three/package.json'), 'utf8'));
const code = readFileSync(outFile, 'utf8');
writeFileSync(outFile, `/* three.js r${version.split('.')[1]} subset for the Rubik's Cube (MIT, see three.LICENSE) */\n${code}`);
console.log(`Wrote ${path.relative(root, outFile)} with ${names.length} exports.`);
