/**
 * BaseParserService - Abstract base class for all video source parsers.
 * All parsers MUST extend this class and implement search() and getVideoSources().
 * 
 * @abstract
 */
class BaseParserService {
    /**
     * @param {Object} config
     * @param {string} config.id - Unique parser identifier (e.g. 'exfs', 'seasonvar')
     * @param {string} config.name - Human-readable name (e.g. 'Ex-FS', 'Seasonvar')
     * @param {string} config.baseUrl - Base URL of the source website
     * @param {number} [config.cacheTTL=3600000] - Cache TTL in ms (default: 1 hour)
     * @param {number} [config.requestTimeoutMs=8000] - Per-request network deadline in ms
     */
    constructor({ id, name, baseUrl, cacheTTL = 3600000, requestTimeoutMs = 8000 }) {
        if (new.target === BaseParserService) {
            throw new TypeError('BaseParserService is abstract and cannot be instantiated directly');
        }
        if (!id || !name) {
            throw new Error('Parser must have id and name');
        }

        /** @type {string} */
        this.id = id;
        /** @type {string} */
        this.name = name;
        /** @type {string} */
        this.baseUrl = baseUrl;
        /** @type {number} */
        this.cacheTTL = cacheTTL;
        /** @type {number} */
        this.requestTimeoutMs = requestTimeoutMs;
        /** @private @type {Map<string, {data: any, timestamp: number}>} */
        this._searchCache = new Map();
        /** @private @type {Map<string, Promise<any>>} */
        this._searchInFlight = new Map();
        /** @private @type {Map<string, {data: Array<VideoSource>, timestamp: number}>} */
        this._sourceCache = new Map();
        this._embedChecks = new Map();
        /** @private @type {Map<string, Promise<Array<VideoSource>>>} */
        this._sourceInFlight = new Map();
        /** @private @type {number} */
        this._cacheGeneration = 0;
    }

    // ─── Abstract Methods (MUST be implemented) ───────────────────────

    /**
     * Search for a movie/series by title and year.
     * @param {string} title - Movie or series title
     * @param {string|number|null} year - Release year
     * @returns {Promise<SearchResult|null>} Found result or null
     * @abstract
     */
    async search(title, year) {
        throw new Error(`${this.constructor.name}.search() is not implemented`);
    }

    /**
     * Get video sources/players from a search result.
     * @param {SearchResult} searchResult - Result from search()
     * @returns {Promise<Array<VideoSource>>} List of video sources
     * @abstract
     */
    async getVideoSources(searchResult) {
        throw new Error(`${this.constructor.name}.getVideoSources() is not implemented`);
    }

    // ─── Optional Methods (CAN be overridden) ─────────────────────────

    /**
     * Render a player for this parser's sources.
     * Default implementation prefers getPlayerType(), then falls back to any valid source type.
     * Override for custom player UIs (e.g. Seasonvar's episode selector).
     * 
     * @param {HTMLElement} container - DOM container element
     * @param {Array<VideoSource>} sources - Video sources
     * @param {Object} [options] - Additional options
     * @returns {boolean} Whether a compatible source was rendered
     */
    renderPlayer(container, sources, options = {}) {
        if (!sources || sources.length === 0) {
            container.innerHTML = '<div class="video-placeholder"><span>Источники не найдены</span></div>';
            return false;
        }

        const preferredPlayerType = this.getPlayerType();
        const compatibleSources = sources.filter(candidate => this.supportsSourceType(candidate));
        const source = compatibleSources.find(candidate =>
            this.getSourcePlayerType(candidate) === preferredPlayerType
        ) || compatibleSources[0];
        if (!source) {
            console.warn(`[BaseParserService] ${this.id} has no supported iframe/video sources`);
            container.innerHTML = '<div class="video-placeholder"><span>Совместимые источники не найдены</span></div>';
            return false;
        }

        const playerType = this.getSourcePlayerType(source);

        container._hlsMountVideo = null;
        if (container._hlsInstance) {
            try { container._hlsInstance.destroy?.(); } catch { /* ignore */ }
            container._hlsInstance = null;
        }

        if (playerType === 'video') {
            const isHls = source.type === 'hls' || source.url?.includes('.m3u8');
            const mediaSrc = toPlayerMediaSrcAttribute(source.url);
            if (!mediaSrc) {
                console.warn(`[${this.name}] Rejected media URL with an unsupported scheme`);
                container.innerHTML = '<div class="video-placeholder"><span>Источник вернул некорректный адрес видео</span></div>';
                return false;
            }
            if (isHls) {
                container.innerHTML = `<video class="player-surface__media" controls playsinline></video>`;
            } else {
                container.innerHTML = `<video class="player-surface__media" controls playsinline src="${mediaSrc}"><source src="${mediaSrc}" type="video/mp4"></video>`;
            }
            const video = container.querySelector?.('video');

            if (isHls && video && typeof window !== 'undefined') {
                container._hlsMountVideo = video;
                const isCurrent = () => container._hlsMountVideo === video
                    && !video._movieExtensionStreamFailed
                    && (!options.isRequestCurrent || options.isRequestCurrent());
                const fail = (reason) => {
                    if (!isCurrent()) return false;
                    return this._handleStreamFailure({ container, video, failedSource: source, sources, options, reason });
                };
                const mountHls = () => {
                    if (!isCurrent()) return;
                    const factory = window.HlsPlaybackFactory;
                    const hls = factory?.create(video, source.url, {
                        networkProfile: 'remote',
                        onSourceExpired: options.onSourceExpired,
                        isCurrent,
                        beforeLoad: (instance) => {
                            container._hlsInstance = instance;
                            video._movieExtensionHls = instance;
                        },
                        onFatal: ({ reason }) => fail(reason)
                    });
                    if (hls && isCurrent()) {
                        container._hlsInstance = hls;
                        video._movieExtensionHls = hls;
                        // The shared native-player menu owns all visible controls.
                        // Keep the HLS instance on its media element so that menu can
                        // expose its quality choices without creating a second control.
                        video.dataset.playerProvider = this.id;
                    } else if (!hls) fail('unsupported');
                };

                if (typeof Hls !== 'undefined') {
                    mountHls();
                } else if (window.LazyLoader) {
                    window.LazyLoader.loadScript('../../shared/lib/hls.min.js').then(mountHls).catch(err => {
                        console.warn('[BaseParserService] Failed to load HLS library:', globalThis.PlayerDiagnostics?.sanitizeError(err) || { category: 'unknown' });
                        fail('unsupported');
                    });
                } else fail('unsupported');
            }
        } else {
            const frameUrl = BalancerDomains.actualize(this.getFrameUrl(source, options));
            const iframeSourceUrl = toPlayerFrameSrcAttribute(withVenomAdFreeParam(frameUrl, this.baseUrl));
            if (!iframeSourceUrl) {
                console.warn(`[${this.name}] Rejected player URL with an unsupported scheme`);
                container.innerHTML = '<div class="video-placeholder"><span>Источник вернул некорректный адрес плеера</span></div>';
                return false;
            }
            const iframeReferrerPolicy = isVenomProviderUrl(frameUrl)
                ? ' referrerpolicy="no-referrer"'
                : '';
            const sandbox = typeof window !== 'undefined'
                ? window.MovieDetailsPlayerSurface?.getProviderSandbox?.(frameUrl) : null;
            const sandboxAttribute = sandbox ? ` sandbox="${escapePlayerAttribute(sandbox)}"` : '';
            container.innerHTML = `<iframe class="player-surface__media" src="${iframeSourceUrl}"${iframeReferrerPolicy}${sandboxAttribute} allowfullscreen allow="autoplay; fullscreen" title="${escapePlayerAttribute(this.name)} player"></iframe>`;
        }

        const lifecycle = typeof window !== 'undefined' ? window.PlayerSourceLifecycle : null;
        const playerElement = container.querySelector?.(playerType === 'video' ? 'video' : 'iframe');
        if (playerElement) {
            playerElement.dataset.playerSourceActive = 'true';
            if (options.requestId !== null && options.requestId !== undefined) {
                playerElement.dataset.playerRequestId = String(options.requestId);
            }
        }
        if (lifecycle && playerElement && options.lifecycle !== false) {
            container._playerSourceWatcher?.cancel?.();
            // A runtime fallback renders off-DOM and is then swapped in; its
            // overlay belongs to the element's real host.
            const lifecycleHost = options.lifecycleHost || container;
            const onState = (state, detail) => {
                if (options.isRequestCurrent && !options.isRequestCurrent()) return;
                lifecycle.setState(lifecycleHost, state, {
                    message: options.lifecycleMessage,
                    onRetry: options.onRetry || (() => this.renderPlayer(container, sources, options)),
                    onResearch: options.onResearch,
                    onTryOther: options.onTryOther
                });
                options.onLifecycleState?.(state, { ...detail, source, parserId: this.id });
            };
            const watch = playerType === 'video' ? lifecycle.watchVideo : lifecycle.watchIframe;
            container._playerSourceWatcher = watch(playerElement, {
                timeoutMs: options.timeoutMs,
                isRequestCurrent: options.isRequestCurrent,
                onState
            });
        }

        if (playerType === 'iframe' && playerElement) {
            this._watchFrameHello({ frame: playerElement, container, source, sources, options });
        }

        // Mount first; probe availability in parallel. Ignore stale mounts.
        if (playerType === 'iframe' && playerElement
            && (BaseParserService.isCheckableEmbedUrl(BalancerDomains.actualize(source.url)) || BalancerDomains.isUnknownEmbed(source.url))) {
            const mountedHost = BalancerDomains.actualHost;
            void this.checkEmbedAvailable(source.url).then(available => {
                if (!playerElement.isConnected
                    || (options.isRequestCurrent && !options.isRequestCurrent())) return;
                // The balancer moved while this frame loaded, or the page printed its new
                // domain before anyone knew it: the same sources work from there.
                if (BalancerDomains.actualHost !== mountedHost && container.isConnected) {
                    this.renderPlayer(container, sources, options);
                    return;
                }
                if (available) return;
                this._handleStreamFailure({ container, video: playerElement, failedSource: source,
                    sources, options, reason: 'embed-missing' });
            });
        }
        return true;
    }

