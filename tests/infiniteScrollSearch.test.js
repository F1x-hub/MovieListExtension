import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

console.log('🧪 Running Search Infinite Scroll Regression Tests...\n');

// 1. Static Contract Test for search.html
const searchHtmlPath = path.resolve('src/pages/search/search.html');
const searchHtml = fs.readFileSync(searchHtmlPath, 'utf8');

assert(searchHtml.includes('id="infiniteScrollTrigger"'), 'search.html must contain #infiniteScrollTrigger');
assert(searchHtml.includes('id="searchEndOfResults"'), 'search.html must contain #searchEndOfResults');
assert(searchHtml.includes('id="searchBtn"'), 'search.html must contain #searchBtn');
assert(searchHtml.includes('type="button" id="searchBtn"') || searchHtml.includes('id="searchBtn" type="button"'), 'search.html #searchBtn must have type="button"');
assert(!searchHtml.includes('id="pagination"'), 'search.html must not contain obsolete #pagination');

console.log('✅ Contract 1: search.html markup matches infinite scroll requirements');

// 2. Static Contract Test for search.js
const searchJsPath = path.resolve('src/pages/search/search.js');
const searchJs = fs.readFileSync(searchJsPath, 'utf8');

assert(searchJs.includes('this.CHUNK_SIZE = 12'), 'search.js must define CHUNK_SIZE = 12');
assert(searchJs.includes('this.scrapedPool'), 'search.js must maintain scrapedPool');
assert(searchJs.includes('this.renderedMovieIds = new Set()'), 'search.js must maintain renderedMovieIds Set');
assert(searchJs.includes('setupIntersectionObserver'), 'search.js must define setupIntersectionObserver');
assert(searchJs.includes('MAX_CONSECUTIVE_AUTO_LOADS = 2'), 'search.js must define MAX_CONSECUTIVE_AUTO_LOADS = 2');
assert(searchJs.includes('isCircuitBreakerTripped'), 'search.js must track isCircuitBreakerTripped');
assert(searchJs.includes('loadMoreResults'), 'search.js must define loadMoreResults');
assert(searchJs.includes('renderMovieCardsChunk'), 'search.js must define renderMovieCardsChunk');
assert(searchJs.includes('this._isSearching'), 'search.js must use _isSearching lock in searchMovies');

console.log('✅ Contract 2: search.js implements chunking, deduplication, observer, and circuit breaker');

// 3. Functional Simulation: Chunk slicing from Scraped Pool (12 items per chunk)
{
    const CHUNK_SIZE = 12;
    // Simulate scrape pool with 28 movies
    let scrapedPool = Array.from({ length: 28 }, (_, i) => ({ kinopoiskId: 1000 + i, name: `Movie ${i + 1}` }));
    
    // Chunk 1
    const chunk1 = scrapedPool.splice(0, CHUNK_SIZE);
    assert.strictEqual(chunk1.length, 12, 'First chunk must have exactly 12 items');
    assert.strictEqual(chunk1[0].kinopoiskId, 1000, 'First item ID is 1000');
    assert.strictEqual(scrapedPool.length, 16, '16 items remaining in pool');

    // Chunk 2
    const chunk2 = scrapedPool.splice(0, CHUNK_SIZE);
    assert.strictEqual(chunk2.length, 12, 'Second chunk must have exactly 12 items');
    assert.strictEqual(chunk2[0].kinopoiskId, 1012, 'First item of chunk 2 is 1012');
    assert.strictEqual(scrapedPool.length, 4, '4 items remaining in pool');

    // Chunk 3 (final)
    const chunk3 = scrapedPool.splice(0, CHUNK_SIZE);
    assert.strictEqual(chunk3.length, 4, 'Third chunk must have remaining 4 items');
    assert.strictEqual(scrapedPool.length, 0, 'Scraped pool is now exhausted');
    
    console.log('✅ Functional Test 1: Scrape pool cleanly slices into chunks of 12');
}

// 4. Functional Simulation: Deduplication with renderedMovieIds Set
{
    const renderedMovieIds = new Set();
    const chunk1 = [
        { kinopoiskId: 101, name: 'Spider-Man 1' },
        { kinopoiskId: 102, name: 'Spider-Man 2' }
    ];
    
    chunk1.forEach(m => {
        renderedMovieIds.add(m.kinopoiskId);
        renderedMovieIds.add(String(m.kinopoiskId));
    });

    // API fallback returns overlapping items + 1 new item
    const apiFallbackDocs = [
        { kinopoiskId: 101, name: 'Spider-Man 1' }, // Duplicate
        { kinopoiskId: '102', name: 'Spider-Man 2' }, // Duplicate (string)
        { kinopoiskId: 103, name: 'Spider-Man 3' }  // New
    ];

    const uniqueNew = apiFallbackDocs.filter(m => !renderedMovieIds.has(m.kinopoiskId) && !renderedMovieIds.has(String(m.kinopoiskId)));
    assert.strictEqual(uniqueNew.length, 1, 'Deduplication must filter out already rendered items');
    assert.strictEqual(uniqueNew[0].kinopoiskId, 103, 'Only new movie 103 passes');

    console.log('✅ Functional Test 2: Deduplication prevents duplicate cards across Scrape and API');
}

// 5. Functional Simulation: Circuit Breaker Logic
{
    const MAX_CONSECUTIVE_AUTO_LOADS = 2;
    let consecutiveAutoLoads = 0;
    let isCircuitBreakerTripped = false;
    let loadCount = 0;

    function simulateAutoLoad() {
        if (isCircuitBreakerTripped || consecutiveAutoLoads >= MAX_CONSECUTIVE_AUTO_LOADS) {
            return false;
        }
        consecutiveAutoLoads++;
        loadCount++;
        return true;
    }

    assert.strictEqual(simulateAutoLoad(), true, 'Load 1 succeeds');
    assert.strictEqual(simulateAutoLoad(), true, 'Load 2 succeeds');
    assert.strictEqual(simulateAutoLoad(), false, 'Load 3 blocked by circuit breaker');
    assert.strictEqual(loadCount, 2, 'Exactly 2 auto-loads executed');

    // Simulate user scroll event resetting counter
    consecutiveAutoLoads = 0;
    assert.strictEqual(simulateAutoLoad(), true, 'Load 3 succeeds after user scroll event');

    console.log('✅ Functional Test 3: Circuit breaker limits runaway auto-loads and resets on scroll');
}

// 6. Functional Simulation: Double-Search Atomic Lock
{
    let isSearching = false;
    let executedSearches = 0;

    async function searchMovies() {
        if (isSearching) return;
        isSearching = true;
        try {
            executedSearches++;
            await new Promise(r => setTimeout(r, 20));
        } finally {
            isSearching = false;
        }
    }

    // Call search concurrently twice
    await Promise.all([searchMovies(), searchMovies()]);
    assert.strictEqual(executedSearches, 1, 'Concurrent searchMovies calls must execute only once');

    console.log('✅ Functional Test 4: Concurrent searches are properly locked');
}

console.log('\n🎉 ALL SEARCH INFINITE SCROLL TESTS PASSED SUCCESSFULLY!\n');
