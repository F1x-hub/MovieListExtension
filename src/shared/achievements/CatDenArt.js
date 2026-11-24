/**
 * The drawing of the cat trail: a storeroom behind a cinema at night, the cat and
 * its box. It is drawn once for the den (the scene opened from the achievements
 * tab) and once, cropped, for the silhouette in the frame picker. Nothing here
 * moves by itself: CatPuppet finds the parts by `data-cat` and animates them, and
 * cat-den.css owns the light and the colors, which depend on the step and on how
 * much the cat trusts the viewer (`--warm`). Like badges, it is content art.
 */

/** The scene is 640x400; the head is drawn around this point. */
export const HEAD = { x: 320, y: 196 };
export const EYE = { x: 42, y: 2 };

// Gradient ids must be unique per drawing on the page.
let sequence = 0;

const mirror = markup => markup + `<g transform="scale(-1 1)">${markup}</g>`;
const round = value => Math.round(value * 100) / 100;

/**
 * Eye outlines, all with the same 13 points so one can turn into another: from
 * the outer corner over the upper lid to the inner corner, and back below. Each
 * way of closing has a half: without it the upper lid would pass through a
 * straight line, and a straight lid looks angry.
 */
const EYES = {
    open: [-26, -2, -24, -17, -10, -25, 3, -24, 16, -23, 26, -10, 25, 5, 24, 16, 13, 23, 1, 23, -12, 23, -24, 14, -26, -2],
    wide: [-29, -2, -28, -20, -13, -30, 2, -30, 17, -30, 29, -18, 29, 2, 29, 18, 16, 28, 1, 28, -14, 28, -28, 16, -29, -2],
    shutHalf: [-26, 5, -21, -4, -11, -8, 1, -8, 12, -8, 21, -3, 25, 8, 23, 17, 12, 21.5, 1, 21.5, -11, 21.5, -23, 16, -26, 5],
    happyHalf: [-26, 7, -21, -7, -11, -14, 0, -14, 11, -14, 21, -7, 25, 8, 20, 11, 11, 8, 0, 8, -11, 8, -20, 11, -26, 7],
    tenseHalf: [-25, 9, -19, -1, -10, -6, 1, -8, 12, -9, 20, -7, 25, 0, 22, 10, 12, 16, 1, 17, -11, 18, -21, 16, -25, 9],
    shut: [-25, 3, -18, 11, -9, 15, 1, 15, 11, 15, 19, 12, 24, 7, 19, 12.4, 11, 15.6, 1, 15.6, -9, 15.6, -18, 11.6, -25, 3],
    happy: [-25, 11, -19, -2, -10, -9, 0, -9, 10, -9, 19, -2, 24, 11, 19, -1.2, 10, -8.4, 0, -8.4, -10, -8.4, -19, -1.2, -25, 11],
    tense: [-24, 11, -16, 11, -7, 9.5, 1, 6.5, 9, 3.5, 17, 0, 23, -3, 17, 0.6, 9, 4.1, 1, 7.1, -7, 10.1, -16, 11.6, -24, 11]
};

/** How closed an eye is in the half shapes. */
const HALF = 0.6;
const mix = (from, to, share) => from.map((value, index) => value + (to[index] - value) * share);

/**
 * Paths of one eye. `lid` 0 is open and 1 closed; `happy` and `tense` choose how it
 * closes, `wide` how far it opens.
 */
export function eyePaths({ lid = 0, happy = 0, tense = 0, wide = 0 } = {}) {
    const half = mix(mix(EYES.shutHalf, EYES.happyHalf, happy), EYES.tenseHalf, tense);
    const p = (lid < HALF
        ? mix(mix(EYES.open, EYES.wide, wide), half, lid / HALF)
        : mix(half, mix(mix(EYES.shut, EYES.happy, happy), EYES.tense, tense), (lid - HALF) / (1 - HALF))).map(round);
    const upper = `C${p.slice(2, 8)}C${p.slice(8, 14)}`;
    const lower = `C${p.slice(14, 20)}C${p.slice(20, 26)}`;
    return { outline: `M${p[0]},${p[1]}${upper}${lower}Z`, lash: `M${p[0]},${p[1]}${upper}`, lower: `M${p[12]},${p[13]}${lower}` };
}

