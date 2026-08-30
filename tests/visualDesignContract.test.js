const assert = require('assert');
const fs = require('fs');

const files = {
    tokens: 'src/shared/styles/tokens.css',
    theme: 'src/shared/styles/theme.css',
    common: 'src/shared/styles/common.css',
    components: 'src/shared/styles/components.css',
    home: 'src/pages/home/home.css',
    catalog: 'src/pages/catalog/catalog.css',
};

const migrationGuardFiles = {
    admin: 'src/shared/styles/admin.css',
    movieCard: 'src/shared/styles/movie-card.css',
    player: 'src/shared/styles/player.css',
    profile: 'src/shared/styles/profile.css',
    ratings: 'src/shared/styles/ratings.css',
    search: 'src/shared/styles/search.css',
    watchlist: 'src/shared/styles/watchlist.css',
    collection: 'src/shared/styles/collection.css',
    random: 'src/pages/random/random.css',
    popup: 'src/shared/styles/popup.css',
    reportWidget: 'src/shared/styles/report-widget.css',
    externalWatchlist: 'src/shared/styles/ex-fs-watchlist.css',
    movieDetails: 'src/pages/movie-details/movie-details.css',
    personDetails: 'src/pages/person-details/person-details.css',
};

const exceptionScopedFiles = [
    'src/pages/bookmarks/bookmarks.css',
    'src/pages/calendar/calendar.css',
    'src/pages/settings/settings.css',
    'src/shared/styles/GamesModal.css',
    'src/shared/styles/WordGuessGame.css',
    'src/shared/styles/back-to-top.css',
    'src/shared/styles/comments.css',
    'src/shared/styles/custom-picker.css',
    'src/shared/styles/favorites.css',
    'src/shared/styles/full-page-auth.css',
    'src/shared/styles/image-lightbox.css',
    'src/shared/styles/navigation.css',
    'src/shared/styles/overflow-fixes.css',
    'src/shared/styles/poster-fixes.css',
    'src/shared/styles/router.css',
];

const neutralHex = new Set([
    '#000000', '#09090b', '#111111', '#111113', '#121214', '#18181b',
    '#27272a', '#3f3f46', '#49494b', '#52525b', '#666666', '#71717a',
    '#66666e', '#838080', '#85858e', '#a1a1aa', '#d4d4d8', '#e4e4e7', '#f4f4f5', '#fafafa',
    '#ffffff',
]);

const documentedExceptions = new Set([
    '#28a745', '#ffc107', '#dc3545', '#17a2b8',
    '#ef4444', '#dc2626', '#f43f5e', '#f5c518',
]);

const forbiddenDecorativeColors = [
    '#fbbf24', '#f59e0b', '#d97706', '#b45309',
    '#67e8f9', '#cffafe', '#22d3ee',
    '#6366f1', '#4f46e5', '#a78bfa', '#c4b5fd',
    '#60a5fa', '#3b82f6', '#38bdf8', '#0284c7',
    '#e94560', '#10b981', '#34d399', '#fb7185',
];

function read(file) {
    return fs.readFileSync(file, 'utf8');
}

