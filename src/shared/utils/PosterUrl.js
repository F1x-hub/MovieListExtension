/**
 * External poster URLs used by Random and its compact MovieCard.
 * The hosts come from Kinopoisk search fixtures, Kinopoisk/OpenMovieDB DTOs,
 * and TMDBService.getImageUrl. Yandex poster sizes are extensionless, and CDN
 * query parameters may select an image variant, so neither is discarded.
 */
class PosterUrl {
    static safe(value) {
        if (typeof value !== 'string' || !value.trim() || value.length > 2048) return '';
        if (Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return '';

        try {
            const input = value.trim();
            const url = new URL(input.startsWith('//') ? `https:${input}` : input);
            const host = url.hostname.toLowerCase();
            const paths = {
                'avatars.mds.yandex.net': '/',
                'st.kp.yandex.net': '/images/',
                'image.tmdb.org': '/t/p/',
                'image.openmoviedb.com': '/'
            };
            const prefix = Object.prototype.hasOwnProperty.call(paths, host) ? paths[host] : null;
            if (!prefix || url.username || url.password || url.port) return '';
            // URL.port hides default ports; reject explicit ports as well.
            const authority = input.replace(/^(?:https?:)?\/\//i, '').split(/[/?#]/, 1)[0];
            if (/:\d+$/.test(authority)) return '';
            if (url.protocol === 'http:') url.protocol = 'https:';
            if (url.protocol !== 'https:' || !url.pathname.startsWith(prefix)) return '';
            return url.href;
        } catch {
            return '';
        }
    }
}

if (typeof window !== 'undefined') window.PosterUrl = PosterUrl;
if (typeof globalThis !== 'undefined') globalThis.PosterUrl = PosterUrl;
if (typeof module !== 'undefined' && module.exports) module.exports = { PosterUrl };
