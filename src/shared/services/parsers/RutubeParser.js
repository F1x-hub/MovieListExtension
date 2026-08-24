/**
 * RutubeParser - Parser for rutube.ru video hosting and streaming.
 * Extracts content metadata and provides embed iframe players.
 * 
 * @extends BaseParserService
 */
class RutubeParser extends BaseParserService {
    constructor() {
        super({
            id: 'rutube',
            name: 'Rutube',
            baseUrl: 'https://rutube.ru'
        });
    }

    // ─── BaseParserService Contract ───────────────────────────────────

    /**
     * Search for a movie/series by title on Rutube.
     * Uses Rutube's search API with multi-query cascade and intelligent scoring.
     * 
     * @param {string} title - Movie or series title
     * @param {string|number|null} year - Release year
     * @returns {Promise<SearchResult|null>}
     */
    async search(title, year) {
        if (!title) return null;
        console.log('[Rutube Search] query:', title, 'year:', year);

        const queries = this._buildSearchQueries(title, year);
        const searchYear = year || this._extractYear(title);
        const candidatesMap = new Map();

        try {
            for (const query of queries) {
                const searchUrl = `${this.baseUrl}/api/search/video/?query=${encodeURIComponent(query)}&page=1&per_page=25`;
                console.log('[Rutube Search] request URL:', searchUrl);

                try {
                    const perf = typeof window !== 'undefined' ? window.MovieDetailsPerf : null;
                    const request = () => fetch(searchUrl, {
                        headers: {
                            'Accept': 'application/json'
                        }
                    });
                    const response = perf ? await perf.trackRequest('RUTUBE_SEARCH', { purpose: 'search', url: searchUrl }, request) : await request();

                    if (!response.ok) {
                        console.warn(`[Rutube Search] status: ${response.status} for query "${query}"`);
                        continue;
                    }

                    const data = await response.json();
                    const results = data.results || data.items || [];

                    for (const item of results) {
                        if (item && item.id && !candidatesMap.has(item.id)) {
                            candidatesMap.set(item.id, item);
                        }
                    }

                    // Check if we found an outstanding candidate early
                    const candidateList = Array.from(candidatesMap.values());
                    const bestSoFar = this._pickBestResult(candidateList, title, searchYear);
                    if (bestSoFar && bestSoFar.score >= 140) {
                        break;
                    }
                } catch (err) {
                    console.warn(`[${this.name}] Query "${query}" failed:`, err);
                }
            }

            const candidateList = Array.from(candidatesMap.values());
            if (candidateList.length === 0) {
                console.log(`[DEBUG RutubeParser] No results found for "${title}"`);
                return null;
            }

            const bestResult = this._pickBestResult(candidateList, title, searchYear);
            if (!bestResult || bestResult.score <= 0) {
                console.log(`[DEBUG RutubeParser] No confident result found for "${title}" (best score: ${bestResult?.score})`);
                return null;
            }

            const best = bestResult.item;
            const parsed = this.parsePageTitle(best.title || '');

            const result = {
                url: `${this.baseUrl}/video/${best.id}/`,
                title: parsed.title || best.title,
                parserId: this.id,
                source: this.id,
                isSeries: parsed.season !== null || parsed.episode !== null,
                season: parsed.season,
                episode: parsed.episode,
                channelName: best.author?.name || parsed.channelName || null,
                duration: best.duration || null,
                publicationDate: best.publication_ts || best.created_ts || null,
                embedUrl: best.embed_url || `${this.baseUrl}/play/embed/${best.id}`,
                thumbnailUrl: best.thumbnail_url || null
            };

            console.log('[Rutube Search] final result:', JSON.stringify(result));
            return result;

        } catch (error) {
            console.error(`[${this.name}] Search error:`, error);
            throw error;
        }
    }

