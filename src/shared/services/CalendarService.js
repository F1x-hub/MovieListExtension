import { TMDB_API_KEY, TMDB_BASE_URL } from '../config/tmdb.config.js';

const DAYS_AHEAD = 730; // Show everything within the next 2 years
const MONTHS_RU = [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
];
const SERIES_TYPE_HINTS = ['tv', 'series', 'anime', 'animated'];

function isTmdbConfigured() {
    return TMDB_API_KEY && !TMDB_API_KEY.includes('YOUR_TMDB_API_KEY');
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
        item.name
    ]);
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

async function fetchJson(url) {
    const response = await fetch(url);

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`TMDB request failed: ${response.status} ${errorText}`);
    }

    return response.json();
}

async function getTrackedItems() {
    const statuses = ['watching', 'plan_to_watch'];
    const allItems = [];

    for (const status of statuses) {
        const response = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
                { action: 'getWatchlistByStatus', status: status },
                (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }
                    resolve(response);
                }
            );
        });

        if (response?.success && Array.isArray(response.items)) {
            allItems.push(...response.items);
        }
    }

    // Deduplicate by movieId/kinopoiskId
    const seen = new Set();
    return allItems.filter(item => {
        const id = item.movieId || item.kinopoiskId || item.id;
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
    });
}

async function getTmdbId(item) {
    const isSeries = hasSeriesHints(item);
    const tmdbType = isSeries ? 'tv' : 'movie';
    const allTitles = getShowTitles(item);

    // 1. Try Find by IMDb ID (Best way)
    if (item.imdbId) {
        try {
            const data = await fetchJson(
                `${TMDB_BASE_URL}/find/${encodeURIComponent(item.imdbId)}?api_key=${TMDB_API_KEY}&external_source=imdb_id&language=ru-RU`
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

    // 2. Try searching for EACH title we have
    for (const title of allTitles) {
        if (!title) continue;
        const query = encodeURIComponent(title);

        // a. Try with Year
        if (year) {
            try {
                const data = await fetchJson(
                    `${TMDB_BASE_URL}/search/${tmdbType}?api_key=${TMDB_API_KEY}&query=${query}&${yearParamName}=${year}&language=ru-RU`
                );
                const bestMatch = isSeries ? chooseBestTvMatch(item, data.results) : chooseBestMovieMatch(item, data.results);
                if (bestMatch?.id) return bestMatch.id;
            } catch (e) {}
        }

        // b. Try without Year
        try {
            const data = await fetchJson(
                `${TMDB_BASE_URL}/search/${tmdbType}?api_key=${TMDB_API_KEY}&query=${query}&language=ru-RU`
            );
            const bestMatch = isSeries ? chooseBestTvMatch(item, data.results) : chooseBestMovieMatch(item, data.results);
            if (bestMatch?.id) return bestMatch.id;
        } catch (e) {}
    }

    console.warn(`[Calendar] Could not find ${tmdbType} on TMDB after trying all titles:`, allTitles[0]);
    return null;
}

async function getMovieRelease(tmdbId, showName, kinoId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const maxDate = new Date(today);
    maxDate.setDate(maxDate.getDate() + DAYS_AHEAD);

    // Fetch with release_dates fallback
    const info = await fetchJson(
        `${TMDB_BASE_URL}/movie/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=release_dates`
    );

    let bestDate = info.release_date;

    // If main release_date is missing, try to find one in regional release_dates
    if (!bestDate && info.release_dates?.results) {
        const allRegional = info.release_dates.results.flatMap(r => r.release_dates || []);
        // Pick the earliest available date
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

async function getUpcomingEpisodes(tmdbId, showName, kinoId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const maxDate = new Date(today);
    maxDate.setDate(maxDate.getDate() + DAYS_AHEAD);

    const info = await fetchJson(
        `${TMDB_BASE_URL}/tv/${tmdbId}?api_key=${TMDB_API_KEY}&language=ru-RU`
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
        const season = await fetchJson(
            `${TMDB_BASE_URL}/tv/${tmdbId}/season/${seasonNumber}?api_key=${TMDB_API_KEY}&language=ru-RU`
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

export async function fetchCalendarEpisodes() {
    if (!isTmdbConfigured()) {
        throw new Error('TMDB API key is not configured');
    }

    const items = await getTrackedItems();
    if (!items.length) {
        return { grouped: {}, total: 0 };
    }

    const allEvents = [];

    await Promise.allSettled(
        items.map(async (item) => {
            try {
                const tmdbId = await getTmdbId(item);
                if (!tmdbId) {
                    return;
                }

                let events = [];
                if (hasSeriesHints(item)) {
                    events = await getUpcomingEpisodes(
                        tmdbId,
                        getPrimaryTitle(item),
                        item.movieId || item.kinopoiskId || item.id
                    );
                } else {
                    events = await getMovieRelease(
                        tmdbId,
                        getPrimaryTitle(item),
                        item.movieId || item.kinopoiskId || item.id
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
