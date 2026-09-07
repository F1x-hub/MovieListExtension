/**
 * Local MediaPlayer client.
 *
 * The extension never talks to Jackett directly and never receives torrent
 * locators. MediaPlayer keeps provider credentials and resolves short-lived
 * source/session identifiers on the local machine.
 */
(function exposeMediaPlayerService(global) {
    const DEFAULT_BASE_URL = 'http://127.0.0.1:3000';
    const NATIVE_HOST_NAME = 'com.movielist.mediaplayer';
    const DEVICE_TOKEN_KEY = 'mediaplayer_device_token_v1';
    const SETUP_STORAGE_KEY = 'mediaplayer_setup_v1';
    const SETUP_STATUSES = new Set(['disabled', 'path_required', 'verifying', 'ready', 'error']);
    const DEFAULT_TIMEOUT_MS = 12_000;
    const DEFAULT_SOURCE_SEARCH_TIMEOUT_MS = 70_000;
    const DEFAULT_NATIVE_MESSAGE_TIMEOUT_MS = 5_000;
    const FOLDER_SELECTION_TIMEOUT_MS = 120_000;

    class MediaPlayerServiceError extends Error {
        constructor(code, message, status = 0) {
            super(message || code || 'MediaPlayer request failed');
            this.name = 'MediaPlayerServiceError';
            this.code = code || 'mediaplayer_error';
            this.status = Number(status) || 0;
        }
    }

    class MediaPlayerService {
        constructor(options = {}) {
            this.baseUrl = String(options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
            this.nativeHostName = options.nativeHostName || NATIVE_HOST_NAME;
            this.deviceTokenKey = options.deviceTokenKey || DEVICE_TOKEN_KEY;
            this.timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;
            this.sourceSearchTimeoutMs = Number(options.sourceSearchTimeoutMs) > 0
                ? Number(options.sourceSearchTimeoutMs)
                : DEFAULT_SOURCE_SEARCH_TIMEOUT_MS;
            this.nativeMessageTimeoutMs = Number(options.nativeMessageTimeoutMs) > 0
                ? Number(options.nativeMessageTimeoutMs)
                : DEFAULT_NATIVE_MESSAGE_TIMEOUT_MS;
            this.fetchImpl = options.fetchImpl || global.fetch?.bind(global);
            this.chromeApi = options.chromeApi || global.chrome;
            this.serviceHealth = {
                status: 'unknown',
                errorCode: '',
                checkedAt: 0
            };
        }

        getServiceHealth() {
            return { ...this.serviceHealth };
        }

        isServiceUnavailableError(error) {
            return error?.code === 'connection_failed' || error?.code === 'timeout';
        }

        isRequestAbortedError(error) {
            return error?.code === 'request_aborted';
        }

        markServiceAvailable() {
            this.serviceHealth = {
                status: 'healthy',
                errorCode: '',
                checkedAt: Date.now()
            };
        }

        markServiceUnavailable(error) {
            this.serviceHealth = {
                status: 'unavailable',
                errorCode: String(error?.code || 'connection_failed'),
                checkedAt: Date.now()
            };
        }

        async getCapabilities() {
            return this.requestJson('/api/capabilities', { authenticated: false });
        }

        async selectInstallFolder() {
            const response = await this.sendNativeMessage(
                { action: 'select_install_folder' },
                FOLDER_SELECTION_TIMEOUT_MS
            );
            const installPath = String(response?.installPath || response?.path || '').trim();
            if (!installPath) {
                throw new MediaPlayerServiceError(
                    'setup_path_missing',
                    'Native Host не вернул папку установки MediaPlayer.'
                );
            }
            return { installPath };
        }

        async verifyInstallation(installPath) {
            const normalizedPath = String(installPath || '').trim();
            if (!normalizedPath) {
                throw new MediaPlayerServiceError(
                    'setup_path_missing',
                    'Сначала укажите папку установки MediaPlayer.'
                );
            }

            const response = await this.sendNativeMessage({
                action: 'verify_installation',
                installPath: normalizedPath
            });
            const nativeReady = response?.ready === true
                || response?.status === 'ready'
                || response?.installation?.status === 'ready';
            let state = this.normalizeSetupState({
                ...response,
                enabled: true,
                installPath: normalizedPath,
                status: nativeReady ? 'verifying' : 'error',
                checks: response?.checks || response?.installation?.checks,
                errorCode: nativeReady ? '' : (response?.errorCode || 'setup_verification_failed'),
                errorMessage: nativeReady ? '' : (response?.errorMessage || 'Проверка установки MediaPlayer не пройдена.')
            });

            if (nativeReady) {
                try {
                    const capabilities = await this.getCapabilities();
                    const moviesCapability = capabilities?.torrents?.movies;
                    const capabilitiesReady = moviesCapability?.supported !== false
                        && moviesCapability?.status === 'ready';
                    state = this.normalizeSetupState({
                        ...state,
                        status: capabilitiesReady ? 'ready' : 'error',
                        errorCode: capabilitiesReady ? '' : 'torrent_not_configured',
                        errorMessage: capabilitiesReady
                            ? ''
                            : 'MediaPlayer запущен, но торрент-модуль ещё не готов.'
                    });
                } catch (error) {
                    state = this.normalizeSetupState({
                        ...state,
                        status: 'error',
                        errorCode: error?.code || 'connection_failed',
                        errorMessage: error?.message || 'Не удалось проверить MediaPlayer.'
                    });
                }
            }

            await this.writeSetupState(state);
            return state;
        }

        async readSetupState() {
            if (this.chromeApi?.storage?.local?.get) {
                const values = await new Promise((resolve, reject) => {
                    this.chromeApi.storage.local.get(SETUP_STORAGE_KEY, result => {
                        const runtimeError = this.chromeApi.runtime?.lastError;
                        if (runtimeError) reject(new MediaPlayerServiceError('storage_failed', runtimeError.message));
                        else resolve(result || {});
                    });
                });
                return this.normalizeSetupState(values?.[SETUP_STORAGE_KEY]);
            }
            try {
                return this.normalizeSetupState(JSON.parse(global.localStorage?.getItem(SETUP_STORAGE_KEY) || 'null'));
            } catch {
                return this.normalizeSetupState(null);
            }
        }

        async writeSetupState(value) {
            const state = this.normalizeSetupState(value);
            if (this.chromeApi?.storage?.local?.set) {
                await new Promise((resolve, reject) => {
                    this.chromeApi.storage.local.set({ [SETUP_STORAGE_KEY]: state }, () => {
                        const runtimeError = this.chromeApi.runtime?.lastError;
                        if (runtimeError) reject(new MediaPlayerServiceError('storage_failed', runtimeError.message));
                        else resolve();
                    });
                });
                return state;
            }
            try {
                global.localStorage?.setItem(SETUP_STORAGE_KEY, JSON.stringify(state));
            } catch { /* Storage can be unavailable in restricted extension contexts. */ }
            return state;
        }

        async getRuntimeReadiness() {
            const storedState = await this.readSetupState();
            if (!storedState.enabled || storedState.status !== 'ready') return storedState;

            try {
                const capabilities = await this.getCapabilities();
                const moviesCapability = capabilities?.torrents?.movies;
                const ready = moviesCapability?.supported !== false
                    && moviesCapability?.status === 'ready';
                const state = this.normalizeSetupState({
                    ...storedState,
                    status: ready ? 'ready' : 'error',
                    errorCode: ready ? '' : 'torrent_not_configured',
                    errorMessage: ready ? '' : 'MediaPlayer запущен, но торрент-модуль ещё не готов.'
                });
                await this.writeSetupState(state);
                return state;
            } catch (error) {
                const state = this.normalizeSetupState({
                    ...storedState,
                    status: 'error',
                    errorCode: error?.code || 'connection_failed',
                    errorMessage: error?.message || 'Не удалось проверить MediaPlayer.'
                });
                await this.writeSetupState(state);
                return state;
            }
        }

        async getSettings() {
            const response = await this.requestJson('/api/settings', { scope: 'torrent:control' });
            return this.normalizeSettings(response);
        }

        async updateSettings({ torrentRetentionDays } = {}) {
            const days = this.normalizeRetentionDays(torrentRetentionDays);
            if (days === null) {
                throw new MediaPlayerServiceError(
                    'invalid_settings',
                    'Выберите допустимый срок хранения фильмов.'
                );
            }
            const response = await this.requestJson('/api/settings', {
                method: 'PATCH',
                body: { torrentRetentionDays: days },
                scope: 'torrent:control'
            });
            return this.normalizeSettings(response);
        }

        async listDownloads(options = {}) {
            const response = await this.requestJson('/api/downloads', {
                scope: 'torrent:read',
                signal: options.signal
            });
            const downloads = Array.isArray(response) ? response : response?.downloads;
            if (!Array.isArray(downloads)) return [];
            return downloads
                .filter(download => download && typeof download === 'object')
                .map(download => this.normalizeDownload(download));
        }

        async playDownload(downloadId) {
            if (!this.isUuid(downloadId)) {
                throw new MediaPlayerServiceError('download_id_invalid', 'Сохранённая загрузка устарела. Обновите список.');
            }
            const response = await this.requestJson(
                `/api/downloads/${encodeURIComponent(downloadId)}/play`,
                {
                    method: 'POST',
                    body: { clientCapabilities: this.getPlaybackCapabilities() },
                    scope: 'playback'
                }
            );
            return this.normalizePlaybackSession(response);
        }

        async pauseDownload(downloadId) {
            if (!this.isUuid(downloadId)) {
                throw new MediaPlayerServiceError('download_id_invalid', 'Сохранённая загрузка устарела. Обновите список.');
            }
            const response = await this.requestJson(
                `/api/downloads/${encodeURIComponent(downloadId)}/pause`,
                { method: 'POST', scope: 'torrent:control' }
            );
            return this.normalizeDownload(response);
        }

        async resumeDownload(downloadId) {
            if (!this.isUuid(downloadId)) {
                throw new MediaPlayerServiceError('download_id_invalid', 'Сохранённая загрузка устарела. Обновите список.');
            }
            const response = await this.requestJson(
                `/api/downloads/${encodeURIComponent(downloadId)}/resume`,
                { method: 'POST', scope: 'torrent:control' }
            );
            return this.normalizeDownload(response);
        }

        async deleteDownload(downloadId) {
            if (!this.isUuid(downloadId)) {
                throw new MediaPlayerServiceError('download_id_invalid', 'Сохранённая загрузка устарела. Обновите список.');
            }
            await this.requestJson(
                `/api/downloads/${encodeURIComponent(downloadId)}`,
                { method: 'DELETE', scope: 'torrent:control' }
            );
            return true;
        }

        async searchMovieSources({ tmdbId, title, originalTitle, year } = {}) {
            const numericTmdbId = this.normalizePositiveInteger(tmdbId);
            const cleanTitle = String(title || '').trim();
            if (!numericTmdbId) {
                throw new MediaPlayerServiceError('tmdb_id_missing', 'Для этого фильма не найден TMDB ID.');
            }
            if (!cleanTitle) {
                throw new MediaPlayerServiceError('title_missing', 'У фильма отсутствует название для поиска.');
            }

            const params = new URLSearchParams({ title: cleanTitle });
            const cleanOriginalTitle = String(originalTitle || '').trim();
            if (cleanOriginalTitle) params.set('originalTitle', cleanOriginalTitle);
            const numericYear = this.normalizeOptionalInteger(year);
            if (numericYear) params.set('year', String(numericYear));

            const response = await this.requestJson(
                `/api/catalog/movie/${numericTmdbId}/sources?${params.toString()}`,
                { scope: 'torrent:read', timeoutMs: this.sourceSearchTimeoutMs }
            );
            const sources = Array.isArray(response) ? response : response?.sources;
            return Array.isArray(sources) ? sources : [];
        }

        async startMovieSourceSearch({ tmdbId, title, originalTitle, year } = {}) {
            const numericTmdbId = this.normalizePositiveInteger(tmdbId);
            const cleanTitle = String(title || '').trim();
            if (!numericTmdbId) {
                throw new MediaPlayerServiceError('tmdb_id_missing', 'Для этого фильма не найден TMDB ID.');
            }
            if (!cleanTitle) {
                throw new MediaPlayerServiceError('title_missing', 'У фильма отсутствует название для поиска.');
            }

            const params = new URLSearchParams({ title: cleanTitle });
            const cleanOriginalTitle = String(originalTitle || '').trim();
            if (cleanOriginalTitle) params.set('originalTitle', cleanOriginalTitle);
            const numericYear = this.normalizeOptionalInteger(year);
            if (numericYear) params.set('year', String(numericYear));

            const response = await this.requestJson(
                `/api/catalog/movie/${numericTmdbId}/sources/search?${params.toString()}`,
                { method: 'POST', scope: 'torrent' }
            );
            if (!response?.jobId || !this.isUuid(response.jobId)) {
                throw new MediaPlayerServiceError('source_search_invalid', 'MediaPlayer не вернул корректное задание поиска.');
            }
            return response;
        }

        async pollMovieSourceSearch(jobId, cursor = 0, tmdbId) {
            if (!this.isUuid(jobId)) {
                throw new MediaPlayerServiceError('source_search_not_found', 'Задание поиска устарело.');
            }
            const numericTmdbId = this.normalizePositiveInteger(tmdbId);
            if (!numericTmdbId) {
                throw new MediaPlayerServiceError('tmdb_id_missing', 'Для этого фильма не найден TMDB ID.');
            }
            const numericCursor = Number(cursor);
            const safeCursor = Number.isSafeInteger(numericCursor) && numericCursor >= 0 ? numericCursor : 0;
            return this.requestJson(
                `/api/catalog/movie/${numericTmdbId}/sources/search/${encodeURIComponent(jobId)}?cursor=${safeCursor}`,
                { scope: 'torrent' }
            );
        }

        async cancelMovieSourceSearch(jobId, tmdbId) {
            if (!this.isUuid(jobId)) return false;
            const numericTmdbId = this.normalizePositiveInteger(tmdbId);
            if (!numericTmdbId) return false;
            await this.requestJson(
                `/api/catalog/movie/${numericTmdbId}/sources/search/${encodeURIComponent(jobId)}`,
                { method: 'DELETE', scope: 'torrent' }
            );
            return true;
        }

        async searchMovieSourcesIncrementally(args = {}, options = {}) {
            const pollIntervalMs = Number.isFinite(Number(options.pollIntervalMs))
                ? Math.max(0, Number(options.pollIntervalMs))
                : 350;
            const started = await this.startMovieSourceSearch(args);
            const jobId = started.jobId;
            const numericTmdbId = this.normalizePositiveInteger(args?.tmdbId);
            let cursor = 0;
            const allSources = [];
            options.onStart?.(started);

            try {
                while (true) {
                    const state = await this.pollMovieSourceSearch(jobId, cursor, numericTmdbId);
                    if (!state || !['running', 'completed', 'failed', 'cancelled'].includes(state.status)) {
                        throw new MediaPlayerServiceError('source_search_invalid', 'MediaPlayer вернул некорректное состояние поиска.');
                    }
                    const batch = Array.isArray(state?.sources) ? state.sources : [];
                    allSources.push(...batch);
                    const snapshot = { ...state, sources: allSources };
                    options.onBatch?.(batch, snapshot);
                    cursor = Number.isSafeInteger(Number(state?.nextCursor))
                        ? Math.max(cursor, Number(state.nextCursor))
                        : cursor + batch.length;

                    const terminal = ['completed', 'failed', 'cancelled'].includes(state?.status)
                        && state?.hasMore !== true;
                    if (terminal) {
                        if (state.status === 'failed') {
                            throw new MediaPlayerServiceError('sources_unavailable', 'Индексеры MediaPlayer временно недоступны.');
                        }
                        if (state.status === 'cancelled') {
                            throw new MediaPlayerServiceError('source_search_cancelled', 'Поиск торрент-раздач отменён.');
                        }
                        return snapshot;
                    }
                    if (pollIntervalMs > 0) await this.delay(pollIntervalMs);
                }
            } catch (error) {
                await this.cancelMovieSourceSearch(jobId, numericTmdbId).catch(() => undefined);
                throw error;
            }
        }

        async createPlaybackSession({ sourceId, tmdbId, title, year } = {}) {
            const numericTmdbId = this.normalizePositiveInteger(tmdbId);
            if (!this.isUuid(sourceId)) {
                throw new MediaPlayerServiceError('source_id_invalid', 'Раздача устарела. Повторите поиск.');
            }
            if (!numericTmdbId) {
                throw new MediaPlayerServiceError('tmdb_id_missing', 'Для этого фильма не найден TMDB ID.');
            }

            const body = {
                sourceId,
                mediaType: 'movie',
                tmdbId: numericTmdbId,
                clientCapabilities: this.getPlaybackCapabilities()
            };
            const cleanTitle = String(title || '').trim();
            if (cleanTitle) body.title = cleanTitle;
            const numericYear = this.normalizeOptionalInteger(year);
            if (numericYear) body.year = numericYear;

            const response = await this.requestJson('/api/playback/sessions', {
                method: 'POST',
                body,
                scope: 'playback'
            });
            if (!response?.sessionId) {
                throw new MediaPlayerServiceError('playback_session_invalid', 'MediaPlayer не вернул playback-сессию.');
            }

            return this.normalizePlaybackSession(response);
        }

        async getPlaybackProgress(progressUrl, options = {}) {
            const url = this.normalizeServiceUrl(progressUrl);
            const response = await this.requestAbsoluteJson(url, options);
            return response?.progress || response || null;
        }

        getPlaybackCapabilities() {
            const mediaSource = globalThis.MediaSource;
            if (!mediaSource || typeof mediaSource.isTypeSupported !== 'function') {
                return {
                    mp4H264Aac: true,
                    webmVp9Opus: true,
                    hlsH264: true,
                    hlsHevc: true,
                    hlsVp9: true,
                    hlsAv1: false
                };
            }
            const isSupported = codec => {
                try {
                    return Boolean(mediaSource.isTypeSupported(codec));
                } catch {
                    return false;
                }
            };
            return {
                mp4H264Aac: isSupported('video/mp4; codecs="avc1.42E01E,mp4a.40.2"'),
                webmVp9Opus: isSupported('video/webm; codecs="vp09.00.10.08,opus"'),
                hlsH264: isSupported('video/mp4; codecs="avc1.42E01E,mp4a.40.2"'),
                hlsHevc: isSupported('video/mp4; codecs="hvc1.1.6.L93.B0,mp4a.40.2"')
                    || isSupported('video/mp4; codecs="hev1.1.6.L93.B0,mp4a.40.2"'),
                hlsVp9: isSupported('video/mp4; codecs="vp09.00.10.08,mp4a.40.2"'),
                hlsAv1: isSupported('video/mp4; codecs="av01.0.12M.10,mp4a.40.2"')
                    || isSupported('video/mp4; codecs="av01.0.08M.08,mp4a.40.2"')
            };
        }

        async revokePlaybackSession(sessionId) {
            if (!this.isUuid(sessionId)) return false;
            await this.requestJson(`/api/playback/sessions/${encodeURIComponent(sessionId)}`, {
                method: 'DELETE',
                scope: 'playback'
            });
            return true;
        }

        async requestJson(path, options = {}) {
            const {
                method = 'GET',
                body,
                authenticated = true,
                scope = null,
                retryUnauthorized = true,
                timeoutMs = this.timeoutMs,
                signal
            } = options;

            if (!this.fetchImpl) {
                throw new MediaPlayerServiceError('fetch_unavailable', 'В этой странице недоступен сетевой клиент.');
            }

            let token = authenticated ? await this.getDeviceToken() : null;
            const headers = { Accept: 'application/json' };
            if (body !== undefined) headers['Content-Type'] = 'application/json';
            if (token) headers.Authorization = `Bearer ${token}`;

            const response = await this.fetchWithTimeout(this.normalizeServiceUrl(path), {
                method,
                headers,
                body: body === undefined ? undefined : JSON.stringify(body),
                signal
            }, timeoutMs);

            if (response.status === 401 && authenticated && retryUnauthorized) {
                await this.clearDeviceToken();
                token = await this.getDeviceToken(true);
                headers.Authorization = `Bearer ${token}`;
                const retryResponse = await this.fetchWithTimeout(this.normalizeServiceUrl(path), {
                    method,
                    headers,
                    body: body === undefined ? undefined : JSON.stringify(body),
                    signal
                }, timeoutMs);
                return this.readJsonResponse(retryResponse, scope);
            }

            return this.readJsonResponse(response, scope);
        }

        async requestAbsoluteJson(url, options = {}) {
            if (!this.fetchImpl) {
                throw new MediaPlayerServiceError('fetch_unavailable', 'В этой странице недоступен сетевой клиент.');
            }
            const response = await this.fetchWithTimeout(url, {
                headers: { Accept: 'application/json' },
                signal: options.signal
            }, options.timeoutMs ?? this.timeoutMs);
            return this.readJsonResponse(response);
        }

        async readJsonResponse(response, scope = null) {
            let payload = null;
            try {
                payload = await response.json();
            } catch {
                // Error responses are allowed to omit JSON; the status still carries the failure.
            }

            if (!response.ok) {
                const code = payload?.error || (response.status === 401 ? 'unauthorized' : 'request_failed');
                const message = this.getErrorMessage(code, scope);
                throw new MediaPlayerServiceError(code, message, response.status);
            }
            return payload;
        }

        async fetchWithTimeout(url, options = {}, timeoutMs = this.timeoutMs) {
            const controller = new AbortController();
            const externalSignal = options.signal;
            const abortFromExternal = () => controller.abort();
            if (externalSignal?.aborted) {
                controller.abort();
            } else {
                externalSignal?.addEventListener('abort', abortFromExternal, { once: true });
            }
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const response = await this.fetchImpl(url, { ...options, signal: controller.signal });
                this.markServiceAvailable();
                return response;
            } catch (error) {
                if (externalSignal?.aborted) {
                    throw new MediaPlayerServiceError('request_aborted', 'Запрос к MediaPlayer отменён.');
                }
                if (error?.name === 'AbortError') {
                    this.markServiceUnavailable({ code: 'timeout' });
                    throw new MediaPlayerServiceError('timeout', 'MediaPlayer не ответил вовремя.');
                }
                this.markServiceUnavailable({ code: 'connection_failed' });
                throw new MediaPlayerServiceError('connection_failed', 'Не удалось подключиться к локальному MediaPlayer.');
            } finally {
                clearTimeout(timer);
                externalSignal?.removeEventListener('abort', abortFromExternal);
            }
        }

        async getDeviceToken(force = false) {
            if (!force) {
                const cachedToken = await this.readStoredToken();
                if (cachedToken) return cachedToken;
            }

            const response = await this.sendNativeMessage({ action: 'pair' });
            const token = typeof response?.accessToken === 'string' ? response.accessToken.trim() : '';
            if (!token) {
                throw new MediaPlayerServiceError('pairing_failed', 'Native Host не вернул device-токен.');
            }
            await this.writeStoredToken(token);
            return token;
        }

        async clearDeviceToken() {
            if (this.chromeApi?.storage?.local?.remove) {
                await new Promise(resolve => this.chromeApi.storage.local.remove(this.deviceTokenKey, resolve));
                return;
            }
            try {
                global.localStorage?.removeItem(this.deviceTokenKey);
            } catch { /* Storage can be unavailable in restricted extension contexts. */ }
        }

        async readStoredToken() {
            if (this.chromeApi?.storage?.local?.get) {
                const values = await new Promise((resolve, reject) => {
                    this.chromeApi.storage.local.get(this.deviceTokenKey, result => {
                        const runtimeError = this.chromeApi.runtime?.lastError;
                        if (runtimeError) reject(new MediaPlayerServiceError('storage_failed', runtimeError.message));
                        else resolve(result || {});
                    });
                });
                return typeof values?.[this.deviceTokenKey] === 'string'
                    ? values[this.deviceTokenKey].trim()
                    : '';
            }
            try {
                return String(global.localStorage?.getItem(this.deviceTokenKey) || '').trim();
            } catch {
                return '';
            }
        }

        async writeStoredToken(token) {
            if (this.chromeApi?.storage?.local?.set) {
                await new Promise((resolve, reject) => {
                    this.chromeApi.storage.local.set({ [this.deviceTokenKey]: token }, () => {
                        const runtimeError = this.chromeApi.runtime?.lastError;
                        if (runtimeError) reject(new MediaPlayerServiceError('storage_failed', runtimeError.message));
                        else resolve();
                    });
                });
                return;
            }
            try {
                global.localStorage?.setItem(this.deviceTokenKey, token);
            } catch { /* Storage can be unavailable in restricted extension contexts. */ }
        }

        sendNativeMessage(message, timeoutMs = this.nativeMessageTimeoutMs) {
            if (!this.chromeApi?.runtime?.sendNativeMessage) {
                return Promise.reject(new MediaPlayerServiceError(
                    'native_host_unavailable',
                    'Native Host MediaPlayer не установлен или недоступен.'
                ));
            }

            return new Promise((resolve, reject) => {
                let settled = false;
                const timer = setTimeout(() => {
                    settled = true;
                    reject(new MediaPlayerServiceError(
                        'native_host_timeout',
                        'Native Host MediaPlayer не ответил вовремя.'
                    ));
                }, timeoutMs);
                const finish = (callback, value) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    callback(value);
                };

                try {
                    this.chromeApi.runtime.sendNativeMessage(this.nativeHostName, message, response => {
                        const runtimeError = this.chromeApi.runtime.lastError;
                        if (runtimeError) {
                            finish(reject, new MediaPlayerServiceError(
                                'native_host_unavailable',
                                runtimeError.message
                            ));
                            return;
                        }
                        if (response?.error) {
                            const code = String(response.error);
                            finish(reject, new MediaPlayerServiceError(code, this.getErrorMessage(code)));
                            return;
                        }
                        finish(resolve, response || {});
                    });
                } catch (error) {
                    finish(reject, new MediaPlayerServiceError(
                        'native_host_unavailable',
                        error?.message || 'Native Host MediaPlayer недоступен.'
                    ));
                }
            });
        }

        normalizeServiceUrl(value) {
            if (typeof value !== 'string' || !value.trim()) {
                throw new MediaPlayerServiceError('service_url_missing', 'MediaPlayer не вернул ссылку на ресурс.');
            }
            const url = new URL(value, `${this.baseUrl}/`);
            const base = new URL(`${this.baseUrl}/`);
            if (url.origin !== base.origin) {
                throw new MediaPlayerServiceError('service_url_invalid', 'MediaPlayer вернул ссылку за пределы localhost.');
            }
            return url.toString();
        }

        normalizePlaybackSession(response) {
            if (!response?.sessionId || !this.isUuid(response.sessionId)) {
                throw new MediaPlayerServiceError('playback_session_invalid', 'MediaPlayer не вернул playback-сессию.');
            }
            return {
                ...response,
                downloadId: this.isUuid(response.downloadId) ? response.downloadId : null,
                streamUrl: this.normalizeServiceUrl(response.streamUrl),
                hlsUrl: this.normalizeServiceUrl(response.hlsUrl),
                progressUrl: this.normalizeServiceUrl(response.progressUrl)
            };
        }

        normalizeDownload(value) {
            const id = typeof value?.id === 'string' ? value.id : '';
            return {
                id,
                mediaType: String(value?.mediaType || 'movie'),
                tmdbId: Number(value?.tmdbId) || null,
                title: String(value?.title || 'Без названия'),
                provider: String(value?.provider || 'MediaPlayer'),
                quality: value?.quality ? String(value.quality) : null,
                sizeBytes: Number(value?.sizeBytes) || 0,
                status: String(value?.status || 'error'),
                downloadedBytes: Number(value?.downloadedBytes) || 0,
                totalBytes: Number(value?.totalBytes) || 0,
                remainingBytes: Number(value?.remainingBytes) || 0,
                progress: Number(value?.progress) || 0,
                downloadSpeedBytesPerSecond: Number(value?.downloadSpeedBytesPerSecond) || 0,
                uploadSpeedBytesPerSecond: Number(value?.uploadSpeedBytesPerSecond) || 0,
                peers: Number(value?.peers) || 0,
                timeRemainingSeconds: Number.isFinite(Number(value?.timeRemainingSeconds))
                    ? Number(value.timeRemainingSeconds)
                    : null,
                playable: value?.playable === true,
                errorMessage: value?.errorMessage ? String(value.errorMessage) : null,
                createdAt: typeof value?.createdAt === 'string' ? value.createdAt : null,
                updatedAt: typeof value?.updatedAt === 'string' ? value.updatedAt : null,
                completedAt: typeof value?.completedAt === 'string' ? value.completedAt : null
            };
        }

        normalizePositiveInteger(value) {
            const number = Number(value);
            return Number.isSafeInteger(number) && number > 0 ? number : null;
        }

        normalizeOptionalInteger(value) {
            const number = Number(value);
            return Number.isSafeInteger(number) && number > 0 ? number : null;
        }

        normalizeRetentionDays(value) {
            const number = Number(value);
            return [0, 1, 3, 7, 14, 30].includes(number) ? number : null;
        }

        normalizeSettings(value) {
            const days = this.normalizeRetentionDays(value?.torrentRetentionDays);
            if (days === null) {
                throw new MediaPlayerServiceError(
                    'settings_invalid',
                    'MediaPlayer вернул некорректные настройки.'
                );
            }
            const options = Array.isArray(value?.options)
                ? value.options.map(option => this.normalizeRetentionDays(option)).filter(option => option !== null)
                : [0, 1, 3, 7, 14, 30];
            return {
                ...value,
                torrentRetentionDays: days,
                options: options.length ? options : [0, 1, 3, 7, 14, 30]
            };
        }

        normalizeSetupState(value) {
            const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
            const enabled = source.enabled === true;
            const requestedStatus = String(source.status || '').trim();
            const status = !enabled
                ? 'disabled'
                : SETUP_STATUSES.has(requestedStatus)
                    ? requestedStatus
                    : 'path_required';
            const checks = Array.isArray(source.checks)
                ? source.checks
                    .filter(check => check && typeof check === 'object')
                    .map(check => ({
                        id: String(check.id || check.name || 'check'),
                        label: String(check.label || check.name || check.id || 'Проверка'),
                        status: String(check.status || 'pending'),
                        message: check.message ? String(check.message) : ''
                    }))
                : [];
            return {
                enabled,
                status,
                installPath: String(source.installPath || '').trim(),
                version: source.version ? String(source.version) : '',
                verifiedAt: source.verifiedAt ? String(source.verifiedAt) : '',
                checks,
                errorCode: source.errorCode ? String(source.errorCode) : '',
                errorMessage: source.errorMessage ? String(source.errorMessage) : ''
            };
        }

        isUuid(value) {
            return typeof value === 'string'
                && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
        }

        getErrorMessage(code, scope = null) {
            const messages = {
                native_host_unavailable: 'Native Host MediaPlayer не установлен или не запущен.',
                pairing_unavailable: 'MediaPlayer ещё не готов к подключению расширения.',
                pairing_failed: 'Не удалось подключить расширение к MediaPlayer.',
                unknown_action: 'Установленный Native Host не поддерживает эту операцию. Обновите MediaPlayer.',
                folder_selection_cancelled: 'Выбор папки установки отменён.',
                folder_selection_failed: 'Не удалось открыть системный выбор папки установки MediaPlayer.',
                unauthorized: 'Расширение потеряло подключение к MediaPlayer.',
                forbidden: scope === 'playback'
                    ? 'MediaPlayer не разрешил запуск playback-сессии.'
                    : scope === 'torrent:control'
                        ? 'MediaPlayer не разрешил изменение настроек.'
                        : 'MediaPlayer не разрешил поиск раздач.',
                invalid_settings: 'Выберите допустимый срок хранения фильмов.',
                settings_invalid: 'MediaPlayer вернул некорректные настройки.',
                download_retention_in_progress: 'Этот файл сейчас удаляется. Повторите позже.',
                download_control_unavailable: 'Пауза или продолжение загрузки сейчас недоступны. Повторите позже.',
                torrent_not_configured: 'Торрент-провайдеры MediaPlayer ещё не настроены.',
                sources_unavailable: 'Индексеры MediaPlayer временно недоступны.',
                source_search_invalid: 'MediaPlayer не вернул корректное задание поиска.',
                source_search_not_found: 'Задание поиска устарело. Повторите поиск.',
                source_search_limit: 'Слишком много одновременных поисков раздач.',
                source_search_cancelled: 'Поиск торрент-раздач отменён.',
                source_not_found: 'Раздача устарела. Повторите поиск.',
                source_mismatch: 'Раздача не относится к выбранному фильму.',
                playback_asset_unavailable: 'Файл ещё не готов для просмотра.',
                engine_closed: 'Торрент-движок MediaPlayer остановлен.',
                connection_failed: 'Не удалось подключиться к локальному MediaPlayer.',
                timeout: 'MediaPlayer не ответил вовремя.',
                native_host_timeout: 'Native Host MediaPlayer не ответил вовремя.'
            };
            return messages[code] || 'MediaPlayer не смог выполнить операцию.';
        }

        delay(milliseconds) {
            return new Promise(resolve => setTimeout(resolve, milliseconds));
        }
    }

    MediaPlayerService.SETUP_STORAGE_KEY = SETUP_STORAGE_KEY;
    MediaPlayerService.SETUP_STATUSES = SETUP_STATUSES;
    global.MediaPlayerService = MediaPlayerService;
    global.MediaPlayerServiceError = MediaPlayerServiceError;
})(typeof window !== 'undefined' ? window : globalThis);
