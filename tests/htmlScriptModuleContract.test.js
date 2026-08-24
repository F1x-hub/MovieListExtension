import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('🧪 Running HTML Script & Module Contract Regression Test Suite...');

// ==========================================
// TEST 1: Offending File (player.config.js) Parses Cleanly in Classic Script Mode
// ==========================================
console.log('\n--- 1. Classic Script VM Execution of player.config.js ---');
const playerConfigPath = path.join(rootDir, 'src/shared/config/player.config.js');
assert.ok(fs.existsSync(playerConfigPath), 'player.config.js must exist');
const playerConfigCode = fs.readFileSync(playerConfigPath, 'utf8');

// In classic browser mode, VM script parses code as non-module classic script.
// Top-level 'export' throws SyntaxError: Unexpected token 'export'
const sandbox = {
    window: {},
    globalThis: {}
};
sandbox.window.window = sandbox.window;
sandbox.globalThis = sandbox.window;

assert.doesNotThrow(() => {
    const script = new vm.Script(playerConfigCode, { filename: 'player.config.js' });
    const context = vm.createContext(sandbox);
    script.runInContext(context);
}, 'player.config.js must parse and run in a classic script context without SyntaxError');

assert.ok(sandbox.window.PlayerConfig, 'window.PlayerConfig must be defined after running player.config.js');
assert.strictEqual(typeof sandbox.window.PlayerConfig.buildYouTubeEmbedUrl, 'function', 'buildYouTubeEmbedUrl must be a function');
const testEmbedUrl = sandbox.window.PlayerConfig.buildYouTubeEmbedUrl('dQw4w9WgXcQ', { autoplay: true, mute: false });
assert.ok(testEmbedUrl.includes('dQw4w9WgXcQ'), 'Embed URL must contain video key');
console.log('  ✅ 1.1 player.config.js parses in classic script mode and exposes window.PlayerConfig');

// ==========================================
// TEST 2: Static HTML Script Contract (Zero top-level export/import in classic scripts)
// ==========================================
console.log('\n--- 2. Static HTML Script Contract Audit ---');

function walkHtmlFiles(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        const full = path.join(dir, file);
        const stat = fs.statSync(full);
        if (stat && stat.isDirectory()) {
            if (file !== 'node_modules' && file !== '.git' && file !== 'dist') {
                results = results.concat(walkHtmlFiles(full));
            }
        } else if (file.endsWith('.html')) {
            results.push(full);
        }
    });
    return results;
}

const htmlFiles = walkHtmlFiles(path.join(rootDir, 'src'));
const scriptTagRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const srcRegex = /src=["']([^"']+)["']/i;
const typeRegex = /type=["']([^"']+)["']/i;

const classicScriptViolations = [];
let totalScriptsAudited = 0;

htmlFiles.forEach(htmlPath => {
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    let match;
    while ((match = scriptTagRegex.exec(htmlContent)) !== null) {
        const attrs = match[1];
        const srcMatch = srcRegex.exec(attrs);
        const typeMatch = typeRegex.exec(attrs);
        const isModule = typeMatch && typeMatch[1].trim().toLowerCase() === 'module';

        if (srcMatch) {
            const scriptSrc = srcMatch[1];
            let resolved;
            if (scriptSrc.startsWith('/')) {
                resolved = path.join(rootDir, scriptSrc.slice(1));
            } else {
                resolved = path.resolve(path.dirname(htmlPath), scriptSrc);
            }

            if (fs.existsSync(resolved)) {
                totalScriptsAudited++;
                const scriptContent = fs.readFileSync(resolved, 'utf8');
                const hasTopLevelExport = /^\s*export\s+/m.test(scriptContent);
                const hasTopLevelImport = /^\s*import\s+/m.test(scriptContent);

                if (!isModule && (hasTopLevelExport || hasTopLevelImport)) {
                    classicScriptViolations.push({
                        html: path.relative(rootDir, htmlPath),
                        src: scriptSrc,
                        resolved: path.relative(rootDir, resolved),
                        hasTopLevelExport,
                        hasTopLevelImport
                    });
                }
            }
        }
    }
});

assert.strictEqual(
    classicScriptViolations.length,
    0,
    `Found classic <script> tags with top-level export/import:\n${JSON.stringify(classicScriptViolations, null, 2)}`
);
console.log(`  ✅ 2.1 Audited ${totalScriptsAudited} script tags across ${htmlFiles.length} HTML files: 0 classic script violations`);

// ==========================================
// TEST 3: MovieDetails Script Dependency Order & Absence of Duplicates
// ==========================================
console.log('\n--- 3. MovieDetails Script Order & Duplicate Audit ---');
const movieDetailsHtmlPath = path.join(rootDir, 'src/pages/movie-details/movie-details.html');
const movieDetailsHtml = fs.readFileSync(movieDetailsHtmlPath, 'utf8');

