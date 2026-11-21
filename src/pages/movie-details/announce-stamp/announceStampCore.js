/**
 * Pure parts of the announce stamp scene: settings, the impression text, its
 * placement on the poster, the choreography of the stamp and the camera, the
 * shadow curve and the Telegram payload guard. Nothing here touches the DOM or
 * WebGL, so Node tests import it directly.
 */

export const STAMP_IMAGE_MAX_BYTES = 3 * 1024 * 1024;
export const STAMP_IMAGE_CONTENT_TYPE = 'image/jpeg';

// The impression is drawn in these SVG user units (a cinema ticket's shape);
// the rubber of the stamp shares the ratio.
export const IMPRESSION_VIEWBOX = Object.freeze({ width: 330, height: 170 });

export const MONTHS_SHORT_RU = Object.freeze(['ЯНВ', 'ФЕВ', 'МАР', 'АПР', 'МАЙ', 'ИЮН', 'ИЮЛ', 'АВГ', 'СЕН', 'ОКТ', 'НОЯ', 'ДЕК']);

export const DEFAULT_ANNOUNCE_STAMP_SETTINGS = Object.freeze({
    label: 'ПОКАЗ',
    // The preferred ink; `chooseInk` swaps it for a clearer one from `INK_CHOICES` on a poster it would vanish on.
    inkColor: '#c0262d',
    inkOpacity: 1,
    // A soft halo under the ink (light under dark ink, dark under white) so it reads on any poster.
    inkBacking: true,
    // Degrees; each impression takes a random angle inside this range.
    rotationRange: Object.freeze([-9, -3]),
    // Centre of the impression as a fraction of the poster, plus random jitter.
    position: Object.freeze({ x: 0.5, y: 0.64 }),
    positionJitter: 0.025,
    // Impression width as a fraction of the poster width.
    size: 0.66,
    // Camera while the stamp flies: degrees away from looking straight down, and
    // its turn around the poster (negative: from the left). It ends straight above.
    tiltAngle: 46,
    cameraYaw: -16,
    // Strength of the hit (0–1): how far the rubber squashes and the camera shakes.
    bounce: 0.3,
    // Milliseconds of each phase; see `buildStampTimeline` for how they overlap.
    timings: Object.freeze({
        intro: 600,
        enter: 750,
        rollers: 1150,
        windup: 260,
        press: 170,
        hold: 200,
        lift: 600,
        reveal: 950,
        fade: 280
    }),
    sound: false,
    skipAnimation: false,
    exportLongSide: 1280,
    jpegQuality: 0.9
});

const isPlainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function pickNumber(value, fallback, min, max) {
    const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    return typeof number === 'number' && Number.isFinite(number) ? clamp(number, min, max) : fallback;
}

function pickColor(value, fallback) {
    return typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim()) ? value.trim().toLowerCase() : fallback;
}

function pickLabel(value, fallback) {
    if (typeof value !== 'string') return fallback;
    const label = Array.from(value).filter(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127).join('').trim().slice(0, 24);
    return label || fallback;
}

/**
 * Defaults overlaid with any valid overrides. Unknown keys are dropped and
 * out-of-range numbers are clamped, so a stored or hand-edited settings object
 * can never break the scene.
 * @param {object} [overrides]
 */
export function mergeStampSettings(overrides = {}) {
    const input = isPlainObject(overrides) ? overrides : {};
    const base = DEFAULT_ANNOUNCE_STAMP_SETTINGS;
    const timingsIn = isPlainObject(input.timings) ? input.timings : {};
    const positionIn = isPlainObject(input.position) ? input.position : {};

    const timings = {};
    for (const [key, fallback] of Object.entries(base.timings)) {
        timings[key] = Math.round(pickNumber(timingsIn[key], fallback, 0, 5000));
    }

    let rotationRange = [...base.rotationRange];
    if (Array.isArray(input.rotationRange) && input.rotationRange.length === 2) {
        const [a, b] = input.rotationRange.map((value, index) => pickNumber(value, base.rotationRange[index], -45, 45));
        rotationRange = [Math.min(a, b), Math.max(a, b)];
    }

    return {
        label: pickLabel(input.label, base.label),
        inkColor: pickColor(input.inkColor, base.inkColor),
        inkOpacity: pickNumber(input.inkOpacity, base.inkOpacity, 0.2, 1),
        inkBacking: typeof input.inkBacking === 'boolean' ? input.inkBacking : base.inkBacking,
        rotationRange,
        position: {
            x: pickNumber(positionIn.x, base.position.x, 0, 1),
            y: pickNumber(positionIn.y, base.position.y, 0, 1)
        },
        positionJitter: pickNumber(input.positionJitter, base.positionJitter, 0, 0.2),
        size: pickNumber(input.size, base.size, 0.3, 0.95),
        tiltAngle: pickNumber(input.tiltAngle, base.tiltAngle, 10, 70),
        cameraYaw: pickNumber(input.cameraYaw, base.cameraYaw, -60, 60),
        bounce: pickNumber(input.bounce, base.bounce, 0, 1),
        timings,
        sound: typeof input.sound === 'boolean' ? input.sound : base.sound,
        skipAnimation: typeof input.skipAnimation === 'boolean' ? input.skipAnimation : base.skipAnimation,
        exportLongSide: Math.round(pickNumber(input.exportLongSide, base.exportLongSide, 480, 2048)),
        jpegQuality: pickNumber(input.jpegQuality, base.jpegQuality, 0.5, 0.95)
    };
}