    /**
     * The extension's scripts greet the page from inside every balancer frame. Silence means
     * they are not there, and the frame shows the balancer's own player: the scripts are
     * registered again and the frame is mounted once more, then the next source takes over.
     * @private
     */
    _watchFrameHello({ frame, container, source, sources, options }) {
        const view = frame.ownerDocument?.defaultView;
        if (!view || options.frameHello === false || !isVenomProviderUrl(BalancerDomains.actualize(source.url))
            || typeof view.chrome?.scripting?.registerContentScripts !== 'function') return;
        let timer = null;
        const stop = () => {
            view.clearTimeout(timer);
            frame.removeEventListener('load', arm);
            view.removeEventListener('message', listen);
        };
        const current = () => frame.isConnected && (!options.isRequestCurrent || options.isRequestCurrent());
        const listen = event => {
            if (event.source === frame.contentWindow && /^PLAYER_/.test(String(event.data?.type || ''))) stop();
        };
        const expire = async () => {
            if (!current()) { stop(); return; }
            // Chrome holds back a hidden page's frames.
            if (frame.ownerDocument.hidden) { arm(); return; }
            stop();
            const domain = BalancerDomains.domainOf(BalancerDomains.actualHost);
            console.warn('[BaseParserService] The player frame stayed silent', {
                providerId: globalThis.PlayerDiagnostics?.safeSourceId(this.id) || 'unknown', domain
            });
            if (!await BalancerDomains.hasAccess()) {
                if (current()) this._askForFrameAccess({ container, sources, options });
                return;
            }
            if (!options.frameRecovery) {
                await BalancerDomains.attachFrameScripts({ force: true });
                if (current() && container.isConnected) this.renderPlayer(container, sources, { ...options, frameRecovery: true });
                return;
            }
            if (current()) this._handleStreamFailure({ container, video: frame, failedSource: source, sources, options, reason: 'player-missing' });
        };
        const arm = () => {
            view.clearTimeout(timer);
            timer = view.setTimeout(expire, FRAME_HELLO_TIMEOUT_MS);
        };
        frame.addEventListener('load', arm);
        view.addEventListener('message', listen);
    }

    /**
     * The balancer left the zone the extension has access to. Chrome asks the viewer once;
     * the request needs their click, so the player offers it.
     * @private
     */
    _askForFrameAccess({ container, sources, options }) {
        const lifecycle = typeof window !== 'undefined' ? window.PlayerSourceLifecycle : null;
        lifecycle?.setState(options.lifecycleHost || container, 'error', {
            message: 'Источник переехал на новый адрес. Нажмите «Повторить» и разрешите доступ: Chrome спросит один раз.',
            onRetry: async () => {
                await BalancerDomains.requestAccess();
                this.renderPlayer(container, sources, { ...options, frameRecovery: false });
            },
            onResearch: options.onResearch,
            onTryOther: options.onTryOther
        });
        options.onLifecycleState?.('error', { reason: 'frame-access', parserId: this.id });
    }

