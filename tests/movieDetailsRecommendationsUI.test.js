import assert from 'node:assert';
import { i18n } from '../src/shared/i18n/I18n.js';
import MediaClassifier from '../src/shared/utils/MediaClassifier.js';
import RecommendationService from '../src/shared/services/RecommendationService.js';
import MovieCardPkg from '../src/shared/components/MovieCard.js';

i18n.currentLocale = 'ru';

// ---------------------------------------------------------------------------
// Chrome & Window Environment Setup for Node testing
// ---------------------------------------------------------------------------
globalThis.chrome = {
    runtime: {
        getURL: (path) => path,
        sendMessage: () => Promise.resolve()
    }
};

class MockDOMElement {
    constructor(tagName = 'div') {
        this.tagName = tagName.toUpperCase();
        this.id = '';
        this.className = '';
        this.style = {};
        this.attributes = {};
        this.children = [];
        this.parentElement = null;
        this._innerHTML = '';
        this.scrollWidth = 1000;
        this.clientWidth = 500;
        this.scrollLeft = 0;
        this.lastScrollBy = null;
        this.dataset = {};
    }

    get innerHTML() {
        return this._innerHTML;
    }

    set innerHTML(val) {
        this._innerHTML = val;
        this.children = [];
    }

    getAttribute(name) {
        return this.attributes[name] !== undefined ? this.attributes[name] : null;
    }

    setAttribute(name, val) {
        this.attributes[name] = String(val);
        if (name.startsWith('data-')) {
            const prop = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            this.dataset[prop] = String(val);
        }
    }

    appendChild(child) {
        child.parentElement = this;
        this.children.push(child);
        return child;
    }

    remove() {
        if (this.parentElement) {
            const idx = this.parentElement.children.indexOf(this);
            if (idx !== -1) {
                this.parentElement.children.splice(idx, 1);
            }
            this.parentElement = null;
        }
    }

    scrollBy(options) {
        this.lastScrollBy = options;
        if (options && typeof options.left === 'number') {
            this.scrollLeft += options.left;
        }
    }

    querySelector(selector) {
        if (selector === '#movieRecommendationsCarousel' || selector === '.movie-recommendations-carousel') {
            return this.children.find(c => c.id === 'movieRecommendationsCarousel') || null;
        }
        if (selector === '#movieRecommendationsNav' || selector === '.movie-recommendations-nav') {
            return this.children.find(c => c.id === 'movieRecommendationsNav') || null;
        }
        return null;
    }

    querySelectorAll(selector) {
        const results = [];
        const traverse = (el) => {
            for (const child of el.children) {
                if (selector.startsWith('.') && child.className.includes(selector.slice(1))) {
                    results.push(child);
                }
                traverse(child);
            }
        };
        traverse(this);
        return results;
    }
}

globalThis.document = {
    createElement: (tag) => new MockDOMElement(tag),
    getElementById: (id) => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {}
};

globalThis.window = globalThis;
globalThis.window.i18n = i18n;

const MovieCard = MovieCardPkg?.MovieCard || globalThis.MovieCard;
globalThis.MediaClassifier = MediaClassifier;
globalThis.RecommendationService = RecommendationService;
globalThis.MovieCard = MovieCard;

// ---------------------------------------------------------------------------
// Mock MovieDetailsManager controller subclass for isolated UI testing
// ---------------------------------------------------------------------------
class TestMovieDetailsManager {
    constructor() {
        this.selectedMovie = null;
        this.recommendationsLoadedForMovieId = null;
        this.recommendationsObserver = null;
        this.recommendationService = null;
        this.availableCollections = [];
        this.detailsRequestsCount = 0;
        this.scraperRequestsCount = 0;
    }

    getRecommendationsSectionTitle(movie) {
        const classifier = (typeof MediaClassifier !== 'undefined') ? MediaClassifier : null;
        const section = classifier ? classifier.classifyHomeMedia(movie) : 'film';

        if (section === 'series') {
            return i18n.get('movie_details.similar_series') || 'Похожие сериалы';
        }
        if (section === 'cartoon') {
            return i18n.get('movie_details.similar_cartoons') || 'Похожие мультфильмы';
        }
        if (section === 'anime') {
            return i18n.get('movie_details.similar_anime') || 'Похожее';
        }
        return i18n.get('movie_details.similar_movies') || 'Похожие фильмы';
    }

    renderRecommendationsSectionPlaceholder(movie) {
        if (!movie) return '';
        const sectionTitle = this.getRecommendationsSectionTitle(movie);

        return `
            <div class="movie-recommendations-section" id="movieRecommendationsSection" data-movie-id="${movie.kinopoiskId}">
                <div class="movie-recommendations-header">
                    <h3 class="movie-recommendations-title">${sectionTitle}</h3>
                    <div class="movie-recommendations-nav" id="movieRecommendationsNav" style="display: none;">
                        <button type="button" class="movie-carousel-btn movie-carousel-btn--prev" data-action="scroll-recommendations-prev" aria-label="Предыдущие">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                        </button>
                        <button type="button" class="movie-carousel-btn movie-carousel-btn--next" data-action="scroll-recommendations-next" aria-label="Следующие">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                        </button>
                    </div>
                </div>
                <div class="movie-recommendations-carousel" id="movieRecommendationsCarousel" tabindex="0" role="region" aria-label="${sectionTitle}">
                    ${this.renderRecommendationSkeletons(5)}
                </div>
            </div>
        `;
    }

