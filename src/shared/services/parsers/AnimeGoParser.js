/**
 * AnimeGoParser - Parser for the animego.me anime catalog.
 *
 * AnimeGo does not host video itself. Its player endpoint lists third-party
 * embeds (Kodik, Sibnet) per dub; series expose one AnimeGo episode ID per
 * episode, and the embeds of one episode are loaded from a separate endpoint.
 * Series sources are therefore episode descriptors that renderPlayer()
 * resolves on demand. A Kodik embed of the chosen dub is resolved to its
 * direct HLS streams and played in the extension's own player, with dub and
 * quality choices exposed to its settings menu; the provider iframes remain
 * the fallback when the stream cannot be resolved or fails.
 *
 * @extends BaseParserService
 */
class AnimeGoParser extends BaseParserService {
    constructor() {
        super({
            id: 'animego',
            name: 'AnimeGo',
            baseUrl: 'https://animego.me'
        });
        /** @private @type {Map<string, {data: Array<VideoSource>, timestamp: number}>} */
        this._episodePlayerCache = new Map();
        /** @private @type {Map<string, Promise<Array<VideoSource>>>} */
        this._episodePlayerInFlight = new Map();
        /** @private Dub chosen for the last mounted episode, per anime. */
        this._preferredTranslationByAnime = new Map();
        /** @private Last chosen dub; AnimeGo dub ids are shared across titles (seasons). */
        this._lastPreferredTranslation = null;
        /** @private Search context by result URL (query, year, season title). */
        this._resultMeta = new Map();
        /** @private Monotonic token: only the latest episode render may mount. */
        this._renderSequence = 0;
        /** @private Quality the user picked in the player menu (pixel height). */
        this._preferredHeight = null;
        /** @private @type {KodikStreamResolver|null} */
        this._streamResolver = null;
    }

    getSupportedTypes() {
        return ['anime'];
    }

    /**
     * The resolved Kodik stream is preferred over the provider iframes, which
     * stay in the source list as fallbacks.
     */
    getPlayerType() {
        return 'video';
    }

    /**
     * Kinopoisk often types anime as a series or film with the "аниме"
     * genre, so the type alone is not enough. Use the shared classifier
     * (genre, Japanese language/country) for the selected title.
     * @param {Object|null} movie
     * @param {string|null} mediaType
     * @returns {boolean}
     */
    supportsMedia(movie, mediaType) {
        if (mediaType && this.supportsType(mediaType)) return true;
        if (movie?.type === 'anime' || movie?.type === 'anime-film') return true;
        const classifier = typeof MediaClassifier !== 'undefined'
            ? MediaClassifier
            : (typeof window !== 'undefined' ? window.MediaClassifier : null);
        // DTO genres are strings, {name} (TMDB) or {genre} (Kinopoisk);
        // the classifier does not read the Kinopoisk shape.
        if (AnimeGoParser.hasAnimeGenre(movie)) return true;
        return typeof classifier?.isAnime === 'function' && classifier.isAnime(movie) === true;
    }

    getSourcePlayerType(source) {
        if (source?.type === ANIMEGO_EPISODE_SOURCE_TYPE) return 'iframe';
        return super.getSourcePlayerType(source);
    }

    // ─── BaseParserService Contract ───────────────────────────────────

    /**
     * Search the AnimeGo catalog by title and year. AnimeGo lists later
     * seasons as separate titles ("… 2: …", "Season 2"); for a season above
     * the first, that title is returned when the catalog has it, otherwise
     * the base title (episodes are then mapped by absolute number).
     * @param {string} title - Anime title (Russian or original)
     * @param {string|number|null} year - Premiere year
     * @param {Object} [options]
     * @param {number|null} [options.seasonNumber]
     * @returns {Promise<SearchResult|null>}
     */
    async search(title, year, options = {}) {
        if (!title) return null;
        const seasonNumber = Number(options?.seasonNumber);
        // Catalog DTOs may combine names ("Solo Leveling: Поднятие уровня в
        // одиночку") while AnimeGo lists one of them; try each part in turn.
        for (const query of AnimeGoParser.buildTitleVariants(title)) {
            const searchUrl = `${this.baseUrl}/search/anime?q=${encodeURIComponent(query)}`;
            const perf = typeof window !== 'undefined' ? window.MovieDetailsPerf : null;
            const request = () => this.fetchWithTimeout(searchUrl, { credentials: 'omit' });
            const response = perf
                ? await perf.trackRequest('ANIMEGO_SEARCH', { purpose: 'search', url: searchUrl }, request)
                : await request();
            if (!response.ok) {
                throw new Error(`AnimeGo search failed: ${response.status}`);
            }
            const html = await response.text();
            const base = this.parseSearchResults(html, query, year);
            if (!base) continue;
            const seasonResult = Number.isInteger(seasonNumber) && seasonNumber > 1
                ? this.findSeasonResult(html, base, seasonNumber)
                : null;
            return this.rememberResult(seasonResult || base, title, year);
        }
        return null;
    }

    /**
     * Keep the query behind a result: MovieDetails passes only the result URL
     * to getVideoSources(), but season resolution must search again.
     * @private
     */
    rememberResult(result, query, year) {
        const remembered = {
            ...result,
            seasonNumber: result.seasonNumber ?? null,
            query,
            queryYear: year ?? null
        };
        this._resultMeta.set(remembered.url, {
            seasonNumber: remembered.seasonNumber,
            query,
            queryYear: remembered.queryYear
        });
        return remembered;
    }

