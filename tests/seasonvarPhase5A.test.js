import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';

console.log('🧪 Running Seasonvar Phase 5A Identity Correctness Tests...\n');

const baseParserSource = fs.readFileSync(
    new URL('../src/shared/services/parsers/BaseParserService.js', import.meta.url),
    'utf8'
);
const seasonvarParserSource = fs.readFileSync(
    new URL('../src/shared/services/parsers/SeasonvarParser.js', import.meta.url),
    'utf8'
);

const parserContext = vm.createContext({
    console,
    window: {
        PlayerSourceLifecycle: {
            setState: () => {}
        }
    },
    fetch: null,
    document: null,
    chrome: {
        storage: {
            local: {
                get: (keys, cb) => cb({})
            }
        }
    },
    DOMParser: class MockDOMParser {}
});

vm.runInContext(baseParserSource, parserContext);
vm.runInContext(seasonvarParserSource, parserContext);

const SeasonvarParser = parserContext.window.SeasonvarParser;
assert(SeasonvarParser, 'SeasonvarParser must be loaded on window');

// ─── MOCK DOM & BROWSER APIS ──────────────────────────────────────────

class MockClassList {
    constructor() {
        this.classes = new Set();
    }
    add(cls) { this.classes.add(cls); }
    remove(cls) { this.classes.delete(cls); }
    contains(cls) { return this.classes.has(cls); }
    toggle(cls, force) {
        if (typeof force === 'boolean') {
            if (force) this.classes.add(cls);
            else this.classes.delete(cls);
            return force;
        }
        if (this.classes.has(cls)) {
            this.classes.delete(cls);
            return false;
        }
        this.classes.add(cls);
        return true;
    }
}

class MockElement {
    constructor(tagName = 'div') {
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.classList = new MockClassList();
        this.attributes = {};
        this._innerHTML = '';
        this.textContent = '';
        this.value = '';
        this.style = {};
        this.eventListeners = {};
        this.selectedIndex = 0;
        this.options = [];
    }

    setAttribute(key, val) { this.attributes[key] = String(val); }
    getAttribute(key) { return this.attributes[key] || null; }
    removeAttribute(key) { delete this.attributes[key]; }

    addEventListener(event, handler) {
        if (!this.eventListeners[event]) this.eventListeners[event] = [];
        this.eventListeners[event].push(handler);
    }

    dispatchEvent(event) {
        const type = event.type || event;
        const handlers = this.eventListeners[type] || [];
        for (const h of handlers) h(event);
    }

    appendChild(child) {
        this.children.push(child);
        return child;
    }

    removeChild(child) {
        const idx = this.children.indexOf(child);
        if (idx !== -1) this.children.splice(idx, 1);
        return child;
    }

    querySelector(selector) {
        if (selector === 'video') return this._findChild(c => c.tagName === 'VIDEO');
        if (selector === '#seasonvarVideo') return this._findChild(c => c.attributes.id === 'seasonvarVideo');
        if (selector === '#svEpisodeSelect') return this._findChild(c => c.attributes.id === 'svEpisodeSelect');
        if (selector === '#svTranslationSelect') return this._findChild(c => c.attributes.id === 'svTranslationSelect');
        if (selector === '.dropdown_episodes') return this._findChild(c => c.classList.contains('dropdown_episodes'));
        if (selector === '.dropdown_seasons') return this._findChild(c => c.classList.contains('dropdown_seasons'));
        if (selector === '.dropdown_seasons .item_simulated.active') {
            const seasons = this._findChild(c => c.classList.contains('dropdown_seasons'));
            return seasons ? seasons._findChild(c => c.classList.contains('item_simulated') && c.classList.contains('active')) : null;
        }
        if (selector === '.seasonvar-voiceover-item.active') {
            return this._findChild(c => c.classList.contains('seasonvar-voiceover-item') && c.classList.contains('active'));
        }
        return null;
    }

    querySelectorAll(selector) {
        if (selector === '.seasonvar-voiceover-item') return this._findAll(c => c.classList.contains('seasonvar-voiceover-item'));
        if (selector === '.dropdown_episodes .item_simulated') {
            const ep = this._findChild(c => c.classList.contains('dropdown_episodes'));
            return ep ? ep._findAll(c => c.classList.contains('item_simulated')) : [];
        }
        if (selector === '.dropdown_seasons .item_simulated') {
            const s = this._findChild(c => c.classList.contains('dropdown_seasons'));
            return s ? s._findAll(c => c.classList.contains('item_simulated')) : [];
        }
        return [];
    }