/**
 * The date and time exactly as picked in the announce modal (the same wall
 * clock the Telegram caption prints), split for the rollers and the impression.
 * @param {string} date - `YYYY-MM-DD`
 * @param {string} time - `HH:MM`
 */
export function formatImpressionParts(date, time) {
    const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? '').trim());
    const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(String(time ?? '').trim());
    if (!dateMatch || !timeMatch) throw new RangeError('Expected date YYYY-MM-DD and time HH:MM');
    const [, year, month, day] = dateMatch;
    const monthIndex = Number(month) - 1;
    const dayNumber = Number(day);
    const hours = Number(timeMatch[1]);
    const minutes = Number(timeMatch[2]);
    const daysInMonth = new Date(Date.UTC(Number(year), monthIndex + 1, 0)).getUTCDate();
    if (monthIndex < 0 || monthIndex > 11 || dayNumber < 1 || dayNumber > daysInMonth || hours > 23 || minutes > 59) {
        throw new RangeError('Date or time out of range');
    }
    const pad = value => String(value).padStart(2, '0');
    const parts = {
        day: pad(dayNumber),
        dayIndex: dayNumber - 1,
        month: MONTHS_SHORT_RU[monthIndex],
        monthIndex,
        year,
        hours: pad(hours),
        minutes: pad(minutes),
        time: `${pad(hours)}:${pad(minutes)}`
    };
    parts.dateText = `${parts.day} ${parts.month} ${parts.year}`;
    return parts;
}

/** «ПОКАЗ · 21 НОЯ 2026 · 20:00», for the accessible name and logs. */
export function formatImpressionLine(label, parts) {
    return `${label} · ${parts.dateText} · ${parts.time}`;
}

