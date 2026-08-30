const DAYS_AHEAD = 730; // Show everything within the next 2 years
const MONTHS_RU = [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
];
const SERIES_TYPE_HINTS = ['tv', 'series', 'anime', 'animated'];
const PLACEHOLDER_TITLES = new Set(['unknown title', 'неизвестное название']);

function resolveTMDBService(customService = null) {
    if (customService) return customService;
    if (typeof window !== 'undefined' && window.firebaseManager?.getTMDBService) {
        try {
            const svc = window.firebaseManager.getTMDBService();
            if (svc) return svc;
        } catch { /* Ignore */ }
    }
    if (typeof TMDBService !== 'undefined') {
        return new TMDBService();
    }
    if (typeof window !== 'undefined' && window.TMDBService) {
        return new window.TMDBService();
    }
    if (typeof globalThis !== 'undefined' && globalThis.TMDBService) {
        return new globalThis.TMDBService();
    }
    return null;
}

function isTmdbConfigured(tmdbService = resolveTMDBService()) {
    if (tmdbService && typeof tmdbService.isConfigured === 'function') {
        return tmdbService.isConfigured();
    }
    if (tmdbService && (tmdbService.hasDirectCredentials?.() || tmdbService.hasProxyAccess?.())) {
        return true;
    }
    const legacyConfig = typeof globalThis !== 'undefined' ? globalThis.TMDB_CONFIG : null;
    if (legacyConfig) {
        return (Array.isArray(legacyConfig.API_KEYS) && legacyConfig.API_KEYS.length > 0 && Boolean(legacyConfig.API_KEY)) ||
            Boolean(legacyConfig.TMDB_PROXY_URL);
    }
    return false;
}

function normalizeTitle(value = '') {
    return value
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9а-яё]+/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function uniqueValues(values) {
    return [...new Set(values.filter(Boolean))];
}

function getShowTitles(item) {
    return uniqueValues([
        item.movieTitleRu,
        item.movieTitle,
        item.nameRu,
        item.nameEn,
        item.name,
        item.title
    ].map((title) => String(title || '').trim())
        .filter((title) => !PLACEHOLDER_TITLES.has(title.toLowerCase())));
}

function getPrimaryTitle(item) {
    return getShowTitles(item)[0] || '';
}

function hasSeriesHints(item) {
    if (item.isSeries === true) {
        return true;
    }

    const type = String(item.type || item.kind || '').toLowerCase();
    if (SERIES_TYPE_HINTS.some((hint) => type.includes(hint))) {
        return true;
    }

    return Array.isArray(item.seasonsInfo) && item.seasonsInfo.length > 0;
}

function scoreTitlePair(source, target) {
    if (!source || !target) {
        return 0;
    }

    if (source === target) {
        return 100;
    }

    if (source.startsWith(target) || target.startsWith(source)) {
        return 88;
    }

    if (source.includes(target) || target.includes(source)) {
        return 76;
    }

    const sourceWords = source.split(' ');
    const targetWords = new Set(target.split(' '));
    const sharedWords = sourceWords.filter((word) => targetWords.has(word));

    if (!sharedWords.length) {
        return 0;
    }

    return Math.round((sharedWords.length / Math.max(sourceWords.length, targetWords.size)) * 70);
}

function chooseBestTvMatch(item, results) {
    if (!Array.isArray(results) || !results.length) {
        return null;
    }

    const titles = getShowTitles(item).map(normalizeTitle).filter(Boolean);
    const requestedYear = Number(item.releaseYear || item.year || 0);

    const scored = results.map((result) => {
        const resultTitles = uniqueValues([result.name, result.original_name]).map(normalizeTitle);
        let score = 0;

        titles.forEach((title) => {
            resultTitles.forEach((resultTitle) => {
                score = Math.max(score, scoreTitlePair(title, resultTitle));
            });
        });

        const firstAirYear = Number((result.first_air_date || '').slice(0, 4) || 0);
        if (requestedYear && firstAirYear) {
            if (requestedYear === firstAirYear) {
                score += 12;
            } else if (Math.abs(requestedYear - firstAirYear) === 1) {
                score += 6;
            }
        }

        return { result, score };
    }).sort((a, b) => b.score - a.score);

    const [best, second] = scored;
    if (!best) {
        return null;
    }

    const threshold = 52;
    if (best.score < threshold) {
        return null;
    }

    if (second && best.score < 80 && best.score - second.score < 5) {
        return null;
    }

    return best.result;
}