/** The mouth: `smile` 0–1 lifts the corners, `open` 0–1 drops the jaw. */
export function mouthPath({ smile = 0, open = 0 } = {}) {
    const x = round(21 + smile * 4);
    const y = round(50 - smile * 3);
    const top = round(46 + open * 2);
    const low = round(57 + smile * 2 + open * 4);
    return `M0 41V${top}M0 ${top}C-4 ${low} ${round(4 - x)} ${low} ${-x} ${y}M0 ${top}C4 ${low} ${round(x - 4)} ${low} ${x} ${y}`;
}

/** Tails: `sway` −1–1 moves the tip, `lift` 0–1 raises it. */
export function floorTail({ sway = 0, lift = 0 } = {}) {
    const a = round(sway * 14);
    const up = round(lift * 34);
    return `M404 360C456 384 ${round(512 + a * 0.5)} ${round(362 - up * 0.4)} ${round(510 + a)} ${round(314 - up)}C${round(509 + a * 1.3)} ${round(288 - up)} ${round(484 + a * 1.4)} ${round(286 - up)} ${round(484 + a * 1.5)} ${round(304 - up)}`;
}

export function boxTail({ sway = 0, lift = 0 } = {}) {
    const a = round(sway * 13);
    const up = round(lift * 26);
    return `M408 300C452 284 ${round(470 + a * 0.4)} ${round(242 - up * 0.4)} ${round(452 + a)} ${round(206 - up)}C${round(444 + a * 1.3)} ${round(188 - up)} ${round(424 + a * 1.5)} ${round(192 - up)} ${round(429 + a * 1.6)} ${round(210 - up)}`;
}

const stops = list => list.map(([offset, attrs]) => `<stop offset="${offset}" ${attrs}/>`).join('');
const linear = (id, list, at = 'x1="0" y1="0" x2="0" y2="1"') => `<linearGradient id="${id}" ${at}>${stops(list)}</linearGradient>`;
const radial = (id, list, at = 'cx="50%" cy="50%" r="50%"') => `<radialGradient id="${id}" ${at}>${stops(list)}</radialGradient>`;

const roomDefs = id => `<defs>
    ${linear(`${id}wall`, [[0, 'class="cat-wall-1"'], [0.82, 'class="cat-wall-2"'], [1, 'class="cat-wall-3"']])}
    ${linear(`${id}floor`, [[0, 'class="cat-floor-1"'], [1, 'class="cat-floor-2"']])}
    ${linear(`${id}moonfloor`, [[0, 'stop-color="#aebaf2" stop-opacity=".5"'], [1, 'stop-color="#aebaf2" stop-opacity="0"']])}
    ${linear(`${id}beam`, [[0.02, 'class="cat-beam-color" stop-opacity="0"'], [0.4, 'class="cat-beam-color" stop-opacity=".14"'], [1, 'class="cat-beam-color" stop-opacity=".7"']], 'x1="0" y1="0" x2="1" y2="0"')}
    ${radial(`${id}halo`, [[0, 'class="cat-halo" stop-opacity=".75"'], [0.45, 'class="cat-halo" stop-opacity=".28"'], [1, 'class="cat-halo" stop-opacity="0"']])}
</defs>`;

