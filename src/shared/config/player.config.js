/**
 * PlayerConfig - Configuration for media playback, wrappers, and video embedding.
 */
const PlayerConfig = {
    /**
     * HTTPS wrapper URL for embedding YouTube videos in Chrome Extension pages.
     * Overcomes YouTube's restrictions on chrome-extension:// referer/origin headers (Error 150/153).
     * 
     * Default points to Firebase Hosting web app or custom domain.
     */
    YOUTUBE_WRAPPER_URL: 'https://movielistdb-13208.web.app/player/embed.html',

    /**
     * Direct YouTube embed fallback when wrapper is disabled or unavailable.
     */
    YOUTUBE_DIRECT_EMBED_BASE: 'https://www.youtube-nocookie.com/embed/',

    /**
     * Builds a safe embed URL for a YouTube video key.
     * 
     * @param {string} key - YouTube video ID (e.g. "dQw4w9WgXcQ")
     * @param {Object} [options]
     * @param {boolean} [options.autoplay=true]
     * @param {boolean} [options.mute=false]
     * @param {number} [options.start=0]
     * @param {boolean} [options.useDirect=false]
     * @returns {string}
     */
    buildYouTubeEmbedUrl(key, options = {}) {
        if (!key || typeof key !== 'string') return '';
        const cleanKey = key.trim();
        if (!cleanKey) return '';

        const autoplay = options.autoplay !== false ? 1 : 0;
        const mute = options.mute ? 1 : 0;
        const start = parseInt(options.start || 0, 10) || 0;

        if (!options.useDirect && this.YOUTUBE_WRAPPER_URL) {
            return `${this.YOUTUBE_WRAPPER_URL}?v=${encodeURIComponent(cleanKey)}&autoplay=${autoplay}&mute=${mute}&t=${start}`;
        }

        return `${this.YOUTUBE_DIRECT_EMBED_BASE}${encodeURIComponent(cleanKey)}?autoplay=${autoplay}&mute=${mute}&start=${start}&rel=0`;
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = PlayerConfig;
}
if (typeof globalThis !== 'undefined') {
    globalThis.PlayerConfig = PlayerConfig;
}
if (typeof window !== 'undefined') {
    window.PlayerConfig = PlayerConfig;
}
