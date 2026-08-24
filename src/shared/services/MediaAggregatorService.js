/**
 * MediaAggregatorService - V1 Unified Media Aggregation Service
 * Combines Kinopoisk and TMDB into a single legacy-compatible UnifiedMovieDTO.
 *
 * Invariants:
 * 1. kinopoiskId > 0 is the immutable root system identifier.
 * 2. Identity contract and metadata quality are strictly orthogonal.
 * 3. Exact externalId.tmdb / externalId.imdb / admin confirm yield VERIFIED identity.
 * 4. Heuristic matches never auto-verify.
 * 5. Ratings are isolated: KP <- KP only, IMDb <- IMDb only, TMDB <- TMDB only.
 * 6. DEGRADED pipeline status is operational telemetry and does NOT block rendering.
 * 7. Verified identity is immutable against downstream metadata drops.
 */

const TMDB_LOGO_SELECTION_VERSION = 3;

class MediaAggregatorService {
    /**
     * @param {Object} [dependencies]
     * @param {Object} [dependencies.kinopoiskService]
     * @param {Object} [dependencies.tmdbService]
     * @param {Object} [dependencies.idMappingService]
     * @param {Object} [dependencies.movieCacheService]
     */
    constructor(dependencies = {}) {
        this.kinopoiskService = dependencies.kinopoiskService || (typeof KinopoiskService !== 'undefined' ? new KinopoiskService() : null);
        this.tmdbService = dependencies.tmdbService || (typeof TMDBService !== 'undefined' ? new TMDBService() : null);
        this.idMappingService = dependencies.idMappingService || (typeof IdMappingService !== 'undefined'
            ? new IdMappingService(this.kinopoiskService, this.tmdbService)
            : null);
        this.movieCacheService = dependencies.movieCacheService || (typeof MovieCacheService !== 'undefined' ? new MovieCacheService(typeof firebaseManager !== 'undefined' ? firebaseManager : null) : null);
    }

    static isFranchiseDebugEnabled() {
        if (typeof window === 'undefined' || !window.location || typeof URLSearchParams === 'undefined') return false;
        return new URLSearchParams(window.location.search).get('franchiseDebug') === '1';
    }

    static logFranchiseDebug(marker, details) {
        if (MediaAggregatorService.isFranchiseDebugEnabled()) {
            console.log(`[FranchiseDiag:${marker}]`, details);
        }
    }

    /**
     * Check if a string is a meaningless placeholder or generic default.
     * @param {string|null|undefined} text
     * @returns {boolean}
     */
    static isPlaceholder(text) {
        if (!text || typeof text !== 'string') return true;
        const trimmed = text.trim();
        if (!trimmed) return true;
        const lower = trimmed.toLowerCase();
        const placeholders = [
            'unknown title',
            'unknown movie',
            'unknown',
            'n/a',
            'na',
            'none',
            'null',
            'без названия',
            'нет описания',
            'описание отсутствует',
            'сюжет отсутствует',
            'loading...',
            'loading',
            'загрузка...'
        ];
        if (placeholders.includes(lower)) return true;
        // Generic "Фильм" or "Сериал" without other specific title content
        if (lower === 'фильм' || lower === 'сериал' || lower === 'мультфильм') return true;
        return false;
    }

    /**
     * Check if a text is meaningful and exceeds minimum length.
     * @param {string|null|undefined} text
     * @param {number} [minLength=1]
     * @returns {boolean}
     */
    static isMeaningfulText(text, minLength = 1) {
        if (this.isPlaceholder(text)) return false;
        return typeof text === 'string' && text.trim().length >= minLength;
    }

    /**
     * Classify metadata quality for a Kinopoisk entity.
     * Evaluates completeness without requiring ratings/votes.
     * @param {Object|null|undefined} kpMovie
     * @returns {'FULL'|'PARTIAL'|'DRAFT'|'EMPTY'|'UNAVAILABLE'}
     */
    static classifyKpQuality(kpMovie) {
        if (!kpMovie || typeof kpMovie !== 'object') return 'UNAVAILABLE';
        
        // Empty object check
        const keys = Object.keys(kpMovie).filter(k => kpMovie[k] !== null && kpMovie[k] !== undefined && kpMovie[k] !== '');
        if (keys.length === 0 || (keys.length === 1 && (keys[0] === 'kinopoiskId' || keys[0] === 'id') && !kpMovie.name && !kpMovie.year && !kpMovie.externalId)) {
            return 'EMPTY';
        }

        const hasName = this.isMeaningfulText(kpMovie.name);
        const hasAltName = this.isMeaningfulText(kpMovie.alternativeName || kpMovie.enName);
        const hasTitle = hasName || hasAltName;
        const hasYear = Boolean(Number(kpMovie.year) > 0);
        const hasPoster = Boolean(kpMovie.posterUrl && typeof kpMovie.posterUrl === 'string' && kpMovie.posterUrl.startsWith('http'));
        const hasDescription = this.isMeaningfulText(kpMovie.description, 20);
        const hasGenres = Array.isArray(kpMovie.genres) && kpMovie.genres.length > 0;

        // FULL: title + year + poster + description + genres (ratings NOT required)
        if (hasTitle && hasYear && hasPoster && hasDescription && hasGenres) {
            return 'FULL';
        }

        // PARTIAL: usable title + (poster OR description)
        if (hasTitle && (hasPoster || hasDescription)) {
            return 'PARTIAL';
        }

        // DRAFT: stub / skeleton (placeholder title, or missing both poster and description)
        return 'DRAFT';
    }

    /**
     * Classify metadata quality for a TMDB entity.
     * Evaluates completeness without requiring ratings/votes.
     * @param {Object|null|undefined} tmdbData
     * @returns {'FULL'|'PARTIAL'|'DRAFT'|'EMPTY'|'UNAVAILABLE'}
     */
    static classifyTmdbQuality(tmdbData) {
        if (!tmdbData || typeof tmdbData !== 'object') return 'UNAVAILABLE';

        const keys = Object.keys(tmdbData).filter(k => tmdbData[k] !== null && tmdbData[k] !== undefined && tmdbData[k] !== '');
        if (keys.length === 0 || (keys.length === 1 && (keys[0] === 'tmdbId' || keys[0] === 'id') && !tmdbData.name && !tmdbData.title)) {
            return 'EMPTY';
        }

        const hasTitle = this.isMeaningfulText(tmdbData.name || tmdbData.title || tmdbData.originalName || tmdbData.original_title);
        const hasYear = Boolean(Number(tmdbData.year) > 0 || (typeof tmdbData.release_date === 'string' && tmdbData.release_date.length >= 4));
        const hasPoster = Boolean((tmdbData.posterUrl || tmdbData.poster_path) && (
            (typeof tmdbData.posterUrl === 'string' && tmdbData.posterUrl.startsWith('http')) ||
            (typeof tmdbData.poster_path === 'string' && tmdbData.poster_path.length > 0)
        ));
        const hasDescription = this.isMeaningfulText(tmdbData.description || tmdbData.overview, 20);
        const hasGenres = Array.isArray(tmdbData.genres) && tmdbData.genres.length > 0;

        if (hasTitle && hasYear && hasPoster && hasDescription && hasGenres) {
            return 'FULL';
        }

        if (hasTitle && (hasPoster || hasDescription)) {
            return 'PARTIAL';
        }

        return 'DRAFT';
    }

