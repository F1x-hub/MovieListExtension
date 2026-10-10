const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const Service = require('../src/shared/services/WhatsNewService.js');

function validate(entries, version) {
    if (!Service.validVersion(version)) throw new Error('Invalid manifest version');
    const ids = new Set(), versions = new Set();
    let previous;
    for (const entry of entries) {
        if (typeof entry.id !== 'string' || !entry.id.trim()) throw new Error('Invalid release id');
        if (ids.has(entry.id) || versions.has(entry.version)) throw new Error('Duplicate release id/version');
        ids.add(entry.id); versions.add(entry.version);
        if (entry.draft !== undefined && typeof entry.draft !== 'boolean') throw new Error('Invalid draft flag');
        if (entry.skipAnnouncement !== undefined && typeof entry.skipAnnouncement !== 'boolean') throw new Error('Invalid skip flag');
        if (entry.draft ? entry.version !== 'next' : !Service.validVersion(entry.version)) throw new Error('Invalid release version');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || !Number.isFinite(Date.parse(entry.date))
            || new Date(entry.date).toISOString().slice(0, 10) !== entry.date) throw new Error('Invalid release date');
        if (!entry.draft) {
            if (previous && Service.compare(previous, entry.version) <= 0) throw new Error('Releases must be newest first');
            previous = entry.version;
        }
        if (!Array.isArray(entry.highlights) || (!entry.skipAnnouncement && (entry.highlights.length < 3 || entry.highlights.length > 6))) throw new Error('Expected 3–6 highlights');
        const highlights = new Set();
        for (const item of entry.highlights) {
            if (typeof item.id !== 'string' || !item.id.trim() || highlights.has(item.id)) throw new Error('Duplicate highlight id');
            highlights.add(item.id);
            for (const field of ['title', 'text']) for (const language of ['ru', 'en']) {
                if (typeof item[field]?.[language] !== 'string' || !item[field][language].trim()) throw new Error('Missing localized content');
            }
        }
    }
    if (!entries.some(entry => !entry.draft && entry.version === version)) throw new Error('Manifest requires an exact published entry or explicit skip');
}

function readCatalog(file) {
    const context = vm.createContext({});
    vm.runInContext(fs.readFileSync(file, 'utf8').replace('export const whatsNew =', 'globalThis.entries ='), context);
    return context.entries;
}
function validateCurrent() {
    const root = path.join(__dirname, '..');
    const version = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version;
    validate(readCatalog(path.join(root, 'src/shared/config/whatsNew.js')), version);
}
if (require.main === module) { validateCurrent(); console.log('WhatsNew release gate passed'); }
module.exports = { validate, readCatalog, validateCurrent };
