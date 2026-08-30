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
        const nextValue = force === undefined ? !this.values.has(value) : force;
        if (nextValue) this.values.add(value);
        else this.values.delete(value);
        return nextValue;
    }

    contains(value) {
        return this.values.has(value);
    }
}

class MockStyle {
    constructor() {
        this.values = new Map();
    }

    setProperty(key, value) {
        this.values.set(key, String(value));
    }

    removeProperty(key) {
        this.values.delete(key);
    }

    getPropertyValue(key) {
        return this.values.get(key) || '';
    }
}

class MockStorage {
    constructor() {
        this.values = new Map();
    }

    getItem(key) {
        return this.values.has(key) ? this.values.get(key) : null;
    }

    setItem(key, value) {
        this.values.set(key, String(value));
    }
}

const listeners = new Map();
const root = { classList: new MockClassList(), style: new MockStyle() };
const body = { classList: new MockClassList(), style: new MockStyle() };
const storage = new MockStorage();
const document = {
    documentElement: root,
    body,
    querySelector: () => null
};

const context = {
    console,
    document,
    localStorage: storage,
    IconUtils: {
        updateExtensionIcon: () => {}
    },
    chrome: {
        storage: {
            local: {
                set: () => ({ catch: () => {} })
            }
        }
    },
    addEventListener(type, listener) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(listener);
    },
    dispatchEvent(event) {
        (listeners.get(event.type) || []).forEach(listener => listener(event));
    }
};

context.window = context;
context.globalThis = context;

const themeServiceSource = fs.readFileSync(
    new URL('../src/shared/services/ThemeService.js', import.meta.url),
    'utf8'
);
vm.createContext(context);
vm.runInContext(themeServiceSource, context, { filename: 'ThemeService.js' });

const ThemeService = context.ThemeService;
assert.ok(ThemeService, 'ThemeService must expose a global browser API');
assert.equal(ThemeService.getCurrentTheme(), 'dark', 'default theme must remain dark');
assert.equal(root.classList.contains('light-theme'), false, 'dark theme must not add light-theme');
assert.equal(body.classList.contains('dark-theme'), true, 'dark theme must mark the body');

storage.setItem('movieExtensionCustomThemes', JSON.stringify([
    {
        id: 'custom_legacy',
        name: 'Legacy Theme',
        base: 'light',
        variables: {
            '--theme-bg-primary': '#ffffff',
            '--theme-text-primary': '#111111'
        }
    }
]));

const migratedThemes = ThemeService.getCustomThemes();
assert.equal(migratedThemes.length, 1, 'legacy custom theme must be readable');
assert.equal(migratedThemes[0].version, 2, 'legacy theme must be upgraded to schema version 2');
assert.equal(JSON.parse(storage.getItem('movieExtensionCustomThemes')).version, 2, 'migration must persist versioned data');

ThemeService.applyTheme('custom_legacy');
assert.equal(root.classList.contains('light-theme'), true, 'custom light theme must apply light class');
assert.equal(root.style.getPropertyValue('--theme-bg-primary'), '#ffffff');
assert.equal(root.style.getPropertyValue('--theme-text-primary'), '#111111');

ThemeService.saveCustomThemes([{
    id: 'custom_next',
    name: 'Next Theme',
    base: 'dark',
    variables: { '--theme-bg-primary': '#09090b' }
}]);
ThemeService.applyTheme('custom_next');
assert.equal(root.classList.contains('light-theme'), false, 'custom dark theme must remove light class');
assert.equal(root.style.getPropertyValue('--theme-text-primary'), '', 'stale custom variables must be removed');

context.dispatchEvent({ type: 'storage', key: 'movieExtensionTheme', newValue: 'light' });
assert.equal(root.classList.contains('light-theme'), true, 'external theme changes must be applied');
assert.equal(body.classList.contains('light-theme'), true, 'external theme changes must update body');

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
