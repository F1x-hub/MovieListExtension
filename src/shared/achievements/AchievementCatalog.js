/**
 * Achievement catalog: every achievement, its category, icon, the metric it
 * counts and the thresholds of its tiers. Names and descriptions live in the
 * `achievements.items.<id>` locale keys; tier visuals come from the tier index
 * (AchievementBadge), so adding an achievement means one entry here, one icon
 * with its illustrated scene (AchievementScenes) and its locale text.
 */

export const CATEGORIES = ['ratings', 'variety', 'watching', 'lists', 'community', 'marathon', 'profile', 'special'];

/** Points for reaching tier 1..7; a one-off achievement counts as tier 4. */
export const TIER_POINTS = [10, 25, 50, 100, 200, 350, 500];
export const ONE_OFF_POINTS = 100;

export const ACHIEVEMENTS = [
    { id: 'rater', category: 'ratings', icon: 'clapper', metric: 'ratings', tiers: [5, 10, 50, 100, 250, 500, 1000] },
    { id: 'series', category: 'ratings', icon: 'tv', metric: 'series', tiers: [3, 10, 25, 50, 100] },
    { id: 'perfect', category: 'ratings', icon: 'ten', metric: 'tens', tiers: [1, 5, 25, 50, 100] },
    { id: 'merciless', category: 'ratings', icon: 'thumbsDown', metric: 'lows', tiers: [1, 5, 25, 50] },
    { id: 'streak', category: 'ratings', icon: 'flame', metric: 'streak', tiers: [3, 7, 30, 100, 365] },

    { id: 'traveler', category: 'variety', icon: 'globe', metric: 'countries', tiers: [5, 10, 20, 35, 50] },
    { id: 'genres', category: 'variety', icon: 'shapes', metric: 'genres', tiers: [5, 10, 15, 20] },
    { id: 'time_machine', category: 'variety', icon: 'hourglass', metric: 'decades', tiers: [3, 5, 7, 10] },
    { id: 'classics', category: 'variety', icon: 'landmark', metric: 'classics', tiers: [5, 10, 25, 50] },
    { id: 'anime', category: 'variety', icon: 'sparkles', metric: 'anime', tiers: [5, 10, 50, 100, 250] },
    { id: 'cartoons', category: 'variety', icon: 'smile', metric: 'cartoons', tiers: [5, 25, 50, 100] },
    { id: 'actors', category: 'variety', icon: 'users', metric: 'actors', tiers: [50, 250, 1000, 2500] },
    { id: 'directors', category: 'variety', icon: 'camera', metric: 'directors', tiers: [5, 25, 50, 100] },

    { id: 'hours', category: 'watching', icon: 'clock', metric: 'hours', tiers: [10, 50, 100, 500, 1000] },
    { id: 'in_progress', category: 'watching', icon: 'playCircle', metric: 'watching', tiers: [1, 5, 10, 25] },

    { id: 'collector', category: 'lists', icon: 'bookmark', metric: 'watchlist', tiers: [10, 50, 100, 500] },
    { id: 'curator', category: 'lists', icon: 'folder', metric: 'collections', tiers: [1, 5, 10, 25] },
    { id: 'filler', category: 'lists', icon: 'layers', metric: 'collectionItems', tiers: [10, 50, 200, 500] },

    { id: 'reviewer', category: 'community', icon: 'pen', metric: 'reviews', tiers: [1, 5, 10, 50, 100] },
    { id: 'writer', category: 'community', icon: 'book', metric: 'longReviews', tiers: [1, 5, 25] },
    { id: 'voice', category: 'community', icon: 'heart', metric: 'reactionsReceived', tiers: [5, 10, 50, 100, 500, 1000] },
    { id: 'generous', category: 'community', icon: 'thumbsUp', metric: 'reactionsGiven', tiers: [5, 25, 100, 500] },

    { id: 'marathoner', category: 'marathon', icon: 'wheel', metric: 'marathonRounds', tiers: [1, 5, 10, 25, 50] },
    { id: 'provider', category: 'marathon', icon: 'trophy', metric: 'marathonWatched', tiers: [1, 5, 25, 50] },

    { id: 'showcase', category: 'profile', icon: 'pin', metric: 'pinned', tiers: [1, 3, 5] },
    { id: 'tenure', category: 'profile', icon: 'calendar', metric: 'accountDays', tiers: [30, 180, 365, 730, 1095] },

    { id: 'first_step', category: 'special', icon: 'flag', metric: 'ratings', tiers: [1], oneOff: true },
    { id: 'full_spectrum', category: 'special', icon: 'chart', metric: 'distinctScores', tiers: [10], oneOff: true },
    { id: 'night_owl', category: 'special', icon: 'moon', metric: 'nightRatings', tiers: [10], oneOff: true, hidden: true },
    { id: 'halloween', category: 'special', icon: 'pumpkin', metric: 'halloweenHorror', tiers: [5], oneOff: true, hidden: true }
];

export const ACHIEVEMENTS_BY_ID = Object.fromEntries(ACHIEVEMENTS.map(def => [def.id, def]));

/**
 * Profile ranks I–VII as shares of all available points. The top rank needs
 * 90%, not every tier: a few hard tiers (1000 ratings, a year-long streak)
 * should not gate the final frame.
 */
export const RANK_SHARES = [0.02, 0.07, 0.15, 0.27, 0.42, 0.62, 0.9];

/** Points for an achievement at a reached tier count (0 = none). */
export function pointsFor(def, tier) {
    if (!def || !tier) return 0;
    if (def.oneOff) return ONE_OFF_POINTS;
    return TIER_POINTS.slice(0, tier).reduce((sum, value) => sum + value, 0);
}