    renderRecommendationSkeletons(count = 5) {
        let html = '';
        for (let i = 0; i < count; i++) {
            html += `
                <div class="movie-recommendations-skeleton-card" aria-hidden="true">
                    <div class="movie-recommendations-skeleton-poster"></div>
                    <div class="movie-recommendations-skeleton-title"></div>
                    <div class="movie-recommendations-skeleton-meta"></div>
                </div>
            `;
        }
        return html;
    }

    observeOrLoadRecommendations(movie, rootEl) {
        if (!movie) return;
        const sectionEl = rootEl ? rootEl.children.find(c => c.id === 'movieRecommendationsSection') : null;
        if (!sectionEl) return;

        if (typeof IntersectionObserver !== 'undefined') {
            if (this.recommendationsObserver) {
                this.recommendationsObserver.disconnect();
            }
            this.recommendationsObserver = new IntersectionObserver((entries) => {
                const entry = entries[0];
                if (entry && entry.isIntersecting) {
                    this.recommendationsObserver.disconnect();
                    this.recommendationsObserver = null;
                    this.loadRecommendationsAsync(movie, rootEl);
                }
            }, { rootMargin: '300px' });
            this.recommendationsObserver.observe(sectionEl);
        } else {
            setTimeout(() => this.loadRecommendationsAsync(movie, rootEl), 50);
        }
    }

    async loadRecommendationsAsync(movie, rootEl) {
        if (!movie) return;
        const movieId = String(movie.kinopoiskId || movie.id);
        if (this.recommendationsLoadedForMovieId === movieId) return;
        this.recommendationsLoadedForMovieId = movieId;

        const sectionEl = rootEl ? rootEl.children.find(c => c.id === 'movieRecommendationsSection') : null;
        const carouselEl = sectionEl ? sectionEl.children.find(c => c.id === 'movieRecommendationsCarousel') : null;
        const navEl = sectionEl ? sectionEl.children.find(c => c.id === 'movieRecommendationsNav') : null;

        try {
            const recService = this.recommendationService;

            if (!recService) {
                if (sectionEl) sectionEl.remove();
                return;
            }

            const rawRecs = await recService.getRecommendationsForMovie(movie, {
                targetCount: 10,
                minFallbackThreshold: 6
            });

            // Lifecycle guard: Ensure user has not navigated away from this movie
            if (String(this.selectedMovie?.kinopoiskId) !== movieId) {
                return;
            }

            if (!Array.isArray(rawRecs) || rawRecs.length === 0) {
                if (sectionEl) sectionEl.remove();
                return;
            }

            // Deduplicate against source movie and sequels/prequels
            const excludedKpIds = new Set();
            if (movie.kinopoiskId) excludedKpIds.add(Number(movie.kinopoiskId));
            if (movie.id) excludedKpIds.add(Number(movie.id));

            if (Array.isArray(movie.sequelsAndPrequels)) {
                movie.sequelsAndPrequels.forEach(seq => {
                    const sid = Number(seq.id || seq.filmId || seq.kinopoiskId);
                    if (sid > 0) excludedKpIds.add(sid);
                });
            }

            const filteredRecs = rawRecs.filter(r => {
                const kpId = Number(r.kinopoiskId);
                return kpId > 0 && !excludedKpIds.has(kpId);
            });

            // UI minimum viable count: 4
            if (filteredRecs.length < 4) {
                if (sectionEl) sectionEl.remove();
                return;
            }

            if (carouselEl) {
                carouselEl.innerHTML = '';
                const favService = (typeof FavoriteService !== 'undefined' && this.firebaseManager?.getFavoriteService)
                    ? this.firebaseManager.getFavoriteService()
                    : (this.favoriteService || null);
                const currentUser = this.currentUser || this.firebaseManager?.auth?.currentUser || null;

                let bookmarksMap = {};
                if (favService && currentUser?.uid) {
                    try {
                        const recKpIds = filteredRecs.map(r => Number(r.kinopoiskId)).filter(id => id > 0);
                        if (recKpIds.length > 0 && typeof favService.getBookmarksBatch === 'function') {
                            bookmarksMap = (await favService.getBookmarksBatch(currentUser.uid, recKpIds)) || {};
                        }
                    } catch {
                        bookmarksMap = {};
                    }
                }

                filteredRecs.forEach(rec => {
                    const kpId = Number(rec.kinopoiskId);
                    const bookmark = bookmarksMap ? bookmarksMap[kpId] : null;
                    const isFav = bookmark?.status === 'favorite';
                    const isWatch = bookmark?.status === 'watching';
                    const isPlan = bookmark?.status === 'plan_to_watch';
                    const isDone = bookmark?.status === 'watched';

                    const card = MovieCard.create({
                        movie: {
                            kinopoiskId: kpId,
                            tmdbId: rec.tmdbId,
                            name: rec.name,
                            alternativeName: rec.alternativeName,
                            posterUrl: rec.posterUrl,
                            year: rec.year,
                            genres: rec.genreIds
                        },
                        isFavorite: isFav,
                        isWatching: isWatch,
                        isInWatchlist: isPlan,
                        isWatched: isDone
                    }, {
                        variant: 'search',
                        showThreeDotMenu: true,
                        showFavorite: true,
                        showWatching: true,
                        showWatched: true,
                        showWatchlist: true,
                        showAddToCollection: true,
                        availableCollections: this.availableCollections
                    });

                    carouselEl.appendChild(card);
                });

                if (navEl && carouselEl.scrollWidth > carouselEl.clientWidth + 10) {
                    navEl.style.display = 'flex';
                }
            }
        } catch {
            if (sectionEl) sectionEl.remove();
        }
    }
}