/** Small deterministic PRNG (mulberry32), so one seed reproduces one impression. */
export function createSeededRandom(seed) {
    let state = (Number(seed) >>> 0) || 1;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const safeAspect = aspect => (Number.isFinite(aspect) && aspect > 0 ? aspect : 2 / 3);

// How far the owner may turn the stamp while aiming, in degrees either way.
export const AIM_ROTATION_LIMIT = 45;

/**
 * The impression's centre moved as little as needed to keep the whole rotated
 * ticket inside the poster, in poster fractions (x of the width, y of the height).
 * @param {{ x: number, y: number, rotation: number, width: number, aspect: number, margin?: number }} aim
 */
export function clampImpressionCentre({ x, y, rotation, width, aspect, margin = 0.02 }) {
    const posterAspect = safeAspect(aspect);
    // Height in poster-height fractions: the box is width * (viewBox height / width) poster widths tall.
    const height = width * (IMPRESSION_VIEWBOX.height / IMPRESSION_VIEWBOX.width) * posterAspect;
    const radians = Math.abs(Number(rotation) || 0) * Math.PI / 180;
    // Half extents of the rotated box, each in its own axis' fractions.
    const halfX = (width * Math.cos(radians) + height / posterAspect * Math.sin(radians)) / 2;
    const halfY = (height * Math.cos(radians) + width * posterAspect * Math.sin(radians)) / 2;
    const fit = (value, half) => {
        const low = half + margin;
        const high = 1 - half - margin;
        if (!Number.isFinite(value) || low > high) return 0.5;
        return clamp(value, low, high);
    };
    return { x: fit(x, halfX), y: fit(y, halfY) };
}

/**
 * Where the impression lands, in poster fractions, and the seeds of its ink.
 * Kept inside the poster even with jitter and rotation. This is where the
 * stamp first hovers; the owner then aims it (`nudgeAim`, or the pointer).
 * @param {ReturnType<typeof mergeStampSettings>} settings
 * @param {number} posterAspect - width / height
 * @param {number} seed
 */
export function createImpressionLayout(settings, posterAspect, seed) {
    const random = createSeededRandom(seed);
    const [minAngle, maxAngle] = settings.rotationRange;
    const rotation = minAngle + (maxAngle - minAngle) * random();
    const jitter = settings.positionJitter;
    const width = settings.size;
    const aspect = safeAspect(posterAspect);
    const height = width * (IMPRESSION_VIEWBOX.height / IMPRESSION_VIEWBOX.width) * aspect;
    const centre = clampImpressionCentre({
        x: settings.position.x + (random() * 2 - 1) * jitter,
        y: settings.position.y + (random() * 2 - 1) * jitter,
        rotation,
        width,
        aspect
    });
    return {
        x: centre.x,
        y: centre.y,
        width,
        height,
        rotation,
        inkSeed: 1 + Math.floor(random() * 9000),
        warpSeed: 1 + Math.floor(random() * 9000)
    };
}

/**
 * The layout moved and turned by the owner: `change` adds to x, y (poster
 * fractions) and rotation (degrees). The angle stays within
 * ±`AIM_ROTATION_LIMIT` and the ticket inside the poster; ink seeds are kept.
 * @param {ReturnType<typeof createImpressionLayout>} layout
 * @param {{ x?: number, y?: number, rotation?: number }} change
 * @param {number} posterAspect
 */
export function nudgeAim(layout, change, posterAspect) {
    const rotation = clamp((Number(layout.rotation) || 0) + (Number(change.rotation) || 0), -AIM_ROTATION_LIMIT, AIM_ROTATION_LIMIT);
    const centre = clampImpressionCentre({
        x: layout.x + (Number(change.x) || 0),
        y: layout.y + (Number(change.y) || 0),
        rotation,
        width: layout.width,
        aspect: posterAspect
    });
    return { ...layout, ...centre, rotation };
}

/**
 * Opacity, scale and drop of the three shadow layers for a stamp `height` px
 * above the paper: a tight contact shadow only near the paper, a soft one in
 * between and a wide faint one while it is high.
 */
export function shadowForHeight(height, maxHeight) {
    const t = clamp(maxHeight > 0 ? height / maxHeight : 0, 0, 1);
    const near = 1 - t;
    return {
        contact: { opacity: +(0.6 * near ** 4).toFixed(3), scale: +(1 + 0.02 * t).toFixed(3), drop: 0 },
        soft: { opacity: +(0.42 * near ** 1.5).toFixed(3), scale: +(1 + 0.12 * t).toFixed(3), drop: +(10 * t).toFixed(2) },
        wide: { opacity: +(0.08 + 0.22 * t).toFixed(3), scale: +(1.05 + 0.35 * t).toFixed(3), drop: +(34 * t).toFixed(2) }
    };
}

// Inks the stamp can carry besides the preferred one: dark blue, black and white.
export const INK_CHOICES = Object.freeze(['#c0262d', '#1d3a8f', '#141418', '#f4f4f5']);

/** The preferred ink first, then the other choices. */
export function inkOptions(preferred = DEFAULT_ANNOUNCE_STAMP_SETTINGS.inkColor) {
    const first = pickColor(preferred, DEFAULT_ANNOUNCE_STAMP_SETTINGS.inkColor);
    return [first, ...INK_CHOICES.filter(color => color !== first)];
}

/** Whether `ink` is a light colour (white ink): it then gets a dark backing and outline halo. */
export function isLightInk(ink) {
    const [r, g, b] = hexToRgb(pickColor(ink, DEFAULT_ANNOUNCE_STAMP_SETTINGS.inkColor));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 140;
}

/** The ink after `current` in `options`, for the owner's own switch. */
export function nextInk(current, options) {
    const index = options.indexOf(current);
    return options[(index + 1) % options.length];
}

/**
 * Colours of the poster under the ticket: a grid of points inside the rotated
 * box, read from a small RGBA copy of the poster (`sample`, same aspect).
 * @returns {number[][]} [r, g, b] per point
 */
export function samplePosterUnder(sample, layout, { columns = 16, rows = 9 } = {}) {
    const { data, width, height } = sample || {};
    if (!data || !width || !height) return [];
    const aspect = width / height;
    const boxWidth = layout.width;
    const boxHeight = layout.width * IMPRESSION_VIEWBOX.height / IMPRESSION_VIEWBOX.width;
    const radians = (Number(layout.rotation) || 0) * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const points = [];
    for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
            // In poster widths, y down; a positive angle turns clockwise as on screen.
            const u = ((column + 0.5) / columns - 0.5) * boxWidth;
            const v = ((row + 0.5) / rows - 0.5) * boxHeight;
            const x = layout.x + u * cos - v * sin;
            const y = layout.y + (u * sin + v * cos) * aspect;
            const px = Math.floor(x * width);
            const py = Math.floor(y * height);
            if (px < 0 || py < 0 || px >= width || py >= height) continue;
            const i = (py * width + px) * 4;
            points.push([data[i], data[i + 1], data[i + 2]]);
        }
    }
    return points;
}