const catDefs = id => `<defs>
    ${radial(`${id}torch`, [[0, 'stop-color="#b9c3f5" stop-opacity=".5"'], [0.5, 'stop-color="#b9c3f5" stop-opacity=".16"'], [1, 'stop-color="#b9c3f5" stop-opacity="0"']])}
    ${radial(`${id}bloom`, [[0, 'stop-color="#fff"'], [0.28, 'stop-color="#ffd0e0" stop-opacity=".85"'], [0.6, 'stop-color="#ff6f9f" stop-opacity=".3"'], [1, 'stop-color="#ff407c" stop-opacity="0"']])}
    ${radial(`${id}shadow`, [[0, 'stop-color="#000" stop-opacity=".75"'], [0.55, 'stop-color="#000" stop-opacity=".42"'], [1, 'stop-color="#000" stop-opacity="0"']])}
    ${linear(`${id}fur`, [[0, 'class="cat-fur-1"'], [1, 'class="cat-fur-2"']])}
    ${linear(`${id}leg`, [[0, 'class="cat-fur-2"'], [0.55, 'class="cat-fur-1"'], [1, 'class="cat-fur-2"']])}
    ${linear(`${id}tail`, [[0, 'class="cat-fur-1"'], [1, 'class="cat-fur-2"']], 'gradientUnits="userSpaceOnUse" x1="0" y1="200" x2="0" y2="400"')}
    ${linear(`${id}rim`, [[0, 'class="cat-rim" stop-opacity=".95"'], [0.45, 'class="cat-rim" stop-opacity=".4"'], [1, 'class="cat-rim" stop-opacity=".1"']])}
    ${linear(`${id}glow`, [[0.45, 'class="cat-beam-color" stop-opacity="0"'], [1, 'class="cat-beam-color" stop-opacity=".95"']], 'x1="0" y1="0" x2="1" y2="0"')}
    ${radial(`${id}sheen`, [[0, 'class="cat-rim" stop-opacity=".34"'], [1, 'class="cat-rim" stop-opacity="0"']], 'cx="50%" cy="8%" r="62%"')}
    ${linear(`${id}ear`, [[0, 'class="cat-ear-1"'], [1, 'class="cat-ear-2"']])}
    ${radial(`${id}iris`, [[0, 'stop-color="#fff6d2"'], [0.4, 'stop-color="#ffd07a"'], [0.78, 'stop-color="#f09a3e"'], [1, 'stop-color="#b5541c"']], 'cx="50%" cy="58%" r="58%"')}
    ${radial(`${id}eyeglow`, [[0, 'stop-color="#ffc25e" stop-opacity=".85"'], [0.4, 'stop-color="#ff9d3c" stop-opacity=".3"'], [1, 'stop-color="#ff8a2c" stop-opacity="0"']])}
    ${radial(`${id}blush`, [[0, 'class="cat-blush-color" stop-opacity="1"'], [1, 'class="cat-blush-color" stop-opacity="0"']])}
    ${linear(`${id}whisker`, [[0, 'class="cat-whisker-1"'], [1, 'class="cat-whisker-2"']], 'x1="0" y1="0" x2="1" y2="0"')}
    ${linear(`${id}board`, [[0, 'class="cat-board-1"'], [1, 'class="cat-board-2"']])}
    ${linear(`${id}flap`, [[0, 'class="cat-board-3"'], [1, 'class="cat-board-1"']])}
    ${linear(`${id}inside`, [[0, 'stop-color="#1c1109"'], [1, 'stop-color="#4a311c"']])}
    <clipPath id="${id}cut"><path d="M-200-600H840V258H452V286H188V258H-200Z"/></clipPath>
</defs>`;

/** A film reel with five windows, as one path. */
function reel(radius) {
    const ring = (x, y, r) => `M${round(x - r)} ${round(y)}a${r} ${r} 0 1 0 ${round(r * 2)} 0a${r} ${r} 0 1 0 ${round(-r * 2)} 0Z`;
    return ring(0, 0, radius) + [0, 1, 2, 3, 4].map(index => {
        const angle = index * Math.PI * 0.4 - Math.PI / 2;
        return ring(Math.cos(angle) * radius * 0.58, Math.sin(angle) * radius * 0.58, round(radius * 0.25));
    }).join('');
}

/** The same shape a few times over, larger and fainter: a soft edge without a filter. */
const soft = (draw, spread = 7, layers = 5) => Array.from({ length: layers }, (_, index) => draw(round(spread * (index / (layers - 1) * 2 - 1)))).join('');

