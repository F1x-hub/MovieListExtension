'use strict';

/**
 * Drawings of the icon set on a 20px grid, shown at 20px, so one unit is one pixel.
 * Straight 2px lines are centred on whole units (edges on pixels). Rules:
 * docs/design-system.md, "Icons".
 */

const { num, point, fill, stroke, dot, box, half, rightHalf, solid } = require('./kit.cjs');

const icons = {};

const ray = (i, count, r) => {
    const a = -Math.PI / 2 + i * 2 * Math.PI / count;
    return [10 + r * Math.cos(a), r * Math.sin(a)];
};

// Simple shapes: the right half is solid.
icons.SEARCH = half(dot(9, 9, 6), 9) + stroke('M13.6 13.6L17.6 17.6', 2.2);

// A toggled icon has a second, fully solid drawing named *_FILLED.
{
    const bookmark = 'M5 5A2 2 0 0 1 7 3H13A2 2 0 0 1 15 5V17L10 13.6L5 17Z';
    icons.BOOKMARK = half(bookmark, 10);
    icons.BOOKMARK_FILLED = solid(bookmark);
}

icons.ADMIN = half('M10 2.4C11.8 3.7 13.8 4.4 16 4.5V9.6C16 13.2 13.8 15.9 10 17.6C6.2 15.9 4 13.2 4 9.6V4.5C6.2 4.4 8.2 3.7 10 2.4Z', 10);

icons.GAMES = half(
    'M6.4 6H13.6C15.4 6 16.6 7 16.9 8.8L17.5 12.4C17.7 13.9 16.9 15 15.7 15C14.9 15 14.3 14.6 13.8 13.9L12.9 12.6H7.1'
        + 'L6.2 13.9C5.7 14.6 5.1 15 4.3 15C3.1 15 2.3 13.9 2.5 12.4L3.1 8.8C3.4 7 4.6 6 6.4 6Z',
    10,
    dot(13.6, 9.5, 1.4)
) + fill('M5 9H6V8H8V9H9V10.6H8V11.6H6V10.6H5Z');

{
    const star = Array.from({ length: 10 }, (_, i) => {
        const [x, y] = ray(i, 10, i % 2 ? 4.4 : 8.4);
        return [x, y + 10.7];
    });
    const outline = `M${star.map(point).join('L')}Z`;
    icons.RATED = stroke(outline, 1.8) + fill(rightHalf(outline, 10));
}

// Compound shapes: one part of their own is solid.
icons.CALENDAR = fill('M5 3H15A3 3 0 0 1 18 6V8H2V6A3 3 0 0 1 5 3Z') + fill('M5 1H7V4H5ZM13 1H15V4H13Z')
    + stroke('M3 8V15A2 2 0 0 0 5 17H15A2 2 0 0 0 17 15V8') + fill(box(11, 11, 3, 3, 0.75));

icons.DOWNLOADS = stroke('M3 13V15A2 2 0 0 0 5 17H15A2 2 0 0 0 17 15V13')
    + fill('M9 2H11V7H13.6C14.4 7 14.8 7.9 14.2 8.5L10.7 12.2C10.3 12.6 9.7 12.6 9.3 12.2L5.8 8.5C5.2 7.9 5.6 7 6.4 7H9Z');

icons.DICE = stroke(box(3, 3, 14, 14, 3)) + fill(dot(7, 7, 1.6) + dot(10, 10, 1.6) + dot(13, 13, 1.6));

icons.LIVE = fill(dot(10, 10, 3)) + stroke('M4.2 4.6A8 8 0 0 0 4.2 15.4M15.8 4.6A8 8 0 0 1 15.8 15.4');

icons.USER = fill(dot(10, 6, 4))
    + stroke('M10 12C13.6 12 16 13.8 16.6 16.2C16.7 16.7 16.4 17 15.9 17H4.1C3.6 17 3.3 16.7 3.4 16.2C4 13.8 6.4 12 10 12Z');

