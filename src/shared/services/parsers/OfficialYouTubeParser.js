/**
 * OfficialYouTubeParser - free, licensed full-length films from film studios' own
 * YouTube channels (Мосфильм, Ленфильм, Киностудия Горького, Беларусьфильм,
 * Союзмультфильм, …). The studios publish these films themselves, so watching
 * them here is legal and free.
 *
 * Search uses YouTube's public results page (long videos only) and accepts a
 * video only when it comes from a VERIFIED channel whose name is on the studio
 * allowlist, its length looks like a feature film and its title matches the
 * movie. Playback goes through the extension's YouTube wrapper.
 *
 * @extends BaseParserService
 */
class OfficialYouTubeParser extends BaseParserService {
    constructor() {
        super({
            id: 'officialyt',
            name: 'Официально · YouTube',
            baseUrl: 'https://www.youtube.com'
        });
    }

    /** Studio channels that publish their own films for free. Verified badge is required too. */
    static get STUDIO_PATTERNS() {
        return [
            /мосфильм/i, /mosfilm/i,
            /ленфильм/i, /lenfilm/i,
            /киностуди[яи]\s+(им\.?\s*)?(м\.?\s*)?горького/i, /gorky film studio/i,
            /беларусьфильм/i, /belarusfilm/i,
            /союзмультфильм/i, /soyuzmultfilm/i,
            /одесская киностудия/i, /свердловская киностудия/i,
            /киностудия довженко/i, /dovzhenko/i,
            /грузия-?фильм/i, /арменфильм/i, /казахфильм/i,
            /рижская киностудия/i, /таллинфильм/i, /литовская киностудия/i
        ];
    }

    static get MIN_FILM_SECONDS() { return 40 * 60; }

    /** Studios publish films and animated features, not episodic series. */
    supportsMedia(movie, mediaType) {
        const type = String(mediaType || movie?.type || '').toLowerCase();
        return !/series|tv|show/.test(type);
    }

    getPlayerType() {
        return 'iframe';
    }

    // ─── BaseParserService Contract ───────────────────────────────────

    async search(title, year) {
        if (!title) return null;
        const queries = [`${title} ${year || ''} фильм`.trim(), title];
        for (const query of queries) {
            let videos;
            try {
                videos = await this._searchVideos(query);
            } catch (error) {
                console.warn(`[${this.name}] search failed:`, error?.message || error);
                return null;
            }
            const best = this._pickBest(videos, title, year);
            if (best) {
                return {
                    url: `${this.baseUrl}/watch?v=${best.videoId}`,
                    title: best.title,
                    parserId: this.id,
                    videoId: best.videoId,
                    channelName: best.channel,
                    duration: best.durationSec,
                    year: year ? String(year) : undefined
                };
            }
        }
        return null;
    }

    async getVideoSources(searchResult) {
        const videoId = this._extractVideoId(typeof searchResult === 'string' ? searchResult : (searchResult?.videoId || searchResult?.url));
        if (!videoId) return [];
        const embedUrl = typeof PlayerConfig !== 'undefined' && PlayerConfig.buildYouTubeEmbedUrl
            ? PlayerConfig.buildYouTubeEmbedUrl(videoId, { autoplay: true })
            : `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0`;
        return [{
            name: searchResult?.channelName ? `${this.name} — ${searchResult.channelName}` : this.name,
            url: embedUrl,
            type: 'iframe',
            parserId: this.id,
            metadata: {
                title: searchResult?.title || '',
                channelName: searchResult?.channelName || '',
                duration: searchResult?.duration || 0,
                youtubeVideoId: videoId
            }
        }];
    }

    // ─── Search helpers ────────────────────────────────────────────────

