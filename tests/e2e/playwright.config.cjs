const path = require('node:path');
const { defineConfig } = require('@playwright/test');
const { OUTPUT_DIR } = require('./lib/config.cjs');

module.exports = defineConfig({
    testDir: path.join(__dirname, 'specs'),
    outputDir: path.join(OUTPUT_DIR, 'results'),
    // Baselines depend on font rendering, so each platform keeps its own.
    snapshotPathTemplate: path.join(__dirname, '__screenshots__', '{platform}', '{arg}{ext}'),
    // One emulator and frame timing that must not compete with other tests.
    workers: 1,
    fullyParallel: false,
    timeout: 180_000,
    expect: {
        timeout: 20_000,
        toHaveScreenshot: {
            animations: 'disabled',
            caret: 'hide',
            scale: 'css',
            // A ratio is useless on a full-screen shot: 0.2% is 2600 pixels and
            // a restyled button fits inside that. Checked by breaking a page.
            maxDiffPixels: 10,
            threshold: 0.03
        }
    },
    reporter: [
        ['list'],
        ['html', { outputFolder: path.join(OUTPUT_DIR, 'report'), open: 'never' }]
    ]
});
