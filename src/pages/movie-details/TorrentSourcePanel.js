/**
 * Torrent source workspace for MovieDetails: the MediaPlayer picker,
 * source ranking/filters, saved downloads library, and torrent playback
 * status/session.
 *
 * Strangler step (plan 2026-10-04, 6.4): the methods were moved here
 * verbatim and are installed onto MovieDetailsManager.prototype, so they
 * still read and write MovieDetails state through `this`. Turning this
 * into a standalone component with its own state is the next step.
 */

// Must match MEDIA_PLAYER_TORRENT_SOURCE in movie-details.js.
const MOVIE_DETAILS_TORRENT_SOURCE = 'mediaplayer:torrent';

class MovieDetailsTorrentPanelMethods {
    setTorrentSourceStatus(message, state = '') {
        const status = this.elements?.torrentSourceStatus;
        if (!status) return;
        status.textContent = message || '';
        if (state) status.setAttribute('data-state', state);
        else status.removeAttribute('data-state');
    }

    formatTorrentBytes(value) {
        const bytes = Number(value);
        if (!Number.isFinite(bytes) || bytes < 0) return '—';
        if (bytes < 1024) return `${Math.round(bytes)} Б`;
        const units = ['КБ', 'МБ', 'ГБ', 'ТБ'];
        let amount = bytes;
        let unitIndex = -1;
        do {
            amount /= 1024;
            unitIndex += 1;
        } while (amount >= 1024 && unitIndex < units.length - 1);
        return `${amount.toFixed(amount >= 10 ? 0 : 1)} ${units[unitIndex]}`;
    }

    formatTorrentRate(value) {
        const rate = Number(value);
        return Number.isFinite(rate) && rate > 0 ? `${this.formatTorrentBytes(rate)}/с` : '0 Б/с';
    }

    getTorrentServiceUnavailableMessage() {
        return 'MediaPlayer недоступен. Перезапустите службу и повторите проверку.';
    }

    formatTorrentError(error) {
        if (error?.code === 'tmdb_id_missing') return 'Для этого фильма не найден TMDB ID.';
        if (error?.code === 'torrent_not_configured') return 'Торрент-провайдеры MediaPlayer ещё не настроены.';
        if (error?.code === 'native_host_unavailable') return 'MediaPlayer не подключён. Проверьте установку Native Host.';
        if (error?.code === 'native_host_timeout') return 'Native Host MediaPlayer не ответил. Перезапустите MediaPlayer и обновите страницу.';
        if (error?.code === 'sources_unavailable') return 'Индексеры MediaPlayer временно недоступны.';
        if (error?.code === 'source_search_limit') return 'Слишком много одновременных поисков раздач.';
        if (error?.code === 'source_search_not_found') return 'Задание поиска устарело. Повторите поиск.';
        if (error?.code === 'connection_failed' || error?.code === 'timeout') {
            return this.getTorrentServiceUnavailableMessage();
        }
        return error?.message || 'Не удалось получить торрент-раздачи.';
    }

    isTorrentRequestCurrent(requestId, movie) {
        return requestId === this.torrentRequestId && this.selectedMovie === movie;
    }

    focusTorrentRegion(target) {
        const body = target?.closest?.('.video-body');
        if (!body || target.hidden) return;
        target.focus?.({ preventScroll: true });
        const bounds = target.getBoundingClientRect();
        const viewport = body.getBoundingClientRect();
        body.scrollTop += bounds.top - viewport.top - 10;
    }

    async openTorrentPicker() {
        const panel = this.elements?.torrentSourcePanel;
        const movie = this.selectedMovie;
        if (!panel || !movie) return false;
        this.clearTorrentFileSelection(false);

        if (!(await this.refreshMediaPlayerReadiness())) {
            panel.hidden = true;
            this.setTorrentSourceStatus('Включите и проверьте MediaPlayer в настройках расширения.', 'error');
            return false;
        }

        const movieKey = this.getTorrentMovieKey(movie);
        if (this.torrentActiveContext && this.torrentActiveContext.movieKey !== movieKey) {
            this.torrentActiveContext = null;
            this.torrentHasPlaybackSnapshot = false;
            this.latestTorrentPlaybackProgress = { state: 'starting' };
        }
        panel.hidden = false;
        const workspaceButton = document.getElementById('torrentWorkspaceBtn');
        if (workspaceButton) workspaceButton.hidden = false;
        this.focusTorrentRegion(panel);
        this.updateActiveSourceButton(MOVIE_DETAILS_TORRENT_SOURCE);
        const requestId = ++this.torrentRequestId;
        this.stopTorrentDownloadMonitoring();
        this.torrentSources = [];
        this.torrentDownloads = [];
        this.torrentVisibleSourceLimit = 10;
        this.torrentSearchState = { status: 'idle', found: 0 };
        this.torrentSort = 'recommended';
        this.torrentQualityFilter = 'all';
        this.torrentLanguageFilter = 'all';
        this.elements.torrentSourceControls?.querySelectorAll('[data-quality-filter]').forEach((item) => {
            item.classList.toggle('is-active', item.getAttribute('data-quality-filter') === 'all');
        });
        if (this.elements.torrentSourceSort) this.elements.torrentSourceSort.value = 'recommended';
        this.torrentSortControl?.syncFromNative();
        if (this.elements.torrentSourceLanguageFilter) this.elements.torrentSourceLanguageFilter.value = 'all';
        this.torrentSourceLanguageControl?.syncFromNative();
        const qualityChoices = this.elements?.torrentSourceControls?.querySelector('.torrent-source-controls__filters');
        window.FilterChoice?.syncSingleGroup(qualityChoices, {
            value: this.torrentQualityFilter || 'all', attribute: 'data-quality-filter', selector: '[data-quality-filter]'
        });
        this.elements.torrentSourceList?.replaceChildren();
        this.elements.torrentDownloadList?.replaceChildren();
        this.elements.torrentDownloadLibrary?.setAttribute('hidden', '');
        if (this.elements.torrentSourceDisclosure) {
            this.elements.torrentSourceDisclosure.hidden = true;
            this.elements.torrentSourceDisclosure.open = false;
        }
        this.setTorrentSourceControlsVisible(false);
        this.cancelActiveTorrentSearch();
        this.setTorrentSourceStatus('Проверяем локальный MediaPlayer…');

        if (!this.isTorrentAvailable(movie)) {
            this.setTorrentSourceStatus('Для просмотра сериалов обновите MediaPlayer и проверьте подключение в настройках.', 'error');
            return false;
        }
        if (!this.mediaPlayerService) {
            this.setTorrentSourceStatus('Клиент MediaPlayer не загружен. Обновите страницу расширения.', 'error');
            return false;
        }

        try {
            const capabilities = await this.mediaPlayerService.getCapabilities();
            if (!this.isTorrentRequestCurrent(requestId, movie)) return false;
            const moviesCapability = this.isTorrentMovie(movie)
                ? capabilities?.torrents?.movies : capabilities?.torrents?.television;
            if (moviesCapability?.supported === false || moviesCapability?.status !== 'ready') {
                throw new MediaPlayerServiceError(
                    'torrent_not_configured',
                    'Торрент-провайдеры MediaPlayer ещё не настроены.'
                );
            }

            await this.refreshTorrentDownloads(movie, requestId);
            if (!this.isTorrentRequestCurrent(requestId, movie)) return false;
            this.ensureTorrentActiveContextFromDownloads(movie);
            this.startTorrentDownloadMonitoring(movie, requestId);
            this.setTorrentSourceControlsVisible(true);

            if (this.torrentActiveContext && !this.torrentPlaybackSession) {
                this.renderTorrentPlaybackStatus(this.getTorrentProgressFromDownload(this.getTorrentActiveDownload()));
            } else if (this.torrentPlaybackSession) {
                this.renderTorrentPlaybackStatus();
            }

            if (this.torrentDownloads.length > 0) {
                this.setTorrentSourceStatus(this.getTorrentDownloadSummary());
                return true;
            }
            return await this.searchTorrentSources(requestId);
        } catch (error) {
            if (!this.isTorrentRequestCurrent(requestId, movie)) return false;
            this.setTorrentSourceStatus(this.formatTorrentError(error), 'error');
            return false;
        }
    }

    setTorrentSourceControlsVisible(visible) {
        const controls = this.elements?.torrentSourceControls;
        if (controls) controls.hidden = !visible;
        if (this.elements?.torrentSourceSearchBtn) this.elements.torrentSourceSearchBtn.hidden = !visible;
    }

    cancelActiveTorrentSearch() {
        const jobId = this.torrentSearchJobId;
        const tmdbId = this.torrentSearchTmdbId;
        const mediaType = this.torrentSearchMediaType;
        this.torrentSearchJobId = null;
        this.torrentSearchTmdbId = null;
        if (jobId) void this.mediaPlayerService?.cancelMovieSourceSearch(jobId, tmdbId, mediaType).catch(() => undefined);
    }

    async searchTorrentSources(requestId = null) {
        const movie = this.selectedMovie;
        if (!movie || !this.mediaPlayerService) return false;
        const activeRequestId = requestId === null ? ++this.torrentRequestId : requestId;
        this.clearTorrentFileSelection(false);
        if (!this.isTorrentRequestCurrent(activeRequestId, movie)) return false;
        this.startTorrentDownloadMonitoring(movie, activeRequestId);
        this.cancelActiveTorrentSearch();
        this.torrentSources = [];
        this.torrentVisibleSourceLimit = 10;
        this.torrentSearchState = { status: 'running', found: 0 };
        if (this.elements.torrentSourceDisclosure) this.elements.torrentSourceDisclosure.open = true;
        this.elements.torrentSourceList?.replaceChildren();
        if (this.elements.torrentSourceDisclosure) this.elements.torrentSourceDisclosure.hidden = true;
        if (this.elements?.torrentSourceSearchBtn) this.elements.torrentSourceSearchBtn.disabled = true;
        this.setTorrentSourceStatus('Ищем раздачи…');

        const searchArgs = {
            ...this.getTorrentPlaybackIdentity(movie),
            tmdbId: this.getMediaPlayerTmdbId(movie),
            title: movie.name || movie.nameRu || movie.alternativeName,
            originalTitle: movie.nameEn || movie.originalTitle || movie.alternativeName,
            year: movie.year
        };

        try {
            const searchResult = await this.mediaPlayerService.searchMovieSourcesIncrementally(searchArgs, {
                pollIntervalMs: 350,
                onStart: (job) => {
                    if (!this.isTorrentRequestCurrent(activeRequestId, movie)) {
                        void this.mediaPlayerService.cancelMovieSourceSearch(job.jobId, searchArgs.tmdbId, searchArgs.mediaType).catch(() => undefined);
                        return;
                    }
                    this.torrentSearchJobId = job.jobId;
                    this.torrentSearchTmdbId = searchArgs.tmdbId;
                    this.torrentSearchMediaType = searchArgs.mediaType;
                },
                onBatch: (_batch, state) => {
                    if (!this.isTorrentRequestCurrent(activeRequestId, movie)) return;
                    const sources = this.deduplicateTorrentSources(
                        Array.isArray(state?.sources) ? state.sources : [],
                    );
                    this.torrentSources = sources;
                    this.torrentSearchState = {
                        status: state?.status === 'running' ? 'running' : 'completed',
                        found: sources.length
                    };
                    this.renderTorrentSources(sources);
                }
            });
            if (!this.isTorrentRequestCurrent(activeRequestId, movie)) return false;
            this.torrentSources = this.deduplicateTorrentSources(
                Array.isArray(searchResult?.sources) ? searchResult.sources : [],
            );
            this.torrentSearchState = {
                status: 'completed',
                found: this.torrentSources.length
            };
            this.renderTorrentSources(this.torrentSources);
            return true;
        } catch (error) {
            if (!this.isTorrentRequestCurrent(activeRequestId, movie)) return false;
            this.torrentSources = [];
            this.torrentSearchState = { status: 'error', found: 0 };
            this.renderTorrentSources([]);
            this.setTorrentSourceStatus(this.formatTorrentError(error), 'error');
            return false;
        } finally {
            if (this.isTorrentRequestCurrent(activeRequestId, movie)) {
                this.torrentSearchJobId = null;
                this.torrentSearchTmdbId = null;
                if (this.elements?.torrentSourceSearchBtn) this.elements.torrentSourceSearchBtn.disabled = false;
            }
        }
    }

