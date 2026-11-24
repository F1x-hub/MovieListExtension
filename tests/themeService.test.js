import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

console.log('🧪 Running ThemeService and design-token contract tests...');

class MockClassList {
    constructor() {
        this.values = new Set();
    }

    toggle(value, force) {
        if (force) this.values.add(value);
        else this.values.delete(value);
    }

    add(value) {
        this.values.add(value);
    }

    remove(value) {
        this.values.delete(value);
    }

    contains(value) {
        return this.values.has(value);
    }
}

const themeServiceSource = fs.readFileSync(
    new URL('../src/shared/services/ThemeService.js', import.meta.url),
    'utf8'
);

/** One page: what is stored, whether the browser is light, and whether the page is in a frame. */
function openPage(stored = {}, { browserIsLight = false, framed = false } = {}) {
    const values = new Map(Object.entries(stored));
    const listeners = new Map();
    const element = () => ({ classList: new MockClassList() });
    const root = element();
    const body = element();
    const query = {
        matches: browserIsLight,
        addEventListener: (type, listener) => { query.changed = listener; }
    };
    const synced = {};
    const context = {
        console,
        document: { documentElement: root, body },
        localStorage: {
            getItem: key => (values.has(key) ? values.get(key) : null),
            setItem: (key, value) => values.set(key, String(value)),
            removeItem: key => values.delete(key)
        },
        matchMedia: () => query,
        chrome: { storage: { local: { set: change => { Object.assign(synced, change); } } } },
        addEventListener: (type, listener) => listeners.set(type, listener)
    };
    context.window = context.globalThis = context.self = context;
    context.top = framed ? {} : context;
    vm.createContext(context);
    vm.runInContext(themeServiceSource, context, { filename: 'ThemeService.js' });
    return {
        service: context.ThemeService,
        root,
        body,
        values,
        synced,
        shown: () => [root, body].map(item => ['light-theme', 'dark-theme'].filter(name => item.classList.contains(name)).join()),
        storageEvent: key => listeners.get('storage')({ key }),
        browserBecomes(light) {
            query.matches = light;
            query.changed();
        }
    };
}

const LIGHT = ['light-theme', 'light-theme'];
const DARK = ['dark-theme', 'dark-theme'];

{
    const page = openPage({}, { browserIsLight: true });
    assert.equal(page.service.getPreference(), 'dark', 'default theme must remain dark, whatever the browser uses');
    assert.deepEqual(page.shown(), DARK);
    assert.equal(page.values.size, 0, 'opening a page must not turn the default into a choice');

    page.service.applyTheme('light');
    assert.deepEqual(page.shown(), LIGHT);
    assert.equal(page.values.get('movieExtensionTheme'), 'light');
    assert.equal(page.root.classList.contains('theme-switching'), false);

    page.service.applyTheme('dark', { persist: false });
    assert.deepEqual(page.shown(), DARK);
    assert.equal(page.values.get('movieExtensionTheme'), 'light', 'a theme applied without persistence must not be stored');

    page.service.applyTheme('no-such-theme');
    assert.equal(page.service.getPreference(), 'dark', 'an unknown theme must be dark');
}

{
    const page = openPage({ movieExtensionTheme: 'light' });
    const states = [];
    page.service.subscribe(state => states.push(`${state.preference}/${state.theme}`));
    page.service.applyTheme('auto');
    assert.equal(page.service.getPreference(), 'auto');
    assert.deepEqual(page.shown(), DARK, 'auto must follow the browser');
    page.browserBecomes(true);
    assert.deepEqual(page.shown(), LIGHT, 'auto must follow the browser while the page is open');
    assert.equal(page.service.getCurrentTheme(), 'light');
    assert.deepEqual(states, ['auto/dark', 'auto/light']);
    assert.equal(page.values.get('movieExtensionTheme'), 'light', 'an older version must find a theme it knows');

    page.service.applyTheme('dark');
    page.browserBecomes(false);
    page.browserBecomes(true);
    assert.equal(page.service.getPreference(), 'dark');
    assert.deepEqual(page.shown(), DARK, 'a chosen theme must not follow the browser');
}

{
    const page = openPage({ movieExtensionTheme: 'dark', movieExtensionThemeAuto: '1' }, { browserIsLight: true });
    assert.deepEqual(page.shown(), LIGHT);
    assert.equal(page.values.get('movieExtensionTheme'), 'light', 'frames must find the theme the browser has now');

    const frame = openPage({ movieExtensionTheme: 'light', movieExtensionThemeAuto: '1' }, { framed: true });
    assert.deepEqual(frame.shown(), LIGHT, 'a frame must take the theme of its page, not its own media query');
    frame.browserBecomes(false);
    assert.deepEqual(frame.shown(), LIGHT);
    assert.deepEqual(frame.synced, {}, 'a frame must not report the mode of the browser');
}

