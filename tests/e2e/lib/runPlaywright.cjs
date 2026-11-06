/**
 * Started by `firebase emulators:exec`. The arguments travel through the
 * environment so no shell in between has to re-quote them.
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { ROOT } = require('./config.cjs');

const cli = require.resolve('@playwright/test/cli');
const args = JSON.parse(process.env.E2E_PLAYWRIGHT_ARGS || '[]');
const { status } = spawnSync(process.execPath, [
    cli, 'test', '-c', path.join('tests', 'e2e', process.env.E2E_PLAYWRIGHT_CONFIG || 'playwright.config.cjs'), ...args
], { cwd: ROOT, stdio: 'inherit' });
process.exitCode = status ?? 1;