    closeTorrentPicker() {
        this.clearTorrentFileSelection(false);
        if (this.elements?.torrentSourcePanel) this.elements.torrentSourcePanel.hidden = true;
        const workspaceButton = document.getElementById('torrentWorkspaceBtn');
        if (workspaceButton) workspaceButton.hidden = true;
        this.focusTorrentRegion(this.elements?.videoContainer);
        this.stopTorrentDownloadMonitoring();
        this.cancelActiveTorrentSearch();
        this.torrentRequestId += 1;
    }

    normalizeTorrentLanguage(value) {
        const text = String(
            value && typeof value === 'object'
                ? (value.code || value.language || value.name || value.label || '')
                : value || '',
        ).trim().toLowerCase();
        if (!text) return null;
        if (/^(?:ru|rus|russian|рус|русс|русский|русская|русское)/i.test(text)) return 'ru';
        if (/^(?:en|eng|english|англ|английский|английская)/i.test(text)) return 'en';
        return null;
    }

    getTorrentLanguageValues(value) {
        const values = Array.isArray(value)
            ? value
            : typeof value === 'string'
                ? value.split(/[,;/|]+/)
                : value
                    ? [value]
                    : [];
        return [...new Set(values.map(item => this.normalizeTorrentLanguage(item)).filter(Boolean))];
    }

    hasTorrentToken(value, tokens = []) {
        const normalized = this.normalizeTorrentText(value);
        return tokens.some(token => new RegExp(`(^|[^A-ZА-ЯЁ0-9])${token}(?=$|[^A-ZА-ЯЁ0-9])`, 'i').test(normalized));
    }