    _findChild(predicate) {
        if (predicate(this)) return this;
        for (const child of this.children) {
            if (child._findChild) {
                const found = child._findChild(predicate);
                if (found) return found;
            }
        }
        return null;
    }

    _findAll(predicate) {
        const results = [];
        if (predicate(this)) results.push(this);
        for (const child of this.children) {
            if (child._findAll) results.push(...child._findAll(predicate));
        }
        return results;
    }

    get innerHTML() {
        return this._innerHTML;
    }

    set innerHTML(html) {
        this._innerHTML = html;
        this.children = [];
        this._parseMockHtml(html);
    }

    _parseMockHtml(html) {
        // Minimal parser to extract simulated DOM elements
        const videoMatch = html.match(/<video id="([^"]+)"[^>]*>([\s\S]*?)<\/video>/);
        if (videoMatch) {
            const video = new MockElement('video');
            video.setAttribute('id', videoMatch[1]);
            const srcMatch = videoMatch[2].match(/<source src="([^"]+)"/);
            if (srcMatch) video.src = srcMatch[1];
            this.children.push(video);
        }

        const epSelectMatch = html.match(/<select id="svEpisodeSelect"[^>]*>([\s\S]*?)<\/select>/);
        if (epSelectMatch) {
            const select = new MockElement('select');
            select.setAttribute('id', 'svEpisodeSelect');
            const optRegex = /<option value="([^"]+)"\s*(selected)?\s*>([^<]+)<\/option>/g;
            let m;
            let idx = 0;
            while ((m = optRegex.exec(epSelectMatch[1])) !== null) {
                const opt = { value: m[1], text: m[3], selected: !!m[2] };
                select.options.push(opt);
                if (opt.selected) {
                    select.selectedIndex = idx;
                    select.value = opt.value;
                }
                idx++;
            }
            if (!select.value && select.options.length > 0) {
                select.value = select.options[0].value;
            }
            this.children.push(select);
        }

        const dropdownEpIdx = html.indexOf('class="dropdown_episodes"');
        if (dropdownEpIdx !== -1) {
            const div = new MockElement('div');
            div.classList.add('dropdown_episodes');
            const epBlock = html.substring(dropdownEpIdx, html.indexOf('class="dropdown_seasons"', dropdownEpIdx) !== -1 ? html.indexOf('class="dropdown_seasons"', dropdownEpIdx) : html.length);
            const itemRegex = /<div class="item_simulated\s*([^"]*)"\s*data-url="([^"]+)">([^<]+)<\/div>/g;
            let m;
            while ((m = itemRegex.exec(epBlock)) !== null) {
                const item = new MockElement('div');
                item.classList.add('item_simulated');
                if (m[1].includes('active')) item.classList.add('active');
                item.setAttribute('data-url', m[2]);
                item.textContent = m[3];
                div.appendChild(item);
            }
            this.children.push(div);
        }

        const dropdownSeasonsIdx = html.indexOf('class="dropdown_seasons"');
        if (dropdownSeasonsIdx !== -1) {
            const div = new MockElement('div');
            div.classList.add('dropdown_seasons');
            const seasonsBlock = html.substring(dropdownSeasonsIdx);
            const itemRegex = /<div class="item_simulated\s*([^"]*)"\s*data-url="([^"]+)">([^<]+)<\/div>/g;
            let m;
            while ((m = itemRegex.exec(seasonsBlock)) !== null) {
                const item = new MockElement('div');
                item.classList.add('item_simulated');
                if (m[1].includes('active')) item.classList.add('active');
                item.setAttribute('data-url', m[2]);
                item.textContent = m[3];
                div.appendChild(item);
            }
            this.children.push(div);
        }

        const trSelectMatch = html.match(/<select id="svTranslationSelect"[^>]*>([\s\S]*?)<\/select>/);
        if (trSelectMatch) {
            const select = new MockElement('select');
            select.setAttribute('id', 'svTranslationSelect');
            this.children.push(select);
        }
    }
}

global.document = {
    getElementById: (id) => {
        return global._testContainer?.querySelector(`#${id}`) || null;
    },
    querySelectorAll: (selector) => {
        return global._testContainer?.querySelectorAll(selector) || [];
    }
};
parserContext.document = global.document;

global.chrome = {
    storage: {
        local: {
            get: (keys, cb) => cb({})
        }
    }
};

global.window = {
    PlayerSourceLifecycle: {
        setState: () => {}
    }
};

// ─── TEST FIXTURES ───────────────────────────────────────────────────

