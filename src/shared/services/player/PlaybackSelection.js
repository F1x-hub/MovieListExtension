/**
 * Canonical PlaybackSelection Contract & Normalization for MovieDetails Player.
 * Single source of truth for media item identity, episode context, and provider targets.
 */

const VALID_MEDIA_TYPES = new Set([
    'movie',
    'tv-series',
    'mini-series',
    'anime',
    'cartoon'
]);

const VALID_SOURCES = new Set([
    'HERO_WATCH',
    'SEASONS_TAB',
    'NEXT_EPISODE_HERO',
    'RESUME',
    'PROVIDER_SWITCH',
    'PLAYER_NAVIGATION',
    'AUTO_NEXT',
    'PLAYER_PROVIDER_PICKER'
]);

/**
 * Detects whether a media item is a series/episodic format based on all standard taxonomy signals.
 * @param {Object} item
 * @returns {boolean}
 */
function isSeriesMedia(item) {
    if (!item || typeof item !== 'object') return false;
    if (item.isSeries === true) return true;
    if (item.isSeries === false && !item.type && !item.mediaType && !item.seasons?.length && !item.seasonsInfo?.length) {
        return false;
    }

    const normMediaType = String(item.mediaType || '').toLowerCase().trim();
    if (['tv', 'tv-series', 'series', 'mini-series', 'animated-series', 'tv-show', 'tv_series'].includes(normMediaType)) {
        return true;
    }

    const normType = String(item.type || '').toLowerCase().trim().replace(/_/g, '-');
    if (['tv', 'tv-series', 'series', 'mini-series', 'animated-series', 'tv-show', 'tv_series'].includes(normType)) {
        return true;
    }

    if (Array.isArray(item.seasons) && item.seasons.length > 0) return true;
    if (Array.isArray(item.seasonsInfo) && item.seasonsInfo.length > 0) return true;
    if (item.totalSeasons && Number(item.totalSeasons) > 0) return true;
    if (item.first_air_date !== undefined) return true;

    return false;
}

/**
 * Normalizes and validates an arbitrary input into a strict PlaybackSelection object.
 * @param {Object} input
 * @returns {Object} Canonical PlaybackSelection
 * @throws {Error} with message containing 'INVALID_PLAYBACK_SELECTION' on invalid input
 */
