const STAR_RATING_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>';

// Franchise films are rated with their own pictures, which the dialog's CSS swaps
// between the unselected and the selected look (`franchiseRatingThemes.js` picks
// the theme). The later sets share one size, set by `.franchise-rating-icon`.
const THEMED_ICONS = new Map([
    ['spiderman', '<span class="spiderman-rating-icon" aria-hidden="true"></span>'],
    ['starwars', '<span class="starwars-rating-icon" aria-hidden="true"></span>'],
    ...['ironman', 'avengers', 'superman', 'dune'].map(theme =>
        [theme, `<span class="franchise-rating-icon ${theme}-rating-icon" aria-hidden="true"></span>`])
]);

/**
 * @param {string} [theme] - a theme from `getRatingTheme()`; '' or unknown → star
 * @returns {string} the markup of one rating button's icon
 */
export function getRatingIconMarkup(theme) {
    return THEMED_ICONS.get(theme) || STAR_RATING_SVG;
}
