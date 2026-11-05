/**
 * Turns recorded frames into findings. A value only counts if a person could
 * notice it, so each rule states the visible symptom it stands for.
 */

const AXES = ['x', 'y', 'w', 'h'];
const DEFAULTS = Object.freeze({
    // A single step at least this large, with stillness around it: a snap.
    teleportPx: 16,
    // A direction change only counts if both sides moved at least this far.
    reversalMinPx: 2,
    // One reversal is an intentional spring overshoot; more is trembling.
    allowedReversals: 1,
    // An opacity dip smaller than this is not visible as a blink.
    flashMinDelta: 0.15
});

function samplesFor(frames, name) {
    return frames.map(frame => ({ t: frame.t, ...frame.items[name] }));
}

function findVisibilityGaps(samples) {
    const gaps = [];
    let seen = false;
    let gapStart = null;
    for (const sample of samples) {
        if (sample.visible) {
            if (gapStart !== null) gaps.push({ from: gapStart, to: sample.t });
            seen = true;
            gapStart = null;
        } else if (seen && gapStart === null) {
            gapStart = sample.t;
        }
    }
    return gaps;
}

function stepsOnAxis(samples, axis) {
    const steps = [];
    for (let i = 1; i < samples.length; i++) {
        const previous = samples[i - 1];
        const current = samples[i];
        if (!previous.visible || !current.visible) continue;
        steps.push({ t: current.t, delta: current[axis] - previous[axis] });
    }
    return steps;
}

function findTeleports(steps, teleportPx) {
    const still = step => !step || Math.abs(step.delta) < 1;
    return steps.filter((step, index) => Math.abs(step.delta) >= teleportPx
        && still(steps[index - 2]) && still(steps[index - 1])
        && still(steps[index + 1]) && still(steps[index + 2]));
}

function countReversals(steps, reversalMinPx) {
    const runs = [];
    for (const { delta } of steps) {
        if (Math.abs(delta) < 0.25) continue;
        const direction = Math.sign(delta);
        const last = runs[runs.length - 1];
        if (last && last.direction === direction) last.distance += Math.abs(delta);
        else runs.push({ direction, distance: Math.abs(delta) });
    }
    const meaningful = runs.filter(run => run.distance >= reversalMinPx);
    let reversals = 0;
    for (let i = 1; i < meaningful.length; i++) {
        if (meaningful[i].direction !== meaningful[i - 1].direction) reversals++;
    }
    return reversals;
}

function findFlashes(samples, flashMinDelta) {
    const flashes = [];
    let peak = null;
    let trough = null;
    for (const { t, visible, opacity } of samples) {
        if (!visible) continue;
        if (peak === null || (trough === null && opacity > peak.opacity)) {
            peak = { t, opacity };
            continue;
        }
        if (trough === null) {
            if (peak.opacity - opacity >= flashMinDelta) trough = { t, opacity };
            continue;
        }
        if (opacity < trough.opacity) {
            trough = { t, opacity };
        } else if (opacity - trough.opacity >= flashMinDelta) {
            flashes.push({ from: peak.opacity, to: trough.opacity, back: opacity, t });
            peak = { t, opacity };
            trough = null;
        }
    }
    return flashes;
}

function analyzeElement(frames, name, options = {}, inputAt = null) {
    const limits = { ...DEFAULTS, ...options };
    const samples = samplesFor(frames, name);
    const visible = samples.filter(sample => sample.visible);
    const wasHiddenAtFirst = samples.length > 0 && !samples[0].visible;
    const wentAway = samples.length > 0 && !samples[samples.length - 1].visible;
    const steps = Object.fromEntries(AXES.map(axis => [axis, stepsOnAxis(samples, axis)]));
    const changing = sample => sample.index > 0 && (
        AXES.some(axis => Math.abs(sample[axis] - visible[sample.index - 1][axis]) >= 0.25)
        || Math.abs(sample.opacity - visible[sample.index - 1].opacity) >= 0.005);
    const lastChange = visible.map((sample, index) => ({ ...sample, index })).filter(changing).pop();
    const frameGaps = frames.slice(1).map((frame, index) => frame.t - frames[index].t);
    const result = {
        name,
        frames: frames.length,
        firstVisibleAt: visible[0]?.t ?? null,
        settledAt: lastChange?.t ?? visible[0]?.t ?? null,
        firstOpacity: visible[0]?.opacity ?? null,
        finalOpacity: visible[visible.length - 1]?.opacity ?? null,
        final: visible.length ? (({ x, y, w, h }) => ({ x, y, w, h }))(visible[visible.length - 1]) : null,
        worstFrameGapMs: frameGaps.length ? Math.round(Math.max(...frameGaps)) : 0,
        visibilityGaps: findVisibilityGaps(samples),
        flashes: findFlashes(samples, limits.flashMinDelta),
        teleports: AXES.flatMap(axis => findTeleports(steps[axis], limits.teleportPx)
            .map(step => ({ axis, t: step.t, delta: Math.round(step.delta) }))),
        reversals: Object.fromEntries(AXES.map(axis => [axis, countReversals(steps[axis], limits.reversalMinPx)]))
    };
    result.animatedForMs = result.settledAt !== null && result.firstVisibleAt !== null
        ? Math.round(result.settledAt - result.firstVisibleAt) : 0;
    // How long the user waited between pressing and seeing the result.
    result.appearedAfterInputMs = inputAt !== null && wasHiddenAtFirst && visible.length
        ? Math.round(result.firstVisibleAt - inputAt) : null;
    result.goneAfterInputMs = inputAt !== null && wentAway && visible.length
        ? Math.round(visible[visible.length - 1].t - inputAt) : null;
    result.problems = problemsIn(result, limits);
    return result;
}