function normalizePlaybackSelection(input) {
    if (!input || typeof input !== 'object') {
        const error = new Error('INVALID_PLAYBACK_SELECTION: input must be a non-null object');
        error.code = 'INVALID_PLAYBACK_SELECTION';
        throw error;
    }

    // Kinopoisk ID must be a positive integer
    const rawKpId = Number(input.kinopoiskId);
    if (!Number.isInteger(rawKpId) || rawKpId <= 0) {
        const error = new Error('INVALID_PLAYBACK_SELECTION: kinopoiskId must be a positive integer');
        error.code = 'INVALID_PLAYBACK_SELECTION';
        throw error;
    }
    const kinopoiskId = rawKpId;

    // Optional IDs
    let tmdbId = null;
    if (input.tmdbId != null && input.tmdbId !== '') {
        const parsedTmdb = Number(input.tmdbId);
        if (Number.isInteger(parsedTmdb) && parsedTmdb > 0) {
            tmdbId = parsedTmdb;
        }
    }

    let imdbId = null;
    if (input.imdbId && typeof input.imdbId === 'string' && input.imdbId.trim().length > 0) {
        imdbId = input.imdbId.trim();
    }

    // Title
    const title = typeof input.title === 'string' ? input.title.trim() : '';

    // Media Type Normalization
    let mediaType = 'movie';
    if (input.mediaType && VALID_MEDIA_TYPES.has(input.mediaType)) {
        mediaType = input.mediaType;
    } else if (isSeriesMedia(input)) {
        mediaType = 'tv-series';
    }

    const isSeries = mediaType !== 'movie';

    // Season & Episode Normalization
    let seasonNumber = null;
    let episodeNumber = null;
    let episodeTitle = null;

    if (isSeries) {
        // Season 0 is valid for Specials
        if (input.seasonNumber != null && input.seasonNumber !== '') {
            const parsedSeason = Number(input.seasonNumber);
            if (Number.isInteger(parsedSeason) && parsedSeason >= 0) {
                seasonNumber = parsedSeason;
            } else {
                const error = new Error('INVALID_PLAYBACK_SELECTION: series seasonNumber must be an integer >= 0');
                error.code = 'INVALID_PLAYBACK_SELECTION';
                throw error;
            }
        }

        // Episode number must be > 0 when provided
        if (input.episodeNumber != null && input.episodeNumber !== '') {
            const parsedEpisode = Number(input.episodeNumber);
            if (Number.isInteger(parsedEpisode) && parsedEpisode > 0) {
                episodeNumber = parsedEpisode;
            } else {
                const error = new Error('INVALID_PLAYBACK_SELECTION: series episodeNumber must be an integer > 0');
                error.code = 'INVALID_PLAYBACK_SELECTION';
                throw error;
            }
        }

        if (typeof input.episodeTitle === 'string' && input.episodeTitle.trim().length > 0) {
            episodeTitle = input.episodeTitle.trim();
        }
    } else {
        // Movie invariant: seasonNumber and episodeNumber are strictly null
        seasonNumber = null;
        episodeNumber = null;
        episodeTitle = null;
    }

    // Provider ID & Source URL
    const providerId = typeof input.providerId === 'string' && input.providerId.trim().length > 0
        ? input.providerId.trim()
        : null;

    const sourceUrl = typeof input.sourceUrl === 'string' && input.sourceUrl.trim().length > 0
        ? input.sourceUrl.trim()
        : null;

    // Origin Source
    let source = 'HERO_WATCH';
    if (input.source && VALID_SOURCES.has(input.source)) {
        source = input.source;
    }

    // Initial Timestamp
    let initialTimestamp = 0;
    if (input.initialTimestamp != null && !Number.isNaN(Number(input.initialTimestamp))) {
        const parsedTs = Number(input.initialTimestamp);
        if (parsedTs >= 0) {
            initialTimestamp = parsedTs;
        }
    }

    return {
        kinopoiskId,
        tmdbId,
        imdbId,
        title,
        mediaType,
        seasonNumber,
        episodeNumber,
        episodeTitle,
        providerId,
        sourceUrl,
        source,
        initialTimestamp
    };
}

/**
 * Resolves the canonical watch target (season, episode, timestamp, reason)
 * based on saved progress and movie metadata.
 * @param {Object} movie
 * @param {Object} [progress]
 * @param {Object} [options]
 * @returns {Object|null}
 */