    /**
     * The catalog card of a later season of `base`: its title continues the
     * base title with a season marker ("2", "II", "Season 2", "2 сезон").
     * @param {string} html - search page
     * @param {SearchResult} base - matched base title
     * @param {number} seasonNumber - season above 1
     * @returns {SearchResult|null}
     */
    findSeasonResult(html, base, seasonNumber) {
        const marker = AnimeGoParser.buildSeasonMarker(seasonNumber);
        const baseYear = Number.parseInt(base.year, 10) || null;
        const matches = this.parseSearchCards(html).filter(card => {
            if (card.animeId === base.animeId) return false;
            if (baseYear && card.year && card.year < baseYear) return false;
            return [[card.title, base.title], [card.originalTitle, base.originalTitle]].some(([candidate, prefix]) => {
                const candidateText = String(candidate || '').toLowerCase().replace(/ё/g, 'е');
                const prefixText = String(prefix || '').toLowerCase().replace(/ё/g, 'е').trim();
                if (!prefixText || !candidateText.startsWith(prefixText)) return false;
                return marker.test(candidateText.slice(prefixText.length));
            });
        }).sort((left, right) => (left.year || 0) - (right.year || 0));
        const card = matches[0];
        if (!card) return null;
        return {
            title: card.title,
            originalTitle: card.originalTitle || null,
            url: new URL(card.href, this.baseUrl).href,
            animeId: card.animeId,
            year: card.year ? String(card.year) : null,
            kind: card.kind,
            isSeries: card.kind ? card.kind !== 'Фильм' : undefined,
            parserId: this.id,
            source: this.id,
            seasonNumber
        };
    }

    /**
     * Load the player data of one anime.
     * Films resolve to provider iframes; series resolve to episode descriptors.
     * @param {SearchResult|string} searchResult
     * @returns {Promise<Array<VideoSource>>}
     */
    async getVideoSources(searchResult) {
        const animeId = AnimeGoParser.extractAnimeId(searchResult);
        if (!animeId) return [];

        const player = this.parsePlayerContent(await this._fetchPlayerJson(`/player/${animeId}`, 'ANIMEGO_SOURCE'));
        if (player.episodes.length === 0) {
            return player.sources.map(source => ({ ...source, animeId }));
        }

        const episodes = [...player.episodes];
        const pageCount = Math.min(player.pageCount, ANIMEGO_MAX_EPISODE_PAGES);
        for (let page = 1; page < pageCount; page += 1) {
            try {
                const pageData = await this._fetchPlayerJson(`/player/${animeId}/episodes?page=${page}`, 'ANIMEGO_SOURCE');
                episodes.push(...this.parsePlayerContent(pageData).episodes);
            } catch (error) {
                // Earlier pages remain playable; a later page is retried on the
                // next uncached discovery.
                console.warn(`[${this.name}] Episode page ${page} failed:`, error);
                break;
            }
        }

        const resultUrl = typeof searchResult === 'string' ? searchResult : searchResult?.url;
        const meta = this._resultMeta.get(resultUrl) || {};
        const seen = new Set();
        return episodes
            .filter(episode => {
                if (seen.has(episode.id)) return false;
                seen.add(episode.id);
                return true;
            })
            .sort((left, right) => left.number - right.number)
            .map(episode => ({
                name: `Серия ${episode.number}`,
                url: `${this.baseUrl}/player/videos/${episode.id}`,
                type: ANIMEGO_EPISODE_SOURCE_TYPE,
                animeId,
                episodeId: episode.id,
                episodeNumber: episode.number,
                filler: episode.filler,
                // Season context for resolving other seasons later.
                seasonScope: meta.seasonNumber ?? null,
                query: meta.query || null,
                queryYear: meta.queryYear ?? null
            }));
    }

    /**
     * Episodes of one canonical season, numbered within that season.
     * Uses, in order: a title scoped to that season, the season's own
     * AnimeGo title, then absolute numbering of the base title against the
     * canonical season layout. When the catalog's season is longer than the
     * AnimeGo title (one catalog season spanning AnimeGo's "… 2" title), the
     * following AnimeGo season titles continue the list. Returns null when
     * the season cannot be mapped, so the caller never plays a wrong episode.
     * @param {Array<VideoSource>} sources - episode descriptors of one title
     * @param {number|null} seasonNumber - canonical season (null: no seasons)
     * @param {{canonicalSeasons?: Array<{seasonNumber: number, episodeCount: number}>, episodeNumber?: number|null}} [context]
     * @returns {Promise<{mode: 'direct'|'scoped'|'absolute'|'continued', offset: number, episodes: Array<VideoSource>}|null>}
     */
    async resolveSeasonEpisodes(sources, seasonNumber, { canonicalSeasons = [], episodeNumber = null } = {}) {
        const episodes = (sources || []).filter(source => source?.type === ANIMEGO_EPISODE_SOURCE_TYPE);
        if (episodes.length === 0) return null;
        const numbered = (list, mode, offset = 0) => ({
            mode,
            offset,
            episodes: list.map(episode => ({ ...episode, seasonEpisodeNumber: episode.episodeNumber - offset }))
        });

        const season = Number(seasonNumber);
        const scope = episodes[0].seasonScope ?? null;
        const query = episodes[0].query || null;
        const queryYear = episodes[0].queryYear ?? null;
        const isFirstSeason = !Number.isInteger(season) || season <= 1;
        const layout = new Map((canonicalSeasons || [])
            .map(entry => [Number(entry?.seasonNumber), Number(entry?.episodeCount) || 0]));

        const loadEpisodes = async (searchOptions) => {
            if (!query) return null;
            const result = await this.cachedSearch(query, queryYear, searchOptions);
            if (!result) return null;
            try {
                const list = (await this.cachedVideoSources(result))
                    .filter(source => source?.type === ANIMEGO_EPISODE_SOURCE_TYPE);
                return { result, list };
            } catch (error) {
                console.warn(`[${this.name}] Season episodes unavailable:`, error);
                return null;
            }
        };

        // A catalog season longer than its AnimeGo title continues into the
        // next AnimeGo season titles ("… 2: …") in order.
        const continueIntoNextTitles = async resolved => {
            const wanted = Math.max(
                layout.get(isFirstSeason ? 1 : season) || 0,
                Number.isFinite(Number(episodeNumber)) ? Number(episodeNumber) : 0
            );
            if (wanted <= resolved.episodes.length || !query) return resolved;
            const list = [...resolved.episodes];
            let nextScope = (list[list.length - 1]?.seasonScope ?? 1) + 1;
            while (list.length < wanted && nextScope <= ANIMEGO_MAX_CONTINUATION_SEASON) {
                const next = await loadEpisodes({ seasonNumber: nextScope });
                if (next?.result?.seasonNumber !== nextScope || next.list.length === 0) break;
                const start = list.length;
                next.list.forEach((episode, index) => {
                    list.push({ ...episode, seasonEpisodeNumber: start + index + 1 });
                });
                nextScope += 1;
            }
            return list.length > resolved.episodes.length
                ? { mode: 'continued', offset: resolved.offset, episodes: list }
                : resolved;
        };

        if (isFirstSeason && (scope === null || scope <= 1)) return continueIntoNextTitles(numbered(episodes, 'direct'));
        if (!isFirstSeason && scope === season) return continueIntoNextTitles(numbered(episodes, 'scoped'));

        if (!isFirstSeason) {
            const seasonTitle = await loadEpisodes({ seasonNumber: season });
            if (seasonTitle?.result?.seasonNumber === season && seasonTitle.list.length > 0) {
                return continueIntoNextTitles(numbered(seasonTitle.list, 'scoped'));
            }
        }

        let base = scope === null ? episodes : null;
        if (!base) {
            const baseTitle = await loadEpisodes({});
            if (baseTitle && (baseTitle.result.seasonNumber ?? null) === null) base = baseTitle.list;
        }
        if (!base?.length) return null;
        if (isFirstSeason) return continueIntoNextTitles(numbered(base, 'direct'));

        // Absolute numbering needs every earlier season's episode count.
        let offset = 0;
        for (let previous = 1; previous < season; previous += 1) {
            const count = layout.get(previous);
            if (!count) return null;
            offset += count;
        }
        const count = layout.get(season) || 0;
        const inSeason = base.filter(episode => episode.episodeNumber > offset
            && (!count || episode.episodeNumber <= offset + count));
        return inSeason.length > 0 ? numbered(inSeason, 'absolute', offset) : null;
    }

