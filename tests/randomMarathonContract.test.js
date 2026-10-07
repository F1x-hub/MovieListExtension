import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const service = fs.readFileSync(path.join(root, 'src/shared/services/RandomMarathonService.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'src/pages/random/random.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'src/pages/random/random.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/pages/random/random.css'), 'utf8');
const rules = fs.readFileSync(path.join(root, 'rules/firestore.rules'), 'utf8');
const functions = fs.readFileSync(path.join(root, 'functions/randomMarathon.js'), 'utf8');
const functionsIndex = fs.readFileSync(path.join(root, 'functions/index.js'), 'utf8');
const posterHelpersStart = page.indexOf('function getSafePosterUrl');
const posterHelpersEnd = page.indexOf('class RandomManager', posterHelpersStart);
assert.notEqual(posterHelpersStart, -1);
assert.notEqual(posterHelpersEnd, -1);
const posterHelperContext = { URL, Set };
runInNewContext(fs.readFileSync(path.join(root, 'src/shared/utils/PosterUrl.js'), 'utf8'), posterHelperContext);
runInNewContext(
    `${page.slice(posterHelpersStart, posterHelpersEnd)}\nglobalThis.getMarathonPosterUrls = getMarathonPosterUrls;`,
    posterHelperContext
);
assert.deepEqual(
    Array.from(posterHelperContext.getMarathonPosterUrls('http://st.kp.yandex.net/images/film_iphone/iphone360_289.jpg?d=old', 289)),
    ['https://st.kp.yandex.net/images/film_iphone/iphone360_289.jpg?d=old', 'https://st.kp.yandex.net/images/film_iphone/iphone360_289.jpg']
);
assert.deepEqual(
    Array.from(posterHelperContext.getMarathonPosterUrls('https://unsupported.example/poster.jpg', 289)),
    ['https://st.kp.yandex.net/images/film_iphone/iphone360_289.jpg']
);
assert.deepEqual(Array.from(posterHelperContext.getMarathonPosterUrls('', 0)), []);

