import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { ACHIEVEMENTS, ACHIEVEMENTS_BY_ID, pointsFor } from '../src/shared/achievements/AchievementCatalog.js';
import {
    computeMetrics,
    evaluate,
    evaluateAll,
    frameChoices,
    frameLevel,
    inSeason,
    longestStreak,
    maxPoints,
    mergeUnlocks,
    rankFor,
    rankThresholds,
    totalPoints
} from '../src/shared/achievements/AchievementEngine.js';
import { BADGE_ICONS, renderAvatarFrame, renderBadge } from '../src/shared/achievements/AchievementBadge.js';
import { CAT_FRAME, advanceTrail, catFrameUnlocked, isBox, saysMeow, trailSteps } from '../src/shared/achievements/catTrail.js';
import { StrokeMeter } from '../src/shared/achievements/CatDen.js';
import { eyePaths, mouthPath, renderCat, renderPaws } from '../src/shared/achievements/CatDenArt.js';
import { FRAME_PARTS } from '../src/shared/achievements/CatFrameParts.js';
import { PARTS } from '../src/shared/achievements/CatPuppet.js';
import { SCENE_ICONS } from '../src/shared/achievements/AchievementScenes.js';
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
    uid: 'me',
    marathonItems: [
        { roundId: 1, state: 'watched', addedBy: 'me', kpId: 90 }, { roundId: 2, state: 'queued', addedBy: 'me', kpId: 91 }, { roundId: 3, state: 'removed', addedBy: 'me', kpId: 92 },
        // Someone else's film, rated (c, 20 October) while it was on, and one rated long before.
        { roundId: 4, state: 'watched', addedBy: 'friend', kpId: 3, selectedAt: day(2026, 9, 19), resolvedAt: day(2026, 9, 20) },
        { roundId: 5, state: 'watched', addedBy: 'friend', kpId: 1, selectedAt: day(2026, 5, 1), resolvedAt: day(2026, 5, 2) }
    ],
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
assert.equal(metrics.newYearRatings, 0, 'early January 2026 belongs to the 2025 holidays, before the first New Year season');
assert.equal(metrics.streak, 2);
assert.equal(metrics.reactionsReceived, 7);
assert.equal(metrics.reactionsGiven, 6);
assert.equal(metrics.marathonRounds, 3, 'bringing or rating a film on time counts; removed items and old ratings do not');
assert.equal(metrics.marathonWatched, 1, 'only the films one brought');
assert.equal(metrics.collections, 2);
assert.equal(metrics.collectionItems, 3);
assert.equal(metrics.pinned, 2);
assert.equal(metrics.accountDays, 365);
assert.equal(metrics.distinctScores, 3);

// Seasonal windows: inclusive local days. New Year crosses the turn of the year
// and counts from the 2026 season on; Halloween counts every year.
const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const NEW_YEAR = ACHIEVEMENTS_BY_ID.new_year.season;
const HALLOWEEN = ACHIEVEMENTS_BY_ID.halloween.season;
assert.equal(inSeason(NEW_YEAR, at(2026, 12, 14, 23, 59)), false);
assert.equal(inSeason(NEW_YEAR, at(2026, 12, 15, 0, 0)), true);
assert.equal(inSeason(NEW_YEAR, at(2026, 12, 31, 23, 59)), true);
assert.equal(inSeason(NEW_YEAR, at(2027, 1, 1, 0, 0)), true);
assert.equal(inSeason(NEW_YEAR, at(2027, 1, 14, 23, 59)), true);
assert.equal(inSeason(NEW_YEAR, at(2027, 1, 15, 0, 0)), false);
assert.equal(inSeason(NEW_YEAR, at(2027, 6, 1)), false);
assert.equal(inSeason(NEW_YEAR, at(2027, 12, 20)), true, 'every later season counts');
assert.equal(inSeason(NEW_YEAR, at(2028, 1, 5)), true);
assert.equal(inSeason(NEW_YEAR, at(2025, 12, 20)), false, 'holidays before the first season do not count');
assert.equal(inSeason(NEW_YEAR, at(2026, 1, 10)), false, 'January 2026 belongs to the 2025 season');
assert.equal(inSeason(HALLOWEEN, at(2026, 10, 16, 23, 59)), false);
assert.equal(inSeason(HALLOWEEN, at(2026, 10, 17, 0, 0)), true);
assert.equal(inSeason(HALLOWEEN, at(2026, 11, 7, 23, 59)), true);
assert.equal(inSeason(HALLOWEEN, at(2026, 11, 8, 0, 0)), false);
assert.equal(inSeason(HALLOWEEN, at(2019, 10, 31)), true);
assert.equal(inSeason(NEW_YEAR, 0), false);
assert.equal(inSeason(NEW_YEAR, Number.NaN), false);
assert.equal(inSeason(undefined, at(2026, 12, 20)), false);

