/** Poses of the cat as CatPuppet targets, shared by the den and the silhouette in the frame picker. */

/** Both sides of a value at once: ears, lids, flaps and paws move in pairs. */
export const pair = (name, value) => ({ [`${name}L`]: value, [`${name}R`]: value });

/** How far the head has sunk into the box: out of sight, only the ears, the eyes over the rim. */
export const HIDDEN = 205;
export const EARS = 148;
export const EYES = 46;

/** How the cat holds itself when nothing else is going on. */
export const CALM = {
    ...pair('lid', 0), ...pair('flat', 0), ...pair('ear', 0), happy: 0, tense: 0, wide: 0, whisk: 0, mouth: 0, glanceX: 0, glanceY: 0,
    headX: 0, headY: 0, headR: 0, headSX: 1, headSY: 1, figX: 0, figY: 0, figR: 0, figSX: 1, figSY: 1, drop: 0,
    purr: 0, knead: 0, tailPuff: 0, tailLift: 0, tailAmp: 1
};

/** The cat at rest on each step: a silhouette, two eyes in the dark, a head over the rim of a box. */
export const REST = [
    { ...CALM, ...pair('lid', 1), glow: 0, pupil: 0.2, smile: 0 },
    { ...CALM, glow: 0.85, pupil: 0.24, smile: 0 },
    { ...CALM, glow: 0, pupil: 0.42, smile: 0.35, boxIn: 1, boxX: 0, boxY: 0, boxR: 0, boxSX: 1, boxSY: 1, ...pair('flap', 0), ...pair('paw', 1) }
];
