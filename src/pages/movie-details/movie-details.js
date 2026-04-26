import { i18n } from '../../shared/i18n/I18n.js';
import '../../shared/services/SequelsParsingService.js';
import '../../shared/services/SimilarMoviesParsingService.js';
import '../../shared/services/TrailerParsingService.js';
import '../../shared/services/SeasonsParsingService.js';

// AniskipService.js is now lazy-loaded via LazyLoader when needed


/**
 * MovieDetailsManager - Controller for the movie details page
 * Handles movie details display, rating, and video playback
 * Migrated from SearchManager in search.js
 */
class MovieDetailsManager {
    constructor() {
        this.elements = this.initializeElements();
        this.selectedMovie = null;
        this.currentUser = null;
        this.currentRating = 0;
        this.isReviewVisible = false;
        this.parserRegistry = window.parserRegistry || new ParserRegistry();
        this.progressService = new ProgressService();
        this.availableCollections = [];
        
        // UI State Manager
        this.page = Utils.createPageStateManager({
            loader: document.getElementById('loadingState'),
            errorScreen: document.getElementById('errorState'),
            errorMessage: document.getElementById('errorMessage'),
            contentContainer: document.getElementById('movieDetailsContainer')
        });
        
        // Video player state
        this.isPlaying = false;
        this.currentVideoUrl = '';
        this.currentSources = [];
        this.currentHls = null;
        this.currentEpisodes = []; // Track episodes separately from sources/providers
        this.videoModalMovie = null;
        this.messageListenerSetup = false;
        this.playerRegistry = {};  // { [parserId]: { container, video, initialized, ready, sources, renderOptions } }
        this.activePlayerId = null; // parserId currently mounted in the modal
        this.preloadTimeout = null;
        
        this.sequelsService = new SequelsParsingService();
        this.similarMoviesService = new SimilarMoviesParsingService();
        this.trailerService = new TrailerParsingService();
        this.seasonsService = new SeasonsParsingService();
        this.aniskipService = null; // Lazy-loaded when video player opens
        this.currentSkipTimes = null; // Track current episode skip times
        this.currentEpisode = 1; // Track current episode for anime skip
        this.failedSequelImages = new Set(); // Track failures to avoid infinite loops
        this.failedSimilarImages = new Set(); // Track failed similar movie images
        
        // Spotify Service - lazy-loaded when Soundtrack tab opens
        this.spotifyService = null;

        // Embedded mode: when loaded inside a site's page via iframe
        const urlParams = new URLSearchParams(window.location.search);
        this.isEmbedded = urlParams.get('embedded') === 'true';

        this.setupEventListeners();
        this.init();
    }

    async init() {
        await i18n.init();
        i18n.translatePage();
        await this.initializeUI();

        
        // Listen for language changes
        chrome.runtime.onMessage.addListener((message) => {
            if (message.type === 'SETTINGS_UPDATED') {
                this.handleSettingsUpdate(message.settings);
            }
        });
    }

    async handleSettingsUpdate(settings) {
        if (settings.language && settings.language !== i18n.currentLocale) {
            await i18n.init();
            i18n.translatePage();
            if (this.selectedMovie) {
                await this.displayMovieDetails(this.selectedMovie);
            }
        }
    }

    initializeElements() {
        return {
            // Page containers
            movieDetailsContainer: document.getElementById('movieDetailsContainer'),
            loadingState: document.getElementById('loadingState'),
            errorState: document.getElementById('errorState'),
            errorMessage: document.getElementById('errorMessage'),
            backToSearchBtn: document.getElementById('backToSearchBtn'),
            
            // Rating Modal
            ratingModal: document.getElementById('ratingModal'),
            ratingMoviePoster: document.getElementById('ratingMoviePoster'),
            ratingMovieTitle: document.getElementById('ratingMovieTitle'),
            ratingMovieMeta: document.getElementById('ratingMovieMeta'),
            ratingStars: document.getElementById('ratingStars'),
            writeReviewBtn: document.getElementById('writeReviewBtn'),
            reviewContainer: document.getElementById('reviewContainer'),
            ratingComment: document.getElementById('ratingComment'),
            charCount: document.getElementById('charCount'),
            saveRatingBtn: document.getElementById('saveRatingBtn'),
            cancelRatingBtn: document.getElementById('cancelRatingBtn'),
            ratingModalClose: document.getElementById('ratingModalClose'),

            // Video Player Modal
            videoPlayerModal: document.getElementById('videoPlayerModal'),
            videoTitle: document.getElementById('videoTitle'),
            videoContainer: document.getElementById('videoContainer'),
            closeVideoBtn: document.getElementById('closeVideoBtn'),
            sourceButtonsContainer: document.getElementById('sourceButtonsContainer'),

            // Trailer Modal (Independent)
            trailerModal: document.getElementById('trailerModal'),
            trailerContainer: document.getElementById('trailerContainer'),
            playerPreloadContainer: (() => {
                let el = document.getElementById('player-preload-container');
                if (!el) {
                    el = document.createElement('div');
                    el.id = 'player-preload-container';
                    el.style.display = 'none';
                    document.body.appendChild(el);
                }
                return el;
            })(),
            trailerTitle: document.getElementById('trailerTitle'),
            closeTrailerBtn: document.getElementById('closeTrailerBtn'),

        };
    }

    initPlayerRegistry() {
        const parsers = this.parserRegistry.getAll();
        for (const parser of parsers) {
            if (this.playerRegistry[parser.id]) continue;
            
            const container = document.createElement('div');
            container.id = `player-preload-${parser.id}`;
            container.style.cssText = 'display:none; position:absolute; width:0; height:0; overflow:hidden;';
            document.body.appendChild(container);
            
            this.playerRegistry[parser.id] = {
                container,
                video: null,
                initialized: false,
                ready: false,
                parserId: parser.id,
                sources: null,
                renderOptions: null
            };
        }
    }

    setupEventListeners() {
        // Player resolution tracking
        if (this.elements.videoContainer) {
            const ro = new ResizeObserver(entries => {
                 if (!entries.length) return;
                 const { width, height } = entries[0].contentRect;
                 const childInfo = Array.from(this.elements.videoContainer.children)
                     .map(c => `${c.className || c.tagName}: ${c.getBoundingClientRect().height}px(h)`)
                     .join(', ');
                 console.log(`[playerResolution] videoContainer: ${width}x${height} | children: [${childInfo}]`);
            });
            ro.observe(this.elements.videoContainer);
            
            const childRo = new ResizeObserver(entries => {
                 for (let entry of entries) {
                      const { width, height } = entry.contentRect;
                      const c = entry.target;
                      console.log(`[playerResolution] child ${c.className || c.tagName}: ${width}x${height}`);
                 }
            });
            const mo = new MutationObserver(mutations => {
                 mutations.forEach(mutation => {
                     mutation.addedNodes.forEach(node => {
                         if (node.nodeType === 1) childRo.observe(node);
                     });
                 });
            });
            mo.observe(this.elements.videoContainer, { childList: true });
        }

        // Back button
        if (this.elements.backToSearchBtn) {
            this.elements.backToSearchBtn.addEventListener('mousedown', () => this.goBackToSearch());
        }
        
        // Rating Modal
        if (this.elements.ratingModalClose) {
            this.elements.ratingModalClose.addEventListener('mousedown', () => this.closeRatingModal());
        }
        if (this.elements.cancelRatingBtn) {
            this.elements.cancelRatingBtn.addEventListener('mousedown', () => this.closeRatingModal());
        }
        if (this.elements.ratingModal) {
            this.elements.ratingModal.addEventListener('mousedown', (e) => {
                if (e.target === this.elements.ratingModal) this.closeRatingModal();
            });
        }
        
        // Rating Stars
        if (this.elements.ratingStars) {
            this.elements.ratingStars.addEventListener('mouseover', (e) => {
                const btn = e.target.closest('.star-rating-btn');
                if (btn) {
                    const rating = parseInt(btn.dataset.rating);
                    this.updateStarVisuals(rating, true);
                }
            });

            this.elements.ratingStars.addEventListener('mouseout', () => {
                this.updateStarVisuals(this.currentRating, false);
            });

            this.elements.ratingStars.addEventListener('mousedown', (e) => {
                const btn = e.target.closest('.star-rating-btn');
                if (btn) {
                    e.preventDefault();
                    const rating = parseInt(btn.dataset.rating);
                    this.currentRating = rating;
                    this.updateStarVisuals(rating, false);
                }
            });
        }

        if (this.elements.writeReviewBtn) {
            this.elements.writeReviewBtn.addEventListener('mousedown', () => {
                this.isReviewVisible = !this.isReviewVisible;
                this.elements.reviewContainer.style.display = this.isReviewVisible ? 'block' : 'none';
                if (this.isReviewVisible) {
                    this.elements.ratingComment.focus();
                }
            });
        }

        if (this.elements.ratingComment && this.elements.charCount) {
            this.elements.ratingComment.addEventListener('input', (e) => {
                this.elements.charCount.textContent = e.target.value.length;
            });
        }
        
        if (this.elements.saveRatingBtn) {
            this.elements.saveRatingBtn.addEventListener('mousedown', () => this.saveRating());
        }

        // Video Player Modal
        if (this.elements.closeVideoBtn) {
            this.elements.closeVideoBtn.addEventListener('mousedown', () => this.closeVideoModal());
        }
        if (this.elements.videoPlayerModal) {
            this.elements.videoPlayerModal.addEventListener('mousedown', (e) => {
                if (e.target === this.elements.videoPlayerModal) this.closeVideoModal();
            });
        }
        if (this.elements.sourceButtonsContainer) {
            this.elements.sourceButtonsContainer.addEventListener('mousedown', (e) => {
                const btn = e.target.closest('.source-btn');
                if (btn) {
                    const value = btn.getAttribute('data-value');
                    if (value && !btn.classList.contains('active')) {
                        this.changeVideoSource(value);
                    }
                }
            });
        }

        // Trailer Modal Listeners
        if (this.elements.closeTrailerBtn) {
            this.elements.closeTrailerBtn.addEventListener('mousedown', () => this.closeTrailerModal());
        }
        if (this.elements.trailerModal) {
            this.elements.trailerModal.addEventListener('mousedown', (e) => {
                if (e.target === this.elements.trailerModal) this.closeTrailerModal();
            });
        }

        // Restore Player Button
        const restoreBtn = document.getElementById('restorePlayerBtn');
        if (restoreBtn) {
            restoreBtn.addEventListener('mousedown', (e) => {
                if (e.target.closest('.restore-close')) return; // Let the close handler handle it
                this.restorePlayer();
            });
            
            const closeRestoreBtn = document.getElementById('closeRestoreBtn');
            if (closeRestoreBtn) {
                closeRestoreBtn.addEventListener('mousedown', (e) => {
                    e.stopPropagation();
                    this.destroyPlayer();
                });
            }
        }

        // Tab navigation & Menu delegation
        Utils.bindTabsAndMenus(document);

        // Action buttons delegation
        document.addEventListener('mousedown', (e) => {
            // If it's not a left click, let the browser handle it (e.g. middle click for new tab)
            if (e.button !== 0) return;

            const actionBtn = e.target.closest('[data-action]');
            if (!actionBtn) return;
            
            const action = actionBtn.getAttribute('data-action');
            const movieId = actionBtn.getAttribute('data-movie-id');
            const ratingId = actionBtn.getAttribute('data-rating-id');
            const currentStatus = actionBtn.getAttribute('data-is-favorite') === 'true';
            
            if (action === 'toggle-favorite' && movieId) {
                this.toggleFavorite(ratingId, currentStatus, actionBtn, movieId);
            } else if (action === 'toggle-watching' && movieId) {
                this.handleWatchingToggle(movieId, actionBtn);
            } else if (action === 'toggle-watched' && movieId) {
                this.handleWatchedToggle(movieId, actionBtn);
            } else if (action === 'toggle-watchlist' && movieId) {
                this.handleWatchlistToggle(movieId, actionBtn);
            } else if (action === 'toggle-collection' && movieId) {
                const collectionId = actionBtn.getAttribute('data-collection-id');
                if (collectionId) this.handleToggleCollection(movieId, collectionId, actionBtn);
            }
        });

        // Rate and Watch button handlers
        document.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('rate-movie-btn') || e.target.closest('.rate-movie-btn')) {
                e.stopPropagation();
                if (this.selectedMovie) {
                    this.showRatingModal(this.selectedMovie);
                }
            }
            
