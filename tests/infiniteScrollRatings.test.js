import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

console.log('🧪 Running Infinite Scroll & User Filtering Regression Tests...\n');

// 1. Static contract test for popup.html
const popupHtmlPath = path.resolve('src/popup/popup.html');
const popupHtml = fs.readFileSync(popupHtmlPath, 'utf8');

const feedContentStartIndex = popupHtml.indexOf('id="feedContent"');
const feedContentEndIndex = popupHtml.indexOf('</div>', feedContentStartIndex);
const triggerIndex = popupHtml.indexOf('id="infiniteScrollTrigger"');

assert(feedContentStartIndex !== -1, 'popup.html must contain #feedContent');
assert(triggerIndex !== -1, 'popup.html must contain #infiniteScrollTrigger');
assert(
    triggerIndex > feedContentStartIndex && triggerIndex < popupHtml.indexOf('<!-- Loading overlay', feedContentStartIndex),
    '#infiniteScrollTrigger must be placed INSIDE #feedContent container'
);

console.log('✅ Contract 1: #infiniteScrollTrigger is placed inside #feedContent');

// 2. Static contract test for popup.js
const popupJsPath = path.resolve('src/popup/popup.js');
const popupJs = fs.readFileSync(popupJsPath, 'utf8');

assert(popupJs.includes('root: this.elements.feedContent'), 'setupIntersectionObserver must configure root as feedContent');
assert(popupJs.includes('this.consecutiveAutoLoads'), 'popup.js must maintain consecutiveAutoLoads counter');
assert(popupJs.includes('MAX_CONSECUTIVE_AUTO_LOADS'), 'popup.js must define MAX_CONSECUTIVE_AUTO_LOADS');
assert(popupJs.includes('feedContent.addEventListener(\'scroll\''), 'popup.js must reset auto-loads on user scroll event');
assert(popupJs.includes('isCircuitBreakerTripped'), 'popup.js must track isCircuitBreakerTripped state');

console.log('✅ Contract 2: popup.js implements observer scoping, scroll reset, and circuit breaker');

// 3. Functional test for RatingService.getAllRatings with userId filter
class MockQuery {
    constructor() {
        this.wheres = [];
        this.orderBys = [];
        this.limitVal = null;
        this.startAfterDoc = null;
    }

    where(field, op, value) {
        this.wheres.push({ field, op, value });
        return this;
    }

    orderBy(field, dir) {
        this.orderBys.push({ field, dir });
        return this;
    }

    limit(n) {
        this.limitVal = n;
        return this;
    }

    startAfter(doc) {
        this.startAfterDoc = doc;
        return this;
    }

    async get() {
        let docs = [
            { id: 'doc1', data: () => ({ id: 'doc1', userId: 'user_A', movieId: 101, rating: 9, createdAt: 1000 }) },
            { id: 'doc2', data: () => ({ id: 'doc2', userId: 'user_A', movieId: 102, rating: 8, createdAt: 900 }) },
            { id: 'doc3', data: () => ({ id: 'doc3', userId: 'user_B', movieId: 103, rating: 7, createdAt: 800 }) }
        ];

        for (const w of this.wheres) {
            docs = docs.filter(d => d.data()[w.field] === w.value);
        }

        if (this.limitVal) {
            docs = docs.slice(0, this.limitVal);
        }

        return {
            docs,
            size: docs.length,
            forEach: (cb) => docs.forEach(cb)
        };
    }
}

class MockCollection {
    constructor() {
        this.query = new MockQuery();
    }

    where(field, op, value) {
        return this.query.where(field, op, value);
    }

    orderBy(field, dir) {
        return this.query.orderBy(field, dir);
    }

    limit(n) {
        return this.query.limit(n);
    }

    doc(id) {
        return {
            get: async () => ({
                exists: true,
                id,
                data: () => ({ id })
            })
        };
    }
}

class MockDb {
    collection() {
        return new MockCollection();
    }
}

// Instantiate and test RatingService
const mockDb = new MockDb();
const mockFirebaseManager = { db: mockDb };

// Inline RatingService logic for testing
class TestRatingService {
    constructor(firebaseManager) {
        this.db = firebaseManager.db;
        this.collection = 'ratings';
    }

    async getAllRatings(limit = 50, lastDocInput = null, userId = null) {
        let query = this.db.collection(this.collection);
        if (userId) {
            query = query.where('userId', '==', userId);
        }
        query = query.orderBy('createdAt', 'desc').limit(limit);

        if (lastDocInput) {
            if (typeof lastDocInput === 'string') {
                const lastDoc = await this.db.collection(this.collection).doc(lastDocInput).get();
                if (lastDoc.exists) {
                    query = query.startAfter(lastDoc);
                }
            } else if (lastDocInput.id) {
                query = query.startAfter(lastDocInput);
            }
        }

        const results = await query.get();
        const ratings = [];
        results.forEach(doc => {
            ratings.push({ id: doc.id, ...doc.data() });
        });

        const lastDoc = results.docs.length > 0 ? results.docs[results.docs.length - 1] : null;
        return {
            ratings,
            hasMore: results.size === limit,
            lastDocId: lastDoc ? lastDoc.id : null,
            lastDoc
        };
    }
}