{
    const teeth = 8;
    const pieces = teeth * 6;
    const step = 2 * Math.PI / pieces;
    const radius = a => 7.7 + 1.1 * Math.tanh(2.6 * (Math.cos(teeth * a) + 0.15)) / Math.tanh(2.6);
    const on = a => [10 + radius(a) * Math.sin(a), 10 - radius(a) * Math.cos(a)];
    const slope = a => [0, 1].map(i => (on(a + 1e-4)[i] - on(a - 1e-4)[i]) / 2e-4);
    let gear = `M${point(on(step / 2))}`;
    for (let k = 0; k < pieces; k++) {
        const a = step / 2 + k * step;
        const b = a + step;
        const [p, q, u, v] = [on(a), on(b), slope(a), slope(b)];
        gear += `C${num(p[0] + u[0] * step / 3)} ${num(p[1] + u[1] * step / 3)} ${num(q[0] - v[0] * step / 3)} ${num(q[1] - v[1] * step / 3)} ${point(q)}`;
    }
    icons.SETTINGS = fill(`${gear}Z${dot(10, 10, 3.2)}`);
}

icons.LOGIN = stroke('M12 3H14A3 3 0 0 1 17 6V14A3 3 0 0 1 14 17H12M3 10H11M7.6 6.4L11.2 10L7.6 13.6');

icons.LOGOUT = stroke('M8 3H6A3 3 0 0 0 3 6V14A3 3 0 0 0 6 17H8M9 10H17M13.6 6.4L17.2 10L13.6 13.6');

// A screen, half light and half dark: the theme follows the browser.
icons.SYSTEM = half(box(2, 3, 16, 11, 2.5), 10) + stroke('M7 17H13');

icons.MOON = fill('M17.9 12A8.1 8.1 0 1 1 8 2.1A6.4 6.4 0 0 0 17.9 12Z');

icons.SUN = fill(dot(10, 10, 3.8)) + stroke(Array.from({ length: 8 }, (_, i) => {
    const [from, to] = [ray(i, 8, 7.5), ray(i, 8, 8.4)];
    return `M${num(from[0])} ${num(from[1] + 10)}L${num(to[0])} ${num(to[1] + 10)}`;
}).join(''));

icons.PALETTE = stroke('M10 3C6 3 3 6 3 10C3 14 6 17 10 17C11.4 17 12.1 16.1 11.9 15C11.7 13.9 12.4 13.2 13.4 13.2H14.4C16 13.2 17 12.1 17 10.2C17 6 14 3 10 3Z')
    + fill(dot(7, 10.4, 1.5) + dot(9, 6.8, 1.5) + dot(13, 7.6, 1.5));

// Cinema and library.
{
    const heart = 'M10 16.6L4.2 10.8A3.9 3.9 0 0 1 9.7 5.3L10 5.6L10.3 5.3A3.9 3.9 0 0 1 15.8 10.8Z';
    icons.HEART = half(heart, 10);
    icons.HEART_FILLED = solid(heart);
}

{
    const eye = 'M2 10C3.8 6.6 6.6 5 10 5C13.4 5 16.2 6.6 18 10C16.2 13.4 13.4 15 10 15C6.6 15 3.8 13.4 2 10Z';
    icons.EYE = stroke(eye) + fill(dot(10, 10, 2.5));
    icons.EYE_FILLED = stroke(eye) + fill(eye + dot(10, 10, 2.4));
    // Closed, not crossed out: a bar over the eye merges with it at this size.
    icons.EYE_OFF = stroke('M2 8C4 11.6 6.8 13 10 13C13.2 13 16 11.6 18 8M10 13V16M5.2 11.8L3.6 14.4M14.8 11.8L16.4 14.4');
}

icons.WATCHED = stroke(box(3, 3, 14, 14, 3)) + stroke('M6.6 10.2L9 12.6L13.4 7.6');
icons.WATCHED_FILLED = fill(box(2, 2, 16, 16, 4) + 'M5.2 10.2L6.6 8.8L9 11.2L12.6 6.9L14.1 8.3L9 14.1Z');

icons.FOLDER = fill('M2 9V6A2 2 0 0 1 4 4H7.6A2 2 0 0 1 9 4.6L10.4 6H16A2 2 0 0 1 18 8V9Z')
    + stroke('M3 9V14A2 2 0 0 0 5 16H15A2 2 0 0 0 17 14V9');

