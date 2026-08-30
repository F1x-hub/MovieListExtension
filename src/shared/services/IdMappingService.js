/**
 * IdMappingService - Deterministic TMDB -> Kinopoisk ID Mapping Service
 * Handles batch resolution, persistent storage, adaptive negative caching,
 * and strict media-type disambiguation (movie:id vs tv:id).
 */
function isQuotaExhaustedError(error) {
    return error?.name === 'QuotaExhaustedError'
        || (typeof globalThis !== 'undefined' && typeof globalThis.isQuotaExhaustedError === 'function' && globalThis.isQuotaExhaustedError(error));
}

class IdMappingService {
    /**
     * @param {Object} [kinopoiskService] - Optional KinopoiskService instance for API requests
     */
    constructor(kinopoiskService = null, tmdbService = null, firebaseManagerInstance = null) {
        this.kinopoiskService = kinopoiskService || (typeof KinopoiskService !== 'undefined' ? new KinopoiskService() : null);
        this.tmdbService = tmdbService || (typeof TMDBService !== 'undefined' ? new TMDBService() : null);
        this.firebaseManager = firebaseManagerInstance;
        this.CACHE_KEY = 'tmdb_kp_mapping_cache_v2';
        this.UNMAPPED_QUEUE_KEY = 'tmdb_unmapped_queue_v1';
        this.SHARED_MAPPING_COLLECTION = 'tmdbKinopoiskMappings';
        this.SHARED_REVERSE_COLLECTION = 'tmdbKinopoiskReverseIndex';
        this.BATCH_SIZE = 25;
        this.MAX_UNMAPPED_QUEUE = 100;
        this.REVERSE_NEGATIVE_TTL = 14 * 24 * 60 * 60 * 1000;
        // Bump when the KP-rooted metadata recovery algorithm changes so
        // fresh negatives from an older algorithm get one controlled retry.
        this.METADATA_RECOVERY_VERSION = 4;

        // In-memory fallback if chrome.storage is unavailable (e.g. tests)
        this._memoryCache = new Map();
        this._memoryUnmappedQueue = new Map();

        // Verified provider-data exception: the canonical KP 1309570 document
        // currently omits externalId.tmdb, so a valid externalId.tmdb=634649
        // lookup completes with HTTP 200 but zero documents.
        this.VERIFIED_MAPPING_OVERRIDES = Object.freeze({
            'movie:634649': Object.freeze({
                tmdbId: 634649,
                mediaType: 'movie',
                kpId: 1309570,
                kpType: 'movie',
                status: 'resolved',
                identityStatus: 'VERIFIED',
                verificationMethod: 'provider_document_verified',
                verificationSource: 'curated_provider_exception',
                resolutionSource: 'curated_provider_exception'
            })
        });

        this.TRUSTED_REVERSE_METHODS = new Set([
            'exact_external_tmdb',
            'exact_external_imdb',
            'admin_verified',
            'manual_verified_override',
            'provider_document_verified',
            'context_verified',
            'exact_title_year_type'
        ]);
    }

    /**
     * Calculate administrative priority for an unmapped queue item.
     * Evaluates productRank (impact on Home page sections) first, with fallback to tmdbRank.
     * CRITICAL: effectiveRank <= 12 (enters Home Top-12)
     * HIGH: 13 <= effectiveRank <= 20
     * MEDIUM: 21 <= effectiveRank <= 30
     * LOW: effectiveRank > 30 or unranked
     * @param {{ productRank?: number|null, tmdbRank?: number|null }} item
     * @returns {'CRITICAL'|'HIGH'|'MEDIUM'|'LOW'}
     */
    static calculatePriority(item) {
        const prodRank = Number(item?.productRank);
        const tmdbRank = Number(item?.tmdbRank);
        const effectiveRank = (Number.isInteger(prodRank) && prodRank > 0)
            ? prodRank
            : ((Number.isInteger(tmdbRank) && tmdbRank > 0) ? tmdbRank : null);

        if (Number.isInteger(effectiveRank) && effectiveRank > 0) {
            if (effectiveRank <= 12) return 'CRITICAL';
            if (effectiveRank <= 20) return 'HIGH';
            if (effectiveRank <= 30) return 'MEDIUM';
            return 'LOW';
        }
        return 'LOW';
    }

    calculatePriority(item) {
        return IdMappingService.calculatePriority(item);
    }

    /**
     * Normalize media type to canonical 'movie' | 'tv' namespace.
     * @param {string} rawType - Input type string
     * @returns {'movie'|'tv'}
     */
    normalizeMediaType(rawType) {
        if (!rawType) return 'movie';
        const lower = String(rawType).toLowerCase().trim();
        if (lower === 'tv' || lower === 'tv-series' || lower === 'series' || lower === 'tv-show' || lower === 'anime' || lower === 'animated-series' || lower === 'mini-series') {
            return 'tv';
        }
        return 'movie';
    }

    /**
     * Build canonical cache key: `${mediaType}:${tmdbId}`
     * @param {'movie'|'tv'} mediaType
     * @param {number|string} tmdbId
     * @returns {string}
     */
    buildKey(mediaType, tmdbId) {
        const normType = this.normalizeMediaType(mediaType);
        return `${normType}:${Number(tmdbId)}`;
    }

    /**
     * Build the O(1) reverse identity key used by KP-rooted detail routes.
     * @param {'movie'|'tv'} mediaType
     * @param {number|string} kinopoiskId
     * @returns {string}
     */
    buildReverseKey(mediaType, kinopoiskId) {
        const normType = this.normalizeMediaType(mediaType);
        return `kp:${normType}:${Number(kinopoiskId)}`;
    }

    getFirebaseManager() {
        return this.firebaseManager
            || (typeof firebaseManager !== 'undefined' ? firebaseManager : null)
            || (typeof window !== 'undefined' ? window.firebaseManager : null);
    }

    get db() {
        return this.getFirebaseManager()?.db || null;
    }

    getCurrentUserId() {
        const manager = this.getFirebaseManager();
        return manager?.getCurrentUser?.()?.uid || manager?.auth?.currentUser?.uid || null;
    }

    _normalizeSharedManualMapping(entry, expectedMediaType = null, expectedTmdbId = null) {
        const mediaType = this.normalizeMediaType(entry?.mediaType);
        const tmdbId = Number(entry?.tmdbId);
        const kpId = Number(entry?.kpId);
        if (!entry
            || !Number.isInteger(tmdbId) || tmdbId <= 0
            || !Number.isInteger(kpId) || kpId <= 0
            || !['movie', 'tv'].includes(mediaType)
            || entry.status !== 'resolved'
            || entry.identityStatus !== 'VERIFIED'
            || entry.verificationMethod !== 'admin_verified'
            || entry.verificationSource !== 'manual'
            || entry.resolutionSource !== 'manual'
            || entry.isManual !== true
            || entry.reverseKey !== this.buildReverseKey(mediaType, kpId)
            || (expectedMediaType && mediaType !== this.normalizeMediaType(expectedMediaType))
            || (expectedTmdbId && tmdbId !== Number(expectedTmdbId))) {
            return null;
        }
        return this._normalizeTrustedMapping(entry);
    }

    async _readSharedMapping(mediaType, tmdbId) {
        if (!this.db || !this.getCurrentUserId()) return { available: false, mapping: null };

        try {
            const doc = await this.db.collection(this.SHARED_MAPPING_COLLECTION)
                .doc(this.buildKey(mediaType, tmdbId))
                .get();
            return {
                available: true,
                mapping: doc.exists ? this._normalizeSharedManualMapping(doc.data(), mediaType, tmdbId) : null
            };
        } catch (error) {
            console.warn('[IdMapping] Could not read shared TMDB mapping:', error?.message || error);
            return { available: false, mapping: null };
        }
    }

    async _readSharedMappings(items) {
        const result = new Map();
        const records = Array.isArray(items) ? items : [];
        const chunkSize = 25;
        for (let offset = 0; offset < records.length; offset += chunkSize) {
            const chunk = records.slice(offset, offset + chunkSize);
            const states = await Promise.all(chunk.map(item => this._readSharedMapping(item.mediaType, item.tmdbId)));
            chunk.forEach((item, index) => result.set(item.key, states[index]));
        }
        return result;
    }

    async _getSharedMapping(mediaType, tmdbId) {
        return (await this._readSharedMapping(mediaType, tmdbId)).mapping;
    }

    async _readSharedMappingByReverseKey(mediaType, kinopoiskId) {
        if (!this.db || !this.getCurrentUserId()) return { available: false, mapping: null };

        try {
            const reverseKey = this.buildReverseKey(mediaType, kinopoiskId);
            const lock = await this.db.collection(this.SHARED_REVERSE_COLLECTION).doc(reverseKey).get();
            const lockData = lock.data?.();
            const normalizedType = this.normalizeMediaType(lockData?.mediaType);
            const lockTmdbId = Number(lockData?.tmdbId);
            const lockKpId = Number(lockData?.kpId);
            if (!lock.exists
                || lockData?.reverseKey !== reverseKey
                || !['movie', 'tv'].includes(normalizedType)
                || normalizedType !== this.normalizeMediaType(mediaType)
                || !Number.isInteger(lockTmdbId) || lockTmdbId <= 0
                || !Number.isInteger(lockKpId) || lockKpId !== Number(kinopoiskId)
                || lockData?.mappingId !== this.buildKey(normalizedType, lockTmdbId)) {
                return { available: true, mapping: null };
            }
            const mappingId = lockData.mappingId;
            if (typeof mappingId !== 'string') return { available: true, mapping: null };

            const mapping = await this.db.collection(this.SHARED_MAPPING_COLLECTION).doc(mappingId).get();
            return {
                available: true,
                mapping: mapping.exists
                    ? this._normalizeSharedManualMapping(mapping.data(), normalizedType, lockTmdbId)
                    : null
            };
        } catch (error) {
            console.warn('[IdMapping] Could not read shared reverse mapping:', error?.message || error);
            return { available: false, mapping: null };
        }
    }