            if (e.target.classList.contains('watch-movie-btn') || e.target.closest('.watch-movie-btn')) {
                e.stopPropagation();
                if (this.selectedMovie) {
                    this.handleWatchClick();
                }
            }
        });

        // Preload player on hover over watch button
        document.addEventListener('mouseenter', (e) => {
            if (!e.target || typeof e.target.closest !== 'function') return;
            const watchBtn = e.target.closest('.watch-movie-btn');
            if (watchBtn && this.selectedMovie) {
                if (this.preloadTimeout) {
                    clearTimeout(this.preloadTimeout);
                }
                this.preloadTimeout = setTimeout(() => {
                    const movieId = this.selectedMovie.kinopoiskId;
                    const hasInitialized = Object.values(this.playerRegistry).some(entry => entry.initialized);
                    if (!hasInitialized) {
                        this.preloadAllPlayers(movieId);
                    }
                }, 300);
            }
        }, true);

        document.addEventListener('mouseleave', (e) => {
            if (!e.target || typeof e.target.closest !== 'function') return;
            const watchBtn = e.target.closest('.watch-movie-btn');
            if (watchBtn && this.preloadTimeout) {
                clearTimeout(this.preloadTimeout);
                this.preloadTimeout = null;
            }
        }, true);

        this.setupImageErrorHandlers();
        this.initSelectionPopup();

        // Global spoiler reveal logic
        if (typeof Utils !== 'undefined') {
            Utils.bindSpoilerReveal(document);
        }
    }

    async initializeUI() {
        // Get movieId from URL
        const urlParams = new URLSearchParams(window.location.search);
        const movieId = urlParams.get('movieId');
        const autoplay = urlParams.get('autoplay') === 'true';

        // Embedded mode adjustments
        if (this.isEmbedded) {
            // Hide back button in embedded mode
            if (this.elements.backToSearchBtn) {
                this.elements.backToSearchBtn.style.display = 'none';
            }
        }

        // 1. Try to load from local cache IMMEDIATELY (bypass auth)
        let cachedLoaded = false;
        if (movieId) {
            cachedLoaded = this.loadCachedMovieImmediately(movieId);
        }

        // Wait for firebaseManager
        if (!window.firebaseManager) {
            await this.waitForFirebaseManager();
        }
        await firebaseManager.waitForAuthReady();
        
        const isAuth = firebaseManager.isAuthenticated();
        if (!isAuth) {
            this.page.showError(i18n.get('movie_details.login_required'));
            return;
        }
            // Pass !cachedLoaded to avoid showing loading spinner if we already have content
            // Pass cachedLoaded to skip re-render if we already displayed cached data
            // Pass !cachedLoaded to avoid showing loading spinner if we already have content
            // Pass cachedLoaded to skip re-render if we already displayed cached data
        
        this.currentUser = firebaseManager.getCurrentUser();
        
        // Load collections
        if (typeof CollectionService !== 'undefined') {
            this.collectionService = new CollectionService();
            try {
                this.availableCollections = await this.collectionService.getCollections();
            } catch (e) {
                console.error('Error loading collections:', e);
            }
        }
        
        if (movieId) {
            await this.loadMovieById(movieId, !cachedLoaded, cachedLoaded);
            this.initPlayerRegistry();
            if (this.selectedMovie) {
                this.preloadAllPlayers(movieId);
            }
            if (autoplay && this.selectedMovie) {
                setTimeout(() => this.handleWatchClick(), 500);
            }
        } else {
            this.page.showError(i18n.get('movie_details.not_found'));
        }
    }

    loadCachedMovieImmediately(movieId) {
        try {
            const localKey = `kp_movie_${movieId}`;
            const localData = localStorage.getItem(localKey);
            if (localData) {
                const movie = JSON.parse(localData);
                // console.log('MovieDetails: Loaded from instant cache', movieId);
                // Render immediately. displayMovieDetails handles missing currentUser gracefully.
                this.displayMovieDetails(movie);
                this.page.hideLoader(); 
                return true;
            }
        } catch (e) {
            console.warn('MovieDetails: Failed to load instant cache', e);
        }
        return false;
    }

    async waitForFirebaseManager() {
        return new Promise((resolve) => {
            if (window.firebaseManager && window.firebaseManager.isInitialized) {
                resolve();
                return;
            }
            
            const onReady = () => {
                window.removeEventListener('firebaseManagerReady', onReady);
                resolve();
            };
            window.addEventListener('firebaseManagerReady', onReady);
            
            let attempts = 0;
            const checkInterval = setInterval(() => {
                attempts++;
                if (window.firebaseManager && window.firebaseManager.isInitialized) {
                    clearInterval(checkInterval);
                    window.removeEventListener('firebaseManagerReady', onReady);
                    resolve();
                }
                if (attempts >= 50) {
                    clearInterval(checkInterval);
                    window.removeEventListener('firebaseManagerReady', onReady);
                    resolve();
                }
            }, 100);
        });
    }

    goBackToSearch() {
        // If embedded, signal parent to close and restore native player
        if (this.isEmbedded && window.parent !== window) {
            window.parent.postMessage({ type: 'CLOSE_EXTENSION_PLAYER' }, '*');
            return;
        }
        // Try to go back in history, otherwise go to search page
        if (window.history.length > 1) {
            window.history.back();
        } else {
            window.location.href = chrome.runtime.getURL('src/pages/search/search.html');
        }
    }

    async loadMovieById(movieId, shouldShowLoading = true, skipRender = false) {
        try {
            if (shouldShowLoading) {
                this.page.showLoader();
            }
            
            const kinopoiskService = firebaseManager.getKinopoiskService();
            const movieCacheService = firebaseManager.getMovieCacheService();
            
            let movie = await movieCacheService.getCachedMovie(movieId);
            const hasDetailedInfo = movie && (movie.budget || movie.fees?.world || (movie.persons && movie.persons.length > 0));
            
            if (!movie || !hasDetailedInfo) {
                movie = await kinopoiskService.getMovieById(movieId);
                if (movie) {
                    await movieCacheService.cacheMovie(movie);
                }
                // New data from API - must render even if cache was shown before
                skipRender = false;
            }
            
            if (!movie) {
                throw new Error('Movie not found');
            }
            
            // Parse awards in background
            if (!movie.awards || movie.awards.length === 0) {
                this.loadAwardsInBackground(movieId, movie);
            }
            
            // Get frames
            let hasNewFrames = false;
            if (!movie.frames || movie.frames.length === 0) {
                try {
                    const images = await kinopoiskService.getMovieImages(movieId);
                    if (images && images.length > 0) {
                        movie.frames = images;
                        hasNewFrames = true;
                    }
                } catch (e) {}
            }
            
            this.preloadSources(movie);

            if (skipRender) {
                // Cached content is already displayed. Just silently update the internal state
                // so that user actions (rate, bookmark) use the freshest data.
                this.selectedMovie = movie;
                
                // If we got new frames that weren't in the instant cache, update that section only
                if (hasNewFrames) {
                    this.updateFramesSection(movie);
                }
            } else {
                await this.displayMovieDetails(movie);
            }
            
            // Check if similar movies are missing and try fallback
            if (!movie.similarMovies || movie.similarMovies.length === 0) {
                this.loadFallbackSimilarMovies(movie);
            }
            
        } catch (error) {
            console.error('Error loading movie:', error);
            this.page.showError(`${i18n.get('movie_details.error_loading_movie') || 'Failed to load movie'}: ${error.message}`);
        } finally {
            this.page.hideLoader();
        }
    }

    /**
     * Update only the frames section without a full re-render
     */
    updateFramesSection(movie) {
        const framesContainer = this.elements.movieDetailsContainer.querySelector('.movie-frames-section');
        if (!framesContainer && movie.frames && movie.frames.length > 0) {
            // Frames section doesn't exist yet, but we have frames - we'd need a full re-render
            // to add the frames tab. For now, skip silently.
        }
    }

    async loadAwardsInBackground(movieId, movie) {
        try {
            const awardsParser = new AwardsParsingService();
            const awards = await awardsParser.getAwards(movieId);
            
            if (awards && awards.length > 0) {
                movie.awards = awards;
                this.updateAwardsUI(awards);
                
                // Update cache if available
                if (firebaseManager && firebaseManager.getMovieCacheService) {
                    const movieCacheService = firebaseManager.getMovieCacheService();
                    await movieCacheService.cacheMovie(movie);
                }
            }
        } catch (e) {
            console.warn('Background awards fetch failed', e);
        }
    }

    updateAwardsUI(awards) {
        // Update tab content
        const tabPane = document.getElementById('tab-awards');
        if (tabPane) {
            tabPane.innerHTML = this.renderAwardsTab(awards);
        }

        // Update tab button state
        const tabBtn = document.querySelector('.tab-btn[data-tab="awards"]');
        if (tabBtn) {
            if (awards && awards.length > 0) {
                tabBtn.classList.remove('disabled');
                tabBtn.removeAttribute('disabled');
                
                // If the user is somehow already on the awards tab (unlikely but possible if they clicked fast), nothing else needed as content is updated
            } else {
                tabBtn.classList.add('disabled');
                tabBtn.setAttribute('disabled', 'true');
            }
        }
        
        // Setup show all awards button event listener again since we replaced the HTML
        const showAllAwardsBtn = tabPane ? tabPane.querySelector('.btn-show-all-awards') : null;
        if (showAllAwardsBtn) {
            showAllAwardsBtn.addEventListener('mousedown', function() {
                this.style.display = 'none';
                const hiddenGrid = this.previousElementSibling;
                if (hiddenGrid && hiddenGrid.classList.contains('awards-grid-hidden')) {
                    hiddenGrid.style.display = 'grid';
                }
            });
        }
    }

    showContent() {
        this.page.showContent();
    }

    cleanupOldPlayerCache(currentMovieId) {
        const MAX_CACHE_SIZE = 5;
        const entries = Array.from(this.playerCache.entries());
        
        if (entries.length <= MAX_CACHE_SIZE) {
            return;
        }

        entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
        
        for (let i = MAX_CACHE_SIZE; i < entries.length; i++) {
            const [movieId, cached] = entries[i];
            if (movieId !== currentMovieId && cached.container && cached.container.parentNode) {
                cached.container.parentNode.removeChild(cached.container);
            }
            this.playerCache.delete(movieId);
        }
    }

    async displayMovieDetails(movie) {
        const previousMovieId = this.selectedMovie?.kinopoiskId;
        if (previousMovieId && previousMovieId !== movie.kinopoiskId) {
            this.cleanupOldPlayerCache(movie.kinopoiskId);
        }

        this.selectedMovie = movie;
        
        
        // Get user rating and status
        let userRating = null;
        let bookmarkStatus = null;
        
        if (this.currentUser) {
            try {
                const ratingService = firebaseManager.getRatingService();
                userRating = await ratingService.getRating(this.currentUser.uid, movie.kinopoiskId);
                
                const favoriteService = firebaseManager.getFavoriteService();
                const bookmark = await favoriteService.getBookmark(this.currentUser.uid, movie.kinopoiskId);
                if (bookmark) {
                    bookmarkStatus = bookmark.status;
                }
            } catch (error) {
                console.warn('Failed to load user data:', error);
            }
        }
        
        const movieHTML = this.createDetailedMovieCard(movie, userRating, bookmarkStatus);
        this.elements.movieDetailsContainer.innerHTML = movieHTML;
        
        // Setup show all awards button
        const showAllAwardsBtn = this.elements.movieDetailsContainer.querySelector('.btn-show-all-awards');
        if (showAllAwardsBtn) {
            showAllAwardsBtn.addEventListener('mousedown', function() {
                this.style.display = 'none';
                const hiddenGrid = this.previousElementSibling;
                if (hiddenGrid && hiddenGrid.classList.contains('awards-grid-hidden')) {
                    hiddenGrid.style.display = 'grid';
                }
            });
        }
        
        // Setup poster zoom listener
        const posterImg = this.elements.movieDetailsContainer.querySelector('.movie-detail-page-poster');
        if (posterImg && typeof window.ImageLightbox !== 'undefined') {
            posterImg.addEventListener('click', () => {
                window.ImageLightbox.show(posterImg.src);
            });
        }
        
        this.loadAndDisplayUserRatings(movie.kinopoiskId);
        
        if (this.currentUser) {
            setTimeout(() => this.updateButtonStates(), 200);
        }
        
        // Load similar movie posters in background
        if (movie.similarMovies && movie.similarMovies.length > 0) {
            this.loadSimilarMoviePosters(movie.similarMovies);
        }

        // Load Soundtrack - lazy-load SpotifyService when needed
        this.loadSoundtrack(movie);

        // Show content after everything is ready
        this.showContent();

        // Load Trailer
        const isSeries = movie.type && ['tv-series', 'mini-series', 'animated-series'].includes(movie.type);
        this.loadTrailer(movie.kinopoiskId, isSeries);
        
        if (isSeries) {
            this.loadSeasons(movie.kinopoiskId);
        }
    }

    createDetailedMovieCard(movie, userRating = null, bookmarkStatus = null) {
        const posterUrl = movie.posterUrl || '/icons/icon48.png';
        const year = movie.year || '';
        const genres = movie.genres?.join(', ') || '';
        const countries = movie.countries?.join(', ') || '';
        const kpRating = movie.kpRating || 0;
        const imdbRating = movie.imdbRating || 0;
        const duration = movie.duration || 0;
        const description = movie.description || i18n.get('movie_details.no_description') || 'Описание отсутствует';
        const votes = movie.votes?.kp || 0;
        const imdbVotes = movie.votes?.imdb || 0;
        
        const isEnglish = i18n.currentLocale === 'en';
        const movieName = (isEnglish && movie.alternativeName) ? movie.alternativeName : (movie.name || i18n.get('movie_card.unknown_movie'));
        const movieAltName = (isEnglish && movie.alternativeName) ? movie.name : (movie.alternativeName || '');
        
        const isFavorite = bookmarkStatus === 'favorite' || (userRating?.isFavorite === true);
        const isWatching = bookmarkStatus === 'watching';
        const isWatched = bookmarkStatus === 'watched';
        const isInWatchlist = bookmarkStatus === 'plan_to_watch';
        const ratingId = userRating?.id || null;
        
        const kinopoiskService = typeof window !== 'undefined' && window.kinopoiskService 
            ? window.kinopoiskService 
            : new KinopoiskService();
        
        const directors = kinopoiskService.getPersonsByProfession(movie.persons, 'DIRECTOR');
        const writers = kinopoiskService.getPersonsByProfession(movie.persons, 'WRITER');
        const producers = kinopoiskService.getPersonsByProfession(movie.persons, 'PRODUCER');
        const operators = kinopoiskService.getPersonsByProfession(movie.persons, 'OPERATOR');
        const composers = kinopoiskService.getPersonsByProfession(movie.persons, 'COMPOSER');
        const designers = kinopoiskService.getPersonsByProfession(movie.persons, 'DESIGNER');
        const editors = kinopoiskService.getPersonsByProfession(movie.persons, 'EDITOR');
        const actors = kinopoiskService.getPersonsByProfession(movie.persons, 'ACTOR');
        
        const directorsStr = kinopoiskService.formatPersonNames(directors);
        const writersStr = kinopoiskService.formatPersonNames(writers);
        const producersStr = kinopoiskService.formatPersonNames(producers);
        const operatorsStr = kinopoiskService.formatPersonNames(operators);
        const composersStr = kinopoiskService.formatPersonNames(composers);
        const designersStr = kinopoiskService.formatPersonNames(designers);
        const editorsStr = kinopoiskService.formatPersonNames(editors);
        
        const budgetStr = kinopoiskService.formatCurrency(movie.budget);
        const feesUsaStr = kinopoiskService.formatCurrency(movie.fees?.usa);
        const feesWorldStr = kinopoiskService.formatCurrency(movie.fees?.world);
        const feesRussiaStr = kinopoiskService.formatCurrency(movie.fees?.russia);
        
        let distributorStr = '';
        if (movie.distributors) {
            const distObj = Array.isArray(movie.distributors) ? movie.distributors[0] : movie.distributors;
            distributorStr = distObj?.distributor || distObj?.value || '';
        }

        const premiereRussiaStr = movie.premiere?.russia 
            ? kinopoiskService.formatDate(movie.premiere.russia) + (distributorStr ? `, «${distributorStr}»` : '')
            : '';
        const premiereWorldStr = movie.premiere?.world 
            ? kinopoiskService.formatDate(movie.premiere.world) 
            : '';

        // Localized labels for genres/countries inside card data
        const localizedGenres = movie.genres?.map(genre => {
            const entry = Object.entries(i18n.locales.ru.random.genres).find(([k, v]) => v.toLowerCase() === genre.toLowerCase());
            return entry ? i18n.get(`random.genres.${entry[0]}`) : genre;
        }).join(', ') || '';

        const localizedCountries = movie.countries?.map(country => {
            const entry = Object.entries(i18n.locales.ru.random.countries).find(([k, v]) => v.toLowerCase() === country.toLowerCase());
            return entry ? i18n.get(`random.countries.${entry[0]}`) : country;
        }).join(', ') || '';

        return `
            <div class="movie-detail-page">
                <div class="movie-detail-header">
                    <div class="movie-detail-poster-container">
                        <img src="${posterUrl}" alt="${movie.name}" class="movie-detail-page-poster" data-fallback="detail" decoding="async" fetchpriority="high">
                        <div class="movie-poster-placeholder" style="display: none;">🎬</div>
                        

                        <div class="movie-detail-ratings-container">
                            <div class="rating-item-large kp">
                                <span class="rating-label">${i18n.get('movie_card.kinopoisk')}</span>
                                <span class="rating-value">${parseFloat(kpRating.toFixed(1))}</span>
                                ${votes > 0 ? `<span class="rating-votes">${i18n.get('movie_details.votes_count').replace('{count}', this.formatVotes(votes))}</span>` : ''}
                            </div>
                            ${imdbRating > 0 ? `
                            <div class="rating-item-large imdb">
                                <span class="rating-label">${i18n.get('movie_card.imdb')}</span>
                                <span class="rating-value">${parseFloat(imdbRating.toFixed(1))}</span>
                                ${imdbVotes > 0 ? `<span class="rating-votes">${i18n.get('movie_details.votes_count').replace('{count}', this.formatVotes(imdbVotes))}</span>` : ''}
                            </div>` : ''}
                        </div>
                        
                        <div class="movie-actions-container">
                            <button class="btn btn-primary btn-lg watch-movie-btn" data-movie-id="${movie.kinopoiskId}">
                                <span class="btn-icon"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span>
                                ${i18n.get('movie_details.watch_movie')}
                            </button>
                            <button class="btn btn-accent btn-lg rate-movie-btn" data-movie-id="${movie.kinopoiskId}">
                                <span class="btn-icon"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg></span>
                                ${i18n.get('movie_details.rate_title')}
                            </button>
                        </div>
                    </div>
                    
                    <div class="movie-detail-info-container">
                        <div class="movie-detail-title-wrapper">
                            <h1 class="movie-detail-page-title">${this.escapeHtml(movieName)}</h1>
                            
                            <div class="mc-menu-container" style="position: relative; z-index: 20;">
                                <button class="mc-menu-btn" title="More options"><span class="mc-menu-icon">⋮</span></button>
                                <div class="mc-menu-dropdown">
                                    <button class="mc-menu-item ${isFavorite ? 'active' : ''}" data-action="toggle-favorite" 
                                            data-rating-id="${ratingId || 'null'}" 
                                            data-movie-id="${movie.kinopoiskId}"
                                            data-is-favorite="${isFavorite}">
                                        <span class="mc-menu-item-icon">${isFavorite ? '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>' : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>'}</span>
                                        <span class="mc-menu-item-text">${isFavorite ? i18n.get('movie_card.remove_favorite') : i18n.get('movie_card.add_favorite')}</span>
                                    </button>
                                    
                                    <button class="mc-menu-item ${isWatching ? 'active' : ''}" data-action="toggle-watching"
                                            data-movie-id="${movie.kinopoiskId}"
                                            data-is-watching="${isWatching}">
                                        <span class="mc-menu-item-icon"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg></span>
                                        <span class="mc-menu-item-text">${isWatching ? i18n.get('movie_card.remove_watching') : i18n.get('movie_card.add_watching')}</span>
                                    </button>

                                    <button class="mc-menu-item ${isWatched ? 'active' : ''}" data-action="toggle-watched"
                                            data-movie-id="${movie.kinopoiskId}"
                                            data-is-watched="${isWatched}">
                                        <span class="mc-menu-item-icon"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg></span>
                                        <span class="mc-menu-item-text">${isWatched ? i18n.get('movie_card.remove_watched') : i18n.get('movie_card.add_watched')}</span>
                                    </button>
                                    
                                    <button class="mc-menu-item ${isInWatchlist ? 'active' : ''}" data-action="toggle-watchlist"
                                            data-movie-id="${movie.kinopoiskId}"
                                            data-is-in-watchlist="${isInWatchlist}">
                                        <span class="mc-menu-item-icon">${isInWatchlist ? '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>' : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>'}</span>
                                        <span class="mc-menu-item-text">${isInWatchlist ? i18n.get('movie_card.remove_watchlist') : i18n.get('movie_card.add_watchlist')}</span>
                                    </button>
                                    
                                    ${this.renderCollectionsMenu(movie)}
                                </div>
                            </div>
                        </div>
                        ${movieAltName ? `<h2 class="movie-detail-alt-title">${this.escapeHtml(movieAltName)}</h2>` : ''}
                        
                        <div class="movie-tabs">
                            <div class="tab-buttons">
                                <button class="tab-btn active" data-tab="about">${i18n.get('movie_details.tabs.about')}</button>
                                <button class="tab-btn ${actors.length === 0 ? 'disabled' : ''}" data-tab="actors" ${actors.length === 0 ? 'disabled' : ''}>${i18n.get('movie_details.tabs.actors')}</button>
                                <button class="tab-btn ${!movie.awards || movie.awards.length === 0 ? 'disabled' : ''}" data-tab="awards" ${!movie.awards || movie.awards.length === 0 ? 'disabled' : ''}>${i18n.get('movie_details.tabs.awards')}</button>
                                <button class="tab-btn" data-tab="seasons" style="display: none;">Сезоны</button>
                                <button class="tab-btn" data-tab="soundtrack">Саундтрек</button>
                            </div>
                            
                            <div class="tab-content">
                                <div class="tab-pane active" id="tab-about">
                                    <div class="movie-detail-meta-grid">
                                        <div class="meta-item"><span class="meta-label">${i18n.get('movie_details.meta.year')}</span><span class="meta-value">${year}</span></div>
                                        ${localizedCountries ? `<div class="meta-item"><span class="meta-label">${i18n.get('movie_details.meta.country')}</span><span class="meta-value">${localizedCountries}</span></div>` : ''}
                                        <div class="meta-item"><span class="meta-label">${i18n.get('movie_details.meta.genre')}</span><span class="meta-value">${localizedGenres}</span></div>
                                        <div class="meta-item"><span class="meta-label">${i18n.get('movie_details.meta.slogan')}</span><span class="meta-value">${movie.slogan ? `«${this.escapeHtml(movie.slogan)}»` : '—'}</span></div>
                                        ${directorsStr ? `<div class="meta-item"><span class="meta-label">${i18n.get('movie_details.meta.director')}</span><span class="meta-value">${this.escapeHtml(directorsStr)}</span></div>` : ''}
                                        ${writersStr ? `<div class="meta-item"><span class="meta-label">${i18n.get('movie_details.meta.writer')}</span><span class="meta-value">${this.escapeHtml(writersStr)}</span></div>` : ''}
                                        ${producersStr ? `<div class="meta-item"><span class="meta-label">${i18n.get('movie_details.meta.producer')}</span><span class="meta-value">${this.escapeHtml(producersStr)}</span></div>` : ''}
                                        ${operatorsStr ? `<div class="meta-item"><span class="meta-label">${i18n.get('movie_details.meta.operator')}</span><span class="meta-value">${this.escapeHtml(operatorsStr)}</span></div>` : ''}
                                        ${composersStr ? `<div class="meta-item"><span class="meta-label">${i18n.get('movie_details.meta.composer')}</span><span class="meta-value">${this.escapeHtml(composersStr)}</span></div>` : ''}
                                        ${designersStr ? `<div class="meta-item"><span class="meta-label">${i18n.get('movie_details.meta.designer')}</span><span class="meta-value">${this.escapeHtml(designersStr)}</span></div>` : ''}
                                        ${editorsStr ? `<div class="meta-item"><span class="meta-label">${i18n.get('movie_details.meta.editor')}</span><span class="meta-value">${this.escapeHtml(editorsStr)}</span></div>` : ''}
                                        ${budgetStr ? `<div class="meta-item"><span class="meta-label">${i18n.get('movie_details.meta.budget')}</span><span class="meta-value">${budgetStr}</span></div>` : ''}
                                        ${feesUsaStr ? `<div class="meta-item"><span class="meta-label">${i18n.get('movie_details.meta.fees_usa')}</span><span class="meta-value">${feesUsaStr}</span></div>` : ''}
                                        ${feesWorldStr ? `<div class="meta-item"><span class="meta-label">${i18n.get('movie_details.meta.fees_world')}</span><span class="meta-value">${feesWorldStr}</span></div>` : ''}
                                        ${feesRussiaStr ? `<div class="meta-item"><span class="meta-label">${i18n.get('movie_details.meta.fees_russia')}</span><span class="meta-value">${feesRussiaStr}</span></div>` : ''}
                                        ${premiereRussiaStr ? `<div class="meta-item"><span class="meta-label">${i18n.get('movie_details.meta.premiere_russia')}</span><span class="meta-value">${premiereRussiaStr}</span></div>` : ''}
                                        ${premiereWorldStr ? `<div class="meta-item"><span class="meta-label">${i18n.get('movie_details.meta.premiere_world')}</span><span class="meta-value">${premiereWorldStr}</span></div>` : ''}
                                        ${movie.ageRating ? `<div class="meta-item"><span class="meta-label">${i18n.get('movie_details.meta.age_rating')}</span><span class="meta-value">${movie.ageRating}+</span></div>` : ''}
                                        ${duration ? `<div class="meta-item"><span class="meta-label">${i18n.get('movie_details.meta.duration')}</span><span class="meta-value">${Math.floor(duration / 60)} ${i18n.get('movie_details.meta.hours')} ${duration % 60} ${i18n.get('movie_details.meta.minutes')}</span></div>` : ''}
                                    </div>
                                </div>
                                
                                <div class="tab-pane" id="tab-actors">
                                    ${this.renderActorsTab(actors)}
                                </div>
                                
                                <div class="tab-pane" id="tab-awards">
                                    ${this.renderAwardsTab(movie.awards)}
                                </div>
                                
                                <div class="tab-pane" id="tab-seasons">
                                    <div class="no-data-placeholder">Загрузка...</div>
                                </div>

                                <div class="tab-pane" id="tab-soundtrack">
                                    <div id="soundtrackContainer" class="soundtrack-container">
                                        <div class="soundtrack-placeholder">Поиск саундтрека...</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="movie-detail-description">
                    <h3>${i18n.get('movie_details.description')}</h3>
                    <p>${this.escapeHtml(description)}</p>
                    ${this.renderSequelsAndPrequels(movie.sequelsAndPrequels)}
                    ${this.renderSimilarMovies(movie.similarMovies)}
                    ${this.createMovieFramesSection(movie)}
                    <div id="userRatingsSection" class="user-ratings-section" data-movie-id="${movie.kinopoiskId}">
                        <div class="user-ratings-loading" style="display: none;">
                            <div class="loading-spinner"></div>
                            <span>${i18n.get('movie_details.loading_reviews')}</span>
                        </div>
                        <div class="user-ratings-content"></div>
                    </div>
                </div>
            </div>
        `;
    }

    async loadSoundtrack(movie) {
        // Lazy-load SpotifyService if not yet loaded
        if (!this.spotifyService) {
            try {
                await LazyLoader.loadScript('../../shared/config/spotify.config.js');
                await LazyLoader.loadScript('../../shared/services/SpotifyService.js');
                if (typeof SpotifyService !== 'undefined') {
                    this.spotifyService = new SpotifyService();
                } else {
                    return; // SpotifyService not available
                }
            } catch (e) {
                console.warn('[MovieDetails] Failed to load SpotifyService:', e.message);
                return;
            }
        }

        const container = document.getElementById('soundtrackContainer');
        
        if (!container) return;
        
        try {
            // Priority: originalName (native) > alternativeName (usually English) > enName > name (Russian)
            const searchTitle = movie.originalName || movie.alternativeName || movie.enName || movie.name;
            const year = movie.year;
            
            const uri = await this.spotifyService.searchSoundtrack(searchTitle, year);
            
            if (uri) {
                const embedUrl = this.spotifyService.getEmbedUrl(uri);
                container.innerHTML = `
                    <iframe src="${embedUrl}" 
                            width="100%" 
                            height="380" 
                            frameBorder="0" 
                            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" 
                            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" 
                            loading="lazy">
                    </iframe>`;
            } else {
                container.innerHTML = `<span class="soundtrack-placeholder">Саундтрек не найден</span>`;
            }
        } catch (error) {
            console.error('Error loading soundtrack:', error);
            container.innerHTML = `<span class="soundtrack-placeholder">Саундтрек недоступен</span>`;
        }
    }

    renderCollectionsMenu(movie) {
        if (!this.availableCollections || this.availableCollections.length === 0) return '';
        
        return `
            <div class="mc-menu-divider"></div>
            <div class="mc-menu-collections">
                ${this.availableCollections.map(col => {
                    const isInCollection = col.movieIds && (col.movieIds.includes(Number(movie.kinopoiskId)) || col.movieIds.includes(String(movie.kinopoiskId)));
                    const isCustomIcon = col.icon && (col.icon.startsWith('data:') || col.icon.startsWith('https://'));
                    const iconHtml = isCustomIcon 
                        ? `<img src="${col.icon}" style="width: 16px; height: 16px; object-fit: cover; border-radius: 4px;">`
                        : (col.icon || '📁');
                    return `
                        <button class="mc-menu-item" data-action="toggle-collection"
                                data-movie-id="${movie.kinopoiskId}"
                                data-collection-id="${col.id}">
                            <span class="mc-menu-item-icon">${iconHtml}</span>
                            <span class="mc-menu-item-text" style="${isInCollection ? 'font-weight: 500; color: #fff;' : ''}">${col.name}</span>
                            ${isInCollection ? '<span style="margin-left: auto; font-weight: bold; color: var(--accent-color, #4CAF50);">✓</span>' : ''}
                        </button>
                    `;
                }).join('')}
            </div>
        `;
    }

    renderSequelsAndPrequels(sequels) {
        if (!sequels || sequels.length === 0) return '';
        
        return `
            <div class="sequels-section">
                <h3>${i18n.get('movie_details.sequels') || 'Сиквелы и приквелы'}</h3>
                <div class="sequels-container">
                    ${sequels.map(movie => {
                        const posterUrl = movie.poster?.previewUrl || movie.poster?.url || '/icons/icon48.png';
                        let name = (i18n.currentLocale === 'en' && movie.enName) ? movie.enName : (movie.name || movie.alternativeName || i18n.get('movie_card.unknown_movie'));
                        
                        // Fallback logic for name if it's missing (rare but possible)
                        if (!name && movie.alternativeName) name = movie.alternativeName;
                        if (!name && movie.enName) name = movie.enName;
                        
                        // Year handling - sometimes it's missing in the simplified object
                        const year = movie.year || (movie.releaseYears && movie.releaseYears.length > 0 ? movie.releaseYears[0].start : '') || '';
                        const movieId = movie.id || movie.filmId || movie.kinopoiskId;
                        
                        return `
                        <a href="movie-details.html?movieId=${movieId}" class="sequel-card">
                            <div class="sequel-poster-container">
                                <img src="${posterUrl}" 
                                     alt="${this.escapeHtml(name)}" 
                                     class="sequel-poster" 
                                     loading="lazy" 
                                     decoding="async"
                                     data-fallback="sequel-poster"
                                     data-sequel-id="${movieId}"
                                     data-year="${year}">
                            </div>
                            <div class="sequel-info">
                                <span class="sequel-year">${year}</span>
                                <span class="sequel-title" title="${this.escapeHtml(name)}">${this.escapeHtml(name)}</span>
                            </div>
                        </a>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    renderSimilarMovies(similarMovies) {
        if (!similarMovies || similarMovies.length === 0) return '';
        
        return `
            <div class="similar-movies-section">
                <h3>${i18n.get('movie_details.similar_movies') || 'Похожие фильмы'}</h3>
                <div class="similar-movies-container">
                    ${similarMovies.map(movie => {
                        const posterUrl = movie.poster?.previewUrl || movie.poster?.url || '/icons/icon48.png';
                        let name = (i18n.currentLocale === 'en' && movie.enName) ? movie.enName : (movie.name || movie.alternativeName || i18n.get('movie_card.unknown_movie'));
                        
                        // Fallback logic for name if it's missing
                        if (!name && movie.alternativeName) name = movie.alternativeName;
                        if (!name && movie.enName) name = movie.enName;
                        
                        // Year handling
                        const year = movie.year || (movie.releaseYears && movie.releaseYears.length > 0 ? movie.releaseYears[0].start : '') || '';
                        
                        const movieId = movie.id || movie.filmId || movie.kinopoiskId;
                        return `
                        <a href="movie-details.html?movieId=${movieId}" class="sequel-card">
                            <div class="sequel-poster-container">
                                <img src="${posterUrl}" alt="${this.escapeHtml(name)}" class="sequel-poster" loading="lazy" decoding="async" data-fallback="similar-poster" data-similar-id="${movieId}">
                            </div>
                            <div class="sequel-info">
                                <span class="sequel-year">${year}</span>
                                <span class="sequel-title" title="${this.escapeHtml(name)}">${this.escapeHtml(name)}</span>
                            </div>
                        </a>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    /**
     * Fallback mechanism to load similar movies if API returns empty list
     */
    async loadFallbackSimilarMovies(movie) {
        if (!movie) return;
        
        // console.log('[MovieDetails] Similar movies missing, attempting fallback fetch...');
        
        try {
            // 1. Try parsing from the website first (most accurate "similar" recommendations)
            if (this.similarMoviesService) {
                const parsedSimilar = await this.similarMoviesService.getSimilarMovies(movie.kinopoiskId);
                
                if (parsedSimilar && parsedSimilar.length > 0) {
                     // console.log(`[MovieDetails] Website parsing found ${parsedSimilar.length} similar movies`);
                     this.applySimilarMovies(movie, parsedSimilar);
                     return;
                }
            }

            // 2. Fallback to API filter search (genres/year) if parsing failed or returned nothing
            if (!movie.genres || movie.genres.length === 0) return;

            const kinopoiskService = firebaseManager.getKinopoiskService();
            
            // Take up to 2 genres for better matching
            const genres = movie.genres.slice(0, 2);
            const isCartoon = movie.genres.includes('мультфильм') || movie.genres.includes('cartoon');
            
            const filters = {
                genres: genres,
                year: `${Math.max(1990, (movie.year || 2020) - 10)}-${new Date().getFullYear()}`,
                excludeId: movie.kinopoiskId
            };

            // If it's NOT a cartoon, exclude cartoons
            if (!isCartoon) {
                filters.excludeGenres = ['мультфильм'];
            }
            
            const result = await kinopoiskService.getMoviesByFilters(filters, 1, 10);
            
            if (result.docs && result.docs.length > 0) {
                // Filter out the current movie ID client-side
                const similar = result.docs
                    .filter(m => m.kinopoiskId !== movie.kinopoiskId)
                    .slice(0, 10);
                
                if (similar.length > 0) {
                    // console.log(`[MovieDetails] Genre fallback found ${similar.length} similar movies`);
                    this.applySimilarMovies(movie, similar);
                }
            }
        } catch (error) {
            console.warn('[MovieDetails] Failed to load fallback similar movies:', error);
        }
    }

    applySimilarMovies(movie, similarMovies) {
        if (!similarMovies || similarMovies.length === 0) return;
        
        movie.similarMovies = similarMovies;
        const movieCacheService = firebaseManager.getMovieCacheService();
        
        // Update UI
        const container = this.elements.movieDetailsContainer.querySelector('.similar-movies-section');
        if (container) {
            container.outerHTML = this.renderSimilarMovies(similarMovies);
        } else {
            // Insert logic
            const sequelsSection = this.elements.movieDetailsContainer.querySelector('.sequels-section');
            const descriptionSection = this.elements.movieDetailsContainer.querySelector('.movie-detail-description');
            
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = this.renderSimilarMovies(similarMovies);
            
            if (sequelsSection) {
                sequelsSection.after(tempDiv.firstElementChild);
            } else if (descriptionSection) {
                const framesSection = descriptionSection.querySelector('.movie-frames-section');
                if (framesSection) {
                    framesSection.before(tempDiv.firstElementChild);
                } else {
                    descriptionSection.appendChild(tempDiv.firstElementChild);
                }
            }
        }
        
        // Trigger poster loading (if needed, though parsed ones usually have URLs)
        // Only load if URLs are missing or low quality logic requires it
        const needsPosters = similarMovies.filter(m => !m.posterUrl);
        if (needsPosters.length > 0) {
             this.loadSimilarMoviePosters(needsPosters);
        }
        
        // Update cache
        if (movieCacheService) {
            movieCacheService.cacheMovie(movie);
        }
    }

    /**
     * Load high-quality posters for similar movies in background
     * @param {Array} similarMovies - Array of similar movie objects
     */
    async loadSimilarMoviePosters(similarMovies) {
        if (!this.similarMoviesService || !similarMovies || similarMovies.length === 0) {
            return;
        }

        // console.log('[MovieDetails] Loading similar movie posters in background...');

        try {
            const posterMap = await this.similarMoviesService.getPostersForMovies(similarMovies);
            
            // Update DOM images with loaded posters
            posterMap.forEach((posterUrl, filmId) => {
                const img = document.querySelector(`img[data-similar-id="${filmId}"]`);
                if (img && posterUrl && !this.failedSimilarImages.has(filmId)) {
                    // console.log(`[MovieDetails] Updating poster for similar movie ${filmId}`);
                    img.src = posterUrl;
                }
            });
        } catch (error) {
            console.warn('[MovieDetails] Error loading similar movie posters:', error);
        }
    }

    renderActorsTab(actors) {
        if (!actors || actors.length === 0) {
            return `<div class="no-data-placeholder"><p>${i18n.get('movie_details.actors_tab.no_data')}</p></div>`;
        }
        
        return `
            <div class="actors-grid">
                ${actors.map(actor => {
                    const photoUrl = actor.photo || '';
                    const isEnglish = i18n.currentLocale === 'en';
                    const name = (isEnglish && actor.enName) ? actor.enName : (actor.name || actor.enName || i18n.get('movie_details.actors_tab.unknown'));
                    const role = actor.description || (actor.enProfession ? i18n.get(`movie_details.profession.${actor.enProfession.toLowerCase()}`) : '');
                    return `
                        <div class="actor-card">
                            <div class="actor-photo-container">
                                ${photoUrl ? `<img src="${photoUrl}" alt="${this.escapeHtml(name)}" class="actor-photo" loading="lazy" decoding="async">` : '<div class="actor-placeholder">🎭</div>'}
                            </div>
                            <div class="actor-info">
                                <div class="actor-name">${this.escapeHtml(name)}</div>
                                <div class="actor-role">${this.escapeHtml(role)}</div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    renderAwardsTab(awards) {
        if (!awards || awards.length === 0) {
            return `<div class="no-data-placeholder"><p>${i18n.get('movie_details.awards_tab.no_data')}</p></div>`;
        }
        
        const notableAwards = awards.sort((a, b) => (b.win ? 1 : 0) - (a.win ? 1 : 0));
        const hasMoreThan6 = notableAwards.length > 6;
        const initialAwards = hasMoreThan6 ? notableAwards.slice(0, 6) : notableAwards;
        const hiddenAwards = hasMoreThan6 ? notableAwards.slice(6) : [];

        const getAwardIcon = (name) => {
            if (name.includes('Оскар')) return '<img src="../../../icons/oscar.png" alt="Oscar" class="award-icon-img">';
            if (name.includes('Золотой глобус')) return '<img src="../../../icons/golden-globe.png" alt="Golden Globe" class="award-icon-img">';
            return '';
        };

        const renderAwardCard = (award) => `
            <div class="award-card">
                <div class="award-icon-container">${getAwardIcon(award.name || '')}</div>
                <div class="award-title">${this.escapeHtml(award.name)}</div>
                <div class="award-nomination">${this.escapeHtml(award.nominationName || i18n.get('movie_details.awards_tab.nomination'))}</div>
                <div class="award-badge ${award.win ? 'winner' : 'nominee'}">${award.win ? i18n.get('movie_details.awards_tab.winner') : i18n.get('movie_details.awards_tab.nominee')}</div>
            </div>
        `;

        return `
            <div class="awards-grid">${initialAwards.map(renderAwardCard).join('')}</div>
            ${hasMoreThan6 ? `
                <div class="awards-grid awards-grid-hidden" style="display: none;">${hiddenAwards.map(renderAwardCard).join('')}</div>
                <button class="btn-show-all-awards">${i18n.get('movie_details.awards_tab.show_all').replace('{count}', notableAwards.length)}</button>
            ` : ''}
        `;
    }

    createMovieFramesSection(movie) {
        let frames = movie.frames || movie.images || movie.backdrop || [];
        if (!frames.length && movie.posterUrl) {
            frames = [{ url: movie.posterUrl, type: 'poster' }];
        }
        if (!frames.length) return '';

        const displayFrames = frames.slice(0, 6);
        movie.displayFrames = displayFrames;

        const framesHTML = displayFrames.map((frame, index) => {
            const frameUrl = typeof frame === 'string' ? frame : (frame.url || frame.previewUrl || '');
            if (!frameUrl) return '';
            return `<div class="movie-frame" data-frame-url="${frameUrl}" data-frame-index="${index}"><img src="${frameUrl}" alt="Кадр" class="movie-frame-image" loading="lazy" decoding="async" data-fallback="frame"></div>`;
        }).join('');

        return framesHTML ? `<div class="movie-frames-section"><h4>${i18n.get('movie_details.frames')}</h4><div class="movie-frames-grid">${framesHTML}</div></div>` : '';
    }

    async loadAndDisplayUserRatings(movieId) {
        const ratingsSection = document.getElementById('userRatingsSection');
        if (!ratingsSection) return;
        
        const loadingEl = ratingsSection.querySelector('.user-ratings-loading');
        const contentEl = ratingsSection.querySelector('.user-ratings-content');
        
        try {
            loadingEl.style.display = 'flex';
            contentEl.innerHTML = '';
            
            const ratingService = firebaseManager.getRatingService();
            const userService = firebaseManager.getUserService();
            const currentUser = firebaseManager.getCurrentUser();
            
            const ratings = await ratingService.getMovieRatings(parseInt(movieId), 50);
            
            if (ratings.length === 0) {
                contentEl.innerHTML = `<div class="user-ratings-empty"><p>${i18n.get('movie_details.empty_reviews')}</p></div>`;
                loadingEl.style.display = 'none';
                return;
            }
            
            const userIds = [...new Set(ratings.map(r => r.userId))];
            const userProfiles = await userService.getUserProfilesByIds(userIds);
            const userProfileMap = new Map(userProfiles.map(u => [u.userId || u.id, u]));
            
            if (currentUser) {
                const currentUserProfile = await userService.getUserProfile(currentUser.uid);
                if (currentUserProfile) userProfileMap.set(currentUser.uid, currentUserProfile);
            }
            
            contentEl.innerHTML = this.createUserRatingsSection(ratings, userProfileMap, currentUser?.uid);
            this.setupRatingMenuListeners();
            this.setupUsernameClickListeners();
            
        } catch (error) {
            console.error('Error loading user ratings:', error);
            contentEl.innerHTML = `<div class="user-ratings-error"><p>${i18n.get('movie_details.error_loading_reviews')}</p></div>`;
        } finally {
            loadingEl.style.display = 'none';
        }
    }

    createUserRatingsSection(ratings, userProfileMap, currentUserId) {
        if (ratings.length === 0) return `<div class="user-ratings-empty"><p>${i18n.get('movie_details.be_first')}</p></div>`;
        
        const ratingsHTML = ratings.map(rating => {
            const userProfile = userProfileMap.get(rating.userId);
            const userName = userProfile?.displayName || rating.userName || i18n.get('navbar.sign_in').replace('Sign In', 'User').replace('Войти', 'Пользователь'); 
            const userPhoto = userProfile?.photoURL || '/icons/icon48.png';
            const isCurrentUser = currentUserId && rating.userId === currentUserId;
            
            let dateStr = '';
            if (rating.createdAt) {
                const dateObj = rating.createdAt.toDate ? rating.createdAt.toDate() : new Date(rating.createdAt);
                if (!isNaN(dateObj.getTime())) {
                    const d = dateObj.getDate().toString().padStart(2, '0');
                    const m = (dateObj.getMonth() + 1).toString().padStart(2, '0');
                    const y = dateObj.getFullYear();
                    dateStr = `<span class="user-rating-date">${d}.${m}.${y}</span>`;
                }
            }
            
            return `
                <div class="user-rating-card ${isCurrentUser ? 'current-user' : ''}" data-rating-id="${rating.id}">
                    <div class="user-rating-header">
                        <img src="${userPhoto}" alt="${this.escapeHtml(userName)}" class="user-rating-avatar" loading="lazy" decoding="async" onerror="this.src='/icons/icon48.png'">
                        <div class="user-rating-info">
                            <div class="user-rating-name-row">
                                <span class="user-rating-name clickable-username" data-user-id="${rating.userId}">${this.escapeHtml(userName)}</span>
                                ${dateStr}
                            </div>
                            <div class="user-rating-score">⭐ ${rating.rating}/10</div>
                        </div>
                        ${isCurrentUser ? `
                            <div class="user-rating-menu">
                                <button class="user-rating-menu-btn" data-rating-id="${rating.id}"><span>⋯</span></button>
                                <div class="user-rating-menu-dropdown" id="menu-${rating.id}" style="display: none;">
                                    <button class="menu-item" data-rating-id="${rating.id}" data-action="edit"><span class="menu-icon">✏️</span><span>${i18n.get('movie_details.edit')}</span></button>
                                    <button class="menu-item delete-item" data-rating-id="${rating.id}" data-action="delete"><span class="menu-icon">🗑️</span><span>${i18n.get('movie_details.delete')}</span></button>
                                </div>
                            </div>
                        ` : ''}
                    </div>
                    ${rating.comment ? `<div class="user-rating-comment">${Utils.parseSpoilers(this.escapeHtml(rating.comment))}</div>` : ''}
                </div>
            `;
        }).join('');
        
        return `<div class="user-ratings-container"><h4 class="user-ratings-title">${i18n.get('movie_details.user_ratings_title')}</h4><div class="user-ratings-list">${ratingsHTML}</div></div>`;
    }

    setupRatingMenuListeners() {
        document.querySelectorAll('.user-rating-menu-btn').forEach(btn => {
            btn.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                const ratingId = btn.getAttribute('data-rating-id');
                const menu = document.getElementById(`menu-${ratingId}`);
                
                // Close other menus
                document.querySelectorAll('.user-rating-menu-dropdown').forEach(m => {
                    if (m.id !== `menu-${ratingId}`) m.style.display = 'none';
                });

                if (menu) {
                    const isVisible = menu.style.display === 'block';
                    if (!isVisible) {
                        // Position the menu relative to the button
                        const rect = btn.getBoundingClientRect();
                        menu.style.top = `${rect.bottom + 5}px`;
                        menu.style.left = `${rect.right - 160}px`; // 160 is min-width
                        menu.style.display = 'block';
                    } else {
                        menu.style.display = 'none';
                    }
                }
            });
        });

        document.querySelectorAll('.user-rating-menu-dropdown .menu-item').forEach(item => {
            item.addEventListener('mousedown', async (e) => {
                e.stopPropagation();
                const ratingId = item.getAttribute('data-rating-id');
                const action = item.getAttribute('data-action');
                document.getElementById(`menu-${ratingId}`)?.style && (document.getElementById(`menu-${ratingId}`).style.display = 'none');
                
                if (action === 'edit') this.showRatingModal(this.selectedMovie);
                else if (action === 'delete') this.deleteUserRating(ratingId);
            });
        });
    }

    setupUsernameClickListeners() {
        document.querySelectorAll('.clickable-username').forEach(el => {
            el.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                const userId = el.getAttribute('data-user-id');
                if (userId) {
                    e.preventDefault();
                    window.location.href = chrome.runtime.getURL(`src/pages/profile/profile.html?userId=${userId}`);
                }
            });
        });
    }

    async deleteUserRating(ratingId) {
        if (!confirm('Удалить отзыв?')) return;
        try {
            const ratingService = firebaseManager.getRatingService();
            await ratingService.deleteRating(this.currentUser.uid, ratingId);
            document.querySelector(`[data-rating-id="${ratingId}"]`)?.remove();
            if (typeof Utils !== 'undefined') Utils.showToast('Отзыв удален', 'success');
            this.loadAndDisplayUserRatings(this.selectedMovie.kinopoiskId);
        } catch (error) {
            console.error('Error deleting rating:', error);
        }
    }

    // Rating Modal Methods
    async showRatingModal(movie) {
        this.selectedMovie = movie;
        const currentUser = firebaseManager.getCurrentUser();
        if (!currentUser) { this.showError('Войдите в систему'); return; }
        this.currentUser = currentUser;
        
        this.elements.ratingMoviePoster.src = movie.posterUrl || '/icons/icon48.png';
        this.elements.ratingMovieTitle.textContent = movie.name;
        this.elements.ratingMovieMeta.textContent = `${movie.year} • ${movie.genres?.slice(0, 3).join(', ')}`;
        
        this.elements.ratingStars.innerHTML = '';
        const starSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;
        for (let i = 1; i <= 10; i++) {
            const btn = document.createElement('button');
            btn.className = 'star-rating-btn';
            btn.dataset.rating = i;
            btn.innerHTML = starSvg;
            this.elements.ratingStars.appendChild(btn);
        }
        
        const ratingService = firebaseManager.getRatingService();
        const existingRating = await ratingService.getRating(currentUser.uid, movie.kinopoiskId);
        
        if (existingRating) {
            this.currentRating = existingRating.rating;
            this.updateStarVisuals(this.currentRating, false);
            this.elements.ratingComment.value = existingRating.comment || '';
            this.elements.charCount.textContent = (existingRating.comment || '').length;
            this.isReviewVisible = !!existingRating.comment;
            this.elements.reviewContainer.style.display = this.isReviewVisible ? 'block' : 'none';
        } else {
            this.currentRating = 0;
            this.updateStarVisuals(0, false);
            this.elements.ratingComment.value = '';
            this.elements.charCount.textContent = '0';
            this.isReviewVisible = false;
            this.elements.reviewContainer.style.display = 'none';
        }
        
        this.elements.ratingModal.style.display = 'flex';
    }

    closeRatingModal() {
        this.elements.ratingModal.style.display = 'none';
        this.currentRating = 0;
    }

    async saveRating() {
        try {
            const currentUser = firebaseManager.getCurrentUser();
            if (!currentUser) { this.showError('Войдите в систему'); return; }
            
            if (!this.currentRating || this.currentRating < 1) {
                if (typeof Utils !== 'undefined') Utils.showToast('Выберите оценку', 'warning');
                return;
            }
            
            const ratingService = firebaseManager.getRatingService();
            const userService = firebaseManager.getUserService();
            const userProfile = await userService.getUserProfile(currentUser.uid);
            const displayName = userProfile?.displayName || currentUser.displayName || currentUser.email;
            
            await ratingService.addOrUpdateRating(
                currentUser.uid, displayName, userProfile?.photoURL || '',
                this.selectedMovie.kinopoiskId, this.currentRating,
                this.elements.ratingComment.value.trim(), this.selectedMovie
            );
            
            this.closeRatingModal();
            if (typeof Utils !== 'undefined') Utils.showToast('Оценка сохранена!', 'success');
            this.loadAndDisplayUserRatings(this.selectedMovie.kinopoiskId);
            await this.loadMovieById(this.selectedMovie.kinopoiskId);
        } catch (error) {
            console.error('Error saving rating:', error);
        }
    }

    updateStarVisuals(rating, isHover) {
        const buttons = this.elements.ratingStars.querySelectorAll('.star-rating-btn');
        buttons.forEach(btn => {
            const starRating = parseInt(btn.dataset.rating);
            if (starRating <= rating) {
                btn.classList.add(isHover ? 'hover' : 'active');
                if (isHover) btn.classList.remove('active');
            } else {
                btn.classList.remove('active', 'hover');
            }
        });
    }

    // Video Player Methods
    async preloadSources(movie) {
        if (!movie) return;
        console.log(`[DEBUG preloadSources] Starting for: ${movie.name} (${movie.kinopoiskId})`);
        const cached = this.getCachedSources(movie.kinopoiskId);
        if (cached) { 
            console.log(`[DEBUG preloadSources] Cache HIT for ${movie.kinopoiskId}. Sources count: ${cached.length}`);
            this.currentSources = cached; 
            return; 
        }
        
        try {
            const movieType = movie?.type;
            console.log(`[DEBUG preloadSources] Cache MISS. Searching for types supported by "${movieType}"`);
            const allResults = await this.parserRegistry.searchAll(movie.name, movie.year);
            const allSources = [];
            await Promise.allSettled(
                allResults.map(async (result) => {
                    const parser = this.parserRegistry.get(result.parserId);
                    if (!parser) {
                        console.log(`[DEBUG preloadSources] Parser not found: ${result.parserId}`);
                        return;
                    }
                    if (parser.getPlayerType() !== 'iframe') {
                        console.log(`[DEBUG preloadSources] Skipping parser ${parser.name} - non-iframe type: ${parser.getPlayerType()}`);
                        return;
                    }
                    if (movieType && !parser.supportsType(movieType)) {
                        console.log(`[DEBUG preloadSources] Skipping parser ${parser.name} - does not support: ${movieType}`);
                        return;
                    }
                    try {
                        const sources = await parser.getVideoSources(result);
                        if (sources?.length) {
                            console.log(`[DEBUG preloadSources] Parser ${parser.name} found ${sources.length} sources`);
                            sources.forEach(s => s.parserId = s.parserId || result.parserId);
                            allSources.push(...sources);
                        }
                    } catch (e) {
                        console.warn(`[DEBUG preloadSources] ${parser.name} sources failed:`, e);
                    }
                })
            );
            if (allSources.length > 0) {
                console.log(`[DEBUG preloadSources] Finished. Found ${allSources.length} total sources for ${movie.kinopoiskId}`);
                this.saveSourcesToCache(movie.kinopoiskId, allSources);
                if (this.selectedMovie?.kinopoiskId === movie.kinopoiskId) {
                    console.log(`[DEBUG preloadSources] Updating currentSources for currently selected movie`);
                    this.currentSources = allSources;
                }
            } else {
                console.log(`[DEBUG preloadSources] Finished. No sources found for ${movie.kinopoiskId}`);
            }
        } catch (e) { console.warn('[DEBUG preloadSources] Preload failed:', e); }
    }

    getCachedSources(movieId) {
        try {
            const data = localStorage.getItem(`movie_sources_${movieId}`);
            if (!data) return null;
            const cached = JSON.parse(data);
            if (Date.now() - cached.timestamp > 24 * 60 * 60 * 1000) { localStorage.removeItem(`movie_sources_${movieId}`); return null; }
            return cached.sources;
        } catch (e) { return null; }
    }

    saveSourcesToCache(movieId, sources) {
        try { localStorage.setItem(`movie_sources_${movieId}`, JSON.stringify({ timestamp: Date.now(), sources })); } catch (e) {}
    }

    async handleWatchClick() {
        console.log('[DEBUG handleWatchClick] === MODAL OPEN START ===');
        console.log('[DEBUG handleWatchClick] selectedMovie:', this.selectedMovie?.name, 'id:', this.selectedMovie?.kinopoiskId, 'type:', this.selectedMovie?.type);
        console.log('[DEBUG handleWatchClick] currentSources at entry:', JSON.stringify(this.currentSources?.map(s => ({name: s.name, url: s.url?.substring(0,60), parserId: s.parserId}))));
        console.log('[DEBUG handleWatchClick] parserRegistry size:', this.parserRegistry?.size, 'ids:', this.parserRegistry?.getIds?.());
        
        // Count existing player instances in DOM
        const existingIframes = document.querySelectorAll('iframe');
        const existingVideos = document.querySelectorAll('video');
        const existingPlayers = document.querySelectorAll('.native-player-wrapper');
        console.log('[DEBUG handleWatchClick] DOM state BEFORE modal: iframes:', existingIframes.length, 'videos:', existingVideos.length, 'native-player-wrappers:', existingPlayers.length);
        
        if (!this.selectedMovie) return;

        if (!this.selectedMovie) return;
        
        // Check if player is already active for this movie (minimized)
        if (this.videoModalMovie && this.videoModalMovie.kinopoiskId === this.selectedMovie.kinopoiskId) {
            const isMinimized = this.elements.videoPlayerModal.classList.contains('minimized-overlay');
            const hasContent = this.elements.videoContainer.innerHTML && !this.elements.videoContainer.innerHTML.includes('video-placeholder');
            
            if (isMinimized && hasContent) {
                console.log('[DEBUG handleWatchClick] Restoring minimized player, skipping init');
                this.restorePlayer();
                return;
            }
        }

        const movieId = this.selectedMovie.kinopoiskId;
        
        // Prefer custom (native video) players for preload mount; skip iframe-only parsers
        const initializedCustomParser = Object.keys(this.playerRegistry).find(parserId => {
            const entry = this.playerRegistry[parserId];
            if (!entry || !entry.initialized) return false;
            const parser = this.parserRegistry.get(parserId);
            return parser && parser.getPlayerType() !== 'iframe';
        });
        
        if (initializedCustomParser) {
            console.log('[DEBUG handleWatchClick] Found preloaded custom player, mounting:', initializedCustomParser);
            this.showVideoModal(this.selectedMovie);
            this.videoModalMovie = this.selectedMovie;
            
            if (this.mountPlayer(initializedCustomParser)) {
                this.populateSourceSelector();
                this.updateActiveSourceButton(`parser:${initializedCustomParser}`);
                return;
            }
        }
        
        // Full initialization logic
        this.showVideoModal(this.selectedMovie);
        this.videoModalMovie = this.selectedMovie;
        this.elements.videoContainer.innerHTML = '<div class="video-placeholder"><div class="loading-spinner"></div><span>Поиск источников...</span></div>';
        
        try {
            // POPULATE SOURCES UI — dynamically from ParserRegistry
            console.log('[DEBUG handleWatchClick] Calling populateSourceSelector() FIRST time (before fetch)');
            this.populateSourceSelector();

            // Logical fetch of sources from ALL parsers
            if (!this.currentSources?.length) {
                if (this.selectedMovie.videoSources?.length) {
                    this.currentSources = this.selectedMovie.videoSources;
                } else {
                    const cached = this.getCachedSources(this.selectedMovie.kinopoiskId);
                    if (cached) {
                        this.currentSources = cached;
                    } else {
                        // Search ALL iframe-type parsers in parallel
                        const movieType = this.selectedMovie?.type;
                        try {
                            const allResults = await this.parserRegistry.searchAll(
                                this.selectedMovie.name, this.selectedMovie.year
                            );
                            const allSources = [];
                            await Promise.allSettled(
                                allResults.map(async (result) => {
                                    const parser = this.parserRegistry.get(result.parserId);
                                    if (!parser || parser.getPlayerType() !== 'iframe') return;
                                    if (movieType && !parser.supportsType(movieType)) return;
                                    try {
                                        const sources = await parser.getVideoSources(result);
                                        if (sources?.length) {
                                            sources.forEach(s => s.parserId = s.parserId || result.parserId);
                                            allSources.push(...sources);
                                        }
                                    } catch (e) {
                                        console.warn(`[MovieDetails] ${parser.name} sources failed:`, e);
                                    }
                                })
                            );
                            if (allSources.length > 0) {
                                this.currentSources = allSources;
                                this.saveSourcesToCache(this.selectedMovie.kinopoiskId, allSources);
                            }
                        } catch (e) {
                            console.warn('[MovieDetails] All parsers search failed:', e);
                        }
                    }
                }
            }
            
            // Re-populate source selector with fetched sources
            console.log('[DEBUG handleWatchClick] Calling populateSourceSelector() SECOND time (after fetch)');
            console.log('[DEBUG handleWatchClick] currentSources after fetch:', this.currentSources?.length, JSON.stringify(this.currentSources?.map(s => ({name: s.name, parserId: s.parserId}))));
            this.populateSourceSelector();
            
            // Playback Logic
            if (this.currentSources && this.currentSources.length > 0) {
                const lastSaved = await this.getLastSource(this.selectedMovie.kinopoiskId);
                let targetSource = null;
                
                if (lastSaved) {
                    if (lastSaved.startsWith('parser:')) {
                        const parserId = lastSaved.replace('parser:', '');
                        const parserOption = this.elements.sourceButtonsContainer.querySelector(`[data-value="parser:${parserId}"]`);
                        if (parserOption) {
                            targetSource = `parser:${parserId}`;
                        }
                    } else {
                        const matchByUrl = this.currentSources?.find(s => s.url === lastSaved);
                        if (matchByUrl) {
                            targetSource = matchByUrl.url;
                        }
                    }
                }
                
                if (!targetSource) {
                    const firstOption = this.elements.sourceButtonsContainer.querySelector('.source-btn');
                    if (firstOption) {
                        targetSource = firstOption.getAttribute('data-value');
                    } else if (this.currentSources?.length > 0) {
                        targetSource = this.currentSources[0].url;
                    }
                // Validate selection — if still -1, force first available option
                }
                
                this.updateActiveSourceButton(targetSource);
                
                if (!this.elements.sourceButtonsContainer.querySelector('.source-btn.active')) {
                    console.error('[handleWatchClick] No button active after setting value:', targetSource);
                    const firstOption = this.elements.sourceButtonsContainer.querySelector('.source-btn');
                    if (firstOption) {
                        targetSource = firstOption.getAttribute('data-value');
                        this.updateActiveSourceButton(targetSource);
                    }
                }
                
                this.changeVideoSource(targetSource);
                this.togglePlayPause();
            } else {
                // No direct sources — try first non-primary parser that supports this movie type
                const currentType = this.selectedMovie?.type;
                console.log('[DEBUG handleWatchClick] NO direct sources. Looking for fallback parser. movieType:', currentType);
                const allParsers = this.parserRegistry.getAll();
                console.log('[DEBUG handleWatchClick] All parsers:', allParsers.map(p => ({id: p.id, playerType: p.getPlayerType(), supportsType: !currentType || p.supportsType(currentType)})));
                
                const lastSaved = await this.getLastSource(this.selectedMovie.kinopoiskId);
                let targetParser = null;
                if (lastSaved && lastSaved.startsWith('parser:')) {
                    const savedParserId = lastSaved.replace('parser:', '');
                    const savedParser = this.parserRegistry.get(savedParserId);
                    if (savedParser && (!currentType || savedParser.supportsType(currentType))) {
                        targetParser = savedParser;
                    }
                }
                
                if (!targetParser) {
                    targetParser = allParsers.find(p => 
                        p.getPlayerType() !== 'iframe' && (!currentType || p.supportsType(currentType))
                    ) || allParsers.find(p => 
                        p !== allParsers[0] && (!currentType || p.supportsType(currentType))
                    );
                }
                
                console.log('[DEBUG handleWatchClick] Fallback parser:', targetParser?.id, targetParser?.name);
                if (targetParser) {
                    const entry = this.playerRegistry[targetParser.id];
                    this.updateActiveSourceButton(`parser:${targetParser.id}`);
                    if (entry && entry.initialized) {
                        this.mountPlayer(targetParser.id);
                    } else {
                        this.changeVideoSource(`parser:${targetParser.id}`);
                    }
                }
            }    
    
            // Setup message listener for iframe communication
            if (!this.messageListenerSetup) {
                window.addEventListener('message', async (event) => {
                     
                    if (event.data.type === 'PLAYER_READY') {
                         const iframe = this.elements.videoContainer.querySelector('iframe');
                         if (iframe && iframe.contentWindow) {
                             
                             iframe.contentWindow.postMessage({
                                 type: 'SET_SOURCES',
                                 sources: this.currentSources,
                                 currentUrl: this.currentVideoUrl
                             }, '*');
                             
                             if (this.selectedMovie && this.selectedMovie.kinopoiskId && this.progressService) {
                                  this.progressService.getProgress(this.selectedMovie.kinopoiskId).then(progress => {
                                      if (progress && progress.season && progress.episode) {
                                           iframe.contentWindow.postMessage({
                                               type: 'RESTORE_PROGRESS',
                                               season: progress.season,
                                               episode: progress.episode
                                           }, '*');
                                           this.currentEpisode = progress.episode;
                                      }
                                  }).catch(e => console.error('Error loading progress:', e));
                             }
                             this.sendAnimeSkipTimes(iframe);
                         }
                    } else if (event.data.type === 'CHANGE_SOURCE') {
                        const newUrl = event.data.url;
                        if (newUrl && newUrl !== this.currentVideoUrl) {
                            this.updateActiveSourceButton(newUrl);
                            this.changeVideoSource(newUrl);
                            this.togglePlayPause(); 
                        }
                    } else if (event.data.type === 'UPDATE_WATCHING_PROGRESS') {
                        const { season, episode, timestamp } = event.data;
                        
                        
                        if (this.selectedMovie && this.selectedMovie.kinopoiskId && this.progressService) {
                             try {
                                 const data = { season, episode, timestamp, movieId: this.selectedMovie.kinopoiskId, movieTitle: this.selectedMovie.name || this.selectedMovie.nameRu };
                                 this.progressService.saveProgress(this.selectedMovie.kinopoiskId, data).catch(console.error);
                             } catch (e) { console.error('Failed to save watching progress:', e); }
                        }
                    } else if (event.data.type === 'EPISODE_CHANGED') {
                        const { episode } = event.data;
                        this.currentEpisode = episode;
                        const iframe = this.elements.videoContainer.querySelector('iframe');
                        this.sendAnimeSkipTimes(iframe);
                    } else if (event.data.type === 'PIP_ENTER') {
                        this.minimizePlayer(false);
                    } else if (event.data.type === 'PIP_EXIT') {
                        this.restorePlayer();
                    }
                });
                this.messageListenerSetup = true;
            }

        } catch (error) {
            console.error('Error in handleWatchClick:', error);
            this.elements.videoContainer.innerHTML = `<div class="video-placeholder"><span>Ошибка: ${error.message}</span></div>`;
        }
    }

    showVideoModal(movie) {
        this.elements.videoTitle.textContent = `Смотреть: ${movie.nameRu || movie.name}`;
        this.elements.videoPlayerModal.style.display = 'flex';
    }

    /**
     * Fetch and send anime skip times to the iframe player
     * @param {HTMLIFrameElement} iframe - The video player iframe
     */
    async sendAnimeSkipTimes(iframe) {
        if (!this.selectedMovie) {
            console.warn('[SkipError] sendAnimeSkipTimes called but no selectedMovie');
            return;
        }

        // Only proceed if this is anime
        if (this.selectedMovie.type !== 'anime') {
            console.log(`[SkipError] Not anime type (type: ${this.selectedMovie.type}) — skip logic disabled`);
            return;
        }

        const activeParser = this.activeSource?.parserId || 'unknown';
        console.log(`[SkipError] sendAnimeSkipTimes called — parser: ${activeParser}, episode: ${this.currentEpisode}, iframe: ${!!iframe?.contentWindow}`);

        // Lazy-load AniskipService if not yet loaded
        if (!this.aniskipService) {
            try {
                await LazyLoader.loadScript('../../shared/services/AniskipService.js');
                if (typeof AniskipService !== 'undefined') {
                    this.aniskipService = new AniskipService();
                } else {
                    console.warn('[SkipError] AniskipService class not found after script load');
                    return;
                }
            } catch (e) {
                console.warn('[SkipError] Failed to load AniskipService:', e.message);
                return;
            }
        }

        // console.log(`[MovieDetails] Fetching anime skip times for episode ${this.currentEpisode}`);

        try {
            const skipTimes = await this.aniskipService.getOpeningTimestamps(
                this.selectedMovie,
                this.currentEpisode
            );

            if (skipTimes) {
                // console.log('[MovieDetails] Sending skip times to player:', skipTimes);
                
                this.currentSkipTimes = skipTimes;
                
                const skipMessage = {
                    type: 'ANIME_SKIP_DATA',
                    skipTimes: {
                        startTime: skipTimes.startTime,
                        endTime: skipTimes.endTime,
                        episodeLength: skipTimes.episodeLength
                    },
                    episodeNumber: this.currentEpisode,
                    malId: skipTimes.malId
                };
                
                if (iframe?.contentWindow) {
                    console.log(`[SkipError] Delivering skip data via iframe.postMessage (parser: ${activeParser}, ep: ${this.currentEpisode}, range: ${skipTimes.startTime}-${skipTimes.endTime}s)`);
                    iframe.contentWindow.postMessage(skipMessage, '*');
                } else {
                    console.log(`[SkipError] Delivering skip data via window.postMessage (parser: ${activeParser}, ep: ${this.currentEpisode}, range: ${skipTimes.startTime}-${skipTimes.endTime}s)`);
                    // Check if a <video> element exists in current DOM for Seasonvar first-load diagnostic
                    const videoEl = this.elements.videoContainer?.querySelector('video');
                    if (!videoEl) {
                        console.warn(`[SkipError] ${activeParser} first load — skip data ready but NO <video> element in videoContainer yet`);
                    } else if (videoEl.readyState < 2) {
                        console.warn(`[SkipError] ${activeParser} first load — skip data ready but video readyState=${videoEl.readyState} (not yet playing)`);
                        
                        const onPlay = () => {
                            console.log(`[SkipError] ${activeParser} video playing — resending skip data`);
                            window.postMessage(skipMessage, '*');
                            videoEl.removeEventListener('playing', onPlay);
                        };
                        videoEl.addEventListener('playing', onPlay);
                    }
                    window.postMessage(skipMessage, '*');
                }
            } else {
            console.warn(`[SkipError] No skip data for episode ${this.currentEpisode} (parser: ${activeParser}) — button will not appear`);
                // Send null to clear any previous skip data
                const nullMessage = {
                    type: 'ANIME_SKIP_DATA',
                    skipTimes: null,
                    episodeNumber: this.currentEpisode
                };
                
                if (iframe?.contentWindow) {
                    iframe.contentWindow.postMessage(nullMessage, '*');
                } else {
                    window.postMessage(nullMessage, '*');
                }
            }
        } catch (error) {
            console.error(`[SkipError] Exception in sendAnimeSkipTimes: ${error.message}`);
        }
    }

    // Video Player Methods
    closeVideoModal() {
        // If embedded, signal parent to restore native player
        if (this.isEmbedded && window.parent !== window) {
            this.unmountActivePlayer();
            this.destroyPlayer();
            window.parent.postMessage({ type: 'CLOSE_EXTENSION_PLAYER' }, '*');
            return;
        }
        // Instead of closing and destroying, we minimize
        this.minimizePlayer();
    }

    async minimizePlayer(shouldPause = true) {
        if (!this.elements.videoPlayerModal) return;
        
        // console.log(`[INFO] Инициировано сворачивание плеера (пауза: ${shouldPause})`);
        
        try {
            if (shouldPause) {
                // Attempt to pause video before minimizing
                const pauseResult = await this.tryPauseVideo();
                
                if (pauseResult.success) {
                    // console.log(`[SUCCESS] Видео поставлено на паузу за ${pauseResult.duration}мс (позиция: ${this.formatTime(pauseResult.currentTime)})`);
                } else if (pauseResult.reason === 'already_paused') {
                    // console.log('[INFO] Видео уже было на паузе');
                } else if (pauseResult.reason === 'iframe_blind_pause') {
                    // console.log('[INFO] Отправлена команда паузы iframe (без подтверждения)');
                } else {
                    console.warn(`[WARNING] Не удалось подтвердить паузу: ${pauseResult.reason}`);
                    console.warn(`[ERROR] Причина: readyState=${pauseResult.readyState}, paused=${pauseResult.paused}, error=${pauseResult.error}`);
                }
            }

            // Add minimized class/state
            this.elements.videoPlayerModal.classList.add('minimized-overlay');
            
            if (shouldPause) {
                // Normal minimize
                this.elements.videoPlayerModal.querySelector('.modal').classList.add('minimized');
                this.elements.videoPlayerModal.querySelector('.modal').classList.remove('pip-hidden');
            } else {
                // PiP minimize (invisible but active)
                this.elements.videoPlayerModal.querySelector('.modal').classList.add('pip-hidden');
                this.elements.videoPlayerModal.querySelector('.modal').classList.remove('minimized');
            }
            
            // Show restore button
            this.showRestoreButton();
            
            // console.log('[INFO] Плеер свернут успешно');
            
        } catch (error) {
            console.error('[ERROR] Ошибка при сворачивании плеера:', error);
            // Force minimize on error to not block UI
            this.elements.videoPlayerModal.classList.add('minimized-overlay');
            if (shouldPause) {
                this.elements.videoPlayerModal.querySelector('.modal').classList.add('minimized');
            } else {
                this.elements.videoPlayerModal.querySelector('.modal').classList.add('pip-hidden');
            }
            this.showRestoreButton();
        }
    }

    async tryPauseVideo() {
        const startTime = performance.now();
        const video = this.elements.videoContainer.querySelector('video');
        const iframe = this.elements.videoContainer.querySelector('iframe');
        
        if (video) {
            // console.log('[INFO] Видео воспроизводится, установка паузы (Native Video)...');
            
            if (video.paused) {
                return { success: false, reason: 'already_paused', currentTime: video.currentTime, duration: 0 };
            }
            
            try {
                video.pause();
                
                // Wait for pause confirmation
                return new Promise((resolve) => {
                    const checkInterval = setInterval(() => {
                        if (video.paused) {
                            clearInterval(checkInterval);
                            resolve({ 
                                success: true, 
                                currentTime: video.currentTime, 
                                duration: Math.round(performance.now() - startTime),
                                readyState: video.readyState
                            });
                        } else if (performance.now() - startTime > 1000) {
                            clearInterval(checkInterval);
                            resolve({ 
                                success: false, 
                                reason: 'timeout', 
                                readyState: video.readyState, 
                                paused: video.paused, 
                                error: video.error 
                            });
                        }
                    }, 50);
                });
            } catch (e) {
                return { success: false, reason: 'api_error', error: e.message };
            }
        } else if (iframe) {
            // console.log('[INFO] Видео воспроизводится, установка паузы (Iframe)...');
            try {
                return new Promise((resolve) => {
                    let resolved = false;
                    const startTime = performance.now();
                    
                    const msgHandler = (e) => {
                        if (e.data && e.data.type === 'PAUSED_CONFIRMATION') {
                            window.removeEventListener('message', msgHandler);
                            if (!resolved) {
                                resolved = true;
                                resolve({ success: true, reason: 'iframe_confirmed', duration: Math.round(performance.now() - startTime) });
                            }
                        }
                    };
                    
                    window.addEventListener('message', msgHandler);
                    iframe.contentWindow.postMessage({ type: 'PAUSE' }, '*');
                    
                    // Timeout after 800ms
                    setTimeout(() => {
                        if (!resolved) {
                            window.removeEventListener('message', msgHandler);
                            resolved = true;
                            console.warn('[WARNING] Нет подтверждения паузы от iframe (таймаут)');
                            // We still return true because we can't be sure it FAILED, and we want to minimize anyway
                            resolve({ success: true, reason: 'iframe_blind_pause', duration: Math.round(performance.now() - startTime) });
                        }
                    }, 800);
                });
            } catch (e) {
                return { success: false, reason: 'iframe_error', error: e.message };
            }
        }
        
        return { success: false, reason: 'no_player_found' };
    }

    formatTime(seconds) {
        if (!seconds) return '00:00';
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    restorePlayer() {
        if (!this.elements.videoPlayerModal) return;
        
        // Remove minimized class/state
        this.elements.videoPlayerModal.classList.remove('minimized-overlay');
        const modal = this.elements.videoPlayerModal.querySelector('.modal');
        modal.classList.remove('minimized');
        modal.classList.remove('pip-hidden');
        
        // Hide restore button
        this.hideRestoreButton();
    }

    showRestoreButton() {
        const btn = document.getElementById('restorePlayerBtn');
        if (btn) {
            btn.style.display = 'flex';
            // Update title if possible
            const titleEl = btn.querySelector('.restore-title');
            if (titleEl && this.selectedMovie) {
                const isEnglish = i18n.currentLocale === 'en';
                titleEl.textContent = (isEnglish && this.selectedMovie.alternativeName) ? this.selectedMovie.alternativeName : (this.selectedMovie.name || 'Movie');
            }
        }
    }

    // Completely close the player (e.g. from restore button 'X')
    hideRestoreButton() {
        const btn = document.getElementById('restorePlayerBtn');
        if (btn) btn.style.display = 'none';
    }

    reuseCachedPlayer(movieId) {
        // Find the first initialized parser entry for this movie in the registry
        const parserId = Object.keys(this.playerRegistry).find(pid => {
            const entry = this.playerRegistry[pid];
            return entry && entry.initialized;
        });

        if (!parserId) return false;

        console.log(`[DEBUG reuseCachedPlayer] Reusing preloaded player: ${parserId} for movie ${movieId}`);
        return this.mountPlayer(parserId);
    }

    destroyPlayer() {
        // unmountActivePlayer pauses and returns player DOM to its hidden registry container
        this.unmountActivePlayer();

        this.elements.videoPlayerModal.style.display = 'none';
        this.elements.videoPlayerModal.classList.remove('minimized-overlay');
        this.elements.videoPlayerModal.querySelector('.modal').classList.remove('minimized');
        this.elements.videoPlayerModal.querySelector('.modal').classList.remove('pip-hidden');
        this.hideRestoreButton();

        if (this.isPlaying) {
            this.isPlaying = false;
        }
        
        if (this.currentHls) {
            this.currentHls.destroy();
            this.currentHls = null;
        }



        // Clear any remaining content that wasn't part of the registry (e.g. error placeholders)
        if (this.elements.videoContainer.innerHTML) {
            this.elements.videoContainer.innerHTML = '';
        }
        
        if (this.isEmbedded && window.parent !== window) {
            window.parent.postMessage({ type: 'CLOSE_EXTENSION_PLAYER' }, '*');
        }
    }

    initPlayerRegistry() {
        const parsers = this.parserRegistry.getAll();
        for (const parser of parsers) {
            if (this.playerRegistry[parser.id]) continue; // already set up

            const container = document.createElement('div');
            container.id = `player-preload-${parser.id}`;
            container.style.cssText = 'display:none; position:absolute; width:0; height:0; overflow:hidden; pointer-events:none;';
            document.body.appendChild(container);

            this.playerRegistry[parser.id] = {
                container,
                video: null,
                initialized: false,
                ready: false,
                parserId: parser.id,
                sources: null,
                renderOptions: null
            };
        }
        console.log('[PlayerRegistry] Initialized for parsers:', Object.keys(this.playerRegistry).join(', '));
    }

    async preloadAllPlayers(movieId) {
        if (!this.selectedMovie || this.selectedMovie.kinopoiskId !== movieId) return;
        
        const parsers = this.parserRegistry.getAll();
        const movieType = this.selectedMovie?.type;
        
        await Promise.allSettled(parsers.map(async (parser) => {
            if (movieType && !parser.supportsType(movieType)) return;
            
            const entry = this.playerRegistry[parser.id];
            if (!entry || entry.initialized) return;
            
            try {
                const name = this.selectedMovie.name || this.selectedMovie.alternativeName;
                let searchResult = parser.searchBestMatch
                    ? await parser.searchBestMatch(name, this.selectedMovie.alternativeName, this.selectedMovie.year)
                    : await parser.cachedSearch(name, this.selectedMovie.year);
                
                if (!searchResult) return;
                
                const sources = await parser.getVideoSources(searchResult);
                if (!sources?.length) return;
                
                let seriesInfo = null, seasons = [];
                if (parser.getSeriesInfo) {
                    try { seriesInfo = await parser.getSeriesInfo(searchResult.url); } catch(e) {}
                }
                if (parser.getSeasons) {
                    try { seasons = await parser.getSeasons(searchResult.url); } catch(e) {}
                }
                
                entry.container.innerHTML = '';
                const renderOptions = {
                    translations: seriesInfo?.translations || null,
                    seasons: seasons || [],
                    movieId: movieId,
                    onPlayerReady: () => {
                        console.log(`[PlayerRegistry] Player ready: ${parser.id}`);
                    }
                };
                
                if (parser.getPlayerType() === 'custom' || parser.renderPlayer !== BaseParserService.prototype.renderPlayer) {
                    // Data-only preload: store sources/options, create DOM on mount
                    entry.dataOnly = true;
                    
                    // Pre-resolve progress so mountPlayer doesn't redo auto-select
                    const key = `watching_progress_${movieId}`;
                    const result = await new Promise(resolve => chrome.storage.local.get([key], resolve));
                    const progress = result[key];
                    
                    if (progress) {
                        if (progress.season && seasons && seasons.length > 0) {
                            const progSeasonNum = parseInt(progress.season);
                            if (!isNaN(progSeasonNum)) {
                                const targetSeason = seasons.find(s => s.season_number === progSeasonNum);
                                if (targetSeason) renderOptions.resolvedSeasonUrl = targetSeason.url;
                            }
                        }
                        
                        let targetSource = null;
                        if (progress.episode) {
                            const pSeason = (progress.season || '').toLowerCase().trim();
                            const pEpisode = (progress.episode || '').toLowerCase().trim();
                            
                            targetSource = sources.find(s => {
                                const sName = (s.name || s.title || '').toLowerCase();
                                if (pSeason) {
                                    return sName.includes(pSeason) && sName.includes(pEpisode);
                                } else {
                                    return sName.includes(pEpisode);
                                }
                            });
                            
                            if (!targetSource) {
                                targetSource = sources.find(s => (s.name || '').includes(progress.episode));
                            }
                        }
                        
                        if (targetSource) {
                            renderOptions.resolvedEpisodeUrl = targetSource.url;
                        }
                        
                        if (progress.timestamp > 5 && progress.timestamp <= 100000) {
                            renderOptions.resolvedTimestamp = progress.timestamp;
                        }
                    }
                } else {
                    parser.renderPlayer(entry.container, sources, renderOptions);
                    
                    const video = entry.container.querySelector('video');
                    if (video) {
                        video.setAttribute('preload', 'auto');
                        video.removeAttribute('autoplay');
                        const pauseOnReady = () => {
                            video.pause();
                            video.removeEventListener('canplay', pauseOnReady);
                            video.removeEventListener('loadeddata', pauseOnReady);
                            entry.ready = true;
                        };
                        video.addEventListener('canplay', pauseOnReady);
                        video.addEventListener('loadeddata', pauseOnReady);
                        entry.video = video;
                    }
                }
                
                entry.initialized = true;
                entry.sources = sources;
                entry.renderOptions = renderOptions;
                
            } catch (e) {
                console.warn(`[PlayerRegistry] Preload failed for ${parser.id}:`, e);
            }
        }));
    }

    mountPlayer(parserId) {
        this.unmountActivePlayer();
        
        const entry = this.playerRegistry[parserId];
        if (!entry || !entry.initialized) return false;
        
        const parser = this.parserRegistry.get(parserId);
        
        // Data-only entries: render fresh DOM now
        if (entry.dataOnly) {
            this.elements.videoContainer.innerHTML = '';
            
            // Pass the pre-resolved auto-select data to renderPlayer
            parser.renderPlayer(this.elements.videoContainer, entry.sources, entry.renderOptions || {});
            
            this.activePlayerId = parserId;
            window._playerMounted = true;
            
            // We still need to _attachListeners manually if required, though renderPlayer often does it
            if (parser?.getPlayerType() === 'custom' && parser._attachListeners) {
                // Not calling here directly if renderPlayer already does it, 
                // but kept for compatibility if needed. (Seasonvar's renderPlayer calls it internally).
            }
        } else {
            // [playerError] Log video state BEFORE mounting
            const videoBefore = entry.container.querySelector('video');
            console.log(`[playerError] mountPlayer BEFORE mount: parserId=${parserId}, video exists=${!!videoBefore}, src=${videoBefore?.src}, readyState=${videoBefore?.readyState}, paused=${videoBefore?.paused}`);
            
            this.elements.videoContainer.innerHTML = '';
            const playerElement = entry.container.querySelector('.player-clean') 
                || entry.container.querySelector('.video-wrapper')
                || entry.container.firstElementChild;
            
            if (!playerElement) return false;
            
            this.elements.videoContainer.appendChild(playerElement);
            this.activePlayerId = parserId;
            window._playerMounted = true;
            
            if (parser?.getPlayerType() === 'custom' && parser._attachListeners) {
                parser._attachListeners(this.elements.videoContainer, entry.renderOptions || {});
            }
        }
        
        // [playerError] Log video state AFTER mounting
        const videoAfter = this.elements.videoContainer.querySelector('video');
        const hasNativeWrapper = !!this.elements.videoContainer.querySelector('.native-player-wrapper');
        console.log(`[playerError] mountPlayer AFTER mount: parserId=${parserId}, video exists=${!!videoAfter}, src=${videoAfter?.src}, readyState=${videoAfter?.readyState}, paused=${videoAfter?.paused}, native-player-wrapper in DOM=${hasNativeWrapper}`);
        
        // [playerError] Try play() and log result
        if (videoAfter) {
            try {
                const playPromise = videoAfter.play();
                if (playPromise) {
                    playPromise.then(() => {
                        console.log(`[playerError] play() resolved successfully after mount for ${parserId}`);
                    }).catch((err) => {
                        console.log(`[playerError] play() REJECTED after mount for ${parserId}: ${err.name}: ${err.message}`);
                    });
                } else {
                    console.log(`[playerError] play() returned undefined (no promise) for ${parserId}`);
                }
            } catch (playErr) {
                console.log(`[playerError] play() THREW after mount for ${parserId}: ${playErr.name}: ${playErr.message}`);
            }
        } else {
            console.log(`[playerError] play() not called after mount — no video element found for ${parserId}`);
        }
        
        return true;
    }

    unmountActivePlayer() {
        if (!this.activePlayerId) return;
        window._playerMounted = false;
        
        const entry = this.playerRegistry[this.activePlayerId];
        if (!entry) { 
            this.activePlayerId = null; 
            return; 
        }
        
        const video = this.elements.videoContainer.querySelector('video');
        if (video && !video.paused) video.pause();
        
        const iframe = this.elements.videoContainer.querySelector('iframe');
        if (iframe?.contentWindow) {
            try { 
                iframe.contentWindow.postMessage({ type: 'PAUSE' }, '*'); 
            } catch(e) {}
        }
        
        const playerElement = this.elements.videoContainer.querySelector('.player-clean')
            || this.elements.videoContainer.querySelector('.video-wrapper')
            || this.elements.videoContainer.firstElementChild;
        
        if (playerElement && !entry.dataOnly) {
            entry.container.appendChild(playerElement);
        } else if (entry.dataOnly) {
            // BUG 1 FIX: Clear the entire container so Seasonvar DOM
            // (horizontal-episodes, episode labels) doesn't bleed through
            this.elements.videoContainer.innerHTML = '';
        }
        
        // BUG 3 FIX: Reset permanentVideo so PlayerCleaner starts fresh
        // for the new source. KinoGo provides its own video element which
        // PlayerCleaner will re-capture via the normal flow.
        // Send reset to current window (player-cleaner runs here too)
        window.postMessage({ type: 'RESET_PERMANENT_VIDEO' }, '*');
        // Also send reset to all iframes
        try {
            const iframes = document.querySelectorAll('iframe');
            iframes.forEach(f => {
                try {
                    if (f.contentWindow) {
                        f.contentWindow.postMessage({ type: 'RESET_PERMANENT_VIDEO' }, '*');
                    }
                } catch(e) {}
            });
        } catch(e) {}
        
        entry.container.style.display = 'none';
        this.activePlayerId = null;
    }

    /**
     * Dynamically populate the source buttons from ParserRegistry + fetched sources.
     */
    populateSourceSelector() {
        console.log('[DEBUG populateSourceSelector] === POPULATING SOURCE BUTTONS ===');
        console.log('[DEBUG populateSourceSelector] currentSources count:', this.currentSources?.length);
        console.log('[DEBUG populateSourceSelector] selectedMovie type:', this.selectedMovie?.type);
        
        let savedValue = this.activeSourceValue;
        if (!savedValue && this.elements.sourceButtonsContainer) {
            savedValue = this.elements.sourceButtonsContainer.querySelector('.source-btn.active')?.getAttribute('data-value');
        }
        console.log('[DEBUG populateSourceSelector] Saved current selection:', savedValue);
        
        if (!this.elements.sourceButtonsContainer) return;
        this.elements.sourceButtonsContainer.innerHTML = '';

        // Add registered parsers with custom player types (e.g. Seasonvar)
        const movieType = this.selectedMovie?.type;
        let addedCustomParsers = 0;
        this.parserRegistry.getAll().forEach(parser => {
            if (parser.getPlayerType() !== 'iframe') {
                // Skip parsers that don't support the current movie type (e.g. Seasonvar for movies)
                if (movieType && !parser.supportsType(movieType)) {
                    console.log(`[DEBUG populateSourceSelector] SKIPPED parser "${parser.id}" - does not support type "${movieType}". Supported:`, parser.getSupportedTypes());
                    return;
                }

                const btn = document.createElement('button');
                btn.className = 'source-btn';
                btn.setAttribute('data-value', `parser:${parser.id}`);
                btn.textContent = parser.name;
                this.elements.sourceButtonsContainer.appendChild(btn);
                addedCustomParsers++;
                console.log(`[DEBUG populateSourceSelector] Added custom parser button: "${parser.name}" (parser:${parser.id})`);
            }
        });

        // --- VidSrc embed source ---
        const imdbId = this.selectedMovie?.externalId?.imdb;
        if (imdbId) {
            const btn = document.createElement('button');
            btn.className = 'source-btn';
            btn.setAttribute('data-value', `vidsrc:${imdbId}`);
            btn.textContent = 'VidSrc';
            this.elements.sourceButtonsContainer.appendChild(btn);
            console.log(`[DEBUG populateSourceSelector] Added VidSrc button for imdb: ${imdbId}`);
        }
        // --- end VidSrc ---

        // Add fetched video sources (from iframe-based parsers like Ex-FS, KinoGo)
        let addedSources = 0;
        if (this.currentSources && this.currentSources.length > 0) {
            this.currentSources.forEach((source, index) => {
                const btn = document.createElement('button');
                btn.className = 'source-btn';
                btn.setAttribute('data-value', source.url);
                // Prefix with parser name for clarity when multiple parsers provide sources
                const parserName = source.parserId ? this.parserRegistry.get(source.parserId)?.name : null;
                const label = source.name || `Источник ${index + 1}`;
                btn.textContent = parserName ? `${parserName}: ${label}` : label;
                this.elements.sourceButtonsContainer.appendChild(btn);
                addedSources++;
            });
        }
        
        const hasSavedValue = savedValue && this.elements.sourceButtonsContainer.querySelector(`[data-value="${savedValue}"]`);
        if (hasSavedValue) {
            this.updateActiveSourceButton(savedValue);
            console.log('[DEBUG populateSourceSelector] Preserved selection:', savedValue);
        } else if (savedValue) {
            console.log('[DEBUG populateSourceSelector] Saved value not found in new options, keeping default state');
        }
        
        console.log(`[DEBUG populateSourceSelector] RESULT: ${addedCustomParsers} custom parsers + ${addedSources} fetched sources = ${addedCustomParsers + addedSources} total options`);
    }

    updateActiveSourceButton(value) {
        if (!this.elements.sourceButtonsContainer) return false;
        // [playerError] Log active source button change
        const video = this.elements.videoContainer?.querySelector('video');
        const parserId = value?.startsWith('parser:') ? value.replace('parser:', '') : value;
        console.log(`[playerError] activeSource button set to: ${parserId}, current video src: ${video?.src}`);
        this.activeSourceValue = value;
        const buttons = this.elements.sourceButtonsContainer.querySelectorAll('.source-btn');
        let found = false;
        buttons.forEach(btn => {
            if (btn.getAttribute('data-value') === value) {
                btn.classList.add('active');
                found = true;
            } else {
                btn.classList.remove('active');
            }
        });
        return found;
    }

    async changeVideoSource(url) {
        console.log(`[playerError] changeVideoSource called: url=${url}, caller=${new Error().stack.split('\n')[2]}, timestamp=${Date.now()}`);
        console.log('[DEBUG changeVideoSource] called with url:', url?.substring(0, 80));
        if (!url) { console.log('[DEBUG changeVideoSource] URL is empty, returning'); return; }
        
        this.updateActiveSourceButton(url);
        
        if (this.selectedMovie?.kinopoiskId) {
            await this.saveLastSource(this.selectedMovie.kinopoiskId, url);
        }
        
        // VidSrc embed source
        if (url.startsWith('vidsrc:')) {
            this.unmountActivePlayer();
            this.loadVidSrcSource(url.replace('vidsrc:', ''));
            return;
        }

        // Check if this is a parser-based source (e.g. "parser:seasonvar")
        if (url.startsWith('parser:')) {
            const parserId = url.replace('parser:', '');
            console.log('[DEBUG changeVideoSource] Parser-based source detected, parser:', parserId);
            const entry = this.playerRegistry[parserId];
            if (entry && entry.initialized) {
                console.log('[DEBUG changeVideoSource] Mounting preloaded player');
                this.mountPlayer(parserId);
            } else {
                console.log('[DEBUG changeVideoSource] Player not preloaded, loading parser source');
                this.loadParserSource(parserId);
            }
            return;
        }

        this.currentVideoUrl = url;
        this.isPlaying = false;
        
        // Detach any active parser player before replacing container contents
        this.unmountActivePlayer();
        
        // Count players BEFORE mounting
        const iframesBefore = this.elements.videoContainer.querySelectorAll('iframe').length;
        const videosBefore = this.elements.videoContainer.querySelectorAll('video').length;
        console.log('[DEBUG changeVideoSource] Container state BEFORE mount: iframes:', iframesBefore, 'videos:', videosBefore);
        console.log('[DEBUG changeVideoSource] Container innerHTML preview:', this.elements.videoContainer.innerHTML?.substring(0, 200));
        
        const iframe = this.elements.videoContainer.querySelector('iframe');
        if (iframe && !iframe.src.includes('parser:')) {
             console.log('[DEBUG changeVideoSource] Reusing existing iframe, setting src');
             iframe.src = url; 
        } else {
             console.log('[DEBUG changeVideoSource] No reusable iframe, calling renderDefaultPlayer');
             this.renderDefaultPlayer(url);
        }
        

        if (this.selectedMovie) this.saveLastSource(this.selectedMovie.kinopoiskId, url);
        // Count players AFTER mounting
        const iframesAfter = this.elements.videoContainer.querySelectorAll('iframe').length;
        const videosAfter = this.elements.videoContainer.querySelectorAll('video').length;
        const nativePlayersAfter = this.elements.videoContainer.querySelectorAll('.native-player-wrapper').length;
        console.log('[DEBUG changeVideoSource] Container state AFTER mount: iframes:', iframesAfter, 'videos:', videosAfter, 'native-wrappers:', nativePlayersAfter);
    }

    /**
     * Load video source via a registered parser.
     * Generalized replacement for the old loadSeasonvarSource().
     * @param {string} parserId - ID of the parser to use
     */
    async loadParserSource(parserId) {
        console.log(`[DEBUG loadParserSource] === LOADING PARSER SOURCE: ${parserId} ===`);
        if (!this.selectedMovie) { console.log('[DEBUG loadParserSource] No selectedMovie, returning'); return; }
        
        const parser = this.parserRegistry.get(parserId);
        if (!parser) {
            console.error(`[DEBUG loadParserSource] Parser "${parserId}" NOT FOUND in registry. Available:`, this.parserRegistry.getIds());
            this.elements.videoContainer.innerHTML = `<div class="video-placeholder"><span>Парсер "${parserId}" не найден</span></div>`;
            return;
        }

        console.log(`[DEBUG loadParserSource] Parser found: ${parser.name}, playerType: ${parser.getPlayerType()}, supportedTypes:`, parser.getSupportedTypes());
        console.log(`[DEBUG loadParserSource] Container state BEFORE render:`, { iframes: this.elements.videoContainer.querySelectorAll('iframe').length, videos: this.elements.videoContainer.querySelectorAll('video').length });

        this.elements.videoContainer.innerHTML = `<div class="video-placeholder"><div class="loading-spinner"></div><span>Загрузка ${parser.name}...</span></div>`;
        
        try {
            const name = this.selectedMovie.name || this.selectedMovie.alternativeName;
            
            // Use enhanced search if available (e.g. SeasonvarParser.searchBestMatch)
            let searchResult;
            if (parser.searchBestMatch) {
                searchResult = await parser.searchBestMatch(name, this.selectedMovie.alternativeName, this.selectedMovie.year);
            } else {
                searchResult = await parser.cachedSearch(name, this.selectedMovie.year);
            }

            if (!searchResult) {
                this.elements.videoContainer.innerHTML = `<div class="video-placeholder"><span>Ничего не найдено на ${parser.name}</span></div>`;
                return;
            }

            // Get video sources
            const sources = await parser.getVideoSources(searchResult);

            if (!sources || sources.length === 0) {
                this.elements.videoContainer.innerHTML = `<div class="video-placeholder"><span>Источники не найдены на ${parser.name}</span></div>`;
                return;
            }

            // FIX: Save sources to state so PLAYER_READY can use them
            
            // CRITICAL FIX: Separate episodes from provider sources
            // DO NOT overwrite currentSources with episodes!
            this.currentEpisodes = sources;

            // this.saveSourcesToCache(this.selectedMovie.kinopoiskId, sources); // Do not cache episodes as sources
            // this.populateSourceSelector(); // Do not re-populate if sources list didn't change
            
            // Fetch additional series info if available (for custom players like Seasonvar)

            // Fetch additional series info if available (for custom players like Seasonvar)
            let seriesInfo = null;
            let seasons = [];

            if (parser.getSeriesInfo) {
                try {
                    seriesInfo = await parser.getSeriesInfo(searchResult.url);
                } catch (e) {
                    console.warn('[MovieDetails] Failed to load series info:', e);
                }
            }

            if (parser.getSeasons) {
                try {
                    seasons = await parser.getSeasons(searchResult.url);
                } catch (e) {
                    console.warn('[MovieDetails] Failed to load seasons:', e);
                }
            }

            // Delegate rendering to the parser
            const renderOptions = {
                translations: seriesInfo?.translations || null,
                seasons: seasons || [],
                movieId: this.selectedMovie.kinopoiskId, // Pass ID for progress restoration
                onPlayerReady: () => {
                     this.populateSourceSelector();
                }
            };

            console.log(`[DEBUG loadParserSource] About to render. playerType: ${parser.getPlayerType()}, sources count: ${sources?.length}`);
            if (parser.getPlayerType() === 'custom' || parser.renderPlayer !== BaseParserService.prototype.renderPlayer) {
                // Parser has custom rendering (like Seasonvar with episode selector)
                console.log(`[DEBUG loadParserSource] Using CUSTOM renderPlayer for ${parser.name}`);
                parser.renderPlayer(this.elements.videoContainer, sources, renderOptions);
            } else {
                // Default iframe rendering
                console.log(`[DEBUG loadParserSource] Using DEFAULT (iframe) renderPlayer for ${parser.name}`);
                parser.renderPlayer(this.elements.videoContainer, sources, renderOptions);
            }
            
            // Log container state AFTER render
            console.log(`[DEBUG loadParserSource] Container state AFTER render:`, { iframes: this.elements.videoContainer.querySelectorAll('iframe').length, videos: this.elements.videoContainer.querySelectorAll('video').length, nativeWrappers: this.elements.videoContainer.querySelectorAll('.native-player-wrapper').length });

            // Cache the player for reuse
            const movieId = this.selectedMovie.kinopoiskId;
            const video = this.elements.videoContainer.querySelector('video');
            const videoState = video ? {
                currentTime: video.currentTime,
                paused: video.paused
            } : null;

            const tempContainer = document.createElement('div');
            tempContainer.style.display = 'none';
            tempContainer.innerHTML = this.elements.videoContainer.innerHTML;
            document.body.appendChild(tempContainer);

            this.playerCache.set(movieId, {
                container: tempContainer,
                parserId: parserId,
                movieId: movieId,
                initialized: true,
                sources: sources,
                renderOptions: renderOptions,
                videoState: videoState,
                timestamp: Date.now()
            });

            console.log(`[DEBUG loadParserSource] Player cached for movie ${movieId}`);

        } catch (e) {
            console.error(`[MovieDetails] ${parser.name} load error:`, e);
            this.elements.videoContainer.innerHTML = `<div class="video-placeholder"><span>Ошибка загрузки ${parser.name}: ${e.message}</span></div>`;
        }
    }

    /** @deprecated Use loadParserSource('seasonvar') instead */
    async loadSeasonvarSource() {
        return this.loadParserSource('seasonvar');
    }

    /** @deprecated Use parser.renderPlayer() instead */
    renderSeasonvarPlayer(episodes, translations) {
        const parser = this.parserRegistry.get('seasonvar');
        if (parser) {
            const sources = episodes.map(ep => ({ name: ep.title, url: ep.url, type: 'video', subtitle: ep.subtitle }));
            parser.renderPlayer(this.elements.videoContainer, sources, { translations });
        }
    }

    renderDefaultPlayer(url) {
        console.log(`[DEBUG renderDefaultPlayer] Rendering IFRAME: ${url?.substring(0,80)}`);
        this.elements.videoContainer.innerHTML = `<iframe src="${url}" allowfullscreen allow="autoplay; fullscreen" style="width: 100%; height: 100%; border: none;"></iframe>`;
    }

    /**
     * Build vidsrc-embed.ru URL for a movie or TV episode.
     * @param {string} imdbId  - e.g. "tt0110912"
     * @param {object} [opts]  - { season, episode } for TV
     * @returns {string}
     */
    buildVidSrcUrl(imdbId, opts = {}) {
        const base = 'https://vidsrc-embed.ru/embed';
        const isSeries = this.selectedMovie?.type &&
            ['tv-series', 'mini-series', 'animated-series', 'anime'].includes(this.selectedMovie.type);

        if (isSeries) {
            const s = opts.season || 1;
            const e = opts.episode || 1;
            return `${base}/tv?imdb=${imdbId}&season=${s}&episode=${e}&autoplay=1`;
        }
        return `${base}/movie?imdb=${imdbId}&autoplay=1`;
    }

    /**
     * Load VidSrc embed player into the video container.
     * @param {string} imdbId
     */
    loadVidSrcSource(imdbId) {
        if (!imdbId) {
            this.elements.videoContainer.innerHTML =
                `<div class="video-placeholder"><span>IMDb ID не найден для этого фильма</span></div>`;
            return;
        }

        const url = this.buildVidSrcUrl(imdbId);
        console.log(`[VidSrc] Loading embed: ${url}`);
        this.currentVideoUrl = url;
        this.renderDefaultPlayer(url);
    }

    async getLastSource(movieId) {
        if (!movieId) return null;
        try {
            const key = `lastSource_${movieId}`;
            const result = await chrome.storage.local.get([key]);
            const saved = result[key];
            if (saved && saved.sourceKey) {
                return saved.sourceKey;
            }
            const oldValue = localStorage.getItem(`last_source_${movieId}`);
            if (oldValue) {
                await this.saveLastSource(movieId, oldValue);
                return oldValue;
            }
            return null;
        } catch (e) {
            console.warn('[getLastSource] Error:', e);
            return null;
        }
    }

    async saveLastSource(movieId, sourceKey) {
        if (!movieId || !sourceKey) return;
        try {
            const key = `lastSource_${movieId}`;
            const data = {
                sourceKey: sourceKey,
                savedAt: Date.now()
            };
            await chrome.storage.local.set({ [key]: data });
            localStorage.removeItem(`last_source_${movieId}`);
        } catch (e) {
            console.warn('[saveLastSource] Error:', e);
            try {
                localStorage.setItem(`last_source_${movieId}`, sourceKey);
            } catch (e2) {}
        }
    }

    togglePlayPause() {
        console.log('[DEBUG togglePlayPause] isPlaying was:', this.isPlaying);
        this.isPlaying = !this.isPlaying;
        console.log('[DEBUG togglePlayPause] isPlaying is now:', this.isPlaying);
        
        if (this.isPlaying) {
            const isMp4 = this.currentVideoUrl?.includes('.mp4');
            const isHls = this.currentVideoUrl?.includes('.m3u8');
            console.log(`[DEBUG togglePlayPause] Detection: isMp4=${isMp4}, isHls=${isHls}, url=${this.currentVideoUrl?.substring(0,80)}`);
            
            if (isMp4 || isHls) {
                // Use Custom Player Wrapper
                console.log('[DEBUG togglePlayPause] Choosing CUSTOM player');
                this.renderCustomPlayer(this.currentVideoUrl, isHls);
            } else {
                console.log('[DEBUG togglePlayPause] Choosing IFRAME player');
                let url = this.currentVideoUrl;
                try { const u = new URL(url); u.searchParams.set('autoplay', '1'); url = u.toString(); } catch (e) { url += url.includes('?') ? '&autoplay=1' : '?autoplay=1'; }
                this.elements.videoContainer.innerHTML = `<iframe src="${url}" allowfullscreen allow="autoplay; encrypted-media; picture-in-picture" style="width:100%; height:100%; border:none;"></iframe>`;
            }
        } else {
            console.log('[DEBUG togglePlayPause] Stopping playback');
            if (this.currentHls) { 
                console.log('[DEBUG togglePlayPause] Destroying HLS instance');
                this.currentHls.destroy(); 
                this.currentHls = null; 
            }
            this.renderSimplePlayer();
        }
    }

    async renderCustomPlayer(url, isHls) {
        console.log('[DEBUG renderCustomPlayer] === renderCustomPlayer() START ===');
        console.log(`[DEBUG renderCustomPlayer] url: ${url?.substring(0,80)}, isHls: ${isHls}`);
        
        // Create wrapper and logic for custom controls
        const wrapper = document.createElement('div');
        wrapper.className = 'video-wrapper';
        
        const video = document.createElement('video');
        video.id = 'nativeVideoPlayer';
        console.log('[DEBUG renderCustomPlayer] Created <video> element');
        video.style.width = '100%';
        video.style.height = '100%';
        video.autoplay = true;
        // video.controls = true; // We use custom controls now
        
        if (!isHls) {
            video.src = url;
            video.type = 'video/mp4';
        }

        // Custom Controls HTML
        const controlsHTML = `
            <div class="custom-controls">
                <div class="progress-container" id="progressBarContainer">
                    <div class="progress-bar" id="progressBar"></div>
                </div>
                <div class="controls-row">
                    <div class="controls-left">
                        <button class="control-btn" id="playPauseBtn">${Icons.PAUSE}</button>
                        <span class="time-display"><span id="currentTime">00:00</span> / <span id="duration">00:00</span></span>
                    </div>
                    <div class="controls-right">
                        <button class="control-btn pip-btn" id="pipBtn" title="Picture-in-Picture">${Icons.PIP || 'PiP'}</button>
                        <div class="volume-container">
                            <button class="control-btn" id="volumeBtn">${Icons.VOLUME_HIGH}</button>
                            <div class="volume-slider-container">
                                <input type="range" class="volume-slider" id="volumeSlider" min="0" max="1" step="0.1" value="1">
                            </div>
                        </div>
                        <button class="control-btn" id="fullscreenBtn">${Icons.FULLSCREEN}</button>
                    </div>
                </div>
            </div>
        `;

        wrapper.appendChild(video);
        wrapper.insertAdjacentHTML('beforeend', controlsHTML);
        
        this.elements.videoContainer.innerHTML = '';
        this.elements.videoContainer.appendChild(wrapper);

        // Initialize HLS if needed - lazy-load the library
        if (isHls) {
            try {
                await LazyLoader.loadScript('../../shared/lib/hls.min.js');
                if (typeof Hls !== 'undefined' && Hls.isSupported()) {
                    const hls = new Hls();
                    hls.loadSource(url);
                    hls.attachMedia(video);
                    hls.on(Hls.Events.MANIFEST_PARSED, () => {
                        video.play().catch(e => console.log('Autoplay blocked', e));
                    });
                    this.currentHls = hls;
                }
            } catch (e) {
                console.error('Failed to load HLS library:', e);
            }
        }

        // Setup Event Listeners for Custom Controls
        this.setupCustomControls(video, wrapper);
    }

    setupCustomControls(video, wrapper) {
        console.log('[DEBUG setupCustomControls] Initializing controls for video:', video.id);

        const playPauseBtn = wrapper.querySelector('#playPauseBtn');
        const progressBarContainer = wrapper.querySelector('#progressBarContainer');
        const progressBar = wrapper.querySelector('#progressBar');
        const currentTimeEl = wrapper.querySelector('#currentTime');
        const durationEl = wrapper.querySelector('#duration');
        const pipBtn = wrapper.querySelector('#pipBtn');
        const volumeBtn = wrapper.querySelector('#volumeBtn');
        const volumeSlider = wrapper.querySelector('#volumeSlider');
        const fullscreenBtn = wrapper.querySelector('#fullscreenBtn');

        // Play/Pause
        const togglePlay = () => {
            if (video.paused || video.ended) {
                video.play();
                playPauseBtn.innerHTML = Icons.PAUSE;
                wrapper.classList.remove('paused');
            } else {
                video.pause();
                playPauseBtn.innerHTML = Icons.PLAY;
                wrapper.classList.add('paused');
            }
        };

        playPauseBtn.addEventListener('click', togglePlay);
        video.addEventListener('click', togglePlay);
        
        video.addEventListener('play', () => {
             playPauseBtn.innerHTML = Icons.PAUSE;
             wrapper.classList.remove('paused');
        });
        video.addEventListener('pause', () => {
             playPauseBtn.innerHTML = Icons.PLAY;
             wrapper.classList.add('paused');
        });

        // PiP Listeners for auto-minimize
        video.addEventListener('enterpictureinpicture', () => {
            console.log('[DEBUG setupCustomControls] Enter PiP (Native Video)');
            this.minimizePlayer(false); // don't pause
        });

        video.addEventListener('leavepictureinpicture', () => {
            console.log('[DEBUG setupCustomControls] Leave PiP (Native Video)');
            this.restorePlayer();
        });

        // Time Update & Progress
        video.addEventListener('timeupdate', () => {
            if (!video.duration) return;
            const progress = (video.currentTime / video.duration) * 100;
            progressBar.style.width = `${progress}%`;
            currentTimeEl.textContent = this.formatTime(video.currentTime);
            durationEl.textContent = this.formatTime(video.duration);
        });

        video.addEventListener('loadedmetadata', () => {
            durationEl.textContent = this.formatTime(video.duration);
        });

        // Seek
        progressBarContainer.addEventListener('click', (e) => {
            const rect = progressBarContainer.getBoundingClientRect();
            const pos = (e.clientX - rect.left) / rect.width;
            video.currentTime = pos * video.duration;
        });

        // Volume
        let lastVolume = 1;
        volumeSlider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            video.volume = val;
            video.muted = val === 0;
            updateVolumeIcon(val);
        });

        volumeBtn.addEventListener('click', () => {
            if (video.muted || video.volume === 0) {
                video.muted = false;
                video.volume = lastVolume || 1;
                volumeSlider.value = lastVolume || 1;
            } else {
                lastVolume = video.volume;
                video.muted = true;
                video.volume = 0;
                volumeSlider.value = 0;
            }
            updateVolumeIcon(video.volume);
        });

        const updateVolumeIcon = (vol) => {
            if (video.muted || vol === 0) volumeBtn.innerHTML = Icons.VOLUME_MUTE;
            else volumeBtn.innerHTML = Icons.VOLUME_HIGH;
        };

        // Picture-in-Picture
        if (document.pictureInPictureEnabled) {
            pipBtn.addEventListener('click', async () => {
                try {
                    if (document.pictureInPictureElement) {
                        await document.exitPictureInPicture();
                    } else {
                        await video.requestPictureInPicture();
                    }
                } catch (error) {
                    console.error('PiP Error:', error);
                }
            });

            video.addEventListener('enterpictureinpicture', () => {
                pipBtn.classList.add('active');
            });

            video.addEventListener('leavepictureinpicture', () => {
                pipBtn.classList.remove('active');
            });
        } else {
            pipBtn.style.display = 'none';
        }

        // Fullscreen
        fullscreenBtn.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                wrapper.requestFullscreen().catch(err => {
                    console.error(`Error attempting to enable fullscreen: ${err.message}`);
                });
            } else {
                document.exitFullscreen();
            }
        });

        document.addEventListener('fullscreenchange', () => {
            if (document.fullscreenElement) {
                fullscreenBtn.innerHTML = Icons.FULLSCREEN_EXIT;
            } else {
                fullscreenBtn.innerHTML = Icons.FULLSCREEN;
            }
        });

        // Auto-hide controls
        let timeout;
        const resetTimer = () => {
            wrapper.classList.remove('idle');
            wrapper.style.cursor = 'default';
            clearTimeout(timeout);
            if (!video.paused) {
                timeout = setTimeout(() => {
                    wrapper.classList.add('idle');
                    wrapper.style.cursor = 'none';
                }, 3000);
            }
        };

        wrapper.addEventListener('mousemove', resetTimer);
        wrapper.addEventListener('click', resetTimer);
    }




    renderSimplePlayer() {
        const posterUrl = this.selectedMovie?.posterUrl || '';
        this.elements.videoContainer.innerHTML = `<div class="simple-player-container"><div class="simple-player-overlay" style="background-image: url('${posterUrl}')"><button class="play-pause-btn" id="mainPlayBtn"><svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg></button></div></div>`;
        document.getElementById('mainPlayBtn')?.addEventListener('click', () => this.togglePlayPause());
    }

    // Button State Methods
    async updateButtonStates() {
        if (!this.currentUser) return;
        const favoriteService = firebaseManager.getFavoriteService();
        
        const buttons = document.querySelectorAll('[data-action="toggle-favorite"], [data-action="toggle-watching"], [data-action="toggle-watched"], [data-action="toggle-watchlist"]');
        for (const button of buttons) {
            const movieId = button.getAttribute('data-movie-id');
            if (!movieId) continue;
            
            try {
                const bookmark = await favoriteService.getBookmark(this.currentUser.uid, parseInt(movieId));
                const action = button.getAttribute('data-action');
                
                if (action === 'toggle-favorite') {
                    const isFavorite = bookmark?.status === 'favorite';
                    Utils.toggleActionButton(button, isFavorite, {
                        active: i18n.get('movie_card.remove_favorite'),
                        inactive: i18n.get('movie_card.add_favorite')
                    }, {
                        active: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>',
                        inactive: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>'
                    });
                } else if (action === 'toggle-watching') {
                    const isWatching = bookmark?.status === 'watching';
                    Utils.toggleActionButton(button, isWatching, {
                        active: i18n.get('movie_card.remove_watching'),
                        inactive: i18n.get('movie_card.add_watching')
                    }, {
                        active: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>',
                        inactive: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>'
                    });
                } else if (action === 'toggle-watched') {
                    const isWatched = bookmark?.status === 'watched';
                    Utils.toggleActionButton(button, isWatched, {
                        active: i18n.get('movie_card.remove_watched'),
                        inactive: i18n.get('movie_card.add_watched')
                    }, {
                        active: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>',
                        inactive: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>'
                    });
                } else if (action === 'toggle-watchlist') {
                    const isInWatchlist = bookmark?.status === 'plan_to_watch';
                    Utils.toggleActionButton(button, isInWatchlist, {
                        active: i18n.get('movie_card.remove_watchlist'),
                        inactive: i18n.get('movie_card.add_watchlist')
                    }, {
                        active: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>',
                        inactive: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>'
                    });
                }
            } catch (e) { console.error('Error updating button:', e); }
        }
    }

    async toggleFavorite(ratingId, currentStatus, buttonElement, movieId) {
        if (!this.currentUser) { if (typeof Utils !== 'undefined') Utils.showToast(i18n.get('navbar.sign_in'), 'warning'); return; }
        try {
            const favoriteService = firebaseManager.getFavoriteService();
            const movie = this.selectedMovie;
            if (!movie) return;

            if (currentStatus) {
                await favoriteService.removeFromFavorites(this.currentUser.uid, movieId);
            } else {
                await favoriteService.addToFavorites(this.currentUser.uid, { ...movie, movieId }, 'favorite');
            }
            
            const newStatus = !currentStatus;
            Utils.toggleActionButton(buttonElement, newStatus, {
                active: i18n.get('movie_card.remove_favorite'),
                inactive: i18n.get('movie_card.add_favorite')
            }, {
                active: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>',
                inactive: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>'
            });
            
            if (typeof Utils !== 'undefined') Utils.showToast(newStatus ? `❤️ ${i18n.get('movie_card.add_favorite')}` : i18n.get('movie_card.remove_favorite'), 'success');
        } catch (error) { console.error('Error toggling favorite:', error); }
    }

    async handleWatchingToggle(movieId, buttonElement) {
        if (!this.currentUser) return;
        try {
            const favoriteService = firebaseManager.getFavoriteService();
            const bookmark = await favoriteService.getBookmark(this.currentUser.uid, movieId);
            const isWatching = bookmark?.status === 'watching';
            
            if (isWatching) {
                await favoriteService.removeFromFavorites(this.currentUser.uid, movieId);
            } else {
                await favoriteService.addToFavorites(this.currentUser.uid, { ...this.selectedMovie, movieId }, 'watching');
            }
            
            const newState = !isWatching;
            Utils.toggleActionButton(buttonElement, newState, {
                active: i18n.get('movie_card.remove_watching'),
                inactive: i18n.get('movie_card.add_watching')
            }, {
                active: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>',
                inactive: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>'
            });
            if (typeof Utils !== 'undefined') Utils.showToast(newState ? i18n.get('movie_card.add_watching') : i18n.get('movie_card.remove_watching'), 'success');
        } catch (error) { console.error('Error toggling watching:', error); }
    }

    async handleWatchedToggle(movieId, buttonElement) {
        if (!this.currentUser) return;
        try {
            const favoriteService = firebaseManager.getFavoriteService();
            const bookmark = await favoriteService.getBookmark(this.currentUser.uid, movieId);
            const isWatched = bookmark?.status === 'watched';
            
            if (isWatched) {
                await favoriteService.removeFromFavorites(this.currentUser.uid, movieId);
            } else {
                await favoriteService.addToFavorites(this.currentUser.uid, { ...this.selectedMovie, movieId }, 'watched');
            }
            
            const newState = !isWatched;
            Utils.toggleActionButton(buttonElement, newState, {
                active: i18n.get('movie_card.remove_watched'),
                inactive: i18n.get('movie_card.add_watched')
            }, {
                active: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>',
                inactive: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>'
            });
            if (typeof Utils !== 'undefined') Utils.showToast(newState ? i18n.get('movie_card.add_watched') : i18n.get('movie_card.remove_watched'), 'success');
        } catch (error) { console.error('Error toggling watched:', error); }
    }

    async handleWatchlistToggle(movieId, buttonElement) {
        if (!this.currentUser) return;
        try {
            const favoriteService = firebaseManager.getFavoriteService();
            const bookmark = await favoriteService.getBookmark(this.currentUser.uid, movieId);
            const isInWatchlist = bookmark?.status === 'plan_to_watch';
            
            if (isInWatchlist) {
                await favoriteService.removeFromFavorites(this.currentUser.uid, movieId);
            } else {
                await favoriteService.addToFavorites(this.currentUser.uid, { ...this.selectedMovie, movieId }, 'plan_to_watch');
            }
            
            const newState = !isInWatchlist;
            Utils.toggleActionButton(buttonElement, newState, {
                active: i18n.get('movie_card.remove_watchlist'),
                inactive: i18n.get('movie_card.add_watchlist')
            }, {
                active: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>',
                inactive: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>'
            });
            if (typeof Utils !== 'undefined') Utils.showToast(newState ? i18n.get('movie_card.add_watchlist') : i18n.get('movie_card.remove_watchlist'), 'success');
        } catch (error) { console.error('Error toggling watchlist:', error); }
    }

    async handleToggleCollection(movieId, collectionId, buttonElement) {
        if (!this.collectionService) return;
        try {
            await this.collectionService.toggleMovieInCollection(collectionId, parseInt(movieId));
            
            const col = this.availableCollections.find(c => c.id === collectionId);
            if (col) {
                const idx = col.movieIds.indexOf(parseInt(movieId));
                if (idx > -1) col.movieIds.splice(idx, 1);
                else col.movieIds.push(parseInt(movieId));
            }
            
            let checkSpan = Array.from(buttonElement.children).find(c => c.textContent.includes('✓'));
            if (checkSpan) checkSpan.remove();
            else {
                const newCheck = document.createElement('span');
                newCheck.textContent = '✓';
                newCheck.style.cssText = 'margin-left: auto; font-weight: bold; color: var(--accent-color, #4CAF50);';
                buttonElement.appendChild(newCheck);
            }
            
            if (typeof Utils !== 'undefined') Utils.showToast(i18n.get('settings.saved'), 'success');
        } catch (error) { console.error('Error toggling collection:', error); }
    }

    // updateButtonState removed in favor of Utils.toggleActionButton

    // Utility Methods
    formatVotes(num) {
        if (!num) return '0';
        if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'm';
        if (num >= 100000) return Math.floor(num / 1000) + 'k';
        if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
        return num.toString();
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    setupImageErrorHandlers() {
        document.addEventListener('error', (event) => {
            if (event.target.tagName === 'IMG' && event.target.hasAttribute('data-fallback')) {
                const img = event.target;
                const type = img.getAttribute('data-fallback');
                
                if (type === 'sequel-poster') {
                    // Prevent infinite retries
                    if (this.failedSequelImages.has(img)) {
                        // If already failed logic, show placeholder
                        this.showSequelPlaceholder(img);
                        return;
                    }
                    
                    this.failedSequelImages.add(img);
                    this.handleSequelPosterError(img);
                    
                } else if (type === 'detail' || type === 'poster') {
                    img.style.display = 'none';
                    const placeholder = img.nextElementSibling;
                    if (placeholder?.classList.contains('movie-poster-placeholder')) placeholder.style.display = 'flex';
                } else if (type === 'frame') {
                    img.closest('.movie-frame')?.style && (img.closest('.movie-frame').style.display = 'none');
                }
                
                // For other types, we remove attribute to stop handling, 
                // but for sequel-poster we might need it if we're retrying with a new URL
                if (type !== 'sequel-poster') {
                    img.removeAttribute('data-fallback');
                }
            }
        }, true);
        
        document.addEventListener('click', (e) => {
            const frame = e.target.closest('.movie-frame');
            if (frame) {
                const url = frame.getAttribute('data-frame-url');
                const index = frame.getAttribute('data-frame-index');
                if (url && index !== null) this.showFrameModal(url, parseInt(index));
            }
        });
    }

    showSequelPlaceholder(img) {
        img.style.display = 'none';
        // You could add a placeholder div here if needed, or just hide the image
        // The container might need styling to look good without image
        const container = img.parentElement;
        if (container) {
            container.style.backgroundColor = '#2a2a2a';
            container.style.display = 'flex';
            container.style.alignItems = 'center';
            container.style.justifyContent = 'center';
            container.innerHTML = '<div style="font-size: 24px;">🎬</div>';
        }
    }

    async loadTrailer(movieId, isSeries = false) {
        if (!this.trailerService) return;
        
        try {
            const trailer = await this.trailerService.getTrailer(movieId, isSeries);
            if (trailer) {
                this.renderTrailerBlock(trailer);
            }
        } catch (error) {
            console.error('[MovieDetails] Error loading trailer:', error);
        }
    }

    renderTrailerBlock(trailer) {
        const actionContainer = this.elements.movieDetailsContainer.querySelector('.movie-actions-container');
        if (!actionContainer) return;
        
        // Check if already exists
        if (document.querySelector('.trailer-block-container')) return;

        const container = document.createElement('div');
        container.className = 'trailer-block-container';
        
        // Use trailer poster or fallback to movie poster
        const posterUrl = trailer.posterUrl || this.selectedMovie?.posterUrl || '/icons/icon48.png';
        const title = trailer.title || 'Трейлер';
        const duration = trailer.duration || '';
        
        container.innerHTML = `
            <div class="trailer-block" role="button" tabindex="0">
                <div class="trailer-poster-wrapper">
                    <img src="${posterUrl}" alt="Trailer" class="trailer-poster" loading="lazy" decoding="async">
                    <div class="trailer-play-icon">
                        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    </div>
                    ${duration ? `<span class="trailer-duration">${duration}</span>` : ''}
                </div>
                <div class="trailer-info">
                    <span class="trailer-title">${this.escapeHtml(title)}</span>
                </div>
            </div>
        `;
        
        // Insert AFTER the action container (Rate/Watch buttons)
        actionContainer.parentNode.insertBefore(container, actionContainer.nextSibling);
        
        container.querySelector('.trailer-block').addEventListener('click', () => {
             console.log('[MovieDetails] Trailer clicked', trailer);
             this.openTrailerModal(trailer);
        });
    }

    openTrailerModal(trailer) {
        if (!trailer.videoUrl) {
            console.error('[MovieDetails] No video URL for trailer', trailer);
            if (typeof Utils !== 'undefined') Utils.showToast('Ссылка на видео не найдена', 'error');
            return;
        }
        
        const modal = this.elements.trailerModal;
        const container = this.elements.trailerContainer;
        const titleEl = this.elements.trailerTitle;
        
        // console.log('[MovieDetails] Opening trailer modal with URL:', trailer.videoUrl);
        
        if (!modal || !container) {
            console.error('[MovieDetails] Trailer modal elements missing');
            return;
        }
        
        if (titleEl) titleEl.textContent = trailer.title || 'Трейлер';
        
        container.innerHTML = `
            <iframe src="${trailer.videoUrl}" 
                    frameborder="0" 
                    allowfullscreen="true" 
                    allow="autoplay"
                    style="width: 100%; height: 100%;">
            </iframe>
        `;
        
        modal.style.display = 'flex';
        // We do NOT set this.isPlaying = true because that controls the main player
    }

    closeTrailerModal() {
        if (this.elements.trailerModal) {
            this.elements.trailerModal.style.display = 'none';
        }
        if (this.elements.trailerContainer) {
            this.elements.trailerContainer.innerHTML = ''; // Stop playback
        }
    }

    async handleSequelPosterError(img) {
        if (!this.selectedMovie || !this.selectedMovie.kinopoiskId) {
            this.showSequelPlaceholder(img);
            return;
        }

        const sequelId = img.getAttribute('data-sequel-id');
        // console.log(`[MovieDetails] Sequel poster failed for ID ${sequelId}, attempting fallback scrape...`);

        try {
            // Fetch sequels from current movie page
            const sequels = await this.sequelsService.getSequels(this.selectedMovie.kinopoiskId);
            
            if (!sequels || sequels.length === 0) {
                console.warn('[MovieDetails] No sequels found in fallback scrape');
                this.showSequelPlaceholder(img);
                return;
            }

            // Find matching sequel
            // Try precise ID match
            let match = sequels.find(s => s.id == sequelId);
            
            // Try fuzzy match if ID mismatch (unlikely but possible with weird API data)
            if (!match) {
                const title = img.alt;
                const year = img.getAttribute('data-year');
                match = sequels.find(s => s.title === title || (year && s.year == year));
            }

            if (match && match.posterUrl) {
                console.log(`[MovieDetails] Found fallback poster for ${sequelId}: ${match.posterUrl}`);
                img.src = match.posterUrl;
                // Don't remove data-fallback immediately, let the new src load. 
                // If the new src fails, the error handler will catch it again, 
                // see that it's in failedSequelImages, and show placeholder.
            } else {
                console.warn(`[MovieDetails] Could not match sequel ${sequelId} in scraped data`);
                this.showSequelPlaceholder(img);
            }

        } catch (error) {
            console.error('[MovieDetails] Error in sequel fallback:', error);
            this.showSequelPlaceholder(img);
        }
    }

    showFrameModal(frameUrl, frameIndex) {
        const frames = this.selectedMovie?.displayFrames || [];
        if (!frames.length) return;
        
        let modal = document.getElementById('frameModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'frameModal';
            modal.className = 'modal-overlay';
            modal.innerHTML = `<div class="modal frame-modal"><div class="modal-header"><h2 class="modal-title">${i18n.get('movie_details.tabs.about').replace('About', 'Frame').replace('О фильме', 'Кадр')}</h2><button class="modal-close" id="frameModalClose">×</button></div><div class="modal-body frame-modal-body"><button class="frame-modal-nav prev" id="frameNavPrev">‹</button><img id="frameModalImage" src="" class="frame-modal-image"><button class="frame-modal-nav next" id="frameNavNext">›</button></div></div>`;
            document.body.appendChild(modal);
            
            modal.addEventListener('click', (e) => { if (e.target === modal || e.target.id === 'frameModalClose') modal.style.display = 'none'; });
            document.getElementById('frameNavPrev').addEventListener('click', (e) => { e.stopPropagation(); const i = parseInt(e.target.dataset.currentIndex || '0'); if (i > 0) this.showFrameAtIndex(frames, i - 1); });
            document.getElementById('frameNavNext').addEventListener('click', (e) => { e.stopPropagation(); const i = parseInt(e.target.dataset.currentIndex || '0'); if (i < frames.length - 1) this.showFrameAtIndex(frames, i + 1); });
        }
        
        this.showFrameAtIndex(frames, frameIndex);
        modal.style.display = 'flex';
    }

    showFrameAtIndex(frames, index) {
        if (index < 0 || index >= frames.length) return;
        const frame = frames[index];
        const url = frame.url || frame.previewUrl || '';
        if (!url) return;
        
        const img = document.getElementById('frameModalImage');
        const prev = document.getElementById('frameNavPrev');
        const next = document.getElementById('frameNavNext');
        
        img.src = url;
        if (prev && next) {
            prev.dataset.currentIndex = index;
            next.dataset.currentIndex = index;
            prev.disabled = index === 0;
            next.disabled = index === frames.length - 1;
        }
    }
    async loadSeasons(movieId) {
        try {
            const seasons = await this.seasonsService.getSeasons(movieId);
            if (seasons && seasons.length > 0) {
                // Show tab
                const tabBtn = document.querySelector('.tab-btn[data-tab="seasons"]');
                if (tabBtn) tabBtn.style.display = 'inline-block';
                
                // Render content
                const tabPane = document.getElementById('tab-seasons');
                if (tabPane) {
                    tabPane.innerHTML = this.renderSeasonsTab(seasons);
                }
                
                // Update movie object
                if (this.selectedMovie) {
                    this.selectedMovie.seasons = seasons;
                }
            } else {
                // Hide tab if no data
                const tabBtn = document.querySelector('.tab-btn[data-tab="seasons"]');
                if (tabBtn) tabBtn.style.display = 'none';
            }
        } catch (e) {
            console.warn('Failed to load seasons:', e);
        }
    }

    renderSeasonsTab(seasons) {
        if (!seasons || seasons.length === 0) return '';
        
        // Simple list rendering
        return `
            <div class="seasons-container">
                ${seasons.map(s => `
                    <div class="season-card">
                        <h4>Сезон ${s.number}</h4>
                        <div class="episodes-list">
                            ${s.episodes ? s.episodes.map(ep => `
                                <div class="episode-item">
                                    <span class="episode-number">${ep.number}</span>
                                    <span class="episode-title">${ep.name || 'Эпизод ' + ep.number}</span>
                                </div>
                            `).join('') : 'Нет информации об эпизодах'}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    initSelectionPopup() {
        const textarea = this.elements.ratingComment;
        if (!textarea) return;

        let popup = null;

        const handleSelection = () => {
            const selection = window.getSelection();
            const selectedText = textarea.value.substring(textarea.selectionStart, textarea.selectionEnd).trim();

            if (selectedText.length > 0 && document.activeElement === textarea) {
                if (!popup) {
                    popup = document.createElement('div');
                    popup.className = 'selection-popup';
                    popup.innerHTML = `
                        <button class="selection-popup-btn" title="Make Spoiler">
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                        </button>
                    `;
                    document.body.appendChild(popup);

                    popup.querySelector('button').addEventListener('mousedown', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        this.wrapSelectionWithSpoilerTag(textarea);
                        hidePopup();
                    });
                }

                // Calculate position above selection
                const coords = this.getTextareaSelectionCoords(textarea);
                popup.style.left = `${coords.left + coords.width / 2}px`;
                popup.style.top = `${coords.top - 45}px`;
                popup.style.display = 'flex';
                popup.style.transform = 'translateX(-50%)';
            } else {
                hidePopup();
            }
        };

        const hidePopup = () => {
            if (popup) popup.style.display = 'none';
        };

        textarea.addEventListener('mouseup', handleSelection);
        textarea.addEventListener('keyup', handleSelection);
        textarea.addEventListener('blur', () => setTimeout(hidePopup, 200));
        
        // Hide popup on scroll if needed, but since it's in a modal, maybe not necessary
        window.addEventListener('resize', hidePopup);
        if (this.elements.ratingModal) {
            this.elements.ratingModal.addEventListener('scroll', hidePopup);
        }
    }

    getTextareaSelectionCoords(textarea) {
        const { selectionStart, selectionEnd } = textarea;
        const style = window.getComputedStyle(textarea);
        
        // Create a ghost element to measure text position
        const ghost = document.createElement('div');
        const properties = [
            'direction', 'boxSizing', 'width', 'height', 'overflowX', 'overflowY',
            'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
            'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
            'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize', 'lineHeight', 'fontFamily',
            'textAlign', 'textTransform', 'textIndent', 'textDecoration', 'letterSpacing', 'wordSpacing'
        ];

        properties.forEach(prop => {
            ghost.style[prop] = style[prop];
        });

        ghost.style.position = 'absolute';
        ghost.style.visibility = 'hidden';
        ghost.style.whiteSpace = 'pre-wrap';
        ghost.style.wordBreak = 'break-word';

        const textBefore = textarea.value.substring(0, selectionStart);
        const selectedText = textarea.value.substring(selectionStart, selectionEnd);

        ghost.textContent = textBefore;
        const span = document.createElement('span');
        span.textContent = selectedText;
        ghost.appendChild(span);

        document.body.appendChild(ghost);
        const rect = textarea.getBoundingClientRect();
        const spanRect = span.getBoundingClientRect();
        
        const coords = {
            top: rect.top + spanRect.top - ghost.getBoundingClientRect().top,
            left: rect.left + spanRect.left - ghost.getBoundingClientRect().left,
            width: spanRect.width,
            height: spanRect.height
        };

        document.body.removeChild(ghost);
        return coords;
    }

    wrapSelectionWithSpoilerTag(textarea) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = textarea.value;
        const selectedText = text.substring(start, end);
        
        if (selectedText.length === 0) return;

        textarea.value = text.substring(0, start) + `||${selectedText}||` + text.substring(end);
        
        // Restore focus and selection
        textarea.focus();
        textarea.setSelectionRange(start, end + 4);
        
        // Trigger input event for character counter if any
        textarea.dispatchEvent(new Event('input'));
    }

}


// Initialize when DOM is loaded
let movieDetailsManager;
document.addEventListener('DOMContentLoaded', () => {
    movieDetailsManager = new MovieDetailsManager();
});

// Alias for compatibility
window.MovieDetailsManager = MovieDetailsManager;
        