    /**
     * Resolve strict media identity.
     * Decouples verification method/source from confidence.
     * Detects external ID contradictions.
     * @param {Object} kpMovie
     * @param {Object} [tmdbData]
     * @param {Object} [options]
     * @returns {Object} MediaIdentity
     */
    static resolveIdentity(kpMovie, tmdbData = null, options = {}) {
        const kinopoiskId = Number(kpMovie?.kinopoiskId || kpMovie?.id || options.kinopoiskId) || 0;
        let tmdbId = Number(tmdbData?.tmdbId || tmdbData?.id || kpMovie?.externalId?.tmdb || options.tmdbId) || null;
        let imdbId = (kpMovie?.externalId?.imdb && typeof kpMovie.externalId.imdb === 'string')
            ? kpMovie.externalId.imdb.trim()
            : ((tmdbData?.externalId?.imdb && typeof tmdbData.externalId.imdb === 'string')
                ? tmdbData.externalId.imdb.trim()
                : (options.imdbId || null));

        if (!imdbId && tmdbData?.imdb_id) {
            imdbId = String(tmdbData.imdb_id).trim();
        }

        let status = 'UNVERIFIED';
        let verificationMethod = null;
        let verificationSource = null;
        let verifiedAt = null;

        // 1. Detect HARD CONTRADICTION between KP declared TMDB ID and candidate TMDB ID
        const kpDeclaredTmdb = Number(kpMovie?.externalId?.tmdb);
        const candidateTmdb = Number(options.candidateTmdbId || (tmdbData ? (tmdbData.tmdbId || tmdbData.id) : null));
        
        const hasTrustedReverseMapping = options.identityStatus === 'VERIFIED' &&
            ['exact_external_tmdb', 'manual_verified_override', 'provider_document_verified', 'context_verified', 'exact_title_year_type']
                .includes(options.verificationMethod);
        if (kpDeclaredTmdb > 0 && candidateTmdb > 0 && kpDeclaredTmdb !== candidateTmdb && !hasTrustedReverseMapping) {
            return {
                kinopoiskId,
                tmdbId: null,
                imdbId,
                status: 'UNVERIFIED',
                verificationMethod: null,
                verificationSource: null,
                verifiedAt: null,
                contradiction: true,
                contradictionReason: `KP declared TMDB ${kpDeclaredTmdb} contradicts candidate TMDB ${candidateTmdb}`
            };
        }

        // 2. Exact externalId.tmdb verification (Gold standard automatic)
        if (kpDeclaredTmdb > 0 && (tmdbId === kpDeclaredTmdb || !tmdbId || candidateTmdb === kpDeclaredTmdb)) {
            tmdbId = kpDeclaredTmdb;
            status = 'VERIFIED';
            verificationMethod = 'exact_external_tmdb';
            verificationSource = 'automatic';
            verifiedAt = options.verifiedAt || new Date().toISOString();
        }
        // 3. Admin verified manual mapping
        else if (options.isManual || options.resolutionSource === 'manual' || options.verificationMethod === 'admin_verified') {
            status = 'VERIFIED';
            verificationMethod = 'admin_verified';
            verificationSource = 'manual';
            verifiedAt = options.verifiedAt || new Date().toISOString();
        }
        // 4. Trusted reverse identity mapping (exact/manual/context verification only)
        else if (
            options.identityStatus === 'VERIFIED' &&
            ['exact_external_tmdb', 'manual_verified_override', 'provider_document_verified', 'context_verified', 'exact_title_year_type']
                .includes(options.verificationMethod)
        ) {
            status = 'VERIFIED';
            verificationMethod = options.verificationMethod;
            verificationSource = options.verificationSource || 'identity_mapping';
            verifiedAt = options.verifiedAt || new Date().toISOString();
        }
        // 5. Legacy compatibility resolution
        else if (options.isLegacyResolved || options.status === 'resolved' || options.verificationMethod === 'legacy_resolved') {
            status = 'VERIFIED';
            verificationMethod = 'legacy_resolved';
            verificationSource = 'system_legacy';
            verifiedAt = options.verifiedAt || new Date().toISOString();
        }
        // 6. Exact externalId.imdb match bridge
        else if (
            imdbId &&
            kpMovie?.externalId?.imdb &&
            tmdbData?.externalId?.imdb &&
            kpMovie.externalId.imdb.toLowerCase() === tmdbData.externalId.imdb.toLowerCase()
        ) {
            status = 'VERIFIED';
            verificationMethod = 'exact_external_imdb';
            verificationSource = 'automatic';
            verifiedAt = options.verifiedAt || new Date().toISOString();
        }
        // 7. Direct KP movie without TMDB (valid standalone KP identity)
        else if (kinopoiskId > 0 && !tmdbData && !options.candidateTmdbId) {
            status = 'VERIFIED';
            verificationMethod = 'legacy_resolved';
            verificationSource = 'system_legacy';
            verifiedAt = options.verifiedAt || new Date().toISOString();
        }

        return {
            kinopoiskId,
            tmdbId,
            imdbId,
            status,
            verificationMethod,
            verificationSource,
            verifiedAt
        };
    }

