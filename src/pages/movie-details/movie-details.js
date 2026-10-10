import { i18n } from '../../shared/i18n/I18n.js';
import { isSpidermanMovie } from '../../shared/config/spidermanMovies.js';
import { isStarWarsMovie } from '../../shared/config/starwarsMovies.js';
import { getRatingIconMarkup } from '../../shared/components/RatingIcons.js';
import { CustomDatePicker, CustomTimePicker } from '../../shared/components/CustomDateTimePicker.js';

function createAppError(code, options = {}) {
    const ErrorCtor = globalThis.AppError;
    if (typeof ErrorCtor === 'function') return new ErrorCtor(code, options);
    const fallback = new Error(options.message || code);
    Object.assign(fallback, {
        name: 'AppError',
        code,
        category: options.category || 'unknown',
        retryable: options.retryable !== false,
        params: { ...(options.params || {}) },
        context: { ...(options.context || {}) },
        userMessage: options.userMessage || null,
        cause: options.cause || null
    });
    return fallback;
}

// Services, configs, and parsers are loaded as deferred scripts in movie-details.html (classic global contract)
// AniskipService.js and SpotifyService.js are lazy-loaded via LazyLoader when needed


/**
 * MovieDetailsManager - Controller for the movie details page
 * Handles movie details display, rating, and video playback
 * Migrated from SearchManager in search.js
 */
class MovieDetailsManager {
    constructor() {
        this.elements = this.initializeElements();
        this.selectedMovie = null;
        // Page generation is the lifecycle authority for asynchronous page enrichment.
        // It advances only when the page starts representing a different movie (or is
        // invalidated on unload). Same-movie renders, such as a locale refresh, keep
        // their generation so in-flight work may safely complete into the replacement DOM.
        this.pageGeneration = 0;
        this.activePageContext = null;
        this.currentUser = null;
        this.commentReactionSummaries = new Map();
        this.commentUserReactions = new Map();
        this.commentReactionPending = new Set();
        this.latestRatingsSnapshot = null;
        this.latestRatingsSnapshotMovieId = null;
        this.latestRatingsSnapshotUser = null;
        this.authVerified = false;
        this.authDecision = 'unresolved';
        this.speculativeMovie = null;
        this.speculativeCacheResolved = false;
        this.postRenderEnrichmentMovieId = null;
        this.renderEnrichmentSnapshot = null;
        this.currentRating = 0;
        this.originalRating = 0;
        this.isReviewVisible = false;
        this.currentRatingId = null;
        this.currentPersonalRating = null;
        this.currentSeriesEpisodeRatings = {
            exists: false,
            episodes: {},
        };
        this.episodeRatingsPermissionDeniedMovieId = null;
        this.episodeRatingUiVersion = 0;
        this.isEpisodeRatingMutationPending = false;
        this.originalRatingComment = '';
        this.originalRatingReview = '';
        this.ratingReviewTouched = false;
        this.activeReviewReaderRating = null;
        this.parserRegistry = window.parserRegistry || new ParserRegistry();
        this.progressService = new ProgressService();
        this.episodeHistoryService = typeof EpisodeHistoryService !== 'undefined' ? new EpisodeHistoryService() : null;
        this.currentEpisodeHistory = {};
        this.availableCollections = [];

        // Admin status — default false; will be overridden by cached value immediately
        // and then confirmed (and re-cached) once Firebase auth resolves.
        this.isAdmin = false;
        
        // UI State Manager
        this.page = Utils.createPageStateManager({
            loader: document.getElementById('loadingState'),
            errorScreen: document.getElementById('errorState'),
            errorMessage: document.getElementById('errorMessage'),
            contentContainer: document.getElementById('movieDetailsContainer'),
            onRetry: () => this.handleLoadRetry(),
            onBack: () => this.goBackToSearch()
        });
        
        // Video player state
        this.isPlaying = false;
        this.currentVideoUrl = '';
        this.currentSources = [];
        this.currentHls = null;
        this.hlsPlaybackState = '';
        this.mediaPlayerService = typeof MediaPlayerService !== 'undefined' ? new MediaPlayerService() : null;
        this.mediaPlayerReady = false;
        this.mediaPlayerSetupState = { enabled: false, status: 'disabled', installPath: '' };
        this.mediaPlayerReadinessRequestId = 0;
        this.torrentSources = [];
        this.torrentRequestId = 0;
        this.torrentSearchJobId = null;
        this.torrentSearchTmdbId = null;
        this.torrentPlaybackSession = null;
        this.latestTorrentPlaybackProgress = { state: 'starting' };
        this.torrentProgressTimer = null;
        this.torrentPlaybackVideo = null;
        this.torrentPlaybackVideoCleanup = null;
        this.torrentPlaybackStartTimer = null;
        this.torrentPlaybackAvailableDurationSeconds = null;
        this.torrentHasPlaybackSnapshot = false;
        this.torrentActiveContext = null;
        this.torrentVisibleSourceLimit = 10;
        this.torrentDownloads = [];
        this.torrentDownloadTimer = null;
        this.torrentDownloadRequestActive = false;
        this.torrentDownloadRequestToken = 0;
        this.torrentDownloadAbortController = null;
        this.torrentDownloadMonitorToken = 0;
        this.torrentDownloadPollDelayMs = 2500;
        this.torrentServiceHealth = 'unknown';
        this.torrentProgressRequestActive = false;
        this.torrentProgressAbortController = null;
        this.torrentProgressMonitorToken = 0;
        this.torrentProgressPollDelayMs = 2500;
        this.torrentQualityFilter = 'all';
        this.torrentLanguageFilter = 'all';
        this.torrentSort = 'recommended';
        this.torrentSearchState = { status: 'idle', found: 0 };
        this.currentEpisodes = []; // Track episodes separately from sources/providers
        this.videoModalMovie = null;
        this.youtubeTitleCache = new Map();
        this.messageListenerSetup = false;
        this.playerEpisodeNavigationPending = false;
        // Single source of truth for parser players. Every entry belongs to one movieId;
        // switching movies disposes the whole registry before new entries are created.
        this.playerRegistry = {};  // { [parserId]: { movieId, container, video, initialized, ready, sources, renderOptions } }
        this.activePlayerId = null; // parserId currently mounted in the modal
        // Provider errors must not silently replace a canonical parser mount
        // with a raw iframe. Keep the failure state local to the current
        // provider request so navigation controls cannot dispatch into a dead
        // or foreign iframe.
        this.unavailableProviderIds = new Set();
        this.preloadTimeout = null;
        this.sourceSwitchRequestId = 0;
        this.sourceLifecycleWatcher = null;
        this.watchRoomStatusTimer = null;
        this.rutubeWatchRoomBridge = typeof RutubeWatchRoomBridge !== 'undefined'
            ? new RutubeWatchRoomBridge({
                getIframe: () => this.elements.videoContainer?.querySelector?.('iframe[data-player-source-active="true"]')
                    || this.elements.videoContainer?.querySelector?.('iframe'),
            })
            : null;
        this.watchRoomController = typeof WatchRoomStagingController !== 'undefined'
            ? new WatchRoomStagingController({
                getIframe: () => this.elements.videoContainer?.querySelector?.('iframe[data-player-source-active="true"]')
                    || this.elements.videoContainer?.querySelector?.('iframe'),
                getVideo: () => this.elements.videoContainer?.querySelector?.('video:not(.ghost-video)'),
                getMovie: () => this.selectedMovie,
                getProviderId: () => this.getWatchRoomProviderId(),
                getProviderSource: () => this.getWatchRoomProviderSource(),
                getPlayerBridge: () => this.getWatchRoomPlayerBridge(),
                getSelection: () => this.playbackController?.getSelection?.() || null,
                onProviderChange: (providerId, providerSource) => this.changeWatchRoomProvider(providerId, providerSource),
                onSelectionRequest: (selection) => this.changeWatchRoomSelection(selection),
                onStatus: (message, options) => this.setWatchRoomStatus(message, options),
                onPlaybackBlocked: (blocked) => this.setWatchRoomPlaybackBlocked(blocked),
                onExpiryWarning: (warning) => this.setWatchRoomExpiryWarning(warning),
                onRoomUpdate: (room) => this.renderWatchRoomMembers(room),
            })
            : null;
        this.watchRoomJoinCode = null;
        this.kinogoContentRecovery = {
            key: null,
            attempts: 0,
            inFlight: null
        };
        
        // Canonical Playback Controller
        this.playbackController = typeof PlaybackController !== 'undefined'
            ? new PlaybackController({
                container: this.elements.videoContainer,
                modal: this.elements.videoPlayerModal,
                lifecycle: window.PlayerSourceLifecycle,
                progressService: this.progressService,
                episodeHistoryService: this.episodeHistoryService,
                onSelectionChange: (selection) => {
                    if (selection && selection.episodeNumber != null) {
                        // Compatibility mirror for Aniskip and legacy scripts
                        this.currentEpisode = selection.episodeNumber;
                    }
                    this.updateActiveEpisodePlayingState(selection);
                    // Episode changes are shared with an active watch room.
                    this.watchRoomController?.publishHostSelection?.(selection);
                },
                onProviderChange: (providerId) => {
                    this.activePlayerId = providerId;
                },
                onStateChange: (state) => {
                    if (state === 'closed') {
                        this.updateActiveEpisodePlayingState(null);
                    }
                }
            })
            : null;

        // Auto-Next Coordinator (Phase 3G)
        this.autoNextCoordinator = typeof AutoNextCoordinator !== 'undefined'
            ? new AutoNextCoordinator({
                playbackController: this.playbackController,
                onPlayNext: (targetSelection) => {
                    this.playSelection(targetSelection);
                },
                resolveNextEpisode: (m, s, d, o) => this.resolveAdjacentEpisode(m, s, d, o),
                elements: {
                    promptEl: this.elements.playerAutoNextPrompt,
                    countdownTextEl: this.elements.playerAutoNextCountdown,
                    targetTitleEl: this.elements.playerAutoNextTargetTitle,
                    playNowBtn: this.elements.playerAutoNextPlayBtn,
                    cancelBtn: this.elements.playerAutoNextCancelBtn
                }
            })
            : null;

        if (this.playbackController && this.autoNextCoordinator) {
            this.playbackController.subscribeEnded((event) => {
                if (this.autoNextCoordinator && this.selectedMovie) {
                    const loadedEpisodes = this.currentEpisodes || null;
                    const loadedSeasonNumber = this.selectedSeasonNumber || null;
                    this.autoNextCoordinator.handlePlaybackEnded({
                        movie: this.selectedMovie,
                        selection: event.selection,
                        runtime: event.runtime,
                        adapter: this.playbackController.getAdapter(event.selection?.providerId),
                        mountToken: event.token,
                        options: {
                            loadedEpisodes,
                            loadedSeasonNumber,
                            isEpisodePlayableByDate: (ep) => this.isEpisodePlayableByDate(ep)
                        }
                    });
                }
            });
            this.playbackController.subscribeCancelAutoNext(() => {
                this.autoNextCoordinator?.cancel();
            });
            this.playbackController.subscribeCompletion(() => {
                this.refreshSeasonsProgress();
            });
        }
        
        // Progress & Watch Target tracking (Phase 4A)
        this.currentProgressRecord = null;
        this.currentWatchTarget = null;

        this.sequelsService = new SequelsParsingService();
        this.recommendationService = null;
        this.recommendationsLoadedForMovieId = null;
        this.recommendationsState = { movieId: null, status: 'idle', data: null };
        this.recommendationsObserver = null;
        this.recommendationPosterObserver = null;
        this.franchiseService = null;
        this.franchiseLoadedForMovieId = null;
        this.franchiseState = { movieId: null, status: 'idle', data: null };
        this.franchiseObserver = null;
        this.trailerService = new TrailerParsingService();
        this.seasonsService = new SeasonsParsingService();
        this.aniskipService = null; // Lazy-loaded when video player opens
        this.currentSkipTimes = null; // Track current episode skip times
        this.currentEpisode = 1; // Track current episode for anime skip
        this.failedSequelImages = new Set(); // Track failures to avoid infinite loops
        this.failedYoutubeThumbs = new Set(); // Track failed YouTube thumbnails to fallback to mqdefault/poster
        
        // Spotify Service - lazy-loaded when Soundtrack tab opens
        this.spotifyService = null;

        // Dynamic SWR in-flight deduplication map
        this.dynamicRefreshRequests = new Map();

        // Embedded mode: when loaded inside a site's page via iframe
        const urlParams = new URLSearchParams(window.location.search);
        this.isEmbedded = urlParams.get('embedded') === 'true';
        this.pendingReviewRatingId = urlParams.get('reviewId');
        this.perf = window.MovieDetailsPerf || null;
        this.perf?.start({ movieId: urlParams.get('movieId') });

        this.setupEventListeners();
        this.setupCommentReactionListeners();
        this.initSelectionPopup();
        this.init().catch(error => {
            console.error('[MovieDetails] Initialization failed:', error);
            this.page.showError(error, { context: { operation: 'movie-details-init' } });
        });
    }

    async init() {
        await i18n.init();
        this.perf?.mark('md:i18n-ready');
        i18n.translatePage();
        await this.initializeUI();

        
        // Listen for language changes
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.type === 'UPDATE_QUERY_PLAYBACK') {
                const nativeMediaPlaying = Array.from(document.querySelectorAll('audio,video'))
                    .some(media => Boolean(media.currentSrc || media.src || media.srcObject)
                        && media.readyState >= HTMLMediaElement.HAVE_METADATA
                        && !media.paused && !media.ended && !media.error);
                const runtimePlaying = this.playbackController?.getRuntimeState?.().isPlaying === true;
                sendResponse({ isPlaying: nativeMediaPlaying || runtimePlaying || this.isPlaying === true });
                return false;
            }
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
        if (typeof settings.mediaPlayerEnabled === 'boolean' || settings.mediaPlayerSetup) {
            await this.refreshMediaPlayerReadiness();
            this.populateSourceSelector();
        }
    }

    initializeElements() {
        return {
            // Page containers
            movieDetailsContainer: document.getElementById('movieDetailsContainer'),
            loadingState: document.getElementById('loadingState'),
            errorState: document.getElementById('errorState'),
            errorMessage: document.getElementById('errorMessage'),
            retryLoadBtn: document.getElementById('retryLoadBtn'),
            backToSearchBtn: document.getElementById('backToSearchBtn'),
            
            // Rating Modal
            ratingModal: document.getElementById('ratingModal'),
            ratingMoviePoster: document.getElementById('ratingMoviePoster'),
            ratingMovieTitle: document.getElementById('ratingMovieTitle'),
            ratingMovieMeta: document.getElementById('ratingMovieMeta'),
            ratingStars: document.getElementById('ratingStars'),
            ratingStatus: document.getElementById('ratingStatus'),
            writeReviewBtn: document.getElementById('writeReviewBtn'),
            reviewContainer: document.getElementById('reviewContainer'),
            ratingComment: document.getElementById('ratingComment'),
            charCount: document.getElementById('charCount'),
            ratingReview: document.getElementById('ratingReview'),
            reviewCharCount: document.getElementById('reviewCharCount'),
            ratingReviewError: document.getElementById('ratingReviewError'),
            saveRatingBtn: document.getElementById('saveRatingBtn'),
            cancelRatingBtn: document.getElementById('cancelRatingBtn'),
            ratingModalClose: document.getElementById('ratingModalClose'),
            reviewReaderModal: document.getElementById('reviewReaderModal'),
            reviewReaderClose: document.getElementById('reviewReaderClose'),
            reviewReaderCloseAction: document.getElementById('reviewReaderCloseAction'),
            reviewReaderTitle: document.getElementById('reviewReaderTitle'),
            reviewReaderMeta: document.getElementById('reviewReaderMeta'),
            reviewReaderBody: document.getElementById('reviewReaderBody'),
            reviewReaderReport: document.getElementById('reviewReaderReport'),

            // Video Player Modal
            videoPlayerModal: document.getElementById('videoPlayerModal'),
            videoTitle: document.getElementById('videoTitle'),
            videoSubtitle: document.getElementById('videoSubtitle'),
            playerNavControls: document.getElementById('playerNavControls'),
            playerPrevEpisodeBtn: document.getElementById('playerPrevEpisodeBtn'),
            playerNextEpisodeBtn: document.getElementById('playerNextEpisodeBtn'),
            playerEpisodesListBtn: document.getElementById('playerEpisodesListBtn'),
            playerEpisodesListBtnLabel: document.getElementById('playerEpisodesListBtnLabel'),
            playerEpisodePickerPopover: document.getElementById('playerEpisodePickerPopover'),
            playerEpisodePickerCloseBtn: document.getElementById('playerEpisodePickerCloseBtn'),
            pickerSeasonsSection: document.getElementById('pickerSeasonsSection'),
            pickerSeasonsList: document.getElementById('pickerSeasonsList'),
            pickerEpisodesList: document.getElementById('pickerEpisodesList'),
            videoContainer: document.getElementById('videoContainer'),
            closeVideoBtn: document.getElementById('closeVideoBtn'),
            minimizeVideoBtn: document.getElementById('minimizeVideoBtn'),
            sourceButtonsContainer: document.getElementById('sourceButtonsContainer'),
            torrentSourcePanel: document.getElementById('torrentSourcePanel'),
            torrentSourceStatus: document.getElementById('torrentSourceStatus'),
            torrentSourceControls: document.getElementById('torrentSourceControls'),
            torrentSourceSort: document.getElementById('torrentSourceSort'),
            torrentSourceLanguageFilter: document.getElementById('torrentSourceLanguageFilter'),
            torrentSourceSearchBtn: document.getElementById('torrentSourceSearchBtn'),
            torrentSourceList: document.getElementById('torrentSourceList'),
            torrentSourceDisclosure: document.getElementById('torrentSourceDisclosure'),
            torrentSourceShowMoreBtn: document.getElementById('torrentSourceShowMoreBtn'),
            torrentDownloadLibrary: document.getElementById('torrentDownloadLibrary'),
            torrentDownloadList: document.getElementById('torrentDownloadList'),
            torrentSourceCloseBtn: document.getElementById('torrentSourceCloseBtn'),
            torrentPlaybackStatus: document.getElementById('torrentPlaybackStatus'),
            createWatchRoomBtn: document.getElementById('createWatchRoomBtn'),
            joinWatchRoomBtn: document.getElementById('joinWatchRoomBtn'),
            copyWatchRoomCodeBtn: document.getElementById('copyWatchRoomCodeBtn'),
            watchRoomMembersBtn: document.getElementById('watchRoomMembersBtn'),
            leaveWatchRoomBtn: document.getElementById('leaveWatchRoomBtn'),
            resumeWatchRoomPlaybackBtn: document.getElementById('resumeWatchRoomPlaybackBtn'),
            extendWatchRoomBtn: document.getElementById('extendWatchRoomBtn'),
            leaveWatchRoomLabel: document.getElementById('leaveWatchRoomLabel'),
            watchRoomParticipantCount: document.getElementById('watchRoomParticipantCount'),
            watchRoomMembersPopover: document.getElementById('watchRoomMembersPopover'),
            watchRoomMembersList: document.getElementById('watchRoomMembersList'),
            watchRoomInvitePopover: document.getElementById('watchRoomInvitePopover'),
            watchRoomInviteTitle: document.getElementById('watchRoomInviteTitle'),
            watchRoomInviteHint: document.getElementById('watchRoomInviteHint'),
            watchRoomInviteInput: document.getElementById('watchRoomInviteInput'),
            watchRoomInviteError: document.getElementById('watchRoomInviteError'),
            watchRoomInviteCancelBtn: document.getElementById('watchRoomInviteCancelBtn'),
            watchRoomInviteSubmitBtn: document.getElementById('watchRoomInviteSubmitBtn'),
            watchRoomControls: document.getElementById('watchRoomControls'),
            watchRoomStatus: document.getElementById('watchRoomStatus'),

            // Auto-Next Prompt Overlay (Phase 3G)
            playerAutoNextPrompt: document.getElementById('playerAutoNextPrompt'),
            playerAutoNextCountdown: document.getElementById('playerAutoNextCountdown'),
            playerAutoNextTargetTitle: document.getElementById('playerAutoNextTargetTitle'),
            playerAutoNextPlayBtn: document.getElementById('playerAutoNextPlayBtn'),
            playerAutoNextCancelBtn: document.getElementById('playerAutoNextCancelBtn'),

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



    setupEventListeners() {
        // Retry button
        if (this.elements.retryLoadBtn) {
            this.elements.retryLoadBtn.addEventListener('click', () => this.handleLoadRetry());
        }

        // Back button
        if (this.elements.backToSearchBtn) {
            this.elements.backToSearchBtn.addEventListener('click', () => this.goBackToSearch());
        }
        
        // Rating Modal
        if (this.elements.ratingModalClose) {
            this.elements.ratingModalClose.addEventListener('click', () => this.closeRatingModal());
        }
        if (this.elements.cancelRatingBtn) {
            this.elements.cancelRatingBtn.addEventListener('click', () => this.closeRatingModal());
        }
        if (this.elements.ratingModal) {
            this.elements.ratingModal.addEventListener('mousedown', (e) => {
                if (e.target === this.elements.ratingModal) this.closeRatingModal();
            });
        }
        if (this.elements.reviewReaderClose) {
            this.elements.reviewReaderClose.addEventListener('click', () => this.closeReviewReader());
        }
        if (this.elements.reviewReaderCloseAction) {
            this.elements.reviewReaderCloseAction.addEventListener('click', () => this.closeReviewReader());
        }
        if (this.elements.reviewReaderModal) {
            this.elements.reviewReaderModal.addEventListener('mousedown', (event) => {
                if (event.target === this.elements.reviewReaderModal) this.closeReviewReader();
            });
        }
        if (this.elements.reviewReaderReport) {
            this.elements.reviewReaderReport.addEventListener('click', () => this.reportActiveReview());
        }
        
        // Rating Stars
        if (this.elements.ratingStars) {
            this.elements.ratingStars.addEventListener('pointerover', (e) => {
                const btn = e.target.closest('.star-rating-btn');
                if (btn) {
                    const rating = parseInt(btn.dataset.rating);
                    this.updateStarVisuals(rating, true);
                }
            });

            this.elements.ratingStars.addEventListener('pointerleave', () => {
                this.updateStarVisuals(this.currentRating, false);
            });

            this.elements.ratingStars.addEventListener('focusin', (e) => {
                const btn = e.target.closest('.star-rating-btn');
                if (btn) this.updateStarVisuals(parseInt(btn.dataset.rating), true);
            });

            this.elements.ratingStars.addEventListener('focusout', (e) => {
                if (e.target.closest('.star-rating-btn')) {
                    this.updateStarVisuals(this.currentRating, false);
                }
            });

            this.elements.ratingStars.addEventListener('keydown', (e) => {
                const btn = e.target.closest('.star-rating-btn');
                if (!btn) return;

                const buttons = [...this.elements.ratingStars.querySelectorAll('.star-rating-btn')];
                const index = buttons.indexOf(btn);
                const targetIndex = {
                    ArrowLeft: Math.max(0, index - 1),
                    ArrowDown: Math.max(0, index - 1),
                    ArrowRight: Math.min(buttons.length - 1, index + 1),
                    ArrowUp: Math.min(buttons.length - 1, index + 1),
                    Home: 0,
                    End: buttons.length - 1
                }[e.key];

                if (targetIndex === undefined) return;
                e.preventDefault();
                buttons[targetIndex].focus();
            });

            this.elements.ratingStars.addEventListener('click', (e) => {
                const btn = e.target.closest('.star-rating-btn');
                if (btn) {
                    const rating = parseInt(btn.dataset.rating);
                    this.currentRating = rating;
                    this.updateStarVisuals(rating, false);
                }
            });
        }

        if (this.elements.writeReviewBtn) {
            this.elements.writeReviewBtn.addEventListener('click', () => {
                this.isReviewVisible = !this.isReviewVisible;
                this.elements.reviewContainer.style.display = this.isReviewVisible ? 'block' : 'none';
                if (this.isReviewVisible) {
                    this.elements.ratingComment.focus();
                }
            });
        }

        if (this.elements.ratingComment && this.elements.charCount) {
            this.elements.ratingComment.addEventListener('input', (e) => {
                this.elements.charCount.textContent = this.getRatingTextLength(e.target.value);
            });
        }
        if (this.elements.ratingReview) {
            this.elements.ratingReview.addEventListener('input', (e) => {
                this.ratingReviewTouched = true;
                this.elements.reviewCharCount.textContent = this.getRatingTextLength(e.target.value);
                this.clearRatingReviewError();
            });
        }
        
        if (this.elements.saveRatingBtn) {
            this.elements.saveRatingBtn.addEventListener('click', () => this.saveRating());
        }
        this.elements.movieDetailsContainer?.addEventListener('keydown', event => this.handleEpisodeRatingKeydown(event));
        this.elements.movieDetailsContainer?.addEventListener('keydown', event => this.handleSeasonsBrowserKeydown(event));
        this.elements.movieDetailsContainer?.addEventListener('mouseover', event => this.handleEpisodeRatingPointer(event));
        this.elements.movieDetailsContainer?.addEventListener('mouseout', event => this.handleEpisodeRatingPointer(event));
        this.elements.movieDetailsContainer?.addEventListener('error', event => {
            const image = event.target;
            if (image?.matches?.('[data-episode-still]')) {
                const still = image.closest('.episode-detail-still');
                if (still) still.innerHTML = '<span aria-label="Кадр отсутствует">▶</span>';
            }
        }, true);
        window.addEventListener('resize', () => this.updateEpisodeChartScrollControls());

        // Video Player Modal
        if (this.elements.closeVideoBtn) {
            this.elements.closeVideoBtn.addEventListener('click', () => this.closeVideoModal());
        }
        if (this.elements.minimizeVideoBtn) {
            this.elements.minimizeVideoBtn.addEventListener('click', () => this.minimizePlayer());
        }
        if (this.elements.watchRoomControls) {
            // Capture the action before a stale page-level listener can handle
            // the same click as a different room action after an extension reload.
            this.elements.watchRoomControls.addEventListener('click', (event) => this.handleWatchRoomAction(event), true);
        }
        if (this.elements.watchRoomInvitePopover) {
            this.elements.watchRoomInvitePopover.addEventListener('submit', (event) => {
                event.preventDefault();
                void this.submitWatchRoomInvite();
            });
        }
        if (this.elements.videoContainer && typeof MutationObserver !== 'undefined') {
            // PlayerSourceLifecycle writes data-source-state for every source
            // path; mirror it onto the active source button.
            new MutationObserver(() => {
                this.refreshSourceButtonStates();
                // A ready player is the earliest moment a saved watch room
                // can be rejoined after a reload or an invite hand-off.
                if (this.elements.videoContainer.getAttribute('data-source-state') === 'ready') {
                    void this.resumeWatchRoomIfPending?.();
                }
            }).observe(this.elements.videoContainer, { attributes: true, attributeFilter: ['data-source-state'] });
        }
        if (this.elements.videoPlayerModal) {
            this.elements.videoPlayerModal.addEventListener('mousedown', (e) => {
                if (e.target === this.elements.videoPlayerModal) this.minimizePlayer();
            });
        }
        if (this.elements.playerEpisodesListBtn) {
            this.elements.playerEpisodesListBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleEpisodePicker();
            });
        }
        if (this.elements.playerEpisodePickerCloseBtn) {
            this.elements.playerEpisodePickerCloseBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.closeEpisodePicker();
            });
        }
        document.addEventListener('click', (event) => {
            if (!this.isEpisodePickerOpen) return;
            const path = event.composedPath ? event.composedPath() : [];
            const isInside = path.some(el => el instanceof HTMLElement && (
                el.id === 'playerEpisodesListBtn' ||
                el.id === 'playerEpisodePickerPopover' ||
                el.getAttribute?.('data-action') === 'toggle-episode-picker' ||
                el.closest?.('#playerEpisodesListBtn, [data-action="toggle-episode-picker"], #playerEpisodePickerPopover')
            )) || Boolean(event.target?.closest?.('#playerEpisodesListBtn, [data-action="toggle-episode-picker"], #playerEpisodePickerPopover'));
            
            if (isInside) {
                return;
            }
            this.closeEpisodePicker();
        });
        this.setupPlayerMessageListener();
        if (this.elements.sourceButtonsContainer) {
            this.elements.sourceButtonsContainer.addEventListener('click', async (e) => {
                const btn = e.target.closest('.source-btn');
                if (btn) {
                    const value = btn.getAttribute('data-value');
                    if (value === 'mediaplayer:torrent') {
                        e.preventDefault();
                        await this.openTorrentPicker();
                        return;
                    }
                    if (value && !btn.classList.contains('active')) {
                        await this.changeVideoSource(value);
                    }
                }
            });
        }
        if (this.elements.torrentSourceCloseBtn) {
            this.elements.torrentSourceCloseBtn.addEventListener('click', () => this.closeTorrentPicker());
        }
        document.getElementById('torrentWorkspaceBtn')?.addEventListener('click', () => {
            this.focusTorrentRegion(this.elements.torrentSourcePanel);
        });
        if (this.elements.torrentSourceControls) {
            this.elements.torrentSourceControls.addEventListener('click', (event) => {
                const chip = event.target.closest('[data-quality-filter]');
                if (!chip) return;
                this.torrentQualityFilter = String(chip.getAttribute('data-quality-filter') || 'all');
                this.elements.torrentSourceControls.querySelectorAll('[data-quality-filter]').forEach((item) => {
                    item.classList.toggle('is-active', item === chip);
                });
                this.renderTorrentSources(this.torrentSources);
            });
        }
        if (this.elements.torrentSourceSort) {
            this.elements.torrentSourceSort.addEventListener('change', (event) => {
                this.torrentSort = String(event.target.value || 'recommended');
                this.renderTorrentSources(this.torrentSources);
            });
        }
        if (this.elements.torrentSourceLanguageFilter) {
            this.elements.torrentSourceLanguageFilter.addEventListener('change', (event) => {
                this.torrentLanguageFilter = String(event.target.value || 'all');
                this.torrentVisibleSourceLimit = 10;
                this.renderTorrentSources(this.torrentSources);
            });
        }
        if (this.elements.torrentSourceSearchBtn) {
            this.elements.torrentSourceSearchBtn.addEventListener('click', () => {
                void this.searchTorrentSources();
            });
        }
        if (this.elements.torrentSourcePanel) {
            this.elements.torrentSourcePanel.addEventListener('click', (event) => {
                const showMore = event.target.closest('#torrentSourceShowMoreBtn');
                if (showMore) {
                    this.torrentVisibleSourceLimit += 10;
                    this.renderTorrentSources(this.torrentSources);
                    return;
                }

                const action = event.target.closest('[data-download-action]');
                const downloadId = action?.getAttribute('data-download-id');
                if (action && downloadId) {
                    event.preventDefault();
                    const downloadAction = action.getAttribute('data-download-action');
                    if (downloadAction === 'play') void this.playSavedTorrent(downloadId);
                    if (downloadAction === 'pause') void this.pauseSavedTorrent(downloadId);
                    if (downloadAction === 'resume') void this.resumeSavedTorrent(downloadId);
                    if (downloadAction === 'delete') void this.deleteSavedTorrent(downloadId);
                    return;
                }

                const sourceButton = event.target.closest('.torrent-source-card__select');
                const sourceId = sourceButton?.getAttribute('data-source-id');
                if (sourceButton && sourceId) void this.startTorrentPlayback(sourceId);
            });
        }
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && !this.elements?.torrentSourcePanel?.hidden) {
                void this.refreshTorrentDownloads();
            }
        });
        window.addEventListener('focus', () => {
            if (!this.elements?.torrentSourcePanel?.hidden) void this.refreshTorrentDownloads();
        });
        this.registerModalLayers();

        // Trailer Modal Listeners
        if (this.elements.closeTrailerBtn) {
            this.elements.closeTrailerBtn.addEventListener('click', () => this.closeTrailerModal());
        }
        if (this.elements.trailerModal) {
            this.elements.trailerModal.addEventListener('mousedown', (e) => {
                if (e.target === this.elements.trailerModal) this.closeTrailerModal();
            });
        }

        // Restore Player Button
        const restoreBtn = document.getElementById('restorePlayerBtn');
        if (restoreBtn) {
            restoreBtn.addEventListener('click', (e) => {
                if (e.target.closest('.restore-close')) return; // Let the close handler handle it
                this.restorePlayer();
            });
            
            const closeRestoreBtn = document.getElementById('closeRestoreBtn');
            if (closeRestoreBtn) {
                closeRestoreBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.closeVideoModal();
                });
            }
        }

        // Tab navigation & Menu delegation
        Utils.bindTabsAndMenus(document);

        // WAI-ARIA tabs: arrows/Home/End move between visible, enabled tabs.
        // Scoped to the content container; document-level keys belong to ModalStack.
        this.elements.movieDetailsContainer?.addEventListener('keydown', (e) => {
            const tab = e.target.closest?.('.movie-tabs [role="tab"]');
            if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
            const tabs = Array.from(tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]'))
                .filter(item => !item.disabled && item.style.display !== 'none');
            const index = tabs.indexOf(tab);
            if (index < 0 || tabs.length < 2) return;
            e.preventDefault();
            const nextIndex = e.key === 'Home' ? 0
                : e.key === 'End' ? tabs.length - 1
                    : (index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
            tabs[nextIndex].focus();
            tabs[nextIndex].click();
        });

        // Action buttons delegation (click keeps Enter/Space activation working)
        document.addEventListener('click', (e) => {
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
            } else if (action === 'add-to-random-pool' && movieId) {
                this.handleAddToRandomPool(movieId, actionBtn);
            } else if (action === 'force-refresh-movie' && movieId) {
                this.closeOpenMenus();
                this.handleForceRefreshMovie(movieId);
            } else if (action === 'toggle-collection' && movieId) {
                const collectionId = actionBtn.getAttribute('data-collection-id');
                if (collectionId) this.handleToggleCollection(movieId, collectionId, actionBtn);
            } else if (action === 'edit-user-rating' || (action === 'edit' && ratingId)) {
                this.closeOpenMenus();
                this.showRatingModal(this.selectedMovie);
            } else if (action === 'delete-user-rating' || (action === 'delete' && ratingId)) {
                this.closeOpenMenus();
                this.deleteUserRating(ratingId);
            } else if (action === 'read-rating-review' && ratingId) {
                this.openReviewReaderByRatingId(ratingId);
            } else if (action === 'episode-rating-choice') {
                e.preventDefault();
                e.stopPropagation();
                void this.changeEpisodeRating(actionBtn, Number(actionBtn.getAttribute('data-rating')));
            } else if (action === 'episode-rating-remove') {
                e.preventDefault();
                e.stopPropagation();
                void this.changeEpisodeRating(actionBtn, null);
            } else if (action === 'retry-season') {
                void this.loadSelectedSeason(Number(actionBtn.dataset.seasonNumber), { forceRefresh: true });
            } else if (action === 'select-season-pill') {
                void this.handleSeasonPillSelect(Number(actionBtn.dataset.seasonNumber));
            } else if (action === 'select-browser-episode') {
                this.selectSeasonEpisode(Number(actionBtn.dataset.episodeNumber));
            } else if (action === 'navigate-browser-episode') {
                void this.navigateSeasonEpisode(actionBtn.dataset.direction);
            } else if (action === 'scroll-episode-chart') {
                const chart = document.querySelector('.episode-chart');
                chart?.scrollBy({ left: chart.clientWidth * (actionBtn.dataset.direction === 'prev' ? -0.8 : 0.8), behavior: 'smooth' });
            } else if (action === 'play-episode') {
                const seasonNumber = Number(actionBtn.getAttribute('data-season-number'));
                const episodeNumber = Number(actionBtn.getAttribute('data-episode-number'));
                const timestamp = Number(actionBtn.getAttribute('data-timestamp')) || 0;
                const parentCard = actionBtn.closest('.episode-detail');
                const episodeTitle = parentCard?.querySelector('.episode-title')?.textContent?.trim() || null;
                this.handleEpisodePlay(seasonNumber, episodeNumber, episodeTitle, timestamp);
            } else if (action === 'continue-watch-progress') {
                const seasonNumber = Number(actionBtn.getAttribute('data-season-number'));
                const episodeNumber = Number(actionBtn.getAttribute('data-episode-number'));
                const timestamp = Number(actionBtn.getAttribute('data-timestamp')) || 0;
                const parentBanner = actionBtn.closest('.seasons-continue-banner');
                const episodeTitle = parentBanner?.querySelector('.seasons-continue-banner__title')?.textContent?.trim() || null;
                this.handleEpisodePlay(seasonNumber, episodeNumber, episodeTitle, timestamp);
            } else if (action === 'toggle-episode-watched') {
                const seasonNumber = Number(actionBtn.getAttribute('data-season-number'));
                const episodeNumber = Number(actionBtn.getAttribute('data-episode-number'));
                this.handleToggleEpisodeWatched(seasonNumber, episodeNumber, actionBtn);
            } else if (action === 'play-next-episode') {
                if (this.selectedMovie?.nextEpisode) {
                    const nextEp = this.selectedMovie.nextEpisode;
                    this.handleNextEpisodePlay(nextEp.seasonNumber, nextEp.episodeNumber, nextEp.name);
                }
            } else if (action === 'player-prev-episode') {
                void this.requestPlayerEpisodeNavigation('previous');
            } else if (action === 'player-next-episode') {
                void this.requestPlayerEpisodeNavigation('next');
            } else if (action === 'scroll-recommendations-prev') {
                const carousel = document.getElementById('movieRecommendationsCarousel');
                if (carousel) {
                    carousel.scrollBy({ left: -carousel.clientWidth * 0.75, behavior: 'smooth' });
                }
            } else if (action === 'scroll-recommendations-next') {
                const carousel = document.getElementById('movieRecommendationsCarousel');
                if (carousel) {
                    carousel.scrollBy({ left: carousel.clientWidth * 0.75, behavior: 'smooth' });
                }
            } else if (action === 'scroll-franchise-prev') {
                const carousel = document.getElementById('movieFranchiseCarousel');
                if (carousel) {
                    carousel.scrollBy({ left: -carousel.clientWidth * 0.75, behavior: 'smooth' });
                }
            } else if (action === 'scroll-franchise-next') {
                const carousel = document.getElementById('movieFranchiseCarousel');
                if (carousel) {
                    carousel.scrollBy({ left: carousel.clientWidth * 0.75, behavior: 'smooth' });
                }
            }
        });

        // Tab click listener to refresh seasons progress when user clicks Seasons tab (Phase 4A)
        document.addEventListener('click', (e) => {
            const tabBtn = e.target.closest('.tab-btn[data-tab="seasons"]');
            if (tabBtn) {
                this.refreshSeasonsProgress();
            }
        });

        // Click handler for toggle-crew to support keyboard / touch / click interactions with localStorage persistence
        document.addEventListener('click', (e) => {
            const crewBtn = e.target.closest('[data-action="toggle-crew"]');
            if (crewBtn) {
                e.preventDefault();
                const isExpanded = crewBtn.getAttribute('aria-expanded') === 'true';
                const targetId = crewBtn.getAttribute('aria-controls');
                const targetEl = targetId ? document.getElementById(targetId) : null;
                if (targetEl) {
                    const nextExpanded = !isExpanded;
                    crewBtn.setAttribute('aria-expanded', String(nextExpanded));
                    if (nextExpanded) {
                        targetEl.removeAttribute('hidden');
                    } else {
                        targetEl.setAttribute('hidden', '');
                    }
                    try {
                        localStorage.setItem('movie_details_crew_expanded', String(nextExpanded));
                    } catch (err) {
                        console.warn('[MovieDetails] Failed to save crew expanded state:', err);
                    }
                }
            }

            // Click handler for toggle-actors (Show More / Show Less)
            const actorsBtn = e.target.closest('[data-action="toggle-actors"]');
            if (actorsBtn) {
                e.preventDefault();
                const isExpanded = actorsBtn.getAttribute('aria-expanded') === 'true';
                const targetId = actorsBtn.getAttribute('aria-controls');
                const targetEl = targetId ? document.getElementById(targetId) : null;
                if (targetEl) {
                    const nextExpanded = !isExpanded;
                    this.applyActorsGridVisibility(targetEl, nextExpanded);
                }
            }
        });

        // Delegated image error handler for actor photos (CSP-safe, no inline onerror)
        document.addEventListener('error', (e) => {
            if (e.target && e.target.classList && e.target.classList.contains('actor-photo')) {
                const img = e.target;
                const container = img.closest('.actor-photo-container');
                if (container && !img.dataset.failed) {
                    img.dataset.failed = 'true';
                    img.style.display = 'none';
                    let placeholder = container.querySelector('.actor-placeholder');
                    if (!placeholder) {
                        placeholder = document.createElement('div');
                        placeholder.className = 'actor-placeholder';
                        placeholder.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`;
                        container.appendChild(placeholder);
                    }
                    placeholder.style.display = 'flex';
                }
            }
        }, true);

        // Rate and Watch button handlers
        document.addEventListener('click', (e) => {
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

            if (e.target.classList.contains('announce-movie-btn') || e.target.closest('.announce-movie-btn')) {
                e.stopPropagation();
                if (this.selectedMovie) {
                    this.showAnnounceModal(this.selectedMovie);
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
                    const movieId = String(this.selectedMovie.kinopoiskId);
                    const hasInitialized = Object.values(this.playerRegistry).some(entry =>
                        entry.movieId === movieId && entry.initialized
                    );
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

        this.setupTheNumbersChartTooltip();
        this.setupImageErrorHandlers();
        this.initSelectionPopup();

        // Global spoiler reveal logic
        if (typeof Utils !== 'undefined') {
            Utils.bindSpoilerReveal(document);
        }

        window.addEventListener('beforeunload', () => this.invalidatePageGeneration());
    }

    setupTheNumbersChartTooltip() {
        if (this._theNumbersChartTooltipEventsSetup) return;
        this._theNumbersChartTooltipEventsSetup = true;

        document.addEventListener('mousemove', event => {
            const viewport = event.target?.closest?.('.the-numbers-chart__viewport');
            if (viewport) this.showTheNumbersChartTooltipAtX(viewport, event.clientX);
        }, true);

        document.addEventListener('mouseout', event => {
            const viewport = event.target?.closest?.('.the-numbers-chart__viewport');
            const relatedViewport = event.relatedTarget?.closest?.('.the-numbers-chart__viewport');
            if (viewport && viewport !== relatedViewport) this.hideTheNumbersChartTooltip();
        }, true);

        document.addEventListener('focusin', event => {
            const point = event.target?.closest?.('.the-numbers-chart__point-hit-area');
            const viewport = point?.closest?.('.the-numbers-chart__viewport');
            const index = Number(point?.dataset?.chartIndex);
            if (viewport && Number.isInteger(index)) this.showTheNumbersChartTooltipAtIndex(viewport, index);
        });

        document.addEventListener('focusout', event => {
            if (event.target?.closest?.('.the-numbers-chart__point-hit-area')) {
                this.hideTheNumbersChartTooltip();
            }
        });
    }

    getTheNumbersChartIndexAtX(viewport, clientX) {
        const svg = viewport?.querySelector?.('.the-numbers-chart__svg');
        const svgRect = svg?.getBoundingClientRect?.();
        const metadata = viewport?.dataset || {};
        const viewBoxWidth = Number(metadata.chartViewWidth);
        const plotLeft = Number(metadata.chartPlotLeft);
        const plotWidth = Number(metadata.chartPlotWidth);
        const pointCount = Number(metadata.chartPointCount);
        if (!svgRect?.width || !Number.isFinite(clientX) || !Number.isFinite(viewBoxWidth)
            || !Number.isFinite(plotLeft) || !Number.isFinite(plotWidth) || !Number.isInteger(pointCount)
            || pointCount < 2) return null;

        const viewX = ((clientX - svgRect.left) / svgRect.width) * viewBoxWidth;
        const normalizedX = Math.max(0, Math.min(1, (viewX - plotLeft) / plotWidth));
        return Math.round(normalizedX * (pointCount - 1));
    }

    showTheNumbersChartTooltipAtX(viewport, clientX) {
        const index = this.getTheNumbersChartIndexAtX(viewport, clientX);
        if (index !== null) this.showTheNumbersChartTooltipAtIndex(viewport, index);
    }

    showTheNumbersChartTooltipAtIndex(viewport, index) {
        const point = viewport?.querySelector?.(`.the-numbers-chart__point-hit-area[data-chart-index="${index}"]`);
        const chart = viewport?.closest?.('.the-numbers-chart');
        const tooltip = chart?.querySelector('.the-numbers-chart__tooltip');
        if (!point || !tooltip) return;

        if (this._theNumbersChartTooltipViewport !== viewport) this.hideTheNumbersChartTooltip();
        const samePoint = this._theNumbersChartTooltipPoint === point;
        this.updateTheNumbersChartHover(viewport, index, point);
        this._theNumbersChartTooltipViewport = viewport;
        this._theNumbersChartTooltipPoint = point;
        if (samePoint) {
            this.positionTheNumbersChartTooltip(point);
            return;
        }

        const rows = [
            ['Cume:', point.dataset.chartCume, 'cume'],
            ['Median:', point.dataset.chartMedian, 'median'],
            ['Bottom 10%:', point.dataset.chartBottom10, 'bottom'],
            ['Top 10%:', point.dataset.chartTop10, 'top']
        ].filter(([, value]) => value !== undefined && value !== '');

        tooltip.innerHTML = `
            <div class="the-numbers-chart__tooltip-date">${this.escapeHtml(point.dataset.chartDate || '')}</div>
            ${rows.map(([label, value, tone]) => `
                <div class="the-numbers-chart__tooltip-row">
                    <span class="the-numbers-chart__tooltip-swatch the-numbers-chart__tooltip-swatch--${tone}" aria-hidden="true"></span>
                    <span class="the-numbers-chart__tooltip-label">${label}</span>
                    <strong>${this.escapeHtml(this.formatTheNumbersAmount(value))}</strong>
                </div>
            `).join('')}`;
        tooltip.hidden = false;
        tooltip.classList.add('is-visible');
        this.positionTheNumbersChartTooltip(point);
    }

    updateTheNumbersChartHover(viewport, index, point) {
        const svg = viewport?.querySelector?.('.the-numbers-chart__svg');
        const activeGroup = svg?.querySelector?.('.the-numbers-chart__active-points');
        const activeCume = activeGroup?.querySelector?.('.the-numbers-chart__active-point--cume');
        const activeMedian = activeGroup?.querySelector?.('.the-numbers-chart__active-point--median');
        const crosshair = activeGroup?.querySelector?.('.the-numbers-chart__crosshair');
        if (!svg || !activeGroup || !activeCume || !activeMedian || !crosshair) return;

        const cumeX = point.getAttribute('cx');
        const cumeY = point.getAttribute('cy');
        const medianPoint = svg.querySelector(`.the-numbers-chart__median-point[data-chart-index="${index}"]`);
        const medianX = medianPoint?.getAttribute('cx');
        const medianY = medianPoint?.getAttribute('cy');
        if (!cumeX || !cumeY) return;

        crosshair.setAttribute('x1', cumeX);
        crosshair.setAttribute('x2', cumeX);
        activeCume.setAttribute('cx', cumeX);
        activeCume.setAttribute('cy', cumeY);
        activeCume.style.display = '';
        if (medianX && medianY) {
            activeMedian.setAttribute('cx', medianX);
            activeMedian.setAttribute('cy', medianY);
            activeMedian.style.display = '';
        } else {
            activeMedian.style.display = 'none';
        }
        activeGroup.style.display = '';
    }

    positionTheNumbersChartTooltip(point) {
        const chart = point?.closest?.('.the-numbers-chart');
        const tooltip = chart?.querySelector('.the-numbers-chart__tooltip');
        const viewport = point?.closest?.('.the-numbers-chart__viewport');
        if (!tooltip || !viewport || tooltip.hidden) return;

        const viewportRect = viewport.getBoundingClientRect();
        const pointRect = point.getBoundingClientRect();
        const clientX = pointRect.left + pointRect.width / 2;
        const clientY = pointRect.top + pointRect.height / 2;
        const gap = 12;
        let left = clientX - viewportRect.left + gap;
        let top = clientY - viewportRect.top - tooltip.offsetHeight - gap;

        if (left + tooltip.offsetWidth > viewportRect.width - 8) {
            left = clientX - viewportRect.left - tooltip.offsetWidth - gap;
        }
        if (left < 8) left = 8;
        if (top < 8) top = clientY - viewportRect.top + gap;
        if (top + tooltip.offsetHeight > viewportRect.height - 8) {
            top = Math.max(8, viewportRect.height - tooltip.offsetHeight - 8);
        }

        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
    }

    hideTheNumbersChartTooltip() {
        const point = this._theNumbersChartTooltipPoint;
        const viewport = this._theNumbersChartTooltipViewport || point?.closest?.('.the-numbers-chart__viewport');
        const chart = viewport?.closest?.('.the-numbers-chart');
        const tooltip = chart?.querySelector('.the-numbers-chart__tooltip');
        const activeGroup = viewport?.querySelector?.('.the-numbers-chart__active-points');
        if (tooltip) {
            tooltip.classList.remove('is-visible');
            tooltip.hidden = true;
        }
        if (activeGroup) activeGroup.style.display = 'none';
        this._theNumbersChartTooltipPoint = null;
        this._theNumbersChartTooltipViewport = null;
    }

    handleLoadRetry() {
        const params = new URLSearchParams(window.location.search);
        if (params.has('resolveTmdbId')) {
            params.set('retry', String(Date.now()));
            window.location.search = params.toString();
        } else {
            window.location.reload();
        }
    }

    async initializeUI() {
        // Get movieId from URL
        const urlParams = new URLSearchParams(window.location.search);
        const movieId = urlParams.get('movieId');
        const resolveTmdbId = urlParams.get('resolveTmdbId');
        const autoplay = urlParams.get('autoplay') === 'true';
        const clearMovieCache = urlParams.get('clearMovieCache') === '1';

        if (resolveTmdbId) {
            this.showHomeResolutionState(urlParams.get('title') || 'фильм');
        }

        // Embedded mode adjustments
        if (this.isEmbedded) {
            // Hide back button in embedded mode
            if (this.elements.backToSearchBtn) {
                this.elements.backToSearchBtn.style.display = 'none';
            }
        }

        // 1. Read cached admin status BEFORE first paint so the announce button
        //    appears immediately without a second re-render.
        try {
            const stored = await chrome.storage.local.get('cached_is_admin');
            if (stored.cached_is_admin === true) {
                this.isAdmin = true;
                console.log('[admin] Loaded isAdmin=true from storage cache');
            }
        } catch (e) {
            console.warn('[admin] Could not read cached isAdmin:', e);
        }

        this.perf?.mark('md:admin-cache-ready');

        // Auth and browser-local cache lookup start together after the
        // FirebaseManager exists. The cache path never invokes provider APIs.
        if (!window.firebaseManager) {
            await this.waitForFirebaseManager();
        }

        // Clear all scoped movie caches only after FirebaseManager is ready.
        // This keeps the instant snapshot, local movie cache, and reverse
        // mapping cache cleanup in one reliable sequence.
        if (clearMovieCache && movieId) {
            await this.clearMovieCacheForMovie(movieId);
            const cleanUrl = new URL(window.location.href);
            cleanUrl.searchParams.delete('clearMovieCache');
            window.history.replaceState({}, document.title, cleanUrl.toString());
        }

        const authPromise = firebaseManager.waitForAuthReady(15000);
        const canSpeculate = !firebaseManager.isAuthReady || firebaseManager.isAuthenticated();
        const cachePromise = movieId && canSpeculate
            ? this.loadSpeculativeCachedMovie(movieId)
            : Promise.resolve(null);
        await authPromise;
        this.perf?.mark('md:auth-ready');
        if (!firebaseManager.isAuthReady && !firebaseManager.isAuthenticated()) {
            this.authDecision = 'unresolved';
            throw createAppError('GENERIC_LOAD_ERROR', {
                retryable: true,
                userMessage: 'Не удалось восстановить вход. Проверьте соединение и повторите загрузку.',
                context: { operation: 'movie-details-auth-timeout' }
            });
        }
        
        const isAuth = firebaseManager.isAuthenticated();
        console.log('[DIAG] Auth check:', JSON.stringify({ isAuth: firebaseManager.isAuthenticated() }));
        if (!isAuth) {
            this.authDecision = 'guest';
            this.perf?.setScenarioHint('guest');
            console.log('[DIAG] Auth check failed; returning before loadMovieById.');
            this.page.showError(createAppError('AUTH_REQUIRED', {
                category: 'auth',
                retryable: false,
                context: { operation: 'movie-details-auth-gate' }
            }));
            this.perf?.complete();
            return;
        }
        
        this.authDecision = 'authenticated';
        this.authVerified = true;
        this.currentUser = firebaseManager.getCurrentUser();
        this.setProtectedControlsEnabled(true);

        if (resolveTmdbId) {
            await this.resolveHomeMovieRoute(urlParams);
            return;
        }

        if (movieId) {
            const speculativeMovie = await cachePromise;
            const cachedLoaded = Boolean(speculativeMovie);
            await this.loadMovieById(movieId, !cachedLoaded, cachedLoaded, {
                prefetchedCachedMovie: speculativeMovie,
                prefetchedCacheResolved: this.speculativeCacheResolved && Boolean(speculativeMovie),
                forceRefresh: clearMovieCache
            });
            this.initPlayerRegistry();
            if (this.selectedMovie) {
                this.preloadAllPlayers(movieId);
                this.perf?.complete();
            }
            if (autoplay && this.selectedMovie) {
                setTimeout(() => this.handleWatchClick(), 500);
            }
        } else {
            this.page.showError(createAppError('MOVIE_NOT_FOUND', {
                category: 'not-found',
                retryable: false,
                context: { operation: 'movie-details-route' }
            }));
        }
    }

    async clearMovieCacheForMovie(movieId) {
        const normalizedId = String(Number(movieId));
        if (!normalizedId || normalizedId === 'NaN' || normalizedId === '0') return;

        try {
            localStorage.removeItem(`kp_movie_${normalizedId}`);
        } catch (error) {
            console.warn('[MovieDetails] Failed to clear instant movie cache:', error);
        }

        try {
            const movieCacheService = window.firebaseManager?.getMovieCacheService?.();
            await movieCacheService?.removeLocalMovieCache?.(normalizedId);
        } catch (error) {
            console.warn('[MovieDetails] Failed to clear local movie cache:', error);
        }

        try {
            const idMappingService = window.firebaseManager?.getIdMappingService?.();
            const removedMappings = await idMappingService?.clearMappingForKinopoiskId?.(normalizedId, 'movie');
            console.info('[MovieDetails] Cleared movie cache for KP ID:', normalizedId, {
                removedMappings: removedMappings || 0
            });
        } catch (error) {
            console.warn('[MovieDetails] Failed to clear reverse mapping cache:', error);
        }
    }

    showHomeResolutionState(title) {
        const titleElement = this.elements.loadingState?.querySelector('.loading-title');
        const textElement = this.elements.loadingState?.querySelector('.loading-text');
        if (titleElement) titleElement.textContent = `Ищем «${title}» в Kinopoisk`;
        if (textElement) textElement.textContent = 'Подбираем точную карточку фильма, пожалуйста, подождите';
        this.page.showLoader();
    }

    async resolveHomeMovieRoute(urlParams) {
        const tmdbId = Number(urlParams.get('resolveTmdbId'));
        const title = urlParams.get('title') || '';
        const originalTitle = urlParams.get('originalTitle') || '';
        const searchTitle = urlParams.get('searchTitle') || '';
        const year = Number(urlParams.get('year')) || null;
        const mediaType = urlParams.get('mediaType') || 'movie';

        try {
            if (!Number.isSafeInteger(tmdbId) || tmdbId <= 0) {
                throw new Error('Некорректный TMDB ID');
            }
            if (typeof HomeMovieNavigationService === 'undefined') {
                throw new Error('Сервис сопоставления фильма не загружен');
            }

            console.log('[MovieDetails] Resolving Home TMDB-only route:', {
                tmdbId,
                title,
                year,
                mediaType
            });

            const resolver = new HomeMovieNavigationService({
                kinopoiskService: firebaseManager.getKinopoiskService()
            });
            const resolved = await this.withMovieLoadDeadline(resolver.resolve({
                tmdbId,
                name: title,
                alternativeName: originalTitle,
                searchTitle,
                year,
                mediaType,
                isTmdbOnly: true
            }, { forceRetry: urlParams.has('retry') }));
            const kinopoiskId = Number(resolved?.kinopoiskId || resolved?.movieId);
            if (!Number.isSafeInteger(kinopoiskId) || kinopoiskId <= 0) {
                throw new Error('Точная карточка фильма в Kinopoisk не найдена');
            }

            const nextParams = new URLSearchParams({
                movieId: String(kinopoiskId),
                tmdbId: String(tmdbId),
                source: 'home-tmdb-only',
                title,
                year: year ? String(year) : '',
                mediaType
            });
            console.log('[MovieDetails] Home TMDB-only route resolved:', {
                tmdbId,
                kinopoiskId
            });
            const canonicalUrl = chrome.runtime.getURL(
                `src/pages/movie-details/movie-details.html?${nextParams.toString()}`
            );
            // Keep the existing details controller and loader alive. A full
            // location.replace() would initialize MovieDetails a second time
            // and show a second generic loading screen.
            window.history.replaceState({}, '', canonicalUrl);
            await this.loadMovieById(kinopoiskId, false, false);
            this.initPlayerRegistry();
            if (this.selectedMovie) {
                this.preloadAllPlayers(kinopoiskId);
                this.perf?.complete();
            }
        } catch (error) {
            console.warn('[MovieDetails] Home TMDB-only route failed:', error);
            this.page.showError(error, {
                context: {
                    operation: 'home-movie-resolution',
                    title: title || null,
                    category: 'provider'
                }
            });
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

    async loadSpeculativeCachedMovie(movieId) {
        this.perf?.mark('md:speculative-cache-start');
        try {
            const currentUrlMovieId = new URLSearchParams(window.location.search).get('movieId');
            if (String(currentUrlMovieId) !== String(movieId)) return null;

            let localMovie = null;
            try {
                const localData = localStorage.getItem(`kp_movie_${movieId}`);
                if (localData) localMovie = JSON.parse(localData);
            } catch (error) {
                console.warn('MovieDetails: Failed reading speculative local cache:', error);
            }

            let movie = localMovie;
            if (localMovie) {
                // Paint immediately, then check browser-local metadata for a richer DTO.
                this.speculativeMovie = localMovie;
                await this.displayMovieDetails(localMovie);
            }

            const movieCacheService = firebaseManager.getMovieCacheService?.();
            const publicCachedMovie = movieCacheService
                ? await movieCacheService.getCachedMovie(movieId, { localOnly: true }) : null;
            if (!movie && publicCachedMovie) movie = publicCachedMovie;
            if (localMovie && publicCachedMovie && this.shouldUpgradeSpeculativeMovie(localMovie, publicCachedMovie)) {
                movie = publicCachedMovie;
                if (this.authDecision !== 'guest') {
                    this.speculativeMovie = publicCachedMovie;
                    await this.displayMovieDetails(publicCachedMovie);
                }
            }
            this.speculativeCacheResolved = true;

            if (!movie || this.authDecision === 'guest') {
                this.perf?.mark('md:speculative-cache-ready');
                return null;
            }
            if (String(new URLSearchParams(window.location.search).get('movieId')) !== String(movieId)) return null;

            this.speculativeMovie ||= movie;
            this.perf?.setScenarioHint(movie === localMovie ? 'instantLocalStorage' : 'movieCacheHit');
            // Stale metadata remains a usable visual fallback while providers refresh it.
            if (movieCacheService?.isMetadataCacheValid && !movieCacheService.isMetadataCacheValid(movie)) {
                movie = { ...movie, _cacheExpired: true };
            }
            if (!localMovie) await this.displayMovieDetails(movie);
            this.perf?.mark('md:speculative-cache-ready');
            this.perf?.mark('md:speculative-rendered');
            return movie;
        } catch (error) {
            console.warn('[MovieDetails] Speculative cache read failed:', error);
            this.speculativeCacheResolved = true;
            return null;
        }
    }

    shouldUpgradeSpeculativeMovie(localMovie, cachedMovie) {
        try {
            if (JSON.stringify(localMovie) === JSON.stringify(cachedMovie)) return false;
        } catch { /* Compare by freshness/schema below */ }
        const localTime = new Date(localMovie?.lastUpdated || 0).getTime();
        const cachedTime = new Date(cachedMovie?.lastUpdated || 0).getTime();
        if (cachedTime > localTime) return true;
        const score = (movie) => Number(Boolean(movie?.tmdbId || movie?.identity?.tmdbId || movie?.externalId?.tmdb))
            + Number(Boolean(movie?.logoUrl))
            + Number(Boolean(movie?._meta));
        return score(cachedMovie) > score(localMovie);
    }

    async waitForFirebaseManager() {
        await new Promise((resolve) => {
            if (window.firebaseManager && window.firebaseManager.isInitialized) {
                resolve();
                return;
            }
            
            const onReady = () => {
                clearInterval(checkInterval);
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
        if (!window.firebaseManager?.isInitialized) {
            throw new Error('Не удалось запустить сервис загрузки. Повторите попытку.');
        }
    }

    goBackToSearch() {
        // If embedded, signal parent to close and restore native player
        if (this.isEmbedded && window.parent !== window) {
            this.postToEmbeddingParent({ type: 'CLOSE_EXTENSION_PLAYER' });
            return;
        }
        // Try to go back in history, otherwise go to search page
        if (window.history.length > 1) {
            window.history.back();
        } else {
            window.location.href = chrome.runtime.getURL('src/pages/search/search.html');
        }
    }

    async loadMovieById(movieId, shouldShowLoading = true, skipRender = false, options = {}) {
        const pageContext = this.beginPageGeneration(movieId);
        let loadActive = true;
        this.perf?.mark('md:aggregation-start');
        try {
            if (shouldShowLoading) {
                this.page.showLoader();
                if (this.elements.movieDetailsContainer) {
                    this.elements.movieDetailsContainer.innerHTML = '';
                }
            }
            
            const mediaAggregator = (typeof firebaseManager !== 'undefined' && firebaseManager.getMediaAggregatorService)
                ? firebaseManager.getMediaAggregatorService()
                : (typeof MediaAggregatorService !== 'undefined' ? new MediaAggregatorService({
                    kinopoiskService: firebaseManager?.getKinopoiskService?.(),
                    tmdbService: firebaseManager?.getTMDBService?.(),
                    idMappingService: firebaseManager?.getIdMappingService?.(),
                    movieCacheService: firebaseManager?.getMovieCacheService?.()
                }) : null);

            const kinopoiskService = firebaseManager.getKinopoiskService();
            const movieCacheService = firebaseManager.getMovieCacheService();
            const params = new URLSearchParams(window.location.search);

            let movie = options.prefetchedCacheResolved ? (options.prefetchedCachedMovie || null) : null;
            if (mediaAggregator) {
                try {
                    movie = await this.withMovieLoadDeadline(mediaAggregator.getMovieDetails(movieId, {
                        title: params.get('title') || '',
                        year: params.get('year') || '',
                        candidateTmdbId: params.get('tmdbId') || '',
                        mediaType: params.get('mediaType') || 'movie',
                        skipKinopoiskApi: params.get('source') === 'home-tmdb-only',
                        prefetchedCachedMovie: options.prefetchedCachedMovie || null,
                        prefetchedCacheResolved: options.prefetchedCacheResolved === true,
                        forceRefresh: options.forceRefresh === true,
                        onBaseMovie: baseMovie => {
                            if (!loadActive || !this.isPageContextCurrent(pageContext) || this.selectedMovie) return;
                            skipRender = true;
                            void this.displayMovieDetails(baseMovie).catch(error => {
                                console.warn('[MovieDetails] Base metadata render failed:', error);
                            });
                        }
                    }));

                    if (!this.isPageContextCurrent(pageContext)) return;

                    this.logFranchiseDebug('E_MOVIE_RECEIVED', {
                        kinopoiskId: movie?.kinopoiskId,
                        tmdbId: movie?.tmdbId || movie?.identity?.tmdbId || movie?.externalId?.tmdb || null,
                        collection: movie?.collection || null,
                        skipRender
                    });

                    // The instant localStorage paint can contain an older KP-only DTO.
                    // If aggregation recovers a verified TMDB identity, force one full
                    // rerender so the healed metadata is visible without a page reload.
                    const renderedTmdbId = Number(
                        this.selectedMovie?.tmdbId ||
                        this.selectedMovie?.identity?.tmdbId ||
                        this.selectedMovie?.externalId?.tmdb
                    ) || null;
                    const resolvedTmdbId = Number(
                        movie?.tmdbId ||
                        movie?.identity?.tmdbId ||
                        movie?.externalId?.tmdb
                    ) || null;
                    const renderedLogoUrl = this.selectedMovie?.logoUrl || null;
                    const resolvedLogoUrl = movie?.logoUrl || null;
                    if (
                        skipRender &&
                        (
                            (resolvedTmdbId && renderedTmdbId !== resolvedTmdbId) ||
                            (resolvedLogoUrl && renderedLogoUrl !== resolvedLogoUrl)
                        )
                    ) {
                        skipRender = false;
                    }
                } catch (aggErr) {
                    if (!this.isPageContextCurrent(pageContext)) return;
                    console.warn('[MovieDetails] MediaAggregator failed, retaining cached metadata:', aggErr);
                    movie ||= options.prefetchedCachedMovie;
                    if (!movie && String(this.selectedMovie?.kinopoiskId) === String(movieId)) {
                        movie = this.selectedMovie;
                    }
                    // Aggregation already attempted the providers. Do not repeat the
                    // same failing request through the legacy compatibility path.
                    if (!movie) throw aggErr;
                }
            }

            if (!movie) {
                movie = await this.withMovieLoadDeadline(movieCacheService.getCachedMovie(movieId));
                if (!this.isPageContextCurrent(pageContext)) return;
                const hasDetailedInfo = Utils.hasDetailedMovieInfo(movie);
                
                if (!movie || !hasDetailedInfo) {
                    try {
                        const freshMovie = await this.withMovieLoadDeadline(kinopoiskService.getMovieById(movieId, {
                            cachedMovie: movie,
                            title: params.get('title') || '',
                            year: params.get('year') || ''
                        }));
                        if (!this.isPageContextCurrent(pageContext)) return;
                        if (freshMovie) {
                            movie = freshMovie;
                            void Promise.resolve().then(() => movieCacheService.cacheMovie(freshMovie))
                                .catch(error => console.warn('[MovieDetails] Cache write failed:', error));
                            skipRender = false;
                        }
                    } catch (apiError) {
                        console.warn('[MovieDetails] Could not fetch detailed movie from API:', apiError);
                        if (!movie) {
                            try {
                                const localKey = `kp_movie_${movieId}`;
                                const localData = localStorage.getItem(localKey);
                                if (localData) {
                                    movie = JSON.parse(localData);
                                }
                            } catch (storageErr) {
                                console.warn('[MovieDetails] Failed reading fallback cache:', storageErr);
                            }
                        }
                        if (!movie) {
                            throw apiError;
                        }
                    }
                }
            }
            
            if (!movie) {
                throw new Error('Movie not found');
            }

            this.perf?.mark('md:aggregation-ready');
            if (!this.isPageContextCurrent(pageContext)) return;
            
            // Parse awards in background
            if (!movie.awards || movie.awards.length === 0) {
                this.loadAwardsInBackground(movieId, movie, pageContext);
            }
            
            if (!this.isPageContextCurrent(pageContext)) return;
            if (!movie.frames || movie.frames.length === 0) {
                this.loadFramesInBackground(movieId, movie, pageContext, kinopoiskService);
            }
            this.preloadSources(movie);

            if (skipRender) {
                // Cached content is already displayed. Just silently update the internal state
                // so that user actions (rate, bookmark) use the freshest data.
                this.selectedMovie = movie;
                
            } else {
                await this.displayMovieDetails(movie);
            }
            if (skipRender) this.startPostRenderEnrichment(movie, this.capturePageContext(movie));
            // Personal state is intentionally post-render. Keeping this at the end of
            // every movie load also covers explicit refreshes after rating/bookmark actions.
            if (this.currentUser && this.selectedMovie) this.loadPersonalState(movieId);
        } catch (error) {
            if (!this.isPageContextCurrent(pageContext)) return;
            console.error('Error loading movie:', error);
            this.page.showError(error, {
                context: {
                    operation: 'movie-details-load',
                    movieId,
                    category: 'provider'
                }
            });
        } finally {
            loadActive = false;
            if (this.isPageContextCurrent(pageContext)) {
                this.page.hideLoader();
            }

        }
    }

    async withMovieLoadDeadline(work, timeoutMs = 25000) {
        let timer;
        try {
            return await Promise.race([
                work,
                new Promise((resolve, reject) => {
                    timer = setTimeout(() => reject(createAppError('GENERIC_LOAD_ERROR', {
                        retryable: true,
                        userMessage: 'Загрузка фильма заняла слишком много времени. Повторите попытку.',
                        context: { operation: 'movie-details-timeout' }
                    })), timeoutMs);
                })
            ]);
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * Update only the frames section without a full re-render
     */
    updateFramesSection(movie) {
        if (!movie) return;
        const framesHTML = this.createMovieFramesSection(movie);
        if (!framesHTML) return;

        const framesContainer = this.elements.movieDetailsContainer?.querySelector('.movie-frames-section');
        if (framesContainer) {
            const temp = document.createElement('div');
            temp.innerHTML = framesHTML;
            if (temp.firstElementChild) {
                framesContainer.replaceWith(temp.firstElementChild);
            }
        } else {
            const descriptionSection = this.elements.movieDetailsContainer?.querySelector('.movie-detail-description');
            if (descriptionSection) {
                const userRatingsSection = descriptionSection.querySelector('#userRatingsSection');
                const temp = document.createElement('div');
                temp.innerHTML = framesHTML;
                const newSection = temp.firstElementChild;
                if (newSection) {
                    if (userRatingsSection) {
                        descriptionSection.insertBefore(newSection, userRatingsSection);
                    } else {
                        descriptionSection.appendChild(newSection);
                    }
                }
            }
        }
        this.bindMovieFrameInteractions();
    }

    async loadAwardsInBackground(movieId, movie, pageContext = this.capturePageContext(movie)) {
        try {
            const awardsParser = new AwardsParsingService();
            const awards = this.perf
                ? await this.perf.trackRequest('AWARDS', { purpose: 'awards-fallback' }, () => awardsParser.getAwards(movieId))
                : await awardsParser.getAwards(movieId);

            if (!this.isPageContextCurrent(pageContext)) return;
            
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
            showAllAwardsBtn.addEventListener('click', function() {
                this.style.display = 'none';
                const hiddenGrid = this.previousElementSibling;
                if (hiddenGrid && hiddenGrid.classList.contains('awards-grid-hidden')) {
                    hiddenGrid.style.display = 'grid';
                }
            });
        }
    }

    // ─── Announce Modal ────────────────────────────────────────────────────────

    showAnnounceModal(movie) {
        const modal = document.getElementById('announceModal');
        if (!modal) return;

        // Заполнить превью
        const poster = document.getElementById('announcePreviewPoster');
        if (poster) poster.src = movie.posterUrl || '';

        const title = movie.name || movie.alternativeName || '';
        const titleEl = document.getElementById('announcePreviewTitle');
        if (titleEl) titleEl.textContent = title;

        const yearEl = document.getElementById('announcePreviewYear');
        if (yearEl) yearEl.textContent = movie.year ? `${movie.year} г.` : '';

        const rawDesc = movie.description || '';
        const shortDesc = rawDesc.length > 200 ? rawDesc.slice(0, 200) + '...' : rawDesc;
        const descEl = document.getElementById('announcePreviewDesc');
        if (descEl) descEl.textContent = shortDesc;



        // Дефолтные дата/время — завтра в 12:00
        const now = new Date();
        now.setDate(now.getDate() + 1);
        now.setHours(12, 0, 0, 0);

        const defaultDateStr = now.toISOString().split('T')[0];
        const defaultTimeStr = '12:00';

        const dateInput = document.getElementById('announceDate');
        const timeInput = document.getElementById('announceTime');
        const dateContainer = document.getElementById('announceDateContainer');
        const timeContainer = document.getElementById('announceTimeContainer');

        if (dateContainer && !this._customDatePicker) {
            this._customDatePicker = new CustomDatePicker({
                container: dateContainer,
                targetInput: dateInput,
                initialValue: defaultDateStr
            });
        } else if (this._customDatePicker) {
            this._customDatePicker.setValue(defaultDateStr);
        }

        if (timeContainer && !this._customTimePicker) {
            this._customTimePicker = new CustomTimePicker({
                container: timeContainer,
                targetInput: timeInput,
                initialValue: defaultTimeStr
            });
        } else if (this._customTimePicker) {
            this._customTimePicker.setValue(defaultTimeStr);
        }

        // Привязать события формы (однократно через флаг)
        if (!this._announceEventsSetup) {
            this._announceEventsSetup = true;

            document.getElementById('closeAnnounceBtn')?.addEventListener('click', () => this.closeAnnounceModal());
            document.getElementById('cancelAnnounceBtn')?.addEventListener('click', () => this.closeAnnounceModal());
            document.getElementById('sendAnnounceBtn')?.addEventListener('click', () => this.sendAnnounce());
            document.getElementById('announceModal')?.addEventListener('mousedown', (e) => {
                if (e.target === document.getElementById('announceModal')) this.closeAnnounceModal();
            });
        }

        // Проверить доступность бота
        this.checkBotStatus();

        this.openAccessibleDialog(modal);
    }

    closeAnnounceModal() {
        this._customDatePicker?.close();
        this._customTimePicker?.close();
        const modal = document.getElementById('announceModal');
        if (modal) this.closeAccessibleDialog(modal);
    }

    async checkBotStatus() {
        const dot = document.getElementById('announceBotStatusDot');
        const text = document.getElementById('announceBotStatusText');
        if (!dot || !text) return;

        dot.className = 'announce-bot-status-dot';
        text.textContent = 'Проверка бота...';

        try {
            const response = await chrome.runtime.sendMessage({ type: 'CHECK_BOT_STATUS' });
            if (response?.ok) {
                dot.className = 'announce-bot-status-dot online';
                text.textContent = 'Бот онлайн';
            } else {
                dot.className = 'announce-bot-status-dot offline';
                text.textContent = 'Бот недоступен. Запустите telegram-bot/index.js';
            }
        } catch {
            dot.className = 'announce-bot-status-dot offline';
            text.textContent = 'Бот недоступен. Запустите telegram-bot/index.js';
        }
    }

    async sendAnnounce() {
        const movie = this.selectedMovie;
        if (!movie) return;

        const text = movie.description || '';
        const date = document.getElementById('announceDate')?.value;
        const time = document.getElementById('announceTime')?.value;

        if (!date || !time) {
            Utils.showToast('Укажите дату и время', 'warning');
            return;
        }

        const scheduledAt = new Date(`${date}T${time}`).getTime();
        if (isNaN(scheduledAt) || scheduledAt <= Date.now()) {
            Utils.showToast('Выберите дату и время в будущем', 'warning');
            return;
        }

        // Format exactly how it should be displayed, to prevent Vercel timezone shifts
        const [year, month, day] = date.split('-');
        const rawDateStr = `${day}.${month}.${year}, ${time}`;

        const btn = document.getElementById('sendAnnounceBtn');
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Отправка...';
        }

        try {
            const response = await chrome.runtime.sendMessage({
                type: 'SCHEDULE_ANNOUNCE',
                movie: {
                    kinopoiskId: movie.kinopoiskId,
                    name: movie.name || movie.alternativeName || '',
                    year: movie.year || '',
                    posterUrl: movie.posterUrl || '',
                    description: text,
                },
                scheduledAt,
                rawDateStr
            });

            if (response?.success) {
                Utils.showToast(`Анонс запланирован на ${rawDateStr}`, 'success');
                this.closeAnnounceModal();
            } else {
                Utils.showToast(response?.error || 'Ошибка при планировании', 'error');
            }
        } catch (err) {
            console.error('[MovieDetails] Announce send error:', err);
            Utils.showToast('Не удалось отправить задание. Убедитесь, что бот запущен.', 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2L15 22 11 13 2 9l20-7z"/></svg> Запланировать`;
            }
        }
    }

    // ──────────────────────────────────────────────────────────────────────────

    showContent() {
        this.page.showContent();
    }

    resetPlayerRegistry() {
        this.unmountActivePlayer();

        Object.values(this.playerRegistry).forEach(entry => {
            const video = entry.container?.querySelector('video');
            if (video) {
                try { video.pause(); } catch { /* Ignore */ }
                video.removeAttribute('src');
                try { video.load(); } catch { /* Ignore */ }
            }

            entry.container?.querySelectorAll('iframe').forEach(iframe => {
                iframe.src = 'about:blank';
            });
            entry.container?.remove();
        });

        this.playerRegistry = {};
        this.activePlayerId = null;
        this.unavailableProviderIds?.clear?.();
        window._playerMounted = false;
    }

    /** Load user-scoped state after base MovieDetails content is visible. */
    async loadPersonalState(movieId) {
        if (!this.currentUser || !this.selectedMovie || String(this.selectedMovie.kinopoiskId) !== String(movieId)) return;
        const pageContext = this.capturePageContext(this.selectedMovie);
        const uid = this.currentUser.uid;
        const userService = firebaseManager.getUserService?.();
        const ratingService = firebaseManager.getRatingService?.();
        const canReadEpisodeRatings = typeof isSeriesMedia === 'function'
            && isSeriesMedia(this.selectedMovie)
            && Number.isInteger(Number(movieId))
            && Number(movieId) > 0;
        const seriesEpisodeRatingService = canReadEpisodeRatings
            ? firebaseManager.getSeriesEpisodeRatingService?.()
            : null;
        const favoriteService = firebaseManager.getFavoriteService?.();
        const read = async (category, purpose, loader) => {
            const request = this.perf?.requestStart(category, { purpose });
            try { return await loader(); } finally { this.perf?.requestEnd(request); }
        };
        const profilePromise = userService ? read('FIREBASE_PROFILE', 'post-render-profile', () => userService.getUserProfile(uid)) : Promise.resolve(null);
        const collectionsPromise = typeof CollectionService !== 'undefined'
            ? read('FIREBASE_COLLECTIONS', 'post-render-collections', async () => {
                this.collectionService ||= new CollectionService();
                return this.collectionService.getCollections();
            }) : Promise.resolve([]);
        const ratingPromise = ratingService ? read('FIREBASE_RATING', 'current-user-rating', () => ratingService.getRating(uid, movieId)) : Promise.resolve(null);
        const episodeRatingPromise = seriesEpisodeRatingService
            ? read('FIREBASE_RATING', 'series-episode-ratings', () => seriesEpisodeRatingService.getEpisodeRatings(uid, movieId))
            : Promise.resolve(null);
        const bookmarkPromise = favoriteService ? read('FIREBASE_BOOKMARK', 'current-user-bookmark', () => favoriteService.getBookmark(uid, movieId)) : Promise.resolve(null);
        const results = await Promise.allSettled([profilePromise, collectionsPromise, ratingPromise, bookmarkPromise, episodeRatingPromise]);

        if (this.isPageContextCurrent(pageContext) && results[0].status === 'fulfilled') {
            this.isAdmin = results[0].value?.isAdmin === true;
            try { await chrome.storage.local.set({ cached_is_admin: this.isAdmin }); } catch { /* non-critical */ }
            this.patchAdminControl(this.isAdmin, pageContext);
            this.perf?.mark('md:profile-ready');
        }
        if (this.isPageContextCurrent(pageContext) && results[1].status === 'fulfilled') {
            this.availableCollections = Array.isArray(results[1].value) ? results[1].value : [];
            this.patchCollectionsMenu(this.selectedMovie, pageContext);
            this.perf?.mark('md:collections-ready');
        }
        if (this.isPageContextCurrent(pageContext) && results[2].status === 'fulfilled') {
            this.patchPersonalRating(results[2].value, pageContext);
            this.perf?.mark('md:rating-state-ready');
        }
        if (this.isPageContextCurrent(pageContext) && results[3].status === 'fulfilled') {
            this.patchBookmarkState(results[3].value, favoriteService, pageContext);
            this.perf?.mark('md:bookmark-state-ready');
        }
        if (this.isPageContextCurrent(pageContext) && results[4].status === 'fulfilled' && results[4].value) {
            this.patchSeriesEpisodeRatings(results[4].value, pageContext);
        } else if (this.isPageContextCurrent(pageContext) && results[4].status === 'rejected'
            && this.isEpisodeRatingsPermissionDenied(results[4].reason)) {
            this.episodeRatingsPermissionDeniedMovieId = String(movieId);
            this.updateSeriesEpisodeRatingUI();
        }
        results.filter(result => result.status === 'rejected').forEach(result => {
            console.warn('[MovieDetails] Personal state read failed:', result.reason);
        });
    }

    async loadFramesInBackground(movieId, movie, pageContext, kinopoiskService) {
        try {
            const images = this.perf
                ? await this.perf.trackRequest('FRAMES', { purpose: 'movie-images' }, () => kinopoiskService.getMovieImages(movieId))
                : await kinopoiskService.getMovieImages(movieId);
            if (!this.isPageContextCurrent(pageContext)) return;
            if (images?.length) {
                movie.frames = images;
                this.updateFramesSection(movie);
            }
        } catch {
            // Frames are optional enrichment; base content remains usable.
        } finally {
            if (this.isPageContextCurrent(pageContext)) this.perf?.mark('md:frames-ready');
        }
    }

    renderAnnounceButton(movieId) {
        const id = this.escapeHtml ? this.escapeHtml(String(movieId ?? '')) : String(movieId ?? '');
        return `<button class="btn btn-lg announce-movie-btn" type="button" data-movie-id="${id}"><svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.248l-2.04 9.613c-.147.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.566-4.46c.537-.194 1.006.131.907.607z"/></svg> Анонсировать</button>`;
    }

    patchAdminControl(isAdmin, pageContext) {
        if (!this.isPageContextCurrent(pageContext) || !this.authVerified) return;
        const actions = this.elements.movieDetailsContainer?.querySelector('.movie-actions-container');
        if (!actions) return;
        const existing = actions.querySelector('.announce-movie-btn');
        if (isAdmin && !existing) {
            actions.insertAdjacentHTML('beforeend', this.renderAnnounceButton(this.selectedMovie.kinopoiskId));
        } else if (!isAdmin && existing) existing.remove();
    }

    patchCollectionsMenu(movie, pageContext) {
        if (!this.isPageContextCurrent(pageContext)) return;
        const slot = this.elements.movieDetailsContainer?.querySelector('.mc-menu-collections-slot');
        if (slot) slot.innerHTML = this.renderCollectionsMenu(movie);
    }

    patchPersonalRating(rating, pageContext) {
        if (!this.isPageContextCurrent(pageContext)) return;
        const button = this.elements.movieDetailsContainer?.querySelector('.rate-movie-btn');
        this.currentPersonalRating = rating || null;
        if (button) {
            const score = this.getPersonalRatingDisplayValue(rating);
            if (score > 0) button.dataset.userRating = String(score);
            else delete button.dataset.userRating;
            const label = button.querySelector('.rate-movie-label');
            if (label) {
                label.textContent = score > 0
                    ? this.formatMovieDetailsText('movie_details.personal_rating', { rating: score })
                    : i18n.get('movie_details.rate_title');
            }
        }
        this.currentRating = Number(rating?.rating) || 0;
        this.updateSeriesEpisodeRatingUI();
    }

    formatMovieDetailsText(key, values = {}) {
        let text = typeof i18n !== 'undefined' && i18n?.get ? i18n.get(key) : key;
        Object.entries(values).forEach(([name, value]) => {
            text = text.split('{' + name + '}').join(String(value));
        });
        return text;
    }

    getPersonalRatingDisplayValue(rating = this.currentPersonalRating) {
        return Number(rating?.rating) || 0;
    }

    hasEpisodeRatingAccess() {
        const movie = this.selectedMovie;
        return Boolean(this.currentUser
            && typeof isSeriesMedia === 'function'
            && isSeriesMedia(movie)
            && Number.isInteger(Number(movie?.kinopoiskId))
            && Number(movie.kinopoiskId) > 0
            && Number.isInteger(Number(movie?.tmdbId || movie?.externalId?.tmdb))
            && Number(movie.tmdbId || movie.externalId?.tmdb) > 0);
    }

    getEpisodeRatingKey(seasonNumber, episodeNumber) {
        if (typeof SeriesEpisodeRatingService === 'undefined') return null;
        try {
            return SeriesEpisodeRatingService.getEpisodeKey(seasonNumber, episodeNumber);
        } catch {
            return null;
        }
    }

    getEpisodeRatingFor(seasonNumber, episodeNumber) {
        const key = this.getEpisodeRatingKey(seasonNumber, episodeNumber);
        return key ? this.currentSeriesEpisodeRatings?.episodes?.[key] || null : null;
    }

    updateSeriesEpisodeRatingUI() {
        this.ensureEpisodeRatingControls();
        document.querySelectorAll('.episode-rating-control').forEach(control => {
            const score = Number(this.getEpisodeRatingFor(Number(control.dataset.seasonNumber), Number(control.dataset.episodeNumber))?.r) || 0;
            const choices = [...control.querySelectorAll('[data-action="episode-rating-choice"]')];
            choices.forEach(button => {
                const value = Number(button.dataset.rating);
                button.setAttribute('aria-checked', String(value === score));
                button.tabIndex = value === (score || 1) ? 0 : -1;
                button.classList.toggle('is-filled', value <= score);
                button.textContent = value <= score ? '★' : '☆';
                button.disabled = this.isEpisodeRatingMutationPending || control.dataset.released !== 'true';
            });
            const value = control.querySelector('.episode-rating-value');
            if (value) value.textContent = score ? `${score}/10` : '—';
            const remove = control.querySelector('[data-action="episode-rating-remove"]');
            if (remove) {
                remove.hidden = score === 0;
                remove.disabled = this.isEpisodeRatingMutationPending;
            }
        });
        document.querySelectorAll('.episode-column').forEach(column => {
            const mark = column.querySelector('[data-marker="rated"]');
            if (mark) mark.hidden = !this.getEpisodeRatingFor(Number(column.dataset.seasonNumber), Number(column.dataset.episodeNumber));
        });
        const card = document.querySelector('.episode-detail');
        const badge = card?.querySelector('.episode-user-rating-badge');
        if (badge) {
            const score = Number(this.getEpisodeRatingFor(Number(card.dataset.seasonNumber), Number(card.dataset.episodeNumber))?.r) || 0;
            badge.textContent = this.formatMovieDetailsText('movie_details.series_episode_user_badge', { rating: score });
            badge.hidden = !score;
        }
    }

    getEpisodeRatingControlAccess() {
        if (!this.currentUser) return 'guest';
        if (!this.hasEpisodeRatingAccess()) return 'unlinked';
        if (this.hasEpisodeRatingsPermissionDenied()) return 'unavailable';
        return 'ready';
    }

    ensureEpisodeRatingControls() {
        const slot = document.querySelector('.episode-rating-slot');
        const ep = this.seasonsBrowserEpisodes?.find(item => Number(item.episodeNumber) === this.seasonsBrowserEpisode);
        if (!slot || !ep) return;
        const existing = slot.querySelector('.episode-rating-control');
        if (existing?.dataset.access === this.getEpisodeRatingControlAccess()) return;
        slot.innerHTML = this.renderEpisodeRatingControl(ep, this.seasonsBrowserAirDate);
    }

    isEpisodeRatingsPermissionDenied(error) {
        return error?.code === 'permission-denied' || /permission-denied|insufficient permissions/i.test(String(error?.message || ''));
    }

    hasEpisodeRatingsPermissionDenied() {
        return Boolean(this.episodeRatingsPermissionDeniedMovieId)
            && String(this.episodeRatingsPermissionDeniedMovieId) === String(this.selectedMovie?.kinopoiskId);
    }

    patchSeriesEpisodeRatings(state, pageContext) {
        if (!this.isPageContextCurrent(pageContext)) return;
        this.episodeRatingsPermissionDeniedMovieId = null;
        this.currentSeriesEpisodeRatings = state || { exists: false, episodes: {} };
        this.updateSeriesEpisodeRatingUI();
    }

    isEpisodeReleasedForRating(episode, seasonAirDate = null) {
        const now = new Date();
        const episodeDate = episode?.airDate ? new Date(episode.airDate) : null;
        if (episodeDate && !Number.isNaN(episodeDate.getTime()) && episodeDate > now) return false;
        if (!episode?.airDate && seasonAirDate) {
            const seasonDate = new Date(seasonAirDate);
            if (!Number.isNaN(seasonDate.getTime()) && seasonDate > now) return false;
        }
        return true;
    }

    renderEpisodeRatingControl(episode, seasonAirDate = null) {
        const season = Number(episode.seasonNumber), number = Number(episode.episodeNumber);
        const access = this.getEpisodeRatingControlAccess();
        const opening = `<div class="episode-rating-control" data-access="${access}" data-season-number="${season}" data-episode-number="${number}" data-tmdb-episode-id="${Number(episode.tmdbEpisodeId) || 0}"`;
        if (access !== 'ready') {
            const message = i18n.get(`movie_details.${access === 'guest' ? 'series_episode_sign_in' : access === 'unlinked' ? 'series_episode_tmdb_only_hint' : 'series_episode_rules_error'}`);
            return `${opening}><span class="episode-rating-message">${this.escapeHtml(message)}</span></div>`;
        }
        const released = this.isEpisodeReleasedForRating(episode, seasonAirDate);
        const score = Number(this.getEpisodeRatingFor(season, number)?.r) || 0;
        return `${opening} data-released="${released}"><span class="episode-rating-label">${this.escapeHtml(i18n.get('movie_details.series_episode_your_rating'))}</span>
            <div class="episode-rating-scale" role="radiogroup" aria-label="${this.escapeHtml(this.formatMovieDetailsText('movie_details.series_episode_aria', { episode: `S${season}E${number}` }))}">${Array.from({ length: 10 }, (_, index) => {
                const value = index + 1;
                return `<button type="button" class="episode-rating-choice${value <= score ? ' is-filled' : ''}" data-action="episode-rating-choice" data-rating="${value}" role="radio" aria-label="${this.escapeHtml(this.formatMovieDetailsText('movie_details.series_episode_rate_value_aria', { rating: value }))}" aria-checked="${value === score}" tabindex="${value === (score || 1) ? 0 : -1}"${released ? '' : ' disabled'}>${value <= score ? '★' : '☆'}</button>`;
            }).join('')}</div><span class="episode-rating-value" aria-live="polite">${score ? `${score}/10` : '—'}</span>
            <span class="episode-rating-remove-slot"><button type="button" class="episode-rating-remove" data-action="episode-rating-remove" aria-label="${this.escapeHtml(i18n.get('movie_details.series_episode_remove_rating'))}"${score ? '' : ' hidden'}>×</button></span>
            ${released ? '' : `<span class="episode-rating-message">${this.escapeHtml(i18n.get('movie_details.series_episode_unreleased'))}</span>`}</div>`;
    }

    previewEpisodeStars(control, value) {
        control?.querySelectorAll('[data-action="episode-rating-choice"]').forEach(button => {
            const filled = Number(button.dataset.rating) <= value;
            button.classList.toggle('is-filled', filled);
            button.textContent = filled ? '★' : '☆';
        });
    }

    handleEpisodeRatingPointer(event) {
        const choice = event.target?.closest?.('[data-action="episode-rating-choice"]');
        const control = event.target?.closest?.('.episode-rating-control');
        if (!control) return;
        if (event.type === 'mouseover' && choice && !choice.disabled) this.previewEpisodeStars(control, Number(choice.dataset.rating));
        if (event.type === 'mouseout' && !control.contains(event.relatedTarget)) {
            this.previewEpisodeStars(control, Number(this.getEpisodeRatingFor(Number(control.dataset.seasonNumber), Number(control.dataset.episodeNumber))?.r) || 0);
        }
    }

    handleEpisodeRatingKeydown(event) {
        const control = event.target?.closest?.('.episode-rating-control');
        if (!control) return;
        const choices = [...control.querySelectorAll('[data-action="episode-rating-choice"]')];
        const index = choices.indexOf(event.target);
        if (index < 0 || event.target.disabled) return;
        const target = { ArrowLeft: Math.max(0, index - 1), ArrowDown: Math.max(0, index - 1), ArrowRight: Math.min(9, index + 1), ArrowUp: Math.min(9, index + 1), Home: 0, End: 9 }[event.key];
        if (target === undefined) return;
        event.preventDefault();
        choices[target]?.focus();
        void this.changeEpisodeRating(choices[target], target + 1);
    }

    applyOptimisticEpisodeRating(seasonNumber, episodeNumber, rating) {
        const previousState = this.currentSeriesEpisodeRatings;
        const key = SeriesEpisodeRatingService.getEpisodeKey(seasonNumber, episodeNumber);
        const episodes = { ...(previousState?.episodes || {}) };
        if (rating === null) delete episodes[key];
        else episodes[key] = { r: rating, t: new Date() };
        this.currentSeriesEpisodeRatings = {
            ...(previousState || {}), exists: Object.keys(episodes).length > 0, episodes
        };
        return { previousState };
    }

    async changeEpisodeRating(button, rating) {
        if (!this.hasEpisodeRatingAccess() || this.isEpisodeRatingMutationPending) return;
        const pageContext = this.capturePageContext(this.selectedMovie);
        const control = button?.closest('.episode-rating-control');
        if (!control) return;
        if (rating !== null && control.dataset.released !== 'true') {
            Utils.showToast(i18n.get('movie_details.series_episode_unreleased'), 'warning');
            return;
        }
        const seasonNumber = Number(control.dataset.seasonNumber);
        const episodeNumber = Number(control.dataset.episodeNumber);
        const requestVersion = ++this.episodeRatingUiVersion;
        const previousPublicStats = this.publicEpisodeStats;
        const oldRating = Number(this.getEpisodeRatingFor(seasonNumber, episodeNumber)?.r) || null;
        const { previousState } = this.applyOptimisticEpisodeRating(seasonNumber, episodeNumber, rating);
        this.adjustPublicEpisodeScore(seasonNumber, episodeNumber, oldRating, rating);
        this.isEpisodeRatingMutationPending = true;
        this.updateSeriesEpisodeRatingUI();
        try {
            const service = firebaseManager.getSeriesEpisodeRatingService();
            const movieId = Number(this.selectedMovie.kinopoiskId);
            const common = {
                userId: this.currentUser.uid,
                movieId,
                tmdbId: Number(this.selectedMovie.tmdbId || this.selectedMovie.externalId?.tmdb) || null,
                tmdbEpisodeId: Number(control.dataset.tmdbEpisodeId) || null,
                seasonNumber,
                episodeNumber
            };
            const result = rating === null
                ? await service.removeEpisodeRating(common)
                : await service.setEpisodeRating({ ...common, rating });
            if (requestVersion !== this.episodeRatingUiVersion || !this.isPageContextCurrent(pageContext)) return;
            this.currentSeriesEpisodeRatings = result.state;
            Utils.showToast(i18n.get(rating === null ? 'movie_details.series_episode_removed' : 'movie_details.series_episode_saved'), 'success');
            if (rating !== null) await this.markRatedEpisodeWatched(movieId, seasonNumber, episodeNumber, pageContext);
        } catch (error) {
            if (requestVersion === this.episodeRatingUiVersion && this.isPageContextCurrent(pageContext)) {
                this.currentSeriesEpisodeRatings = previousState;
                this.publicEpisodeStats = previousPublicStats;
                this.refreshEpisodeCommunityUI();
            }
            if (this.isPageContextCurrent(pageContext)) {
                const permissionDenied = error?.code === 'permission-denied' || /permission|insufficient permissions/i.test(String(error?.message || ''));
                Utils.showToast(i18n.get(permissionDenied ? 'movie_details.series_episode_rules_error' : 'movie_details.series_episode_save_error'), 'error');
            }
        } finally {
            if (requestVersion === this.episodeRatingUiVersion && this.isPageContextCurrent(pageContext)) {
                this.isEpisodeRatingMutationPending = false;
                this.updateSeriesEpisodeRatingUI();
                control.querySelector(`[data-rating="${rating || 1}"]`)?.focus();
            }
        }
    }

    async markRatedEpisodeWatched(movieId, seasonNumber, episodeNumber, pageContext) {
        if (!this.currentUser || !this.isPageContextCurrent(pageContext)) return;
        const episodeKey = `${seasonNumber}:${episodeNumber}`;
        if (this.currentEpisodeHistory?.[episodeKey]) return;
        const key = `${this.pageGeneration || 0}:${movieId}:${episodeKey}`;
        this.ratedEpisodeWatchedLoads ||= new Map();
        if (this.ratedEpisodeWatchedLoads.has(key)) return this.ratedEpisodeWatchedLoads.get(key);
        const load = (async () => {
            try {
                if (!this.episodeHistoryService) throw new Error('Episode history service unavailable');
                const history = await this.episodeHistoryService.markCompleted(movieId, seasonNumber, episodeNumber, { source: 'MANUAL' });
                if (!this.isPageContextCurrent(pageContext)) return;
                this.currentEpisodeHistory = history;
                await this.refreshSeasonsProgress();
            } catch {
                if (this.isPageContextCurrent(pageContext)) Utils.showToast(i18n.get('movie_details.series_episode_watched_error'), 'warning');
            }
        })();
        this.ratedEpisodeWatchedLoads.set(key, load);
        try { await load; } finally {
            if (this.ratedEpisodeWatchedLoads.get(key) === load) this.ratedEpisodeWatchedLoads.delete(key);
        }
    }

    setProtectedControlsEnabled(enabled) {
        const container = this.elements.movieDetailsContainer;
        if (!container) return;
        container.querySelectorAll('.rate-movie-btn, [data-action="toggle-favorite"], [data-action="toggle-watching"], [data-action="toggle-watched"], [data-action="toggle-watchlist"], [data-action="toggle-collection"]').forEach(button => {
            button.disabled = !enabled;
            button.setAttribute('aria-disabled', String(!enabled));
        });
    }

    patchBookmarkState(bookmark, favoriteService, pageContext) {
        if (!this.isPageContextCurrent(pageContext)) return;
        this.updateButtonStates(bookmark);
        if (bookmark && favoriteService) {
            const hasPoster = !!(this.selectedMovie?.posterUrl || this.selectedMovie?.posterPath);
            if (hasPoster && (!bookmark.posterPath || bookmark.posterPath.trim() === '')) {
                favoriteService.addToFavorites(this.currentUser.uid, { ...this.selectedMovie, movieId: this.selectedMovie.kinopoiskId }, bookmark.status)
                    .catch(error => console.warn('[MovieDetails] Silent bookmark metadata enrichment failed:', error));
            }
        }
    }

    async displayMovieDetails(movie) {
        this.perf?.mark('md:render-start');
        if (this.recommendationsObserver) {
            this.recommendationsObserver.disconnect();
            this.recommendationsObserver = null;
        }
        if (this.franchiseObserver) {
            this.franchiseObserver.disconnect();
            this.franchiseObserver = null;
        }
        if (this.recommendationPosterObserver) {
            this.recommendationPosterObserver.disconnect();
            this.recommendationPosterObserver = null;
        }
        this.beginPageGeneration(movie?.kinopoiskId || movie?.id);
        const previousMovieKey = String(this.selectedMovie?.kinopoiskId || this.selectedMovie?.tmdbId || '');
        const nextMovieKey = String(movie?.kinopoiskId || movie?.tmdbId || '');
        if (previousMovieKey && previousMovieKey !== nextMovieKey) {
            this.episodeRatingUiVersion += 1;
            this.isEpisodeRatingMutationPending = false;
            this.destroyPlayer();
            this.resetPlayerRegistry();
            this.currentSources = [];
            this.currentEpisodes = [];
            this.currentVideoUrl = '';
            this.videoModalMovie = null;
            this.isPlaying = false;
            this.currentPersonalRating = null;
            this.currentSeriesEpisodeRatings = {
                exists: false, episodes: {}
            };
            this.episodeRatingsPermissionDeniedMovieId = null;
        }

        this.selectedMovie = movie;
        this.updateDocumentMetadata(movie);
        this.initPlayerRegistry(movie.kinopoiskId);
        void this.refreshMediaPlayerReadiness().then(() => {
            if (this.selectedMovie === movie) this.populateSourceSelector();
        });
        
        
        // Personal state starts after the base card is mounted. Neutral controls are
        // deterministic and are patched by loadPersonalState() when reads settle.
        const movieHTML = this.createDetailedMovieCard(movie, null, null);
        this.disconnectActorsGridObserver();
        this.elements.movieDetailsContainer.innerHTML = movieHTML;
        this.bindMovieFrameInteractions();
        this.setupActorsGridVisibility();
        this.setProtectedControlsEnabled(this.authVerified);
        void this.syncRandomPoolAction(movie);
        
        // Setup show all awards button
        const showAllAwardsBtn = this.elements.movieDetailsContainer.querySelector('.btn-show-all-awards');
        if (showAllAwardsBtn) {
            showAllAwardsBtn.addEventListener('click', function() {
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

        // Setup backdrop error listener
        const backdropImg = this.elements.movieDetailsContainer.querySelector('.movie-detail-hero-backdrop-img');
        if (backdropImg) {
            backdropImg.addEventListener('error', function() {
                const container = this.closest('.movie-detail-hero-backdrop');
                if (container) container.style.display = 'none';
            });
        }
        
        // Show content after everything is ready
        this.showContent();
        this.perf?.mark('md:first-content-rendered');

        if (this.authVerified) this.startPostRenderEnrichment(movie, this.capturePageContext(movie));
    }

    updateDocumentMetadata(movie) {
        const locale = i18n?.currentLocale || 'ru';
        document.documentElement.lang = locale;
        const title = (locale === 'en' && movie?.alternativeName) ? movie.alternativeName : (movie?.name || movie?.alternativeName || '');
        if (!title) return;
        document.title = movie?.year ? `${title} (${movie.year}) — Movie Rating Extension` : `${title} — Movie Rating Extension`;
    }

    startPostRenderEnrichment(movie, pageContext = this.capturePageContext(movie)) {
        if (!this.authVerified || !this.isPageContextCurrent(pageContext)) return;
        const movieId = String(movie?.kinopoiskId || '');
        if (movieId && this.postRenderEnrichmentMovieId === movieId) {
            // Same-movie renders replace the DOM while page generation deliberately
            // remains stable. Rebind visual owners to the replacement DOM without
            // duplicating their network subscriptions or provider work.
            this.rehydrateRatingsForCurrentRender(movieId);
            this.observeOrLoadRecommendations(movie);
            this.observeOrLoadFranchise(movie);
            this.rehydrateRenderEnrichments(movie, pageContext);
            return;
        }
        this.postRenderEnrichmentMovieId = movieId;
        this.renderEnrichmentSnapshot = { movieId };
        this.loadAndDisplayUserRatings(movie.kinopoiskId);

        // User/provider enrichments are intentionally unavailable to the
        // pre-auth speculative render and begin only after auth verification.
        this.loadSoundtrack(movie);

        // Provider ratings are independent from the user-rating listener and
        // must not block the initial MovieDetails render. Refresh them after
        // the base card is visible, then patch only the rating rail.
        this.loadProviderRatingsInBackground(movie, pageContext);

        // Phase 1I-B: Observe & load async recommendations (P2, non-blocking)
        this.observeOrLoadRecommendations(movie);

        // Observe & load async franchise collection (P2, non-blocking)
        this.observeOrLoadFranchise(movie);

        // Resolve & Render Trailer (TMDB Structured -> KP Structured -> Scraper Fallback)
        this.resolveAndRenderTrailer(movie);

        // The Numbers is a non-blocking personal-use enrichment. The cached
        // value renders immediately when available; a stale/missing snapshot
        // is refreshed without delaying the MovieDetails critical path.
        this.loadTheNumbersInBackground(movie, pageContext);
        
        const isSeries = Boolean(movie.isSeries || (movie.type && ['tv-series', 'mini-series', 'animated-series', 'tv'].includes(movie.type)));
        if (isSeries) {
            this.resolveAndRenderSeasons(movie);

            // Phase 1G: Dynamic Freshness SWR for stale next episode
            if (this.isNextEpisodeStale(movie)) {
                this.revalidateDynamicData(movie);
            }
        }
    }

    /** Snapshot of render-bound enrichments for the current movie, or null after navigation. */
    getRenderEnrichmentSnapshot(movieId = this.selectedMovie?.kinopoiskId) {
        const snapshot = this.renderEnrichmentSnapshot;
        return snapshot && String(snapshot.movieId) === String(movieId || '') ? snapshot : null;
    }

    /**
     * Same-movie renders (language change, healed metadata) replace the DOM but keep the
     * page generation. Restore results that were patched into the previous DOM without
     * repeating their provider requests; in-flight loaders resolve into the new DOM.
     */
    rehydrateRenderEnrichments(movie, pageContext = this.capturePageContext(movie)) {
        const snapshot = this.getRenderEnrichmentSnapshot(movie?.kinopoiskId);
        if (!snapshot || !this.isPageContextCurrent(pageContext)) return;
        const current = this.selectedMovie || movie;

        if (snapshot.providerRatings) {
            this.selectedMovie = { ...current, ...snapshot.providerRatings };
            this.updateProviderRatingsUI(this.selectedMovie);
        } else if (snapshot.providerRatingsSettled) {
            this.updateProviderRatingsUI(current);
        }

        if (snapshot.boxOffice) {
            this.selectedMovie = { ...this.selectedMovie, boxOffice: snapshot.boxOffice };
            this.updateFinanceSection(this.selectedMovie, pageContext);
        }

        if (snapshot.trailer) {
            this.renderTrailerBlock(snapshot.trailer.trailer, snapshot.trailer.source);
        } else {
            const primaryTrailer = this.resolvePrimaryTrailer(movie);
            if (primaryTrailer) this.renderTrailerBlock(primaryTrailer.trailer, primaryTrailer.source);
        }

        if (snapshot.soundtrack) this.renderSoundtrackState(snapshot.soundtrack);

        if (Array.isArray(snapshot.seasons) && snapshot.seasons.length > 0 && !(Array.isArray(this.selectedMovie.seasons) && this.selectedMovie.seasons.length > 0)) {
            this.selectedMovie.seasons = snapshot.seasons;
        }
        const hasSeasons = (Array.isArray(this.selectedMovie.seasons) && this.selectedMovie.seasons.length > 0)
            || (Array.isArray(this.selectedMovie.seasonsInfo) && this.selectedMovie.seasonsInfo.length > 0);
        if (hasSeasons) this.resolveAndRenderSeasons(this.selectedMovie);
    }

    updateFinanceSection(movie, pageContext = this.capturePageContext(movie)) {
        if (!movie || !this.isPageContextCurrent(pageContext)) return;
        const grid = this.elements.movieDetailsContainer?.querySelector('.movie-detail-meta-grid');
        if (!grid) return;

        const current = grid.querySelector('.meta-item--finance');
        const html = this.renderFinanceMetaItem(movie);
        if (current) {
            if (!html) {
                current.remove();
                return;
            }
            const temp = document.createElement('div');
            temp.innerHTML = html.trim();
            current.replaceWith(temp.firstElementChild);
            return;
        }
        if (html) grid.insertAdjacentHTML('beforeend', html);
    }

    async loadTheNumbersInBackground(movie, pageContext = this.capturePageContext(movie)) {
        if (!movie || !this.isPageContextCurrent(pageContext) || typeof TheNumbersService !== 'function') return;
        try {
            const service = new TheNumbersService();
            const boxOffice = await service.refreshMovie(movie);
            if (!boxOffice || !this.isPageContextCurrent(pageContext)) return;

            const updatedMovie = { ...this.selectedMovie, boxOffice };
            this.selectedMovie = updatedMovie;
            const snapshot = this.getRenderEnrichmentSnapshot(movie.kinopoiskId);
            if (snapshot) snapshot.boxOffice = boxOffice;
            this.updateFinanceSection(updatedMovie, pageContext);
        } catch (error) {
            console.info('[MovieDetails] The Numbers data unavailable:', error.message);
        }
    }

    async loadProviderRatingsInBackground(movie, pageContext = this.capturePageContext(movie)) {
        if (!this.authVerified || !this.isPageContextCurrent(pageContext)) return;

        const kinopoiskId = Number(movie?.kinopoiskId);
        if (!Number.isInteger(kinopoiskId) || kinopoiskId <= 0) return;

        const kpRating = Number(movie?.rating?.kp || movie?.kpRating || 0);
        const imdbRating = Number(movie?.rating?.imdb || movie?.imdbRating || 0);
        const kpVotes = Number(movie?.votes?.kp || 0);
        const imdbVotes = Number(movie?.votes?.imdb || 0);
        if (kpRating > 0 && imdbRating > 0 && kpVotes > 0 && imdbVotes > 0) return;

        if (typeof RatingsRefreshService !== 'function') {
            console.warn('[MovieDetails] RatingsRefreshService is unavailable');
            this.settleProviderRatingsUI(movie, pageContext);
            return;
        }

        try {
            const imdbId = movie?.identity?.imdbId
                || movie?.imdbId
                || movie?.externalId?.imdb
                || null;
            const refreshService = new RatingsRefreshService(firebaseManager);
            let result = await refreshService.checkAndRefreshRatings(
                kinopoiskId,
                imdbId,
                () => console.info('[MovieDetails] Provider ratings refresh started', { kinopoiskId }),
                {
                    kpRating,
                    imdbRating,
                    votes: movie?.votes || {}
                }
            );

            if (!this.isPageContextCurrent(pageContext)) return;

            const cachedVotes = {
                ...(result?.votes || {})
            };
            const resultKpRating = Number(result?.kpRating) || kpRating;
            const resultImdbRating = Number(result?.imdbRating) || imdbRating;
            // The hidden Kinopoisk page also shows the IMDb rating. It is the
            // only working IMDb source when the ratings proxy is unavailable
            // (imdb.com answers extension fetches with a bot challenge), so a
            // missing rating needs it as much as missing vote counts do.
            const hasImdbId = [movie?.identity?.imdbId, movie?.imdbId, movie?.externalId?.imdb, result?.imdbId]
                .some(value => /^tt\d{7,10}$/i.test(String(value || '').trim()));
            // A title checked within 12 hours that still has no IMDb rating or
            // ID (no IMDb page) is not loaded again on every visit.
            const imdbRecentlyChecked = Date.now() - (Number(result?.imdbCheckedAt) || 0) < 12 * 60 * 60 * 1000;
            const needsVoteRepair = resultKpRating <= 0
                || ((resultImdbRating <= 0 || !hasImdbId) && !imdbRecentlyChecked)
                || (resultKpRating > 0 && Number(cachedVotes.kp) <= 0)
                || (resultImdbRating > 0 && Number(cachedVotes.imdb) <= 0);
            const kinopoiskService = needsVoteRepair
                ? firebaseManager?.getKinopoiskService?.()
                : null;

            if (needsVoteRepair && typeof kinopoiskService?.scrapeMoviePageRatingsOffscreen === 'function') {
                try {
                    const pageRatings = await kinopoiskService.scrapeMoviePageRatingsOffscreen(kinopoiskId, {
                        mediaType: movie?.mediaType || movie?.type || null,
                        requestKey: `movie-details-votes:${kinopoiskId}`,
                        priority: 'visible-ratings'
                    });
                    if (!this.isPageContextCurrent(pageContext)) return;

                    if (Number(pageRatings?.kpVotes) > 0) cachedVotes.kp = Number(pageRatings.kpVotes);
                    if (Number(pageRatings?.imdbVotes) > 0) cachedVotes.imdb = Number(pageRatings.imdbVotes);
                    result = {
                        ...result,
                        // The Kinopoisk page links to the IMDb title; keep the ID.
                        imdbId: result?.imdbId || pageRatings?.imdbId || null,
                        imdbChecked: true,
                        kpRating: Number(pageRatings?.kpRating) > 0 ? Number(pageRatings.kpRating) : result?.kpRating,
                        imdbRating: Number(pageRatings?.imdbRating) > 0 ? Number(pageRatings.imdbRating) : result?.imdbRating,
                        votes: cachedVotes
                    };
                    await refreshService.persistCardRatingPatch(kinopoiskId, result);
                } catch (error) {
                    console.warn('[MovieDetails] Provider vote count repair failed:', error.message);
                }
            }

            const nextKpRating = Number(result?.kpRating) > 0 ? Number(result.kpRating) : kpRating;
            const nextImdbRating = Number(result?.imdbRating) > 0 ? Number(result.imdbRating) : imdbRating;
            const nextVotes = {
                ...(movie.votes || {}),
                ...(result?.votes || {})
            };

            if (nextKpRating <= 0 && nextImdbRating <= 0) {
                console.info('[MovieDetails] Provider ratings unavailable', { kinopoiskId });
                this.settleProviderRatingsUI(movie, pageContext);
                return;
            }

            // An IMDb ID found while refreshing (Kinopoisk page or card cache)
            // makes the IMDb tile a link when the details had none.
            const validImdbId = value => (/^tt\d{7,10}$/i.test(String(value || '').trim()) ? String(value).trim() : null);
            const knownImdbId = validImdbId(movie?.identity?.imdbId)
                || validImdbId(movie?.imdbId)
                || validImdbId(movie?.externalId?.imdb)
                || validImdbId(result?.imdbId);
            const updatedMovie = {
                ...movie,
                rating: {
                    ...(movie.rating || {}),
                    kp: nextKpRating || null,
                    imdb: nextImdbRating || null
                },
                votes: nextVotes,
                kpRating: nextKpRating,
                imdbRating: nextImdbRating,
                ...(knownImdbId ? {
                    imdbId: knownImdbId,
                    identity: { ...(movie.identity || {}), imdbId: knownImdbId },
                    externalId: { ...(movie.externalId || {}), imdb: knownImdbId }
                } : {})
            };

            this.selectedMovie = updatedMovie;
            this.updateProviderRatingsUI(updatedMovie);
            const snapshot = this.getRenderEnrichmentSnapshot(kinopoiskId);
            if (snapshot) {
                snapshot.providerRatings = {
                    rating: updatedMovie.rating,
                    votes: updatedMovie.votes,
                    kpRating: nextKpRating,
                    imdbRating: nextImdbRating
                };
            }
            console.info('[MovieDetails] Provider ratings updated', {
                kinopoiskId,
                kpRating: nextKpRating,
                imdbRating: nextImdbRating,
                kpVotes: nextVotes.kp || 0,
                imdbVotes: nextVotes.imdb || 0,
                refreshed: Boolean(result?.refreshed),
                cacheHit: Boolean(result?.cacheHit)
            });
        } catch (error) {
            console.warn('[MovieDetails] Provider ratings refresh failed:', error);
            this.settleProviderRatingsUI(movie, pageContext);
        }
    }

    /**
     * Replace loading skeletons with final values (or "—") once the refresh settles
     * without new data, so a single-provider rating never shows an endless skeleton.
     */
    settleProviderRatingsUI(movie, pageContext = this.capturePageContext(movie)) {
        if (!this.isPageContextCurrent(pageContext)) return;
        const snapshot = this.getRenderEnrichmentSnapshot(movie?.kinopoiskId);
        if (snapshot) snapshot.providerRatingsSettled = true;
        const container = this.elements.movieDetailsContainer?.querySelector('.movie-detail-ratings-container');
        if (!container?.querySelector('.rating-item-large--loading')) return;
        this.updateProviderRatingsUI(this.selectedMovie || movie);
    }

    updateProviderRatingsUI(movie) {
        const container = this.elements.movieDetailsContainer?.querySelector('.movie-detail-ratings-container');
        if (!container) return;

        container.innerHTML = [
            this.renderProviderRatingTile('kp', movie, {
                rating: Number(movie?.rating?.kp || movie?.kpRating || 0),
                votes: Number(movie?.votes?.kp || 0)
            }),
            this.renderProviderRatingTile('imdb', movie, {
                rating: Number(movie?.rating?.imdb || movie?.imdbRating || 0),
                votes: Number(movie?.votes?.imdb || 0)
            })
        ].join('');
    }

    /** Public provider page for a rating tile, or null when the ID is unknown. */
    getProviderRatingUrl(provider, movie) {
        if (provider === 'kp') {
            const kinopoiskId = Number(movie?.kinopoiskId);
            return Number.isInteger(kinopoiskId) && kinopoiskId > 0
                ? `https://www.kinopoisk.ru/film/${kinopoiskId}/`
                : null;
        }
        if (provider === 'imdb') {
            const imdbId = String(movie?.identity?.imdbId || movie?.imdbId || movie?.externalId?.imdb || '').trim();
            return /^tt\d+$/.test(imdbId) ? `https://www.imdb.com/title/${imdbId}/` : null;
        }
        return null;
    }

    /**
     * Kinopoisk/IMDb rating tile. With a known provider ID the tile is a link that
     * opens the title on that site in a new tab; otherwise it stays a plain block.
     */
    renderProviderRatingTile(provider, movie, { rating = 0, votes = 0, loading = false } = {}) {
        const label = provider === 'kp' ? i18n.get('movie_card.kinopoisk') : i18n.get('movie_card.imdb');
        const siteName = provider === 'kp' ? 'Кинопоиске' : 'IMDb';
        const url = this.getProviderRatingUrl(provider, movie);
        const classes = `rating-item-large ${provider}${loading ? ' rating-item-large--loading' : ''}${url ? ' rating-item-large--link' : ''}`;

        let body;
        if (loading) {
            body = `<span class="rating-label">${label}</span>
                <span class="rating-value rating-value--skeleton" aria-hidden="true"></span>
                <span class="rating-votes rating-votes--skeleton" aria-hidden="true"></span>`;
        } else {
            const valueText = rating > 0 ? String(parseFloat(rating.toFixed(1))) : '—';
            body = `<span class="rating-label">${label}</span>
                ${rating > 0
                    ? `<span class="rating-value">${valueText}</span>`
                    : '<span class="rating-value rating-value--unavailable">—</span>'}
                ${votes > 0
                    ? `<span class="rating-votes">${i18n.get('movie_details.votes_count').replace('{count}', this.formatVotes(votes))}</span>`
                    : '<span class="rating-votes rating-votes--placeholder" aria-hidden="true">&nbsp;</span>'}`;
        }

        if (!url) return `<div class="${classes}">${body}</div>`;

        const valueForLabel = !loading && rating > 0 ? `: ${parseFloat(rating.toFixed(1))}` : '';
        const ariaLabel = `${label}${valueForLabel}. Открыть на ${siteName} в новой вкладке`;
        return `<a class="${classes}" href="${this.escapeHtml(url)}" target="_blank" rel="noopener noreferrer" title="Открыть на ${siteName}" aria-label="${this.escapeHtml(ariaLabel)}">${body}</a>`;
    }

    closeOpenMenus() {
        document.querySelectorAll('.mc-menu-dropdown.active').forEach(menu => {
            menu.classList.remove('active');
            const button = menu.previousElementSibling;
            if (button?.classList.contains('mc-menu-btn')) button.setAttribute('aria-expanded', 'false');
        });
    }

    /** Runtime label without empty units: "45 мин", "2 ч", "1 ч 35 мин". */
    formatDurationLabel(totalMinutes) {
        const minutesTotal = Math.round(Number(totalMinutes));
        if (!Number.isFinite(minutesTotal) || minutesTotal <= 0) return '';
        const hours = Math.floor(minutesTotal / 60);
        const minutes = minutesTotal % 60;
        const parts = [];
        if (hours > 0) parts.push(`${hours} ${i18n.get('movie_details.meta.hours')}`);
        if (minutes > 0) parts.push(`${minutes} ${i18n.get('movie_details.meta.minutes')}`);
        return parts.join(' ');
    }

    /**
     * Determine whether shortDescription should be rendered separately from full description.
     * @param {string} shortDesc
     * @param {string} fullDesc
     * @returns {boolean}
     */
    shouldRenderShortDescription(shortDesc, fullDesc) {
        if (!shortDesc || typeof shortDesc !== 'string') return false;
        const cleanShort = shortDesc.trim();
        if (!cleanShort || cleanShort.length < 10) return false;
        if (!fullDesc || typeof fullDesc !== 'string') return true;

        const cleanFull = fullDesc.trim();
        const normShort = cleanShort.toLowerCase().replace(/\s+/g, ' ');
        const normFull = cleanFull.toLowerCase().replace(/\s+/g, ' ');

        if (normShort === normFull) return false;

        const shorter = normShort.length <= normFull.length ? normShort : normFull;
        const longer = normShort.length > normFull.length ? normShort : normFull;

        const lengthRatio = shorter.length / longer.length;
        const shorterStem = shorter.replace(/[.,!?;:]+$/, '').trim();
        if (lengthRatio >= 0.85 && (longer.includes(shorter) || (shorterStem.length >= 10 && longer.includes(shorterStem)))) {
            return false;
        }

        return true;
    }

    createDetailedMovieCard(movie, userRating = null, bookmarkStatus = null) {
        const posterUrl = movie.posterUrl || '/src/shared/assets/icons/app/icon48.png';
        const year = movie.year || '';

        const kpRating = (movie.rating?.kp !== undefined && movie.rating?.kp !== null && !isNaN(Number(movie.rating.kp)) && Number(movie.rating.kp) > 0)
            ? Number(movie.rating.kp)
            : (movie.kpRating !== undefined && movie.kpRating !== null && !isNaN(Number(movie.kpRating)) && Number(movie.kpRating) > 0)
                ? Number(movie.kpRating)
                : 0;

        const imdbRating = (movie.rating?.imdb !== undefined && movie.rating?.imdb !== null && !isNaN(Number(movie.rating.imdb)) && Number(movie.rating.imdb) > 0)
            ? Number(movie.rating.imdb)
            : (movie.imdbRating !== undefined && movie.imdbRating !== null && !isNaN(Number(movie.imdbRating)) && Number(movie.imdbRating) > 0)
                ? Number(movie.imdbRating)
                : 0;

        const tmdbRating = (movie.rating?.tmdb !== undefined && movie.rating?.tmdb !== null && !isNaN(Number(movie.rating.tmdb)) && Number(movie.rating.tmdb) > 0)
            ? Number(movie.rating.tmdb)
            : (movie.ratingTmdb !== undefined && movie.ratingTmdb !== null && !isNaN(Number(movie.ratingTmdb)) && Number(movie.ratingTmdb) > 0)
                ? Number(movie.ratingTmdb)
                : 0;

        const duration = movie.duration || movie.movieLength || 0;
        const description = movie.description || i18n.get('movie_details.no_description') || 'Описание отсутствует';
        
        const votes = (movie.votes?.kp !== undefined && movie.votes?.kp !== null && !isNaN(Number(movie.votes.kp)) && Number(movie.votes.kp) > 0)
            ? Number(movie.votes.kp)
            : 0;

        const imdbVotes = (movie.votes?.imdb !== undefined && movie.votes?.imdb !== null && !isNaN(Number(movie.votes.imdb)) && Number(movie.votes.imdb) > 0)
            ? Number(movie.votes.imdb)
            : 0;

        const hasProviderRatingData = kpRating > 0 || imdbRating > 0;
        const providerRatingsReady = kpRating > 0 && imdbRating > 0;
        const initialProviderRatingsMarkup = hasProviderRatingData
            ? this.renderProviderRatingTile('kp', movie, { rating: kpRating, votes, loading: !providerRatingsReady })
                + this.renderProviderRatingTile('imdb', movie, { rating: imdbRating, votes: imdbVotes, loading: !providerRatingsReady })
            : '';

        const tmdbVotes = (movie.votes?.tmdb !== undefined && movie.votes?.tmdb !== null && !isNaN(Number(movie.votes.tmdb)) && Number(movie.votes.tmdb) > 0)
            ? Number(movie.votes.tmdb)
            : (movie.voteCount !== undefined && movie.voteCount !== null && !isNaN(Number(movie.voteCount)) && Number(movie.voteCount) > 0)
                ? Number(movie.voteCount)
                : 0;

        const backdropUrl = movie.backdropUrl || movie.backdrop || '';
        const hasBackdrop = Boolean(backdropUrl && typeof backdropUrl === 'string' && backdropUrl.startsWith('http'));

        const hasShortDesc = this.shouldRenderShortDescription(movie.shortDescription, description);
        const shortDescToRender = hasShortDesc ? movie.shortDescription.trim() : '';
        
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
        
        const allCrew = this.getMovieCrew(movie);
        const directorsStr = this.formatCrewCategory(allCrew, 'DIRECTOR', 3);
        const writersStr = this.formatCrewCategory(allCrew, 'WRITER', 5);
        const producersStr = this.formatCrewCategory(allCrew, 'PRODUCER', 5);
        const operatorsStr = this.formatCrewCategory(allCrew, 'CINEMATOGRAPHY', 3);
        const composersStr = this.formatCrewCategory(allCrew, 'COMPOSER', 3);
        const designersStr = this.formatCrewCategory(allCrew, 'DESIGNER', 3);
        const editorsStr = this.formatCrewCategory(allCrew, 'EDITOR', 3);
        const cast = this.getMovieCast(movie);
        
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

        const parseDateTs = (d) => {
            if (!d) return null;
            const ts = new Date(d).getTime();
            return isNaN(ts) ? null : ts;
        };

        const premiereDigitalRaw = movie.premiere?.digital;
        const digitalTs = parseDateTs(premiereDigitalRaw);
        const worldTs = parseDateTs(movie.premiere?.world);
        const russiaTs = parseDateTs(movie.premiere?.russia);

        let premiereDigitalStr = '';
        if (premiereDigitalRaw && digitalTs !== null) {
            if (digitalTs !== worldTs && digitalTs !== russiaTs) {
                premiereDigitalStr = kinopoiskService.formatDate(premiereDigitalRaw);
            }
        }

        let ageRatingStr = '';
        if (movie.ageRating !== undefined && movie.ageRating !== null && movie.ageRating !== '') {
            const numAge = Number(movie.ageRating);
            if (!isNaN(numAge) && numAge > 0) {
                ageRatingStr = `${numAge}+`;
            } else if (typeof movie.ageRating === 'string') {
                const trimmed = movie.ageRating.trim();
                const parsed = parseInt(trimmed, 10);
                if (!isNaN(parsed) && parsed > 0) {
                    ageRatingStr = `${parsed}+`;
                }
            }
        }

        let mpaaRatingStr = '';
        if (movie.ratingMpaa && typeof movie.ratingMpaa === 'string') {
            const trimmedMpaa = movie.ratingMpaa.trim();
            if (trimmedMpaa && trimmedMpaa.toLowerCase() !== 'null' && trimmedMpaa.toLowerCase() !== 'undefined') {
                mpaaRatingStr = trimmedMpaa.toUpperCase();
            }
        }

        let ageDisplayStr = '';
        if (ageRatingStr && mpaaRatingStr) {
            ageDisplayStr = `${ageRatingStr} • ${mpaaRatingStr}`;
        } else if (ageRatingStr) {
            ageDisplayStr = ageRatingStr;
        } else if (mpaaRatingStr) {
            ageDisplayStr = mpaaRatingStr;
        }

        // Localized labels for genres/countries inside card data
        const localizedGenres = Array.isArray(movie.genres) ? movie.genres.map(genre => {
            const genreName = typeof genre === 'string' ? genre : (genre?.name || genre?.genre || '');
            if (!genreName || typeof genreName !== 'string') return '';
            const entry = Object.entries(i18n.locales.ru.random.genres).find(([k, v]) => v.toLowerCase() === genreName.toLowerCase());
            return entry ? i18n.get(`random.genres.${entry[0]}`) : genreName;
        }).filter(Boolean).join(', ') : '';

        const localizedCountries = Array.isArray(movie.countries) ? movie.countries.map(country => {
            const countryName = typeof country === 'string' ? country : (country?.name || country?.country || '');
            if (!countryName || typeof countryName !== 'string') return '';
            const entry = Object.entries(i18n.locales.ru.random.countries).find(([k, v]) => v.toLowerCase() === countryName.toLowerCase());
            return entry ? i18n.get(`random.countries.${entry[0]}`) : this.localizeCountryName(countryName);
        }).filter(Boolean).join(', ') : '';

        const logoUrl = movie.logoUrl || '';
        const hasLogo = Boolean(logoUrl && typeof logoUrl === 'string' && logoUrl.startsWith('http'));

        const statusLabel = this.translateStatus(movie.status);
        const statusBadgeClass = this.getStatusBadgeClass(movie.status);

        const productionCompaniesHtml = this.renderProductionCompanies(movie.productionCompanies);
        const criticRatingsHtml = this.renderCriticRatings(movie.criticRatings);

        const facts = Array.isArray(movie.facts)
            ? movie.facts.filter(f => f && typeof f.value === 'string' && f.value.trim().length > 0)
            : [];

        const mediaTypeInfo = this.getMediaTypeBadge(movie);
        const hasSecondaryCrew = Boolean(operatorsStr || composersStr || designersStr || editorsStr);
        let isCrewExpanded = false;
        try {
            isCrewExpanded = localStorage.getItem('movie_details_crew_expanded') === 'true';
        } catch {
            // Safe fallback if localStorage is restricted
        }

        const primaryTrailerResult = this.resolvePrimaryTrailer(movie);
        const primaryTrailerKey = (primaryTrailerResult?.trailer?.key && String(primaryTrailerResult.trailer.key).trim())
            ? String(primaryTrailerResult.trailer.key).trim()
            : null;

        return `
            <div class="movie-detail-page">
                ${hasBackdrop ? `
                <div class="movie-detail-hero-backdrop" aria-hidden="true">
                    <img src="${this.escapeHtml(backdropUrl)}" alt="" class="movie-detail-hero-backdrop-img" data-fallback="backdrop" loading="eager" decoding="async">
                    <div class="movie-detail-hero-backdrop-overlay"></div>
                </div>` : ''}
                <div class="movie-detail-header">
                    <div class="movie-detail-poster-container">
                        <img src="${this.escapeHtml(posterUrl)}" alt="${this.escapeHtml(movieName)}" class="movie-detail-page-poster" data-fallback="detail" decoding="async" fetchpriority="high">
                        <div class="movie-poster-placeholder" style="display: none;"><svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line><line x1="2" y1="7" x2="7" y2="7"></line><line x1="2" y1="17" x2="7" y2="17"></line><line x1="17" y1="17" x2="22" y2="17"></line><line x1="17" y1="7" x2="22" y2="7"></line></svg></div>
                        

                        <div class="movie-detail-ratings-container">
                            ${initialProviderRatingsMarkup}
                        </div>
                        
                        <div class="movie-actions-container">
                            <button class="btn btn-primary btn-lg watch-movie-btn" data-movie-id="${movie.kinopoiskId}">
                                <span class="btn-icon"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span>
                                ${i18n.get('movie_details.watch_movie')}
                            </button>
                            <button class="btn btn-secondary btn-lg rate-movie-btn" data-movie-id="${movie.kinopoiskId}"${typeof isSeriesMedia === 'function' && isSeriesMedia(movie) && !(Number(movie.kinopoiskId) > 0) ? ` disabled aria-disabled="true" title="${this.escapeHtml(i18n.get('movie_details.series_rating_disabled_hint'))}"` : ''}>
                                <span class="btn-icon"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg></span>
                                <span class="rate-movie-label">${i18n.get('movie_details.rate_title')}</span>
                            </button>
                            ${this.isAdmin && this.authVerified ? this.renderAnnounceButton(movie.kinopoiskId) : ''}
                        </div>
                    </div>
                    
                    <div class="movie-detail-info-container">
                        <div class="movie-detail-title-wrapper">
                            ${hasLogo ? `
                            <div class="movie-detail-logo-container">
                                <img src="${this.escapeHtml(logoUrl)}" alt="${this.escapeHtml(movieName)}" class="movie-detail-title-logo" data-fallback="title-logo" loading="eager" decoding="async">
                            </div>` : ''}
                            <div class="movie-detail-title-row">
                                <span class="hero-media-type-badge hero-media-type-badge--${mediaTypeInfo.class}">${this.escapeHtml(mediaTypeInfo.label)}</span>
                                <h1 class="movie-detail-page-title">${this.escapeHtml(movieName)}</h1>
                            </div>
                            
                            <div class="mc-menu-container" style="position: relative; z-index: 20;">
                                <button type="button" class="mc-menu-btn" title="Действия" aria-label="Действия с фильмом" aria-haspopup="true" aria-expanded="false"><span class="mc-menu-icon" aria-hidden="true">⋮</span></button>
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

                                    <div class="mc-menu-divider"></div>
                                    <button class="mc-menu-item" data-action="add-to-random-pool"
                                            data-movie-id="${movie.kinopoiskId}" aria-pressed="false">
                                        <span class="mc-menu-item-icon"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"></rect><circle cx="8" cy="8" r="1"></circle><circle cx="16" cy="8" r="1"></circle><circle cx="8" cy="16" r="1"></circle><circle cx="16" cy="16" r="1"></circle><circle cx="12" cy="12" r="1"></circle></svg></span>
                                        <span class="mc-menu-item-text">${i18n.get('movie_card.add_random_pool')}</span>
                                    </button>
                                    
                                    <div class="mc-menu-collections-slot">${this.renderCollectionsMenu(movie)}</div>

                                    <div class="mc-menu-divider"></div>
                                    <button class="mc-menu-item" data-action="force-refresh-movie"
                                            data-movie-id="${movie.kinopoiskId}"
                                            title="${this.escapeHtml(i18n.get('movie_details.refresh_data') || 'Обновить данные')}">
                                        <span class="mc-menu-item-icon"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg></span>
                                        <span class="mc-menu-item-text">${i18n.get('movie_details.refresh_data') || 'Обновить данные'}</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                        ${movieAltName ? `<h2 class="movie-detail-alt-title">${this.escapeHtml(movieAltName)}</h2>` : ''}
                        ${this.renderHeroNextEpisode(movie)}
                        ${shortDescToRender ? `<p class="movie-detail-short-description">${this.escapeHtml(shortDescToRender)}</p>` : ''}
                        
                        <div class="movie-tabs tabs-container">
                            <div class="tab-buttons" role="tablist" aria-label="Информация о фильме">
                                <button type="button" class="tab-btn active" data-tab="about" role="tab" id="tab-btn-about" aria-controls="tab-about" aria-selected="true" tabindex="0">${i18n.get('movie_details.tabs.about')}</button>
                                <button type="button" class="tab-btn ${cast.length === 0 ? 'disabled' : ''}" data-tab="actors" role="tab" id="tab-btn-actors" aria-controls="tab-actors" aria-selected="false" tabindex="-1" ${cast.length === 0 ? 'disabled' : ''}>${i18n.get('movie_details.tabs.actors')}</button>
                                <button type="button" class="tab-btn ${!movie.awards || movie.awards.length === 0 ? 'disabled' : ''}" data-tab="awards" role="tab" id="tab-btn-awards" aria-controls="tab-awards" aria-selected="false" tabindex="-1" ${!movie.awards || movie.awards.length === 0 ? 'disabled' : ''}>${i18n.get('movie_details.tabs.awards')}</button>
                                ${facts.length > 0 ? `<button type="button" class="tab-btn" data-tab="facts" role="tab" id="tab-btn-facts" aria-controls="tab-facts" aria-selected="false" tabindex="-1">${i18n.get('movie_details.tabs.facts')} <span class="tab-count-badge">${facts.length}</span></button>` : ''}
                                <button type="button" class="tab-btn" data-tab="seasons" role="tab" id="tab-btn-seasons" aria-controls="tab-seasons" aria-selected="false" tabindex="-1" style="display: none;">${i18n.get('movie_details.tabs.seasons')}</button>
                                <button type="button" class="tab-btn" data-tab="soundtrack" role="tab" id="tab-btn-soundtrack" aria-controls="tab-soundtrack" aria-selected="false" tabindex="-1">${i18n.get('movie_details.tabs.soundtrack')}</button>
                            </div>
                            
                            <div class="tab-content">
                                <div class="tab-pane active" id="tab-about" role="tabpanel" aria-labelledby="tab-btn-about" tabindex="0">
                                    <div class="movie-detail-meta-grid">
                                        <div class="meta-item"><span class="meta-label">${this.metaLabel('movie_details.meta.year')}</span><span class="meta-value">${year}</span></div>
                                        ${statusLabel ? `<div class="meta-item meta-item-status"><span class="meta-label">${this.metaLabel('movie_details.meta.status')}</span><span class="meta-value status-badge status-badge--${statusBadgeClass}">${this.escapeHtml(statusLabel)}</span></div>` : ''}
                                        ${tmdbRating > 0 ? `
                                        <div class="meta-item meta-item--tmdb">
                                            <span class="meta-label">${this.metaLabel('movie_details.meta.tmdb_rating')}</span>
                                            <span class="meta-value meta-value--tmdb">
                                                <strong class="meta-tmdb-score">${parseFloat(tmdbRating.toFixed(1))}</strong>
                                                ${tmdbVotes > 0 ? `<span class="meta-tmdb-separator">·</span><span class="meta-tmdb-votes">${i18n.get('movie_details.votes_count').replace('{count}', this.formatVotes(tmdbVotes))}</span>` : ''}
                                            </span>
                                        </div>` : ''}
                                        ${localizedCountries ? `<div class="meta-item"><span class="meta-label">${this.metaLabel('movie_details.meta.country')}</span><span class="meta-value">${localizedCountries}</span></div>` : ''}
                                        ${productionCompaniesHtml ? `<div class="meta-item meta-item--companies"><span class="meta-label">${this.metaLabel('movie_details.meta.studios')}</span><span class="meta-value">${productionCompaniesHtml}</span></div>` : ''}
                                        ${localizedGenres ? `<div class="meta-item"><span class="meta-label">${this.metaLabel('movie_details.meta.genre')}</span><span class="meta-value">${localizedGenres}</span></div>` : ''}
                                        ${movie.slogan ? `<div class="meta-item"><span class="meta-label">${this.metaLabel('movie_details.meta.slogan')}</span><span class="meta-value">«${this.escapeHtml(movie.slogan)}»</span></div>` : ''}
                                        ${directorsStr ? `<div class="meta-item"><span class="meta-label">${this.metaLabel('movie_details.meta.director')}</span><span class="meta-value">${directorsStr}</span></div>` : ''}
                                        ${writersStr ? `<div class="meta-item"><span class="meta-label">${this.metaLabel('movie_details.meta.writer')}</span><span class="meta-value">${writersStr}</span></div>` : ''}
                                        ${producersStr ? `<div class="meta-item"><span class="meta-label">${this.metaLabel('movie_details.meta.producer')}</span><span class="meta-value">${producersStr}</span></div>` : ''}
                                        ${hasSecondaryCrew ? `
                                        <div class="meta-item meta-item--secondary-crew">
                                            <button type="button" class="meta-toggle-btn meta-crew-toggle" data-action="toggle-crew" aria-expanded="${isCrewExpanded}" aria-controls="metaSecondaryCrew">
                                                <span class="meta-toggle-text">${this.metaLabel('movie_details.meta.crew')}</span>
                                                <svg class="meta-toggle-icon" viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                                                    <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
                                                </svg>
                                            </button>
                                            <div class="meta-secondary-crew" id="metaSecondaryCrew" ${isCrewExpanded ? '' : 'hidden'}>
                                                ${operatorsStr ? `<div class="meta-item meta-item--nested"><span class="meta-label">${this.metaLabel('movie_details.meta.operator')}</span><span class="meta-value">${operatorsStr}</span></div>` : ''}
                                                ${composersStr ? `<div class="meta-item meta-item--nested"><span class="meta-label">${this.metaLabel('movie_details.meta.composer')}</span><span class="meta-value">${composersStr}</span></div>` : ''}
                                                ${designersStr ? `<div class="meta-item meta-item--nested"><span class="meta-label">${this.metaLabel('movie_details.meta.designer')}</span><span class="meta-value">${designersStr}</span></div>` : ''}
                                                ${editorsStr ? `<div class="meta-item meta-item--nested"><span class="meta-label">${this.metaLabel('movie_details.meta.editor')}</span><span class="meta-value">${editorsStr}</span></div>` : ''}
                                            </div>
                                        </div>` : ''}
                                        ${this.renderFinanceMetaItem(movie, kinopoiskService)}
                                        ${premiereRussiaStr ? `<div class="meta-item"><span class="meta-label">${this.metaLabel('movie_details.meta.premiere_russia')}</span><span class="meta-value">${premiereRussiaStr}</span></div>` : ''}
                                        ${premiereWorldStr ? `<div class="meta-item"><span class="meta-label">${this.metaLabel('movie_details.meta.premiere_world')}</span><span class="meta-value">${premiereWorldStr}</span></div>` : ''}
                                        ${premiereDigitalStr ? `<div class="meta-item"><span class="meta-label">${this.metaLabel('movie_details.meta.premiere_digital')}</span><span class="meta-value">${this.escapeHtml(premiereDigitalStr)}</span></div>` : ''}
                                        ${criticRatingsHtml ? `<div class="meta-item meta-item--critics"><span class="meta-label">${this.metaLabel('movie_details.meta.critics')}</span><span class="meta-value">${criticRatingsHtml}</span></div>` : ''}
                                        ${ageDisplayStr ? `<div class="meta-item"><span class="meta-label">${this.metaLabel('movie_details.meta.age_rating')}</span><span class="meta-value">${this.escapeHtml(ageDisplayStr)}</span></div>` : ''}
                                        ${duration ? `<div class="meta-item"><span class="meta-label">${this.metaLabel('movie_details.meta.duration')}</span><span class="meta-value">${this.escapeHtml(this.formatDurationLabel(duration))}</span></div>` : ''}
                                    </div>
                                </div>
                                
                                <div class="tab-pane" id="tab-actors" role="tabpanel" aria-labelledby="tab-btn-actors" tabindex="0">
                                    ${this.renderActorsTab(cast)}
                                </div>
                                
                                <div class="tab-pane" id="tab-awards" role="tabpanel" aria-labelledby="tab-btn-awards" tabindex="0">
                                    ${this.renderAwardsTab(movie.awards)}
                                </div>

                                ${facts.length > 0 ? `
                                <div class="tab-pane" id="tab-facts" role="tabpanel" aria-labelledby="tab-btn-facts" tabindex="0">
                                    ${this.renderFactsTab(facts)}
                                </div>` : ''}
                                
                                <div class="tab-pane" id="tab-seasons" role="tabpanel" aria-labelledby="tab-btn-seasons" tabindex="0">
                                    <div class="no-data-placeholder">Загрузка...</div>
                                </div>

                                <div class="tab-pane" id="tab-soundtrack" role="tabpanel" aria-labelledby="tab-btn-soundtrack" tabindex="0">
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
                    ${this.renderFranchiseSectionPlaceholder(movie)}
                    ${this.renderVideosSection(movie.videos, primaryTrailerKey)}
                    ${this.renderSequelsAndPrequels(movie.sequelsAndPrequels, movie)}
                    ${this.renderRecommendationsSectionPlaceholder(movie)}
                    ${this.createMovieFramesSection(movie)}
                    <div id="userRatingsSection" class="user-ratings-section" data-movie-id="${movie.kinopoiskId}">
                        <div class="user-ratings-loading app-loader app-loader--inline app-loader--compact" style="display: none;" role="status" aria-live="polite">
                            <div class="app-loader__indicator" aria-hidden="true"></div>
                            <span class="app-loader__label">${i18n.get('movie_details.loading_reviews')}</span>
                        </div>
                        <div class="user-ratings-content"></div>
                    </div>
                </div>
            </div>
        `;
    }

    async loadSoundtrack(movie) {
        const movieId = movie?.kinopoiskId;
        const settle = (state) => {
            if (String(this.selectedMovie?.kinopoiskId || '') !== String(movieId || '')) return;
            const snapshot = this.getRenderEnrichmentSnapshot(movieId);
            if (snapshot) snapshot.soundtrack = state;
            this.renderSoundtrackState(state);
        };

        // Lazy-load SpotifyService if not yet loaded
        if (!this.spotifyService) {
            try {
                await LazyLoader.loadScript('../../shared/config/spotify.config.js');
                await LazyLoader.loadScript('../../shared/services/SpotifyService.js');
                if (typeof SpotifyService === 'undefined') throw new Error('SpotifyService is not defined');
                this.spotifyService = new SpotifyService();
            } catch (e) {
                console.warn('[MovieDetails] Failed to load SpotifyService:', e.message);
                settle({ status: 'error' });
                return;
            }
        }

        try {
            // Priority: originalName (native) > alternativeName (usually English) > enName > name (Russian)
            const searchTitle = movie.originalName || movie.alternativeName || movie.enName || movie.name;
            const uri = await this.spotifyService.searchSoundtrack(searchTitle, movie.year);
            if (!uri) {
                settle({ status: 'missing' });
                return;
            }
            const embedUrl = this.getSafeWebUrl(this.spotifyService.getEmbedUrl(uri));
            if (!embedUrl) throw new Error('Spotify returned an unsupported embed URL');
            settle({ status: 'found', embedUrl });
        } catch (error) {
            console.error('Error loading soundtrack:', error);
            settle({ status: 'error' });
        }
    }

    renderSoundtrackState(state) {
        const container = document.getElementById('soundtrackContainer');
        if (!container || !state) return;

        if (state.status === 'found' && state.embedUrl) {
            const frame = document.createElement('iframe');
            frame.src = state.embedUrl;
            frame.width = '100%';
            frame.height = '380';
            frame.setAttribute('frameborder', '0');
            frame.setAttribute('allow', 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture');
            frame.loading = 'lazy';
            frame.title = 'Spotify';
            container.replaceChildren(frame);
            return;
        }

        const placeholder = document.createElement('span');
        placeholder.className = 'soundtrack-placeholder';
        placeholder.textContent = state.status === 'missing' ? 'Саундтрек не найден' : 'Саундтрек недоступен';
        container.replaceChildren(placeholder);
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
                        ? `<img src="${this.escapeHtml(col.icon)}" alt="" style="width: 16px; height: 16px; object-fit: cover; border-radius: 4px;">`
                        : (col.icon || '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>');
                    return `
                        <button class="mc-menu-item" data-action="toggle-collection"
                                data-movie-id="${movie.kinopoiskId}"
                                data-collection-id="${col.id}">
                            <span class="mc-menu-item-icon">${iconHtml}</span>
                            <span class="mc-menu-item-text" style="${isInCollection ? 'font-weight: 500; color: #fff;' : ''}">${col.name}</span>
                            ${isInCollection ? '<span class="mc-collection-check" style="margin-left: auto; font-weight: bold; color: var(--accent-color, #4CAF50);"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></span>' : ''}
                        </button>
                    `;
                }).join('')}
            </div>
        `;
    }

    getRelatedContentIdentity(item, { allowGenericKinopoiskId = false } = {}) {
        if (typeof FranchiseService !== 'undefined' && typeof FranchiseService.getStableIdentity === 'function') {
            return FranchiseService.getStableIdentity(item, { allowGenericKinopoiskId });
        }

        const normalizeId = (value) => {
            const numericId = Number(value);
            return Number.isInteger(numericId) && numericId > 0 ? numericId : null;
        };
        const kpCandidates = [item?.kinopoiskId, item?.filmId, item?.movieId];
        if (allowGenericKinopoiskId) kpCandidates.push(item?.id);
        return {
            kinopoiskId: kpCandidates.map(normalizeId).find(Boolean) || null,
            tmdbId: normalizeId(item?.tmdbId ?? item?.externalId?.tmdb ?? item?.externalIds?.tmdb)
        };
    }

    beginPageGeneration(movieId) {
        const kinopoiskId = String(movieId || '');
        if (!kinopoiskId) return this.capturePageContext();

        if (this.activePageContext?.kinopoiskId !== kinopoiskId) {
            this.pageGeneration += 1;
            this.activePageContext = {
                generation: this.pageGeneration,
                kinopoiskId
            };
            this.resetMovieStateForNavigation(kinopoiskId);
        }

        return this.capturePageContext();
    }

    resetMovieStateForNavigation(kinopoiskId = null) {
        this.selectedMovie = null;
        this.postRenderEnrichmentMovieId = null;
        this.renderEnrichmentSnapshot = null;
        this.franchiseState = null;
        if (this.franchiseObserver) {
            try { this.franchiseObserver.disconnect(); } catch { /* ignore */ }
            this.franchiseObserver = null;
        }
        if (this.preloadTimeout) {
            clearTimeout(this.preloadTimeout);
            this.preloadTimeout = null;
        }
        if (this.isVideoModalOpen) {
            try { this.closeVideoModal(); } catch { /* ignore */ }
        }
        this.ratingReviewTouched = false;
        this.currentRating = 0;
    }

    capturePageContext(movie = this.selectedMovie) {
        const kinopoiskId = String(movie?.kinopoiskId || movie?.id || this.activePageContext?.kinopoiskId || '');
        return {
            generation: this.activePageContext?.generation ?? this.pageGeneration,
            kinopoiskId
        };
    }

    isPageContextCurrent(context) {
        if (!context || !context.kinopoiskId) return false;
        // Keeps prototype-level legacy test harnesses usable; real managers always
        // initialize pageGeneration in the constructor and therefore never use it.
        const selectedMovieId = String(this.selectedMovie?.kinopoiskId || this.selectedMovie?.id || '');
        if (!this.activePageContext) {
            return this.pageGeneration === undefined && context.kinopoiskId === selectedMovieId;
        }
        return context.generation === this.activePageContext.generation
            && context.kinopoiskId === this.activePageContext.kinopoiskId
            && (!selectedMovieId || context.kinopoiskId === selectedMovieId);
    }

    invalidatePageGeneration() {
        this.pageGeneration += 1;
        this.activePageContext = null;
    }

    getModalStack() {
        if (!this.modalStack) {
            this.modalStack = new MovieDetailsModalStack({
                trapFocus: (event, dialog) => this.trapDialogFocus(event, dialog)
            });
            this.modalStack.attach(document);
        }
        return this.modalStack;
    }

    isDialogShown(dialog) {
        return Boolean(dialog) && dialog.style.display !== 'none';
    }

    getPlayerModal() {
        if (!this.playerModal) {
            this.playerModal = new MovieDetailsPlayerModal({
                getModal: () => this.elements?.videoPlayerModal,
                getRestoreDock: () => document.getElementById('restorePlayerBtn'),
                getCloseButton: () => this.elements?.closeVideoBtn,
                getRestoreTitle: () => {
                    if (!this.selectedMovie) return '';
                    const isEnglish = i18n.currentLocale === 'en';
                    return (isEnglish && this.selectedMovie.alternativeName)
                        ? this.selectedMovie.alternativeName
                        : (this.selectedMovie.name || 'Movie');
                },
                openDialog: (dialog) => this.openAccessibleDialog(dialog),
                closeDialog: (dialog) => this.closeAccessibleDialog(dialog),
                pausePlayback: () => this.tryPauseVideo()
            });
        }
        return this.playerModal;
    }

    isVideoPlayerShown() {
        return this.getPlayerModal().isShown();
    }

    // Escape/Tab precedence, topmost first. Player popovers sit above the
    // player dialog; trailer and rating dialogs open above the player.
    registerModalLayers() {
        const stack = this.getModalStack();
        const announceModal = () => document.getElementById('announceModal');
        // The shared ConfirmDialog handles its own Escape/Tab; this layer keeps the
        // page stack from treating the dialogs underneath it as topmost.
        stack.register('confirm', {
            order: 5,
            isOpen: () => Boolean(window.ConfirmDialog?.isOpen()),
            close: () => window.ConfirmDialog?.cancel(),
            getFocusContainer: () => window.ConfirmDialog?.getElement() || null,
            stopPropagation: true
        });
        stack.register('announce', {
            order: 10,
            isOpen: () => this.isDialogShown(announceModal()),
            close: () => this.closeAnnounceModal(),
            getFocusContainer: announceModal
        });
        stack.register('review-reader', {
            order: 20,
            isOpen: () => this.isDialogShown(this.elements.reviewReaderModal),
            close: () => this.closeReviewReader(),
            getFocusContainer: () => this.elements.reviewReaderModal
        });
        stack.register('torrent-source-disclosure', {
            order: 30,
            isOpen: () => this.isVideoPlayerShown()
                && !this.elements.torrentSourcePanel?.hidden
                && Boolean(this.elements.torrentSourceDisclosure?.open),
            close: () => {
                this.elements.torrentSourceDisclosure.open = false;
                this.elements.torrentSourceDisclosure.querySelector('summary')?.focus();
            }
        });
        stack.register('watch-room-invite', {
            order: 40,
            isOpen: () => this.isVideoPlayerShown() && this.elements.watchRoomInvitePopover?.hidden === false,
            close: () => this.closeWatchRoomInvite({ restoreFocus: true })
        });
        stack.register('episode-picker', {
            order: 50,
            stopPropagation: true,
            isOpen: () => this.isVideoPlayerShown() && Boolean(this.isEpisodePickerOpen),
            close: () => this.closeEpisodePicker()
        });
        stack.register('trailer', {
            order: 60,
            isOpen: () => this.isDialogShown(this.elements.trailerModal),
            close: () => this.closeTrailerModal(),
            getFocusContainer: () => this.elements.trailerModal
        });
        stack.register('rating', {
            order: 70,
            isOpen: () => this.isDialogShown(this.elements.ratingModal),
            close: () => this.closeRatingModal(),
            getFocusContainer: () => this.elements.ratingModal
        });
        stack.register('video-player', {
            order: 80,
            isOpen: () => this.isVideoPlayerShown(),
            close: () => this.closeVideoModal(),
            getFocusContainer: () => this.elements.videoPlayerModal
        });
    }

    openAccessibleDialog(dialog, trigger = document.activeElement) {
        if (!dialog) return;
        this._dialogTriggers ||= new WeakMap();
        this._dialogTriggers.set(dialog, trigger);
        dialog.style.display = 'flex';
        // Priority order, not document order: a selector list would pick the first match in the DOM.
        const target = ['[data-dialog-initial-focus]', '[autofocus]', '.modal-close', 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])']
            .map(selector => dialog.querySelector?.(selector))
            .find(Boolean) || dialog;
        target.focus?.();
    }

    closeAccessibleDialog(dialog) {
        if (!dialog) return;
        dialog.style.display = 'none';
        const trigger = this._dialogTriggers?.get(dialog);
        if (trigger?.isConnected && !trigger.disabled && trigger.offsetParent !== null) {
            trigger.focus?.();
        } else {
            this.elements.movieDetailsContainer?.focus?.();
        }
    }

    trapDialogFocus(event, dialog) {
        if (event.key !== 'Tab' || !dialog || dialog.style.display === 'none' || dialog.classList.contains('minimized-overlay')) return;
        const focusable = [...(dialog.querySelectorAll?.('button:not([disabled]), summary, [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') || [])]
            .filter(el => el.offsetParent !== null);
        if (focusable.length === 0) {
            event.preventDefault();
            dialog.focus?.();
            return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    relatedContentItemsMatch(left, right, leftOptions = {}, rightOptions = {}) {
        const leftIdentity = this.getRelatedContentIdentity(left, leftOptions);
        const rightIdentity = this.getRelatedContentIdentity(right, rightOptions);
        if (leftIdentity.kinopoiskId && rightIdentity.kinopoiskId) {
            return leftIdentity.kinopoiskId === rightIdentity.kinopoiskId;
        }
        return Boolean(
            leftIdentity.tmdbId &&
            rightIdentity.tmdbId &&
            leftIdentity.tmdbId === rightIdentity.tmdbId
        );
    }

    deduplicateRelatedContent(items, { allowGenericKinopoiskId = false } = {}) {
        if (!Array.isArray(items)) return [];
        const accepted = [];
        return items.filter(item => {
            const identity = this.getRelatedContentIdentity(item, { allowGenericKinopoiskId });
            if (!identity.kinopoiskId && !identity.tmdbId) return true;
            if (accepted.some(existing => this.relatedContentItemsMatch(
                existing,
                item,
                { allowGenericKinopoiskId },
                { allowGenericKinopoiskId }
            ))) return false;
            accepted.push(item);
            return true;
        });
    }

    renderSequelsAndPrequels(sequels, currentMovie = this.selectedMovie) {
        const uniqueSequels = this.deduplicateRelatedContent(sequels, { allowGenericKinopoiskId: true })
            .filter(item => !this.relatedContentItemsMatch(
                item,
                currentMovie,
                { allowGenericKinopoiskId: true },
                { allowGenericKinopoiskId: true }
            ));
        if (uniqueSequels.length === 0) return '';
        
        return `
            <div class="sequels-section" data-relation-count="${uniqueSequels.length}">
                <h3>${i18n.get('movie_details.sequels') || 'Сиквелы и приквелы'}</h3>
                <div class="sequels-container">
                    ${uniqueSequels.map(movie => {
                        const posterUrl = movie.poster?.previewUrl || movie.poster?.url || '/src/shared/assets/icons/app/icon48.png';
                        let name = (i18n.currentLocale === 'en' && movie.enName) ? movie.enName : (movie.name || movie.alternativeName || i18n.get('movie_card.unknown_movie'));
                        
                        // Fallback logic for name if it's missing (rare but possible)
                        if (!name && movie.alternativeName) name = movie.alternativeName;
                        if (!name && movie.enName) name = movie.enName;
                        
                        // Year handling - sometimes it's missing in the simplified object
                        const year = movie.year || (movie.releaseYears && movie.releaseYears.length > 0 ? movie.releaseYears[0].start : '') || '';
                        const identity = this.getRelatedContentIdentity(movie, { allowGenericKinopoiskId: true });
                        const movieId = identity.kinopoiskId;
                        const identityAttributes = `${movieId ? ` data-kinopoisk-id="${movieId}"` : ''}${identity.tmdbId ? ` data-tmdb-id="${identity.tmdbId}"` : ''}`;
                        const tagName = movieId ? 'a' : 'div';
                        const href = movieId ? ` href="movie-details.html?movieId=${movieId}"` : '';
                        const inertClass = movieId ? '' : ' sequel-card--inert';
                        
                        return `
                        <${tagName}${href} class="sequel-card${inertClass}"${identityAttributes}>
                            <div class="sequel-poster-container">
                                <img src="${this.escapeHtml(posterUrl)}"
                                     alt="${this.escapeHtml(name)}" 
                                     class="sequel-poster" 
                                     loading="lazy" 
                                     decoding="async"
                                     data-fallback="sequel-poster"
                                     data-sequel-id="${movieId || ''}"
                                     data-year="${this.escapeHtml(year)}">
                            </div>
                            <div class="sequel-info">
                                <span class="sequel-year">${year}</span>
                                <span class="sequel-title" title="${this.escapeHtml(name)}">${this.escapeHtml(name)}</span>
                            </div>
                        </${tagName}>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    /**
     * Resolve localized recommendations section title based on media classification.
     * @param {Object} movie
     * @returns {string}
     */
    getRecommendationsSectionTitle(movie) {
        const classifier = (typeof MediaClassifier !== 'undefined')
            ? MediaClassifier
            : (typeof globalThis !== 'undefined' && globalThis.MediaClassifier ? globalThis.MediaClassifier : null);

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

    /**
     * Render lightweight placeholder with skeleton cards for recommendations.
     * @param {Object} movie
     * @returns {string}
     */
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

    /**
     * Render compact skeleton cards.
     * @param {number} [count=5]
     * @returns {string}
     */
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

    /**
     * Observe recommendation section or trigger deferred async load.
     * @param {Object} movie
     */
    observeOrLoadRecommendations(movie) {
        if (!movie) return;
        const sectionEl = document.getElementById('movieRecommendationsSection');
        if (!sectionEl) return;

        const scheduleLoad = () => {
            const load = () => {
                if (sectionEl.isConnected) this.loadRecommendationsAsync(movie);
            };

            // Let the first content frame and critical enrichment work settle
            // before starting the browser-context Kinopoisk scrape.
            if (typeof requestIdleCallback === 'function') {
                requestIdleCallback(load, { timeout: 1200 });
            } else {
                setTimeout(load, 120);
            }
        };

        if (typeof IntersectionObserver !== 'undefined') {
            if (this.recommendationsObserver) {
                this.recommendationsObserver.disconnect();
            }
            this.recommendationsObserver = new IntersectionObserver((entries) => {
                const entry = entries[0];
                if (entry && entry.isIntersecting) {
                    this.recommendationsObserver.disconnect();
                    this.recommendationsObserver = null;
                    scheduleLoad();
                }
            }, { rootMargin: '300px' });
            this.recommendationsObserver.observe(sectionEl);
        } else {
            scheduleLoad();
        }
    }

    /**
     * Asynchronously fetch, deduplicate, and render recommendations in MovieDetails.
     * @param {Object} movie
     */
    async loadRecommendationsAsync(movie) {
        if (!movie) return;
        const movieId = String(movie.kinopoiskId || movie.id);
        const pageContext = this.capturePageContext(movie);
        const state = this.recommendationsState || (this.recommendationsState = { movieId: null, status: 'idle', data: null });
        if (state.movieId === movieId && state.status === 'failed') {
            document.getElementById('movieRecommendationsSection')?.remove();
            return;
        }
        if (state.movieId === movieId && state.status === 'loading') return;

        let filteredRecs = state.movieId === movieId && state.status === 'ready' ? state.data : null;
        const recommendationUiTraceStartedAt = typeof performance !== 'undefined' && typeof performance.now === 'function'
            ? performance.now()
            : Date.now();
        let recommendationLongTaskCount = 0;
        let recommendationLongTaskTotalMs = 0;
        let recommendationLongTaskObserver = null;
        try {
            if (typeof PerformanceObserver !== 'undefined') {
                recommendationLongTaskObserver = new PerformanceObserver((list) => {
                    list.getEntries().forEach(entry => {
                        recommendationLongTaskCount += 1;
                        recommendationLongTaskTotalMs += Number(entry.duration) || 0;
                    });
                });
                recommendationLongTaskObserver.observe({ type: 'longtask', buffered: false });
            }
        } catch {
            recommendationLongTaskObserver = null;
        }

        try {
            const fbMgr = (typeof firebaseManager !== 'undefined' && firebaseManager) ? firebaseManager : (typeof window !== 'undefined' && window.firebaseManager ? window.firebaseManager : null);
            if (!filteredRecs) {
                const recService = (fbMgr && typeof fbMgr.getRecommendationService === 'function')
                    ? fbMgr.getRecommendationService()
                    : (this.recommendationService || (typeof RecommendationService !== 'undefined' ? new RecommendationService({
                        tmdbService: fbMgr?.getTMDBService?.(),
                        idMappingService: fbMgr?.getIdMappingService?.()
                    }) : null));

                if (!recService) {
                    state.movieId = movieId;
                    state.status = 'failed';
                    document.getElementById('movieRecommendationsSection')?.remove();
                    return;
                }

                state.movieId = movieId;
                state.status = 'loading';
                this.perf?.mark('md:recommendations-start');
                const recommendationsRequest = this.perf?.requestStart('RECOMMENDATIONS', { purpose: 'recommendations' });
                const rawRecs = await recService.getRecommendationsForMovie(movie, {
                    targetCount: 10,
                    minFallbackThreshold: 6
                });
                this.perf?.requestEnd(recommendationsRequest);
                if (!this.isPageContextCurrent(pageContext)) {
                    if (state.movieId === movieId && state.status === 'loading') state.status = 'idle';
                    return;
                }

                const excludedKpIds = new Set([Number(movie.kinopoiskId), Number(movie.id)]);
                (movie.sequelsAndPrequels || []).forEach(seq => excludedKpIds.add(Number(seq.id || seq.filmId || seq.kinopoiskId)));
                filteredRecs = Array.isArray(rawRecs)
                    ? rawRecs.filter(r => Number(r.kinopoiskId) > 0 && !excludedKpIds.has(Number(r.kinopoiskId)))
                    : [];
                state.data = filteredRecs;
                state.status = 'ready';
            }

            if (!this.isPageContextCurrent(pageContext)) return;
            const sectionEl = document.getElementById('movieRecommendationsSection');
            const carouselEl = document.getElementById('movieRecommendationsCarousel');
            const navEl = document.getElementById('movieRecommendationsNav');

            // UI minimum viable count: 4
            if (filteredRecs.length < 4) {
                state.status = 'failed';
                if (sectionEl) sectionEl.remove();
                return;
            }

            if (carouselEl) {
                if (this.recommendationPosterObserver) {
                    this.recommendationPosterObserver.disconnect();
                    this.recommendationPosterObserver = null;
                }
                carouselEl.replaceChildren();
                const favService = (typeof FavoriteService !== 'undefined' && fbMgr?.getFavoriteService)
                    ? fbMgr.getFavoriteService()
                    : null;
                const currentUser = this.currentUser || fbMgr?.auth?.currentUser || null;

                let bookmarksMap = {};
                if (favService && currentUser?.uid) {
                    try {
                        const recKpIds = filteredRecs.map(r => Number(r.kinopoiskId)).filter(id => id > 0);
                        if (recKpIds.length > 0 && typeof favService.getBookmarksBatch === 'function') {
                            bookmarksMap = (await favService.getBookmarksBatch(currentUser.uid, recKpIds)) || {};
                            if (!this.isPageContextCurrent(pageContext)) return;
                        }
                    } catch (bErr) {
                        console.warn('[MovieDetails] Failed to load bookmarks batch for recommendations:', bErr);
                        bookmarksMap = {};
                    }
                }

                const renderStartedAt = typeof performance !== 'undefined' && typeof performance.now === 'function'
                    ? performance.now()
                    : Date.now();
                const cardFragment = document.createDocumentFragment();
                const deferredPosterImages = [];
                const initialPosterCount = Math.min(4, filteredRecs.length);

                filteredRecs.forEach((rec, index) => {
                    const kpId = Number(rec.kinopoiskId);
                    const deferPoster = index >= initialPosterCount;
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
                            genres: rec.genres || rec.genreIds,
                            mediaType: rec.mediaType,
                            kpRating: rec.kpRating || rec.ratingKp,
                            imdbRating: rec.imdbRating,
                            kpVotes: rec.kpVotes,
                            imdbVotes: rec.imdbVotes
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
                        availableCollections: this.availableCollections,
                        lazyPoster: true,
                        deferPoster
                    });

                    cardFragment.appendChild(card);

                    const posterImage = card.querySelector('.mc-poster');
                    if (posterImage) {
                        if (posterImage.dataset.deferredPosterUrl) {
                            deferredPosterImages.push(posterImage);
                        }
                        let posterMetricsLogged = false;
                        const logPosterMetrics = () => {
                            if (posterMetricsLogged) return;
                            // Deferred cards initially contain the tiny app icon;
                            // only measure the real poster after it is activated.
                            if (posterImage.dataset.deferredPosterUrl) return;
                            posterMetricsLogged = true;
                            const renderedWidth = posterImage.clientWidth || 0;
                            const renderedHeight = posterImage.clientHeight || 0;
                            const naturalWidth = posterImage.naturalWidth || 0;
                            const naturalHeight = posterImage.naturalHeight || 0;
                            const resourceEntry = typeof performance !== 'undefined'
                                && typeof performance.getEntriesByName === 'function'
                                ? performance.getEntriesByName(posterImage.currentSrc || posterImage.src).at(-1)
                                : null;
                            console.info('[RecommendationImageTrace]', {
                                kinopoiskId: kpId,
                                recommendationSource: rec.recommendationSource || 'unknown',
                                posterUrl: rec.posterUrl || null,
                                naturalWidth,
                                naturalHeight,
                                renderedWidth,
                                renderedHeight,
                                widthScale: renderedWidth > 0 ? Number((naturalWidth / renderedWidth).toFixed(2)) : null,
                                heightScale: renderedHeight > 0 ? Number((naturalHeight / renderedHeight).toFixed(2)) : null,
                                resourceDurationMs: resourceEntry?.duration ? Number(resourceEntry.duration.toFixed(2)) : null,
                                transferSize: resourceEntry?.transferSize || null,
                                encodedBodySize: resourceEntry?.encodedBodySize || null,
                                decodedBodySize: resourceEntry?.decodedBodySize || null
                            });
                        };

                        posterImage.addEventListener('load', logPosterMetrics, { once: true });
                        posterImage.addEventListener('error', () => {
                            console.warn('[RecommendationImageTrace] poster-load-failed', {
                                kinopoiskId: kpId,
                                posterUrl: rec.posterUrl || null
                            });
                        }, { once: true });
                        if (posterImage.complete) setTimeout(logPosterMetrics, 0);
                    }
                });

                const appendStartedAt = typeof performance !== 'undefined' && typeof performance.now === 'function'
                    ? performance.now()
                    : Date.now();
                carouselEl.appendChild(cardFragment);
                const appendMs = (typeof performance !== 'undefined' && typeof performance.now === 'function'
                    ? performance.now()
                    : Date.now()) - appendStartedAt;

                // This read intentionally happens once, after the batch append,
                // so layout is not forced for every individual recommendation.
                const layoutStartedAt = typeof performance !== 'undefined' && typeof performance.now === 'function'
                    ? performance.now()
                    : Date.now();
                const hasOverflow = carouselEl.scrollWidth > carouselEl.clientWidth + 10;
                const layoutMs = (typeof performance !== 'undefined' && typeof performance.now === 'function'
                    ? performance.now()
                    : Date.now()) - layoutStartedAt;

                console.info('[RecommendationRenderTrace]', {
                    stage: 'cards-mounted',
                    movieId,
                    cardCount: filteredRecs.length,
                    initialPosterCount,
                    deferredPosterCount: deferredPosterImages.length,
                    availableCollectionsCount: Array.isArray(this.availableCollections) ? this.availableCollections.length : 0,
                    buildMs: Number((appendStartedAt - renderStartedAt).toFixed(2)),
                    appendMs: Number(appendMs.toFixed(2)),
                    layoutMs: Number(layoutMs.toFixed(2)),
                    totalMs: Number(((typeof performance !== 'undefined' && typeof performance.now === 'function'
                        ? performance.now()
                        : Date.now()) - renderStartedAt).toFixed(2)),
                    domNodeCount: carouselEl.querySelectorAll('*').length,
                    hasOverflow
                });

                const activateDeferredPoster = (posterImage) => {
                    const sourceUrl = posterImage?.dataset?.deferredPosterUrl;
                    if (!sourceUrl || posterImage.dataset.posterLoading === 'true') return;

                    posterImage.dataset.posterLoading = 'true';
                    delete posterImage.dataset.deferredPosterUrl;
                    posterImage.src = sourceUrl;
                };

                if (deferredPosterImages.length > 0) {
                    if (typeof IntersectionObserver !== 'undefined') {
                        this.recommendationPosterObserver = new IntersectionObserver((entries) => {
                            entries.forEach(entry => {
                                if (!entry.isIntersecting) return;
                                activateDeferredPoster(entry.target);
                                this.recommendationPosterObserver?.unobserve(entry.target);
                            });
                        // Keep the preload window smaller than a card. A broad margin
                        // made every deferred large Kinopoisk poster decode during
                        // initial paint on short carousels.
                        }, { root: carouselEl, rootMargin: '0px 96px', threshold: 0.01 });
                        deferredPosterImages.forEach(posterImage => this.recommendationPosterObserver.observe(posterImage));
                    } else {
                        deferredPosterImages.forEach((posterImage, index) => {
                            setTimeout(() => activateDeferredPoster(posterImage), index * 80);
                        });
                    }
                }

                // Show navigation buttons if carousel has horizontal overflow
                if (navEl && hasOverflow) {
                    navEl.style.display = 'flex';
                }

            }
        } catch (err) {
            if (!this.isPageContextCurrent(pageContext)) return;
            state.movieId = movieId;
            state.status = 'failed';
            console.warn('[MovieDetails] Failed to load recommendations asynchronously:', err);
            document.getElementById('movieRecommendationsSection')?.remove();
        } finally {
            recommendationLongTaskObserver?.disconnect();
            const traceNow = typeof performance !== 'undefined' && typeof performance.now === 'function'
                ? performance.now()
                : Date.now();
            console.info('[RecommendationRenderTrace]', {
                stage: 'complete',
                movieId,
                totalMs: Number((traceNow - recommendationUiTraceStartedAt).toFixed(2)),
                longTaskCount: recommendationLongTaskCount,
                longTaskTotalMs: Number(recommendationLongTaskTotalMs.toFixed(2))
            });
        }
    }

    /**
     * Resolve cast credits with canonical preference and legacy fallback adapter.
     * @param {Object} movie 
     * @returns {Array<Object>}
     */
    getMovieCast(movie) {
        if (!movie || typeof movie !== 'object') return [];

        // 1. Canonical credits.cast
        if (Array.isArray(movie.credits?.cast) && movie.credits.cast.length > 0) {
            return [...movie.credits.cast]
                .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
                .slice(0, 30);
        }

        // 2. Legacy movie.persons fallback
        if (Array.isArray(movie.persons) && movie.persons.length > 0) {
            const legacyActors = movie.persons
                .filter(p => p && (p.enProfession || '').toUpperCase() === 'ACTOR')
                .filter(p => p.name || p.enName)
                .slice(0, 30);

            if (legacyActors.length > 0) {
                return legacyActors.map((p, idx) => ({
                    id: p.id ? `kp:${p.id}` : `cast:${idx}`,
                    kpPersonId: p.id ? Number(p.id) : null,
                    tmdbPersonId: null,
                    name: (p.name || p.enName || '').trim(),
                    originalName: p.enName ? String(p.enName).trim() : null,
                    photoUrl: p.photo || null,
                    role: 'ACTOR',
                    character: p.description ? String(p.description).trim() : null,
                    job: 'Actor',
                    department: 'Acting',
                    order: idx,
                    providerSource: 'KP'
                }));
            }
        }

        // 3. Legacy movie.tmdbCredits fallback
        if (Array.isArray(movie.tmdbCredits?.cast) && movie.tmdbCredits.cast.length > 0) {
            const validTmdb = movie.tmdbCredits.cast
                .filter(p => p && (p.name || p.original_name || p.originalName))
                .slice(0, 30);

            if (validTmdb.length > 0) {
                return validTmdb.map((p, idx) => ({
                    id: p.id ? `tmdb:${p.id}` : `cast:${idx}`,
                    kpPersonId: null,
                    tmdbPersonId: p.id ? Number(p.id) : null,
                    name: p.name || p.original_name || '',
                    originalName: p.originalName || p.original_name || null,
                    photoUrl: p.photoUrl || (p.profile_path ? `https://image.tmdb.org/t/p/w185${p.profile_path}` : (p.photo || null)),
                    role: 'ACTOR',
                    character: p.character || null,
                    job: 'Actor',
                    department: 'Acting',
                    order: typeof p.order === 'number' ? p.order : idx,
                    providerSource: 'TMDB'
                })).sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
            }
        }

        return [];
    }

    /**
     * Resolve crew credits with canonical preference and legacy fallback adapter.
     * @param {Object} movie 
     * @returns {Array<Object>}
     */
    getMovieCrew(movie) {
        if (!movie || typeof movie !== 'object') return [];

        // 1. Canonical credits.crew
        if (Array.isArray(movie.credits?.crew) && movie.credits.crew.length > 0) {
            return movie.credits.crew.slice(0, 30);
        }

        // 2. Legacy movie.persons fallback
        if (Array.isArray(movie.persons) && movie.persons.length > 0) {
            const canonicalTaxonomyMap = {
                'DIRECTOR': 'DIRECTOR',
                'WRITER': 'WRITER',
                'PRODUCER': 'PRODUCER',
                'COMPOSER': 'COMPOSER',
                'OPERATOR': 'CINEMATOGRAPHY',
                'EDITOR': 'EDITOR',
                'DESIGNER': 'DESIGNER'
            };

            const legacyCrew = movie.persons
                .filter(p => p && (p.enProfession || '').toUpperCase() !== 'ACTOR')
                .filter(p => p.name || p.enName)
                .slice(0, 30);

            if (legacyCrew.length > 0) {
                return legacyCrew.map((p, idx) => {
                    const prof = (p.enProfession || '').toUpperCase();
                    const canonicalRole = canonicalTaxonomyMap[prof] || 'OTHER';
                    return {
                        id: p.id ? `kp:${p.id}` : `crew:${idx}`,
                        kpPersonId: p.id ? Number(p.id) : null,
                        tmdbPersonId: null,
                        name: (p.name || p.enName || '').trim(),
                        originalName: p.enName ? String(p.enName).trim() : null,
                        photoUrl: p.photo || null,
                        role: canonicalRole,
                        character: null,
                        job: p.profession || prof,
                        department: canonicalRole,
                        order: null,
                        providerSource: 'KP'
                    };
                });
            }
        }

        // 3. Legacy movie.tmdbCredits fallback
        if (Array.isArray(movie.tmdbCredits?.crew) && movie.tmdbCredits.crew.length > 0) {
            const mapTmdbRole = (member) => {
                const job = (member.job || '').toLowerCase();
                const dept = (member.department || '').toLowerCase();
                if (job === 'director' || dept === 'directing') return 'DIRECTOR';
                if (job.includes('writer') || job.includes('screenplay') || job.includes('story') || dept === 'writing') return 'WRITER';
                if (job.includes('producer') || job.includes('executive producer') || dept === 'production') return 'PRODUCER';
                if (job.includes('composer') || job.includes('original music') || job.includes('music') || dept === 'sound') return 'COMPOSER';
                if (job.includes('cinematograph') || job.includes('photography') || dept === 'camera') return 'CINEMATOGRAPHY';
                if (job.includes('editor') || dept === 'editing') return 'EDITOR';
                if (job.includes('production design') || job.includes('art direction') || dept === 'art') return 'DESIGNER';
                return 'OTHER';
            };

            const validTmdbCrew = movie.tmdbCredits.crew
                .filter(p => p && (p.name || p.original_name || p.originalName))
                .slice(0, 30);

            if (validTmdbCrew.length > 0) {
                return validTmdbCrew.map((p, idx) => ({
                    id: p.id ? `tmdb:${p.id}` : `crew:${idx}`,
                    kpPersonId: null,
                    tmdbPersonId: p.id ? Number(p.id) : null,
                    name: p.name || p.original_name || '',
                    originalName: p.originalName || p.original_name || null,
                    photoUrl: p.photoUrl || (p.profile_path ? `https://image.tmdb.org/t/p/w185${p.profile_path}` : (p.photo || null)),
                    role: mapTmdbRole(p),
                    character: null,
                    job: p.job || 'Crew',
                    department: p.department || 'Crew',
                    order: null,
                    providerSource: 'TMDB'
                }));
            }
        }

        return [];
    }

    /**
     * Format crew names for a specific canonical role with deduplication and bounded count.
     * @param {Array<Object>} crew 
     * @param {string} role 
     * @param {number} maxCount 
     * @returns {string}
     */
    formatCrewCategory(crew, role, maxCount = 5) {
        if (!Array.isArray(crew) || crew.length === 0) return '';
        const members = crew.filter(c => c && c.role === role && c.name && typeof c.name === 'string' && c.name.trim().length > 0);
        if (members.length === 0) return '';

        const seenKeys = new Set();
        const uniqueMembers = [];

        for (const m of members) {
            const key = m.id || (m.kpPersonId ? `kp:${m.kpPersonId}` : (m.tmdbPersonId ? `tmdb:${m.tmdbPersonId}` : m.name.trim().toLowerCase()));
            if (!seenKeys.has(key)) {
                seenKeys.add(key);
                uniqueMembers.push(m);
            }
        }

        if (uniqueMembers.length === 0) return '';
        const visible = uniqueMembers.slice(0, maxCount);
        const remaining = uniqueMembers.length - visible.length;

        const renderedItems = visible.map(m => {
            const personKey = (typeof m.id === 'string' && /^(tmdb|kp):\d+$/i.test(m.id.trim()))
                ? m.id.trim()
                : (m.kpPersonId && Number(m.kpPersonId) > 0 ? `kp:${m.kpPersonId}` : (m.tmdbPersonId && Number(m.tmdbPersonId) > 0 ? `tmdb:${m.tmdbPersonId}` : null));
            
            const escapedName = this.escapeHtml(m.name.trim());
            if (personKey) {
                return `<a href="../person-details/person-details.html?personKey=${encodeURIComponent(personKey)}" class="crew-link">${escapedName}</a>`;
            }
            return escapedName;
        });

        return renderedItems.join(', ') + (remaining > 0 ? ` +${remaining}` : '');
    }

    /**
     * Render single actor card markup.
     * @param {Object} actor 
     * @returns {string}
     */
    renderActorCard(actor, options = null) {
        if (!actor) return '';
        const photoUrl = actor.photoUrl || actor.photo || '';
        const isEnglish = i18n.currentLocale === 'en';
        const name = (isEnglish && actor.originalName)
            ? actor.originalName
            : (actor.name || actor.originalName || actor.enName || i18n.get('movie_details.actors_tab.unknown'));
        const character = (actor.character || actor.description || '').trim();

        const personKey = (typeof actor.id === 'string' && /^(tmdb|kp):\d+$/i.test(actor.id.trim()))
            ? actor.id.trim()
            : (actor.kpPersonId && Number(actor.kpPersonId) > 0 ? `kp:${actor.kpPersonId}` : (actor.tmdbPersonId && Number(actor.tmdbPersonId) > 0 ? `tmdb:${actor.tmdbPersonId}` : null));

        const isClickable = Boolean(personKey);
        const cardTag = isClickable ? 'a' : 'div';
        const remainingClass = options?.remaining ? ' actor-card--remaining' : '';
        const hiddenAttr = options?.hidden ? ' hidden' : '';
        const linkAttrs = isClickable
            ? `href="../person-details/person-details.html?personKey=${encodeURIComponent(personKey)}" class="actor-card actor-card--link${remainingClass}" aria-label="${this.escapeHtml(name)}"${hiddenAttr}`
            : `class="actor-card${remainingClass}"${hiddenAttr}`;

        return `
            <${cardTag} ${linkAttrs}>
                <div class="actor-photo-container">
                    ${photoUrl ? `
                    <img src="${this.escapeHtml(photoUrl)}" alt="${this.escapeHtml(name)}" class="actor-photo" loading="lazy" decoding="async">
                    ` : `
                    <div class="actor-placeholder">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                            <circle cx="12" cy="7" r="4"></circle>
                        </svg>
                    </div>
                    `}
                </div>
                <div class="actor-info">
                    <div class="actor-name">${this.escapeHtml(name)}</div>
                    ${character ? `<div class="actor-character" title="${this.escapeHtml(character)}">${this.escapeHtml(character)}</div>` : ''}
                </div>
            </${cardTag}>
        `;
    }

    /**
     * Render entire actors tab content with 16-card initial view and expandable remaining cards.
     * @param {Array<Object>} cast 
     * @returns {string}
     */
    renderActorsTab(cast) {
        if (!Array.isArray(cast) || cast.length === 0) {
            return `<div class="no-data-placeholder"><p>${i18n.get('movie_details.actors_tab.no_data')}</p></div>`;
        }

        const boundedCast = cast.slice(0, 30);

        return `
            <div class="actors-tab-wrapper">
                <div class="actors-grid" id="actorsGrid">
                    ${boundedCast.map(actor => this.renderActorCard(actor)).join('')}
                </div>
                <div class="actors-expand-container">
                    <button type="button" class="btn-show-more-actors" data-action="toggle-actors" aria-expanded="false" aria-controls="actorsGrid">
                        Показать ещё
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * Read the number of columns produced by the CSS grid.
     * CSS remains the responsive layout authority; this only adapts visibility.
     * @param {HTMLElement} grid
     * @returns {number}
     */
    getActorsGridColumnCount(grid) {
        if (!grid || typeof getComputedStyle !== 'function') return 1;
        const template = getComputedStyle(grid).gridTemplateColumns || '';
        const columnCount = template.split(/\s+/).filter(Boolean).length;
        return Math.max(1, columnCount);
    }

    /**
     * Apply three complete rows while collapsed, or reveal every card when expanded.
     * @param {HTMLElement} grid
     * @param {boolean} expanded
     */
    applyActorsGridVisibility(grid, expanded = false) {
        if (!grid) return;

        const cards = Array.from(grid.querySelectorAll(':scope > .actor-card'));
        const columnCount = this.getActorsGridColumnCount(grid);
        const initialVisibleCount = Math.min(cards.length, columnCount * 3);
        const hiddenCount = expanded ? 0 : Math.max(0, cards.length - initialVisibleCount);

        grid.dataset.initialVisibleCount = String(initialVisibleCount);
        grid.dataset.expanded = String(expanded);
        cards.forEach((card, index) => {
            card.hidden = !expanded && index >= initialVisibleCount;
        });

        const wrapper = grid.closest('.actors-tab-wrapper');
        const button = wrapper?.querySelector('[data-action="toggle-actors"]');
        const expandContainer = button?.closest('.actors-expand-container');
        if (button) {
            button.setAttribute('aria-expanded', String(expanded));
            button.removeAttribute('data-remaining-count');
            button.textContent = expanded ? 'Скрыть' : `Показать ещё ${hiddenCount}`;
        }
        if (expandContainer) {
            expandContainer.hidden = hiddenCount === 0;
        }
    }

    disconnectActorsGridObserver() {
        if (this.actorsGridResizeObserver) {
            this.actorsGridResizeObserver.disconnect();
            this.actorsGridResizeObserver = null;
        }
    }

    setupActorsGridVisibility() {
        this.disconnectActorsGridObserver();
        const grid = document.getElementById('actorsGrid');
        if (!grid) return;

        const button = grid.closest('.actors-tab-wrapper')?.querySelector('[data-action="toggle-actors"]');
        const applyCurrentState = () => {
            if (!grid.isConnected) return;
            const expanded = button?.getAttribute('aria-expanded') === 'true';
            this.applyActorsGridVisibility(grid, expanded);
        };

        applyCurrentState();

        if (typeof ResizeObserver === 'function') {
            this.actorsGridResizeObserver = new ResizeObserver(() => {
                if (button?.getAttribute('aria-expanded') !== 'true') {
                    applyCurrentState();
                }
            });
            this.actorsGridResizeObserver.observe(grid);
        }
    }

    groupAwardsForDisplay(awards) {
        const groups = new Map();

        (Array.isArray(awards) ? awards : []).forEach((award, index) => {
            const name = String(award?.name || '').trim();
            const year = award?.year ?? '';
            const key = `${name}\u0000${year}`;
            let group = groups.get(key);

            if (!group) {
                group = {
                    name,
                    year,
                    wins: 0,
                    nominations: 0,
                    items: [],
                    firstIndex: index
                };
                groups.set(key, group);
            }

            group.items.push(award);
            if (award?.win === true) group.wins += 1;
            else group.nominations += 1;
        });

        return Array.from(groups.values()).sort((a, b) => {
            const aYear = Number(a.year);
            const bYear = Number(b.year);
            const aHasYear = Number.isFinite(aYear);
            const bHasYear = Number.isFinite(bYear);

            if (aHasYear !== bHasYear) return aHasYear ? -1 : 1;
            if (aHasYear && aYear !== bYear) return bYear - aYear;

            const nameOrder = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
            return nameOrder || a.firstIndex - b.firstIndex;
        });
    }

    renderAwardsTab(awards) {
        if (!awards || awards.length === 0) {
            return `<div class="no-data-placeholder"><p>${i18n.get('movie_details.awards_tab.no_data')}</p></div>`;
        }

        const groups = this.groupAwardsForDisplay(awards);
        const visibleGroups = [];
        let visibleAwardCount = 0;
        for (const group of groups) {
            if (visibleAwardCount >= 6) break;
            visibleGroups.push(group);
            visibleAwardCount += group.items.length;
        }
        const hiddenGroups = groups.slice(visibleGroups.length);
        const hasMoreThan6 = hiddenGroups.length > 0;

        const getAwardIcon = (name) => {
            if (name.includes('Оскар')) return '<img src="/src/shared/assets/icons/awards/oscar.png" alt="Oscar" class="award-icon-img">';
            if (name.includes('Золотой глобус')) return '<img src="/src/shared/assets/icons/awards/golden-globe.png" alt="Golden Globe" class="award-icon-img">';
            return '';
        };

        const renderAwardGroup = (group) => `
            <section class="award-group" aria-label="${this.escapeHtml(`${group.name}${group.year ? ` ${group.year}` : ''}`)}">
                <header class="award-group-header">
                    <div class="award-icon-container">${getAwardIcon(group.name)}</div>
                    <div class="award-group-heading">
                        <h3 class="award-group-title">${this.escapeHtml(group.name || i18n.get('movie_details.awards_tab.nomination'))}${group.year ? ` <span class="award-group-year">· ${this.escapeHtml(group.year)}</span>` : ''}</h3>
                        <div class="award-group-summary">
                            ${group.wins > 0 ? `${group.wins} ${this.escapeHtml(i18n.get('movie_details.awards_tab.winner'))}` : ''}${group.wins > 0 && group.nominations > 0 ? ' · ' : ''}${group.nominations > 0 ? `${group.nominations} ${this.escapeHtml(i18n.get('movie_details.awards_tab.nominee'))}` : ''}
                        </div>
                    </div>
                </header>
                <div class="award-rows">
                    ${group.items.map((award) => `
                        <div class="award-row">
                            <span class="award-nomination">${this.escapeHtml(award.nominationName || i18n.get('movie_details.awards_tab.nomination'))}</span>
                            <span class="award-badge ${award.win === true ? 'winner' : 'nominee'}">${award.win === true ? i18n.get('movie_details.awards_tab.winner') : i18n.get('movie_details.awards_tab.nominee')}</span>
                        </div>
                    `).join('')}
                </div>
            </section>
        `;

        return `
            <div class="awards-grid">${visibleGroups.map(renderAwardGroup).join('')}</div>
            ${hasMoreThan6 ? `
                <div class="awards-grid awards-grid-hidden" style="display: none;">${hiddenGroups.map(renderAwardGroup).join('')}</div>
                <button class="btn-show-all-awards">${i18n.get('movie_details.awards_tab.show_all').replace('{count}', awards.length)}</button>
            ` : ''}
        `;
    }

    createMovieFramesSection(movie) {
        const frameSource = Array.isArray(movie.frames) ? movie.frames :
            (Array.isArray(movie.images) ? movie.images : []);
        // TMDB contributes one backdrop URL, while this UI expects a frame array.
        // Treat it as a single frame instead of calling Array.prototype.map on a string.
        let frames = frameSource.length > 0 ? frameSource :
            (typeof movie.backdrop === 'string' && movie.backdrop ? [{ url: movie.backdrop, type: 'backdrop' }] : []);
        if (!frames.length && movie.posterUrl) {
            frames = [{ url: movie.posterUrl, type: 'poster' }];
        }
        if (!frames.length) return '';

        const displayFrames = frames.slice(0, 6);
        movie.displayFrames = displayFrames;

        const framesHTML = displayFrames.map((frame, index) => {
            const frameUrl = typeof frame === 'string' ? frame : (frame.url || frame.previewUrl || '');
            if (!frameUrl) return '';
            return `<div class="movie-frame" data-frame-url="${this.escapeHtml(frameUrl)}" data-frame-index="${index}"><img src="${this.escapeHtml(frameUrl)}" alt="Кадр" class="movie-frame-image" loading="lazy" decoding="async" data-fallback="frame"></div>`;
        }).join('');

        return framesHTML ? `<div class="movie-frames-section"><h4>${i18n.get('movie_details.frames')}</h4><div class="movie-frames-grid">${framesHTML}</div></div>` : '';
    }

    translateVideoType(type) {
        if (!type || typeof type !== 'string') return 'Видео';
        const map = {
            'trailer': 'Трейлер',
            'teaser': 'Тизер',
            'clip': 'Клип',
            'featurette': 'Фрагмент',
            'behind the scenes': 'О съемках',
            'bloopers': 'Неудачные дубли'
        };
        return map[type.trim().toLowerCase()] || type;
    }

    /**
     * Pure sorting and ranking function for videos.
     * Tier 1: Official Trailer
     * Tier 2: Official Teaser
     * Tier 3: Non-official Trailer
     * Tier 4: Non-official Teaser
     * Tier 5: Other videos
     * Inside tiers: Preferred language (ru) -> English (en) -> recency.
     * @param {Array<Object>} videos 
     * @param {string} preferredLanguage 
     * @returns {Array<Object>}
     */
    rankVideos(videos, preferredLanguage = 'ru') {
        if (!Array.isArray(videos) || videos.length === 0) return [];
        const prefLang = (preferredLanguage || 'ru').toLowerCase();
        
        const getVideoScore = (v) => {
            if (!v) return -1;
            const type = (v.type || '').toLowerCase().trim();
            const isOfficial = Boolean(v.official);
            const lang = (v.language || v.iso_639_1 || '').toLowerCase().trim();
            
            let typeScore = 10;
            if (type === 'trailer') {
                typeScore = isOfficial ? 1000 : 600;
            } else if (type === 'teaser') {
                typeScore = isOfficial ? 800 : 400;
            } else if (type === 'clip') {
                typeScore = 200;
            } else if (type === 'featurette') {
                typeScore = 100;
            } else if (type === 'behind the scenes') {
                typeScore = 50;
            }
            
            let langScore = 0;
            if (lang === prefLang) {
                langScore = 50;
            } else if (lang === 'en') {
                langScore = 10;
            }
            
            return typeScore + langScore;
        };
        
        return [...videos]
            .filter(v => v && ((v.provider || v.site || '').toLowerCase() === 'youtube' ? Boolean(v.key && String(v.key).trim()) : Boolean(v.videoUrl)))
            .sort((a, b) => {
                const scoreDiff = getVideoScore(b) - getVideoScore(a);
                if (scoreDiff !== 0) return scoreDiff;
                const dateA = a.publishedAt || a.published_at ? new Date(a.publishedAt || a.published_at).getTime() : 0;
                const dateB = b.publishedAt || b.published_at ? new Date(b.publishedAt || b.published_at).getTime() : 0;
                return dateB - dateA;
            });
    }

    /**
     * Deterministic pure selector for primary trailer.
     * @param {Array<Object>} videos 
     * @param {string} preferredLanguage 
     * @returns {Object|null}
     */
    selectPrimaryTrailer(videos, preferredLanguage = 'ru') {
        if (!Array.isArray(videos) || videos.length === 0) return null;
        const ranked = this.rankVideos(videos, preferredLanguage);
        if (ranked.length === 0) return null;
        
        // Find best trailer or teaser first
        const candidate = ranked.find(v => {
            const type = (v.type || '').toLowerCase().trim();
            return type === 'trailer' || type === 'teaser';
        }) || ranked[0];
        
        if (!candidate) return null;
        
        return {
            provider: candidate.provider || candidate.site || 'YouTube',
            key: candidate.key ? String(candidate.key).trim() : null,
            name: String(candidate.name || candidate.title || 'Трейлер').trim(),
            type: String(candidate.type || 'Trailer').trim(),
            official: Boolean(candidate.official),
            language: candidate.language || candidate.iso_639_1 || null,
            posterUrl: candidate.posterUrl || null,
            duration: candidate.duration || '',
            videoUrl: candidate.videoUrl || null
        };
    }

    /**
     * Resolve primary trailer and its source synchronously from movie DTO following source hierarchy:
     * 1. TMDB Structured Videos (movie.videos) -> 'TMDB_STRUCTURED'
     * 2. KP / Legacy Structured Trailers (movie.trailers / movie.trailer) -> 'KP_STRUCTURED'
     * Returns { trailer: Object, source: string } or null if scraper fallback is needed.
     * @param {Object} movie 
     * @param {string} [preferredLanguage='ru']
     * @returns {{ trailer: Object, source: string }|null}
     */
    resolvePrimaryTrailer(movie, preferredLanguage = 'ru') {
        if (!movie) return null;
        
        // 1. TMDB Structured Videos Priority
        if (Array.isArray(movie.videos) && movie.videos.length > 0) {
            const primaryTrailer = this.selectPrimaryTrailer(movie.videos, preferredLanguage);
            if (primaryTrailer) {
                return { trailer: primaryTrailer, source: 'TMDB_STRUCTURED' };
            }
        }
        
        // 2. KP / Legacy Structured Trailers Priority
        if (Array.isArray(movie.trailers) && movie.trailers.length > 0) {
            const kpTrailer = this.selectPrimaryTrailer(movie.trailers, preferredLanguage);
            if (kpTrailer) {
                return { trailer: kpTrailer, source: 'KP_STRUCTURED' };
            }
        } else if (movie.trailer && (movie.trailer.videoUrl || movie.trailer.key)) {
            return { trailer: movie.trailer, source: 'KP_STRUCTURED' };
        }
        
        return null;
    }

    /**
     * Resolve and render primary trailer following source hierarchy:
     * 1. TMDB Structured Videos (movie.videos)
     * 2. KP / Legacy Structured Trailers (movie.trailers / movie.trailer)
     * 3. Scraper Fallback (TrailerParsingService)
     * @param {Object} movie 
     */
    resolveAndRenderTrailer(movie) {
        if (!movie) return;
        const pageContext = this.capturePageContext(movie);
        const isSeries = Boolean(movie.isSeries || (movie.type && ['tv-series', 'mini-series', 'animated-series', 'tv'].includes(movie.type)));
        
        const primaryTrailerResult = this.resolvePrimaryTrailer(movie);
        if (primaryTrailerResult) {
            console.log(`[MovieDetails] Trailer source: ${primaryTrailerResult.source}`);
            this.renderTrailerBlock(primaryTrailerResult.trailer, primaryTrailerResult.source);
            return;
        }
        
        // 3. Scraper Fallback
        this.loadTrailerFallback(movie.kinopoiskId, isSeries, pageContext);
    }

    renderVideosSection(videos, excludeKey = null) {
        if (!Array.isArray(videos) || videos.length === 0) return '';
        const rankedVideos = this.rankVideos(videos);
        const youtubeVideos = rankedVideos.filter(v => v && (v.provider || v.site || '').toLowerCase() === 'youtube' && v.key && String(v.key).trim().length > 0);
        if (youtubeVideos.length === 0) return '';
        
        // Deduplicate by key and filter out excludeKey if provided
        const seenKeys = new Set();
        const uniqueVideos = [];
        const normalizedExclude = excludeKey ? String(excludeKey).trim() : null;

        for (const v of youtubeVideos) {
            const key = String(v.key).trim();
            if (normalizedExclude && key === normalizedExclude) continue;
            if (!seenKeys.has(key)) {
                seenKeys.add(key);
                uniqueVideos.push(v);
            }
        }

        const displayVideos = uniqueVideos.slice(0, 6);
        if (displayVideos.length === 0) return '';

        return `
            <div class="movie-videos-section">
                <h4>Трейлеры и видео</h4>
                <div class="movie-videos-grid">
                    ${displayVideos.map(video => `
                        <div class="movie-video-card" data-video-key="${this.escapeHtml(video.key)}" data-video-name="${this.escapeHtml(video.name || 'Видео')}">
                            <div class="movie-video-thumb-container">
                                <img src="https://i.ytimg.com/vi/${encodeURIComponent(video.key)}/hqdefault.jpg" 
                                     alt="${this.escapeHtml(video.name || 'Видео')}" 
                                     class="movie-video-thumb" 
                                     loading="lazy" 
                                     decoding="async" 
                                     data-fallback="youtube-thumb" 
                                     data-key="${encodeURIComponent(video.key)}">
                                <div class="movie-video-play-badge" aria-hidden="true">
                                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                                </div>
                                <div class="movie-video-badges">
                                    ${video.official ? '<span class="movie-video-badge badge-official">Официальный</span>' : ''}
                                    <span class="movie-video-badge badge-type">${this.escapeHtml(this.translateVideoType(video.type))}</span>
                                </div>
                            </div>
                            <div class="movie-video-info">
                                <span class="movie-video-title" title="${this.escapeHtml(video.name || '')}">${this.escapeHtml(video.name || '')}</span>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    /**
     * Returns a display label and CSS class for the hero media-type badge.
     * @param {Object} movie - UnifiedMovieDTO
     * @returns {{ label: string, class: string }}
     */
    getMediaTypeBadge(movie) {
        const type = (movie && movie.type) ? String(movie.type).toLowerCase() : '';
        if (type === 'tv-series' || type === 'mini-series' || type === 'tv') {
            return { label: 'Сериал', class: 'series' };
        }
        if (type === 'animated-series' || type === 'cartoon-series') {
            return { label: 'Мультсериал', class: 'cartoon-series' };
        }
        if (type === 'anime') {
            return { label: 'Аниме', class: 'anime' };
        }
        if (type === 'cartoon') {
            return { label: 'Мультфильм', class: 'cartoon' };
        }
        if (type === 'documentary') {
            return { label: 'Документальный', class: 'documentary' };
        }
        // default: film
        return { label: 'Фильм', class: 'film' };
    }

    /**
     * Helper to clean franchise / collection name for display.
     * @param {string} rawName
     * @returns {string}
     */
    cleanFranchiseName(rawName) {
        if (!rawName || typeof rawName !== 'string') return '';
        if (typeof FranchiseService !== 'undefined' && FranchiseService.cleanCollectionName) {
            return FranchiseService.cleanCollectionName(rawName);
        }
        return rawName.replace(/\s*[([]?(?:Коллекция|коллекция|КОЛЛЕКЦИЯ|Collection|collection|COLLECTION)[)\]]?\s*$/i, '').trim();
    }

    /**
     * Render initial skeleton placeholder for Franchise section.
     * @param {Object} movie
     * @returns {string}
     */
    renderFranchiseSectionPlaceholder(movie) {
        if (!movie?.collection || !movie.collection.tmdbId) {
            this.logFranchiseDebug('F_PLACEHOLDER', {
                decision: 'skip-no-collection',
                kinopoiskId: movie?.kinopoiskId || movie?.id || null,
                tmdbId: movie?.tmdbId || movie?.identity?.tmdbId || movie?.externalId?.tmdb || null,
                collection: movie?.collection || null
            });
            return '';
        }
        const collection = movie.collection;
        const rawName = typeof collection.name === 'string' ? collection.name.trim() : '';
        if (!rawName) {
            this.logFranchiseDebug('F_PLACEHOLDER', {
                decision: 'skip-empty-collection-name',
                collection
            });
            return '';
        }

        const cleanTitle = this.cleanFranchiseName(rawName) || rawName;
        this.logFranchiseDebug('F_PLACEHOLDER', {
            decision: 'render',
            collectionId: collection.tmdbId,
            collectionName: rawName
        });

        return `
            <div class="movie-franchise-section" id="movieFranchiseSection" data-collection-id="${collection.tmdbId}">
                <div class="movie-franchise-header">
                    <div class="movie-franchise-title-group">
                        <span class="movie-franchise-label">Франшиза</span>
                        <h3 class="movie-franchise-title">${this.escapeHtml(cleanTitle)}</h3>
                    </div>
                    <div class="movie-franchise-nav" id="movieFranchiseNav" style="display: none;">
                        <button type="button" class="movie-carousel-btn movie-carousel-btn--prev" data-action="scroll-franchise-prev" aria-label="Предыдущие">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                        </button>
                        <button type="button" class="movie-carousel-btn movie-carousel-btn--next" data-action="scroll-franchise-next" aria-label="Следующие">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                        </button>
                    </div>
                </div>
                <div class="movie-franchise-carousel" id="movieFranchiseCarousel" tabindex="0" role="region" aria-label="Франшиза ${this.escapeHtml(cleanTitle)}">
                    ${this.renderFranchiseSkeletons(4)}
                </div>
            </div>
        `;
    }

    /**
     * Render compact skeleton cards for franchise carousel.
     * @param {number} [count=4]
     * @returns {string}
     */
    /**
     * Resolve and render primary trailer following source hierarchy:
     * 1. TMDB Structured Videos (movie.videos)
     * 2. KP / Legacy Structured Trailers (movie.trailers / movie.trailer)
     * 3. Scraper Fallback (TrailerParsingService)
     * @param {Object} movie 
     */
    legacyResolveAndRenderTrailer(movie) {
        if (!movie) return;
        const isSeries = Boolean(movie.isSeries || (movie.type && ['tv-series', 'mini-series', 'animated-series', 'tv'].includes(movie.type)));
        
        const primaryTrailerResult = this.resolvePrimaryTrailer(movie);
        if (primaryTrailerResult) {
            console.log(`[MovieDetails] Trailer source: ${primaryTrailerResult.source}`);
            this.renderTrailerBlock(primaryTrailerResult.trailer, primaryTrailerResult.source);
            return;
        }
        
        // 3. Scraper Fallback
        this.loadTrailerFallback(movie.kinopoiskId, isSeries, pageContext);
    }

    legacyRenderVideosSection(videos, excludeKey = null) {
        if (!Array.isArray(videos) || videos.length === 0) return '';
        const rankedVideos = this.rankVideos(videos);
        const youtubeVideos = rankedVideos.filter(v => v && (v.provider || v.site || '').toLowerCase() === 'youtube' && v.key && String(v.key).trim().length > 0);
        if (youtubeVideos.length === 0) return '';
        
        // Deduplicate by key and filter out excludeKey if provided
        const seenKeys = new Set();
        const uniqueVideos = [];
        const normalizedExclude = excludeKey ? String(excludeKey).trim() : null;

        for (const v of youtubeVideos) {
            const key = String(v.key).trim();
            if (normalizedExclude && key === normalizedExclude) continue;
            if (!seenKeys.has(key)) {
                seenKeys.add(key);
                uniqueVideos.push(v);
            }
        }

        const displayVideos = uniqueVideos.slice(0, 6);
        if (displayVideos.length === 0) return '';

        return `
            <div class="movie-videos-section">
                <h4>Трейлеры и видео</h4>
                <div class="movie-videos-grid">
                    ${displayVideos.map(video => `
                        <div class="movie-video-card" data-video-key="${this.escapeHtml(video.key)}" data-video-name="${this.escapeHtml(video.name || 'Видео')}">
                            <div class="movie-video-thumb-container">
                                <img src="https://i.ytimg.com/vi/${encodeURIComponent(video.key)}/hqdefault.jpg" 
                                     alt="${this.escapeHtml(video.name || 'Видео')}" 
                                     class="movie-video-thumb" 
                                     loading="lazy" 
                                     decoding="async" 
                                     data-fallback="youtube-thumb" 
                                     data-key="${encodeURIComponent(video.key)}">
                                <div class="movie-video-play-badge" aria-hidden="true">
                                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                                </div>
                                <div class="movie-video-badges">
                                    ${video.official ? '<span class="movie-video-badge badge-official">Официальный</span>' : ''}
                                    <span class="movie-video-badge badge-type">${this.escapeHtml(this.translateVideoType(video.type))}</span>
                                </div>
                            </div>
                            <div class="movie-video-info">
                                <span class="movie-video-title" title="${this.escapeHtml(video.name || '')}">${this.escapeHtml(video.name || '')}</span>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    legacyRenderProductionCompanies(companies) {
        if (!Array.isArray(companies) || companies.length === 0) return '';
        const valid = companies.filter(c => c && c.name && typeof c.name === 'string' && c.name.trim().length > 0);
        if (valid.length === 0) return '';
        
        const visible = valid.slice(0, 6);
        const remaining = valid.length - 6;

        return `
            <div class="production-companies-list">
                ${visible.map(c => `
                    <span class="production-company-pill" title="${this.escapeHtml(c.name)}${c.originCountry ? ` (${this.escapeHtml(c.originCountry)})` : ''}">
                        ${c.logoUrl ? `<img src="${this.escapeHtml(c.logoUrl)}" alt="${this.escapeHtml(c.name)}" class="production-company-logo" data-fallback="company-logo" loading="lazy" decoding="async">` : ''}
                        <span class="production-company-name">${this.escapeHtml(c.name)}</span>
                    </span>
                `).join('')}
                ${remaining > 0 ? `<span class="production-company-more">+${remaining}</span>` : ''}
            </div>
        `;
    }

    legacyRenderCriticRatings(criticRatings) {
        if (!criticRatings || typeof criticRatings !== 'object') return '';
        const items = [];
        if (criticRatings.international && Number(criticRatings.international.rating) > 0) {
            const r = parseFloat(Number(criticRatings.international.rating).toFixed(1));
            const v = Number(criticRatings.international.votes) || 0;
            items.push(`Мировые: <strong class="critic-score">${r}%</strong>${v > 0 ? ` <span class="critic-votes">(${v})</span>` : ''}`);
        }
        if (criticRatings.russian && Number(criticRatings.russian.rating) > 0) {
            const r = parseFloat(Number(criticRatings.russian.rating).toFixed(1));
            const v = Number(criticRatings.russian.votes) || 0;
            items.push(`Российские: <strong class="critic-score">${r}%</strong>${v > 0 ? ` <span class="critic-votes">(${v})</span>` : ''}`);
        }
        if (items.length === 0) return '';
        return items.join(' • ');
    }

    /**
     * Returns a display label and CSS class for the hero media-type badge.
     * @param {Object} movie - UnifiedMovieDTO
     * @returns {{ label: string, class: string }}
     */
    legacyGetMediaTypeBadge(movie) {
        const type = (movie && movie.type) ? String(movie.type).toLowerCase() : '';
        if (type === 'tv-series' || type === 'mini-series' || type === 'tv') {
            return { label: 'Сериал', class: 'series' };
        }
        if (type === 'animated-series' || type === 'cartoon-series') {
            return { label: 'Мультсериал', class: 'cartoon-series' };
        }
        if (type === 'anime') {
            return { label: 'Аниме', class: 'anime' };
        }
        if (type === 'cartoon') {
            return { label: 'Мультфильм', class: 'cartoon' };
        }
        if (type === 'documentary') {
            return { label: 'Документальный', class: 'documentary' };
        }
        // default: film
        return { label: 'Фильм', class: 'film' };
    }

    /**
     * Helper to clean franchise / collection name for display.
     * @param {string} rawName
     * @returns {string}
     */
    legacyCleanFranchiseName(rawName) {
        if (!rawName || typeof rawName !== 'string') return '';
        if (typeof FranchiseService !== 'undefined' && FranchiseService.cleanCollectionName) {
            return FranchiseService.cleanCollectionName(rawName);
        }
        return rawName.replace(/\s*[([]?(?:Коллекция|коллекция|КОЛЛЕКЦИЯ|Collection|collection|COLLECTION)[)\]]?\s*$/i, '').trim();
    }

    isFranchiseDebugEnabled() {
        if (typeof window === 'undefined' || !window.location || typeof URLSearchParams === 'undefined') return false;
        return new URLSearchParams(window.location.search).get('franchiseDebug') === '1';
    }

    logFranchiseDebug(marker, details) {
        if (this.isFranchiseDebugEnabled()) {
            console.log(`[FranchiseDiag:${marker}]`, details);
        }
    }

    /**
     * Render initial skeleton placeholder for Franchise section.
     * @param {Object} movie
     * @returns {string}
     */
    legacyRenderFranchiseSectionPlaceholder(movie) {
        if (!movie?.collection || !movie.collection.tmdbId) return '';
        const collection = movie.collection;
        const rawName = typeof collection.name === 'string' ? collection.name.trim() : '';
        if (!rawName) return '';

        const cleanTitle = this.cleanFranchiseName(rawName) || rawName;

        return `
            <div class="movie-franchise-section" id="movieFranchiseSection" data-collection-id="${collection.tmdbId}">
                <div class="movie-franchise-header">
                    <div class="movie-franchise-title-group">
                        <span class="movie-franchise-label">Франшиза</span>
                        <h3 class="movie-franchise-title">${this.escapeHtml(cleanTitle)}</h3>
                    </div>
                    <div class="movie-franchise-nav" id="movieFranchiseNav" style="display: none;">
                        <button type="button" class="movie-carousel-btn movie-carousel-btn--prev" data-action="scroll-franchise-prev" aria-label="Предыдущие">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                        </button>
                        <button type="button" class="movie-carousel-btn movie-carousel-btn--next" data-action="scroll-franchise-next" aria-label="Следующие">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                        </button>
                    </div>
                </div>
                <div class="movie-franchise-carousel" id="movieFranchiseCarousel" tabindex="0" role="region" aria-label="Франшиза ${this.escapeHtml(cleanTitle)}">
                    ${this.renderFranchiseSkeletons(4)}
                </div>
            </div>
        `;
    }

    /**
     * Render compact skeleton cards for franchise carousel.
     * @param {number} [count=4]
     * @returns {string}
     */
    renderFranchiseSkeletons(count = 4) {
        let html = '';
        for (let i = 0; i < count; i++) {
            html += `
                <div class="franchise-skeleton-card" aria-hidden="true">
                    <div class="franchise-skeleton-poster"></div>
                    <div class="franchise-skeleton-title"></div>
                    <div class="franchise-skeleton-meta"></div>
                </div>
            `;
        }
        return html;
    }

    /**
     * Observe franchise section or trigger deferred async load.
     * @param {Object} movie
     */
    observeOrLoadFranchise(movie) {
        if (!movie?.collection?.tmdbId) {
            this.logFranchiseDebug('G_OBSERVE', { decision: 'skip-no-collection' });
            return;
        }
        const sectionEl = document.getElementById('movieFranchiseSection');
        if (!sectionEl) {
            this.logFranchiseDebug('G_OBSERVE', {
                decision: 'skip-section-missing',
                collectionId: movie.collection.tmdbId
            });
            return;
        }

        this.logFranchiseDebug('G_OBSERVE', {
            decision: 'observe',
            collectionId: movie.collection.tmdbId
        });

        if (typeof IntersectionObserver !== 'undefined') {
            if (this.franchiseObserver) {
                this.franchiseObserver.disconnect();
            }
            this.franchiseObserver = new IntersectionObserver((entries) => {
                const entry = entries[0];
                if (entry && entry.isIntersecting) {
                    this.franchiseObserver.disconnect();
                    this.franchiseObserver = null;
                    this.loadFranchiseAsync(movie);
                }
            }, { rootMargin: '300px' });
            this.franchiseObserver.observe(sectionEl);
        } else {
            setTimeout(() => this.loadFranchiseAsync(movie), 50);
        }
    }

    /**
     * Asynchronously fetch and render franchise collection in MovieDetails.
     * @param {Object} movie
     */
    async loadFranchiseAsync(movie) {
        if (!movie?.collection?.tmdbId) {
            this.logFranchiseDebug('H_LOAD', { decision: 'skip-no-collection' });
            return;
        }
        const movieId = String(movie.kinopoiskId || movie.id);
        const collectionId = Number(movie.collection.tmdbId);
        if (!collectionId) {
            this.logFranchiseDebug('H_LOAD', { decision: 'skip-invalid-collection-id', collection: movie.collection });
            return;
        }
        this.logFranchiseDebug('H_LOAD', { decision: 'start', collectionId, kinopoiskId: movieId });
        const pageContext = this.capturePageContext(movie);
        const state = this.franchiseState || (this.franchiseState = { movieId: null, status: 'idle', data: null });
        if (state.movieId === movieId && state.status === 'failed') {
            document.getElementById('movieFranchiseSection')?.remove();
            return;
        }
        if (state.movieId === movieId && state.status === 'loading') return;

        const retainedParts = state.movieId === movieId && state.status === 'ready'
            ? this.deduplicateRelatedContent(state.data)
            : null;
        const retainedDataIsComplete = Array.isArray(retainedParts)
            && retainedParts.length > 0
            && retainedParts.every(part => Number(part?.kinopoiskId) > 0);
        // A ready same-movie state may predate mapping self-healing. Do not
        // render that stale snapshot or let it bypass FranchiseService.
        let franchiseParts = retainedDataIsComplete ? retainedParts : null;
        if (!franchiseParts && state.movieId === movieId && state.status === 'ready') {
            state.status = 'idle';
            state.data = null;
        }

        try {
            const fbMgr = (typeof firebaseManager !== 'undefined' && firebaseManager) ? firebaseManager : (typeof window !== 'undefined' && window.firebaseManager ? window.firebaseManager : null);
            if (!franchiseParts) {
                const franchiseService = (fbMgr && typeof fbMgr.getFranchiseService === 'function')
                    ? fbMgr.getFranchiseService()
                    : (this.franchiseService || (typeof FranchiseService !== 'undefined' ? new FranchiseService({
                        tmdbService: fbMgr?.getTMDBService?.(),
                        idMappingService: fbMgr?.getIdMappingService?.(),
                        kinopoiskService: fbMgr?.getKinopoiskService?.()
                    }) : null));

                if (!franchiseService) {
                    state.movieId = movieId;
                    state.status = 'failed';
                    document.getElementById('movieFranchiseSection')?.remove();
                    return;
                }

                state.movieId = movieId;
                state.status = 'loading';
                this.perf?.mark('md:franchise-start');
                const franchiseRequest = this.perf?.requestStart('FRANCHISE', { purpose: 'franchise' });
                const franchise = await franchiseService.getFranchise(collectionId);
                this.perf?.requestEnd(franchiseRequest);
                if (!this.isPageContextCurrent(pageContext)) {
                    if (state.movieId === movieId && state.status === 'loading') state.status = 'idle';
                    return;
                }
                franchiseParts = this.deduplicateRelatedContent(franchise?.parts);
                state.data = franchiseParts;
                state.status = 'ready';
            }

            if (!this.isPageContextCurrent(pageContext)) return;
            const sectionEl = document.getElementById('movieFranchiseSection');
            const carouselEl = document.getElementById('movieFranchiseCarousel');
            const navEl = document.getElementById('movieFranchiseNav');
            if (franchiseParts.length < 2) {
                state.status = 'failed';
                // Remove section if empty or only 1 single part
                if (sectionEl) sectionEl.remove();
                return;
            }

            if (carouselEl) {
                carouselEl.innerHTML = '';

                // Update section header movie count if available
                const titleGroup = sectionEl.querySelector('.movie-franchise-title-group');
                if (titleGroup && !titleGroup.querySelector('.movie-franchise-count')) {
                    const countSpan = document.createElement('span');
                    countSpan.className = 'movie-franchise-count';
                    countSpan.textContent = `· ${franchiseParts.length} фильмов`;
                    titleGroup.appendChild(countSpan);
                }

                franchiseParts.forEach(part => {
                    const isCurrentMovie = (movie.tmdbId && Number(part.tmdbId) === Number(movie.tmdbId)) ||
                        (movie.kinopoiskId && part.kinopoiskId && Number(part.kinopoiskId) === Number(movie.kinopoiskId));
                    const hasKpId = Boolean(part.kinopoiskId && Number(part.kinopoiskId) > 0);
                    const posterUrl = part.posterUrl || '/src/shared/assets/icons/app/icon48.png';
                    const yearDisplay = part.year || (part.releaseDate ? String(part.releaseDate).slice(0, 4) : '');
                    const isUpcoming = Boolean(part.releaseDate && new Date(part.releaseDate) > new Date()) || (!part.releaseDate && !yearDisplay);
                    const titleText = part.title || part.originalTitle || 'Фильм';

                    const cardEl = document.createElement(isCurrentMovie || !hasKpId ? 'div' : 'a');
                    cardEl.className = `franchise-card${isCurrentMovie ? ' franchise-card--current' : ''}${!hasKpId && !isCurrentMovie ? ' franchise-card--inert' : ''}${isUpcoming ? ' franchise-card--upcoming' : ''}`;
                    cardEl.dataset.tmdbId = String(part.tmdbId || '');
                    if (hasKpId) cardEl.dataset.kinopoiskId = String(part.kinopoiskId);
                    if (isCurrentMovie) {
                        cardEl.setAttribute('aria-current', 'true');
                    } else if (hasKpId) {
                        cardEl.href = `movie-details.html?movieId=${part.kinopoiskId}`;
                    }

                    const badgeHtml = isCurrentMovie
                        ? '<span class="franchise-card-badge franchise-card-badge--current">Сейчас</span>'
                        : (isUpcoming ? '<span class="franchise-card-badge franchise-card-badge--upcoming">Скоро</span>' : '');
                    cardEl.innerHTML = `
                        <div class="franchise-poster-wrap">
                            <img src="${this.escapeHtml(posterUrl)}"
                                 alt="${this.escapeHtml(titleText)}"
                                 class="franchise-poster"
                                 loading="lazy"
                                 decoding="async"
                                 data-fallback="franchise-poster"
                                 data-tmdb-id="${part.tmdbId}">
                            ${badgeHtml}
                        </div>
                        <div class="franchise-info">
                            ${yearDisplay ? `<span class="franchise-year">${yearDisplay}</span>` : ''}
                            <span class="franchise-title" title="${this.escapeHtml(titleText)}">${this.escapeHtml(titleText)}</span>
                        </div>
                    `;

                    carouselEl.appendChild(cardEl);
                });

                this.patchSequelsAgainstFranchise(franchiseParts, movieId);

                // Show navigation buttons if carousel has horizontal overflow
                if (navEl && carouselEl.scrollWidth > carouselEl.clientWidth + 10) {
                    navEl.style.display = 'flex';
                }
            }
        } catch (err) {
            if (!this.isPageContextCurrent(pageContext)) return;
            state.movieId = movieId;
            state.status = 'failed';
            console.warn(`[MovieDetails] Failed to load franchise collection ${collectionId}:`, err);
            document.getElementById('movieFranchiseSection')?.remove();
        }
    }

    patchSequelsAgainstFranchise(franchiseParts, expectedMovieId) {
        const activeMovieId = String(this.selectedMovie?.kinopoiskId || this.selectedMovie?.id || '');
        if (!expectedMovieId || activeMovieId !== String(expectedMovieId)) {
            return { applied: false, removed: 0, remaining: null };
        }

        const uniqueFranchiseParts = this.deduplicateRelatedContent(franchiseParts);
        if (uniqueFranchiseParts.length < 2) {
            return { applied: false, removed: 0, remaining: null };
        }

        const sectionEl = document.querySelector('.sequels-section');
        if (!sectionEl) return { applied: true, removed: 0, remaining: 0 };

        const cards = Array.from(sectionEl.querySelectorAll('.sequel-card'));
        let removed = 0;
        cards.forEach(card => {
            const relationIdentity = {
                kinopoiskId: card.dataset.kinopoiskId || null,
                tmdbId: card.dataset.tmdbId || null
            };
            const overlaps = uniqueFranchiseParts.some(part => this.relatedContentItemsMatch(relationIdentity, part));
            if (overlaps) {
                card.remove();
                removed++;
            }
        });

        const remaining = sectionEl.querySelectorAll('.sequel-card').length;
        if (remaining === 0) {
            sectionEl.remove();
        } else {
            sectionEl.dataset.relationCount = String(remaining);
        }

        return { applied: true, removed, remaining };
    }

    renderFactsTab(facts) {
        if (!Array.isArray(facts) || facts.length === 0) return '';
        const validFacts = facts.filter(f => f && typeof f.value === 'string' && f.value.trim().length > 0);
        if (validFacts.length === 0) return '';

        const hasMoreThan5 = validFacts.length > 5;
        const initialFacts = hasMoreThan5 ? validFacts.slice(0, 5) : validFacts;
        const hiddenFacts = hasMoreThan5 ? validFacts.slice(5) : [];

        const renderFactCard = (fact) => {
            const isSpoiler = Boolean(fact.spoiler);
            if (isSpoiler) {
                return `
                    <div class="fact-item fact-item--spoiler">
                        <div class="fact-spoiler-guard">
                            <button class="btn-reveal-spoiler" type="button">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                                <span>Факт содержит спойлер (показать)</span>
                            </button>
                        </div>
                        <p class="fact-text fact-text--concealed">${this.escapeHtml(fact.value)}</p>
                    </div>
                `;
            }
            return `
                <div class="fact-item">
                    <p class="fact-text">${this.escapeHtml(fact.value)}</p>
                </div>
            `;
        };

        return `
            <div class="facts-list">${initialFacts.map(renderFactCard).join('')}</div>
            ${hasMoreThan5 ? `
                <div class="facts-list facts-list-hidden" style="display: none;">${hiddenFacts.map(renderFactCard).join('')}</div>
                <button class="btn-show-all-facts">Показать ещё ${hiddenFacts.length} ${this.getPluralFacts(hiddenFacts.length)}</button>
            ` : ''}
        `;
    }

    getPluralFacts(count) {
        const mod10 = count % 10;
        const mod100 = count % 100;
        if (mod10 === 1 && mod100 !== 11) return 'факт';
        if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'факта';
        return 'фактов';
    }

    async loadAndDisplayUserRatings(movieId) {
        return this.setupRatingsListener(movieId);
    }

    getRatingsRenderElements(movieId) {
        const ratingsSection = document.getElementById('userRatingsSection');
        if (!ratingsSection || String(ratingsSection.dataset.movieId || '') !== String(movieId)) return null;

        return {
            ratingsSection,
            loadingEl: ratingsSection.querySelector('.user-ratings-loading'),
            contentEl: ratingsSection.querySelector('.user-ratings-content')
        };
    }

    renderRatingsSnapshot(movieId, ratings, currentUser) {
        const renderElements = this.getRatingsRenderElements(movieId);
        if (!renderElements || !Array.isArray(ratings)) return false;

        const { contentEl, loadingEl } = renderElements;
        if (!contentEl) return false;

        if (ratings.length === 0) {
            contentEl.innerHTML = `<div class="user-ratings-empty"><p>${i18n.get('movie_details.empty_reviews')}</p></div>`;
            this._ratingsListEl = null;
        } else {
            contentEl.innerHTML = this.createUserRatingsSection(
                ratings,
                this._userProfileCache || new Map(),
                currentUser?.uid,
                this.commentReactionSummaries,
                this.commentUserReactions
            );
            this._ratingsListEl = contentEl.querySelector('.user-ratings-list');
            this.setupUsernameClickListeners();
        }

        if (loadingEl) loadingEl.style.display = 'none';
        if (this.pendingReviewRatingId && ratings.some(rating => String(rating.id) === String(this.pendingReviewRatingId))) {
            const ratingId = this.pendingReviewRatingId;
            this.pendingReviewRatingId = null;
            setTimeout(() => this.openReviewReaderByRatingId(ratingId), 0);
        }
        return true;
    }

    rehydrateRatingsForCurrentRender(movieId) {
        if (String(this.latestRatingsSnapshotMovieId || '') !== String(movieId)) return false;
        return this.renderRatingsSnapshot(movieId, this.latestRatingsSnapshot || [], this.latestRatingsSnapshotUser);
    }

    setupCommentReactionListeners() {
        if (this._commentReactionListenerBound) return;
        this._commentReactionListenerBound = true;

        document.addEventListener('click', async (event) => {
            const pickerToggle = event.target?.closest?.('[data-action="toggle-comment-reaction-picker"]');
            if (pickerToggle) {
                event.preventDefault();
                event.stopPropagation();
                const reactionBar = pickerToggle.closest('[data-comment-reactions]');
                const picker = reactionBar?.querySelector('[data-comment-reaction-picker]');
                if (reactionBar && picker && typeof CommentReactionBar !== 'undefined') {
                    const open = picker.hidden;
                    CommentReactionBar.setPickerOpen(reactionBar, open);
                    if (open) picker.querySelector('[data-reaction-type]:not([disabled])')?.focus();
                }
                return;
            }

            const button = event.target?.closest?.('[data-action="toggle-comment-reaction"]');
            if (!button) {
                if (!event.target?.closest?.('[data-comment-reactions]') && typeof CommentReactionBar !== 'undefined') {
                    CommentReactionBar.closeOpenPickers();
                }
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            await this.toggleCommentReaction(button);
        });

        this.getModalStack().register('comment-reaction-picker', {
            order: 100,
            isOpen: () => Boolean(
                typeof CommentReactionBar !== 'undefined'
                && document.querySelector('[data-comment-reaction-picker]:not([hidden])')?.closest('[data-comment-reactions]')
            ),
            close: () => {
                const picker = document.querySelector('[data-comment-reaction-picker]:not([hidden])');
                const reactionBar = picker?.closest('[data-comment-reactions]');
                const trigger = reactionBar?.querySelector('[data-action="toggle-comment-reaction-picker"]');
                CommentReactionBar.setPickerOpen(reactionBar, false);
                trigger?.focus();
            }
        });
    }

    async hydrateCommentReactions(ratings, currentUser) {
        const reactionService = firebaseManager.getCommentReactionService?.();
        if (!reactionService || !Array.isArray(ratings) || ratings.length === 0) return;

        const ratingIds = ratings.map((rating) => rating.id).filter(Boolean);
        if (ratingIds.length === 0) return;

        try {
            await reactionService.loadConfig?.();
            if (!this.commentReactionConfigUnsubscribe) {
                this.commentReactionConfigUnsubscribe = reactionService.subscribeToConfig?.(() => {
                    this.refreshCommentReactionBars();
                });
            }
            const [summaryMap, userReactionMap] = await Promise.all([
                reactionService.getSummaryMap(ratingIds),
                currentUser
                    ? reactionService.getUserReactionMap(currentUser.uid, ratingIds)
                    : Promise.resolve(new Map())
            ]);

            ratingIds.forEach((ratingId) => this.commentUserReactions.delete(ratingId));
            summaryMap.forEach((summary, ratingId) => this.commentReactionSummaries.set(ratingId, summary));
            userReactionMap.forEach((types, ratingId) => this.commentUserReactions.set(ratingId, types));

            ratings.forEach((rating) => {
                const bar = document.querySelector(`[data-comment-reactions="true"][data-rating-id="${rating.id}"]`);
                if (bar && typeof CommentReactionBar !== 'undefined') {
                    CommentReactionBar.update(
                        bar,
                        this.commentReactionSummaries.get(rating.id),
                        this.commentUserReactions.get(rating.id) || null
                    );
                }
            });
        } catch (error) {
            console.warn('[CommentReactions] Failed to hydrate reaction state:', error);
        }
    }

    refreshCommentReactionBars() {
        if (typeof CommentReactionBar === 'undefined') return;
        document.querySelectorAll('[data-comment-reactions="true"]').forEach((bar) => {
            const ratingId = bar.getAttribute('data-rating-id');
            if (!ratingId) return;
            CommentReactionBar.update(
                bar,
                this.commentReactionSummaries.get(ratingId),
                this.commentUserReactions.get(ratingId) || null
            );
        });
    }

    async toggleCommentReaction(button) {
        const reactionBar = button.closest('[data-comment-reactions]');
        const ratingId = button.getAttribute('data-rating-id') || reactionBar?.getAttribute('data-rating-id');
        const movieId = button.getAttribute('data-movie-id')
            || reactionBar?.getAttribute('data-movie-id')
            || this.selectedMovie?.kinopoiskId
            || this._currentMovieId;
        const type = button.getAttribute('data-reaction-type');
        if (!ratingId || !movieId || !type || this.commentReactionPending.has(ratingId)) return;

        if (reactionBar && typeof CommentReactionBar !== 'undefined') {
            CommentReactionBar.setPickerOpen(reactionBar, false);
        }

        const currentUser = this.currentUser || firebaseManager.getCurrentUser?.();
        if (!currentUser) {
            Utils.showToast(i18n.get('navbar.sign_in'), 'warning');
            return;
        }

        const reactionService = firebaseManager.getCommentReactionService?.();
        if (!reactionService) return;

        const storedTypes = this.commentUserReactions.get(ratingId);
        const previousTypes = Array.isArray(storedTypes) ? [...storedTypes] : (storedTypes ? [storedTypes] : []);
        const hasReaction = previousTypes.includes(type);
        const maxReactions = typeof CommentReactionService !== 'undefined'
            ? CommentReactionService.MAX_REACTIONS_PER_USER
            : 3;
        if (!hasReaction && previousTypes.length >= maxReactions) {
            Utils.showToast(i18n.get('movie_details.max_reactions'), 'warning');
            return;
        }

        const nextTypes = hasReaction
            ? previousTypes.filter((reactionType) => reactionType !== type)
            : [...previousTypes, type];
        const currentSummary = this.commentReactionSummaries.get(ratingId) || { counts: {} };
        const optimisticCounts = { ...(currentSummary.counts || {}) };

        if (hasReaction) {
            optimisticCounts[type] = Math.max(0, Number(optimisticCounts[type] || 0) - 1);
        } else {
            optimisticCounts[type] = Number(optimisticCounts[type] || 0) + 1;
        }

        const previousOrder = Array.isArray(currentSummary.order)
            ? currentSummary.order
            : Object.keys(currentSummary.counts || {}).filter((k) => Number(currentSummary.counts[k]) > 0);
        const optimisticOrder = [...previousOrder];
        if (!hasReaction && !optimisticOrder.includes(type)) {
            optimisticOrder.push(type);
        } else if (hasReaction && optimisticCounts[type] <= 0) {
            const idx = optimisticOrder.indexOf(type);
            if (idx !== -1) optimisticOrder.splice(idx, 1);
        }

        const optimisticSummary = {
            ...currentSummary,
            ratingId,
            movieId,
            counts: optimisticCounts,
            order: optimisticOrder,
            total: Object.values(optimisticCounts).reduce((sum, c) => sum + c, 0)
        };
        this.commentReactionPending.add(ratingId);
        this.commentUserReactions.set(ratingId, nextTypes);
        this.commentReactionSummaries.set(ratingId, optimisticSummary);

        if (reactionBar && typeof CommentReactionBar !== 'undefined') {
            CommentReactionBar.update(reactionBar, optimisticSummary, nextTypes, { isPending: true });
        }

        try {
            await reactionService.toggleReaction({
                userId: currentUser.uid,
                ratingId,
                movieId,
                type
            });
            this.commentReactionSummaries.set(ratingId, optimisticSummary);
            this.commentUserReactions.set(ratingId, nextTypes);
            if (reactionBar && typeof CommentReactionBar !== 'undefined') {
                CommentReactionBar.update(reactionBar, optimisticSummary, nextTypes, { isPending: false });
            }
        } catch (error) {
            this.commentUserReactions.set(ratingId, previousTypes);
            this.commentReactionSummaries.set(ratingId, currentSummary);
            if (reactionBar && typeof CommentReactionBar !== 'undefined') {
                CommentReactionBar.update(reactionBar, currentSummary, previousTypes, { isPending: false });
            }
            console.error('[CommentReactions] Failed to toggle reaction:', error);
            const message = error?.code === 'MAX_COMMENT_REACTIONS'
                ? i18n.get('movie_details.max_reactions')
                : i18n.get('movie_details.error_loading_reviews');
            Utils.showToast(message, 'error');
        } finally {
            this.commentReactionPending.delete(ratingId);
            if (reactionBar && typeof CommentReactionBar !== 'undefined') {
                const latestSummary = this.commentReactionSummaries.get(ratingId) || optimisticSummary;
                const latestTypes = this.commentUserReactions.get(ratingId) || nextTypes;
                CommentReactionBar.update(reactionBar, latestSummary, latestTypes, { isPending: false });
            }
        }
    }

    async setupRatingsListener(movieId) {
        // Отписываемся от предыдущего слушателя (смена фильма)
        this.destroyRatingsListener();

        if (String(this.latestRatingsSnapshotMovieId || '') !== String(movieId)) {
            this.latestRatingsSnapshot = null;
            this.latestRatingsSnapshotMovieId = null;
            this.latestRatingsSnapshotUser = null;
        }

        const ratingsSection = document.getElementById('userRatingsSection');
        if (!ratingsSection) return;

        const loadingEl = ratingsSection.querySelector('.user-ratings-loading');
        const contentEl = ratingsSection.querySelector('.user-ratings-content');

        if (loadingEl) loadingEl.style.display = 'flex';
        if (contentEl) contentEl.innerHTML = '';

        // Карта профилей пользователей (кеш на время жизни страницы)
        if (!this._userProfileCache) this._userProfileCache = new Map();

        // Используем onAuthStateChanged напрямую от Firebase для надежности
        const auth = firebaseManager.auth;

        if (this._unsubscribeAuthWait) {
            this._unsubscribeAuthWait();
            this._unsubscribeAuthWait = null;
        }

        this._unsubscribeAuthWait = auth.onAuthStateChanged(async (user) => {
            // Сразу отписываемся — нужен только первый вызов при инициализации/смене пользователя
            if (this._unsubscribeAuthWait) {
                this._unsubscribeAuthWait();
                this._unsubscribeAuthWait = null;
            }

            if (!user) {
                console.info('[RatingsListener] No authenticated user, loading public comments');
                this.currentUser = null;
                this.currentPersonalRating = null;
                this.currentSeriesEpisodeRatings = {
                    exists: false, episodes: {}
                };
                this.patchPersonalRating(null, this.capturePageContext(this.selectedMovie));
                this.updateSeriesEpisodeRatingUI();
                await this._startSnapshot(movieId, null, ratingsSection, loadingEl, contentEl);
                return;
            }

            console.log('[RatingsListener] Auth ready, starting snapshot for movieId:', movieId);
            await this._startSnapshot(movieId, user, ratingsSection, loadingEl, contentEl);
        });
    }

    async _startSnapshot(movieId, currentUser, ratingsSection, loadingEl, contentEl) {
        const db = firebaseManager.db;
        if (!db) {
            console.error('[RatingsListener] Firestore not initialized');
            if (contentEl) contentEl.innerHTML = `<div class="user-ratings-error"><p>${i18n.get('movie_details.error_loading_reviews')}</p></div>`;
            if (loadingEl) loadingEl.style.display = 'none';
            return;
        }

        this._currentMovieId = movieId;
        const previousUid = this.currentUser?.uid || null;
        this.currentUser = currentUser;
        if (previousUid !== (currentUser?.uid || null)) {
            this.episodeRatingUiVersion += 1;
            this.isEpisodeRatingMutationPending = false;
            this.currentPersonalRating = null;
            this.currentSeriesEpisodeRatings = {
                exists: false, episodes: {}
            };
            this.patchPersonalRating(null, this.capturePageContext(this.selectedMovie));
            this.updateSeriesEpisodeRatingUI();
            if (currentUser && this.selectedMovie && String(this.selectedMovie.kinopoiskId) === String(movieId)) {
                void this.loadPersonalState(movieId).catch(error => console.warn('[MovieDetails] Failed to refresh personal state after auth change:', error));
            }
        }
        const userService = firebaseManager.getUserService();

        // Флаг первого снимка — нужен, чтобы отобразить спиннер только однажды
        let isFirstSnapshot = true;

        // Инициализируем контейнер списка
        this._ratingsListEl = null;

        // Приводим ID фильма к правильному типу данных для точного сопоставления
        const targetMovieId = typeof movieId === 'number' ? movieId : (Number(movieId) || movieId);

        // Top-level коллекция с фильтром по movieId
        const collectionRef = db
            .collection('ratings')
            .where('movieId', '==', targetMovieId)
            .orderBy('createdAt', 'desc')
            .limit(50);

        this._ratingsUnsubscribe = collectionRef.onSnapshot(
            { includeMetadataChanges: true },
            async (snapshot) => {
                // Оффлайн-уведомление
                const liveRatingsSection = this.getRatingsRenderElements(movieId)?.ratingsSection || ratingsSection;
                if (snapshot.metadata.fromCache && !navigator.onLine) {
                    this._showOfflineBanner(liveRatingsSection);
                } else {
                    this._hideOfflineBanner(liveRatingsSection);
                }

                const isInitialSnapshot = isFirstSnapshot;
                const allRatings = isInitialSnapshot
                    ? snapshot.docs.map(d => ({ id: d.id, ...d.data() }))
                    : null;

                // Comments are useful before profile lookups settle. Keep this
                // snapshot as the render source so a same-movie DOM replacement
                // can rehydrate immediately instead of waiting for Firestore.
                if (isInitialSnapshot) {
                    isFirstSnapshot = false;
                    this.latestRatingsSnapshot = allRatings;
                    this.latestRatingsSnapshotMovieId = String(movieId);
                    this.latestRatingsSnapshotUser = currentUser || null;
                    this.renderRatingsSnapshot(movieId, allRatings, currentUser);
                    if (!snapshot.empty) this.hydrateCommentReactions(allRatings, currentUser);
                } else {
                    this.latestRatingsSnapshot = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
                    this.latestRatingsSnapshotMovieId = String(movieId);
                    this.latestRatingsSnapshotUser = currentUser || null;
                }

                // Ждём профили новых пользователей (только для добавленных)
                const addedDocs = snapshot.docChanges().filter(c => c.type === 'added');
                const newUserIds = addedDocs
                    .map(c => c.doc.data().userId)
                    .filter(uid => uid && !this._userProfileCache.has(uid));

                if (newUserIds.length > 0) {
                    try {
                        const profiles = await userService.getUserProfilesByIds([...new Set(newUserIds)]);
                        profiles.forEach(p => {
                            const key = p.userId || p.id;
                            if (key) this._userProfileCache.set(key, p);
                        });
                    } catch (e) {
                        console.warn('[RatingsListener] Failed to load user profiles:', e);
                    }
                }

                // Также обновляем профиль текущего пользователя, если нужен
                if (currentUser && !this._userProfileCache.has(currentUser.uid)) {
                    try {
                        const p = await userService.getUserProfile(currentUser.uid);
                        if (p) this._userProfileCache.set(currentUser.uid, p);
                    } catch { /* ignore */ }
                }

                if (isInitialSnapshot) {
                    // Refresh names and avatars after profile data arrives. The
                    // renderer resolves the live section rather than the old
                    // closure, so a same-movie rerender remains safe.
                    this.renderRatingsSnapshot(movieId, allRatings, currentUser);
                    return;
                }

                // Инкрементальные обновления
                const liveContentEl = this.getRatingsRenderElements(movieId)?.contentEl || contentEl;
                for (const change of snapshot.docChanges()) {
                    const rating = { id: change.doc.id, ...change.doc.data() };
                    switch (change.type) {
                        case 'added':    await this._onRatingAdded(rating, currentUser?.uid, liveContentEl); break;
                        case 'modified': this._onRatingModified(rating, currentUser?.uid); break;
                        case 'removed':  this._onRatingRemoved(rating.id); break;
                    }
                }
            },
            (error) => {
                console.error('[RatingsListener] Snapshot error:', error);
                if (typeof Utils !== 'undefined') {
                    Utils.showToast(i18n.get('movie_details.error_loading_reviews') || 'Ошибка загрузки отзывов', 'error');
                }
                const liveRenderElements = this.getRatingsRenderElements(movieId);
                const liveContentEl = liveRenderElements?.contentEl || contentEl;
                if (liveContentEl && !liveContentEl.querySelector('.user-ratings-list')) {
                    liveContentEl.innerHTML = `<div class="user-ratings-error"><p>${i18n.get('movie_details.error_loading_reviews')}</p></div>`;
                }
                const liveLoadingEl = liveRenderElements?.loadingEl || loadingEl;
                if (liveLoadingEl) liveLoadingEl.style.display = 'none';
            }
        );

        // Регистрируем обработчики отписки (идемпотентны)
        if (!this._ratingsListenerPageBound) {
            this._ratingsListenerPageBound = true;

            window.addEventListener('beforeunload', () => this.destroyRatingsListener());

            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') {
                    this.destroyRatingsListener();
                } else if (document.visibilityState === 'visible' && this._currentMovieId) {
                    this.setupRatingsListener(this._currentMovieId);
                }
            });
        }
    }

    /** Отписывается от текущего onSnapshot-слушателя */
    destroyRatingsListener() {
        if (this._unsubscribeAuthWait) {
            this._unsubscribeAuthWait();
            this._unsubscribeAuthWait = null;
        }
        if (this._ratingsUnsubscribe) {
            this._ratingsUnsubscribe();
            this._ratingsUnsubscribe = null;
        }
    }

    /** Показывает баннер «нет соединения» внутри секции рейтингов */
    _showOfflineBanner(ratingsSection) {
        if (ratingsSection.querySelector('.ratings-offline-banner')) return;
        const banner = document.createElement('div');
        banner.className = 'ratings-offline-banner';
        banner.innerHTML = '<span style="display:inline-flex;align-items:center;margin-right:6px;"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg></span> Нет соединения — данные могут быть устаревшими';
        ratingsSection.prepend(banner);
    }

    /** Удаляет баннер «нет соединения» */
    _hideOfflineBanner(ratingsSection) {
        ratingsSection.querySelector('.ratings-offline-banner')?.remove();
    }

    /**
     * Рендерит выпадающее меню действий карточки оценки в системном стиле .mc-menu-*
     */
    _renderRatingMenu(ratingId) {
        return `
            <div class="mc-menu-container user-rating-menu-container">
                <button type="button" class="mc-menu-btn" data-rating-id="${this.escapeHtml(ratingId)}" aria-haspopup="true" aria-expanded="false" aria-label="${i18n.get('movie_details.user_ratings_title')}" title="${i18n.get('movie_details.user_ratings_title')}">
                    <span class="mc-menu-icon"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg></span>
                </button>
                <div class="mc-menu-dropdown">
                    <button class="mc-menu-item" data-rating-id="${this.escapeHtml(ratingId)}" data-action="edit-user-rating">
                        <span class="mc-menu-item-icon"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg></span>
                        <span class="mc-menu-item-text">${i18n.get('movie_details.edit')}</span>
                    </button>
                    <button class="mc-menu-item delete-item" data-rating-id="${this.escapeHtml(ratingId)}" data-action="delete-user-rating">
                        <span class="mc-menu-item-icon"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></span>
                        <span class="mc-menu-item-text">${i18n.get('movie_details.delete')}</span>
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * Единая разметка содержимого карточки рейтинга для первичного и инкрементального рендера.
     */
    renderRatingCardInnerHtml(rating, {
        userProfile = this._userProfileCache?.get(rating.userId),
        currentUserId = null,
        reactionSummary = this.commentReactionSummaries?.get(rating.id),
        userReaction = this.commentUserReactions?.get(rating.id) || null
    } = {}) {
        const userName = userProfile?.displayName || rating.userName || 'Пользователь';
        const userPhoto = userProfile?.photoURL || '/src/shared/assets/icons/app/icon48.png';
        const isCurrentUser = Boolean(currentUserId && rating.userId === currentUserId);

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

        const normalizedComment = Utils.normalizeRatingComment(rating.comment);
        const commentHtml = normalizedComment
            ? `<div class="user-rating-comment">${Utils.parseSpoilers(Utils.linkify(this.escapeHtml(normalizedComment)))}</div>`
            : '';
        const reactionHtml = typeof CommentReactionBar !== 'undefined'
            ? CommentReactionBar.render({
                ratingId: rating.id,
                movieId: rating.movieId || rating.kinopoiskId || this.selectedMovie?.kinopoiskId || this._currentMovieId,
                summary: reactionSummary,
                userReaction
            })
            : '';

        return `
            <div class="user-rating-header">
                <img src="${this.escapeHtml(userPhoto)}" alt="${this.escapeHtml(userName)}" class="user-rating-avatar" data-fallback="avatar" loading="lazy" decoding="async">
                <div class="user-rating-info">
                    <div class="user-rating-name-row">
                        <span class="user-rating-name clickable-username" role="link" tabindex="0" data-user-id="${this.escapeHtml(rating.userId)}">${this.escapeHtml(userName)}</span>
                        ${dateStr}
                    </div>
                    <div class="user-rating-score"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="color: #eab308; vertical-align: middle; margin-right: 4px;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>${this.escapeHtml(rating.rating)}/10</div>
                </div>
                ${isCurrentUser ? this._renderRatingMenu(rating.id) : ''}
            </div>
            ${commentHtml}
            ${this.renderRatingReview(rating)}
            ${reactionHtml}
        `;
    }

    /**
     * Строит DOM-элемент карточки рейтинга.
     * Используется как для первичного рендера, так и для инкрементального.
     */
    _buildRatingCard(rating, currentUserId) {
        const isCurrentUser = Boolean(currentUserId && rating.userId === currentUserId);
        const card = document.createElement('div');
        card.className = `user-rating-card${isCurrentUser ? ' current-user' : ''}`;
        card.dataset.ratingId = rating.id;
        card.innerHTML = this.renderRatingCardInnerHtml(rating, { currentUserId });
        return card;
    }

    /**
     * Обрабатывает событие «added» от onSnapshot.
     * Не дублирует карточку текущего пользователя, если она уже есть (оптимистичный UI).
     */
    async _onRatingAdded(rating, currentUserId, contentEl) {
        // Если секция пустая (empty-state), очищаем её и создаём список
        if (contentEl) {
            const emptyEl = contentEl.querySelector('.user-ratings-empty');
            if (emptyEl) {
                const container = document.createElement('div');
                container.className = 'user-ratings-container';
                container.innerHTML = `<h4 class="user-ratings-title">${i18n.get('movie_details.user_ratings_title')}</h4>`;
                const list = document.createElement('div');
                list.className = 'user-ratings-list';
                container.appendChild(list);
                contentEl.innerHTML = '';
                contentEl.appendChild(container);
                this._ratingsListEl = list;
            }
        }

        if (!this._ratingsListEl) {
            this._ratingsListEl = contentEl?.querySelector('.user-ratings-list');
        }
        if (!this._ratingsListEl) return;

        // Не дублируем, если карточка уже есть (оптимистичное добавление при сабмите)
        if (this._ratingsListEl.querySelector(`[data-rating-id="${rating.id}"]`)) return;

        const card = this._buildRatingCard(rating, currentUserId);
        card.classList.add('rating-card-entering');
        // Новые оценки — в начало списка
        this._ratingsListEl.prepend(card);
        // Форсируем reflow для анимации
        void card.offsetWidth;
        card.classList.remove('rating-card-entering');
        card.classList.add('rating-card-visible');
        this.hydrateCommentReactions([rating], this.currentUser);

        card.querySelectorAll('.clickable-username').forEach(el => {
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') el.click();
            });
            el.addEventListener('click', (e) => {
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

    /**
     * Обрабатывает событие «modified» от onSnapshot.
     * Обновляет существующую карточку на лету без перерендера всего списка.
     */
    async _onRatingModified(rating, currentUserId) {
        const existingCard = this._ratingsListEl?.querySelector(`[data-rating-id="${rating.id}"]`);
        if (!existingCard) return;

        // Обновляем оценку
        const scoreEl = existingCard.querySelector('.user-rating-score');
        if (scoreEl) scoreEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="color: #eab308; vertical-align: middle; margin-right: 4px;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>${this.escapeHtml(rating.rating)}/10`;

        // Обновляем комментарий
        let commentEl = existingCard.querySelector('.user-rating-comment');
        let reactionBarEl = existingCard.querySelector('.comment-reaction-bar');
        const normalizedComment = Utils.normalizeRatingComment(rating.comment);
        if (normalizedComment) {
            const newHtml = Utils.parseSpoilers(Utils.linkify(this.escapeHtml(normalizedComment)));
            if (commentEl) {
                commentEl.innerHTML = newHtml;
            } else {
                commentEl = document.createElement('div');
                commentEl.className = 'user-rating-comment';
                commentEl.innerHTML = newHtml;
                if (reactionBarEl) {
                    existingCard.insertBefore(commentEl, reactionBarEl);
                } else {
                    existingCard.appendChild(commentEl);
                }
            }
        } else if (commentEl) {
            commentEl.remove();
        }

        const reviewEl = existingCard.querySelector('.user-rating-review');
        const reviewHtml = this.renderRatingReview(rating);
        if (reviewHtml) {
            const wrapper = document.createElement('div');
            wrapper.innerHTML = reviewHtml;
            const nextReviewEl = wrapper.firstElementChild;
            if (reviewEl) {
                reviewEl.replaceWith(nextReviewEl);
            } else if (reactionBarEl) {
                existingCard.insertBefore(nextReviewEl, reactionBarEl);
            } else {
                existingCard.appendChild(nextReviewEl);
            }
        } else if (reviewEl) {
            reviewEl.remove();
        }

        if (!reactionBarEl && typeof CommentReactionBar !== 'undefined') {
            existingCard.insertAdjacentHTML('beforeend', CommentReactionBar.render({
                ratingId: rating.id,
                movieId: rating.movieId || rating.kinopoiskId || this.selectedMovie?.kinopoiskId || this._currentMovieId,
                summary: this.commentReactionSummaries.get(rating.id),
                userReaction: this.commentUserReactions.get(rating.id) || null
            }));
        }

        this.hydrateCommentReactions([rating], this.currentUser);

        // Пульс-анимация при изменении
        existingCard.classList.add('rating-card-updated');
        setTimeout(() => existingCard.classList.remove('rating-card-updated'), 600);
    }

    /** Обрабатывает событие «removed» — убирает карточку с анимацией */
    _onRatingRemoved(ratingId) {
        const existingCard = document.querySelector(`[data-rating-id="${CSS.escape(String(ratingId))}"]`);
        if (!existingCard) return;

        existingCard.classList.add('rating-card-leaving');
        setTimeout(() => {
            existingCard.remove();
            // Если карточек не осталось — показываем empty state
            const list = this._ratingsListEl || document.querySelector('.user-ratings-list');
            if (list && list.children.length === 0) {
                const container = list.closest('.user-ratings-container') || list.parentElement;
                if (container) {
                    container.innerHTML = `<div class="user-ratings-empty"><p>${i18n.get('movie_details.be_first')}</p></div>`;
                }
            }
        }, 300);
    }

    createUserRatingsSection(ratings, userProfileMap, currentUserId, reactionSummaries = this.commentReactionSummaries, userReactions = this.commentUserReactions) {
        if (ratings.length === 0) return `<div class="user-ratings-empty"><p>${i18n.get('movie_details.be_first')}</p></div>`;

        const ratingsHTML = ratings.map(rating => {
            const isCurrentUser = Boolean(currentUserId && rating.userId === currentUserId);
            const innerHtml = this.renderRatingCardInnerHtml(rating, {
                userProfile: userProfileMap?.get(rating.userId),
                currentUserId,
                reactionSummary: reactionSummaries?.get(rating.id),
                userReaction: userReactions?.get(rating.id) || null
            });
            return `<div class="user-rating-card ${isCurrentUser ? 'current-user' : ''}" data-rating-id="${this.escapeHtml(rating.id)}">${innerHtml}</div>`;
        }).join('');

        return `<div class="user-ratings-container"><h4 class="user-ratings-title">${i18n.get('movie_details.user_ratings_title')}</h4><div class="user-ratings-list">${ratingsHTML}</div></div>`;
    }

    renderRatingReview(rating) {
        const review = this.normalizeReviewForDisplay(rating?.review);
        if (!review) return '';

        const previewLimit = 360;
        const reviewChars = Array.from(review);
        const preview = reviewChars.slice(0, previewLimit).join('');
        const suffix = reviewChars.length > previewLimit ? '…' : '';
        return `
            <section class="user-rating-review" aria-label="Подробная рецензия">
                <div class="user-rating-review__label">Рецензия</div>
                <div class="user-rating-review__preview">${Utils.parseSpoilers(Utils.linkify(this.escapeHtml(preview + suffix)))}</div>
                <button class="user-rating-review__read btn btn-secondary" type="button" data-action="read-rating-review" data-rating-id="${this.escapeHtml(rating.id)}">Читать рецензию</button>
            </section>
        `;
    }

    openReviewReaderByRatingId(ratingId) {
        const rating = this.latestRatingsSnapshot?.find(item => String(item.id) === String(ratingId));
        if (rating) {
            this.openReviewReader(rating);
            return;
        }
        if (typeof Utils !== 'undefined') Utils.showToast('Рецензия ещё загружается', 'warning');
    }

    openReviewReader(rating) {
        const review = this.normalizeReviewForDisplay(rating?.review);
        if (!review || !this.elements.reviewReaderModal || !this.elements.reviewReaderBody) return;

        const profile = this._userProfileCache?.get(rating.userId);
        const userName = profile?.displayName || rating.userName || 'Пользователь';
        this.activeReviewReaderRating = rating;
        this.elements.reviewReaderTitle.textContent = `Рецензия — ${userName}`;
        this.elements.reviewReaderMeta.textContent = this.selectedMovie?.name || '';
        this.elements.reviewReaderBody.innerHTML = Utils.parseSpoilers(Utils.linkify(this.escapeHtml(review)));
        Utils.bindSpoilerReveal(this.elements.reviewReaderBody);
        if (this.elements.reviewReaderReport) {
            const isOwnReview = this.currentUser?.uid && this.currentUser.uid === rating.userId;
            this.elements.reviewReaderReport.hidden = Boolean(isOwnReview);
        }
        this.openAccessibleDialog(this.elements.reviewReaderModal, document.activeElement);
    }

    closeReviewReader() {
        this.closeAccessibleDialog(this.elements.reviewReaderModal);
        this.activeReviewReaderRating = null;
    }

    reportActiveReview() {
        const rating = this.activeReviewReaderRating;
        if (!rating || !window.reportWidget?.openForContext) return;
        const context = {
            targetType: 'rating-review',
            targetRatingId: rating.id,
            targetMovieId: Number(rating.movieId || this.selectedMovie?.kinopoiskId),
            targetAuthorId: rating.userId
        };
        this.closeReviewReader();
        window.reportWidget.openForContext(context);
    }

    setupUsernameClickListeners() {
        document.querySelectorAll('.clickable-username').forEach(el => {
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') el.click();
            });
            el.addEventListener('click', (e) => {
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
        const confirmed = await window.ConfirmDialog.confirm({
            title: 'Удалить отзыв?',
            message: 'Оценка, комментарий и рецензия к этому фильму будут удалены без возможности восстановления.',
            confirmLabel: 'Удалить',
            danger: true
        });
        if (!confirmed) return;
        try {
            const ratingService = firebaseManager.getRatingService();
            await ratingService.deleteRating(this.currentUser.uid, ratingId);
            document.querySelector(`[data-rating-id="${CSS.escape(String(ratingId))}"]`)?.remove();
            if (typeof Utils !== 'undefined') Utils.showToast('Отзыв удален', 'success');
            // The ratings listener owns the review list; only user-scoped controls need a refresh.
            await this.loadPersonalState(this.selectedMovie.kinopoiskId);
        } catch (error) {
            console.error('Error deleting rating:', error);
            if (typeof Utils !== 'undefined') Utils.showToast('Не удалось удалить отзыв', 'error');
        }
    }

    // Rating Modal Methods
    async showRatingModal(movie) {
        this.selectedMovie = movie;
        const currentUser = firebaseManager.getCurrentUser();
        if (!currentUser) {
            this.page.showError(createAppError('AUTH_REQUIRED', {
                category: 'auth',
                retryable: false,
                context: { operation: 'rating-modal' }
            }));
            return;
        }
        this.currentUser = currentUser;
        
        this.elements.ratingMoviePoster.src = movie.posterUrl || '/src/shared/assets/icons/app/icon48.png';
        this.elements.ratingMovieTitle.textContent = movie.name;
        const genresStr = typeof Utils !== 'undefined' && Utils.formatGenres ? Utils.formatGenres(movie.genres, 3) : (Array.isArray(movie.genres) ? movie.genres.slice(0, 3).map(g => (typeof g === 'object' && g ? (g.name || g.genre || '') : g)).filter(Boolean).join(', ') : (movie.genres || ''));
        const metaParts = [];
        if (movie.year) metaParts.push(movie.year);
        if (genresStr) metaParts.push(genresStr);
        this.elements.ratingMovieMeta.textContent = metaParts.join(' • ');
        
        this.elements.ratingStars.innerHTML = '';
        const isSpiderman = isSpidermanMovie(movie);
        const isStarWars = isStarWarsMovie(movie);
        const ratingIcon = getRatingIconMarkup({ isSpiderman, isStarWars });

        for (let i = 1; i <= 10; i++) {
            const btn = document.createElement('button');
            btn.className = 'star-rating-btn';
            btn.classList.toggle('spiderman-rating-btn', isSpiderman);
            btn.classList.toggle('starwars-rating-btn', isStarWars);
            btn.dataset.rating = i;
            btn.type = 'button';
            btn.setAttribute('aria-label', `Оценить на ${i} из 10`);
            btn.setAttribute('aria-pressed', 'false');
            btn.innerHTML = ratingIcon;
            this.elements.ratingStars.appendChild(btn);
        }
        
        const ratingService = firebaseManager.getRatingService();
        const existingRating = await ratingService.getRating(currentUser.uid, movie.kinopoiskId);
        this.currentRatingId = existingRating?.id || null;
        this.currentPersonalRating = existingRating || null;
        if (existingRating) {
            this.currentRating = existingRating.rating;
            this.originalRating = Number(existingRating.rating) || 0;
            this.updateStarVisuals(this.currentRating, false);
            const normalizedComment = Utils.normalizeRatingComment(existingRating.comment);
            const normalizedReview = this.normalizeReviewForDisplay(existingRating.review);
            this.elements.ratingComment.value = normalizedComment;
            this.elements.charCount.textContent = this.getRatingTextLength(normalizedComment);
            this.elements.ratingReview.value = normalizedReview;
            this.elements.reviewCharCount.textContent = this.getRatingTextLength(normalizedReview);
            this.originalRatingComment = normalizedComment;
            this.originalRatingReview = normalizedReview;
            this.ratingReviewTouched = false;
            this.clearRatingReviewError();
            this.isReviewVisible = Boolean(normalizedComment || normalizedReview);
            this.elements.reviewContainer.style.display = this.isReviewVisible ? 'block' : 'none';
        } else {
            this.currentRating = 0;
            this.originalRating = 0;
            this.updateStarVisuals(0, false);
            this.elements.ratingComment.value = '';
            this.elements.charCount.textContent = '0';
            this.elements.ratingReview.value = '';
            this.elements.reviewCharCount.textContent = '0';
            this.currentRatingId = null;
            this.originalRatingComment = '';
            this.originalRatingReview = '';
            this.ratingReviewTouched = false;
            this.clearRatingReviewError();
            this.isReviewVisible = false;
            this.elements.reviewContainer.style.display = 'none';
        }
        
        this.openAccessibleDialog(this.elements.ratingModal);
    }

    closeRatingModal() {
        this.closeAccessibleDialog(this.elements.ratingModal);
        this.currentRating = 0;
    }

    async saveRating() {
        try {
            const currentUser = firebaseManager.getCurrentUser();
            if (!currentUser) {
                this.page.showError(createAppError('AUTH_REQUIRED', {
                    category: 'auth',
                    retryable: false,
                    context: { operation: 'rating-save' }
                }));
                return;
            }
            
            if (!this.currentRating || this.currentRating < 1) {
                if (typeof Utils !== 'undefined') Utils.showToast('Выберите оценку', 'warning');
                return;
            }
            
            const ratingService = firebaseManager.getRatingService();
            const userService = firebaseManager.getUserService();
            const userProfile = await userService.getUserProfile(currentUser.uid);
            const displayName = userProfile?.displayName || currentUser.displayName || currentUser.email;
            const comment = Utils.normalizeRatingComment(this.elements.ratingComment.value);
            const review = this.normalizeReviewForDisplay(this.elements.ratingReview?.value || '');
            const commentChanged = comment !== this.originalRatingComment;
            const reviewChanged = review !== this.originalRatingReview;
            if (this.getRatingTextLength(review) > 5000) {
                this.showRatingReviewError('Рецензия не должна превышать 5000 символов.');
                return;
            }

            if (this.currentRatingId && this.originalRating === Number(this.currentRating) && (commentChanged || reviewChanged)) {
                const patch = {};
                if (commentChanged) patch.comment = comment;
                if (reviewChanged || this.ratingReviewTouched) patch.review = review;
                await ratingService.updateRatingText(currentUser.uid, this.currentRatingId, patch);
            } else if (Number(this.currentRating) !== Number(this.originalRating) || !this.currentRatingId) {
                const reviewOptions = reviewChanged || this.ratingReviewTouched ? { review } : {};
                await ratingService.addOrUpdateRating(
                    currentUser.uid, displayName, userProfile?.photoURL || '',
                    this.selectedMovie.kinopoiskId, this.currentRating,
                    comment, this.selectedMovie, reviewOptions
                );
            }
            
            this.closeRatingModal();
            if (typeof Utils !== 'undefined') Utils.showToast('Оценка сохранена!', 'success');
            // The ratings listener patches the review list live; a full page reload
            // would reset scroll and drop render-bound enrichments.
            await this.loadPersonalState(this.selectedMovie.kinopoiskId);
        } catch (error) {
            console.error('Error saving rating:', error);
            this.showRatingReviewError(error.message || 'Не удалось сохранить рецензию.');
        }
    }

    getRatingTextLength(value) {
        const config = typeof globalThis !== 'undefined' ? globalThis.RatingConfig : null;
        return config?.getLength ? config.getLength(value) : Array.from(String(value || '').replace(/\r\n?/g, '\n')).length;
    }

    normalizeReviewForDisplay(value) {
        if (typeof Utils !== 'undefined' && typeof Utils.normalizeRatingReview === 'function') {
            return Utils.normalizeRatingReview(value);
        }
        return typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : '';
    }

    showRatingReviewError(message) {
        const error = this.elements.ratingReviewError;
        if (!error) return;
        error.textContent = message;
        error.hidden = false;
        this.elements.ratingReview?.setAttribute('aria-invalid', 'true');
    }

    clearRatingReviewError() {
        const error = this.elements.ratingReviewError;
        if (!error) return;
        error.textContent = '';
        error.hidden = true;
        this.elements.ratingReview?.removeAttribute('aria-invalid');
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
            const selectedRating = isHover ? this.currentRating : rating;
            btn.setAttribute('aria-pressed', String(selectedRating > 0 && starRating === selectedRating));
        });
        this.updateRatingStatus(rating, isHover);
    }

    updateRatingStatus(rating, isHover) {
        if (!this.elements.ratingStatus) return;

        const statusKey = rating > 0
            ? (isHover ? 'movie_details.rating_preview' : 'movie_details.rating_selected')
            : 'movie_details.rating_prompt';
        const template = i18n.get(statusKey);
        this.elements.ratingStatus.textContent = template.replace('{rating}', String(rating));
        this.elements.ratingStatus.dataset.state = rating > 0 ? (isHover ? 'preview' : 'selected') : 'empty';
    }

    // Video Player Methods
    getCachedSources(movieId, mediaType = null) {
        try {
            const data = localStorage.getItem(`movie_sources_${movieId}`);
            if (!data) return null;
            const cached = JSON.parse(data);
            const requestedType = mediaType ? String(mediaType).toLowerCase().replace(/_/g, '-') : null;
            const cachedType = cached.mediaType ? String(cached.mediaType).toLowerCase().replace(/_/g, '-') : null;
            if (requestedType && (!cachedType || cachedType !== requestedType)) {
                console.info('[KinogoSearchTrace] Ignoring source cache with incompatible media type', {
                    movieId,
                    requestedMediaType: requestedType,
                    cachedMediaType: cachedType,
                    cacheHasMediaType: Boolean(cachedType)
                });
                return null;
            }
            const defaultTtl = 15 * 60 * 1000; // 15 minutes aligned with balancer token lifespan
            const ttl = typeof cached.ttl === 'number' ? cached.ttl : defaultTtl;
            if (Date.now() - cached.timestamp > ttl) {
                localStorage.removeItem(`movie_sources_${movieId}`);
                return null;
            }
            return this.normalizeVideoSources(cached.sources || []);
        } catch { return null; }
    }

    async preloadSources(movie) {
        if (!movie) return;
        const requestedMediaType = movie.type || (movie.isSeries ? 'tv-series' : null);
        const cached = this.getCachedSources(movie.kinopoiskId, requestedMediaType);
        if (cached) { 
            this.currentSources = cached; 
            return; 
        }
        
        try {
            const movieType = requestedMediaType;
            console.log('[KinogoSearchTrace] preloadSources searchAll dispatch', {
                title: movie.name,
                year: movie.year || null,
                requestedMediaType: movieType,
                cacheKeyIncludesMediaType: true
            });
            const allSources = [];
            const pendingSourceTasks = [];
            const collectSources = async (result, parser) => {
                if (!parser || parser.getPlayerType() === 'custom') return;
                if (!(parser.supportsMedia?.(movie, movieType) ?? (!movieType || parser.supportsType(movieType)))) return;
                try {
                    const sources = await parser.cachedVideoSources(result);
                    if (!sources?.length) return;
                    sources.forEach(s => s.parserId = s.parserId || result.parserId);
                    allSources.push(...sources);

                    // Make the first usable partial result available to an
                    // immediate Watch click while keeping final ordering and
                    // cache persistence below unchanged.
                    if (this.selectedMovie?.kinopoiskId === movie.kinopoiskId) {
                        this.currentSources = this.normalizeVideoSources([
                            ...(this.currentSources || []),
                            ...sources
                        ]);
                    }
                } catch (e) {
                    console.warn(`[Player] ${parser.name} source discovery failed:`, e);
                }
            };
            await this.parserRegistry.searchAll(movie.name || movie.alternativeName, movie.year, {
                mediaType: movieType,
                fallbackTitle: movie.alternativeName,
                altName: movie.alternativeName || null,
                onResult: (result, parser) => {
                    pendingSourceTasks.push(collectSources(result, parser));
                }
            });
            await Promise.allSettled(pendingSourceTasks);
            const normalizedSources = this.normalizeVideoSources(allSources);
            if (normalizedSources.length > 0) {
                this.saveSourcesToCache(movie.kinopoiskId, normalizedSources, movieType);
                if (this.selectedMovie?.kinopoiskId === movie.kinopoiskId) {
                    this.currentSources = normalizedSources;
                }
            }
        } catch (e) { console.warn('[Player] Source discovery failed:', e); }
    }

    /**
     * Start source extraction as parser results arrive, but release the watch
     * path only when the highest-priority settled parser with usable sources
     * is known. This keeps provider priority deterministic without waiting for
     * unrelated slow parsers to finish their searches. After
     * `priorityDeadlineMs` a still-pending higher-priority parser no longer
     * blocks the watch path: the best already-ready parser is released instead.
     */
    startProgressiveSourceDiscovery(movie, { priorityDeadlineMs = 6000 } = {}) {
        const movieType = movie?.type || (movie?.isSeries ? 'tv-series' : null);
        const parsers = (this.parserRegistry?.getAll?.() || [])
            .filter(parser => parser?.getPlayerType?.() !== 'custom')
            .filter(parser => parser.supportsMedia?.(movie, movieType) ?? (!movieType || parser.supportsType?.(movieType)));
        const states = new Map(parsers.map(parser => [parser.id, {
            parser,
            searchSettled: false,
            sourceSettled: true,
            sources: []
        }]));
        const allSources = [];
        const sourceTasks = [];
        let firstResolved = false;
        let priorityDeadlinePassed = false;
        let priorityDeadlineTimer = null;
        let resolveFirstSources;
        const firstSources = new Promise(resolve => {
            resolveFirstSources = resolve;
        });
        const releaseFirstSources = (sources) => {
            firstResolved = true;
            if (priorityDeadlineTimer !== null) clearTimeout(priorityDeadlineTimer);
            priorityDeadlineTimer = null;
            resolveFirstSources(sources);
        };

        const resolveFirstIfReady = () => {
            if (firstResolved) return;
            for (const parser of parsers) {
                const state = states.get(parser.id);
                if (!state.searchSettled || !state.sourceSettled) {
                    // A slow mirror must not hold the watch path indefinitely.
                    if (!priorityDeadlinePassed) return;
                    continue;
                }
                if (state.sources.length > 0) {
                    releaseFirstSources(this.normalizeVideoSources(state.sources));
                    return;
                }
            }
            if (parsers.every(stateParser => {
                const state = states.get(stateParser.id);
                return state.searchSettled && state.sourceSettled;
            })) {
                releaseFirstSources([]);
            }
        };
        if (typeof setTimeout === 'function' && priorityDeadlineMs > 0) {
            priorityDeadlineTimer = setTimeout(() => {
                priorityDeadlineTimer = null;
                priorityDeadlinePassed = true;
                resolveFirstIfReady();
            }, priorityDeadlineMs);
        }

        const collectSources = async (result, parser) => {
            const state = states.get(parser.id);
            if (!state) return;
            state.sourceSettled = false;
            try {
                const sources = await parser.cachedVideoSources(result);
                const normalized = Array.isArray(sources) ? sources : [];
                normalized.forEach(source => {
                    source.parserId = source.parserId || result.parserId || parser.id;
                });
                state.sources = normalized;
                allSources.push(...normalized);
            } catch (error) {
                console.warn(`[Player] ${parser.name} source discovery failed:`, error);
                state.sources = [];
            } finally {
                state.sourceSettled = true;
                resolveFirstIfReady();
            }
        };

        const searchPromise = this.parserRegistry.searchAll(movie.name || movie.alternativeName, movie.year, {
            mediaType: movieType,
            fallbackTitle: movie.alternativeName,
            altName: movie.alternativeName || null,
            onResult: (result, parser) => {
                const state = states.get(parser.id);
                if (!state) return;
                state.sourceSettled = false;
                const sourceTask = collectSources(result, parser);
                sourceTasks.push(sourceTask);
            },
            onSettled: (result, parser) => {
                const state = states.get(parser.id);
                if (!state) return;
                state.searchSettled = true;
                if (!result) state.sourceSettled = true;
                resolveFirstIfReady();
            }
        }).catch(error => {
            console.warn('[Player] Progressive source search failed:', error);
            states.forEach(state => {
                state.searchSettled = true;
                state.sourceSettled = true;
            });
            resolveFirstIfReady();
            return [];
        });

        const finalize = searchPromise.then(async () => {
            await Promise.allSettled(sourceTasks);
            const normalizedSources = this.normalizeVideoSources(allSources);
            if (normalizedSources.length > 0) {
                this.saveSourcesToCache(movie.kinopoiskId, normalizedSources, movieType);
                if (this.selectedMovie?.kinopoiskId === movie.kinopoiskId) {
                    this.currentSources = normalizedSources;
                    this.populateSourceSelector();
                }
            }
            return normalizedSources;
        });

        resolveFirstIfReady();
        return { firstSources, finalize };
    }

    /**
     * Source lists expire after minutes but were only removed when the same
     * movie was opened again, so every visited title left a key behind. Drop
     * expired or unreadable entries and keep at most `maxEntries` newest ones.
     */
    pruneSourceCache({ maxEntries = 30, now = Date.now() } = {}) {
        try {
            const prefix = 'movie_sources_';
            const live = [];
            for (let index = localStorage.length - 1; index >= 0; index -= 1) {
                const key = localStorage.key(index);
                if (!key?.startsWith(prefix)) continue;
                let cached = null;
                try { cached = JSON.parse(localStorage.getItem(key)); } catch { /* unreadable */ }
                const timestamp = Number(cached?.timestamp);
                const ttl = typeof cached?.ttl === 'number' ? cached.ttl : 15 * 60 * 1000;
                if (!Number.isFinite(timestamp) || now - timestamp > ttl) {
                    localStorage.removeItem(key);
                } else {
                    live.push({ key, timestamp });
                }
            }
            live.sort((left, right) => right.timestamp - left.timestamp)
                .slice(maxEntries)
                .forEach(({ key }) => localStorage.removeItem(key));
        } catch { /* storage unavailable */ }
    }

    saveSourcesToCache(movieId, sources, mediaType = null) {
        try {
            const hasShortLivedTokens = Array.isArray(sources) && sources.some(s => {
                const u = s?.url || '';
                return u.includes('cinemar.cc') || u.includes('stravers.live') || u.includes('allarknow.online');
            });
            const ttl = hasShortLivedTokens ? (5 * 60 * 1000) : (15 * 60 * 1000);
            this.pruneSourceCache();
            localStorage.setItem(`movie_sources_${movieId}`, JSON.stringify({
                timestamp: Date.now(),
                ttl,
                mediaType: mediaType || null,
                sources
            }));
        } catch { /* Ignore */ }
    }

    updatePlayerHeaderTitle() {
        if (!this.elements?.videoTitle || !this.selectedMovie) return;
        const baseTitle = this.selectedMovie.nameRu || this.selectedMovie.name || 'Фильм';
        const selection = this.playbackController?.getSelection();
        const subtitleEl = this.elements?.videoSubtitle || (typeof document !== 'undefined' ? document.getElementById('videoSubtitle') : null);

        this.elements.videoTitle.textContent = baseTitle;

        if (selection && selection.seasonNumber != null && selection.episodeNumber != null) {
            let epText = `S${selection.seasonNumber}E${selection.episodeNumber}`;
            if (selection.episodeTitle) {
                epText += ` · ${selection.episodeTitle}`;
            }
            if (subtitleEl) {
                subtitleEl.textContent = epText;
                subtitleEl.style.display = 'block';
            }
        } else {
            if (subtitleEl) {
                subtitleEl.textContent = '';
                subtitleEl.style.display = 'none';
            }
        }

        this.updatePlayerNavigationControls();
    }

    resolveAdjacentEpisode(movie, selection, direction, options = {}) {
        if (!movie || !selection || !direction) return null;
        if (selection.mediaType === 'movie') return null;
        if (selection.seasonNumber == null || selection.episodeNumber == null) return null;

        const currentSeasonNum = Number(selection.seasonNumber);
        const currentEpNum = Number(selection.episodeNumber);
        if (!Number.isInteger(currentSeasonNum) || currentSeasonNum < 0) return null;
        if (!Number.isInteger(currentEpNum) || currentEpNum <= 0) return null;

        const playabilityCheck = options.isEpisodePlayableByDate || ((ep) => this.isEpisodePlayableByDate(ep));
        const seasons = Array.isArray(movie.seasons) ? movie.seasons : [];

        const getSeasonNum = (s) => Number(s.season_number ?? s.seasonNumber ?? s.number ?? -1);
        const getEpCount = (s) => Number(s.episode_count ?? s.episodeCount ?? s.episodesCount ?? s.episodes?.length ?? 0);

        // ==========================================
        // SPECIALS / SEASON 0 (PART 7: Isolated)
        // ==========================================
        if (currentSeasonNum === 0) {
            const season0 = seasons.find(s => getSeasonNum(s) === 0);
            let season0Count = season0 ? getEpCount(season0) : 0;
            if (options.loadedEpisodes && options.loadedSeasonNumber === 0) {
                season0Count = Math.max(season0Count, options.loadedEpisodes.length);
            }

            if (direction === 'previous') {
                if (currentEpNum > 1) {
                    const prevEpNum = currentEpNum - 1;
                    let epObj = null;
                    if (season0?.episodes) epObj = season0.episodes.find(e => Number(e.episode_number ?? e.episodeNumber ?? e.number) === prevEpNum);
                    else if (options.loadedEpisodes && options.loadedSeasonNumber === 0) epObj = options.loadedEpisodes.find(e => Number(e.episode_number ?? e.episodeNumber ?? e.number) === prevEpNum);
                    return {
                        seasonNumber: 0,
                        episodeNumber: prevEpNum,
                        episodeTitle: epObj?.name || epObj?.title || epObj?.nameRu || null,
                        airDate: epObj?.air_date || epObj?.airDate || null,
                        isReleased: true
                    };
                }
                return null;
            }

            if (direction === 'next') {
                if (season0Count > 0 && currentEpNum < season0Count) {
                    const nextEpNum = currentEpNum + 1;
                    let epObj = null;
                    if (season0?.episodes) epObj = season0.episodes.find(e => Number(e.episode_number ?? e.episodeNumber ?? e.number) === nextEpNum);
                    else if (options.loadedEpisodes && options.loadedSeasonNumber === 0) epObj = options.loadedEpisodes.find(e => Number(e.episode_number ?? e.episodeNumber ?? e.number) === nextEpNum);

                    if (epObj && !playabilityCheck(epObj)) return null;

                    return {
                        seasonNumber: 0,
                        episodeNumber: nextEpNum,
                        episodeTitle: epObj?.name || epObj?.title || epObj?.nameRu || null,
                        airDate: epObj?.air_date || epObj?.airDate || null,
                        isReleased: true
                    };
                }
                return null; // Specials do NOT jump to Season 1
            }
            return null;
        }

        // ==========================================
        // REGULAR SEASONS (SEASON >= 1)
        // ==========================================
        const regularSeasons = seasons
            .filter(s => getSeasonNum(s) > 0)
            .sort((a, b) => getSeasonNum(a) - getSeasonNum(b));

        const currentSeasonObj = regularSeasons.find(s => getSeasonNum(s) === currentSeasonNum);
        let currentSeasonEpCount = currentSeasonObj ? getEpCount(currentSeasonObj) : 0;
        if (options.loadedEpisodes && options.loadedSeasonNumber === currentSeasonNum) {
            currentSeasonEpCount = Math.max(currentSeasonEpCount, options.loadedEpisodes.length);
        }

        // ------------------------------------------
        // DIRECTION: PREVIOUS
        // ------------------------------------------
        if (direction === 'previous') {
            if (currentEpNum > 1) {
                // Same-season previous (Part 4)
                const targetEpNum = currentEpNum - 1;
                let epObj = null;
                if (currentSeasonObj?.episodes) {
                    epObj = currentSeasonObj.episodes.find(e => Number(e.episode_number ?? e.episodeNumber ?? e.number) === targetEpNum);
                } else if (options.loadedEpisodes && options.loadedSeasonNumber === currentSeasonNum) {
                    epObj = options.loadedEpisodes.find(e => Number(e.episode_number ?? e.episodeNumber ?? e.number) === targetEpNum);
                }

                return {
                    seasonNumber: currentSeasonNum,
                    episodeNumber: targetEpNum,
                    episodeTitle: epObj?.name || epObj?.title || epObj?.nameRu || null,
                    airDate: epObj?.air_date || epObj?.airDate || null,
                    isReleased: true
                };
            }

            // Cross-season previous (Part 6)
            if (currentEpNum === 1) {
                const prevSeasons = regularSeasons.filter(s => getSeasonNum(s) < currentSeasonNum);
                if (prevSeasons.length === 0) return null; // S1E1 has no previous

                const prevSeasonObj = prevSeasons[prevSeasons.length - 1];
                const prevSeasonNum = getSeasonNum(prevSeasonObj);
                const prevSeasonEpCount = getEpCount(prevSeasonObj);
                if (prevSeasonEpCount <= 0) return null;

                let epObj = null;
                if (prevSeasonObj.episodes) {
                    epObj = prevSeasonObj.episodes.find(e => Number(e.episode_number ?? e.episodeNumber ?? e.number) === prevSeasonEpCount);
                }

                return {
                    seasonNumber: prevSeasonNum,
                    episodeNumber: prevSeasonEpCount,
                    episodeTitle: epObj?.name || epObj?.title || epObj?.nameRu || null,
                    airDate: epObj?.air_date || epObj?.airDate || null,
                    isReleased: true
                };
            }

            return null;
        }

        // ------------------------------------------
        // DIRECTION: NEXT
        // ------------------------------------------
        if (direction === 'next') {
            // Same-season next (Part 3)
            if (currentSeasonEpCount > 0 && currentEpNum < currentSeasonEpCount) {
                const targetEpNum = currentEpNum + 1;
                let epObj = null;
                if (currentSeasonObj?.episodes) {
                    epObj = currentSeasonObj.episodes.find(e => Number(e.episode_number ?? e.episodeNumber ?? e.number) === targetEpNum);
                } else if (options.loadedEpisodes && options.loadedSeasonNumber === currentSeasonNum) {
                    epObj = options.loadedEpisodes.find(e => Number(e.episode_number ?? e.episodeNumber ?? e.number) === targetEpNum);
                }

                // Future episode check (Part 8 & 9)
                if (epObj && !playabilityCheck(epObj)) {
                    return null;
                }

                // Check against movie.nextEpisode if present
                if (movie.nextEpisode) {
                    const nextEpSeason = Number(movie.nextEpisode.season_number ?? movie.nextEpisode.seasonNumber);
                    const nextEpNum = Number(movie.nextEpisode.episode_number ?? movie.nextEpisode.episodeNumber);
                    if (nextEpSeason === currentSeasonNum && nextEpNum === targetEpNum) {
                        if (!playabilityCheck(movie.nextEpisode)) {
                            return null;
                        }
                    }
                }

                return {
                    seasonNumber: currentSeasonNum,
                    episodeNumber: targetEpNum,
                    episodeTitle: epObj?.name || epObj?.title || epObj?.nameRu || null,
                    airDate: epObj?.air_date || epObj?.airDate || null,
                    isReleased: true
                };
            }

            // Cross-season next (Part 5)
            if (currentSeasonEpCount > 0 && currentEpNum >= currentSeasonEpCount) {
                const nextSeasons = regularSeasons.filter(s => getSeasonNum(s) > currentSeasonNum);
                if (nextSeasons.length === 0) return null; // Last season of ended/current run

                const nextSeasonObj = nextSeasons[0];
                const nextSeasonNum = getSeasonNum(nextSeasonObj);
                const nextSeasonEpCount = getEpCount(nextSeasonObj);
                if (nextSeasonEpCount <= 0) return null;

                let epObj = null;
                if (nextSeasonObj.episodes) {
                    epObj = nextSeasonObj.episodes.find(e => Number(e.episode_number ?? e.episodeNumber ?? e.number) === 1);
                }

                if (epObj && !playabilityCheck(epObj)) {
                    return null;
                }

                if (movie.nextEpisode) {
                    const nextEpSeason = Number(movie.nextEpisode.season_number ?? movie.nextEpisode.seasonNumber);
                    const nextEpNum = Number(movie.nextEpisode.episode_number ?? movie.nextEpisode.episodeNumber);
                    if (nextEpSeason === nextSeasonNum && nextEpNum === 1) {
                        if (!playabilityCheck(movie.nextEpisode)) {
                            return null;
                        }
                    }
                }

                return {
                    seasonNumber: nextSeasonNum,
                    episodeNumber: 1,
                    episodeTitle: epObj?.name || epObj?.title || epObj?.nameRu || null,
                    airDate: epObj?.air_date || epObj?.airDate || null,
                    isReleased: true
                };
            }

            return null;
        }

        return null;
    }

    updatePlayerNavigationControls() {
        const navControls = (typeof document !== 'undefined' && typeof document.getElementById === 'function')
            ? document.getElementById('playerNavControls')
            : (this.elements?.playerNavControls || null);
        const prevBtn = (typeof document !== 'undefined' && typeof document.getElementById === 'function')
            ? document.getElementById('playerPrevEpisodeBtn')
            : (this.elements?.playerPrevEpisodeBtn || null);
        const nextBtn = (typeof document !== 'undefined' && typeof document.getElementById === 'function')
            ? document.getElementById('playerNextEpisodeBtn')
            : (this.elements?.playerNextEpisodeBtn || null);
        const episodesListBtn = (typeof document !== 'undefined' && typeof document.getElementById === 'function')
            ? document.getElementById('playerEpisodesListBtn')
            : (this.elements?.playerEpisodesListBtn || null);

        const hideEpisodePickerButton = () => {
            if (!episodesListBtn) return;
            episodesListBtn.style.display = 'none';
            episodesListBtn.setAttribute('aria-expanded', 'false');
            episodesListBtn.classList.remove('active');
        };

        if (!navControls) return;

        const movie = this.selectedMovie;
        if (!movie) {
            navControls.style.display = 'none';
            hideEpisodePickerButton();
            return;
        }

        const isSeries = Boolean(movie.isSeries || (movie.type && ['tv-series', 'mini-series', 'animated-series', 'tv'].includes(movie.type)));
        const selection = this.playbackController?.getSelection();
        const navigationPending = Boolean(this.playerEpisodeNavigationPending);

        const activeProviderId = this.playbackController?.getActiveProvider() || this.activePlayerId;
        const activeAdapter = activeProviderId
            ? (this.playbackController?.getAdapter(activeProviderId) || this.providerAdapters?.[activeProviderId])
            : null;
        const activeIframe = this.elements.videoContainer?.querySelector?.('iframe[data-player-source-active="true"]')
            || this.elements.videoContainer?.querySelector?.('iframe');
        const activeIframeUrl = activeIframe?.src || activeIframe?.getAttribute?.('src') || null;
        const providerMarkedUnavailable = Boolean(activeProviderId && this.unavailableProviderIds?.has(activeProviderId));
        const nativeBridgeSourceAvailable = activeProviderId !== 'kinogo'
            || !activeAdapter
            || typeof activeAdapter.supportsNativeBridgeSource !== 'function'
            || activeAdapter.supportsNativeBridgeSource(activeIframeUrl);
        console.info('[ExFsBridgeTrace] navigation capability', {
            activeProviderId,
            activePlayerId: this.activePlayerId,
            adapterId: activeAdapter?.id || null,
            activeIframeUrl,
            providerMarkedUnavailable,
            nativeBridgeSourceAvailable,
            selection,
            selectionMode: typeof activeAdapter?.getSelectionMode === 'function'
                ? activeAdapter.getSelectionMode()
                : null,
            supportsEpisodePicker: typeof activeAdapter?.supportsEpisodePicker === 'function'
                ? activeAdapter.supportsEpisodePicker()
                : null,
            iframeCount: this.elements.videoContainer?.querySelectorAll?.('iframe')?.length || 0
        });
        this._canonicalPickerSyncTimers?.forEach(timer => clearTimeout(timer));
        this._canonicalPickerSyncTimers = [];
        // Canonical picker mode forces the provider's episode arrows on, so it
        // must stay off for films.
        if (isSeries && activeAdapter && ['exfs', 'kinogo'].includes(activeProviderId) && nativeBridgeSourceAvailable && !providerMarkedUnavailable) {

            const dispatchCanonicalPickerMode = () => {
                const iframes = Array.from(this.elements.videoContainer?.querySelectorAll?.('iframe') || []);
                const selectionContext = this.playbackController?.getSelectionContext?.() || {
                    selection,
                    selectionVersion: null
                };
                console.info('[ExFsBridgeTrace] canonical picker dispatch', {
                    provider: activeProviderId,
                    iframeCount: iframes.length,
                    frames: iframes.map((iframe, index) => ({
                        index,
                        src: iframe.src || iframe.getAttribute?.('src') || null,
                        readyState: iframe.contentDocument?.readyState || 'cross-origin',
                        hasContentWindow: Boolean(iframe.contentWindow)
                    }))
                });
                iframes.forEach((iframe, index) => {
                    const enableCanonicalPicker = () => {
                        try {
                            this.postToPlayerFrame(iframe, {
                                type: 'SET_CANONICAL_PICKER_MODE',
                                enabled: true,
                                providerId: activeProviderId,
                                seasonNumber: selectionContext.selection?.seasonNumber ?? null,
                                episodeNumber: selectionContext.selection?.episodeNumber ?? null,
                                selectionVersion: selectionContext.selectionVersion ?? null
                            });
                            console.info('[ExFsBridgeTrace] canonical picker message sent', {
                                provider: activeProviderId,
                                iframeIndex: index,
                                src: iframe.src || iframe.getAttribute?.('src') || null
                            });
                        } catch {
                            console.warn('[ExFsBridgeTrace] canonical picker message failed', {
                                provider: activeProviderId,
                                iframeIndex: index,
                                src: iframe.src || iframe.getAttribute?.('src') || null
                            });
                            // Cross-origin postMessage is intentionally best-effort.
                        }
                    };
                    enableCanonicalPicker();
                    iframe.addEventListener?.('load', enableCanonicalPicker, { once: true });
                });
            };

            // The provider iframe is often inserted after the first navigation
            // render. Query the container again on each retry instead of
            // capturing an empty iframe list from the initial render.
            dispatchCanonicalPickerMode();
            [250, 750, 1500, 3000].forEach(delay => {
                this._canonicalPickerSyncTimers.push(
                    setTimeout(dispatchCanonicalPickerMode, delay)
                );
            });
        }
        const supportsPrevNext = activeAdapter && typeof activeAdapter.supportsPrevNext === 'function'
            ? !providerMarkedUnavailable && nativeBridgeSourceAvailable && activeAdapter.supportsPrevNext() && (typeof activeAdapter.canHandle !== 'function' || activeAdapter.canHandle(selection))
            : false;
        const supportsPicker = (activeAdapter && typeof activeAdapter.supportsEpisodePicker === 'function')
            ? !providerMarkedUnavailable && nativeBridgeSourceAvailable && activeAdapter.supportsEpisodePicker() && (typeof activeAdapter.canHandle !== 'function' || activeAdapter.canHandle(selection))
            : ((activeAdapter && typeof activeAdapter.supportsDirectSeasonEpisode === 'function')
                ? !providerMarkedUnavailable && nativeBridgeSourceAvailable && activeAdapter.supportsDirectSeasonEpisode() && (typeof activeAdapter.canHandle !== 'function' || activeAdapter.canHandle(selection))
                : false);

        console.info('[ExFsBridgeTrace] navigation visibility decision', {
            provider: activeProviderId,
            isSeries,
            hasSelection: Boolean(selection),
            supportsPrevNext,
            supportsPicker,
            showNavigation: isSeries
                && Boolean(selection)
                && selection.seasonNumber != null
                && selection.episodeNumber != null
                && (supportsPrevNext || supportsPicker)
        });

        if (!isSeries || !selection || selection.seasonNumber == null || selection.episodeNumber == null
            || (!supportsPrevNext && !supportsPicker)) {
            navControls.style.display = 'none';
            hideEpisodePickerButton();
            return;
        }

        navControls.style.display = 'flex';
        if (prevBtn) prevBtn.style.display = supportsPrevNext ? '' : 'none';
        if (nextBtn) nextBtn.style.display = supportsPrevNext ? '' : 'none';

        const loadedEpisodes = this.currentEpisodes || null;
        const loadedSeasonNumber = this.selectedSeasonNumber || null;

        const prevAdjacent = this.resolveAdjacentEpisode(movie, selection, 'previous', {
            loadedEpisodes,
            loadedSeasonNumber,
            isEpisodePlayableByDate: (ep) => this.isEpisodePlayableByDate(ep)
        });

        const nextAdjacent = this.resolveAdjacentEpisode(movie, selection, 'next', {
            loadedEpisodes,
            loadedSeasonNumber,
            isEpisodePlayableByDate: (ep) => this.isEpisodePlayableByDate(ep)
        });

        if (prevBtn) {
            if (prevAdjacent) {
                prevBtn.disabled = navigationPending;
                const prevTitle = prevAdjacent.episodeTitle ? ` · ${prevAdjacent.episodeTitle}` : '';
                prevBtn.setAttribute('aria-label', `Смотреть предыдущую серию S${prevAdjacent.seasonNumber}E${prevAdjacent.episodeNumber}${prevTitle}`);
                prevBtn.title = `Предыдущая: S${prevAdjacent.seasonNumber}E${prevAdjacent.episodeNumber}`;
            } else {
                prevBtn.disabled = true;
                prevBtn.setAttribute('aria-label', 'Предыдущая серия недоступна');
                prevBtn.title = 'Предыдущая серия недоступна';
            }
        }

        if (nextBtn) {
            if (nextAdjacent) {
                nextBtn.disabled = navigationPending;
                const nextTitle = nextAdjacent.episodeTitle ? ` · ${nextAdjacent.episodeTitle}` : '';
                nextBtn.setAttribute('aria-label', `Смотреть следующую серию S${nextAdjacent.seasonNumber}E${nextAdjacent.episodeNumber}${nextTitle}`);
                nextBtn.title = `Следующая: S${nextAdjacent.seasonNumber}E${nextAdjacent.episodeNumber}`;
            } else {
                nextBtn.disabled = true;
                nextBtn.setAttribute('aria-label', 'Следующая серия недоступна');
                nextBtn.title = 'Следующая серия недоступна';
            }
        }

        if (episodesListBtn) {
            if (isSeries && supportsPicker) {
                episodesListBtn.style.display = 'inline-flex';
                episodesListBtn.setAttribute('aria-expanded', String(Boolean(this.isEpisodePickerOpen)));
                if (this.isEpisodePickerOpen) {
                    episodesListBtn.classList.add('active');
                } else {
                    episodesListBtn.classList.remove('active');
                }
            } else {
                episodesListBtn.style.display = 'none';
            }
        }
    }

    toggleEpisodePicker(forceState) {
        const targetState = typeof forceState === 'boolean' ? forceState : !this.isEpisodePickerOpen;
        if (targetState) {
            this.openEpisodePicker();
        } else {
            this.closeEpisodePicker();
        }
    }

    openEpisodePicker() {
        const popover = (typeof document !== 'undefined' && typeof document?.getElementById === 'function')
            ? document.getElementById('playerEpisodePickerPopover')
            : (this.elements?.playerEpisodePickerPopover || null);
        const listBtn = (typeof document !== 'undefined' && typeof document?.getElementById === 'function')
            ? document.getElementById('playerEpisodesListBtn')
            : (this.elements?.playerEpisodesListBtn || null);
        if (!popover) return;

        this.isEpisodePickerOpen = true;
        popover.style.display = 'flex';
        if (listBtn) {
            listBtn.setAttribute('aria-expanded', 'true');
            listBtn.classList.add('active');
        }

        const selection = this.playbackController?.getSelection();
        this.pickerBrowsingSeasonNumber = selection?.seasonNumber || this.selectedSeasonNumber || 1;
        this.renderEpisodePickerContent();
    }

    closeEpisodePicker() {
        const popover = (typeof document !== 'undefined' && typeof document?.getElementById === 'function')
            ? document.getElementById('playerEpisodePickerPopover')
            : (this.elements?.playerEpisodePickerPopover || null);
        const listBtn = (typeof document !== 'undefined' && typeof document?.getElementById === 'function')
            ? document.getElementById('playerEpisodesListBtn')
            : (this.elements?.playerEpisodesListBtn || null);
        if (popover) {
            popover.style.display = 'none';
        }
        if (listBtn) {
            listBtn.setAttribute('aria-expanded', 'false');
            listBtn.classList.remove('active');
        }
        this.isEpisodePickerOpen = false;
    }

    async renderEpisodePickerContent() {
        const seasonsSection = (typeof document !== 'undefined' && typeof document?.getElementById === 'function')
            ? document.getElementById('pickerSeasonsSection')
            : (this.elements?.pickerSeasonsSection || null);
        const seasonsList = (typeof document !== 'undefined' && typeof document?.getElementById === 'function')
            ? document.getElementById('pickerSeasonsList')
            : (this.elements?.pickerSeasonsList || null);
        const episodesList = (typeof document !== 'undefined' && typeof document?.getElementById === 'function')
            ? document.getElementById('pickerEpisodesList')
            : (this.elements?.pickerEpisodesList || null);
        if (!episodesList) return;

        const selection = this.playbackController?.getSelection();
        const activePlayingSeason = selection?.seasonNumber || 1;
        const activePlayingEpisode = selection?.episodeNumber || 1;
        const browsingSeason = Number(this.pickerBrowsingSeasonNumber || activePlayingSeason) || 1;
        const seasonvarEntry = this.playerRegistry?.seasonvar;
        const seasonvarRegistrySeasons = seasonvarEntry?.renderOptions?.seasons || [];
        const normalizePickerSeason = (season, index = 0) => {
            const seasonNumber = Number(
                season?.seasonNumber
                ?? season?.season_number
                ?? season?.number
                ?? index + 1
            );
            const episodeCount = Number(
                season?.episodeCount
                ?? season?.episode_count
                ?? season?.episodes_count
                ?? season?.episodesCount
                ?? season?.episodes?.length
                ?? 0
            );
            return {
                ...season,
                seasonNumber,
                episodeCount,
                name: season?.name || `${seasonNumber} сезон`,
                url: season?.url || null
            };
        };
        const rawSeasonvarSeasons = this.currentSeasonvarPlaybackState?.seasons?.length
            ? this.currentSeasonvarPlaybackState.seasons
            : seasonvarRegistrySeasons;
        const seasonvarSeasons = rawSeasonvarSeasons.map(normalizePickerSeason);
        const loadedSeasonNumber = Number(seasonvarEntry?.sourcesSeasonNumber);
        const activeProvider = this.playbackController?.getActiveProvider?.() || this.activePlayerId;
        const useLoadedEpisodeSources = String(activeProvider || '').toLowerCase() === 'seasonvar';

        console.info('[SeasonPickerTrace] Picker season normalization', {
            activeProvider,
            browsingSeason,
            source: this.currentSeasonvarPlaybackState?.seasons?.length
                ? 'playback-state'
                : seasonvarRegistrySeasons.length
                    ? 'seasonvar-registry'
                    : 'movie-metadata',
            seasons: seasonvarSeasons.map(season => ({
                seasonNumber: season.seasonNumber,
                episodeCount: season.episodeCount,
                hasUrl: Boolean(season.url),
                name: season.name
            }))
        });

        // 1. Render Seasons
        let seasons = [];
        if (seasonvarSeasons.length) {
            seasons = seasonvarSeasons;
        } else if (
            this.selectedMovie?.seasons?.length
            && !seasonvarSeasons.some(s => Number(s.seasonNumber) === Number(browsingSeason) && s.url)
        ) {
            seasons = this.selectedMovie.seasons.map(s => ({
                seasonNumber: s.number || s.seasonNumber,
                name: `${s.number || s.seasonNumber} сезон`,
                url: null
            }));
        }

        if (seasonsList && seasonsSection) {
            if (seasons.length > 1) {
                seasonsSection.style.display = 'flex';
                seasonsList.innerHTML = seasons.map(s => {
                    const isSelected = Number(s.seasonNumber) === browsingSeason;
                    return `<button type="button" class="picker-season-btn ${isSelected ? 'active' : ''}" data-season-number="${s.seasonNumber}" data-season-url="${s.url || ''}" aria-pressed="${isSelected}">${s.name || `${s.seasonNumber} сезон`}</button>`;
                }).join('');

                const activeSeasonButton = seasonsList.querySelector('.picker-season-btn.active');
                if (activeSeasonButton) {
                    const listBounds = seasonsList.getBoundingClientRect();
                    const buttonBounds = activeSeasonButton.getBoundingClientRect();
                    if (buttonBounds.left < listBounds.left) {
                        seasonsList.scrollLeft -= listBounds.left - buttonBounds.left;
                    } else if (buttonBounds.right > listBounds.right) {
                        seasonsList.scrollLeft += buttonBounds.right - listBounds.right;
                    }
                }

                seasonsList.querySelectorAll('.picker-season-btn').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        const sNum = Number(btn.getAttribute('data-season-number'));
                        const sUrl = btn.getAttribute('data-season-url');
                        await this.onPickerSeasonClick(sNum, sUrl);
                    });
                });
            } else {
                seasonsSection.style.display = 'none';
            }
        }

        // 2. Render Episodes for browsingSeason
        let episodes = [];
        if (browsingSeason === (this.currentSeasonvarPlaybackState?.activeSeasonNumber || activePlayingSeason) && this.currentSeasonvarPlaybackState?.episodes?.length) {
            episodes = this.currentSeasonvarPlaybackState.episodes;
        } else if (useLoadedEpisodeSources
            && this.currentEpisodes?.length
            && loadedSeasonNumber === Number(browsingSeason)) {
            episodes = this.currentEpisodes.map((ep, i) => ({
                episodeNumber: ep.episodeNumber || i + 1,
                name: ep.nameRu || ep.name || `${ep.episodeNumber || i + 1} серия`,
                url: null
            }));
        } else if (
            this.selectedMovie?.seasons?.length
            && !seasonvarSeasons.some(s => Number(s.seasonNumber) === Number(browsingSeason) && s.url)
        ) {
            const matchedSeason = this.selectedMovie.seasons.find(s => (s.number || s.seasonNumber) === browsingSeason);
            if (matchedSeason) {
                if (matchedSeason.episodes?.length) {
                    episodes = matchedSeason.episodes.map((ep, i) => ({
                        episodeNumber: ep.episodeNumber || ep.number || i + 1,
                        name: ep.nameRu || ep.name || `${ep.episodeNumber || ep.number || i + 1} серия`,
                        url: null
                    }));
                } else if (matchedSeason.episodeCount > 0) {
                    episodes = Array.from({ length: matchedSeason.episodeCount }, (_, i) => ({
                        episodeNumber: i + 1,
                        name: `${i + 1} серия`,
                        url: null
                    }));
                }
            }
        }

        if (!episodes.length && !useLoadedEpisodeSources) {
            const providerSeason = seasonvarSeasons.find(
                season => season.seasonNumber === browsingSeason
            );
            if (providerSeason?.episodeCount > 0) {
                episodes = Array.from({ length: providerSeason.episodeCount }, (_, i) => ({
                    episodeNumber: i + 1,
                    name: `${i + 1} серия`,
                    url: null
                }));
                console.info('[SeasonPickerTrace] Provider-independent episode fallback', {
                    activeProvider,
                    browsingSeason,
                    episodeCount: providerSeason.episodeCount,
                    source: 'seasonvar-metadata'
                });
            }
        }

        // Providers that number episodes themselves (AnimeGo) supply the list
        // when the catalog has none, plus filler marks for the picker.
        const providerEpisodes = await this.loadProviderSeasonEpisodes?.(browsingSeason) || null;
        if ((Number(this.pickerBrowsingSeasonNumber || activePlayingSeason) || 1) !== browsingSeason) return;
        if (!episodes.length && providerEpisodes?.length) {
            episodes = providerEpisodes.map(ep => ({
                episodeNumber: ep.episodeNumber,
                name: `${ep.episodeNumber} серия`,
                url: null
            }));
        }

        if (episodes.length > 0) {
            console.groupCollapsed?.('[SeasonPickerTrace] Render episode list');
            console.log('[SeasonPickerTrace] Context', {
                browsingSeason,
                activePlayingSeason,
                activePlayingEpisode,
                pickerBrowsingSeasonNumber: this.pickerBrowsingSeasonNumber,
                canonicalSelection: this.playbackController?.getSelection(),
                stateSeason: this.currentSeasonvarPlaybackState?.activeSeasonNumber,
                stateEpisodeCount: this.currentSeasonvarPlaybackState?.episodes?.length || 0,
                registrySeason: seasonvarEntry?.sourcesSeasonNumber,
                registryEpisodeCount: seasonvarEntry?.sources?.length || 0,
                selectedSeasonNumber: this.selectedSeasonNumber,
                episodeCount: episodes.length,
                episodeNumbers: episodes.map(ep => ep.episodeNumber)
            });
            console.groupEnd?.();
            this.renderPickerEpisodeButtons(episodes, activePlayingSeason, activePlayingEpisode, browsingSeason);
        } else {
            // Need to fetch season playlist on demand
            const targetSeasonObj = seasonvarSeasons.find(s => Number(s.seasonNumber) === Number(browsingSeason));
            const seasonvarParser = this.parserRegistry?.get?.('seasonvar')
                || (typeof SeasonvarParser !== 'undefined' ? new SeasonvarParser() : null);
            if (targetSeasonObj?.url && seasonvarParser) {
                episodesList.innerHTML = '<div style="padding: 12px; font-size: 12px; color: var(--theme-text-muted); text-align: center;">Загрузка серий...</div>';
                try {
                    const seriesInfo = await seasonvarParser.getSeriesInfo(targetSeasonObj.url);
                    if (this.pickerBrowsingSeasonNumber === browsingSeason && seriesInfo?.episodes) {
                        const extractEp = (ep) => (seasonvarParser.extractEpisodeNumber
                            ? seasonvarParser.extractEpisodeNumber(ep)
                            : (typeof SeasonvarParser !== 'undefined' && SeasonvarParser.extractEpisodeNumber
                                ? SeasonvarParser.extractEpisodeNumber(ep)
                                : null));
                        const fetchedEps = seriesInfo.episodes.map(ep => ({
                            name: ep.title,
                            episodeNumber: extractEp(ep),
                            url: ep.url
                        }));
                        this.renderPickerEpisodeButtons(fetchedEps, activePlayingSeason, activePlayingEpisode, browsingSeason);
                    }
                } catch (err) {
                    console.error('[MovieDetails] Failed to load season episodes for picker:', err);
                    episodesList.innerHTML = '<div style="padding: 12px; font-size: 12px; color: #ef4444; text-align: center;">Не удалось загрузить серии</div>';
                }
            } else {
                episodesList.innerHTML = '<div style="padding: 12px; font-size: 12px; color: var(--theme-text-muted); text-align: center;">Нет данных о сериях</div>';
            }
        }
    }

    renderPickerEpisodeButtons(episodes, activePlayingSeason, activePlayingEpisode, browsingSeason, { focus = true } = {}) {
        const byId = id => ((typeof document !== 'undefined' && typeof document?.getElementById === 'function')
            ? document.getElementById(id)
            : (this.elements?.[id] || null));
        const episodesList = byId('pickerEpisodesList');
        if (!episodesList) return;

        const list = Array.isArray(episodes) ? episodes : [];
        this.pickerEpisodeContext = { episodes: list, activePlayingSeason, activePlayingEpisode, browsingSeason };
        const isPlayingSeason = browsingSeason === activePlayingSeason;

        // Long seasons (AnimeGo's 500-episode titles) are browsed in ranges.
        const ranges = this.buildPickerEpisodeRanges(list);
        let rangeIndex = 0;
        if (ranges.length > 1) {
            const stored = this.pickerEpisodeRange;
            if (stored?.seasonNumber === browsingSeason && stored.index < ranges.length) {
                rangeIndex = stored.index;
            } else if (isPlayingSeason) {
                const playingRange = ranges.findIndex(range => range.episodes.some(ep => ep.episodeNumber === activePlayingEpisode));
                if (playingRange >= 0) rangeIndex = playingRange;
            }
            this.pickerEpisodeRange = { seasonNumber: browsingSeason, index: rangeIndex };
        }
        const visibleEpisodes = ranges.length > 1 ? ranges[rangeIndex].episodes : list;
        this.renderPickerEpisodeRanges(ranges, rangeIndex, byId('pickerEpisodeRanges'));
        this.updatePickerEpisodeHeader(list, isPlayingSeason ? activePlayingEpisode : null, byId);

        const escape = value => String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        const fillerEpisodes = this.getProviderFillerEpisodes?.(browsingSeason) || null;
        const history = this.currentEpisodeHistory || {};
        episodesList.innerHTML = visibleEpisodes.map(ep => {
            const isPlaying = isPlayingSeason && (ep.episodeNumber === activePlayingEpisode);
            const isFiller = Boolean(fillerEpisodes?.has(Number(ep.episodeNumber)));
            const isWatched = Boolean(history[`${browsingSeason}:${ep.episodeNumber}`]);
            const notes = [isFiller ? 'филлер' : null, isWatched ? 'просмотрена' : null].filter(Boolean);
            const title = `${ep.name || `${ep.episodeNumber} серия`}${notes.length ? ` · ${notes.join(', ')}` : ''}`;
            const labelAttr = notes.length ? ` aria-label="Серия ${escape(ep.episodeNumber)}, ${notes.join(', ')}"` : '';
            const classes = [
                'picker-episode-btn',
                isPlaying ? 'picker-episode-btn--active' : '',
                isFiller ? 'picker-episode-btn--filler' : '',
                isWatched ? 'picker-episode-btn--watched' : ''
            ].filter(Boolean).join(' ');
            const fillerBadge = isFiller ? '<span class="picker-episode-btn__filler" aria-hidden="true">F</span>' : '';
            const watchedBadge = isWatched
                ? '<span class="picker-episode-btn__watched" aria-hidden="true"><svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></span>'
                : '';
            return `<button type="button" class="${classes}" data-season-number="${browsingSeason}" data-episode-number="${escape(ep.episodeNumber)}" aria-current="${isPlaying ? 'true' : 'false'}" title="${escape(title)}"${labelAttr}>${escape(ep.episodeNumber)}${fillerBadge}${watchedBadge}</button>`;
        }).join('');

        episodesList.querySelectorAll('.picker-episode-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const seasonNum = Number(btn.getAttribute('data-season-number'));
                const epNum = Number(btn.getAttribute('data-episode-number'));
                await this.onPickerEpisodeClick(epNum, seasonNum);
            });
        });

        if (!focus) return;
        // Focus currently playing or first episode
        const activeBtn = episodesList.querySelector('.picker-episode-btn--active') || episodesList.querySelector('.picker-episode-btn');
        if (activeBtn) {
            try { activeBtn.focus(); } catch { /* ignore */ }
        }
    }

    /**
     * Split a season into ranges of PICKER_EPISODE_RANGE_SIZE episodes.
     * @param {Array<{episodeNumber: number}>} episodes
     * @returns {Array<{label: string, episodes: Array}>}
     */
    buildPickerEpisodeRanges(episodes) {
        const list = Array.isArray(episodes) ? episodes : [];
        if (list.length <= PICKER_EPISODE_RANGE_SIZE) return [{ label: '', episodes: list }];
        const ranges = [];
        for (let start = 0; start < list.length; start += PICKER_EPISODE_RANGE_SIZE) {
            const chunk = list.slice(start, start + PICKER_EPISODE_RANGE_SIZE);
            ranges.push({ label: `${chunk[0].episodeNumber}–${chunk[chunk.length - 1].episodeNumber}`, episodes: chunk });
        }
        return ranges;
    }

    renderPickerEpisodeRanges(ranges, activeIndex, container) {
        if (!container) return;
        if (!Array.isArray(ranges) || ranges.length <= 1) {
            container.hidden = true;
            container.innerHTML = '';
            return;
        }
        container.hidden = false;
        container.innerHTML = ranges.map((range, index) => {
            const isActive = index === activeIndex;
            return `<button type="button" class="picker-range-btn${isActive ? ' picker-range-btn--active' : ''}" data-range-index="${index}" aria-pressed="${isActive}">${range.label}</button>`;
        }).join('');
        container.querySelectorAll('.picker-range-btn').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                const context = this.pickerEpisodeContext;
                if (!context) return;
                this.pickerEpisodeRange = { seasonNumber: context.browsingSeason, index: Number(button.dataset.rangeIndex) };
                this.renderPickerEpisodeButtons(
                    context.episodes,
                    context.activePlayingSeason,
                    context.activePlayingEpisode,
                    context.browsingSeason,
                    { focus: false }
                );
                container.querySelector(`[data-range-index="${button.dataset.rangeIndex}"]`)?.focus?.();
            });
        });
    }

    updatePickerEpisodeHeader(episodes, playingEpisode, byId) {
        const list = Array.isArray(episodes) ? episodes : [];
        const label = byId('pickerEpisodesLabel');
        if (label) {
            const isListed = playingEpisode != null && list.some(ep => ep.episodeNumber === playingEpisode);
            label.textContent = isListed
                ? `Серия ${playingEpisode} из ${list.length}`
                : (list.length ? `Серий: ${list.length}` : 'Серия');
        }

        const input = byId('pickerEpisodeSearch');
        if (!input) return;
        const searchWrapper = input.closest?.('.player-episode-picker__search') || input;
        searchWrapper.hidden = list.length <= PICKER_EPISODE_SEARCH_MIN_COUNT;
        const hint = byId('pickerEpisodeSearchHint');
        if (hint && searchWrapper.hidden) hint.hidden = true;
        if (input.dataset.pickerSearchBound) return;
        input.dataset.pickerSearchBound = 'true';
        input.addEventListener('input', () => this.onPickerEpisodeSearch(input.value, { submit: false }));
        input.addEventListener('keydown', event => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            event.stopPropagation();
            void this.onPickerEpisodeSearch(input.value, { submit: true });
        });
    }

    /**
     * Search by episode number: typing reveals and marks the episode,
     * Enter plays it. A missing number shows a hint and does nothing else.
     */
    async onPickerEpisodeSearch(value, { submit = false } = {}) {
        const byId = id => ((typeof document !== 'undefined' && typeof document?.getElementById === 'function')
            ? document.getElementById(id)
            : (this.elements?.[id] || null));
        const context = this.pickerEpisodeContext;
        const hint = byId('pickerEpisodeSearchHint');
        const episodesList = byId('pickerEpisodesList');
        episodesList?.querySelectorAll?.('.picker-episode-btn--match').forEach(btn => btn.classList.remove('picker-episode-btn--match'));

        const number = Number.parseInt(String(value || '').trim(), 10);
        if (!context || !Number.isFinite(number)) {
            if (hint) hint.hidden = true;
            return false;
        }
        const episode = context.episodes.find(ep => Number(ep.episodeNumber) === number);
        if (!episode) {
            if (hint) {
                hint.textContent = 'Такой серии нет';
                hint.hidden = false;
            }
            return false;
        }
        if (hint) hint.hidden = true;
        if (submit) {
            await this.onPickerEpisodeClick(number, context.browsingSeason);
            return true;
        }

        const ranges = this.buildPickerEpisodeRanges(context.episodes);
        const rangeIndex = ranges.findIndex(range => range.episodes.includes(episode));
        if (ranges.length > 1 && rangeIndex >= 0 && this.pickerEpisodeRange?.index !== rangeIndex) {
            this.pickerEpisodeRange = { seasonNumber: context.browsingSeason, index: rangeIndex };
            this.renderPickerEpisodeButtons(
                context.episodes,
                context.activePlayingSeason,
                context.activePlayingEpisode,
                context.browsingSeason,
                { focus: false }
            );
        }
        const button = byId('pickerEpisodesList')?.querySelector?.(`.picker-episode-btn[data-episode-number="${number}"]`);
        if (button) {
            button.classList.add('picker-episode-btn--match');
            try { button.scrollIntoView?.({ block: 'nearest' }); } catch { /* ignore */ }
        }
        return true;
    }

    async onPickerSeasonClick(seasonNumber, seasonUrl) {
        console.log('[SeasonPickerTrace] Season clicked', {
            requestedSeason: Number(seasonNumber),
            seasonUrl,
            previousBrowsingSeason: this.pickerBrowsingSeasonNumber,
            canonicalSelection: this.playbackController?.getSelection()
        });
        if (this.pickerBrowsingSeasonNumber === seasonNumber) return;
        this.pickerBrowsingSeasonNumber = seasonNumber;
        await this.renderEpisodePickerContent();
    }

    async onPickerEpisodeClick(episodeNumber, explicitSeasonNumber = null) {
        const movie = this.selectedMovie;
        const currentSel = this.playbackController?.getSelection();
        if (!movie || !currentSel) return;

        const targetSeason = Number(explicitSeasonNumber) > 0
            ? Number(explicitSeasonNumber)
            : (this.pickerBrowsingSeasonNumber || currentSel.seasonNumber || 1);

        console.log('[SeasonPickerTrace] Episode clicked', {
            requestedSeason: targetSeason,
            requestedEpisode: Number(episodeNumber),
            explicitSeasonNumber,
            pickerBrowsingSeasonNumber: this.pickerBrowsingSeasonNumber,
            canonicalBefore: currentSel
        });
        
        this.closeEpisodePicker();

        const newSelection = {
            kinopoiskId: movie.kinopoiskId,
            tmdbId: movie.tmdbId || currentSel.tmdbId,
            imdbId: movie.externalId?.imdb || movie.imdbId || currentSel.imdbId,
            title: movie.nameRu || movie.name || currentSel.title,
            mediaType: currentSel.mediaType || 'tv-series',
            seasonNumber: targetSeason,
            episodeNumber: episodeNumber,
            initialTimestamp: 0,
            source: 'PLAYER_PROVIDER_PICKER'
        };

        console.log('[SeasonPickerTrace] Selection dispatched', newSelection);

        try {
            await this.playSelection(newSelection);
        } catch (err) {
            console.error('[MovieDetails] onPickerEpisodeClick failed:', err);
        }

        const listBtn = (typeof document !== 'undefined' && typeof document?.getElementById === 'function')
            ? document.getElementById('playerEpisodesListBtn')
            : (this.elements?.playerEpisodesListBtn || null);
        if (listBtn) {
            try { listBtn.focus(); } catch { /* ignore */ }
        }
    }

    async requestPlayerEpisodeNavigation(direction) {
        if (direction !== 'previous' && direction !== 'next') return false;
        if (this.playerEpisodeNavigationPending) return false;

        this.playerEpisodeNavigationPending = true;
        this.updatePlayerNavigationControls();
        try {
            return await this.handlePlayerNavigate(direction);
        } catch (error) {
            console.error('[MovieDetails] Episode navigation failed:', error);
            return false;
        } finally {
            this.playerEpisodeNavigationPending = false;
            this.updatePlayerNavigationControls();
        }
    }

    async handlePlayerNavigate(direction) {
        if (direction !== 'previous' && direction !== 'next') return false;
        if (!this.selectedMovie) return false;
        const movie = this.selectedMovie;
        const selection = this.playbackController?.getSelection();
        if (!selection || selection.seasonNumber == null || selection.episodeNumber == null) return false;
        const selectionContext = typeof this.playbackController?.getSelectionContext === 'function'
            ? this.playbackController.getSelectionContext()
            : { selection, selectionVersion: null };
        const selectionVersion = selectionContext.selectionVersion;
        const selectionIdentity = `${selection.kinopoiskId || movie.kinopoiskId || ''}:`
            + `${selection.seasonNumber}:${selection.episodeNumber}:`
            + `${selection.providerId || this.playbackController?.getActiveProvider?.() || ''}`;

        const loadedEpisodes = this.currentEpisodes || null;
        const loadedSeasonNumber = this.selectedSeasonNumber || null;

        const adjacent = this.resolveAdjacentEpisode(movie, selection, direction, {
            loadedEpisodes,
            loadedSeasonNumber,
            isEpisodePlayableByDate: (ep) => this.isEpisodePlayableByDate(ep)
        });

        if (!adjacent) return false;

        const selectionPayload = {
            kinopoiskId: movie.kinopoiskId,
            tmdbId: movie.tmdbId || selection.tmdbId,
            imdbId: movie.externalId?.imdb || movie.imdbId || selection.imdbId,
            title: movie.nameRu || movie.name || selection.title,
            mediaType: selection.mediaType || 'tv-series',
            seasonNumber: adjacent.seasonNumber,
            episodeNumber: adjacent.episodeNumber,
            episodeTitle: adjacent.episodeTitle || null,
            source: 'PLAYER_NAVIGATION',
            initialTimestamp: 0
        };

        // Flush departing episode's progress before switching to adjacent episode (Phase 3E Part 13)
        if (this.playbackController) {
            await this.playbackController.flushProgress({ force: true });
        }

        // The flush above is asynchronous. A user can select another episode
        // while it is pending; never let this older navigation request commit
        // its adjacent episode after that newer intent.
        const latestSelectionContext = typeof this.playbackController?.getSelectionContext === 'function'
            ? this.playbackController.getSelectionContext()
            : { selection: this.playbackController?.getSelection?.(), selectionVersion: null };
        const latestSelection = latestSelectionContext.selection;
        const latestIdentity = latestSelection
            ? `${latestSelection.kinopoiskId || movie.kinopoiskId || ''}:`
                + `${latestSelection.seasonNumber}:${latestSelection.episodeNumber}:`
                + `${latestSelection.providerId || this.playbackController?.getActiveProvider?.() || ''}`
            : null;
        if ((selectionVersion != null && latestSelectionContext.selectionVersion !== selectionVersion)
            || latestIdentity !== selectionIdentity) {
            console.info('[MovieDetails] Discarded stale episode navigation request', {
                direction,
                selectionVersion,
                latestSelectionVersion: latestSelectionContext.selectionVersion,
                selectionIdentity,
                latestIdentity
            });
            return false;
        }

        await this.playSelection(selectionPayload);
        return true;
    }

    updateSourceGuidance(providerId = this.playbackController?.getActiveProvider()) {
        const guidanceEl = (typeof document !== 'undefined' && typeof document.getElementById === 'function')
            ? document.getElementById('playerSourceGuidance')
            : (this.elements?.playerSourceGuidance || null);
        if (!guidanceEl) return;
        const selection = this.playbackController?.getSelection();
        if (!selection || selection.seasonNumber == null || selection.episodeNumber == null) {
            guidanceEl.style.display = 'none';
            return;
        }

        let provKey = providerId;
        if (typeof provKey === 'string') {
            if (provKey.startsWith('parser:')) provKey = provKey.replace('parser:', '');
            else if (provKey.startsWith('vidsrc:')) provKey = 'vidsrc';
        }

        const activeAdapter = this.playbackController?.getAdapter(provKey)
            || this.providerAdapters?.[provKey];
        const supportsProviderInternalSelection = activeAdapter
            && typeof activeAdapter.supportsProviderInternalSelection === 'function'
            && activeAdapter.supportsProviderInternalSelection();
        const selectionMode = typeof activeAdapter?.getSelectionMode === 'function'
            ? activeAdapter.getSelectionMode()
            : null;
        const hasCanonicalNativeBridge = selectionMode === 'NATIVE_BRIDGE'
            && typeof activeAdapter?.supportsEpisodePicker === 'function'
            && activeAdapter.supportsEpisodePicker();
        const shouldShowGuidance = Boolean(supportsProviderInternalSelection && !hasCanonicalNativeBridge);
        console.info('[ExFsBridgeTrace] source guidance decision', {
            provider: provKey || null,
            selection: {
                seasonNumber: selection.seasonNumber,
                episodeNumber: selection.episodeNumber
            },
            selectionMode,
            supportsProviderInternalSelection: Boolean(supportsProviderInternalSelection),
            supportsEpisodePicker: typeof activeAdapter?.supportsEpisodePicker === 'function'
                ? activeAdapter.supportsEpisodePicker()
                : null,
            hasCanonicalNativeBridge,
            visible: shouldShowGuidance
        });
        if (shouldShowGuidance) {
            const textEl = guidanceEl.querySelector?.('.player-source-guidance__text') || guidanceEl;
            textEl.textContent = `Выберите S${selection.seasonNumber}E${selection.episodeNumber} в плеере источника`;
            guidanceEl.style.display = 'flex';
        } else {
            guidanceEl.style.display = 'none';
        }
    }

    handleEpisodePlay(seasonNumber, episodeNumber, episodeTitle = null, initialTimestamp = 0) {
        if (!this.selectedMovie) return;
        const movie = this.selectedMovie;
        const isSeries = Boolean(movie.isSeries || (movie.type && ['tv-series', 'mini-series', 'animated-series', 'tv'].includes(movie.type)));

        const isResume = Number(initialTimestamp) > 0;

        const selectionPayload = {
            kinopoiskId: movie.kinopoiskId,
            tmdbId: movie.tmdbId || null,
            imdbId: movie.externalId?.imdb || movie.imdbId || null,
            title: movie.nameRu || movie.name || '',
            mediaType: isSeries ? (movie.type || 'tv-series') : 'movie',
            seasonNumber: Number(seasonNumber),
            episodeNumber: Number(episodeNumber),
            episodeTitle: episodeTitle || null,
            source: isResume ? 'RESUME' : 'SEASONS_TAB',
            initialTimestamp: Number(initialTimestamp) || 0
        };

        this.playSelection(selectionPayload);
    }

    handleNextEpisodePlay(seasonNumber, episodeNumber, episodeTitle = null) {
        if (!this.selectedMovie) return;
        const movie = this.selectedMovie;
        const isSeries = Boolean(movie.isSeries || (movie.type && ['tv-series', 'mini-series', 'animated-series', 'tv'].includes(movie.type)));

        const selectionPayload = {
            kinopoiskId: movie.kinopoiskId,
            tmdbId: movie.tmdbId || null,
            imdbId: movie.externalId?.imdb || movie.imdbId || null,
            title: movie.nameRu || movie.name || '',
            mediaType: isSeries ? (movie.type || 'tv-series') : 'movie',
            seasonNumber: Number(seasonNumber),
            episodeNumber: Number(episodeNumber),
            episodeTitle: episodeTitle || null,
            source: 'NEXT_EPISODE_HERO',
            initialTimestamp: 0
        };

        this.playSelection(selectionPayload);
    }

    async playSelection(selectionPayload) {
        if (!this.selectedMovie) return;

        console.log('[SeasonPickerTrace] playSelection received', {
            selectionPayload,
            canonicalBefore: this.playbackController?.getSelection(),
            activeProvider: this.playbackController?.getActiveProvider(),
            activePlayerId: this.activePlayerId
        });

        // Cancel any active auto-next countdown before starting new playback (Phase 3G)
        if (this.autoNextCoordinator) {
            this.autoNextCoordinator.cancel();
        }

        // 1. Set container and selection in PlaybackController
        if (this.playbackController) {
            this.playbackController.setContainer(this.elements.videoContainer, this.elements.videoPlayerModal);
            this.playbackController.setSelection(selectionPayload);
            this.playbackController.cleanupOrphanPreloadContainers(this.selectedMovie.kinopoiskId);
        }

        // 2. Update player modal title & navigation controls
        this.updatePlayerHeaderTitle();
        this.updatePlayerNavigationControls();

        // 3. Open or restore modal
        const isMinimized = this.getPlayerModal().isMinimized();
        if (isMinimized) {
            this.restorePlayer();
        } else if (this.elements.videoPlayerModal.style.display === 'none' || !this.elements.videoPlayerModal.style.display) {
            this.showVideoModal(this.selectedMovie);
        }

        // 4. Update episode context for Aniskip
        if (selectionPayload.episodeNumber != null) {
            this.currentEpisode = selectionPayload.episodeNumber;
            if (this.selectedMovie.type === 'anime') {
                const iframe = this.elements.videoContainer.querySelector('iframe');
                this.sendAnimeSkipTimes(iframe);
            }
        }

        // 5. If player has active source / provider, reload direct provider or preserve title-only
        const activeProvider = this.playbackController?.getActiveProvider() || this.activeSource?.parserId || (this.currentVideoUrl?.startsWith('vidsrc:') ? 'vidsrc' : null);

        if (activeProvider) {
            const adapter = this.playbackController?.getAdapter(activeProvider);
            const manuallyMountedParser = Boolean(
                this.activePlayerId === activeProvider
                && this.playerRegistry?.[activeProvider]?.initialized
                && !this.playbackController?.activeMount
            );
            console.info('[ExFsBridgeTrace] playSelection provider boundary', {
                provider: activeProvider,
                adapterId: adapter?.id || null,
                selection: selectionPayload,
                selectionMode: typeof adapter?.getSelectionMode === 'function'
                    ? adapter.getSelectionMode()
                    : null,
                manuallyMountedParser,
                hasActiveMount: Boolean(this.playbackController?.activeMount),
                activeContainerMatches: Boolean(adapter?.activeContainer === this.elements.videoContainer),
                iframes: Array.from(this.elements.videoContainer?.querySelectorAll?.('iframe') || [])
                    .map(iframe => iframe.src || iframe.getAttribute?.('src') || null)
            });

            if (manuallyMountedParser && activeProvider !== 'vidsrc') {
                const selectionMode = typeof adapter?.getSelectionMode === 'function'
                    ? adapter.getSelectionMode()
                    : 'OPAQUE';
                let nativeSelectionApplied = false;
                if (selectionMode === 'NATIVE_BRIDGE' && adapter) {
                    // Legacy parser mounts do not populate adapter.activeContainer;
                    // point the bridge at the already-mounted provider iframe.
                    adapter.activeContainer = this.elements.videoContainer;
                    const applyResult = typeof this.playbackController.applySelection === 'function'
                        ? await this.playbackController.applySelection(selectionPayload)
                        : { status: 'UNAVAILABLE' };
                    nativeSelectionApplied = applyResult.status === 'PENDING_NATIVE_UI';
                    console.log('[SeasonPickerTrace] native bridge apply result', {
                        provider: activeProvider,
                        requestedSeason: selectionPayload.seasonNumber,
                        requestedEpisode: selectionPayload.episodeNumber,
                        result: applyResult
                    });
                } else if (adapter?.supportsInPlaceSelection?.() === true
                    && typeof this.playbackController?.applySelection === 'function') {
                    // Opt-in DIRECT adapters (AnimeGo) swap the episode into the
                    // mounted player; a declined apply falls back to a remount.
                    adapter.activeContainer = this.elements.videoContainer;
                    const applyResult = await this.playbackController.applySelection(selectionPayload);
                    nativeSelectionApplied = applyResult.status === 'APPLIED';
                    // Progress and auto-next must report the new episode.
                    if (nativeSelectionApplied) this.bindProviderVideoTracking?.(activeProvider);
                    console.log('[SeasonPickerTrace] in-place apply result', {
                        provider: activeProvider,
                        requestedSeason: selectionPayload.seasonNumber,
                        requestedEpisode: selectionPayload.episodeNumber,
                        result: applyResult
                    });
                }
                if (!nativeSelectionApplied) {
                    // Parser players mounted by the legacy source lifecycle already own
                    // their discovered sources. Re-enter that lifecycle instead of
                    // asking an adapter to mount without its parser source context.
                    await this.changeVideoSource(`parser:${activeProvider}`);
                }
            } else if (adapter) {
                const applyResult = typeof this.playbackController.applySelection === 'function'
                    ? await this.playbackController.applySelection(selectionPayload)
                    : { status: 'UNAVAILABLE' };
                console.log('[SeasonPickerTrace] canonical selection apply result', {
                    provider: activeProvider,
                    requestedSeason: selectionPayload.seasonNumber,
                    requestedEpisode: selectionPayload.episodeNumber,
                    result: applyResult
                });
                if (!['APPLIED', 'PENDING_NATIVE_UI'].includes(applyResult.status)
                    && adapter.supportsDirectSeasonEpisode()) {
                    await this.playbackController.switchProvider(activeProvider, { isSwitch: true });
                }
            }
            this.updateSourceGuidance(activeProvider);
        } else {
            // Player not yet mounted: trigger full initialization
            await this.handleWatchClick();
        }
    }

    resolveWatchTarget(movie, progress = null, options = {}) {
        const resolver = (typeof resolveWatchTarget === 'function')
            ? resolveWatchTarget
            : (typeof window !== 'undefined' && window.resolveWatchTarget);

        if (typeof resolver === 'function') {
            return resolver(movie, progress, {
                loadedEpisodes: this.currentEpisodes || null,
                loadedSeasonNumber: this.selectedSeasonNumber || null,
                isEpisodePlayableByDate: (ep) => this.isEpisodePlayableByDate(ep),
                resolveAdjacentEpisode: (m, s, d, o) => this.resolveAdjacentEpisode(m, s, d, o),
                ...options
            });
        }

        return null;
    }

    async handleWatchClick() {
        if (!this.selectedMovie) return;
        
        // Construct canonical PlaybackSelection
        const movie = this.selectedMovie;
        const isSeries = (typeof isSeriesMedia === 'function'
            ? isSeriesMedia(movie)
            : Boolean(movie.isSeries || (movie.type && ['tv-series', 'mini-series', 'animated-series', 'tv', 'series', 'tv_series', 'tv-show'].includes(String(movie.type).toLowerCase().replace(/_/g, '-'))) || (Array.isArray(movie.seasons) && movie.seasons.length > 0) || (Array.isArray(movie.seasonsInfo) && movie.seasonsInfo.length > 0)));
        
        const existingSelection = this.playbackController?.getSelection();
        const hasExplicitSelection = Boolean(existingSelection && (
            existingSelection.seasonNumber != null ||
            existingSelection.episodeNumber != null ||
            (existingSelection.source && existingSelection.source !== 'HERO_WATCH')
        ));

        let target = null;
        if (!hasExplicitSelection && isSeries) {
            let progress = null;
            if (this.progressService) {
                try {
                    progress = await this.progressService.getProgress(movie.kinopoiskId);
                } catch (e) {
                    console.warn('[MovieDetails] Failed to load progress for watch target:', e);
                }
            }
            target = this.resolveWatchTarget(movie, progress);
        }

        const selectionPayload = hasExplicitSelection ? existingSelection : {
            kinopoiskId: movie.kinopoiskId,
            tmdbId: movie.tmdbId || null,
            imdbId: movie.externalId?.imdb || movie.imdbId || null,
            title: movie.name || movie.nameRu || '',
            mediaType: isSeries ? (movie.type || 'tv-series') : 'movie',
            seasonNumber: target?.seasonNumber != null ? target.seasonNumber : null,
            episodeNumber: target?.episodeNumber != null ? target.episodeNumber : null,
            source: 'HERO_WATCH',
            initialTimestamp: target?.initialTimestamp || 0
        };

        if (this.playbackController) {
            this.playbackController.setContainer(this.elements.videoContainer, this.elements.videoPlayerModal);
            this.playbackController.setSelection(selectionPayload);
            this.playbackController.cleanupOrphanPreloadContainers(movie.kinopoiskId);
        }

        this.updatePlayerHeaderTitle();

        // Check if player is already active for this movie (minimized)
        if (this.videoModalMovie && this.videoModalMovie.kinopoiskId === this.selectedMovie.kinopoiskId) {
            const isMinimized = this.getPlayerModal().isMinimized();
            const hasContent = this.elements.videoContainer.innerHTML && !this.elements.videoContainer.innerHTML.includes('video-placeholder');
            
            if (isMinimized && hasContent) {
                this.restorePlayer();
                return;
            }
        }

        // Prefer custom (native video) players for preload mount; skip iframe-only parsers
        const initializedCustomParser = Object.keys(this.playerRegistry).find(parserId => {
            const entry = this.playerRegistry[parserId];
            if (!entry || entry.movieId !== String(this.selectedMovie.kinopoiskId) || !entry.initialized) return false;
            const parser = this.parserRegistry.get(parserId);
            return parser && parser.getPlayerType() !== 'iframe';
        });
        
        if (initializedCustomParser) {
            this.showVideoModal(this.selectedMovie);
            this.videoModalMovie = this.selectedMovie;
            
            if (await this.changeVideoSource(`parser:${initializedCustomParser}`)) {
                this.populateSourceSelector();
                this.updateActiveSourceButton(`parser:${initializedCustomParser}`);
                return;
            }
        }
        
        // Full initialization logic
        this.showVideoModal(this.selectedMovie);
        this.videoModalMovie = this.selectedMovie;
        this.setPlayerSourceState('loading', { message: 'Поиск источников…' });
        
        try {
            // POPULATE SOURCES UI — dynamically from ParserRegistry
            this.populateSourceSelector();

            // Logical fetch of sources from ALL parsers
            if (!this.currentSources?.length) {
                if (this.selectedMovie.videoSources?.length) {
                    this.currentSources = this.selectedMovie.videoSources;
                } else {
                    const requestedMediaType = this.selectedMovie.type || (this.selectedMovie.isSeries ? 'tv-series' : null);
                    const cached = this.getCachedSources(this.selectedMovie.kinopoiskId, requestedMediaType);
                    if (cached) {
                        this.currentSources = cached;
                    } else {
                        // Release the first priority-safe source as soon as it is
                        // known; slower parsers continue enriching the selector in
                        // the background and are finalized into the cache.
                        const discovery = this.startProgressiveSourceDiscovery(this.selectedMovie);
                        try {
                            const firstSources = await discovery.firstSources;
                            if (firstSources.length > 0) {
                                this.currentSources = this.normalizeVideoSources(firstSources);
                                this.populateSourceSelector();
                                void discovery.finalize.catch(error => {
                                    console.warn('[MovieDetails] Progressive source finalization failed:', error);
                                });
                            } else {
                                await discovery.finalize;
                            }
                        } catch (e) {
                            console.warn('[MovieDetails] Progressive source discovery failed:', e);
                        }
                    }
                }
            }
            
            // Re-populate source selector with fetched sources
            this.populateSourceSelector();
            
            // Playback Logic
            if (this.currentSources && this.currentSources.length > 0) {
                const lastSaved = await this.getLastSource(this.selectedMovie.kinopoiskId);
                let targetSource = null;

                // A source button click is an explicit user intent. Preserve it
                // across the async watch flow instead of allowing stale storage or
                // the first URL in currentSources to select VidSrc/Ex-FS again.
                const explicitSource = this.activeSourceValue
                    && this.elements.sourceButtonsContainer.querySelector(
                        `.source-btn[data-value="${this.activeSourceValue}"]`
                    )
                    ? this.activeSourceValue
                    : null;

                if (explicitSource) {
                    targetSource = explicitSource;
                }
                
                if (!targetSource && lastSaved) {
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
                
                // Mount immediately. A stale cached embed is reported by the
                // player lifecycle (and KinoGo's balancer 404 state), which
                // offers or triggers forceResearchSources(); a HEAD preflight
                // only delayed every start and missed expired tokens served as 200.
                const sourceChanged = await this.changeVideoSource(targetSource);
                if (sourceChanged) this.togglePlayPause(targetSource);
            } else {
                // No direct sources — try first non-primary parser that supports this movie type
                const currentType = this.selectedMovie?.type;
                const allParsers = this.parserRegistry.getAll();
                
                const lastSaved = await this.getLastSource(this.selectedMovie.kinopoiskId);
                let targetParser = null;
                if (lastSaved && lastSaved.startsWith('parser:')) {
                    const savedParserId = lastSaved.replace('parser:', '');
                    const savedParser = this.parserRegistry.get(savedParserId);
                    if (savedParser && (savedParser.supportsMedia?.(this.selectedMovie, currentType) ?? (!currentType || savedParser.supportsType(currentType)))) {
                        targetParser = savedParser;
                    }
                }
                
                if (!targetParser) {
                    targetParser = allParsers.find(p => 
                        p.getPlayerType() !== 'iframe' && (p.supportsMedia?.(this.selectedMovie, currentType) ?? (!currentType || p.supportsType(currentType)))
                    ) || allParsers.find(p => 
                        p !== allParsers[0] && (p.supportsMedia?.(this.selectedMovie, currentType) ?? (!currentType || p.supportsType(currentType)))
                    );
                }
                
                if (targetParser) {
                    this.updateActiveSourceButton(`parser:${targetParser.id}`);
                    await this.changeVideoSource(`parser:${targetParser.id}`);
                }
            }    
    
            // Setup message listener for iframe communication
            this.setupPlayerMessageListener();

        } catch (error) {
            console.error('Error in handleWatchClick:', error);
            const playbackError = createAppError('PLAYBACK_UNAVAILABLE', {
                category: 'playback',
                retryable: false,
                cause: error
            });
            const presentation = window.ErrorPresentation?.getPresentation?.(playbackError);
            this.renderPlayerPlaceholder(presentation?.message || 'Playback unavailable');
        }
    }

    parsePlaybackNumber(value) {
        if (typeof value === 'number') {
            return Number.isFinite(value) ? value : null;
        }
        const match = String(value ?? '').match(/\d+/);
        return match ? Number(match[0]) : null;
    }

    isExplicitPlaybackSelection(selection) {
        return Boolean(selection && (
            selection.seasonNumber != null
            || selection.episodeNumber != null
            || [
                'SEASONS_TAB',
                'PLAYER_NAVIGATION',
                'AUTO_NEXT',
                'RESUME',
                'NEXT_EPISODE_HERO',
                'PROVIDER_SWITCH',
                'PLAYER_PROVIDER_PICKER'
            ].includes(selection.source)
        ));
    }

    getPlaybackSelectionContext() {
        const context = this.playbackController?.getSelectionContext?.();
        const selection = context?.selection || this.playbackController?.getSelection?.() || null;
        return {
            selection,
            selectionVersion: Number.isInteger(context?.selectionVersion) ? context.selectionVersion : null,
            signature: selection
                ? [
                    selection.kinopoiskId,
                    selection.mediaType,
                    selection.seasonNumber,
                    selection.episodeNumber,
                    selection.providerId,
                    selection.source
                ].map(value => String(value ?? '')).join('|')
                : 'none'
        };
    }

    restoreProgressForReadyIframe(iframe) {
        const movieId = this.selectedMovie?.kinopoiskId;
        if (!iframe?.contentWindow || movieId == null || !this.progressService) return;

        const selectionContext = this.getPlaybackSelectionContext();
        if (this.isExplicitPlaybackSelection(selectionContext.selection)) return;

        const restoreContext = {
            movieId: String(movieId),
            iframe,
            sourceSwitchRequestId: this.sourceSwitchRequestId,
            pageGeneration: this.pageGeneration,
            selectionVersion: selectionContext.selectionVersion,
            selectionSignature: selectionContext.signature
        };
        const previousAttempt = this.progressRestoreAttempt;
        if (previousAttempt
            && previousAttempt.iframe === restoreContext.iframe
            && previousAttempt.movieId === restoreContext.movieId
            && previousAttempt.sourceSwitchRequestId === restoreContext.sourceSwitchRequestId
            && previousAttempt.selectionVersion === restoreContext.selectionVersion
            && previousAttempt.selectionSignature === restoreContext.selectionSignature) {
            return;
        }
        this.progressRestoreAttempt = restoreContext;

        this.progressService.getProgress(movieId).then(progress => {
            const activeIframe = this.elements?.videoContainer?.querySelector?.('iframe[data-player-source-active="true"]')
                || this.elements?.videoContainer?.querySelector?.('iframe');
            const currentSelectionContext = this.getPlaybackSelectionContext();
            const isCurrent = String(this.selectedMovie?.kinopoiskId) === restoreContext.movieId
                && activeIframe === restoreContext.iframe
                && this.sourceSwitchRequestId === restoreContext.sourceSwitchRequestId
                && this.pageGeneration === restoreContext.pageGeneration
                && currentSelectionContext.selectionVersion === restoreContext.selectionVersion
                && currentSelectionContext.signature === restoreContext.selectionSignature
                && !this.isExplicitPlaybackSelection(currentSelectionContext.selection);
            if (!isCurrent || !progress?.season || !progress?.episode) return;

            this.postToPlayerFrame(restoreContext.iframe, {
                type: 'RESTORE_PROGRESS',
                season: progress.season,
                episode: progress.episode
            });

            const episodeNumber = this.parsePlaybackNumber(progress.episodeNumber ?? progress.episode);
            if (episodeNumber != null && episodeNumber > 0) {
                this.currentEpisode = episodeNumber;
            }
        }).catch(e => console.error('Error loading progress:', e));
    }

    setupPlayerMessageListener() {
        if (this.messageListenerSetup) return;
        window.addEventListener('message', async (event) => {
            const providerMessage = this.watchRoomController?.handleProviderPlayerMessage(event);
            if (providerMessage?.handled) {
                if (providerMessage.ready) this.watchRoomController?.refreshPlayerBridge();
                return;
            }
            if (!this.isTrustedPlayerMessage(event)) return;

            if (['ROOM_SYNC_PROBE_RESULT', 'ROOM_SYNC_COMMAND_RESULT', 'ROOM_SYNC_TELEMETRY'].includes(event.data.type)) {
                this.watchRoomController?.handlePlayerMessage(event.data);
                return;
            }

            if (event.data.type === 'PLAYER_READY') {
                 this.sourceLifecycleWatcher?.cancel?.();
                 this.sourceLifecycleWatcher = null;
                 this.setPlayerSourceState('ready');
                 this.watchRoomController?.refreshPlayerBridge();
                 const iframe = this.elements.videoContainer.querySelector('iframe');
                 if (iframe && iframe.contentWindow) {
                     
                     this.postToPlayerFrame(iframe, {
                         type: 'SET_SOURCES',
                         sources: this.currentSources,
                         currentUrl: this.currentVideoUrl
                     });
                     
                     this.restoreProgressForReadyIframe(iframe);
                     this.sendAnimeSkipTimes(iframe);
                 }
            } else if (event.data.type === 'CHANGE_SOURCE') {
                const newUrl = event.data.url;
                if (newUrl && newUrl !== this.currentVideoUrl) {
                    this.updateActiveSourceButton(newUrl);
                    const sourceChanged = await this.changeVideoSource(newUrl);
                    if (sourceChanged) this.togglePlayPause(newUrl);
                 }
            } else if (event.data.type === 'PLAYER_SOURCE_STATE') {
                const { state, url } = event.data;
                const parserId = this.activePlayerId;
                const isActiveSource = url === this.currentVideoUrl || !!parserId;
                if ((state === 'error' || state === 'unavailable') && isActiveSource) {
                    if (parserId === 'kinogo' && event.data.reason === 'provider-content-not-found') {
                        const recoveryScheduled = this.retryKinogoAfterContentError(url);
                        if (recoveryScheduled) return;
                        console.warn('[KinogoSearchTrace] fresh provider retry exhausted', {
                            reason: event.data.reason,
                            providerId: parserId,
                            iframeUrl: url || null,
                            activePlayerId: this.activePlayerId,
                            activeProviderId: this.playbackController?.getActiveProvider?.() || null
                        });
                    }
                    if (parserId) {
                        this.unavailableProviderIds?.add?.(parserId);
                    }
                    const movieId = String(this.selectedMovie?.kinopoiskId || '');
                    this.invalidateSourceCache(movieId);
                    this.setPlayerSourceState(state, {
                        onRetry: () => this.changeVideoSource(parserId ? `parser:${parserId}` : url),
                        onResearch: () => this.forceResearchSources(
                            parserId ? `parser:${parserId}` : url,
                            parserId
                        )
                    });
                    this.updatePlayerNavigationControls();
                }
            } else if (event.data.type === 'PLAYER_EPISODE_NAVIGATE') {
                await this.requestPlayerEpisodeNavigation(event.data.direction);
            } else if (event.data.type === 'UPDATE_WATCHING_PROGRESS') {
                const {
                    season,
                    episode,
                    seasonNumber,
                    episodeNumber,
                    timestamp,
                    selectionVersion,
                    providerId,
                    origin
                } = event.data;
                const currentSelection = this.playbackController?.getSelection?.();
                const activeAdapter = this.playbackController?.getAdapter?.(
                    this.playbackController?.getActiveProvider?.()
                );
                const canonicalNativeBridge = activeAdapter?.getSelectionMode?.() === 'NATIVE_BRIDGE'
                    && activeAdapter?.supportsEpisodePicker?.();
                if (canonicalNativeBridge
                    && origin === 'USER_PROVIDER_SELECTION'
                    && event.data.providerState !== 'NATIVE_DOM') {
                    console.info('[MovieDetails] Ignored legacy provider progress in canonical native bridge mode:', event.data);
                    return;
                }
                const incomingSeasonNumber = this.parsePlaybackNumber(seasonNumber ?? season);
                const incomingEpisodeNumber = this.parsePlaybackNumber(episodeNumber ?? episode);
                if (this.isExplicitPlaybackSelection(currentSelection)
                    && origin !== 'USER_PROVIDER_SELECTION'
                    && ((incomingSeasonNumber != null
                        && currentSelection.seasonNumber != null
                        && incomingSeasonNumber !== Number(currentSelection.seasonNumber))
                        || (incomingEpisodeNumber != null
                            && currentSelection.episodeNumber != null
                            && incomingEpisodeNumber !== Number(currentSelection.episodeNumber)))) {
                    return;
                }
                if (this.playbackController) {
                    this.playbackController.handleProgressUpdate({
                        season,
                        episode,
                        seasonNumber,
                        episodeNumber,
                        timestamp,
                        selectionVersion,
                        providerId,
                        origin,
                        movieId: this.selectedMovie?.kinopoiskId
                    });
                }
            } else if (event.data.type === 'EPISODE_CHANGED') {
                const {
                    episode,
                    season,
                    seasonNumber,
                    origin,
                    providerId,
                    providerState
                } = event.data;
                const currentSel = this.playbackController?.getSelection();
                const activeAdapter = this.playbackController?.getAdapter?.(
                    this.playbackController?.getActiveProvider?.()
                );
                const canonicalNativeBridge = activeAdapter?.getSelectionMode?.() === 'NATIVE_BRIDGE'
                    && activeAdapter?.supportsEpisodePicker?.();
                if (canonicalNativeBridge
                    && origin === 'USER_PROVIDER_SELECTION'
                    && providerState !== 'NATIVE_DOM') {
                    console.info('[MovieDetails] Ignored legacy provider episode event in canonical native bridge mode:', event.data);
                    return;
                }
                const isExplicitSelection = currentSel && [
                    'SEASONS_TAB',
                    'PLAYER_NAVIGATION',
                    'AUTO_NEXT',
                    'RESUME',
                    'NEXT_EPISODE_HERO',
                    'PROVIDER_SWITCH',
                    'PLAYER_PROVIDER_PICKER'
                ].includes(currentSel.source);

                // Guard: ignore messages that do not come from genuine user action inside the provider (Part 18 & 19)
                if (isExplicitSelection && origin !== 'USER_PROVIDER_SELECTION') {
                    console.log('[MovieDetails] Ignored non-user EPISODE_CHANGED event during explicit selection:', event.data);
                } else {
                    const epNum = typeof episode === 'number' ? episode : parseInt(String(episode).replace(/\D+/g, ''), 10);
                    if (!Number.isNaN(epNum) && epNum > 0) {
                        this.currentEpisode = epNum;
                        if (this.playbackController && currentSel) {
                            const updatePayload = { episodeNumber: epNum };
                            const sNum = typeof seasonNumber === 'number'
                                ? seasonNumber
                                : (typeof season === 'number' ? season : parseInt(String(season || '').replace(/\D+/g, ''), 10));
                            if (!Number.isNaN(sNum) && sNum > 0) {
                                updatePayload.seasonNumber = sNum;
                            }
                            if (providerId && providerState === 'NATIVE_DOM') {
                                updatePayload.providerId = providerId;
                            }
                            this.playbackController.updateSelection(updatePayload);
                            this.updatePlayerHeaderTitle();
                        }
                    }
                }
                const iframe = this.elements.videoContainer.querySelector('iframe');
                this.sendAnimeSkipTimes(iframe);
            } else if (event.data.type === 'SEASONVAR_PLAYBACK_STATE') {
                this.currentSeasonvarPlaybackState = event.data;
                this.updatePlayerNavigationControls();
                if (this.isEpisodePickerOpen) {
                    this.renderEpisodePickerContent();
                }
            } else if (event.data.type === 'PIP_ENTER') {
                this.minimizePlayer(false);
            } else if (event.data.type === 'PIP_EXIT') {
                this.restorePlayer();
            }
        });
        this.messageListenerSetup = true;
    }

    getPlayerSurface() {
        if (!this.playerSurface) {
            this.playerSurface = new MovieDetailsPlayerSurface({
                getContainer: () => this.elements?.videoContainer
            });
        }
        return this.playerSurface;
    }

    getSafeWebUrl(url) {
        return MovieDetailsPlayerSurface.getSafeWebUrl(url);
    }

    renderFrameInto(container, url, options = {}) {
        return MovieDetailsPlayerSurface.renderFrameInto(container, url, options);
    }

    renderPlayerPlaceholder(message) {
        this.getPlayerSurface().showPlaceholder(message);
    }

    getPlayerFrameOrigin(iframe) {
        try {
            const url = new URL(iframe?.src || iframe?.getAttribute?.('src') || '', window.location?.href);
            if (url.origin !== 'null') return url.origin;
            return url.protocol === 'chrome-extension:' && url.host ? `${url.protocol}//${url.host}` : null;
        } catch {
            return null;
        }
    }

    // Commands are addressed to the frame's expected origin. If a provider
    // frame navigates elsewhere, the browser drops them instead of leaking
    // playback state to the new document.
    postToPlayerFrame(iframe, message) {
        const targetOrigin = this.getPlayerFrameOrigin(iframe);
        if (!targetOrigin || !iframe?.contentWindow) return false;
        try {
            iframe.contentWindow.postMessage(message, targetOrigin);
            return true;
        } catch {
            return false;
        }
    }

    postToEmbeddingParent(message) {
        if (window.parent === window) return;
        const parentOrigin = window.location.ancestorOrigins?.[0];
        window.parent.postMessage(message, parentOrigin && parentOrigin !== 'null' ? parentOrigin : '*');
    }

    isTrustedPlayerMessage(event) {
        const playerMessageTypes = new Set([
            'PLAYER_READY',
            'CHANGE_SOURCE',
            'PLAYER_SOURCE_STATE',
            'PLAYER_EPISODE_NAVIGATE',
            'UPDATE_WATCHING_PROGRESS',
            'EPISODE_CHANGED',
            'PIP_ENTER',
            'PIP_EXIT',
            'SEASONVAR_PLAYBACK_STATE',
            'ROOM_SYNC_PROBE_RESULT',
            'ROOM_SYNC_COMMAND_RESULT',
            'ROOM_SYNC_TELEMETRY'
        ]);
        if (!playerMessageTypes.has(event?.data?.type)) return false;

        const iframe = this.elements.videoContainer?.querySelector?.('iframe[data-player-source-active="true"]')
            || this.elements.videoContainer?.querySelector?.('iframe');
        if (iframe?.contentWindow) {
            if (event.source !== iframe.contentWindow) return false;

            const iframeRequestId = iframe.dataset?.playerRequestId;
            if (iframeRequestId && Number(iframeRequestId) !== this.sourceSwitchRequestId) return false;

            try {
                const expectedUrl = new URL(iframe.src, window.location.href);
                const expectedOrigin = expectedUrl.origin === 'null'
                    && expectedUrl.protocol === 'chrome-extension:'
                    && expectedUrl.host
                    ? `${expectedUrl.protocol}//${expectedUrl.host}`
                    : expectedUrl.origin;
                return event.origin === expectedOrigin;
            } catch (error) {
                console.warn('[MovieDetails] Rejecting player message with invalid iframe origin:', error);
                return false;
            }
        }

        const video = this.elements.videoContainer?.querySelector?.('video');
        return !!video
            && event.source === window
            && event.origin === window.location.origin;
    }

    showVideoModal() {
        this.updatePlayerHeaderTitle();
        this.getPlayerModal().open();
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
                    this.postToPlayerFrame(iframe, skipMessage);
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
                    this.postToPlayerFrame(iframe, nullMessage);
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
        this.closeEpisodePicker();
        // If embedded, signal parent to restore native player
        if (this.isEmbedded && window.parent !== window) {
            this.unmountActivePlayer();
            this.destroyPlayer();
            this.postToEmbeddingParent({ type: 'CLOSE_EXTENSION_PLAYER' });
            return;
        }
        // Closing must stop playback. A provider frame cannot confirm a pause
        // reliably, so its cached frame is released instead of kept hidden.
        const activePlayerId = this.activePlayerId;
        this.destroyPlayer();
        if (activePlayerId) this.releasePlayerRegistryEntry(activePlayerId);
        this.closeAccessibleDialog?.(this.elements?.videoPlayerModal);
    }

    releasePlayerRegistryEntry(parserId) {
        const entry = this.playerRegistry?.[parserId];
        if (!entry || entry.dataOnly) return false;
        const iframes = entry.container?.querySelectorAll?.('iframe') || [];
        if (iframes.length === 0) return false;

        iframes.forEach(iframe => { iframe.src = 'about:blank'; });
        entry.container?.remove?.();
        delete this.playerRegistry[parserId];
        this.initPlayerRegistry(entry.movieId);
        return true;
    }

    async minimizePlayer(shouldPause = true) {
        await this.getPlayerModal().minimize({ pause: shouldPause });
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
                        if (e.source === iframe.contentWindow && e.data?.type === 'PAUSED_CONFIRMATION') {
                            window.removeEventListener('message', msgHandler);
                            if (!resolved) {
                                resolved = true;
                                resolve({ success: true, reason: 'iframe_confirmed', duration: Math.round(performance.now() - startTime) });
                            }
                        }
                    };
                    
                    window.addEventListener('message', msgHandler);
                    this.postToPlayerFrame(iframe, { type: 'PAUSE' });
                    
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
        this.getPlayerModal().restore();
    }


    async reuseCachedPlayer(movieId) {
        const registryMovieId = String(movieId);
        // Find the first initialized parser entry for this movie in the registry
        const parserId = Object.keys(this.playerRegistry).find(pid => {
            const entry = this.playerRegistry[pid];
            return entry && entry.movieId === registryMovieId && entry.initialized;
        });

        if (!parserId) return false;

        return this.mountPlayer(parserId, registryMovieId);
    }

    destroyPlayer() {
        this.beginSourceSwitchRequest();
        this.stopTorrentProgressMonitoring();
        void this.revokeTorrentPlaybackSession();
        this.closeTorrentPicker();
        this.resetHlsRecoveryState();
        this.torrentActiveContext = null;
        this.torrentHasPlaybackSnapshot = false;
        this.latestTorrentPlaybackProgress = { state: 'starting' };
        this.torrentPlaybackAvailableDurationSeconds = null;
        if (this.elements?.torrentPlaybackStatus) {
            this.elements.torrentPlaybackStatus.hidden = true;
            this.elements.torrentPlaybackStatus.innerHTML = '';
            this.elements.torrentPlaybackStatus.dataset.view = '';
            this.elements.torrentPlaybackStatus.removeAttribute('data-state');
        }
        // unmountActivePlayer pauses and returns player DOM to its hidden registry container
        this.unmountActivePlayer();

        this.getPlayerModal().hide();

        if (this.isPlaying) {
            this.isPlaying = false;
        }
        
        if (this.currentHls) {
            this.currentHls.destroy();
            this.currentHls = null;
        }



        // Clear any remaining content that wasn't part of the registry (e.g. error placeholders)
        this.getPlayerSurface().clear();

        if (this.playbackController) {
            this.playbackController.cleanupOrphanPreloadContainers(this.selectedMovie?.kinopoiskId);
        }
        
        if (this.isEmbedded && window.parent !== window) {
            this.postToEmbeddingParent({ type: 'CLOSE_EXTENSION_PLAYER' });
        }
    }

    initPlayerRegistry(movieId = this.selectedMovie?.kinopoiskId) {
        if (!movieId) return;
        const registryMovieId = String(movieId);
        // player-cleaner scopes its local resume position to this title; the
        // page URL can lag behind in-page navigation.
        if (document.documentElement?.dataset) {
            document.documentElement.dataset.playerProgressScope = `movie-${registryMovieId}`;
        }

        const entries = Object.values(this.playerRegistry);
        if (entries.some(entry => entry.movieId !== registryMovieId)) {
            this.resetPlayerRegistry();
        }

        const parsers = this.parserRegistry.getAll();
        for (const parser of parsers) {
            const existingEntry = this.playerRegistry[parser.id];
            if (existingEntry?.movieId === registryMovieId) continue;

            const container = document.createElement('div');
            container.id = `player-preload-${registryMovieId}-${parser.id}`;
            container.style.cssText = 'display:none; position:absolute; width:0; height:0; overflow:hidden; pointer-events:none;';
            document.body.appendChild(container);

            this.playerRegistry[parser.id] = {
                movieId: registryMovieId,
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

    orderParserSourcesForNativeBridge(parserId, sources, selection = null) {
        if (parserId !== 'kinogo' || !Array.isArray(sources)) return sources;

        const adapter = this.playbackController?.getAdapter?.(parserId);
        if (typeof adapter?.orderSourcesForNativeBridge !== 'function') return sources;

        const movie = this.selectedMovie;
        const mediaType = selection?.mediaType
            || movie?.type
            || (typeof isSeriesMedia === 'function' && isSeriesMedia(movie) ? 'tv-series' : null);
        const normalizedSelection = { ...(selection || {}), mediaType };
        const orderedSources = adapter.orderSourcesForNativeBridge(sources, normalizedSelection);

        console.info('[KinogoSearchTrace] legacy source order', {
            mediaType,
            nativeBridgePreferred: orderedSources?.[0]?.url || null,
            sources: orderedSources.map(source => source?.url || null)
        });

        return orderedSources;
    }

    async preloadAllPlayers(movieId) {
        const registryMovieId = String(movieId);
        if (!this.selectedMovie || String(this.selectedMovie.kinopoiskId) !== registryMovieId) return;

        this.perf?.mark('md:player-preload-start');
        this.initPlayerRegistry(registryMovieId);
        
        const parsers = this.parserRegistry.getAll();
        const movieType = this.selectedMovie?.type;
        
        const preloadWork = Promise.allSettled(parsers.map(async (parser) => {
            if (!(parser.supportsMedia?.(this.selectedMovie, movieType) ?? (!movieType || parser.supportsType(movieType)))) return;

            // Default iframe/video renderers are intentionally not preloaded: mounting them
            // in hidden containers duplicates third-party network/player initialization.
            // Custom parsers keep their data-only preload path for fast season/episode setup.
            const usesCustomRenderer = parser.getPlayerType() === 'custom'
                || parser.renderPlayer !== BaseParserService.prototype.renderPlayer;
            if (!usesCustomRenderer) return;
            
            const entry = this.playerRegistry[parser.id];
            if (!entry || entry.movieId !== registryMovieId || entry.initialized) return;
            
            try {
                const name = this.selectedMovie.name || this.selectedMovie.alternativeName;
                const requestedMediaType = this.selectedMovie.type || (this.selectedMovie.isSeries ? 'tv-series' : null);
                const searchResult = await parser.cachedSearch(name, this.selectedMovie.year, {
                    mediaType: requestedMediaType
                });
                
                if (!searchResult) return;
                
                const sources = await parser.cachedVideoSources(searchResult);
                if (!sources?.length) return;
                
                let seriesInfo = null, seasons = [];
                if (parser.getSeriesInfo) {
                    try { seriesInfo = await parser.getSeriesInfo(searchResult.url); } catch { /* Ignore */ }
                }
                if (parser.getSeasons) {
                    try { seasons = await parser.getSeasons(searchResult.url); } catch { /* Ignore */ }
                }

                if (String(this.selectedMovie?.kinopoiskId) !== registryMovieId || this.playerRegistry[parser.id] !== entry) {
                    return;
                }
                
                entry.container.innerHTML = '';
                const renderOptions = {
                    translations: seriesInfo?.translations || null,
                    canonicalSeasons: this.getCanonicalSeasonLayout?.() || [],
                    seasons: seasons || [],
                    movieId: registryMovieId,
                    lifecycle: false
                };
                
                if (parser.getPlayerType() === 'custom' || parser.renderPlayer !== BaseParserService.prototype.renderPlayer) {
                    // Data-only preload: store sources/options, create DOM on mount
                    entry.dataOnly = true;
                    
                    // Pre-resolve selection (top priority) or progress so mountPlayer doesn't redo auto-select
                    const selection = this.playbackController?.getSelection();
                    const movie = this.selectedMovie;
                    const isSeries = (typeof isSeriesMedia === 'function'
                        ? isSeriesMedia(movie)
                        : Boolean(movie?.isSeries || movie?.seasons?.length > 0 || movie?.seasonsInfo?.length > 0));
                    
                    let targetSeasonNum = selection?.seasonNumber != null ? Number(selection.seasonNumber) : null;
                    let targetEpNum = selection?.episodeNumber != null ? Number(selection.episodeNumber) : null;
                    let targetTimestamp = selection?.initialTimestamp || 0;

                    if (targetSeasonNum == null || targetEpNum == null) {
                        let progress = null;
                        const key = `watching_progress_${registryMovieId}`;
                        const result = await new Promise(resolve => chrome.storage.local.get([key], resolve));
                        progress = result[key];
                        
                        if (isSeries) {
                            const target = this.resolveWatchTarget(movie, progress);
                            if (target && target.seasonNumber != null && target.episodeNumber != null) {
                                targetSeasonNum = target.seasonNumber;
                                targetEpNum = target.episodeNumber;
                                targetTimestamp = target.initialTimestamp || 0;
                            }
                        } else if (progress) {
                            if (targetSeasonNum == null && progress.season) {
                                const pSeasonNum = parseInt(progress.season, 10);
                                if (!isNaN(pSeasonNum)) targetSeasonNum = pSeasonNum;
                            }
                            if (targetEpNum == null && progress.episode) {
                                const pEpNum = parseInt(progress.episode, 10);
                                if (!isNaN(pEpNum)) targetEpNum = pEpNum;
                            }
                            if (!targetTimestamp && progress.timestamp > 5 && progress.timestamp <= 100000) {
                                targetTimestamp = progress.timestamp;
                            }
                        }
                    }

                    if (targetSeasonNum != null && seasons && seasons.length > 0) {
                        const targetSeason = seasons.find(s => Number(s.season_number) === targetSeasonNum);
                        if (targetSeason) {
                            renderOptions.resolvedSeasonUrl = targetSeason.url;
                            renderOptions.resolvedSeasonNumber = targetSeasonNum;
                        }
                    }

                    if (targetEpNum != null && sources && sources.length > 0) {
                        const extractEp = (s) => (parser.extractEpisodeNumber
                            ? parser.extractEpisodeNumber(s)
                            : (typeof SeasonvarParser !== 'undefined' && SeasonvarParser.extractEpisodeNumber
                                ? SeasonvarParser.extractEpisodeNumber(s)
                                : null));
                        let targetSource = sources.find(s => extractEp(s) === targetEpNum);
                        if (!targetSource) {
                            const idx = targetEpNum - 1;
                            if (idx >= 0 && idx < sources.length) targetSource = sources[idx];
                        }
                        if (targetSource) {
                            renderOptions.resolvedEpisodeUrl = targetSource.url;
                            renderOptions.resolvedEpisodeNumber = targetEpNum;
                        }
                    }

                    if (targetTimestamp > 0) {
                        renderOptions.resolvedTimestamp = targetTimestamp;
                    }
                } else {
                    await parser.renderPlayer(entry.container, sources, renderOptions);
                    
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
                
                if (String(this.selectedMovie?.kinopoiskId) !== registryMovieId || this.playerRegistry[parser.id] !== entry) {
                    return;
                }

                entry.initialized = true;
                entry.sources = sources;
                entry.renderOptions = renderOptions;
                entry.sourcesSeasonUrl = searchResult.url;
                entry.sourcesSeasonNumber = (seasons.find(s => s.url === searchResult.url)?.season_number)
                    ? Number(seasons.find(s => s.url === searchResult.url).season_number)
                    : (renderOptions.resolvedSeasonNumber || 1);
                
            } catch (e) {
                console.warn(`[PlayerRegistry] Preload failed for ${parser.id}:`, e);
            }
        }));
        this.perf?.mark('md:player-preload-dispatched');
        await preloadWork;
        this.perf?.mark('md:player-preload-settled');
        this.perf?.completePlayerPreload();
    }

    async mountPlayer(parserId, movieId = this.selectedMovie?.kinopoiskId, sourceRequestId = null) {
        const entry = this.playerRegistry[parserId];
        if (!entry || entry.movieId !== String(movieId) || !entry.initialized) return false;

        if (sourceRequestId !== null && !this.isSourceSwitchRequestCurrent(sourceRequestId, movieId)) {
            return false;
        }

        this.unmountActivePlayer();
        
        const parser = this.parserRegistry.get(parserId);
        const selection = this.playbackController?.getSelection();
        if (entry.sources?.length) {
            entry.sources = this.orderParserSourcesForNativeBridge(parserId, entry.sources, selection);
        }
        
        // Data-only entries: render fresh DOM now
        if (entry.dataOnly) {
            this.getPlayerSurface().clear();
            
            // Pass the pre-resolved auto-select data to renderPlayer, ground-truthed against current selection
            const renderOptions = {
                ...(entry.renderOptions || {}),
                canonicalSeasons: this.getCanonicalSeasonLayout?.() || entry.renderOptions?.canonicalSeasons || [],
                ...this.createSourceLifecycleOptions({
                    url: `parser:${parserId}`,
                    parserId,
                    movieId,
                    requestId: sourceRequestId
                }),
                currentSourcesUrl: entry.sourcesSeasonUrl || null,
                sourcesSeasonUrl: entry.sourcesSeasonUrl || null,
                sourcesSeasonNumber: entry.sourcesSeasonNumber || null
            };

            if (selection) {
                if (selection.seasonNumber != null) {
                    renderOptions.season = selection.seasonNumber;
                    renderOptions.resolvedSeasonNumber = selection.seasonNumber;
                    if (renderOptions.seasons && renderOptions.seasons.length > 0) {
                        const targetSeason = renderOptions.seasons.find(s => Number(s.season_number) === Number(selection.seasonNumber));
                        if (targetSeason?.url) {
                            renderOptions.resolvedSeasonUrl = targetSeason.url;
                        } else {
                            renderOptions.resolvedSeasonUrl = null;
                        }
                    } else {
                        renderOptions.resolvedSeasonUrl = null;
                    }
                }
                if (selection.episodeNumber != null) {
                    renderOptions.episode = selection.episodeNumber;
                    renderOptions.resolvedEpisodeNumber = selection.episodeNumber;
                    const isSourcesMatchingSeason = !entry.sourcesSeasonNumber || Number(entry.sourcesSeasonNumber) === Number(selection.seasonNumber);
                    if (isSourcesMatchingSeason && entry.sources && entry.sources.length > 0) {
                        const targetEpNum = Number(selection.episodeNumber);
                        const extractEp = (s) => (parser.extractEpisodeNumber
                            ? parser.extractEpisodeNumber(s)
                            : (typeof SeasonvarParser !== 'undefined' && SeasonvarParser.extractEpisodeNumber
                                ? SeasonvarParser.extractEpisodeNumber(s)
                                : null));
                        let targetSource = entry.sources.find(s => extractEp(s) === targetEpNum);
                        if (!targetSource) {
                            const idx = targetEpNum - 1;
                            if (idx >= 0 && idx < entry.sources.length) targetSource = entry.sources[idx];
                        }
                        if (targetSource) {
                            renderOptions.resolvedEpisodeUrl = targetSource.url;
                        }
                    } else {
                        renderOptions.resolvedEpisodeUrl = null;
                    }
                }
                if (selection.initialTimestamp > 0) {
                    renderOptions.resolvedTimestamp = selection.initialTimestamp;
                }
            }

            console.log('[SeasonPickerTrace] mountPlayer render request', {
                parserId,
                canonicalSelection: selection,
                entrySeason: entry.sourcesSeasonNumber,
                entryEpisodeCount: entry.sources?.length || 0,
                renderSeason: renderOptions.season,
                renderEpisode: renderOptions.episode,
                resolvedSeasonUrl: renderOptions.resolvedSeasonUrl,
                resolvedEpisodeNumber: renderOptions.resolvedEpisodeNumber,
                resolvedEpisodeUrl: renderOptions.resolvedEpisodeUrl,
                sourceCount: entry.sources?.length || 0
            });

            await parser.renderPlayer(this.elements.videoContainer, entry.sources, renderOptions);

            if (this.elements.videoContainer?.__seasonvarPlaybackState) {
                this.currentSeasonvarPlaybackState = this.elements.videoContainer.__seasonvarPlaybackState;
                console.log('[SeasonPickerTrace] mountPlayer result', {
                    activeSeasonNumber: this.currentSeasonvarPlaybackState.activeSeasonNumber,
                    activeEpisodeNumber: this.currentSeasonvarPlaybackState.activeEpisodeNumber,
                    activeSeasonUrl: this.currentSeasonvarPlaybackState.activeSeasonUrl,
                    activeEpisodeUrl: this.currentSeasonvarPlaybackState.activeEpisodeUrl,
                    episodeCount: this.currentSeasonvarPlaybackState.episodes?.length || 0
                });
                this.updatePlayerNavigationControls();
                if (this.currentSeasonvarPlaybackState.activeSeasonNumber != null) {
                    entry.sourcesSeasonNumber = this.currentSeasonvarPlaybackState.activeSeasonNumber;
                    entry.sourcesSeasonUrl = this.currentSeasonvarPlaybackState.activeSeasonUrl;
                    if (this.currentSeasonvarPlaybackState.episodes?.length > 0) {
                        entry.sources = this.currentSeasonvarPlaybackState.episodes;
                    }
                }
            }

            if (sourceRequestId !== null && !this.isSourceSwitchRequestCurrent(sourceRequestId, movieId)) {
                return false;
            }
            
            this.activePlayerId = parserId;
            window._playerMounted = true;
            
            // We still need to _attachListeners manually if required, though renderPlayer often does it
            if (parser?.getPlayerType() === 'custom' && parser._attachListeners) {
                // Not calling here directly if renderPlayer already does it, 
                // but kept for compatibility if needed. (Seasonvar's renderPlayer calls it internally).
            }
        } else {
            this.getPlayerSurface().clear();
            const playerElement = entry.container.querySelector('.player-clean') 
                || entry.container.querySelector('.video-wrapper')
                || entry.container.firstElementChild;
            
            if (!playerElement) return false;
            
            this.getPlayerSurface().mountElement(playerElement);
            this.activePlayerId = parserId;
            window._playerMounted = true;

            const mountedVideo = this.elements.videoContainer.querySelector('video');
            const lifecycle = window.PlayerSourceLifecycle;
            if (mountedVideo && lifecycle) {
                const lifecycleOptions = this.createSourceLifecycleOptions({
                    url: `parser:${parserId}`,
                    parserId,
                    movieId,
                    requestId: sourceRequestId
                });
                this.sourceLifecycleWatcher = lifecycle.watchVideo(mountedVideo, {
                    timeoutMs: 5000,
                    isRequestCurrent: lifecycleOptions.isRequestCurrent,
                    onState: (state, detail) => {
                        if (!lifecycleOptions.isRequestCurrent()) return;
                        lifecycle.setState(this.elements.videoContainer, state, {
                            onRetry: lifecycleOptions.onRetry,
                            onResearch: lifecycleOptions.onResearch
                        });
                        lifecycleOptions.onLifecycleState(state, detail);
                    }
                });
            }
            
            if (parser?.getPlayerType() === 'custom' && parser._attachListeners) {
                parser._attachListeners(this.elements.videoContainer, entry.renderOptions || {});
            }
        }
        
        const videoAfter = this.elements.videoContainer.querySelector('video');
        if (videoAfter) {
            try {
                const playPromise = videoAfter.play();
                if (playPromise) {
                    playPromise.catch((err) => {
                        console.warn(`[Player] Playback did not start after mounting ${parserId}: ${err.name}: ${err.message}`);
                    });
                }
            } catch (playErr) {
                console.warn(`[Player] Playback failed after mounting ${parserId}: ${playErr.name}: ${playErr.message}`);
            }
        }
        
        return true;
    }

    unmountActivePlayer() {
        this.detachTorrentPlaybackVideo();
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
                this.postToPlayerFrame(iframe, { type: 'PAUSE' });
            } catch { /* Ignore */ }
        }
        
        const playerElement = this.elements.videoContainer.querySelector('.player-clean')
            || this.elements.videoContainer.querySelector('.video-wrapper')
            || this.elements.videoContainer.firstElementChild;
        
        if (playerElement && !entry.dataOnly) {
            entry.container.appendChild(playerElement);
        } else if (entry.dataOnly) {
            // BUG 1 FIX: Clear the entire container so Seasonvar DOM
            // (horizontal-episodes, episode labels) doesn't bleed through
            this.getPlayerSurface().clear();
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
                        this.postToPlayerFrame(f, { type: 'RESET_PERMANENT_VIDEO' });
                    }
                } catch { /* Ignore */ }
            });
        } catch { /* Ignore */ }
        
        entry.container.style.display = 'none';
        this.activePlayerId = null;
    }

    /**
     * Dynamically populate the source buttons from ParserRegistry + fetched sources.
     */
    normalizeVideoSources(sources = []) {
        const sourceList = Array.isArray(sources) ? sources : [];
        const priorityIds = this.parserRegistry?.getIds?.() || [];
        const priorityByParser = new Map(priorityIds.map((id, index) => [id, index]));
        const fallbackPriority = priorityIds.length;

        const sorted = sourceList
            .filter(source => source?.url)
            .map((source, index) => ({
                source: { ...source, url: String(source.url).trim() },
                index
            }))
            .filter(({ source }) => {
                const parser = source.parserId ? this.parserRegistry?.get?.(source.parserId) : null;
                return !parser || typeof parser.supportsSourceType !== 'function' || parser.supportsSourceType(source);
            })
            .sort((left, right) => {
                const leftParserId = left.source.parserId || '';
                const rightParserId = right.source.parserId || '';
                const priorityDifference = (priorityByParser.get(leftParserId) ?? fallbackPriority)
                    - (priorityByParser.get(rightParserId) ?? fallbackPriority);
                if (priorityDifference !== 0) return priorityDifference;
                if (leftParserId !== rightParserId) return leftParserId < rightParserId ? -1 : 1;
                return left.index - right.index;
            });

        const seenUrls = new Set();
        return sorted.reduce((uniqueSources, { source }) => {
            if (seenUrls.has(source.url)) return uniqueSources;
            seenUrls.add(source.url);
            uniqueSources.push(source);
            return uniqueSources;
        }, []);
    }

    formatSourceLabel(source, index) {
        const parserName = source.parserId ? this.parserRegistry.get(source.parserId)?.name : null;
        const label = String(source.name || `Источник ${index + 1}`).trim();
        if (!parserName || label.toLocaleLowerCase().includes(parserName.toLocaleLowerCase())) {
            return label;
        }
        return `${parserName}: ${label}`;
    }

    getParserSelectorIds(movieType = this.selectedMovie?.type) {
        return new Set(
            this.parserRegistry.getAll()
                .filter(parser => parser.supportsMedia?.(this.selectedMovie, movieType) ?? (!movieType || parser.supportsType(movieType)))
                .map(parser => parser.id)
        );
    }

    async refreshMediaPlayerReadiness() {
        const requestId = ++this.mediaPlayerReadinessRequestId;
        const chromeApi = typeof chrome !== 'undefined' ? chrome : null;
        const setupKey = this.mediaPlayerService?.constructor?.SETUP_STORAGE_KEY || 'mediaplayer_setup_v1';
        if (!this.mediaPlayerService || !chromeApi?.storage?.local?.get) {
            this.mediaPlayerReady = false;
            this.mediaPlayerSetupState = { enabled: false, status: 'disabled', installPath: '' };
            return false;
        }

        let values;
        try {
            values = await new Promise((resolve, reject) => {
                chromeApi.storage.local.get(['mediaPlayerEnabled', setupKey], result => {
                    const runtimeError = chromeApi.runtime?.lastError;
                    if (runtimeError) reject(runtimeError);
                    else resolve(result || {});
                });
            });
        } catch {
            if (requestId !== this.mediaPlayerReadinessRequestId) return false;
            this.mediaPlayerReady = false;
            return false;
        }

        if (requestId !== this.mediaPlayerReadinessRequestId) return false;
        const enabled = values.mediaPlayerEnabled === true;
        const storedSetup = this.mediaPlayerService.normalizeSetupState(
            { ...(values[setupKey] || {}), enabled }
        );
        this.mediaPlayerSetupState = storedSetup;
        if (!enabled || storedSetup.status !== 'ready') {
            this.mediaPlayerReady = false;
            if (this.activeSourceValue === MEDIA_PLAYER_TORRENT_SOURCE) {
                this.activeSourceValue = '';
                this.elements?.torrentSourcePanel?.setAttribute('hidden', '');
            }
            return false;
        }

        try {
            const runtimeSetup = await this.mediaPlayerService.getRuntimeReadiness();
            if (requestId !== this.mediaPlayerReadinessRequestId) return false;
            this.mediaPlayerSetupState = runtimeSetup;
            this.mediaPlayerReady = runtimeSetup?.enabled === true && runtimeSetup?.status === 'ready';
        } catch {
            if (requestId !== this.mediaPlayerReadinessRequestId) return false;
            this.mediaPlayerReady = false;
        }
        return this.mediaPlayerReady;
    }

    shouldDisplaySourceButton(source, parserSelectorIds) {
        return !parserSelectorIds.has(source?.parserId);
    }

    isTorrentMovie(movie = this.selectedMovie) {
        if (!movie) return false;

        // Keep torrent eligibility aligned with the playback classifier. Movie
        // DTOs may contain empty seasons arrays; their presence alone must not
        // hide the torrent source from an otherwise valid film.
        if (typeof isSeriesMedia === 'function') return !isSeriesMedia(movie);

        const type = String(movie.type || '').toLowerCase().replace(/_/g, '-');
        const mediaType = String(movie.mediaType || '').toLowerCase().replace(/_/g, '-');
        const seriesTypes = new Set(['tv', 'tv-series', 'tv-show', 'series', 'mini-series', 'animated-series']);
        const hasSeasons = (Array.isArray(movie.seasons) && movie.seasons.length > 0)
            || (Array.isArray(movie.seasonsInfo) && movie.seasonsInfo.length > 0);
        return !movie.isSeries
            && !seriesTypes.has(type)
            && !seriesTypes.has(mediaType)
            && !hasSeasons
            && !(Number(movie.totalSeasons) > 0)
            && movie.first_air_date === undefined;
    }

    getMediaPlayerTmdbId(movie = this.selectedMovie) {
        const value = movie?.tmdbId ?? movie?.identity?.tmdbId ?? movie?.externalId?.tmdb ?? movie?.externalIds?.tmdb;
        const numericId = Number(value);
        return Number.isSafeInteger(numericId) && numericId > 0 ? numericId : null;
    }

    populateSourceSelector() {
        let savedValue = this.activeSourceValue;
        if (!savedValue && this.elements.sourceButtonsContainer) {
            savedValue = this.elements.sourceButtonsContainer.querySelector('.source-btn.active')?.getAttribute('data-value');
        }
        if (!this.elements.sourceButtonsContainer) return;
        this.elements.sourceButtonsContainer.innerHTML = '';

        this.currentSources = this.normalizeVideoSources(this.currentSources);

        // Non-iframe parsers need one canonical parser button so source.type is
        // resolved by renderPlayer instead of sending a direct-video URL to an iframe.
        const movieType = this.selectedMovie?.type;
        const parserSelectorIds = this.getParserSelectorIds(movieType);
        this.parserRegistry.getAll().forEach(parser => {
            if (parserSelectorIds.has(parser.id)) {

                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'source-btn';
                btn.setAttribute('data-value', `parser:${parser.id}`);
                btn.setAttribute('aria-pressed', 'false');
                btn.textContent = parser.name;
                this.elements.sourceButtonsContainer.appendChild(btn);
            }
        });

        // MediaPlayer is a local backend source, not an iframe parser. Keep it
        // in the same provider rail while opening a dedicated torrent picker.
        if (this.mediaPlayerReady && this.isTorrentMovie()) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'source-btn';
            btn.setAttribute('data-value', MEDIA_PLAYER_TORRENT_SOURCE);
            btn.setAttribute('aria-pressed', 'false');
            btn.setAttribute('aria-label', 'Торрент-раздачи через MediaPlayer');
            btn.textContent = 'Торрент';
            this.elements.sourceButtonsContainer.appendChild(btn);
        }

        // --- VidSrc embed source ---
        const imdbId = this.selectedMovie?.externalId?.imdb;
        if (imdbId) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'source-btn';
            btn.setAttribute('data-value', `vidsrc:${imdbId}`);
            btn.setAttribute('aria-pressed', 'false');
            btn.textContent = 'VidSrc';
            this.elements.sourceButtonsContainer.appendChild(btn);
        }
        // --- end VidSrc ---

        // Add URL buttons only for parsers without a canonical parser button.
        // Ex-FS, for example, can expose video or iframe sources and must not appear twice.
        if (this.currentSources && this.currentSources.length > 0) {
            this.currentSources.forEach((source, index) => {
                if (!this.shouldDisplaySourceButton(source, parserSelectorIds)) return;

                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'source-btn';
                btn.setAttribute('data-value', source.url);
                btn.setAttribute('aria-pressed', 'false');
                btn.textContent = this.formatSourceLabel(source, index);
                this.elements.sourceButtonsContainer.appendChild(btn);
            });
        }
        
        const hasSavedValue = savedValue && this.elements.sourceButtonsContainer.querySelector(`[data-value="${savedValue}"]`);
        if (hasSavedValue) {
            this.updateActiveSourceButton(savedValue);
        }
        this.refreshSourceButtonStates();
    }

    /**
     * Show the dub selector for the mounted provider player. Parsers publish
     * `__providerDubState` on the video container after rendering (AnimeGo);
     * the selector stays hidden for providers without a host-side dub choice.
     * @param {string|null} providerId - Provider that just mounted, or null to hide
     */
    refreshProviderDubSelector(providerId = null) {
        this.bindProviderDubStateListener();
        const doc = typeof document !== 'undefined' ? document : null;
        const control = doc?.getElementById?.('sourceDubControl');
        const select = doc?.getElementById?.('sourceDubSelect');
        if (!control || !select) return;

        const state = providerId ? this.elements?.videoContainer?.__providerDubState : null;
        const translations = state?.providerId === providerId ? state.translations || [] : [];
        if (translations.length < 2) {
            control.hidden = true;
            select.replaceChildren();
            return;
        }

        select.replaceChildren(...translations.map(translation => {
            const option = doc.createElement('option');
            option.value = translation.id;
            option.textContent = translation.name;
            option.selected = translation.id === state.activeTranslationId;
            return option;
        }));
        if (!select.dataset.dubBound) {
            select.dataset.dubBound = 'true';
            select.addEventListener('change', () => {
                void this.onProviderDubChange(select.value);
            });
        }
        control.hidden = false;
    }

    /**
     * A parser can change its dub state without a source switch: when the
     * native stream fails at runtime and its iframe takes over, the toolbar
     * selector must appear and progress tracking must stop. Bound once.
     */
    bindProviderDubStateListener() {
        const container = this.elements?.videoContainer;
        if (!container?.addEventListener || container.dataset?.providerDubStateBound) return;
        if (container.dataset) container.dataset.providerDubStateBound = 'true';
        container.addEventListener('providerdubstatechange', event => {
            const activeProvider = this.playbackController?.getActiveProvider?.() || this.activePlayerId;
            if (!activeProvider || event?.detail?.providerId !== activeProvider) return;
            this.refreshProviderDubSelector(activeProvider);
            this.bindProviderVideoTracking?.(activeProvider);
        });
    }

    /**
     * Attach PlaybackController progress/completion/ended tracking to the
     * native video of an opt-in parser mount (AnimeGo's Kodik stream). Other
     * sources, and AnimeGo's iframe fallback, are detached.
     * @param {string|null} providerId - Provider that just mounted, or null
     * @returns {boolean}
     */
    bindProviderVideoTracking(providerId = null) {
        const controller = this.playbackController;
        if (typeof controller?.attachExternalVideo !== 'function') return false;
        const adapter = providerId ? controller.getAdapter?.(providerId) : null;
        const video = this.elements?.videoContainer?.querySelector?.('video[data-progress-owner="canonical"]');
        const eligible = adapter?.supportsInPlaceSelection?.() === true
            && adapter.getProgressConfidence?.() === 'RELIABLE'
            && Boolean(video);
        if (!eligible) {
            controller.detachExternalVideo?.();
            return false;
        }
        return controller.attachExternalVideo(video, { providerId, selection: controller.getSelection?.() });
    }

    async onProviderDubChange(translationId) {
        const state = this.elements?.videoContainer?.__providerDubState;
        const parser = state ? this.parserRegistry?.get?.(state.providerId) : null;
        if (!parser?.setPreferredTranslation || !translationId || translationId === state.activeTranslationId) return;
        parser.setPreferredTranslation(state.contextId, translationId);
        await this.changeVideoSource(`parser:${state.providerId}`);
    }

    /**
     * Canonical (Kinopoisk/TMDB) seasons with their episode counts. Providers
     * that number episodes across a whole title (AnimeGo) map seasons with it.
     * @returns {Array<{seasonNumber: number, episodeCount: number}>}
     */
    getCanonicalSeasonLayout(movie = this.selectedMovie) {
        const seasons = Array.isArray(movie?.seasons) ? movie.seasons : [];
        return seasons
            .filter(season => !season?.isSpecial)
            .map(season => ({
                seasonNumber: Number(season?.number ?? season?.seasonNumber),
                episodeCount: Number(
                    season?.episodeCount
                    ?? season?.episodesCount
                    ?? season?.episodes?.length
                    ?? 0
                ) || 0,
                // Lets providers that name later seasons by subtitle (AnimeGo:
                // "ДжоДжо: Гонка «Стальной шар»") find a season by its year.
                airYear: Number(String(season?.airDate || season?.air_date || '').slice(0, 4)) || null
            }))
            .filter(season => Number.isInteger(season.seasonNumber) && season.seasonNumber > 0);
    }

    /**
     * Episodes of a season as the active provider numbers them (AnimeGo).
     * Cached for the picker's synchronous filler marks.
     * @param {number} seasonNumber
     * @returns {Promise<Array<{episodeNumber: number, filler: boolean}>|null>}
     */
    async loadProviderSeasonEpisodes(seasonNumber) {
        const activeProvider = this.playbackController?.getActiveProvider?.() || this.activePlayerId;
        const parser = activeProvider ? this.parserRegistry?.get?.(activeProvider) : null;
        const sources = activeProvider ? this.playerRegistry?.[activeProvider]?.sources : null;
        if (typeof parser?.getSeasonEpisodeList !== 'function' || !Array.isArray(sources) || sources.length === 0) {
            this.providerSeasonEpisodes = null;
            return null;
        }
        const season = Number(seasonNumber) || 1;
        let episodes = null;
        try {
            episodes = await parser.getSeasonEpisodeList(sources, season, {
                canonicalSeasons: this.getCanonicalSeasonLayout()
            });
        } catch (error) {
            console.warn('[MovieDetails] Provider season episodes unavailable:', error);
        }
        this.providerSeasonEpisodes = { providerId: activeProvider, seasonNumber: season, episodes: episodes || [] };
        return episodes;
    }

    /**
     * Filler episode numbers of the season last loaded for the picker.
     * @param {number} seasonNumber
     * @returns {Set<number>|null}
     */
    getProviderFillerEpisodes(seasonNumber) {
        const activeProvider = this.playbackController?.getActiveProvider?.() || this.activePlayerId;
        const cached = this.providerSeasonEpisodes;
        if (!cached || cached.providerId !== activeProvider || cached.seasonNumber !== Number(seasonNumber)) return null;
        const fillers = new Set(cached.episodes.filter(episode => episode.filler).map(episode => Number(episode.episodeNumber)));
        return fillers.size > 0 ? fillers : null;
    }

    getSourceButtonProviderKey(value) {
        const sourceValue = String(value || '');
        if (sourceValue.startsWith('parser:')) return sourceValue.slice('parser:'.length);
        if (sourceValue.startsWith('vidsrc:')) return 'vidsrc';
        return null;
    }

    // Status is carried by text (title + hidden label) and dot shape, not only color.
    refreshSourceButtonStates() {
        const container = this.elements?.sourceButtonsContainer;
        if (!container?.querySelectorAll) return;
        const lifecycleState = this.elements.videoContainer?.dataset?.sourceState || '';
        const labels = {
            loading: 'загружается',
            ready: 'воспроизводится',
            unavailable: 'недоступен — нажмите, чтобы повторить'
        };
        container.querySelectorAll('.source-btn').forEach(btn => {
            const providerKey = this.getSourceButtonProviderKey(btn.getAttribute('data-value'));
            let state = '';
            if (btn.classList.contains('active')) {
                if (lifecycleState === 'loading') state = 'loading';
                else if (lifecycleState === 'ready') state = 'ready';
                else if (lifecycleState === 'error' || lifecycleState === 'unavailable') state = 'unavailable';
            } else if (providerKey && this.unavailableProviderIds?.has(providerKey)) {
                state = 'unavailable';
            }

            if (state) btn.dataset.sourceState = state;
            else delete btn.dataset.sourceState;

            let stateLabel = btn.querySelector('.source-btn__state');
            if (state && !stateLabel) {
                stateLabel = document.createElement('span');
                stateLabel.className = 'source-btn__state';
                btn.appendChild(stateLabel);
            }
            if (stateLabel) stateLabel.textContent = state ? `, ${labels[state]}` : '';
            const name = btn.firstChild?.nodeType === 3 ? btn.firstChild.textContent.trim() : btn.textContent.trim();
            btn.title = state ? `${name}: ${labels[state]}` : name;
        });
    }

    updateActiveSourceButton(value) {
        if (!this.elements.sourceButtonsContainer) return false;
        this.activeSourceValue = value;
        const buttons = this.elements.sourceButtonsContainer.querySelectorAll('.source-btn');
        let found = false;
        buttons.forEach(btn => {
            if (btn.getAttribute('data-value') === value) {
                btn.classList.add('active');
                btn.setAttribute('aria-pressed', 'true');
                found = true;
            } else {
                btn.classList.remove('active');
                btn.setAttribute('aria-pressed', 'false');
            }
        });
        this.refreshSourceButtonStates();
        return found;
    }

    resetHlsRecoveryState() {
        this.hlsPlaybackState = '';
    }

    beginSourceSwitchRequest() {
        this.sourceLifecycleWatcher?.cancel?.();
        this.sourceLifecycleWatcher = null;
        this.sourceSwitchRequestId += 1;
        return this.sourceSwitchRequestId;
    }

    isSourceSwitchRequestCurrent(requestId, movieId = this.selectedMovie?.kinopoiskId) {
        return requestId === this.sourceSwitchRequestId
            && String(this.selectedMovie?.kinopoiskId) === String(movieId);
    }

    setPlayerSourceState(state, options = {}) {
        const lifecycle = window.PlayerSourceLifecycle;
        if (!lifecycle || !this.elements.videoContainer) return;
        lifecycle.setState(this.elements.videoContainer, state, options);
    }

    invalidateSourceCache(movieId = this.selectedMovie?.kinopoiskId) {
        if (!movieId) return;
        localStorage.removeItem(`movie_sources_${movieId}`);
    }

    createSourceLifecycleOptions({ url, parserId = null, movieId, requestId }) {
        const isRequestCurrent = () => requestId === null
            || this.isSourceSwitchRequestCurrent(requestId, movieId);
        return {
            requestId,
            isRequestCurrent,
            onRetry: () => this.changeVideoSource(url),
            onResearch: () => this.forceResearchSources(url, parserId),
            onLifecycleState: state => {
                if (!isRequestCurrent()) return;
                if (state === 'error' || state === 'unavailable') {
                    this.invalidateSourceCache(movieId);
                }
            }
        };
    }

    retryKinogoAfterContentError(failedUrl = null) {
        const movieId = String(this.selectedMovie?.kinopoiskId || '');
        const selection = this.playbackController?.getSelection?.() || {};
        const recoveryKey = [
            movieId,
            selection.seasonNumber ?? 'na',
            selection.episodeNumber ?? 'na'
        ].join(':');
        const recovery = this.kinogoContentRecovery;

        if (!recovery || !movieId) return false;
        if (recovery.key !== recoveryKey) {
            recovery.key = recoveryKey;
            recovery.attempts = 0;
            recovery.inFlight = null;
        }
        if (recovery.inFlight || recovery.attempts >= 1) return false;

        recovery.attempts += 1;
        console.warn('[KinogoSearchTrace] provider content 404; refreshing embed token', {
            movieId,
            seasonNumber: selection.seasonNumber ?? null,
            episodeNumber: selection.episodeNumber ?? null,
            failedUrl: failedUrl || null,
            attempt: recovery.attempts,
            maxAttempts: 1
        });

        recovery.inFlight = this.forceResearchSources('parser:kinogo', 'kinogo')
            .then(result => {
                console.info('[KinogoSearchTrace] fresh embed recovery finished', {
                    movieId,
                    seasonNumber: selection.seasonNumber ?? null,
                    episodeNumber: selection.episodeNumber ?? null,
                    success: Boolean(result)
                });
                return result;
            })
            .catch(error => {
                console.warn('[KinogoSearchTrace] fresh embed recovery failed', {
                    movieId,
                    message: error?.message || String(error)
                });
                return false;
            })
            .finally(() => {
                recovery.inFlight = null;
            });

        return true;
    }

    async forceResearchSources(failedUrl, parserId = null) {
        const movie = this.selectedMovie;
        if (!movie) return false;
        const movieId = String(movie.kinopoiskId);
        const requestId = this.beginSourceSwitchRequest();
        const isRequestCurrent = () => this.isSourceSwitchRequestCurrent(requestId, movieId);

        this.invalidateSourceCache(movieId);
        this.setPlayerSourceState('loading', { message: 'Повторный поиск источников…' });

        if (parserId) {
            const parser = this.parserRegistry.get(parserId);
            parser?.clearCache?.();
            const entry = this.playerRegistry[parserId];
            if (entry?.movieId === movieId) {
                entry.initialized = false;
                entry.ready = false;
                entry.dataOnly = false;
                entry.sources = [];
                entry.container.innerHTML = '';
            }
            return this.loadParserSource(parserId, requestId, { forceRefresh: true });
        }

        this.parserRegistry.getAll().forEach(parser => parser.clearCache?.());
        this.currentSources = [];
        await this.preloadSources(movie);
        if (!isRequestCurrent()) return false;

        this.populateSourceSelector();
        const replacement = this.currentSources.find(source => source.url !== failedUrl);
        if (replacement) return this.changeVideoSource(replacement.url);

        this.setPlayerSourceState('unavailable', {
            message: 'Новые доступные источники не найдены.',
            onRetry: () => this.forceResearchSources(failedUrl)
        });
        return false;
    }

    async changeVideoSource(url, { fromWatchRoom = false, providerSource = null } = {}) {
        if (!url) return false;
        if (url === MEDIA_PLAYER_TORRENT_SOURCE) {
            if (!this.mediaPlayerReady && !(await this.refreshMediaPlayerReadiness())) return false;
            return this.openTorrentPicker();
        }
        this.closeEpisodePicker();

        const movieId = String(this.selectedMovie?.kinopoiskId || '');
        const requestId = this.beginSourceSwitchRequest();

        this.updateActiveSourceButton(url);
        // The dub selector belongs to the mounted player; hide it until the
        // new source publishes its own choices.
        this.refreshProviderDubSelector?.(null);
        this.playbackController?.detachExternalVideo?.();

        let providerKey = url;
        if (url.startsWith('parser:')) {
            providerKey = url.replace('parser:', '');
        } else if (url.startsWith('vidsrc:')) {
            providerKey = 'vidsrc';
        }

        this.unavailableProviderIds?.delete?.(providerKey);

        // Keep the canonical controller provider aligned with legacy/manual source
        // mounting. Without this, a previous provider (for example Ex-FS) remains
        // active in PlaybackController and the next episode selection is routed
        // back to that stale provider instead of the source the user selected.
        if (this.playbackController && (url.startsWith('parser:') || url.startsWith('vidsrc:'))) {
            this.playbackController.setActiveProvider(providerKey);
        }

        const currentSel = this.playbackController?.getSelection();
        if (this.playbackController && currentSel) {
            this.playbackController.updateSelection({
                providerId: providerKey,
                source: (currentSel.source && ['SEASONS_TAB', 'NEXT_EPISODE_HERO', 'RESUME', 'PLAYER_NAVIGATION', 'AUTO_NEXT', 'PLAYER_PROVIDER_PICKER'].includes(currentSel.source))
                    ? currentSel.source
                    : 'PROVIDER_SWITCH'
            });
        }

        this.updateSourceGuidance(providerKey);
        this.updatePlayerHeaderTitle();
        // Render provider-capability navigation immediately; it must not wait
        // for the iframe's native player to finish loading.
        this.updatePlayerNavigationControls();

        if (movieId) {
            await this.saveLastSource(movieId, url);
        }

        if (!this.isSourceSwitchRequestCurrent(requestId, movieId)) return false;
        
        // VidSrc embed source
        if (url.startsWith('vidsrc:')) {
            this.unmountActivePlayer();
            this.loadVidSrcSource(url.replace('vidsrc:', ''), { requestId, movieId });
            return this.isSourceSwitchRequestCurrent(requestId, movieId);
        }

        // Check if this is a parser-based source (e.g. "parser:seasonvar")
        if (url.startsWith('parser:')) {
            const parserId = url.replace('parser:', '');
            const entry = this.playerRegistry[parserId];
            let sourceChanged;
            if (!providerSource && entry && entry.movieId === String(this.selectedMovie?.kinopoiskId) && entry.initialized) {
                sourceChanged = await this.mountPlayer(parserId, movieId, requestId);
            } else {
                sourceChanged = await this.loadParserSource(parserId, requestId, {
                    forceRefresh: Boolean(providerSource),
                    providerSource,
                });
            }
            if (sourceChanged && !fromWatchRoom) {
                this.watchRoomController?.publishHostProvider(parserId, this.getWatchRoomProviderSource());
            }
            if (this.isSourceSwitchRequestCurrent(requestId, movieId)) {
                this.refreshProviderDubSelector?.(sourceChanged ? parserId : null);
                this.bindProviderVideoTracking?.(sourceChanged ? parserId : null);
            }
            return sourceChanged;
        }

        this.currentVideoUrl = url;
        this.isPlaying = false;
        
        // Detach any active parser player before replacing container contents
        this.unmountActivePlayer();
        
        this.renderDefaultPlayer(url, { requestId, movieId });
        return this.isSourceSwitchRequestCurrent(requestId, movieId);
    }

    /**
     * Load video source via a registered parser.
     * Generalized replacement for the old loadSeasonvarSource().
     * @param {string} parserId - ID of the parser to use
     */
    async loadParserSource(parserId, sourceRequestId = null, { forceRefresh = false, providerSource = null } = {}) {
        if (!this.selectedMovie) return false;

        this.unavailableProviderIds?.delete?.(parserId);

        const targetMovie = this.selectedMovie;
        const movieId = String(targetMovie.kinopoiskId);
        const loadStartedAt = performance.now();
        const isRequestCurrent = () => sourceRequestId === null
            || this.isSourceSwitchRequestCurrent(sourceRequestId, movieId);
        
        const parser = this.parserRegistry.get(parserId);
        if (!parser) {
            console.error(`[Player] Parser "${parserId}" was not found`, { available: this.parserRegistry.getIds() });
            this.renderPlayerPlaceholder(`Парсер "${parserId}" не найден`);
            return false;
        }

        const entry = this.playerRegistry[parserId];
        if (!entry || entry.movieId !== movieId) {
            console.warn(`[MovieDetails] Ignoring ${parser.name} load for stale movie ${movieId}`);
            return false;
        }

        console.log('[SeasonPickerTrace] loadParserSource started', {
            parserId,
            sourceRequestId,
            forceRefresh,
            canonicalSelection: this.playbackController?.getSelection(),
            existingSeason: entry.sourcesSeasonNumber,
            existingEpisodeCount: entry.sources?.length || 0
        });

        this.setPlayerSourceState('loading', { message: `Загрузка ${parser.name}…` });
        
        try {
            const name = targetMovie.name || targetMovie.alternativeName;
            const selection = this.playbackController?.getSelection();
            const requestedMediaType = targetMovie.type || (targetMovie.isSeries ? 'tv-series' : null);
            const requiresSeasonSpecificSearch = parserId === 'kinogo'
                && parser.isSeriesMediaType?.(requestedMediaType)
                && selection?.seasonNumber != null;

            const usesBaseRenderer = parser.renderPlayer === BaseParserService.prototype.renderPlayer;
            const reusableSources = usesBaseRenderer && !forceRefresh && !requiresSeasonSpecificSearch
                ? (this.currentSources || []).filter(source => {
                    if (source.parserId !== parserId || !source.url) return false;
                    return true;
                })
                : [];
            const reusedDiscoveredSources = reusableSources.length > 0;
            let searchResult = null;
            let sources = reusableSources;

            console.info('[Player] Source load started', {
                parserId,
                movieId,
                requestId: sourceRequestId,
                reusedDiscoveredSources,
                requiresSeasonSpecificSearch,
                requestedSeason: selection?.seasonNumber ?? null
            });

            if (providerSource && parserId === 'rutube') {
                searchResult = parser.getRoomSearchResult?.(providerSource) || null;
            } else if (!reusedDiscoveredSources) {
                // Use enhanced search if available (e.g. SeasonvarParser.searchBestMatch)
                if (parser.searchBestMatch) {
                    searchResult = await parser.searchBestMatch(name, targetMovie.alternativeName, targetMovie.year, {
                        mediaType: requestedMediaType
                    });
                } else {
                    const searchTraceLabel = parserId === 'kinogo' ? '[KinogoSearchTrace]' : '[PlayerSearchTrace]';
                    console.log(`${searchTraceLabel} MovieDetails search dispatch`, {
                        parserId,
                        title: name,
                        year: targetMovie.year || null,
                        requestedMediaType,
                        requestedSeason: selection?.seasonNumber ?? null,
                        isSeries: Boolean(targetMovie.isSeries),
                        cacheKeyIncludesMediaType: true
                    });
                    // The original title is a fallback for providers that list
                    // a title only under it; it never replaces a primary match.
                    const searchTitles = [...new Set(
                        [name, targetMovie.alternativeName]
                            .map(value => (typeof value === 'string' ? value.trim() : ''))
                            .filter(Boolean)
                    )];
                    for (const searchTitle of searchTitles) {
                        // Same options as background discovery, so both share
                        // one cache entry for the title.
                        searchResult = await parser.cachedSearch(searchTitle, targetMovie.year, {
                            mediaType: requestedMediaType,
                            seasonNumber: selection?.seasonNumber ?? null,
                            altName: targetMovie.alternativeName || null
                        });
                        if (searchResult) break;
                    }
                }

                if (searchResult && typeof parser.isSearchResultCompatible === 'function'
                    && !parser.isSearchResultCompatible(searchResult, targetMovie.type)) {
                    console.warn('[MovieDetails] Ignoring incompatible parser result', {
                        parserId,
                        mediaType: targetMovie.type,
                        result: searchResult
                    });
                    searchResult = null;
                }

                if (String(this.selectedMovie?.kinopoiskId) !== movieId || this.playerRegistry[parserId] !== entry || !isRequestCurrent()) return false;

                if (!searchResult) {
                    this.setPlayerSourceState('unavailable', {
                        message: `Ничего не найдено на ${parser.name}.`,
                        onRetry: () => this.changeVideoSource(`parser:${parserId}`),
                        onResearch: () => this.forceResearchSources(`parser:${parserId}`, parserId)
                    });
                    return false;
                }
            }

            // Part 2 & Part 5: Fetch seasons first (if supported) and resolve target season URL
            let seriesInfo = null;
            let seasons = [];

            if (parser.getSeasons && searchResult?.url) {
                try {
                    seasons = await parser.getSeasons(searchResult.url);
                } catch (e) {
                    console.warn('[MovieDetails] Failed to load seasons:', e);
                }
            }

            let effectiveSeasonUrl = searchResult?.url;

            if (selection?.seasonNumber != null && seasons && seasons.length > 0) {
                const targetSeason = seasons.find(s => Number(s.season_number) === Number(selection.seasonNumber));
                if (targetSeason && targetSeason.url) {
                    effectiveSeasonUrl = targetSeason.url;
                    console.log(`[MovieDetails] Resolved target Season ${selection.seasonNumber} URL: ${effectiveSeasonUrl}`);
                } else {
                    console.warn(`[MovieDetails] Requested Season ${selection.seasonNumber} not found in provider seasons list (${seasons.length} seasons). Preserving canonical selection.`);
                }
            }

            if (parser.getSeriesInfo && effectiveSeasonUrl) {
                try {
                    seriesInfo = await parser.getSeriesInfo(effectiveSeasonUrl);
                } catch (e) {
                    console.warn('[MovieDetails] Failed to load series info:', e);
                }
            }

            if (!reusedDiscoveredSources) {
                if (effectiveSeasonUrl) {
                    const forceFreshSeasonSource = parserId === 'kinogo'
                        && parser.isSeriesMediaType?.(requestedMediaType)
                        && selection?.seasonNumber != null;
                    if (forceFreshSeasonSource) {
                        console.info(`[KinogoSearchTrace] source cache policy ${JSON.stringify({
                            requestedSeason: Number(selection.seasonNumber),
                            effectiveSeasonUrl,
                            forceRefresh: true
                        })}`);
                    }
                    sources = await parser.cachedVideoSources(
                        searchResult?.videoId ? searchResult : { url: effectiveSeasonUrl },
                        { forceRefresh: forceFreshSeasonSource }
                    );
                }
            }

            if (String(this.selectedMovie?.kinopoiskId) !== movieId || this.playerRegistry[parserId] !== entry || !isRequestCurrent()) return false;

            if (!sources || sources.length === 0) {
                this.setPlayerSourceState('unavailable', {
                    message: `Источники не найдены на ${parser.name}.`,
                    onRetry: () => this.changeVideoSource(`parser:${parserId}`),
                    onResearch: () => this.forceResearchSources(`parser:${parserId}`, parserId)
                });
                return false;
            }

            sources = this.orderParserSourcesForNativeBridge(parserId, sources, selection);

            // FIX: Save sources to state so PLAYER_READY can use them
            
            // CRITICAL FIX: Separate episodes from provider sources
            // DO NOT overwrite currentSources with episodes!
            this.currentEpisodes = sources;

            // Part 7, 8, 9: Episode resolution
            let resolvedEpisodeUrl = null;
            let resolvedEpisodeNumber = null;
            if (selection?.episodeNumber != null && sources && sources.length > 0) {
                const targetEpNum = Number(selection.episodeNumber);
                const extractEp = (s) => (parser.extractEpisodeNumber
                    ? parser.extractEpisodeNumber(s)
                    : (typeof SeasonvarParser !== 'undefined' && SeasonvarParser.extractEpisodeNumber
                        ? SeasonvarParser.extractEpisodeNumber(s)
                        : null));
                let targetSource = sources.find(s => extractEp(s) === targetEpNum);
                if (!targetSource) {
                    const idx = targetEpNum - 1;
                    if (idx >= 0 && idx < sources.length) {
                        targetSource = sources[idx];
                    }
                }
                if (targetSource) {
                    resolvedEpisodeUrl = targetSource.url;
                    resolvedEpisodeNumber = targetEpNum;
                }
            }

            console.log('[SeasonPickerTrace] Seasonvar resolution', {
                parserId,
                requestedSeason: selection?.seasonNumber,
                requestedEpisode: selection?.episodeNumber,
                effectiveSeasonUrl,
                loadedEpisodeCount: sources?.length || 0,
                resolvedEpisodeNumber,
                resolvedEpisodeUrl,
                firstEpisodeUrl: sources?.[0]?.url || null
            });
            if (parserId === 'kinogo') {
                console.info(`[KinogoSearchTrace] source resolution ${JSON.stringify({
                    requestedSeason: selection?.seasonNumber ?? null,
                    requestedEpisode: selection?.episodeNumber ?? null,
                    effectiveSeasonUrl,
                    loadedSourceCount: sources?.length || 0,
                    resolvedEpisodeNumber,
                    resolvedEpisodeUrl,
                    firstSourceUrl: sources?.[0]?.url || null
                })}`);
            }

            // Delegate rendering to the parser
            const renderOptions = {
                translations: seriesInfo?.translations || null,
                canonicalSeasons: this.getCanonicalSeasonLayout?.() || [],
                seasons: seasons || [],
                movieId,
                season: selection?.seasonNumber ?? null,
                episode: selection?.episodeNumber ?? null,
                resolvedSeasonNumber: selection?.seasonNumber ?? null,
                resolvedEpisodeNumber: resolvedEpisodeNumber,
                resolvedSeasonUrl: effectiveSeasonUrl,
                resolvedEpisodeUrl: resolvedEpisodeUrl,
                resolvedTimestamp: selection?.initialTimestamp || 0,
                currentSourcesUrl: effectiveSeasonUrl,
                onPlayerReady: () => {
                     this.populateSourceSelector();
                },
                ...this.createSourceLifecycleOptions({
                    url: `parser:${parserId}`,
                    parserId,
                    movieId,
                    requestId: sourceRequestId
                })
            };

            if (String(this.selectedMovie?.kinopoiskId) !== movieId || this.playerRegistry[parserId] !== entry || !isRequestCurrent()) return false;

            if (parser.getPlayerType() === 'custom' || parser.renderPlayer !== BaseParserService.prototype.renderPlayer) {
                // Parser has custom rendering (like Seasonvar with episode selector)
                await parser.renderPlayer(this.elements.videoContainer, sources, renderOptions);
            } else {
                // Default source-aware rendering (iframe/video is selected from source.type)
                await parser.renderPlayer(this.elements.videoContainer, sources, renderOptions);
            }

            if (this.elements.videoContainer?.__seasonvarPlaybackState) {
                this.currentSeasonvarPlaybackState = this.elements.videoContainer.__seasonvarPlaybackState;
                this.updatePlayerNavigationControls();
            }

            if (!isRequestCurrent()) return false;

            // Cache the player for reuse
            const video = this.elements.videoContainer.querySelector('video');
            const videoState = video ? {
                currentTime: video.currentTime,
                paused: video.paused
            } : null;

            if (entry && entry.movieId === movieId) {
                entry.initialized = true;
                entry.ready = !!video && video.readyState >= 2;
                entry.video = video;
                entry.sources = sources;
                entry.renderOptions = renderOptions;
                entry.sourcesSeasonUrl = effectiveSeasonUrl;
                entry.sourcesSeasonNumber = selection?.seasonNumber != null ? Number(selection.seasonNumber) : (renderOptions.resolvedSeasonNumber || 1);
                entry.videoState = videoState;
                entry.timestamp = Date.now();
                entry.dataOnly = true;
                this.activePlayerId = parserId;
                window._playerMounted = true;
            }

            const preferredType = parser.getPlayerType();
            const mountedSource = sources.find(source => parser.getSourcePlayerType?.(source) === preferredType)
                || sources[0];
            console.info('[Player] Source ready', {
                parserId,
                movieId,
                playerType: parser.getSourcePlayerType?.(mountedSource) || preferredType,
                reusedDiscoveredSources,
                iframeCount: this.elements.videoContainer?.querySelectorAll?.('iframe')?.length || 0,
                iframeSources: Array.from(this.elements.videoContainer?.querySelectorAll?.('iframe') || [])
                    .map(iframe => iframe.src || iframe.getAttribute?.('src') || null),
                durationMs: Math.round(performance.now() - loadStartedAt)
            });
            return true;

        } catch (e) {
            console.error(`[MovieDetails] ${parser.name} load error:`, e);
            if (isRequestCurrent()) {
                this.unavailableProviderIds?.add?.(parserId);
                this.invalidateSourceCache(movieId);
                this.setPlayerSourceState('error', {
                    message: `Ошибка загрузки ${parser.name}: ${e.message}`,
                    onRetry: () => this.changeVideoSource(`parser:${parserId}`),
                    onResearch: () => this.forceResearchSources(`parser:${parserId}`, parserId)
                });
                this.updatePlayerNavigationControls();
            }
            return false;
        }
    }

    /** @deprecated Use loadParserSource('seasonvar') instead */
    async loadSeasonvarSource() {
        return this.loadParserSource('seasonvar');
    }

    /** @deprecated Use parser.renderPlayer() instead */
    async renderSeasonvarPlayer(episodes, translations) {
        const parser = this.parserRegistry.get('seasonvar');
        if (parser) {
            const sources = episodes.map(ep => ({ name: ep.title, url: ep.url, type: 'video', subtitle: ep.subtitle }));
            await parser.renderPlayer(this.elements.videoContainer, sources, { translations });
        }
    }

    renderDefaultPlayer(url, { requestId = null, movieId = this.selectedMovie?.kinopoiskId } = {}) {
        if (!this.getPlayerSurface().mountFrame(url, { allow: 'autoplay; fullscreen' })) return;
        const iframe = this.elements.videoContainer.querySelector('iframe');
        if (iframe) {
            iframe.dataset.playerSourceActive = 'true';
            if (requestId !== null) iframe.dataset.playerRequestId = String(requestId);
        }
        const lifecycle = window.PlayerSourceLifecycle;
        if (!iframe || !lifecycle) return;
        const lifecycleOptions = this.createSourceLifecycleOptions({ url, movieId, requestId });
        this.sourceLifecycleWatcher = lifecycle.watchIframe(iframe, {
            timeoutMs: 5000,
            isRequestCurrent: lifecycleOptions.isRequestCurrent,
            onState: (state, detail) => {
                if (!lifecycleOptions.isRequestCurrent()) return;
                lifecycle.setState(this.elements.videoContainer, state, {
                    onRetry: lifecycleOptions.onRetry,
                    onResearch: lifecycleOptions.onResearch
                });
                lifecycleOptions.onLifecycleState(state, detail);
            }
        });
    }

    /**
     * Build vidsrc-embed.ru URL for a movie or TV episode.
     * @param {string} imdbId  - e.g. "tt0110912"
     * @param {object} [opts]  - { season, episode } for TV
     * @returns {string}
     */
    buildVidSrcUrl(imdbId, opts = {}) {
        const base = 'https://vidsrc-embed.ru/embed';
        const isSeries = (typeof isSeriesMedia === 'function'
            ? isSeriesMedia(this.selectedMovie)
            : Boolean(this.selectedMovie?.isSeries || (this.selectedMovie?.type && ['tv-series', 'mini-series', 'animated-series', 'anime', 'tv', 'tv-show', 'series', 'tv_series'].includes(String(this.selectedMovie.type).toLowerCase().replace(/_/g, '-')))));

        if (isSeries) {
            const selection = this.playbackController?.getSelection();
            const s = (opts.season != null ? opts.season : (selection?.seasonNumber != null ? selection.seasonNumber : 1));
            const e = (opts.episode != null ? opts.episode : (selection?.episodeNumber != null ? selection.episodeNumber : 1));
            return `${base}/tv?imdb=${encodeURIComponent(imdbId)}&season=${s}&episode=${e}&autoplay=1`;
        }
        return `${base}/movie?imdb=${encodeURIComponent(imdbId)}&autoplay=1`;
    }

    /**
     * Load VidSrc embed player into the video container.
     * @param {string} imdbId
     */
    loadVidSrcSource(imdbId, lifecycleContext = {}) {
        if (!imdbId) {
            this.renderPlayerPlaceholder('IMDb ID не найден для этого фильма');
            return;
        }

        const url = this.buildVidSrcUrl(imdbId);
        console.log(`[VidSrc] Loading embed: ${url}`);
        this.currentVideoUrl = url;
        this.renderDefaultPlayer(url, lifecycleContext);
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
            } catch { /* Ignore */ }
        }
    }

    togglePlayPause(sourceKey = this.currentVideoUrl) {
        if (sourceKey === MEDIA_PLAYER_TORRENT_SOURCE) {
            return this.changeVideoSource(sourceKey);
        }
        if (this.torrentPlaybackSession) {
            const video = this.elements.videoContainer?.querySelector('video');
            if (!video) return false;
            if (video.paused) {
                void video.play().catch(error => console.warn('[Torrent] Playback could not start', error));
            } else {
                video.pause();
            }
            return true;
        }
        // Parser sources already own and mount their player DOM in changeVideoSource().
        // Re-rendering from currentVideoUrl here would replace that DOM; parser sources
        // intentionally do not populate currentVideoUrl.
        if (typeof sourceKey === 'string' && sourceKey.startsWith('parser:')) {
            return false;
        }

        // Never allow an empty relative iframe src: "?autoplay=1" resolves back to
        // movie-details.html and recursively mounts the extension page inside the player.
        if (!this.currentVideoUrl) {
            console.warn('[togglePlayPause] No direct video URL available; skipping playback toggle');
            return false;
        }

        this.isPlaying = !this.isPlaying;
        
        if (this.isPlaying) {
            const isMp4 = this.currentVideoUrl?.includes('.mp4');
            const isHls = this.currentVideoUrl?.includes('.m3u8');
            
            if (isMp4 || isHls) {
                // Use Custom Player Wrapper
                this.renderCustomPlayer(this.currentVideoUrl, isHls);
            } else {
                let url = this.currentVideoUrl;
                try { const u = new URL(url); u.searchParams.set('autoplay', '1'); url = u.toString(); } catch { url += url.includes('?') ? '&autoplay=1' : '?autoplay=1'; }
                this.getPlayerSurface().mountFrame(url, { allow: 'autoplay; encrypted-media; picture-in-picture' });
            }
        } else {
            if (this.currentHls) { 
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
        wrapper.className = 'video-wrapper player-surface__content';
        
        const video = document.createElement('video');
        video.id = 'nativeVideoPlayer';
        video.className = 'player-surface__media';
        console.log('[DEBUG renderCustomPlayer] Created <video> element');
        video.autoplay = !this.torrentPlaybackSession;
        video.controls = true; // Native fallback until the shared cleaner UI mounts.
        video.dataset.playerProvider = this.torrentPlaybackSession ? 'torrent' : 'native';
        
        if (!isHls) {
            video.src = url;
            video.type = 'video/mp4';
        }

        wrapper.appendChild(video);
        
        this.getPlayerSurface().mountElement(wrapper);
        if (this.torrentPlaybackSession) {
            this.attachTorrentPlaybackVideo(video);
        }

        // Initialize HLS if needed - lazy-load the library
        if (isHls) {
            try {
                await LazyLoader.loadScript('../../shared/lib/hls.min.js');
                if (!wrapper.isConnected || this.currentVideoUrl !== url) return;
                const isTorrentStream = Boolean(this.torrentPlaybackSession);
                let hls = null;
                const isCurrentPlayer = () => Boolean(hls)
                    && this.currentHls === hls
                    && wrapper.isConnected
                    && this.currentVideoUrl === url;
                // Torrent sessions answer 5xx while buffering, so they retry
                // indefinitely; other direct streams use bounded recovery.
                hls = window.HlsPlaybackFactory?.create(video, url, {
                    policy: isTorrentStream ? 'persistent' : 'bounded',
                    attachFirst: true,
                    isCurrent: isCurrentPlayer,
                    beforeLoad: (instance) => {
                        hls = instance;
                        this.currentHls = instance;
                        video._movieExtensionHls = instance;
                        instance.on(Hls.Events.MANIFEST_PARSED, () => {
                            if (!isCurrentPlayer()) return;
                            this.hlsPlaybackState = '';
                            this.renderTorrentPlaybackStatus();
                            this.waitForTorrentPlaybackStart(video, isCurrentPlayer);
                        });
                        instance.on(Hls.Events.MEDIA_ATTACHED, () => {
                            if (isCurrentPlayer()) video.dispatchEvent(new Event('extension-player-source-ready', { bubbles: true }));
                        });
                    },
                    onRetryScheduled: ({ delaySeconds }) => {
                        if (!isCurrentPlayer()) return;
                        this.hlsPlaybackState = `Поток ждёт данные · повтор через ${delaySeconds} с`;
                        this.renderTorrentPlaybackStatus();
                    },
                    onRecovered: () => {
                        this.hlsPlaybackState = '';
                        this.renderTorrentPlaybackStatus();
                    },
                    onFatal: () => {
                        this.hlsPlaybackState = 'Поток не удалось запустить';
                        this.renderTorrentPlaybackStatus();
                    }
                }) || null;
                if (hls) {
                    // Retry timers live in the factory; only the status text is ours.
                    video.addEventListener('playing', () => this.resetHlsRecoveryState());
                } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                    video.src = url;
                    this.waitForTorrentPlaybackStart(video, () => video.isConnected && this.currentVideoUrl === url);
                } else {
                    this.hlsPlaybackState = 'HLS не поддерживается в этом браузере';
                    this.renderTorrentPlaybackStatus();
                }
            } catch (e) {
                console.error('Failed to load HLS library:', e);
                this.hlsPlaybackState = 'Ошибка запуска потока';
                this.renderTorrentPlaybackStatus();
            }
        }

        // player-cleaner is the single owner of native player controls.
        if (video.isConnected) video.dispatchEvent(new Event('extension-player-source-ready', { bubbles: true }));
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
        this.getPlayerSurface().showPoster(this.selectedMovie?.posterUrl)
            ?.addEventListener('click', () => this.togglePlayPause());
    }

    // Button State Methods
    async updateButtonStates(existingBookmark = undefined) {
        if (!this.currentUser) return;
        const favoriteService = firebaseManager.getFavoriteService();
        
        const buttons = document.querySelectorAll('[data-action="toggle-favorite"], [data-action="toggle-watching"], [data-action="toggle-watched"], [data-action="toggle-watchlist"]');
        let bookmark = existingBookmark;
        if (bookmark === undefined) {
            try {
                bookmark = await favoriteService.getBookmark(this.currentUser.uid, Number(this.selectedMovie?.kinopoiskId));
            } catch (error) {
                console.warn('[MovieDetails] Failed to load bookmark state:', error);
                return;
            }
        }
        for (const button of buttons) {
            const movieId = button.getAttribute('data-movie-id');
            if (!movieId) continue;
            
            try {
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

    updateRandomPoolAction(buttonElement, isInPool) {
        if (!buttonElement) return;

        const icon = buttonElement.querySelector('.mc-menu-item-icon');
        const label = buttonElement.querySelector('.mc-menu-item-text');
        buttonElement.classList.toggle('active', isInPool);
        buttonElement.setAttribute('aria-pressed', String(isInPool));
        if (label) {
            label.textContent = i18n.get(isInPool ? 'movie_card.random_pool_added' : 'movie_card.add_random_pool');
        }
        if (icon) {
            icon.innerHTML = isInPool
                ? '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4L19 6"></path></svg>'
                : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"></rect><circle cx="8" cy="8" r="1"></circle><circle cx="16" cy="8" r="1"></circle><circle cx="8" cy="16" r="1"></circle><circle cx="16" cy="16" r="1"></circle><circle cx="12" cy="12" r="1"></circle></svg>';
        }
    }

    async syncRandomPoolAction(movie = this.selectedMovie) {
        const actionButton = this.elements.movieDetailsContainer?.querySelector('[data-action="add-to-random-pool"]');
        if (!actionButton || !movie || typeof RandomPoolService === 'undefined') return;
        const pageContext = this.capturePageContext(movie);

        try {
            const pool = await RandomPoolService.getPool();
            if (!this.isPageContextCurrent(pageContext)) return;
            this.updateRandomPoolAction(actionButton, RandomPoolService.isInPool(pool, movie));
        } catch (error) {
            console.warn('[MovieDetails] Failed to read Random pool state:', error);
        }
    }

    async handleAddToRandomPool(movieId, buttonElement) {
        const movie = this.selectedMovie;
        if (!movie || String(movie.kinopoiskId) !== String(movieId) || typeof RandomPoolService === 'undefined') return;

        buttonElement.disabled = true;
        buttonElement.setAttribute('aria-busy', 'true');
        try {
            const result = await RandomPoolService.addMovie(movie);
            this.updateRandomPoolAction(buttonElement, true);
            this.closeOpenMenus();
            Utils.showToast(
                i18n.get(result.added ? 'movie_card.add_random_pool' : 'movie_card.random_pool_added'),
                'success'
            );
        } catch (error) {
            console.error('[MovieDetails] Failed to add movie to Random pool:', error);
            Utils.showToast(i18n.get('movie_card.random_pool_error'), 'error');
        } finally {
            buttonElement.disabled = false;
            buttonElement.removeAttribute('aria-busy');
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
            
            if (typeof Utils !== 'undefined') Utils.showToast(newStatus ? i18n.get('movie_card.add_favorite') : i18n.get('movie_card.remove_favorite'), 'success');
        } catch (error) { console.error('Error toggling favorite:', error); }
    }

    captureFavoriteToggleContext(movieId) {
        const userId = this.currentUser?.uid;
        const movie = this.selectedMovie;
        const selectedId = Number(movie?.kinopoiskId || movie?.movieId || movie?.id);
        const requestedId = Number(movieId);
        if (!userId || !Number.isSafeInteger(selectedId) || selectedId <= 0
            || selectedId !== requestedId) return null;
        return { userId, movieId: selectedId, movie };
    }

    isFavoriteToggleContextCurrent(context) {
        if (!context || this.currentUser?.uid !== context.userId) return false;
        const selectedId = Number(this.selectedMovie?.kinopoiskId
            || this.selectedMovie?.movieId || this.selectedMovie?.id);
        return selectedId === context.movieId;
    }

    async handleWatchingToggle(movieId, buttonElement) {
        const context = this.captureFavoriteToggleContext(movieId);
        if (!context) return;
        try {
            const favoriteService = firebaseManager.getFavoriteService();
            const bookmark = await favoriteService.getBookmark(context.userId, context.movieId);
            if (!this.isFavoriteToggleContextCurrent(context)) return;
            const isWatching = bookmark?.status === 'watching';
            
            if (isWatching) {
                await favoriteService.removeFromFavorites(context.userId, context.movieId);
            } else {
                await favoriteService.addToFavorites(context.userId, { ...context.movie, movieId: context.movieId }, 'watching');
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
        const context = this.captureFavoriteToggleContext(movieId);
        if (!context) return;
        try {
            const favoriteService = firebaseManager.getFavoriteService();
            const bookmark = await favoriteService.getBookmark(context.userId, context.movieId);
            if (!this.isFavoriteToggleContextCurrent(context)) return;
            const isWatched = bookmark?.status === 'watched';
            
            if (isWatched) {
                await favoriteService.removeFromFavorites(context.userId, context.movieId);
            } else {
                await favoriteService.addToFavorites(context.userId, { ...context.movie, movieId: context.movieId }, 'watched');
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
        const context = this.captureFavoriteToggleContext(movieId);
        if (!context) return;
        try {
            const favoriteService = firebaseManager.getFavoriteService();
            const bookmark = await favoriteService.getBookmark(context.userId, context.movieId);
            if (!this.isFavoriteToggleContextCurrent(context)) return;
            const isInWatchlist = bookmark?.status === 'plan_to_watch';
            
            if (isInWatchlist) {
                await favoriteService.removeFromFavorites(context.userId, context.movieId);
            } else {
                await favoriteService.addToFavorites(context.userId, { ...context.movie, movieId: context.movieId }, 'plan_to_watch');
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
            
            let checkSpan = Array.from(buttonElement.children).find(c => c.classList?.contains('mc-collection-check') || c.textContent.includes('✓') || c.querySelector('svg'));
            if (checkSpan) checkSpan.remove();
            else {
                const newCheck = document.createElement('span');
                newCheck.className = 'mc-collection-check';
                newCheck.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
                newCheck.style.cssText = 'margin-left: auto; font-weight: bold; color: var(--accent-color, #4CAF50);';
                buttonElement.appendChild(newCheck);
            }
            
            if (typeof Utils !== 'undefined') Utils.showToast(i18n.get('settings.saved'), 'success');
        } catch (error) { console.error('Error toggling collection:', error); }
    }

    async handleForceRefreshMovie(movieId) {
        const numId = Number(movieId);
        if (!numId || isNaN(numId)) return;
        try {
            this.page?.showLoader?.();
            await this.clearMovieCacheForMovie(numId);

            // Also clear collection cache if collection exists
            const collectionId = this.selectedMovie?.collection?.tmdbId;
            if (collectionId && typeof chrome !== 'undefined' && chrome.storage?.local) {
                try {
                    await new Promise(resolve => chrome.storage.local.remove([`tmdb_collection_cache_v2_${collectionId}`], resolve));
                } catch (e) {
                    console.debug('[MovieDetails] Could not remove collection cache:', e);
                }
            }

            await this.loadMovieById(numId, true, false, { forceRefresh: true });
            if (typeof Utils !== 'undefined' && Utils.showToast) {
                Utils.showToast(i18n.get('movie_details.data_refreshed') || 'Данные фильма обновлены', 'success');
            }
        } catch (error) {
            console.error('[MovieDetails] Failed to force refresh movie:', error);
            if (typeof Utils !== 'undefined' && Utils.showToast) {
                Utils.showToast(i18n.get('movie_details.error_loading_movie') || 'Ошибка обновления данных', 'error');
            }
        } finally {
            this.page?.hideLoader?.();
        }
    }

    // updateButtonState removed in favor of Utils.toggleActionButton

    escapeHtml(text) {
        if (text === null || text === undefined || text === false || text === '') return '';
        // Quotes are escaped too: the result is interpolated into attribute values.
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
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
                } else if (type === 'backdrop') {
                    const backdropContainer = img.closest('.movie-detail-hero-backdrop');
                    if (backdropContainer) {
                        backdropContainer.style.display = 'none';
                    }
                } else if (type === 'company-logo') {
                    img.style.display = 'none';
                } else if (type === 'title-logo') {
                    const logoContainer = img.closest('.movie-detail-logo-container');
                    if (logoContainer) {
                        logoContainer.remove();
                    } else {
                        img.style.display = 'none';
                    }
                } else if (type === 'youtube-thumb') {
                    const key = img.getAttribute('data-key');
                    if (key && !this.failedYoutubeThumbs.has(key)) {
                        this.failedYoutubeThumbs.add(key);
                        img.src = `https://i.ytimg.com/vi/${key}/mqdefault.jpg`;
                        return; // Allow new URL to attempt loading before removing attribute
                    } else {
                        img.src = this.selectedMovie?.backdropUrl || this.selectedMovie?.posterUrl || '/src/shared/assets/icons/app/icon48.png';
                    }
                } else if (type === 'avatar') {
                    img.src = '/src/shared/assets/icons/app/icon48.png';
                } else if (type === 'frame') {
                    img.closest('.movie-frame')?.style && (img.closest('.movie-frame').style.display = 'none');
                }
                
                // For other types, we remove attribute to stop handling, 
                // but for sequel-poster we might need it if we're retrying with a new URL
                if (type !== 'sequel-poster' && type !== 'youtube-thumb') {
                    img.removeAttribute('data-fallback');
                }
            }
        }, true);
        
        document.addEventListener('click', (e) => {
            const youtubeCommentLink = e.target.closest('.user-rating-comment a.chat-link--youtube');
            if (youtubeCommentLink) {
                e.preventDefault();
                e.stopPropagation();

                const key = youtubeCommentLink.getAttribute('data-youtube-id');
                const start = Number.parseInt(youtubeCommentLink.getAttribute('data-youtube-start') || '0', 10) || 0;
                if (key) {
                    this.openVideoModal({
                        provider: 'YouTube',
                        key,
                        start,
                        name: 'Загрузка названия…'
                    }, youtubeCommentLink);
                    this.loadYouTubeCommentTitle(youtubeCommentLink.getAttribute('href') || '', key);
                }
                return;
            }

            const videoCard = e.target.closest('.movie-video-card');
            if (videoCard) {
                const key = videoCard.getAttribute('data-video-key');
                const name = videoCard.getAttribute('data-video-name');
                if (key) {
                    this.openVideoModal({ provider: 'YouTube', key, name });
                }
                return;
            }

            const trailerBlock = e.target.closest('.trailer-block');
            if (trailerBlock) {
                const key = trailerBlock.getAttribute('data-video-key');
                const videoUrl = trailerBlock.getAttribute('data-video-url');
                const provider = trailerBlock.getAttribute('data-video-provider');
                const name = trailerBlock.getAttribute('data-video-name');
                this.openVideoModal({ key, videoUrl, provider, name });
                return;
            }

            const spoilerBtn = e.target.closest('.btn-reveal-spoiler');
            if (spoilerBtn) {
                const item = spoilerBtn.closest('.fact-item--spoiler');
                if (item) {
                    item.classList.add('revealed');
                    spoilerBtn.style.display = 'none';
                }
                return;
            }

            const showFactsBtn = e.target.closest('.btn-show-all-facts');
            if (showFactsBtn) {
                showFactsBtn.style.display = 'none';
                const hiddenContainer = showFactsBtn.previousElementSibling;
                if (hiddenContainer && hiddenContainer.classList.contains('facts-list-hidden')) {
                    hiddenContainer.style.display = 'flex';
                }
                return;
            }

            const showAwardsBtn = e.target.closest('.btn-show-all-awards');
            if (showAwardsBtn) {
                showAwardsBtn.style.display = 'none';
                const hiddenContainer = showAwardsBtn.previousElementSibling;
                if (hiddenContainer && hiddenContainer.classList.contains('awards-grid-hidden')) {
                    hiddenContainer.style.display = 'grid';
                }
                return;
            }
        });
    }

    /**
     * Opens the clicked movie frame in the shared ImageLightbox gallery.
     * @param {string} frameUrl - URL of the clicked frame (used only for safety check)
     * @param {number} frameIndex - Index in displayFrames to start from
     */
    showFrameModal(frameUrl, frameIndex) {
        const movie = this.selectedMovie;
        if (!movie) return;

        const frames = movie.displayFrames || movie.frames || [];
        if (frames.length === 0) return;

        const urls = frames.map(f =>
            typeof f === 'string' ? f : (f.url || f.previewUrl || '')
        ).filter(Boolean);

        if (urls.length === 0) return;

        if (window.ImageLightbox) {
            window.ImageLightbox.show(urls, Math.max(0, frameIndex));
        }
    }

    bindMovieFrameInteractions() {
        const container = this.elements.movieDetailsContainer;
        if (!container || typeof container.querySelectorAll !== 'function') return;

        container.querySelectorAll('.movie-frame').forEach((frame) => {
            if (frame.dataset.frameInteractionBound === 'true') return;

            frame.dataset.frameInteractionBound = 'true';
            frame.setAttribute('role', 'button');
            frame.setAttribute('tabindex', '0');
            frame.setAttribute('aria-label', 'Открыть кадр фильма');

            const openFrame = () => {
                const url = frame.getAttribute('data-frame-url');
                const index = Number.parseInt(frame.getAttribute('data-frame-index') || '0', 10);
                if (url) this.showFrameModal(url, Number.isFinite(index) ? index : 0);
            };

            frame.addEventListener('click', (event) => {
                event.preventDefault();
                openFrame();
            });
            frame.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openFrame();
                }
            });
        });
    }

    showSequelPlaceholder(img) {
        img.style.display = 'none';
        const container = img.parentElement;
        if (container) {
            container.style.backgroundColor = '#2a2a2a';
            container.style.display = 'flex';
            container.style.alignItems = 'center';
            container.style.justifyContent = 'center';
            container.innerHTML = '<div style="color: #64748b;"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line><line x1="2" y1="7" x2="7" y2="7"></line><line x1="2" y1="17" x2="7" y2="17"></line><line x1="17" y1="17" x2="22" y2="17"></line><line x1="17" y1="7" x2="22" y2="7"></line></svg></div>';
        }
    }

    async loadTrailerFallback(movieId, isSeries = false, pageContext = this.capturePageContext()) {
        if (!this.trailerService || !movieId) return;
        
        try {
            console.log('[MovieDetails] Trailer source: SCRAPER (invoking fallback)');
            const trailerRequest = this.perf?.requestStart('TRAILER_FALLBACK', { purpose: 'trailer-fallback' });
            const trailer = await this.trailerService.getTrailer(movieId, isSeries);
            this.perf?.requestEnd(trailerRequest);
            if (!this.isPageContextCurrent(pageContext)) return;
            if (trailer && (trailer.videoUrl || trailer.key)) {
                console.log('[MovieDetails] Trailer source: SCRAPER');
                this.renderTrailerBlock(trailer, 'SCRAPER');
            } else {
                console.log('[MovieDetails] Trailer source: NONE');
            }
        } catch (error) {
            console.warn('[MovieDetails] Scraper trailer fallback failed (continuing gracefully):', error);
            console.log('[MovieDetails] Trailer source: NONE');
        }
    }

    async loadTrailer(movieId, isSeries = false) {
        return this.loadTrailerFallback(movieId, isSeries);
    }

    renderTrailerBlock(trailer, source = 'TMDB_STRUCTURED') {
        if (!trailer) return;
        const actionContainer = this.elements.movieDetailsContainer?.querySelector('.movie-actions-container');
        if (!actionContainer) return;
        
        // Check if already exists
        if (this.elements.movieDetailsContainer?.querySelector('.trailer-block-container')) return;

        const container = document.createElement('div');
        container.className = 'trailer-block-container';
        
        // Resolve poster: trailer poster, high-res YouTube thumb, or movie poster
        let posterUrl = trailer.posterUrl;
        if (!posterUrl && trailer.key) {
            posterUrl = `https://i.ytimg.com/vi/${encodeURIComponent(trailer.key)}/hqdefault.jpg`;
        }
        if (!posterUrl) {
            posterUrl = this.selectedMovie?.posterUrl || '/src/shared/assets/icons/app/icon48.png';
        }

        const title = trailer.name || trailer.title || 'Трейлер';
        const duration = trailer.duration || '';
        const keyAttr = trailer.key ? `data-fallback="youtube-thumb" data-key="${encodeURIComponent(trailer.key)}"` : '';
        const videoKeyAttr = trailer.key ? `data-video-key="${this.escapeHtml(trailer.key)}"` : '';
        const videoUrlAttr = trailer.videoUrl ? `data-video-url="${this.escapeHtml(trailer.videoUrl)}"` : '';
        const providerAttr = trailer.provider ? `data-video-provider="${this.escapeHtml(trailer.provider)}"` : '';

        container.innerHTML = `
            <div class="trailer-block" role="button" tabindex="0" data-source="${this.escapeHtml(source)}" ${videoKeyAttr} ${videoUrlAttr} ${providerAttr} data-video-name="${this.escapeHtml(title)}">
                <div class="trailer-poster-wrapper">
                    <img src="${this.escapeHtml(posterUrl)}" alt="${this.escapeHtml(title)}" class="trailer-poster" loading="lazy" decoding="async" ${keyAttr}>
                    <div class="trailer-play-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    </div>
                    ${duration ? `<span class="trailer-duration">${this.escapeHtml(duration)}</span>` : ''}
                </div>
                <div class="trailer-info">
                    <span class="trailer-title">${this.escapeHtml(title)}</span>
                </div>
            </div>
        `;
        
        // Insert AFTER the action container (Rate/Watch buttons)
        actionContainer.parentNode.insertBefore(container, actionContainer.nextSibling);
        const snapshot = this.getRenderEnrichmentSnapshot();
        if (snapshot) snapshot.trailer = { trailer, source };
    }

    openVideoModal(video, trigger = document.activeElement) {
        if (!video) return;
        this.youtubeTitleRequestToken = null;
        const modal = this.elements.trailerModal;
        const container = this.elements.trailerContainer;
        const titleEl = this.elements.trailerTitle;
        
        if (!modal || !container) {
            console.error('[MovieDetails] Trailer modal elements missing');
            return;
        }
        
        const title = video.name || video.title || 'Видео';
        if (titleEl) titleEl.textContent = title;
        
        let embedUrl = '';
        const isYouTube = (video.provider || '').toLowerCase() === 'youtube' || Boolean(video.key);
        const parsedYouTubeUrl = video.videoUrl
            && typeof Utils !== 'undefined'
            && typeof Utils.extractYouTubeVideoInfo === 'function'
            ? Utils.extractYouTubeVideoInfo(video.videoUrl)
            : null;
        
        if ((isYouTube && video.key) || parsedYouTubeUrl) {
            const key = video.key || parsedYouTubeUrl.id;
            const start = Number.isSafeInteger(video.start) && video.start > 0
                ? video.start
                : (parsedYouTubeUrl?.startSeconds || 0);
            embedUrl = typeof PlayerConfig !== 'undefined' && PlayerConfig.buildYouTubeEmbedUrl
                ? PlayerConfig.buildYouTubeEmbedUrl(key, { autoplay: true, start })
                : `https://www.youtube-nocookie.com/embed/${encodeURIComponent(key)}?autoplay=1${start > 0 ? `&start=${start}` : ''}&rel=0`;
        } else if (video.videoUrl) {
            // If videoUrl is a YouTube URL, extract key for safe embed
            const ytMatch = video.videoUrl.match(/(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]+)/i);
            if (ytMatch && ytMatch[1]) {
                embedUrl = typeof PlayerConfig !== 'undefined' && PlayerConfig.buildYouTubeEmbedUrl
                    ? PlayerConfig.buildYouTubeEmbedUrl(ytMatch[1], { autoplay: true })
                    : `https://www.youtube-nocookie.com/embed/${encodeURIComponent(ytMatch[1])}?autoplay=1&rel=0`;
            } else {
                embedUrl = video.videoUrl;
            }
        }
        
        if (!embedUrl) {
            console.error('[MovieDetails] No video URL or key available for playback:', video);
            if (typeof Utils !== 'undefined') Utils.showToast('Ссылка на видео не найдена', 'error');
            return;
        }
        
        if (!this.renderFrameInto(container, embedUrl, {
            allow: 'autoplay; encrypted-media; picture-in-picture',
            title: title || 'Video player'
        })) {
            console.error('[MovieDetails] Rejected trailer URL with an unsupported scheme');
            if (typeof Utils !== 'undefined') Utils.showToast('Ссылка на видео не найдена', 'error');
            return;
        }
        
        this.openAccessibleDialog(modal, trigger);
    }

    /**
     * Resolve a YouTube title for a comment link without delaying video playback.
     * @param {string} videoUrl - Original YouTube URL from the comment
     * @param {string} videoId - Validated YouTube video ID
     * @returns {Promise<void>}
     */
    async loadYouTubeCommentTitle(videoUrl, videoId) {
        if (!videoUrl || !videoId) return;

        const requestToken = Symbol('youtube-title-request');
        this.youtubeTitleRequestToken = requestToken;
        this.youtubeTitleCache ||= new Map();

        const titleEl = this.elements?.trailerTitle;
        const fallbackTitle = () => {
            if (this.youtubeTitleRequestToken !== requestToken || !titleEl) return;
            titleEl.textContent = 'Видео';
            titleEl.removeAttribute?.('title');
            titleEl.setAttribute?.('aria-busy', 'false');
        };
        const renderTitle = (fullTitle) => {
            if (this.youtubeTitleRequestToken !== requestToken || !titleEl) return;

            const maxTitleLength = 96;
            const displayTitle = fullTitle.length > maxTitleLength
                ? `${fullTitle.slice(0, maxTitleLength - 1).trimEnd()}…`
                : fullTitle;

            titleEl.textContent = displayTitle;
            titleEl.setAttribute?.('aria-busy', 'false');
            if (displayTitle !== fullTitle) {
                titleEl.setAttribute?.('title', fullTitle);
            } else {
                titleEl.removeAttribute?.('title');
            }
        };

        titleEl?.setAttribute?.('aria-busy', 'true');

        const cachedTitle = this.youtubeTitleCache.get(videoId);
        if (cachedTitle) {
            renderTitle(cachedTitle);
            return;
        }

        try {
            const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`;
            const response = await fetch(endpoint);
            if (!response || !response.ok) {
                fallbackTitle();
                return;
            }

            const payload = await response.json();
            const title = typeof payload?.title === 'string' ? payload.title.trim() : '';
            if (!title) {
                fallbackTitle();
                return;
            }

            if (this.youtubeTitleCache.size >= 100) {
                this.youtubeTitleCache.delete(this.youtubeTitleCache.keys().next().value);
            }
            this.youtubeTitleCache.set(videoId, title);
            renderTitle(title);
        } catch {
            // The video remains playable with the generic fallback title.
            fallbackTitle();
        }
    }

    openTrailerModal(trailer) {
        this.openVideoModal(trailer);
    }

    openYouTubeModal(key, title) {
        this.openVideoModal({ provider: 'YouTube', key, name: title });
    }

    closeTrailerModal() {
        this.youtubeTitleRequestToken = null;
        if (this.elements.trailerModal) {
            this.closeAccessibleDialog(this.elements.trailerModal);
        }
        if (this.elements.trailerContainer) {
            if (typeof this.elements.trailerContainer.querySelector === 'function') {
                const iframe = this.elements.trailerContainer.querySelector('iframe');
                if (iframe && iframe.contentWindow) {
                    try {
                        this.postToPlayerFrame(iframe, { action: 'DESTROY' });
                    } catch {
                        // Ignore cross-origin destroy error on unmount
                    }
                }
            }
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

    showFrameAtIndex(frames, index) {
        if (!frames || !frames.length) return;
        const frameUrls = frames.map(f => typeof f === 'string' ? f : (f.url || f.previewUrl || '')).filter(Boolean);
        if (typeof window.ImageLightbox !== 'undefined') {
            window.ImageLightbox.show(frameUrls, index);
        }
    }

    /**
     * Determine if an episode is playable based on its airDate.
     * Rules:
     * - Null / non-object episode -> false
     * - Missing / empty airDate -> true (policy-based fallback when air date is unannounced/unknown)
     * - Date-only (YYYY-MM-DD) or ISO timestamp:
     *   - airDate <= todayStr (local calendar day) -> true
     *   - airDate > todayStr (future) -> false
     * @param {Object} episode
     * @returns {boolean}
     */
    isEpisodePlayableByDate(episode) {
        if (!episode || typeof episode !== 'object') return false;
        if (!episode.airDate) return true;

        const rawAirDate = String(episode.airDate).trim();
        if (!rawAirDate) return true;

        const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(rawAirDate);
        const now = new Date();

        if (isDateOnly) {
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            const todayStr = `${year}-${month}-${day}`;
            return rawAirDate <= todayStr;
        }

        const airTimestamp = new Date(rawAirDate).getTime();
        if (isNaN(airTimestamp)) return true;
        return airTimestamp <= now.getTime();
    }

    /**
     * Render compact Hero Next Episode block for TV series.
     * @param {Object} movie 
     * @returns {string}
     */
    renderHeroNextEpisode(movie) {
        if (!movie) return '';
        const isSeries = Boolean(movie.isSeries || (movie.type && ['tv-series', 'mini-series', 'animated-series', 'tv'].includes(movie.type)));
        if (!isSeries) return '';

        const statusStr = String(movie.status || '').trim().toLowerCase();
        const isEndedOrCanceled = statusStr === 'ended' || statusStr === 'canceled' || statusStr === 'cancelled' || statusStr === 'completed';

        // Contradiction safety: if status says ended/canceled and nextEpisode exists, prefer safe omission
        if (isEndedOrCanceled) {
            if (movie.nextEpisode) {
                console.warn(`[MovieDetails] Next episode contradiction for ended/canceled series ${movie.kinopoiskId}: omitting Hero next-episode block`);
            }
            return '';
        }

        if (!movie.nextEpisode || typeof movie.nextEpisode !== 'object') {
            return '';
        }

        const seasonNum = movie.nextEpisode.seasonNumber;
        const episodeNum = movie.nextEpisode.episodeNumber;
        if (seasonNum == null || episodeNum == null) return '';

        const airDateStr = movie.nextEpisode.airDate ? this.formatDate(movie.nextEpisode.airDate) : '';
        const title = movie.nextEpisode.name ? String(movie.nextEpisode.name).trim() : '';
        const runtime = movie.nextEpisode.runtime ? `${movie.nextEpisode.runtime} мин` : '';
        const isPlayable = this.isEpisodePlayableByDate(movie.nextEpisode);

        return `
            <div class="hero-next-episode-card" id="heroNextEpisode">
                <div class="hero-next-episode-header">
                    <span class="hero-next-episode-badge">Следующая серия</span>
                    ${airDateStr ? `<span class="hero-next-episode-date">${this.escapeHtml(airDateStr)}</span>` : ''}
                </div>
                <div class="hero-next-episode-content">
                    <span class="hero-next-episode-code">S${seasonNum}E${episodeNum}</span>
                    ${title ? `<span class="hero-next-episode-title">${this.escapeHtml(title)}</span>` : ''}
                    ${runtime ? `<span class="hero-next-episode-runtime">· ${this.escapeHtml(runtime)}</span>` : ''}
                    ${isPlayable ? `
                        <button type="button" 
                                class="hero-next-episode__play-btn" 
                                data-action="play-next-episode" 
                                aria-label="Смотреть S${seasonNum}E${episodeNum}${title ? ` — ${this.escapeHtml(title)}` : ''}">
                            <span class="play-icon" aria-hidden="true">▶</span> Смотреть
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }

    /**
     * Client-side dynamic expiration evaluation for next episode.
     * For date-only (YYYY-MM-DD): expires only once current local calendar date is strictly after airDate.
     * For full timestamp: expires when current timestamp >= airDate.
     * @param {Object} movie 
     * @returns {boolean}
     */
    isNextEpisodeStale(movie) {
        if (!movie) return false;
        const isSeries = Boolean(movie.isSeries || (movie.type && ['tv-series', 'mini-series', 'animated-series', 'tv'].includes(movie.type)));
        if (!isSeries) return false;

        if (!movie.nextEpisode || !movie.nextEpisode.airDate) return false;

        const rawAirDate = String(movie.nextEpisode.airDate).trim();
        if (!rawAirDate) return false;

        const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(rawAirDate);
        const now = new Date();

        if (isDateOnly) {
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            const todayStr = `${year}-${month}-${day}`;
            return todayStr > rawAirDate;
        }

        const airTimestamp = new Date(rawAirDate).getTime();
        if (isNaN(airTimestamp)) return false;
        return now.getTime() >= airTimestamp;
    }

    /**
     * Stale-While-Revalidate background revalidation for dynamic series metadata.
     * Uses in-flight Promise deduplication and does not block page rendering.
     * @param {Object} movie 
     * @returns {Promise<Object|null>}
     */
    revalidateDynamicData(movie) {
        if (!movie || !movie.kinopoiskId) return Promise.resolve(null);
        const movieId = String(movie.kinopoiskId);

        if (this.dynamicRefreshRequests.has(movieId)) {
            return this.dynamicRefreshRequests.get(movieId);
        }

        const refreshPromise = (async () => {
            try {
                const fbMgr = (typeof firebaseManager !== 'undefined' && firebaseManager) ? firebaseManager : (typeof window !== 'undefined' && window.firebaseManager ? window.firebaseManager : null);
                const mediaAggregator = (fbMgr && typeof fbMgr.getMediaAggregatorService === 'function')
                    ? fbMgr.getMediaAggregatorService()
                    : (typeof MediaAggregatorService !== 'undefined' ? new MediaAggregatorService({
                        kinopoiskService: fbMgr?.getKinopoiskService?.(),
                        tmdbService: fbMgr?.getTMDBService?.(),
                        idMappingService: fbMgr?.getIdMappingService?.(),
                        movieCacheService: fbMgr?.getMovieCacheService?.()
                    }) : null);

                if (!mediaAggregator) return null;

                const freshMovie = await mediaAggregator.getMovieDetails(movie.kinopoiskId, {
                    title: movie.name || movie.alternativeName || '',
                    year: movie.year || '',
                    forceRefresh: true
                });

                if (freshMovie && String(this.selectedMovie?.kinopoiskId) === movieId) {
                    this.selectedMovie = freshMovie;
                    this.patchDynamicSeriesUI(freshMovie);
                }
                return freshMovie;
            } catch (err) {
                console.warn('[MovieDetails] Dynamic SWR revalidation failed (continuing gracefully):', err);
                // If background refresh fails and cached next episode is strictly stale, remove stale hero block
                if (this.isNextEpisodeStale(movie)) {
                    const heroNextEpEl = document.getElementById('heroNextEpisode');
                    if (heroNextEpEl) {
                        heroNextEpEl.remove();
                    }
                }
                return null;
            } finally {
                this.dynamicRefreshRequests.delete(movieId);
            }
        })();

        this.dynamicRefreshRequests.set(movieId, refreshPromise);
        return refreshPromise;
    }

    /**
     * Non-destructive DOM patching after dynamic SWR background revalidation.
     * @param {Object} freshMovie 
     */
    patchDynamicSeriesUI(freshMovie) {
        if (!freshMovie) return;

        // 1. Patch Hero next episode block
        const currentHeroEl = document.getElementById('heroNextEpisode');
        const newHeroHTML = this.renderHeroNextEpisode(freshMovie);

        if (currentHeroEl) {
            if (newHeroHTML) {
                const temp = document.createElement('div');
                temp.innerHTML = newHeroHTML.trim();
                const newEl = temp.firstElementChild || temp;
                if (typeof currentHeroEl.replaceWith === 'function') {
                    currentHeroEl.replaceWith(newEl);
                } else if (typeof currentHeroEl.outerHTML !== 'undefined') {
                    currentHeroEl.outerHTML = newHeroHTML;
                }
            } else {
                currentHeroEl.remove();
            }
        } else if (newHeroHTML) {
            const infoContainer = document.querySelector('.movie-detail-info-container');
            if (infoContainer) {
                const shortDesc = infoContainer.querySelector('.movie-detail-short-description');
                const tabs = infoContainer.querySelector('.movie-tabs');
                const target = shortDesc || tabs;
                const temp = document.createElement('div');
                temp.innerHTML = newHeroHTML.trim();
                const newEl = temp.firstElementChild || temp;
                if (target && typeof target.before === 'function') {
                    target.before(newEl);
                } else if (typeof infoContainer.appendChild === 'function') {
                    infoContainer.appendChild(newEl);
                }
            }
        }

        // 2. Patch Status badge if present in meta grid (DEF-02: selector matches .meta-item-status added in template)
        if (freshMovie.status) {
            const statusValEl = document.querySelector('.meta-item-status .meta-value');
            if (statusValEl) {
                const translated = this.translateStatus(freshMovie.status);
                const badgeClass = this.getStatusBadgeClass(freshMovie.status);
                // Update textContent and className to stay consistent with the original template structure
                statusValEl.textContent = translated;
                statusValEl.className = `meta-value status-badge status-badge--${badgeClass}`;
            }
        }

        // 3. Update seasons tab if series
        const isSeries = Boolean(freshMovie.isSeries || (freshMovie.type && ['tv-series', 'mini-series', 'animated-series', 'tv'].includes(freshMovie.type)));
        if (isSeries) {
            this.resolveAndRenderSeasons(freshMovie);
        }
    }

    async resolveAndRenderSeasons(movie) {
        if (!movie) return;
        const pageContext = this.capturePageContext(movie);
        void this.loadPublicEpisodeStats(movie, pageContext);

        const tabBtn = document.querySelector('.tab-btn[data-tab="seasons"]');
        const tabPane = document.getElementById('tab-seasons');

        // Tier 1: TMDB structured seasons
        if (Array.isArray(movie.seasons) && movie.seasons.length > 0) {
            console.log('[MovieDetails] Seasons source: TMDB_STRUCTURED');
            if (tabBtn) tabBtn.style.display = 'inline-block';
            if (tabPane) {
                tabPane.innerHTML = this.renderSeasonsTab(movie.seasons, movie.nextEpisode, movie.lastEpisode, movie.tmdbId, this.currentProgressRecord, this.currentWatchTarget, this.currentEpisodeHistory);
                void this.loadSelectedSeason();
            }
            await this._hydrateSeasonsProgressAndHistory(movie, movie.seasons, pageContext);
            return;
        }

        // Tier 2: KP structured seasonsInfo
        if (Array.isArray(movie.seasonsInfo) && movie.seasonsInfo.length > 0) {
            console.log('[MovieDetails] Seasons source: KP_STRUCTURED');
            const seasons = movie.seasonsInfo.map(s => ({
                number: s.number,
                name: `Сезон ${s.number}`,
                episodeCount: Number(s.episodesCount) || 0,
                airDate: null,
                overview: null,
                posterUrl: null,
                isSpecial: s.number === 0,
                source: 'kp'
            }));
            if (tabBtn) tabBtn.style.display = 'inline-block';
            if (tabPane) {
                tabPane.innerHTML = this.renderSeasonsTab(seasons, movie.nextEpisode, movie.lastEpisode, movie.tmdbId, this.currentProgressRecord, this.currentWatchTarget, this.currentEpisodeHistory);
                void this.loadSelectedSeason();
            }
            await this._hydrateSeasonsProgressAndHistory(movie, seasons, pageContext);
            return;
        }

        // Tier 3: Scraper Fallback
        console.log('[MovieDetails] Seasons source: SCRAPER (invoking fallback)');
        this.loadSeasonsFallback(movie.kinopoiskId, pageContext);
    }

    async _hydrateSeasonsProgressAndHistory(movie, seasons, pageContext = this.capturePageContext(movie)) {
        if (!movie || !movie.kinopoiskId) return;
        try {
            const [progRes, histRes] = await Promise.all([
                this.progressService ? this.progressService.getProgress(movie.kinopoiskId) : Promise.resolve(null),
                this.episodeHistoryService ? this.episodeHistoryService.getHistory(movie.kinopoiskId) : Promise.resolve({})
            ]);
            if (!this.isPageContextCurrent(pageContext)) return;
            let progress = progRes;
            let history = histRes || {};

            // Lazy migration: Seed single exact completed record if present in progress
            if (progress && progress.completed && this.episodeHistoryService) {
                await this.episodeHistoryService.seedFromProgress(movie.kinopoiskId, progress);
                history = await this.episodeHistoryService.getHistory(movie.kinopoiskId);
                if (!this.isPageContextCurrent(pageContext)) return;
            }

            this.currentProgressRecord = progress;
            this.currentEpisodeHistory = history;
            this.currentWatchTarget = this.resolveWatchTarget(movie, progress);

            const tabPane = document.getElementById('tab-seasons');
            if (tabPane && seasons) {
                if (this.seasonsBrowserTouched && tabPane.querySelector('.season-browser-tabs')) {
                    this.updateSeasonsBrowserState();
                    return;
                }
                tabPane.innerHTML = this.renderSeasonsTab(seasons, movie.nextEpisode, movie.lastEpisode, movie.tmdbId, progress, this.currentWatchTarget, history);
                void this.loadSelectedSeason();
            }
        } catch (e) {
            console.warn('[MovieDetails] Failed to hydrate seasons progress/history:', e);
        }
    }

    async loadSeasonsFallback(movieId, pageContext = this.capturePageContext()) {
        try {
            const seasonsRequest = this.perf?.requestStart('SEASONS_FALLBACK', { purpose: 'seasons-fallback' });
            const seasons = await this.seasonsService.getSeasons(movieId);
            this.perf?.requestEnd(seasonsRequest);
            if (!this.isPageContextCurrent(pageContext)) return;
            const tabBtn = document.querySelector('.tab-btn[data-tab="seasons"]');
            const tabPane = document.getElementById('tab-seasons');

            if (seasons && seasons.length > 0) {
                let progress = null;
                let history = {};
                if (movieId) {
                    try {
                        const [progRes, histRes] = await Promise.all([
                            this.progressService ? this.progressService.getProgress(movieId) : Promise.resolve(null),
                            this.episodeHistoryService ? this.episodeHistoryService.getHistory(movieId) : Promise.resolve({})
                        ]);
                        if (!this.isPageContextCurrent(pageContext)) return;
                        progress = progRes;
                        history = histRes || {};

                        // Lazy migration
                        if (progress && progress.completed && this.episodeHistoryService) {
                            await this.episodeHistoryService.seedFromProgress(movieId, progress);
                            history = await this.episodeHistoryService.getHistory(movieId);
                            if (!this.isPageContextCurrent(pageContext)) return;
                        }
                    } catch (err) {
                        console.debug('[MovieDetails] Progress/history fallback fetch ignored:', err);
                    }
                }
                this.currentProgressRecord = progress;
                this.currentEpisodeHistory = history;
                this.currentWatchTarget = this.resolveWatchTarget(this.selectedMovie || { kinopoiskId: movieId, isSeries: true }, progress);

                if (tabBtn) tabBtn.style.display = 'inline-block';
                if (tabPane) {
                    tabPane.innerHTML = this.renderSeasonsTab(seasons, this.selectedMovie?.nextEpisode, this.selectedMovie?.lastEpisode, this.selectedMovie?.tmdbId, progress, this.currentWatchTarget, history);
                    void this.loadSelectedSeason();
                }
                if (this.selectedMovie) {
                    this.selectedMovie.seasons = seasons;
                }
                const snapshot = this.getRenderEnrichmentSnapshot(movieId);
                if (snapshot) snapshot.seasons = seasons;
            } else {
                if (tabBtn) tabBtn.style.display = 'none';
            }
        } catch (e) {
            if (!this.isPageContextCurrent(pageContext)) return;
            console.warn('[MovieDetails] Scraper seasons fallback failed (continuing gracefully):', e);
            const tabBtn = document.querySelector('.tab-btn[data-tab="seasons"]');
            if (tabBtn) tabBtn.style.display = 'none';
        }
    }

    async loadSeasons(movieId) {
        if (this.selectedMovie && (
            (Array.isArray(this.selectedMovie.seasons) && this.selectedMovie.seasons.length > 0) ||
            (Array.isArray(this.selectedMovie.seasonsInfo) && this.selectedMovie.seasonsInfo.length > 0)
        )) {
            return this.resolveAndRenderSeasons(this.selectedMovie);
        }
        return this.loadSeasonsFallback(movieId);
    }

    formatDate(dateStr) {
        if (!dateStr) return '';
        try {
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return String(dateStr);
            return `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}.${d.getFullYear()}`;
        } catch {
            return String(dateStr);
        }
    }

    getPluralEpisodes(count) {
        return Utils.selectRussianPlural(count, ['серия', 'серии', 'серий']);
    }

    getPluralSeasons(count) {
        return Utils.selectRussianPlural(count, ['сезон', 'сезона', 'сезонов']);
    }

    getPluralRatings(count) {
        // Compact counts (e.g. "1 тыс.") always take the plural genitive.
        return count >= 1000 ? 'оценок' : Utils.selectRussianPlural(count, ['оценка', 'оценки', 'оценок']);
    }

    /**
     * Renders the Continue Watching banner at the top of Seasons tab.
     * @param {Object} movie
     * @param {Object|null} progress
     * @param {Object|null} watchTarget
     * @param {Array} seasons
     * @returns {string}
     */
    renderSeasonsContinueBanner(movie, progress, watchTarget, seasons = []) {
        if (!progress || !watchTarget) return '';

        const isSeries = Boolean(movie?.isSeries || (movie?.type && ['tv-series', 'mini-series', 'animated-series', 'tv'].includes(movie.type)));
        if (!isSeries) return '';

        // Case 1: Incomplete progress (RESUME_IN_PROGRESS)
        if (watchTarget.reason === 'RESUME_IN_PROGRESS' || (!progress.completed && progress.season != null && progress.episode != null)) {
            const seasonNum = progress.season;
            const episodeNum = progress.episode;
            
            // Try to find episode title from seasons structure if available
            let episodeTitle = null;
            if (Array.isArray(seasons)) {
                const sObj = seasons.find(s => (s.number ?? s.season_number) === seasonNum);
                if (sObj?.episodes) {
                    const epObj = sObj.episodes.find(e => (e.episodeNumber ?? e.episode_number ?? e.number) === episodeNum);
                    episodeTitle = epObj?.name || epObj?.title || epObj?.nameRu || null;
                }
            }
            if (!episodeTitle && progress.episodeLabel) {
                episodeTitle = progress.episodeLabel;
            }

            const timestamp = progress.timestamp || 0;
            const duration = progress.duration || null;
            const timeFormatter = (typeof formatPlaybackTime === 'function')
                ? formatPlaybackTime
                : (typeof window !== 'undefined' && window.formatPlaybackTime ? window.formatPlaybackTime : null);
            const formattedTime = timeFormatter ? timeFormatter(timestamp) : '00:00';
            
            let progressRowHtml = '';
            if (duration && duration > 0 && timestamp > 0) {
                const formattedDuration = timeFormatter ? timeFormatter(duration) : '00:00';
                const percent = Math.min(100, Math.max(0, (timestamp / duration) * 100)).toFixed(1);
                progressRowHtml = `
                    <div class="seasons-continue-banner__progress-row">
                        <div class="seasons-continue-banner__progress-track">
                            <div class="seasons-continue-banner__progress-bar" style="width: ${percent}%;" role="progressbar" aria-valuenow="${timestamp}" aria-valuemin="0" aria-valuemax="${duration}" aria-label="Прогресс серии"></div>
                        </div>
                        <span class="seasons-continue-banner__time">${formattedTime} / ${formattedDuration}</span>
                    </div>
                `;
            } else if (timestamp > 0) {
                progressRowHtml = `
                    <div class="seasons-continue-banner__time-only">
                        <span class="seasons-continue-banner__time">${formattedTime}</span>
                    </div>
                `;
            }

            return `
                <div class="seasons-continue-banner seasons-continue-banner--resume" id="seasonsContinueBanner">
                    <div class="seasons-continue-banner__content">
                        <div class="seasons-continue-banner__header">
                            <span class="seasons-continue-banner__badge">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                                <span>Продолжить просмотр</span>
                            </span>
                            <div class="seasons-continue-banner__target">
                                <span class="seasons-continue-banner__code">S${seasonNum}E${episodeNum}</span>
                                ${episodeTitle ? `<span class="seasons-continue-banner__title">${this.escapeHtml(episodeTitle)}</span>` : ''}
                            </div>
                        </div>
                        ${progressRowHtml}
                    </div>
                    <div class="seasons-continue-banner__actions">
                        <button type="button" 
                                class="btn btn-primary btn-sm seasons-continue-banner__btn" 
                                data-action="continue-watch-progress" 
                                data-season-number="${seasonNum}" 
                                data-episode-number="${episodeNum}" 
                                data-timestamp="${timestamp}"
                                aria-label="Продолжить просмотр S${seasonNum}E${episodeNum}">
                            <span class="play-icon" aria-hidden="true">▶</span> Продолжить
                        </button>
                    </div>
                </div>
            `;
        }

        // Case 2: Completed progress targeting next episode (NEXT_AFTER_COMPLETED)
        if (watchTarget.reason === 'NEXT_AFTER_COMPLETED' && watchTarget.seasonNumber != null && watchTarget.episodeNumber != null) {
            const seasonNum = watchTarget.seasonNumber;
            const episodeNum = watchTarget.episodeNumber;
            const episodeTitle = watchTarget.episodeTitle || null;

            return `
                <div class="seasons-continue-banner seasons-continue-banner--next" id="seasonsContinueBanner">
                    <div class="seasons-continue-banner__content">
                        <div class="seasons-continue-banner__header">
                            <span class="seasons-continue-banner__badge seasons-continue-banner__badge--next">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                                <span>Продолжить просмотр</span>
                            </span>
                            <div class="seasons-continue-banner__target">
                                <span class="seasons-continue-banner__subtitle">Следующая серия:</span>
                                <span class="seasons-continue-banner__code">S${seasonNum}E${episodeNum}</span>
                                ${episodeTitle ? `<span class="seasons-continue-banner__title">${this.escapeHtml(episodeTitle)}</span>` : ''}
                            </div>
                        </div>
                    </div>
                    <div class="seasons-continue-banner__actions">
                        <button type="button" 
                                class="btn btn-primary btn-sm seasons-continue-banner__btn" 
                                data-action="continue-watch-progress" 
                                data-season-number="${seasonNum}" 
                                data-episode-number="${episodeNum}" 
                                data-timestamp="0"
                                aria-label="Смотреть следующую серию S${seasonNum}E${episodeNum}">
                            <span class="play-icon" aria-hidden="true">▶</span> Смотреть
                        </button>
                    </div>
                </div>
            `;
        }

        // Case 3: NEW_SERIES or FINAL_EPISODE_COMPLETED or no progress -> Omit banner
        return '';
    }

    /**
     * Calculates completion statistics for a single season (Phase 4C & 4D).
     * Excludes future unreleased episodes from denominator.
     * Specials (Season 0) are tracked independently.
     * @param {Object} season 
     * @param {Record<string, { cAt: number, src: string }>} history 
     * @returns {{ completedCount: number, totalReleasedCount: number, totalCount: number, hasFutureEpisodes: boolean, isFullyCompleted: boolean, isSpecial: boolean, badgeLabel: string, badgeType: string }}
     */
    getSeasonCompletionStats(season, history = this.currentEpisodeHistory) {
        if (!season) {
            return {
                completedCount: 0,
                totalReleasedCount: 0,
                totalCount: 0,
                hasFutureEpisodes: false,
                isFullyCompleted: false,
                isSpecial: false,
                badgeLabel: '',
                badgeType: 'none'
            };
        }

        const seasonNumber = Number(season.number);
        const isSpecial = Boolean(season.isSpecial || seasonNumber === 0);

        let totalReleasedCount;
        let totalCount;
        let completedCount = 0;

        if (Array.isArray(season.episodes) && season.episodes.length > 0) {
            totalCount = season.episodes.length;
            const released = season.episodes.filter(ep => this.isEpisodeReleasedForRating(ep, season.airDate));
            totalReleasedCount = released.length;
            completedCount = released.filter(ep => {
                const epKey = typeof buildEpisodeHistoryKey === 'function'
                    ? buildEpisodeHistoryKey(seasonNumber, ep.episodeNumber)
                    : `${seasonNumber}:${ep.episodeNumber}`;
                return Boolean(history && epKey && history[epKey]);
            }).length;
        } else {
            totalCount = Number(season.episodeCount) || 0;
            totalReleasedCount = totalCount;
            if (history && typeof history === 'object') {
                for (const key of Object.keys(history)) {
                    const parsed = typeof parseEpisodeHistoryKey === 'function'
                        ? parseEpisodeHistoryKey(key)
                        : (() => { const p = key.split(':'); return p.length === 2 ? { seasonNumber: Number(p[0]), episodeNumber: Number(p[1]) } : null; })();
                    if (parsed && parsed.seasonNumber === seasonNumber) {
                        completedCount++;
                    }
                }
            }
        }

        const isFullyCompleted = totalReleasedCount > 0 && completedCount >= totalReleasedCount;
        const hasFutureEpisodes = totalCount > totalReleasedCount;

        let badgeLabel = '';
        let badgeType = 'none';

        if (completedCount > 0) {
            if (isFullyCompleted) {
                if (hasFutureEpisodes) {
                    badgeLabel = 'Все вышедшие просмотрены';
                    badgeType = 'full_released';
                } else {
                    badgeLabel = 'Сезон просмотрен';
                    badgeType = 'full_season';
                }
            } else if (totalReleasedCount > 0) {
                badgeLabel = `${completedCount} / ${totalReleasedCount} просмотрено`;
                badgeType = 'partial';
            } else {
                badgeLabel = `${completedCount} просмотрено`;
                badgeType = 'unknown_total';
            }
        }

        return {
            completedCount,
            totalReleasedCount,
            totalCount,
            hasFutureEpisodes,
            isFullyCompleted,
            isSpecial,
            badgeLabel,
            badgeType
        };
    }

    /**
     * Handles manual toggle of an episode's watched status (Phase 4C).
     * @param {number} seasonNumber 
     * @param {number} episodeNumber 
     * @param {HTMLElement} btn 
     */
    async handleToggleEpisodeWatched(seasonNumber, episodeNumber, btn) {
        if (!this.selectedMovie || !this.episodeHistoryService) return;
        const movieId = this.selectedMovie.kinopoiskId;
        if (!movieId || isNaN(seasonNumber) || isNaN(episodeNumber)) return;

        const epKey = typeof buildEpisodeHistoryKey === 'function'
            ? buildEpisodeHistoryKey(seasonNumber, episodeNumber)
            : `${seasonNumber}:${episodeNumber}`;
        if (!epKey) return;
        if (btn?.disabled) return;
        const pageContext = this.capturePageContext(this.selectedMovie);
        if (btn) btn.disabled = true;

        const isCurrentlyWatched = Boolean(this.currentEpisodeHistory && this.currentEpisodeHistory[epKey]);

        try {
            const history = isCurrentlyWatched
                ? await this.episodeHistoryService.unmarkCompleted(movieId, seasonNumber, episodeNumber)
                : await this.episodeHistoryService.markCompleted(movieId, seasonNumber, episodeNumber, { source: 'MANUAL' });
            if (!this.isPageContextCurrent(pageContext)) return;
            this.currentEpisodeHistory = history;
            await this.refreshSeasonsProgress();
        } catch (err) {
            console.warn('[MovieDetails] Failed to toggle watched state:', err);
        } finally {
            if (btn && this.isPageContextCurrent(pageContext)) btn.disabled = false;
        }
    }

    getDefaultSeasonEpisode(seasons, progress = this.currentProgressRecord, watchTarget = this.currentWatchTarget, history = this.currentEpisodeHistory) {
        const ordered = [...(seasons || [])].sort((a, b) => (Number(a.number) === 0 ? Infinity : Number(a.number)) - (Number(b.number) === 0 ? Infinity : Number(b.number)));
        const candidates = [watchTarget && { seasonNumber: Number(watchTarget.seasonNumber), episodeNumber: Number(watchTarget.episodeNumber) },
            progress && { seasonNumber: Number(progress.season), episodeNumber: Number(progress.episode) }];
        const lastWatched = Object.entries(history || {}).sort((a, b) => Number(b[1]?.cAt || b[1]?.completedAt || 0) - Number(a[1]?.cAt || a[1]?.completedAt || 0))[0];
        if (lastWatched) {
            const [seasonNumber, episodeNumber] = lastWatched[0].split(':').map(Number);
            candidates.push({ seasonNumber, episodeNumber });
        }
        const saved = candidates.find(item => item && item.episodeNumber > 0 && ordered.some(season => Number(season.number) === item.seasonNumber));
        if (saved) return saved;
        const season = ordered[0];
        const episode = season?.episodes?.find(ep => this.isEpisodeReleasedForRating(ep, season.airDate));
        return { seasonNumber: Number(season?.number) || 0, episodeNumber: Number(episode?.episodeNumber) || null };
    }

    renderSeasonsTab(seasons, nextEpisode = null, lastEpisode = null, tmdbId = null, progress = this.currentProgressRecord, watchTarget = this.currentWatchTarget, history = this.currentEpisodeHistory) {
        if (!Array.isArray(seasons) || seasons.length === 0) return '';
        const identity = `${this.pageGeneration || 0}:${this.selectedMovie?.kinopoiskId || ''}:${tmdbId || this.selectedMovie?.externalId?.tmdb || ''}`;
        if (this.seasonsBrowserIdentity !== identity) {
            this.seasonsBrowserIdentity = identity;
            this.seasonsBrowserCache = new Map();
            this.seasonsBrowserLoads = new Map();
            this.seasonsBrowserLoadVersions = new Map();
            this.seasonsBrowserRequest = 0;
            this.seasonsBrowserTouched = false;
            this.seasonsBrowserEpisode = null;
            this.seasonsBrowserPlayingSelection = undefined;
        }
        this.seasonsBrowserSeasons = seasons.map(season => ({ ...season, number: Number(season.number), episodeCount: Number(season.episodeCount ?? season.episodesCount) || 0 }))
            .sort((a, b) => (a.number === 0 ? Infinity : a.number) - (b.number === 0 ? Infinity : b.number));
        this.seasonsBrowserTmdbId = Number(tmdbId || this.selectedMovie?.externalId?.tmdb) || null;
        const target = this.getDefaultSeasonEpisode(this.seasonsBrowserSeasons, progress, watchTarget, history);
        if (!this.seasonsBrowserTouched || !this.seasonsBrowserSeasons.some(season => season.number === this.seasonsBrowserSeason)) {
            this.seasonsBrowserSeason = target.seasonNumber;
            this.seasonsBrowserEpisode = target.episodeNumber;
        }
        this.seasonsBrowserSeasons.forEach(season => {
            if (Array.isArray(season.episodes) && season.episodes.length) this.seasonsBrowserCache.set(season.number, { ...season, episodes: this.normalizeBrowserEpisodes(season.episodes, season.number) });
        });
        const active = this.seasonsBrowserSeasons.find(season => season.number === this.seasonsBrowserSeason);
        const data = this.seasonsBrowserCache.get(this.seasonsBrowserSeason);
        const normalCount = this.seasonsBrowserSeasons.filter(season => season.number > 0).length;
        return `<section class="seasons-container">
            <div class="seasons-tab-header"><h3 class="seasons-tab-title">Сезоны</h3><span class="seasons-tab-count">${normalCount} ${this.getPluralSeasons(normalCount)}</span></div>
            <div class="season-browser-continue">${this.renderSeasonsContinueBanner(this.selectedMovie, progress, watchTarget, seasons)}</div>
            <div class="season-browser-nav"><span class="season-browser-label">Сезон</span><div class="season-browser-tabs" role="tablist" aria-label="Выбор сезона">
                ${this.seasonsBrowserSeasons.map(season => {
                    const selected = season.number === this.seasonsBrowserSeason;
                    const completion = this.getSeasonCompletionStats(season, history);
                    return `<button type="button" id="season-browser-tab-${season.number}" class="season-tab${selected ? ' is-selected' : ''}" data-action="select-season-pill" data-season-number="${season.number}" role="tab" aria-controls="season-browser-panel" aria-selected="${selected}" tabindex="${selected ? 0 : -1}">${season.number === 0 ? 'Спецвыпуски' : `S${season.number}`}<span class="season-tab-progress">${completion.completedCount ? ` · ${completion.completedCount}/${completion.totalReleasedCount}` : ''}</span></button>`;
                }).join('')}
            </div></div>
            <div id="season-browser-panel" class="season-browser-panel" role="tabpanel" aria-labelledby="season-browser-tab-${this.seasonsBrowserSeason}">${data ? this.renderEpisodesList(data.episodes, nextEpisode, progress, watchTarget, history, this.playbackController?.currentSelection, active?.airDate || data.airDate) : this.renderSeasonBrowserPlaceholder(active)}</div>
        </section>`;
    }

    normalizeBrowserEpisodes(episodes, seasonNumber) {
        return episodes.filter(ep => Number.isInteger(Number(ep.episodeNumber)) && Number(ep.episodeNumber) > 0)
            .map(ep => ({ ...ep, seasonNumber: Number(seasonNumber), episodeNumber: Number(ep.episodeNumber) }))
            .sort((a, b) => a.episodeNumber - b.episodeNumber);
    }

    renderSeasonBrowserPlaceholder(season) {
        if (!this.seasonsBrowserTmdbId) return '<p class="season-empty-notice">Подробный список серий доступен для сериалов с привязкой к TMDB</p>';
        if (!season || season.episodeCount === 0) return '<p class="season-empty-notice">Серии пока не опубликованы</p>';
        return '<div class="season-episodes-loader app-loader app-loader--inline" role="status" aria-live="polite"><div class="app-loader__indicator" aria-hidden="true"></div><span class="app-loader__label">Загрузка серий...</span></div>';
    }

    async loadSelectedSeason(seasonNumber = this.seasonsBrowserSeason, options = {}) {
        const season = this.seasonsBrowserSeasons?.find(item => item.number === Number(seasonNumber));
        if (!season) return;
        const panel = document.getElementById('season-browser-panel');
        if (!panel) return;
        const identity = this.seasonsBrowserIdentity;
        const pageContext = this.capturePageContext(this.selectedMovie);
        const request = ++this.seasonsBrowserRequest;
        const isCurrent = () => identity === this.seasonsBrowserIdentity && request === this.seasonsBrowserRequest
            && Number(seasonNumber) === this.seasonsBrowserSeason && this.isPageContextCurrent(pageContext)
            && document.getElementById('season-browser-panel') === panel;
        const paint = data => {
            if (!isCurrent()) return;
            this.seasonsBrowserEpisodes = data.episodes;
            this.seasonsBrowserAirDate = season.airDate || data.airDate || null;
            if (options.episodeNumber !== undefined) this.seasonsBrowserEpisode = options.episodeNumber;
            panel.innerHTML = this.renderEpisodesList(data.episodes, this.selectedMovie?.nextEpisode, this.currentProgressRecord,
                this.currentWatchTarget, this.currentEpisodeHistory, this.playbackController?.currentSelection, this.seasonsBrowserAirDate);
            this.updateSeasonsBrowserState();
            this.updateEpisodeChartScrollControls();
            const chart = panel.querySelector('.episode-chart');
            chart?.addEventListener('scroll', () => this.updateEpisodeChartScrollControls(), { passive: true });
            this.scrollBrowserSelectionIntoView('.episode-chart', '.episode-column.is-selected');
        };
        if (!options.forceRefresh && this.seasonsBrowserCache.has(season.number)) {
            paint(this.seasonsBrowserCache.get(season.number));
            return;
        }
        panel.innerHTML = this.renderSeasonBrowserPlaceholder(season);
        if (!this.seasonsBrowserTmdbId || season.episodeCount === 0) return;
        panel.setAttribute('aria-busy', 'true');
        let load = this.seasonsBrowserLoads.get(season.number);
        const versions = this.seasonsBrowserLoadVersions ||= new Map();
        let loadVersion = versions.get(season.number) || 0;
        try {
            if (!load || options.forceRefresh) {
                const tmdb = typeof firebaseManager !== 'undefined' && firebaseManager.getTMDBService
                    ? firebaseManager.getTMDBService() : (this.tmdbService || new TMDBService());
                load = tmdb.getSeasonDetails(this.seasonsBrowserTmdbId, season.number, { forceRefresh: Boolean(options.forceRefresh) });
                this.seasonsBrowserLoads.set(season.number, load);
                loadVersion += 1;
                versions.set(season.number, loadVersion);
            }
            const raw = await load;
            if (versions.get(season.number) !== loadVersion) return;
            const data = { ...(raw || {}), episodes: this.normalizeBrowserEpisodes(raw?.episodes || [], season.number) };
            if (identity !== this.seasonsBrowserIdentity || !this.isPageContextCurrent(pageContext)) return;
            this.seasonsBrowserCache.set(season.number, data);
            if (isCurrent()) {
                if (data.episodes.length) paint(data);
                else panel.innerHTML = '<p class="season-empty-notice">Информация о сериях отсутствует</p>';
            }
        } catch {
            if (isCurrent()) panel.innerHTML = `<div class="season-error-box" role="alert"><p>Не удалось загрузить серии этого сезона</p><button type="button" class="btn btn-secondary" data-action="retry-season" data-season-number="${season.number}">Повторить</button></div>`;
        } finally {
            if (identity === this.seasonsBrowserIdentity && this.seasonsBrowserLoads.get(season.number) === load) this.seasonsBrowserLoads.delete(season.number);
            if (isCurrent()) panel.removeAttribute('aria-busy');
        }
    }

    async handleSeasonPillSelect(seasonNumber, options = {}) {
        if (!this.seasonsBrowserSeasons?.some(season => season.number === Number(seasonNumber))) return;
        this.seasonsBrowserTouched = true;
        this.seasonsBrowserSeason = Number(seasonNumber);
        this.seasonsBrowserEpisode = options.episodeNumber ?? null;
        this.seasonsBrowserEpisodes = [];
        document.querySelectorAll('.season-tab').forEach(tab => {
            const selected = Number(tab.dataset.seasonNumber) === this.seasonsBrowserSeason;
            tab.classList.toggle('is-selected', selected);
            tab.setAttribute('aria-selected', String(selected));
            tab.tabIndex = selected ? 0 : -1;
        });
        const panel = document.getElementById('season-browser-panel');
        panel?.setAttribute('aria-labelledby', `season-browser-tab-${this.seasonsBrowserSeason}`);
        this.scrollBrowserSelectionIntoView('.season-browser-tabs', '.season-tab.is-selected');
        await this.loadSelectedSeason(this.seasonsBrowserSeason, options);
    }

    async loadPublicEpisodeStats(movie, pageContext = this.capturePageContext(movie)) {
        if (typeof isSeriesMedia !== 'function' || !isSeriesMedia(movie)) return;
        const movieId = Number(movie?.kinopoiskId);
        if (!Number.isInteger(movieId) || movieId <= 0) return;
        const identity = `${this.pageGeneration || 0}:${movieId}`;
        if (this.episodeStatsPageIdentity === identity) return this.episodeStatsLoad;
        this.episodeStatsPageIdentity = identity;
        this.publicEpisodeStats = { movieId, episodes: {} };
        this.publicEpisodeStatsRevision = 0;
        this.episodeStatsLoad = (async () => {
            try {
                const db = typeof firebaseManager !== 'undefined' ? firebaseManager.db : null;
                if (!db) return;
                const snapshot = await db.collection('seriesEpisodeStats').doc(String(movieId)).get();
                if (identity !== this.episodeStatsPageIdentity || !this.isPageContextCurrent(pageContext) || this.publicEpisodeStatsRevision > 0) return;
                this.publicEpisodeStats = { movieId, episodes: snapshot.exists ? snapshot.data()?.episodes || {} : {} };
            } catch {
                // Missing rules or a failed public read must not block the catalog.
            } finally {
                if (identity === this.episodeStatsPageIdentity && this.isPageContextCurrent(pageContext)) this.refreshEpisodeCommunityUI();
            }
        })();
        return this.episodeStatsLoad;
    }

    getPublicEpisodeScore(ep) {
        if (Number(this.publicEpisodeStats?.movieId) !== Number(this.selectedMovie?.kinopoiskId)) return null;
        const entry = this.publicEpisodeStats?.episodes?.[`${Number(ep.seasonNumber)}:${Number(ep.episodeNumber)}`];
        if (!Number.isInteger(entry?.count) || entry.count < 1 || !Number.isInteger(entry.sum)
            || entry.sum < entry.count || entry.sum > entry.count * 10) return null;
        return { ...entry, avg: Math.round(entry.sum / entry.count * 10) / 10 };
    }

    adjustPublicEpisodeScore(season, episode, oldRating, newRating) {
        const movieId = Number(this.selectedMovie?.kinopoiskId);
        const episodes = Number(this.publicEpisodeStats?.movieId) === movieId ? { ...this.publicEpisodeStats.episodes } : {};
        const key = `${season}:${episode}`;
        const previous = this.getPublicEpisodeScore({ seasonNumber: season, episodeNumber: episode });
        // An absent/stale projection may not yet contain the user's old vote.
        const removeOld = oldRating && previous && previous.sum >= oldRating;
        const sum = Math.max(0, (previous?.sum || 0) - (removeOld ? oldRating : 0) + (newRating || 0));
        const count = Math.max(0, (previous?.count || 0) - (removeOld ? 1 : 0) + (newRating ? 1 : 0));
        if (count && sum >= count && sum <= count * 10) episodes[key] = { sum, count, avg: Math.round(sum / count * 10) / 10 };
        else delete episodes[key];
        this.publicEpisodeStats = { movieId, episodes };
        this.publicEpisodeStatsRevision = (this.publicEpisodeStatsRevision || 0) + 1;
        this.refreshEpisodeCommunityUI();
    }

    getSeasonEpisodeChartStats(episodes, seasonAirDate = null) {
        const rated = episodes.filter(ep => this.isEpisodeReleasedForRating(ep, seasonAirDate)).map(ep => this.getPublicEpisodeScore(ep)).filter(Boolean);
        return { average: rated.length ? rated.reduce((sum, entry) => sum + entry.avg, 0) / rated.length : null,
            votes: rated.reduce((sum, entry) => sum + entry.count, 0),
            minRating: rated.length ? Math.min(...rated.map(entry => entry.avg)) : null,
            maxRating: rated.length ? Math.max(...rated.map(entry => entry.avg)) : null };
    }

    getEpisodeSeasonSummary(episodes, stats, seasonNumber) {
        const ratings = stats.average === null ? `${episodes.length} ${this.getPluralEpisodes(episodes.length)} · оценок пока нет`
            : `★ ${stats.average.toFixed(1)} среднее · ${this.formatVotes(stats.votes)} ${this.getPluralRatings(stats.votes)}`;
        return `Серии ${seasonNumber === 0 ? '· Спецвыпуски' : `S${seasonNumber}`} · ${ratings}`;
    }

    getCommunityEpisodeLabel(ep) {
        const score = this.getPublicEpisodeScore(ep);
        return score ? `★ ${score.avg.toFixed(1)} · ${this.formatVotes(score.count)} ${this.getPluralRatings(score.count)}` : 'Оценок пока нет';
    }

    refreshEpisodeCommunityUI() {
        const episodes = this.seasonsBrowserEpisodes || [];
        if (!episodes.length) return;
        const stats = this.getSeasonEpisodeChartStats(episodes, this.seasonsBrowserAirDate);
        const summary = document.querySelector('.season-browser-summary strong');
        if (summary) summary.textContent = this.getEpisodeSeasonSummary(episodes, stats, this.seasonsBrowserSeason);
        document.querySelectorAll('.episode-column').forEach(column => {
            const ep = episodes.find(item => Number(item.episodeNumber) === Number(column.dataset.episodeNumber));
            if (!ep) return;
            const score = this.isEpisodeReleasedForRating(ep, this.seasonsBrowserAirDate) ? this.getPublicEpisodeScore(ep) : null;
            column.classList.toggle('is-unrated', !score);
            column.setAttribute('aria-label', `Серия ${ep.episodeNumber}, ${score ? `средняя оценка ${score.avg.toFixed(1)}` : 'нет оценок'}`);
            const bar = column.querySelector('.episode-column-bar');
            bar?.style.setProperty('--episode-bar-position', ((this.getEpisodeChartHeight(ep, stats, this.seasonsBrowserAirDate) - 22) / 38).toFixed(6));
            const value = column.querySelector('.episode-column-score');
            if (value) value.textContent = score ? score.avg.toFixed(1) : '—';
        });
        const track = document.querySelector('.episode-chart-track');
        let line = track?.querySelector('.episode-chart-average');
        if (stats.average === null) line?.remove();
        else if (track) {
            if (!line) {
                line = document.createElement('span');
                line.className = 'episode-chart-average';
                line.setAttribute('aria-hidden', 'true');
                track.prepend(line);
            }
            line.style.setProperty('--episode-bar-position', ((this.getEpisodeChartRatingHeight(stats.average, stats) - 22) / 38).toFixed(6));
        }
        const ep = episodes.find(item => Number(item.episodeNumber) === this.seasonsBrowserEpisode);
        const label = document.querySelector('.episode-community-score');
        if (label && ep) label.textContent = this.getCommunityEpisodeLabel(ep);
    }

    getEpisodeChartRatingHeight(rating, stats) {
        const minHeight = 22, maxHeight = 60;
        if (stats.minRating === null || stats.maxRating === null) return minHeight;
        if (stats.minRating === stats.maxRating) return (minHeight + maxHeight) / 2;
        const lo = stats.minRating - 0.3, hi = stats.maxRating;
        const ratio = Math.max(0, Math.min(1, (rating - lo) / (hi - lo)));
        return minHeight + ratio * (maxHeight - minHeight);
    }

    getEpisodeChartHeight(ep, stats, seasonAirDate = null) {
        const score = this.getPublicEpisodeScore(ep);
        if (!this.isEpisodeReleasedForRating(ep, seasonAirDate) || !score) return 22;
        return this.getEpisodeChartRatingHeight(score.avg, stats);
    }

    renderEpisodesList(episodes, nextEpisode = null, progress = this.currentProgressRecord, watchTarget = this.currentWatchTarget, history = this.currentEpisodeHistory, currentSelection = this.playbackController?.currentSelection, seasonAirDate = null) {
        if (!Array.isArray(episodes) || !episodes.length) return '';
        const seasonNumber = Number(episodes[0].seasonNumber);
        this.seasonsBrowserEpisodes = episodes;
        this.seasonsBrowserAirDate = seasonAirDate;
        const target = this.getDefaultSeasonEpisode([{ number: seasonNumber, episodes }], progress, watchTarget, history);
        const wanted = this.seasonsBrowserEpisode ?? target.episodeNumber;
        const selected = episodes.find(ep => Number(ep.episodeNumber) === Number(wanted))
            || episodes.find(ep => this.isEpisodeReleasedForRating(ep, seasonAirDate)) || episodes[0];
        this.seasonsBrowserEpisode = Number(selected.episodeNumber);
        const stats = this.getSeasonEpisodeChartStats(episodes, seasonAirDate);
        const season = this.seasonsBrowserSeasons?.find(item => item.number === seasonNumber);
        const summary = this.getEpisodeSeasonSummary(episodes, stats, seasonNumber);
        return `<div class="season-browser-summary"><strong>${this.escapeHtml(summary)}</strong>${season?.airDate ? `<span>Премьера: ${this.escapeHtml(this.formatDate(season.airDate))}</span>` : ''}</div>
            <div class="episode-chart-shell"><button type="button" class="episode-chart-scroll" data-action="scroll-episode-chart" data-direction="prev" aria-label="Прокрутить серии влево" hidden>‹</button>
            <div class="episode-chart" role="tablist" aria-label="Выбор серии"><div class="episode-chart-track" style="--episode-count:${episodes.length}">${stats.average === null ? '' : `<span class="episode-chart-average" aria-hidden="true" style="--episode-bar-position:${((this.getEpisodeChartRatingHeight(stats.average, stats) - 22) / 38).toFixed(6)}"></span>`}${episodes.map(ep => {
                const score = this.isEpisodeReleasedForRating(ep, seasonAirDate) ? this.getPublicEpisodeScore(ep) : null;
                const voted = Boolean(score);
                const isSelected = Number(ep.episodeNumber) === this.seasonsBrowserEpisode;
                const state = this.getBrowserEpisodeState(ep, progress, history, currentSelection);
                return `<button type="button" id="episode-browser-tab-${seasonNumber}-${Number(ep.episodeNumber)}" class="episode-column${isSelected ? ' is-selected' : ''}${voted ? '' : ' is-unrated'}" data-action="select-browser-episode" data-season-number="${seasonNumber}" data-episode-number="${Number(ep.episodeNumber)}" role="tab" aria-controls="episode-detail-panel" aria-selected="${isSelected}" aria-label="Серия ${Number(ep.episodeNumber)}, средняя оценка ${voted ? score.avg.toFixed(1) : 'нет оценок'}" tabindex="${isSelected ? 0 : -1}"><span class="episode-column-bar" style="--episode-bar-position:${((this.getEpisodeChartHeight(ep, stats, seasonAirDate) - 22) / 38).toFixed(6)}"><span class="episode-column-score">${voted ? score.avg.toFixed(1) : '—'}</span></span><span class="episode-column-label">E${Number(ep.episodeNumber)}<span class="episode-column-markers"><span data-marker="watched" title="Просмотрено"${state.watched ? '' : ' hidden'}>✓</span><span data-marker="resume" title="Продолжить"${state.resume ? '' : ' hidden'}>●</span><span data-marker="rated" title="Вы оценили"${state.rated ? '' : ' hidden'}>★</span><span data-marker="playing" title="Смотрю"${state.playing ? '' : ' hidden'}>▶</span></span></span></button>`;
            }).join('')}</div></div><button type="button" class="episode-chart-scroll" data-action="scroll-episode-chart" data-direction="next" aria-label="Прокрутить серии вправо" hidden>›</button></div>
            <div id="episode-detail-panel" role="tabpanel" aria-labelledby="episode-browser-tab-${seasonNumber}-${this.seasonsBrowserEpisode}">${this.renderSelectedEpisode(selected, progress, watchTarget, history, currentSelection, seasonAirDate)}</div>`;
    }

    getBrowserEpisodeState(ep, progress = this.currentProgressRecord, history = this.currentEpisodeHistory, selection = this.seasonsBrowserPlayingSelection !== undefined ? this.seasonsBrowserPlayingSelection : this.playbackController?.currentSelection) {
        const season = Number(ep.seasonNumber), episode = Number(ep.episodeNumber);
        const same = record => record && Number(record.seasonNumber ?? record.season) === season && Number(record.episodeNumber ?? record.episode) === episode;
        const playing = Boolean(same(selection) && (!selection.kinopoiskId || Number(selection.kinopoiskId) === Number(this.selectedMovie?.kinopoiskId)));
        return { watched: Boolean(history?.[`${season}:${episode}`]), resume: Boolean(progress && !progress.completed && same(progress)), playing,
            rated: Number(this.getEpisodeRatingFor(season, episode)?.r) || 0,
            released: this.isEpisodeReleasedForRating(ep, this.seasonsBrowserAirDate) };
    }

    renderBrowserEpisodeBadges(ep, state) {
        return `<span class="badge-playing-episode"${state.playing ? '' : ' hidden'}>Смотрю</span><span class="badge-watched-episode"${state.watched ? '' : ' hidden'}>✓ Просмотрено</span><span class="badge-resume-episode"${state.resume ? '' : ' hidden'}>Продолжить</span><span class="episode-user-rating-badge"${state.rated ? '' : ' hidden'}>Вы ★ ${state.rated}</span><span class="badge-upcoming"${state.released ? ' hidden' : ''}>Серия ещё не вышла</span>`;
    }

    renderSelectedEpisode(ep, progress = this.currentProgressRecord, watchTarget = this.currentWatchTarget, history = this.currentEpisodeHistory, selection = this.seasonsBrowserPlayingSelection !== undefined ? this.seasonsBrowserPlayingSelection : this.playbackController?.currentSelection, seasonAirDate = this.seasonsBrowserAirDate) {
        const state = this.getBrowserEpisodeState(ep, progress, history, selection);
        const season = Number(ep.seasonNumber), episode = Number(ep.episodeNumber);
        const title = this.escapeHtml(ep.name || `Серия ${episode}`);
        const index = this.seasonsBrowserEpisodes?.findIndex(item => Number(item.episodeNumber) === episode) ?? 0;
        const seasonIndex = this.seasonsBrowserSeasons?.findIndex(item => item.number === season) ?? 0;
        const canPrevious = index > 0 || seasonIndex > 0;
        const canNext = index < (this.seasonsBrowserEpisodes?.length || 1) - 1 || seasonIndex < (this.seasonsBrowserSeasons?.length || 1) - 1;
        const fallbackStill = this.selectedMovie?.backdropUrl || this.selectedMovie?.backdrop || this.seasonsBrowserCache?.get(season)?.posterUrl
            || this.seasonsBrowserSeasons?.find(item => item.number === season)?.posterUrl || null;
        const still = ep.stillUrl || fallbackStill;
        const timestamp = state.resume ? Number(progress?.timestamp) || 0 : 0;
        const percent = state.resume && Number(progress?.duration) > 0 ? Math.min(100, Math.max(0, timestamp / Number(progress.duration) * 100)) : 0;
        return `<article class="episode-detail" data-season-number="${season}" data-episode-number="${episode}">
            <button type="button" class="episode-detail-nav episode-detail-nav--prev" data-action="navigate-browser-episode" data-direction="prev" aria-label="Предыдущая серия" aria-disabled="${!canPrevious}"${canPrevious ? '' : ' disabled'}>‹</button>
            <div class="episode-detail-main"><div class="episode-detail-still">${still ? `<img src="${this.escapeHtml(still)}" alt="${title}" loading="lazy" decoding="async" data-episode-still>${ep.stillUrl ? '' : '<span class="episode-still-placeholder-label">Кадр серии недоступен</span>'}` : '<span aria-label="Кадр отсутствует">▶</span>'}</div>
            <div class="episode-detail-content"><p class="episode-detail-meta">S${season}.E${episode}${ep.airDate ? ` · ${this.escapeHtml(this.formatDate(ep.airDate))}` : ''}${Number(ep.runtime) > 0 ? ` (${Number(ep.runtime)} мин)` : ''}</p>
            <h4 class="episode-title">${title}</h4><p class="episode-community-score">${this.escapeHtml(this.getCommunityEpisodeLabel(ep))}</p>
            <div class="episode-badges">${this.renderBrowserEpisodeBadges(ep, state)}</div><p class="episode-overview">${this.escapeHtml(ep.overview || '')}</p>
            <div class="episode-progress"${percent ? '' : ' hidden'} role="progressbar" aria-label="Прогресс серии" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent.toFixed(1)}"><span style="width:${percent.toFixed(1)}%"></span></div>
            <div class="episode-detail-actions"><button type="button" class="episode-watched-btn${state.watched ? ' is-watched' : ''}" data-action="toggle-episode-watched" data-season-number="${season}" data-episode-number="${episode}" aria-label="${state.watched ? 'Снять отметку просмотра' : 'Отметить просмотренной'}" aria-pressed="${state.watched}"${state.released ? '' : ' disabled'}>✓</button>
            <button type="button" class="episode-play-btn${state.resume || state.playing ? ' is-resume' : ''}" data-action="play-episode" data-season-number="${season}" data-episode-number="${episode}" data-timestamp="${timestamp}"${state.released ? '' : ' disabled'}>${state.playing ? '■ Смотрю' : state.resume ? '▶ Продолжить' : '▶ Смотреть'}</button></div></div></div>
            <button type="button" class="episode-detail-nav episode-detail-nav--next" data-action="navigate-browser-episode" data-direction="next" aria-label="Следующая серия" aria-disabled="${!canNext}"${canNext ? '' : ' disabled'}>›</button>
            <div class="episode-rating-slot">${this.renderEpisodeRatingControl(ep, seasonAirDate)}</div></article>`;
    }

    selectSeasonEpisode(episodeNumber, options = {}) {
        const ep = this.seasonsBrowserEpisodes?.find(item => Number(item.episodeNumber) === Number(episodeNumber));
        if (!ep) return;
        this.seasonsBrowserTouched = true;
        this.seasonsBrowserEpisode = Number(episodeNumber);
        const slot = document.getElementById('episode-detail-panel');
        if (slot) {
            slot.setAttribute('aria-labelledby', `episode-browser-tab-${Number(ep.seasonNumber)}-${Number(episodeNumber)}`);
            slot.innerHTML = this.renderSelectedEpisode(ep);
        }
        this.updateSeasonsBrowserState();
        if (options.scroll !== false) this.scrollBrowserSelectionIntoView('.episode-chart', '.episode-column.is-selected');
    }

    async navigateSeasonEpisode(direction) {
        const index = this.seasonsBrowserEpisodes?.findIndex(ep => Number(ep.episodeNumber) === this.seasonsBrowserEpisode) ?? -1;
        if (index < 0) return;
        const delta = direction === 'prev' ? -1 : 1;
        const ep = this.seasonsBrowserEpisodes[index + delta];
        if (ep) this.selectSeasonEpisode(ep.episodeNumber);
        else {
            const seasonIndex = this.seasonsBrowserSeasons.findIndex(season => season.number === this.seasonsBrowserSeason);
            const nextSeason = this.seasonsBrowserSeasons[seasonIndex + delta];
            if (!nextSeason) return;
            await this.handleSeasonPillSelect(nextSeason.number);
            if (this.seasonsBrowserEpisodes?.length && this.seasonsBrowserSeason === nextSeason.number) {
                const boundaryEpisode = delta < 0 ? this.seasonsBrowserEpisodes.at(-1) : this.seasonsBrowserEpisodes[0];
                this.selectSeasonEpisode(boundaryEpisode.episodeNumber);
            }
        }
        document.querySelector(`.episode-detail-nav[data-direction="${direction}"]`)?.focus();
    }

    scrollBrowserSelectionIntoView(containerSelector, itemSelector) {
        const container = document.querySelector(containerSelector), item = container?.querySelector(itemSelector);
        if (!container || !item) return;
        const left = item.offsetLeft - container.offsetLeft;
        if (left < container.scrollLeft || left + item.offsetWidth > container.scrollLeft + container.clientWidth) {
            container.scrollTo?.({ left: Math.max(0, left - container.clientWidth / 2 + item.offsetWidth / 2), behavior: 'smooth' });
        }
    }

    updateEpisodeChartScrollControls() {
        const chart = document.querySelector('.episode-chart');
        if (!chart) return;
        const overflows = chart.scrollWidth > chart.clientWidth + 1;
        document.querySelectorAll('.episode-chart-scroll').forEach(button => {
            button.hidden = !overflows || (button.dataset.direction === 'prev' ? chart.scrollLeft <= 1 : chart.scrollLeft + chart.clientWidth >= chart.scrollWidth - 1);
        });
    }

    handleSeasonsBrowserKeydown(event) {
        const tab = event.target?.closest?.('.season-tab, .episode-column');
        if (!tab) return;
        const parent = tab.parentElement;
        const tabs = [...parent.querySelectorAll('[role="tab"]')];
        const index = tabs.indexOf(tab);
        const next = { ArrowLeft: Math.max(0, index - 1), ArrowRight: Math.min(tabs.length - 1, index + 1), Home: 0, End: tabs.length - 1 }[event.key];
        if (next === undefined) return;
        event.preventDefault();
        const target = tabs[next];
        target?.focus();
        if (target?.classList.contains('season-tab')) void this.handleSeasonPillSelect(Number(target.dataset.seasonNumber));
        else if (target) this.selectSeasonEpisode(Number(target.dataset.episodeNumber));
    }

    updateSeasonsBrowserState() {
        const season = this.seasonsBrowserSeasons?.find(item => item.number === this.seasonsBrowserSeason);
        const episodes = this.seasonsBrowserEpisodes || [];
        document.querySelectorAll('.episode-column').forEach(column => {
            const ep = episodes.find(item => Number(item.episodeNumber) === Number(column.dataset.episodeNumber));
            if (!ep) return;
            const state = this.getBrowserEpisodeState(ep);
            const selected = Number(ep.episodeNumber) === this.seasonsBrowserEpisode;
            column.classList.toggle('is-selected', selected);
            column.setAttribute('aria-selected', String(selected));
            column.tabIndex = selected ? 0 : -1;
            for (const marker of ['watched', 'resume', 'rated', 'playing']) {
                const mark = column.querySelector(`[data-marker="${marker}"]`);
                if (mark) mark.hidden = !state[marker];
            }
        });
        document.querySelectorAll('.season-tab').forEach(tab => {
            const metadata = this.seasonsBrowserSeasons?.find(item => item.number === Number(tab.dataset.seasonNumber));
            const data = this.seasonsBrowserCache?.get(Number(tab.dataset.seasonNumber));
            const stats = this.getSeasonCompletionStats({ ...metadata, ...(data?.episodes ? { episodes: data.episodes } : {}) });
            const label = tab.querySelector('.season-tab-progress');
            if (label) label.textContent = stats.completedCount ? ` · ${stats.completedCount}/${stats.totalReleasedCount}` : '';
        });
        const ep = episodes.find(item => Number(item.episodeNumber) === this.seasonsBrowserEpisode);
        const card = document.querySelector('.episode-detail');
        if (ep && card) {
            const state = this.getBrowserEpisodeState(ep);
            const badges = card.querySelector('.episode-badges');
            if (badges) badges.innerHTML = this.renderBrowserEpisodeBadges(ep, state);
            const play = card.querySelector('[data-action="play-episode"]');
            if (play) {
                play.textContent = state.playing ? '■ Смотрю' : state.resume ? '▶ Продолжить' : '▶ Смотреть';
                play.dataset.timestamp = String(state.resume ? Number(this.currentProgressRecord?.timestamp) || 0 : 0);
                play.classList.toggle('is-resume', state.resume || state.playing);
            }
            const watched = card.querySelector('[data-action="toggle-episode-watched"]');
            if (watched) {
                watched.classList.toggle('is-watched', state.watched);
                watched.setAttribute('aria-pressed', String(state.watched));
                watched.setAttribute('aria-label', state.watched ? 'Снять отметку просмотра' : 'Отметить просмотренной');
            }
            const bar = card.querySelector('.episode-progress');
            if (bar) {
                const percent = state.resume && Number(this.currentProgressRecord?.duration) > 0
                    ? Math.min(100, Math.max(0, Number(this.currentProgressRecord.timestamp) / Number(this.currentProgressRecord.duration) * 100)) : 0;
                bar.hidden = !percent;
                bar.setAttribute('aria-valuenow', percent.toFixed(1));
                const fill = bar.querySelector('span');
                if (fill) fill.style.width = `${percent.toFixed(1)}%`;
            }
        }
        const banner = document.querySelector('.season-browser-continue');
        if (banner && season) {
            const markup = this.renderSeasonsContinueBanner(this.selectedMovie, this.currentProgressRecord, this.currentWatchTarget, this.seasonsBrowserSeasons);
            if (banner.innerHTML !== markup) banner.innerHTML = markup;
        }
        this.updateSeriesEpisodeRatingUI();
    }

    updateActiveEpisodePlayingState(selection) {
        this.seasonsBrowserPlayingSelection = selection;
        const matchesPage = selection && (!selection.kinopoiskId || Number(selection.kinopoiskId) === Number(this.selectedMovie?.kinopoiskId));
        if (matchesPage && Number(selection.seasonNumber) === this.seasonsBrowserSeason
            && Number(selection.episodeNumber) !== this.seasonsBrowserEpisode) {
            this.selectSeasonEpisode(Number(selection.episodeNumber), { scroll: false });
        } else this.updateSeasonsBrowserState();
    }

    async refreshSeasonsProgress() {
        const movie = this.selectedMovie;
        if (!movie || typeof isSeriesMedia !== 'function' || !isSeriesMedia(movie)) return;
        const pageContext = this.capturePageContext(movie);
        if (movie.kinopoiskId) {
            try {
                const [progress, history] = await Promise.all([
                    this.progressService ? this.progressService.getProgress(movie.kinopoiskId) : Promise.resolve(null),
                    this.episodeHistoryService ? this.episodeHistoryService.getHistory(movie.kinopoiskId) : Promise.resolve({})
                ]);
                if (!this.isPageContextCurrent(pageContext)) return;
                this.currentProgressRecord = progress;
                this.currentEpisodeHistory = history || {};
                this.currentWatchTarget = this.resolveWatchTarget(movie, progress);
            } catch (error) {
                if (!this.isPageContextCurrent(pageContext)) return;
                console.warn('[MovieDetails] Failed to refresh seasons progress and history:', error);
            }
        }
        this.updateSeasonsBrowserState();
        this.updateEpisodeChartScrollControls();
    }

    initSelectionPopup() {
        const textareas = [this.elements.ratingComment, this.elements.ratingReview].filter(Boolean);
        if (textareas.length === 0) return;

        let popup = null;
        let activeTextarea = null;

        const hidePopup = () => {
            if (popup) popup.style.display = 'none';
            activeTextarea = null;
        };

        const handleSelection = (textarea) => {
            const selectedText = textarea.value.substring(textarea.selectionStart, textarea.selectionEnd).trim();

            if (selectedText.length > 0 && document.activeElement === textarea) {
                activeTextarea = textarea;
                if (!popup) {
                    popup = document.createElement('div');
                    popup.className = 'selection-popup';
                    popup.innerHTML = `
                        <button class="selection-popup-btn" type="button" title="Скрыть как спойлер" aria-label="Скрыть выделенный текст как спойлер">
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                            <span>Спойлер</span>
                        </button>
                    `;
                    document.body.appendChild(popup);

                    popup.querySelector('button').addEventListener('mousedown', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        this.wrapSelectionWithSpoilerTag(activeTextarea);
                        hidePopup();
                    });
                }

                // Calculate position above selection
                const coords = this.getTextareaSelectionCoords(textarea);
                popup.style.display = 'flex';
                const halfPopupWidth = popup.offsetWidth / 2;
                const left = Math.max(
                    halfPopupWidth + 12,
                    Math.min(window.innerWidth - halfPopupWidth - 12, coords.left + coords.width / 2)
                );
                popup.style.left = `${left}px`;
                popup.style.top = `${coords.top - 45}px`;
                popup.style.transform = 'translateX(-50%)';
            } else {
                hidePopup();
            }
        };

        textareas.forEach(textarea => {
            textarea.addEventListener('mouseup', () => handleSelection(textarea));
            textarea.addEventListener('keyup', () => handleSelection(textarea));
            textarea.addEventListener('blur', () => setTimeout(hidePopup, 200));
        });
        
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

        const textareaRect = textarea.getBoundingClientRect();
        ghost.style.position = 'fixed';
        ghost.style.left = `${textareaRect.left}px`;
        ghost.style.top = `${textareaRect.top - textarea.scrollTop}px`;
        ghost.style.width = `${textareaRect.width}px`;
        ghost.style.height = 'auto';
        ghost.style.visibility = 'hidden';
        ghost.style.pointerEvents = 'none';
        ghost.style.whiteSpace = 'pre-wrap';
        ghost.style.wordBreak = 'break-word';

        const textBefore = textarea.value.substring(0, selectionStart);
        const selectedText = textarea.value.substring(selectionStart, selectionEnd);

        ghost.textContent = textBefore;
        const span = document.createElement('span');
        span.textContent = selectedText;
        ghost.appendChild(span);

        document.body.appendChild(ghost);
        const spanRect = span.getBoundingClientRect();
        
        const coords = {
            top: spanRect.top,
            left: spanRect.left,
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
        
        if (selectedText.length === 0) return false;

        const candidate = text.substring(0, start) + `||${selectedText}||` + text.substring(end);
        const maxLength = textarea === this.elements.ratingReview ? 5000 : 500;
        if (this.getRatingTextLength(candidate) > maxLength) {
            if (textarea === this.elements.ratingReview) {
                this.showRatingReviewError('Добавление спойлера превысит лимит 5000 символов.');
            } else if (typeof Utils !== 'undefined') {
                Utils.showToast('Добавление спойлера превысит лимит 500 символов', 'warning');
            }
            return false;
        }

        textarea.value = candidate;
        
        // Restore focus and selection
        textarea.focus();
        textarea.setSelectionRange(start, end + 4);
        
        // Trigger input event for character counter if any
        textarea.dispatchEvent(new Event('input'));
        return true;
    }

}

// Torrent workspace methods live in TorrentSourcePanel.js (loaded before
// this module); see that file for the ownership note.
if (typeof installMovieDetailsTorrentPanel === 'function') {
    installMovieDetailsTorrentPanel(MovieDetailsManager);
} else if (typeof window !== 'undefined' && window.document) {
    console.error('[MovieDetails] TorrentSourcePanel.js is not loaded; torrent sources are unavailable');
}
if (typeof installMovieDetailsWatchRoomPanel === 'function') {
    installMovieDetailsWatchRoomPanel(MovieDetailsManager);
} else if (typeof window !== 'undefined' && window.document) {
    console.error('[MovieDetails] WatchRoomPanel.js is not loaded; watch rooms are unavailable');
}
if (typeof installMovieDetailsMetaRenderer === 'function') {
    installMovieDetailsMetaRenderer(MovieDetailsManager);
} else if (typeof window !== 'undefined' && window.document) {
    console.error('[MovieDetails] MetaRenderer.js is not loaded; movie metadata cannot render');
}


// Initialize when DOM is loaded in browser
if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('DOMContentLoaded', () => {
        new MovieDetailsManager();
    });
}

// Alias for compatibility
if (typeof window !== 'undefined') {
    window.MovieDetailsManager = MovieDetailsManager;
}
const MEDIA_PLAYER_TORRENT_SOURCE = 'mediaplayer:torrent';
// Episode picker: long seasons are browsed in ranges and searchable by number.
const PICKER_EPISODE_RANGE_SIZE = 100;
const PICKER_EPISODE_SEARCH_MIN_COUNT = 24;