    /**
     * Get video sources from a Rutube search result.
     * Extracts direct HLS stream (.m3u8) for native player with iframe fallback.
     * 
     * @param {SearchResult} searchResult - Result from search()
     * @returns {Promise<Array<VideoSource>>}
     */
    async getVideoSources(searchResult) {
        console.log(`[DEBUG RutubeParser] getVideoSources() called.`, searchResult?.url);
        try {
            const url = typeof searchResult === 'string' ? searchResult : searchResult.url;

            // Extract video ID from URL
            const videoId = this._extractVideoId(url);
            if (!videoId) {
                console.warn(`[${this.name}] Could not extract video ID from: ${url}`);
                return [];
            }

            const embedUrl = searchResult.embedUrl || `${this.baseUrl}/play/embed/${videoId}`;
            let playOptions = null;

            try {
                playOptions = await this._fetchPlayOptions(videoId);
            } catch (e) {
                console.warn(`[${this.name}] Failed to fetch play options for ${videoId}:`, e);
            }

            const m3u8Url = playOptions?.video_balancer?.m3u8
                || playOptions?.video_balancer?.default
                || playOptions?.balancer?.m3u8
                || (typeof playOptions?.video_balancer === 'string' ? playOptions.video_balancer : null);

            const metadata = {
                title: playOptions?.title || searchResult.title,
                channelName: playOptions?.author?.name || searchResult.channelName,
                duration: playOptions?.duration || searchResult.duration,
                publicationDate: playOptions?.publication_ts || searchResult.publicationDate,
                thumbnailUrl: playOptions?.thumbnail_url || searchResult.thumbnailUrl
            };

            const sources = [];

            // Primary: Direct HLS Stream for native video player
            if (m3u8Url) {
                sources.push({
                    name: this.name,
                    url: m3u8Url,
                    type: 'hls',
                    metadata
                });
            }

            // Fallback: Embed iframe player
            sources.push({
                name: m3u8Url ? `${this.name} (Embed)` : this.name,
                url: embedUrl,
                type: 'iframe',
                metadata
            });

            console.log(`[DEBUG RutubeParser] getVideoSources result: ${sources.length} sources (HLS: ${!!m3u8Url})`);
            return sources;

        } catch (error) {
            console.error(`[${this.name}] getVideoSources error:`, error);
            throw error;
        }
    }

    /**
     * Return player type — Rutube prefers native video player for HLS streams.
     * @returns {'video'}
     */
    getPlayerType() {
        return 'video';
    }

    /**
     * Fetch play options (video balancer stream URLs) from Rutube API.
     * Tries primary and fallback endpoints.
     * @param {string} videoId
     * @returns {Promise<Object|null>}
     * @private
     */
    async _fetchPlayOptions(videoId) {
        const candidateUrls = [
            `${this.baseUrl}/api/play/options/${videoId}/?format=json`,
            `${this.baseUrl}/api/play/options/${videoId}/`,
            `${this.baseUrl}/api/video/${videoId}/?format=json`
        ];

        for (const url of candidateUrls) {
            try {
                const perf = typeof window !== 'undefined' ? window.MovieDetailsPerf : null;
                const request = () => fetch(url, {
                    headers: { 'Accept': 'application/json' }
                });
                const response = perf ? await perf.trackRequest('RUTUBE_SOURCE', { purpose: 'getVideoSources', url }, request) : await request();
                if (response.ok) {
                    const data = await response.json();
                    if (data?.video_balancer || data?.balancer || data?.video_url) {
                        return data;
                    }
                }
            } catch (err) {
                console.warn(`[${this.name}] Endpoint ${url} failed:`, err);
            }
        }
        return null;
    }

    // ─── Query Building ───────────────────────────────────────────────

    /**
     * Build prioritized cascade queries for searching.
     * @param {string} title
     * @param {string|number|null} year
     * @returns {Array<string>}
     * @private
     */
    _buildSearchQueries(title, year) {
        if (!title) return [];
        const cleanTitle = title.replace(/[:;/\\|]/g, ' ').replace(/\s+/g, ' ').trim();
        const queries = [];
        const searchYear = year || this._extractYear(title);

        if (searchYear) {
            queries.push(`${cleanTitle} ${searchYear}`);
        }
        queries.push(`${cleanTitle} фильм`);
        queries.push(cleanTitle);

        // Deduplicate case-insensitively
        const unique = [];
        const seen = new Set();
        for (const q of queries) {
            const lower = q.toLowerCase();
            if (!seen.has(lower)) {
                seen.add(lower);
                unique.push(q);
            }
        }
        return unique;
    }

    // ─── Garbage Detection & Scoring ─────────────────────────────────