    /**
     * Season-relative episode list for the host episode picker.
     * @returns {Promise<Array<{episodeNumber: number, filler: boolean, absoluteNumber: number}>|null>}
     */
    async getSeasonEpisodeList(sources, seasonNumber, context = {}) {
        const resolved = await this.resolveSeasonEpisodes(sources, seasonNumber, context);
        if (!resolved) return null;
        return resolved.episodes.map(episode => ({
            episodeNumber: episode.seasonEpisodeNumber,
            filler: episode.filler === true,
            absoluteNumber: episode.episodeNumber
        }));
    }

    /**
     * Mount the chosen dub of a film or of the requested episode. Episode
     * descriptors are resolved to that episode's embeds first.
     * @param {HTMLElement} container
     * @param {Array<VideoSource>} sources
     * @param {Object} [options]
     * @returns {Promise<boolean>}
     */
    async renderPlayer(container, sources, options = {}) {
        // A runtime stream fallback (BaseParserService._handleStreamFailure)
        // re-enters with already resolved sources; mount them as they are.
        if (options[ANIMEGO_RESOLVED_OPTION]) {
            return super.renderPlayer(container, sources, options);
        }

        const renderId = ++this._renderSequence;
        const isCurrent = () => renderId === this._renderSequence
            && (!options.isRequestCurrent || options.isRequestCurrent());

        const episodes = (sources || []).filter(source => source?.type === ANIMEGO_EPISODE_SOURCE_TYPE);
        if (episodes.length === 0) {
            const players = (sources || []).filter(Boolean);
            const animeId = players.find(source => source?.animeId)?.animeId || null;
            return this.mountPlayers(container, { animeId, episodeNumber: null, players, sources, options, isCurrent });
        }

        const showUnavailable = message => {
            container.innerHTML = `<div class="video-placeholder"><span>${AnimeGoParser.escapeAttribute(message)}</span></div>`;
            delete container.__animegoNativeState;
            this.publishDubState(container, null);
            return false;
        };

        const season = options.season ?? options.resolvedSeasonNumber ?? null;
        const resolved = await this.resolveSeasonEpisodes(episodes, season, {
            canonicalSeasons: options.canonicalSeasons,
            episodeNumber: options.episode ?? options.resolvedEpisodeNumber ?? null
        });
        if (!isCurrent()) return false;
        if (!resolved) return showUnavailable(`Сезон ${season} недоступен на AnimeGo`);

        const episode = this.resolveEpisode(resolved.episodes, options);
        if (!episode) {
            return showUnavailable(`Серия ${options.episode ?? options.resolvedEpisodeNumber} недоступна на AnimeGo`);
        }
        let players = [];
        try {
            players = await this.getEpisodePlayers(episode);
        } catch (error) {
            console.warn(`[${this.name}] Episode ${episode.episodeNumber} players failed:`, error);
        }
        if (!isCurrent()) return false;

        if (players.length === 0) {
            return showUnavailable(`Серия ${episode.seasonEpisodeNumber ?? episode.episodeNumber} недоступна на AnimeGo`);
        }

        return this.mountPlayers(container, {
            animeId: episode.animeId,
            episodeNumber: episode.episodeNumber,
            episodeId: episode.episodeId,
            players,
            sources,
            options,
            isCurrent
        });
    }

    /**
     * Mount the preferred dub: its resolved Kodik stream in the extension's
     * player when available, otherwise its provider iframe.
     * @private
     * @returns {Promise<boolean>}
     */
    async mountPlayers(container, { animeId, episodeNumber, episodeId = null, players, sources, options, isCurrent }) {
        const ordered = this.orderByPreferredTranslation(players, animeId);
        const streams = await this.resolveNativeStreams(ordered);
        if (!isCurrent()) return false;

        const state = {
            animeId,
            episodeNumber,
            episodeId,
            players,
            sources,
            options,
            ordered,
            streams,
            stream: streams.length > 0 ? this.pickStream(streams) : null
        };
        state.mountSources = this.buildMountSources(state);
        state.mountOptions = this.buildMountOptions(container, state);

        const rendered = super.renderPlayer(container, state.mountSources, state.mountOptions);
        if (rendered && ordered[0]?.translationId) {
            this.setPreferredTranslation(animeId, ordered[0].translationId);
        }

        const nativeVideo = rendered && state.stream ? container.querySelector?.('video') : null;
        if (nativeVideo) {
            this.mountNativeBridge(container, state);
            // Dub and quality live in the player's settings menu.
            this.publishDubState(container, null);
        } else {
            this.unmountNativeBridge(container);
            this.publishDubState(container, rendered ? { animeId, players: ordered, episodeNumber } : null);
        }
        return rendered;
    }