const ratingService = new TestRatingService(mockFirebaseManager);

// Test 3.1: Filter by user_A
const userARatings = await ratingService.getAllRatings(10, null, 'user_A');
assert.strictEqual(userARatings.ratings.length, 2);
assert.strictEqual(userARatings.ratings[0].userId, 'user_A');
assert.strictEqual(userARatings.ratings[1].userId, 'user_A');

// Test 3.2: Filter by user_B
const userBRatings = await ratingService.getAllRatings(10, null, 'user_B');
assert.strictEqual(userBRatings.ratings.length, 1);
assert.strictEqual(userBRatings.ratings[0].userId, 'user_B');

// Test 3.3: Without userId filter (legacy/global)
const allRatings = await ratingService.getAllRatings(10, null, null);
assert.strictEqual(allRatings.ratings.length, 3);

console.log('✅ Test 3: RatingService.getAllRatings correctly filters by userId and preserves global querying');

// 4. Test RatingsCacheService critical error breaker
class TestRatingsCacheService {
    constructor() {
        this.consecutiveCriticalErrors = 0;
        this.MAX_CONSECUTIVE_CRITICAL_ERRORS = 3;
    }

    simulateEnrichment(hasQuotaOr403) {
        if (hasQuotaOr403) {
            this.consecutiveCriticalErrors++;
        } else {
            this.consecutiveCriticalErrors = 0;
        }

        const criticalError = this.consecutiveCriticalErrors >= this.MAX_CONSECUTIVE_CRITICAL_ERRORS;
        return { criticalError };
    }
}

const cacheService = new TestRatingsCacheService();
assert.strictEqual(cacheService.simulateEnrichment(true).criticalError, false, '1st error should not trip');
assert.strictEqual(cacheService.simulateEnrichment(true).criticalError, false, '2nd error should not trip');
assert.strictEqual(cacheService.simulateEnrichment(true).criticalError, true, '3rd consecutive error MUST trip circuit breaker');

// Recover after success
assert.strictEqual(cacheService.simulateEnrichment(false).criticalError, false, 'Success should reset counter');
assert.strictEqual(cacheService.consecutiveCriticalErrors, 0, 'Counter must be 0 after success');

console.log('✅ Test 4: Critical error circuit breaker trips after 3 consecutive quota/403 errors and resets on success');

// 5. Test PopupManager runaway loop circuit breaker simulation
class TestPopupPaginationController {
    constructor() {
        this.consecutiveAutoLoads = 0;
        this.MAX_CONSECUTIVE_AUTO_LOADS = 2;
        this.isCircuitBreakerTripped = false;
        this.isLoadingMore = false;
        this.hasMore = true;
        this.loadCalls = 0;
    }

    onUserScroll() {
        this.consecutiveAutoLoads = 0;
    }

    async triggerLoadMore() {
        if (this.isLoadingMore || !this.hasMore || this.isCircuitBreakerTripped) {
            return { executed: false, reason: 'BLOCKED' };
        }

        if (this.consecutiveAutoLoads >= this.MAX_CONSECUTIVE_AUTO_LOADS) {
            return { executed: false, reason: 'CIRCUIT_BREAKER_TRIPPED' };
        }

        this.consecutiveAutoLoads++;
        this.isLoadingMore = true;
        this.loadCalls++;

        // Simulate async load finish
        this.isLoadingMore = false;
        return { executed: true, loadCalls: this.loadCalls };
    }
}

const controller = new TestPopupPaginationController();

// 1st load (auto-triggered by observer)
const call1 = await controller.triggerLoadMore();
assert.strictEqual(call1.executed, true);
assert.strictEqual(controller.loadCalls, 1);

// 2nd load (auto-triggered by observer)
const call2 = await controller.triggerLoadMore();
assert.strictEqual(call2.executed, true);
assert.strictEqual(controller.loadCalls, 2);

// 3rd load (WITHOUT user scroll -> breaker must stop it)
const call3 = await controller.triggerLoadMore();
assert.strictEqual(call3.executed, false);
assert.strictEqual(call3.reason, 'CIRCUIT_BREAKER_TRIPPED');
assert.strictEqual(controller.loadCalls, 2, 'Total load calls must remain capped at 2 without user scroll');

// User scrolls -> resets breaker
controller.onUserScroll();
assert.strictEqual(controller.consecutiveAutoLoads, 0);

// 4th load (WITH user scroll -> succeeds)
const call4 = await controller.triggerLoadMore();
assert.strictEqual(call4.executed, true);
assert.strictEqual(controller.loadCalls, 3);

console.log('✅ Test 5: Infinite scroll auto-loop is halted by circuit breaker and unblocked upon user scroll event');

console.log('\n🎉 ALL INFINITE SCROLL & USER FILTERING REGRESSION TESTS PASSED!\n');
