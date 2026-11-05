/**
 * Control group for the detectors themselves. A green journey only means
 * something if these same detectors demonstrably fire on broken motion and
 * stay quiet on clean motion, in a real browser.
 */
const { test, expect } = require('@playwright/test');
const { installMotionRecorder } = require('../lib/initScripts.cjs');
const { analyzeElement, layoutAnimations, summarizeShifts } = require('../lib/motionAnalysis.cjs');

const PAGE = `<!doctype html><style>
    body { margin: 0; height: 2000px; font: 16px sans-serif; }
    #box { position: absolute; top: 100px; left: 100px; width: 200px; height: 120px; background: #888; }
    #above { height: 80px; background: #444; }
    #below { width: 400px; height: 200px; background: #666; }
</style><div id="above"></div><div id="below"></div><div id="box"></div>`;

async function record(page, run, durationMs = 500) {
    await page.evaluate(() => {
        globalThis.__e2eMotion.reset();
        globalThis.__e2eMotion.startTrack({ box: '#box' });
    });
    await page.evaluate(run);
    await page.waitForTimeout(durationMs);
    const track = await page.evaluate(() => globalThis.__e2eMotion.stopTrack());
    const { shifts } = await page.evaluate(() => globalThis.__e2eMotion.read());
    return { analysis: analyzeElement(track.frames, 'box'), track, shifts: summarizeShifts(shifts) };
}

test.describe('motion detectors', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(installMotionRecorder);
        await page.goto('about:blank');
        await page.setContent(PAGE);
    });

    test('stay quiet on a clean fade and slide', async ({ page }) => {
        const { analysis, shifts, track } = await record(page, () => {
            const box = document.getElementById('box');
            box.style.opacity = '0';
            box.style.transform = 'translateY(24px)';
            box.getBoundingClientRect();
            box.style.transition = 'opacity 200ms ease-out, transform 200ms ease-out';
            box.style.opacity = '1';
            box.style.transform = 'none';
        });
        expect(analysis.problems).toEqual([]);
        expect(analysis.animatedForMs).toBeGreaterThan(100);
        expect(shifts.score).toBe(0);
        expect(layoutAnimations(track.animated)).toEqual([]);
    });

    test('allow one spring overshoot', async ({ page }) => {
        const { analysis } = await record(page, () => {
            // From rest: if it began at an offset, a frame sampled before the start
            // would see that jump as one more movement, and a second reversal.
            document.getElementById('box').animate(
                [{ transform: 'translateY(0)' }, { transform: 'translateY(36px)' }, { transform: 'translateY(30px)' }],
                { duration: 300, easing: 'ease-out', fill: 'forwards' });
        });
        expect(analysis.reversals.y).toBe(1);
        expect(analysis.problems).toEqual([]);
    });

    test('catch an element that snaps into place', async ({ page }) => {
        const { analysis } = await record(page, () => {
            setTimeout(() => { document.getElementById('box').style.top = '220px'; }, 200);
        });
        expect(analysis.teleports).toEqual([expect.objectContaining({ axis: 'y', delta: 120 })]);
        expect(analysis.problems.join()).toContain('snapped');
    });

    test('catch trembling', async ({ page }) => {
        const { analysis } = await record(page, () => {
            const box = document.getElementById('box');
            let sign = 1;
            const timer = setInterval(() => {
                box.style.transform = `translateX(${6 * sign}px)`;
                sign = -sign;
            }, 50);
            setTimeout(() => { clearInterval(timer); box.style.transform = 'none'; }, 400);
        });
        expect(analysis.reversals.x).toBeGreaterThan(1);
        expect(analysis.problems.join()).toContain('trembling');
    });

    test('catch an opacity flash', async ({ page }) => {
        const { analysis } = await record(page, () => {
            document.getElementById('box').animate(
                [{ opacity: 1 }, { opacity: 0.2 }, { opacity: 1 }],
                { duration: 300 });
        });
        expect(analysis.flashes).toHaveLength(1);
        expect(analysis.problems.join()).toContain('flash');
    });

    test('catch a one-frame disappearance', async ({ page }) => {
        const { analysis } = await record(page, () => {
            const box = document.getElementById('box');
            setTimeout(() => {
                box.style.display = 'none';
                setTimeout(() => { box.style.display = ''; }, 60);
            }, 150);
        });
        expect(analysis.visibilityGaps).toHaveLength(1);
        expect(analysis.problems.join()).toContain('blink');
    });

    test('catch content pushed down by a late insertion', async ({ page }) => {
        const { shifts } = await record(page, () => {
            setTimeout(() => { document.getElementById('above').style.height = '300px'; }, 150);
        });
        expect(shifts.count).toBeGreaterThan(0);
        expect(shifts.score).toBeGreaterThan(0.01);
        expect(shifts.worst[0].node).toContain('#below');
    });

    test('name an animation that re-runs layout', async ({ page }) => {
        const { track } = await record(page, () => {
            const box = document.getElementById('box');
            box.style.transition = 'width 250ms linear';
            box.getBoundingClientRect();
            box.style.width = '420px';
        });
        expect(layoutAnimations(track.animated)).toEqual([
            expect.objectContaining({ property: 'width', targets: [expect.stringContaining('#box')] })
        ]);
    });
});