/** Four panes of moonlight, drawn as they fall on the wall. */
const panes = grow => [[182, 20, 132, 104], [328, 20, 132, 104], [182, 138, 132, 112], [328, 138, 132, 112]]
    .map(([x, y, width, height]) => `<rect x="${round(x - grow)}" y="${round(y - grow)}" width="${round(width + grow * 2)}" height="${round(height + grow * 2)}" rx="${round(Math.max(0, grow + 4))}"/>`).join('');

/** The storeroom: moonlight through a window, film cans, and a projector whose lamp comes on once the cat stays. */
const room = id => `${roomDefs(id)}<g>
    <rect x="-20" y="-20" width="680" height="440" fill="url(#${id}wall)"/>
    <g class="cat-moon" fill="#aab6f2" fill-opacity=".135" transform="matrix(1 .05 -.1 1 22 -8)">${soft(panes, 6.5, 10)}</g>
    <path d="M-20 322H660V420H-20Z" fill="url(#${id}floor)"/>
    <path d="M-20 322H660" class="cat-skirting" fill="none" stroke-width="2"/>
    <path d="M30 400L148 322M170 400L236 322M306 400L312 322M440 400L390 322M566 400L468 322M660 376L548 322" class="cat-boards" fill="none" stroke-width="1.5"/>
    <g class="cat-moon" fill="url(#${id}moonfloor)" fill-opacity=".3">${soft(grow => `<path d="M${182 - grow} 324H${474 + grow}L${round(532 + grow * 1.6)} 404H${round(118 - grow * 1.6)}Z"/>`, 10, 5)}</g>
    <g class="cat-prop">
        <g transform="translate(96 268)"><path d="${reel(50)}" fill-rule="evenodd" class="cat-prop__body"/><path d="${reel(50)}" fill="none" class="cat-prop__rim"/><path d="M-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0Z" class="cat-prop__dark"/></g>
        <path d="M134 296C158 306 150 336 166 350 176 358 188 352 196 360" fill="none" class="cat-prop__strip" stroke-width="13"/><path d="M134 296C158 306 150 336 166 350 176 358 188 352 196 360" fill="none" class="cat-prop__frames" stroke-width="8" stroke-dasharray="8 3"/>
        <path d="M30 356V378C30 388 138 388 138 378V356Z" class="cat-prop__body"/><path d="M30 356C30 346 138 346 138 356 138 366 30 366 30 356Z" class="cat-prop__top"/>
        <path d="M44 334V354C44 363 128 363 128 354V334Z" class="cat-prop__body"/><path d="M44 334C44 325 128 325 128 334 128 343 44 343 44 334Z" class="cat-prop__top"/>
        <path d="M44 334C44 325 128 325 128 334M30 356C30 346 138 346 138 356" fill="none" class="cat-prop__rim"/>
    </g>
    <g class="cat-prop">
        <path d="M556 306L526 394M562 306V398M568 306L604 392" fill="none" class="cat-prop__leg" stroke-width="6" stroke-linecap="round"/>
        <g transform="translate(536 222)"><path d="${reel(27)}" fill-rule="evenodd" class="cat-prop__body"/><path d="${reel(27)}" fill="none" class="cat-prop__rim"/></g>
        <g transform="translate(594 214)"><path d="${reel(32)}" fill-rule="evenodd" class="cat-prop__body"/><path d="${reel(32)}" fill="none" class="cat-prop__rim"/></g>
        <path d="M530 246H596C602 246 606 250 606 256V298C606 304 602 308 596 308H530C524 308 520 304 520 298V256C520 250 524 246 530 246Z" class="cat-prop__body"/>
        <path d="M520 262H500V288H520Z M500 258H492V292H500Z" class="cat-prop__dark"/><path d="M520 256C520 250 524 246 530 246H596C602 246 606 250 606 256" fill="none" class="cat-prop__rim"/>
        <path d="M584 258H598V264H584Z" class="cat-prop__lamp"/><ellipse class="cat-prop__lens" cx="493" cy="275" rx="4" ry="15"/>
    </g>
    <g class="cat-beam" fill="url(#${id}beam)" fill-opacity=".16">${soft(grow => `<path d="M494 ${round(265 - grow * 0.12)}V${round(285 + grow * 0.12)}L-40 ${430 + grow}V${20 - grow}Z"/>`, 54, 10)}</g>
    <ellipse class="cat-halo-light" cx="320" cy="206" rx="300" ry="220" fill="url(#${id}halo)"/>
</g>`;