    async _writeSharedManualMapping(entry) {
        const manager = this.getFirebaseManager();
        if (!manager) throw new Error('Общая база связей недоступна. Попробуйте позже.');
        if (!this.db) throw new Error('Общая база связей недоступна. Попробуйте позже.');

        const adminId = this.getCurrentUserId();
        if (!adminId) throw new Error('Для сохранения общей связи требуется авторизация администратора.');

        const collection = this.db.collection(this.SHARED_MAPPING_COLLECTION);
        const reverseCollection = this.db.collection(this.SHARED_REVERSE_COLLECTION);
        const documentId = this.buildKey(entry.mediaType, entry.tmdbId);
        const documentRef = collection.doc(documentId);
        const reverseKey = this.buildReverseKey(entry.mediaType, entry.kpId);
        const reverseRef = reverseCollection.doc(reverseKey);
        const serverTimestamp = (typeof firebase !== 'undefined' && firebase.firestore?.FieldValue?.serverTimestamp)
            ? firebase.firestore.FieldValue.serverTimestamp()
            : Date.now();

        await this.db.runTransaction(async (transaction) => {
            const existing = await transaction.get(documentRef);
            const existingReverse = await transaction.get(reverseRef);
            if (existingReverse.exists && existingReverse.data()?.mappingId !== documentId) {
                throw new Error('Этот Kinopoisk ID уже связан с другим TMDB-тайтлом того же типа.');
            }

            const existingKpId = Number(existing.exists ? existing.data()?.kpId : 0);
            if (existingKpId && existingKpId !== Number(entry.kpId)) {
                throw new Error('В общей базе уже есть другая подтверждённая связь для этого TMDB ID.');
            }

            transaction.set(documentRef, {
                tmdbId: Number(entry.tmdbId),
                mediaType: this.normalizeMediaType(entry.mediaType),
                kpId: Number(entry.kpId),
                kpType: entry.kpType || null,
                title: entry.title || '',
                year: Number(entry.year) || null,
                status: 'resolved',
                identityStatus: 'VERIFIED',
                verificationMethod: 'admin_verified',
                verificationSource: 'manual',
                resolutionSource: 'manual',
                isManual: true,
                reverseKey,
                confirmedBy: existing.exists ? existing.data()?.confirmedBy || adminId : adminId,
                updatedBy: adminId,
                createdAt: existing.exists ? existing.data()?.createdAt || serverTimestamp : serverTimestamp,
                updatedAt: serverTimestamp,
                resolvedAt: Number(entry.resolvedAt) || Date.now()
            });
            transaction.set(reverseRef, {
                reverseKey,
                mappingId: documentId,
                tmdbId: Number(entry.tmdbId),
                mediaType: this.normalizeMediaType(entry.mediaType),
                kpId: Number(entry.kpId),
                updatedAt: serverTimestamp
            });
        });
    }

    async _deleteSharedManualMapping(mediaType, tmdbId) {
        const manager = this.getFirebaseManager();
        if (!manager) throw new Error('Общая база связей недоступна. Попробуйте позже.');
        if (!this.db) throw new Error('Общая база связей недоступна. Попробуйте позже.');
        if (!this.getCurrentUserId()) throw new Error('Для удаления общей связи требуется авторизация администратора.');

        const documentRef = this.db.collection(this.SHARED_MAPPING_COLLECTION)
            .doc(this.buildKey(mediaType, tmdbId));
        await this.db.runTransaction(async (transaction) => {
            const existing = await transaction.get(documentRef);
            if (!existing.exists) return;

            const reverseKey = existing.data()?.reverseKey;
            transaction.delete(documentRef);
            if (typeof reverseKey === 'string' && reverseKey) {
                transaction.delete(this.db.collection(this.SHARED_REVERSE_COLLECTION).doc(reverseKey));
            }
        });
    }

    _normalizeTrustedMapping(entry) {
        if (!entry || entry.status !== 'resolved') return null;

        const tmdbId = Number(entry.tmdbId);
        const kpId = Number(entry.kpId || entry.kinopoiskId);
        if (!tmdbId || !kpId) return null;

        let identityStatus = entry.identityStatus || null;
        let verificationMethod = entry.verificationMethod || null;
        let verificationSource = entry.verificationSource || null;

        // Migrate only historically exact/manual records. Generic legacy_resolved
        // entries are deliberately excluded from the reverse trust boundary.
        if (entry.isManual || entry.resolutionSource === 'manual') {
            identityStatus = 'VERIFIED';
            verificationMethod = verificationMethod || 'admin_verified';
            verificationSource = verificationSource || 'manual';
        } else if (entry.resolutionSource === 'automatic') {
            identityStatus = 'VERIFIED';
            verificationMethod = verificationMethod || 'exact_external_tmdb';
            verificationSource = verificationSource || 'automatic';
        }

        if (identityStatus !== 'VERIFIED' || !this.TRUSTED_REVERSE_METHODS.has(verificationMethod)) {
            return null;
        }

        return {
            tmdbId,
            mediaType: this.normalizeMediaType(entry.mediaType),
            kpId,
            kpType: entry.kpType || null,
            status: 'resolved',
            identityStatus,
            verificationMethod,
            verificationSource,
            resolutionSource: entry.resolutionSource || null,
            isManual: entry.isManual === true,
            resolvedAt: Number(entry.resolvedAt) || Date.now()
        };
    }

    _writeReverseIndex(cache, entry) {
        const trusted = this._normalizeTrustedMapping(entry);
        if (!trusted) return null;

        const reverseKey = this.buildReverseKey(trusted.mediaType, trusted.kpId);
        cache[reverseKey] = {
            ...trusted,
            sharedSource: entry.sharedSource || null,
            isReverseIndex: true
        };
        return trusted;
    }

    _getReverseVerificationPriority(entry) {
        const priorities = {
            admin_verified: 5,
            manual_verified_override: 5,
            provider_document_verified: 4,
            exact_title_year_type: 3,
            context_verified: 2,
            exact_external_imdb: 1.5,
            exact_external_tmdb: 1
        };
        return priorities[entry?.verificationMethod] || 0;
    }

    _writeReverseNegative(cache, mediaType, kinopoiskId, attemptedAt = Date.now(), metadataFingerprint = '') {
        const normType = this.normalizeMediaType(mediaType);
        const kpId = Number(kinopoiskId);
        const reverseKey = this.buildReverseKey(normType, kpId);
        cache[reverseKey] = {
            mediaType: normType,
            kpId,
            status: 'not-found',
            isReverseIndex: true,
            attemptedAt,
            retryAfter: attemptedAt + this.REVERSE_NEGATIVE_TTL,
            metadataRecoveryVersion: this.METADATA_RECOVERY_VERSION
        };
        if (metadataFingerprint) {
            cache[reverseKey].metadataFingerprint = metadataFingerprint;
        }
        return cache[reverseKey];
    }

    _getKinopoiskMetadataTitles(kpMovie) {
        return [...new Set([
            kpMovie?.name,
            kpMovie?.alternativeName,
            kpMovie?.enName,
            kpMovie?.title
        ].map(value => this._normalizeMetadataTitle(value)).filter(Boolean))];
    }

    _buildMetadataFingerprint(kpMovie) {
        const titles = this._getKinopoiskMetadataTitles(kpMovie).sort();
        const year = Number(kpMovie?.year) || 0;
        const type = this.normalizeMediaType(kpMovie?.type);
        return titles.length || year ? `${type}|${year}|${titles.join('|')}` : '';
    }

    _getTmdbCandidateYear(candidate, mediaType) {
        const date = mediaType === 'tv'
            ? (candidate?.first_air_date || candidate?.release_date)
            : candidate?.release_date;
        const year = String(date || '').match(/^\d{4}/);
        return year ? Number(year[0]) : 0;
    }

    _verifyTmdbMetadataCandidate(kpMovie, candidate, mediaType) {
        const inputTitles = this._getKinopoiskMetadataTitles(kpMovie);
        const candidateTitles = [
            candidate?.title,
            candidate?.name,
            candidate?.original_title,
            candidate?.original_name
        ].map(value => this._normalizeMetadataTitle(value)).filter(Boolean);
        const titleMatch = candidateTitles.some(title => inputTitles.includes(title));
        const candidateYear = this._getTmdbCandidateYear(candidate, mediaType);
        const kpYear = Number(kpMovie?.year) || 0;
        const yearMatch = Boolean(kpYear && candidateYear && kpYear === candidateYear);
        const candidateMediaType = candidate?.media_type || mediaType;
        const typeMatch = candidateMediaType === mediaType;

        return { titleMatch, yearMatch, typeMatch, accepted: titleMatch && yearMatch && typeMatch };
    }

    async _saveAutomaticReverseMapping(cache, metadata) {
        const kpId = Number(metadata.kpId);
        const tmdbId = Number(metadata.tmdbId);
        const mediaType = this.normalizeMediaType(metadata.mediaType);
        const now = Date.now();
        const entry = {
            tmdbId,
            mediaType,
            kpId,
            kpType: metadata.kpType || (mediaType === 'tv' ? 'tv-series' : 'movie'),
            title: metadata.title || '',
            year: Number(metadata.year) || null,
            status: 'resolved',
            identityStatus: 'VERIFIED',
            verificationMethod: metadata.verificationMethod,
            verificationSource: 'automatic',
            resolutionSource: metadata.verificationMethod === 'exact_title_year_type'
                ? 'metadata_fallback'
                : 'automatic',
            resolvedAt: now
        };

        cache[this.buildKey(mediaType, tmdbId)] = entry;
        this._writeReverseIndex(cache, entry);
        await this.saveMappingCache(cache);
        return this._normalizeTrustedMapping(entry);
    }

