(function(global) {
    'use strict';
    const methods = {
        async initializeWatchEntry() {
            this.proPlayerEnabled = await global.ProPlayerPreferences?.isEnabled() === true;
            const before = global.document?.getElementById('minimizeVideoBtn');
            const host = before?.parentElement;
            if (host && global.PlayerDiagnosticsPanel) this.playerDiagnosticsPanel ||= new global.PlayerDiagnosticsPanel({
                host, before, playerHost: this.elements?.videoContainer
            });
            this.watchLocaleUnsubscribe?.();
            this.watchLocaleUnsubscribe = global.PlayerLocale?.subscribe(() => {
                this.syncWatchEntry();
                this.refreshSourceButtonStates?.();
                global.PlayerSourceLifecycle?.localize?.(this.elements?.videoContainer);
            });
            this.watchFlagUnsubscribe?.();
            this.watchFlagUnsubscribe = global.ProPlayerPreferences?.subscribe(enabled => {
                this.proPlayerEnabled = enabled;
                if (!enabled) this.watchSourceRun = null;
                this.populateSourceSelector();
            });
            if (!this.watchEntryPageCleanup) {
                this.watchEntryPageCleanup = () => {
                    this.watchFlagUnsubscribe?.();
                    this.watchLocaleUnsubscribe?.();
                    this.watchEntryController?.destroy();
                    this.watchEntryController = null;
                    this.watchSourceRun = null;
                    this.playerMetricsDispose?.();
                    this.playerDiagnosticsPanel?.destroy();
                    this.playerDiagnosticsPanel = null;
                    this.sourceRefreshCoordinator?.invalidate();
                };
                global.addEventListener('pagehide', this.watchEntryPageCleanup);
                global.addEventListener('pageshow', event => { if (event.persisted) void this.initializeWatchEntry().then(() => this.populateSourceSelector()); });
            }
        },
        syncWatchEntry() {
            const container = this.elements?.sourceButtonsContainer;
            if (!container) return;
            if (this.watchRoomController?.room) this.elements?.videoContainer?.querySelector('[data-action="try-other"]')?.remove();
            if (!this.proPlayerEnabled) {
                this.watchEntryController?.destroy();
                this.watchEntryController = null;
                return;
            }
            this.watchEntryController ||= new global.WatchEntryController({
                container,
                onWatch: async value => {
                    if (value && this.getWatchInnerValues().includes(value)) this.activeSourceValue = value;
                    await this.handleWatchClick();
                },
                onTorrent: () => this.openTorrentPicker()
            });
            this.watchEntryController.sync(this.activeSourceValue, {
                torrentEligible: Boolean(this.mediaPlayerReady && this.isTorrentMovie()), busy: Boolean(this.watchSearching),
                sourceLocked: Boolean(this.watchRoomController?.room && !['owner', 'controller'].includes(this.watchRoomController.role))
            });
        },
        getWatchInnerValues() {
            return [...(this.elements?.sourceButtonsContainer?.querySelectorAll('.source-btn') || [])]
                .map(button => button.dataset.value).filter(value => value && value !== 'mediaplayer:torrent');
        },
        getWatchRankOptions() {
            const movie = this.selectedMovie;
            return { anime: Boolean(global.MediaClassifier?.isAnime?.(movie)
                || /^anime/.test(movie?.type || '')
                || movie?.genres?.some(genre => /^(аниме|anime)$/i.test(typeof genre === 'string' ? genre : genre?.name || genre?.genre || ''))),
            film: this.isTorrentMovie() };
        },
        async resolveWatchSource() {
            const movieId = this.selectedMovie?.kinopoiskId;
            const generation = this.sourceSwitchRequestId;
            const [preference, last] = await Promise.all([
                global.WatchSourcePolicy.read(movieId), this.getLastSource(movieId)
            ]);
            if (this.selectedMovie?.kinopoiskId !== movieId || this.sourceSwitchRequestId !== generation) return null;
            const room = this.watchRoomController?.room && this.watchRoomController.activeProviderHint;
            return global.WatchSourcePolicy.select(this.getWatchInnerValues(), {
                room: room ? `parser:${room}` : null, explicit: this.activeSourceValue,
                preference, last, anime: this.getWatchRankOptions().anime
            });
        },
        getPlayerCapabilitySnapshot() {
            const providerId = this.playbackController?.getActiveProvider?.() || this.activePlayerId;
            return global.ProviderCapabilities?.describe({ providerId,
                adapter: this.playbackController?.getAdapter?.(providerId), parser: this.parserRegistry?.get?.(providerId),
                selection: this.playbackController?.getSelection?.(), readiness: this.elements?.videoContainer?.dataset?.sourceState
            });
        },
        observePlayerMetrics(state, { requestId, parserId = null, reason = state } = {}) {
            const attempt = this.playerMetricsAttempt;
            if (!global.PlayerMetrics || !attempt || attempt.requestId !== requestId || !this.isSourceSwitchRequestCurrent(requestId)) return;
            const providerId = parserId || attempt.providerId;
            const video = this.elements?.videoContainer?.querySelector('video');
            if (video && !attempt.attached) {
                attempt.attached = true;
                const selection = this.playbackController?.getSelection?.();
                const identity = current => current ? `${current.kinopoiskId}:${current.seasonNumber ?? ''}:${current.episodeNumber ?? ''}` : '';
                const captured = identity(selection);
                this.playerMetricsDispose = global.PlayerMetrics.attach(video, {
                    providerId, startAt: attempt.startAt, isCurrent: () => this.isSourceSwitchRequestCurrent(requestId)
                        && captured === identity(this.playbackController?.getSelection?.())
                });
            }
            if (!['ready', 'error', 'unavailable'].includes(state) || attempt.complete) return;
            attempt.complete = true;
            void global.PlayerMetrics.record(state === 'ready' ? 'resolveOk' : 'resolveFail', { providerId, reason });
            if (!video) void global.PlayerMetrics.record('ttff', { providerId });
        },
        async refreshExpiredWatchSource({ parserId, movieId, requestId, status, resource }) {
            const selection = this.playbackController?.getSelection?.();
            const generation = this.sourceRefreshGeneration;
            const owned = { requestId };
            const captured = selection && { kinopoiskId: String(selection.kinopoiskId),
                season: selection.seasonNumber ?? null, episode: selection.episodeNumber ?? null };
            const matches = current => current && captured && String(current.kinopoiskId) === captured.kinopoiskId
                && (current.seasonNumber ?? null) === captured.season && (current.episodeNumber ?? null) === captured.episode;
            const isCurrent = () => generation === this.sourceRefreshGeneration
                && !this.watchRoomController?.room
                && this.isSourceSwitchRequestCurrent(owned.requestId, movieId)
                && matches(this.playbackController?.getSelection?.());
            if (!selection || !isCurrent() || this.watchRoomController?.room || !global.SourceRefreshCoordinator) return false;
            this.sourceRefreshCoordinator ||= new global.SourceRefreshCoordinator();
            const result = await this.sourceRefreshCoordinator.run({
                identity: { titleId: String(movieId), providerId: parserId,
                    season: captured.season, episode: captured.episode, requestId, attemptId: generation ?? requestId },
                status, resource, isCurrent, manual: this.manualRefreshRequestId === requestId,
                refresh: async ({ isCurrent: tokenCurrent }) => {
                    if (!tokenCurrent()) return false;
                    const runtime = this.playbackController?.getRuntimeState?.();
                    if (runtime?.progressConfidence === 'RELIABLE' && matches(runtime.mediaIdentity) && Number.isFinite(runtime.currentTime)) {
                        this.playbackController.updateSelection({ initialTimestamp: runtime.currentTime });
                    }
                    const pending = this.forceResearchSources(`parser:${parserId}`, parserId);
                    owned.requestId = this.sourceSwitchRequestId;
                    return pending;
                }
            });
            return result.recovered;
        },
        async handleWatchSourceFailure(value, requestId, reason = 'error') {
            const run = this.watchSourceRun;
            if (!this.proPlayerEnabled || !run || run.switching || run.manual || reason === 'timeout'
                || this.watchRoomController?.room || run.movieId !== String(this.selectedMovie?.kinopoiskId)
                || !this.isSourceSwitchRequestCurrent(requestId) || this.activeSourceValue !== value
                || run.failed.has(requestId)) return false;
            run.failed.add(requestId);
            run.attempted.add(value);
            run.switching = true;
            try {
                let expectedRequest = requestId;
                while (this.watchSourceRun === run && !run.manual && !this.watchRoomController?.room
                    && this.isSourceSwitchRequestCurrent(expectedRequest)) {
                    const next = global.WatchSourcePolicy.rank(this.getWatchInnerValues(), this.getWatchRankOptions())
                        .find(candidate => !run.attempted.has(candidate));
                    if (!next) return false;
                    void global.PlayerMetrics?.record('fallback', { providerId: global.PlayerDiagnostics?.safeSourceId(value) || 'unknown', reason });
                    const selection = this.playbackController?.getSelection?.();
                    const runtime = this.playbackController?.getRuntimeState?.();
                    const identity = runtime?.mediaIdentity;
                    if (runtime?.progressConfidence === 'RELIABLE' && identity && selection
                        && String(identity.kinopoiskId) === String(selection.kinopoiskId)
                        && identity.seasonNumber === selection.seasonNumber && identity.episodeNumber === selection.episodeNumber
                        && Number.isFinite(runtime.currentTime) && runtime.currentTime > 0) {
                        this.playbackController.updateSelection({ initialTimestamp: runtime.currentTime });
                    }
                    const changed = await this.changeVideoSource(next);
                    expectedRequest = run.requestId;
                    if (changed) return true;
                }
                return false;
            } finally { run.switching = false; }
        },
        tryOtherWatchSource() {
            if (!this.proPlayerEnabled || this.watchRoomController?.room) return;
            const run = global.WatchSourcePolicy.createRun(this.selectedMovie?.kinopoiskId);
            this.watchSourceRun = run;
            void this.handleWatchSourceFailure(this.activeSourceValue, this.sourceSwitchRequestId, 'explicit-alternative');
        }
    };
    global.installMovieDetailsWatchEntry = Manager => {
        const watch = Manager.prototype.handleWatchClick;
        Object.assign(Manager.prototype, methods);
        Manager.prototype.handleWatchClick = async function(...args) {
            if (!this.proPlayerEnabled) return watch.apply(this, args);
            if (this.watchActivationPending) return false;
            this.watchActivationPending = true;
            try { return await watch.apply(this, args); }
            finally {
                this.watchActivationPending = false;
                this.watchSearching = false;
                this.syncWatchEntry();
            }
        };
    };
    global.MovieDetailsWatchEntryMethods = methods;
})(typeof window !== 'undefined' ? window : globalThis);