{
    const page = openPage({ movieExtensionTheme: 'dark' });
    page.values.set('movieExtensionTheme', 'light');
    page.storageEvent('movieExtensionTheme');
    assert.deepEqual(page.shown(), LIGHT, 'a choice made in another tab must be applied');
    page.values.set('movieExtensionThemeAuto', '1');
    page.storageEvent('movieExtensionThemeAuto');
    assert.deepEqual(page.shown(), DARK);
}

{
    const custom = JSON.stringify({ version: 2, themes: [
        { id: 'custom_light', name: 'Mine', base: 'light', variables: { '--theme-bg-primary': '#ff0000' } },
        { id: 'custom_dark', name: 'Mine too', base: 'dark', variables: {} }
    ] });
    const light = openPage({ movieExtensionTheme: 'custom_light', movieExtensionCustomThemes: custom });
    assert.deepEqual(light.shown(), LIGHT, 'a theme from the removed editor must become its base');
    assert.equal(light.values.get('movieExtensionTheme'), 'light');
    assert.equal(light.values.get('movieExtensionCustomThemes'), custom, 'the colours a user made must not be deleted');
    assert.deepEqual(openPage({ movieExtensionTheme: 'custom_dark', movieExtensionCustomThemes: custom }).shown(), DARK);
    assert.deepEqual(openPage({ movieExtensionTheme: 'custom_light' }).shown(), DARK, 'a missing theme must be dark');
    const legacy = JSON.stringify([{ id: 'custom_old', base: 'light' }]);
    assert.deepEqual(openPage({ movieExtensionTheme: 'custom_old', movieExtensionCustomThemes: legacy }).shown(), LIGHT);
    assert.deepEqual(openPage({ movieExtensionTheme: 'custom_old', movieExtensionCustomThemes: '{broken' }).shown(), DARK);
}

{
    const page = openPage({ movieExtensionTheme: 'light' });
    assert.equal(page.synced.toolbarScheme, 'dark', 'the toolbar icon must follow the browser, not the theme');
    page.browserBecomes(true);
    assert.equal(page.synced.toolbarScheme, 'light');
}

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const commonCss = read('../src/shared/styles/common.css');
const tokensCss = read('../src/shared/styles/tokens.css');
const componentsCss = read('../src/shared/styles/components.css');

assert.match(commonCss, /@import url\('\.\/tokens\.css'\)/, 'common.css must load semantic tokens');
assert.match(tokensCss, /--ui-button-primary-bg:/, 'tokens.css must define button semantic tokens');
assert.match(componentsCss, /background: var\(--ui-button-primary-bg\)/, 'button must consume semantic tokens');
assert.doesNotMatch(componentsCss, /\.light-theme \.btn-primary\s*\{/, 'button theme values must not have a second owner');

const srcRoot = fileURLToPath(new URL('../src/', import.meta.url));
const canonicalButtonStyles = path.join(srcRoot, 'shared', 'styles', 'components.css');
const canonicalMovieCardStyles = path.join(srcRoot, 'shared', 'styles', 'movie-card.css');

function collectFiles(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const entryPath = path.join(directory, entry.name);
        return entry.isDirectory() ? collectFiles(entryPath) : [entryPath];
    });
}