icons.DOCUMENT = stroke('M11 3H6A2 2 0 0 0 4 5V15A2 2 0 0 0 6 17H14A2 2 0 0 0 16 15V8')
    + fill('M11 2H11.2A2 2 0 0 1 12.6 2.6L16.4 6.4A2 2 0 0 1 17 7.8V8H12A1 1 0 0 1 11 7Z') + stroke('M8 12H12');

icons.FILM = fill(box(2, 3, 16, 14, 3) + box(7, 5, 6, 4, 0.5) + box(7, 11, 6, 4, 0.5)
    + [3.5, 14.5].flatMap(x => [5, 9, 13].map(y => box(x, y, 2, 2, 0.5))).join(''));

// The bar is one tilted strip in three pieces: stripes cut inside it vanish at 20px.
{
    const tilt = -13 * Math.PI / 180;
    const at = (x, y) => point([2.2 + x * Math.cos(tilt) - y * Math.sin(tilt), 7.4 + x * Math.sin(tilt) + y * Math.cos(tilt)]);
    const bar = `M${at(1, -4)}L${at(4.6, -4)}L${at(3, 0)}L${at(0, 0)}L${at(0, -3)}Q${at(0, -4)} ${at(1, -4)}Z`
        + `M${at(6.4, -4)}L${at(10, -4)}L${at(8.4, 0)}L${at(4.8, 0)}Z`
        + `M${at(11.8, -4)}L${at(15, -4)}Q${at(16, -4)} ${at(16, -3)}L${at(16, 0)}L${at(10.2, 0)}Z`;
    icons.MOVIE_CLAPPER = fill(bar) + stroke('M3 9H17V15A2 2 0 0 1 15 17H5A2 2 0 0 1 3 15Z');
}

icons.TV = stroke('M6.6 2L10 5L13.4 2') + stroke(box(3, 6, 14, 11, 2))
    + fill('M12 6H15A2 2 0 0 1 17 8V15A2 2 0 0 1 15 17H12Z' + dot(14.6, 9.4, 1) + dot(14.6, 12.8, 1));

icons.PLAY_BOX = stroke(box(3, 3, 14, 14, 3))
    + fill('M8 7.2C8 6.6 8.7 6.2 9.2 6.6L13 9.3C13.5 9.7 13.5 10.3 13 10.7L9.2 13.4C8.7 13.8 8 13.4 8 12.8Z');

icons.CLOCK = stroke(dot(10, 10, 7)) + stroke('M10 6V10L12.6 12');

icons.PICTURE = stroke(box(3, 3, 14, 14, 3))
    + fill('M3 14.6L7 10.4A1 1 0 0 1 8.4 10.4L10.6 12.6L12 11.2A1 1 0 0 1 13.4 11.2L17 14.8V15A2 2 0 0 1 15 17H5A2 2 0 0 1 3 15Z' + dot(13, 7, 1.5));

icons.CAMERA = stroke('M5 6H6.6L8 4H12L13.4 6H15A2 2 0 0 1 17 8V14A2 2 0 0 1 15 16H5A2 2 0 0 1 3 14V8A2 2 0 0 1 5 6Z') + fill(dot(10, 11, 2.6));

{
    const pin = 'M6 3H14L13 5V8.4L15 11V12H5V11L7 8.4V5Z';
    icons.PIN = stroke(pin) + stroke('M10 13V18');
    icons.PIN_FILLED = solid(pin) + stroke('M10 13V18');
}

icons.PEN = fill(box(6, 1, 8, 4, 1)) + stroke('M7 7H13L15 11L10 18L5 11Z') + stroke('M10 12V16') + fill(dot(10, 11, 1.5));

{
    const cup = 'M6 3H14V8A4 4 0 0 1 6 8Z';
    const handles = stroke('M6 5H2.6V5.6A3.6 3.6 0 0 0 6.2 9.2M14 5H17.4V5.6A3.6 3.6 0 0 1 13.8 9.2M10 12V16M6 17H14');
    icons.TROPHY = half(cup, 10) + handles;
    icons.TROPHY_FILLED = solid(cup) + handles;
}

icons.GENRE = fill('M4 3H16A1 1 0 0 1 17 4V10A7 7 0 0 1 3 10V4A1 1 0 0 1 4 3Z' + dot(7, 7.5, 1.5) + dot(13, 7.5, 1.5) + 'M6.4 11H13.6A3.6 3.6 0 0 1 6.4 11Z');

