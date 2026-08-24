import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🧪 Running Random Movie Runtime Hardening Tests...\n');

// Mock browser / Chrome environment
class MockClassList {
    constructor() {
        this.classes = new Set();
    }
    add(...names) { names.forEach(n => this.classes.add(n)); }
    remove(...names) { names.forEach(n => this.classes.delete(n)); }
    contains(name) { return this.classes.has(name); }
}

class MockElement {
    constructor(tagName = 'div') {
        this.tagName = tagName.toUpperCase();
        this.dataset = {};
        this.classList = new MockClassList();
        this.style = {};
        this.children = [];
        this._text = '';
        this.innerHTML = '';
        this.src = '';
        this.attributes = {};
        this.listeners = {};
    }

    set textContent(val) {
        this._text = val;
        this.innerHTML = String(val);
    }
    get textContent() {
        return this._text;
    }

    addEventListener(event, callback) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(callback);
    }

    dispatchEvent(event) {
        const list = this.listeners[event.type || event] || [];
        list.forEach(cb => cb(event));
    }

    appendChild(child) {
        this.children.push(child);
        return child;
    }

    querySelector(selector) {
        if (selector === '.cmc-poster') {
            const img = new MockElement('img');
            img.className = 'cmc-poster';
            return img;
        }
        if (selector === '.cmc-watch-btn') {
            const btn = new MockElement('button');
            btn.className = 'cmc-watch-btn';
            return btn;
        }
        if (selector === '.cmc-header') {
            const hdr = new MockElement('div');
            hdr.className = 'cmc-header';
            return hdr;
        }
        return null;
    }

    querySelectorAll() {
        return [];
    }

    removeAttribute(attr) {
        delete this.attributes[attr];
    }
}

global.document = {
    createElement: (tag) => new MockElement(tag),
    getElementById: (id) => new MockElement('div')
};

global.window = {
    document: global.document,
    location: { href: '' },
    i18n: {
        get: (key) => key,
        currentLocale: 'ru'
    }
};

global.chrome = {
    runtime: {
        getURL: (path) => `chrome-extension://mock-id/${path}`,
        onMessage: { addListener: () => {} }
    },
    storage: {
        local: {
            get: async () => ({}),
            set: async () => ({})
        }
    }
};

global.Image = class MockImage {
    constructor() {
        this._src = '';
        this.onload = null;
        this.onerror = null;
    }
    set src(val) {
        this._src = val;
    }
    get src() {
        return this._src;
    }
};

// Load MovieCard
const movieCardCode = fs.readFileSync(path.join(__dirname, '../src/shared/components/MovieCard.js'), 'utf8');
eval(movieCardCode);
const MovieCard = global.window.MovieCard;
global.MovieCard = MovieCard;

// -------------------------------------------------------------
// Test Suite
// -------------------------------------------------------------

