import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
    AIM_ROTATION_LIMIT,
    DEFAULT_ANNOUNCE_STAMP_SETTINGS,
    IMPRESSION_VIEWBOX,
    STAMP_FLIGHT,
    STAMP_IMAGE_MAX_BYTES,
    base64DecodedSize,
    buildImpressionSvg,
    buildStampImagePayload,
    buildStampTimeline,
    cameraPoseAt,
    chooseInk,
    INK_CHOICES,
    inkContrast,
    inkOptions,
    isLightInk,
    nextInk,
    samplePosterUnder,
    clampImpressionCentre,
    createImpressionLayout,
    cubicBezier,
    fitStampText,
    formatImpressionLine,
    formatImpressionParts,
    mergeStampSettings,
    nudgeAim,
    rollerIndexAt,
    shadowForHeight,
    stampPoseAt,
    strikeStartFor,
    ticketOutlinePath
} from '../src/pages/movie-details/announce-stamp/announceStampCore.js';

// Impression date and time: the wall clock picked in the modal, Russian month.
const parts = formatImpressionParts('2026-11-21', '20:00');
assert.equal(parts.dateText, '21 НОЯ 2026');
assert.equal(parts.time, '20:00');
assert.equal(parts.dayIndex, 20);
assert.equal(parts.monthIndex, 10);
assert.equal(formatImpressionLine('ПОКАЗ', parts), 'ПОКАЗ · 21 НОЯ 2026 · 20:00');
assert.equal(formatImpressionParts('2027-01-05', '9:07').dateText, '05 ЯНВ 2027');
assert.equal(formatImpressionParts('2027-01-05', '9:07').time, '09:07');
assert.equal(formatImpressionParts('2026-05-31', '00:00').month, 'МАЙ');
assert.throws(() => formatImpressionParts('2026-02-30', '12:00'), RangeError);
assert.throws(() => formatImpressionParts('2026-13-01', '12:00'), RangeError);
assert.throws(() => formatImpressionParts('2026-11-21', '24:00'), RangeError);
assert.throws(() => formatImpressionParts('21.11.2026', '12:00'), RangeError);
assert.equal(formatImpressionParts('2028-02-29', '12:00').day, '29');

// Settings: defaults, deep merge of timings/position, clamping, junk dropped.
const defaults = mergeStampSettings();
assert.deepEqual(defaults.timings, { ...DEFAULT_ANNOUNCE_STAMP_SETTINGS.timings });
assert.equal(defaults.sound, false);
assert.equal(defaults.skipAnimation, false);
assert.equal(defaults.label, 'ПОКАЗ');
const merged = mergeStampSettings({
    label: '  ПРЕМЬЕРА\u0007 ',
    inkColor: '#1E40AF',
    timings: { press: 90, windup: 'fast', reveal: 99999, tilt: 10 },
    position: { y: 0.3 },
    rotationRange: [6, -4],
    sound: true,
    skipAnimation: 'yes',
    size: 5,
    tiltAngle: 5,
    cameraYaw: -200,
    unknown: 1
});
assert.equal(merged.label, 'ПРЕМЬЕРА');
assert.equal(merged.inkColor, '#1e40af');
assert.equal(merged.timings.press, 90);
assert.equal(merged.timings.windup, DEFAULT_ANNOUNCE_STAMP_SETTINGS.timings.windup);
assert.equal(merged.timings.reveal, 5000);
assert.equal(merged.timings.lift, DEFAULT_ANNOUNCE_STAMP_SETTINGS.timings.lift);
assert.equal('tilt' in merged.timings, false, 'unknown timings are dropped');
assert.equal(merged.tiltAngle, 10);
assert.equal(merged.cameraYaw, -60);
assert.deepEqual(merged.position, { x: DEFAULT_ANNOUNCE_STAMP_SETTINGS.position.x, y: 0.3 });
assert.deepEqual(merged.rotationRange, [-4, 6]);
assert.equal(merged.sound, true);
assert.equal(merged.skipAnimation, false);
assert.equal(merged.size, 0.95);
assert.equal('unknown' in merged, false);
assert.equal(mergeStampSettings({ inkColor: 'red', label: '' }).inkColor, DEFAULT_ANNOUNCE_STAMP_SETTINGS.inkColor);
assert.equal(mergeStampSettings({ label: '   ' }).label, 'ПОКАЗ');
assert.deepEqual(mergeStampSettings(null), defaults);
// Defaults are frozen and merging never mutates them.
assert.ok(Object.isFrozen(DEFAULT_ANNOUNCE_STAMP_SETTINGS.timings));