    /**
     * Recover a missing KP -> TMDB identity from provider evidence.
     * IMDb is exact. Title/year recovery requires one exact, type-compatible
     * candidate; ambiguous or title-only results are rejected.
     */
    async _resolveTmdbByKinopoiskMetadata(kpMovie, mediaType, options = {}) {
        const tmdbService = options.tmdbService || this.tmdbService;
        if (!tmdbService) return null;

        const kpId = Number(kpMovie?.kinopoiskId || kpMovie?.id || options.kinopoiskId);
        if (!kpId || isNaN(kpId) || kpId <= 0) return null;

        const imdbId = String(kpMovie?.externalId?.imdb || '').trim();
        const isValidImdb = typeof tmdbService.isValidImdbId === 'function'
            ? tmdbService.isValidImdbId(imdbId)
            : /^tt\d{7,10}$/i.test(imdbId);

        if (isValidImdb && typeof tmdbService.findByImdbId === 'function') {
            try {
                const tmdbData = await tmdbService.findByImdbId(imdbId, mediaType);
                const tmdbId = Number(tmdbData?.tmdbId || tmdbData?.id);
                if (tmdbId > 0) {
                    return {
                        tmdbId,
                        mediaType,
                        kpId,
                        kpType: kpMovie?.type,
                        title: kpMovie?.name || kpMovie?.alternativeName || '',
                        year: kpMovie?.year,
                        verificationMethod: 'exact_external_imdb'
                    };
                }
            } catch (error) {
                console.warn(`[IdMapping] IMDb bridge failed for KP ${kpId}:`, error?.message || error);
            }
        }

        const year = Number(kpMovie?.year) || 0;
        const titles = this._getKinopoiskMetadataTitles(kpMovie);
        if (!year || titles.length === 0 || typeof tmdbService.searchByTitleYearCandidates !== 'function') {
            return null;
        }

        const candidatesById = new Map();
        const verifiedIdsByTitle = [];
        for (const title of titles) {
            try {
                const candidates = await tmdbService.searchByTitleYearCandidates(title, year, mediaType);
                const verifiedIdsForTitle = new Set();
                for (const candidate of candidates || []) {
                    const candidateId = Number(candidate?.id);
                    if (candidateId <= 0) continue;
                    candidatesById.set(candidateId, candidate);
                    if (this._verifyTmdbMetadataCandidate(kpMovie, candidate, mediaType).accepted) {
                        verifiedIdsForTitle.add(candidateId);
                    }
                }
                if (verifiedIdsForTitle.size > 0) {
                    verifiedIdsByTitle.push(verifiedIdsForTitle);
                }
            } catch (error) {
                console.warn(`[IdMapping] TMDB metadata search failed for KP ${kpId}:`, error?.message || error);
            }
        }

        // Multiple KP titles are independent evidence. Prefer the candidate
        // present in every non-empty exact-title result set. This resolves
        // translated-title ambiguity without accepting title-only matches.
        const verifiedCandidateIds = verifiedIdsByTitle.length > 0
            ? [...verifiedIdsByTitle].reduce((intersection, ids) =>
                intersection.filter(candidateId => ids.has(candidateId)),
                [...verifiedIdsByTitle[0]])
            : [];
        const verifiedCandidates = verifiedCandidateIds
            .map(candidateId => candidatesById.get(candidateId))
            .filter(Boolean);

        if (verifiedCandidates.length !== 1) {
            if (verifiedCandidates.length > 1) {
                console.warn(`[IdMapping] Ambiguous TMDB metadata mapping for KP ${kpId}; refusing enrichment.`);
            }
            return null;
        }

        return {
            tmdbId: Number(verifiedCandidates[0].id),
            mediaType,
            kpId,
            kpType: kpMovie?.type,
            title: kpMovie?.name || kpMovie?.alternativeName || '',
            year,
            verificationMethod: 'exact_title_year_type'
        };
    }

    /**
     * Resolve a trusted TMDB identity from a canonical Kinopoisk route ID.
     * Direct reverse-index hits are O(1). Old forward-only caches are scanned once
     * on a miss and migrated to a persistent reverse entry (including a negative
     * marker so unrelated KP-only titles are not rescanned on every page load).
     * @param {number|string} kinopoiskId
     * @param {'movie'|'tv'} [mediaType='movie']
     * @param {{ forceRefresh?: boolean }} [options]
     * @returns {Promise<Object|null>}
     */
    async resolveTmdbIdByKinopoiskId(kinopoiskId, mediaType = 'movie', options = {}) {
        const kpId = Number(kinopoiskId);
        if (!kpId || isNaN(kpId) || kpId <= 0) return null;

        const normType = this.normalizeMediaType(mediaType);
        const reverseKey = this.buildReverseKey(normType, kpId);
        const cache = await this.getMappingCache();
        const sharedState = await this._readSharedMappingByReverseKey(normType, kpId);
        const sharedMapping = sharedState.mapping;
        if (sharedMapping) {
            const sharedCacheEntry = { ...sharedMapping, sharedSource: 'firestore' };
            cache[this.buildKey(sharedMapping.mediaType, sharedMapping.tmdbId)] = sharedCacheEntry;
            this._writeReverseIndex(cache, sharedCacheEntry);
            await this.saveMappingCache(cache);
            return sharedCacheEntry;
        }
        if (sharedState.available && cache[reverseKey]?.sharedSource === 'firestore') {
            const staleForwardKey = this.buildKey(cache[reverseKey].mediaType, cache[reverseKey].tmdbId);
            delete cache[reverseKey];
            if (cache[staleForwardKey]?.sharedSource === 'firestore') {
                delete cache[staleForwardKey];
            }
            await this.saveMappingCache(cache);
        }
        const direct = this._normalizeTrustedMapping(cache[reverseKey]);

        const overrideMatches = Object.values(this.VERIFIED_MAPPING_OVERRIDES)
            .map(entry => this._normalizeTrustedMapping(entry))
            .filter(entry => entry && entry.kpId === kpId && entry.mediaType === normType);

        if (overrideMatches.length === 1) {
            const match = overrideMatches[0];
            const forwardKey = this.buildKey(match.mediaType, match.tmdbId);
            cache[forwardKey] = { ...(cache[forwardKey] || {}), ...match };
            this._writeReverseIndex(cache, match);
            await this.saveMappingCache(cache);
            return match;
        }

        const now = Date.now();
        const reverseNegative = cache[reverseKey];
        if (reverseNegative?.status === 'not-found') {
            const retryAfter = Number(reverseNegative.retryAfter) || 0;
            if (!options.forceRefresh && retryAfter > now) {
                const metadataFingerprint = this._buildMetadataFingerprint(options.kinopoiskMovie);
                const isLegacyNegative = !reverseNegative.metadataFingerprint;
                const isStaleRecoveryVersion = Number(reverseNegative.metadataRecoveryVersion) < this.METADATA_RECOVERY_VERSION;
                if (
                    !options.kinopoiskMovie ||
                    (!isLegacyNegative && !isStaleRecoveryVersion && reverseNegative.metadataFingerprint === metadataFingerprint)
                ) {
                    return null;
                }
            }
            // Missing retryAfter identifies a legacy permanent negative. It is stale
            // by contract, so fall through to recovery and rewrite it below.
        }

        const forwardMatches = Object.entries(cache)
            .filter(([key]) => !key.startsWith('kp:'))
            .map(([, entry]) => this._normalizeTrustedMapping(entry))
            .filter(entry => entry && entry.kpId === kpId && entry.mediaType === normType);

        const matches = [direct, ...forwardMatches]
            .filter(entry => entry && entry.kpId === kpId && entry.mediaType === normType)
            .filter((entry, index, all) => all.findIndex(other => other.tmdbId === entry.tmdbId) === index);

        const highestPriority = Math.max(...matches.map(entry => this._getReverseVerificationPriority(entry)), 0);
        const strongestMatches = matches.filter(entry => this._getReverseVerificationPriority(entry) === highestPriority);

        if (strongestMatches.length !== 1) {
            if (matches.length === 0 && options.kinopoiskMovie) {
                const metadataMatch = await this._resolveTmdbByKinopoiskMetadata(
                    options.kinopoiskMovie,
                    normType,
                    options
                );
                if (metadataMatch) {
                    return this._saveAutomaticReverseMapping(cache, metadataMatch);
                }
            }
            if (matches.length > 1) {
                console.warn(`[IdMapping] Conflicting verified reverse mappings for ${reverseKey}; refusing enrichment.`);
            }
            this._writeReverseNegative(
                cache,
                normType,
                kpId,
                now,
                this._buildMetadataFingerprint(options.kinopoiskMovie)
            );
            await this.saveMappingCache(cache);
            return null;
        }

        const match = strongestMatches[0];
        const forwardKey = this.buildKey(match.mediaType, match.tmdbId);
        cache[forwardKey] = { ...(cache[forwardKey] || {}), ...match };
        this._writeReverseIndex(cache, match);
        await this.saveMappingCache(cache);
        return match;
    }

    /**
     * Check if a Kinopoisk entity type is compatible with a TMDB media type.
     * Strict rule: Never match TMDB movie to KP tv-series or TMDB tv to KP movie.
     * Uses Kinopoisk doc metadata (isSeries, movieLength, seriesLength) to safely disambiguate 'anime'.
     * @param {'movie'|'tv'} mediaType - TMDB media type ('movie' | 'tv')
     * @param {string} kpType - Kinopoisk document type
     * @param {Object} [doc] - Optional full Kinopoisk document for precise subtype checking
     * @returns {boolean}
     */
    isCompatibleType(mediaType, kpType, doc = null) {
        if (!kpType) return true; // If KP type is undefined in doc, allow fallback
        const normMediaType = this.normalizeMediaType(mediaType);
        const normKpType = String(kpType).toLowerCase().trim();

        if (normMediaType === 'movie') {
            if (normKpType === 'movie' || normKpType === 'film' || normKpType === 'cartoon' || normKpType === 'anime-film') {
                return true;
            }
            if (normKpType === 'anime') {
                // Disambiguation: If doc metadata indicates this is a TV series, reject for TMDB movie
                if (doc && doc.isSeries === true) {
                    return false;
                }
                return true;
            }
            return false;
        }

        if (normMediaType === 'tv') {
            if (normKpType === 'tv-series' || normKpType === 'tv_series' || normKpType === 'tvseries' || normKpType === 'animated-series' || normKpType === 'tv-show' || normKpType === 'mini-series') {
                return true;
            }
            if (normKpType === 'anime') {
                // Disambiguation: If doc metadata indicates this is a standalone feature film, reject for TMDB tv
                if (doc && doc.isSeries === false && Number(doc.movieLength) > 0 && !doc.seriesLength) {
                    return false;
                }
                return true;
            }
            return false;
        }

        return false;
    }

    _normalizeMetadataTitle(value) {
        return String(value || '')
            .normalize('NFKC')
            .toLocaleLowerCase('ru-RU')
            .replace(/ё/g, 'е')
            .replace(/[\u2010-\u2015\u2212]/g, '-')
            .replace(/[\u2018\u2019\u201B\u201C\u201D\u201E\u00AB\u00BB]/g, ' ')
            .replace(/[^\p{L}\p{N}]+/gu, ' ')
            .trim()
            .replace(/\s+/g, ' ');
    }