    /**
     * Check if a title indicates UGC noise (reviews, reactions, let's plays, trailers, soundtracks, etc.)
     * @param {string} title - Candidate video title
     * @param {string} [query] - Original query title to avoid false positives if target title has such words
     * @returns {boolean}
     * @private
     */
    _isUgcGarbage(title, query = '') {
        if (!title) return true;
        const lower = title.toLowerCase();
        const queryLower = (query || '').toLowerCase();

        const garbagePatterns = [
            // Reviews, recaps, reactions, essays, opinions, explanations
            /(?:^|[^a-zа-яё0-9])(?:обзор[а-яё]*|разбор[а-яё]*|реакци[а-яё]*|рекап[а-яё]*|recap[s]?|пересказ[а-яё]*|мнени[а-яё]*|сюжет[а-яё]*|смысл\s+концовки|рецензи[а-яё]*|отзыв[а-яё]*|эссе|видеоэссе|разборк[а-яё]*|кинокритик[а-яё]*|впечатлени[а-яё]*|объяснени[а-яё]*)(?:$|[^a-zа-яё0-9])/i,
            // Streaming, podcasts, shows, vlogs, interviews
            /(?:^|[^a-zа-яё0-9])(?:подкаст[а-яё]*|podcast[s]?|интервью|стрим[а-яё]*|stream[s]?|шоу|выпуск[а-яё]*|влог[а-яё]*|vlog[s]?|в\s+гостях)(?:$|[^a-zа-яё0-9])/i,
            // Gaming
            /(?:^|[^a-zа-яё0-9])(?:прохожден[а-яё]*|геймпле[а-яё]*|gameplay|летспле[а-яё]*|letsplay|walkthrough|playthrough)(?:$|[^a-zа-яё0-9])/i,
            // Music, soundtracks, songs, albums, playlists, AMVs, edits, shorts, tiktok
            /(?:^|[^a-zа-яё0-9])(?:ost|ост|саундтрек[а-яё]*|саундтрэк[а-яё]*|soundtrack[s]?|музык[а-яё]*|песн[а-яё]*|трек[а-яё]*|альбом[а-яё]*|плейлист[а-яё]*|playlist[s]?|клип[а-яё]*|clip[s]?|amv|амв|edit[s]?|эдит[а-яё]*|shorts|шортс|тикток[а-яё]*|tiktok|кавер[а-яё]*|cover[s]?|ремикс[а-яё]*|remix)(?:$|[^a-zа-яё0-9])/i,
            // Trailers, teasers, fragments, tops, bloopers, facts
            /(?:^|[^a-zа-яё0-9])(?:трейлер[а-яё]*|trailer[s]?|промо|promo|тизер[а-яё]*|teaser[s]?|анонс[а-яё]*|нарезк[а-яё]*|фрагмент[а-яё]*|отрывок|отрывк[а-яё]*|сцен[а-яё]*|вырезанны[а-яё]*\s+сцен[а-яё]*|топ\s*\d+|топ-\d+|пасхалк[а-яё]*|факт[а-яё]*|секрет[а-яё]*|лучши[а-яё]*\s+момент[а-яё]*|блуперс[а-яё]*|неудачны[а-яё]*\s+дубл[а-яё]*)(?:$|[^a-zа-яё0-9])/i
        ];

        return garbagePatterns.some(regex => {
            const match = lower.match(regex);
            if (!match) return false;
            const matchedWord = match[0].replace(/[^a-zа-яё0-9]/gi, '').trim().toLowerCase();
            // If the search query itself includes this word, don't flag it as garbage
            if (matchedWord && queryLower.includes(matchedWord)) {
                return false;
            }
            return true;
        });
    }

    /**
     * Pick the best result from candidates based on scoring.
     * @private
     */
    _pickBestResult(results, query, year) {
        if (!results?.length) return null;

        const cleaned = results.filter(item =>
            item &&
            !item.is_deleted &&
            !item.is_livestream &&
            !item.is_audio &&
            !item.is_hidden
        );

        if (!cleaned.length) return null;

        const scored = cleaned.map(item => {
            const score = this._scoreResult(item, query, year);
            return { item, score };
        });

        scored.sort((a, b) => b.score - a.score);
        return scored[0];
    }