    normalizeTorrentText(value) {
        return String(value || '')
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .toUpperCase()
            .replace(/\[/g, ' ')
            .replace(/\]/g, ' ')
            .replace(/[(){},]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    hasTorrentSubtitleContext(value, start, end) {
        const before = value.slice(Math.max(0, start - 18), start);
        if (this.hasTorrentToken(before, ['SUB', 'SUBS', 'SUBBED', 'SUBTITLE', 'SUBTITLES', 'СУБТИТР'])) {
            return true;
        }
        const after = value.slice(end, Math.min(value.length, end + 16));
        return /^\s*[._-]\s*(?:SUB|SUBS|SUBBED|SUBTITLE|SUBTITLES)(?:\b|[._-])/.test(after);
    }

    hasTorrentAudioToken(value, tokens = []) {
        const normalized = this.normalizeTorrentText(value);
        return tokens.some(token => {
            const escaped = String(token).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const pattern = new RegExp(`(^|[^A-ZА-ЯЁ0-9])${escaped}(?=$|[^A-ZА-ЯЁ0-9])`, 'gi');
            for (const match of normalized.matchAll(pattern)) {
                const start = (match.index || 0) + match[1].length;
                const end = start + String(token).length;
                if (!this.hasTorrentSubtitleContext(normalized, start, end)) return true;
            }
            return false;
        });
    }

    getTorrentSourceLanguages(source = {}) {
        const declaredAudio = this.getTorrentLanguageValues(source.audioLanguages);
        const declaredLanguage = this.normalizeTorrentLanguage(source.language);
        if (declaredLanguage && !declaredAudio.includes(declaredLanguage)) declaredAudio.push(declaredLanguage);

        const text = `${source.quality || ''} ${source.title || ''}`;
        const inferredAudio = [];
        if (this.hasTorrentAudioToken(text, ['RUS', 'RUSSIAN', 'РУС', 'РУССК', 'РУССИЙ', 'РУССКАЯ'])) inferredAudio.push('ru');
        if (this.hasTorrentAudioToken(text, ['ENG', 'ENGLISH', 'АНГЛ', 'АНГЛИЙСК'])) inferredAudio.push('en');
        if (this.hasTorrentToken(text, [
            'DUB',
            'DUBBED',
            'MVO',
            'HDREZKA',
            'PARAGRAPH MEDIA',
            'LOSTFILM',
            'NEWSTUDIO',
            'TVSHOW',
            'JASKIER',
            'КУБИК В КУБЕ',
            'ДВОЙНАЯ ОЗВУЧКА',
            'МНОГОГОЛОСАЯ'
        ])) inferredAudio.push('ru');

        const audioLanguages = [...new Set([...declaredAudio, ...inferredAudio])];
        const subtitleLanguages = this.getTorrentLanguageValues(source.subtitleLanguages);
        const confidence = source.languageConfidence === 'declared' || declaredAudio.length
            ? 'declared'
            : audioLanguages.length
                ? 'title'
                : 'unknown';
        return { audioLanguages, subtitleLanguages, confidence };
    }

    getTorrentQualityDetails(source = {}) {
        const supplied = source.qualityDetails;
        if (supplied && typeof supplied === 'object') {
            const score = Number(supplied.score);
            const resolution = supplied.resolution === null || supplied.resolution === undefined || supplied.resolution === ''
                ? NaN
                : Number(supplied.resolution);
            if (Number.isFinite(score) || (Number.isFinite(resolution) && resolution > 0)) {
                return {
                    ...supplied,
                    score: Number.isFinite(score) ? score : 0,
                    resolution: Number.isFinite(resolution) && resolution > 0 ? resolution : null,
                    label: String(supplied.label || source.quality || 'Качество не указано')
                };
            }
        }

        const text = `${source.quality || ''} ${source.title || ''}`
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .toUpperCase();
        const resolution = this.hasTorrentToken(text, ['2160P', '4K', 'UHD']) ? 2160
            : this.hasTorrentToken(text, ['1440P', '2K', 'QHD']) ? 1440
                : this.hasTorrentToken(text, ['1080P', 'FHD']) ? 1080
                    : this.hasTorrentToken(text, ['720P', 'HD']) ? 720
                        : this.hasTorrentToken(text, ['576P', '576']) ? 576
                            : this.hasTorrentToken(text, ['480P', '480', 'SD']) ? 480
                                : null;
        const releaseSource = this.hasTorrentToken(text, ['REMUX']) ? 'remux'
            : this.hasTorrentToken(text, ['BLURAY', 'BLU-RAY']) ? 'bluray'
                : this.hasTorrentToken(text, ['WEB-DL', 'WEBDL']) ? 'web-dl'
                    : this.hasTorrentToken(text, ['WEBRIP', 'WEB-RIP']) ? 'webrip'
                        : this.hasTorrentToken(text, ['BDRIP', 'BD-RIP']) ? 'bdrip'
                            : this.hasTorrentToken(text, ['HDRIP', 'HD-RIP']) ? 'hdrip'
                                : this.hasTorrentToken(text, ['DVDRIP', 'DVD-RIP']) ? 'dvdrip'
                                    : this.hasTorrentToken(text, ['CAM', 'CAMRIP', 'TS', 'TELESYNC', 'TC']) ? 'cam'
                                        : 'unknown';
        const codec = this.hasTorrentToken(text, ['HEVC', 'H265', 'X265']) ? 'hevc'
            : this.hasTorrentToken(text, ['AV1']) ? 'av1'
                : this.hasTorrentToken(text, ['VP9']) ? 'vp9'
                    : this.hasTorrentToken(text, ['H264', 'H.264', 'AVC', 'X264']) ? 'h264'
                        : 'unknown';
        const resolutionScore = { 2160: 40, 1440: 32, 1080: 28, 720: 18, 576: 10, 480: 8 };
        const sourceScore = { remux: 30, bluray: 27, 'web-dl': 25, webrip: 20, bdrip: 19, hdrip: 14, dvdrip: 8, cam: 0, unknown: 4 };
        const codecScore = { hevc: 4, av1: 4, vp9: 3, h264: 2, unknown: 0 };
        const labelSource = { remux: 'Remux', bluray: 'BluRay', 'web-dl': 'WEB-DL', webrip: 'WEBRip', bdrip: 'BDRip', hdrip: 'HDRip', dvdrip: 'DVDRip', cam: 'CAM/TS', unknown: '' };
        const label = [resolution ? `${resolution}p` : null, labelSource[releaseSource] || null, codec === 'unknown' ? null : codec.toUpperCase()]
            .filter(Boolean)
            .join(' · ');
        return {
            resolution,
            source: releaseSource,
            codec,
            score: (resolution ? resolutionScore[resolution] : 0) + sourceScore[releaseSource] + codecScore[codec],
            label: label || String(source.quality || 'Качество не указано')
        };
    }

    getTorrentQualityRank(source = {}) {
        const resolution = this.getTorrentQualityDetails(source).resolution;
        if (resolution >= 2160) return 4;
        if (resolution >= 1440) return 3;
        if (resolution >= 1080) return 2;
        if (resolution >= 720) return 1;
        if (resolution >= 480) return 0;
        return -1;
    }

    getTorrentQualityBucket(source = {}) {
        const rank = this.getTorrentQualityRank(source);
        return rank === 4 ? '4k' : rank === 3 ? '2k' : rank === 2 ? '1080p' : rank === 1 ? '720p' : rank === 0 ? 'sd' : 'unknown';
    }

    getTorrentNumber(value, fallback = -1) {
        const number = Number(value);
        return Number.isFinite(number) && number >= 0 ? number : fallback;
    }

    getTorrentSourceIdentity(source = {}) {
        const normalize = (value) => String(value ?? '')
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/ё/g, 'е')
            .replace(/[^\p{L}\p{N}]+/gu, ' ')
            .trim()
            .replace(/\s+/g, ' ');

        return [
            normalize(source.title),
            normalize(source.quality),
            this.formatTorrentBytes(source.sizeBytes),
        ].join('\u0000');
    }

    deduplicateTorrentSources(sources = []) {
        const input = Array.isArray(sources) ? sources : [];
        const unique = input.slice(0, 0);
        const byIdentity = new Map();
        for (const source of input) {
            if (!source || this.getTorrentNumber(source.seeders, 0) <= 0) continue;
            const identity = this.getTorrentSourceIdentity(source);
            const existing = byIdentity.get(identity);
            if (!existing || this.compareTorrentSources(source, existing) < 0) {
                byIdentity.set(identity, source);
            }
        }
        unique.push(...byIdentity.values());
        return unique;
    }

    compareTorrentSources(first = {}, second = {}) {
        const firstSeeders = this.getTorrentNumber(first.seeders);
        const secondSeeders = this.getTorrentNumber(second.seeders);
        const firstQualityScore = this.getTorrentQualityDetails(first).score;
        const secondQualityScore = this.getTorrentQualityDetails(second).score;
        const firstSize = this.getTorrentNumber(first.sizeBytes, Number.MAX_SAFE_INTEGER);
        const secondSize = this.getTorrentNumber(second.sizeBytes, Number.MAX_SAFE_INTEGER);
        const sort = this.torrentSort;
        let difference;

        if (sort === 'quality') difference = secondQualityScore - firstQualityScore;
        else if (sort === 'size-asc') difference = firstSize - secondSize;
        else if (sort === 'size-desc') difference = secondSize - firstSize;
        else if (sort === 'recommended') {
            const firstLanguages = this.getTorrentSourceLanguages(first);
            const secondLanguages = this.getTorrentSourceLanguages(second);
            const firstRecommended = firstQualityScore * 100
                + (firstLanguages.audioLanguages.length ? 3 : 0)
                + (firstLanguages.confidence === 'declared' ? 2 : 0)
                + Math.min(firstSeeders, 100);
            const secondRecommended = secondQualityScore * 100
                + (secondLanguages.audioLanguages.length ? 3 : 0)
                + (secondLanguages.confidence === 'declared' ? 2 : 0)
                + Math.min(secondSeeders, 100);
            difference = secondRecommended - firstRecommended;
        } else difference = secondSeeders - firstSeeders;
        if (difference) return difference;

        difference = secondSeeders - firstSeeders;
        if (difference) return difference;
        difference = secondQualityScore - firstQualityScore;
        if (difference) return difference;
        difference = firstSize - secondSize;
        if (difference) return difference;
        difference = String(first.provider || '').localeCompare(String(second.provider || ''), 'ru', { sensitivity: 'base' });
        if (difference) return difference;
        difference = String(first.title || '').localeCompare(String(second.title || ''), 'ru', { sensitivity: 'base' });
        return difference || String(first.sourceId || '').localeCompare(String(second.sourceId || ''));
    }

    getVisibleTorrentSources(sources = this.torrentSources) {
        const qualityFilter = this.torrentQualityFilter || 'all';
        const languageFilter = this.torrentLanguageFilter || 'all';
        return this.deduplicateTorrentSources(sources)
            .filter(source => qualityFilter === 'all' || this.getTorrentQualityBucket(source) === qualityFilter)
            .filter(source => this.hasRequestedTorrentLanguage(source, languageFilter))
            .slice()
            .sort((first, second) => this.compareTorrentSources(first, second));
    }

    hasRequestedTorrentLanguage(source = {}, filter = 'all') {
        if (filter === 'all') return true;
        const languages = new Set(this.getTorrentSourceLanguages(source).audioLanguages);
        if (filter === 'unknown') return languages.size === 0;
        if (filter === 'bilingual') return languages.has('ru') && languages.has('en');
        return languages.has(filter);
    }

    getTorrentSourceLanguageLabel(source = {}) {
        const metadata = this.getTorrentSourceLanguages(source);
        const languages = new Set(metadata.audioLanguages);
        if (languages.has('ru') && languages.has('en')) return 'RU + EN';
        if (languages.has('ru')) return 'RU';
        if (languages.has('en')) return 'EN';
        if (metadata.subtitleLanguages.length) return 'Субтитры';
        return 'Язык не указан';
    }

    getTorrentMovieKey(movie = this.selectedMovie) {
        if (!movie) return '';
        const id = String(this.getMediaPlayerTmdbId(movie) || movie.kinopoiskId || movie.id || '');
        return this.isTorrentMovie(movie) ? id : `tv:${id}`;
    }

    getTorrentPlaybackIdentity(movie = this.selectedMovie) {
        const mediaType = this.isTorrentMovie(movie) ? 'movie' : 'tv';
        const selection = this.playbackController?.getSelection?.();
        return { mediaType, tmdbId: this.getMediaPlayerTmdbId(movie),
            title: movie?.name || movie?.nameRu || movie?.alternativeName,
            year: movie?.year,
            ...(mediaType === 'tv' ? { seasonNumber: selection?.seasonNumber ?? undefined,
                episodeNumber: selection?.episodeNumber ?? undefined } : {}) };
    }

    clearTorrentFileSelection(restoreFocus = true) {
        this.torrentPlaybackGeneration = (this.torrentPlaybackGeneration || 0) + 1;
        this.torrentPreparedSource = null;
        const picker = this.elements?.torrentSourcePanel?.querySelector('#torrentFilePicker');
        if (picker) picker.hidden = true;
        this.elements?.torrentSourceList?.querySelectorAll('.torrent-source-card__select').forEach(button => { button.disabled = false; });
        if (restoreFocus) {
            this.setTorrentSourceStatus('Выберите раздачу.');
            this.elements?.torrentSourceList?.querySelector('.torrent-source-card__select')?.focus();
        }
    }

    showTorrentFileSelection(sourceId, files = [], identity = this.getTorrentPlaybackIdentity(), loading = false) {
        const picker = this.elements?.torrentSourcePanel?.querySelector('#torrentFilePicker');
        if (!picker) return;
        picker.hidden = false;
        picker.setAttribute('aria-busy', String(loading));
        picker.querySelector('[data-torrent-files-hint]').textContent = loading
            ? 'Получаем список видео… Можно вернуться к раздачам.'
            : identity.mediaType === 'tv'
                ? `Сезон ${identity.seasonNumber ?? '—'}, серия ${identity.episodeNumber ?? '—'}. Проверьте название файла перед запуском.`
                : 'Выберите видео для просмотра.';
        const list = picker.querySelector('[data-torrent-files-list]');
        list.replaceChildren();
        for (const file of files) {
            const row = document.createElement('div');
            row.setAttribute('role', 'listitem');
            const button = document.createElement('button');
            button.type = 'button';
            button.dataset.torrentFileId = file.fileId;
            const title = document.createElement('span');
            title.textContent = file.name;
            const details = document.createElement('span');
            details.className = 'torrent-file-picker__meta';
            details.textContent = [file.seasonNumber != null && file.episodeNumber != null
                ? `S${String(file.seasonNumber).padStart(2, '0')}E${String(file.episodeNumber).padStart(2, '0')}` : '',
            this.formatTorrentBytes(file.sizeBytes)].filter(Boolean).join(' · ');
            button.append(title, details);
            row.append(button);
            list.append(row);
        }
        this.torrentPreparedSource = { sourceId, files, identity };
        this.focusTorrentRegion(picker);
    }

    getTorrentActiveDownload() {
        const downloadId = this.torrentActiveContext?.downloadId;
        if (!downloadId) return null;
        return this.torrentDownloads.find(download => String(download.id) === String(downloadId)) || null;
    }

    setTorrentActiveContext(context = null) {
        if (!context) {
            this.torrentActiveContext = null;
            return;
        }
        this.torrentActiveContext = {
            movieKey: context.movieKey || this.getTorrentMovieKey(),
            sourceId: context.sourceId || null,
            downloadId: context.downloadId || null,
            title: context.title || 'Без названия',
            provider: context.provider || 'MediaPlayer',
            quality: context.quality || 'Качество не указано',
            sizeBytes: Number.isFinite(Number(context.sizeBytes)) ? Number(context.sizeBytes) : null
        };
    }

    ensureTorrentActiveContextFromDownloads(movie = this.selectedMovie) {
        if (!movie) return null;
        const movieKey = this.getTorrentMovieKey(movie);
        if (this.torrentActiveContext?.movieKey === movieKey && this.torrentActiveContext?.downloadId) {
            return this.getTorrentActiveDownload();
        }

        const active = this.getMatchingTorrentDownloads(this.torrentDownloads, movie)
            .filter(download => ['starting', 'downloading', 'paused', 'error'].includes(download.status));
        if (active.length !== 1) return null;

        const download = active[0];
        this.setTorrentActiveContext({
            movieKey,
            downloadId: download.id,
            title: download.title,
            provider: download.provider,
            quality: download.quality,
            sizeBytes: download.sizeBytes || download.totalBytes
        });
        return download;
    }

    resolveTorrentActiveDownload() {
        const context = this.torrentActiveContext;
        if (!context || context.downloadId) return this.getTorrentActiveDownload();

        const candidates = this.getMatchingTorrentDownloads()
            .filter(download => ['starting', 'downloading', 'paused', 'error', 'complete'].includes(download.status))
            .filter(download => String(download.title || '') === String(context.title || ''))
            .filter(download => String(download.provider || '') === String(context.provider || ''))
            .filter(download => String(download.quality || '') === String(context.quality || ''))
            .filter(download => {
                const contextSize = Number(context.sizeBytes);
                const downloadSize = Number(download.sizeBytes || download.totalBytes);
                return Number.isFinite(contextSize) && Number.isFinite(downloadSize)
                    ? contextSize === downloadSize
                    : !Number.isFinite(contextSize) && !Number.isFinite(downloadSize);
            });

        if (candidates.length !== 1) return null;
        context.downloadId = candidates[0].id;
        return candidates[0];
    }

    getTorrentProgressFromDownload(download = this.getTorrentActiveDownload()) {
        if (!download) return { state: 'starting' };
        return {
            state: download.status || 'starting',
            progress: download.progress,
            downloadSpeedBytesPerSecond: download.downloadSpeedBytesPerSecond,
            peers: download.peers,
            timeRemainingSeconds: download.timeRemainingSeconds,
            playable: download.playable === true,
            errorMessage: download.errorMessage
        };
    }

    updateTorrentSourceSummary() {
        if (this.torrentSearchState.status === 'error') return;
        const found = this.torrentSearchState.found || this.torrentSources.length;
        const visible = this.getVisibleTorrentSources().length;
        if (!found) {
            this.setTorrentSourceStatus(
                this.torrentSearchState.status === 'running'
                    ? 'Ищем раздачи…'
                    : 'Для этого фильма раздачи не найдены.'
            );
            return;
        }
        const limit = Math.max(1, Number(this.torrentVisibleSourceLimit) || 10);
        const shown = Math.min(visible, limit);
        const filtered = visible !== this.torrentSources.length ? ` · подходит: ${visible}` : '';
        const paged = shown < visible ? ` · показано: ${shown}` : '';
        const running = this.torrentSearchState.status === 'running' ? ' · поиск продолжается' : '';
        this.setTorrentSourceStatus(`Найдено раздач: ${found}${filtered}${paged}${running}`);
    }

    renderTorrentSources(sources = []) {
        const list = this.elements?.torrentSourceList;
        if (!list) return;
        list.replaceChildren();
        const availableSources = this.deduplicateTorrentSources(sources);
        const filteredSources = this.getVisibleTorrentSources(availableSources);
        const limit = Math.max(1, Number(this.torrentVisibleSourceLimit) || 10);
        const visibleSources = filteredSources.slice(0, limit);
        visibleSources.forEach((source) => {
            const sourceId = typeof source?.sourceId === 'string' ? source.sourceId : '';
            if (!sourceId) return;

            const item = document.createElement('article');
            item.className = 'torrent-source-card-item';
            item.setAttribute('role', 'listitem');

            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'torrent-source-card';
            card.classList.add('torrent-source-card__select');
            card.setAttribute('data-source-id', sourceId);
            card.setAttribute('aria-label', `Открыть раздачу: ${String(source.title || 'Без названия')}`);

            const title = document.createElement('span');
            title.className = 'torrent-source-card__title';
            title.textContent = String(source.title || 'Без названия');

            const quality = document.createElement('span');
            quality.className = 'torrent-source-card__quality';
            quality.textContent = this.getTorrentQualityDetails(source).label;

            const language = document.createElement('span');
            language.className = 'torrent-source-card__language';
            language.textContent = this.getTorrentSourceLanguageLabel(source);

            const provider = document.createElement('span');
            provider.className = 'torrent-source-card__provider';
            provider.textContent = String(source.provider || 'Неизвестный индексер');

            const meta = document.createElement('span');
            meta.className = 'torrent-source-card__meta';
            const releaseYear = Number(source.year);
            if (Number.isInteger(releaseYear) && releaseYear > 0) {
                const year = document.createElement('span');
                year.textContent = `Год: ${releaseYear}`;
                meta.appendChild(year);
            }
            const size = document.createElement('span');
            size.textContent = `Размер: ${this.formatTorrentBytes(source.sizeBytes)}`;
            const peers = document.createElement('span');
            peers.textContent = `Сиды: ${this.getTorrentNumber(source.seeders, '—')}`;
            const leechers = document.createElement('span');
            leechers.textContent = `Личеры: ${this.getTorrentNumber(source.leechers, '—')}`;
            meta.append(size, peers, leechers);

            card.append(title, quality, language, provider, meta);
            item.appendChild(card);
            list.appendChild(item);
        });
        if (!visibleSources.length && availableSources.length) {
            const empty = document.createElement('div');
            empty.className = 'torrent-source-empty';
            empty.setAttribute('role', 'status');
            empty.textContent = this.torrentQualityFilter === 'all' && (this.torrentLanguageFilter || 'all') === 'all'
                ? 'Подходящих раздач нет.'
                : 'По выбранным фильтрам раздач нет. Выберите «Все» или другой язык/формат.';
            list.appendChild(empty);
        }
        if (this.elements.torrentSourceDisclosure) {
            this.elements.torrentSourceDisclosure.hidden = availableSources.length === 0;
        }
        if (this.elements.torrentSourceShowMoreBtn) {
            const hasMore = visibleSources.length < filteredSources.length;
            this.elements.torrentSourceShowMoreBtn.hidden = !hasMore;
            this.elements.torrentSourceShowMoreBtn.textContent = hasMore
                ? `Показать ещё (${Math.min(10, filteredSources.length - visibleSources.length)})`
                : 'Показать ещё';
        }
        const count = this.elements.torrentSourceDisclosure?.querySelector('[data-torrent-disclosure-count]');
        if (count) count.textContent = availableSources.length ? `${filteredSources.length}` : '';
        this.updateTorrentSourceSummary();
    }

    getMatchingTorrentDownloads(downloads = this.torrentDownloads, movie = this.selectedMovie) {
        const tmdbId = this.getMediaPlayerTmdbId(movie);
        const identity = this.getTorrentPlaybackIdentity(movie);
        return (Array.isArray(downloads) ? downloads : [])
            .filter(download => String(download?.mediaType || 'movie') === (this.isTorrentMovie(movie) ? 'movie' : 'tv'))
            .filter(download => Number(download?.tmdbId) === tmdbId)
            .filter(download => identity.mediaType !== 'tv' || (download.seasonNumber === identity.seasonNumber
                && download.episodeNumber === identity.episodeNumber))
            .sort((first, second) => {
                const order = { downloading: 0, starting: 1, paused: 2, error: 3, complete: 4 };
                const statusDifference = (order[first.status] ?? 5) - (order[second.status] ?? 5);
                if (statusDifference) return statusDifference;
                return String(second.updatedAt || '').localeCompare(String(first.updatedAt || ''));
            });
    }

    formatTorrentTime(value) {
        const seconds = Number(value);
        if (!Number.isFinite(seconds) || seconds <= 0) return '';
        if (seconds >= 86400) return `${Math.ceil(seconds / 86400)} д`;
        if (seconds >= 3600) return `${Math.ceil(seconds / 3600)} ч`;
        if (seconds >= 60) return `${Math.ceil(seconds / 60)} мин`;
        return `${Math.ceil(seconds)} с`;
    }

    getTorrentDownloadStatus(download = {}) {
        const labels = {
            starting: 'Подготавливается',
            downloading: 'Скачивается',
            paused: 'Приостановлено',
            error: 'Нужно повторить',
            complete: 'Файл готов'
        };
        return labels[download.status] || 'Состояние неизвестно';
    }

    getTorrentDownloadSummary() {
        const count = this.torrentDownloads.length;
        if (!count) return 'Сохранённых загрузок для этого фильма нет.';
        const active = this.torrentDownloads.filter(download => ['starting', 'downloading'].includes(download.status)).length;
        if (active) return `В библиотеке: ${count} · ${active} продолжается автоматически`;
        return `В библиотеке: ${count} · загрузка сохранена`;
    }

    getTorrentPlaybackSummary(progress = this.latestTorrentPlaybackProgress || {}) {
        const playback = progress.playback && typeof progress.playback === 'object'
            ? progress.playback
            : null;
        if (!this.torrentPlaybackSession && !playback) return '';

        const state = this.getTorrentWorkspaceState(progress);
        if (state === 'playback-error') {
            const message = playback?.message ? ` · ${String(playback.message)}` : '';
            return `Просмотр: ошибка${message} · загрузка продолжается`;
        }
        if (state === 'probing') return 'Просмотр: определяем формат…';
        if (state === 'remuxing') return 'Просмотр: готовим быстрый поток…';
        if (state === 'transcoding') return 'Просмотр: подготавливаем совместимый поток…';

        const availableSeconds = Number(playback?.availableDurationSeconds);
        if (Number.isFinite(availableSeconds) && availableSeconds > 0) {
            return `Просмотр доступен: ${this.formatTorrentPlaybackDuration(availableSeconds)}`;
        }
        if (state === 'complete') return 'Просмотр: файл готов';
        return 'Просмотр: подключаемся…';
    }

    renderTorrentDownloads(downloads = this.torrentDownloads) {
        const library = this.elements?.torrentDownloadLibrary;
        const list = this.elements?.torrentDownloadList;
        if (!library || !list) return;
        list.replaceChildren();
        const matching = this.getMatchingTorrentDownloads(downloads);
        library.hidden = matching.length === 0;
        if (!matching.length) return;

        matching.forEach((download) => {
            const card = document.createElement('article');
            const isCurrent = String(this.torrentActiveContext?.downloadId || '') === String(download.id);
            const serviceUnavailable = this.torrentServiceHealth === 'unavailable';
            card.className = `torrent-download-card${isCurrent ? ' torrent-download-card--current' : ''}`;
            card.dataset.state = String(download.status || 'unknown');
            card.dataset.current = isCurrent ? 'true' : 'false';
            card.dataset.serviceHealth = serviceUnavailable ? 'unavailable' : this.torrentServiceHealth;
            card.setAttribute('role', 'listitem');

            const header = document.createElement('div');
            header.className = 'torrent-download-card__header';
            const state = document.createElement('strong');
            state.className = 'torrent-download-card__state';
            state.textContent = this.getTorrentDownloadStatus(download);
            const quality = document.createElement('span');
            quality.className = 'torrent-download-card__quality';
            quality.textContent = String(download.quality || 'Качество не указано');
            header.append(state, quality);

            const title = document.createElement('div');
            title.className = 'torrent-download-card__title';
            title.textContent = String(download.title || this.selectedMovie?.name || 'Без названия');
            if (isCurrent) {
                const current = document.createElement('span');
                current.className = 'torrent-download-card__current';
                current.textContent = 'Текущий файл';
                title.appendChild(current);
            }

            const progress = document.createElement('div');
            progress.className = 'torrent-download-card__progress';
            progress.setAttribute('role', 'progressbar');
            const progressValue = Number(download.progress);
            const percent = Number.isFinite(progressValue)
                ? Math.max(0, Math.min(100, progressValue <= 1 ? progressValue * 100 : progressValue))
                : 0;
            progress.setAttribute('aria-valuenow', String(Math.round(percent)));
            progress.setAttribute('aria-valuemin', '0');
            progress.setAttribute('aria-valuemax', '100');
            const progressFill = document.createElement('span');
            progressFill.className = 'torrent-download-card__progress-fill';
            progressFill.style.width = `${percent.toFixed(2)}%`;
            progress.appendChild(progressFill);

            const meta = document.createElement('div');
            meta.className = 'torrent-download-card__meta';
            const downloaded = this.formatTorrentBytes(download.downloadedBytes);
            const total = this.formatTorrentBytes(download.totalBytes || download.sizeBytes);
            const progressText = total === '—' ? downloaded : `${downloaded} из ${total}`;
            const details = serviceUnavailable
                ? [progressText, 'данные устарели']
                : [progressText, this.formatTorrentRate(download.downloadSpeedBytesPerSecond)];
            if (!serviceUnavailable && download.status !== 'complete') {
                details.push(`пиры: ${this.getTorrentNumber(download.peers, 0)}`);
            }
            const remaining = serviceUnavailable ? '' : this.formatTorrentTime(download.timeRemainingSeconds);
            if (remaining) details.push(`осталось: ${remaining}`);
            meta.textContent = details.join(' · ');

            const provider = document.createElement('div');
            provider.className = 'torrent-download-card__provider';
            provider.textContent = String(download.provider || 'MediaPlayer');

            const playbackSummary = this.getTorrentPlaybackSummary();
            const playbackElement = isCurrent && playbackSummary
                ? document.createElement('div')
                : null;
            if (playbackElement) {
                playbackElement.className = 'torrent-download-card__playback';
                playbackElement.dataset.playbackState = this.getTorrentWorkspaceState(
                    this.latestTorrentPlaybackProgress || {}
                );
                playbackElement.textContent = playbackSummary;
                playbackElement.setAttribute('role', 'status');
                playbackElement.setAttribute('aria-live', 'polite');
            }

            const actions = document.createElement('div');
            actions.className = 'torrent-download-card__actions';
            const isActiveDownload = ['starting', 'downloading'].includes(download.status);
            if (download.status === 'complete' || isActiveDownload) {
                const playButton = document.createElement('button');
                playButton.type = 'button';
                playButton.className = 'torrent-download-card__action torrent-download-card__action--primary';
                playButton.dataset.downloadAction = 'play';
                playButton.dataset.downloadId = download.id;
                playButton.textContent = download.status === 'complete' ? 'Смотреть' : 'Открыть просмотр';
                playButton.setAttribute('aria-label', `${playButton.textContent}: ${download.title || 'фильм'}`);
                actions.appendChild(playButton);
            }
            if (isActiveDownload || download.status === 'paused' || download.status === 'error') {
                const controlButton = document.createElement('button');
                controlButton.type = 'button';
                controlButton.className = 'torrent-download-card__action torrent-download-card__action--control';
                controlButton.dataset.downloadAction = isActiveDownload ? 'pause' : 'resume';
                controlButton.dataset.downloadId = download.id;
                controlButton.textContent = isActiveDownload
                    ? 'Пауза'
                    : download.status === 'error' ? 'Повторить' : 'Продолжить';
                controlButton.setAttribute('aria-label', `${controlButton.textContent}: ${download.title || 'фильм'}`);
                actions.appendChild(controlButton);
            }
            const deleteButton = document.createElement('button');
            deleteButton.type = 'button';
            deleteButton.className = 'torrent-download-card__action';
            deleteButton.dataset.downloadAction = 'delete';
            deleteButton.dataset.downloadId = download.id;
            deleteButton.textContent = 'Удалить';
            actions.appendChild(deleteButton);

            card.append(header, title, progress, meta, provider);
            if (playbackElement) card.appendChild(playbackElement);
            card.appendChild(actions);
            list.appendChild(card);
        });
    }

    async refreshTorrentDownloads(movie = this.selectedMovie, requestId = this.torrentRequestId, options = {}) {
        if (!this.mediaPlayerService || !movie || this.torrentDownloadRequestActive) return false;
        const requestToken = ++this.torrentDownloadRequestToken;
        this.torrentDownloadRequestActive = true;
        try {
            const downloads = await this.mediaPlayerService.listDownloads({ signal: options.signal });
            if (!this.isTorrentRequestCurrent(requestId, movie)) return false;
            this.torrentServiceHealth = 'healthy';
            this.torrentDownloads = this.getMatchingTorrentDownloads(downloads, movie);
            this.resolveTorrentActiveDownload();
            this.renderTorrentDownloads(this.torrentDownloads);
            if (this.torrentActiveContext && !this.torrentPlaybackSession) {
                this.renderTorrentPlaybackStatus(this.getTorrentProgressFromDownload(this.getTorrentActiveDownload()));
            }
            if (!this.torrentSearchJobId && this.torrentSources.length === 0) {
                this.setTorrentSourceStatus(this.getTorrentDownloadSummary());
            }
            return true;
        } catch (error) {
            const requestAborted = this.mediaPlayerService?.isRequestAbortedError?.(error) === true
                || error?.code === 'request_aborted';
            if (requestAborted) return false;
            if (this.isTorrentRequestCurrent(requestId, movie)) {
                const serviceUnavailable = this.mediaPlayerService?.isServiceUnavailableError?.(error) === true;
                this.torrentServiceHealth = serviceUnavailable ? 'unavailable' : this.torrentServiceHealth;
                if (serviceUnavailable) {
                    this.renderTorrentDownloads(this.torrentDownloads);
                }
                if (serviceUnavailable || this.torrentDownloads.length === 0) {
                    this.setTorrentSourceStatus(this.formatTorrentError(error), 'error');
                }
            }
            return false;
        } finally {
            if (this.torrentDownloadRequestToken === requestToken) {
                this.torrentDownloadRequestActive = false;
            }
        }
    }

    startTorrentDownloadMonitoring(movie = this.selectedMovie, requestId = this.torrentRequestId) {
        this.stopTorrentDownloadMonitoring();
        if (!this.mediaPlayerService || !movie) return;
        const monitorToken = ++this.torrentDownloadMonitorToken;
        const abortController = new AbortController();
        this.torrentDownloadAbortController = abortController;
        this.torrentDownloadPollDelayMs = 2500;
        const poll = async () => {
            if (monitorToken !== this.torrentDownloadMonitorToken) return;
            if (!this.elements?.torrentSourcePanel || this.elements.torrentSourcePanel.hidden) {
                this.torrentDownloadTimer = setTimeout(() => void poll(), 2500);
                return;
            }

            const refreshed = await this.refreshTorrentDownloads(movie, requestId, {
                signal: abortController.signal
            });
            if (monitorToken !== this.torrentDownloadMonitorToken) return;
            if (refreshed) {
                this.torrentDownloadPollDelayMs = 2500;
            } else if (this.torrentServiceHealth === 'unavailable') {
                this.torrentDownloadPollDelayMs = Math.min(
                    30_000,
                    Math.max(5_000, this.torrentDownloadPollDelayMs * 2)
                );
            } else {
                this.torrentDownloadPollDelayMs = 2500;
            }
            this.torrentDownloadTimer = setTimeout(() => void poll(), this.torrentDownloadPollDelayMs);
        };
        void poll();
    }

    stopTorrentDownloadMonitoring() {
        this.torrentDownloadMonitorToken += 1;
        this.torrentDownloadRequestToken += 1;
        this.torrentDownloadAbortController?.abort();
        this.torrentDownloadAbortController = null;
        if (this.torrentDownloadTimer) clearTimeout(this.torrentDownloadTimer);
        this.torrentDownloadTimer = null;
        this.torrentDownloadPollDelayMs = 2500;
        this.torrentDownloadRequestActive = false;
    }

    async playSavedTorrent(downloadId, options = {}) {
        const movie = this.selectedMovie;
        if (!movie || !this.mediaPlayerService) return false;
        const record = this.getMatchingTorrentDownloads(this.torrentDownloads, movie).find(download => String(download.id) === String(downloadId));
        if (!record) return false;
        this.setTorrentActiveContext({
            movieKey: this.getTorrentMovieKey(movie),
            downloadId: record.id,
            title: record.title,
            provider: record.provider,
            quality: record.quality,
            sizeBytes: record.sizeBytes || record.totalBytes
        });
        const requestId = this.torrentRequestId;
        const generation = this.torrentPlaybackGeneration = (this.torrentPlaybackGeneration || 0) + 1;
        const action = Array.from(
            this.elements.torrentDownloadList?.querySelectorAll('[data-download-action="play"]') || []
        ).find(item => item.dataset.downloadId === downloadId);
        if (action) action.disabled = true;
        try {
            const session = await this.mediaPlayerService.playDownload(downloadId, options);
            if (!this.isTorrentRequestCurrent(requestId, movie) || generation !== this.torrentPlaybackGeneration) {
                void this.mediaPlayerService.revokePlaybackSession(session.sessionId).catch(() => undefined);
                return false;
            }
            this.torrentPlaybackResume = options.resume || null;
            return await this.mountTorrentPlaybackSession(session, requestId, movie, generation);
        } catch (error) {
            if (!this.isTorrentRequestCurrent(requestId, movie) || generation !== this.torrentPlaybackGeneration) return false;
            this.setTorrentSourceStatus(this.formatTorrentError(error), 'error');
            if (action) action.disabled = false;
            return false;
        }
    }

    updateTorrentDownloadRecord(download) {
        if (!download?.id) return;
        const index = this.torrentDownloads.findIndex(item => item.id === download.id);
        if (index < 0) return;
        this.torrentDownloads[index] = { ...this.torrentDownloads[index], ...download };
        this.renderTorrentDownloads(this.torrentDownloads);
    }

    async pauseSavedTorrent(downloadId) {
        const movie = this.selectedMovie;
        if (!movie || !this.mediaPlayerService) return false;
        const requestId = this.torrentRequestId;
        const action = Array.from(
            this.elements.torrentDownloadList?.querySelectorAll('[data-download-action="pause"]') || []
        ).find(item => item.dataset.downloadId === downloadId);
        if (action) action.disabled = true;
        try {
            const download = await this.mediaPlayerService.pauseDownload(downloadId);
            if (!this.isTorrentRequestCurrent(requestId, movie)) return false;
            this.updateTorrentDownloadRecord(download);
            this.renderTorrentPlaybackStatus(this.getTorrentProgressFromDownload(this.getTorrentActiveDownload()));
            void this.refreshTorrentDownloads(movie, requestId);
            this.setTorrentSourceStatus('Загрузка приостановлена. Файл и скачанные части сохранены.');
            return true;
        } catch (error) {
            this.setTorrentSourceStatus(this.formatTorrentError(error), 'error');
            return false;
        } finally {
            if (action?.isConnected) action.disabled = false;
        }
    }

    async resumeSavedTorrent(downloadId) {
        const movie = this.selectedMovie;
        if (!movie || !this.mediaPlayerService) return false;
        const requestId = this.torrentRequestId;
        const action = Array.from(
            this.elements.torrentDownloadList?.querySelectorAll('[data-download-action="resume"]') || []
        ).find(item => item.dataset.downloadId === downloadId);
        if (action) action.disabled = true;
        try {
            const download = await this.mediaPlayerService.resumeDownload(downloadId);
            if (!this.isTorrentRequestCurrent(requestId, movie)) return false;
            this.updateTorrentDownloadRecord(download);
            this.renderTorrentPlaybackStatus(this.getTorrentProgressFromDownload(this.getTorrentActiveDownload()));
            void this.refreshTorrentDownloads(movie, requestId);
            this.setTorrentSourceStatus('Загрузка продолжена.');
            return true;
        } catch (error) {
            this.setTorrentSourceStatus(this.formatTorrentError(error), 'error');
            return false;
        } finally {
            if (action?.isConnected) action.disabled = false;
        }
    }

    async deleteSavedTorrent(downloadId) {
        const record = this.torrentDownloads.find(download => download.id === downloadId);
        if (!record || !this.mediaPlayerService) return false;
        const question = `Удалить загрузку «${record.title || 'фильм'}»?`;
        if (typeof window !== 'undefined') {
            const confirmed = window.ConfirmDialog
                ? await window.ConfirmDialog.confirm({ title: question, confirmLabel: 'Удалить', danger: true })
                : (typeof window.confirm !== 'function' || window.confirm(question));
            if (!confirmed) return false;
        }
        try {
            await this.mediaPlayerService.deleteDownload(downloadId);
            this.torrentDownloads = this.torrentDownloads.filter(download => download.id !== downloadId);
            if (String(this.torrentActiveContext?.downloadId || '') === String(downloadId)) {
                this.torrentActiveContext = null;
                if (!this.torrentPlaybackSession && this.elements?.torrentPlaybackStatus) {
                    this.elements.torrentPlaybackStatus.hidden = true;
                }
            }
            this.renderTorrentDownloads(this.torrentDownloads);
            this.setTorrentSourceStatus(this.getTorrentDownloadSummary());
            return true;
        } catch (error) {
            this.setTorrentSourceStatus(this.formatTorrentError(error), 'error');
            return false;
        }
    }

    async startTorrentPlayback(sourceId, fileId = null, options = {}) {
        const source = this.torrentSources.find(candidate => candidate?.sourceId === sourceId);
        const movie = this.selectedMovie;
        if (!source || !movie || !this.mediaPlayerService) return false;
        const requestId = this.torrentRequestId;
        const generation = this.torrentPlaybackGeneration = (this.torrentPlaybackGeneration || 0) + 1;
        const isCurrent = () => this.isTorrentRequestCurrent(requestId, movie) && generation === this.torrentPlaybackGeneration;
        const identity = this.getTorrentPlaybackIdentity(movie);
        this.setTorrentActiveContext({
            movieKey: this.getTorrentMovieKey(movie),
            sourceId: source.sourceId,
            title: source.title,
            provider: source.provider,
            quality: source.quality,
            sizeBytes: source.sizeBytes
        });
        this.cancelActiveTorrentSearch();
        this.elements.torrentSourceList?.querySelectorAll('.torrent-source-card__select').forEach(card => {
            card.disabled = true;
        });
        this.setTorrentSourceStatus('Подготавливаем просмотр…');

        try {
            if (this.mediaPlayerService.capabilities?.playback?.fileSelection === true) {
                const cached = this.torrentPreparedSource;
                let prepared = cached?.sourceId === sourceId && fileId ? cached : null;
                if (!prepared) {
                    this.showTorrentFileSelection(sourceId, [], identity, true);
                    prepared = await this.mediaPlayerService.preparePlayback({ sourceId, ...identity });
                    if (!isCurrent()) return false;
                }
                if (fileId && !prepared.files.some(file => file.fileId === fileId)) {
                    throw new Error('Файл отсутствует в выбранной раздаче. Повторите выбор.');
                }
                if (!fileId) {
                    const exact = identity.mediaType === 'tv' ? prepared.files.filter(file =>
                        file.seasonNumber != null && file.episodeNumber != null
                        && file.seasonNumber === identity.seasonNumber && file.episodeNumber === identity.episodeNumber) : [];
                    fileId = identity.mediaType === 'movie' && prepared.files.length === 1
                        ? prepared.files[0].fileId : exact.length === 1 ? exact[0].fileId : null;
                }
                if (!fileId) {
                    this.showTorrentFileSelection(sourceId, prepared.files, identity);
                    this.setTorrentSourceStatus('Выберите видео из раздачи.');
                    return false;
                }
                const file = prepared.files.find(candidate => candidate.fileId === fileId);
                if (identity.mediaType === 'tv' && file.seasonNumber != null && file.episodeNumber != null) {
                    identity.seasonNumber = file.seasonNumber;
                    identity.episodeNumber = file.episodeNumber;
                }
            } else if (identity.mediaType === 'tv') {
                throw new Error('Для выбора серий обновите MediaPlayer.');
            }
            const session = await this.mediaPlayerService.createPlaybackSession({
                sourceId: source.sourceId, ...identity, fileId,
                audioStreamIndex: options.audioStreamIndex
            });
            if (!isCurrent()) {
                void this.mediaPlayerService.revokePlaybackSession(session.sessionId).catch(() => undefined);
                return false;
            }
            this.torrentPlaybackSourceArgs = { sourceId, fileId, ...identity };
            this.torrentPlaybackResume = options.resume || null;
            return await this.mountTorrentPlaybackSession(session, requestId, movie, generation);
        } catch (error) {
            if (!isCurrent()) return false;
            this.setTorrentSourceStatus(this.formatTorrentError(error), 'error');
            this.elements.torrentSourceList?.querySelectorAll('.torrent-source-card__select').forEach(card => {
                card.disabled = false;
            });
            return false;
        }
    }

    async mountTorrentPlaybackSession(session, requestId, movie, generation = this.torrentPlaybackGeneration) {
        if (!session || !this.isTorrentRequestCurrent(requestId, movie) || generation !== this.torrentPlaybackGeneration) {
            if (session?.sessionId) void this.mediaPlayerService?.revokePlaybackSession(session.sessionId).catch(() => undefined);
            return false;
        }

        const obsolete = this.torrentPlaybackSession;
        if (this.torrentPlaybackResume && obsolete?.sessionId && obsolete.sessionId !== session.sessionId) {
            const ready = await this.waitForTorrentReplacement(session, requestId, movie, generation);
            if (!ready) return false;
        }
        if (!this.isTorrentRequestCurrent(requestId, movie) || generation !== this.torrentPlaybackGeneration) {
            void this.mediaPlayerService?.revokePlaybackSession(session.sessionId).catch(() => undefined);
            return false;
        }
        if (obsolete?.sessionId && obsolete.sessionId !== session.sessionId) {
            void this.mediaPlayerService.revokePlaybackSession(obsolete.sessionId).catch(() => undefined);
        }
        const picker = this.elements?.torrentSourcePanel?.querySelector('#torrentFilePicker');
        if (picker) picker.hidden = true;
        this.beginSourceSwitchRequest();
        this.disposeTorrentPlaybackVideo();
        this.unmountActivePlayer();
        this.resetHlsRecoveryState();
        if (this.currentHls) {
            this.currentHls.destroy();
            this.currentHls = null;
        }
        this.torrentPlaybackSession = session;
        if (!this.torrentPlaybackResume) this.torrentSubtitlePreference = null;
        const selectedFile = session.selectedFile;
        const canonical = this.playbackController?.getSelection?.();
        if (canonical) this.playbackController.setSelection({ ...canonical, providerId: MOVIE_DETAILS_TORRENT_SOURCE });
        if (!this.isTorrentMovie(movie) && canonical && selectedFile?.seasonNumber != null && selectedFile?.episodeNumber != null) {
            this.playbackController.setSelection({ ...canonical, providerId: MOVIE_DETAILS_TORRENT_SOURCE, seasonNumber: selectedFile.seasonNumber,
                episodeNumber: selectedFile.episodeNumber, initialTimestamp: this.torrentPlaybackResume?.currentTime || 0 });
            this.updatePlayerHeaderTitle?.();
            this.updatePlayerNavigationControls?.();
        }
        if (!this.torrentPlaybackResume && canonical?.initialTimestamp > 0
            && (this.isTorrentMovie(movie) || (selectedFile?.seasonNumber === canonical.seasonNumber
                && selectedFile?.episodeNumber === canonical.episodeNumber))) {
            this.torrentPlaybackResume = { currentTime: canonical.initialTimestamp, paused: false,
                volume: 1, muted: false, playbackRate: 1 };
        }
        this.torrentTracksSnapshot = null;
        this.torrentTracksRefreshState = '';
        if (session.downloadId) {
            this.setTorrentActiveContext({
                ...(this.torrentActiveContext || {}),
                movieKey: this.getTorrentMovieKey(movie),
                downloadId: session.downloadId
            });
        }
        this.latestTorrentPlaybackProgress = { state: 'starting' };
        this.torrentHasPlaybackSnapshot = false;
        this.torrentPlaybackAvailableDurationSeconds = null;
        this.currentVideoUrl = session.preferHls ? session.hlsUrl : session.streamUrl;
        this.activePlayerId = null;
        this.isPlaying = true;
        await this.renderCustomPlayer(this.currentVideoUrl, Boolean(session.preferHls));
        this.renderTorrentPlaybackStatus({ state: 'starting' });
        if (session.downloadId) void this.refreshTorrentDownloads(movie, requestId);
        this.startTorrentProgressMonitoring(session);
        if (this.elements.torrentSourceDisclosure) this.elements.torrentSourceDisclosure.open = false;
        this.elements.torrentSourceList?.querySelectorAll('.torrent-source-card__select').forEach(card => {
            card.disabled = false;
        });
        this.focusTorrentRegion(this.elements.videoContainer);
        return true;
    }

    async waitForTorrentReplacement(session, requestId, movie, generation) {
        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline && this.isTorrentRequestCurrent(requestId, movie) && generation === this.torrentPlaybackGeneration) {
            try {
                await this.mediaPlayerService.warmPlaybackSession?.(session);
                const progress = await this.mediaPlayerService.getPlaybackProgress(session.progressUrl);
                if (!this.isTorrentRequestCurrent(requestId, movie) || generation !== this.torrentPlaybackGeneration) break;
                const playback = progress?.playback;
                const audioSwitch = this.torrentAudioSwitch;
                const liveResume = audioSwitch && audioSwitch.session === this.torrentPlaybackSession
                    && audioSwitch.video === this.torrentPlaybackVideo
                    ? this.getTorrentVideoResume(audioSwitch.video) : null;
                const target = (liveResume || this.torrentPlaybackResume)?.currentTime || 0;
                if (['error', 'failed'].includes(playback?.state)) break;
                if (playback?.isReady && (playback.isComplete || playback.availableDurationSeconds >= target + 2)) {
                    if (liveResume) this.torrentPlaybackResume = liveResume;
                    return true;
                }
            } catch { /* The replacement may still be starting; retain the old player. */ }
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        void this.mediaPlayerService.revokePlaybackSession(session.sessionId).catch(() => undefined);
        if (generation === this.torrentPlaybackGeneration) {
            this.torrentPlaybackResume = null;
            this.setTorrentSourceStatus('Не удалось быстро подготовить выбранную озвучку. Предыдущая дорожка сохранена — повторите попытку позже.', 'error');
        }
        return false;
    }

    ensureTorrentPlaybackStatusMarkup(status) {
        if (status.dataset.view === 'active') return;

        status.dataset.view = 'active';
        status.setAttribute('aria-atomic', 'false');
        status.innerHTML = `
            <div class="torrent-playback-status__header">
                <div>
                    <span class="torrent-playback-status__eyebrow">ТОРРЕНТ-ПРОСМОТР</span>
                    <h4 class="torrent-playback-status__title" id="torrentPlaybackTitle" data-status-title>Поток готовится</h4>
                    <div class="torrent-playback-status__context">
                        <span data-status-quality>Качество не указано</span>
                        <span data-status-provider>MediaPlayer</span>
                    </div>
                </div>
                <span class="torrent-playback-status__state" data-status-state>Запуск загрузки</span>
            </div>
            <div class="torrent-playback-status__metrics" aria-label="Состояние торрент-просмотра">
                <div class="torrent-playback-status__metric">
                    <span class="torrent-playback-status__metric-label">Скачано</span>
                    <strong class="torrent-playback-status__metric-value" data-status-download>—</strong>
                </div>
                <div class="torrent-playback-status__metric">
                    <span class="torrent-playback-status__metric-label">Скорость</span>
                    <strong class="torrent-playback-status__metric-value" data-status-speed>0 Б/с</strong>
                </div>
                <div class="torrent-playback-status__metric">
                    <span class="torrent-playback-status__metric-label">Пиры</span>
                    <strong class="torrent-playback-status__metric-value" data-status-peers>—</strong>
                </div>
                <div class="torrent-playback-status__metric torrent-playback-status__metric--available">
                    <span class="torrent-playback-status__metric-label">Доступно для просмотра</span>
                    <strong class="torrent-playback-status__metric-value" data-status-available>Пока нет</strong>
                </div>
                <div class="torrent-playback-status__metric">
                    <span class="torrent-playback-status__metric-label">Размер</span>
                    <strong class="torrent-playback-status__metric-value" data-status-size>—</strong>
                </div>
            </div>
            <div class="torrent-playback-status__download-track" data-status-download-bar role="progressbar"
                aria-label="Прогресс скачивания" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
                <span class="torrent-playback-status__download-fill" data-status-download-fill></span>
            </div>
            <div class="torrent-playback-status__actions" data-status-actions></div>
            <div class="torrent-playback-status__footer">
                <span class="torrent-playback-status__note" data-status-note aria-live="polite" aria-atomic="false">Подключаемся к раздаче…</span>
                <span class="torrent-playback-status__remaining" data-status-remaining></span>
            </div>
        `;
    }

    getTorrentWorkspaceState(progress = {}) {
        const playback = progress.playback && typeof progress.playback === 'object'
            ? progress.playback
            : null;
        const downloadState = String(progress.state || 'starting');
        const playbackState = String(playback?.state || 'idle');

        if (downloadState === 'error' || progress.errorMessage || progress.error) {
            return 'error';
        }
        if (playbackState === 'failed') return 'playback-error';
        if (downloadState === 'paused' || playbackState === 'paused') return 'paused';
        if (['probing', 'remuxing', 'transcoding'].includes(playbackState)) return playbackState;
        if (downloadState === 'metadata') return 'metadata';
        if (downloadState === 'complete') {
            return playback?.isComplete || playback?.isReady || progress.playable === true
                ? 'complete'
                : 'preparing';
        }
        if (downloadState === 'downloading') return 'downloading';
        if (playbackState === 'complete' && (playback?.isComplete || playback?.isReady)) return 'complete';
        if (downloadState === 'starting') return 'starting';
        return 'starting';
    }

    formatTorrentPlaybackDuration(value) {
        const seconds = Number(value);
        if (!Number.isFinite(seconds) || seconds <= 0) return '—';

        const totalSeconds = Math.floor(seconds);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const remainingSeconds = totalSeconds % 60;
        const paddedMinutes = String(minutes).padStart(2, '0');
        const paddedSeconds = String(remainingSeconds).padStart(2, '0');

        return hours > 0
            ? `${hours}:${paddedMinutes}:${paddedSeconds}`
            : `${paddedMinutes}:${paddedSeconds}`;
    }

    renderTorrentPlaybackStatus(progress = {}) {
        const status = this.elements?.torrentPlaybackStatus;
        if (!status) return;
        if (Object.keys(progress).length) this.latestTorrentPlaybackProgress = progress;
        else progress = this.latestTorrentPlaybackProgress || {};
        if (this.torrentPlaybackVideo) this.torrentPlaybackVideo._torrentPlaybackSnapshot = progress.playback || null;
        const activeDownload = this.getTorrentActiveDownload();
        if (activeDownload) {
            this.renderTorrentDownloads(this.torrentDownloads);
            status.hidden = true;
            return;
        }
        this.ensureTorrentPlaybackStatusMarkup(status);

        const playback = progress.playback && typeof progress.playback === 'object'
            ? progress.playback
            : null;
        const videoMode = String(playback?.videoMode || 'unknown');
        const audioMode = String(playback?.audioMode || 'unknown');
        const trackAwareFallback = videoMode === 'copy' && audioMode === 'transcode'
            ? 'audio'
            : videoMode === 'transcode' && audioMode === 'copy'
                ? 'video'
                : null;
        const stateLabels = {
            starting: 'Запуск загрузки',
            metadata: 'Получение метаданных',
            downloading: 'Загрузка',
            paused: 'Пауза',
            complete: 'Файл готов',
            preparing: 'Готовим просмотр',
            error: 'Ошибка загрузки',
            'playback-error': 'Ошибка просмотра',
            probing: 'Определяем формат',
            remuxing: 'Быстрый remux',
            transcoding: trackAwareFallback === 'audio' ? 'Подготовка аудио' : 'Подготовка видео'
        };
        const state = this.getTorrentWorkspaceState(progress);
        const percent = Number(progress.progress);
        const downloadPercent = Number.isFinite(percent)
            ? Math.max(0, Math.min(100, percent <= 1 ? percent * 100 : percent))
            : null;
        const hasDownloadSnapshot = this.torrentHasPlaybackSnapshot || !this.torrentPlaybackSession;
        const speed = hasDownloadSnapshot
            ? this.formatTorrentRate(progress.downloadSpeedBytesPerSecond)
            : 'Получаем данные…';
        const peers = hasDownloadSnapshot && Number.isFinite(Number(progress.peers))
            ? Number(progress.peers)
            : '—';
        const remaining = this.formatTorrentTime(progress.timeRemainingSeconds);

        const hasOfficialPlayback = Boolean(playback);
        const availableDuration = hasOfficialPlayback
            ? Number(playback.availableDurationSeconds)
            : null;
        const hasAvailableDuration = Number.isFinite(availableDuration) && availableDuration > 0;
        const normalizedState = stateLabels[state] ? state : 'starting';
        const activeContext = this.torrentActiveContext || {};
        const title = activeDownload?.title || activeContext.title || this.selectedMovie?.name || 'Торрент-файл';
        const quality = activeDownload?.quality || activeContext.quality || 'Качество не указано';
        const provider = activeDownload?.provider || activeContext.provider || 'MediaPlayer';
        const sizeBytes = activeDownload?.sizeBytes || activeDownload?.totalBytes || activeContext.sizeBytes;
        const titles = {
            starting: 'Поток готовится',
            metadata: 'Получаем данные раздачи',
            downloading: 'Фильм скачивается',
            paused: 'Загрузка на паузе',
            complete: 'Файл готов к просмотру',
            preparing: 'Файл скачан, готовим просмотр',
            error: 'Не удалось продолжить загрузку',
            'playback-error': 'Поток не запустился',
            probing: 'Проверяем кодеки',
            remuxing: 'Запускаем быстрый поток',
            transcoding: trackAwareFallback === 'audio'
                ? 'Подготавливаем только звук, видео копируется без перекодирования.'
                : trackAwareFallback === 'video'
                    ? 'Подготавливаем только видео, аудиодорожка копируется без изменений.'
                    : 'Подготавливаем совместимый поток'
        };
        const notes = {
            starting: 'Подключаемся к раздаче…',
            metadata: 'Получаем метаданные и готовим первый фрагмент видео…',
            downloading: hasAvailableDuration
                ? 'Плеер показывает доступный фрагмент. Длина растёт по мере обработки файла.'
                : 'Готовим первый фрагмент видео…',
            paused: 'Скачивание приостановлено. Нажмите «Продолжить», чтобы возобновить его.',
            complete: hasAvailableDuration
                ? 'Торрент скачан. Доступная длительность подтверждена HLS-плейлистом.'
                : progress.playable === true
                    ? 'Файл скачан полностью и отмечен как доступный для просмотра.'
                    : 'Торрент скачан. Ждём подтверждение готовности playback.',
            preparing: 'Торрент скачан, но playback ещё не подтвердил доступный поток.',
            error: playback?.message || progress.errorMessage || 'Проверьте состояние MediaPlayer и повторите запуск загрузки.',
            'playback-error': playback?.message
                ? `Просмотр временно недоступен: ${String(playback.message)}`
                : 'Просмотр временно недоступен. Загрузка торрента продолжается.',
            probing: 'Проверяем заголовок файла и выбираем remux или перекодирование…',
            remuxing: playback?.isReady
                ? 'Поток готов к просмотру и продолжает наполняться по мере загрузки.'
                : 'Собираем первые сегменты без перекодирования…',
            transcoding: playback?.isReady
                ? 'Идёт подготовка потока. Плеер запущен после безопасного буфера.'
                : trackAwareFallback === 'audio'
                    ? 'Видео копируется без перекодирования. Ждём первые 2 секунды звука…'
                    : 'Кодек требует подготовки. Ждём минимум 15 секунд буфера…'
        };

        const titleElement = status.querySelector('[data-status-title]');
        const stateElement = status.querySelector('[data-status-state]');
        const qualityElement = status.querySelector('[data-status-quality]');
        const providerElement = status.querySelector('[data-status-provider]');
        const downloadElement = status.querySelector('[data-status-download]');
        const speedElement = status.querySelector('[data-status-speed]');
        const peersElement = status.querySelector('[data-status-peers]');
        const availableElement = status.querySelector('[data-status-available]');
        const sizeElement = status.querySelector('[data-status-size]');
        const downloadBar = status.querySelector('[data-status-download-bar]');
        const downloadFill = status.querySelector('[data-status-download-fill]');
        const noteElement = status.querySelector('[data-status-note]');
        const remainingElement = status.querySelector('[data-status-remaining]');
        const actionsElement = status.querySelector('[data-status-actions]');

        status.dataset.state = normalizedState;
        titleElement.textContent = title;
        titleElement.setAttribute('data-status-heading', titles[normalizedState]);
        qualityElement.textContent = quality;
        providerElement.textContent = provider;
        stateElement.textContent = stateLabels[normalizedState];
        downloadElement.textContent = downloadPercent === null ? '—' : `${downloadPercent.toFixed(0)}%`;
        speedElement.textContent = speed;
        peersElement.textContent = String(peers);
        availableElement.textContent = hasAvailableDuration
            ? this.formatTorrentPlaybackDuration(availableDuration)
            : progress.playable === true ? 'Весь файл' : 'Пока нет';
        sizeElement.textContent = this.formatTorrentBytes(sizeBytes);
        downloadFill.style.width = `${downloadPercent === null ? 0 : downloadPercent}%`;
        if (downloadPercent === null) {
            downloadBar.removeAttribute('aria-valuenow');
            downloadBar.removeAttribute('aria-valuetext');
        } else {
            downloadBar.setAttribute('aria-valuenow', String(Math.round(downloadPercent)));
            downloadBar.setAttribute('aria-valuetext', `${downloadPercent.toFixed(0)}% скачано`);
        }
        noteElement.textContent = this.hlsPlaybackState || notes[normalizedState] || notes.starting;
        remainingElement.textContent = remaining
            ? `до полной загрузки: ${remaining}`
            : normalizedState === 'complete' ? 'файл скачан целиком' : '';
        actionsElement.replaceChildren();
        if (activeDownload) {
            const addAction = (action, label, primary = false) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = `torrent-playback-status__action${primary ? ' torrent-playback-status__action--primary' : ''}`;
                button.dataset.downloadAction = action;
                button.dataset.downloadId = activeDownload.id;
                button.textContent = label;
                button.setAttribute('aria-label', `${label}: ${title}`);
                actionsElement.appendChild(button);
            };
            if (activeDownload.status === 'complete' && activeDownload.playable === true) {
                addAction('play', 'Смотреть', true);
            } else if (['starting', 'downloading'].includes(activeDownload.status)) {
                addAction('pause', 'Пауза');
            } else if (['paused', 'error'].includes(activeDownload.status)) {
                addAction('resume', activeDownload.status === 'error' ? 'Повторить' : 'Продолжить');
            }
            addAction('delete', 'Удалить');
        } else if (this.torrentPlaybackSession) {
            const hint = document.createElement('span');
            hint.className = 'torrent-playback-status__actions-hint';
            hint.textContent = 'Управление загрузкой появится после сохранения её записи.';
            actionsElement.appendChild(hint);
        }
        status.hidden = false;
    }

