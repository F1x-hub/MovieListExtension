import assert from 'node:assert/strict';
import { ACHIEVEMENTS, ACHIEVEMENTS_BY_ID, pointsFor } from '../src/shared/achievements/AchievementCatalog.js';
import {
    computeMetrics,
    evaluate,
    evaluateAll,
    longestStreak,
    maxPoints,
    mergeUnlocks,
    rankFor,
    rankThresholds,
    totalPoints
} from '../src/shared/achievements/AchievementEngine.js';
import { BADGE_ICONS, renderAvatarFrame, renderBadge } from '../src/shared/achievements/AchievementBadge.js';
import { locales } from '../src/shared/i18n/locales.js';

// Catalog: unique ids, ascending thresholds, at most seven tiers, one-offs have one tier.
const ids = new Set();
for (const def of ACHIEVEMENTS) {
    assert.ok(!ids.has(def.id), `duplicate id ${def.id}`);
    ids.add(def.id);
    assert.ok(def.tiers.length >= 1 && def.tiers.length <= 7, def.id);
    def.tiers.forEach((value, index) => index && assert.ok(value > def.tiers[index - 1], `${def.id} thresholds ascend`));
    if (def.oneOff) assert.equal(def.tiers.length, 1, def.id);
}
assert.ok(ACHIEVEMENTS.length >= 30);

const day = (y, m, d, h = 12) => new Date(y, m, d, h).getTime();
const movies = {
    1: { year: 1965, movieLength: 120, genres: [{ name: 'драма' }], countries: [{ name: 'США' }], persons: [
        { id: 1, enProfession: 'actor' }, { id: 2, enProfession: 'director' }] },
    2: { year: 2003, movieLength: 90, genres: [{ name: 'аниме' }, { name: 'мультфильм' }], countries: [{ name: 'Япония' }], persons: [
        { id: 3, enProfession: 'actor' }, { id: 1, enProfession: 'actor' }] },
    3: { year: 2010, isSeries: true, genres: ['ужасы'], countries: ['Великобритания'] }
};
const ratings = [
    { id: 'a', movieId: 1, rating: 10, createdAt: { seconds: day(2026, 0, 1) / 1000 }, comment: 'x'.repeat(1200) },
    { id: 'b', movieId: 2, rating: '2', createdAt: new Date(day(2026, 0, 2, 3)), review: 'Неплохо' },
    { id: 'c', movieId: 3, rating: 8, createdAt: day(2026, 9, 20) }
];
const metrics = computeMetrics({
    ratings,
    movies,
    reactionSummaries: [{ total: 4 }, { total: 3 }],
    reactionsGiven: 6,
    marathonItems: [{ roundId: 1, state: 'watched' }, { roundId: 2, state: 'queued' }, { roundId: 3, state: 'removed' }],
    watchlistCount: 12,
    watchingCount: 2,
    collections: [{ movieIds: [1, 2] }, { movieIds: [3] }],
    pinned: [{}, {}],
    createdAt: day(2025, 0, 1),
    now: day(2026, 0, 1)
});
assert.equal(metrics.ratings, 3);
assert.equal(metrics.tens, 1);
assert.equal(metrics.lows, 1);
assert.equal(metrics.series, 1);
assert.equal(metrics.anime, 1);
assert.equal(metrics.cartoons, 1);
assert.equal(metrics.classics, 1);
assert.equal(metrics.countries, 3);
assert.equal(metrics.decades, 3);
assert.equal(metrics.actors, 2);
assert.equal(metrics.directors, 1, 'directors count only from films rated 8+');
assert.equal(metrics.hours, 3, 'series length is not counted; 210 minutes = 3 hours');
assert.equal(metrics.reviews, 2);
assert.equal(metrics.longReviews, 1);
assert.equal(metrics.nightRatings, 1);
assert.equal(metrics.halloweenHorror, 1);
assert.equal(metrics.streak, 2);
assert.equal(metrics.reactionsReceived, 7);
assert.equal(metrics.reactionsGiven, 6);
assert.equal(metrics.marathonRounds, 2, 'removed items do not count');
assert.equal(metrics.marathonWatched, 1);
assert.equal(metrics.collections, 2);
assert.equal(metrics.collectionItems, 3);
assert.equal(metrics.pinned, 2);
assert.equal(metrics.accountDays, 365);
assert.equal(metrics.distinctScores, 3);