function toLab([r, g, b]) {
    const linear = value => {
        const c = value / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const [lr, lg, lb] = [linear(r), linear(g), linear(b)];
    const x = (lr * 0.4124 + lg * 0.3576 + lb * 0.1805) / 0.95047;
    const y = lr * 0.2126 + lg * 0.7152 + lb * 0.0722;
    const z = (lr * 0.0193 + lg * 0.1192 + lb * 0.9505) / 1.08883;
    const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

function hexToRgb(hex) {
    const value = hex.length === 4 ? hex.slice(1).split('').map(char => char + char).join('') : hex.slice(1);
    return [0, 2, 4].map(offset => parseInt(value.slice(offset, offset + 2), 16));
}

/**
 * How well `ink` stands out on `points`: the colour difference (CIE ΔE) that
 * 90% of the points reach, so even a small patch the ink blends into (a red
 * title, a sign) counts against it.
 */
export function inkContrast(ink, points) {
    if (!points.length) return 0;
    const [L, A, B] = toLab(hexToRgb(ink));
    const distances = points.map(point => {
        const [l, a, b] = toLab(point);
        return Math.hypot(L - l, A - a, B - b);
    }).sort((first, second) => first - second);
    return distances[Math.floor(distances.length * 0.1)];
}

/**
 * The ink to stamp with on `points`: the preferred (first) one while it stands
 * out nearly as well as the best, otherwise the clearest of `options`.
 */
export function chooseInk(points, options) {
    if (!points.length) return options[0];
    const scores = options.map(ink => inkContrast(ink, points));
    const best = Math.max(...scores);
    if (scores[0] >= 40 && scores[0] >= best * 0.8) return options[0];
    return options[scores.indexOf(best)];
}

/**
 * CSS-style cubic Bézier easing (x1, y1, x2, y2 as in `cubic-bezier()`), so the
 * WebGL choreography can use the same curves a stylesheet would.
 * @returns {(x: number) => number}
 */
export function cubicBezier(x1, y1, x2, y2) {
    const cx = 3 * x1;
    const bx = 3 * (x2 - x1) - cx;
    const ax = 1 - cx - bx;
    const cy = 3 * y1;
    const by = 3 * (y2 - y1) - cy;
    const ay = 1 - cy - by;
    const sampleX = t => ((ax * t + bx) * t + cx) * t;
    const sampleY = t => ((ay * t + by) * t + cy) * t;
    const slopeX = t => (3 * ax * t + 2 * bx) * t + cx;
    return x => {
        if (!(x > 0)) return 0;
        if (x >= 1) return 1;
        let t = x;
        for (let i = 0; i < 8; i++) {
            const error = sampleX(t) - x;
            if (Math.abs(error) < 1e-6) return sampleY(t);
            const slope = slopeX(t);
            if (Math.abs(slope) < 1e-6) break;
            t -= error / slope;
        }
        // Newton did not converge (flat slope): bisect.
        let low = 0;
        let high = 1;
        t = x;
        for (let i = 0; i < 40 && high - low > 1e-7; i++) {
            if (sampleX(t) < x) low = t;
            else high = t;
            t = (low + high) / 2;
        }
        return sampleY(t);
    };
}

export const STAMP_EASING = Object.freeze({
    intro: cubicBezier(0.2, 0, 0, 1),
    // Drops in from above and settles into the hover.
    enter: cubicBezier(0.18, 0.82, 0.3, 1),
    windup: cubicBezier(0.2, 0.7, 0.3, 1),
    // Accelerates all the way into the paper, like a hand slamming it down.
    press: cubicBezier(0.62, 0, 0.96, 0.56),
    // Leaves the paper slowly, then sweeps up and out.
    lift: cubicBezier(0.48, 0, 0.78, 0.42),
    camera: cubicBezier(0.45, 0, 0.18, 1),
    // Rollers spin fast and click into place.
    rollers: cubicBezier(0.1, 0.72, 0.18, 1)
});

/**
 * Heights and travel of the stamp in world units (the poster is 1 wide), from
 * the paper to the rubber's underside.
 */
export const STAMP_FLIGHT = Object.freeze({
    start: 3,
    // Low enough that the stamp reads as over its outline while aiming.
    hover: 0.36,
    breath: 0.012,
    breathPeriod: 1600,
    windup: 0.12,
    exitHeight: 3.4,
    exitSide: 0.75,
    // Rest after the rollers stop, before the wind-up.
    settle: 160
});

const progress = (time, start, end) => (end <= start ? (time >= end ? 1 : 0) : clamp((time - start) / (end - start), 0, 1));
const lerp = (from, to, t) => from + (to - from) * t;

/**
 * When each phase starts and ends, in ms. The opening runs from the scene
 * start: the stamp drops in while the poster settles and the rollers spin
 * while it comes down. From `aimFrom` it hovers and the owner aims it for as
 * long as they like; the strike phases in `strike` count from the moment they
 * strike (`strikeAt`), and the camera rises to the top view while the stamp leaves.
 * @param {ReturnType<typeof mergeStampSettings>['timings']} timings
 */
export function buildStampTimeline(timings) {
    const introEnd = timings.intro;
    const enterStart = Math.round(timings.intro * 0.45);
    const enterEnd = enterStart + timings.enter;
    const rollersStart = enterStart + Math.round(timings.enter * 0.3);
    const rollersEnd = rollersStart + timings.rollers;
    const aimFrom = Math.max(enterEnd, rollersEnd) + STAMP_FLIGHT.settle;
    const windupEnd = timings.windup;
    const impact = windupEnd + timings.press;
    const holdEnd = impact + timings.hold;
    const liftEnd = holdEnd + timings.lift;
    const revealStart = holdEnd + Math.round(timings.lift * 0.3);
    const revealEnd = revealStart + timings.reveal;
    return {
        introEnd, enterStart, enterEnd, rollersStart, rollersEnd, aimFrom,
        strike: { windupEnd, impact, holdEnd, liftEnd, revealStart, revealEnd, end: Math.max(liftEnd, revealEnd) }
    };
}

/** The moment a strike asked for at `requestedAt` begins: never before the stamp has settled. */
export function strikeStartFor(requestedAt, timeline) {
    return Math.max(Number(requestedAt) || 0, timeline.aimFrom);
}

/**
 * Where the stamp is at `time`: height of the rubber over the paper, tilts in
 * degrees, sideways drift, squash of the hit and whether the ink is on the
 * paper (it transfers at the hit, hidden under the stamp until it lifts).
 * Continuous from phase to phase. The aim (where over the poster, which
 * angle) is the stage's; this is only the vertical story.
 * @param {number} time - ms from the scene start
 * @param {ReturnType<typeof buildStampTimeline>} timeline
 * @param {{ strikeAt?: number, bounce?: number }} [options] - `strikeAt` Infinity while aiming
 */
export function stampPoseAt(time, timeline, { strikeAt = Infinity, bounce = DEFAULT_ANNOUNCE_STAMP_SETTINGS.bounce } = {}) {
    const f = STAMP_FLIGHT;
    const strike = timeline.strike;
    const pose = { visible: true, y: f.hover, tiltX: 0, tiltZ: 0, offsetX: 0, squash: 0, ink: 0 };
    const breath = at => f.breath * Math.sin(2 * Math.PI * (at - timeline.enterEnd) / f.breathPeriod);
    if (time < timeline.enterStart) return { ...pose, visible: false, y: f.start };
    if (time < timeline.enterEnd) {
        const k = STAMP_EASING.enter(progress(time, timeline.enterStart, timeline.enterEnd));
        // Arrives a little tipped, as if lowered by hand, and levels out.
        return { ...pose, y: lerp(f.start, f.hover, k), tiltX: 9 * (1 - k), tiltZ: -6 * (1 - k) };
    }
    if (!(time >= strikeAt)) return { ...pose, y: f.hover + breath(time) };
    const since = time - strikeAt;
    const windupFrom = f.hover + breath(strikeAt);
    if (since < strike.windupEnd) {
        const k = STAMP_EASING.windup(progress(since, 0, strike.windupEnd));
        return { ...pose, y: windupFrom + f.windup * k, tiltX: -3.5 * k };
    }
    const top = windupFrom + f.windup;
    if (since < strike.impact) {
        const k = STAMP_EASING.press(progress(since, strike.windupEnd, strike.impact));
        return { ...pose, y: top * (1 - k), tiltX: -3.5 * (1 - k) };
    }
    if (since < strike.holdEnd) {
        const pressed = since - strike.impact;
        const squash = pressed < 130 ? (0.03 + 0.09 * bounce) * (1 - pressed / 130) ** 2 : 0;
        return { ...pose, y: 0, squash, ink: 1 };
    }
    if (since < strike.liftEnd) {
        const k = STAMP_EASING.lift(progress(since, strike.holdEnd, strike.liftEnd));
        return { ...pose, y: f.exitHeight * k, offsetX: f.exitSide * k * k, tiltX: -12 * k, tiltZ: 14 * k, ink: 1 };
    }
    return { ...pose, visible: false, y: f.exitHeight, offsetX: f.exitSide, ink: 1 };
}

/**
 * The camera at `time`: `push` scales the opening distance (a slow push-in),
 * `orbit` turns it around the poster while the stamp comes down and is still
 * by the time the owner aims, `reveal` takes it from the angled view to
 * straight above after the strike, and `shake` is the hit's jolt in world units.
 * @param {{ strikeAt?: number, bounce?: number }} [options]
 */
export function cameraPoseAt(time, timeline, { strikeAt = Infinity, bounce = DEFAULT_ANNOUNCE_STAMP_SETTINGS.bounce } = {}) {
    const strike = timeline.strike;
    const intro = STAMP_EASING.intro(progress(time, 0, timeline.introEnd));
    const since = time - strikeAt - strike.impact;
    const shake = since >= 0 && since < 420
        ? (0.004 + 0.014 * bounce) * Math.exp(-since / 105) * Math.sin(2 * Math.PI * since / 52)
        : 0;
    const revealStart = strikeAt + strike.revealStart;
    return {
        push: 1 + 0.18 * (1 - intro),
        orbit: STAMP_EASING.camera(progress(time, 0, timeline.aimFrom)),
        reveal: Number.isFinite(revealStart) ? STAMP_EASING.camera(progress(time, revealStart, strikeAt + strike.revealEnd)) : 0,
        shake
    };
}

/**
 * The ticket's outline (with the stub's notches) as an SVG path in impression
 * user units: the inked frame, and the aiming outline drawn on the poster.
 */
export function ticketOutlinePath({ width = IMPRESSION_VIEWBOX.width, tear = 214, notch = 10 } = {}) {
    const right = width - 6;
    return `M20 6H${tear - notch}A${notch} ${notch} 0 0 0 ${tear + notch} 6H${right - 14}A14 14 0 0 1 ${right} 20V150`
        + `A14 14 0 0 1 ${right - 14} 164H${tear + notch}A${notch} ${notch} 0 0 0 ${tear - notch} 164H20A14 14 0 0 1 6 150V20A14 14 0 0 1 20 6Z`;
}

/**
 * Index of a date roller at `time`: it spins from `from` through at least one
 * full turn to `to` (indices into a list of `length` values). Rollers further
 * right stop a little later.
 */
export function rollerIndexAt(time, timeline, { from, to, length, column = 0, columns = 1 }) {
    const span = timeline.rollersEnd - timeline.rollersStart;
    const end = timeline.rollersStart + span * (0.62 + 0.38 * (columns > 1 ? column / (columns - 1) : 1));
    const k = STAMP_EASING.rollers(progress(time, timeline.rollersStart, end));
    const travel = length + ((((to - from) % length) + length) % length);
    return from + travel * k;
}

const escapeXml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);

// System fonts only: an SVG drawn as an image cannot load web fonts, and the
// screen and the exported JPEG must draw the same glyphs.
const STAMP_FONT = "'Arial Black', 'Segoe UI Black', 'Helvetica Neue', Arial, sans-serif";

// The extension's clapperboard mark (navigation logo, 256-unit box): the tilted
// clapper and the board with the Play cut-out.
export const CLAPPER_MARK = Object.freeze({
    clapper: 'M11 0H189A11 11 0 0 1 200 11V31A11 11 0 0 1 189 42H11A11 11 0 0 1 0 31V11A11 11 0 0 1 11 0ZM22 34L36 8L56 8L42 34ZM66 34L80 8L100 8L86 34ZM110 34L124 8L144 8L130 34ZM154 34L168 8L188 8L174 34Z',
    clapperTransform: 'translate(28 112) rotate(-14) translate(0 -42)',
    board: 'M46 120H210A18 18 0 0 1 228 138V218A18 18 0 0 1 210 236H46A18 18 0 0 1 28 218V138A18 18 0 0 1 46 120ZM110 155Q110 148 116.12 151.4L157.88 174.6Q164 178 157.88 181.4L116.12 204.6Q110 208 110 201Z',
    // Drawn part of the 256 box: x 18–228, y 23–236.
    box: Object.freeze({ x: 18, y: 23, width: 210, height: 213 })
});

/**
 * Font size (and a forced length when even the smallest size is too wide) that
 * fits `text` into `maxWidth` user units. Widths are estimated from a heavy
 * sans glyph average, so the label never runs into the frame.
 */
export function fitStampText(text, { size, maxWidth, spacing = 0, minSize = 12, advance = 0.8 }) {
    const count = Math.max(1, Array.from(String(text)).length);
    const width = fontSize => count * advance * fontSize + (count - 1) * spacing;
    if (width(size) <= maxWidth) return { size, spacing };
    const fitted = (maxWidth - (count - 1) * spacing) / (count * advance);
    if (fitted >= minSize) return { size: Math.floor(fitted * 10) / 10, spacing };
    return { size: minSize, spacing: 0, textLength: maxWidth };
}

/**
 * The ink impression as a standalone SVG document: a cinema ticket with a
 * tear-off stub. The main part carries the clapperboard mark, the label and
 * the date (day and month large, the year below), the stub «НАЧАЛО» and the
 * time. The same string is shown on screen and drawn into the JPEG, so both
 * carry the same ink texture.
 * With `backing` the ink lies on a soft halo of its own shape (light under
 * dark ink, dark under white ink), as if pressed onto a paper patch.
 * @param {{ label: string, parts: ReturnType<typeof formatImpressionParts>, inkColor: string, layout: { inkSeed: number, warpSeed: number }, pixelWidth?: number, backing?: boolean }} options
 */
export function buildImpressionSvg({ label, parts, inkColor, layout, pixelWidth, backing = DEFAULT_ANNOUNCE_STAMP_SETTINGS.inkBacking }) {
    const { width: W, height: H } = IMPRESSION_VIEWBOX;
    const ink = pickColor(inkColor, DEFAULT_ANNOUNCE_STAMP_SETTINGS.inkColor);
    const size = pixelWidth > 0 ? ` width="${Math.round(pixelWidth)}" height="${Math.round(pixelWidth * H / W)}"` : ` width="${W}" height="${H}"`;
    // Perforation between the ticket and its stub; notches bite into both edges
    // there. Widths are measured in Arial Black: «28 ИЮН» at 38 is 171 units and
    // «20:00» at 26 is 78 (plus the glyph stroke), so the main part's inner frame
    // is 187 and the stub's 89. Lines and glyphs are heavy and the speckle light,
    // so the ticket still reads on a busy poster.
    const tear = 214;
    const outline = ticketOutlinePath({ width: W, tear });
    const innerRight = W - 13;
    const mainCentre = (13 + tear - 14) / 2;
    const stubCentre = (tear + 14 + innerRight) / 2;
    const markSize = 30;
    const markScale = markSize / CLAPPER_MARK.box.height;
    const markX = 24 - CLAPPER_MARK.box.x * markScale;
    const markY = 20 - CLAPPER_MARK.box.y * markScale;
    const labelX = 24 + CLAPPER_MARK.box.width * markScale + 9;
    const labelFit = fitStampText(label, { size: 23, spacing: 3.5, maxWidth: tear - 22 - labelX });
    const labelAttrs = `font-size="${labelFit.size}" letter-spacing="${labelFit.spacing}"`
        + (labelFit.textLength ? ` textLength="${labelFit.textLength}" lengthAdjust="spacingAndGlyphs"` : '');
    const dayMonth = `${parts.day} ${parts.month}`;
    // Glyphs get a thin stroke of the same ink, which makes them heavier.
    const glyph = 'stroke-width="1.1" stroke-linejoin="round"';
    // letter-spacing also follows the last glyph; dx re-centres spaced text.
    // The halo: the finished ink spread by 2.4 units, blurred and tinted, merged under the ink.
    const halo = backing
        ? '<feMorphology in="pressed" operator="dilate" radius="2.4" result="spread"/>'
            + '<feGaussianBlur in="spread" stdDeviation="1.8" result="soft"/>'
            + `<feFlood flood-color="${isLightInk(ink) ? '#111114' : '#ffffff'}" flood-opacity="0.82"/>`
            + '<feComposite in2="soft" operator="in" result="halo"/>'
            + '<feMerge><feMergeNode in="halo"/><feMergeNode in="pressed"/></feMerge>'
        : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"${size}>`
        + '<defs><filter id="ink" x="-5%" y="-9%" width="110%" height="118%" color-interpolation-filters="sRGB">'
        + `<feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="2" seed="${layout.inkSeed}" result="grain"/>`
        + '<feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -7 5.9" result="speckle"/>'
        + '<feComposite in="SourceGraphic" in2="speckle" operator="in" result="inked"/>'
        + `<feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="2" seed="${layout.warpSeed}" result="warp"/>`
        + '<feDisplacementMap in="inked" in2="warp" scale="1.8" xChannelSelector="R" yChannelSelector="G" result="pressed"/>'
        + halo
        + '</filter></defs>'
        + `<g filter="url(#ink)" fill="${ink}" stroke="${ink}" font-family="${STAMP_FONT}" font-weight="900" text-anchor="middle">`
        + `<path d="${outline}" fill="none" stroke-width="6.5" stroke-linejoin="round"/>`
        + `<rect x="13" y="13" width="${tear - 14 - 13}" height="${H - 26}" rx="8" fill="none" stroke-width="2.6"/>`
        + `<rect x="${tear + 14}" y="13" width="${innerRight - tear - 14}" height="${H - 26}" rx="8" fill="none" stroke-width="2.6"/>`
        + `<line x1="${tear}" y1="22" x2="${tear}" y2="${H - 22}" stroke-width="3" stroke-dasharray="5 4.5"/>`
        + `<g transform="translate(${markX.toFixed(2)} ${markY.toFixed(2)}) scale(${markScale.toFixed(4)})" stroke="none">`
        + `<g transform="${CLAPPER_MARK.clapperTransform}"><path fill-rule="evenodd" d="${CLAPPER_MARK.clapper}"/></g>`
        + `<path fill-rule="evenodd" d="${CLAPPER_MARK.board}"/></g>`
        + `<text x="${labelX}" y="44" text-anchor="start" stroke-width="0.8" stroke-linejoin="round" ${labelAttrs}>${escapeXml(label)}</text>`
        + `<line x1="24" y1="57" x2="${tear - 24}" y2="57" stroke-width="2.4"/>`
        + `<text x="${mainCentre}" y="104" font-size="38" ${glyph}>${escapeXml(dayMonth)}</text>`
        + `<text x="${mainCentre}" y="141" dx="3" font-size="23" letter-spacing="6" ${glyph}>${escapeXml(parts.year)}</text>`
        + `<text x="${stubCentre}" y="67" dx="0.8" font-size="13" letter-spacing="1.6" stroke-width="0.6" stroke-linejoin="round">НАЧАЛО</text>`
        + `<text x="${stubCentre}" y="104" font-size="26" ${glyph}>${escapeXml(parts.time)}</text>`
        + `<line x1="${stubCentre - 22}" y1="119" x2="${stubCentre + 22}" y2="119" stroke-width="2.4"/>`
        + '</g></svg>';
}

/** Decoded byte length of a base64 string (padding and whitespace aware). */
export function base64DecodedSize(base64) {
    const clean = String(base64 ?? '').replace(/\s+/g, '');
    if (!clean) return 0;
    const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
    return Math.floor(clean.length * 3 / 4) - padding;
}

/**
 * The optional `stampImage` field of SCHEDULE_ANNOUNCE: base64 without the
 * `data:` prefix, decoded size at most 3 MB. Throws instead of sending an
 * oversized or malformed image.
 */
export function buildStampImagePayload(base64, contentType = STAMP_IMAGE_CONTENT_TYPE, maxBytes = STAMP_IMAGE_MAX_BYTES) {
    let data = String(base64 ?? '').trim();
    const prefixed = /^data:([^;,]+)?(;base64)?,/i.exec(data);
    if (prefixed) data = data.slice(prefixed[0].length);
    data = data.replace(/\s+/g, '');
    if (!data || !/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length % 4 !== 0) {
        throw new TypeError('Stamp image is not valid base64');
    }
    if (contentType !== STAMP_IMAGE_CONTENT_TYPE) throw new TypeError('Stamp image must be image/jpeg');
    const size = base64DecodedSize(data);
    if (size > maxBytes) throw new RangeError(`Stamp image is ${size} bytes, over the ${maxBytes} byte limit`);
    return { data, contentType };
}