    /** Fetches YouTube results (filter: long videos) and returns plain video records. */
    async _searchVideos(query) {
        // sp=EgIYAg%3D%3D → «Длительность: больше 20 минут».
        const url = `${this.baseUrl}/results?search_query=${encodeURIComponent(query)}&sp=EgIYAg%3D%3D&hl=ru&gl=RU`;
        const response = await fetch(url, { credentials: 'omit' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const html = await response.text();
        return OfficialYouTubeParser.extractVideos(html);
    }

    /** Pulls `videoRenderer` entries out of the ytInitialData JSON embedded in the page. */
    static extractVideos(html) {
        const match = /var ytInitialData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/.exec(String(html || ''));
        if (!match) return [];
        let data;
        try { data = JSON.parse(match[1]); } catch { return []; }
        const videos = [];
        const walk = (node, depth = 0) => {
            if (!node || typeof node !== 'object' || depth > 40 || videos.length >= 60) return;
            if (Array.isArray(node)) { node.forEach(item => walk(item, depth + 1)); return; }
            if (node.videoRenderer) {
                const record = OfficialYouTubeParser._toRecord(node.videoRenderer);
                if (record) videos.push(record);
                return;
            }
            for (const value of Object.values(node)) walk(value, depth + 1);
        };
        walk(data);
        return videos;
    }

    static _toRecord(renderer) {
        const videoId = String(renderer?.videoId || '');
        if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
        const text = value => value?.simpleText || (value?.runs || []).map(run => run.text).join('') || '';
        const badges = (renderer.ownerBadges || []).map(badge => badge?.metadataBadgeRenderer?.style || '');
        return {
            videoId,
            title: text(renderer.title),
            channel: text(renderer.ownerText) || text(renderer.longBylineText),
            verified: badges.some(style => /VERIFIED/.test(style)),
            durationSec: OfficialYouTubeParser.parseDuration(text(renderer.lengthText))
        };
    }

    static parseDuration(value) {
        const parts = String(value || '').trim().split(':').map(Number);
        if (!parts.length || parts.some(part => !Number.isFinite(part))) return 0;
        return parts.reduce((total, part) => total * 60 + part, 0);
    }

    static isStudioChannel(name) {
        return OfficialYouTubeParser.STUDIO_PATTERNS.some(pattern => pattern.test(String(name || '')));
    }

    static normalize(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/ё/g, 'е')
            .replace(/[«»"'“”„()[\]{}.,:;!?…—–-]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Picks the studio upload whose title best matches the movie. A different
     * year in the video title (a remake, another adaptation) rules it out.
     */
    _pickBest(videos, title, year) {
        const wanted = OfficialYouTubeParser.normalize(title);
        if (!wanted) return null;
        const wantedTokens = wanted.split(' ').filter(token => token.length > 1);
        const targetYear = Number(year) || null;
        let best = null;
        for (const video of videos || []) {
            if (!video.verified || !OfficialYouTubeParser.isStudioChannel(video.channel)) continue;
            if (video.durationSec < OfficialYouTubeParser.MIN_FILM_SECONDS) continue;
            const name = OfficialYouTubeParser.normalize(video.title);
            const years = (video.title.match(/\b(19[0-9]{2}|20[0-9]{2})\b/g) || []).map(Number);
            if (targetYear && years.length && !years.some(found => Math.abs(found - targetYear) <= 1)) continue;
            const hits = wantedTokens.filter(token => name.includes(token)).length;
            const coverage = wantedTokens.length ? hits / wantedTokens.length : 0;
            const exact = name.startsWith(wanted) || name.includes(` ${wanted} `) || name.includes(`${wanted} `);
            if (!exact && coverage < 0.8) continue;
            // Prefer a complete upload over «1 серия» of a two-part film when both exist.
            const partial = /\d\s*(-?я)?\s*серия|часть\s*\d|part\s*\d/i.test(video.title);
            const score = (exact ? 2 : 0) + coverage + (targetYear && years.includes(targetYear) ? 0.5 : 0) - (partial ? 0.75 : 0);
            if (!best || score > best.score) best = { ...video, score };
        }
        return best;
    }

    _extractVideoId(value) {
        const raw = String(value || '');
        if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;
        const info = typeof Utils !== 'undefined' && Utils.extractYouTubeVideoInfo ? Utils.extractYouTubeVideoInfo(raw) : null;
        return info?.id || null;
    }
}

if (typeof window !== 'undefined') window.OfficialYouTubeParser = OfficialYouTubeParser;
if (typeof module !== 'undefined' && module.exports) module.exports = OfficialYouTubeParser;
