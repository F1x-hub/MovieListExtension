/**
 * The cat's frame taken apart, bottom to top, for the scene where it is put
 * together around the viewer's photo. Boxes are [x, y, width, height] in the 120
 * units of AchievementBadge's rank frames; the pictures are cut from the same
 * drawing as the whole frame (assets/frames/kitty-label.webp), so together they
 * look exactly like it. `root` is the point a part grows from; a `mirrored` part
 * is the named `picture` turned around the frame's vertical axis.
 */
export const FRAME_PARTS = [
    { name: 'ear-left', box: [8.01, 12.31, 32.39, 32.01], root: '78% 78%' },
    { name: 'ear-mirror', picture: 'ear-left', mirrored: true, box: [8.01, 12.31, 32.39, 32.01], root: '78% 78%' },
    { name: 'ear-right', box: [89.78, 12.31, 22.21, 26.19], root: '14% 78%' },
    { name: 'ring', box: [11.76, 11.76, 96.47, 96.47] },
    { name: 'whiskers-left', box: [-1.14, 65.12, 18.95, 17.97], root: '100% 30%' },
    { name: 'whiskers-right', box: [102.19, 65.12, 18.95, 17.97], root: '0% 30%' },
    { name: 'flowers', box: [6.43, 81.56, 31.96, 22.43] },
    { name: 'stars', box: [77.75, 84.93, 17.1, 23.36] },
    { name: 'beads', box: [95.5, 82.27, 10.07, 13.34] },
    { name: 'heart-big', box: [9.53, 50.53, 15.24, 13.72] },
    { name: 'heart-small', box: [95.33, 62.5, 8.71, 7.68] },
    { name: 'heart-ear', box: [20.64, 10.51, 11.6, 6.37] },
    { name: 'bow', box: [68.11, 6.7, 49.11, 53.14], root: '44% 46%' },
    { name: 'letters', box: [34.52, 77.8, 50.25, 11.54] }
];

export function framePartUrl(name) {
    const path = `src/shared/assets/frames/kitty/${name}.webp`;
    return globalThis.chrome?.runtime?.getURL ? globalThis.chrome.runtime.getURL(path) : '/' + path;
}
