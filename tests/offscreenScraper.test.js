import assert from 'node:assert';
import KINOPOISK_CONFIG from '../src/shared/config/kinopoisk.config.js';
globalThis.KINOPOISK_CONFIG = KINOPOISK_CONFIG;
import KinopoiskService from '../src/shared/services/KinopoiskService.js';
import { extractSearchItemsFromDOM, isChallengeOrCaptchaPage } from '../content-scripts/kinopoisk-search-scraper.js';

console.log('🧪 Running Offscreen Browser Scraper & 3-Tier Fallback Tests...\n');

// Mock a lightweight DOM Element hierarchy for Node testing of extractSearchItemsFromDOM & isChallengeOrCaptchaPage
class MockElement {
    constructor(tagName, attributes = {}, textContent = '') {
        this.tagName = tagName.toUpperCase();
        this.attributes = attributes;
        this.textContent = textContent;
        this.children = [];
    }

    getAttribute(name) {
        return this.attributes[name] !== undefined ? this.attributes[name] : null;
    }

    appendChild(child) {
        this.children.push(child);
        return child;
    }

    querySelectorAll(selector) {
        const results = [];
        const matchSelector = (el) => {
            if (selector.includes('[data-testid="search-top-result"]') && el.attributes['data-testid'] === 'search-top-result') return true;
            if (selector.includes('[data-testid="search-films"]') && el.attributes['data-testid'] === 'search-films') return true;
            if (selector.includes('a[data-test-id="next-link"]') && el.tagName === 'A' && el.attributes['data-test-id'] === 'next-link') return true;
            if (selector.includes('a[data-testid="next-link"]') && el.tagName === 'A' && el.attributes['data-testid'] === 'next-link') return true;
            if (selector === 'script' && el.tagName === 'SCRIPT') return true;
            return false;
        };

        const traverse = (node) => {
            for (const child of node.children) {
                if (matchSelector(child)) {
                    results.push(child);
                }
                traverse(child);
            }
        };

        traverse(this);
        return results;
    }

    querySelector(selector) {
        if (selector.includes('form[action') && this.tagName === 'FORM' && (this.attributes['action']?.includes('sso.kinopoisk.ru') || this.attributes['action']?.includes('sso.passport.yandex.ru'))) return this;
        if (selector.includes('#smartcaptcha') && this.attributes['id'] === 'smartcaptcha') return this;
        if (selector.includes('.smart-captcha') && this.attributes['class'] && this.attributes['class'].includes('smart-captcha')) return this;
        
        for (const child of this.children) {
            const found = child.querySelector(selector);
            if (found) return found;
        }
        return null;
    }
}

// --- Test 1: DOM Extraction Logic in Content Script ---
console.log('1. Testing DOM item extraction and series/film type discrimination...');
const mockDoc = new MockElement('document');
const topSection = new MockElement('section', { 'data-testid': 'search-top-result' });
const filmsSection = new MockElement('section', { 'data-testid': 'search-films' });
const personsSection = new MockElement('section', { 'data-testid': 'search-persons' });

// In top result: Movie "Вот это драма!" (ID: 6116803)
topSection.appendChild(new MockElement('a', { 'data-test-id': 'next-link', href: '/film/6116803/' }, 'Вот это драма!'));

// In films section: Series "Драматическое убийство" (ID: 808381) + Image link + Title link
filmsSection.appendChild(new MockElement('a', { 'data-test-id': 'next-link', href: '/series/808381/' }, 'Драматическое убийство'));
// Duplicate link for same ID in the same section (e.g. alternate layout anchor)
filmsSection.appendChild(new MockElement('a', { 'data-test-id': 'next-link', href: '/series/808381/' }, 'Драматическое убийство (повтор)'));
// Movie "Драма" (ID: 462747)
filmsSection.appendChild(new MockElement('a', { 'data-test-id': 'next-link', href: '/film/462747/' }, 'Драма'));

// In persons section (should be ignored): Person link
personsSection.appendChild(new MockElement('a', { 'data-test-id': 'next-link', href: '/name/12345/' }, 'Иван Иванов'));

mockDoc.appendChild(topSection);
mockDoc.appendChild(filmsSection);
mockDoc.appendChild(personsSection);

const extracted = extractSearchItemsFromDOM(mockDoc);
assert.strictEqual(extracted.length, 3, 'Should extract exactly 3 unique items from top and films sections');
assert.deepStrictEqual(extracted[0], { type: 'film', id: 6116803 });
assert.deepStrictEqual(extracted[1], { type: 'series', id: 808381 });
assert.deepStrictEqual(extracted[2], { type: 'film', id: 462747 });
console.log('✅ DOM extraction, type discrimination, deduplication, and section filtering passed!\n');

// --- Test 2: Challenge / SSO / Captcha Detection in DOM ---
console.log('2. Testing SSO and Captcha DOM detection...');
const challengeDoc = new MockElement('document');
const ssoForm = new MockElement('form', { action: 'https://sso.passport.yandex.ru/install?retpath=...' });
challengeDoc.appendChild(ssoForm);
assert.strictEqual(isChallengeOrCaptchaPage(challengeDoc), true, 'Should detect SSO form action');