// Actions.
icons.EDIT = stroke('M4 16L4.8 12.2L12.6 4.4A1.7 1.7 0 0 1 15 4.4L15.6 5A1.7 1.7 0 0 1 15.6 7.4L7.8 15.2Z')
    + fill('M10.4 6.6L12.6 4.4A1.7 1.7 0 0 1 15 4.4L15.6 5A1.7 1.7 0 0 1 15.6 7.4L13.4 9.6Z');

icons.TRASH = fill('M7 4V3A1 1 0 0 1 8 2H12A1 1 0 0 1 13 3V4H16A1 1 0 0 1 17 5V6A1 1 0 0 1 16 7H4A1 1 0 0 1 3 6V5A1 1 0 0 1 4 4Z')
    + stroke('M5 8V15A2 2 0 0 0 7 17H13A2 2 0 0 0 15 15V8M10 10V13');

icons.SEND = stroke('M17 3L11.4 17L9 11L3 8.6Z') + fill('M17 3L11.4 17L9 11Z');

icons.LINK = stroke('M8.4 11.6L11.6 8.4M9.6 5.9L11.2 4.3A3.18 3.18 0 0 1 15.7 8.8L14.1 10.4M10.4 14.1L8.8 15.7A3.18 3.18 0 0 1 4.3 11.2L5.9 9.6');

icons.EXTERNAL = stroke('M8 5H6A2 2 0 0 0 4 7V14A2 2 0 0 0 6 16H13A2 2 0 0 0 15 14V12M9 11L14 6')
    + fill('M11.4 2H17A1 1 0 0 1 18 3V8.6A.6 .6 0 0 1 17 9L11 3A.6 .6 0 0 1 11.4 2Z');

icons.COPY = stroke('M6 13H5A2 2 0 0 1 3 11V5A2 2 0 0 1 5 3H11A2 2 0 0 1 13 5V6') + fill(box(8, 8, 10, 10, 2.5));

icons.PAPERCLIP = stroke('M14 7V13A4 4 0 0 1 6 13V6A2 2 0 0 1 10 6V12');

icons.FILTER = half('M3 4H17L12 10.4V16L8 14V10.4Z', 10);

icons.CROP = stroke('M6 2V12A2 2 0 0 0 8 14H18M2 6H12A2 2 0 0 1 14 8V18');

// The tray of DOWNLOADS with the arrow turned up.
icons.UPLOAD = stroke('M3 13V15A2 2 0 0 0 5 17H15A2 2 0 0 0 17 15V13')
    + fill('M9 13V8H6.4C5.6 8 5.2 7.1 5.8 6.5L9.3 2.8C9.7 2.4 10.3 2.4 10.7 2.8L14.2 6.5C14.8 7.1 14.4 8 13.6 8H11V13Z');

icons.TIMER = stroke(dot(10, 11, 6)) + stroke('M10 8V11M10 2V4M15.6 4.6L16.4 5.4') + fill(box(7, 1, 6, 2, 1));

icons.LOCK = fill(box(3, 8, 14, 10, 2.5) + box(9, 11, 2, 4, 1)) + stroke('M6 8V6A4 4 0 0 1 14 6V8');

icons.GLOBE = stroke(dot(10, 10, 7)) + stroke('M3 10H17', 1.8)
    + stroke('M10 3C7.6 5.2 7 7.4 7 10C7 12.6 7.6 14.8 10 17C12.4 14.8 13 12.6 13 10C13 7.4 12.4 5.2 10 3Z', 1.6);

icons.USERS = fill(dot(7.5, 6, 3.5))
    + stroke('M7.5 12C10.4 12 12.4 13.6 13 16C13.1 16.6 12.7 17 12.1 17H2.9C2.3 17 1.9 16.6 2 16C2.6 13.6 4.6 12 7.5 12Z')
    + stroke('M13.4 3.2A3 3 0 0 1 13.4 8.8M15.6 12.4C17.2 13.2 18 14.6 18.2 16.4');

icons.BOLT = solid('M11 2.6L4.4 11H9.4L8.6 17.4L15.6 8.6H10.2Z');