function problemsIn(result, limits = DEFAULTS) {
    const problems = [];
    for (const gap of result.visibilityGaps) {
        problems.push(`${result.name} disappeared for ${Math.round(gap.to - gap.from)} ms and came back (blink)`);
    }
    for (const flash of result.flashes) {
        problems.push(`${result.name} opacity went ${flash.from} -> ${flash.to} -> ${flash.back} (flash)`);
    }
    for (const teleport of result.teleports) {
        problems.push(`${result.name} snapped ${teleport.delta}px on ${teleport.axis} at ${Math.round(teleport.t)} ms`);
    }
    for (const [axis, count] of Object.entries(result.reversals)) {
        if (count > limits.allowedReversals) problems.push(`${result.name} changed direction ${count} times on ${axis} (trembling)`);
    }
    return problems;
}

const LAYOUT_PROPERTIES = /^(width|height|top|left|right|bottom|inset|margin|padding|fontSize|lineHeight|border.*Width|min|max)/;

/** Animating these re-runs layout every frame, which is what makes motion stutter. */
function layoutAnimations(animated = {}) {
    return Object.entries(animated)
        .filter(([property]) => LAYOUT_PROPERTIES.test(property))
        .map(([property, targets]) => ({ property, targets }));
}

/** Any move at or above this is visible, however small the moved element is. */
const VISIBLE_JUMP_PX = 8;

function summarizeShifts(shifts = []) {
    const unexpected = shifts.filter(shift => !shift.hadRecentInput);
    const sources = unexpected
        .flatMap(shift => shift.sources.map(source => ({ ...source, t: shift.t, value: shift.value })))
        .sort((a, b) => b.value - a.value);
    return {
        score: Math.round(unexpected.reduce((sum, shift) => sum + shift.value, 0) * 10000) / 10000,
        count: unexpected.length,
        worst: sources.slice(0, 5),
        // The score weighs by area and so forgives a small element that jumps.
        jumps: sources.map(describeJump).filter(Boolean)
    };
}

/**
 * Chromium clips these rectangles to the viewport, so an off-screen edge reads
 * as an empty box: such an element entered or left the view, by an unknown
 * distance, and comparing its coordinates would invent a number.
 */
function describeJump({ node, t, from, to }) {
    const isEmpty = box => !box || box.w === 0 || box.h === 0;
    if (isEmpty(from) && isEmpty(to)) return null;
    const when = Math.round(t);
    if (isEmpty(from)) return { what: `${node} entering view`, t: when };
    if (isEmpty(to)) return { what: `${node} leaving view`, t: when };
    const moved = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
    return moved >= VISIBLE_JUMP_PX ? { what: `${node} moved`, t: when, px: Math.round(moved) } : null;
}

function summarizeLongFrames(longFrames = []) {
    return {
        count: longFrames.length,
        worstMs: longFrames.length ? Math.max(...longFrames.map(frame => frame.duration)) : 0
    };
}

/**
 * A blank white frame between two dark pages, or the reverse, is the classic
 * flash during navigation. A dimmed backdrop is fine: it never gets this far.
 */
const THEME_BRIGHTNESS = Object.freeze({ dark: { max: 0.6 }, light: { min: 0.2 } });

function themeFlashes(brightness, theme) {
    const { min = 0, max = 1 } = THEME_BRIGHTNESS[theme] || {};
    return brightness.filter(frame => frame.value < min || frame.value > max);
}

module.exports = { analyzeElement, layoutAnimations, summarizeShifts, summarizeLongFrames, themeFlashes };