// Layout: same seed, same impression; always inside the poster and the angle range.
const layoutA = createImpressionLayout(defaults, 2 / 3, 1234);
assert.deepEqual(createImpressionLayout(defaults, 2 / 3, 1234), layoutA);
assert.notDeepEqual(createImpressionLayout(defaults, 2 / 3, 98765), layoutA);
for (let seed = 1; seed < 400; seed++) {
    const settings = mergeStampSettings({ position: { x: seed % 2, y: (seed % 3) / 2 }, positionJitter: 0.2, size: 0.9, rotationRange: [-20, 20] });
    const layout = createImpressionLayout(settings, seed % 5 === 0 ? 1.5 : 2 / 3, seed);
    assert.ok(layout.rotation >= -20 && layout.rotation <= 20);
    assert.ok(layout.x > 0 && layout.x < 1 && layout.y > 0 && layout.y < 1, `layout off the poster for seed ${seed}`);
    assert.ok(layout.inkSeed >= 1 && layout.warpSeed >= 1);
}

// Aim: the centre moves only as far as needed to keep the turned ticket on the poster.
{
    const width = defaults.size;
    assert.deepEqual(clampImpressionCentre({ x: 0.5, y: 0.6, rotation: 0, width, aspect: 2 / 3 }), { x: 0.5, y: 0.6 });
    const corner = clampImpressionCentre({ x: -3, y: 9, rotation: 30, width, aspect: 2 / 3 });
    assert.ok(corner.x > width / 2 && corner.y < 1, 'pushed back inside');
    assert.deepEqual(clampImpressionCentre({ x: 0.2, y: 0.2, rotation: 0, width: 2, aspect: 1 }), { x: 0.5, y: 0.5 }, 'too wide: centred');
    assert.deepEqual(clampImpressionCentre({ x: NaN, y: 0.4, rotation: 0, width, aspect: 2 / 3 }).x, 0.5);
    const turned = nudgeAim(layoutA, { rotation: 500, x: 0.01 }, 2 / 3);
    assert.equal(turned.rotation, AIM_ROTATION_LIMIT);
    assert.equal(nudgeAim(layoutA, { rotation: -500 }, 2 / 3).rotation, -AIM_ROTATION_LIMIT);
    assert.equal(turned.inkSeed, layoutA.inkSeed, 'aiming keeps the ink');
    const far = nudgeAim(layoutA, { x: 5, y: -5 }, 2 / 3);
    assert.deepEqual({ x: far.x, y: far.y }, clampImpressionCentre({ x: layoutA.x + 5, y: layoutA.y - 5, rotation: layoutA.rotation, width: layoutA.width, aspect: 2 / 3 }));
    assert.deepEqual(nudgeAim(layoutA, {}, 2 / 3), { ...layoutA, ...clampImpressionCentre({ ...layoutA, aspect: 2 / 3 }) });
}

// Ink: the preferred red unless it would vanish on the poster under the ticket.
{
    const inks = inkOptions(defaults.inkColor);
    assert.equal(inks[0], '#c0262d');
    assert.deepEqual([...inks].sort(), [...INK_CHOICES].sort());
    assert.equal(inkOptions('#00ff00')[0], '#00ff00');
    assert.equal(inkOptions('#00ff00').length, INK_CHOICES.length + 1);
    assert.equal(nextInk(inks[inks.length - 1], inks), inks[0]);
    assert.equal(nextInk(inks[0], inks), inks[1]);

    // A 20×30 poster painted in two halves: left red-orange, right pale grey.
    const width = 20;
    const height = 30;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const colour = x < width / 2 ? [205, 60, 40] : [225, 225, 222];
            data.set([...colour, 255], i);
        }
    }
    const sample = { data, width, height };
    const onRed = { ...layoutA, x: 0.25, width: 0.4, rotation: 0 };
    const onGrey = { ...layoutA, x: 0.75, width: 0.4, rotation: 0 };
    const redPoints = samplePosterUnder(sample, onRed);
    assert.ok(redPoints.length > 50);
    assert.ok(redPoints.every(([r]) => r === 205), 'only the red half is under the left ticket');
    assert.ok(samplePosterUnder(sample, onGrey).every(([r]) => r === 225));
    assert.deepEqual(samplePosterUnder(null, onRed), []);
    // A turned ticket reads a turned area: at 90° it spans the poster's height instead.
    const tall = samplePosterUnder(sample, { ...onRed, rotation: 90 }, { columns: 4, rows: 2 });
    assert.ok(tall.length > 0);

    assert.ok(inkContrast('#c0262d', redPoints) < inkContrast('#141418', redPoints));
    assert.notEqual(chooseInk(redPoints, inks), '#c0262d', 'red does not go on red');
    assert.equal(chooseInk(samplePosterUnder(sample, onGrey), inks), '#c0262d', 'red stays where it reads');
    assert.equal(chooseInk([], inks), inks[0]);
    assert.equal(chooseInk([[12, 12, 14]], inks), '#c0262d', 'red reads on black');
}