// Utility marks: plain lines of the outlines' weight.
Object.assign(icons, {
    CLOSE: stroke('M5 5L15 15M15 5L5 15'),
    CHECK: stroke('M4 10.6L8 14.6L16 5.4'),
    PLUS: stroke('M10 4V16M4 10H16'),
    MINUS: stroke('M4 10H16'),
    CHEVRON_UP: stroke('M5 12.5L10 7.5L15 12.5'),
    CHEVRON_DOWN: stroke('M5 7.5L10 12.5L15 7.5'),
    CHEVRON_LEFT: stroke('M12.5 5L7.5 10L12.5 15'),
    CHEVRON_RIGHT: stroke('M7.5 5L12.5 10L7.5 15'),
    ARROW_UP: stroke('M10 16V4M5 9L10 4L15 9'),
    ARROW_DOWN: stroke('M10 4V16M5 11L10 16L15 11'),
    ARROW_LEFT: stroke('M16 10H4M9 5L4 10L9 15'),
    ARROW_RIGHT: stroke('M4 10H16M11 5L16 10L11 15'),
    MENU: stroke('M3 5H17M3 10H17M3 15H17'),
    MORE_VERTICAL: fill(dot(10, 4, 1.6) + dot(10, 10, 1.6) + dot(10, 16, 1.6)),
    MORE: fill(dot(4, 10, 1.6) + dot(10, 10, 1.6) + dot(16, 10, 1.6)),
    LIST: fill(dot(4, 5, 1.5) + dot(4, 10, 1.5) + dot(4, 15, 1.5)) + stroke('M9 5H17M9 10H17M9 15H17'),
    LIST_NUMBERED: stroke('M3 4L4.4 3V8M3 12.6A1.4 1.4 0 0 1 5.6 13.4C5.6 14.4 3 15.4 3 17H6', 1.8) + stroke('M10 5H17M10 15H17'),
    // REFRESH loads again, RESET goes back or turns.
    REFRESH: stroke('M3 9A7 7 0 0 1 15.6 5.6L17 7M17 3V7H13M17 11A7 7 0 0 1 4.4 14.4L3 13M3 17V13H7'),
    RESET: stroke('M3.2 11.6A7 7 0 1 0 5 5.1L3 7M3 3V7H7'),
    SHUFFLE: stroke('M3 5H5.2C9.6 5 10.4 15 14.8 15H17M3 15H5.2C6.6 15 7.6 14 8.4 12.6M11.6 7.4C12.4 6 13.4 5 14.8 5H17M14.4 2.4L17 5L14.4 7.6M14.4 12.4L17 15L14.4 17.6'),
    LOADING: stroke('M10 3A7 7 0 1 1 3 10'),
    ZOOM_IN: stroke(dot(9, 9, 6)) + stroke('M13.6 13.6L17.6 17.6', 2.2) + stroke('M9 6.8V11.2M6.8 9H11.2', 1.8),
    ZOOM_OUT: stroke(dot(9, 9, 6)) + stroke('M13.6 13.6L17.6 17.6', 2.2) + stroke('M6.8 9H11.2', 1.8)
});

// States.
const TRI = 'M10 3.2L17.4 16H2.6Z';
icons.WARNING = stroke(TRI) + fill(TRI + box(9, 7, 2, 4.6, 1) + dot(10, 13.6, 1.15));
icons.INFO = stroke(box(3, 3, 14, 14, 3)) + stroke('M10 10V13.4') + fill(dot(10, 6.8, 1.3));
icons.SHIELD_ALERT = stroke('M10 2.4C11.8 3.7 13.8 4.4 16 4.5V9.6C16 13.2 13.8 15.9 10 17.6C6.2 15.9 4 13.2 4 9.6V4.5C6.2 4.4 8.2 3.7 10 2.4Z') + stroke('M10 6.6V9.6') + fill(dot(10, 12.8, 1.25));
icons.QUESTION = stroke(box(3, 3, 14, 14, 3)) + stroke('M7.8 7.9A2.2 2.2 0 1 1 10.9 9.9C10.3 10.2 10 10.5 10 11.2', 1.8) + fill(dot(10, 13.8, 1.2));
icons.SAD = stroke(box(3, 3, 14, 14, 5)) + fill(dot(7.4, 8.2, 1.3) + dot(12.6, 8.2, 1.3)) + stroke('M7 13.6A3.6 3.6 0 0 1 13 13.6', 1.8);
icons.PLUG = stroke('M7 2.6V6M13 2.6V6M10 14V17.4') + fill('M4 6H16A1 1 0 0 1 17 7V8A7 7 0 0 1 3 8V7A1 1 0 0 1 4 6Z');
icons.DOWNLOADING = stroke(box(3, 3, 14, 14, 3)) + stroke('M10 6.6V13M7.2 10.2L10 13L12.8 10.2');
icons.PAUSED = stroke(box(3, 3, 14, 14, 3)) + fill(box(7, 7, 2, 6, .6) + box(11, 7, 2, 6, .6));

