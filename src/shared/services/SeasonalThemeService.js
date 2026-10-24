/**
 * SeasonalThemeService
 *
 * Owns seasonal decoration: which holiday window is active, the user's
 * opt-out, the `season-*` class on <html>, and the decorative overlay layer.
 * Dark/light theme state stays with ThemeService; seasonal decor only adds a
 * bounded layer on top of whichever neutral theme is active.
 */
(function (global) {
    'use strict';

    const STORAGE_KEY = 'seasonalDecorEnabled';
    const MIRROR_KEY = 'movieExtensionSeasonalDecor';
    const BATS_SHOWN_KEY = 'movieExtensionSeasonBatsAt';
    const BATS_COOLDOWN_MS = 3 * 60 * 1000;
    const DECOR_ID = 'seasonalDecor';
    const SCROLLED_OFFSET = 24;
    // Garland hang points (% of viewport width) for the pumpkin lanterns.
    const GARLAND_POINTS = Object.freeze([6, 20, 34, 50, 66, 80, 94]);

    // Inclusive local-time windows; months are 1-based.
    const SEASONS = Object.freeze([
        Object.freeze({
            id: 'halloween',
            start: Object.freeze({ month: 10, day: 17 }),
            peak: Object.freeze({ month: 10, day: 31 }),
            end: Object.freeze({ month: 11, day: 7 }),
            // Home banner destination; each season owns its own catalog link.
            ctaHref: '../catalog/catalog.html?category=films&genre=27'
        })
    ]);

    const SEASON_CLASSES = SEASONS.map(season => `season-${season.id}`);
    const DAY_MS = 24 * 60 * 60 * 1000;

    const LOGO_CLAPPER_PATH = 'M11 0H189A11 11 0 0 1 200 11V31A11 11 0 0 1 189 42H11A11 11 0 0 1 0 31V11A11 11 0 0 1 11 0ZM22 34L36 8L56 8L42 34ZM66 34L80 8L100 8L86 34ZM110 34L124 8L144 8L130 34ZM154 34L168 8L188 8L174 34Z';
    // Clapperboard body with a carved jack-o'-lantern face (eyes + grin).
    const LOGO_PUMPKIN_BODY_PATH = 'M46 120H210A18 18 0 0 1 228 138V218A18 18 0 0 1 210 236H46A18 18 0 0 1 28 218V138A18 18 0 0 1 46 120Z'
        + 'M60 180L82 144L104 180Z'
        + 'M152 180L174 144L196 180Z'
        + 'M58 194L88 200L96 212L106 202L150 202L160 212L168 200L198 194Q186 226 128 226Q70 226 58 194Z';

    const BAT_PATH = 'M32 13L29.6 7.5L28.6 11.2C25 6.5 15 3.5 4 7C9.5 8.5 12 12 12.5 16C15.5 13.8 19.5 14.2 21.5 17.5C23.5 15.5 27 15.8 28.5 19L32 24L35.5 19C37 15.8 40.5 15.5 42.5 17.5C44.5 14.2 48.5 13.8 51.5 16C52 12 54.5 8.5 60 7C49 3.5 39 6.5 35.4 11.2L34.4 7.5Z';

    // Haunted hill: moon, graves, a dead tree and a house with lit windows.
    // The house is one body, a roof and a chimney seated on the right slope.
    const SCENE_BODY = '<circle class="season-scene__halo" cx="378" cy="38" r="34"/>'
        + '<circle class="season-scene__moon" cx="378" cy="38" r="15"/>'
        + '<path class="season-scene__ground" d="M0 220V178Q80 150 170 158Q250 120 330 126Q390 132 420 128V220Z"/>'
        + '<g class="season-scene__ground">'
        + '<path d="M252 88H318V136H252Z"/>'
        + '<path d="M240 92L285 50L330 92Z"/>'
        + '<path d="M298 76V58H296V53H310V58H308V76Z"/>'
        + '<path d="M40 170V154A10 10 0 0 1 60 154V170Z"/><path d="M78 166V146A11 11 0 0 1 100 146V166Z"/>'
        + '<path d="M122 164V136H115V130H122V122H128V130H135V136H128V164Z"/>'
        + '</g>'
        + '<g class="season-scene__tree" fill="none" stroke-linecap="round">'
        + '<path stroke-width="6" d="M196 152L192 92"/>'
        + '<path stroke-width="3.5" d="M193 116L174 98L164 100M192 102L208 82L222 80M193 126L214 114"/>'
        + '<path stroke-width="2" d="M174 98L170 86M208 82L210 70M214 114L226 118"/>'
        + '</g>'
        + '<g class="season-scene__window">'
        + '<rect x="262" y="98" width="12" height="13" rx="1.5"/><rect x="296" y="98" width="12" height="13" rx="1.5"/>'
        + '<circle cx="285" cy="74" r="5"/><rect x="279" y="116" width="12" height="20" rx="1.5"/>'
        + '</g>';

    const PUMPKIN_ORNAMENT = '<path class="season-ornament__stem" d="M15 3h3l-.5 5h-2.5z"/>'
        + '<ellipse class="season-ornament__rib" cx="10" cy="18" rx="7" ry="10"/>'
        + '<ellipse class="season-ornament__rib" cx="22" cy="18" rx="7" ry="10"/>'
        + '<ellipse class="season-ornament__body" cx="16" cy="18" rx="8" ry="10.5"/>'
        + '<path class="season-ornament__carve" d="M9 16l3-4 3 4zM17 16l3-4 3 4zM9 21q7 6 14 0l-2.5 1-1.5 2-2-2h-2l-2 2-1.5-2z"/>';

    const listeners = new Set();
    let enabledOverride = null;
    let scrollBound = false;
    let scrollFrame = 0;
    let externalListenersBound = false;
    let domReadyBound = false;

    function getLocalStorage() {
        try {
            return global.localStorage || null;
        } catch {
            return null;
        }
    }

    function getRoot() {
        return typeof document !== 'undefined' ? document.documentElement : null;
    }

    function getChromeStorage() {
        return typeof chrome !== 'undefined' && chrome.storage?.local ? chrome.storage.local : null;
    }

    function toLocalDate(year, { month, day }) {
        return new Date(year, month - 1, day);
    }

    function startOfDay(date) {
        return new Date(date.getFullYear(), date.getMonth(), date.getDate());
    }

    /**
     * @param {Date} [date]
     * @returns {{id: string, year: number, start: Date, peak: Date, end: Date}|null}
     */
    function getActiveSeason(date = new Date()) {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
        const today = startOfDay(date);
        const year = today.getFullYear();

        for (const season of SEASONS) {
            const start = toLocalDate(year, season.start);
            const end = toLocalDate(year, season.end);
            if (today >= start && today <= end) {
                return {
                    id: season.id,
                    year,
                    start,
                    peak: toLocalDate(year, season.peak),
                    end,
                    ctaHref: season.ctaHref || ''
                };
            }
        }
        return null;
    }

    /**
     * Whole local days from `date` to the season's peak; negative after it.
     */
    function getDaysUntilPeak(season, date = new Date()) {
        if (!season?.peak) return null;
        return Math.round((season.peak - startOfDay(date)) / DAY_MS);
    }

    function isEnabled() {
        if (typeof enabledOverride === 'boolean') return enabledOverride;
        const storage = getLocalStorage();
        try {
            return storage?.getItem(MIRROR_KEY) !== '0';
        } catch {
            return true;
        }
    }

    function writeMirror(enabled) {
        const storage = getLocalStorage();
        try {
            storage?.setItem(MIRROR_KEY, enabled ? '1' : '0');
        } catch (error) {
            console.warn('SeasonalThemeService: could not persist preference', error);
        }
    }

    function getActiveDecor(date = new Date()) {
        return isEnabled() ? getActiveSeason(date) : null;
    }

    function svg(viewBox, className, body) {
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" class="${className}" aria-hidden="true" focusable="false">${body}</svg>`;
    }

    /**
     * Seasonal logo mark. It is always rendered next to the regular logo and
     * becomes visible only under an active `season-*` class.
     */
    function getLogoMarkup(className = '') {
        return svg('0 0 256 256', `season-logo ${className}`.trim(),
            '<rect class="season-logo__ember" x="54" y="140" width="148" height="90" rx="12"/>'
            + `<g class="season-logo__ink"><g transform="translate(28 112) rotate(-14) translate(0 -42)"><path fill-rule="evenodd" d="${LOGO_CLAPPER_PATH}"/></g>`
            + `<path fill-rule="evenodd" d="${LOGO_PUMPKIN_BODY_PATH}"/></g>`);
    }

    function getBatsMarkup() {
        const bat = index => `<span class="seasonal-decor__bat seasonal-decor__bat--${index}">`
            + svg('0 0 64 32', 'seasonal-decor__bat-wings', `<path fill="currentColor" d="${BAT_PATH}"/>`)
            + '</span>';
        return `<div class="seasonal-decor__bats">${[1, 2, 3].map(bat).join('')}</div>`;
    }

    function getSceneMarkup(className = '') {
        return svg('0 0 420 220', `season-scene ${className}`.trim(), SCENE_BODY);
    }

    // Gradient stops take their color from CSS classes, so markup stays token-only.
    function gradientStop(offset, name) {
        return `<stop offset="${offset}" class="season-stop season-stop--${name}"/>`;
    }

    const CROSS_PATH = 'M114 172V124H102V114H114V100H124V114H136V124H124V172Z';
    const HEADSTONE_PATH = 'M30 170V112Q30 92 54 92Q78 92 78 112V170Z';
    const SLANT_STONE_PATH = 'M168 170V134L182 125L196 134V170Z';
    const GHOST_PATH = 'M0 -32C-16 -32 -24 -19 -24 -3V24Q-20 31 -16 25Q-12 31 -8 25Q-4 31 0 25'
        + 'Q4 31 8 25Q12 31 16 25Q20 31 24 24V-3C24 -19 16 -32 0 -32Z';

    /** Graveyard corner: fence, headstones with depth, crow, candle, fog and a ghost. */
    function getGraveyardMarkup() {
        let fence = '';
        for (let x = 150; x <= 246; x += 12) {
            fence += `M${x} 156V122L${x + 1.6} 115L${x + 3.2} 122V156Z`;
        }
        // Tufts sit on the mound's top edge (y sampled from the ground curve).
        const grass = [[12, 164.7], [34, 158.4], [70, 154.6], [140, 158.7], [188, 159.5], [250, 158.7]]
            .map(([x, y]) => `M${x} ${y}q-2-6-5-9M${x} ${y}q0-7 1-11M${x} ${y}q2-5 5-8`)
            .join('');
        const defs = '<defs>'
            + `<linearGradient id="seasonGyStone" x1="0" y1="0" x2="1" y2="1">${gradientStop(0, 'stone-hi')}${gradientStop(1, 'stone-lo')}</linearGradient>`
            + `<linearGradient id="seasonGyGround" x1="0" y1="0" x2="0" y2="1">${gradientStop(0, 'ground-top')}${gradientStop(1, 'ground-bottom')}</linearGradient>`
            + `<linearGradient id="seasonGyGhost" x1="0" y1="0" x2="0" y2="1">${gradientStop(0, 'ghost-top')}${gradientStop(0.62, 'ghost-top')}${gradientStop(1, 'ghost-bottom')}</linearGradient>`
            + `<radialGradient id="seasonGyCandle">${gradientStop(0, 'glow-core')}${gradientStop(1, 'glow-edge')}</radialGradient>`
            + '<filter id="seasonGyBlur" x="-20%" y="-80%" width="140%" height="260%"><feGaussianBlur stdDeviation="5"/></filter>'
            + '</defs>';
        const back = `<g class="season-gy-fence"><path d="${fence}"/>`
            + '<rect x="148" y="128" width="104" height="2.4"/><rect x="148" y="146" width="104" height="2.4"/></g>'
            + '<path class="season-gy-far" transform="rotate(-6 64 152)" fill="url(#seasonGyStone)" d="M52 152V130Q52 118 64 118Q76 118 76 130V152Z"/>'
            + '<ellipse class="season-gy-fog" cx="130" cy="150" rx="140" ry="14" filter="url(#seasonGyBlur)"/>';
        const ground = '<path fill="url(#seasonGyGround)" d="M0 230V170Q40 150 100 156Q170 162 220 158Q262 155 284 172Q298 186 300 230Z"/>'
            + '<path class="season-gy-rim" d="M0 170Q40 150 100 156Q170 162 220 158Q262 155 284 172"/>'
            + `<path class="season-gy-grass" d="${grass}"/>`;
        const headstone = '<g transform="rotate(-4 54 170)">'
            + '<ellipse class="season-gy-shadow" cx="57" cy="170" rx="30" ry="4"/>'
            + `<path class="season-gy-side" transform="translate(4 -3)" d="${HEADSTONE_PATH}"/>`
            + `<path fill="url(#seasonGyStone)" d="${HEADSTONE_PATH}"/>`
            + '<path class="season-gy-edge" d="M33 112Q33 95 54 95"/>'
            + '<text class="season-gy-engrave" x="54" y="124" text-anchor="middle">RIP</text>'
            + '<path class="season-gy-groove" d="M42 134H66M45 141H63"/>'
            + '<path class="season-gy-crack" d="M71 100L66 109L69 114L65 122"/>'
            + '</g>';
        const crow = '<g class="season-gy-crow" transform="translate(118 89)">'
            + '<path class="season-gy-crow-legs" d="M-1 5V11M3 5V11"/>'
            + '<path d="M7 1L17 5L15 -1Z"/>'
            + '<ellipse cx="1" cy="0" rx="9" ry="6" transform="rotate(-18 1 0)"/>'
            + '<circle cx="-7" cy="-6" r="4.2"/>'
            + '<path d="M-11 -7.5L-17 -5.5L-11 -4.5Z"/>'
            + '<path class="season-gy-crow-wing" d="M-3 -2Q4 -4 10 2"/>'
            + '<circle class="season-gy-crow-eye" cx="-8" cy="-7" r="0.9"/>'
            + '</g>';
        const cross = '<g transform="rotate(6 119 172)">'
            + '<ellipse class="season-gy-shadow" cx="121" cy="172" rx="16" ry="3"/>'
            + `<path class="season-gy-side" transform="translate(3 -2)" d="${CROSS_PATH}"/>`
            + `<path fill="url(#seasonGyStone)" d="${CROSS_PATH}"/>`
            + '<path class="season-gy-edge" d="M115.5 102V113M103.5 115.5H113"/>'
            + crow
            + '</g>';
        const slant = '<g transform="rotate(-8 182 170)">'
            + '<ellipse class="season-gy-shadow" cx="183" cy="170" rx="18" ry="3"/>'
            + `<path class="season-gy-side" transform="translate(3 -2)" d="${SLANT_STONE_PATH}"/>`
            + `<path fill="url(#seasonGyStone)" d="${SLANT_STONE_PATH}"/>`
            + '<path class="season-gy-edge" d="M170 134L182 127"/>'
            + '<path class="season-gy-groove" d="M182 139V155M176 144H188"/>'
            + '</g>';
        const candle = '<g class="season-gy-candle">'
            + '<circle class="season-gy-candle-glow" cx="90" cy="150" r="28" fill="url(#seasonGyCandle)"/>'
            + '<rect class="season-gy-side" x="85" y="164" width="10" height="9" rx="1.5"/>'
            + '<rect class="season-gy-wax" x="87" y="152" width="6" height="13" rx="1"/>'
            + '<path class="season-gy-wick" d="M90 152V149"/>'
            + '<path class="season-gy-flame" d="M90 139C93 143 94 146 90 150C86 146 87 143 90 139Z"/>'
            + '</g>';
        const fog = '<g class="season-gy-fog-front" filter="url(#seasonGyBlur)">'
            + '<ellipse class="season-gy-fog" cx="80" cy="188" rx="90" ry="13"/>'
            + '<ellipse class="season-gy-fog" cx="200" cy="198" rx="80" ry="11"/></g>';
        const ghost = '<ellipse class="season-gy-shadow season-ghost__shadow" cx="214" cy="163" rx="12" ry="2"/>'
            + '<g class="season-ghost"><g transform="translate(214 62)">'
            + '<path class="season-ghost__body" fill="url(#seasonGyGhost)" d="M-23 0C-29 -2 -34 1 -34 7C-30 5 -26 6 -23 8ZM23 0C29 -2 34 1 34 7C30 5 26 6 23 8Z"/>'
            + `<path class="season-ghost__body" fill="url(#seasonGyGhost)" d="${GHOST_PATH}"/>`
            + '<ellipse class="season-ghost__eye" cx="-8" cy="-9" rx="3.6" ry="5"/>'
            + '<ellipse class="season-ghost__eye" cx="8" cy="-9" rx="3.6" ry="5"/>'
            + '<ellipse class="season-ghost__eye" cx="0" cy="5" rx="3.6" ry="4.6"/>'
            + '<ellipse class="season-ghost__shine" cx="-9.4" cy="-11" rx="1.1" ry="1.5"/>'
            + '<ellipse class="season-ghost__shine" cx="6.6" cy="-11" rx="1.1" ry="1.5"/>'
            + '</g></g>';
        return svg('0 0 300 230', 'seasonal-side seasonal-side__graves',
            defs + back + ground + headstone + cross + slant + candle + fog + ghost);
    }

    const PUMPKIN_FACES = Object.freeze({
        // Carve outline, then hanging teeth left in the flesh.
        classic: {
            carve: 'M-19 -7L-11 -21L-3 -7ZM3 -7L11 -21L19 -7ZM-3 0L0 -6L3 0ZM-24 6Q0 18 24 6Q0 40 -24 6Z',
            teeth: '<rect x="-9" y="10" width="5" height="5.5" rx="1.5"/><rect x="4" y="10" width="5" height="5.5" rx="1.5"/>'
        },
        spooky: {
            carve: 'M-20 -16L-4 -9L-10 -2ZM20 -16L4 -9L10 -2Z'
                + 'M-22 6L-15 12L-10 7L-5 13L0 8L5 13L10 7L15 12L22 6Q14 25 0 25Q-14 25 -22 6Z',
            teeth: ''
        }
    });

    function getPumpkinMarkup({ transform, face = null, leaf = false }) {
        const lobes = [[-22, 20, 33], [22, 20, 33], [-11, 20, 37], [11, 20, 37], [0, 17, 38]]
            .map(([cx, rx, ry]) => `<ellipse class="season-pk-lobe" cx="${cx}" cy="0" rx="${rx}" ry="${ry}" fill="url(#seasonPkBody)"/>`)
            .join('');
        const carved = face
            ? `<path class="season-pk-rim" transform="translate(1.4 1.8)" d="${PUMPKIN_FACES[face].carve}"/>`
                + `<g class="season-pk-face"><path fill="url(#seasonPkFace)" d="${PUMPKIN_FACES[face].carve}"/></g>`
                + `<g class="season-pk-tooth">${PUMPKIN_FACES[face].teeth}</g>`
            : '';
        return `<g transform="${transform}">`
            + '<ellipse class="season-gy-shadow" cx="2" cy="37" rx="40" ry="5"/>'
            + '<path fill="url(#seasonPkStem)" d="M-5 -34C-6 -42 -4 -50 2 -55L7 -52C3 -47 2 -41 4 -34Z"/>'
            + '<path class="season-pk-vine" d="M3 -48C10 -54 18 -50 16 -43C15 -38 9 -39 10 -43"/>'
            + (leaf ? '<path class="season-pk-leaf" d="M-3 -38C-14 -50 -28 -47 -33 -38C-23 -35 -12 -33 -3 -38Z"/>'
                + '<path class="season-pk-leaf-vein" d="M-4 -38C-14 -41 -23 -40 -31 -38"/>' : '')
            + lobes
            + '<path class="season-pk-shine" d="M-15 -26C-20 -19 -22 -9 -21 0"/>'
            + carved
            + '</g>';
    }

    /** Pumpkin patch corner: two lit jack-o'-lanterns, a plain pumpkin and leaves. */
    function getPumpkinPatchMarkup() {
        const leaf = (x, y, rotate, kind) => `<g transform="translate(${x} ${y}) rotate(${rotate})" class="season-pk-fallen season-pk-fallen--${kind}">`
            + '<path d="M0 0C3 -5 9 -7 15 -4C12 0 12 3 15 6C9 8 3 6 0 0Z"/><path class="season-pk-fallen-vein" d="M1 0L13 1"/></g>';
        const defs = '<defs>'
            + `<radialGradient id="seasonPkBody" cx="0.38" cy="0.32" r="0.75">${gradientStop(0, 'pk-hi')}${gradientStop(0.55, 'pk-mid')}${gradientStop(1, 'pk-lo')}</radialGradient>`
            + `<radialGradient id="seasonPkFace" cx="0.5" cy="0.45" r="0.6">${gradientStop(0, 'face-core')}${gradientStop(1, 'face-edge')}</radialGradient>`
            + `<linearGradient id="seasonPkStem" x1="0" y1="0" x2="1" y2="0">${gradientStop(0, 'stem-hi')}${gradientStop(1, 'stem-lo')}</linearGradient>`
            + `<radialGradient id="seasonPkPool">${gradientStop(0, 'pool-core')}${gradientStop(1, 'pool-edge')}</radialGradient>`
            + '</defs>';
        return svg('0 0 300 210', 'seasonal-side seasonal-side__pumpkins',
            defs
            + '<ellipse cx="150" cy="190" rx="150" ry="28" fill="url(#seasonPkPool)"/>'
            + getPumpkinMarkup({ transform: 'translate(214 156) rotate(8) scale(0.82)', face: 'spooky' })
            + getPumpkinMarkup({ transform: 'translate(112 136) scale(1.25)', face: 'classic', leaf: true })
            + getPumpkinMarkup({ transform: 'translate(270 178) rotate(-10) scale(0.5)', leaf: true })
            + leaf(30, 190, -25, 'a') + leaf(160, 192, 30, 'b') + leaf(236, 194, -50, 'a') + leaf(78, 196, 12, 'b'));
    }

    /**
     * Side art for the empty page margins on wide screens: a branch with a
     * sleeping bat and a graveyard ghost on the left, a dangling spider and
     * jack-o'-lanterns on the right. Some pages paint an opaque root, so it
     * lives in the decor layer and CSS keeps it inside the margins.
     */
    function getSideArtMarkup() {
        const leaf = (x, y, rotate, kind) => `<g transform="translate(${x} ${y}) rotate(${rotate})" class="season-pk-fallen season-pk-fallen--${kind}">`
            + '<path d="M0 0C3 -5 9 -7 15 -4C12 0 12 3 15 6C9 8 3 6 0 0Z"/><path class="season-pk-fallen-vein" d="M1 0L13 1"/></g>';
        const branch = svg('0 0 280 150', 'seasonal-side seasonal-side__branch',
            '<defs>'
            + `<linearGradient id="seasonBrBark" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="90">${gradientStop(0, 'stone-hi')}${gradientStop(1, 'stone-lo')}</linearGradient>`
            + `<radialGradient id="seasonBrBat" cx="0.35" cy="0.3" r="0.8">${gradientStop(0, 'bat-hi')}${gradientStop(1, 'bat-lo')}</radialGradient>`
            + '</defs>'
            + '<g class="season-br-limb" stroke="url(#seasonBrBark)">'
            + '<path stroke-width="11" d="M-6 44C40 40 80 46 120 42"/>'
            + '<path stroke-width="9" d="M100 43C116 42 132 41 150 38"/>'
            + '<path stroke-width="7" d="M118 42C160 38 200 30 228 20"/>'
            + '<path stroke-width="4" d="M226 21C244 15 258 12 274 6"/>'
            + '<path stroke-width="5" d="M88 44C104 58 122 68 146 74"/><path stroke-width="2.5" d="M144 74L162 86"/>'
            + '<path stroke-width="4" d="M150 40C160 28 172 20 186 16"/><path stroke-width="2" d="M184 16L198 8"/>'
            + '<path stroke-width="3" d="M50 42L40 24"/><path stroke-width="2" d="M40 24L44 12"/>'
            + '<path stroke-width="2.5" d="M210 26L234 34"/>'
            + '</g>'
            + '<path class="season-gy-edge" d="M0 39C40 35 80 41 118 37M121 37C160 33 196 26 224 16"/>'
            + '<ellipse class="season-gy-side" cx="70" cy="45" rx="4" ry="2.4"/>'
            + '<path class="season-gy-crack" d="M24 46L36 45M168 34L180 31"/>'
            + leaf(196, 8, 35, 'a') + leaf(234, 34, 70, 'b') + leaf(162, 86, 80, 'a')
            + '<g class="season-br-bat">'
            + '<path class="season-gy-crow-legs" d="M143 74V81M149 74V81"/>'
            + '<path fill="url(#seasonBrBat)" d="M146 80C154 80 158 92 156 104C154 114 150 118 146 120C142 118 138 114 136 104C134 92 138 80 146 80Z"/>'
            + '<path class="season-gy-crow-wing" d="M139 88C133 98 135 110 142 116M153 88C159 98 157 110 150 116"/>'
            + '<path fill="url(#seasonBrBat)" d="M140 125L138 134L144 127ZM152 125L154 134L148 127Z"/>'
            + '<circle cx="146" cy="122" r="6.5" fill="url(#seasonBrBat)"/>'
            + '<path class="season-gy-crow-wing" d="M142 121Q143.5 122.5 145 121M147 121Q148.5 122.5 150 121"/>'
            + '</g>');
        const legs = 'M20 18L10 10L6 2M19 21L7 18L2 12M19 24L7 28L3 36M20 27L12 34L11 44'
            + 'M28 18L38 10L42 2M29 21L41 18L46 12M29 24L41 28L45 36M28 27L36 34L37 44';
        const spider = '<div class="seasonal-side seasonal-side__spider">'
            + '<span class="seasonal-side__thread"></span>'
            + svg('0 0 48 48', 'seasonal-side__spider-body',
                '<defs>'
                + `<radialGradient id="seasonSpBody" cx="0.35" cy="0.3" r="0.8">${gradientStop(0, 'bat-hi')}${gradientStop(1, 'bat-lo')}</radialGradient>`
                + '</defs>'
                + `<path class="season-sp-legs" d="${legs}"/>`
                + '<ellipse cx="24" cy="20" rx="5" ry="4.5" fill="url(#seasonSpBody)"/>'
                + '<ellipse cx="24" cy="31" rx="8" ry="9" fill="url(#seasonSpBody)"/>'
                + '<path class="season-sp-mark" d="M21 27H27L24 31ZM21 35H27L24 31Z"/>'
                + '<ellipse class="season-sp-sheen" cx="20.5" cy="27" rx="1.8" ry="3"/>'
                + '<circle class="season-sp-eye" cx="22.2" cy="17.6" r="1"/><circle class="season-sp-eye" cx="25.8" cy="17.6" r="1"/>')
            + '</div>';
        return branch + getGraveyardMarkup() + spider + getPumpkinPatchMarkup();
    }

    function getGarlandMarkup() {
        let d = 'M0 0';
        GARLAND_POINTS.concat(100).forEach((point, index, points) => {
            const previous = index === 0 ? 0 : points[index - 1];
            d += `Q${((previous + point) / 2).toFixed(1)} 16 ${point} 2`;
        });
        const ornaments = GARLAND_POINTS.map((point, index) => {
            const drop = [8, 14, 10][index % 3];
            return `<span class="seasonal-decor__ornament" style="left:${point}%;--season-drop:${drop}px">`
                + '<span class="seasonal-decor__ornament-thread"></span>'
                + svg('0 0 32 32', 'season-ornament', PUMPKIN_ORNAMENT)
                + '</span>';
        }).join('');
        const string = svg('0 0 100 20', 'seasonal-decor__garland-string',
            `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`)
            .replace('<svg ', '<svg preserveAspectRatio="none" ');
        return `<div class="seasonal-decor__garland">${string}${ornaments}</div>`;
    }

    // Rare side-art scenes: one at a time, in rotation, only while visible.
    const SCENES = Object.freeze([
        { id: 'spider', duration: 7000 },
        { id: 'ghost', duration: 6000 },
        { id: 'pumpkins', duration: 4000 }
    ]);
    const SCENE_MIN_GAP_MS = 20000;
    const SCENE_GAP_SPREAD_MS = 15000;
    let sceneTimer = 0;
    let sceneIndex = 0;

    function prefersReducedMotion() {
        try {
            return global.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
        } catch {
            return false;
        }
    }

    function scheduleScene(delay = SCENE_MIN_GAP_MS + Math.random() * SCENE_GAP_SPREAD_MS) {
        clearTimeout(sceneTimer);
        sceneTimer = setTimeout(playScene, delay);
    }

    function playScene() {
        const layer = typeof document !== 'undefined' ? document.getElementById(DECOR_ID) : null;
        if (!layer || !layer.querySelector('.seasonal-side')) return;
        if (document.visibilityState !== 'visible' || prefersReducedMotion()) {
            scheduleScene();
            return;
        }
        const scene = SCENES[sceneIndex % SCENES.length];
        sceneIndex += 1;
        layer.classList.add(`is-scene-${scene.id}`);
        setTimeout(() => {
            layer.classList.remove(`is-scene-${scene.id}`);
            scheduleScene();
        }, scene.duration);
    }

    function updateScrolledState() {
        scrollFrame = 0;
        const layer = typeof document !== 'undefined' ? document.getElementById(DECOR_ID) : null;
        layer?.classList.toggle('is-scrolled', (global.scrollY || 0) > SCROLLED_OFFSET);
    }

    function bindScroll() {
        if (scrollBound || typeof global.addEventListener !== 'function') return;
        scrollBound = true;
        global.addEventListener('scroll', () => {
            if (!scrollFrame) scrollFrame = global.requestAnimationFrame?.(updateScrolledState) || 0;
        }, { passive: true });
    }

    function shouldFlyBats(now = Date.now()) {
        const storage = getLocalStorage();
        try {
            const last = Number(storage?.getItem(BATS_SHOWN_KEY)) || 0;
            if (now - last < BATS_COOLDOWN_MS) return false;
            storage?.setItem(BATS_SHOWN_KEY, String(now));
        } catch {
            // Without storage the flight simply runs on every load.
        }
        return true;
    }

    function syncDecorLayer(season) {
        if (typeof document === 'undefined' || !document.body) return;
        const existing = document.getElementById(DECOR_ID);

        if (!season) {
            existing?.remove();
            return;
        }
        if (existing?.dataset.season === season.id) return;
        existing?.remove();

        // The popup is a small surface: glow and logo only.
        const isPopup = document.body.classList.contains('popup-page');
        const layer = document.createElement('div');
        layer.id = DECOR_ID;
        layer.className = `seasonal-decor seasonal-decor--${season.id}`;
        layer.dataset.season = season.id;
        layer.setAttribute('aria-hidden', 'true');
        layer.innerHTML = isPopup
            ? ''
            : getSideArtMarkup() + getGarlandMarkup() + (shouldFlyBats() ? getBatsMarkup() : '');
        document.body.appendChild(layer);
        bindScroll();
        if (!isPopup) {
            // Entry animations run once; scenes must not replay them afterwards.
            setTimeout(() => layer.classList.add('is-ready'), 4000);
            scheduleScene();
        }
        updateScrolledState();
    }

    function mountDeclaredLogos() {
        if (typeof document === 'undefined') return;
        document.querySelectorAll('[data-seasonal-logo]').forEach(host => {
            if (host.querySelector('.season-logo')) return;
            host.insertAdjacentHTML('beforeend', getLogoMarkup(host.dataset.seasonalLogo || ''));
        });
        document.querySelectorAll('[data-seasonal-scene]').forEach(host => {
            if (host.querySelector('.season-scene')) return;
            host.insertAdjacentHTML('beforeend', getSceneMarkup(host.dataset.seasonalScene || ''));
        });
    }

    function notify(state) {
        listeners.forEach(listener => {
            try {
                listener(state);
            } catch (error) {
                console.warn('SeasonalThemeService: listener failed', error);
            }
        });
    }

    function apply(options = {}) {
        const date = options.date instanceof Date ? options.date : new Date();
        const season = getActiveDecor(date);
        const root = getRoot();

        if (root) {
            SEASON_CLASSES.forEach(name => root.classList.remove(name));
            if (season) {
                root.classList.add(`season-${season.id}`);
                root.dataset.season = season.id;
            } else {
                delete root.dataset.season;
            }
        }

        if (typeof document !== 'undefined' && document.body) {
            syncDecorLayer(season);
            mountDeclaredLogos();
        }

        const state = { season, enabled: isEnabled() };
        notify(state);
        return state;
    }

    /**
     * Persists the opt-out. chrome.storage.local is authoritative; the
     * localStorage mirror lets the next page apply the class before paint.
     */
    function setEnabled(enabled) {
        const value = enabled !== false;
        enabledOverride = null;
        writeMirror(value);
        const storage = getChromeStorage();
        if (storage) {
            try {
                const result = storage.set({ [STORAGE_KEY]: value });
                result?.catch?.(() => {});
            } catch (error) {
                console.warn('SeasonalThemeService: could not sync preference', error);
            }
        }
        return apply();
    }

    /** Applies an unsaved value (Settings preview) without persisting it. */
    function preview(enabled) {
        enabledOverride = typeof enabled === 'boolean' ? enabled : null;
        return apply();
    }

    function reconcileFromChromeStorage() {
        const storage = getChromeStorage();
        if (!storage) return;
        try {
            const handle = data => {
                if (typeof data?.[STORAGE_KEY] !== 'boolean') return;
                const current = getLocalStorage()?.getItem(MIRROR_KEY);
                const next = data[STORAGE_KEY] ? '1' : '0';
                if (current !== next) {
                    writeMirror(data[STORAGE_KEY]);
                    apply();
                }
            };
            const result = storage.get(STORAGE_KEY, handle);
            result?.then?.(handle)?.catch?.(() => {});
        } catch {
            // The mirror remains usable when chrome.storage is unavailable.
        }
    }

    function bindExternalListeners() {
        if (externalListenersBound) return;
        externalListenersBound = true;

        if (typeof chrome !== 'undefined' && chrome.storage?.onChanged?.addListener) {
            chrome.storage.onChanged.addListener((changes, area) => {
                if (area !== 'local' || !changes[STORAGE_KEY]) return;
                writeMirror(changes[STORAGE_KEY].newValue !== false);
                apply();
            });
        }

        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
            // A page left open across a boundary date picks up the new window.
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') apply();
            });
        }
    }

    function bindDomReady() {
        if (domReadyBound || typeof document === 'undefined') return;
        domReadyBound = true;
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => apply(), { once: true });
        }
    }

    const SeasonalThemeService = {
        STORAGE_KEY,
        MIRROR_KEY,
        SEASONS,
        getActiveSeason,
        getActiveDecor,
        getDaysUntilPeak,
        getLogoMarkup,
        getSceneMarkup,
        getSideArtMarkup,
        isEnabled,
        setEnabled,
        preview,
        apply,
        subscribe(listener) {
            if (typeof listener !== 'function') return () => {};
            listeners.add(listener);
            return () => listeners.delete(listener);
        }
    };

    global.SeasonalThemeService = SeasonalThemeService;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = SeasonalThemeService;
    }

    bindExternalListeners();
    bindDomReady();
    apply();
    reconcileFromChromeStorage();
})(typeof window !== 'undefined' ? window : globalThis);
