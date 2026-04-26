/**
 * RutubeParser - Parser for rutube.ru video pages.
 * Extracts content metadata (title, season, episode, channel, duration, date)
 * from Rutube page titles and player DOM structure.
 * 
 * Unlike other parsers (ExFS, KinoGo), this parser doesn't search a streaming site.
 * Instead, it parses the current Rutube page to extract structured content info.
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
     * Uses Rutube's search API to find matching videos.
     * 
     * @param {string} title - Movie or series title
     * @param {string|number|null} year - Release year (unused, kept for interface)
     * @returns {Promise<SearchResult|null>}
     */
    async search(title, year) {
        console.log('[Rutube Search] query:', title);
        try {
            const searchUrl = `${this.baseUrl}/api/search/video/?query=${encodeURIComponent(title)}&page=1&per_page=10`;
            console.log('[Rutube Search] запрос URL:', searchUrl);

            const response = await fetch(searchUrl, {
                headers: {
                    'Accept': 'application/json'
                }
            });

            console.log('[Rutube Search] статус ответа:', response.status);

            if (!response.ok) {
                throw new Error(`Search failed: ${response.status}`);
            }

            const data = await response.json();
            console.log('[Rutube Search] сырой ответ:', JSON.stringify(data).slice(0, 500));
            console.log('[Rutube Search] кол-во результатов:', data?.results?.length ?? data?.items?.length ?? '???');
            console.log('[Rutube Search] первый результат:', JSON.stringify(data?.results?.[0] ?? data?.items?.[0]));

            const results = data.results || [];

            if (results.length === 0) {
                console.log(`[DEBUG RutubeParser] No results found for "${title}"`);
                return null;
            }

            // Find best match
            const searchYear = year || this._extractYear(title);
            const best = this._pickBestResult(results, title, searchYear);
            if (!best) return null;

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
                embedUrl: best.embed_url || null,
                thumbnailUrl: best.thumbnail_url || null
            };

            console.log('[Rutube Search] итоговый результат:', JSON.stringify(result));
            console.log(`[DEBUG RutubeParser] search result:`, result.url);
            return result;

        } catch (error) {
            console.error(`[${this.name}] Search error:`, error);
            throw error;
        }
    }

    /**
     * Get video sources from a Rutube search result.
     * Returns the Rutube embed player URL as an iframe source.
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

            // Use Rutube's embed URL
            let embedUrl = searchResult.embedUrl || `${this.baseUrl}/play/embed/${videoId}`;

            // Also try to get additional metadata from the OEmbed/API
            let metadata = {};
            try {
                metadata = await this._fetchVideoMetadata(videoId);
            } catch (e) {
                console.warn(`[${this.name}] Failed to fetch video metadata:`, e);
            }

            const sources = [{
                name: this.name,
                url: embedUrl,
                type: 'iframe',
                metadata: {
                    title: metadata.title || searchResult.title,
                    channelName: metadata.author?.name || searchResult.channelName,
                    duration: metadata.duration || searchResult.duration,
                    publicationDate: metadata.publication_ts || searchResult.publicationDate,
                    thumbnailUrl: metadata.thumbnail_url || searchResult.thumbnailUrl
                }
            }];

            console.log(`[DEBUG RutubeParser] getVideoSources result: ${sources.length} sources`);
            return sources;

        } catch (error) {
            console.error(`[${this.name}] getVideoSources error:`, error);
            throw error;
        }
    }

    /**
     * Return player type — Rutube uses its own embedded iframe player.
     * @returns {'iframe'}
     */
    getPlayerType() {
        return 'iframe';
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
                // This could be part of the title or the channel — heuristic: if after "от", it's channel
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
        // Remove "N сезон - M серия" or "N сезон M серия"
        cleanTitle = cleanTitle.replace(/\d+\s*сезон\s*[-–]?\s*\d*\s*серия/gi, '').trim();
        // Remove standalone "N сезон" or "N серия"  
        cleanTitle = cleanTitle.replace(/\d+\s*сезон/gi, '').trim();
        cleanTitle = cleanTitle.replace(/\d+\s*серия/gi, '').trim();

        // Remove slash-separated alternative titles (e.g. "/ Jujutsu Kaisen")
        // Keep the first part (Russian title)
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

    // ─── Player DOM Parsing ──────────────────────────────────────────

    /**
     * Parse Rutube player DOM to extract metadata.
     * Uses aria-labels and data-testid attributes from the player HTML.
     * 
     * @param {string} html - Player section HTML
     * @returns {{ duration: number|null, channelName: string|null, currentTime: number|null }}
     */
    parsePlayerDOM(html) {
        if (!html) return { duration: null, channelName: null, currentTime: null };

        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        let duration = null;
        let channelName = null;
        let currentTime = null;

        // Extract duration from progress bar aria-valuemax
        // <div ... role="slider" aria-valuemax="1439" aria-valuenow="3" aria-valuetext="0 мин. (общая длительность 23 мин.)" ...>
        const progressSlider = doc.querySelector('[role="slider"][aria-label*="Ползунок временной шкалы"]') 
            || doc.querySelector('[data-testid="ui-progress-progressBar"]');
        
        if (progressSlider) {
            const maxVal = progressSlider.getAttribute('aria-valuemax');
            if (maxVal) {
                duration = parseInt(maxVal, 10); // Duration in seconds
            }
            const nowVal = progressSlider.getAttribute('aria-valuenow');
            if (nowVal) {
                currentTime = parseInt(nowVal, 10);
            }
        }

        // Try time display elements: "23:59" format
        if (!duration) {
            const timeBlocks = doc.querySelectorAll('.time-block-module__timeFormat___LfKTX');
            if (timeBlocks.length >= 2) {
                // Second time block is typically total duration
                const durationText = timeBlocks[timeBlocks.length - 1].textContent.trim();
                duration = this._parseTimeString(durationText);
            }
        }

        // Extract channel name
        // From channel subscription overlay: <h3 ...>КОМНАТА ДИДИ</h3>
        const channelHeading = doc.querySelector('.channel-subscription-module__info___lTQjF h3');
        if (channelHeading) {
            channelName = channelHeading.textContent.trim();
        }

        // Fallback: from avatar aria-label
        if (!channelName) {
            const avatarDiv = doc.querySelector('[role="img"][aria-label]');
            if (avatarDiv) {
                channelName = avatarDiv.getAttribute('aria-label');
            }
        }

        return { duration, channelName, currentTime };
    }

    // ─── Internal Helpers ────────────────────────────────────────────

    /**
     * Pick the best result from the search results array based on scoring.
     * @private
     */
    _pickBestResult(results, query, year) {
        if (!results?.length) return null;

        // 1. Исключаем мусор
        const cleaned = results.filter(item =>
            !item.is_deleted &&
            !item.is_livestream &&
            !item.is_audio &&
            !item.is_hidden &&
            this._isNotTrailer(item.title)
        );

        if (!cleaned.length) {
            console.log('[Rutube Search] No cleaned results, using first available');
            return results[0];
        }

        // 2. Считаем скор для каждого
        const scored = cleaned.map(item => {
            const score = this._scoreResult(item, query, year);
            console.log(`[Rutube Parse] scored item: "${item.title}", score: ${score}, duration: ${item.duration}`);
            return { item, score };
        });

        // 3. Берём с максимальным скором
        scored.sort((a, b) => b.score - a.score);
        return scored[0].item;
    }

    /**
     * Check if a title suggests it's a trailer or other non-full content.
     * @private
     */
    _isNotTrailer(title) {
        if (!title) return true;
        const t = title.toLowerCase();
        const trailerWords = ['трейлер', 'trailer', 'промо', 'promo', 'тизер', 'teaser',
            'анонс', 'клип', 'нарезка', 'фрагмент', 'otryv'];
        return !trailerWords.some(w => t.includes(w));
    }

    /**
     * Score a search result based on various criteria.
     * @private
     */
    _scoreResult(item, query, year) {
        let score = 0;
        const title = (item.title || '').toLowerCase();
        const queryLower = (query || '').toLowerCase();

        // Длительность — главный критерий
        const duration = item.duration || 0;
        if (duration >= 3600) score += 100;       // полный фильм (>60 мин)
        else if (duration >= 1800) score += 60;   // короткий фильм / серия (>30 мин)
        else if (duration >= 600) score += 20;    // короткий контент
        else score -= 50;                         // трейлер/клип

        // Год совпадает
        if (year && title.includes(String(year))) score += 40;

        // Совпадение по запросу
        const queryWords = queryLower.split(/\s+/).filter(Boolean);
        const matchedWords = queryWords.filter(w => title.includes(w));
        score += matchedWords.length * 10;

        // Категория "Фильмы" (id=4)
        if (item.category?.id === 4) score += 20;

        // Популярность (hits) — небольшой буст
        score += Math.min(20, Math.floor((item.hits || 0) / 10000));

        // is_official — небольшой буст
        if (item.is_official) score += 10;

        return score;
    }

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
        // Pattern: /video/{id}/ or /play/embed/{id}
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
     * Parse a time string like "23:59" or "1:23:45" to seconds.
     * @private
     */
    _parseTimeString(timeStr) {
        if (!timeStr) return null;
        const parts = timeStr.split(':').map(Number);
        if (parts.length === 3) {
            return parts[0] * 3600 + parts[1] * 60 + parts[2];
        } else if (parts.length === 2) {
            return parts[0] * 60 + parts[1];
        }
        return null;
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