function resolveWatchTarget(movie, progress = null, options = {}) {
    if (!movie) return null;

    const isSeries = isSeriesMedia(movie);
    
    // Normalization fallback
    const normProgress = (typeof normalizeProgressRecord === 'function')
        ? normalizeProgressRecord(progress)
        : (progress ? {
            season: typeof progress.season === 'number' ? progress.season : (String(progress.season || '').match(/(\d+)/)?.[1] ? parseInt(String(progress.season).match(/(\d+)/)[1], 10) : null),
            episode: typeof progress.episode === 'number' ? progress.episode : (String(progress.episode || '').match(/(\d+)/)?.[1] ? parseInt(String(progress.episode).match(/(\d+)/)[1], 10) : null),
            timestamp: typeof progress.timestamp === 'number' ? progress.timestamp : 0,
            completed: Boolean(progress.completed)
        } : null);

    if (!isSeries) {
        return {
            seasonNumber: null,
            episodeNumber: null,
            initialTimestamp: normProgress?.timestamp || 0,
            reason: normProgress ? 'RESUME_IN_PROGRESS' : 'NEW_SERIES'
        };
    }

    const seasons = Array.isArray(movie.seasons) ? movie.seasons : [];
    const getSeasonNum = (s) => Number(s.season_number ?? s.seasonNumber ?? s.number ?? -1);

    const regularSeasons = seasons
        .filter(s => getSeasonNum(s) > 0)
        .sort((a, b) => getSeasonNum(a) - getSeasonNum(b));

    // 1. No progress recorded -> start first playable regular season episode (S1E1)
    if (!normProgress || (normProgress.season == null && normProgress.episode == null)) {
        let targetSeason = 1;
        if (regularSeasons.length > 0) {
            const hasS1 = regularSeasons.some(s => getSeasonNum(s) === 1);
            if (!hasS1) {
                targetSeason = getSeasonNum(regularSeasons[0]);
            }
        }
        return {
            seasonNumber: targetSeason,
            episodeNumber: 1,
            initialTimestamp: 0,
            reason: 'NEW_SERIES'
        };
    }

    // 2. Incomplete progress -> resume exact S/E and timestamp
    if (!normProgress.completed) {
        return {
            seasonNumber: normProgress.season,
            episodeNumber: normProgress.episode,
            initialTimestamp: normProgress.timestamp || 0,
            reason: 'RESUME_IN_PROGRESS'
        };
    }

    // 3. Completed progress -> resolve adjacent next episode
    const currentSelection = {
        mediaType: 'tv-series',
        seasonNumber: normProgress.season,
        episodeNumber: normProgress.episode
    };

    const resolveAdjacent = options.resolveAdjacentEpisode || resolveAdjacentEpisode || (typeof window !== 'undefined' && window.resolveAdjacentEpisode) || null;

    let adjacentNext = null;
    if (typeof resolveAdjacent === 'function') {
        adjacentNext = resolveAdjacent(movie, currentSelection, 'next', options);
    }

    if (adjacentNext && adjacentNext.seasonNumber != null && adjacentNext.episodeNumber != null) {
        return {
            seasonNumber: adjacentNext.seasonNumber,
            episodeNumber: adjacentNext.episodeNumber,
            initialTimestamp: 0,
            reason: 'NEXT_AFTER_COMPLETED'
        };
    }

    // 4. Completed final episode of series or next episode unreleased -> stay on completed final episode
    return {
        seasonNumber: normProgress.season,
        episodeNumber: normProgress.episode,
        initialTimestamp: 0,
        reason: 'FINAL_EPISODE_COMPLETED'
    };
}

/**
 * Resolves the adjacent playable episode (previous or next) based on host-owned season metadata.
 * Pure function with zero network requests.
 * @param {Object} movie
 * @param {Object} selection Current selection
 * @param {'previous'|'next'} direction
 * @param {Object} [options]
 * @returns {Object|null} { seasonNumber, episodeNumber, episodeTitle, airDate, isReleased } or null
 */