/** Chest, legs and tail of the sitting cat. */
const torso = id => `<g data-cat="torso">
    <path class="cat-tail-edge" data-cat="tail-floor-edge" d="${floorTail()}" fill="none" stroke-linecap="round"/>
    <path data-cat="tail-floor" d="${floorTail()}" fill="none" stroke="url(#${id}tail)" stroke-width="22" stroke-linecap="round"/>
    <path d="M266 240C244 264 234 290 230 318 210 328 198 346 204 366 207 376 220 378 236 378H404C420 378 433 376 436 366 442 346 430 328 410 318 406 290 396 264 374 240Z" fill="url(#${id}fur)"/>
    <path d="M266 240C244 264 234 290 230 318 210 328 198 346 204 366M374 240C396 264 406 290 410 318 430 328 442 346 436 366" fill="none" stroke="url(#${id}rim)" stroke-width="2.4"/>
    <path d="M410 318C406 290 396 264 374 240M436 366C442 346 430 328 410 318" class="cat-lit" fill="none" stroke="url(#${id}glow)" stroke-width="3"/>
    <path d="M230 318C244 322 254 336 254 356M410 318C396 322 386 336 386 356" fill="none" class="cat-crease" stroke-width="3" stroke-linecap="round"/>
    <path d="M282 292C276 318 276 346 279 362 266 364 262 377 273 379H310C318 377 317 366 309 363 313 340 314 316 314 298ZM358 292C364 318 364 346 361 362 374 364 378 377 367 379H330C322 377 323 366 331 363 327 340 326 316 326 298Z" fill="url(#${id}leg)"/>
    <path d="M284 370V378M297 370V378M343 370V378M356 370V378" fill="none" class="cat-crease" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M282 292C276 318 276 346 279 362M314 300C314 322 312 344 309 362M358 292C364 318 364 346 361 362M326 300C326 322 328 344 331 362" fill="none" class="cat-crease" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M270 254C280 284 292 290 298 312L306 300 313 320 320 306 327 320 334 300 342 312C348 290 360 284 370 254Z" class="cat-tuft"/>
</g>`;

const EAR = 'M-89-12C-99-56-96-102-85-117-82-121-78-119-74-117-54-106-32-86-16-60-38-56-70-42-89-12Z';
const HEAD_PATH = 'M0-74C50-76 88-48 94-4 96 6 99 16 108 25L93 27C94 35 95 41 100 50L81 47C62 70 34 80 0 80-34 80-62 70-81 47L-100 50C-95 41-94 35-93 27L-108 25C-99 16-96 6-94-4-88-48-50-76 0-74Z';
const FORELOCK = 'M-17-71C-15-79-11-84-4-88-5-83-4-80-1-77 2-83 7-86 14-87 11-83 11-80 13-77 16-78 19-76 22-70 10-74-6-74-17-71Z';

const ear = (id, side) => `<g${side < 0 ? '' : ' transform="scale(-1 1)"'}><g data-cat="ear-${side < 0 ? 'l' : 'r'}">
    <path d="${EAR}" fill="url(#${id}fur)"/>
    <path class="cat-ear__inner" d="M-79-34C-86-64-84-90-78-99-62-91-44-76-32-61-50-57-68-48-79-34Z" fill="url(#${id}ear)"/>
    <path class="cat-ear__hair" d="M-74-39C-76-56-72-70-65-79M-65-45C-64-58-60-67-53-72M-55-51C-53-58-50-63-45-66" fill="none" stroke-width="2.6" stroke-linecap="round"/>
    <path d="${EAR}" fill="none" stroke="url(#${id}rim)" stroke-width="2.6"/>
</g></g>`;

