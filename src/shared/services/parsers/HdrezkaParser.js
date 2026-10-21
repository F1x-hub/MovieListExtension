/** Movie-only, session-backed HDRezka source. Never cache signed stream URLs. */
class HdrezkaParser extends BaseParserService {
    constructor({ service } = {}) {
        super({ id: 'hdrezka', name: 'HDRezka', baseUrl: 'https://hdrezka.co', cacheTTL: 60000 });
        this.service = service || new HdrezkaSessionService();
        this.accessRequired = false;
        this.preferredTranslations = new Map();
        this.disposers = new Set();
        if (typeof window !== 'undefined') window.addEventListener('pagehide', () => {
            for (const dispose of [...this.disposers]) dispose();
            this.service.dispose?.();
        });
    }
    getPlayerType() { return 'custom'; }
    supportsMedia(movie, mediaType) {
        return !movie?.isSeries && !this.isSeriesMediaType(mediaType || movie?.type) && !movie?.seasons?.length
            && !movie?.seasonsInfo?.length && !(Number(movie?.totalSeasons) > 0) && movie?.first_air_date === undefined;
    }
    supportsType(type) { return !this.isSeriesMediaType(type); }
    isSearchResultCompatible(result, mediaType) { return !result?.isSeries && this.supportsType(mediaType); }
    supportsSourceType(source) { return Boolean(source?.parserId === this.id && HdrezkaProtocol.pageUrl(source.url)); }
    async search(title, year, options = {}) {
        if (!this.supportsType(options.mediaType)) return null;
        try {
            const data = await this.service.request('search', { query: title });
            this.accessRequired = false;
            const wanted = Number(year);
            const match = data.results?.find(item => !item.isSeries && HdrezkaProtocol.pageUrl(item.url)
                && BaseParserService.compactTitle(item.title) === BaseParserService.compactTitle(title)
                && (!Number.isFinite(wanted) || wanted < 1800 || Number(item.year) === wanted));
            return match ? { ...match, parserId: this.id, titleVerified: true } : null;
        } catch (failure) {
            this.accessRequired = failure?.code === 'HDREZKA_ACCESS_REQUIRED';
            throw failure;
        }
    }
    async getVideoSources(result) {
        const url = HdrezkaProtocol.pageUrl(typeof result === 'string' ? result : result?.url);
        if (!url) return [];
        let data;
        try { data = await this.service.request('details', { url }); }
        catch (failure) { this.accessRequired = failure?.code === 'HDREZKA_ACCESS_REQUIRED'; throw failure; }
        this.accessRequired = false;
        return [{ name: this.name, parserId: this.id, url, type: 'custom', metadata: {
            movieId: String(data.movieId), kinopoiskId: data.kinopoiskId || null,
            translations: data.translations, activeTranslationId: data.activeTranslationId
        } }];
    }
    setPreferredTranslation(contextId, translationId, movieId) {
        if (!/^[1-9]\d*$/.test(String(contextId)) || !/^[1-9]\d*$/.test(String(translationId))) return;
        this.preferredTranslations.set(String(contextId), String(translationId));
        if (movieId) void window.WatchPreferences?.patch(movieId, { providers: { hdrezka: { translationId: String(translationId) } } });
    }
    async changeTranslation(container, translationId) {
        return await container._hdrezkaChangeTranslation?.(String(translationId)) || false;
    }
    async renderPlayer(container, sources, options = {}) {
        container._hdrezkaDispose?.();
        const source = sources?.find(item => this.supportsSourceType(item));
        if (!source) return false;
        const metadata = source.metadata;
        if (metadata?.kinopoiskId && options.movieId && String(metadata.kinopoiskId) !== String(options.movieId)) throw new Error('HDREZKA_IDENTITY_MISMATCH');
        let disposed = false;
        let version = 0;
        let transport = null;
        let watcher = null;
        let observer = null;
        let refreshed = false;
        let details = null;
        let phase = 'preferences';
        const active = () => !disposed && (!options.isRequestCurrent || options.isRequestCurrent());
        const video = document.createElement('video');
        video.className = 'player-surface__media';
        video.controls = video.playsInline = true;
        video.dataset.playerProvider = this.id;
        video.dataset.progressOwner = 'canonical';
        video.dataset.playerSourceActive = 'true';
        if (options.requestId != null) video.dataset.playerRequestId = String(options.requestId);
        const bridge = document.createElement('div');
        bridge.hidden = true;
        bridge.dataset.playerQualitySource = this.id;
        const voiceBridge = document.createElement('div');
        voiceBridge.hidden = true;
        voiceBridge.dataset.playerVoiceoverSource = this.id;
        const dispose = () => {
            if (disposed) return;
            disposed = true; version += 1;
            transport?.destroy(); watcher?.cancel?.(); observer?.disconnect();
            video.pause();
            if (container._hlsInstance === transport) container._hlsInstance = null;
            video._movieExtensionHls = null;
            video.remove(); bridge.remove(); voiceBridge.remove();
            this.disposers.delete(dispose);
            if (container._hdrezkaDispose === dispose) {
                delete container._hdrezkaDispose;
                delete container._hdrezkaChangeTranslation;
                delete container.__providerDubState;
            }
        };
        container.replaceChildren(video, bridge, voiceBridge);
        delete container.dataset.hdrezkaFailure;
        container._hdrezkaDispose = dispose;
        this.disposers.add(dispose);
        const fail = failure => {
            if (!active()) return;
            const messages = {
                HDREZKA_ACCESS_REQUIRED: 'HDRezka требует подтверждения доступа. Откройте сайт, подтвердите доступ и оставьте вкладку открытой, затем повторите поиск.',
                HDREZKA_PREMIUM_REQUIRED: 'HDRezka требует Premium для этой озвучки. Выберите доступный перевод на сайте и повторите запуск.',
                HDREZKA_NO_TRANSLATIONS: 'Для этого фильма HDRezka не предложила доступных обычных озвучек.',
                HDREZKA_NO_STREAMS: 'HDRezka не вернула доступный HLS-поток для этого фильма. Повторите запуск позже.',
                HDREZKA_STREAM_UNAVAILABLE: 'HDRezka не выдала поток для выбранной озвучки. Повторите запуск позже.',
                HDREZKA_IDENTITY_MISMATCH: 'HDRezka вернула другой фильм. Запуск остановлен.',
                HDREZKA_INVALID_STREAM: 'HDRezka вернула неподдерживаемый адрес потока.',
                HDREZKA_STREAM_EXPIRED: 'Срок действия ссылки HDRezka истёк. Повторите запуск.',
                HDREZKA_UNAVAILABLE: 'Не удалось получить ответ HDRezka. Повторите запуск позже.',
                HDREZKA_INVALID_RESPONSE: 'HDRezka вернула неожиданный ответ вместо данных потока.',
                HDREZKA_HLS_UNAVAILABLE: 'Не удалось загрузить HLS-плеер HDRezka в этом браузере.',
                HDREZKA_HLS_FAILED: 'Браузер не смог воспроизвести HLS-поток HDRezka. Повторите запуск или выберите другой источник.',
                HDREZKA_RESOLVER_SETUP_FAILED: 'Не удалось подготовить обработчик потока HDRezka.',
                HDREZKA_RESOLVE_FAILED: 'Видеосервер HDRezka не ответил вовремя. Повторите запуск.',
                HDREZKA_RESOLVER_RESPONSE_FAILED: 'Не удалось получить HLS-поток с видеосервера HDRezka. Повторите запуск позже.',
                HDREZKA_RESOLVER_DISCONNECTED: 'Подготовка потока HDRezka прервалась. Повторите запуск.'
            };
            const reason = failure?.code || failure?.message;
            const code = Object.hasOwn(messages, reason) ? reason : 'HDREZKA_PLAYBACK_FAILED';
            this.accessRequired = code === 'HDREZKA_ACCESS_REQUIRED';
            const diagnostic = { phase, code };
            if (phase === 'cdn-resolve') {
                const cdn = window.HdrezkaProtocol.resolverFailure(failure);
                delete cdn.code;
                Object.assign(diagnostic, cdn);
            }
            if (['policy', 'source-rejected', 'network-retries-exhausted', 'media-recovery-exhausted', 'fatal-error'].includes(failure?.hlsReason)) {
                diagnostic.hlsReason = failure.hlsReason;
            }
            if (Number.isInteger(failure?.status) && failure.status >= 400 && failure.status <= 599) diagnostic.status = failure.status;
            container.dataset.hdrezkaFailure = code;
            container.dataset.hdrezkaPhase = phase;
            console.warn('[HDRezka] Playback failed', JSON.stringify(diagnostic));
            window.PlayerSourceLifecycle?.setState(container, 'error', {
                message: messages[code] || 'Не удалось запустить поток HDRezka. Повторите запуск или выберите другой источник.', onRetry: options.onRetry
            });
            options.onLifecycleState?.('error', { reason: this.accessRequired ? 'access-required' : 'provider-unavailable', parserId: this.id });
        };
        try {
            const prefs = options.movieId ? await window.WatchPreferences?.get(options.movieId) : null;
            if (!active()) { dispose(); return false; }
            const translationId = this.preferredTranslations.get(String(metadata?.movieId)) || prefs?.providers?.hdrezka?.translationId || metadata?.activeTranslationId;
            phase = 'streams';
            details = await this.service.request('streams', { url: source.url, translationId });
            if (!active()) { dispose(); return false; }
            this.accessRequired = false;
            const verifyDetails = value => {
                if (String(value.movieId) !== String(metadata?.movieId)
                    || value.kinopoiskId && options.movieId && String(value.kinopoiskId) !== String(options.movieId)) throw new Error('HDREZKA_IDENTITY_MISMATCH');
            };
            verifyDetails(details);
            const persist = height => {
                if (options.movieId) void window.WatchPreferences?.patch(options.movieId, { providers: { hdrezka: {
                    translationId: details.activeTranslationId, qualityHeight: height
                } } });
            };
            const load = async (height, position, paused) => {
                const request = ++version;
                phase = 'streams';
                const variants = HdrezkaProtocol.qualities(details.response);
                const chosen = variants.find(item => item.height === height) || variants.find(item => item.height === 480) || variants[0];
                if (!chosen) throw new Error('HDREZKA_NO_STREAMS');
                let url;
                phase = 'cdn-resolve';
                try { url = await this.service.resolve(chosen.url); }
                catch (failure) {
                    if (!active() || request !== version) return false;
                    if (failure?.code !== 'HDREZKA_STREAM_EXPIRED' || refreshed) throw failure;
                    refreshed = true;
                    phase = 'streams';
                    const next = await this.service.request('streams', { url: source.url, translationId: details.activeTranslationId });
                    verifyDetails(next);
                    if (!active() || request !== version) return false;
                    details = next;
                    return load(chosen.height, position, paused);
                }
                if (!active() || request !== version) return false;
                video.autoplay = false;
                transport?.destroy();
                bridge.replaceChildren(...variants.map(item => {
                    const button = document.createElement('button');
                    button.type = 'button'; button.dataset.qualityOption = String(item.height);
                    button.textContent = `${item.height}p`;
                    button.classList.toggle('active', item.height === chosen.height);
                    button.addEventListener('click', () => { void load(item.height, video.currentTime, video.paused).catch(fail); });
                    return button;
                }));
                const restore = () => {
                    if (!active() || request !== version) return;
                    if (position > 0 && Number.isFinite(video.duration)) video.currentTime = Math.min(position, Math.max(0, video.duration - 0.5));
                    if (paused) video.pause();
                    else void video.play().catch(() => {});
                };
                video.addEventListener('loadedmetadata', restore, { once: true });
                phase = 'hls-playback';
                transport = window.HlsPlaybackFactory?.create(video, url, {
                    networkProfile: 'hdrezka', providerManifestUrl: url, isCurrent: () => active() && request === version,
                    beforeLoad: instance => { container._hlsInstance = instance; video._movieExtensionHls = instance; },
                    onSourceExpired: async () => {
                        if (refreshed || !active() || request !== version) return false;
                        refreshed = true;
                        phase = 'streams';
                        try {
                            const next = await this.service.request('streams', { url: source.url, translationId: details.activeTranslationId });
                            if (!active() || request !== version) return false;
                            verifyDetails(next);
                            details = next;
                        } catch (failure) {
                            if (!active() || request !== version) return false;
                            transport?.destroy();
                            fail(failure);
                            return false;
                        }
                        return load(chosen.height, video.currentTime, video.paused);
                    },
                    onFatal: ({ reason, data }) => { fail({ code: 'HDREZKA_HLS_FAILED', hlsReason: reason, status: data?.response?.code }); return true; }
                });
                if (!transport) { video.removeEventListener('loadedmetadata', restore); throw new Error('HDREZKA_HLS_UNAVAILABLE'); }
                persist(chosen.height);
                return true;
            };
            const publishDubState = () => {
                container.__providerDubState = { providerId: this.id, contextId: details.movieId,
                    translations: details.translations, activeTranslationId: details.activeTranslationId, controlsLocation: 'settings' };
                voiceBridge.replaceChildren(...details.translations.map(translation => {
                    const item = document.createElement('button');
                    item.type = 'button'; item.dataset.voiceoverOption = translation.id;
                    item.textContent = translation.name;
                    item.classList.toggle('active', translation.id === details.activeTranslationId);
                    item.addEventListener('click', event => {
                        event.stopPropagation();
                        if (!active()) return;
                        if (options.onProviderDubChange) {
                            void options.onProviderDubChange(translation.id);
                        } else {
                            this.setPreferredTranslation(details.movieId, translation.id, options.movieId);
                            void this.changeTranslation(container, translation.id);
                        }
                    });
                    return item;
                }));
                container.dispatchEvent(new CustomEvent('providerdubstatechange', { detail: { providerId: this.id } }));
            };
            container._hdrezkaChangeTranslation = async translationId => {
                if (!active() || !details.translations.some(item => item.id === translationId)) return false;
                let request = ++version;
                const position = video.currentTime;
                const paused = video.paused;
                const height = Number(bridge.querySelector('.active')?.dataset.qualityOption);
                try {
                    phase = 'streams';
                    const next = await this.service.request('streams', { url: source.url, translationId });
                    if (!active() || request !== version) return false;
                    verifyDetails(next);
                    details = next;
                    refreshed = false;
                    request = version + 1;
                    if (!await load(height, position, paused)) return false;
                    publishDubState();
                    return true;
                } catch (failure) {
                    if (request === version) fail(failure);
                    return false;
                }
            };
            phase = 'hls-library';
            if (!window.Hls && window.LazyLoader) {
                try { await window.LazyLoader.loadScript('../../shared/lib/hls.min.js'); }
                catch { throw new Error('HDREZKA_HLS_UNAVAILABLE'); }
            }
            if (!active()) { dispose(); return false; }
            await load(prefs?.providers?.hdrezka?.qualityHeight || Number.parseInt(details.response?.quality, 10), Number(options.resolvedTimestamp ?? options.initialTimestamp) || 0, false);
            if (!active()) { dispose(); return false; }
            publishDubState();
            if (options.lifecycle !== false && window.PlayerSourceLifecycle) watcher = window.PlayerSourceLifecycle.watchVideo(video, {
                ...options, onState: (state, data) => {
                    if (!active()) return;
                    window.PlayerSourceLifecycle.setState(container, state, { ...data, ...options });
                    options.onLifecycleState?.(state, data);
                }
            });
            observer = new MutationObserver(() => { if (!container.contains(video)) dispose(); });
            observer.observe(container, { childList: true, subtree: true });
            return video;
        } catch (failure) {
            if (active()) fail(failure);
            dispose();
            return false;
        }
    }
}
if (typeof window !== 'undefined') window.HdrezkaParser = HdrezkaParser;
if (typeof module !== 'undefined' && module.exports) module.exports = { HdrezkaParser };
