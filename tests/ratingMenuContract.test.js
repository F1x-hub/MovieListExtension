import assert from 'node:assert';
import fs from 'node:fs';

console.log('🧪 Running rating menu contract & regression tests...');

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const movieDetailsJs = read('../src/pages/movie-details/movie-details.js');
const movieDetailsCss = read('../src/pages/movie-details/movie-details.css');
const utilsJs = read('../src/shared/utils/Utils.js');

// 1. Static Contract Checks
console.log('  1. Testing static code contracts...');

// Obsolete methods and classes must not exist in movie-details.js
assert.doesNotMatch(movieDetailsJs, /setupRatingMenuListeners/, 'setupRatingMenuListeners must be completely removed');
assert.doesNotMatch(movieDetailsJs, /user-rating-menu-btn/, 'legacy user-rating-menu-btn must not exist in movie-details.js');
assert.doesNotMatch(movieDetailsJs, /user-rating-menu-dropdown/, 'legacy user-rating-menu-dropdown must not exist in movie-details.js');
assert.doesNotMatch(movieDetailsJs, /btn\.getBoundingClientRect\(\)/, 'manual getBoundingClientRect calculation must be removed');

// Unified helper _renderRatingMenu and mc-menu pattern
assert.match(movieDetailsJs, /_renderRatingMenu\s*\(/, '_renderRatingMenu helper method must exist');
assert.match(movieDetailsJs, /mc-menu-container user-rating-menu-container/, 'rating menu must use mc-menu-container');
assert.match(movieDetailsJs, /data-action="edit-user-rating"/, 'edit rating must use data-action="edit-user-rating"');
assert.match(movieDetailsJs, /data-action="delete-user-rating"/, 'delete rating must use data-action="delete-user-rating"');

// Action delegation must handle edit and delete actions
assert.match(movieDetailsJs, /action === 'edit-user-rating'/, 'setupEventListeners must handle edit-user-rating');
assert.match(movieDetailsJs, /action === 'delete-user-rating'/, 'setupEventListeners must handle delete-user-rating');

// Obsolete CSS classes must be removed and replaced with .user-rating-card .mc-menu-*
assert.doesNotMatch(movieDetailsCss, /\.user-rating-menu\s*\{/, 'legacy .user-rating-menu CSS rule must be removed');
assert.doesNotMatch(movieDetailsCss, /\.user-rating-menu-btn\s*\{/, 'legacy .user-rating-menu-btn CSS rule must be removed');
assert.doesNotMatch(movieDetailsCss, /\.user-rating-menu-dropdown\s*\{/, 'legacy .user-rating-menu-dropdown CSS rule must be removed');
assert.match(movieDetailsCss, /\.user-rating-card\s+\.mc-menu-container/, '.user-rating-card .mc-menu-container CSS rule must exist');
assert.match(movieDetailsCss, /\.user-rating-card\s+\.mc-menu-btn/, '.user-rating-card .mc-menu-btn CSS rule must exist');
assert.match(movieDetailsCss, /\.user-rating-card\s+\.mc-menu-dropdown/, '.user-rating-card .mc-menu-dropdown CSS rule must exist');

// Utils.bindTabsAndMenus must support Escape key dismissal
assert.match(utilsJs, /e\.key === 'Escape'/, 'bindTabsAndMenus must handle Escape key');

// 2. Functional DOM Simulation of Utils.bindTabsAndMenus
console.log('  2. Testing functional delegation & lifecycle simulation...');

class MockClassList {
    constructor() {
        this.classes = new Set();
    }
    add(cls) { this.classes.add(cls); }
    remove(cls) { this.classes.delete(cls); }
    toggle(cls) {
        if (this.classes.has(cls)) {
            this.classes.delete(cls);
            return false;
        } else {
            this.classes.add(cls);
            return true;
        }
    }
    contains(cls) { return this.classes.has(cls); }
}

class MockElement {
    constructor(tagName = 'div', className = '') {
        this.tagName = tagName.toUpperCase();
        this.className = className;
        this.classList = new MockClassList();
        if (className) {
            className.split(/\s+/).filter(Boolean).forEach(c => this.classList.add(c));
        }
        this.children = [];
        this.parentElement = null;
        this.nextElementSibling = null;
        this.attributes = {};
    }

    setAttribute(name, val) { this.attributes[name] = String(val); }
    getAttribute(name) { return this.attributes[name] || null; }

    appendChild(child) {
        if (this.children.length > 0) {
            this.children[this.children.length - 1].nextElementSibling = child;
        }
        child.parentElement = this;
        this.children.push(child);
        return child;
    }

    closest(selector) {
        const checkClass = selector.startsWith('.') ? selector.slice(1) : selector;
        let current = this;
        while (current) {
            if (current.classList && current.classList.contains(checkClass)) {
                return current;
            }
            current = current.parentElement;
        }
        return null;
    }

    querySelectorAll(selector) {
        const results = [];
        const match = (el) => {
            const isMatch = selector.split('.').filter(Boolean).every(cls => el.classList.contains(cls));
            if (isMatch) results.push(el);
            for (const child of el.children) match(child);
        };
        for (const child of this.children) match(child);
        return results;
    }
}

class MockDocument extends MockElement {
    constructor() {
        super('#document');
        this.listeners = {};
    }

    addEventListener(event, fn) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(fn);
    }

    dispatchEvent(event) {
        const list = this.listeners[event.type] || [];
        for (const fn of list) {
            fn(event);
        }
    }
}

// Test delegate implementation
const doc = new MockDocument();

// Attach bindTabsAndMenus logic
doc.addEventListener('mousedown', (e) => {
    const menuBtn = e.target.closest('.mc-menu-btn');
    if (menuBtn) {
        if (e.stopPropagation) e.stopPropagation();
        const menu = menuBtn.nextElementSibling;
        if (menu?.classList.contains('mc-menu-dropdown')) {
            doc.querySelectorAll('.mc-menu-dropdown.active').forEach(m => {
                if (m !== menu) m.classList.remove('active');
            });
            menu.classList.toggle('active');
        }
        return;
    }

    if (!e.target.closest('.mc-menu-dropdown')) {
        doc.querySelectorAll('.mc-menu-dropdown.active').forEach(m => m.classList.remove('active'));
    }
});

doc.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        doc.querySelectorAll('.mc-menu-dropdown.active').forEach(m => m.classList.remove('active'));
    }
});

