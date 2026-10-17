const assert = require('node:assert/strict');
const { analyze } = require('../scripts/player-track-study.cjs');
assert.equal(analyze([]).missingFractionKnown, null);
const report = analyze([
    { exactIdentity: true, missingPair: true, sameEdit: true, durationDeltaSeconds: 0.1, anchorOffsetsMs: [0, 30, 50], url: 'secret' },
    { exactIdentity: true, missingPair: false, sameEdit: true, durationDeltaSeconds: 0.1, anchorOffsetsMs: [0, 200, 400] },
    { exactIdentity: false, missingPair: true },
    { exactIdentity: true, missingPair: null }
]);
assert.equal(report.known, 2); assert.equal(report.unknown, 2);
assert.equal(report.missingFractionKnown, 0.5);
assert.deepEqual(report.missingFractionBounds, [0.25, 0.75]);
assert.equal(report.synchronizationCandidates, 1, 'similar duration alone cannot establish synchronization');
assert.equal(report.decision, 'owner_review_required');
assert.ok(!JSON.stringify(report).includes('secret'));
assert.throws(() => analyze({}));
console.log('Offline track study denominator, unknown, identity, anchors and privacy checks passed');
