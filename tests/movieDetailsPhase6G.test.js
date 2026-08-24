import assert from 'node:assert';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/pages/movie-details/movie-details.js', import.meta.url), 'utf8');

assert(source.includes('this.loadPersonalState(movieId);'), 'personal state must start after movie load');
assert(source.includes('this.createDetailedMovieCard(movie, null, null)'), 'base render must use neutral personal state');
assert(source.includes('Promise.allSettled([profilePromise, collectionsPromise, ratingPromise, bookmarkPromise])'), 'personal reads must settle independently');
assert(source.includes('loadFramesInBackground(movieId, movie, pageContext, kinopoiskService)'), 'frames must be post-render enrichment');
assert(source.includes('patchPersonalRating') && source.includes('patchBookmarkState'), 'personal results need owned patch methods');
assert(source.includes('patchCollectionsMenu') && source.includes('patchAdminControl'), 'profile and collection results need owned patch methods');
assert(!source.includes('await ratingService.getRating(this.currentUser.uid, movie.kinopoiskId);'), 'displayMovieDetails must not await personal rating');
assert(!source.includes('await favoriteService.getBookmark(this.currentUser.uid, movie.kinopoiskId);'), 'displayMovieDetails must not await personal bookmark');

const displayStart = source.indexOf('async displayMovieDetails(movie)');
const displayEnd = source.indexOf('createDetailedMovieCard(movie', displayStart);
const displayBody = source.slice(displayStart, displayEnd);
assert(!displayBody.includes('await '), 'base display must not await user-scoped reads');

console.log('✅ MovieDetails Phase 6G base-first and personal-state orchestration contract passed');