    _verifyMetadataCandidate(item, candidate) {
        const inputTitles = [item.title, item.originalTitle]
            .map(title => this._normalizeMetadataTitle(title))
            .filter(Boolean);
        const candidateTitles = [candidate.name, candidate.alternativeName, candidate.enName]
            .map(title => this._normalizeMetadataTitle(title))
            .filter(Boolean);
        
        // Strict normalized exact equality
        const titleMatch = candidateTitles.some(candTitle => inputTitles.includes(candTitle));

        const candYear = Number(candidate.year);
        const itemYear = Number(item.year);
        // Exact year match
        const yearMatch = Boolean(candYear && itemYear && candYear === itemYear);
        const typeMatch = this.isCompatibleType(item.mediaType, candidate.type, candidate);

        return { titleMatch, yearMatch, typeMatch, accepted: titleMatch && yearMatch && typeMatch };
    }

    /**
     * Query Kinopoisk API by externalId.imdb batch
     * @param {Array<Object>} chunk - Array of items containing imdbId
     * @param {Object} kinopoiskService
     * @param {AbortSignal} [signal]
     * @returns {Promise<{ ok: boolean, docsMap: Map<string, Object>, errorType: string|null }>}
     */
    async _queryKinopoiskImdbBatch(chunk, kinopoiskService, signal = null) {
        const docsMap = new Map();
        if (!chunk || chunk.length === 0 || !kinopoiskService) {
            return { ok: true, docsMap, errorType: null };
        }

        try {
            const baseUrl = kinopoiskService.baseUrl || (typeof KINOPOISK_CONFIG !== 'undefined' ? KINOPOISK_CONFIG.BASE_URL : 'https://api.poiskkino.dev');
            const endpoint = (typeof KINOPOISK_CONFIG !== 'undefined' && KINOPOISK_CONFIG.ENDPOINTS?.MOVIE) || '/v1.4/movie';
            const url = `${baseUrl}${endpoint}`;

            const params = new URLSearchParams();
            const limit = Math.min(250, chunk.length * 2 + 10);
            params.append('limit', String(limit));
            params.append('selectFields', 'id');
            params.append('selectFields', 'externalId');
            params.append('selectFields', 'type');
            params.append('selectFields', 'isSeries');
            params.append('selectFields', 'movieLength');
            params.append('selectFields', 'seriesLength');
            params.append('selectFields', 'year');

            for (const item of chunk) {
                if (item.imdbId) {
                    params.append('externalId.imdb', String(item.imdbId));
                }
            }

            const fetchMethod = typeof kinopoiskService._fetchWithRotation === 'function'
                ? kinopoiskService._fetchWithRotation.bind(kinopoiskService)
                : fetch;

            const fullUrl = `${url}?${params.toString()}`;
            const response = await fetchMethod(fullUrl, { method: 'GET', signal });
            if (!response.ok) {
                return { ok: false, docsMap, errorType: 'http-error', status: response.status };
            }

            const data = await response.json();
            const docs = Array.isArray(data.docs) ? data.docs : [];

            // Group docs by imdbId
            const docsByImdbId = new Map();
            for (const doc of docs) {
                const imdbVal = String(doc.externalId?.imdb || '').trim();
                if (!imdbVal) continue;
                if (!docsByImdbId.has(imdbVal)) {
                    docsByImdbId.set(imdbVal, []);
                }
                docsByImdbId.get(imdbVal).push(doc);
            }

            for (const item of chunk) {
                if (!item.imdbId) continue;
                const candidateDocs = docsByImdbId.get(item.imdbId) || [];
                const matched = candidateDocs.find(doc => this.isCompatibleType(item.mediaType, doc.type, doc));
                if (matched) {
                    docsMap.set(item.key, matched);
                }
            }

            return { ok: true, docsMap, errorType: null };
        } catch (err) {
            if (isQuotaExhaustedError(err)) throw err;
            return { ok: false, docsMap, errorType: 'network', error: err.message };
        }
    }

    async _queryKinopoiskMetadata(item, kinopoiskService, signal = null) {
        const titles = [...new Set([item.originalTitle, item.title]
            .map(title => String(title || '').trim())
            .filter(Boolean))];

        if (!kinopoiskService || typeof kinopoiskService.searchMovies !== 'function' || !item.year || titles.length === 0) {
            return { ok: true, doc: null, docs: [] };
        }

        try {
            const documents = [];
            const yearNum = Number(item.year);
            const yearFrom = yearNum ? yearNum - 1 : undefined;
            const yearTo = yearNum ? yearNum + 1 : undefined;

            for (const query of titles) {
                const response = await kinopoiskService.searchMovies(query, 1, 25, {
                    yearFrom,
                    yearTo,
                    candidateLimit: 25,
                    skipScraper: true,
                    skipOffscreen: true,
                    skipFetchScraper: true,
                    throwOnLimit: true,
                    signal
                });
                if (Array.isArray(response?.docs)) documents.push(...response.docs);
            }

            const uniqueDocuments = [...new Map(documents
                .filter(doc => Number(doc?.id || doc?.kinopoiskId))
                .map(doc => [Number(doc.id || doc.kinopoiskId), doc])).values()];
            const verified = [];
            for (const candidate of uniqueDocuments) {
                const checks = this._verifyMetadataCandidate(item, candidate);
                if (checks.accepted) verified.push(candidate);
            }

            if (verified.length !== 1) {
                return { ok: true, doc: null, docs: verified };
            }

            const doc = verified[0];
            return { ok: true, doc, docs: verified };
        } catch (error) {
            if (isQuotaExhaustedError(error)) throw error;
            return { ok: false, doc: null, docs: [], error: error?.message || String(error) };
        }
    }