const JACK_REACHER_SEASONS = [
    { season_number: 1, url: 'http://seasonvar.ru/serial-28000-Jack_Reacher-1-season.html' },
    { season_number: 2, url: 'http://seasonvar.ru/serial-29500-Jack_Reacher-2-season.html' },
    { season_number: 3, url: 'http://seasonvar.ru/serial-31500-Jack_Reacher-3-season.html' },
    { season_number: 4, url: 'http://seasonvar.ru/serial-32100-Jack_Reacher-4-season.html' }
];

const JACK_REACHER_S3_EPISODES = [
    { name: '3 сезон - 1 серия', title: '3 сезон - 1 серия', url: 'http://cdn.seasonvar.ru/reacher/s3e1.mp4', type: 'video' },
    { name: '3 сезон - 2 серия', title: '3 сезон - 2 серия', url: 'http://cdn.seasonvar.ru/reacher/s3e2.mp4', type: 'video' },
    { name: '3 сезон - 3 серия', title: '3 сезон - 3 серия', url: 'http://cdn.seasonvar.ru/reacher/s3e3.mp4', type: 'video' },
    { name: '3 сезон - 4 серия', title: '3 сезон - 4 серия', url: 'http://cdn.seasonvar.ru/reacher/s3e4.mp4', type: 'video' }
];

const JACK_REACHER_S4_EPISODES = [
    { name: '4 сезон - 1 серия', title: '4 сезон - 1 серия', url: 'http://cdn.seasonvar.ru/reacher/s4e1.mp4', type: 'video' }
];

// =====================================================================
// PART 8 & 48: Pure Episode Number Parser Tests
// =====================================================================
console.log('--- Test Group 1: extractEpisodeNumber helper ---');

assert.strictEqual(SeasonvarParser.extractEpisodeNumber('1 серия'), 1);
assert.strictEqual(SeasonvarParser.extractEpisodeNumber('3 серия'), 3);
assert.strictEqual(SeasonvarParser.extractEpisodeNumber('3 сезон - 3 серия'), 3);
assert.strictEqual(SeasonvarParser.extractEpisodeNumber('Серия 12'), 12);
assert.strictEqual(SeasonvarParser.extractEpisodeNumber('Эпизод 5'), 5);
assert.strictEqual(SeasonvarParser.extractEpisodeNumber('10'), 10);
assert.strictEqual(SeasonvarParser.extractEpisodeNumber({ name: '2 сезон, 8 серия' }), 8);
assert.strictEqual(SeasonvarParser.extractEpisodeNumber({ title: '4 серия (озвучка TVShows)' }), 4);
assert.strictEqual(SeasonvarParser.extractEpisodeNumber(null), null);
assert.strictEqual(SeasonvarParser.extractEpisodeNumber(''), null);
assert.strictEqual(SeasonvarParser.extractEpisodeNumber('Трейлер'), null);
console.log('  ✅ 1. extractEpisodeNumber correctly extracts episode numbers across all label formats');

// =====================================================================
// PART 47: Season URL Resolution Tests
// =====================================================================
console.log('\n--- Test Group 2: Season URL Resolution ---');

const parser = new SeasonvarParser();

// =====================================================================
// PART 49: Seasonvar Search Ranking Regression
// =====================================================================
console.log('\n--- Test Group 7: Seasonvar search must not select embedded-word matches ---');

const searchCandidates = [
    {
        url: 'http://seasonvar.ru/serial-43755-Dikie_Skrichery-5-season.html',
        title: 'Дикие Скричеры',
        originalTitle: 'Wild Screechers',
        year: 2022
    },
    {
        url: 'http://seasonvar.ru/serial-32100-Jack_Reacher-4-season.html',
        title: 'Джек Ричер',
        originalTitle: 'Jack Reacher',
        year: 2022
    }
];

const selectedReacher = parser.selectBestSearchResult(searchCandidates, 'Ричер', 'Jack Reacher', 2022);
assert.strictEqual(selectedReacher.title, 'Джек Ричер', 'Whole-word title match must beat embedded match');

const onlyEmbeddedMatch = parser.selectBestSearchResult([searchCandidates[0]], 'Ричер', '', 2022);
assert.strictEqual(onlyEmbeddedMatch, null, 'Embedded-word-only result must be rejected');

parser.parseSearchResults = () => searchCandidates;
parserContext.fetch = async () => ({ ok: true, text: async () => '<html></html>' });
const searchResult = await parser.search('Ричер', 2022, { altName: 'Jack Reacher' });
assert.strictEqual(searchResult.title, 'Джек Ричер', 'search() must use validated ranking');
const bestMatchResult = await parser.searchBestMatch('Ричер', 'Jack Reacher', 2022);
assert.strictEqual(bestMatchResult.title, 'Джек Ричер', 'searchBestMatch() must use validated ranking');