// Easing: CSS cubic-bezier semantics.
{
    const linear = cubicBezier(0, 0, 1, 1);
    assert.equal(linear(0), 0);
    assert.equal(linear(1), 1);
    assert.ok(Math.abs(linear(0.37) - 0.37) < 1e-4);
    const easeOut = cubicBezier(0.2, 0, 0, 1);
    let previous = 0;
    for (let x = 0.05; x <= 1; x += 0.05) {
        const y = easeOut(x);
        assert.ok(y >= previous - 1e-9, 'monotonic');
        previous = y;
    }
    assert.ok(easeOut(0.5) > 0.5, 'an ease-out is ahead at half time');
    assert.equal(easeOut(-1), 0);
    assert.equal(easeOut(2), 1);
}

// Timeline and poses: the stamp comes in, hovers for as long as the owner aims, then strikes.
{
    const timeline = buildStampTimeline(defaults.timings);
    assert.ok(timeline.enterStart > 0 && timeline.enterStart < timeline.enterEnd);
    assert.ok(timeline.aimFrom >= timeline.rollersEnd && timeline.aimFrom >= timeline.enterEnd);
    const s = timeline.strike;
    assert.ok(s.windupEnd < s.impact && s.impact < s.holdEnd && s.holdEnd < s.liftEnd && s.revealStart < s.revealEnd && s.end >= s.liftEnd);
    assert.equal(strikeStartFor(10, timeline), timeline.aimFrom, 'an early click waits for the stamp to settle');
    assert.equal(strikeStartFor(timeline.aimFrom + 500, timeline), timeline.aimFrom + 500);

    assert.equal(stampPoseAt(0, timeline).visible, false);
    const entered = stampPoseAt(timeline.enterEnd, timeline);
    assert.ok(Math.abs(entered.y - STAMP_FLIGHT.hover) < 1e-9 && entered.tiltX === 0);
    // Aiming has no end: a minute later it still hovers, no ink yet.
    const waiting = stampPoseAt(timeline.aimFrom + 60000, timeline);
    assert.ok(waiting.visible && Math.abs(waiting.y - STAMP_FLIGHT.hover) <= STAMP_FLIGHT.breath + 1e-9 && waiting.ink === 0);

    const strikeAt = timeline.aimFrom + 1234;
    const at = offset => stampPoseAt(strikeAt + offset, timeline, { strikeAt, bounce: 0.3 });
    // Continuous where phases meet.
    for (const edge of [0, s.windupEnd, s.impact, s.holdEnd]) {
        assert.ok(Math.abs(at(edge - 0.01).y - at(edge).y) < 0.01, `no jump at ${edge}`);
    }
    assert.ok(at(s.windupEnd).y > at(0).y, 'winds up before the hit');
    assert.equal(at(s.impact - 1).ink, 0);
    assert.equal(at(s.impact).y, 0);
    assert.equal(at(s.impact).ink, 1);
    assert.ok(at(s.impact).squash > 0 && at(s.holdEnd - 1).squash === 0);
    assert.ok(at(s.liftEnd - 1).y > STAMP_FLIGHT.hover && at(s.liftEnd - 1).offsetX > 0);
    assert.equal(at(s.liftEnd).visible, false);
    assert.equal(at(s.liftEnd).ink, 1);
    assert.ok(stampPoseAt(strikeAt + s.impact, timeline, { strikeAt, bounce: 1 }).squash > at(s.impact).squash, 'bounce sets the squash');

    const aimingCamera = cameraPoseAt(timeline.aimFrom + 5000, timeline);
    assert.deepEqual([aimingCamera.reveal, aimingCamera.orbit, aimingCamera.shake, aimingCamera.push], [0, 1, 0, 1], 'still while aiming');
    assert.ok(cameraPoseAt(0, timeline).push > 1, 'pushes in at the start');
    assert.equal(cameraPoseAt(strikeAt + s.revealEnd, timeline, { strikeAt }).reveal, 1);
    assert.equal(cameraPoseAt(strikeAt + s.impact - 1, timeline, { strikeAt }).shake, 0);
    assert.notEqual(cameraPoseAt(strikeAt + s.impact + 13, timeline, { strikeAt }).shake, 0);

    // Rollers spin at least a full turn and stop on the date.
    const roller = { from: 7, to: 20, length: 31, column: 0, columns: 5 };
    assert.equal(rollerIndexAt(0, timeline, roller), 7);
    const stopped = rollerIndexAt(timeline.rollersEnd, timeline, roller);
    assert.equal(((stopped % 31) + 31) % 31, 20);
    assert.ok(stopped - 7 >= 31);
    assert.ok(rollerIndexAt(timeline.rollersEnd - 1, timeline, { ...roller, column: 4 }) < rollerIndexAt(timeline.rollersEnd - 1, timeline, roller) + 31, 'rightmost stops last');
}