const eye = (id, side) => {
    const key = side < 0 ? 'l' : 'r';
    const flip = side < 0 ? '' : ' transform="scale(-1 1)"';
    const { outline, lash, lower } = eyePaths();
    return `<g class="cat-eye" data-cat="eye-${key}" transform="translate(${side * EYE.x} ${EYE.y})">
        <ellipse class="cat-eye__glow" data-cat="glow-${key}" rx="62" ry="54" fill="url(#${id}eyeglow)"/>
        <clipPath id="${id}lid-${key}"><path data-cat="clip-${key}" d="${outline}"${flip}/></clipPath>
        <g clip-path="url(#${id}lid-${key})">
            <g data-cat="iris-${key}"><ellipse rx="32" ry="31" fill="url(#${id}iris)"/><ellipse rx="30" ry="29" fill="none" stroke="#6d2c0c" stroke-opacity=".6" stroke-width="5"/><path d="M-18 10C-12 20 12 20 18 10 14 24-14 24-18 10Z" fill="#fff3c4" opacity=".55"/></g>
            <ellipse data-cat="pupil-${key}" rx="7" ry="18" fill="#100a0e"/>
            <path d="M-32-32H32V-12C14-19-14-19-32-12Z" fill="#100a0e" opacity=".3"/>
            <g data-cat="shine-${key}" fill="#fff"><path d="M-12-9C-12-15-8-19-3-19 1-19 3-16 3-12 3-7-1-4-5-4-9-4-12-6-12-9Z" opacity=".96"/><path d="M6 10C6 8 8 6 10 6 12 6 14 8 14 10 14 12 12 13 10 13 8 13 6 12 6 10Z" opacity=".65"/></g>
        </g>
        <path class="cat-eye__lower" data-cat="lower-${key}" d="${lower}" fill="none" stroke-width="2.4" stroke-linecap="round"${flip}/>
        <path class="cat-eye__lash" data-cat="lash-${key}" d="${lash}" fill="none" stroke-width="5" stroke-linecap="round"${flip}/>
    </g>`;
};

const WHISKERS = '<path d="M50 37C80 29 108 26 138 27M52 44C82 42 112 45 138 51M50 51C78 55 104 63 126 76"/>';

const head = id => `<g data-cat="head" transform="translate(${HEAD.x} ${HEAD.y})"><g data-cat="purr">
    ${ear(id, -1)}${ear(id, 1)}
    <path d="${HEAD_PATH}" fill="url(#${id}fur)"/>
    <path d="${HEAD_PATH}" fill="url(#${id}sheen)"/>
    <path d="${FORELOCK}" class="cat-forelock"/>
    <path d="${HEAD_PATH}" fill="none" stroke="url(#${id}rim)" stroke-width="2.6"/>
    <path d="M22-71C62-62 88-38 94-4 96 6 99 16 108 25" class="cat-lit" fill="none" stroke="url(#${id}glow)" stroke-width="3.2" stroke-linecap="round"/>
    <g class="cat-face" data-cat="face">
        <g class="cat-stripes" fill="none" stroke-linecap="round"><path d="M0-60V-36M-20-58C-19-48-17-42-14-36M20-58C19-48 17-42 14-36" stroke-width="6"/>${mirror('<path d="M87 2C79 2 73 4 67 7M87 18C80 17 75 19 70 22" stroke-width="5"/>')}</g>
        <g class="cat-brows" fill="none" stroke-linecap="round" stroke-width="1.8">${mirror('<path d="M46-28C50-42 56-50 66-56M55-25C62-36 70-42 80-44"/>')}</g>
        <g class="cat-muzzle">${mirror('<path d="M0 40C10 31 34 32 38 46 40 58 24 64 12 60 6 58 0 52 0 46Z"/>')}<path d="M-13 59C-8 64 8 64 13 59 12 72-12 72-13 59Z"/></g>
        ${mirror(`<ellipse class="cat-blush" cx="58" cy="33" rx="27" ry="19" fill="url(#${id}blush)"/>`)}
        <g class="cat-eyes">${eye(id, -1)}${eye(id, 1)}</g>
        <g class="cat-nose"><path d="M0 42C-6 37-12 34-11 28-10 24-3 24 0 29 3 24 10 24 11 28 12 34 6 37 0 42Z"/><path d="M-7 28.5C-5 27-3 27.5-2 29" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.8" stroke-linecap="round"/></g>
        <path class="cat-mouth" data-cat="mouth" d="${mouthPath()}" fill="none" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>
        <g class="cat-dots">${mirror('<path d="M20 45a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M27 49a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M28 42a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0"/>')}</g>
        <g class="cat-whiskers" fill="none" stroke="url(#${id}whisker)" stroke-linecap="round" stroke-width="2.8">
            <g data-cat="whisker-r">${WHISKERS}</g><g transform="scale(-1 1)"><g data-cat="whisker-l">${WHISKERS}</g></g>
        </g>
    </g>
</g></g>`;