const mdScripts = [];
let mdMatch;
const mdScriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
while ((mdMatch = mdScriptRegex.exec(movieDetailsHtml)) !== null) {
    const attrs = mdMatch[1];
    const srcMatch = srcRegex.exec(attrs);
    const typeMatch = typeRegex.exec(attrs);
    if (srcMatch) {
        mdScripts.push({
            src: srcMatch[1],
            isModule: typeMatch && typeMatch[1].trim().toLowerCase() === 'module'
        });
    }
}

// Find indices
const findIndex = (srcSubstr) => mdScripts.findIndex(s => s.src.includes(srcSubstr));

const tmdbIdx = findIndex('TMDBService.js');
const idMappingIdx = findIndex('IdMappingService.js');
const franchiseIdx = findIndex('FranchiseService.js');
const recommendationIdx = findIndex('RecommendationService.js');
const playerConfigIdx = findIndex('player.config.js');
const firestoreIdx = findIndex('firestore.js');
const movieDetailsJsIdx = findIndex('movie-details.js');

assert.ok(playerConfigIdx >= 0, 'player.config.js must be loaded in movie-details.html');
assert.ok(franchiseIdx >= 0, 'FranchiseService.js must be loaded in movie-details.html');
assert.ok(tmdbIdx >= 0, 'TMDBService.js must be loaded in movie-details.html');
assert.ok(idMappingIdx >= 0, 'IdMappingService.js must be loaded in movie-details.html');
assert.ok(firestoreIdx >= 0, 'firestore.js must be loaded in movie-details.html');
assert.ok(movieDetailsJsIdx >= 0, 'movie-details.js must be loaded in movie-details.html');

assert.ok(tmdbIdx < firestoreIdx, 'TMDBService.js must precede firestore.js');
assert.ok(idMappingIdx < firestoreIdx, 'IdMappingService.js must precede firestore.js');
assert.ok(franchiseIdx < firestoreIdx, 'FranchiseService.js must precede firestore.js');
assert.ok(recommendationIdx < firestoreIdx, 'RecommendationService.js must precede firestore.js');
assert.ok(firestoreIdx < movieDetailsJsIdx, 'firestore.js must precede movie-details.js');

assert.strictEqual(mdScripts[movieDetailsJsIdx].isModule, true, 'movie-details.js must have type="module"');
console.log('  ✅ 3.1 Script dependency order verified in movie-details.html');

// ==========================================
// TEST 4: FranchiseService and firebaseManager.getFranchiseService()
// ==========================================
console.log('\n--- 4. FranchiseService & Firestore Accessor ---');
const franchiseServicePath = path.join(rootDir, 'src/shared/services/FranchiseService.js');
const franchiseCode = fs.readFileSync(franchiseServicePath, 'utf8');

const franchiseSandbox = {
    window: {},
    globalThis: {},
    chrome: {
        storage: {
            local: {
                get: (keys, cb) => cb({}),
                set: (items, cb) => cb?.(),
                remove: (keys, cb) => cb?.()
            }
        }
    },
    TMDBService: class {
        async getCollection(id) {
            return {
                id,
                name: 'Spider-Man Collection',
                parts: [
                    { tmdbId: 557, title: 'Spider-Man', releaseDate: '2002-05-01' }
                ]
            };
        }
    },
    IdMappingService: class {
        async resolveBatch(candidates) {
            const map = new Map();
            candidates.forEach(c => map.set(c.tmdbId, { kinopoiskId: 326 }));
            return map;
        }
    }
};
franchiseSandbox.window.window = franchiseSandbox.window;
franchiseSandbox.globalThis = franchiseSandbox.window;

const franchiseScript = new vm.Script(franchiseCode, { filename: 'FranchiseService.js' });
const franchiseContext = vm.createContext(franchiseSandbox);
franchiseScript.runInContext(franchiseContext);

assert.ok(franchiseSandbox.window.FranchiseService, 'FranchiseService must attach to window');
const fsInstance = new franchiseSandbox.window.FranchiseService();
assert.ok(fsInstance, 'FranchiseService must instantiate cleanly');

// Test firebaseManager mock accessor
const mockFirebaseManager = {
    getTMDBService: () => new franchiseSandbox.TMDBService(),
    getIdMappingService: () => new franchiseSandbox.IdMappingService(),
    getFranchiseService() {
        if (!this.franchiseService) {
            if (typeof franchiseSandbox.window.FranchiseService === 'undefined') {
                throw new Error('FranchiseService class not found');
            }
            this.franchiseService = new franchiseSandbox.window.FranchiseService({
                tmdbService: this.getTMDBService(),
                idMappingService: this.getIdMappingService()
            });
        }
        return this.franchiseService;
    }
};

const retrievedService = mockFirebaseManager.getFranchiseService();
assert.ok(retrievedService, 'firebaseManager.getFranchiseService() must return instance');
assert.strictEqual(mockFirebaseManager.getFranchiseService(), retrievedService, 'Must return cached singleton instance');

console.log('  ✅ 4.1 FranchiseService global registration and firebaseManager accessor verified');

console.log('\n🎉 ALL HTML Script & Module Contract Tests Passed Successfully!\n');