    /**
     * A stream failed after HlsPlaybackFactory exhausted its recovery (expired
     * signed manifest, repeated network or decode failures). Swap the player in
     * place for the next compatible source of this parser (for example the
     * Rutube embed after its direct HLS), or show the source error state.
     * @returns {boolean} true when a fallback source was mounted
     * @private
     */
    _handleStreamFailure({ container, video, failedSource, sources, options = {}, reason }) {
        if (options.isRequestCurrent && !options.isRequestCurrent()) return false;
        if (!video || video._movieExtensionStreamFailed) return false;
        video._movieExtensionStreamFailed = true;

        const hls = video._movieExtensionHls;
        // Policy failures already destroy their transport in the factory.
        if (reason !== 'policy') {
            try { hls?.destroy?.(); } catch { /* ignore */ }
        }
        video._movieExtensionHls = null;
        if (container?._hlsInstance === hls) container._hlsInstance = null;

        // The shared cleaner may have wrapped this same element in its UI.
        const mountRoot = video.closest?.('.native-player-wrapper') || video;
        const host = mountRoot.parentElement || container;
        const failedSourceUrls = [...(options.failedSourceUrls || []), failedSource?.url].filter(Boolean);
        const remaining = (sources || []).filter(candidate =>
            candidate
            && candidate !== failedSource
            && !failedSourceUrls.includes(candidate.url)
            && this.supportsSourceType(candidate)
        );

        console.warn('[BaseParserService] Stream failed', {
            providerId: globalThis.PlayerDiagnostics?.safeSourceId(this.id) || 'unknown', fallback: remaining.length > 0
        });

        const doc = typeof document !== 'undefined' ? document : null;
        if (remaining.length > 0 && doc && mountRoot.parentElement) {
            const staging = doc.createElement('div');
            const fallbackOptions = { ...options, failedSourceUrls, lifecycleHost: host };
            const rendered = this.renderPlayer(staging, remaining, fallbackOptions);
            const replacement = staging.firstElementChild;
            if (rendered && replacement) {
                container?._playerSourceWatcher?.cancel?.();
                mountRoot.replaceWith(replacement);
                if (container) {
                    container._hlsInstance = staging._hlsInstance || null;
                    container._playerSourceWatcher = staging._playerSourceWatcher || null;
                }
                options.onSourceFallback?.({ from: failedSource, reason, parserId: this.id });
                return true;
            }
        }

        const lifecycle = typeof window !== 'undefined' ? window.PlayerSourceLifecycle : null;
        lifecycle?.setState(host, 'error', {
            message: 'Поток недоступен: ссылка устарела или сервер не отвечает.',
            onRetry: options.onRetry || (() => this.renderPlayer(container, sources, options)),
            onResearch: options.onResearch,
            onTryOther: options.onTryOther
        });
        options.onLifecycleState?.('error', { reason: reason || 'stream-failed', source: failedSource, parserId: this.id });
        return false;
    }

    /**
     * The address a source's frame is opened at. A parser whose balancer takes the
     * season and episode in the address overrides this (`options.season`, `options.episode`).
     * @param {VideoSource} source
     * @param {Object} [_options] The render options
     * @returns {string}
     */
    getFrameUrl(source, _options = {}) {
        return source.url;
    }

    /**
     * Check whether a VideoSource can be mounted by the base renderer.
     * Compatibility belongs to the individual source; getPlayerType() is only a preference.
     * @param {VideoSource} source
     * @returns {boolean}
     */
    supportsSourceType(source) {
        return this.getSourcePlayerType(source) !== null;
    }

    /**
     * Resolve the DOM player type for one source.
     * Legacy sources without a type are treated as iframe sources.
     * @param {VideoSource} source
     * @returns {'iframe'|'video'|null}
     */
    getSourcePlayerType(source) {
        const sourceType = source?.type || 'iframe';
        if (sourceType === 'iframe') return 'iframe';
        if (sourceType === 'video' || sourceType === 'hls') return 'video';
        return null;
    }

    /**
     * Return the player type this parser uses.
     * @returns {'iframe'|'video'|'custom'} Player type
     */
    getPlayerType() {
        return 'iframe';
    }

    /**
     * Return the list of supported movie types for this parser.
     * Return null to indicate all types are supported.
     * @returns {Array<string>|null} Supported types (e.g. ['tv-series', 'cartoon', 'anime']) or null for all
     */
    getSupportedTypes() {
        return null;
    }

    /**
     * Check if this parser supports the given movie type.
     * @param {string} movieType - The movie type to check
     * @returns {boolean}
     */
    supportsType(movieType) {
        const supported = this.getSupportedTypes();
        if (!supported) return true; // null = all types supported
        return supported.includes(movieType);
    }

    /**
     * Check whether this parser should be offered for a concrete title.
     * Defaults to the media-type gate; parsers whose audience is not a type
     * (for example anime, which providers label as series or films) override it.
     * @param {Object|null} _movie - Selected movie DTO
     * @param {string|null} mediaType - Normalized media type, if known
     * @returns {boolean}
     */
    supportsMedia(_movie, mediaType) {
        return !mediaType || this.supportsType(mediaType);
    }

    isSearchResultCompatible(_result, _movieType) {
        return true;
    }

    // ─── Title Matching ───────────────────────────────────────────────