    /**
     * Read persistent mapping cache from chrome.storage.local or memory store.
     * @returns {Promise<Object>}
     */
    async getMappingCache() {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            return new Promise((resolve) => {
                chrome.storage.local.get([this.CACHE_KEY], (res) => {
                    const stored = (res && res[this.CACHE_KEY]) || {};
                    this._memoryCache.clear();
                    Object.entries(stored).forEach(([key, value]) => this._memoryCache.set(key, value));
                    resolve(stored);
                });
            });
        }
        const obj = {};
        for (const [k, v] of this._memoryCache.entries()) {
            obj[k] = v;
        }
        return obj;
    }

    /**
     * Save persistent mapping cache to chrome.storage.local or memory store.
     * @param {Object} cacheObj
     * @returns {Promise<void>}
     */
    async saveMappingCache(cacheObj) {
        this._memoryCache.clear();
        Object.entries(cacheObj || {}).forEach(([key, value]) => this._memoryCache.set(key, value));

        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            return new Promise((resolve) => {
                chrome.storage.local.set({ [this.CACHE_KEY]: cacheObj }, () => {
                    resolve();
                });
            });
        }
        return undefined;
    }

    /**
     * Clear all mapping cache (for testing or manual invalidation).
     * @returns {Promise<void>}
     */
    async clearCache() {
        this._memoryCache.clear();
        this._memoryUnmappedQueue.clear();
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            return new Promise((resolve) => {
                chrome.storage.local.remove([this.CACHE_KEY, this.UNMAPPED_QUEUE_KEY], () => resolve());
            });
        }
    }

    /**
     * Remove only the trusted/negative mapping records for one canonical KP ID.
     * This is intentionally narrower than clearCache() so a movie-details
     * recovery cannot invalidate mappings for unrelated films.
     * @param {number|string} kinopoiskId
     * @param {'movie'|'tv'} [mediaType]
     * @returns {Promise<number>} Number of removed mapping records
     */
    async clearMappingForKinopoiskId(kinopoiskId, mediaType = null) {
        const kpId = Number(kinopoiskId);
        if (!kpId || isNaN(kpId) || kpId <= 0) return 0;

        const normalizedType = mediaType ? this.normalizeMediaType(mediaType) : null;
        const cache = await this.getMappingCache();
        let removed = 0;

        for (const [key, entry] of Object.entries(cache)) {
            const entryKpId = Number(entry?.kpId);
            const entryType = entry?.mediaType ? this.normalizeMediaType(entry.mediaType) : null;
            const isReverseKey = key === this.buildReverseKey('movie', kpId) || key === this.buildReverseKey('tv', kpId);
            const matches = entryKpId === kpId && (!normalizedType || entryType === normalizedType);
            if (isReverseKey || matches) {
                delete cache[key];
                removed++;
            }
        }

        if (removed > 0) await this.saveMappingCache(cache);
        return removed;
    }

    /**
     * Get unmapped candidates queue with automatic adult sanitization and section correction.
     * @returns {Promise<Array<Object>>}
     */
    async getUnmappedQueue() {
        const EXPLICIT_TMDB_IDS = new Set([233643, 241002, 220118, 212568, 284780]);
        let rawQueue;
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            rawQueue = await new Promise((resolve) => {
                chrome.storage.local.get([this.UNMAPPED_QUEUE_KEY], (res) => {
                    resolve((res && res[this.UNMAPPED_QUEUE_KEY]) || []);
                });
            });
        } else {
            rawQueue = Array.from(this._memoryUnmappedQueue.values());
        }

        let needsSave = false;
        const sanitized = [];

        for (const item of rawQueue) {
            const tmdbId = Number(item.tmdbId);
            if (item.adult === true || EXPLICIT_TMDB_IDS.has(tmdbId)) {
                needsSave = true;
                continue;
            }
            let section = item.section || 'films';
            // Correct Japanese animation mislabeled as cartoons
            if (item.originalLanguage === 'ja' && (item.genreIds?.includes(16) || section === 'cartoons')) {
                section = 'anime';
                needsSave = true;
            }
            sanitized.push({ ...item, section });
        }

        if (needsSave) {
            this._memoryUnmappedQueue.clear();
            sanitized.forEach(it => this._memoryUnmappedQueue.set(it.key, it));
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                await new Promise(resolve => {
                    chrome.storage.local.set({ [this.UNMAPPED_QUEUE_KEY]: sanitized }, resolve);
                });
            }
        }

        return sanitized;
    }

    /**
     * Record unmapped TMDB candidates into persistent queue with priority metadata.
     * Rejects adult content and explicit erotica candidates.
     * @param {Array<Object>} candidates
     * @returns {Promise<void>}
     */
    async recordUnmappedCandidates(candidates) {
        if (!Array.isArray(candidates) || candidates.length === 0) return;
        const currentQueue = await this.getUnmappedQueue();
        const queueMap = new Map();
        currentQueue.forEach(item => {
            if (item && item.key) queueMap.set(item.key, item);
        });

        const EXPLICIT_TMDB_IDS = new Set([233643, 241002, 220118, 212568, 284780]);
        const now = Date.now();
        for (const c of candidates) {
            // Defensive Adult & Explicit Erotica Gate
            if (c.adult === true) continue;
            const tmdbId = Number(c.tmdbId || c.id);
            if (!tmdbId || isNaN(tmdbId)) continue;
            if (c.mediaType === 'tv' && EXPLICIT_TMDB_IDS.has(tmdbId)) continue;

            const normType = this.normalizeMediaType(c.mediaType || c.type);
            const key = this.buildKey(normType, tmdbId);
            const existing = queueMap.get(key);

            const title = c.title || c.name || c.originalTitle || c.original_name || existing?.title || `TMDB #${tmdbId}`;
            const originalTitle = c.originalTitle || c.alternativeName || c.original_title || c.original_name || existing?.originalTitle || '';
            const year = c.year || (c.releaseDate ? parseInt(c.releaseDate, 10) : (existing?.year || null));
            const posterUrl = c.posterUrl || existing?.posterUrl || '';

            // Best rank preservation across discovery runs
            let tmdbRank = Number(c.tmdbRank) || null;
            let productRank = (Number.isInteger(Number(c.productRank)) && Number(c.productRank) > 0) ? Number(c.productRank) : null;
            let section = c.section || '';

            if (existing?.productRank) {
                if (!productRank || existing.productRank < productRank) {
                    productRank = existing.productRank;
                    section = existing.section || section;
                }
            }
            if (existing?.tmdbRank) {
                if (!tmdbRank || existing.tmdbRank < tmdbRank) {
                    tmdbRank = existing.tmdbRank;
                    if (!productRank) section = existing.section || section;
                }
            }
            if (!section) section = existing?.section || 'films';
            // Semantic correction for Japanese animation
            if (c.originalLanguage === 'ja' && (c.genreIds?.includes(16) || c.type === 'anime')) {
                section = 'anime';
            }

            const popularity = Math.max(Number(c.popularity) || 0, existing?.popularity || 0);
            const voteCount = Math.max(Number(c.voteCount) || 0, existing?.voteCount || 0);
            const timesSeen = (existing?.timesSeen || 0) + 1;
            const discoveredAt = existing?.discoveredAt || now;

            const priority = this.calculatePriority({ productRank, tmdbRank });

            queueMap.set(key, {
                key,
                tmdbId,
                mediaType: normType,
                title,
                originalTitle,
                year,
                posterUrl,
                section,
                tmdbRank,
                productRank,
                popularity,
                voteCount,
                priority,
                manualStatus: existing?.manualStatus || 'needs-review',
                snoozedUntil: existing?.snoozedUntil || null,
                discoveredAt,
                updatedAt: now,
                timesSeen
            });
        }

        // Priority-Aware Eviction:
        // Priority weight: CRITICAL (4) > HIGH (3) > MEDIUM (2) > LOW (1)
        const priorityWeight = { 'CRITICAL': 4, 'HIGH': 3, 'MEDIUM': 2, 'LOW': 1 };

        const sortedQueue = Array.from(queueMap.values()).sort((a, b) => {
            const weightA = priorityWeight[a.priority] || 1;
            const weightB = priorityWeight[b.priority] || 1;
            if (weightA !== weightB) {
                return weightB - weightA; // Higher priority first
            }
            const seenA = a.timesSeen || 1;
            const seenB = b.timesSeen || 1;
            if (seenA !== seenB) {
                return seenB - seenA; // More frequently seen first
            }
            const rankA = (Number.isInteger(a.productRank) && a.productRank > 0)
                ? a.productRank
                : ((Number.isInteger(a.tmdbRank) && a.tmdbRank > 0) ? a.tmdbRank : 999);
            const rankB = (Number.isInteger(b.productRank) && b.productRank > 0)
                ? b.productRank
                : ((Number.isInteger(b.tmdbRank) && b.tmdbRank > 0) ? b.tmdbRank : 999);
            if (rankA !== rankB) {
                return rankA - rankB; // Better rank (lower number) first
            }
            return (b.updatedAt || 0) - (a.updatedAt || 0);
        });

        const updatedList = sortedQueue.slice(0, this.MAX_UNMAPPED_QUEUE);

        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            return new Promise((resolve) => {
                chrome.storage.local.set({ [this.UNMAPPED_QUEUE_KEY]: updatedList }, () => resolve());
            });
        }
        this._memoryUnmappedQueue.clear();
        updatedList.forEach(it => this._memoryUnmappedQueue.set(it.key, it));
    }

    /**
     * Snooze an unmapped candidate in the queue.
     * @param {string} key
     * @param {number} [days=7]
     * @param {'no-kp-page'|'ignored'} [status='no-kp-page']
     * @returns {Promise<boolean>}
     */
    async snoozeUnmappedQueueItem(key, days = 7, status = 'no-kp-page') {
        const queue = await this.getUnmappedQueue();
        const item = queue.find(it => it.key === key);
        if (!item) return false;

        item.manualStatus = status;
        item.snoozedUntil = Date.now() + (days * 24 * 60 * 60 * 1000);
        item.updatedAt = Date.now();

        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await new Promise(res => chrome.storage.local.set({ [this.UNMAPPED_QUEUE_KEY]: queue }, res));
        } else {
            this._memoryUnmappedQueue.set(key, item);
        }
        return true;
    }

    /**
     * Remove an item from the unmapped queue.
     * @param {string} key
     * @returns {Promise<void>}
     */
    async removeUnmappedQueueItem(key) {
        const currentQueue = await this.getUnmappedQueue();
        const filtered = currentQueue.filter(it => it.key !== key);
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            return new Promise((resolve) => {
                chrome.storage.local.set({ [this.UNMAPPED_QUEUE_KEY]: filtered }, () => resolve());
            });
        }
        this._memoryUnmappedQueue.delete(key);
    }

    /**
     * Set a manual TMDB -> Kinopoisk ID mapping.
     * @param {'movie'|'tv'} mediaType
     * @param {number|string} tmdbId
     * @param {number|string} kinopoiskId
     * @param {Object} [meta] - Optional title, year, kpType
     * @returns {Promise<Object>}
     */
    async setManualMapping(mediaType, tmdbId, kinopoiskId, meta = {}) {
        const normType = this.normalizeMediaType(mediaType);
        const numTmdb = Number(tmdbId);
        const numKp = Number(kinopoiskId);

        if (!numTmdb || isNaN(numTmdb) || numTmdb <= 0) {
            throw new Error('Valid positive integer TMDB ID is required');
        }
        if (!numKp || isNaN(numKp) || numKp <= 0) {
            throw new Error('Valid positive integer Kinopoisk ID is required');
        }

        const key = this.buildKey(normType, numTmdb);
        const cache = await this.getMappingCache();
        const now = Date.now();

        const entry = {
            tmdbId: numTmdb,
            mediaType: normType,
            kpId: numKp,
            kpType: meta.kpType || (normType === 'tv' ? 'tv-series' : 'movie'),
            title: meta.title || '',
            year: meta.year || null,
            status: 'resolved',
            identityStatus: 'VERIFIED',
            verificationMethod: 'admin_verified',
            verificationSource: 'manual',
            resolutionSource: 'manual',
            isManual: true,
            resolvedAt: now
        };

        await this._writeSharedManualMapping(entry);
        const sharedEntry = { ...entry, sharedSource: 'firestore' };
        cache[key] = sharedEntry;
        this._writeReverseIndex(cache, sharedEntry);
        await this.saveMappingCache(cache);
        await this.removeUnmappedQueueItem(key);

        // Invalidate Home Discovery cache so Home immediately picks up the new mapping
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.remove(['home_discovery_cache_v10', 'home_discovery_cache_v9']);
        }

        return sharedEntry;
    }

    /**
     * Publish legacy device-local, admin-verified mappings to the shared source.
     * Conflicts stay untouched in Firestore and are returned for manual review.
     * @returns {Promise<{published: number, alreadyShared: number, conflicts: Array, invalid: Array}>}
     */
    async publishLocalManualMappings() {
        const manager = this.getFirebaseManager();
        if (!manager || !this.db) {
            throw new Error('Общая база связей недоступна. Попробуйте позже.');
        }
        if (!this.getCurrentUserId()) {
            throw new Error('Для публикации связей требуется авторизация администратора.');
        }

        const result = { total: 0, published: 0, alreadyShared: 0, conflicts: [], invalid: [] };
        const localMappings = (await this.getManualMappings())
            .filter(mapping => mapping.sharedSource !== 'firestore');
        result.total = localMappings.length;
        const publishedKeys = new Set();

        for (const mapping of localMappings) {
            const tmdbId = Number(mapping.tmdbId);
            const kpId = Number(mapping.kpId);
            if (!tmdbId || !kpId) {
                result.invalid.push(mapping.key || `${mapping.mediaType}:${mapping.tmdbId}`);
                continue;
            }

            const shared = await this._getSharedMapping(mapping.mediaType, tmdbId);
            if (shared) {
                if (Number(shared.kpId) === kpId) {
                    result.alreadyShared++;
                    publishedKeys.add(mapping.key);
                } else {
                    result.conflicts.push({ key: mapping.key, localKpId: kpId, sharedKpId: shared.kpId });
                }
                continue;
            }

            try {
                await this._writeSharedManualMapping(mapping);
                result.published++;
                publishedKeys.add(mapping.key);
            } catch (error) {
                result.conflicts.push({ key: mapping.key, localKpId: kpId, reason: error.message });
            }
        }

        if (publishedKeys.size > 0) {
            const cache = await this.getMappingCache();
            const publishedAt = Date.now();
            for (const key of publishedKeys) {
                if (!cache[key]) continue;
                cache[key] = { ...cache[key], sharedSource: 'firestore', sharedPublishedAt: publishedAt };
                this._writeReverseIndex(cache, cache[key]);
            }
            await this.saveMappingCache(cache);
        }

        return result;
    }

    /**
     * Count old device-local manual records before an administrator publishes them.
     * @returns {Promise<{total: number, invalid: number}>}
     */
    async getLocalManualMappingPublicationPreview() {
        const localMappings = (await this.getManualMappings())
            .filter(mapping => mapping.sharedSource !== 'firestore');
        const invalid = localMappings.filter(mapping => {
            const tmdbId = Number(mapping.tmdbId);
            const kpId = Number(mapping.kpId);
            return !Number.isInteger(tmdbId) || tmdbId <= 0 || !Number.isInteger(kpId) || kpId <= 0;
        }).length;
        return { total: localMappings.length, invalid };
    }

    /**
     * Remove a manual TMDB -> Kinopoisk ID mapping.
     * @param {'movie'|'tv'} mediaType
     * @param {number|string} tmdbId
     * @returns {Promise<boolean>}
     */
    async removeManualMapping(mediaType, tmdbId) {
        const normType = this.normalizeMediaType(mediaType);
        const numTmdb = Number(tmdbId);
        const key = this.buildKey(normType, numTmdb);
        const cache = await this.getMappingCache();

        if (cache[key]) {
            const removed = cache[key];
            if (removed.isManual) {
                await this._deleteSharedManualMapping(normType, numTmdb);
            }
            delete cache[key];
            const reverseKey = this.buildReverseKey(normType, removed.kpId);
            if (Number(cache[reverseKey]?.tmdbId) === numTmdb) {
                delete cache[reverseKey];
            }
            await this.saveMappingCache(cache);
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                chrome.storage.local.remove(['home_discovery_cache_v10', 'home_discovery_cache_v9']);
            }
            return true;
        }
        return false;
    }

    /**
     * Get all active manual mappings.
     * @returns {Promise<Array<Object>>}
     */
    async getManualMappings() {
        const cache = await this.getMappingCache();
        const list = [];
        for (const [key, entry] of Object.entries(cache)) {
            if (entry && entry.isManual && !entry.isReverseIndex) {
                list.push({ key, ...entry });
            }
        }
        return list.sort((a, b) => (b.resolvedAt || 0) - (a.resolvedAt || 0));
    }

    /**
     * Export all active manual mappings as compact JSON string.
     * @returns {Promise<string>}
     */
    async exportManualMappingsJson() {
        const manualList = await this.getManualMappings();
        const exportObj = {};
        for (const item of manualList) {
            exportObj[item.key] = {
                tmdbId: item.tmdbId,
                mediaType: item.mediaType,
                kpId: item.kpId,
                kpType: item.kpType || (item.mediaType === 'tv' ? 'tv-series' : 'movie'),
                title: item.title || '',
                year: item.year || null,
                resolvedAt: item.resolvedAt || Date.now()
            };
        }
        return JSON.stringify(exportObj, null, 2);
    }

    /**
     * Import manual mappings from JSON string with strict validation.
     * @param {string} jsonString
     * @returns {Promise<{ imported: number, errors: Array<string> }>}
     */
    async importManualMappingsJson(jsonString) {
        const result = { imported: 0, errors: [] };
        if (!jsonString || typeof jsonString !== 'string') {
            throw new Error('Invalid JSON string provided');
        }

        let parsed;
        try {
            parsed = JSON.parse(jsonString);
        } catch (e) {
            throw new Error(`JSON parse error: ${e.message}`, { cause: e });
        }

        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('Mapping JSON must be an object of key -> mapping pairs');
        }

        const cache = await this.getMappingCache();
        const unmappedQueue = await this.getUnmappedQueue();
        const unmappedKeys = new Set(unmappedQueue.map(it => it.key));
        let modified = false;

        for (const [key, val] of Object.entries(parsed)) {
            try {
                // Key format: 'movie:123' or 'tv:123'
                const match = key.match(/^(movie|tv):(\d+)$/);
                if (!match) {
                    result.errors.push(`Invalid key format: "${key}" (expected "movie:ID" or "tv:ID")`);
                    continue;
                }

                const mediaType = match[1];
                const tmdbId = Number(match[2]);
                const kpId = Number(typeof val === 'number' ? val : val?.kpId);

                if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
                    result.errors.push(`Invalid TMDB ID in key "${key}"`);
                    continue;
                }
                if (!Number.isInteger(kpId) || kpId <= 0) {
                    result.errors.push(`Invalid Kinopoisk ID for key "${key}": ${kpId}`);
                    continue;
                }

                const kpType = (typeof val === 'object' && val.kpType) ? val.kpType : (mediaType === 'tv' ? 'tv-series' : 'movie');
                const title = (typeof val === 'object' && val.title) ? String(val.title) : '';
                const year = (typeof val === 'object' && val.year) ? Number(val.year) : null;
                const resolvedAt = (typeof val === 'object' && val.resolvedAt) ? Number(val.resolvedAt) : Date.now();

                cache[key] = {
                    tmdbId,
                    mediaType,
                    kpId,
                    kpType,
                    title,
                    year,
                    status: 'resolved',
                    identityStatus: 'VERIFIED',
                    verificationMethod: 'admin_verified',
                    verificationSource: 'manual',
                    resolutionSource: 'manual',
                    isManual: true,
                    resolvedAt
                };
                this._writeReverseIndex(cache, cache[key]);

                if (unmappedKeys.has(key)) {
                    await this.removeUnmappedQueueItem(key);
                }

                modified = true;
                result.imported++;
            } catch (err) {
                result.errors.push(`Error processing "${key}": ${err.message}`);
            }
        }

        if (modified) {
            await this.saveMappingCache(cache);
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                chrome.storage.local.remove(['home_discovery_cache_v10', 'home_discovery_cache_v9']);
            }
        }

        return result;
    }

    /**
     * Batch resolve TMDB candidates to Kinopoisk IDs.
     * @param {Array<{ tmdbId: number|string, mediaType?: string, type?: string, year?: number, release_date?: string }>} items
     * @param {Object} [options] - { signal, kinopoiskService }
     * @returns {Promise<Map<string, { tmdbId: number, mediaType: string, kinopoiskId: number|null, status: 'resolved'|'not-found'|'unresolved', kpType: string|null }>>}
     */
    async resolveBatch(items = [], options = {}) {
        const resultMap = new Map();
        if (!Array.isArray(items) || items.length === 0) {
            return resultMap;
        }

        const isFastRecommendationPath = options.context === 'recommendations' && options.fastPath === true;
        const maxFallbackCandidates = isFastRecommendationPath
            ? Math.max(0, Number(options.maxFallbackCandidates) || 0)
            : Number.POSITIVE_INFINITY;

        const currentYear = new Date().getFullYear();
        const now = Date.now();

        // 1. Normalize and deduplicate inputs by canonical key, preserving full metadata context
        const uniqueItems = new Map();
        for (const raw of items) {
            if (!raw) continue;
            const tmdbId = Number(raw.tmdbId || raw.id);
            if (!tmdbId || isNaN(tmdbId)) continue;

            const mediaType = this.normalizeMediaType(raw.mediaType || raw.type);
            const key = this.buildKey(mediaType, tmdbId);

            let year = Number(raw.year);
            if (!year && raw.releaseDate) {
                const match = String(raw.releaseDate).match(/^\d{4}/);
                if (match) year = Number(match[0]);
            }
            if (!year && raw.first_air_date) {
                const match = String(raw.first_air_date).match(/^\d{4}/);
                if (match) year = Number(match[0]);
            }

            const title = raw.name || raw.title || raw.originalTitle || raw.original_name || `TMDB #${tmdbId}`;
            const originalTitle = raw.originalTitle || raw.original_title || raw.original_name || raw.alternativeName || '';
            const posterUrl = raw.posterUrl || '';
            const section = raw.section || (raw.type === 'anime' ? 'anime' : (raw.type === 'cartoon' ? 'cartoons' : (mediaType === 'tv' ? 'series' : 'films')));
            const tmdbRank = Number(raw.tmdbRank) || null;
            const productRank = (Number.isInteger(Number(raw.productRank)) && Number(raw.productRank) > 0) ? Number(raw.productRank) : null;
            const popularity = Number(raw.popularity) || 0;
            const voteCount = Number(raw.voteCount) || 0;
            const imdbId = raw.imdbId || raw.imdb_id || raw.externalId?.imdb || null;

            if (!uniqueItems.has(key)) {
                uniqueItems.set(key, {
                    key,
                    tmdbId,
                    mediaType,
                    title,
                    originalTitle,
                    year: year || null,
                    posterUrl,
                    section,
                    tmdbRank,
                    productRank,
                    popularity,
                    voteCount,
                    imdbId
                });
            } else {
                // If candidate appears in multiple section contexts within the same batch:
                // Preserve the highest priority / best productRank (lowest number) and tmdbRank
                const existing = uniqueItems.get(key);
                if (productRank && (!existing.productRank || productRank < existing.productRank)) {
                    existing.productRank = productRank;
                    if (section) existing.section = section;
                }
                if (tmdbRank && (!existing.tmdbRank || tmdbRank < existing.tmdbRank)) {
                    existing.tmdbRank = tmdbRank;
                    if (!existing.productRank && section) existing.section = section;
                }
                if (popularity > (existing.popularity || 0)) {
                    existing.popularity = popularity;
                }
                if (voteCount > (existing.voteCount || 0)) {
                    existing.voteCount = voteCount;
                }
                if (!existing.posterUrl && posterUrl) existing.posterUrl = posterUrl;
                if ((!existing.title || existing.title.startsWith('TMDB #')) && title) existing.title = title;
                if (!existing.originalTitle && originalTitle) existing.originalTitle = originalTitle;
                if (!existing.imdbId && imdbId) existing.imdbId = imdbId;
            }
        }

        // 2. Read persistent mapping cache
        const cache = await this.getMappingCache();
        let cacheModified = false;

        const resolvedCount = { cacheHit: 0, negativeHit: 0, unknown: 0 };
        const unknownItems = [];
        const markAsUnresolved = (item) => {
            resultMap.set(item.key, {
                tmdbId: item.tmdbId,
                mediaType: item.mediaType,
                kinopoiskId: null,
                status: 'unresolved',
                kpType: null,
                identityStatus: null,
                verificationMethod: null,
                verificationSource: null
            });
        };
        const markAllAsUnresolved = (candidates) => candidates.forEach(markAsUnresolved);

        // 3. Prefer a shared, admin-verified mapping over a local cache entry.
        // Read in bounded parallel chunks so a large page does not serialize Firestore reads.
        const sharedStates = await this._readSharedMappings([...uniqueItems.values()]);
        for (const [key, item] of uniqueItems.entries()) {
            const sharedState = sharedStates.get(key) || { available: false, mapping: null };
            const sharedMapping = sharedState.mapping;
            if (sharedMapping) {
                const sharedCacheEntry = { ...sharedMapping, sharedSource: 'firestore' };
                cache[key] = sharedCacheEntry;
                this._writeReverseIndex(cache, sharedCacheEntry);
                cacheModified = true;
            } else if (sharedState.available && cache[key]?.isManual && cache[key]?.sharedSource === 'firestore') {
                const staleReverseKey = this.buildReverseKey(cache[key].mediaType, cache[key].kpId);
                delete cache[key];
                if (cache[staleReverseKey]?.sharedSource === 'firestore') {
                    delete cache[staleReverseKey];
                }
                cacheModified = true;
            }
            const entry = sharedMapping || cache[key];

            if (entry && entry.status === 'resolved' && entry.kpId) {
                // Persistent resolved hit
                resolvedCount.cacheHit++;
                globalThis.quotaTracker?.track('IdMappingService.resolveBatch', 'cacheHit');
                if (options.context === 'person-filmography') {
                    globalThis.quotaTracker?.track('PersonDetailsService.kpMatchingPerFilm', 'cacheHit');
                }
                const identityStatus = entry.identityStatus || 'VERIFIED';
                const verificationMethod = entry.isManual ? 'admin_verified' : (entry.verificationMethod || (entry.resolutionSource === 'automatic' ? 'exact_external_tmdb' : 'legacy_resolved'));
                const verificationSource = entry.isManual ? 'manual' : (entry.verificationSource || (entry.resolutionSource === 'automatic' ? 'automatic' : 'system_legacy'));

                resultMap.set(key, {
                    tmdbId: item.tmdbId,
                    mediaType: item.mediaType,
                    kinopoiskId: entry.kpId,
                    status: 'resolved',
                    kpType: entry.kpType || null,
                    identityStatus,
                    verificationMethod,
                    verificationSource
                });
                continue;
            }

            if (entry && entry.status === 'not-found') {
                const retryAfter = Number(entry.retryAfter) || 0;
                if (!options.forceRefresh && now < retryAfter) {
                    // Valid negative cache hit
                    resolvedCount.negativeHit++;
                    globalThis.quotaTracker?.track('IdMappingService.resolveBatch', 'cacheHit');
                    if (options.context === 'person-filmography') {
                        globalThis.quotaTracker?.track('PersonDetailsService.kpMatchingPerFilm', 'cacheHit');
                    }
                    resultMap.set(key, {
                        tmdbId: item.tmdbId,
                        mediaType: item.mediaType,
                        kinopoiskId: null,
                        status: 'not-found',
                        kpType: null,
                        identityStatus: null,
                        verificationMethod: null,
                        verificationSource: null
                    });
                    continue;
                }
                // Negative cache expired or forceRefresh -> treat as unknown and retry
            }

            // Unknown or expired negative
            resolvedCount.unknown++;
            if (options.context === 'person-filmography') {
                globalThis.quotaTracker?.track('PersonDetailsService.kpMatchingPerFilm', 'network');
            }
            unknownItems.push(item);
        }

        console.log(`[IdMapping] candidates: ${uniqueItems.size} | cache hits: ${resolvedCount.cacheHit} | negative hits: ${resolvedCount.negativeHit} | unknown: ${resolvedCount.unknown} | fastPath: ${isFastRecommendationPath} | fallbackBudget: ${Number.isFinite(maxFallbackCandidates) ? maxFallbackCandidates : 'unlimited'}`);

        // 4. Batch query Kinopoisk API for unknown items in chunks of 25
        if (unknownItems.length > 0) {
            const service = options.kinopoiskService || this.kinopoiskService ||
                (typeof window !== 'undefined' && window.firebaseManager?.getKinopoiskService?.()) ||
                (typeof KinopoiskService !== 'undefined' ? new KinopoiskService() : null);
            if (service && !this.kinopoiskService) this.kinopoiskService = service;
            const chunks = [];
            for (let i = 0; i < unknownItems.length; i += this.BATCH_SIZE) {
                chunks.push(unknownItems.slice(i, i + this.BATCH_SIZE));
            }

            console.log(`[IdMapping] API chunks to request: ${chunks.length}`);

            for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
                const chunk = chunks[chunkIndex];
                let batchResult;
                try {
                    batchResult = await this._queryKinopoiskBatch(chunk, service, options.signal, true, options);
                } catch (error) {
                    if (!isQuotaExhaustedError(error)) throw error;

                    const remainingCandidates = chunks.slice(chunkIndex).flat();
                    console.warn(`[IdMapping] Quota exhausted mid-batch. Marking ${remainingCandidates.length} remaining candidates as unresolved and aborting.`);
                    markAllAsUnresolved(remainingCandidates);
                    break;
                }

                if (!batchResult || !batchResult.ok) {
                    // API request failed (HTTP 401/402/403/429/5xx, network error, or rate limit)
                    // CRITICAL INVARIANT: DO NOT write negative cache on temporary/infrastructure failures.
                    console.warn(`[IdMapping] Batch request failed (${batchResult?.errorType || 'unknown'}). Marking ${chunk.length} chunk items as temporary unresolved.`);
                    markAllAsUnresolved(chunk);
                    continue;
                }

                // Batch succeeded (HTTP 200 OK) -> safely resolve matched or record legitimate not-found
                const docsMap = batchResult.docsMap || new Map();
                const resolutionMethodsByKey = batchResult.resolutionMethodsByKey || new Map();
                const failedKeys = new Set(batchResult.failedKeys || []);

                for (const item of chunk) {
                    if (failedKeys.has(item.key)) {
                        resultMap.set(item.key, {
                            tmdbId: item.tmdbId,
                            mediaType: item.mediaType,
                            kinopoiskId: null,
                            status: 'unresolved',
                            kpType: null,
                            identityStatus: null,
                            verificationMethod: null,
                            verificationSource: null
                        });
                        continue;
                    }
                    const matchedDoc = docsMap.get(item.key);
                    const verifiedOverride = !matchedDoc ? this.VERIFIED_MAPPING_OVERRIDES[item.key] : null;

                    if ((matchedDoc && (matchedDoc.id || matchedDoc.kinopoiskId)) || verifiedOverride?.kpId) {
                        const kpId = Number(matchedDoc?.id || matchedDoc?.kinopoiskId || verifiedOverride.kpId);
                        const kpType = matchedDoc?.type || verifiedOverride?.kpType || 'movie';
                        const verificationMethod = matchedDoc
                            ? (resolutionMethodsByKey.get(item.key) || 'exact_external_tmdb')
                            : verifiedOverride.verificationMethod;
                        const resolutionSource = matchedDoc
                            ? (verificationMethod === 'exact_title_year_type' ? 'metadata_fallback' : 'automatic')
                            : verifiedOverride.resolutionSource;
                        const verificationSource = matchedDoc ? 'automatic' : verifiedOverride.verificationSource;

                        cache[item.key] = {
                            tmdbId: item.tmdbId,
                            mediaType: item.mediaType,
                            kpId,
                            kpType,
                            resolvedAt: now,
                            status: 'resolved',
                            identityStatus: 'VERIFIED',
                            verificationMethod,
                            verificationSource,
                            resolutionSource
                        };
                        this._writeReverseIndex(cache, cache[item.key]);
                        cacheModified = true;

                        resultMap.set(item.key, {
                            tmdbId: item.tmdbId,
                            mediaType: item.mediaType,
                            kinopoiskId: kpId,
                            status: 'resolved',
                            kpType,
                            identityStatus: 'VERIFIED',
                            verificationMethod,
                            verificationSource
                        });
                    } else {
                        // Legitimate not-found confirmed by 200 OK response
                        // Adaptive Negative Cache TTL:
                        // Fresh content (>= currentYear - 1): retry after 2 days (48h)
                        // Old content (< currentYear - 1): retry after 14 days
                        const isFresh = item.year ? item.year >= (currentYear - 1) : true;
                        const ttlMs = isFresh
                            ? (2 * 24 * 60 * 60 * 1000)
                            : (14 * 24 * 60 * 60 * 1000);

                        cache[item.key] = {
                            tmdbId: item.tmdbId,
                            mediaType: item.mediaType,
                            kpId: null,
                            attemptedAt: now,
                            retryAfter: now + ttlMs,
                            status: 'not-found'
                        };
                        cacheModified = true;

                        resultMap.set(item.key, {
                            tmdbId: item.tmdbId,
                            mediaType: item.mediaType,
                            kinopoiskId: null,
                            status: 'not-found',
                            kpType: null
                        });
                    }
                }
            }
        }

        // 5. Persist updated cache
        if (cacheModified) {
            await this.saveMappingCache(cache);
        }

        // 6. Record unmapped items to persistent queue for admin review & manual mapping (bypassed if skipQueue is true)
        const skipQueue = Boolean(options?.skipQueue || options?.context === 'recommendations');
        if (!skipQueue) {
            const unmappedForQueue = [];
            for (const item of uniqueItems.values()) {
                const res = resultMap.get(item.key);
                if (res && res.status !== 'resolved') {
                    // Smart Queue Ingestion:
                    // Only enqueue CRITICAL, HIGH priority or items with significant popularity.
                    // Obscure/unrated micro-titles that are legitimately missing on KP do not bloat admin queue.
                    const isPriorityEligible = item.productRank && item.productRank <= 20;
                    const isRankEligible = item.tmdbRank && item.tmdbRank <= 20;
                    const isPopularEligible = (Number(item.popularity) >= 30) || (Number(item.voteCount) >= 50);
                    if (isPriorityEligible || isRankEligible || isPopularEligible) {
                        unmappedForQueue.push(item);
                    }
                }
            }
            if (unmappedForQueue.length > 0) {
                await this.recordUnmappedCandidates(unmappedForQueue).catch(err => {
                    console.warn('[IdMapping] Failed to queue unmapped items:', err?.message);
                });
            }
        }

        return resultMap;
    }

    /**
     * Query Kinopoisk API v1.4 for a batch of unknown items using 3-tier cascade:
     * Tier 1: Exact TMDB ID batch query (externalId.tmdb)
     * Tier 2: IMDb ID bridge batch query (externalId.imdb)
     * Tier 3: Verified metadata search (Title + Year ± 1 + Type)
     * @param {Array<{ key: string, tmdbId: number, mediaType: string, year: number|null, imdbId?: string|null }>} chunk
     * @param {Object} kinopoiskService
     * @param {AbortSignal} [signal]
     * @param {boolean} [allowExactFallback=true]
     * @returns {Promise<{ ok: boolean, docsMap: Map<string, Object>, resolutionMethodsByKey: Map<string, string>, errorType: string|null, status?: number }>}
     */
    async _queryKinopoiskBatch(chunk, kinopoiskService, signal = null, allowExactFallback = true, options = {}) {
        const docsMap = new Map();
        const candidateDocsByKey = new Map();
        const resolutionMethodsByKey = new Map();
        const metadataDocsByKey = new Map();
        const isFastRecommendationPath = options.context === 'recommendations' && options.fastPath === true;
        const maxFallbackCandidates = isFastRecommendationPath
            ? Math.max(0, Number(options.maxFallbackCandidates) || 0)
            : Number.POSITIVE_INFINITY;

        if (!chunk || chunk.length === 0) {
            return { ok: true, docsMap, candidateDocsByKey, resolutionMethodsByKey, metadataDocsByKey, rawDocs: [], errorType: null };
        }

        if (!kinopoiskService) {
            console.warn('[IdMapping] KinopoiskService is not available for batch query');
            return { ok: false, docsMap, resolutionMethodsByKey, metadataDocsByKey, errorType: 'no-service' };
        }

        try {
            const baseUrl = kinopoiskService.baseUrl || (typeof KINOPOISK_CONFIG !== 'undefined' ? KINOPOISK_CONFIG.BASE_URL : 'https://api.poiskkino.dev');
            const endpoint = (typeof KINOPOISK_CONFIG !== 'undefined' && KINOPOISK_CONFIG.ENDPOINTS?.MOVIE) || '/v1.4/movie';
            const url = `${baseUrl}${endpoint}`;

            const params = new URLSearchParams();
            const limit = Math.min(250, chunk.length * 2 + 10);
            params.append('limit', String(limit));
            params.append('selectFields', 'id');
            params.append('selectFields', 'externalId');
            params.append('selectFields', 'type');
            params.append('selectFields', 'isSeries');
            params.append('selectFields', 'movieLength');
            params.append('selectFields', 'seriesLength');
            params.append('selectFields', 'year');

            for (const item of chunk) {
                params.append('externalId.tmdb', String(item.tmdbId));
            }

            const usesKinopoiskRotation = typeof kinopoiskService._fetchWithRotation === 'function';
            const fetchMethod = usesKinopoiskRotation
                ? kinopoiskService._fetchWithRotation.bind(kinopoiskService)
                : fetch;

            let page = 1;
            const allDocs = [];

            while (true) {
                params.set('page', String(page));
                const fullUrl = `${url}?${params.toString()}`;

                let quotaAlreadyExhausted = false;
                if (usesKinopoiskRotation && typeof globalThis?.kinopoiskQuota?.isQuotaExhausted === 'function') {
                    quotaAlreadyExhausted = await globalThis.kinopoiskQuota.isQuotaExhausted();
                }
                if (!quotaAlreadyExhausted) {
                    for (let itemIndex = 0; itemIndex < chunk.length; itemIndex++) {
                        globalThis.quotaTracker?.track('IdMappingService.queryKinopoiskBatch', 'network');
                    }
                }
                const response = await fetchMethod(fullUrl, { method: 'GET', signal });
                if (!response.ok) {
                    console.warn(`[IdMapping] Kinopoisk batch query failed with HTTP ${response.status}`);
                    let errorType = 'http-error';
                    if (response.status === 401 || response.status === 402 || response.status === 403) {
                        errorType = 'quota';
                    } else if (response.status === 429) {
                        errorType = 'rate-limit';
                    } else if (response.status >= 500) {
                        errorType = 'server';
                    }
                    return { ok: false, docsMap, resolutionMethodsByKey, metadataDocsByKey, errorType, status: response.status };
                }

                const data = await response.json();
                const docs = Array.isArray(data.docs) ? data.docs : [];
                allDocs.push(...docs);

                const totalPages = Number(data.pages) || 1;
                const totalDocs = Number(data.total) || allDocs.length;

                if (page >= totalPages || allDocs.length >= totalDocs) {
                    break;
                }
                page++;
            }

            // Group returned docs by numeric externalId.tmdb
            const docsByTmdbId = new Map();
            for (const doc of allDocs) {
                const tmdbVal = doc.externalId?.tmdb;
                if (!tmdbVal) continue;
                const numTmdb = Number(tmdbVal);
                if (!numTmdb || isNaN(numTmdb)) continue;

                if (!docsByTmdbId.has(numTmdb)) {
                    docsByTmdbId.set(numTmdb, []);
                }
                docsByTmdbId.get(numTmdb).push(doc);
            }

            // Match Tier 1 exact TMDB matches
            for (const item of chunk) {
                const candidateDocs = docsByTmdbId.get(item.tmdbId) || [];
                const matched = candidateDocs.find(doc => this.isCompatibleType(item.mediaType, doc.type, doc));

                if (matched) {
                    docsMap.set(item.key, matched);
                    resolutionMethodsByKey.set(item.key, 'exact_external_tmdb');
                }
                candidateDocsByKey.set(item.key, candidateDocs);
            }

            const failedKeys = [];

            // Tier 1.5 Individual retry for partial batch omissions
            if (allowExactFallback && !isFastRecommendationPath && chunk.length > 1) {
                const missingItems = chunk.filter(item => !docsMap.has(item.key));
                for (const item of missingItems) {
                    const exactResult = await this._queryKinopoiskBatch(
                        [item], kinopoiskService, signal, false, options
                    );
                    const exactMatch = exactResult?.docsMap?.get(item.key);
                    if (exactMatch) {
                        docsMap.set(item.key, exactMatch);
                        const method = exactResult.resolutionMethodsByKey?.get(item.key) || 'exact_external_tmdb';
                        resolutionMethodsByKey.set(item.key, method);
                        const metaDoc = exactResult.metadataDocsByKey?.get(item.key);
                        if (metaDoc) metadataDocsByKey.set(item.key, metaDoc);
                    } else if (exactResult && !exactResult.ok) {
                        failedKeys.push(item.key);
                    }
                }
            }

            // Tier 2: IMDb Bridge Resolution
            // For items still missing, query Kinopoisk by externalId.imdb
            const unresolvedItems = chunk.filter(item => !docsMap.has(item.key) && !failedKeys.includes(item.key));
            const itemsForImdbBridge = unresolvedItems.slice(0, maxFallbackCandidates);
            if (itemsForImdbBridge.length > 0) {
                // Pre-fetch IMDb IDs for candidates if not present in item
                let tmdbService = null;
                try {
                    if (typeof window !== 'undefined' && window.firebaseManager?.getTMDBService) {
                        tmdbService = window.firebaseManager.getTMDBService();
                    } else if (typeof TMDBService !== 'undefined') {
                        tmdbService = new TMDBService();
                    } else if (typeof window !== 'undefined' && window.TMDBService) {
                        tmdbService = new window.TMDBService();
                    }
                } catch {
                    tmdbService = null;
                }

                if (tmdbService && typeof tmdbService.getExternalIds === 'function') {
                    const loadExternalId = async (item) => {
                        if (item.imdbId) return;
                        try {
                            const ext = await tmdbService.getExternalIds(item.tmdbId, item.mediaType, { signal });
                            if (ext?.imdb_id) item.imdbId = ext.imdb_id;
                        } catch { /* ignore individual tmdb failure */ }
                    };

                    if (isFastRecommendationPath) {
                        await Promise.all(itemsForImdbBridge.map(loadExternalId));
                    } else {
                        for (const item of itemsForImdbBridge) {
                            await loadExternalId(item);
                        }
                    }
                }

                const itemsWithImdb = itemsForImdbBridge.filter(it => Boolean(it.imdbId));
                if (itemsWithImdb.length > 0) {
                    const imdbResult = await this._queryKinopoiskImdbBatch(itemsWithImdb, kinopoiskService, signal);
                    if (imdbResult && imdbResult.ok && imdbResult.docsMap) {
                        for (const [key, doc] of imdbResult.docsMap.entries()) {
                            if (!docsMap.has(key)) {
                                docsMap.set(key, doc);
                                resolutionMethodsByKey.set(key, 'exact_external_imdb');
                            }
                        }
                    }
                }
            }

            // Tier 3: Metadata Verification (Title + Year ± 1 + Type)
            const metadataCandidates = isFastRecommendationPath
                ? unresolvedItems.slice(0, maxFallbackCandidates)
                : chunk;
            const resolveMetadata = async (item) => {
                if (docsMap.has(item.key) || failedKeys.includes(item.key)) return { item, result: null };
                return {
                    item,
                    result: await this._queryKinopoiskMetadata(item, kinopoiskService, signal)
                };
            };
            const metadataResults = isFastRecommendationPath
                ? await Promise.all(metadataCandidates.map(resolveMetadata))
                : [];

            if (isFastRecommendationPath) {
                for (const { item, result: metadataResult } of metadataResults) {
                    if (!metadataResult) continue;
                    if (!metadataResult.ok) {
                        failedKeys.push(item.key);
                        continue;
                    }
                    if (metadataResult.doc) {
                        docsMap.set(item.key, metadataResult.doc);
                        metadataDocsByKey.set(item.key, metadataResult.doc);
                        resolutionMethodsByKey.set(item.key, 'exact_title_year_type');
                    }
                }
            } else {
                for (const item of metadataCandidates) {
                    if (docsMap.has(item.key) || failedKeys.includes(item.key)) continue;
                    const metadataResult = await this._queryKinopoiskMetadata(item, kinopoiskService, signal);
                    if (!metadataResult.ok) {
                        failedKeys.push(item.key);
                        continue;
                    }
                    if (metadataResult.doc) {
                        docsMap.set(item.key, metadataResult.doc);
                        metadataDocsByKey.set(item.key, metadataResult.doc);
                        resolutionMethodsByKey.set(item.key, 'exact_title_year_type');
                    }
                }
            }

            return {
                ok: true,
                docsMap,
                metadataDocsByKey,
                resolutionMethodsByKey,
                candidateDocsByKey,
                failedKeys,
                rawDocs: allDocs,
                pages: page,
                documentsFound: allDocs.length,
                errorType: null,
                status: 200
            };
        } catch (error) {
            if (error?.name === 'AbortError') {
                return { ok: false, docsMap, resolutionMethodsByKey, metadataDocsByKey, errorType: 'aborted' };
            }
            if (isQuotaExhaustedError(error)) throw error;
            console.error('[IdMapping] Error querying Kinopoisk batch:', error);
            return { ok: false, docsMap, resolutionMethodsByKey, metadataDocsByKey, errorType: 'network', error: error.message };
        }
    }
}

// Export for module and browser environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = IdMappingService;
}
if (typeof window !== 'undefined') {
    window.IdMappingService = IdMappingService;
}
if (typeof globalThis !== 'undefined') {
    globalThis.IdMappingService = IdMappingService;
}
