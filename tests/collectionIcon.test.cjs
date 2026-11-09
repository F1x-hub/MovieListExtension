/**
 * Collection icons. The icon picker used to keep SVG markup in a data-icon
 * attribute without escaping quotes, so a chosen default icon was saved as
 * `<svg viewBox=`. Rendered as HTML, that fragment became a 300x150 <svg> that
 * swallowed the collection name next to it: the name was pushed to the far
 * edge of the movie menu, and the bookmarks sidebar showed "Дюна⁰".
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const TRUNCATED = '<svg viewBox=';
const FILM = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/></svg>';

function openWindow() {
    const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://extension.test/', runScripts: 'outside-only' });
    dom.window.eval(`${read('src/shared/services/CollectionService.js')}\n;window.CollectionService = CollectionService;`);
    dom.window.eval(read('src/shared/data/collectionIcons.js'));
    return dom.window;
}

function checkRendering() {
    const window = openWindow();
    const { CollectionService } = window;
    try {
        const row = html => {
            const button = window.document.createElement('button');
            button.innerHTML = `<span class="icon">${html}</span><span class="label">Дюна</span><span class="count">0</span>`;
            return button;
        };

        const film = row(CollectionService.renderIconHtml(FILM, { size: 16 }));
        const filmSvg = film.querySelector('.icon > svg');
        assert.ok(filmSvg, 'A default icon renders as an <svg>');
        assert.equal(filmSvg.getAttribute('width'), '16', 'A default icon gets the requested width');
        assert.equal(filmSvg.getAttribute('height'), '16', 'A default icon gets the requested height');
        assert.equal(filmSvg.querySelector('path').getAttribute('d').slice(0, 9), 'M18 4l2 4', 'The chosen icon is kept');

        const broken = row(CollectionService.renderIconHtml(TRUNCATED, { size: 16 }));
        assert.equal(broken.querySelector('.label').parentElement, broken, 'A truncated icon cannot swallow the name');
        assert.equal(broken.querySelector('.count').parentElement, broken, 'A truncated icon cannot swallow the count');
        assert.equal(broken.querySelector('.icon > svg').getAttribute('width'), '16', 'A truncated icon falls back to a sized icon');
        assert.match(broken.querySelector('.icon path').getAttribute('d'), /^M22 19a2/, 'The fallback is the folder icon');

        // Icon upload was removed and its Storage files deleted: an old picture
        // shows the folder icon instead of a broken image.
        for (const uploaded of ['https://firebasestorage.googleapis.com/v0/b/x/o/collection_icons%2Fu%2Ficon.jpg?alt=media', 'data:image/png;base64,AAAA']) {
            const old = row(CollectionService.renderIconHtml(uploaded, { size: 20 }));
            assert.equal(old.querySelector('img'), null, 'An uploaded picture is no longer loaded');
            assert.match(old.querySelector('.icon path').getAttribute('d'), /^M22 19a2/, 'An uploaded picture shows the folder icon');
            assert.equal(old.querySelector('.icon > svg').getAttribute('width'), '20');
        }

        const hostile = row(CollectionService.renderIconHtml('<svg viewBox="0 0 24 24" onload="x()"><script>x()</script><a href="javascript:x()"><path d="M0 0"/></a></svg>'));
        assert.equal(hostile.querySelector('script'), null, 'Scripts are dropped');
        assert.equal(hostile.querySelector('svg').hasAttribute('onload'), false, 'Event handlers are dropped');
        assert.equal(hostile.querySelector('a').hasAttribute('href'), false, 'External links are dropped');

        const emoji = row(CollectionService.renderIconHtml('🎬', { size: 16 }));
        assert.equal(emoji.querySelector('.icon').textContent, '🎬', 'A legacy emoji icon still shows');

        assert.equal(CollectionService.isUsableIcon(FILM), true);
        assert.equal(CollectionService.isUsableIcon('data:image/png;base64,AAAA'), false);
        assert.equal(CollectionService.isUsableIcon('https://firebasestorage.googleapis.com/v0/b/x/o/i.jpg'), false);
        assert.equal(CollectionService.isUsableIcon('🎬'), true);
        assert.equal(CollectionService.isUsableIcon(TRUNCATED), false);
        assert.equal(CollectionService.isUsableIcon(''), false);
        assert.equal(CollectionService.isUsableIcon(null), false);
    } finally {
        window.close();
    }
}

function loadBookmarksManager(window) {
    const addListener = window.document.addEventListener;
    window.document.addEventListener = function (type, listener, options) {
        if (type !== 'DOMContentLoaded') addListener.call(this, type, listener, options);
    };
    try {
        window.eval(`${read('src/pages/bookmarks/bookmarks.js').replace(/^import .*;\r?\n/gm, '')}\nwindow.TestManager = BookmarksPageManager;`);
    } finally {
        window.document.addEventListener = addListener;
    }
    return window.TestManager;
}

async function settle(window) {
    for (let turn = 0; turn < 10; turn++) await new Promise(resolve => window.setTimeout(resolve, 0));
}

async function openPicker(collection) {
    const window = openWindow();
    const Manager = loadBookmarksManager(window);
    const saved = [];
    const page = {
        escapeHtml: Manager.prototype.escapeHtml,
        loadCustomCollections: async () => {},
        collectionService: {
            createCollection: async (name, icon) => saved.push({ name, icon }),
            updateCollection: async (id, updates) => saved.push({ id, ...updates })
        }
    };
    Manager.prototype.showCollectionModal.call(page, collection);
    await settle(window);
    const modal = window.document.querySelector('.collection-modal-overlay');
    const submit = async () => {
        modal.querySelector('#collectionForm').dispatchEvent(new window.Event('submit', { cancelable: true }));
        await settle(window);
    };
    return { window, modal, saved, submit };
}

async function checkPickerSavesWholeIcon() {
    const { window, modal, saved, submit } = await openPicker(null);
    try {
        const buttons = [...modal.querySelectorAll('.emoji-icon-btn')];
        assert.ok(buttons.length > 2, 'The picker shows the default icons');
        buttons[1].click();
        modal.querySelector('#collectionNameInput').value = 'Дюна';
        await submit();
        assert.equal(saved.length, 1, 'Create saves once');
        assert.match(saved[0].icon, /^<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 3H3/, 'The whole chosen SVG is saved');
        assert.ok(saved[0].icon.endsWith('</svg>'), 'The saved SVG is complete');
    } finally {
        window.close();
    }
}

function checkFranchiseIcons() {
    const window = openWindow();
    try {
        const icons = window.CollectionIcons.FRANCHISE_ICONS;
        assert.ok(icons.length >= 50, 'The franchise set is there');
        const groups = window.CollectionIcons.GROUPS.map(group => group.id);
        for (const icon of icons) assert.ok(groups.includes(icon.group), `${icon.id} belongs to a known group`);
        for (const label of ['Мстители', 'Доктор Стрэндж', 'Чёрная пантера', 'Люди Икс', 'Мир Юрского периода']) {
            assert.ok(icons.some(icon => icon.label === label), `${label} has a tile`);
        }
        assert.equal(new Set(icons.map(icon => icon.id)).size, icons.length, 'Franchise icon ids are unique');
        for (const icon of icons) {
            assert.ok(icon.label, `${icon.id} has a name for the tooltip`);
            assert.ok(window.CollectionService.isUsableIcon(icon.svg), `${icon.id} is whole SVG that the strict parser accepts`);
            assert.match(window.CollectionService.renderIconHtml(icon.svg, { size: 16 }), /width="16"/, `${icon.id} renders at a fixed size`);
        }
    } finally {
        window.close();
    }
}

async function checkPickerSavesFranchiseIcon() {
    const { window, modal, saved, submit } = await openPicker(null);
    try {
        const icons = window.CollectionIcons.FRANCHISE_ICONS;
        const buttons = [...modal.querySelectorAll('.franchise-icon-btn')];
        assert.equal(buttons.length, icons.length, 'The picker shows every franchise icon');
        const text = modal.querySelector('#iconsGrid').textContent;
        for (const group of window.CollectionIcons.GROUPS) {
            assert.ok(text.includes(`Франшизы · ${group.label}`), `The ${group.label} section has a heading`);
        }
        assert.equal(buttons[0].getAttribute('title'), 'Мстители', 'Marvel opens with Мстители');
        const dune = icons.findIndex(icon => icon.id === 'sandworm');
        assert.equal(buttons[dune].getAttribute('title'), 'Дюна', 'A franchise icon is named on hover');
        buttons[dune].click();
        modal.querySelector('#collectionNameInput').value = 'Дюна';
        await submit();
        assert.equal(saved[0].icon, icons[dune].svg, 'The chosen franchise icon is saved as it is');
    } finally {
        window.close();
    }
}

async function checkPickerHasNoUpload() {
    const { window, modal } = await openPicker(null);
    try {
        assert.equal(modal.querySelector('input[type="file"]'), null, 'The dialog has no file input');
        assert.equal(modal.querySelector('#uploadIconBtn'), null, 'The dialog has no upload button');
        assert.equal(modal.querySelector('.custom-icon-btn'), null, 'The grid offers no uploaded pictures');
    } finally {
        window.close();
    }
}

async function checkEditingReplacesUploadedIcon() {
    const uploaded = 'https://firebasestorage.googleapis.com/v0/b/x/o/collection_icons%2Fu%2Ficon.jpg?alt=media';
    const { window, modal, saved, submit } = await openPicker({ id: 'marvel', name: 'Марвел', icon: uploaded, movieIds: [] });
    try {
        const selected = modal.querySelectorAll('.icon-select-btn[data-selected="true"]');
        assert.equal(selected.length, 1, 'One icon is highlighted for a collection with an uploaded picture');
        assert.equal(selected[0], modal.querySelector('.emoji-icon-btn'), 'It is the first default icon');
        await submit();
        assert.ok(window.CollectionService.isUsableIcon(saved[0].icon), 'Saving replaces the uploaded picture with a drawn icon');
    } finally {
        window.close();
    }
}

async function checkEditingRepairsTruncatedIcon() {
    const { window, modal, saved, submit } = await openPicker({ id: 'dune', name: 'Дюна', icon: TRUNCATED, movieIds: [] });
    try {
        const selected = modal.querySelectorAll('.icon-select-btn[data-selected="true"]');
        assert.equal(selected.length, 1, 'One icon is highlighted for a damaged collection');
        assert.equal(selected[0], modal.querySelector('.emoji-icon-btn'), 'It is the first default icon');
        await submit();
        assert.equal(saved.length, 1, 'Edit saves once');
        assert.equal(saved[0].id, 'dune');
        assert.ok(window.CollectionService.isUsableIcon(saved[0].icon), 'Saving replaces the truncated icon with a whole one');
    } finally {
        window.close();
    }
}

(async () => {
    checkRendering();
    await checkPickerSavesWholeIcon();
    checkFranchiseIcons();
    await checkPickerSavesFranchiseIcon();
    await checkEditingRepairsTruncatedIcon();
    await checkPickerHasNoUpload();
    await checkEditingReplacesUploadedIcon();
    console.log('Collection icons passed: icons render at a fixed size, a truncated icon falls back without swallowing the name, the picker saves the whole SVG, and every franchise icon parses and saves as it is, and the dialog has no icon upload while old uploaded pictures show the folder icon (JSDOM).');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
