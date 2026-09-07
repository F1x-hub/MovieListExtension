const assert = require('node:assert/strict');
const fs = require('node:fs');

const cleanerSource = fs.readFileSync('content-scripts/player-cleaner.js', 'utf8');
const applyStart = cleanerSource.indexOf('window.movieExtension_applySelection = async');
const restoreStart = cleanerSource.indexOf('window.movieExtension_restoreProgress =', applyStart);
const applyContract = cleanerSource.slice(applyStart, restoreStart);

assert.match(cleanerSource, /selectionOperationGeneration/);
assert.match(cleanerSource, /acknowledge\('CANCELLED', 'stale-selection'\)/);
assert.match(applyContract, /return false;/);
assert.doesNotMatch(applyContract, /movieExtension_restoreProgress/);

function loadSelectionContract(document) {
    const factory = new Function(
        'window',
        'document',
        'console',
        'applyKinogoProviderSelection',
        'applyNativeProviderSelection',
        `${applyContract}; return window.movieExtension_applySelection;`
    );
    const window = {};
    return factory(
        window,
        document,
        { info() {}, warn() {} },
        async () => false,
        async () => false
    );
}

function makeItem(label, state) {
    return {
        textContent: label,
        get className() {
            return state.active ? 'item_hash active_hash' : 'item_hash';
        },
        classList: {
            contains(name) {
                return name === 'active' && state.active;
            }
        },
        getAttribute(name) {
            return name === 'aria-selected' && state.active ? 'true' : null;
        },
        click() {
            state.active = true;
        }
    };
}

function makeDropdown(items) {
    return { querySelectorAll: () => items };
}

function makeProviderDom({ seasons, episodes }) {
    const seasonDropdown = makeDropdown(seasons);
    const episodeDropdown = makeDropdown(episodes);
    const listContainer = {
        querySelectorAll(selector) {
            return selector.includes('dropdown_') ? [seasonDropdown, episodeDropdown] : [];
        }
    };
    return {
        querySelector(selector) {
            return selector.includes('list_') ? listContainer : null;
        },
        querySelectorAll() {
            return [];
        }
    };
}

function loadClassBridge(document) {
    const start = cleanerSource.indexOf('const applyNativeProviderSelection = async');
    const end = cleanerSource.indexOf('window.movieExtension_applySelection =', start);
    const factory = new Function(
        'document',
        'console',
        `${cleanerSource.slice(start, end)}; return applyNativeProviderSelection;`
    );
    return factory(document, { info() {}, warn() {} });
}

async function run() {
    const noProviderSelection = loadSelectionContract({ querySelector: () => null });
    assert.equal(
        await noProviderSelection(3, 5, 'exfs'),
        false,
        'provider selection without an applied DOM state must report failure'
    );
    assert.equal(
        await noProviderSelection(3, 5, 'exfs', () => false),
        false,
        'a cancelled selection operation must report failure'
    );

    const missingSeason = makeProviderDom({
        seasons: [makeItem('Сезон 2', { active: true })],
        episodes: [makeItem('Серия 5', { active: false })]
    });
    const missingSeasonResult = await loadClassBridge(missingSeason)(3, 5);
    assert.equal(missingSeasonResult, false, 'missing season must never report applied');

    const validSeasonState = { active: true };
    const validEpisodeState = { active: false };
    const validDom = makeProviderDom({
        seasons: [makeItem('Сезон 3', validSeasonState)],
        episodes: [makeItem('Серия 5', validEpisodeState)]
    });
    const validResult = await loadClassBridge(validDom)(3, 5);
    assert.equal(validResult, true, 'active season and episode must report applied');
    assert.equal(validEpisodeState.active, true, 'requested episode must be activated');

    console.log('✅ player cleaner selection contract tests passed');
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
