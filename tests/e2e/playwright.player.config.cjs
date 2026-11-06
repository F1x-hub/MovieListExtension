const path = require('node:path');
const { defineConfig } = require('@playwright/test');
const { OUTPUT_DIR } = require('./lib/config.cjs');

// Real providers: slow, changing, and to be asked one request at a time.
module.exports = defineConfig({
    testDir: path.join(__dirname, 'player'),
    outputDir: path.join(OUTPUT_DIR, 'player-results'),
    globalSetup: path.join(__dirname, 'player', 'cleanup.cjs'),
    globalTeardown: path.join(__dirname, 'player', 'summary.cjs'),
    workers: 1,
    fullyParallel: false,
    timeout: 480_000,
    expect: { timeout: 20_000 },
    // A control that never appears is a finding, not eight minutes of waiting.
    use: { actionTimeout: 20_000 },
    reporter: [
        ['list'],
        ['html', { outputFolder: path.join(OUTPUT_DIR, 'player-report'), open: 'never' }]
    ]
});