    /**
     * Score a candidate search result.
     * @param {Object} item - Rutube video item
     * @param {string} query - Target search title
     * @param {string|number|null} year - Target release year
     * @returns {number}
     * @private
     */
    _scoreResult(item, query, year) {
        if (!item) return -1000;
        const itemTitle = (item.title || '').trim();
        if (!itemTitle) return -1000;

        // Hard penalty for UGC garbage
        if (this._isUgcGarbage(itemTitle)) {
            return -500;
        }

        let score = 0;
        const targetTitle = (query || '').trim().toLowerCase();
        const candidateTitle = itemTitle.toLowerCase();

        // 1. Title Similarity & Token Overlap
        const targetTokens = this._tokenize(targetTitle);
        const candidateTokens = this._tokenize(candidateTitle);

        if (targetTokens.length === 0) return -1000;

        const cleanTarget = this._normalizeTitle(targetTitle);
        const cleanCandidate = this._normalizeTitle(candidateTitle);

        if (cleanCandidate === cleanTarget) {
            score += 150;
        } else if (cleanCandidate.startsWith(cleanTarget)) {
            score += 100;
        } else {
            let matchedCount = 0;
            for (const token of targetTokens) {
                if (candidateTokens.includes(token)) {
                    matchedCount++;
                }
            }

            const matchRatio = matchedCount / targetTokens.length;
            if (matchRatio === 1) {
                score += 80;
            } else if (matchRatio >= 0.66) {
                score += 40;
            } else if (matchRatio > 0) {
                score += 15;
            } else {
                return -300;
            }

            // Penalize overly bloated titles with lots of extra words
            const extraWords = Math.max(0, candidateTokens.length - targetTokens.length);
            if (extraWords > 5) {
                score -= Math.min(60, (extraWords - 5) * 5);
            }
        }

        // 2. Year Matching
        const targetYear = year ? parseInt(year, 10) : this._extractYear(query);
        const candidateYear = this._extractYear(itemTitle);

        if (targetYear) {
            if (candidateYear === targetYear) {
                score += 60;
            } else if (candidateYear && Math.abs(candidateYear - targetYear) > 1) {
                score -= 50;
            }
        }

        // 3. Duration Scoring
        const duration = item.duration || 0;
        if (duration >= 3000 && duration <= 14400) {
            // 50 min to 4 hours — optimal full movie
            score += 100;
        } else if (duration >= 1200 && duration < 3000) {
            // 20 min to 50 min — series episode / animated short
            score += 60;
        } else if (duration >= 600 && duration < 1200) {
            // 10 to 20 min
            score += 10;
        } else if (duration > 0 && duration < 600) {
            // Under 10 min — almost certainly trailer / clip
            score -= 120;
        } else if (duration > 14400) {
            // Over 4 hours — stream or marathon
            score -= 40;
        }

        // 4. Category & Quality hints
        if (item.category?.id === 4 || item.category?.name?.toLowerCase()?.includes('фильм')) {
            score += 25;
        }
        if (item.is_official) {
            score += 15;
        }

        return score;
    }

    /**
     * Tokenize text into normalized words, excluding common stop words.
     * @param {string} str
     * @returns {Array<string>}
     * @private
     */
    _tokenize(str) {
        if (!str) return [];
        const stopWords = new Set([
            'в', 'на', 'и', 'с', 'по', 'о', 'об', 'из', 'к', 'от', 'до', 'для', 'за', 'под', 'не',
            'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by'
        ]);
        return str
            .toLowerCase()
            .replace(/[^a-zа-яё0-9]/gi, ' ')
            .split(/\s+/)
            .filter(token => token.length > 0 && !stopWords.has(token));
    }

    /**
     * Normalize title to alphanumeric lowercase string for direct prefix/equality comparison.
     * @param {string} str
     * @returns {string}
     * @private
     */
    _normalizeTitle(str) {
        if (!str) return '';
        return str
            .toLowerCase()
            .replace(/[^a-zа-яё0-9]/gi, '')
            .trim();
    }

    // ─── Title Parsing ───────────────────────────────────────────────