    // ─── Native Kodik Playback ────────────────────────────────────────

    /**
     * Lazily created resolver sharing this parser's request deadline.
     * @returns {KodikStreamResolver|null}
     */
    getStreamResolver() {
        if (this._streamResolver) return this._streamResolver;
        const Resolver = typeof KodikStreamResolver !== 'undefined'
            ? KodikStreamResolver
            : (typeof window !== 'undefined' ? window.KodikStreamResolver : null);
        if (typeof Resolver !== 'function') return null;
        this._streamResolver = new Resolver({ fetch: (url, init) => this.fetchWithTimeout(url, init) });
        return this._streamResolver;
    }

    /**
     * Direct streams of the first (preferred) player when it is a Kodik embed.
     * @param {Array<VideoSource>} ordered
     * @returns {Promise<Array<{height: number, url: string}>>}
     */
    async resolveNativeStreams(ordered, { forceRefresh = false } = {}) {
        const active = ordered?.[0];
        if (!active?.url || !AnimeGoParser.isKodikUrl(active.url)) return [];
        const resolver = this.getStreamResolver();
        if (!resolver) return [];
        try {
            return await resolver.resolve(active.url, { forceRefresh });
        } catch (error) {
            console.warn(`[${this.name}] Kodik stream unavailable, using the embed player:`, error);
            return [];
        }
    }

    /**
     * The quality the user picked, else the best one.
     * @param {Array<{height: number, url: string}>} streams - best first
     */
    pickStream(streams) {
        return streams.find(stream => stream.height === this._preferredHeight) || streams[0] || null;
    }

    /**
     * Render options for resolved sources, including a runtime fallback hook
     * that reads the current state (episode and dub change in place).
     * @private
     */
    buildMountOptions(container, state) {
        return {
            ...state.options,
            [ANIMEGO_RESOLVED_OPTION]: true,
            onSourceFallback: info => {
                // The stream failed and an iframe took over: the host toolbar
                // owns the dub choice again.
                this.unmountNativeBridge(container);
                this.publishDubState(container, {
                    animeId: state.animeId,
                    players: state.ordered,
                    episodeNumber: state.episodeNumber
                });
                state.options.onSourceFallback?.(info);
            }
        };
    }

    /**
     * Play another episode in the mounted native player (canonical episode
     * picker, prev/next, player arrows). Returns false when the host has to
     * remount instead: iframe fallback active, unknown episode, or no stream.
     * @param {HTMLElement} container
     * @param {{episodeNumber: number, initialTimestamp?: number}} selection
     * @returns {Promise<boolean>}
     */
    async applyEpisodeSelection(container, selection) {
        const state = container?.__animegoNativeState;
        const episodeNumber = Number(selection?.episodeNumber);
        if (!state || state.episodeNumber == null || !Number.isFinite(episodeNumber)) return false;

        const renderId = ++this._renderSequence;
        const isCurrent = () => renderId === this._renderSequence
            && container.__animegoNativeState === state
            && (!state.options.isRequestCurrent || state.options.isRequestCurrent());

        const season = selection.seasonNumber ?? state.options.season ?? state.options.resolvedSeasonNumber ?? null;
        const resolved = await this.resolveSeasonEpisodes(state.sources, season, {
            canonicalSeasons: state.options.canonicalSeasons,
            episodeNumber
        });
        if (!isCurrent() || !resolved) return false;

        const episode = resolved.episodes.find(candidate => candidate.seasonEpisodeNumber === episodeNumber);
        if (!episode) return false;
        if (episode.episodeId === state.episodeId && container.querySelector?.('video')) return true;

        let players = [];
        try {
            players = await this.getEpisodePlayers(episode);
        } catch (error) {
            console.warn(`[${this.name}] Episode ${episode.episodeNumber} players failed:`, error);
        }
        if (!isCurrent() || players.length === 0) return false;

        const ordered = this.orderByPreferredTranslation(players, episode.animeId);
        const streams = await this.resolveNativeStreams(ordered);
        if (!isCurrent() || streams.length === 0) return false;

        // A later season may live in another AnimeGo title.
        state.animeId = episode.animeId;
        state.episodeNumber = episode.episodeNumber;
        state.episodeId = episode.episodeId;
        state.players = players;
        state.ordered = ordered;
        state.streams = streams;
        state.stream = this.pickStream(streams);
        // A later remount (dub without a stream, iframe fallback) must open
        // this season and episode, not the ones first mounted.
        state.options = {
            ...state.options,
            season,
            resolvedSeasonNumber: season,
            episode: episodeNumber,
            resolvedEpisodeNumber: episodeNumber,
            resolvedEpisodeUrl: episode.url
        };
        state.mountSources = this.buildMountSources(state);
        state.mountOptions = this.buildMountOptions(container, state);
        if (ordered[0]?.translationId) this.setPreferredTranslation(state.animeId, ordered[0].translationId);

        this.swapNativeStream(container, state, {
            startAt: Number(selection.initialTimestamp) || 0,
            play: true
        });
        this.mountNativeBridge(container, state);
        return true;
    }

    /** @private */
    buildMountSources(state) {
        const active = state.ordered[0];
        if (!state.stream || !active) return state.ordered;
        return [{
            name: active.name,
            url: state.stream.url,
            type: 'hls',
            animeId: state.animeId,
            translationId: active.translationId,
            translation: active.translation,
            provider: active.provider
        }, ...state.ordered];
    }