    updateTorrentPlaybackAvailability(video = this.torrentPlaybackVideo) {
        // Torrent availability is owned by the MediaPlayer playback snapshot.
        // video.duration describes the current media element, not HLS readiness,
        // and must never replace an authoritative zero from the API.
        if (!video || !this.torrentPlaybackSession) return;
        if (this.latestTorrentPlaybackProgress?.playback) return;
    }

    attachTorrentPlaybackVideo(video) {
        this.detachTorrentPlaybackVideo();
        if (!video) return;

        this.torrentPlaybackVideo = video;
        const controller = this.playbackController;
        if (controller?.registerAdapter && typeof window.TorrentAdapter === 'function') {
            if (!controller.getAdapter(MOVIE_DETAILS_TORRENT_SOURCE)) controller.registerAdapter(new window.TorrentAdapter());
            video.dataset.progressOwner = 'canonical';
            video._torrentPlaybackSnapshot = this.latestTorrentPlaybackProgress?.playback || null;
            controller.attachExternalVideo(video, { providerId: MOVIE_DETAILS_TORRENT_SOURCE, selection: controller.getSelection() });
        }
        this.applyTorrentTrackSnapshot(video);
        void this.refreshTorrentTracks();
        const updateAvailability = () => this.updateTorrentPlaybackAvailability(video);
        const events = ['loadedmetadata', 'durationchange', 'progress', 'canplay'];
        events.forEach(eventName => video.addEventListener(eventName, updateAvailability));
        this.torrentPlaybackVideoCleanup = () => {
            events.forEach(eventName => video.removeEventListener(eventName, updateAvailability));
            this.torrentPlaybackVideoCleanup = null;
            this.torrentPlaybackVideo = null;
            this.torrentPlaybackAvailableDurationSeconds = null;
        };
        updateAvailability();
    }