const boxBack = id => `<g class="cat-box" data-cat="box-back">
    <path d="M204 258H436L454 268 440 300H200L186 268Z" fill="url(#${id}inside)"/>
    <path class="cat-tail-edge" data-cat="tail-box-edge" d="${boxTail()}" fill="none" stroke-linecap="round"/>
    <path data-cat="tail-box" d="${boxTail()}" fill="none" stroke="url(#${id}tail)" stroke-width="20" stroke-linecap="round"/>
</g>`;

/** The front of the box: flaps, tape, and a clapperboard and a paw stamped on the side. */
const boxFront = id => `<g class="cat-box" data-cat="box-front">
    <g data-cat="flap-l"><path d="M186 268L204 258 150 224 116 238Z" fill="url(#${id}flap)"/><path d="M186 268L116 238 119 245 189 276Z" class="cat-board-edge"/><path d="M186 268L116 238" class="cat-board-hi" fill="none" stroke-width="1.4"/></g>
    <g data-cat="flap-r"><path d="M454 268L436 258 490 224 524 238Z" fill="url(#${id}flap)"/><path d="M454 268L524 238 521 245 451 276Z" class="cat-board-edge"/><path d="M454 268L524 238" class="cat-board-hi" fill="none" stroke-width="1.4"/></g>
    <path d="M186 268H454L441 378H199Z" fill="url(#${id}board)"/>
    <path d="M186 268H454L450 302H190Z" fill="url(#${id}flap)"/>
    <path d="M190 302H450L449 309H191Z" class="cat-board-shade"/>
    <path d="M186 268H454" class="cat-board-hi" fill="none" stroke-width="2.4"/>
    <path d="M199 378L197 362H443L441 378Z" class="cat-board-shade"/>
    <path d="M306 268H334V320L327 316 320 320 313 316 306 320Z" class="cat-tape"/><path d="M306 268H311V318L306 320Z" class="cat-tape-hi"/>
    <g transform="translate(230 326) rotate(-2)" class="cat-stamp"><path d="M0 13H44V38C44 40 43 41 41 41H3C1 41 0 40 0 38Z"/><path d="M-1 9L40-2 42 6 1 17Z"/><path d="M5 8L13 6 9.5 13.5 1.5 15.5ZM19 4L27 2 23.5 9.5 15.5 11.7ZM33 .2L40-1.7 37 5.8 29.5 7.9Z" class="cat-stamp__gap"/></g>
    <g transform="translate(394 348) rotate(8)" class="cat-stamp"><path d="M0-2C8-2 15 6 14 12 13 18 6 17 0 15-6 17-13 18-14 12-15 6-8-2 0-2Z"/><ellipse cx="-15" cy="-5" rx="4.2" ry="5.8" transform="rotate(-28 -15 -5)"/><ellipse cx="15" cy="-5" rx="4.2" ry="5.8" transform="rotate(28 15 -5)"/><ellipse cx="-5.5" cy="-13" rx="4.3" ry="6.2" transform="rotate(-8 -5.5 -13)"/><ellipse cx="5.5" cy="-13" rx="4.3" ry="6.2" transform="rotate(8 5.5 -13)"/></g>
</g>`;