    /**
     * Lowercase, fold ё to е, and reduce punctuation to single spaces.
     * @param {*} value
     * @returns {string}
     */
    static normalizeTitle(value) {
        return String(value ?? '')
            .toLowerCase()
            .replace(/ё/g, 'е')
            .replace(/[^a-zа-я0-9\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * normalizeTitle() without spaces, for exact-title comparisons.
     * @param {*} value
     * @returns {string}
     */
    static compactTitle(value) {
        return BaseParserService.normalizeTitle(value).replace(/\s/g, '');
    }

    /**
     * Whole-word title comparison shared by search-page parsers.
     * Sequel and part numbers must agree, so "Джон Уик" does not match
     * "Джон Уик 3", and a bracketed release year in the provider title is
     * ignored. With `allowSeriesSuffix` an explicit season suffix
     * ("Джек Ричер 4 сезон") is stripped from the found title.
     * @param {string} foundTitle
     * @param {string} targetTitle
     * @param {{allowSeriesSuffix?: boolean}} [options]
     * @returns {boolean}
     */
    isTitleMatch(foundTitle, targetTitle, options = {}) {
        if (!foundTitle || !targetTitle) return false;
        const normalize = BaseParserService.normalizeTitle;
        let cleanFound = normalize(String(foundTitle).replace(/\(\s*(?:19|20)\d{2}\s*\)/g, ' '));
        const cleanTarget = normalize(targetTitle);
        if (!cleanFound || !cleanTarget) return false;
        if (cleanFound === cleanTarget) return true;

        if (options.allowSeriesSuffix) {
            cleanFound = cleanFound.replace(
                /\s+(?:(?:\d+|i|ii|iii|iv|v|vi|vii|viii|ix|x)\s+)?(?:сезон(?:а|ов)?|season|series)(?:\s.*)?$/i,
                ''
            ).trim();
            if (cleanFound === cleanTarget) return true;
        }

        const romanMap = { i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10' };
        const extractNumbers = words => words
            .filter(word => /^(?:\d+|i|ii|iii|iv|v|vi|vii|viii|ix|x)$/.test(word))
            .map(word => romanMap[word] || String(Number(word)));

        const targetWordList = cleanTarget.split(' ');
        const foundWordList = cleanFound.split(' ');
        const targetNumbers = extractNumbers(targetWordList);
        const foundNumbers = extractNumbers(foundWordList);

        if (targetNumbers.length > 0) {
            if (!targetNumbers.every(num => foundNumbers.includes(num))) return false;
        } else if (foundNumbers.some(num => num !== '1')) {
            return false;
        }

        const targetWords = targetWordList.filter(word => word.length > 1);
        const foundWords = foundWordList.filter(word => word.length > 1);
        if (targetWords.length === 0) return false;

        const foundWordSet = new Set(foundWordList);
        const targetWordSet = new Set(targetWordList);
        const targetInFound = targetWords.every(word => foundWordSet.has(word));
        const foundInTarget = foundWords.length >= 2 && foundWords.every(word => targetWordSet.has(word));
        return targetInFound || foundInTarget;
    }

    /**
     * Rank title-matched candidates by release year and exact title, and
     * reject a best candidate whose year diverges by more than two years
     * unless its title is an exact match.
     * @param {Array<{title: string, year?: string|number|null}>} matches
     * @param {string} targetTitle
     * @param {string|number|null} targetYear
     * @param {(candidate: Object) => number} [extraScore]
     * @returns {Object|null}
     */
    rankTitleMatches(matches, targetTitle, targetYear, extraScore = null) {
        if (!Array.isArray(matches) || matches.length === 0) return null;
        const year = Number.parseInt(targetYear, 10);
        const hasYear = Number.isFinite(year);
        const target = BaseParserService.compactTitle(targetTitle);
        const scored = matches.map((candidate, index) => {
            let score = 0;
            const candidateYear = Number.parseInt(candidate.year, 10);
            if (hasYear && Number.isFinite(candidateYear)) {
                const diff = Math.abs(candidateYear - year);
                if (diff === 0) score += 100;
                else if (diff <= 1) score += 50;
                else score -= Math.min(100, diff * 10);
            }
            if (BaseParserService.compactTitle(candidate.title) === target) score += 50;
            if (typeof extraScore === 'function') score += extraScore(candidate) || 0;
            return { candidate, score, index };
        });
        scored.sort((a, b) => b.score - a.score || a.index - b.index);
        return scored[0].candidate;
    }

    /**
     * Whether a candidate's year diverges from the target by more than two years.
     * @param {Object} candidate
     * @param {string|number|null} targetYear
     * @returns {boolean}
     */
    /**
     * Last line of defence shared by every source: a result whose year or title
     * says it is another film (a remake, a namesake, an unrelated upload) is
     * dropped, so the player never opens «not that movie».
     *  - Films: a known result year must be within ±1 of the target year.
     *    Series are exempt (later seasons legitimately carry later years).
     *  - Title: one of the result's title variants («Рус / Original») must match
     *    the requested title or the original title, unless the parser already
     *    verified the title itself (`titleVerified`) or matches titles its own
     *    way (`ownTitleMatching`, e.g. stem-based anime matching).
     */
    verifySearchResult(result, title, year, options = {}) {
        if (!result || this.skipResultVerification) return true;
        const mediaType = options?.mediaType || null;
        const series = this.isSeriesMediaType?.(mediaType) || options?.seasonNumber != null;
        const target = Number.parseInt(year, 10);
        const found = Number.parseInt(result.year, 10);
        if (!series && Number.isFinite(target) && Number.isFinite(found) && Math.abs(found - target) > 1) return false;

        if (result.titleVerified || this.ownTitleMatching || !result.title) return true;
        const wanted = [title, options?.altName].filter(value => typeof value === 'string' && value.trim());
        if (!wanted.length) return true;
        const variants = String(result.title).split(/\s+\/\s+|\s+\|\s+/).map(part => part.trim()).filter(Boolean);
        return variants.some(variant => wanted.some(name => {
            if (BaseParserService.compactTitle(variant) === BaseParserService.compactTitle(name)) return true;
            return this.isTitleMatch(variant, name, { allowSeriesSuffix: series })
                && BaseParserService.extraTitleWords(variant, name, series) <= (BaseParserService.significantWords(name).length >= 3 ? 1 : 0);
        }));
    }

    /** Words that providers add around a title and that never make it another film. */
    static get TITLE_NOISE_WORDS() {
        return new Set(['фильм', 'фильма', 'кино', 'мультфильм', 'мультик', 'аниме', 'сериал', 'смотреть', 'онлайн', 'бесплатно',
            'хорошем', 'качестве', 'полный', 'полностью', 'hd', 'fullhd', 'full', 'uhd', '4k', '4к', '1080', '1080p', '720', '720p',
            'год', 'года', 'г', 'русская', 'озвучка', 'дубляж', 'дублированный', 'the', 'a', 'an', 'movie', 'film']);
    }

    static significantWords(value) {
        const noise = BaseParserService.TITLE_NOISE_WORDS;
        return BaseParserService.normalizeTitle(String(value || '').replace(/\(\s*(?:19|20)\d{2}\s*\)/g, ' '))
            .split(' ')
            .filter(word => word.length > 1 && !noise.has(word) && !/^(?:19|20)\d{2}$/.test(word));
    }

    /**
     * How many meaningful words the found title has beyond the wanted one
     * («Мама, я дома» vs «Мама» → 1). Season suffixes are ignored for series.
     */
    static extraTitleWords(found, wanted, series = false) {
        let cleanFound = String(found || '');
        if (series) cleanFound = cleanFound.replace(/\s+(?:\d+\s+)?(?:сезон\S*|season|серия|серии|series)(?:\s.*)?$/i, ' ');
        const wantedSet = new Set(BaseParserService.significantWords(wanted));
        return BaseParserService.significantWords(cleanFound).filter(word => !wantedSet.has(word) && !/^\d+$/.test(word)).length;
    }

    /** Whether a media type describes episodic content. */
    isSeriesMediaType(mediaType) {
        return /series|tv|show|serial/i.test(String(mediaType || ''));
    }

    static hasYearDivergence(candidate, targetYear) {
        const year = Number.parseInt(targetYear, 10);
        const candidateYear = Number.parseInt(candidate?.year, 10);
        return Number.isFinite(year) && Number.isFinite(candidateYear)
            && Math.abs(candidateYear - year) > 2;
    }

    // ─── Diagnostics ──────────────────────────────────────────────────

    /**
     * Verbose parser tracing is opt-in so normal playback does not flood the
     * console (and serialize candidate lists) on every search. Enable with
     * `localStorage.setItem('movieExtension.debugParsers', '1')`.
     * @returns {boolean}
     */
    static isDebugEnabled() {
        try {
            return globalThis.localStorage?.getItem(PARSER_DEBUG_STORAGE_KEY) === '1';
        } catch {
            return false;
        }
    }

    /**
     * console.log() only when parser debugging is enabled.
     * @param {...any} args
     */
    debugLog(...args) {
        if (BaseParserService.isDebugEnabled()) console.log(...args);
    }

    // ─── Network ──────────────────────────────────────────────────────

    /**
     * fetch() with a hard deadline that also covers reading the body.
     * A provider mirror that accepts the connection but never answers must not
     * hold source discovery until the browser's own network timeout. An
     * optional `options.signal` (for example a mirror race) aborts it as well.
     * @param {string} url
     * @param {RequestInit} [options]
     * @param {number} [timeoutMs]
     * @returns {Promise<Response>}
     */
    fetchWithTimeout(url, options = {}, timeoutMs = this.requestTimeoutMs) {
        if (typeof AbortController === 'undefined') return fetch(url, options);

        const controller = new AbortController();
        const externalSignal = options?.signal;
        if (externalSignal) {
            if (externalSignal.aborted) controller.abort(externalSignal.reason);
            else externalSignal.addEventListener?.('abort', () => controller.abort(externalSignal.reason), { once: true });
        }
        if (typeof setTimeout === 'function' && timeoutMs > 0) {
            // The timer intentionally outlives the response headers so a stalled
            // body is aborted too; aborting a consumed response is a no-op.
            const timer = setTimeout(() => {
                controller.abort(new Error(`${this.name} request timed out after ${timeoutMs} ms`));
            }, timeoutMs);
            timer?.unref?.();
        }
        return fetch(url, { ...options, signal: controller.signal });
    }

    // ─── Built-in Caching ─────────────────────────────────────────────

    /**
     * Cached wrapper around search(). Uses in-memory cache with configurable TTL.
     * @param {string} title
     * @param {string|number|null} year
     * @param {Object} [options] - Provider-specific search options
     * @returns {Promise<SearchResult|null>}
     */
    getPerfCategory(operation) {
        const provider = { kinogo: 'KINOGO', exfs: 'EXFS', seasonvar: 'SEASONVAR', rutube: 'RUTUBE', animego: 'ANIMEGO' }[this.id];
        return provider ? `${provider}_${operation}` : 'OTHER';
    }

    /**
     * What makes two searches the same one. A parser that finds a title by its
     * ID rather than by its name overrides this.
     * @returns {string}
     */
    getSearchCacheKey(title, year, options = {}) {
        const mediaType = options?.mediaType || null;
        const seasonNumber = options?.seasonNumber ?? '';
        const seasonYear = options?.seasonYear ?? '';
        const altName = options?.altName || '';
        return `${title}_${year || ''}_${mediaType || ''}_${seasonNumber}_${seasonYear}_${altName}`;
    }

    async cachedSearch(title, year, options = {}) {
        const cacheKey = this.getSearchCacheKey(title, year, options);
        const cached = this._searchCache.get(cacheKey);
        const perf = typeof window !== 'undefined' ? window.MovieDetailsPerf : null;

        if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
            perf?.recordCall(this.getPerfCategory('SEARCH'), { cacheHit: true });
            return cached.data;
        }

        const inFlight = this._searchInFlight.get(cacheKey);
        if (inFlight) {
            perf?.recordCall(this.getPerfCategory('SEARCH'), { inFlightDedupHit: true });
            return inFlight;
        }
        perf?.recordCall(this.getPerfCategory('SEARCH'));
        const cacheGeneration = this._cacheGeneration;

        const request = (async () => {
            try {
                let result = await this.search(title, year, options);
                if (result && !this.verifySearchResult(result, title, year, options)) {
                    console.info('[BaseParserService] Rejected a result for a different title', {
                        parserId: this.id,
                        wanted: { title, year: year || null },
                        found: { title: result.title || null, year: result.year || null }
                    });
                    result = null;
                }
                // Parsers report a failed mirror or query as "no result", so a
                // miss may be transient. Do not let it block a retry for the
                // whole TTL; concurrent callers still share the in-flight request.
                if (result && cacheGeneration === this._cacheGeneration) {
                    this._searchCache.set(cacheKey, { data: result, timestamp: Date.now() });
                }
                return result;
            } catch (error) {
                console.error('[BaseParserService] Search error:', globalThis.PlayerDiagnostics?.sanitizeError(error) || { category: 'unknown' });
                return null;
            } finally {
                if (this._searchInFlight.get(cacheKey) === request) {
                    this._searchInFlight.delete(cacheKey);
                }
            }
        })();

        this._searchInFlight.set(cacheKey, request);
        return request;
    }

    /**
     * Cache and coalesce source extraction for one search result.
     * This prevents background discovery and an immediate user click from fetching
     * and parsing the same third-party movie page twice.
     * @param {SearchResult|string} searchResult
     * @returns {Promise<Array<VideoSource>>}
     */
    async cachedVideoSources(searchResult, options = {}) {
        const sourceKey = typeof searchResult === 'string' ? searchResult : searchResult?.url;
        if (!sourceKey) return [];

        const forceRefresh = options?.forceRefresh === true;

        const cached = this._sourceCache.get(sourceKey);
        const perf = typeof window !== 'undefined' ? window.MovieDetailsPerf : null;
        if (!forceRefresh && cached && Date.now() - cached.timestamp < this.cacheTTL) {
            perf?.recordCall(this.getPerfCategory('SOURCE'), { cacheHit: true });
            return cached.data;
        }

        const inFlight = this._sourceInFlight.get(sourceKey);
        if (!forceRefresh && inFlight) {
            perf?.recordCall(this.getPerfCategory('SOURCE'), { inFlightDedupHit: true });
            return inFlight;
        }
        if (forceRefresh) {
            perf?.recordCall(this.getPerfCategory('SOURCE'), { cacheBypass: true });
        }
        perf?.recordCall(this.getPerfCategory('SOURCE'));
        const cacheGeneration = this._cacheGeneration;

        const request = (async () => {
            try {
                const sources = await this.getVideoSources(searchResult);
                const normalized = Array.isArray(sources) ? sources : [];
                // An empty source list is not a successful discovery result. Do
                // not poison the source cache after a transient provider page,
                // expired token, or incomplete iframe response.
                if (cacheGeneration === this._cacheGeneration && normalized.length > 0) {
                    this._sourceCache.set(sourceKey, { data: normalized, timestamp: Date.now() });
                }
                // Refine future cache hits without holding up this mount or
                // mutating an array already handed to an active player.
                void this.dropMissingEmbedSources(normalized).then(available => {
                    if (cacheGeneration !== this._cacheGeneration
                        || this._sourceCache.get(sourceKey)?.data !== normalized) return;
                    if (available.length) this._sourceCache.set(sourceKey, { data: available, timestamp: Date.now() });
                    else this._sourceCache.delete(sourceKey);
                });
                return normalized;
            } finally {
                if (this._sourceInFlight.get(sourceKey) === request) {
                    this._sourceInFlight.delete(sourceKey);
                }
            }
        })();

        this._sourceInFlight.set(sourceKey, request);
        return request;
    }

    /**
     * Drop player embeds that the player service reports as missing.
     * A Venom embed (`…/embed/kp/<id>`) for a title the service does not have
     * still loads as a page that only says "видео не найдено", so the
     * extension would show it as a working player. The service answers such
     * requests with HTTP 404, which is checked in parallel with mounting. Only a
     * definitive 404/410 drops a source; network errors and timeouts keep it.
     * Token-signed URLs are never pre-fetched.
     * @param {Array<VideoSource>} sources
     * @returns {Promise<Array<VideoSource>>}
     */
    async dropMissingEmbedSources(sources) {
        if (!Array.isArray(sources) || sources.length === 0) return sources;
        const checks = await Promise.all(sources.map(source => this.checkEmbedAvailable(source?.url)));
        const available = sources.filter((_source, index) => checks[index]);
        Object.keys(sources).forEach(key => {
            if (!/^\d+$/.test(key)) available[key] = sources[key];
        });
        return available;
    }

    async checkEmbedAvailable(sourceUrl) {
        if (BalancerDomains.isUnknownEmbed(sourceUrl)) await BalancerDomains.adopt(sourceUrl);
        return this._checkKnownEmbed(sourceUrl);
    }

    /** @private */
    _checkKnownEmbed(sourceUrl) {
        const url = BalancerDomains.actualize(sourceUrl);
        if (!BaseParserService.isCheckableEmbedUrl(url)) return Promise.resolve(true);
        const cached = this._embedChecks.get(url);
        if (cached && Date.now() - cached.timestamp < this.cacheTTL) return cached.promise;
        const entry = { timestamp: Date.now() };
        entry.promise = (async () => {
            try {
                const request = () => this.fetchWithTimeout(url, {
                    credentials: 'omit',
                    cache: 'no-store'
                }, EMBED_CHECK_TIMEOUT_MS);
                const perf = typeof window !== 'undefined' ? window.MovieDetailsPerf : null;
                const response = perf ? await perf.trackRequest('EMBED_CHECK', { purpose: this.getPerfCategory('EMBED_CHECK') }, request) : await request();
                try { await response.body?.cancel?.(); } catch { /* ignore */ }
                // What a domain the balancer has left answers.
                if (response.status === 422) {
                    await BalancerDomains.refresh({ force: true });
                    return false;
                }
                if (response.status === 404 || response.status === 410) {
                    console.warn('[BaseParserService] Player embed has no video', { status: response.status });
                    return false;
                }
                return true;
            } catch {
                if (this._embedChecks.get(url) === entry) this._embedChecks.delete(url);
                return true;
            }
        })();
        if (this._embedChecks.size >= 100) this._embedChecks.delete(this._embedChecks.keys().next().value);
        this._embedChecks.set(url, entry);
        return entry.promise;
    }

    /**
     * Whether a source URL is an unsigned Venom embed that can be pre-checked.
     * @param {string} sourceUrl
     * @returns {boolean}
     */
    static isCheckableEmbedUrl(sourceUrl) {
        try {
            const parsed = new URL(String(sourceUrl || ''));
            if (parsed.protocol !== 'https:' || !isVenomProviderUrl(parsed)) return false;
            if (!/\/embed\//.test(parsed.pathname) || /\/embed\/trailer/.test(parsed.pathname)) return false;
            return ![...parsed.searchParams.keys()].some(key => /token|sign|hash|expires/i.test(key));
        } catch {
            return false;
        }
    }

    /**
     * Clear the search cache.
     */
    clearCache() {
        this._cacheGeneration += 1;
        this._searchCache.clear();
        this._searchInFlight.clear();
        this._sourceCache.clear();
        this._sourceInFlight.clear();
        this._embedChecks.clear();
    }

    // ─── Markup Helpers (for custom renderers) ────────────────────────

    /**
     * Escape provider text for HTML text or a quoted attribute.
     * @param {*} value
     * @returns {string}
     */
    static escapeAttribute(value) {
        return escapePlayerAttribute(value);
    }

    /**
     * Validate a direct media URL and escape it for a quoted src attribute.
     * @param {string} sourceUrl
     * @returns {string|null} Escaped URL, or null for unsupported schemes
     */
    static toMediaSrcAttribute(sourceUrl) {
        return toPlayerMediaSrcAttribute(sourceUrl);
    }

    /**
     * Whether a frame URL belongs to a provider the extension supports inside
     * the frame (player-cleaner ad isolation and the episode bridge).
     * @param {string} sourceUrl
     * @returns {boolean}
     */
    static isSupportedProviderFrameUrl(sourceUrl) {
        return isVenomProviderUrl(sourceUrl);
    }

    /**
     * The same address on the domain the balancer answers from today.
     * @param {string} sourceUrl
     * @returns {string}
     */
    static actualizeProviderUrl(sourceUrl) {
        return BalancerDomains.actualize(sourceUrl);
    }

    /**
     * @param {string} sourceUrl
     * @returns {boolean} Whether the address is on the balancer's current domain.
     */
    static isActualBalancerUrl(sourceUrl) {
        try {
            return BalancerDomains.domainOf(new URL(sourceUrl).hostname) === BalancerDomains.domainOf(BalancerDomains.actualHost);
        } catch {
            return false;
        }
    }
}

const PARSER_DEBUG_STORAGE_KEY = 'movieExtension.debugParsers';

// Background availability check for player embeds; a slow answer keeps the source.
const EMBED_CHECK_TIMEOUT_MS = 4000;

// From a frame's load event to the first message of the extension's scripts in it.
const FRAME_HELLO_TIMEOUT_MS = 6000;

const VENOM_AD_FREE_HOSTS = new Set([
    'corevia.ws',
    'datavex.ws',
    'femd.ws',
    'namy.ws',
    'variyt.ws',
    'nextembed.ws',
    'ortified.ws',
    'lumex.cloud',
    'cinemar.cc',
    'stravers.live',
    'allarknow.online',
    'stloadi.live'
]);

const BALANCER_SCRIPT_URL = 'https://kodir2.github.io/actualize.js';
const BALANCER_STORAGE_KEY = 'venomBalancerDomainsV1';
const BALANCER_REFRESH_MS = 60 * 60 * 1000;
const BALANCER_FORCED_REFRESH_GAP_MS = 60 * 1000;
const BALANCER_SCRIPT_TIMEOUT_MS = 5000;
// Manifest entries written for this domain are what a balancer frame needs.
const BALANCER_FRAME_MATCH = '*://*.femd.ws/*';
const BALANCER_FRAME_SCRIPT_PREFIX = 'venom-balancer-frame-';
// The sites that embed the balancer name its script; one of these paths is all we accept.
const BALANCER_SCRIPT_PATTERN = /https:\/\/[a-z0-9.-]+\/(?:[a-z0-9._-]+\/)*actualize\.js/i;
const BALANCER_EMBED_PATH = /^\/embed\/[a-z]+\/\d+/i;
// The manifest's Referer rules already cover this zone.
const BALANCER_ZONE = 'ws';
const BALANCER_DYNAMIC_RULE_BASE = 5200;
// A balancer address: the same shape the balancer's own script looks for.
const BALANCER_HOST_PATTERN = /^(?:mm|app?i\w*)\.((?:[a-z0-9-]+\.)+[a-z]{2,})$/;

/**
 * The balancer behind KinoGo and Ex-FS keeps moving to new domains. A domain it has
 * left answers every embed with HTTP 422, yet those sites go on printing the address:
 * on their pages a script of the balancer's own rewrites it (actualize.js). The
 * extension reads the sites' HTML without running it, so it rewrites the address here.
 * It reads the same script, as text and never as code, to follow the next move without
 * a release. Frame scripts for a domain the manifest does not name are registered
 * before its address is used (attachFrameScripts); they reach it while it stays inside
 * the manifest's host permissions, which cover the .ws zone the balancer keeps to;
 * elsewhere the player asks the viewer once. The next domain is learned from the
 * balancer's script, wherever the sites load it from, or from an address a film page
 * already prints.
 */
const BalancerDomains = {
    // As published by actualize.js on 2026-11-25.
    actualHost: 'api.corevia.ws',
    retired: new Set([
        'delivembed.cc', 'buildplayer.com', 'embedstorage.net', 'embf.net', 'mir-dikogo-zapada.com', 'multikland.net',
        'placehere.link', 'synchroncode.com', 'ameytools.club',
        ...['tobaco', 'topdbltj', 'delivembd', 'hostemb', 'loadbox', 'getcodes', 'strvid', 'ebder', 'framprox',
            'embprox', 'bedemp2', 'embr', 'lessornot', 'linktodo', 'insertunit', 'marts', 'ninsel', 'embess',
            'luxembd', 'domem', 'atomics', 'namy', 'variyt', 'zenithjs', 'ortified', 'nextembed',
            'femd', 'datavex'
        ].map(name => `${name}.ws`)
    ]),
    // Where the sites themselves load that script from, once a page has shown another place.
    scriptUrl: BALANCER_SCRIPT_URL,
    checkedAt: 0,
    lastForcedAt: 0,
    loading: null,
    refreshing: null,

    domainOf(host) {
        return BALANCER_HOST_PATTERN.exec(String(host || '').toLowerCase())?.[1] || null;
    },

    /** @returns {{actualHost: string, retired: string[]}|null} null when it is not the script we know. */
    parseScript(text) {
        const source = String(text || '');
        const actualHost = /\bactual\s*=\s*["']https:\/\/([a-z0-9.-]+?)\/?["']/i.exec(source)?.[1]?.toLowerCase();
        if (!this.domainOf(actualHost)) return null;
        const pattern = /\bre\s*=\s*\/(.+)\//.exec(source)?.[1] || '';
        const retired = [
            // Single names: delivembed\.cc
            ...[...pattern.matchAll(/(?<![a-z0-9-])([a-z0-9-]+\\\.[a-z]{2,})(?=\||\))/gi)].map(match => match[1].replace('\\', '')),
            // Groups sharing a zone, in either form the script has used:
            // (?:embedstorage|embf|multikland)\.net and (tobaco|namy)(\.ws)
            ...[...pattern.matchAll(/\((?:\?:)?([a-z0-9|-]+)\)\(?\\\.([a-z]{2,})\)?/gi)]
                .flatMap(match => match[1].split('|').filter(Boolean).map(name => `${name}.${match[2]}`))
        ].map(domain => domain.toLowerCase());
        return { actualHost, retired };
    },

    apply({ actualHost, retired = [], checkedAt = 0, scriptUrl = null } = {}) {
        if (BALANCER_SCRIPT_PATTERN.test(scriptUrl || '')) this.scriptUrl = scriptUrl;
        const nextDomain = this.domainOf(actualHost);
        if (!nextDomain) return false;
        const previousDomain = this.domainOf(this.actualHost);
        const moved = actualHost !== this.actualHost;
        if (moved && previousDomain && previousDomain !== nextDomain) this.retired.add(previousDomain);
        retired.forEach(domain => this.retired.add(domain));
        this.retired.delete(nextDomain);
        this.actualHost = actualHost;
        this.checkedAt = Math.max(this.checkedAt, Number(checkedAt) || 0);
        return moved;
    },

    /** Reads what an earlier page learned, then checks for a move in the background. */
    load() {
        this.loading ||= (async () => {
            try {
                const stored = await globalThis.chrome?.storage?.local?.get?.(BALANCER_STORAGE_KEY);
                this.apply(stored?.[BALANCER_STORAGE_KEY]);
            } catch { /* The built-in domain still works. */ }
            await this.attachFrameScripts();
            if (Date.now() - this.checkedAt >= BALANCER_REFRESH_MS) void this.refresh();
        })();
        return this.loading;
    },

    /** @returns {Promise<boolean>} Whether the balancer turned out to have moved. */
    refresh({ force = false } = {}) {
        if (this.refreshing) return this.refreshing;
        const now = Date.now();
        if (force && now - this.lastForcedAt < BALANCER_FORCED_REFRESH_GAP_MS) return Promise.resolve(false);
        if (force) this.lastForcedAt = now;
        this.refreshing = (async () => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), BALANCER_SCRIPT_TIMEOUT_MS);
            try {
                let parsed = null;
                for (const url of new Set([this.scriptUrl, BALANCER_SCRIPT_URL])) {
                    try {
                        const response = await fetch(url, { credentials: 'omit', cache: 'no-store', signal: controller.signal });
                        parsed = response.ok ? this.parseScript(await response.text()) : null;
                    } catch (error) {
                        if (controller.signal.aborted) throw error;
                    }
                    if (parsed) break;
                }
                if (!parsed) {
                    console.warn('[BalancerDomains] The balancer script has changed; keeping the known domain');
                    return false;
                }
                const moved = this.apply({ ...parsed, checkedAt: Date.now() });
                if (moved) console.info('[BalancerDomains] The balancer moved', { actualHost: this.actualHost });
                await this.attachFrameScripts();
                await this.save();
                return moved;
            } catch {
                // Nothing to act on: the next page checks again.
                return false;
            } finally {
                clearTimeout(timer);
                this.refreshing = null;
            }
        })();
        return this.refreshing;
    },

    async save() {
        await globalThis.chrome?.storage?.local?.set?.({ [BALANCER_STORAGE_KEY]: {
            actualHost: this.actualHost, retired: [...this.retired], checkedAt: this.checkedAt, scriptUrl: this.scriptUrl
        } });
    },

    /** Remembers where a site's page loads the balancer's script from. */
    noteScript(html) {
        const found = BALANCER_SCRIPT_PATTERN.exec(String(html || ''))?.[0];
        if (!found || found === this.scriptUrl) return;
        this.scriptUrl = found;
        void this.refresh({ force: true });
    },

    /** An address shaped like the balancer's, on a domain nobody has named yet. */
    isUnknownEmbed(sourceUrl) {
        try {
            const url = new URL(sourceUrl, 'https://relative.invalid');
            const domain = this.domainOf(url.hostname);
            return Boolean(domain) && BALANCER_EMBED_PATH.test(url.pathname)
                && !this.retired.has(domain) && !isVenomProviderUrl(url);
        } catch {
            return false;
        }
    },

    /**
     * Learns the new domain from a film page that already prints it. The answer must be
     * the balancer's own player page for that very host; anything else changes nothing.
     */
    async adopt(sourceUrl) {
        const url = new URL(sourceUrl, 'https://relative.invalid');
        url.protocol = 'https:';
        try {
            const response = await fetch(url.href, { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(BALANCER_SCRIPT_TIMEOUT_MS) });
            if (!response.ok) return false;
            const page = await response.text();
            const host = /\bembedHost\s*=\s*["']([a-z0-9.-]+)["']/i.exec(page)?.[1]?.toLowerCase();
            if (host !== url.hostname.toLowerCase() || !/\bVenomPlayer\b/.test(page)) return false;
            const moved = this.apply({ actualHost: host });
            await this.attachFrameScripts();
            await this.save();
            if (moved) console.info('[BalancerDomains] The balancer moved', { actualHost: this.actualHost });
            return moved;
        } catch {
            return false;
        }
    },

    accessRequest() {
        const domain = this.domainOf(this.actualHost);
        return domain ? { origins: [`https://*.${domain}/*`] } : null;
    },

    /** Whether the extension's scripts may run on the current domain. */
    async hasAccess() {
        const request = this.accessRequest();
        const permissions = globalThis.chrome?.permissions;
        if (!request || !permissions?.contains) return true;
        return permissions.contains(request).catch(() => true);
    },

    /** Only from a click: Chrome shows its own question. */
    async requestAccess() {
        const request = this.accessRequest();
        const granted = request ? await globalThis.chrome?.permissions?.request?.(request).catch(() => false) : false;
        if (granted) await this.attachFrameScripts({ force: true });
        return Boolean(granted);
    },

    /** The Referer rules for a domain outside the zone the static ones cover. */
    async attachRefererRules(domain) {
        const dnr = globalThis.chrome?.declarativeNetRequest;
        if (!dnr?.updateDynamicRules || !dnr.getDynamicRules) return;
        const old = (await dnr.getDynamicRules())
            .filter(rule => rule.id >= BALANCER_DYNAMIC_RULE_BASE && rule.id < BALANCER_DYNAMIC_RULE_BASE + 100);
        const outside = !domain.endsWith(`.${BALANCER_ZONE}`);
        if (!outside && old.length === 0) return;
        if (outside && old.length && old.every(rule => rule.condition.requestDomains?.includes(domain))) return;
        const template = outside
            ? await (await fetch(globalThis.chrome.runtime.getURL('src/background/provider-embed-rules.json'))).json()
            : [];
        const added = template
            .filter(rule => rule.condition.requestDomains?.includes(BALANCER_ZONE))
            .map((rule, index) => ({ ...rule, id: BALANCER_DYNAMIC_RULE_BASE + index, condition: { ...rule.condition, requestDomains: [domain] } }));
        await dnr.updateDynamicRules({ removeRuleIds: old.map(rule => rule.id), addRules: added });
    },

    /**
     * Gives the current domain the same frame scripts the manifest gives the known ones.
     * Without them its frame shows the balancer's own player. Chrome drops the
     * registration on an extension update, so every page confirms it.
     */
    async attachFrameScripts({ force = false } = {}) {
        const api = globalThis.chrome;
        const domain = this.domainOf(this.actualHost);
        if (!domain || !api?.scripting?.registerContentScripts || !api.runtime?.getManifest) return;
        const match = `*://*.${domain}/*`;
        const attach = async () => {
            await this.attachRefererRules(domain).catch(() => undefined);
            const wanted = (api.runtime.getManifest().content_scripts || [])
                .filter(entry => entry.matches.includes(BALANCER_FRAME_MATCH) && !entry.matches.includes(match))
                .map((entry, index) => ({
                    id: `${BALANCER_FRAME_SCRIPT_PREFIX}${index}`,
                    matches: [match],
                    js: entry.js,
                    runAt: entry.run_at,
                    allFrames: entry.all_frames === true,
                    world: entry.world || 'ISOLATED',
                    ...(entry.match_about_blank ? { matchOriginAsFallback: true } : {})
                }));
            const registered = (await api.scripting.getRegisteredContentScripts())
                .filter(script => script.id.startsWith(BALANCER_FRAME_SCRIPT_PREFIX));
            if (!force && registered.length === wanted.length && registered.every(script => script.matches.includes(match))) return;
            if (registered.length) await api.scripting.unregisterContentScripts({ ids: registered.map(script => script.id) });
            if (wanted.length) await api.scripting.registerContentScripts(wanted);
        };
        try {
            // Two pages can learn of the move at once; the second finds it done.
            if (globalThis.navigator?.locks) await globalThis.navigator.locks.request(BALANCER_FRAME_SCRIPT_PREFIX, attach);
            else await attach();
        } catch (error) {
            console.warn('[BalancerDomains] Could not prepare the player for the new domain', error?.message || error);
        }
    },

    /** The same address on the domain the balancer answers from today. */
    actualize(sourceUrl) {
        if (typeof sourceUrl !== 'string' || !sourceUrl) return sourceUrl;
        try {
            const parsed = new URL(sourceUrl, 'https://relative.invalid');
            if (!this.retired.has(this.domainOf(parsed.hostname))) return sourceUrl;
            parsed.protocol = 'https:';
            parsed.host = this.actualHost;
            return parsed.href;
        } catch {
            return sourceUrl;
        }
    }
};

// Provider URLs come from scraped pages. Only web/extension schemes may become
// frame sources, and the serialized URL is escaped for a quoted attribute.
function toPlayerFrameSrcAttribute(sourceUrl) {
    try {
        const parsed = new URL(String(sourceUrl || ''), typeof window !== 'undefined' ? window.location?.href : undefined);
        if (!['https:', 'http:', 'chrome-extension:'].includes(parsed.protocol)) return null;
        return escapePlayerAttribute(parsed.href);
    } catch {
        return null;
    }
}

// Direct media URLs come from scraped pages or decoded provider playlists. Only
// network/blob schemes may become <video>/<source> sources, escaped for a quoted attribute.
function toPlayerMediaSrcAttribute(sourceUrl) {
    try {
        const parsed = new URL(String(sourceUrl || ''), typeof window !== 'undefined' ? window.location?.href : undefined);
        if (!['https:', 'http:', 'blob:'].includes(parsed.protocol)) return null;
        return escapePlayerAttribute(parsed.href);
    } catch {
        return null;
    }
}

function escapePlayerAttribute(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function withVenomAdFreeParam(sourceUrl, sourceSite) {
    if (typeof sourceUrl !== 'string' || !sourceUrl.trim()) return sourceUrl;

    try {
        const parsed = new URL(sourceUrl, typeof window !== 'undefined' ? window.location?.href : undefined);
        if (!isVenomProviderUrl(parsed)) return sourceUrl;

        // player-venom supports this flag natively and checks it before any
        // pre-roll, mid-roll, post-roll, or non-linear ad is initialized.
        parsed.searchParams.set('santabarbaranoads', '1');
        // The embed API signs different media URLs without the source site's
        // HTTP Referer. Its `host` query alone does not preserve that context.
        // Narrow DNR rules restore the Referer for marked extension frames.
        if (sourceSite) {
            const site = new URL(sourceSite);
            if (site.protocol === 'https:') parsed.searchParams.set('movieExtensionSite', site.hostname);
        }
        return parsed.toString();
    } catch {
        return sourceUrl;
    }
}

function isVenomProviderUrl(sourceUrl) {
    try {
        const parsed = sourceUrl instanceof URL
            ? sourceUrl
            : new URL(sourceUrl, typeof window !== 'undefined' ? window.location?.href : undefined);
        const hostname = parsed.hostname.toLowerCase();
        return [...VENOM_AD_FREE_HOSTS, BalancerDomains.domainOf(BalancerDomains.actualHost)].some(host =>
            hostname === host || hostname.endsWith(`.${host}`)
        );
    } catch {
        return false;
    }
}

/**
 * @typedef {Object} SearchResult
 * @property {string} url - URL for getVideoSources
 * @property {string} title - Title of the found content
 * @property {string} parserId - ID of the parser that found this result
 * @property {string|null} [year] - Release year
 * @property {boolean} [isSeries] - Whether it's a series
 * @property {string} [source] - Source identifier
 */

/**
 * @typedef {Object} VideoSource
 * @property {string} name - Display name of the source/player
 * @property {string} url - URL to the video or player
 * @property {'iframe'|'video'|'hls'} type - Source type
 */

// Export
if (typeof window !== 'undefined') {
    window.BaseParserService = BaseParserService;
    window.BalancerDomains = BalancerDomains;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { BaseParserService };
}