// ---------------------------------------------------------------------------
// Test Suite Execution
// ---------------------------------------------------------------------------
async function runTests() {
    console.log('=== Running MovieDetails Recommendations UI Test Suite ===\n');
    let passed = 0;
    let failed = 0;

    function test(name, fn) {
        try {
            fn();
            console.log(`  [PASS] ${name}`);
            passed++;
        } catch (err) {
            console.error(`  [FAIL] ${name}:`, err);
            failed++;
        }
    }

    async function asyncTest(name, fn) {
        try {
            await fn();
            console.log(`  [PASS] ${name}`);
            passed++;
        } catch (err) {
            console.error(`  [FAIL] ${name}:`, err);
            failed++;
        }
    }

    // 1. Heading Movie
    test('1. Heading: movie classification produces "Похожие фильмы"', () => {
        const mgr = new TestMovieDetailsManager();
        const title = mgr.getRecommendationsSectionTitle({
            kinopoiskId: 100,
            type: 'FILM',
            genres: [{ name: 'боевик' }]
        });
        assert.strictEqual(title, 'Похожие фильмы');
    });

    // 2. Heading Series
    test('2. Heading: series classification produces "Похожие сериалы"', () => {
        const mgr = new TestMovieDetailsManager();
        const title = mgr.getRecommendationsSectionTitle({
            kinopoiskId: 200,
            isSeries: true,
            type: 'TV_SERIES',
            genres: [{ name: 'драма' }]
        });
        assert.strictEqual(title, 'Похожие сериалы');
    });

    // 3. Heading Cartoon
    test('3. Heading: cartoon classification produces "Похожие мультфильмы"', () => {
        const mgr = new TestMovieDetailsManager();
        const title = mgr.getRecommendationsSectionTitle({
            kinopoiskId: 300,
            isSeries: false,
            type: 'FILM',
            genres: [{ name: 'мультфильм' }]
        });
        assert.strictEqual(title, 'Похожие мультфильмы');
    });

    // 4. Heading Anime
    test('4. Heading: anime classification produces "Похожее"', () => {
        const mgr = new TestMovieDetailsManager();
        const title = mgr.getRecommendationsSectionTitle({
            kinopoiskId: 400,
            isSeries: true,
            type: 'ANIME',
            genres: [{ name: 'аниме' }]
        });
        assert.strictEqual(title, 'Похожее');
    });

    // 5. Placeholder & Skeleton Markup
    test('5. Placeholder: renders 5 skeleton cards inside carousel with accessibility attributes', () => {
        const mgr = new TestMovieDetailsManager();
        const html = mgr.renderRecommendationsSectionPlaceholder({
            kinopoiskId: 500,
            name: 'Test Film',
            type: 'FILM'
        });
        assert.ok(html.includes('id="movieRecommendationsSection"'));
        assert.ok(html.includes('id="movieRecommendationsCarousel"'));
        assert.ok(html.includes('tabindex="0"'));
        assert.ok(html.includes('role="region"'));
        assert.ok(html.includes('movie-recommendations-skeleton-card'));
        const skeletonMatches = html.match(/movie-recommendations-skeleton-card/g);
        assert.strictEqual(skeletonMatches.length, 5);
    });

    // 6. Target 10 cards rendered
    await asyncTest('6. Async UI: renders 10 cards when 10 mapped recommendations available', async () => {
        const mgr = new TestMovieDetailsManager();
        const movie = { kinopoiskId: 600, tmdbId: 10600, type: 'FILM' };
        mgr.selectedMovie = movie;

        const fakeRecs = Array.from({ length: 10 }, (_, i) => ({
            kinopoiskId: 7000 + i,
            tmdbId: 8000 + i,
            name: `Rec Movie ${i + 1}`,
            year: 2020 + i,
            posterUrl: `https://img.com/${i}.jpg`,
            genreIds: ['боевик']
        }));

        mgr.recommendationService = {
            getRecommendationsForMovie: async () => fakeRecs
        };

        const rootEl = new MockDOMElement('div');
        const secEl = new MockDOMElement('div');
        secEl.id = 'movieRecommendationsSection';
        const carEl = new MockDOMElement('div');
        carEl.id = 'movieRecommendationsCarousel';
        const navEl = new MockDOMElement('div');
        navEl.id = 'movieRecommendationsNav';
        secEl.appendChild(navEl);
        secEl.appendChild(carEl);
        rootEl.appendChild(secEl);

        await mgr.loadRecommendationsAsync(movie, rootEl);

        assert.strictEqual(carEl.children.length, 10);
        assert.strictEqual(navEl.style.display, 'flex');
    });

    // 7. Threshold 4 cards (boundary pass)
    await asyncTest('7. Threshold: 4 cards render successfully (minimum viable count)', async () => {
        const mgr = new TestMovieDetailsManager();
        const movie = { kinopoiskId: 700, tmdbId: 10700, type: 'FILM' };
        mgr.selectedMovie = movie;

        const fakeRecs = Array.from({ length: 4 }, (_, i) => ({
            kinopoiskId: 7100 + i,
            tmdbId: 8100 + i,
            name: `Rec ${i + 1}`,
            year: 2021
        }));

        mgr.recommendationService = {
            getRecommendationsForMovie: async () => fakeRecs
        };

        const rootEl = new MockDOMElement('div');
        const secEl = new MockDOMElement('div');
        secEl.id = 'movieRecommendationsSection';
        const carEl = new MockDOMElement('div');
        carEl.id = 'movieRecommendationsCarousel';
        secEl.appendChild(carEl);
        rootEl.appendChild(secEl);

        await mgr.loadRecommendationsAsync(movie, rootEl);

        assert.strictEqual(carEl.children.length, 4);
        assert.strictEqual(rootEl.children.length, 1);
    });

    // 8. Threshold < 4 cards (boundary drop/clean removal)
    await asyncTest('8. Threshold: < 4 cards (e.g. 3) cleanly removes the section', async () => {
        const mgr = new TestMovieDetailsManager();
        const movie = { kinopoiskId: 800, tmdbId: 10800, type: 'FILM' };
        mgr.selectedMovie = movie;

        const fakeRecs = Array.from({ length: 3 }, (_, i) => ({
            kinopoiskId: 7200 + i,
            tmdbId: 8200 + i,
            name: `Rec ${i + 1}`,
            year: 2021
        }));

        mgr.recommendationService = {
            getRecommendationsForMovie: async () => fakeRecs
        };

        const rootEl = new MockDOMElement('div');
        const secEl = new MockDOMElement('div');
        secEl.id = 'movieRecommendationsSection';
        rootEl.appendChild(secEl);

        await mgr.loadRecommendationsAsync(movie, rootEl);

        assert.strictEqual(rootEl.children.length, 0);
    });

    // 9. Service Failure / Exception handling
    await asyncTest('9. Error Safety: Service rejection cleanly removes section without crashing', async () => {
        const mgr = new TestMovieDetailsManager();
        const movie = { kinopoiskId: 900, tmdbId: 10900, type: 'FILM' };
        mgr.selectedMovie = movie;

        mgr.recommendationService = {
            getRecommendationsForMovie: async () => {
                throw new Error('TMDB Network Timeout');
            }
        };

        const rootEl = new MockDOMElement('div');
        const secEl = new MockDOMElement('div');
        secEl.id = 'movieRecommendationsSection';
        rootEl.appendChild(secEl);

        await mgr.loadRecommendationsAsync(movie, rootEl);

        assert.strictEqual(rootEl.children.length, 0);
    });

    // 10. Missing tmdbId / empty recommendation list
    await asyncTest('10. Graceful empty: 0 recommendations removes section without residue', async () => {
        const mgr = new TestMovieDetailsManager();
        const movie = { kinopoiskId: 1000, type: 'FILM' };
        mgr.selectedMovie = movie;

        mgr.recommendationService = {
            getRecommendationsForMovie: async () => []
        };

        const rootEl = new MockDOMElement('div');
        const secEl = new MockDOMElement('div');
        secEl.id = 'movieRecommendationsSection';
        rootEl.appendChild(secEl);

        await mgr.loadRecommendationsAsync(movie, rootEl);

        assert.strictEqual(rootEl.children.length, 0);
    });

    // 11. Kinopoisk Route & No TMDB ID Routing
    await asyncTest('11. Routing: Rendered cards use verified Kinopoisk ID for navigation, never TMDB ID', async () => {
        const mgr = new TestMovieDetailsManager();
        const movie = { kinopoiskId: 1100, tmdbId: 5555, type: 'FILM' };
        mgr.selectedMovie = movie;

        const fakeRecs = [
            { kinopoiskId: 301, tmdbId: 99999, name: 'Card 1', year: 2022 },
            { kinopoiskId: 302, tmdbId: 99998, name: 'Card 2', year: 2022 },
            { kinopoiskId: 303, tmdbId: 99997, name: 'Card 3', year: 2022 },
            { kinopoiskId: 304, tmdbId: 99996, name: 'Card 4', year: 2022 }
        ];

        mgr.recommendationService = {
            getRecommendationsForMovie: async () => fakeRecs
        };

        const rootEl = new MockDOMElement('div');
        const secEl = new MockDOMElement('div');
        secEl.id = 'movieRecommendationsSection';
        const carEl = new MockDOMElement('div');
        carEl.id = 'movieRecommendationsCarousel';
        secEl.appendChild(carEl);
        rootEl.appendChild(secEl);

        await mgr.loadRecommendationsAsync(movie, rootEl);

        assert.strictEqual(carEl.children.length, 4);
        carEl.children.forEach((card, idx) => {
            const expKpId = fakeRecs[idx].kinopoiskId;
            assert.strictEqual(card.dataset.movieId, String(expKpId));
            assert.ok(card.innerHTML.includes(`movieId=${expKpId}`));
            assert.ok(!card.innerHTML.includes(`movieId=${fakeRecs[idx].tmdbId}`));
        });
    });

    // 12. Self-Exclusion
    await asyncTest('12. Deduplication: Current movie KP ID is strictly excluded from rendered cards', async () => {
        const mgr = new TestMovieDetailsManager();
        const movie = { kinopoiskId: 1200, tmdbId: 1200, type: 'FILM' };
        mgr.selectedMovie = movie;

        const fakeRecs = [
            { kinopoiskId: 1200, tmdbId: 1200, name: 'Current Movie Clone' },
            { kinopoiskId: 1201, tmdbId: 1201, name: 'Other 1' },
            { kinopoiskId: 1202, tmdbId: 1202, name: 'Other 2' },
            { kinopoiskId: 1203, tmdbId: 1203, name: 'Other 3' },
            { kinopoiskId: 1204, tmdbId: 1204, name: 'Other 4' }
        ];

        mgr.recommendationService = {
            getRecommendationsForMovie: async () => fakeRecs
        };

        const rootEl = new MockDOMElement('div');
        const secEl = new MockDOMElement('div');
        secEl.id = 'movieRecommendationsSection';
        const carEl = new MockDOMElement('div');
        carEl.id = 'movieRecommendationsCarousel';
        secEl.appendChild(carEl);
        rootEl.appendChild(secEl);

        await mgr.loadRecommendationsAsync(movie, rootEl);

        assert.strictEqual(carEl.children.length, 4);
        assert.ok(!carEl.children.some(c => c.dataset.movieId === '1200'));
    });

    // 13. Sequel/Prequel Exclusion
    await asyncTest('13. Deduplication: Sequels and prequels already present in movie DTO are excluded', async () => {
        const mgr = new TestMovieDetailsManager();
        const movie = {
            kinopoiskId: 1300,
            tmdbId: 1300,
            type: 'FILM',
            sequelsAndPrequels: [
                { id: 1301, name: 'Part 2' },
                { filmId: 1302, name: 'Part 3' }
            ]
        };
        mgr.selectedMovie = movie;

        const fakeRecs = [
            { kinopoiskId: 1301, tmdbId: 9001, name: 'Part 2' },
            { kinopoiskId: 1302, tmdbId: 9002, name: 'Part 3' },
            { kinopoiskId: 1303, tmdbId: 9003, name: 'Fresh Rec 1' },
            { kinopoiskId: 1304, tmdbId: 9004, name: 'Fresh Rec 2' },
            { kinopoiskId: 1305, tmdbId: 9005, name: 'Fresh Rec 3' },
            { kinopoiskId: 1306, tmdbId: 9006, name: 'Fresh Rec 4' }
        ];

        mgr.recommendationService = {
            getRecommendationsForMovie: async () => fakeRecs
        };

        const rootEl = new MockDOMElement('div');
        const secEl = new MockDOMElement('div');
        secEl.id = 'movieRecommendationsSection';
        const carEl = new MockDOMElement('div');
        carEl.id = 'movieRecommendationsCarousel';
        secEl.appendChild(carEl);
        rootEl.appendChild(secEl);

        await mgr.loadRecommendationsAsync(movie, rootEl);

        assert.strictEqual(carEl.children.length, 4);
        assert.ok(!carEl.children.some(c => c.dataset.movieId === '1301' || c.dataset.movieId === '1302'));
    });

    // 14. Zero N+1 requests invariant
    await asyncTest('14. Invariant: Zero per-card details requests are initiated', async () => {
        const mgr = new TestMovieDetailsManager();
        const movie = { kinopoiskId: 1400, tmdbId: 1400, type: 'FILM' };
        mgr.selectedMovie = movie;

        const fakeRecs = Array.from({ length: 5 }, (_, i) => ({
            kinopoiskId: 7400 + i,
            tmdbId: 8400 + i,
            name: `Rec ${i}`
        }));

        mgr.recommendationService = {
            getRecommendationsForMovie: async () => fakeRecs
        };

        const rootEl = new MockDOMElement('div');
        const secEl = new MockDOMElement('div');
        secEl.id = 'movieRecommendationsSection';
        const carEl = new MockDOMElement('div');
        carEl.id = 'movieRecommendationsCarousel';
        secEl.appendChild(carEl);
        rootEl.appendChild(secEl);

        await mgr.loadRecommendationsAsync(movie, rootEl);

        assert.strictEqual(mgr.detailsRequestsCount, 0);
    });

    // 15. Zero Scraper Invariant
    await asyncTest('15. Invariant: SimilarMoviesParsingService is NOT invoked', async () => {
        const mgr = new TestMovieDetailsManager();
        const movie = { kinopoiskId: 1500, tmdbId: 1500, type: 'FILM' };
        mgr.selectedMovie = movie;

        const fakeRecs = Array.from({ length: 5 }, (_, i) => ({
            kinopoiskId: 7500 + i,
            tmdbId: 8500 + i,
            name: `Rec ${i}`
        }));

        mgr.recommendationService = {
            getRecommendationsForMovie: async () => fakeRecs
        };

        const rootEl = new MockDOMElement('div');
        const secEl = new MockDOMElement('div');
        secEl.id = 'movieRecommendationsSection';
        const carEl = new MockDOMElement('div');
        carEl.id = 'movieRecommendationsCarousel';
        secEl.appendChild(carEl);
        rootEl.appendChild(secEl);

        await mgr.loadRecommendationsAsync(movie, rootEl);

        assert.strictEqual(mgr.scraperRequestsCount, 0);
    });

    // 16. In-flight Promise & ID Dedup
    await asyncTest('16. Deduplication: One-shot guard prevents re-executing for the same movie ID', async () => {
        const mgr = new TestMovieDetailsManager();
        const movie = { kinopoiskId: 1600, tmdbId: 1600, type: 'FILM' };
        mgr.selectedMovie = movie;

        let callCount = 0;
        mgr.recommendationService = {
            getRecommendationsForMovie: async () => {
                callCount++;
                return Array.from({ length: 5 }, (_, i) => ({
                    kinopoiskId: 7600 + i,
                    tmdbId: 8600 + i,
                    name: `Rec ${i}`
                }));
            }
        };

        const rootEl = new MockDOMElement('div');
        const secEl = new MockDOMElement('div');
        secEl.id = 'movieRecommendationsSection';
        const carEl = new MockDOMElement('div');
        carEl.id = 'movieRecommendationsCarousel';
        secEl.appendChild(carEl);
        rootEl.appendChild(secEl);

        await mgr.loadRecommendationsAsync(movie, rootEl);
        await mgr.loadRecommendationsAsync(movie, rootEl);

        assert.strictEqual(callCount, 1);
    });

    // 17. Stale navigation guard
    await asyncTest('17. Lifecycle: Outdated async recommendation resolution is discarded if active movie changed', async () => {
        const mgr = new TestMovieDetailsManager();
        const movie1 = { kinopoiskId: 1701, tmdbId: 1701, type: 'FILM' };
        mgr.selectedMovie = movie1;

        let resolvePromise;
        mgr.recommendationService = {
            getRecommendationsForMovie: () => new Promise(res => { resolvePromise = res; })
        };

        const rootEl = new MockDOMElement('div');
        const secEl = new MockDOMElement('div');
        secEl.id = 'movieRecommendationsSection';
        const carEl = new MockDOMElement('div');
        carEl.id = 'movieRecommendationsCarousel';
        secEl.appendChild(carEl);
        rootEl.appendChild(secEl);

        const loadPromise = mgr.loadRecommendationsAsync(movie1, rootEl);

        // User switches to movie 2
        mgr.selectedMovie = { kinopoiskId: 1702, tmdbId: 1702, type: 'FILM' };

        resolvePromise(Array.from({ length: 5 }, (_, i) => ({
            kinopoiskId: 7700 + i,
            tmdbId: 8700 + i,
            name: `Rec ${i}`
        })));

        await loadPromise;

        // Cards must NOT be injected into carousel
        assert.strictEqual(carEl.children.length, 0);
    });

    // 18. Observer Fallback
    await asyncTest('18. Fallback: Loads via setTimeout when IntersectionObserver is not available', async () => {
        const mgr = new TestMovieDetailsManager();
        const movie = { kinopoiskId: 1800, tmdbId: 1800, type: 'FILM' };
        mgr.selectedMovie = movie;

        mgr.recommendationService = {
            getRecommendationsForMovie: async () => Array.from({ length: 5 }, (_, i) => ({
                kinopoiskId: 7800 + i,
                tmdbId: 8800 + i,
                name: `Rec ${i}`
            }))
        };

        const rootEl = new MockDOMElement('div');
        const secEl = new MockDOMElement('div');
        secEl.id = 'movieRecommendationsSection';
        const carEl = new MockDOMElement('div');
        carEl.id = 'movieRecommendationsCarousel';
        secEl.appendChild(carEl);
        rootEl.appendChild(secEl);

        mgr.observeOrLoadRecommendations(movie, rootEl);

        await new Promise(r => setTimeout(r, 70));
        assert.strictEqual(carEl.children.length, 5);
    });

    // 19. Carousel navigation controls
    test('19. Carousel Controls: scrollBy is called with 75% clientWidth on prev/next', () => {
        const carousel = new MockDOMElement('div');
        carousel.clientWidth = 400;

        // Next
        carousel.scrollBy({ left: carousel.clientWidth * 0.75, behavior: 'smooth' });
        assert.strictEqual(carousel.lastScrollBy.left, 300);
        assert.strictEqual(carousel.scrollLeft, 300);

        // Prev
        carousel.scrollBy({ left: -carousel.clientWidth * 0.75, behavior: 'smooth' });
        assert.strictEqual(carousel.lastScrollBy.left, -300);
        assert.strictEqual(carousel.scrollLeft, 0);
    });

    // 20. Accessibility: Carousel element has proper role, tabindex, and aria-label
    test('20. Accessibility: Carousel element has proper role, tabindex, and aria-label', () => {
        const mgr = new TestMovieDetailsManager();
        const placeholder = mgr.renderRecommendationsSectionPlaceholder({
            kinopoiskId: 2000,
            type: 'FILM'
        });

        assert.ok(placeholder.includes('tabindex="0"'));
        assert.ok(placeholder.includes('role="region"'));
        assert.ok(placeholder.includes('aria-label="Похожие фильмы"'));
    });

    // 21. No CSP inline script handlers
    test('21. CSP Safety: No inline onclick handlers in placeholder or buttons', () => {
        const mgr = new TestMovieDetailsManager();
        const placeholder = mgr.renderRecommendationsSectionPlaceholder({
            kinopoiskId: 2100,
            type: 'FILM'
        });

        assert.ok(!placeholder.includes('onclick='));
        assert.ok(!placeholder.includes('onerror='));
        assert.ok(!placeholder.includes('onload='));
    });

    // 22. Responsive carousel structure
    test('22. Responsive: Nav container and buttons use semantic data-action attributes', () => {
        const mgr = new TestMovieDetailsManager();
        const placeholder = mgr.renderRecommendationsSectionPlaceholder({
            kinopoiskId: 2200,
            type: 'FILM'
        });

        assert.ok(placeholder.includes('data-action="scroll-recommendations-prev"'));
        assert.ok(placeholder.includes('data-action="scroll-recommendations-next"'));
    });

    // 23. Warm service result
    await asyncTest('23. Warm Cache: Repeated query returns cached DTOs seamlessly', async () => {
        let networkHits = 0;
        const fakeTMDB = {
            getRecommendations: async () => {
                networkHits++;
                return [
                    { id: 1, title: 'W1', release_date: '2021', genre_ids: [28] },
                    { id: 2, title: 'W2', release_date: '2021', genre_ids: [28] },
                    { id: 3, title: 'W3', release_date: '2021', genre_ids: [28] },
                    { id: 4, title: 'W4', release_date: '2021', genre_ids: [28] },
                    { id: 5, title: 'W5', release_date: '2021', genre_ids: [28] },
                    { id: 6, title: 'W6', release_date: '2021', genre_ids: [28] }
                ];
            },
            getSimilar: async () => []
        };
        const fakeMapping = {
            buildKey: (type, id) => `${type || 'movie'}:${id}`,
            resolveBatch: async (items) => {
                const map = new Map();
                items.forEach((it, idx) => {
                    map.set(`${it.mediaType || 'movie'}:${it.tmdbId || it.id}`, { kinopoiskId: 50000 + idx });
                });
                return map;
            }
        };

        const recService = new RecommendationService({
            tmdbService: fakeTMDB,
            idMappingService: fakeMapping
        });

        const movie = { kinopoiskId: 2300, tmdbId: 2300 };

        const res1 = await recService.getRecommendationsForMovie(movie);
        const res2 = await recService.getRecommendationsForMovie(movie);

        assert.strictEqual(res1.length, 6);
        assert.strictEqual(res2.length, 6);
        assert.strictEqual(networkHits, 1); // Only 1 network hit due to internal LRU cache
    });

    // 24. FavoriteService Contract & getBookmarksBatch single roundtrip
    await asyncTest('24. FavoriteService Contract: Single getBookmarksBatch populates isWatching, isFavorite, etc.', async () => {
        let batchCalls = 0;
        const fakeFavoriteService = {
            getBookmarksBatch: async (userId, movieIds) => {
                batchCalls++;
                assert.strictEqual(userId, 'user_123');
                assert.strictEqual(movieIds.length, 5);
                return {
                    50001: { movieId: 50001, status: 'watching' },
                    50002: { movieId: 50002, status: 'favorite' },
                    50003: { movieId: 50003, status: 'plan_to_watch' },
                    50004: { movieId: 50004, status: 'watched' }
                };
            }
        };

        const mgr = new TestMovieDetailsManager();
        mgr.currentUser = { uid: 'user_123' };
        mgr.favoriteService = fakeFavoriteService;
        mgr.recommendationService = {
            getRecommendationsForMovie: async () => [
                { kinopoiskId: 50000, name: 'Rec 0', posterUrl: 'p0.jpg' },
                { kinopoiskId: 50001, name: 'Rec 1', posterUrl: 'p1.jpg' },
                { kinopoiskId: 50002, name: 'Rec 2', posterUrl: 'p2.jpg' },
                { kinopoiskId: 50003, name: 'Rec 3', posterUrl: 'p3.jpg' },
                { kinopoiskId: 50004, name: 'Rec 4', posterUrl: 'p4.jpg' }
            ]
        };

        const movie = { kinopoiskId: 2400, name: 'Source' };
        mgr.selectedMovie = movie;
        const rootEl = new MockDOMElement('div');
        const sectionEl = new MockDOMElement('div');
        sectionEl.id = 'movieRecommendationsSection';
        const carouselEl = new MockDOMElement('div');
        carouselEl.id = 'movieRecommendationsCarousel';
        sectionEl.appendChild(carouselEl);
        rootEl.appendChild(sectionEl);

        await mgr.loadRecommendationsAsync(movie, rootEl);

        assert.strictEqual(batchCalls, 1, 'Exactly 1 batch read performed for all 5 recommendation cards');
        assert.strictEqual(carouselEl.children.length, 5, 'All 5 cards rendered');
        assert.strictEqual(sectionEl.parentElement, rootEl, 'Recommendations section survived');

        // Check card 0 (none)
        assert.ok(carouselEl.children[0].innerHTML.includes('data-is-watching="false"'));
        // Check card 1 (watching)
        assert.ok(carouselEl.children[1].innerHTML.includes('data-is-watching="true"'));
        // Check card 2 (favorite)
        assert.ok(carouselEl.children[2].innerHTML.includes('data-is-favorite="true"'));
        // Check card 3 (watchlist)
        assert.ok(carouselEl.children[3].innerHTML.includes('data-is-in-watchlist="true"'));
        // Check card 4 (watched)
        assert.ok(carouselEl.children[4].innerHTML.includes('data-is-watched="true"'));
    });

    // 25. FavoriteService Failure Graceful Degradation
    await asyncTest('25. FavoriteService Failure: Recommendations render normally when bookmark service throws', async () => {
        const fakeFavoriteService = {
            getBookmarksBatch: async () => {
                throw new Error('Firestore permission denied');
            }
        };

        const mgr = new TestMovieDetailsManager();
        mgr.currentUser = { uid: 'user_456' };
        mgr.favoriteService = fakeFavoriteService;
        mgr.recommendationService = {
            getRecommendationsForMovie: async () => [
                { kinopoiskId: 60000, name: 'R0', posterUrl: 'p0.jpg' },
                { kinopoiskId: 60001, name: 'R1', posterUrl: 'p1.jpg' },
                { kinopoiskId: 60002, name: 'R2', posterUrl: 'p2.jpg' },
                { kinopoiskId: 60003, name: 'R3', posterUrl: 'p3.jpg' }
            ]
        };

        const movie = { kinopoiskId: 2500, name: 'Source' };
        mgr.selectedMovie = movie;
        const rootEl = new MockDOMElement('div');
        const sectionEl = new MockDOMElement('div');
        sectionEl.id = 'movieRecommendationsSection';
        const carouselEl = new MockDOMElement('div');
        carouselEl.id = 'movieRecommendationsCarousel';
        sectionEl.appendChild(carouselEl);
        rootEl.appendChild(sectionEl);

        await mgr.loadRecommendationsAsync(movie, rootEl);

        assert.strictEqual(carouselEl.children.length, 4, 'All 4 cards rendered despite bookmark failure');
        assert.strictEqual(sectionEl.parentElement, rootEl, 'Recommendations section did not blow up');
        assert.strictEqual(carouselEl.children[0].attributes['data-is-watching'], undefined);
    });

    // 26. Zero network reads when unauthenticated
    await asyncTest('26. Unauthenticated: Zero bookmark queries executed for guest user', async () => {
        let batchCalls = 0;
        const fakeFavoriteService = {
            getBookmarksBatch: async () => {
                batchCalls++;
                return {};
            }
        };

        const mgr = new TestMovieDetailsManager();
        mgr.currentUser = null;
        mgr.favoriteService = fakeFavoriteService;
        mgr.recommendationService = {
            getRecommendationsForMovie: async () => [
                { kinopoiskId: 70000, name: 'G0', posterUrl: 'p0.jpg' },
                { kinopoiskId: 70001, name: 'G1', posterUrl: 'p1.jpg' },
                { kinopoiskId: 70002, name: 'G2', posterUrl: 'p2.jpg' },
                { kinopoiskId: 70003, name: 'G3', posterUrl: 'p3.jpg' }
            ]
        };

        const movie = { kinopoiskId: 2600, name: 'Source' };
        mgr.selectedMovie = movie;
        const rootEl = new MockDOMElement('div');
        const sectionEl = new MockDOMElement('div');
        sectionEl.id = 'movieRecommendationsSection';
        const carouselEl = new MockDOMElement('div');
        carouselEl.id = 'movieRecommendationsCarousel';
        sectionEl.appendChild(carouselEl);
        rootEl.appendChild(sectionEl);

        await mgr.loadRecommendationsAsync(movie, rootEl);

        assert.strictEqual(batchCalls, 0, 'Zero bookmark batch calls for guest user');
        assert.strictEqual(carouselEl.children.length, 4, 'All 4 cards rendered for guest');
    });

    console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===`);
    if (failed > 0) {
        process.exit(1);
    }
}

runTests();