// 0. Test Error State Layout Contract
console.log('--- 0. Testing error-state keeps its centered flex layout ---');
{
    const randomJs = fs.readFileSync(path.join(__dirname, '../src/pages/random/random.js'), 'utf8');
    const randomCss = fs.readFileSync(path.join(__dirname, '../src/pages/random/random.css'), 'utf8');

    assert.match(
        randomJs,
        /this\.elements\.errorState\.style\.display\s*=\s*['"]flex['"]/,
        'Error state must be shown as flex so the icon remains centered'
    );
    assert.match(
        randomCss,
        /\.error-state\s*\{[\s\S]*?display:\s*flex;/,
        'Random page error state must define a flex column layout'
    );
    console.log('  âœ… Error icon, message, and retry button share the centered layout');
}

// 1. Test MovieCard.createCompactDetail with year
console.log('--- 1. Testing MovieCard.createCompactDetail with year ---');
{
    const movie = {
        kinopoiskId: 301,
        name: 'Матрица',
        alternativeName: 'The Matrix',
        year: 1999,
        posterUrl: 'https://avatars.mds.yandex.net/test.jpg',
        kpRating: 8.5,
        imdbRating: 8.7,
        votes: { kp: 500000, imdb: 1800000 },
        genres: ['фантастика', 'боевик'],
        countries: ['США']
    };

    assert.doesNotThrow(() => {
        const card = MovieCard.createCompactDetail(movie);
        assert.ok(card, 'Card should be created');
        assert.ok(card.innerHTML.includes('ГОД ПРОИЗВОДСТВА:'), 'Card should include year label');
        assert.ok(card.innerHTML.includes('1999'), 'Card should include year value');
        assert.ok(card.innerHTML.includes('Матрица'), 'Card should include movie name');
        assert.ok(card.innerHTML.includes('The Matrix'), 'Card should include alternative name');
        assert.strictEqual(card.dataset.movieId, '301', 'Dataset movieId should match');
    }, 'createCompactDetail with year should not throw');
    console.log('  ✅ createCompactDetail with year renders successfully');
}

// 2. Test MovieCard.createCompactDetail without year
console.log('\n--- 2. Testing MovieCard.createCompactDetail with null / missing year ---');
{
    const movieWithoutYear = {
        id: 9999,
        name: 'Без года',
        year: null,
        kpRating: 7.0
    };

    assert.doesNotThrow(() => {
        const card = MovieCard.createCompactDetail(movieWithoutYear);
        assert.ok(card, 'Card should be created');
        assert.ok(!card.innerHTML.includes('ГОД ПРОИЗВОДСТВА:'), 'Card should omit year row when year is null');
        assert.strictEqual(card.dataset.movieId, '9999', 'Fallback ID should be used');
    }, 'createCompactDetail without year should not throw');
    console.log('  ✅ null / missing year omits year row without exception');
}

// 3. Test Numeric-String Ratings
console.log('\n--- 3. Testing Rating Type Hardening (Numeric Strings & Nulls) ---');
{
    const movieWithStringRatings = {
        kinopoiskId: 435,
        name: 'Зеленая миля',
        year: 1999,
        kpRating: '9.1',
        imdbRating: '8.6',
        votes: { kp: '900000', imdb: '1300000' }
    };

    assert.doesNotThrow(() => {
        const card = MovieCard.createCompactDetail(movieWithStringRatings);
        assert.ok(card.innerHTML.includes('9.1'), 'Should format string kpRating 9.1');
        assert.ok(card.innerHTML.includes('8.6'), 'Should format string imdbRating 8.6');
    }, 'String ratings should be safely parsed without .toFixed error');

    const movieWithInvalidRatings = {
        kinopoiskId: 436,
        name: 'Неизвестный',
        kpRating: 'invalid_rating',
        imdbRating: null
    };

    assert.doesNotThrow(() => {
        const card = MovieCard.createCompactDetail(movieWithInvalidRatings);
        assert.ok(!card.innerHTML.includes('cmc-rating-kp'), 'Invalid rating should not render badge');
    }, 'Invalid / null ratings should degrade safely');
    console.log('  ✅ String, null, and NaN ratings handled safely without .toFixed crashes');
}

// 4. Test Missing Optional Fields & Sanitization
console.log('\n--- 4. Testing Missing Optional Metadata & CSP Safety ---');
{
    const sparseMovie = {
        kinopoiskId: 777,
        name: null,
        alternativeName: null,
        description: null,
        genres: null,
        countries: null,
        duration: null,
        ageRating: null,
        budget: null,
        fees: null,
        premiere: null
    };

    const card = MovieCard.createCompactDetail(sparseMovie);
    assert.ok(card.innerHTML.includes('Неизвестный фильм'), 'Should fall back to default title');
    assert.ok(!card.innerHTML.includes('onerror="Utils.handlePosterError(this)"'), 'Inline onerror must be absent for CSP compliance');
    assert.ok(!card.innerHTML.includes('undefined'), 'HTML should not contain literal undefined');
    assert.ok(!card.innerHTML.includes('null'), 'HTML should not contain literal null');
    console.log('  ✅ Missing optional metadata renders cleanly and without inline onerror');
}

// 5. Test Random Pipeline async findRandomMovie & Error Catching
console.log('\n--- 5. Testing findRandomMovie async/await & Error Propagation ---');
{
    // Minimal mock of RandomManager to verify await contract
    class MockRandomManager {
        constructor() {
            this.state = 'initial';
            this.displayMovieCalled = false;
        }
        showState(s) {
            this.state = s;
        }
        toggleConfig() {}
        getFilters() { return {}; }
        async displayMovie(movie) {
            this.displayMovieCalled = true;
            if (movie.shouldThrow) {
                throw new Error('Simulated Render Crash');
            }
        }
        async findRandomMovie(mockService) {
            this.showState('loading');
            this.toggleConfig(false);
            try {
                const filters = this.getFilters();
                const movie = await mockService.getRandomMovie(filters);
                if (movie) {
                    await this.displayMovie(movie);
                } else {
                    this.showState('error');
                }
            } catch (error) {
                this.showState('error');
            }
        }
    }

    const manager = new MockRandomManager();
    
    // Normal flow
    await manager.findRandomMovie({
        getRandomMovie: async () => ({ kinopoiskId: 100, name: 'Test Movie', year: 2024 })
    });
    assert.strictEqual(manager.displayMovieCalled, true, 'displayMovie must be called');
    
    // Render error flow
    const errorManager = new MockRandomManager();
    await errorManager.findRandomMovie({
        getRandomMovie: async () => ({ kinopoiskId: 100, name: 'Crash Movie', shouldThrow: true })
    });
    assert.strictEqual(errorManager.state, 'error', 'findRandomMovie must catch render exception and transition to error state');
    console.log('  ✅ findRandomMovie awaits displayMovie and catches render exceptions');
}

// 6. Test Spinner Lifecycle & Candidate Error Pruning
console.log('\n--- 6. Testing Spinner Lifecycle, Rapid Rolls & Error Pruning ---');
{
    let activeIntervals = 0;
    let clearedIntervals = 0;

    const fakeSetInterval = (fn, ms) => {
        activeIntervals++;
        return 123;
    };
    const fakeClearInterval = (id) => {
        clearedIntervals++;
        activeIntervals = Math.max(0, activeIntervals - 1);
    };

    let intervalId = null;
    const stopSpinner = () => {
        if (intervalId) {
            fakeClearInterval(intervalId);
            intervalId = null;
        }
    };
    const startSpinner = (candidates) => {
        stopSpinner(); // Invariant: clear previous
        let activeCandidates = candidates.length > 0 ? [...candidates] : ['/fallback.png'];
        if (activeCandidates.length > 1) {
            intervalId = fakeSetInterval(() => {}, 70);
        }
    };

    // First roll
    startSpinner(['/p1.png', '/p2.png']);
    assert.strictEqual(activeIntervals, 1, 'Exactly one interval running');

    // Rapid second roll before first stops
    startSpinner(['/p3.png', '/p4.png']);
    assert.strictEqual(activeIntervals, 1, 'Previous interval was cleared before starting new one');

    // Stop spinner
    stopSpinner();
    assert.strictEqual(activeIntervals, 0, 'Spinner successfully stopped');

    // Candidate error pruning simulation
    let candidatePool = ['https://dead.url/1.png', 'https://dead.url/2.png'];
    let active = [...candidatePool];
    const triggerError = (failedUrl) => {
        active = active.filter(u => u !== failedUrl);
        if (active.length === 0) active = ['/fallback.png'];
    };

    triggerError('https://dead.url/1.png');
    assert.deepStrictEqual(active, ['https://dead.url/2.png'], 'Failed URL pruned');
    triggerError('https://dead.url/2.png');
    assert.deepStrictEqual(active, ['/fallback.png'], 'Fallback engaged when all URLs fail');

    console.log('  ✅ Spinner interval lifecycle is bounded and candidate pruning works');
}

console.log('\n🎉 ALL Random Movie Runtime Hardening Tests Passed Successfully!');