    /**
     * Aggregate Kinopoisk and TMDB datasets into a single UnifiedMovieDTO.
     * Pure function: no network or storage calls.
     * @param {Object} kpMovie - Normalized Kinopoisk movie
     * @param {Object|null} [tmdbData] - Normalized TMDB movie details
     * @param {Object} [options] - Aggregation options
     * @returns {Object} UnifiedMovieDTO
     */
    static aggregate(kpMovie, tmdbData = null, options = {}) {
        const kpQuality = this.classifyKpQuality(kpMovie);
        const tmdbQuality = this.classifyTmdbQuality(tmdbData);
        const identity = this.resolveIdentity(kpMovie, tmdbData, options);

        const fieldSources = {
            name: 'none',
            originalName: 'none',
            description: 'none',
            shortDescription: 'none',
            posterUrl: 'none',
            backdropUrl: 'none',
            year: 'none',
            genres: 'none',
            countries: 'none',
            movieLength: 'none',
            ageRating: 'none',
            kpRating: 'none',
            imdbRating: 'none',
            tmdbRating: 'none',
            status: 'none',
            facts: 'none',
            criticRatings: 'none',
            logoUrl: 'none',
            productionCompanies: 'none',
            spokenLanguages: 'none',
            collection: 'none',
            videos: 'none',
            seasons: 'none',
            nextEpisode: 'none',
            lastEpisode: 'none'
        };

        // 1. NAME RESOLUTION:
        // KP Russian name -> TMDB localized title -> TMDB original title -> KP alt name -> fallback
        let name;
        const kpHasValidName = this.isMeaningfulText(kpMovie?.name);
        const tmdbHasValidName = this.isMeaningfulText(tmdbData?.name || tmdbData?.title);
        const tmdbOriginalName = this.isMeaningfulText(tmdbData?.originalName || tmdbData?.original_title);
        const kpAltName = this.isMeaningfulText(kpMovie?.alternativeName || kpMovie?.enName);

        if (kpHasValidName && kpQuality !== 'DRAFT') {
            name = kpMovie.name;
            fieldSources.name = 'kp';
        } else if (tmdbHasValidName) {
            name = tmdbData.name || tmdbData.title;
            fieldSources.name = 'tmdb';
        } else if (kpHasValidName) {
            name = kpMovie.name;
            fieldSources.name = 'kp';
        } else if (tmdbOriginalName) {
            name = tmdbData.originalName || tmdbData.original_title;
            fieldSources.name = 'tmdb';
        } else if (kpAltName) {
            name = kpMovie.alternativeName || kpMovie.enName;
            fieldSources.name = 'kp';
        } else {
            name = kpMovie?.name || tmdbData?.name || '';
            fieldSources.name = kpMovie?.name ? 'kp' : (tmdbData?.name ? 'tmdb' : 'none');
        }

        // 2. ORIGINAL NAME:
        let originalName = null;
        if (tmdbOriginalName) {
            originalName = tmdbData.originalName || tmdbData.original_title;
            fieldSources.originalName = 'tmdb';
        } else if (kpAltName) {
            originalName = kpMovie.alternativeName || kpMovie.enName;
            fieldSources.originalName = 'kp';
        } else if (tmdbData?.alternativeName && this.isMeaningfulText(tmdbData.alternativeName)) {
            originalName = tmdbData.alternativeName;
            fieldSources.originalName = 'tmdb';
        }

        // 3. YEAR:
        let year = null;
        const kpYear = Number(kpMovie?.year);
        const tmdbYear = Number(tmdbData?.year);
        if (kpYear > 0) {
            year = kpYear;
            fieldSources.year = 'kp';
        } else if (tmdbYear > 0) {
            year = tmdbYear;
            fieldSources.year = 'tmdb';
        }

        // 4. DESCRIPTION:
        let description = '';
        const kpHasDesc = this.isMeaningfulText(kpMovie?.description, 20);
        const tmdbHasDesc = this.isMeaningfulText(tmdbData?.description || tmdbData?.overview, 20);

        if (kpHasDesc && kpQuality !== 'DRAFT') {
            description = kpMovie.description;
            fieldSources.description = 'kp';
        } else if (tmdbHasDesc) {
            description = tmdbData.description || tmdbData.overview;
            fieldSources.description = 'tmdb';
        } else if (kpHasDesc) {
            description = kpMovie.description;
            fieldSources.description = 'kp';
        } else if (this.isMeaningfulText(kpMovie?.shortDescription)) {
            description = kpMovie.shortDescription;
            fieldSources.description = 'kp';
        }

        // 5. SHORT DESCRIPTION:
        let shortDescription = '';
        if (this.isMeaningfulText(kpMovie?.shortDescription)) {
            shortDescription = kpMovie.shortDescription;
            fieldSources.shortDescription = 'kp';
        }

        // 6. POSTER URL:
        let posterUrl = '';
        const kpHasPoster = Boolean(kpMovie?.posterUrl && typeof kpMovie.posterUrl === 'string' && kpMovie.posterUrl.startsWith('http'));
        const tmdbHasPoster = Boolean(tmdbData?.posterUrl && typeof tmdbData.posterUrl === 'string' && tmdbData.posterUrl.startsWith('http'));

        if (kpHasPoster && kpQuality !== 'DRAFT') {
            posterUrl = kpMovie.posterUrl;
            fieldSources.posterUrl = 'kp';
        } else if (tmdbHasPoster) {
            posterUrl = tmdbData.posterUrl;
            fieldSources.posterUrl = 'tmdb';
        } else if (kpHasPoster) {
            posterUrl = kpMovie.posterUrl;
            fieldSources.posterUrl = 'kp';
        }

        // 7. BACKDROP URL:
        let backdropUrl = '';
        const tmdbBackdropCandidate = tmdbData?.backdrop || tmdbData?.backdropUrl;
        const kpBackdropCandidate = kpMovie?.backdrop || kpMovie?.backdropUrl;
        const tmdbHasBackdrop = Boolean(tmdbBackdropCandidate && typeof tmdbBackdropCandidate === 'string' && tmdbBackdropCandidate.startsWith('http'));
        const kpHasBackdrop = Boolean(kpBackdropCandidate && typeof kpBackdropCandidate === 'string' && kpBackdropCandidate.startsWith('http'));

        if (tmdbHasBackdrop) {
            backdropUrl = tmdbBackdropCandidate;
            fieldSources.backdropUrl = 'tmdb';
        } else if (kpHasBackdrop) {
            backdropUrl = kpBackdropCandidate;
            fieldSources.backdropUrl = 'kp';
        }

        // 8. GENRES:
        let genres = [];
        const normalizeGenreArray = (arr) => arr.map(g => (typeof g === 'string' ? { name: g } : (g?.name ? { name: g.name } : null))).filter(Boolean);

        if (Array.isArray(kpMovie?.genres) && kpMovie.genres.length > 0 && kpQuality !== 'DRAFT') {
            genres = normalizeGenreArray(kpMovie.genres);
            fieldSources.genres = 'kp';
        } else if (Array.isArray(tmdbData?.genres) && tmdbData.genres.length > 0) {
            genres = normalizeGenreArray(tmdbData.genres);
            fieldSources.genres = 'tmdb';
        } else if (Array.isArray(kpMovie?.genres) && kpMovie.genres.length > 0) {
            genres = normalizeGenreArray(kpMovie.genres);
            fieldSources.genres = 'kp';
        }

        // 9. COUNTRIES:
        let countries = [];
        const normalizeCountryArray = (arr) => arr.map(c => (typeof c === 'string' ? { name: c } : (c?.name ? { name: c.name } : null))).filter(Boolean);

        if (Array.isArray(kpMovie?.countries) && kpMovie.countries.length > 0 && kpQuality !== 'DRAFT') {
            countries = normalizeCountryArray(kpMovie.countries);
            fieldSources.countries = 'kp';
        } else if (Array.isArray(tmdbData?.countries) && tmdbData.countries.length > 0) {
            countries = normalizeCountryArray(tmdbData.countries);
            fieldSources.countries = 'tmdb';
        } else if (Array.isArray(kpMovie?.countries) && kpMovie.countries.length > 0) {
            countries = normalizeCountryArray(kpMovie.countries);
            fieldSources.countries = 'kp';
        }

        // 10. DURATION / MOVIE LENGTH:
        let movieLength = null;
        const kpDuration = Number(kpMovie?.duration || kpMovie?.movieLength);
        const tmdbDuration = Number(tmdbData?.duration || tmdbData?.runtime);
        if (kpDuration > 0) {
            movieLength = kpDuration;
            fieldSources.movieLength = 'kp';
        } else if (tmdbDuration > 0) {
            movieLength = tmdbDuration;
            fieldSources.movieLength = 'tmdb';
        }

        // 11. AGE RATING & MPAA:
        let ageRating = kpMovie?.ageRating !== undefined ? kpMovie.ageRating : null;
        let ratingMpaa = kpMovie?.ratingMpaa || tmdbData?.ratingMpaa || null;
        if (ageRating !== null) fieldSources.ageRating = 'kp';
        else if (ratingMpaa) fieldSources.ageRating = tmdbData?.ratingMpaa ? 'tmdb' : 'kp';

        // 12. RATINGS & VOTES (STRICT ISOLATION INVARIANT):
        // KP Rating   <- KP only
        // IMDb Rating <- IMDb source only (never from TMDB vote_average)
        // TMDB Rating <- TMDB vote_average only
        const rawKpRating = kpMovie?.kpRating !== undefined ? kpMovie.kpRating : kpMovie?.rating?.kp;
        const rawImdbRating = kpMovie?.imdbRating !== undefined ? kpMovie.imdbRating : kpMovie?.rating?.imdb;
        const rawTmdbRating = tmdbData?.ratingTmdb !== undefined ? tmdbData.ratingTmdb : (tmdbData?.vote_average !== undefined ? tmdbData.vote_average : tmdbData?.rating?.tmdb);

        const kpRating = (rawKpRating !== null && rawKpRating !== undefined && Number(rawKpRating) > 0) ? Number(rawKpRating) : null;
        const imdbRating = (rawImdbRating !== null && rawImdbRating !== undefined && Number(rawImdbRating) > 0) ? Number(rawImdbRating) : null;
        const tmdbRating = (rawTmdbRating !== null && rawTmdbRating !== undefined && Number(rawTmdbRating) > 0) ? Number(rawTmdbRating) : null;

        if (kpRating !== null) fieldSources.kpRating = 'kp';
        if (imdbRating !== null) fieldSources.imdbRating = 'kp';
        if (tmdbRating !== null) fieldSources.tmdbRating = 'tmdb';

        const votesKp = (kpMovie?.votes?.kp !== undefined && Number(kpMovie.votes.kp) > 0) ? Number(kpMovie.votes.kp) : null;
        const votesImdb = (kpMovie?.votes?.imdb !== undefined && Number(kpMovie.votes.imdb) > 0) ? Number(kpMovie.votes.imdb) : null;
        const votesTmdb = (tmdbData?.voteCount || tmdbData?.vote_count || tmdbData?.votes?.tmdb) ? Number(tmdbData.voteCount || tmdbData.vote_count || tmdbData.votes?.tmdb) : null;

        // 13. PHASE 1B RICH PROVIDER METADATA RESOLUTION:

        // A. Facts (KP)
        let facts = [];
        const rawFacts = Array.isArray(kpMovie?.facts) ? kpMovie.facts : [];
        if (rawFacts.length > 0) {
            facts = rawFacts.map(f => {
                const rawVal = typeof f === 'string' ? f : (f?.value || '');
                const cleanVal = String(rawVal).replace(/<[^>]*>/g, '').trim();
                return {
                    value: cleanVal,
                    type: (f && typeof f === 'object' && f.type) ? String(f.type) : 'FACT',
                    spoiler: Boolean(f && typeof f === 'object' && f.spoiler)
                };
            }).filter(f => f.value.length > 0);
            if (facts.length > 0) fieldSources.facts = 'kp';
        }

        // B. Critic Ratings (KP)
        const rawKpCritics = kpMovie?.rating?.filmCritics ?? kpMovie?.ratingFilmCritics ?? null;
        const rawKpCriticsVotes = kpMovie?.votes?.filmCritics ?? kpMovie?.votesFilmCritics ?? null;
        const rawRuCritics = kpMovie?.rating?.russianFilmCritics ?? kpMovie?.ratingRussianFilmCritics ?? null;
        const rawRuCriticsVotes = kpMovie?.votes?.russianFilmCritics ?? kpMovie?.votesRussianFilmCritics ?? null;

        const criticRatings = {
            international: {
                rating: (rawKpCritics !== null && rawKpCritics !== undefined && Number(rawKpCritics) > 0) ? Number(rawKpCritics) : null,
                votes: (rawKpCriticsVotes !== null && rawKpCriticsVotes !== undefined && Number(rawKpCriticsVotes) > 0) ? Number(rawKpCriticsVotes) : null
            },
            russian: {
                rating: (rawRuCritics !== null && rawRuCritics !== undefined && Number(rawRuCritics) > 0) ? Number(rawRuCritics) : null,
                votes: (rawRuCriticsVotes !== null && rawRuCriticsVotes !== undefined && Number(rawRuCriticsVotes) > 0) ? Number(rawRuCriticsVotes) : null
            }
        };
        if (criticRatings.international.rating !== null || criticRatings.russian.rating !== null) {
            fieldSources.criticRatings = 'kp';
        }

        // C. Canonical title logo (KP primary, localized TMDB fallback)
        let logoUrl = null;
        const kpLogoCandidate = kpMovie?.logo?.url || kpMovie?.logoUrl || (typeof kpMovie?.logo === 'string' ? kpMovie.logo : '');
        const tmdbLogoCandidate = tmdbData?.logoUrl || '';
        if (this.isMeaningfulText(kpLogoCandidate) && kpLogoCandidate.startsWith('http')) {
            logoUrl = kpLogoCandidate;
            fieldSources.logoUrl = 'kp';
        } else if (
            this.isMeaningfulText(tmdbLogoCandidate) &&
            tmdbLogoCandidate.startsWith('https://image.tmdb.org/t/p/')
        ) {
            logoUrl = tmdbLogoCandidate;
            fieldSources.logoUrl = 'tmdb';
        }

        // D. Status (TMDB priority, fallback KP)
        let status = null;
        if (this.isMeaningfulText(tmdbData?.status)) {
            status = tmdbData.status;
            fieldSources.status = 'tmdb';
        } else if (this.isMeaningfulText(kpMovie?.status)) {
            status = kpMovie.status;
            fieldSources.status = 'kp';
        }

        // E. Production Companies (TMDB)
        let productionCompanies = [];
        const rawCompanies = Array.isArray(tmdbData?.productionCompanies)
            ? tmdbData.productionCompanies
            : (Array.isArray(tmdbData?.production_companies) ? tmdbData.production_companies : []);

        if (rawCompanies.length > 0) {
            const seen = new Set();
            productionCompanies = rawCompanies.map(c => {
                const id = c.tmdbId || c.id || null;
                const compName = String(c.name || '').trim();
                const logo = c.logoUrl || (c.logo_path ? `https://image.tmdb.org/t/p/w185${c.logo_path}` : null);
                const originCountry = c.originCountry || c.origin_country || null;
                return {
                    tmdbId: id ? Number(id) : null,
                    name: compName,
                    logoUrl: logo,
                    originCountry
                };
            }).filter(c => {
                if (!c.name) return false;
                const key = c.tmdbId ? `id:${c.tmdbId}` : `name:${c.name.toLowerCase()}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
            if (productionCompanies.length > 0) fieldSources.productionCompanies = 'tmdb';
        }

        // F. Spoken Languages (TMDB)
        let spokenLanguages = [];
        const rawLangs = Array.isArray(tmdbData?.spokenLanguages)
            ? tmdbData.spokenLanguages
            : (Array.isArray(tmdbData?.spoken_languages) ? tmdbData.spoken_languages : []);

        if (rawLangs.length > 0) {
            spokenLanguages = rawLangs.map(l => ({
                code: String(l.code || l.iso_639_1 || '').trim(),
                englishName: l.englishName || l.english_name || null,
                name: l.name || null
            })).filter(l => l.code.length > 0 || (l.name && l.name.length > 0));
            if (spokenLanguages.length > 0) fieldSources.spokenLanguages = 'tmdb';
        }

        // G. Collection (TMDB)
        let collection = null;
        const rawCollection = tmdbData?.collection || tmdbData?.belongs_to_collection;
        if (rawCollection && (rawCollection.name || rawCollection.id)) {
            collection = {
                tmdbId: Number(rawCollection.tmdbId || rawCollection.id) || null,
                name: String(rawCollection.name || '').trim(),
                posterUrl: rawCollection.posterUrl || (rawCollection.poster_path ? `https://image.tmdb.org/t/p/w500${rawCollection.poster_path}` : null),
                backdropUrl: rawCollection.backdropUrl || (rawCollection.backdrop_path ? `https://image.tmdb.org/t/p/w1280${rawCollection.backdrop_path}` : null)
            };
            fieldSources.collection = 'tmdb';
        }

        // H. Videos (TMDB)
        let videos = [];
        const rawVideos = Array.isArray(tmdbData?.videos) ? tmdbData.videos : (Array.isArray(tmdbData?.videos?.results) ? tmdbData.videos.results : []);
        if (rawVideos.length > 0) {
            videos = rawVideos.map(v => ({
                tmdbId: String(v.tmdbId || v.id || ''),
                provider: v.provider || v.site || 'YouTube',
                key: String(v.key || ''),
                name: String(v.name || ''),
                type: String(v.type || 'Trailer'),
                official: Boolean(v.official),
                language: v.language || v.iso_639_1 || null,
                country: v.country || v.iso_3166_1 || null,
                publishedAt: v.publishedAt || v.published_at || null
            })).filter(v => v.key.length > 0).slice(0, 20);
            if (videos.length > 0) fieldSources.videos = 'tmdb';
        }

        // I. Normalized Unified Credits (Phase 2A)
        const credits = MediaAggregatorService._normalizeUnifiedCredits(kpMovie, tmdbData, fieldSources);

        // TMDB Credits (Legacy compatibility)
        let tmdbCredits = null;
        if (tmdbData?.credits) {
            tmdbCredits = {
                cast: (Array.isArray(tmdbData.credits.cast) ? tmdbData.credits.cast : []).slice(0, 30).map(p => ({
                    id: p.id,
                    name: p.name || '',
                    originalName: p.originalName || p.original_name || p.name || '',
                    character: p.character || '',
                    photoUrl: p.photoUrl || (p.profile_path ? `https://image.tmdb.org/t/p/w185${p.profile_path}` : (p.photo || null)),
                    order: typeof p.order === 'number' ? p.order : null
                })),
                crew: (Array.isArray(tmdbData.credits.crew) ? tmdbData.credits.crew : []).slice(0, 30).map(p => ({
                    id: p.id,
                    name: p.name || '',
                    job: p.job || '',
                    department: p.department || '',
                    photoUrl: p.photoUrl || (p.profile_path ? `https://image.tmdb.org/t/p/w185${p.profile_path}` : (p.photo || null))
                }))
            };
        }

        // J. Watchability (KP)
        let watchability = [];
        if (Array.isArray(kpMovie?.watchability)) {
            watchability = kpMovie.watchability;
        } else if (Array.isArray(kpMovie?.watchability?.items)) {
            watchability = kpMovie.watchability.items.map(w => ({
                name: String(w.name || '').trim(),
                logoUrl: w.logo?.url || (typeof w.logo === 'string' ? w.logo : null),
                url: w.url || null
            })).filter(w => w.name.length > 0);
        }

        // K. Distributors (KP)
        const distributors = kpMovie?.distributors || null;

        // L. Seasons & Series metadata (Phase 1E)
        let seasons = [];
        let seasonsInfo = [];
        let nextEpisode = tmdbData?.nextEpisode || null;
        let lastEpisode = tmdbData?.lastEpisode || null;
        let totalSeasons = Number(tmdbData?.totalSeasons) || 0;
        let totalEpisodes = Number(tmdbData?.totalEpisodes) || 0;

        if (Array.isArray(tmdbData?.seasons) && tmdbData.seasons.length > 0) {
            seasons = tmdbData.seasons;
            fieldSources.seasons = 'tmdb';
            seasonsInfo = (Array.isArray(kpMovie?.seasonsInfo) && kpMovie.seasonsInfo.length > 0)
                ? kpMovie.seasonsInfo
                : (Array.isArray(tmdbData?.seasonsInfo) ? tmdbData.seasonsInfo : seasons.filter(s => !s.isSpecial).map(s => ({ number: s.number, episodesCount: s.episodeCount })));
        } else if (Array.isArray(kpMovie?.seasonsInfo) && kpMovie.seasonsInfo.length > 0) {
            seasonsInfo = kpMovie.seasonsInfo;
            seasons = kpMovie.seasonsInfo.map(s => ({
                number: s.number,
                name: `Сезон ${s.number}`,
                episodeCount: Number(s.episodesCount) || 0,
                airDate: null,
                overview: null,
                posterUrl: null,
                isSpecial: s.number === 0,
                source: 'kp'
            }));
            fieldSources.seasons = 'kp';
            if (!totalSeasons) totalSeasons = seasons.filter(s => !s.isSpecial).length;
            if (!totalEpisodes) totalEpisodes = seasons.reduce((sum, s) => sum + s.episodeCount, 0);
        }

        if (nextEpisode) fieldSources.nextEpisode = 'tmdb';
        if (lastEpisode) fieldSources.lastEpisode = 'tmdb';

        // 14. PIPELINE STATUS:
        let pipelineStatus = 'READY';
        if (kpQuality === 'DRAFT' && (tmdbQuality === 'UNAVAILABLE' || tmdbQuality === 'EMPTY')) {
            pipelineStatus = 'DEGRADED';
        } else if (kpQuality === 'UNAVAILABLE' && (tmdbQuality === 'UNAVAILABLE' || tmdbQuality === 'EMPTY')) {
            pipelineStatus = 'DEGRADED';
        }

        const isSeries = Boolean(
            kpMovie?.isSeries ||
            tmdbData?.isSeries ||
            ['tv-series', 'mini-series', 'animated-series', 'tv'].includes(kpMovie?.type) ||
            ['tv-series', 'mini-series', 'animated-series', 'tv'].includes(tmdbData?.type)
        );

        const dto = {
            // Primary Invariant Root Identifiers
            kinopoiskId: identity.kinopoiskId,
            id: identity.kinopoiskId ? String(identity.kinopoiskId) : null,
            tmdbId: identity.tmdbId,
            imdbId: identity.imdbId,

            // Display Metadata
            name,
            originalName,
            enName: originalName,
            alternativeName: originalName,
            year,
            description,
            shortDescription,
            posterUrl,
            posterPreviewUrl: kpMovie?.posterPreviewUrl || posterUrl,
            backdropUrl,
            backdrop: backdropUrl,
            logoUrl,
            isSeries,
            type: kpMovie?.type || tmdbData?.type || (isSeries ? 'tv-series' : 'movie'),
            status,
            movieLength,
            duration: movieLength,
            ageRating,
            ratingMpaa,
            genres,
            countries,

            // Multi-Catalog Isolated Ratings
            rating: {
                kp: kpRating,
                imdb: imdbRating,
                tmdb: tmdbRating
            },
            votes: {
                kp: votesKp,
                imdb: votesImdb,
                tmdb: votesTmdb
            },
            criticRatings,

            // Legacy Compatibility Rating Aliases
            kpRating: kpRating || 0,
            imdbRating: imdbRating || 0,
            ratingTmdb: tmdbRating || 0,

            // Unified Credits (Phase 2A) & Legacy Compatibility
            credits,
            persons: (Array.isArray(kpMovie?.persons) && kpMovie.persons.length > 0)
                ? kpMovie.persons
                : (Array.isArray(tmdbData?.persons) ? tmdbData.persons : []),
            tmdbCredits,

            // Rich Provider Collections & Enriched Metadata (Phase 1B & 1E)
            facts,
            productionCompanies,
            spokenLanguages,
            collection,
            videos,
            watchability,
            distributors,

            // TV & Series Metadata (Phase 1E)
            seasons,
            seasonsInfo,
            totalSeasons,
            totalEpisodes,
            nextEpisode,
            lastEpisode,
            inProduction: Boolean(tmdbData?.inProduction),

            // Supporting metadata
            budget: kpMovie?.budget || tmdbData?.budget || null,
            fees: kpMovie?.fees || tmdbData?.fees || null,
            premiere: kpMovie?.premiere || tmdbData?.premiere || null,
            slogan: kpMovie?.slogan || tmdbData?.slogan || '',
            externalId: {
                ...(kpMovie?.externalId || {}),
                ...(tmdbData?.externalId || {}),
                tmdb: identity.tmdbId,
                imdb: identity.imdbId
            },

            // Strict Media Identity Contract
            identity,

            // Lightweight Metadata Quality and Field Provenance
            _meta: {
                aggregatedAt: new Date().toISOString(),
                pipelineStatus,
                providers: {
                    kp: {
                        available: kpQuality !== 'UNAVAILABLE',
                        quality: kpQuality
                    },
                    tmdb: {
                        available: tmdbQuality !== 'UNAVAILABLE',
                        quality: tmdbQuality,
                        logoChecked: Boolean(
                            tmdbData &&
                            Object.prototype.hasOwnProperty.call(tmdbData, 'logoUrl')
                        ),
                        logoSelectionVersion: tmdbData
                            ? (Number(tmdbData.logoSelectionVersion) || TMDB_LOGO_SELECTION_VERSION)
                            : 0,
                        collectionChecked: Boolean(tmdbData)
                    }
                },
                fieldSources
            },

            lastUpdated: new Date().toISOString()
        };

        return dto;
    }

    /**
     * Normalize UnifiedCreditDTO cast and crew with hybrid provider prioritization,
     * exact Latin-name Russian enrichment, category fallback, and provider namespace safety.
     * 
     * @param {Object|null} kpMovie
     * @param {Object|null} tmdbData
     * @param {Object} fieldSources - Reference to _meta.fieldSources map
     * @returns {{ cast: Array<Object>, crew: Array<Object> }}
     */
    static _normalizeUnifiedCredits(kpMovie, tmdbData, fieldSources = {}) {
        const kpPersons = Array.isArray(kpMovie?.persons) ? kpMovie.persons : [];
        const tmdbCredits = tmdbData?.credits || {};
        const rawTmdbCast = Array.isArray(tmdbCredits.cast) ? tmdbCredits.cast : [];
        const rawTmdbCrew = Array.isArray(tmdbCredits.crew) ? tmdbCredits.crew : [];

        // Helper to normalize Latin/English names for exact equality matching
        const normalizeLatinName = (name) => {
            if (!name || typeof name !== 'string') return '';
            return name.toLowerCase().replace(/[\s\-_.,'"`´’]+/g, ' ').trim();
        };

        // Pre-index KP persons by normalized Latin name for contextual enrichment within this movie
        const kpPersonsByLatinName = new Map();
        for (const p of kpPersons) {
            const latName = normalizeLatinName(p.enName);
            if (latName && !kpPersonsByLatinName.has(latName)) {
                kpPersonsByLatinName.set(latName, p);
            }
        }

        // 1. Cast Normalization (TMDB Primary when length >= 4, else KP fallback)
        let cast = [];
        let hasCastEnrichment = false;

        if (rawTmdbCast.length >= 4) {
            const validTmdbCast = rawTmdbCast
                .filter(p => p && (p.name || p.original_name || p.originalName))
                .slice(0, 30);

            cast = validTmdbCast.map((p, idx) => {
                const tmdbIdNum = Number(p.id);
                const tmdbPersonId = !isNaN(tmdbIdNum) && tmdbIdNum > 0 ? tmdbIdNum : null;
                const tmdbOrigName = p.originalName || p.original_name || p.name || '';
                const tmdbDisplayName = p.name || tmdbOrigName;
                const normalizedLat = normalizeLatinName(tmdbOrigName);
                
                // Contextual exact-match lookup in KP persons
                const matchedKp = normalizedLat ? kpPersonsByLatinName.get(normalizedLat) : null;
                
                let displayName = tmdbDisplayName;
                let kpPersonId = null;
                let photoUrl = p.photoUrl || (p.profile_path ? `https://image.tmdb.org/t/p/w185${p.profile_path}` : (p.photo || null));
                let character = p.character || null;

                if (matchedKp) {
                    if (matchedKp.name && typeof matchedKp.name === 'string' && matchedKp.name.trim().length > 0) {
                        displayName = matchedKp.name.trim();
                        hasCastEnrichment = true;
                    }
                    if (matchedKp.id && Number(matchedKp.id) > 0) {
                        kpPersonId = Number(matchedKp.id);
                    }
                    if (!character && matchedKp.description) {
                        character = String(matchedKp.description).trim();
                    }
                    if (!photoUrl && matchedKp.photo) {
                        photoUrl = matchedKp.photo;
                    }
                }

                const creditId = tmdbPersonId ? `tmdb:${tmdbPersonId}` : (kpPersonId ? `kp:${kpPersonId}` : `cast:${idx}`);

                return {
                    id: creditId,
                    kpPersonId,
                    tmdbPersonId,
                    name: displayName,
                    originalName: tmdbOrigName || null,
                    photoUrl: photoUrl || null,
                    role: 'ACTOR',
                    character: character || null,
                    job: 'Actor',
                    department: 'Acting',
                    order: typeof p.order === 'number' ? p.order : idx,
                    providerSource: 'TMDB'
                };
            });

            // Ensure order ascending
            cast.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
            fieldSources['credits.cast'] = hasCastEnrichment ? 'hybrid' : 'tmdb';
        } else if (kpPersons.length > 0) {
            // KP Cast Fallback
            const kpActors = kpPersons
                .filter(p => {
                    const prof = (p.enProfession || '').toUpperCase();
                    return prof === 'ACTOR';
                })
                .filter(p => p.name || p.enName)
                .slice(0, 30);

            cast = kpActors.map((p, idx) => {
                const kpIdNum = Number(p.id);
                const kpPersonId = !isNaN(kpIdNum) && kpIdNum > 0 ? kpIdNum : null;
                const creditId = kpPersonId ? `kp:${kpPersonId}` : `cast:${idx}`;

                return {
                    id: creditId,
                    kpPersonId,
                    tmdbPersonId: null,
                    name: (p.name || p.enName || '').trim(),
                    originalName: p.enName ? String(p.enName).trim() : null,
                    photoUrl: p.photo || null,
                    role: 'ACTOR',
                    character: p.description ? String(p.description).trim() : null,
                    job: 'Actor',
                    department: 'Acting',
                    order: idx,
                    providerSource: 'KP'
                };
            });

            if (cast.length > 0) {
                fieldSources['credits.cast'] = 'kp';
            }
        }

        // 2. Crew Normalization (KP Primary with TMDB Category Fallback)
        const canonicalTaxonomyMap = {
            'DIRECTOR': 'DIRECTOR',
            'WRITER': 'WRITER',
            'PRODUCER': 'PRODUCER',
            'COMPOSER': 'COMPOSER',
            'OPERATOR': 'CINEMATOGRAPHY',
            'EDITOR': 'EDITOR',
            'DESIGNER': 'DESIGNER'
        };

        const canonicalRolePriority = {
            'DIRECTOR': 1,
            'WRITER': 2,
            'PRODUCER': 3,
            'COMPOSER': 4,
            'CINEMATOGRAPHY': 5,
            'EDITOR': 6,
            'DESIGNER': 7,
            'OTHER': 8
        };

        const kpCrewPersons = kpPersons.filter(p => {
            const prof = (p.enProfession || '').toUpperCase();
            return prof !== 'ACTOR';
        });

        const crew = [];
        const coveredRoles = new Set();
        const seenCrewKeys = new Set();

        // Add KP crew entries
        for (const p of kpCrewPersons) {
            if (!p || (!p.name && !p.enName)) continue;
            const prof = (p.enProfession || '').toUpperCase();
            const canonicalRole = canonicalTaxonomyMap[prof] || 'OTHER';
            const kpIdNum = Number(p.id);
            const kpPersonId = !isNaN(kpIdNum) && kpIdNum > 0 ? kpIdNum : null;
            const creditId = kpPersonId ? `kp:${kpPersonId}:${canonicalRole}` : `crew:${p.name || p.enName}:${canonicalRole}`;

            if (seenCrewKeys.has(creditId)) continue;
            seenCrewKeys.add(creditId);

            coveredRoles.add(canonicalRole);

            let jobTitle = p.profession || prof;
            let department = 'Crew';
            if (canonicalRole === 'DIRECTOR') { jobTitle = 'Director'; department = 'Directing'; }
            else if (canonicalRole === 'WRITER') { jobTitle = 'Writer'; department = 'Writing'; }
            else if (canonicalRole === 'PRODUCER') { jobTitle = 'Producer'; department = 'Production'; }
            else if (canonicalRole === 'COMPOSER') { jobTitle = 'Composer'; department = 'Sound'; }
            else if (canonicalRole === 'CINEMATOGRAPHY') { jobTitle = 'Director of Photography'; department = 'Camera'; }
            else if (canonicalRole === 'EDITOR') { jobTitle = 'Editor'; department = 'Editing'; }
            else if (canonicalRole === 'DESIGNER') { jobTitle = 'Production Designer'; department = 'Art'; }

            crew.push({
                id: kpPersonId ? `kp:${kpPersonId}` : creditId,
                kpPersonId,
                tmdbPersonId: null,
                name: (p.name || p.enName || '').trim(),
                originalName: p.enName ? String(p.enName).trim() : null,
                photoUrl: p.photo || null,
                role: canonicalRole,
                character: null,
                job: jobTitle,
                department,
                order: null,
                providerSource: 'KP'
            });
        }

        // Helper to map TMDB crew item to canonical role
        const mapTmdbCrewRole = (member) => {
            const job = (member.job || '').toLowerCase();
            const dept = (member.department || '').toLowerCase();

            if (job === 'director' || dept === 'directing') return 'DIRECTOR';
            if (job.includes('writer') || job.includes('screenplay') || job.includes('story') || dept === 'writing') return 'WRITER';
            if (job.includes('producer') || job.includes('executive producer') || dept === 'production') return 'PRODUCER';
            if (job.includes('composer') || job.includes('original music') || job.includes('music') || dept === 'sound') return 'COMPOSER';
            if (job.includes('cinematograph') || job.includes('photography') || dept === 'camera') return 'CINEMATOGRAPHY';
            if (job.includes('editor') || dept === 'editing') return 'EDITOR';
            if (job.includes('production design') || job.includes('art direction') || dept === 'art') return 'DESIGNER';
            return 'OTHER';
        };

        let tmdbCrewBackfilled = false;

        // Check if canonical roles are missing from KP crew, and backfill from TMDB crew
        if (rawTmdbCrew.length > 0) {
            for (const member of rawTmdbCrew) {
                if (!member || (!member.name && !member.original_name && !member.originalName)) continue;
                const canonicalRole = mapTmdbCrewRole(member);
                
                // If KP has no crew for this major category, backfill it from TMDB
                if (!coveredRoles.has(canonicalRole) && canonicalRole !== 'OTHER') {
                    const tmdbIdNum = Number(member.id);
                    const tmdbPersonId = !isNaN(tmdbIdNum) && tmdbIdNum > 0 ? tmdbIdNum : null;
                    const creditKey = tmdbPersonId ? `tmdb:${tmdbPersonId}:${canonicalRole}` : `crew:${member.name}:${canonicalRole}`;

                    if (seenCrewKeys.has(creditKey)) continue;
                    seenCrewKeys.add(creditKey);

                    tmdbCrewBackfilled = true;
                    const origName = member.originalName || member.original_name || member.name || '';
                    const normLat = normalizeLatinName(origName);
                    const matchedKp = normLat ? kpPersonsByLatinName.get(normLat) : null;

                    let displayName = member.name || origName;
                    let kpPersonId = null;
                    let photoUrl = member.photoUrl || (member.profile_path ? `https://image.tmdb.org/t/p/w185${member.profile_path}` : (member.photo || null));

                    if (matchedKp) {
                        if (matchedKp.name) displayName = matchedKp.name.trim();
                        if (matchedKp.id) kpPersonId = Number(matchedKp.id);
                        if (!photoUrl && matchedKp.photo) photoUrl = matchedKp.photo;
                    }

                    crew.push({
                        id: tmdbPersonId ? `tmdb:${tmdbPersonId}` : creditKey,
                        kpPersonId,
                        tmdbPersonId,
                        name: displayName,
                        originalName: origName || null,
                        photoUrl: photoUrl || null,
                        role: canonicalRole,
                        character: null,
                        job: member.job || canonicalRole,
                        department: member.department || 'Crew',
                        order: null,
                        providerSource: 'TMDB'
                    });
                }
            }
        }

        // Sort crew by canonical priority then name
        crew.sort((a, b) => {
            const prioA = canonicalRolePriority[a.role] || 99;
            const prioB = canonicalRolePriority[b.role] || 99;
            if (prioA !== prioB) return prioA - prioB;
            return (a.name || '').localeCompare(b.name || '', 'ru');
        });

        // Bounded to 30 items
        const boundedCrew = crew.slice(0, 30);

        if (kpCrewPersons.length > 0) {
            fieldSources['credits.crew'] = tmdbCrewBackfilled ? 'hybrid' : 'kp';
        } else if (boundedCrew.length > 0) {
            fieldSources['credits.crew'] = 'tmdb';
        }

        return {
            cast: cast.slice(0, 30),
            crew: boundedCrew
        };
    }

    /**
     * Check whether a UnifiedMovieDTO satisfies renderability requirements.
     * DEGRADED pipeline status is operational telemetry and does NOT block rendering
     * as long as kinopoiskId > 0, identity is VERIFIED, and a display title exists.
     * @param {Object} dto - UnifiedMovieDTO candidate
     * @returns {boolean}
     */
    static isRenderable(dto) {
        if (!dto || typeof dto !== 'object') return false;
        const hasValidKpId = typeof dto.kinopoiskId === 'number' && dto.kinopoiskId > 0;
        const hasVerifiedIdentity = dto.identity?.status === 'VERIFIED';
        const hasDisplayTitle = Boolean(dto.name && dto.name.trim().length > 0 && !this.isPlaceholder(dto.name));
        return Boolean(hasValidKpId && hasVerifiedIdentity && hasDisplayTitle);
    }

    /**
     * Primary entry point: Retrieve and aggregate a complete, render-ready movie DTO.
     * @param {number|string} kinopoiskId
     * @param {Object} [options]
     * @param {boolean} [options.forceRefresh=false]
     * @param {string} [options.title='']
     * @param {number|string} [options.year='']
     * @param {number} [options.candidateTmdbId=null]
     * @returns {Promise<Object>} UnifiedMovieDTO
     */
    async getMovieDetails(kinopoiskId, options = {}) {
        const perf = typeof window !== 'undefined' ? window.MovieDetailsPerf : null;
        const numKpId = Number(kinopoiskId);
        if (!numKpId || isNaN(numKpId) || numKpId <= 0) {
            throw new Error(`INVALID_KP_ID: Valid positive Kinopoisk ID required, got ${kinopoiskId}`);
        }

        let reverseMapping = null;
        let reverseLookupAttempted = false;
        // A cached DTO can be structurally complete while still lacking a
        // verified TMDB identity (and therefore a title logo). Keep this
        // state separate from a warm-cache hit so a negative/old reverse
        // lookup cannot permanently freeze a KP-only payload in the UI.
        let cacheRefreshRequired = false;

        // 1. Check MovieCacheService unless forceRefresh requested. A speculative
        // pre-auth read may be supplied so authenticated continuation does not
        // issue the same public cache request twice.
        if (!options.forceRefresh && this.movieCacheService) {
            try {
                const cached = options.prefetchedCacheResolved
                    ? (options.prefetchedCachedMovie || null)
                    : await this.movieCacheService.getCachedMovie(numKpId);
                if (cached && !cached._cacheExpired) {
                    perf?.setScenarioHint('movieCacheHit');
                    // Check if cached payload already adheres to UnifiedMovieDTO V1
                    if (cached._meta && cached.identity?.status === 'VERIFIED') {
                        const cachedTmdbId = Number(cached.tmdbId || cached.identity?.tmdbId || cached.externalId?.tmdb) || null;
                        const cachedMediaType = cached.isSeries || ['tv-series', 'mini-series', 'animated-series', 'tv'].includes(cached.type)
                            ? 'tv'
                            : 'movie';
                        const canHealFromTmdb = this.tmdbService?.isConfigured ? this.tmdbService.isConfigured() : false;
                        const cachedLogoSelectionVersion = Number(
                            cached._meta?.providers?.tmdb?.logoSelectionVersion
                        ) || 0;
                        const needsLogoSchemaHeal = Boolean(
                            cachedTmdbId &&
                            canHealFromTmdb &&
                            (cachedLogoSelectionVersion < TMDB_LOGO_SELECTION_VERSION ||
                                (!cached.logoUrl && cached._meta?.providers?.tmdb?.logoChecked !== true))
                        );
                        const needsCollectionSchemaHeal = Boolean(
                            cachedTmdbId &&
                            !cached.collection &&
                            canHealFromTmdb &&
                            cached._meta?.providers?.tmdb?.collectionChecked !== true
                        );

                        // KP-only cache records may be missing the IMDb/alternate
                        // title evidence required for reverse recovery. Resolve
                        // them after fetching the canonical KP document below;
                        // only existing TMDB identities need an early conflict check.
                        if (cachedTmdbId && canHealFromTmdb && typeof this.idMappingService?.resolveTmdbIdByKinopoiskId === 'function') {
                            reverseLookupAttempted = true;
                            reverseMapping = await this.idMappingService.resolveTmdbIdByKinopoiskId(
                                numKpId,
                                cachedMediaType,
                                {
                                    kinopoiskMovie: cachedTmdbId ? null : cached,
                                    tmdbService: this.tmdbService
                                }
                            );
                        }
                        const needsIdentityMappingHeal = Boolean(
                            canHealFromTmdb &&
                            (!cachedTmdbId || (reverseMapping && Number(reverseMapping.tmdbId) !== cachedTmdbId))
                        );

                        cacheRefreshRequired = Boolean(
                            needsIdentityMappingHeal ||
                            needsLogoSchemaHeal ||
                            needsCollectionSchemaHeal
                        );

                        MediaAggregatorService.logFranchiseDebug('A_CACHE', {
                            kinopoiskId: numKpId,
                            tmdbId: cachedTmdbId,
                            collection: cached.collection || null,
                            collectionChecked: cached._meta?.providers?.tmdb?.collectionChecked,
                            logoChecked: cached._meta?.providers?.tmdb?.logoChecked,
                            needsLogoSchemaHeal,
                            needsCollectionSchemaHeal,
                            reverseTmdbId: reverseMapping?.tmdbId || null,
                            needsIdentityMappingHeal
                        });

                        if (!cacheRefreshRequired) {
                            MediaAggregatorService.logFranchiseDebug('B_CACHE_DECISION', {
                                kinopoiskId: numKpId,
                                decision: 'return-warm-cache'
                            });
                            perf?.mark('md:aggregation-ready');
                            return cached;
                        }
                        if (needsIdentityMappingHeal && reverseMapping?.tmdbId) {
                            console.info(`[MediaAggregator] Reaggregating degraded cache for KP ${numKpId} using verified TMDB ${reverseMapping.tmdbId}.`);
                        } else {
                            console.info(`[MediaAggregator] Refreshing cached KP ${numKpId} once for missing TMDB identity/schema fields.`);
                        }
                    }
                    // Adapt legacy cached movie to UnifiedMovieDTO shape
                    if (typeof Utils !== 'undefined' && Utils.hasDetailedMovieInfo && Utils.hasDetailedMovieInfo(cached)) {
                        if (!reverseMapping && !reverseLookupAttempted) {
                            const cachedMediaType = cached.isSeries || ['tv-series', 'mini-series', 'animated-series', 'tv'].includes(cached.type)
                                ? 'tv'
                                : 'movie';
                            const canHealFromTmdb = this.tmdbService?.isConfigured ? this.tmdbService.isConfigured() : false;
                            const cachedTmdbId = Number(cached.tmdbId || cached.identity?.tmdbId || cached.externalId?.tmdb) || null;
                            if (cachedTmdbId && canHealFromTmdb && typeof this.idMappingService?.resolveTmdbIdByKinopoiskId === 'function') {
                                reverseLookupAttempted = true;
                                reverseMapping = await this.idMappingService.resolveTmdbIdByKinopoiskId(
                                    numKpId,
                                    cachedMediaType,
                                    { kinopoiskMovie: cached, tmdbService: this.tmdbService }
                                );
                            }
                            // A legacy KP-only cache must be allowed through the
                            // provider pipeline when TMDB is configured. Returning
                            // the adapted legacy DTO here would permanently omit
                            // recoverable logos after a negative reverse lookup.
                            cacheRefreshRequired = canHealFromTmdb;
                        }
                        if (!reverseMapping && !cacheRefreshRequired) {
                            perf?.mark('md:aggregation-ready');
                            return MediaAggregatorService.aggregate(cached, null, {
                                isLegacyResolved: true,
                                status: 'resolved'
                            });
                        }
                    }
                }
            } catch (cacheErr) {
                console.warn(`[MediaAggregator] Error reading cache for ${numKpId}:`, cacheErr);
            }
        }

        // 2. Fetch Kinopoisk details unless the Home click route explicitly
        // provides a verified TMDB identity. That route must remain API-free.
        let kpMovie = null;
        let tmdbData = null;
        const candidateTmdbId = Number(options.candidateTmdbId || options.tmdbId) || null;
        const skipKinopoiskApi = options.skipKinopoiskApi === true && candidateTmdbId > 0;

        if (skipKinopoiskApi) {
            try {
                if (this.tmdbService?.isConfigured?.() && typeof this.tmdbService.getMovieDetails === 'function') {
                    tmdbData = await this.tmdbService.getMovieDetails(
                        candidateTmdbId,
                        '',
                        options.mediaType === 'tv' ? 'tv' : 'movie'
                    );
                }
            } catch (tmdbErr) {
                console.warn(`[MediaAggregator] TMDB-only detail lookup failed for ${candidateTmdbId}:`, tmdbErr);
            }

            kpMovie = {
                id: numKpId,
                kinopoiskId: numKpId,
                name: options.title || tmdbData?.name || tmdbData?.title || '',
                alternativeName: tmdbData?.originalName || tmdbData?.original_title || '',
                year: Number(options.year || tmdbData?.year || String(tmdbData?.release_date || '').slice(0, 4)) || null,
                type: options.mediaType === 'tv' ? 'tv-series' : 'movie',
                externalId: { tmdb: candidateTmdbId },
                genres: [],
                countries: [],
                persons: []
            };
            perf?.mark('md:kp-skipped-tmdb-only');
        } else {
            try {
                if (this.kinopoiskService) {
                    const kpRequest = perf?.requestStart('KP_METADATA', { purpose: 'movie-details' });
                    kpMovie = await this.kinopoiskService.getMovieById(numKpId, {
                        title: options.title || '',
                        year: options.year || ''
                    });
                    perf?.requestEnd(kpRequest);
                    perf?.mark('md:kp-ready');
                }
            } catch (kpError) {
                console.warn(`[MediaAggregator] Kinopoisk API fetch failed for ${numKpId}:`, kpError);
            }
        }

        // Fallback to expired cache if available
        if (!kpMovie && this.movieCacheService) {
            try {
                const fallbackCached = options.prefetchedCacheResolved
                    ? (options.prefetchedCachedMovie || null)
                    : await this.movieCacheService.getCachedMovie(numKpId);
                if (fallbackCached) {
                    kpMovie = fallbackCached;
                }
            } catch (e) {
                console.warn(`[MediaAggregator] Error reading fallback cache for ${numKpId}:`, e);
            }
        }

        if (!kpMovie) {
            throw new Error(`KP_ENTITY_NOT_FOUND: Failed to get Kinopoisk entity for ID ${numKpId}`);
        }

        // 3. Resolve trusted TMDB ID
        let tmdbId = Number(kpMovie?.externalId?.tmdb) || null;
        let isManual = false;
        let isLegacyResolved = false;
        const isSeries = Boolean(kpMovie?.isSeries || ['tv-series', 'mini-series', 'animated-series', 'tv'].includes(kpMovie?.type));
        const mediaType = isSeries ? 'tv' : 'movie';

        if (reverseMapping && Number(reverseMapping.tmdbId) > 0) {
            tmdbId = Number(reverseMapping.tmdbId);
            isManual = reverseMapping.isManual === true || reverseMapping.verificationMethod === 'admin_verified';
        } else if (!tmdbId && this.idMappingService) {
            try {
                if (!reverseMapping && !reverseLookupAttempted && typeof this.idMappingService.resolveTmdbIdByKinopoiskId === 'function') {
                    reverseLookupAttempted = true;
                    reverseMapping = await this.idMappingService.resolveTmdbIdByKinopoiskId(
                        numKpId,
                        mediaType,
                        { kinopoiskMovie: kpMovie, tmdbService: this.tmdbService }
                    );
                }

                if (reverseMapping && Number(reverseMapping.tmdbId) > 0) {
                    tmdbId = Number(reverseMapping.tmdbId);
                    isManual = reverseMapping.isManual === true || reverseMapping.verificationMethod === 'admin_verified';
                } else if (typeof this.idMappingService.getManualMappings === 'function') {
                    // Backward-compatible adapter for older injected mapping services.
                    const manualMappings = await this.idMappingService.getManualMappings();
                    const match = manualMappings.find(m => Number(m.kpId) === numKpId);
                    if (match && Number(match.tmdbId) > 0) {
                        tmdbId = Number(match.tmdbId);
                        isManual = true;
                    }
                }
            } catch (mapErr) {
                console.warn('[MediaAggregator] Error checking verified reverse mappings:', mapErr);
            }
        }

        // 4. Fetch TMDB enrichment with safe failure handling
        const isTmdbConfigured = this.tmdbService?.isConfigured ? this.tmdbService.isConfigured() : false;

        if (cacheRefreshRequired || !tmdbId) {
            console.info('[MediaAggregator] TMDB resolution diagnostics:', {
                kinopoiskId: numKpId,
                mediaType,
                tmdbConfigured: isTmdbConfigured,
                reverseLookupAttempted,
                resolvedTmdbId: tmdbId,
                reverseMappingStatus: reverseMapping?.status || null,
                reverseMappingMethod: reverseMapping?.verificationMethod || null,
                kpExternalIdKeys: Object.keys(kpMovie?.externalId || {})
            });
        }

        if (isTmdbConfigured && !tmdbData) {
            try {
                const tmdbRequest = perf?.requestStart('TMDB_METADATA', { purpose: 'movie-enrichment' });
                if (tmdbId) {
                    if (typeof this.tmdbService.getMovieDetails === 'function') {
                        tmdbData = await this.tmdbService.getMovieDetails(tmdbId, '', mediaType);
                    } else if (typeof this.tmdbService._getMovieDetails === 'function') {
                        tmdbData = await this.tmdbService._getMovieDetails(tmdbId);
                    }
                } else {
                    const imdbId = kpMovie?.externalId?.imdb?.trim();
                    if (imdbId && typeof this.tmdbService.isValidImdbId === 'function' && this.tmdbService.isValidImdbId(imdbId)) {
                        tmdbData = await this.tmdbService.findByImdbId(imdbId, mediaType);
                        if (tmdbData?.tmdbId) {
                            tmdbId = tmdbData.tmdbId;
                        }
                    }
                }
                perf?.requestEnd(tmdbRequest);
                perf?.mark('md:tmdb-ready');
                MediaAggregatorService.logFranchiseDebug('C_TMDB_RESULT', {
                    kinopoiskId: numKpId,
                    tmdbId,
                    received: Boolean(tmdbData),
                    collection: tmdbData?.collection || tmdbData?.belongs_to_collection || null
                });
            } catch (tmdbErr) {
                console.warn(`[MediaAggregator] Optional TMDB enrichment failed for KP ${numKpId}:`, tmdbErr);
                tmdbData = null;
            }
        }

        // 5. Aggregate into UnifiedMovieDTO
        const unifiedDto = MediaAggregatorService.aggregate(kpMovie, tmdbData, {
            kinopoiskId: numKpId,
            tmdbId,
            candidateTmdbId: options.candidateTmdbId || null,
            isManual,
            isLegacyResolved,
            identityStatus: reverseMapping?.identityStatus || null,
            verificationMethod: reverseMapping?.verificationMethod || null,
            verificationSource: reverseMapping?.verificationSource || null,
            resolutionSource: reverseMapping?.resolutionSource || null,
            verifiedAt: reverseMapping?.resolvedAt ? new Date(reverseMapping.resolvedAt).toISOString() : null
        });
        perf?.mark('md:aggregation-ready');
        MediaAggregatorService.logFranchiseDebug('D_UNIFIED_DTO', {
            kinopoiskId: numKpId,
            tmdbId: unifiedDto.tmdbId,
            collection: unifiedDto.collection || null,
            collectionChecked: unifiedDto._meta?.providers?.tmdb?.collectionChecked,
            verificationMethod: unifiedDto.identity?.verificationMethod || null
        });

        // 6. Cache the unified DTO if renderable
        if (this.movieCacheService && MediaAggregatorService.isRenderable(unifiedDto)) {
            try {
                await this.movieCacheService.cacheMovie(unifiedDto);
            } catch (cacheWriteErr) {
                console.warn(`[MediaAggregator] Failed caching unified DTO for ${numKpId}:`, cacheWriteErr);
            }
        }

        // Observability
        console.info(`[MediaAggregator] Aggregated ${numKpId}: KP=${unifiedDto._meta.providers.kp.quality}, TMDB=${unifiedDto._meta.providers.tmdb.quality}, Identity=${unifiedDto.identity.verificationMethod || 'none'}, Pipeline=${unifiedDto._meta.pipelineStatus}`);

        return unifiedDto;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = MediaAggregatorService;
}
if (typeof window !== 'undefined') {
    window.MediaAggregatorService = MediaAggregatorService;
}
