/**
 * Global teardown: one table for the whole run, on the console and in a file, so
 * that what each source did today can be read without opening the report.
 */
const fs = require('node:fs');
const path = require('node:path');
const { OUTPUT_DIR } = require('../lib/config.cjs');

const ROWS_FILE = path.join(OUTPUT_DIR, 'player-rows.jsonl');

function cell(value) {
    return value === null || value === undefined || value === '' ? '—' : String(value).replace(/\|/g, '/');
}

module.exports = async function summarize() {
    if (!fs.existsSync(ROWS_FILE)) return;
    const rows = fs.readFileSync(ROWS_FILE, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    const header = ['Title', 'Source', 'Outcome', 'Ready, s', 'First frame, s', 'Ads, s', 'Joined film at, s', 'Presses', 'Picture', 'Length, min', 'Stalls', 'Dropped', 'Host / why not'];
    const lines = rows.map(row => [
        row.title, row.source, row.outcome, row.readyAfterSeconds, row.firstFrameAfterSeconds, row.adSeconds, row.joinedAtSeconds, row.presses,
        row.resolution, row.minutes, row.stalls, row.droppedFrames, row.host || row.message || row.states
    ].map(cell));
    const table = [header, header.map(() => '---'), ...lines].map(line => `| ${line.join(' | ')} |`).join('\n');
    const file = path.join(OUTPUT_DIR, 'player-summary.md');
    fs.writeFileSync(file, `# Player on real sources\n\n${new Date().toISOString()}, ${process.env.E2E_NO_UBLOCK === '1' ? 'without uBlock' : 'with uBlock Origin Lite'}, ${process.env.E2E_HEADED === '1' ? 'in a window' : 'without a window'}\n\n${table}\n`);
    console.log(`\n${table}\n\nSaved to ${file}`);
};