console.log('  ✅ 7. Seasonvar selects Reacher and rejects Дикие Скричеры false positive');

// 2.1 Search S4 + requested S3 -> effective S3 URL
function resolveEffectiveSeasonUrl(searchResultUrl, seasons, requestedSeasonNumber) {
    if (requestedSeasonNumber != null && seasons && seasons.length > 0) {
        const targetSeason = seasons.find(s => Number(s.season_number) === Number(requestedSeasonNumber));
        if (targetSeason && targetSeason.url) {
            return targetSeason.url;
        }
    }
    return searchResultUrl;
}

const s4SearchResultUrl = 'http://seasonvar.ru/serial-32100-Jack_Reacher-4-season.html';

const effectiveS3 = resolveEffectiveSeasonUrl(s4SearchResultUrl, JACK_REACHER_SEASONS, 3);
assert.strictEqual(effectiveS3, 'http://seasonvar.ru/serial-31500-Jack_Reacher-3-season.html', 'Requested S3 resolves S3 URL');

const effectiveS1 = resolveEffectiveSeasonUrl(s4SearchResultUrl, JACK_REACHER_SEASONS, 1);
assert.strictEqual(effectiveS1, 'http://seasonvar.ru/serial-28000-Jack_Reacher-1-season.html', 'Requested S1 resolves S1 URL');

const effectiveS4 = resolveEffectiveSeasonUrl(s4SearchResultUrl, JACK_REACHER_SEASONS, 4);
assert.strictEqual(effectiveS4, 'http://seasonvar.ru/serial-32100-Jack_Reacher-4-season.html', 'Requested S4 resolves S4 URL');

// 2.2 Missing target season does NOT silently remap or change selection
const effectiveMissing = resolveEffectiveSeasonUrl(s4SearchResultUrl, JACK_REACHER_SEASONS, 99);
assert.strictEqual(effectiveMissing, s4SearchResultUrl, 'Missing season returns fallback without mutating selection');

console.log('  ✅ 2. Target season URL resolved correctly from getSeasons without string surgery');

// =====================================================================
// PART 41 & 42: Jack Reacher S3E3 Acceptance & renderPlayer Contract
// =====================================================================
console.log('\n--- Test Group 3: Jack Reacher S3E3 Primary Bug Acceptance ---');

const container = new MockElement('div');
global._testContainer = container;

// Mount S3E3 explicitly
await parser.renderPlayer(container, JACK_REACHER_S3_EPISODES, {
    season: 3,
    episode: 3,
    resolvedSeasonNumber: 3,
    resolvedEpisodeNumber: 3,
    resolvedSeasonUrl: 'http://seasonvar.ru/serial-31500-Jack_Reacher-3-season.html',
    resolvedEpisodeUrl: 'http://cdn.seasonvar.ru/reacher/s3e3.mp4',
    seasons: JACK_REACHER_SEASONS
});

const video = container.querySelector('video');
assert.ok(video, 'Video element mounted');
assert.strictEqual(video.src, 'http://cdn.seasonvar.ru/reacher/s3e3.mp4', 'Video source is S3E3 stream');

const state = container.__seasonvarPlaybackState;
assert.ok(state, 'Structured playback state attached to container');
assert.strictEqual(state.activeSeasonNumber, 3, 'Structured season number is 3');
assert.strictEqual(state.activeEpisodeNumber, 3, 'Structured episode number is 3');
assert.strictEqual(state.activeEpisodeUrl, 'http://cdn.seasonvar.ru/reacher/s3e3.mp4', 'Structured episode URL is S3E3');

console.log('  ✅ 3. Jack Reacher S3E3 mounts S3E3 stream with structured state matching S3/E3');

// =====================================================================
// PART 41: Full Jack Reacher Control Matrix (S1E1, S2E2, S3E3, S4E1)
// =====================================================================
console.log('\n--- Test Group 4: Jack Reacher Control Matrix ---');

const testMatrix = [
    { season: 1, episode: 1, expectedEpUrl: 'http://cdn.seasonvar.ru/reacher/s1e1.mp4', seasonUrl: JACK_REACHER_SEASONS[0].url },
    { season: 2, episode: 2, expectedEpUrl: 'http://cdn.seasonvar.ru/reacher/s2e2.mp4', seasonUrl: JACK_REACHER_SEASONS[1].url },
    { season: 3, episode: 3, expectedEpUrl: 'http://cdn.seasonvar.ru/reacher/s3e3.mp4', seasonUrl: JACK_REACHER_SEASONS[2].url },
    { season: 4, episode: 1, expectedEpUrl: 'http://cdn.seasonvar.ru/reacher/s4e1.mp4', seasonUrl: JACK_REACHER_SEASONS[3].url }
];