const captchaDoc = new MockElement('document');
const captchaDiv = new MockElement('div', { id: 'smartcaptcha' });
captchaDoc.appendChild(captchaDiv);
assert.strictEqual(isChallengeOrCaptchaPage(captchaDoc), true, 'Should detect SmartCaptcha container');

const probeDoc = new MockElement('document');
const scriptProbe = new MockElement('script', {}, 'var it = { host: "https://sso.kinopoisk.ru/install" }; _emitProbe();');
probeDoc.appendChild(scriptProbe);
assert.strictEqual(isChallengeOrCaptchaPage(probeDoc), true, 'Should detect inline probe script');

const normalDoc = new MockElement('document');
normalDoc.appendChild(new MockElement('div', { class: 'content' }, 'Normal content'));
assert.strictEqual(isChallengeOrCaptchaPage(normalDoc), false, 'Normal document should not trigger challenge flag');
console.log('✅ Challenge and SSO detection checks passed!\n');

// --- Test 3: KinopoiskService scrapeSearchResultsOffscreen mocking ---
console.log('3. Testing scrapeSearchResultsOffscreen Chrome message dispatch...');
// Mock chrome.runtime
const originalChrome = globalThis.chrome;

let lastSentMessage = null;
globalThis.chrome = {
    runtime: {
        sendMessage: async (msg) => {
            lastSentMessage = msg;
            if (msg.type === 'KINOPOISK_OFFSCREEN_SCRAPE') {
                if (msg.query === 'драма') {
                    return { success: true, items: [{ type: 'film', id: 6116803 }, { type: 'series', id: 808381 }] };
                }
                if (msg.query === 'blocked') {
                    return { success: false, reason: 'SCRAPE_BLOCKED_EVEN_WITH_SESSION', items: [] };
                }
            }
            return { success: false, reason: 'UNKNOWN' };
        }
    }
};

const service = new KinopoiskService();
const offscreenSuccess = await service.scrapeSearchResultsOffscreen('драма');
assert.strictEqual(lastSentMessage.type, 'KINOPOISK_OFFSCREEN_SCRAPE');
assert.strictEqual(lastSentMessage.query, 'драма');
assert.strictEqual(lastSentMessage.requireRating, false);
assert.strictEqual(offscreenSuccess.length, 2);
assert.strictEqual(offscreenSuccess[0].id, 6116803);

await service.scrapeSearchResultsOffscreen('драма', { requireRating: true });
assert.strictEqual(lastSentMessage.requireRating, true);

const offscreenBlocked = await service.scrapeSearchResultsOffscreen('blocked');
assert.strictEqual(offscreenBlocked, null, 'Blocked offscreen scrape should return null to trigger fallback');
console.log('✅ Offscreen message dispatch and error handling passed!\n');

// --- Test 4: 3-Tier Fallback Hierarchy in searchMovies ---
console.log('4. Testing 3-tier fallback hierarchy in searchMovies...');
// Mock getMoviesByIdsBatch and _fetchWithRotation
service.getMoviesByIdsBatch = async (items) => {
    return items.map(item => ({
        kinopoiskId: item.id,
        name: `Movie ${item.id}`,
        isSeries: item.type === 'series'
    }));
};

// Case A: Tier 1 (Offscreen) succeeds
const tier1Result = await service.searchMovies('драма', 1, 20);
assert.strictEqual(tier1Result.searchSource, 'kinopoisk-offscreen-scrape', 'Should tag as kinopoisk-offscreen-scrape');
assert.strictEqual(tier1Result.docs.length, 2);

// Case B: Tier 1 fails, Tier 2 (Regex Fetch Scraper) succeeds
service.scrapeSearchResults = async (query) => {
    if (query === 'regex_fallback') {
        return [{ type: 'film', id: 111 }, { type: 'film', id: 222 }];
    }
    return null;
};

const tier2Result = await service.searchMovies('regex_fallback', 1, 20);
assert.strictEqual(tier2Result.searchSource, 'kinopoisk-scrape', 'Should tag as kinopoisk-scrape when Tier 1 fails and Tier 2 succeeds');
assert.strictEqual(tier2Result.docs.length, 2);

// Case C: Tier 1 & Tier 2 fail, Tier 3 (API search endpoint) succeeds
service._fetchWithRotation = async (url) => {
    return {
        ok: true,
        json: async () => ({
            docs: [
                { id: 999, name: 'API Fallback Movie', votes: { kp: 50000 } }
            ],
            total: 1,
            page: 1,
            pages: 1
        })
    };
};

const tier3Result = await service.searchMovies('api_only_fallback', 1, 20);
assert.strictEqual(tier3Result.searchSource, 'api-fallback', 'Should tag as api-fallback when both scraping tiers fail');
assert.strictEqual(tier3Result.docs.length, 1);
assert.strictEqual(tier3Result.docs[0].kinopoiskId, 999);

// Restore global chrome
globalThis.chrome = originalChrome;
console.log('✅ 3-Tier fallback hierarchy (offscreen-scrape -> regex-fetch-scrape -> api-fallback) passed!\n');

console.log('🎉 ALL OFFSCREEN SCRAPER & 3-TIER FALLBACK TESTS PASSED SUCCESSFULLY!\n');
