class TrailerParsingService {
    constructor() {
        this.cacheDuration = 24 * 60 * 60 * 1000; // 24 hours
        this.storageKey = 'kp_trailer_cache_';
    }

    async getTrailer(movieId, isSeries = false) {
        try {
            // Check cache first
            const cached = this.getFromCache(movieId);
            if (cached) {
                console.log(`[TrailerParsing] Returning cached trailer for ${movieId}`);
                return cached;
            }

            const section = isSeries ? 'series' : 'film';
            const url = `https://www.kinopoisk.ru/${section}/${movieId}/video/`;
            const response = await fetch(url);
            const text = await response.text();
            
            // Convert to DOM for easier parsing
            const parser = new DOMParser();
            const doc = parser.parseFromString(text, 'text/html');
            
            // This is a heuristic search based on the provided snippet and common KP layout.
            // We look for the first video block that looks like a trailer.
            
            // Strategy 1: Look for the specific structure provided in the requirement
            // <div class="js-discovery-trailer movie-trailer-embed" data-trailer-id="...">
            
            const trailerContainer = doc.querySelector('.js-discovery-trailer.movie-trailer-embed');
            
            if (!trailerContainer) {
                console.warn('[TrailerParsing] No specific trailer container found');
                return null;
            }
            
            const trailerId = trailerContainer.getAttribute('data-trailer-id');
            const filmId = trailerContainer.getAttribute('data-film-id');
            const iframe = trailerContainer.querySelector('iframe');
            let videoUrl = iframe ? iframe.src : null;

            console.log('[TrailerParsing] Found block:', { trailerId, filmId, videoUrl, iframeHTML: iframe ? iframe.outerHTML : 'no iframe' });
            
            // Find title: The user snippet shows it in a table above the div.
            // We traverse up to find the common container (likely the table or tr)
            // <a href="/film/409600/video/134194/" class="all">Трейлер (дублированный)</a>
            
            let title = 'Трейлер';
            const linkRegex = new RegExp(`/${section}/${movieId}/video/${trailerId}/`);
            const titleLink = Array.from(doc.querySelectorAll('a.all')).find(a => a.href.includes(linkRegex.source) || a.href.includes(`/${trailerId}/`));
             
            if (titleLink) {
                title = titleLink.textContent.trim();
            }
            
            // Find poster: usually in a style attribute of a sibling or parent
            // or we might construct it if KP uses standard patterns.
            // However, the snippet says: Постер: из style="background-image: url(...)"
            // Let's look for elements with background-image near the trailer container.
            
            let posterUrl = null;
            
            // Often KP video previews are in a div with class 'play' or similar that has the background style
            // Let's search for any element with background-image that contains 'trailer' or 'video' or 'preview'
            // OR simply look for the closest element with a style attribute containing 'url'
            
            const walker = document.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
            while(walker.nextNode()) {
                const el = walker.currentNode;
                const style = el.getAttribute('style');
                if (style && style.includes('background-image') && style.includes(trailerId)) {
                     // High probability this is it if it mentions the ID, 
                     // but KP might use generic "preview" URLs.
                     // The snippet implies it's "Structured".
                     const match = style.match(/url\((['"]?)(.*?)\1\)/);
                     if (match) {
                         posterUrl = match[2];
                         break;
                     }
                }
            }
            
            // Fallback for poster if not found above
            if (!posterUrl) {
                // Try to find an img tag that might be the preview
                 const img = window.kinopoiskService?.getMovieImages ? null : null; // We don't have access to service here easily
                 // Use a default or leave null to let UI handle it with movie poster
            }

            // Duration: "справа снизу на постере" implies it's an element overlaid on the poster.
            // Search for text like "2 мин" or "01:30"
            let duration = '';
            // We can look for siblings of the found title or container
            // This is harder without the full HTML, but well try a regex across the nearby text content
            
            // Let's try to extract from the whole block containing the trailer
            const trailerRow = trailerContainer.closest('tr');
            if (trailerRow) {
                const textContent = trailerRow.textContent;
                const timeMatch = textContent.match(/(\d+)\s*мин/);
                if (timeMatch) {
                    duration = `${timeMatch[1]} мин`;
                }
            }


            // Normalize URL
            if (videoUrl && videoUrl.startsWith('//')) {
                 videoUrl = 'https:' + videoUrl;
            } else if (!videoUrl && filmId && trailerId) {
                // Fallback: Construct widget URL manually if iframe is not in static HTML
                videoUrl = `https://widgets.kinopoisk.ru/discovery/${section}/${filmId}/trailer/${trailerId}?onlyPlayer=1&autoplay=1&noAd=1`;
                console.log('[TrailerParsing] Constructed videoUrl:', videoUrl);
            }
            
            // If poster is missing, we might want to defer to the main movie poster in the UI
            
            const result = {
                id: trailerId,
                filmId: filmId,
                videoUrl: videoUrl,
                title: title,
                posterUrl: posterUrl,
                duration: duration
            };
            
            // Save to cache
            if (result.videoUrl) {
                this.saveToCache(movieId, result);
            }
            
            return result;

        } catch (error) {
            console.error('[TrailerParsing] Error fetching trailer:', error);
            return null;
        }
    }

    saveToCache(movieId, data) {
        try {
            const cacheEntry = {
                timestamp: Date.now(),
                data: data
            };
            localStorage.setItem(this.storageKey + movieId, JSON.stringify(cacheEntry));
        } catch (e) {
            console.warn('Failed to save trailer to cache', e);
        }
    }

    getFromCache(movieId) {
        try {
            const json = localStorage.getItem(this.storageKey + movieId);
            if (!json) return null;

            const cacheEntry = JSON.parse(json);
            if (Date.now() - cacheEntry.timestamp > this.cacheDuration) {
                localStorage.removeItem(this.storageKey + movieId);
                return null;
            }

            return cacheEntry.data;
        } catch (e) {
            return null;
        }
    }
}

// Export as global
if (typeof window !== 'undefined') {
    window.TrailerParsingService = TrailerParsingService;
}