    /**
     * Hidden dub/quality lists next to the video. The player's settings menu
     * (player-cleaner) reads them and clicks the chosen entry.
     * @private
     */
    mountNativeBridge(container, state) {
        this.unmountNativeBridge(container);
        const doc = container.ownerDocument || (typeof document !== 'undefined' ? document : null);
        if (!doc) return;
        container.__animegoNativeState = state;

        // Series: the player's own prev/next arrows ask the host to navigate
        // (player-cleaner reads this flag on extension pages).
        const video = container.querySelector?.('video');
        if (video) {
            if (state.episodeNumber != null) video.dataset.canonicalEpisodeNav = 'true';
            else delete video.dataset.canonicalEpisodeNav;
            // Position is restored by the host's ProgressService, not by the
            // player's local per-page resume.
            video.dataset.progressOwner = 'canonical';
        }

        const bridge = doc.createElement('div');
        bridge.className = 'player-surface__bridge';
        bridge.hidden = true;
        bridge.setAttribute('aria-hidden', 'true');
        bridge.dataset.animegoBridge = 'true';

        const translations = this.getTranslationOptions(state.ordered);
        const activeTranslationId = state.ordered[0]?.translationId != null ? String(state.ordered[0].translationId) : '';
        if (translations.length > 1) {
            const list = doc.createElement('div');
            list.dataset.playerVoiceoverSource = this.id;
            translations.forEach(translation => {
                const item = doc.createElement('div');
                item.dataset.voiceoverOption = translation.id;
                item.textContent = translation.name;
                if (translation.id === activeTranslationId) item.classList.add('active');
                item.addEventListener('click', event => {
                    event.stopPropagation?.();
                    void this.switchNativeDub(container, translation.id);
                });
                list.appendChild(item);
            });
            bridge.appendChild(list);
        }

        if (state.streams.length > 1) {
            const list = doc.createElement('div');
            list.dataset.playerQualitySource = this.id;
            state.streams.forEach(stream => {
                const item = doc.createElement('div');
                item.dataset.qualityOption = String(stream.height);
                item.textContent = `${stream.height}p`;
                if (stream === state.stream) item.classList.add('active');
                item.addEventListener('click', event => {
                    event.stopPropagation?.();
                    this.switchNativeQuality(container, stream.height);
                });
                list.appendChild(item);
            });
            bridge.appendChild(list);
        }

        container.appendChild(bridge);
    }

    /** @private */
    unmountNativeBridge(container) {
        if (!container) return;
        container.querySelectorAll?.('[data-animego-bridge]').forEach(node => node.remove());
        delete container.__animegoNativeState;
    }

    /**
     * Play another quality of the mounted stream from the same position.
     * @param {HTMLElement} container
     * @param {number} height
     * @returns {boolean}
     */
    switchNativeQuality(container, height) {
        const state = container?.__animegoNativeState;
        const stream = state?.streams.find(candidate => candidate.height === Number(height));
        if (!state || !stream || stream === state.stream) return false;
        this._preferredHeight = stream.height;
        state.stream = stream;
        state.mountSources = this.buildMountSources(state);
        this.swapNativeStream(container, state);
        this.mountNativeBridge(container, state);
        return true;
    }

    /**
     * Play another dub of the mounted episode/film from the same position.
     * A dub without a resolvable Kodik stream is mounted as its iframe.
     * @param {HTMLElement} container
     * @param {string} translationId
     * @returns {Promise<boolean>}
     */
    async switchNativeDub(container, translationId) {
        const state = container?.__animegoNativeState;
        const activeTranslationId = state?.ordered[0]?.translationId != null ? String(state.ordered[0].translationId) : null;
        if (!state || !translationId || String(translationId) === activeTranslationId) return false;

        this.setPreferredTranslation(state.animeId, translationId);
        container.querySelectorAll?.('[data-voiceover-option]').forEach(item => {
            item.classList.toggle('active', item.dataset.voiceoverOption === String(translationId));
        });

        const renderId = ++this._renderSequence;
        const isCurrent = () => renderId === this._renderSequence
            && container.__animegoNativeState === state
            && (!state.options.isRequestCurrent || state.options.isRequestCurrent());

        const ordered = this.orderByPreferredTranslation(state.players, state.animeId);
        const streams = await this.resolveNativeStreams(ordered);
        if (!isCurrent()) return false;

        if (streams.length === 0) {
            return this.renderPlayer(container, state.sources, state.options);
        }

        state.ordered = ordered;
        state.streams = streams;
        state.stream = this.pickStream(streams);
        state.mountSources = this.buildMountSources(state);
        this.swapNativeStream(container, state);
        this.mountNativeBridge(container, state);
        return true;
    }

    /**
     * Replace the HLS source of the mounted video in place, keeping the
     * player chrome, position and play state.
     * @private
     */
    swapNativeStream(container, state, { startAt = null, play = null } = {}) {
        const video = container.querySelector?.('video');
        if (!video || !state.stream) return false;
        // Quality/dub keep the position; a new episode starts at its own one.
        const resumeAt = startAt != null ? Math.max(0, Number(startAt) || 0) : (Number(video.currentTime) || 0);
        const wasPlaying = play != null ? Boolean(play) : (!video.paused && !video.ended);
        const url = state.stream.url;

        try { video._movieExtensionHls?.destroy?.(); } catch { /* ignore */ }
        video._movieExtensionHls = null;
        video._movieExtensionStreamFailed = false;

        const isCurrent = () => container.__animegoNativeState === state
            && (!state.options.isRequestCurrent || state.options.isRequestCurrent());
        const factory = typeof window !== 'undefined' ? window.HlsPlaybackFactory : null;
        const hls = factory
            ? factory.create(video, url, {
                isCurrent,
                onFatal: ({ reason }) => this._handleStreamFailure({
                    container,
                    video,
                    failedSource: state.mountSources[0],
                    sources: state.mountSources,
                    options: state.mountOptions,
                    reason
                })
            })
            : this._createUnmanagedHls(video, url);
        if (hls) {
            video._movieExtensionHls = hls;
            container._hlsInstance = hls;
        } else {
            video.src = url;
        }

        const restore = () => {
            video.removeEventListener('loadedmetadata', restore);
            if (!isCurrent()) return;
            if (resumeAt > 0 || startAt != null) {
                const duration = Number(video.duration);
                video.currentTime = Number.isFinite(duration) && duration > 1 ? Math.min(resumeAt, duration - 1) : resumeAt;
            }
            if (wasPlaying) video.play?.()?.catch?.(() => {});
        };
        video.addEventListener('loadedmetadata', restore);
        return true;
    }