// New Year counts any rated title inside the season, cached or not.
const holidayRatings = [
    { movieId: 1, rating: 7, createdAt: { seconds: at(2026, 12, 15, 0, 5) / 1000 } },
    { movieId: 2, rating: 8, createdAt: new Date(at(2027, 1, 14, 23, 50)) },
    { movieId: 404, rating: 6, createdAt: at(2026, 12, 31, 23, 59) },
    { movieId: 3, rating: 9, createdAt: at(2027, 1, 15, 0, 1) },
    { movieId: 1, rating: 5, createdAt: at(2025, 12, 25) },
    { movieId: 2, rating: 0, createdAt: at(2026, 12, 20) },
    { movieId: 3, rating: 4 }
];
assert.equal(computeMetrics({ ratings: holidayRatings, movies }).newYearRatings, 3);
const newYearDef = ACHIEVEMENTS_BY_ID.new_year;
const tenEvenings = Array.from({ length: 10 }, (_, index) => ({ movieId: index + 1, rating: 7, createdAt: at(2026, 12, 28 + index, 21) }));
assert.equal(evaluate(newYearDef, computeMetrics({ ratings: tenEvenings }).newYearRatings).tier, 1, 'ten films from 28 December to 6 January');
assert.equal(evaluate(newYearDef, computeMetrics({ ratings: tenEvenings.slice(1) }).newYearRatings).tier, 0);
assert.equal(newYearDef.oneOff, true);
assert.ok(!newYearDef.hidden, 'the season goal is shown before it is earned');

// Seasonal points are a bonus: they count in the total, not in the maximum ranks are shares of.
assert.equal(maxPoints(), ACHIEVEMENTS.filter(def => !def.season && !def.bonus).reduce((sum, def) => sum + pointsFor(def, def.tiers.length), 0));
assert.equal(totalPoints({ new_year: { tier: 1 }, halloween: { tier: 1 } }), 200);

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

