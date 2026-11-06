/**
 * Films are watched with uBlock Origin Lite installed, so the live specs run with it
 * too: ads, and whatever a provider does when its ads are blocked, change what a
 * viewer gets. Only a copy of the extension's own folder is used. The browser's
 * profile, settings and data stay out of it, so the filter settings are the defaults.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { OUTPUT_DIR } = require('./config.cjs');

const UBLOCK_LITE_ID = 'ddkjiahejlhfcafbddmgiahcphecmpfh';
const COPY = path.join(OUTPUT_DIR, 'ublock-lite');

function installedVersions() {
    const folder = path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data', 'Default', 'Extensions', UBLOCK_LITE_ID);
    try {
        return fs.readdirSync(folder).map(version => path.join(folder, version)).sort().reverse();
    } catch {
        return [];
    }
}

/** @returns {string|null} A folder Chromium can load, or null when none is installed. */
function prepareUblockCopy() {
    const source = process.env.E2E_UBLOCK_PATH || installedVersions()[0];
    if (!source || !fs.existsSync(path.join(source, 'manifest.json'))) return null;
    fs.rmSync(COPY, { recursive: true, force: true });
    // Chromium refuses an unpacked extension holding the store's _metadata folder.
    fs.cpSync(source, COPY, { recursive: true, filter: file => path.basename(file) !== '_metadata' });
    return COPY;
}

/** Waits until its filters are really on, so a run never measures an idle blocker. */
async function waitForUblockRules(context) {
    const isUblock = worker => new URL(worker.url()).host === UBLOCK_LITE_ID;
    const worker = context.serviceWorkers().find(isUblock)
        || await context.waitForEvent('serviceworker', { predicate: isUblock, timeout: 15000 });
    const startedAt = Date.now();
    while (Date.now() - startedAt < 15000) {
        const rulesets = await worker.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets());
        if (rulesets.length) return { rulesets, version: await worker.evaluate(() => chrome.runtime.getManifest().version) };
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('uBlock Origin Lite loaded, but enabled no filter rules');
}

module.exports = { prepareUblockCopy, waitForUblockRules, UBLOCK_LITE_ID };