const paws = id => `<g class="cat-paws" data-cat="paws">${[['l', 262], ['r', 378]].map(([key, x]) => `<g transform="translate(${x} 266)"><g data-cat="paw-${key}">
    <path d="M-25 15C-30-10-17-21 0-21 17-21 30-10 25 15 20 27-20 27-25 15Z" fill="url(#${id}fur)"/>
    <path d="M-25 15C-30-10-17-21 0-21 17-21 30-10 25 15" fill="none" stroke="url(#${id}rim)" stroke-width="2.2"/>
    <path d="M-9 4C-10 10-10 15-9 21M9 4C10 10 10 15 9 21" fill="none" class="cat-crease" stroke-width="3" stroke-linecap="round"/>
</g></g>`).join('')}</g>`;

const MOTES = [[18, 62, 3], [27, 37, 2], [36, 23, 3], [44, 75, 2], [63, 29, 2], [67, 53, 3], [72, 40, 2], [32, 56, 2], [58, 16, 2]];

/**
 * The scene in layers, from the back: the room, dust in the projector's light, the
 * cat, the dark of the corners. Only the cat's layer is drawn anew as it moves.
 * @param {{compact?: boolean}} [options] - compact: a square crop around the head for the frame picker
 */
export function renderCat({ compact = false } = {}) {
    const id = `catden${++sequence}-`;
    const view = `viewBox="${compact ? '176 60 288 288' : '0 0 640 400'}" preserveAspectRatio="xMidYMid slice" aria-hidden="true"`;
    const motes = compact ? '' : `<div class="cat-motes">${MOTES.map(([left, top, size], index) => `<i style="left:${left}%;top:${top}%;width:${size}px;height:${size}px;--mote:${index}"></i>`).join('')}</div>`;
    return `<div class="cat-layers" data-cat="camera">
        <svg class="cat-room" ${view}>${room(id)}</svg>${motes}
        <svg class="cat-art" ${view}>${catDefs(id)}
            <circle data-cat="torch" r="150" fill="url(#${id}torch)" opacity="0"/>
            <ellipse data-cat="shadow" cx="320" cy="380" rx="176" ry="17" fill="url(#${id}shadow)"/>
            <ellipse data-cat="box-shadow" cx="320" cy="381" rx="196" ry="18" fill="url(#${id}shadow)"/>
            ${boxBack(id)}
            <g data-cat="cut" data-clip="url(#${id}cut)"><g data-cat="figure">${torso(id)}${head(id)}</g></g>
            ${boxFront(id)}${paws(id)}
            <circle data-cat="bloom" cx="320" cy="200" r="210" fill="url(#${id}bloom)" opacity="0"/>
        </svg>
        <div class="cat-vignette"></div>
    </div>`;
}

const toe = (x, y, turn) => `<ellipse rx="2.3" ry="3.1" transform="translate(${x} ${y}) rotate(${turn})"/>`;
const PAW = toe(4.2, 11, -28) + toe(9, 5.6, -9) + toe(15, 5.6, 9) + toe(19.8, 11, 28)
    + '<path d="M12 11.5C15.5 11.5 18.5 15 18.5 18 18.5 20.5 16.5 21.5 14.5 21 13 20.6 11 20.6 9.5 21 7.5 21.5 5.5 20.5 5.5 18 5.5 15 8.5 11.5 12 11.5Z"/>';

/** Steps as paw prints; each is inked from the bottom up by `--ink` (0–1). */
export function renderPaws(total) {
    const print = cls => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${PAW}</svg>`;
    return Array.from({ length: total }, () => `<span class="cat-paw">${print('cat-paw__blank')}${print('cat-paw__ink')}</span>`).join('');
}
