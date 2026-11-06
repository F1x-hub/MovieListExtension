/** Global setup: the summary describes this run only. */
const fs = require('node:fs');
const path = require('node:path');
const { OUTPUT_DIR } = require('../lib/config.cjs');

module.exports = async function cleanup() {
    fs.rmSync(path.join(OUTPUT_DIR, 'player-rows.jsonl'), { force: true });
};