function chooseBestMovieMatch(item, results) {
    if (!Array.isArray(results) || !results.length) {
        return null;
    }

    const titles = getShowTitles(item).map(normalizeTitle).filter(Boolean);
    const requestedYear = Number(item.releaseYear || item.year || 0);

    const scored = results.map((result) => {
        const resultTitles = uniqueValues([result.title, result.original_title]).map(normalizeTitle);
        let score = 0;

        titles.forEach((title) => {
            resultTitles.forEach((resultTitle) => {
                score = Math.max(score, scoreTitlePair(title, resultTitle));
            });
        });

        const releaseYear = Number((result.release_date || '').slice(0, 4) || 0);
        if (requestedYear && releaseYear) {
            if (requestedYear === releaseYear) {
                score += 15; 
            } else if (Math.abs(requestedYear - releaseYear) === 1) {
                score += 8;
            }
        }

        return { result, score };
    }).sort((a, b) => b.score - a.score);

    const [best, second] = scored;
    if (!best) {
        return null;
    }

    const threshold = 65; 
    if (best.score < threshold) {
        return null;
    }

    if (second && best.score < 80 && best.score - second.score < 5) {
        return null;
    }

    return best.result;
}

async function fetchTmdbJson(url, tmdbService = resolveTMDBService()) {
    if (tmdbService && typeof tmdbService._fetchWithRotation === 'function') {
        const response = await tmdbService._fetchWithRotation(url, {
            headers: {
                Accept: 'application/json'
            }
        });
        if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            throw new Error(`TMDB request failed: ${response.status} ${errorText}`);
        }
        return response.json();
    }

    if (tmdbService && typeof tmdbService.fetchJson === 'function') {
        return tmdbService.fetchJson(url);
    }

    // Direct credentials fallback
    const directKey = tmdbService?.apiKey || (typeof globalThis !== 'undefined' && globalThis.TMDB_CONFIG?.API_KEY);
    if (directKey) {
        const response = await fetch(url, {
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${directKey}`
            }
        });
        if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            throw new Error(`TMDB request failed: ${response.status} ${errorText}`);
        }
        return response.json();
    }

    throw new Error('TMDBService is not available to execute TMDB request');
}

async function getTrackedItems() {
    const allItems = [];
    const seen = new Set();

    const addItem = (item) => {
        if (!item) return;
        const id = item.movieId || item.kinopoiskId || item.id;
        if (!id || seen.has(id)) return;
        seen.add(id);
        allItems.push(item);
    };

    // 1. Try reading from FavoriteService / local bookmarks cache
    try {
        let userId = null;
        if (typeof window !== 'undefined' && window.firebaseManager) {
            await window.firebaseManager.waitForAuthReady?.();
            userId = window.firebaseManager.getCurrentUser?.()?.uid;
        }
        if (!userId && typeof chrome !== 'undefined' && chrome.storage?.local) {
            const userRes = await chrome.storage.local.get(['user']);
            userId = userRes.user?.uid;
        }

        if (userId) {
            // Check local cache first for instant resolution
            if (typeof chrome !== 'undefined' && chrome.storage?.local) {
                const cacheKey = `bookmarks_cache_${userId}`;
                const cached = await chrome.storage.local.get([cacheKey]);
                const bookmarkList = cached[cacheKey]?.bookmarks || cached[cacheKey];
                if (Array.isArray(bookmarkList) && bookmarkList.length > 0) {
                    for (const item of bookmarkList) {
                        if (item && (item.status === 'watching' || item.status === 'plan_to_watch')) {
                            addItem(item);
                        }
                    }
                    if (allItems.length > 0) return allItems;
                }
            }

            // Direct Firestore query if available
            const favService = typeof window !== 'undefined' && window.firebaseManager?.getFavoriteService
                ? window.firebaseManager.getFavoriteService()
                : (typeof FavoriteService !== 'undefined' && window.firebaseManager ? new FavoriteService(window.firebaseManager) : null);

            if (favService && typeof favService.getFavorites === 'function') {
                const [watching, planToWatch] = await Promise.all([
                    favService.getFavorites(userId, 'watching').catch(() => []),
                    favService.getFavorites(userId, 'plan_to_watch').catch(() => [])
                ]);
                for (const item of [...watching, ...planToWatch]) {
                    addItem(item);
                }
                if (allItems.length > 0) return allItems;
            }
        }
    } catch (error) {
        console.warn('[Calendar] FavoriteService item resolution encountered warning:', error);
    }

    if (allItems.length > 0) {
        return allItems;
    }

    // 2. Fallback to background messaging if available
    try {
        const statuses = ['watching', 'plan_to_watch'];
        for (const status of statuses) {
            const response = await new Promise((resolve) => {
                if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
                    resolve(null);
                    return;
                }
                chrome.runtime.sendMessage(
                    { action: 'getWatchlistByStatus', status: status },
                    (res) => {
                        if (chrome.runtime.lastError) {
                            resolve(null);
                            return;
                        }
                        resolve(res);
                    }
                );
            });

            if (response?.success && Array.isArray(response.items)) {
                response.items.forEach(addItem);
            }
        }
    } catch (e) {
        console.warn('[Calendar] Background message fallback failed:', e);
    }

    return allItems;
}

async function getTmdbId(item, tmdbService = resolveTMDBService()) {
    const tmdbBaseUrl = tmdbService?.baseUrl || 'https://api.themoviedb.org/3';
    const tmdbLanguage = tmdbService?.defaultLanguage || 'ru-RU';
    const isSeries = hasSeriesHints(item);
    const tmdbType = isSeries ? 'tv' : 'movie';
    const allTitles = getShowTitles(item);

    // 1. Try Find by IMDb ID (Best way)
    const imdbId = item.imdbId || item.externalId?.imdb;
    if (imdbId) {
        try {
            const data = await fetchTmdbJson(
                `${tmdbBaseUrl}/find/${encodeURIComponent(imdbId)}?external_source=imdb_id&language=${tmdbLanguage}`,
                tmdbService
            );
            const results = isSeries ? data.tv_results : data.movie_results;
            const found = results?.[0];
            if (found?.id) {
                return found.id;
            }
        } catch (e) {
            console.warn(`[Calendar] Find via IMDb failed:`, e);
        }
    }

    const year = item.releaseYear || item.year;
    const yearParamName = isSeries ? 'first_air_date_year' : 'primary_release_year';

    if (!allTitles.length) {
        console.warn('[Calendar] Skipping item without a reliable title or IMDb ID:', item.movieId || item.kinopoiskId || item.id);
        return null;
    }

    // 2. Try searching for EACH title we have
    for (const title of allTitles) {
        if (!title) continue;
        const query = encodeURIComponent(title);

        // a. Try with Year
        if (year) {
            try {
                const data = await fetchTmdbJson(
                    `${tmdbBaseUrl}/search/${tmdbType}?query=${query}&${yearParamName}=${year}&language=${tmdbLanguage}`,
                    tmdbService
                );
                const bestMatch = isSeries ? chooseBestTvMatch(item, data.results) : chooseBestMovieMatch(item, data.results);
                if (bestMatch?.id) return bestMatch.id;
            } catch { /* Ignore */ }
        }

        // b. Try without Year
        try {
            const data = await fetchTmdbJson(
                `${tmdbBaseUrl}/search/${tmdbType}?query=${query}&language=${tmdbLanguage}`,
                tmdbService
            );
            const bestMatch = isSeries ? chooseBestTvMatch(item, data.results) : chooseBestMovieMatch(item, data.results);
            if (bestMatch?.id) return bestMatch.id;
        } catch { /* Ignore */ }
    }

    console.warn(`[Calendar] Could not find ${tmdbType} on TMDB after trying all titles:`, allTitles[0]);
    return null;
}

async function getMovieRelease(tmdbId, showName, kinoId, tmdbService = resolveTMDBService()) {
    const tmdbBaseUrl = tmdbService?.baseUrl || 'https://api.themoviedb.org/3';
    const tmdbLanguage = tmdbService?.defaultLanguage || 'ru-RU';
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const maxDate = new Date(today);
    maxDate.setDate(maxDate.getDate() + DAYS_AHEAD);

    // Fetch with release_dates fallback
    const info = await fetchTmdbJson(
        `${tmdbBaseUrl}/movie/${tmdbId}?append_to_response=release_dates&language=${tmdbLanguage}`,
        tmdbService
    );

    let bestDate = info.release_date;

    // If main release_date is missing, try to find one in regional release_dates
    if (!bestDate && info.release_dates?.results) {
        const allRegional = info.release_dates.results.flatMap(r => r.release_dates || []);
        const sorted = allRegional
            .map(rd => rd.release_date)
            .filter(Boolean)
            .sort();
        if (sorted.length > 0) {
            bestDate = sorted[0].split('T')[0];
        }
    }

    if (!bestDate) {
        return [];
    }

    const releaseDate = new Date(bestDate);
    releaseDate.setHours(0, 0, 0, 0);

    if (releaseDate < today || releaseDate > maxDate) {
        return [];
    }

    return [{
        showName,
        kinoId,
        tmdbId,
        isMovie: true,
        airDate: bestDate
    }];
}

async function getUpcomingEpisodes(tmdbId, showName, kinoId, tmdbService = resolveTMDBService()) {
    const tmdbBaseUrl = tmdbService?.baseUrl || 'https://api.themoviedb.org/3';
    const tmdbLanguage = tmdbService?.defaultLanguage || 'ru-RU';
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const maxDate = new Date(today);
    maxDate.setDate(maxDate.getDate() + DAYS_AHEAD);

    const info = await fetchTmdbJson(
        `${tmdbBaseUrl}/tv/${tmdbId}?language=${tmdbLanguage}`,
        tmdbService
    );

    const episodes = [];
    const addedEpisodes = new Set();
    const seasonsToCheck = new Set();

    if (info.next_episode_to_air?.season_number) {
        seasonsToCheck.add(info.next_episode_to_air.season_number);
    }

    if (info.last_episode_to_air?.season_number) {
        seasonsToCheck.add(info.last_episode_to_air.season_number);
    }

    if (info.number_of_seasons) {
        seasonsToCheck.add(info.number_of_seasons);
    }

    for (const seasonNumber of seasonsToCheck) {
        const season = await fetchTmdbJson(
            `${tmdbBaseUrl}/tv/${tmdbId}/season/${seasonNumber}?language=${tmdbLanguage}`,
            tmdbService
        );

        for (const episode of season.episodes || []) {
            if (!episode.air_date) {
                continue;
            }

            const airDate = new Date(episode.air_date);
            airDate.setHours(0, 0, 0, 0);

            if (airDate < today || airDate > maxDate) {
                continue;
            }

            const dedupeKey = `${tmdbId}_${episode.season_number}_${episode.episode_number}_${episode.air_date}`;
            if (addedEpisodes.has(dedupeKey)) {
                continue;
            }

            addedEpisodes.add(dedupeKey);
            episodes.push({
                showName,
                kinoId,
                tmdbId,
                season: episode.season_number,
                episode: episode.episode_number,
                episodeName: episode.name || '',
                airDate: episode.air_date
            });
        }
    }

    return episodes;
}

export async function fetchCalendarEpisodes(options = {}) {
    const tmdbService = resolveTMDBService(options.tmdbService);
    if (!isTmdbConfigured(tmdbService)) {
        throw new Error('TMDB API key is not configured');
    }

    const items = options.items || await getTrackedItems();
    if (!items.length) {
        return { grouped: {}, total: 0 };
    }

    const allEvents = [];

    await Promise.allSettled(
        items.map(async (item) => {
            try {
                const tmdbId = item.tmdbId || await getTmdbId(item, tmdbService);
                if (!tmdbId) {
                    return;
                }

                let events = [];
                if (hasSeriesHints(item)) {
                    events = await getUpcomingEpisodes(
                        tmdbId,
                        getPrimaryTitle(item),
                        item.movieId || item.kinopoiskId || item.id,
                        tmdbService
                    );
                } else {
                    events = await getMovieRelease(
                        tmdbId,
                        getPrimaryTitle(item),
                        item.movieId || item.kinopoiskId || item.id,
                        tmdbService
                    );
                }

                allEvents.push(...events);
            } catch (error) {
                console.warn('[Calendar] Failed to resolve item', getPrimaryTitle(item), error);
            }
        })
    );

    allEvents.sort((a, b) => new Date(a.airDate) - new Date(b.airDate));

    const grouped = {};

    allEvents.forEach((event) => {
        const date = new Date(event.airDate);
        const monthKey = `${MONTHS_RU[date.getMonth()]}__${date.getFullYear()}`;
        const dayKey = event.airDate;

        if (!grouped[monthKey]) {
            grouped[monthKey] = {};
        }

        if (!grouped[monthKey][dayKey]) {
            grouped[monthKey][dayKey] = [];
        }

        grouped[monthKey][dayKey].push(event);
    });

    return {
        grouped,
        total: allEvents.length
    };
}

export {
    isTmdbConfigured,
    getTrackedItems,
    getTmdbId,
    getMovieRelease,
    getUpcomingEpisodes
};