// Player, statistics and settings.
// rounded play triangle: left edge x, width w, height 2h around y=10
const triangle = (x, w, h) => { const r = 1.3, t = 10 - h, b = 10 + h, e = x + w; return `M${x} ${t + r}C${x} ${t + .3} ${x + .9} ${t - .3} ${x + 1.7} ${t + .3}L${e - .8} ${10 - 1.1}C${e} ${10 - .5} ${e} ${10 + .5} ${e - .8} ${10 + 1.1}L${x + 1.7} ${b - .3}C${x + .9} ${b + .3} ${x} ${b - .3} ${x} ${b - r}Z`.replace(/\d+\.\d{3,}/g, n => String(+(+n).toFixed(2))); };
icons.PLAY = fill(triangle(5, 12, 7.4));
icons.PAUSE = fill(box(4, 3, 4, 14, 1.2) + box(12, 3, 4, 14, 1.2));
icons.STOP = fill(box(4, 4, 12, 12, 2.5));
icons.SKIP = fill(triangle(3, 10, 7) + box(14, 3, 2, 14, .8));
icons.FAST_FORWARD = fill(triangle(2, 8, 5.6) + triangle(10, 8, 5.6));
const SP = 'M2 8A1 1 0 0 1 3 7H5.4L9.3 3.4A1 1 0 0 1 11 4.1V15.9A1 1 0 0 1 9.3 16.6L5.4 13H3A1 1 0 0 1 2 12Z';
icons.VOLUME_HIGH = fill(SP) + stroke('M13.6 7.4A3.8 3.8 0 0 1 13.6 12.6M15.8 4.6A7.6 7.6 0 0 1 15.8 15.4');
icons.VOLUME_LOW = fill(SP) + stroke('M13.6 7.4A3.8 3.8 0 0 1 13.6 12.6');
icons.VOLUME_MUTE = fill(SP) + stroke('M13.6 7.8L18 12.2M18 7.8L13.6 12.2');
icons.SUBTITLES = stroke(box(3, 4, 14, 12, 2.5)) + stroke('M6 8H7M10 8H14M6 12H10M13 12H14');
icons.PIP = stroke('M8 16H5A2 2 0 0 1 3 14V6A2 2 0 0 1 5 4H15A2 2 0 0 1 17 6V8') + fill(box(10, 10, 8, 7, 2));
icons.PIP_EXIT = stroke(box(3, 4, 14, 12, 2.5)) + fill(box(6, 7, 8, 6, 1));
icons.FULLSCREEN = stroke('M3 7V5A2 2 0 0 1 5 3H7M13 3H15A2 2 0 0 1 17 5V7M17 13V15A2 2 0 0 1 15 17H13M7 17H5A2 2 0 0 1 3 15V13');
icons.FULLSCREEN_EXIT = stroke('M7 3V5A2 2 0 0 1 5 7H3M13 3V5A2 2 0 0 0 15 7H17M17 13H15A2 2 0 0 0 13 15V17M7 17V15A2 2 0 0 0 5 13H3');
icons.CHART_BARS = fill(box(3, 10, 4, 7, 1) + box(8, 3, 4, 14, 1) + box(13, 7, 4, 10, 1));
icons.CHART_LINE = stroke('M3 3V15A2 2 0 0 0 5 17H17M7 12.4L10 8.6L12.6 11L17 5.6');
icons.KEY = stroke(dot(6.6, 13.4, 3.4)) + stroke('M9 11L16.6 3.4M13 7L15.8 9.8');
icons.SMILE = stroke(box(3, 3, 14, 14, 5)) + fill(dot(7.4, 8, 1.3) + dot(12.6, 8, 1.3) + 'M6.4 11H13.6A3.6 3.6 0 0 1 6.4 11Z');
icons.FIRE = half('M10.4 2.6C10.8 5.8 15.8 7.4 15.8 12A5.8 5.6 0 0 1 4.2 12C4.2 10 5.2 8.6 6.4 7.6C6.8 8.8 7.4 9.4 8.2 9.6C9.2 7.6 8.8 4.8 10.4 2.6Z', 10);
icons.HEADPHONES = stroke('M3 13V10A7 7 0 0 1 17 10V13') + fill(box(2, 11, 4, 6, 1.5) + box(14, 11, 4, 6, 1.5));
icons.SLIDERS = stroke('M2 6H4M10 6H18M2 14H10M16 14H18') + stroke(dot(7, 6, 2)) + fill(dot(13, 14, 3));
icons.UPDATE = stroke(box(3, 3, 14, 14, 3)) + stroke('M10 13.4V7M7.2 9.8L10 7L12.8 9.8');