    detachTorrentPlaybackVideo() {
        this.clearTorrentSubtitleResources();
        if (this.torrentPlaybackVideo && this.playbackController?.externalVideoElement === this.torrentPlaybackVideo) {
            this.playbackController.flushProgress({ force: true });
            this.playbackController.detachExternalVideo();
        }
        if (this.torrentPlaybackStartTimer) clearTimeout(this.torrentPlaybackStartTimer);
        this.torrentPlaybackStartTimer = null;
        if (this.torrentPlaybackVideoCleanup) {
            this.torrentPlaybackVideoCleanup();
            return;
        }
        this.torrentPlaybackVideo = null;
        this.torrentPlaybackAvailableDurationSeconds = null;
    }

    disposeTorrentPlaybackVideo() {
        const video = this.torrentPlaybackVideo;
        // A newer source may already own currentHls. Dispose only this video's instance.
        const hls = video?._movieExtensionHls
            || (video && this.currentHls?.media === video ? this.currentHls : null);
        video?.pause();
        this.detachTorrentPlaybackVideo();
        if (hls) {
            if (this.currentHls === hls) this.currentHls = null;
            delete video._movieExtensionHls;
            hls.destroy();
        }
        video?.removeAttribute?.('src');
        video?.load?.();
    }

    getTorrentTrackLabel(track) {
        return [track.title || track.language || `Дорожка ${track.streamIndex + 1}`,
            track.channels ? `${track.channels} ch` : '', track.codec || ''].filter(Boolean).join(' · ');
    }