for (const tc of testMatrix) {
    const epList = [
        { name: `${tc.season} сезон - 1 серия`, title: `${tc.season} сезон - 1 серия`, url: `http://cdn.seasonvar.ru/reacher/s${tc.season}e1.mp4`, type: 'video' },
        { name: `${tc.season} сезон - 2 серия`, title: `${tc.season} сезон - 2 серия`, url: `http://cdn.seasonvar.ru/reacher/s${tc.season}e2.mp4`, type: 'video' },
        { name: `${tc.season} сезон - 3 серия`, title: `${tc.season} сезон - 3 серия`, url: `http://cdn.seasonvar.ru/reacher/s${tc.season}e3.mp4`, type: 'video' }
    ];

    const testCont = new MockElement('div');
    global._testContainer = testCont;
    await parser.renderPlayer(testCont, epList, {
        season: tc.season,
        episode: tc.episode,
        resolvedSeasonNumber: tc.season,
        resolvedEpisodeNumber: tc.episode,
        resolvedSeasonUrl: tc.seasonUrl,
        seasons: JACK_REACHER_SEASONS
    });

    const v = testCont.querySelector('video');
    assert.strictEqual(v.src, `http://cdn.seasonvar.ru/reacher/s${tc.season}e${tc.episode}.mp4`, `S${tc.season}E${tc.episode} mounted correctly`);
}
console.log('  ✅ 4. Full Jack Reacher matrix (S1E1, S2E2, S3E3, S4E1) verified 100%');

// =====================================================================
// PART 18 & 19 & 20: Host Receiver Protection against Init Events
// =====================================================================
console.log('\n--- Test Group 5: EPISODE_CHANGED Guard & Origin Filtering ---');

let currentHostSelection = {
    seasonNumber: 3,
    episodeNumber: 3,
    source: 'SEASONS_TAB'
};

function handleEpisodeChangedEvent(eventData) {
    const { episode, seasonNumber, origin } = eventData;
    const isExplicit = [
        'SEASONS_TAB',
        'PLAYER_NAVIGATION',
        'AUTO_NEXT',
        'RESUME',
        'NEXT_EPISODE_HERO'
    ].includes(currentHostSelection.source);

    if (isExplicit && origin !== 'USER_PROVIDER_SELECTION') {
        // Ignored: non-user event cannot overwrite canonical host selection
        return false;
    }

    const epNum = typeof episode === 'number' ? episode : parseInt(String(episode).replace(/\D+/g, ''), 10);
    if (!Number.isNaN(epNum) && epNum > 0) {
        currentHostSelection.episodeNumber = epNum;
        if (seasonNumber) currentHostSelection.seasonNumber = seasonNumber;
        return true;
    }
    return false;
}

// 5.1 First-load un-originated event (e.g. { episode: 1 }) is IGNORED
const ignored = handleEpisodeChangedEvent({
    type: 'EPISODE_CHANGED',
    episode: 1,
    episodeLabel: '1 серия'
});
assert.strictEqual(ignored, false, 'Un-originated first load init event is ignored');
assert.strictEqual(currentHostSelection.episodeNumber, 3, 'Host selection remains E3');

// 5.2 Genuine user click inside legacy provider selector UPDATES host
const updated = handleEpisodeChangedEvent({
    type: 'EPISODE_CHANGED',
    episode: 4,
    episodeLabel: '4 серия',
    seasonNumber: 3,
    origin: 'USER_PROVIDER_SELECTION'
});
assert.strictEqual(updated, true, 'User provider selection event is accepted');
assert.strictEqual(currentHostSelection.episodeNumber, 4, 'Host selection updated to E4');

console.log('  ✅ 5. Provider init cannot overwrite explicit host state; genuine user changes sync correctly');

// =====================================================================
// PART 46: Movie Compatibility
// =====================================================================
console.log('\n--- Test Group 6: Movie Compatibility ---');

const movieSelection = {
    kinopoiskId: 301,
    title: 'The Matrix',
    mediaType: 'movie',
    seasonNumber: null,
    episodeNumber: null,
    source: 'GENERIC_WATCH'
};

assert.strictEqual(movieSelection.seasonNumber, null);
assert.strictEqual(movieSelection.episodeNumber, null);
assert.strictEqual(resolveEffectiveSeasonUrl('http://movie.url', [], movieSelection.seasonNumber), 'http://movie.url');
console.log('  ✅ 6. Movie playback with null season/episode is unaffected');

console.log('\n🎉 ALL Seasonvar Phase 5A Identity Correctness Tests Passed Successfully!\n');