    /**
     * Remember the dub the user picked; the next render mounts it first.
     * @param {string|number} animeId
     * @param {string|number} translationId
     */
    setPreferredTranslation(animeId, translationId) {
        if (translationId == null || translationId === '') return;
        this._lastPreferredTranslation = String(translationId);
        if (animeId == null) return;
        this._preferredTranslationByAnime.set(String(animeId), String(translationId));
    }

    /**
     * Dubs available for the mounted episode/film, in provider order.
     * @param {Array<VideoSource>} players
     * @returns {Array<{id: string, name: string}>}
     */
    getTranslationOptions(players) {
        const options = [];
        const seen = new Set();
        (players || []).forEach(player => {
            const id = player?.translationId != null ? String(player.translationId) : '';
            if (!id || seen.has(id)) return;
            seen.add(id);
            options.push({ id, name: player.translation || player.provider || `Озвучка ${id}` });
        });
        return options;
    }

    /**
     * Expose the dub choice of the mounted player to the host page, which
     * owns the visible selector. Cleared when nothing was mounted.
     * @private
     */
    publishDubState(container, state) {
        if (!container) return;
        if (!state) {
            delete container.__providerDubState;
        } else {
            container.__providerDubState = {
                providerId: this.id,
                contextId: state.animeId != null ? String(state.animeId) : null,
                episodeNumber: state.episodeNumber,
                translations: this.getTranslationOptions(state.players),
                activeTranslationId: state.players[0]?.translationId != null ? String(state.players[0].translationId) : null
            };
        }
        // The host refreshes its toolbar on source switches; a runtime
        // fallback (stream -> iframe) happens without one, so announce it.
        const EventCtor = container.ownerDocument?.defaultView?.CustomEvent
            || (typeof CustomEvent === 'function' ? CustomEvent : null);
        if (EventCtor && typeof container.dispatchEvent === 'function') {
            container.dispatchEvent(new EventCtor(PROVIDER_DUB_STATE_EVENT, { detail: { providerId: this.id } }));
        }
    }

    /**
     * Episode number of an episode descriptor, used by MovieDetails to
     * resolve the canonical selection.
     * @param {VideoSource} source
     * @returns {number|null}
     */
    extractEpisodeNumber(source) {
        const number = Number(source?.episodeNumber);
        return Number.isFinite(number) ? number : null;
    }

    /**
     * Filler episode numbers among loaded episode descriptors.
     * @param {Array<VideoSource>} sources
     * @returns {Set<number>}
     */
    getFillerEpisodeNumbers(sources) {
        return new Set((sources || [])
            .filter(source => source?.type === ANIMEGO_EPISODE_SOURCE_TYPE && source.filler === true)
            .map(source => Number(source.episodeNumber))
            .filter(Number.isFinite));
    }

    clearCache() {
        super.clearCache();
        this._episodePlayerCache.clear();
        this._episodePlayerInFlight.clear();
        this._streamResolver?.clearCache?.();
    }

    // ─── Episode Resolution ───────────────────────────────────────────

    /**
     * Pick the requested episode of one season. Numbers are season-relative
     * (`seasonEpisodeNumber`); the host's resolved URL is only used when no
     * number was requested, because it is computed from absolute numbers.
     * @param {Array<VideoSource>} episodes
     * @param {Object} options - MovieDetails render options
     * @returns {VideoSource|null} null when the requested episode is missing
     */
    resolveEpisode(episodes, options = {}) {
        const requested = Number(options.episode ?? options.resolvedEpisodeNumber);
        if (options.episode != null || options.resolvedEpisodeNumber != null) {
            if (!Number.isFinite(requested)) return episodes[0] || null;
            return episodes.find(episode => (episode.seasonEpisodeNumber ?? episode.episodeNumber) === requested) || null;
        }
        if (options.resolvedEpisodeUrl) {
            const byUrl = episodes.find(episode => episode.url === options.resolvedEpisodeUrl);
            if (byUrl) return byUrl;
        }
        return episodes[0] || null;
    }

    /**
     * Provider embeds of one episode, cached and coalesced.
     * @param {VideoSource} episode
     * @returns {Promise<Array<VideoSource>>}
     */
    async getEpisodePlayers(episode) {
        const key = String(episode?.episodeId || '');
        if (!key) return [];

        const cached = this._episodePlayerCache.get(key);
        if (cached && Date.now() - cached.timestamp < this.cacheTTL) return cached.data;

        const inFlight = this._episodePlayerInFlight.get(key);
        if (inFlight) return inFlight;

        const cacheGeneration = this._cacheGeneration;
        const request = (async () => {
            try {
                const data = await this._fetchPlayerJson(`/player/videos/${key}`, 'ANIMEGO_EPISODE');
                const players = this.parsePlayerContent(data).sources;
                if (players.length > 0 && cacheGeneration === this._cacheGeneration) {
                    this._episodePlayerCache.set(key, { data: players, timestamp: Date.now() });
                }
                return players;
            } finally {
                if (this._episodePlayerInFlight.get(key) === request) {
                    this._episodePlayerInFlight.delete(key);
                }
            }
        })();
        this._episodePlayerInFlight.set(key, request);
        return request;
    }

    /**
     * Keep the dub of the previous episode first when it is available.
     * @param {Array<VideoSource>} players
     * @param {string|number} animeId
     * @returns {Array<VideoSource>}
     */
    orderByPreferredTranslation(players, animeId) {
        const preferred = this._preferredTranslationByAnime.get(String(animeId)) || this._lastPreferredTranslation;
        if (!preferred) return players;
        const matching = players.filter(player => player.translationId === preferred);
        if (matching.length === 0) return players;
        return [...matching, ...players.filter(player => player.translationId !== preferred)];
    }