// Shadows: contact only near the paper, the wide one grows with height.
const low = shadowForHeight(0, 200);
const high = shadowForHeight(200, 200);
assert.ok(low.contact.opacity > 0.5 && high.contact.opacity === 0);
assert.ok(high.wide.opacity > low.wide.opacity && high.wide.scale > low.wide.scale);
assert.deepEqual(shadowForHeight(-10, 200), low);
assert.deepEqual(shadowForHeight(999, 200), high);

// Impression SVG: a ticket with a stub; escaped label, seeds and the ink filter chain.
const svg = buildImpressionSvg({ label: 'A<&>"', parts, inkColor: '#c0262d', layout: layoutA, pixelWidth: 660 });
assert.match(svg, /A&lt;&amp;&gt;&quot;/);
assert.match(svg, new RegExp(`seed="${layoutA.inkSeed}"`));
assert.match(svg, /baseFrequency="0\.55"/);
// Light speckle and a small wobble, so the ink stays legible on busy posters.
assert.match(svg, /0 0 0 -7 5\.9"/);
assert.match(svg, /feDisplacementMap[^>]*scale="1\.8"/);
assert.match(svg, /<path d="M20 6[^"]*" fill="none" stroke-width="6\.5"/);
assert.equal(defaults.inkOpacity, 1);
// Backing: a light halo of the ink's own shape under dark ink, a dark one under white ink.
assert.equal(defaults.inkBacking, true);
assert.equal(mergeStampSettings({ inkBacking: false }).inkBacking, false);
assert.equal(mergeStampSettings({ inkBacking: 'no' }).inkBacking, true);
assert.match(svg, /feMorphology in="pressed" operator="dilate"/);
assert.match(svg, /flood-color="#ffffff"/);
assert.match(svg, /<feMerge><feMergeNode in="halo"\/><feMergeNode in="pressed"\/><\/feMerge>/);
assert.match(buildImpressionSvg({ label: 'x', parts, inkColor: '#f4f4f5', layout: layoutA }), /flood-color="#111114"/);
assert.doesNotMatch(buildImpressionSvg({ label: 'x', parts, inkColor: '#c0262d', layout: layoutA, backing: false }), /feMorphology|feMerge/);
assert.equal(isLightInk('#f4f4f5'), true);
assert.equal(isLightInk('#c0262d'), false);
assert.equal(isLightInk('#1d3a8f'), false);
assert.match(svg, new RegExp(`width="660" height="${Math.round(660 * IMPRESSION_VIEWBOX.height / IMPRESSION_VIEWBOX.width)}"`));
assert.match(svg, />21 НОЯ</);
assert.match(svg, />2026</);
assert.match(svg, />НАЧАЛО</);
assert.match(svg, />20:00</);
assert.ok(svg.includes(ticketOutlinePath()), 'the inked frame is the aiming outline');
assert.match(ticketOutlinePath(), /^M20 6H204A10 10 0 0 0 224 6H/);
assert.doesNotMatch(buildImpressionSvg({ label: 'x', parts, inkColor: 'url(javascript:1)', layout: layoutA }), /javascript/);
// Long labels shrink, and the longest are squeezed into the space.
assert.deepEqual(fitStampText('ПОКАЗ', { size: 21, spacing: 4.5, maxWidth: 140 }), { size: 21, spacing: 4.5 });
const premiere = fitStampText('ПРЕМЬЕРА', { size: 21, spacing: 4.5, maxWidth: 140 });
assert.ok(premiere.size < 21 && premiere.size >= 12 && !premiere.textLength);
assert.deepEqual(fitStampText('СЕАНС ДЛЯ ДРУЗЕЙ И СЕМЬИ', { size: 21, spacing: 4.5, maxWidth: 140 }), { size: 12, spacing: 0, textLength: 140 });
assert.match(buildImpressionSvg({ label: 'СЕАНС ДЛЯ ДРУЗЕЙ И СЕМЬИ', parts, inkColor: '#c0262d', layout: layoutA }), /textLength="\d+(\.\d+)?" lengthAdjust="spacingAndGlyphs"/);

// Payload guard: base64 without the data: prefix, at most 3 MB decoded.
assert.equal(base64DecodedSize('TWFu'), 3);
assert.equal(base64DecodedSize('TWE='), 2);
assert.equal(base64DecodedSize('TQ=='), 1);
assert.equal(base64DecodedSize(''), 0);
assert.deepEqual(buildStampImagePayload('data:image/jpeg;base64,/9j/4A=='), { data: '/9j/4A==', contentType: 'image/jpeg' });
assert.deepEqual(buildStampImagePayload('/9j/\n4A=='), { data: '/9j/4A==', contentType: 'image/jpeg' });
assert.throws(() => buildStampImagePayload('not base64!'), TypeError);
assert.throws(() => buildStampImagePayload(''), TypeError);
assert.throws(() => buildStampImagePayload('/9j/4A==', 'image/png'), TypeError);
const limitChars = Math.ceil(STAMP_IMAGE_MAX_BYTES / 3) * 4;
assert.ok(base64DecodedSize('A'.repeat(limitChars)) > STAMP_IMAGE_MAX_BYTES - 3);
assert.doesNotThrow(() => buildStampImagePayload('A'.repeat(4 * (STAMP_IMAGE_MAX_BYTES / 3 | 0))));
assert.throws(() => buildStampImagePayload('A'.repeat(limitChars + 4)), RangeError);

// Wiring: the page sends the stamped image in SCHEDULE_ANNOUNCE and registers the scene layer.
const page = fs.readFileSync('src/pages/movie-details/movie-details.js', 'utf8');
assert.match(page, /from '\.\/announce-stamp\/AnnounceStampScene\.js'/);
assert.match(page, /encodeImage: blobToStampImage/);
assert.match(fs.readFileSync('src/pages/movie-details/announce-stamp/announceFlow.js', 'utf8'), /message\.stampImage = await encodeImage\(blob\)/);
assert.match(page, /stack\.register\('announce-stamp',\s*\{\s*order: 8,/);
const html = fs.readFileSync('src/pages/movie-details/movie-details.html', 'utf8');
assert.match(html, /href="announce-stamp\/announce-stamp\.css"/);
// three.js loads only when an announcement plays: the scene imports the stage on demand.
const sceneSource = fs.readFileSync('src/pages/movie-details/announce-stamp/AnnounceStampScene.js', 'utf8');
assert.match(sceneSource, /await import\('\.\/announceStampStage\.js'\)/);
assert.doesNotMatch(sceneSource, /three\.games\.min\.js/);
assert.doesNotMatch(page, /announceStampStage|three\.games\.min\.js/);
// The vendored three.js subset keeps every name the stage imports when it is rebuilt.
const { importedNames } = await import('../scripts/vendor-three.mjs');
const stageSource = fs.readFileSync('src/pages/movie-details/announce-stamp/announceStampStage.js', 'utf8');
const stageNames = /import \{([^}]+)\} from '\.\.\/\.\.\/\.\.\/\.\.\/libs\/three\.games\.min\.js'/.exec(stageSource)[1].split(',').map(name => name.trim()).filter(Boolean);
const vendored = importedNames();
stageNames.forEach(name => assert.ok(vendored.includes(name), `vendor-three collects ${name}`));
const three = await import('../libs/three.games.min.js');
stageNames.forEach(name => assert.ok(three[name], `libs/three.games.min.js exports ${name}`));

console.log('announceStampCore tests passed');