function extractHexes(css) {
    return [...css.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((match) => match[0].toLowerCase());
}

function assertOnlyApprovedHexes(file, allowExceptions) {
    const unknown = [...new Set(extractHexes(read(file)))].filter((hex) => {
        return !neutralHex.has(hex) && !(allowExceptions && documentedExceptions.has(hex));
    });
    assert.deepStrictEqual(unknown, [], `${file} contains unapproved colors: ${unknown.join(', ')}`);
}

for (const file of Object.values(files)) {
    assert.ok(fs.existsSync(file), `Missing visual contract file: ${file}`);
}

for (const file of Object.values(migrationGuardFiles)) {
    assert.ok(fs.existsSync(file), `Missing migration guard file: ${file}`);
}

for (const file of exceptionScopedFiles) {
    assert.ok(fs.existsSync(file), `Missing classified exception stylesheet: ${file}`);
}

const cssFilesInSource = fs.readdirSync('src', { recursive: true })
    .filter((file) => file.endsWith('.css'))
    .map((file) => `src/${file.replaceAll('\\', '/')}`)
    .sort();
const classifiedCssFiles = [
    ...Object.values(files),
    ...Object.values(migrationGuardFiles),
    ...exceptionScopedFiles,
].sort();
assert.deepStrictEqual(classifiedCssFiles, cssFilesInSource, 'Every stylesheet must be classified by the visual contract');

assertOnlyApprovedHexes(files.tokens, true);
assertOnlyApprovedHexes(files.theme, false);
assertOnlyApprovedHexes(files.common, true);
assertOnlyApprovedHexes(files.components, true);
assertOnlyApprovedHexes(files.home, true);
assertOnlyApprovedHexes(files.catalog, false);

const theme = read(files.theme);
assert.match(theme, /--theme-accent:\s*#f4f4f5;/);
assert.match(theme, /--theme-accent-hover:\s*#d4d4d8;/);
assert.match(theme, /\.light-theme\s*\{[\s\S]*?--theme-accent:\s*#18181b;/);
assert.match(theme, /\.light-theme\s*\{[\s\S]*?--theme-accent-hover:\s*#3f3f46;/);

const catalog = read(files.catalog);
assert.match(catalog, /--catalog-accent:\s*var\(--ui-color-interactive\);/);
assert.doesNotMatch(catalog, /103,\s*232,\s*249|#67e8f9|#cffafe/i);

const home = read(files.home);
assert.doesNotMatch(home, /#fbbf24|#f59e0b|#d97706|#b45309/i);
assert.doesNotMatch(home, /var\(--theme-accent,\s*#fbbf24\)/i);

const components = read(files.components);
assert.match(components, /\.btn-accent\s*\{[\s\S]*?background:\s*var\(--ui-color-interactive\);/);
assert.match(components, /\.btn-secondary\s*\{[\s\S]*?background:\s*var\(--ui-color-surface\);/);
assert.match(components, /\.dropdown-option\.selected\s*\{[\s\S]*?background:\s*var\(--theme-active-bg\);/);

const common = read(files.common);
assert.match(common, /\*:focus-visible\s*\{[\s\S]*?outline:\s*2px solid var\(--ui-color-interactive\);/);

const migrationGuards = {
    admin: ['#6366f1', '#4f46e5', '#818cf8', '#3b82f6', '#c084fc', '#22d3ee', '#a78bfa', '#c4b5fd'],
    movieCard: ['#0056b3', '#bbff00'],
    player: ['#e50914', '#93c5fa', '#2563eb', '#4f46e5', '#6366f1'],
    profile: ['#8b5cf6', '#c4b5fd', '#a78bfa', '#f59e0b'],
    ratings: ['#fbbf24'],
    search: ['#ffd700', '#eab308'],
    watchlist: ['#667eea', '#764ba2', '#6366f1', '#4f46e5'],
    collection: ['#fbbf24'],
    random: ['#34d399', '#059669', '#fb7185', '#e11d48'],
    popup: ['#22c55e', '#fbbf24'],
    reportWidget: ['#ff4757', '#ff6b81', '#22d3ee'],
    externalWatchlist: ['#6366f1', '#4f46e5'],
    movieDetails: ['#6366f1', '#4f46e5', '#818cf8', '#3b82f6', '#60a5fa', '#c084fc', '#a5b4fc', '#86efac', '#9333ea', '#a855f7', '#93c5fd', '#6ee7b7', '#2aabee'],
    personDetails: ['#6366f1'],
};

for (const [name, colors] of Object.entries(migrationGuards)) {
    const source = read(migrationGuardFiles[name]).toLowerCase();
    for (const color of colors) {
        assert.ok(!source.includes(color), `${migrationGuardFiles[name]} regressed with ${color}`);
    }
}

const admin = read(migrationGuardFiles.admin);
assert.doesNotMatch(admin, /rgba\(\s*(?:34\s*,\s*211\s*,\s*238|167\s*,\s*139\s*,\s*250|192\s*,\s*132\s*,\s*252|124\s*,\s*58\s*,\s*237)/i);

const movieCard = read(migrationGuardFiles.movieCard);
assert.doesNotMatch(movieCard, /rgba\(\s*(?:147\s*,\s*51\s*,\s*234|192\s*,\s*132\s*,\s*252)/i);

const movieDetails = read(migrationGuardFiles.movieDetails);
assert.doesNotMatch(movieDetails, /rgba\(\s*(?:59\s*,\s*130\s*,\s*246|168\s*,\s*85\s*,\s*247|42\s*,\s*171\s*,\s*238)/i);
assert.match(movieDetails, /\.tab-btn\.disabled\s*\{[\s\S]*?color:\s*var\(--theme-text-muted\);[\s\S]*?opacity:\s*1;/);

for (const file of [files.components, migrationGuardFiles.popup, migrationGuardFiles.player, migrationGuardFiles.search]) {
    assert.doesNotMatch(read(file), /--popover-(?:bg|border|radius|shadow|backdrop)\s*:/i, `${file} redefines a legacy generic popover token`);
}

assert.match(read(files.components), /--popover-surface-bg\s*:/);

function contrastRatio(foreground, background) {
    const luminance = (hex) => {
        const channels = hex.slice(1).match(/.{2}/g).map((part) => Number.parseInt(part, 16) / 255);
        const linear = channels.map((channel) => channel <= 0.03928
            ? channel / 12.92
            : ((channel + 0.055) / 1.055) ** 2.4);
        return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    };
    const [first, second] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (first + 0.05) / (second + 0.05);
}

assert.ok(contrastRatio('#85858e', '#09090b') >= 4.5, 'Dark subtle text must meet 4.5:1 contrast');
assert.ok(contrastRatio('#66666e', '#f4f4f5') >= 4.5, 'Light subtle text must meet 4.5:1 contrast');
assert.ok(contrastRatio('#a1a1aa', '#09090b') >= 4.5, 'Dark secondary text must meet 4.5:1 contrast');
assert.ok(contrastRatio('#52525b', '#f4f4f5') >= 4.5, 'Light secondary text must meet 4.5:1 contrast');

assert.match(admin, /\.report-url\s*\{[\s\S]*?color:\s*var\(--theme-text-secondary,\s*var\(--text-secondary\)\);/);
assert.doesNotMatch(admin, /\.report-url\s*\{[\s\S]*?--accent-light/);
assert.match(admin, /\.btn-resolve\s*\{[\s\S]*?background:\s*var\(--theme-text-primary\);[\s\S]*?color:\s*var\(--theme-bg-primary\);/);
assert.match(admin, /\.btn-resolve:disabled\s*\{[\s\S]*?color:\s*var\(--theme-text-muted\);[\s\S]*?opacity:\s*1;/);

for (const [name, file] of Object.entries(files)) {
    const source = read(file).toLowerCase();
    for (const color of forbiddenDecorativeColors) {
        if (name === 'components' && color === '#f43f5e') continue;
        assert.ok(!source.includes(color), `${file} contains forbidden decorative color ${color}`);
    }
}

console.log('Visual design contract tests passed');