    // ─── Parsing ──────────────────────────────────────────────────────

    /**
     * Pick the best catalog card for a title/year.
     * @param {string} html - /search/anime page
     * @param {string} targetTitle
     * @param {string|number|null} targetYear
     * @returns {SearchResult|null}
     */
    parseSearchResults(html, targetTitle, targetYear) {
        const target = AnimeGoParser.normalizeTitle(targetTitle);
        if (!target) return null;
        const year = Number.parseInt(targetYear, 10) || null;

        let best = null;
        this.parseSearchCards(html).forEach(card => {
            const score = AnimeGoParser.scoreCandidate(target, [card.title, card.originalTitle], year, card.year);
            if (score < ANIMEGO_MIN_MATCH_SCORE || (best && score <= best.score)) return;
            best = {
                score,
                result: {
                    title: card.title,
                    originalTitle: card.originalTitle || null,
                    url: new URL(card.href, this.baseUrl).href,
                    animeId: card.animeId,
                    year: card.year ? String(card.year) : null,
                    kind: card.kind,
                    isSeries: card.kind ? card.kind !== 'Фильм' : undefined,
                    parserId: this.id,
                    source: this.id
                }
            };
        });

        return best ? best.result : null;
    }

    /**
     * Catalog cards of a search page.
     * @param {string} html
     * @returns {Array<{title: string, originalTitle: string, href: string, animeId: string, year: number|null, kind: string|null}>}
     */
    parseSearchCards(html) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const cards = [];
        doc.querySelectorAll('.ani-grid__item').forEach(card => {
            const link = card.querySelector('.ani-grid__item-title a[href]');
            const href = link?.getAttribute('href') || '';
            const animeId = AnimeGoParser.extractAnimeId(href);
            if (!animeId) return;
            const labels = Array.from(card.querySelectorAll('.ani-grid__item-genres__link'))
                .map(node => node.textContent.trim());
            cards.push({
                title: (link.getAttribute('title') || link.textContent || '').trim(),
                originalTitle: (card.querySelector('.ani-grid__item-body > .fw-lighter')?.textContent || '').trim(),
                href,
                animeId,
                year: Number.parseInt(labels.find(label => /^(19|20)\d{2}$/.test(label)), 10) || null,
                kind: labels.find(label => !/^\d+$/.test(label)) || null
            });
        });
        return cards;
    }

    /**
     * Read episodes and provider embeds from AnimeGo player markup.
     * @param {Object} data - `data` object of a player JSON response
     * @returns {{episodes: Array<{id: string, number: number, filler: boolean}>, sources: Array<VideoSource>, pageCount: number}}
     */
    parsePlayerContent(data) {
        const html = typeof data?.content === 'string' ? data.content : '';
        const doc = new DOMParser().parseFromString(html, 'text/html');

        const episodes = [];
        doc.querySelectorAll('[data-episode][data-episode-number]').forEach(node => {
            const id = String(node.getAttribute('data-episode') || '').trim();
            const number = Number.parseInt(node.getAttribute('data-episode-number'), 10);
            if (!/^\d+$/.test(id) || !Number.isFinite(number)) return;
            episodes.push({ id, number, filler: node.getAttribute('data-episode-type') === '3' });
        });

        const kodik = [];
        const fallback = [];
        doc.querySelectorAll('[data-player]').forEach(node => {
            const url = AnimeGoParser.toProviderFrameUrl(node.getAttribute('data-player'));
            if (!url) return;
            const translation = (node.getAttribute('data-translation-title') || '').trim();
            const provider = (node.getAttribute('data-provider-title') || '').trim();
            const source = {
                name: ['AnimeGo', translation, provider].filter(Boolean).join(' · '),
                url,
                type: 'iframe',
                translationId: node.getAttribute('data-translation-id') || null,
                translation: translation || null,
                provider: provider || null
            };
            (AnimeGoParser.isKodikUrl(url) ? kodik : fallback).push(source);
        });

        const seenUrls = new Set();
        const sources = [...kodik, ...fallback].filter(source => {
            if (seenUrls.has(source.url)) return false;
            seenUrls.add(source.url);
            return true;
        });

        return { episodes, sources, pageCount: AnimeGoParser.readEpisodePageCount(doc, data) };
    }

    // ─── Network ──────────────────────────────────────────────────────

    /**
     * AnimeGo serves player JSON only to XHR-style requests; a plain request
     * returns the full HTML page instead.
     * @private
     */
    async _fetchPlayerJson(path, perfCategory) {
        const url = `${this.baseUrl}${path}`;
        const perf = typeof window !== 'undefined' ? window.MovieDetailsPerf : null;
        const request = () => this.fetchWithTimeout(url, {
            credentials: 'omit',
            headers: {
                'Accept': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            }
        });
        const response = perf
            ? await perf.trackRequest(perfCategory, { purpose: 'player', url }, request)
            : await request();
        if (!response.ok) {
            throw new Error(`AnimeGo player request failed: ${response.status}`);
        }
        const json = await response.json();
        if (json?.status !== 'success' || !json.data) {
            throw new Error('AnimeGo player response was not successful');
        }
        return json.data;
    }

    // ─── Static Helpers ───────────────────────────────────────────────

    /**
     * @param {SearchResult|string} value - search result or AnimeGo URL/path
     * @returns {string|null}
     */
    static extractAnimeId(value) {
        if (value && typeof value === 'object') {
            if (/^\d+$/.test(String(value.animeId || ''))) return String(value.animeId);
            value = value.url;
        }
        const match = String(value || '').match(/\/anime\/[^/?#]*?-(\d+)(?:[/?#]|$)/);
        return match ? match[1] : null;
    }

    /**
     * Full title first, then each part of a "Name: Other name" title.
     * @param {string} title
     * @returns {string[]}
     */
    static buildTitleVariants(title) {
        const full = String(title || '').trim();
        const parts = full.split(/\s*[:|]\s+|\s+[—–-]\s+/)
            .map(part => part.trim())
            .filter(part => AnimeGoParser.normalizeTitle(part).length >= 3);
        return [...new Set([full, ...(parts.length > 1 ? parts : [])])].filter(Boolean);
    }

    /**
     * Matches the text following a base title in a later season's title:
     * "2", "II", "Season 2", "2nd Season", "2 сезон", "сезон 2", "второй сезон".
     * @param {number} seasonNumber - season above 1
     * @returns {RegExp}
     */
    static buildSeasonMarker(seasonNumber) {
        const season = Number(seasonNumber);
        const roman = ANIMEGO_ROMAN_NUMERALS[season] || null;
        const ordinal = ANIMEGO_RU_SEASON_ORDINALS[season] || null;
        const englishSuffix = season % 10 === 2 && season % 100 !== 12 ? 'nd'
            : (season % 10 === 3 && season % 100 !== 13 ? 'rd' : 'th');
        const alternatives = [
            `${season}(?!\\d)`,
            `season\\s*${season}(?!\\d)`,
            `${season}${englishSuffix}\\s+season`,
            `${season}\\s*сезон`,
            `сезон\\s*${season}(?!\\d)`
        ];
        if (roman) alternatives.push(`${roman}(?![a-z])`);
        if (ordinal) alternatives.push(`${ordinal}[а-я]*\\s+сезон`);
        return new RegExp(`^\\s*[:\\-–—.,]?\\s*(?:${alternatives.join('|')})`, 'i');
    }

    static hasAnimeGenre(movie) {
        return Array.isArray(movie?.genres) && movie.genres.some(genre => {
            const name = String(typeof genre === 'string' ? genre : (genre?.genre || genre?.name || ''))
                .toLowerCase()
                .trim();
            return name === 'аниме' || name === 'anime';
        });
    }

    static normalizeTitle(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/ё/g, 'е')
            .replace(/[^a-zа-я0-9]+/g, '');
    }

    /**
     * Exact title matches win; a near-identical containment match needs a
     * matching year. Short prefixes ("Наруто" in "Наруто: Ураганные хроники")
     * are other seasons, and year differences beyond one are remakes.
     */
    static scoreCandidate(normalizedTarget, titles, targetYear, cardYear) {
        let titleScore = 0;
        for (const title of titles) {
            const candidate = AnimeGoParser.normalizeTitle(title);
            if (!candidate) continue;
            if (candidate === normalizedTarget) {
                titleScore = Math.max(titleScore, 100);
                continue;
            }
            const contained = candidate.includes(normalizedTarget) || normalizedTarget.includes(candidate);
            const lengthRatio = Math.min(candidate.length, normalizedTarget.length)
                / Math.max(candidate.length, normalizedTarget.length);
            if (contained && lengthRatio >= ANIMEGO_MIN_CONTAINMENT_RATIO) {
                titleScore = Math.max(titleScore, 40);
            }
        }
        if (titleScore === 0) return 0;
        if (!targetYear || !cardYear) return titleScore;
        const difference = Math.abs(targetYear - cardYear);
        if (difference === 0) return titleScore + 30;
        if (difference === 1) return titleScore + 10;
        return titleScore - 40;
    }

    static readEpisodePageCount(doc, data) {
        if (Number.isFinite(Number(data?.total)) && Number(data?.pageSize) > 0) {
            return Math.ceil(Number(data.total) / Number(data.pageSize));
        }
        const holder = doc.querySelector('[data-anime-player-episodes-total-value]');
        const total = Number(holder?.getAttribute('data-anime-player-episodes-total-value'));
        const pageSize = Number(holder?.getAttribute('data-anime-player-episodes-page-size-value'));
        if (Number.isFinite(total) && pageSize > 0) return Math.ceil(total / pageSize);
        return 1;
    }

    /**
     * Accept only known embed hosts over HTTPS. Kodik checks the embedding
     * site, so its frames are marked for the AnimeGo Referer DNR rule.
     * @param {string} rawUrl - protocol-relative or absolute embed URL
     * @returns {string|null}
     */
    static toProviderFrameUrl(rawUrl) {
        const value = String(rawUrl || '').trim();
        if (!value) return null;
        try {
            const parsed = new URL(value.startsWith('//') ? `https:${value}` : value);
            if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
            parsed.protocol = 'https:';
            const hostname = parsed.hostname.toLowerCase();
            if (!ANIMEGO_FRAME_HOSTS.some(host => hostname === host || hostname.endsWith(`.${host}`))) return null;
            if (AnimeGoParser.isKodikUrl(parsed)) {
                parsed.searchParams.set('movieExtensionSite', 'animego.me');
            }
            return parsed.toString();
        } catch {
            return null;
        }
    }

    static isKodikUrl(value) {
        try {
            const hostname = (value instanceof URL ? value : new URL(value)).hostname.toLowerCase();
            return hostname === 'kodikplayer.com' || hostname.endsWith('.kodikplayer.com');
        } catch {
            return false;
        }
    }
}

const ANIMEGO_EPISODE_SOURCE_TYPE = 'animego-episode';
const ANIMEGO_RESOLVED_OPTION = '__animegoResolvedSources';
// Dispatched on the player container whenever the published dub state changes.
const PROVIDER_DUB_STATE_EVENT = 'providerdubstatechange';
const ANIMEGO_ROMAN_NUMERALS = ['', 'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'];
const ANIMEGO_RU_SEASON_ORDINALS = {
    2: 'втор', 3: 'трет', 4: 'четв', 5: 'пят', 6: 'шест', 7: 'седьм', 8: 'восьм', 9: 'девят', 10: 'десят'
};
const ANIMEGO_MIN_MATCH_SCORE = 70;
const ANIMEGO_MIN_CONTAINMENT_RATIO = 0.8;
const ANIMEGO_MAX_EPISODE_PAGES = 20;
// Highest AnimeGo season title a catalog season may continue into.
const ANIMEGO_MAX_CONTINUATION_SEASON = 10;
const ANIMEGO_FRAME_HOSTS = ['kodikplayer.com', 'video.sibnet.ru'];

// Export
if (typeof window !== 'undefined') {
    window.AnimeGoParser = AnimeGoParser;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AnimeGoParser };
}
