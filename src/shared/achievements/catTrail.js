/**
 * The cat trail: a secret achievement earned in three steps, in order, whose
 * reward is an avatar frame. Steps passed are kept in the achievement's stored
 * record (`steps`), so deleting the review or the collection does not undo them.
 *   1. a review or a comment says «мяу»;
 *   2. a collection named «Коробка» holds at least one film;
 *   3. the cat is petted (CatDen), the only step the recompute cannot find.
 */

/** The cat's frame as a frame level; negative, so 0 keeps meaning "no frame" and older clients fall back to the rank. */
export const CAT_FRAME = -1;
export const TRAIL_ID = 'cat_trail';
export const TRAIL_STEPS = 3;

const MEOW = /(?<!\p{L})(?:м+я+у+|m+e+o+w+|m+i+a+o+w*)(?!\p{L})/iu;
const BOX = /(?<!\p{L})(?:короб(?:к[аиуео]|кой|ок|очк[аиуео]|очкой)|box)(?!\p{L})/iu;

export const saysMeow = text => typeof text === 'string' && MEOW.test(text);
export const isBox = collection => BOX.test(String(collection?.name ?? ''))
    && Array.isArray(collection.movieIds) && collection.movieIds.length > 0;

/** Steps passed according to the stored achievements. */
export function trailSteps(stored) {
    const entry = stored?.[TRAIL_ID];
    if (Number(entry?.tier) > 0) return TRAIL_STEPS;
    return Math.max(0, Math.min(TRAIL_STEPS - 1, Math.floor(Number(entry?.steps) || 0)));
}

export const catFrameUnlocked = stored => trailSteps(stored) === TRAIL_STEPS;

/** Steps passed now: the stored ones, plus those the data shows next in order. */
export function advanceTrail(steps, { ratings = [], collections = [] }) {
    let next = Math.max(0, Math.min(TRAIL_STEPS, Number(steps) || 0));
    if (next === 0 && ratings.some(rating => saysMeow(rating?.comment) || saysMeow(rating?.review))) next = 1;
    if (next === 1 && collections.some(isBox)) next = 2;
    return next;
}