// Games, awards and collections.
icons.SNAKE = stroke('M3 17H11.4A3.4 3.4 0 0 0 11.4 10.2H8A3.1 3.1 0 0 1 8 4H12') + fill(box(11, 2, 7, 4, 2) + dot(15.4, 4, .8));
icons.BLOCKS = fill(box(3, 5, 4, 4, .8) + box(8, 5, 4, 4, .8) + box(13, 5, 4, 4, .8) + box(8, 10, 4, 4, .8));
icons.GAME_2048 = stroke(box(3, 3, 14, 14, 3)) + stroke('M7.6 8A2.4 2.4 0 1 1 11.8 9.6L7.6 13.4H12.6');
icons.WORDS = fill(box(2, 2, 16, 16, 4) + 'M10 4.8L14.6 15H12.3L11.4 12.9H8.6L7.7 15H5.4ZM9.4 11H10.6L10 9.5Z');
icons.RUBIK = stroke('M10 2.6L17 6.4V13.8L10 17.6L3 13.8V6.4ZM3 6.4L10 10.2L17 6.4M10 10.2V17.6') + fill('M10 10.2L17 6.4V13.8L10 17.6Z');
icons.SHIP = fill('M2.6 12H17.4A.8 .8 0 0 1 18.1 13.1L16.4 16.4A3 3 0 0 1 13.8 18H6.2A3 3 0 0 1 3.6 16.4L1.9 13.1A.8 .8 0 0 1 2.6 12Z') + stroke('M5 11V9H14V11M9 9V3H13');
icons.KNIGHT = fill('M6 15C6 12.4 7.4 11 8.8 9.8L6.6 10.8A1 1 0 0 1 5.6 10.7L4.2 9.7A1 1 0 0 1 3.9 8.4L6.2 4.6L7.8 4V2.4A.6 .6 0 0 1 8.7 1.9L10.8 3.4C14.2 4 16 7.4 15.6 11.4C15.5 12.8 15 14 14.4 15Z' + dot(8.6, 6.6, .9)) + fill(box(4, 16, 12, 2, 1));
icons.CANNON = fill('M6 8.2L12.6 2.7A1 1 0 0 1 14 2.9L16.7 6.1A1 1 0 0 1 16.5 7.5L11 12.1A5 5 0 0 0 6 8.2Z') + stroke(dot(6, 14, 3)) + stroke('M11 17H17');
icons.ANCHOR = stroke(dot(10, 4, 2)) + stroke('M10 6V17M7 9H13M3 11.4A7 6 0 0 0 17 11.4');
icons.TARGET = stroke(dot(10, 10, 7)) + fill(dot(10, 10, 3));
icons.FLAG = stroke('M5 3V17') + fill('M5 2H15.2A.8 .8 0 0 1 15.9 3.3L13.8 6.6L15.9 9.9A.8 .8 0 0 1 15.2 11.2H5Z');
icons.ROBOT = stroke(box(3, 7, 14, 10, 3)) + stroke('M10 7V4') + fill(dot(10, 2.8, 1.6) + dot(7.2, 11.2, 1.3) + dot(12.8, 11.2, 1.3)) + stroke('M8.4 14.2H11.6', 1.6);
icons.WHEEL = stroke(dot(10, 11, 6)) + stroke('M10 5V17M4 11H16', 1.6) + fill(dot(10, 11, 2) + 'M7.4 1H12.6A.6 .6 0 0 1 13.1 1.9L10.5 5.6A.6 .6 0 0 1 9.5 5.6L6.9 1.9A.6 .6 0 0 1 7.4 1Z');
icons.GRID = stroke(box(3, 3, 5, 5, 1)) + stroke(box(12, 3, 5, 5, 1)) + stroke(box(3, 12, 5, 5, 1)) + fill(box(11, 11, 7, 7, 2));
icons.BOARD = stroke(box(3, 3, 14, 14, 2)) + fill('M10 3H15A2 2 0 0 1 17 5V10H10ZM3 10H10V17H5A2 2 0 0 1 3 15Z');
const starPts = (cx, cy, a, b) => 'M' + Array.from({ length: 10 }, (_, i) => { const t = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? b : a; return num(cx + r * Math.cos(t)) + ' ' + num(cy + r * Math.sin(t)); }).join('L') + 'Z';
icons.STATUETTE = `<path fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" d="${starPts(10, 6.4, 5, 2.5)}"/>` + fill('M9 10H11V13H13A1 1 0 0 1 14 14V15H6V14A1 1 0 0 1 7 13H9Z' + box(4, 16, 12, 2, 1));
icons.AWARD_GLOBE = half(dot(10, 7, 5), 10) + fill('M8.4 13H11.6L12.6 15H7.4Z' + box(5, 16, 10, 2, 1));
icons.AWARD_MASK = half('M4 4H16V9.4A6 6.6 0 0 1 4 9.4Z', 10, box(11.4, 7, 3, 2, 1)) + fill(box(5.6, 7, 3, 2, 1));
const leaf = (x, y, deg, a = 2.3, b = 1.25) => { const t = deg * Math.PI / 180, c = Math.cos(t) * a, s = Math.sin(t) * a; return `M${num(x - c)} ${num(y - s)}A${a} ${b} ${deg} 1 1 ${num(x + c)} ${num(y + s)}A${a} ${b} ${deg} 1 1 ${num(x - c)} ${num(y - s)}Z`; };
const LV = [-62, -28, 6, 40, 70].map(a => { const t = a * Math.PI / 180; return [10 + 6.9 * Math.cos(t), 10.4 + 6.9 * Math.sin(t), a + 90 + 24]; });
icons.LAUREL = fill(LV.map(([x, y, d]) => leaf(x, y, d, 2.3, 1.2) + leaf(20 - x, y, 180 - d, 2.3, 1.2)).join('')) + fill(starPts(10, 10, 3.6, 1.7));
icons.NOTE = stroke('M8 15V5L16 3.4V13') + fill(dot(6, 15, 3) + dot(14, 13, 3));
icons.MUSIC_CARD = stroke(box(3, 3, 14, 14, 3)) + stroke('M10.4 12.6V6.4H13') + fill(dot(8.8, 12.8, 2.1));
icons.MESSAGE = stroke('M5 3H15A2 2 0 0 1 17 5V11A2 2 0 0 1 15 13H9.4L5.4 16.6V13H5A2 2 0 0 1 3 11V5A2 2 0 0 1 5 3Z') + fill(dot(6.8, 8, 1.2) + dot(10, 8, 1.2) + dot(13.2, 8, 1.2));
icons.BUILDING = fill(box(2, 2, 10, 16, 2) + box(5, 5, 2, 2, .4) + box(8, 5, 2, 2, .4) + box(5, 9, 2, 2, .4) + box(8, 9, 2, 2, .4) + box(6, 14, 2, 4, 0)) + stroke('M13 8H15A2 2 0 0 1 17 10V17H13');
icons.VIDEO_CAMERA = stroke(box(3, 5, 9, 10, 2)) + fill('M13 9L17 6.3A.7 .7 0 0 1 18 6.9V13.1A.7 .7 0 0 1 17 13.7L13 11Z');

module.exports = icons;
