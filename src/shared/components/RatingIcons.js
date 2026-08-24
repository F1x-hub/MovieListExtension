const STAR_RATING_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>';

export function getRatingIconMarkup(theme) {
    if (typeof theme === 'object' && theme !== null) {
        if (theme.isSpiderman) return '<span class="spiderman-rating-icon" aria-hidden="true"></span>';
        if (theme.isStarWars) return '<span class="starwars-rating-icon" aria-hidden="true"></span>';
        return STAR_RATING_SVG;
    }
    if (theme === 'spiderman' || theme === true) {
        return '<span class="spiderman-rating-icon" aria-hidden="true"></span>';
    }
    if (theme === 'starwars') {
        return '<span class="starwars-rating-icon" aria-hidden="true"></span>';
    }
    return STAR_RATING_SVG;
}