assert.match(page, /const DEFAULT_ROLL_DURATION_SECONDS = 6;/);
assert.match(page, /const ROLL_DURATION_STORAGE_KEY = 'random_wheel_duration_seconds';/);
assert.match(page, /localStorage\.setItem\(ROLL_DURATION_STORAGE_KEY, String\(seconds\)\)/);
assert.match(page, /const duration = reducedMotion \? 0 : this\.rollDurationSeconds \* 1000;/);
assert.match(page, /const eased = 1 - Math\.pow\(1 - progress, 3\);/);
assert.match(service, /maxMoviesPerUser\(\)\s*\{\s*return 3;/);
assert.match(service, /resolveCurrent\(resolution = 'watched', expectedRoundId = null, expectedItemId = null\)/);
assert.match(service, /expectedRoundId/);
assert.match(service, /expectedItemId/);
assert.match(service, /mutationUrl/);
assert.match(service, /_callMutation\('add'/);
assert.match(service, /latestRound !== roundForSubscription/);
assert.match(page, /_marathonAuthRefreshId/);
assert.match(page, /const isAdmin = await this\.marathonService\.isAdmin\(\)\.catch\(\(\) => false\)/);
assert.match(page, /if \(refreshId !== this\._marathonAuthRefreshId\) return;/);
assert.doesNotMatch(service, /item\.data\(\)/);
assert.match(service, /Utils\.getDisplayName\(profile, fallbackUser\)/);
assert.match(service, /_decorateItems\(items\)/);
assert.match(service, /profileByUserId\.get\(item\.addedBy\)/);
assert.match(service, /let active = true/);
assert.match(service, /generation \+= 1/);
assert.match(service, /cached\.expiresAt > Date\.now\(\)/);
assert.match(page, /data-marathon-action="roll"/);
assert.match(page, /const nextState = await action\(\)/);
assert.match(page, /_refreshPoolModalIfOpen\(\)/);
assert.match(page, /Number\(marathonItem\.kpId\) === Number\(m\.kpId\)/);
assert.match(page, /author\.className = 'marathon-item-author'/);
assert.match(page, /item\.addedByName \|\| item\.addedBy/);
assert.match(page, /this\.marathonIsAdmin \|\| ownCount < RandomMarathonService\.maxMoviesPerUser/);
assert.match(page, /data-marathon-action="removed"/);
assert.match(page, /resolveCurrent\('watched', expectedRoundId, expectedItemId\)/);
assert.match(page, /event\.target\.closest\?\.\('button'\)/);
assert.match(page, /_marathonPendingRemovals = new Set/);
assert.match(page, /_marathonPendingAdds = new Map/);
assert.match(page, /_addMovieToMarathon\(movie\)/);
assert.match(page, /_getMarathonDisplayItems\(\)/);
assert.match(page, /this\._marathonPendingRemovals\.add\(item\.id\)/);
assert.match(page, /this\._marathonPendingRemovals\.has\(item\.id\)/);
assert.match(page, /this\._marathonPendingRemovals\.add\(item\.id\);\s*this\._renderMarathon\(\);\s*await this\._runMarathonAction/);
assert.match(page, /pool-list-item-marathon-add/);
assert.match(page, /this\._addMovieToMarathon\(movie\)/);
assert.match(page, /this\._addMovieToMarathon\(m\)/);
assert.match(page, /this\._showRollPendingAnimation\(queuedItems\);\s*const nextState = await this\._runMarathonAction/);
assert.match(page, /wheel\.classList\.add\('roll-wheel--pending'\)/);
assert.match(page, /this\._stopRollAnimation\(\)/);
assert.match(page, /this\._renderRollCandidates\(wheel, candidates\)/);
assert.match(page, /this\._showRollReady\(candidates, \(\) => this\._rollMarathonWithAnimation\(\)\)/);
assert.match(page, /this\._showRollReady\(this\.pool, \(\) => this\._rollFromPool\(\)\)/);
assert.match(page, /const targetAngle = \(360 - \(winnerIdx \+ \.5\) \* stepAngle\) % 360/);
assert.match(page, /aria-labelledby="rollTitle"/);
assert.match(page, /id="rollSettingsBtn"/);
assert.match(page, /id="rollDurationInput" type="number" min="2" max="1800"/);
assert.match(page, /class="pool-list-item-actions"/);
assert.match(page, /row\.className = 'pool-list-item marathon-list-item'/);
assert.match(page, /rowActions\.className = 'marathon-item-actions'/);
assert.match(page, /poster\.className = 'marathon-item-poster'/);
assert.match(page, /function getMarathonPosterUrls\(value, kpId\)/);
assert.match(page, /https:\/\/st\.kp\.yandex\.net\/images\/film_iphone\/iphone360_\$\{movieId\}\.jpg/);
assert.match(page, /getMarathonPosterUrls\(item\.poster, item\.kpId\)/);
assert.match(page, /getMarathonPosterUrls\(movie\.poster, movie\.kpId\)/);
assert.match(page, /PosterUrl\.safe\(value\)/);
assert.match(page, /window\.ImageLightbox\.show\(currentPosterUrl\)/);
assert.match(page, /currentLink\.className = 'marathon-current-movie-link'/);
assert.match(page, /currentLink\.href = chrome\.runtime\.getURL\(`src\/pages\/movie-details\/movie-details\.html\?movieId=\$\{current\.kpId\}`\)/);
assert.match(page, /currentLabel\.append\('Сейчас выпал фильм: ', currentLink\)/);
assert.match(page, /_rollMarathonWithAnimation\(\)/);
assert.match(page, /this\._showRollAnimation\(candidates, winnerIndex/);
assert.match(page, /deferRender = false/);
assert.match(page, /let shouldRender = true/);
assert.match(page, /if \(shouldRender\) this\._renderMarathon\(\)/);
assert.match(page, /actionLabel: \(\) => 'Вернуться к марафону'/);
assert.match(css, /\.pool-list-item\s*\{[\s\S]*display:\s*grid/);
assert.match(css, /grid-template-columns:\s*36px\s+minmax\(0,\s*1fr\)\s+auto/);
assert.match(css, /\.pool-list-item-actions\s*\{/);
assert.match(css, /\.marathon-list-item\s*\{/);
assert.match(css, /\.marathon-item-poster\s*\{[\s\S]*cursor:\s*zoom-in/);
assert.match(css, /\.roll-wheel--pending\s*\{[\s\S]*animation:\s*roll-wheel-pending\s+550ms\s+linear\s+infinite/);
assert.match(css, /\.roll-wheel-frame\s*\{[\s\S]*overflow:\s*hidden/);
assert.match(css, /\.roll-wheel-pointer\s*\{/);
assert.match(css, /\.roll-wheel-lines\s*\{[\s\S]*width:\s*100%/);
assert.match(css, /\.roll-wheel-line\s*\{[\s\S]*stroke:\s*var\(--ui-color-content\)/);
assert.match(page, /linesSvg = document\.createElementNS\(svgNs, 'svg'\)/);
assert.match(page, /line\.setAttribute\('class', 'roll-wheel-line'\)/);
assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
assert.match(css, /\.marathon-item-actions\s*\{/);
assert.match(css, /\.pool-list-item-bonus \.chance-tag\s*\{[\s\S]*margin-left:\s*0/);
assert.match(html, /id="showMarathonBtn"/);
assert.match(html, /id="marathonSearchInput"/);
assert.match(html, /shared\/services\/RandomMarathonService\.js/);
assert.match(rules, /match \/randomMarathons\/current/);
assert.match(rules, /allow create, update, delete: if false;/);
assert.match(functions, /MAX_MOVIES_PER_USER = 3/);
assert.match(functions, /participantCounts/);
assert.match(functions, /createRandomMarathonHandler/);
assert.match(functions, /normalizeMovie/);
assert.match(functions, /round\.status !== "collecting"/);
assert.match(functions, /Math\.random\(\) \* queued\.length/);
assert.match(functions, /ownCount >= MAX_MOVIES_PER_USER/);
assert.match(functions, /INVALID_ITEM/);
assert.match(functions, /CURRENT_MOVIE_STALE/);
assert.match(functions, /expectedRoundId/);
assert.match(functions, /expectedItemId/);
assert.match(functions, /AUTH_REQUIRED/);
assert.match(functions, /readTransactionItems\(transaction, itemsRef\.where\("roundId", "==", round\.roundId\)\)/);
assert.doesNotMatch(functions, /getRoundItemDocs/);
assert.match(functionsIndex, /exports\.randomMarathon = onRequest/);

let visibleButtons = [];
const alerts = [];
const makeButton = (action, label) => {
    const classes = new Set();
    const attributes = new Map();
    return {
        dataset: { marathonAction: action },
        textContent: label,
        disabled: false,
        classList: {
            toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
            contains(name) { return classes.has(name); }
        },
        setAttribute(name, value) { attributes.set(name, value); },
        getAttribute(name) { return attributes.get(name); },
        removeAttribute(name) { attributes.delete(name); }
    };
};
const mockElement = (tag, ns) => {
    const children = [];
    const attributes = new Map();
    const style = {};
    const classList = new Set();
    return {
        tag,
        ns,
        children,
        style,
        dataset: {},
        textContent: '',
        classList: {
            add(c) { classList.add(c); },
            remove(c) { classList.delete(c); },
            contains(c) { return classList.has(c); }
        },
        setAttribute(k, v) { attributes.set(k, String(v)); },
        getAttribute(k) { return attributes.get(k); },
        removeAttribute(k) { attributes.delete(k); },
        appendChild(child) { children.push(child); return child; },
        append(...items) { children.push(...items); },
        replaceChildren(...items) { children.length = 0; children.push(...items); },
        addEventListener() {}
    };
};
const managerContext = {
    URL,
    document: {
        addEventListener() {},
        querySelectorAll() { return visibleButtons; },
        createElement(tag) { return mockElement(tag); },
        createElementNS(ns, tag) { return mockElement(tag, ns); }
    },
    window: { alert(message) { alerts.push(message); } },
    console: { warn() {} }
};
runInNewContext(`${page.replace(/^import .*;\r?\n/gm, '')}\nglobalThis.RandomManager = RandomManager;`, managerContext);
const manager = Object.create(managerContext.RandomManager.prototype);
manager._marathonMutationRunning = false;
manager._marathonPendingAction = null;
manager._formatMarathonError = (error) => error.message;
manager._renderMarathon = () => manager._syncMarathonActionState();

visibleButtons = [makeButton('watched', 'Отметить просмотренным'), makeButton('removed', 'Удалить выпавший')];
let finishMutation;
const delayedMutation = new Promise((resolve) => { finishMutation = resolve; });
const pendingMutation = manager._runMarathonAction(() => delayedMutation, { pendingAction: 'watched' });
assert.equal(visibleButtons[0].textContent, 'Отмечаем…');
assert.equal(visibleButtons[0].getAttribute('aria-busy'), 'true');
assert.equal(visibleButtons[0].classList.contains('marathon-action-loading'), true);
assert.equal(visibleButtons[1].disabled, true);
assert.equal(await manager._runMarathonAction(() => { throw new Error('duplicate'); }), null);

visibleButtons = [makeButton('roll', 'Крутить рулетку')];
manager._syncMarathonActionState();
assert.equal(visibleButtons[0].textContent, 'Отмечаем…', 'a live update must keep the progress indicator visible');
assert.equal(visibleButtons[0].disabled, true);
finishMutation({ round: { roundId: 1 }, items: [] });
await pendingMutation;
assert.equal(visibleButtons[0].textContent, 'Крутить рулетку');
assert.equal(visibleButtons[0].disabled, false);
assert.equal(visibleButtons[0].getAttribute('aria-busy'), undefined);

visibleButtons = [makeButton('watched', 'Отметить просмотренным')];
const failedMutation = manager._runMarathonAction(
    () => Promise.reject(new Error('Сеть недоступна')),
    { pendingAction: 'watched' }
);
assert.equal(visibleButtons[0].textContent, 'Отмечаем…');
await failedMutation;
assert.deepEqual(alerts, ['Сеть недоступна']);
assert.equal(visibleButtons[0].textContent, 'Отметить просмотренным');
assert.equal(visibleButtons[0].disabled, false);

// Test Wheel Geometry & Alignment Contract
for (const count of [2, 3, 5, 6, 7]) {
    const wheelMock = mockElement('div');
    const candidates = Array.from({ length: count }, (_, i) => ({
        kpId: 100 + i,
        title: `Movie ${i + 1}`,
        poster: `p${i + 1}.jpg`
    }));

    manager._renderRollCandidates(wheelMock, candidates);

    // count slices + 1 SVG lines overlay
    assert.equal(wheelMock.children.length, count + 1, `Wheel should have ${count} slices and 1 SVG overlay`);
    const slices = wheelMock.children.slice(0, count);
    const linesSvg = wheelMock.children[count];

    assert.equal(linesSvg.tag, 'svg');
    assert.equal(linesSvg.getAttribute('class'), 'roll-wheel-lines');
    assert.equal(linesSvg.children.length, count, `Wheel must have exactly ${count} divider lines`);

    const sectorAngle = 360 / count;
    for (let i = 0; i < count; i++) {
        const line = linesSvg.children[i];
        const x1 = parseFloat(line.getAttribute('x1'));
        const y1 = parseFloat(line.getAttribute('y1'));
        const x2 = parseFloat(line.getAttribute('x2'));
        const y2 = parseFloat(line.getAttribute('y2'));

        const angleDeg = -90 + i * sectorAngle;
        const rad = angleDeg * Math.PI / 180;
        const expectedX1 = 50 + 12 * Math.cos(rad);
        const expectedY1 = 50 + 12 * Math.sin(rad);
        const expectedX2 = 50 + 50 * Math.cos(rad);
        const expectedY2 = 50 + 50 * Math.sin(rad);

        assert.ok(Math.abs(x1 - expectedX1) < 0.01, `N=${count} Line ${i} x1 should match inner circle boundary`);
        assert.ok(Math.abs(y1 - expectedY1) < 0.01, `N=${count} Line ${i} y1 should match inner circle boundary`);
        assert.ok(Math.abs(x2 - expectedX2) < 0.01, `N=${count} Line ${i} x2 should match outer wheel boundary`);
        assert.ok(Math.abs(y2 - expectedY2) < 0.01, `N=${count} Line ${i} y2 should match outer wheel boundary`);

        // Slice i clip-path start boundary point matches Line i outer point
        const sliceClip = slices[i].style.clipPath;
        assert.ok(
            sliceClip.includes(`${expectedX2.toFixed(4)}% ${expectedY2.toFixed(4)}%`),
            `N=${count} Slice ${i} clip-path must contain the start boundary point matching Line ${i}`
        );

        // Previous slice (i - 1 + count) % count end boundary point matches Line i outer point
        const prevSlice = slices[(i + count - 1) % count];
        assert.ok(
            prevSlice.style.clipPath.includes(`${expectedX2.toFixed(4)}% ${expectedY2.toFixed(4)}%`),
            `N=${count} Previous slice must contain the end boundary point matching Line ${i}`
        );
    }
}

// Single candidate wheel test: no divider lines
{
    const wheelMock = mockElement('div');
    manager._renderRollCandidates(wheelMock, [{ kpId: 1, title: 'Solo', poster: 'solo.jpg' }]);
    assert.equal(wheelMock.children.length, 1, 'Single movie wheel should have only 1 slice');
    assert.equal(wheelMock.children[0].style.clipPath, 'circle(50% at 50% 50%)');
}

console.log('Random marathon contract passed.');