// Illustrated scenes are clipped to the frame face and every tier from I to VII renders cleanly.
for (const icon of SCENE_ICONS) {
    for (let tier = 1; tier <= 7; tier++) {
        const svg = renderBadge({ icon }, tier);
        assert.match(svg, /<clipPath id="ach\d+-clip">/, `${icon} tier ${tier} scene is clipped`);
        assert.ok(!svg.includes('NaN') && !svg.includes('undefined') && !svg.includes('${'), `${icon} tier ${tier} scene renders cleanly`);
    }
}
// Two copies of a badge on one page must not share gradient or clip ids.
const sceneIds = svg => [...svg.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
const firstIds = sceneIds(renderBadge(ACHIEVEMENTS_BY_ID.night_owl, 1));
assert.ok(firstIds.length > 0 && !sceneIds(renderBadge(ACHIEVEMENTS_BY_ID.night_owl, 1)).some(id => firstIds.includes(id)));
// An icon without a scene keeps its line glyph.
assert.ok(!renderBadge({ icon: 'unknownIcon' }, 3).includes('clipPath'));
// Every catalog achievement has an illustrated scene.
for (const def of ACHIEVEMENTS) assert.ok(SCENE_ICONS.includes(def.icon), `${def.id} has a scene`);

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

// The cat's frame comes first and needs its trail, not a rank; without a choice nothing changes.
assert.deepEqual(frameChoices(0), [CAT_FRAME, 0]);
assert.deepEqual(frameChoices(3), [CAT_FRAME, 1, 2, 3]);
assert.equal(frameLevel(0, CAT_FRAME, true), CAT_FRAME);
assert.equal(frameLevel(4, CAT_FRAME, true), CAT_FRAME);
assert.equal(frameLevel(0, CAT_FRAME), 0);
assert.equal(frameLevel(4, CAT_FRAME), 4, 'a locked cat frame falls back to the rank');
assert.equal(frameLevel(0, undefined), 0);
assert.equal(frameLevel(4, null), 4);
assert.equal(frameLevel(4, 2), 2);
assert.equal(frameLevel(2, 5), 2, 'a rank not reached falls back to the current one');
assert.equal(frameLevel(2, -2), 2);
assert.match(renderAvatarFrame(CAT_FRAME), /assets\/frames\/kitty-label\.webp/);
assert.match(renderAvatarFrame(CAT_FRAME, { label: false }), /assets\/frames\/kitty\.webp/);
for (const name of ['kitty', 'kitty-label']) assert.ok(existsSync(new URL(`../src/shared/assets/frames/${name}.webp`, import.meta.url)), name);

// The cat trail: «мяу» as a word of its own, then a box with a film, in this order.
for (const text of ['мяу', 'Ну МЯУ!!!', 'мяяяу', 'мяу-мяу', 'Meow.', 'кот сказал "мяу"']) assert.ok(saysMeow(text), text);
for (const text of ['мяукать', 'замяукал', 'homeowner', 'который', '', null]) assert.ok(!saysMeow(text), String(text));
for (const name of ['Коробка', 'моя коробка!', 'КОРОБОЧКА', 'Картонная коробка с кино', 'The Box']) assert.ok(isBox({ name, movieIds: [1] }), name);
assert.ok(!isBox({ name: 'Коробка', movieIds: [] }), 'an empty box is not enough');
for (const name of ['Коробейники', 'Xbox', 'Боксёры', '']) assert.ok(!isBox({ name, movieIds: [1] }), name);
const meow = { rating: 7, comment: 'Мяу', createdAt: 1 };
const box = { name: 'Коробка', movieIds: [1] };
assert.equal(advanceTrail(0, { ratings: [], collections: [box] }), 0, 'the box waits for the call');
assert.equal(advanceTrail(0, { ratings: [meow] }), 1);
assert.equal(advanceTrail(0, { ratings: [{ review: 'мяу' }], collections: [box] }), 2);
assert.equal(advanceTrail(1, { ratings: [], collections: [box] }), 2, 'a passed step survives a deleted review');
const trailDef = ACHIEVEMENTS_BY_ID.cat_trail;
const trailResults = value => [evaluate(trailDef, value)];
const afterCall = mergeUnlocks({}, trailResults(1));
assert.deepEqual(afterCall.unlocked, []);
assert.deepEqual(afterCall.changedIds, ['cat_trail']);
assert.equal(trailSteps(afterCall.stored), 1);
assert.equal(totalPoints(afterCall.stored), 0, 'steps alone are worth nothing');
assert.equal(mergeUnlocks(afterCall.stored, trailResults(0)).changed, false, 'steps never go down');
assert.equal(trailSteps(mergeUnlocks(afterCall.stored, trailResults(0)).stored), 1);
assert.equal(trailSteps({ cat_trail: { steps: 3 } }), 2, 'the last step needs the tier');
const petted = { cat_trail: { tier: 1, steps: 3, at: { 1: 'x' } } };
assert.ok(catFrameUnlocked(petted) && !catFrameUnlocked(afterCall.stored));
assert.deepEqual(mergeUnlocks(petted, trailResults(3)).stored.cat_trail, petted.cat_trail);
assert.equal(computeMetrics({ ratings: [meow], collections: [box] }).catTrail, 2);

// Petting: a slow pass counts once per direction; hurrying startles.
const pass = (meter, from, to, start, ms, samples = 10) => Array.from({ length: samples + 1 }, (_, i) =>
    meter.move(from + (to - from) * i / samples, start + ms * i / samples)).filter(Boolean);
const hand = new StrokeMeter();
assert.deepEqual(pass(hand, 250, 390, 0, 400), ['stroke']);
assert.deepEqual(pass(hand, 390, 430, 410, 200), [], 'the same direction is still the same stroke');
assert.deepEqual(pass(hand, 430, 260, 620, 400), ['stroke']);
assert.deepEqual(pass(new StrokeMeter(), 250, 280, 0, 300), [], 'too short to be a stroke');
assert.equal(pass(new StrokeMeter(), 200, 440, 0, 50)[0], 'startle');

// The drawing needs no filters (they stall the first frames); every part the puppet moves is there once, every reference resolves, and two drawings share no ids.
const drawings = [renderCat(), renderCat({ compact: true })];
for (const svg of drawings) {
    assert.ok(!/NaN|undefined|\$\{|<filter/.test(svg));
    for (const part of PARTS) assert.equal(svg.split(`data-cat="${part}"`).length, 2, part);
    const known = new Set([...svg.matchAll(/ id="([^"]+)"/g)].map(match => match[1]));
    for (const [, id] of svg.matchAll(/url\(#([^)]+)\)/g)) assert.ok(known.has(id), id);
}
const idsOf = svg => [...svg.matchAll(/ id="([^"]+)"/g)].map(match => match[1]);
assert.ok(!idsOf(drawings[0]).some(id => idsOf(drawings[1]).includes(id)));
assert.equal(renderPaws(3).split('class="cat-paw"').length, 4);
// Eyelids: any mix of shapes is one path with the same points, and a closed eye is nearly a line.
const heightOf = options => {
    const numbers = eyePaths(options).outline.match(/-?[\d.]+/g).map(Number);
    assert.equal(numbers.length, 26);
    assert.ok(numbers.every(Number.isFinite));
    // From the middle of the upper lid to the middle of the lower one.
    return numbers[19] - numbers[7];
};
for (const way of [{}, { happy: 1 }, { tense: 1 }, { happy: 0.5, tense: 0.3 }]) {
    const open = heightOf(way);
    const half = heightOf({ ...way, lid: 0.5 });
    const shut = heightOf({ ...way, lid: 1 });
    assert.ok(open > 40 && half < open && half > 8 && shut < 2, JSON.stringify([way, open, half, shut]));
}
assert.ok(heightOf({ wide: 1 }) > heightOf({}));
assert.ok(!/NaN/.test(mouthPath({ smile: 1, open: 1 })));
for (const { name, picture = name } of FRAME_PARTS) assert.ok(existsSync(new URL(`../src/shared/assets/frames/kitty/${picture}.webp`, import.meta.url)), picture);
assert.deepEqual(Object.keys(locales.ru.achievements.cat).sort(), Object.keys(locales.en.achievements.cat).sort());

// The card and the dialog say when a seasonal achievement can be earned.
globalThis.document = { getElementById: () => null, addEventListener() {} };
const { AchievementsView } = await import('../src/shared/achievements/AchievementsView.js');
const viewFor = lang => new AchievementsView({
    i18n: { currentLocale: lang, get: key => key.split('.').reduce((node, part) => node?.[part], locales[lang]) },
    db: null,
    profileService: null
});
const ruView = viewFor('ru');
const enView = viewFor('en');
const chip = text => `<span class="ach-chip">${text}</span>`;
assert.equal(ruView.seasonChip(newYearDef, at(2026, 11, 17)), chip('С 15 декабря'));
assert.equal(ruView.seasonChip(newYearDef, at(2026, 12, 15, 0, 0)), chip('До 14 января'));
assert.equal(ruView.seasonChip(newYearDef, at(2027, 1, 14, 23, 59)), chip('До 14 января'));
assert.equal(ruView.seasonChip(newYearDef, at(2027, 1, 15, 0, 0)), chip('С 15 декабря'));
assert.equal(enView.seasonChip(newYearDef, at(2026, 11, 17)), chip('From 15 December'));
assert.equal(enView.seasonChip(newYearDef, at(2026, 12, 20)), chip('Until 14 January'));
assert.equal(ruView.item('new_year', 'condition', { n: 10, ...ruView.seasonDates(newYearDef) }), 'Оценить 10 фильмов с 15 декабря по 14 января');
assert.equal(enView.item('new_year', 'condition', { n: 10, ...enView.seasonDates(newYearDef) }), 'Rate 10 films between 15 December and 14 January');
assert.match(ruView.cardHTML(newYearDef), /<span class="ach-chip">(С 15 декабря|До 14 января)<\/span>/);
assert.equal(ruView.seasonChip(ACHIEVEMENTS_BY_ID.halloween, at(2026, 10, 20)), '', 'a secret achievement keeps its dates');
assert.equal(ruView.seasonChip(rater, at(2026, 12, 20)), '');
ruView.stored = { new_year: { tier: 1, at: { 1: '2026-12-20T18:00:00.000Z' } } };
assert.equal(ruView.seasonChip(newYearDef, at(2026, 12, 20)), '', 'an earned achievement needs no dates');

console.log('Achievement engine tests passed');
