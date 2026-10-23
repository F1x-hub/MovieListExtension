const assert = require("node:assert/strict");
const { achievementStatsDelta, statsUpdate, tierMap } = require("../achievementStats");

// Malformed entries are ignored and tiers are clamped.
assert.deepEqual(tierMap({ rater: { tier: 3 }, "bad/id": { tier: 2 }, voice: { tier: 99 }, zero: { tier: 0 } }), { rater: 3, voice: 7 });
assert.deepEqual(tierMap(null), {});

// First computation: the user becomes a participant and every reached tier counts.
let delta = achievementStatsDelta({ username: "a" }, { username: "a", achievements: { rater: { tier: 2 }, first_step: { tier: 1 } } });
assert.equal(delta.participants, 1);
assert.deepEqual(delta.tiers, { rater: { 1: 1, 2: 1 }, first_step: { 1: 1 } });

// A user with an empty map is still a participant.
assert.equal(achievementStatsDelta(null, { achievements: {} }).participants, 1);

// A new tier adds only that tier; unrelated profile edits do nothing.
delta = achievementStatsDelta({ achievements: { rater: { tier: 2 } } }, { achievements: { rater: { tier: 4 } } });
assert.equal(delta.participants, 0);
assert.deepEqual(delta.tiers, { rater: { 3: 1, 4: 1 } });
assert.equal(achievementStatsDelta({ bio: "x", achievements: { rater: { tier: 2 } } }, { bio: "y", achievements: { rater: { tier: 2, at: {} } } }).empty, true);
assert.equal(achievementStatsDelta({ bio: "x" }, { bio: "y" }).empty, true);

// Lowered tiers and deleted users are subtracted.
delta = achievementStatsDelta({ achievements: { rater: { tier: 3 } } }, { achievements: { rater: { tier: 1 } } });
assert.deepEqual(delta.tiers, { rater: { 2: -1, 3: -1 } });
delta = achievementStatsDelta({ achievements: { voice: { tier: 1 } } }, null);
assert.equal(delta.participants, -1);
assert.deepEqual(delta.tiers, { voice: { 1: -1 } });

// The update payload uses increments only for what changed.
const FieldValue = { increment: (n) => ({ inc: n }), serverTimestamp: () => "ts" };
const payload = statsUpdate(achievementStatsDelta(null, { achievements: { rater: { tier: 1 } } }), FieldValue);
assert.deepEqual(payload, { updatedAt: "ts", participants: { inc: 1 }, tiers: { rater: { 1: { inc: 1 } } } });
assert.equal("participants" in statsUpdate(achievementStatsDelta({ achievements: {} }, { achievements: { rater: { tier: 1 } } }), FieldValue), false);

console.log("Achievement stats tests passed");