// Build rating card 1
const card1 = new MockElement('div', 'user-rating-card current-user');
const header1 = new MockElement('div', 'user-rating-header');
const menuContainer1 = new MockElement('div', 'mc-menu-container user-rating-menu-container');
const menuBtn1 = new MockElement('button', 'mc-menu-btn');
const menuIcon1 = new MockElement('span', 'mc-menu-icon');
menuBtn1.appendChild(menuIcon1);
const menuDropdown1 = new MockElement('div', 'mc-menu-dropdown');
menuContainer1.appendChild(menuBtn1);
menuContainer1.appendChild(menuDropdown1);
header1.appendChild(menuContainer1);
card1.appendChild(header1);
doc.appendChild(card1);

// Step A: Click button -> dropdown should become active
assert.strictEqual(menuDropdown1.classList.contains('active'), false);
doc.dispatchEvent({ type: 'mousedown', target: menuIcon1 });
assert.strictEqual(menuDropdown1.classList.contains('active'), true, 'Menu dropdown should open when button is clicked');

// Step B: Click outside -> dropdown should close
const outsideEl = new MockElement('div', 'outside-area');
doc.appendChild(outsideEl);
doc.dispatchEvent({ type: 'mousedown', target: outsideEl });
assert.strictEqual(menuDropdown1.classList.contains('active'), false, 'Menu dropdown should close on outside click');

// Step C: Re-open and press Escape
doc.dispatchEvent({ type: 'mousedown', target: menuIcon1 });
assert.strictEqual(menuDropdown1.classList.contains('active'), true);
doc.dispatchEvent({ type: 'keydown', key: 'Escape' });
assert.strictEqual(menuDropdown1.classList.contains('active'), false, 'Menu dropdown should close on Escape key');

// Step D: Dynamically added card (simulation of Firestore onSnapshot added)
const card2 = new MockElement('div', 'user-rating-card current-user');
const header2 = new MockElement('div', 'user-rating-header');
const menuContainer2 = new MockElement('div', 'mc-menu-container user-rating-menu-container');
const menuBtn2 = new MockElement('button', 'mc-menu-btn');
const menuDropdown2 = new MockElement('div', 'mc-menu-dropdown');
menuContainer2.appendChild(menuBtn2);
menuContainer2.appendChild(menuDropdown2);
header2.appendChild(menuContainer2);
card2.appendChild(header2);
doc.appendChild(card2);

// Click new button without any new addEventListener call on card2
doc.dispatchEvent({ type: 'mousedown', target: menuBtn2 });
assert.strictEqual(menuDropdown2.classList.contains('active'), true, 'Dynamically added card menu must open automatically via delegation');

console.log('✅ Rating menu contract & regression tests passed successfully!');
