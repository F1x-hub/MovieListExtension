const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
const service = read('src/shared/services/SeriesEpisodeRatingService.js');
const details = read('src/pages/movie-details/movie-details.js');
const detailsHtml = read('src/pages/movie-details/movie-details.html');
const detailsCss = read('src/pages/movie-details/movie-details.css');
const rules = read('rules/firestore.rules');
const tmdb = read('src/shared/services/TMDBService.js');
const card = read('src/shared/components/MovieCard.js');
const ratings = read('src/pages/ratings/ratings.js');

assert.match(service, /collection = 'seriesEpisodeRatings'/);
assert.match(service, /return uid \+ '_' \+ kpId/);
assert.match(service, /return season \+ ':' \+ episode/);
assert.match(service, /_enqueueSeries\(userId, movieId/);
assert.match(service, /runTransaction\(async transaction/);
assert.match(service, /ratingSource: 'episodes'/);
assert.match(service, /ratingSource: 'manual'/);
assert.match(service, /invalidateAverageRatingsCache/);
assert.match(service, /invalidateRatingsCache/);
assert.match(service, /recalculateUserTopGenres/);
assert.doesNotMatch(service, /getWatchlistService|removeFromWatchlist/);

assert.match(rules, /match \/seriesEpisodeRatings\/{seriesRatingId}/);
assert.match(rules, /allow list: if false/);
assert.match(rules, /hasOwnSeriesEpisodeRatingId/);
assert.match(rules, /episodes\.size\(\) <= 3000/);
assert.match(rules, /request\.resource\.data\.episodes\.diff\(resource\.data\.episodes\)\.affectedKeys\(\)/);
assert.match(rules, /\^\[0-9\]\{1,3\}:\[0-9\]\{1,5\}\$/);
assert.match(rules, /ratingSource in \['episodes', 'manual'\]/);
assert.match(rules, /episodeAverage is number/);
assert.match(rules, /episodesRatedCount is int/);

assert.match(details, /&& Number\.isInteger\(Number\(movie\?\.kinopoiskId\)\)/);
assert.match(details, /&& Number\.isInteger\(Number\(movie\?\.tmdbId \|\| movie\?\.externalId\?\.tmdb\)\)/);
assert.match(details, /if \(!this\.hasEpisodeRatingAccess\(\)\) return ''/);
assert.match(details, /isEpisodeReleasedForRating\(episode, seasonAirDate/);
assert.match(details, /series_episode_tmdb_only_hint/);
assert.match(details, /data-action="episode-rating-choice"/);
assert.match(details, /const \[existingRating, episodeRatings\] = await Promise\.all\(/);
assert.match(details, /event\.key === 'Escape'/);
assert.match(details, /ArrowLeft:[\s\S]*ArrowRight:/);
assert.match(details, /aria-label="\$\{this\.escapeHtml\(ariaLabel\)\}"/);
assert.match(detailsHtml, /id="seriesAggregateRatingNotice"/);
assert.match(detailsHtml, /id="deleteSeriesRatingBtn"/);
assert.match(detailsCss, /episode-rating-popover\[hidden\]/);
assert.match(detailsCss, /:focus-visible/);
assert.match(tmdb, /tmdbEpisodeId: Number\.isInteger\(Number\(rawEp\.id\)\)/);
assert.match(ratings, /userRatingDisplay: personalRating\.ratingSource === 'episodes'/);
assert.match(ratings, /myEpisodesRatedCount/);
assert.match(card, /mc-badge-user-caption/);

console.log('seriesEpisodeRatingsContract.test.cjs: all tests passed');