const canonicalControlSelectors = [
    { name: '.btn', pattern: /^\.btn(?=[:\[]|$)/ },
    { name: '.btn-primary', pattern: /^\.btn-primary(?=[:\[]|$)/ },
    { name: '.btn-secondary', pattern: /^\.btn-secondary(?=[:\[]|$)/ },
    { name: '.btn-accent', pattern: /^\.btn-accent(?=[:\[]|$)/ },
    { name: '.btn-ghost', pattern: /^\.btn-ghost(?=[:\[]|$)/ },
    { name: '.btn-danger', pattern: /^\.btn-danger(?=[:\[]|$)/ },
    { name: '.light-theme .btn-secondary', pattern: /^\.light-theme \.btn-secondary(?=[:\[]|$)/ },
    { name: '.light-theme .btn-accent', pattern: /^\.light-theme \.btn-accent(?=[:\[]|$)/ },
    { name: '.light-theme .btn-ghost', pattern: /^\.light-theme \.btn-ghost(?=[:\[]|$)/ }
];

const canonicalActionSelectors = [
    { name: '.movie-actions-container', pattern: /^\.movie-actions-container$/ },
    { name: '.movie-actions-container .btn', pattern: /^\.movie-actions-container \.btn(?=[:\[]|$)/ },
    { name: '.movie-actions-container .btn-icon', pattern: /^\.movie-actions-container \.btn-icon(?=[:\[]|$)/ }
];

const canonicalMovieCardSelectors = [
    { name: '.movie-card-component', pattern: /^\.movie-card-component$/ }
];

function collectCssSelectors(source) {
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
    return [...withoutComments.matchAll(/([^{}]+)\{/g)]
        .map(match => match[1].trim())
        .filter(selectorList => selectorList && !selectorList.startsWith('@'))
        .flatMap(selectorList => selectorList.split(',').map(selector => selector.trim()))
        .filter(Boolean);
}

function collectControlOwners(source, file) {
    return collectCssSelectors(source).flatMap(selector =>
        canonicalControlSelectors
            .filter(({ pattern }) => pattern.test(selector))
            .map(({ name }) => name + ': ' + file)
    );
}

const fixtureOwners = collectControlOwners(`
    .press-feedback, .btn, .dropdown-trigger { transition: transform 140ms ease; }
    @media (max-width: 320px) { .btn { padding: 4px; } }
`, 'fixture.css');
assert.deepEqual(
    fixtureOwners,
    ['.btn: fixture.css', '.btn: fixture.css'],
    'CSS guard must inspect selector lists and nested media-query rules'
);

const duplicateControlOwners = collectFiles(srcRoot)
    .filter(file => file.endsWith('.css') && file !== canonicalButtonStyles)
    .flatMap(file => collectControlOwners(fs.readFileSync(file, 'utf8'), file));

function collectActionOwners(source, file) {
    return collectCssSelectors(source).flatMap(selector =>
        canonicalActionSelectors
            .filter(({ pattern }) => pattern.test(selector))
            .map(({ name }) => name + ': ' + file)
    );
}

function collectMovieCardOwners(source, file) {
    return collectCssSelectors(source).flatMap(selector =>
        canonicalMovieCardSelectors
            .filter(({ pattern }) => pattern.test(selector))
            .map(({ name }) => name + ': ' + file)
    );
}

const duplicateActionOwners = collectFiles(srcRoot)
    .filter(file => file.endsWith('.css') && file !== canonicalButtonStyles)
    .flatMap(file => collectActionOwners(fs.readFileSync(file, 'utf8'), file));

const canonicalActionOwners = collectActionOwners(
    fs.readFileSync(canonicalButtonStyles, 'utf8'),
    canonicalButtonStyles
);

const duplicateMovieCardOwners = collectFiles(srcRoot)
    .filter(file => file.endsWith('.css') && file !== canonicalMovieCardStyles)
    .flatMap(file => collectMovieCardOwners(fs.readFileSync(file, 'utf8'), file));

const canonicalMovieCardOwners = collectMovieCardOwners(
    fs.readFileSync(canonicalMovieCardStyles, 'utf8'),
    canonicalMovieCardStyles
);

function hasCssClass(selector, className) {
    const escapedClassName = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-zA-Z0-9_-])\\.${escapedClassName}(?=$|[^a-zA-Z0-9_-])`).test(selector);
}

const retiredActionSelectors = collectFiles(srcRoot)
    .filter(file => file.endsWith('.css'))
    .flatMap(file => collectCssSelectors(fs.readFileSync(file, 'utf8'))
        .filter(selector => ['movie-actions', 'action-btn'].some(className => hasCssClass(selector, className)))
        .map(selector => selector + ': ' + file));

const retiredMovieCardSelectors = collectFiles(srcRoot)
    .filter(file => file.endsWith('.css'))
    .flatMap(file => collectCssSelectors(fs.readFileSync(file, 'utf8'))
        .filter(selector => ['movie-card', 'movie-card--search', 'person-details-card-fallback']
            .some(className => hasCssClass(selector, className)))
        .map(selector => selector + ': ' + file));

assert.deepEqual(
    duplicateControlOwners,
    [],
    `generic button controls must have one shared owner: ${duplicateControlOwners.join(', ')}`
);

assert.deepEqual(
    duplicateActionOwners,
    [],
    `movie action layout must have one shared owner: ${duplicateActionOwners.join(', ')}`
);

assert.deepEqual(
    canonicalActionOwners,
    [
        '.movie-actions-container: ' + canonicalButtonStyles,
        '.movie-actions-container .btn: ' + canonicalButtonStyles,
        '.movie-actions-container .btn-icon: ' + canonicalButtonStyles
    ],
    'canonical movie action owner must define the shared layout contract'
);

assert.deepEqual(
    retiredActionSelectors,
    [],
    `retired action selectors must not return after MovieCard migration: ${retiredActionSelectors.join(', ')}`
);

assert.deepEqual(
    duplicateMovieCardOwners,
    [],
    `movie card base styles must have one shared owner: ${duplicateMovieCardOwners.join(', ')}`
);

assert.ok(
    canonicalMovieCardOwners.includes('.movie-card-component: ' + canonicalMovieCardStyles),
    'canonical MovieCard stylesheet must define the shared card root'
);

assert.deepEqual(
    retiredMovieCardSelectors,
    [],
    `retired movie-card selectors must not return after MovieCard migration: ${retiredMovieCardSelectors.join(', ')}`
);

console.log('✅ ThemeService and design-token contract tests passed successfully!');