    /**
     * Parse a Rutube page title to extract structured content info.
     * 
     * Handles patterns like:
     *   "Магическая битва: Смертельная миграция / Jujutsu Kaisen 3 сезон - 8 серия [КОМНАТА ДИДИ] — смотреть видео онлайн"
     *   "Наруто 1 сезон 24 серия [DubLikTV] — видео"
     *   "Ванпанчмен 3 сезон - 1 серия / One Punch Man [ОЗВУЧКА] — смотреть"
     * 
     * @param {string} pageTitle - Full page title string
     * @returns {{ title: string|null, season: number|null, episode: number|null, channelName: string|null }}
     */
    parsePageTitle(pageTitle) {
        if (!pageTitle) return { title: null, season: null, episode: null, channelName: null };

        let title = pageTitle;

        // Remove trailing "— смотреть видео онлайн от ..." or "— смотреть видео онлайн" etc.
        title = title.replace(/\s*—\s*смотреть.*$/i, '').trim();

        // Remove trailing publication info "бесплатно опубликованное..."
        title = title.replace(/\s*,?\s*бесплатно\s+опубликованн.*$/i, '').trim();

        // Remove trailing "в хорошем качестве" etc.
        title = title.replace(/\s*в хорошем качестве.*$/i, '').trim();

        // Extract channel name from [brackets]
        let channelName = null;
        const channelMatch = title.match(/\[([^\]]+)\]/);
        if (channelMatch) {
            channelName = channelMatch[1].trim();
            title = title.replace(/\s*\[[^\]]+\]\s*/g, ' ').trim();
        }

        // Extract channel name from «quotes» (sometimes in title format)
        if (!channelName) {
            const quoteMatch = title.match(/[«"]([^»"]+)[»"]/);
            if (quoteMatch) {
                const fromMatch = pageTitle.match(/от\s*[«"]([^»"]+)[»"]/i);
                if (fromMatch) {
                    channelName = fromMatch[1].trim();
                }
            }
        }

        // Extract season and episode numbers
        let season = null;
        let episode = null;

        // Pattern: "N сезон" or "N сезон - M серия" or "N сезон M серия"
        const seasonMatch = title.match(/(\d+)\s*сезон/i);
        if (seasonMatch) {
            season = parseInt(seasonMatch[1], 10);
        }

        const episodeMatch = title.match(/(\d+)\s*серия/i);
        if (episodeMatch) {
            episode = parseInt(episodeMatch[1], 10);
        }

        // Clean up the title: remove season/episode info
        let cleanTitle = title;
        cleanTitle = cleanTitle.replace(/\d+\s*сезон\s*[-–]?\s*\d*\s*серия/gi, '').trim();
        cleanTitle = cleanTitle.replace(/\d+\s*сезон/gi, '').trim();
        cleanTitle = cleanTitle.replace(/\d+\s*серия/gi, '').trim();

        // Remove slash-separated alternative titles (e.g. "/ Jujutsu Kaisen")
        const slashIndex = cleanTitle.indexOf(' / ');
        if (slashIndex > 0) {
            cleanTitle = cleanTitle.substring(0, slashIndex).trim();
        }

        // Clean up trailing/leading dashes and special chars
        cleanTitle = cleanTitle.replace(/^\s*[-–:]\s*/, '').replace(/\s*[-–:]\s*$/, '').trim();

        // Remove double spaces
        cleanTitle = cleanTitle.replace(/\s{2,}/g, ' ').trim();

        return {
            title: cleanTitle || null,
            season,
            episode,
            channelName
        };
    }

    // ─── Internal Helpers ────────────────────────────────────────────

    /**
     * Extract year from a query string.
     * @private
     */
    _extractYear(query) {
        if (!query) return null;
        const match = String(query).match(/\b(19|20)\d{2}\b/);
        return match ? parseInt(match[0], 10) : null;
    }

    /**
     * Extract video ID from a Rutube URL.
     * Supports: /video/XXXXX/, /play/embed/XXXXX
     * @private
     */
    _extractVideoId(url) {
        if (!url) return null;
        const match = url.match(/\/(?:video|play\/embed)\/([a-f0-9-]+)/i);
        return match ? match[1] : null;
    }

    /**
     * Fetch metadata about a video from Rutube API.
     * @private
     */
    async _fetchVideoMetadata(videoId) {
        const apiUrl = `${this.baseUrl}/api/video/${videoId}/`;
        const response = await fetch(apiUrl, {
            headers: { 'Accept': 'application/json' }
        });
        if (!response.ok) throw new Error(`API request failed: ${response.status}`);
        return await response.json();
    }

    /**
     * Format duration in seconds to human-readable string.
     * @param {number} seconds
     * @returns {string} e.g. "23:59" or "1:23:45"
     */
    formatDuration(seconds) {
        if (!seconds || seconds <= 0) return '0:00';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        if (h > 0) {
            return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }
        return `${m}:${String(s).padStart(2, '0')}`;
    }
}

// Export
if (typeof window !== 'undefined') {
    window.RutubeParser = RutubeParser;
}