    clearTorrentSubtitleResources() {
        this.torrentSubtitleAbortController?.abort();
        this.torrentSubtitleAbortController = null;
        for (const url of this.torrentSubtitleBlobUrls || []) URL.revokeObjectURL(url);
        this.torrentSubtitleBlobUrls = new Set();
    }

    async loadTorrentSubtitle(video, track, subtitle, session, controller) {
        const service = this.mediaPlayerService;
        const url = new URL(service.normalizeServiceUrl(subtitle.url));
        const manifest = new URL(service.normalizeServiceUrl(session.hlsUrl));
        if (!Number.isSafeInteger(subtitle.streamIndex) || subtitle.streamIndex < 0
            || url.origin !== manifest.origin
            || url.pathname !== `/api/playback/sessions/${encodeURIComponent(session.sessionId)}/subtitles/${subtitle.streamIndex}.vtt`
            || !manifest.searchParams.get('token') || url.searchParams.get('token') !== manifest.searchParams.get('token')
            || url.username || url.password || url.hash) throw new Error('Invalid subtitle capability');
        const requestController = new AbortController();
        const abort = () => requestController.abort();
        if (controller.signal.aborted) abort();
        else controller.signal.addEventListener('abort', abort, { once: true });
        const timer = setTimeout(abort, 35_000);
        let reader;
        try {
            // Keep the same abort signal through headers and the entire body.
            const response = await service.fetchImpl(url.toString(), {
                headers: { Accept: 'text/vtt' }, redirect: 'error', credentials: 'omit', signal: requestController.signal
            });
            if (!response.ok || !/^text\/vtt(?:\s*;|$)/i.test(response.headers.get('content-type') || '')
                || Number(response.headers.get('content-length')) > 4 * 1024 * 1024 || !response.body) {
                await response.body?.cancel();
                throw new Error('Subtitle unavailable');
            }
            reader = response.body.getReader();
            const chunks = [];
            let bytes = 0;
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                bytes += value.byteLength;
                if (bytes > 4 * 1024 * 1024) throw new Error('Subtitle too large');
                chunks.push(value);
            }
            if (requestController.signal.aborted || this.torrentPlaybackSession !== session
                || this.torrentPlaybackVideo !== video || !video.contains(track)) return;
            const blob = new Blob(chunks, { type: 'text/vtt' });
            if (!/^\uFEFF?WEBVTT(?:\s|$)/.test(await blob.text())) throw new Error('Invalid subtitle content');
            if (requestController.signal.aborted || this.torrentPlaybackSession !== session
                || this.torrentPlaybackVideo !== video || !video.contains(track)) return;
            const blobUrl = URL.createObjectURL(blob);
            this.torrentSubtitleBlobUrls.add(blobUrl);
            track.src = blobUrl;
        } finally {
            clearTimeout(timer);
            controller.signal.removeEventListener('abort', abort);
            await reader?.cancel().catch(() => undefined);
        }
    }

    applyTorrentTrackSnapshot(video = this.torrentPlaybackVideo) {
        const snapshot = this.torrentTracksSnapshot;
        if (!video || !snapshot) return;
        video._movieExtensionMediaTracks = {
            audio: snapshot.audio.map(track => ({ ...track, label: this.getTorrentTrackLabel(track) })),
            subtitles: snapshot.subtitles,
            selectedAudioStreamIndex: snapshot.selectedAudioStreamIndex,
            selectAudio: streamIndex => { void this.changeTorrentAudioTrack(streamIndex); }
        };
        const previousModes = new Map(Array.from(video.querySelectorAll('track[data-torrent-subtitle]'))
            .map(track => [track.dataset.torrentSubtitle, track.track?.mode]));
        this.clearTorrentSubtitleResources();
        const controller = new AbortController();
        this.torrentSubtitleAbortController = controller;
        const session = this.torrentPlaybackSession;
        const pending = [];
        video.querySelectorAll('track[data-torrent-subtitle]').forEach(track => track.remove());
        for (const subtitle of snapshot.subtitles) {
            if (!subtitle.supported || !subtitle.url) continue;
            const track = document.createElement('track');
            track.kind = 'subtitles';
            track.dataset.torrentSubtitle = String(subtitle.streamIndex);
            track.label = this.getTorrentTrackLabel(subtitle);
            track.srclang = subtitle.language || 'und';
            const mode = previousModes.get(String(subtitle.streamIndex))
                || (this.torrentSubtitlePreference === String(subtitle.streamIndex) ? 'showing' : 'disabled');
            video.append(track);
            if (track.track) track.track.mode = mode;
            pending.push({ track, subtitle });
        }
        // Fetch only the selected language, serially, within the converter pool limit.
        const attempted = new Set();
        let loading = false;
        const selectedTrack = () => {
            const enabled = pending.filter(({ track }) => video.contains(track) && track.track?.mode !== 'disabled');
            const selected = enabled.find(({ subtitle }) => this.torrentSubtitlePreference === String(subtitle.streamIndex)) || enabled[0];
            // Native automatic selection can enable extra tracks as they are appended.
            for (const item of enabled) if (item !== selected) item.track.track.mode = 'disabled';
            this.torrentSubtitlePreference = selected ? String(selected.subtitle.streamIndex) : null;
            return selected;
        };
        const loadSelected = async () => {
            if (controller.signal.aborted) return;
            selectedTrack();
            if (loading) return;
            loading = true;
            try {
                let selected;
                while (!controller.signal.aborted && (selected = selectedTrack()) && !attempted.has(selected.track)) {
                    const { track, subtitle } = selected;
                    attempted.add(track);
                    try {
                        await this.loadTorrentSubtitle(video, track, subtitle, session, controller);
                    } catch {
                        if (controller.signal.aborted || this.torrentPlaybackSession !== session || this.torrentPlaybackVideo !== video) return;
                        track.remove();
                        this.setTorrentSourceStatus('Не удалось загрузить субтитры. Повторите запуск просмотра.', 'error');
                        video.dispatchEvent(new Event('extension-player-tracks-ready'));
                    }
                }
            } finally {
                loading = false;
            }
        };
        const onTrackChange = () => { void loadSelected(); };
        video.textTracks.addEventListener('change', onTrackChange);
        controller.signal.addEventListener('abort', () => video.textTracks.removeEventListener('change', onTrackChange), { once: true });
        void loadSelected();
        video.dispatchEvent(new Event('extension-player-tracks-ready'));
    }

    async refreshTorrentTracks() {
        const session = this.torrentPlaybackSession;
        if (!session || !this.mediaPlayerService?.getPlaybackTracks
            || this.mediaPlayerService.capabilities?.playback?.trackSelection !== true) return;
        if (this.torrentTracksRequestSession === session.sessionId) return;
        this.torrentTracksRequestSession = session.sessionId;
        try {
            const tracks = await this.mediaPlayerService.getPlaybackTracks(session);
            if (this.torrentPlaybackSession !== session) return;
            this.torrentTracksSnapshot = tracks;
            this.applyTorrentTrackSnapshot();
        } catch {
            if (this.torrentPlaybackSession !== session) return;
            if (this.latestTorrentPlaybackProgress?.playback?.isReady) {
                this.setTorrentSourceStatus('Не удалось получить дорожки. Повторите запуск просмотра.', 'error');
            }
        } finally {
            if (this.torrentTracksRequestSession === session.sessionId) this.torrentTracksRequestSession = null;
        }
    }

    getTorrentVideoResume(video) {
        return { currentTime: Number(video?.currentTime) || 0, paused: video?.paused !== false,
            volume: video?.volume ?? 1, muted: video?.muted === true, playbackRate: video?.playbackRate || 1 };
    }

    async changeTorrentAudioTrack(audioStreamIndex) {
        const session = this.torrentPlaybackSession;
        const snapshot = this.torrentTracksSnapshot;
        if (!session || !snapshot?.audio.some(track => track.streamIndex === audioStreamIndex)
            || snapshot.selectedAudioStreamIndex === audioStreamIndex) return false;
        const video = this.torrentPlaybackVideo;
        const pending = this.torrentAudioSwitch;
        const resume = pending?.session === session && pending.video === video
            ? pending.resume : this.getTorrentVideoResume(video);
        const operation = { session, video, resume };
        this.torrentAudioSwitch = operation;
        this.torrentSubtitlePreference = video?.querySelector('track[data-torrent-subtitle]')
            ? Array.from(video.querySelectorAll('track[data-torrent-subtitle]')).find(track => track.track?.mode === 'showing')?.dataset.torrentSubtitle || null : null;
        this.setTorrentSourceStatus('Переключаем озвучку. Позиция просмотра сохранена…');
        try {
            // Keep the old session playing while the selected audio is prepared.
            if (session.downloadId) return await this.playSavedTorrent(session.downloadId, { audioStreamIndex, resume });
            const args = this.torrentPlaybackSourceArgs;
            return args ? await this.startTorrentPlayback(args.sourceId, args.fileId, { audioStreamIndex, resume }) : false;
        } finally {
            if (this.torrentAudioSwitch === operation) this.torrentAudioSwitch = null;
        }
    }

    waitForTorrentPlaybackStart(video, isCurrentPlayer) {
        if (this.torrentPlaybackStartTimer) clearTimeout(this.torrentPlaybackStartTimer);
        this.torrentPlaybackStartTimer = null;

        const attempt = () => {
            if (!isCurrentPlayer()) return;

            const playback = this.latestTorrentPlaybackProgress?.playback || null;
            const requiredSeconds = Number(playback?.startupBufferSeconds)
                || (playback?.mode === 'transcode' ? 15 : 2);
            const availableSeconds = Number(playback?.availableDurationSeconds);
            const bufferedSeconds = video.buffered?.length
                ? Math.max(0, video.buffered.end(video.buffered.length - 1) - video.currentTime)
                : 0;
            const enoughBuffered = bufferedSeconds >= Math.min(
                requiredSeconds,
                Number.isFinite(availableSeconds) && availableSeconds > 0
                    ? availableSeconds
                    : requiredSeconds
            );
            const ready = video.readyState >= 2
                && (playback?.isComplete || enoughBuffered || (playback?.isReady && video.readyState >= 3));

            if (ready) {
                const resume = this.torrentPlaybackResume;
                if (resume) {
                    // A new HLS stream keeps the full timeline. Wait until the
                    // saved position is seekable instead of restarting at zero.
                    const target = resume.currentTime;
                    const seekableEnd = video.seekable?.length ? video.seekable.end(video.seekable.length - 1) : 0;
                    if (target > 0 && seekableEnd < target && !playback?.isComplete) {
                        this.torrentPlaybackSeekDeadline ||= Date.now() + 30_000;
                        if (Date.now() >= this.torrentPlaybackSeekDeadline) {
                            this.torrentPlaybackResume = null;
                            this.torrentPlaybackSeekDeadline = null;
                            this.setTorrentSourceStatus('Позиция просмотра ещё не готова. Возобновите просмотр после буферизации.', 'error');
                            video.pause();
                            return;
                        }
                        this.torrentPlaybackStartTimer = setTimeout(attempt, 400);
                        return;
                    }
                    video.currentTime = Math.min(target, Number.isFinite(video.duration) ? video.duration : target);
                    video.volume = resume.volume;
                    video.muted = resume.muted;
                    video.playbackRate = resume.playbackRate;
                    this.torrentPlaybackResume = null;
                    this.torrentPlaybackSeekDeadline = null;
                }
                this.torrentPlaybackStartTimer = null;
                this.hlsPlaybackState = '';
                this.renderTorrentPlaybackStatus();
                if (resume?.paused) { video.pause(); return; }
                video.play().catch(error => console.log('Autoplay blocked', error));
                return;
            }

            if (playback?.state === 'transcoding' && !playback?.isReady) {
                this.hlsPlaybackState = `Буферизация перед запуском · нужно ${requiredSeconds} с`;
            } else if (playback?.state === 'probing') {
                this.hlsPlaybackState = 'Определяем формат видео…';
            }
            this.renderTorrentPlaybackStatus();
            this.torrentPlaybackStartTimer = setTimeout(attempt, 400);
        };

        attempt();
    }

    startTorrentProgressMonitoring(session) {
        this.stopTorrentProgressMonitoring();
        if (!session?.progressUrl || !this.mediaPlayerService) return;
        const monitorToken = ++this.torrentProgressMonitorToken;
        const abortController = new AbortController();
        this.torrentProgressAbortController = abortController;
        this.torrentProgressPollDelayMs = 2500;
        const schedulePoll = () => {
            if (monitorToken !== this.torrentProgressMonitorToken) return;
            this.torrentProgressTimer = setTimeout(() => void poll(), this.torrentProgressPollDelayMs);
        };
        const poll = async () => {
            if (monitorToken !== this.torrentProgressMonitorToken) return;
            if (this.torrentProgressRequestActive || this.torrentPlaybackSession?.sessionId !== session.sessionId) return;
            this.torrentProgressRequestActive = true;
            try {
                const progress = await this.mediaPlayerService.getPlaybackProgress(session.progressUrl, {
                    signal: abortController.signal
                });
                if (this.torrentPlaybackSession?.sessionId === session.sessionId) {
                    this.torrentServiceHealth = 'healthy';
                    this.torrentProgressPollDelayMs = 2500;
                    this.torrentHasPlaybackSnapshot = true;
                    this.renderTorrentPlaybackStatus(progress || {});
                    const trackState = progress?.playback?.isComplete ? 'complete'
                        : progress?.playback?.isReady ? 'ready' : '';
                    if (trackState && trackState !== this.torrentTracksRefreshState) {
                        this.torrentTracksRefreshState = trackState;
                        void this.refreshTorrentTracks();
                    }
                }
            } catch (error) {
                if (monitorToken !== this.torrentProgressMonitorToken) return;
                const requestAborted = this.mediaPlayerService.isRequestAbortedError?.(error) === true
                    || error?.code === 'request_aborted';
                if (requestAborted) return;
                if (this.torrentPlaybackSession?.sessionId === session.sessionId) {
                    const serviceUnavailable = this.mediaPlayerService.isServiceUnavailableError?.(error) === true;
                    if (serviceUnavailable) {
                        this.torrentServiceHealth = 'unavailable';
                        this.torrentProgressPollDelayMs = Math.min(
                            30_000,
                            Math.max(5_000, this.torrentProgressPollDelayMs * 2)
                        );
                        this.hlsPlaybackState = `${this.getTorrentServiceUnavailableMessage()} · повторяем проверку…`;
                        this.renderTorrentPlaybackStatus();
                    } else {
                        this.torrentProgressPollDelayMs = 2500;
                        this.renderTorrentPlaybackStatus({
                            ...this.latestTorrentPlaybackProgress,
                            state: 'error',
                            errorMessage: error?.message
                        });
                    }
                }
            } finally {
                if (monitorToken === this.torrentProgressMonitorToken) {
                    this.torrentProgressRequestActive = false;
                    if (this.torrentPlaybackSession?.sessionId === session.sessionId) schedulePoll();
                }
            }
        };
        void poll();
    }

    stopTorrentProgressMonitoring() {
        this.torrentProgressMonitorToken += 1;
        this.torrentProgressAbortController?.abort();
        this.torrentProgressAbortController = null;
        if (this.torrentProgressTimer) clearTimeout(this.torrentProgressTimer);
        this.torrentProgressTimer = null;
        this.torrentProgressPollDelayMs = 2500;
        this.torrentProgressRequestActive = false;
    }

    async revokeTorrentPlaybackSession() {
        const session = this.torrentPlaybackSession;
        this.torrentPlaybackSession = null;
        this.torrentPlaybackGeneration = (this.torrentPlaybackGeneration || 0) + 1;
        this.torrentAudioSwitch = null;
        this.torrentPlaybackResume = null;
        this.torrentPlaybackSeekDeadline = null;
        this.stopTorrentProgressMonitoring();
        this.disposeTorrentPlaybackVideo();
        if (!session?.sessionId || !this.mediaPlayerService) return;
        try {
            await this.mediaPlayerService.revokePlaybackSession(session.sessionId);
        } catch (error) {
            console.warn('[MovieDetails] Failed to revoke MediaPlayer playback session:', error?.code || error);
        }
    }
}

function installMovieDetailsTorrentPanel(targetClass) {
    const source = MovieDetailsTorrentPanelMethods.prototype;
    Object.getOwnPropertyNames(source).forEach(name => {
        if (name === 'constructor') return;
        if (Object.prototype.hasOwnProperty.call(targetClass.prototype, name)) {
            throw new Error(`MovieDetails already defines ${name}`);
        }
        Object.defineProperty(targetClass.prototype, name, Object.getOwnPropertyDescriptor(source, name));
    });
    return targetClass;
}

if (typeof window !== 'undefined') {
    window.MovieDetailsTorrentPanelMethods = MovieDetailsTorrentPanelMethods;
    window.installMovieDetailsTorrentPanel = installMovieDetailsTorrentPanel;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MovieDetailsTorrentPanelMethods, installMovieDetailsTorrentPanel, MOVIE_DETAILS_TORRENT_SOURCE };
}
