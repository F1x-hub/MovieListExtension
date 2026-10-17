const fs = require('node:fs');

// Offline aggregate analysis only. Never exports title, episode, URL or track identity.
function analyze(rows) {
    if (!Array.isArray(rows) || rows.length > 10000) throw new Error('invalid_study_rows');
    let missing = 0, present = 0, unknown = 0, syncEligible = 0;
    for (const row of rows) {
        if (!row || row.exactIdentity !== true || typeof row.missingPair !== 'boolean') unknown++;
        else if (row.missingPair) missing++;
        else present++;
        const anchors = row?.anchorOffsetsMs;
        if (row?.exactIdentity === true && row.sameEdit === true
            && Number.isFinite(row.durationDeltaSeconds) && Math.abs(row.durationDeltaSeconds) <= 0.5
            && Array.isArray(anchors) && anchors.length === 3 && anchors.every(Number.isFinite)
            && anchors.every(value => Math.abs(value) <= 100)
            && Math.max(...anchors) - Math.min(...anchors) <= 100) syncEligible++;
    }
    const total = rows.length, known = missing + present;
    return { schemaVersion: 1, mode: 'offline', total, known, unknown, missing, present,
        missingFractionKnown: known ? missing / known : null,
        missingFractionBounds: total ? [missing / total, (missing + unknown) / total] : null,
        synchronizationCandidates: syncEligible,
        threshold: 0.15, decision: 'owner_review_required', liveCollectionPerformed: false };
}

if (require.main === module) {
    try {
        const rows = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) : [];
        console.log(JSON.stringify(analyze(rows), null, 2));
    } catch { console.error('invalid_study_input'); process.exitCode = 1; }
}
module.exports = { analyze };