// Streak: consecutive days, gaps reset it.
assert.equal(longestStreak([day(2026, 0, 1), day(2026, 0, 1, 20), day(2026, 0, 2), day(2026, 0, 3), day(2026, 0, 5)]), 3);
assert.equal(longestStreak([]), 0);

// Evaluation: tier, next threshold and progress.
const rater = ACHIEVEMENTS_BY_ID.rater;
assert.deepEqual(evaluate(rater, 0), { id: 'rater', value: 0, tier: 0, total: 7, next: 5, progress: 0 });
const mid = evaluate(rater, 137);
assert.equal(mid.tier, 4);
assert.equal(mid.next, 250);
assert.ok(Math.abs(mid.progress - 37 / 150) < 1e-9);
assert.equal(evaluate(rater, 5000).next, null);
assert.equal(evaluate(rater, 5000).progress, 1);
assert.equal(evaluateAll(metrics).length, ACHIEVEMENTS.length);

// Unlocks: new tiers get a date, tiers never go down, unchanged input is not "changed".
const first = mergeUnlocks({}, [{ id: 'rater', tier: 2 }], '2026-10-01T00:00:00.000Z');
assert.deepEqual(first.unlocked, [{ id: 'rater', tier: 1 }, { id: 'rater', tier: 2 }]);
assert.equal(first.stored.rater.tier, 2);
assert.equal(first.stored.rater.at[2], '2026-10-01T00:00:00.000Z');
const later = mergeUnlocks(first.stored, [{ id: 'rater', tier: 1 }], '2026-10-02T00:00:00.000Z');
assert.equal(later.stored.rater.tier, 2, 'tiers never decrease');
assert.equal(later.changed, false);
const third = mergeUnlocks(first.stored, [{ id: 'rater', tier: 3 }], '2026-10-03T00:00:00.000Z');
assert.deepEqual(third.unlocked, [{ id: 'rater', tier: 3 }]);
assert.equal(third.stored.rater.at[1], '2026-10-01T00:00:00.000Z', 'earlier dates are kept');
assert.equal(mergeUnlocks({ rater: { tier: 99 } }, []).stored.rater.tier, 7, 'stored tiers are clamped');

// Points.
assert.equal(pointsFor(rater, 3), 10 + 25 + 50);
assert.equal(totalPoints(third.stored), 85);
assert.ok(maxPoints() > 0);

// Every achievement has an icon, text in both languages and renders on every tier.
for (const def of ACHIEVEMENTS) {
    assert.ok(BADGE_ICONS.includes(def.icon), `${def.id} icon ${def.icon}`);
    for (const lang of ['ru', 'en']) {
        const item = locales[lang].achievements.items[def.id];
        assert.ok(item && item.name && item.condition && item.text, `${lang} text for ${def.id}`);
    }
    for (let tier = 1; tier <= def.tiers.length; tier++) {
        const svg = renderBadge(def, tier);
        assert.match(svg, /^<svg class="achievement-badge"/);
        assert.ok(!svg.includes('NaN') && !svg.includes('undefined'), `${def.id} tier ${tier} renders cleanly`);
    }
}
assert.match(renderBadge(ACHIEVEMENTS_BY_ID.rater, 7, { title: 'A <b>' }), /aria-label="A b"/);

// Higher tiers are worth more points than lower ones.
for (let tier = 2; tier <= 7; tier++) assert.ok(pointsFor(rater, tier) - pointsFor(rater, tier - 1) > pointsFor(rater, tier - 1) - pointsFor(rater, tier - 2));

// Ranks: ascending thresholds, the top rank at 90% of all points, not 100%.
const thresholds = rankThresholds();
thresholds.forEach((value, index) => index && assert.ok(value > thresholds[index - 1]));
assert.equal(thresholds[6], Math.round(maxPoints() * 0.9));
assert.equal(rankFor(0).level, 0);
assert.equal(rankFor(thresholds[0]).level, 1);
assert.equal(rankFor(thresholds[6]).level, 7);
assert.equal(rankFor(thresholds[6]).next, null);
assert.equal(rankFor(maxPoints() - 1).level, 7, 'the top rank does not need every tier');
const halfway = rankFor((thresholds[2] + thresholds[3]) / 2);
assert.equal(halfway.level, 3);
assert.ok(Math.abs(halfway.progress - 0.5) < 1e-9);
for (let level = 1; level <= 7; level++) assert.match(renderAvatarFrame(level), /^<svg class="rank-frame"/);

console.log('Achievement engine tests passed');
