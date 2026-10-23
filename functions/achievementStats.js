/**
 * Shares of users per achievement tier («Есть у N%»).
 *
 * Clients store reached tiers on users/{uid}.achievements as
 * {id: {tier, at}}. On every user write this module diffs the tiers before and
 * after and turns the difference into counter increments for
 * achievementStats/global:
 *   participants         — users whose achievements were computed at least once
 *   tiers.<id>.<tier>    — users who reached at least that tier
 * Writes that do not touch achievements produce no increments.
 */

const ID_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
const MAX_TIER = 7;

/** {id: tier} from a stored achievements map; malformed entries are ignored. */
function tierMap(achievements) {
  const result = {};
  if (!achievements || typeof achievements !== "object" || Array.isArray(achievements)) return result;
  for (const [id, entry] of Object.entries(achievements)) {
    if (!ID_PATTERN.test(id)) continue;
    const tier = Math.min(MAX_TIER, Math.max(0, Math.floor(Number(entry?.tier) || 0)));
    if (tier > 0) result[id] = tier;
  }
  return result;
}

const hasAchievements = (data) => Boolean(data && data.achievements && typeof data.achievements === "object");

/**
 * Counter changes for one user write.
 * @returns {{participants: number, tiers: Object<string, Object<string, number>>, empty: boolean}}
 */
function achievementStatsDelta(before, after) {
  const was = hasAchievements(before);
  const is = hasAchievements(after);
  const participants = (is ? 1 : 0) - (was ? 1 : 0);
  const previous = tierMap(was ? before.achievements : null);
  const next = tierMap(is ? after.achievements : null);
  const tiers = {};
  for (const id of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    const from = previous[id] || 0;
    const to = next[id] || 0;
    if (from === to) continue;
    const step = to > from ? 1 : -1;
    for (let tier = Math.min(from, to) + 1; tier <= Math.max(from, to); tier++) {
      tiers[id] = tiers[id] || {};
      tiers[id][tier] = step;
    }
  }
  return { participants, tiers, empty: participants === 0 && Object.keys(tiers).length === 0 };
}

/** Firestore set-merge payload with increments for a non-empty delta. */
function statsUpdate(delta, FieldValue) {
  const payload = { updatedAt: FieldValue.serverTimestamp() };
  if (delta.participants) payload.participants = FieldValue.increment(delta.participants);
  const tiers = {};
  for (const [id, byTier] of Object.entries(delta.tiers)) {
    tiers[id] = {};
    for (const [tier, step] of Object.entries(byTier)) tiers[id][tier] = FieldValue.increment(step);
  }
  if (Object.keys(tiers).length) payload.tiers = tiers;
  return payload;
}

module.exports = { achievementStatsDelta, statsUpdate, tierMap };