function resolveAdjacentEpisode(movie, selection, direction, options = {}) {
    if (!movie || !selection || !direction) return null;
    if (selection.mediaType === 'movie') return null;
    if (selection.seasonNumber == null || selection.episodeNumber == null) return null;

    const currentSeasonNum = Number(selection.seasonNumber);
    const currentEpNum = Number(selection.episodeNumber);
    if (!Number.isInteger(currentSeasonNum) || currentSeasonNum < 0) return null;
    if (!Number.isInteger(currentEpNum) || currentEpNum <= 0) return null;

    const defaultPlayabilityCheck = (ep) => {
        if (!ep) return false;
        const airDate = ep.air_date || ep.airDate;
        if (!airDate) return true; // Missing airDate treated as released
        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const epDate = new Date(airDate);
            if (Number.isNaN(epDate.getTime())) return true;
            epDate.setHours(0, 0, 0, 0);
            return epDate <= today;
        } catch {
            return true;
        }
    };

    const playabilityCheck = options.isEpisodePlayableByDate || (typeof window !== 'undefined' && window.isEpisodePlayableByDate) || defaultPlayabilityCheck;
    const seasons = Array.isArray(movie.seasons) ? movie.seasons : [];

    const getSeasonNum = (s) => Number(s.season_number ?? s.seasonNumber ?? s.number ?? -1);
    const getEpCount = (s) => Number(s.episode_count ?? s.episodeCount ?? s.episodesCount ?? s.episodes?.length ?? 0);

    // ==========================================
    // SPECIALS / SEASON 0 (Isolated)
    // ==========================================
    if (currentSeasonNum === 0) {
        const season0 = seasons.find(s => getSeasonNum(s) === 0);
        let season0Count = season0 ? getEpCount(season0) : 0;
        if (options.loadedEpisodes && options.loadedSeasonNumber === 0) {
            season0Count = Math.max(season0Count, options.loadedEpisodes.length);
        }

        if (direction === 'previous') {
            if (currentEpNum > 1) {
                const prevEpNum = currentEpNum - 1;
                let epObj = null;
                if (season0?.episodes) epObj = season0.episodes.find(e => Number(e.episode_number ?? e.episodeNumber ?? e.number) === prevEpNum);
                else if (options.loadedEpisodes && options.loadedSeasonNumber === 0) epObj = options.loadedEpisodes.find(e => Number(e.episode_number ?? e.episodeNumber ?? e.number) === prevEpNum);
                return {
                    seasonNumber: 0,
                    episodeNumber: prevEpNum,
                    episodeTitle: epObj?.name || epObj?.title || epObj?.nameRu || null,
                    airDate: epObj?.air_date || epObj?.airDate || null,
                    isReleased: true
                };
            }
            return null;
        }

        if (direction === 'next') {
            if (season0Count > 0 && currentEpNum < season0Count) {
                const nextEpNum = currentEpNum + 1;
                let epObj = null;
                if (season0?.episodes) epObj = season0.episodes.find(e => Number(e.episode_number ?? e.episodeNumber ?? e.number) === nextEpNum);
                else if (options.loadedEpisodes && options.loadedSeasonNumber === 0) epObj = options.loadedEpisodes.find(e => Number(e.episode_number ?? e.episodeNumber ?? e.number) === nextEpNum);

                if (epObj && !playabilityCheck(epObj)) return null;

                return {
                    seasonNumber: 0,
                    episodeNumber: nextEpNum,
                    episodeTitle: epObj?.name || epObj?.title || epObj?.nameRu || null,
                    airDate: epObj?.air_date || epObj?.airDate || null,
                    isReleased: true
                };
            }
            return null; // Specials do NOT jump to Season 1
        }
        return null;
    }

    // ==========================================
    // REGULAR SEASONS (SEASON >= 1)
    // ==========================================
    const regularSeasons = seasons
        .filter(s => getSeasonNum(s) > 0)
        .sort((a, b) => getSeasonNum(a) - getSeasonNum(b));

    const currentSeasonObj = regularSeasons.find(s => getSeasonNum(s) === currentSeasonNum);
    let currentSeasonEpCount = currentSeasonObj ? getEpCount(currentSeasonObj) : 0;
    if (options.loadedEpisodes && options.loadedSeasonNumber === currentSeasonNum) {
        currentSeasonEpCount = Math.max(currentSeasonEpCount, options.loadedEpisodes.length);
    }

    // ------------------------------------------
    // DIRECTION: PREVIOUS
    // ------------------------------------------
    if (direction === 'previous') {
        if (currentEpNum > 1) {
            const targetEpNum = currentEpNum - 1;
            let epObj = null;
            if (currentSeasonObj?.episodes) {
                epObj = currentSeasonObj.episodes.find(e => Number(e.episode_number ?? e.episodeNumber ?? e.number) === targetEpNum);
            } else if (options.loadedEpisodes && options.loadedSeasonNumber === currentSeasonNum) {
                epObj = options.loadedEpisodes.find(e => Number(e.episode_number ?? e.episodeNumber ?? e.number) === targetEpNum);
            }

            return {
                seasonNumber: currentSeasonNum,
                episodeNumber: targetEpNum,
                episodeTitle: epObj?.name || epObj?.title || epObj?.nameRu || null,
                airDate: epObj?.air_date || epObj?.airDate || null,
                isReleased: true
            };
        }

        if (currentEpNum === 1) {
            const prevSeasons = regularSeasons.filter(s => getSeasonNum(s) < currentSeasonNum);
            if (prevSeasons.length === 0) return null; // S1E1 has no previous

            const prevSeasonObj = prevSeasons[prevSeasons.length - 1];
            const prevSeasonNum = getSeasonNum(prevSeasonObj);
            const prevSeasonEpCount = getEpCount(prevSeasonObj);
            if (prevSeasonEpCount <= 0) return null;

            let epObj = null;
            if (prevSeasonObj.episodes) {
                epObj = prevSeasonObj.episodes.find(e => Number(e.episode_number ?? e.episodeNumber ?? e.number) === prevSeasonEpCount);
            }

            return {
                seasonNumber: prevSeasonNum,
                episodeNumber: prevSeasonEpCount,
                episodeTitle: epObj?.name || epObj?.title || epObj?.nameRu || null,
                airDate: epObj?.air_date || epObj?.airDate || null,
                isReleased: true
            };
        }

        return null;
    }

    // ------------------------------------------
    // DIRECTION: NEXT
    // ------------------------------------------
    if (direction === 'next') {
        // Same-season next
        if (currentSeasonEpCount > 0 && currentEpNum < currentSeasonEpCount) {
            const targetEpNum = currentEpNum + 1;
            let epObj = null;
            if (currentSeasonObj?.episodes) {
                epObj = currentSeasonObj.episodes.find(e => Number(e.episode_number ?? e.episodeNumber ?? e.number) === targetEpNum);
            } else if (options.loadedEpisodes && options.loadedSeasonNumber === currentSeasonNum) {
                epObj = options.loadedEpisodes.find(e => Number(e.episode_number ?? e.episodeNumber ?? e.number) === targetEpNum);
            }

            if (epObj && !playabilityCheck(epObj)) {
                return null;
            }

            if (movie.nextEpisode) {
                const nextEpSeason = Number(movie.nextEpisode.season_number ?? movie.nextEpisode.seasonNumber);
                const nextEpNum = Number(movie.nextEpisode.episode_number ?? movie.nextEpisode.episodeNumber);
                if (nextEpSeason === currentSeasonNum && nextEpNum === targetEpNum) {
                    if (!playabilityCheck(movie.nextEpisode)) {
                        return null;
                    }
                }
            }

            return {
                seasonNumber: currentSeasonNum,
                episodeNumber: targetEpNum,
                episodeTitle: epObj?.name || epObj?.title || epObj?.nameRu || null,
                airDate: epObj?.air_date || epObj?.airDate || null,
                isReleased: true
            };
        }

        // Cross-season next
        if (currentSeasonEpCount > 0 && currentEpNum >= currentSeasonEpCount) {
            const nextSeasons = regularSeasons.filter(s => getSeasonNum(s) > currentSeasonNum);
            if (nextSeasons.length === 0) return null; // Last season of ended/current run

            const nextSeasonObj = nextSeasons[0];
            const nextSeasonNum = getSeasonNum(nextSeasonObj);
            const nextSeasonEpCount = getEpCount(nextSeasonObj);
            if (nextSeasonEpCount <= 0) return null;

            let epObj = null;
            if (nextSeasonObj.episodes) {
                epObj = nextSeasonObj.episodes.find(e => Number(e.episode_number ?? e.episodeNumber ?? e.number) === 1);
            }

            if (epObj && !playabilityCheck(epObj)) {
                return null;
            }

            if (movie.nextEpisode) {
                const nextEpSeason = Number(movie.nextEpisode.season_number ?? movie.nextEpisode.seasonNumber);
                const nextEpNum = Number(movie.nextEpisode.episode_number ?? movie.nextEpisode.episodeNumber);
                if (nextEpSeason === nextSeasonNum && nextEpNum === 1) {
                    if (!playabilityCheck(movie.nextEpisode)) {
                        return null;
                    }
                }
            }

            return {
                seasonNumber: nextSeasonNum,
                episodeNumber: 1,
                episodeTitle: epObj?.name || epObj?.title || epObj?.nameRu || null,
                airDate: epObj?.air_date || epObj?.airDate || null,
                isReleased: true
            };
        }

        return null;
    }

    return null;
}

if (typeof window !== 'undefined') {
    window.isSeriesMedia = isSeriesMedia;
    window.normalizePlaybackSelection = normalizePlaybackSelection;
    window.resolveWatchTarget = resolveWatchTarget;
    window.resolveAdjacentEpisode = resolveAdjacentEpisode;
    window.VALID_PLAYBACK_MEDIA_TYPES = VALID_MEDIA_TYPES;
    window.VALID_PLAYBACK_SOURCES = VALID_SOURCES;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        isSeriesMedia,
        normalizePlaybackSelection,
        resolveWatchTarget,
        resolveAdjacentEpisode,
        VALID_MEDIA_TYPES,
        VALID_SOURCES
    };
}
