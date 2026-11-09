/**
 * Downloads page: every torrent the local MediaPlayer keeps for this browser,
 * in one place. Films and series can be filtered, searched, selected, paused,
 * resumed and deleted here; «Смотреть» opens the film's page, whose player
 * starts that exact copy (`?torrentDownload=`), so playback keeps the one
 * player with its timeline, tracks and saved position.
 *
 * MediaPlayer owns the records. The page polls them while it is visible and
 * backs off while the service does not answer. Rules that need no DOM live in
 * DownloadsLibraryModel.js.
 */
(function () {
    'use strict';

    const Model = window.DownloadsLibraryModel;
    const POLL_MS = 2500;
    const MAX_BACKOFF_MS = 30000;
    const SETUP_KEY = 'mediaplayer_setup_v1';
    const META_CACHE_KEY = 'downloads_tmdb_meta_v1';
    // MovieCacheService keeps each film page's card in this browser under this key.
    const LOCAL_FILM_PREFIX = 'local_movie_cache_';
    const META_TTL_MS = 30 * 24 * 60 * 60 * 1000;
    const META_LIMIT = 300;
    const META_CONCURRENCY = 4;

    const FILTER_TITLES = Object.freeze({
        all: 'Все загрузки',
        active: 'Качаются',
        ready: 'Готовы к просмотру',
        paused: 'На паузе',
        error: 'Ошибки'
    });

    const STATUS_LABELS = Object.freeze({
        starting: 'Подготавливается',
        downloading: 'Качается',
        paused: 'На паузе',
        error: 'Ошибка',
        complete: 'Готово'
    });

    const ICONS = Object.freeze({
        play: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l12-7.5-12-7.5Z"></path></svg>',
        pause: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"></rect><rect x="14" y="5" width="4" height="14" rx="1"></rect></svg>',
        resume: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"></path><path d="m6 13 6 6 6-6"></path></svg>',
        retry: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>',
        delete: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="m6 6 1 14h10l1-14"></path></svg>',
        page: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>',
        chevron: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>',
        film: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line><line x1="2" y1="7" x2="7" y2="7"></line><line x1="2" y1="17" x2="7" y2="17"></line><line x1="17" y1="17" x2="22" y2="17"></line><line x1="17" y1="7" x2="22" y2="7"></line></svg>',
        link: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>',
        plug: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2v6"></path><path d="M15 2v6"></path><path d="M6 8h12v3a6 6 0 0 1-12 0V8Z"></path><path d="M12 17v5"></path></svg>',
        state: Object.freeze({
            downloading: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v14"></path><path d="m6 12 6 6 6-6"></path></svg>',
            starting: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><polyline points="12 7 12 12 15 14"></polyline></svg>',
            paused: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"></rect><rect x="14" y="5" width="4" height="14" rx="1"></rect></svg>',
            error: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
            complete: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>'
        })
    });

    // ---------- Small helpers ----------

    function icon(markup) {
        const template = document.createElement('template');
        template.innerHTML = markup.trim();
        return template.content.firstElementChild;
    }

    function el(tag, className = '', text = null) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== null && text !== undefined) node.textContent = String(text);
        return node;
    }

    function number(value, digits = 1) {
        return Number(value).toLocaleString('ru-RU', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
    }

    function formatBytes(value) {
        const bytes = Number(value);
        if (!Number.isFinite(bytes) || bytes <= 0) return '0 Б';
        if (bytes < 1024) return `${Math.round(bytes)} Б`;
        const units = ['КБ', 'МБ', 'ГБ', 'ТБ'];
        let amount = bytes;
        let unit = -1;
        do {
            amount /= 1024;
            unit += 1;
        } while (amount >= 1024 && unit < units.length - 1);
        return `${number(amount, amount >= 100 ? 0 : 1)} ${units[unit]}`;
    }

    function formatRate(value) {
        const rate = Number(value);
        return Number.isFinite(rate) && rate > 0 ? `${formatBytes(rate)}/с` : '0 Б/с';
    }

    function formatEta(value) {
        const seconds = Number(value);
        if (!Number.isFinite(seconds) || seconds <= 0) return '';
        if (seconds < 60) return 'меньше минуты';
        const minutes = Math.round(seconds / 60);
        if (minutes < 60) return `${minutes} мин`;
        const hours = Math.floor(minutes / 60);
        if (hours < 48) return `${hours} ч ${minutes % 60} мин`;
        return `${Math.round(hours / 24)} дн.`;
    }

    function formatAgo(value) {
        const time = Date.parse(String(value || ''));
        if (!Number.isFinite(time)) return '';
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const startOfToday = today.getTime();
        if (time >= startOfToday) return 'сегодня';
        if (time >= startOfToday - 86400000) return 'вчера';
        const days = Math.ceil((startOfToday - time) / 86400000);
        return `${days} ${plural(days, 'день', 'дня', 'дней')} назад`;
    }

    function formatClock(time) {
        return new Date(time).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    }

    function plural(count, one, few, many) {
        const n = Math.abs(Number(count)) % 100;
        const last = n % 10;
        if (n > 10 && n < 20) return many;
        if (last > 1 && last < 5) return few;
        if (last === 1) return one;
        return many;
    }

    function toast(message, type = 'info') {
        if (typeof Utils !== 'undefined' && typeof Utils.showToast === 'function') {
            Utils.showToast(message, type);
        }
    }

    function isSetUp(enabled, setup) {
        if (typeof Navigation !== 'undefined' && typeof Navigation.isMediaPlayerSetUp === 'function') {
            return Navigation.isMediaPlayerSetUp(enabled, setup);
        }
        return enabled === true && setup?.enabled === true && setup?.status === 'ready';
    }

    function storageGet(keys) {
        return new Promise((resolve) => {
            try {
                chrome.storage.local.get(keys, result => resolve(chrome.runtime?.lastError ? {} : (result || {})));
            } catch {
                resolve({});
            }
        });
    }

    // ---------- Page ----------

    class DownloadsPage {
        constructor() {
            this.service = typeof MediaPlayerService !== 'undefined' ? new MediaPlayerService() : null;
            this.tmdb = typeof TMDBService !== 'undefined' ? new TMDBService() : null;
            this.idMapping = typeof IdMappingService !== 'undefined' ? new IdMappingService(null, this.tmdb) : null;
            this.downloads = [];
            this.items = [];
            this.entries = [];
            this.view = { filter: 'all', query: '', sort: 'activity' };
            this.selected = new Set();
            this.pending = new Set();
            this.collapsed = new Set();
            this.cards = new Map();
            this.cardSignatures = new WeakMap();
            this.meta = new Map();
            // Kinopoisk ID per linked item (null when this browser has no verified one).
            this.identities = new Map();
            this.metaPending = new Set();
            this.metaQueue = [];
            this.metaActive = 0;
            this.gate = 'checking';
            this.loaded = false;
            this.health = 'unknown';
            this.lastError = null;
            this.lastSuccessAt = 0;
            this.pollDelay = POLL_MS;
            this.nextPollAt = 0;
            this.pollTimer = null;
            this.waitingForVisible = false;
            this.refreshing = null;
            this.abortController = null;
            this.bulkBusy = false;
            this.storageInfo = null;

            this.elements = {
                filters: document.getElementById('downloadsFilters'),
                title: document.getElementById('downloadsTitle'),
                controls: document.getElementById('downloadsControls'),
                search: document.getElementById('downloadsSearch'),
                sort: document.getElementById('downloadsSort'),
                summary: document.getElementById('downloadsSummary'),
                banner: document.getElementById('downloadsBanner'),
                bannerTitle: document.getElementById('downloadsBannerTitle'),
                bannerText: document.getElementById('downloadsBannerText'),
                retry: document.getElementById('downloadsRetryBtn'),
                toolbar: document.getElementById('downloadsToolbar'),
                selectAll: document.getElementById('downloadsSelectAll'),
                loader: document.getElementById('downloadsLoader'),
                list: document.getElementById('downloadsList'),
                empty: document.getElementById('downloadsEmpty'),
                bulkBar: document.getElementById('downloadsBulkBar'),
                bulkCount: document.getElementById('downloadsBulkCount'),
                bulkPause: document.getElementById('downloadsBulkPause'),
                bulkResume: document.getElementById('downloadsBulkResume'),
                bulkDelete: document.getElementById('downloadsBulkDelete'),
                folder: document.getElementById('downloadsFolder'),
                folderPath: document.getElementById('downloadsFolderPath'),
                used: document.getElementById('downloadsUsed'),
                retention: document.getElementById('downloadsRetention'),
                settingsLink: document.getElementById('downloadsSettingsLink')
            };
        }

        async start() {
            this.bindEvents();
            try { this.sortControl = window.SortControl?.enhance(this.elements.sort); } catch { /* the native select stays */ }
            if (this.elements.settingsLink) {
                this.elements.settingsLink.href = this.settingsUrl();
            }
            await this.loadMetaCache();
            await this.applyGate();
            chrome.storage?.onChanged?.addListener((changes, area) => {
                if (area === 'local' && (changes.mediaPlayerEnabled || changes[SETUP_KEY])) void this.applyGate();
            });
        }

        settingsUrl() {
            return chrome.runtime.getURL('src/pages/settings/settings.html?pane=mediaplayer');
        }

        // ---------- MediaPlayer gate and polling ----------

        async applyGate() {
            const values = await storageGet(['mediaPlayerEnabled', SETUP_KEY]);
            const open = Boolean(this.service) && isSetUp(values.mediaPlayerEnabled, values[SETUP_KEY]);
            const next = open ? 'open' : 'off';
            if (next === this.gate) return;
            this.gate = next;
            if (open) {
                this.loaded = false;
                this.render();
                void this.loadStorageInfo();
                void this.poll();
            } else {
                this.stopPolling();
                this.downloads = [];
                this.selected.clear();
                this.render();
            }
        }

        stopPolling() {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
            this.abortController?.abort();
            this.abortController = null;
        }

        schedulePoll(delay = this.pollDelay) {
            clearTimeout(this.pollTimer);
            if (this.gate !== 'open') return;
            this.nextPollAt = Date.now() + delay;
            this.pollTimer = setTimeout(() => void this.poll(), delay);
        }

        async poll() {
            if (this.gate !== 'open') return;
            if (document.hidden) {
                // No requests for a tab nobody looks at; visibilitychange picks it up.
                this.waitingForVisible = true;
                return;
            }
            await this.refresh();
            this.schedulePoll();
        }

        async refresh() {
            if (!this.service || this.gate !== 'open') return false;
            if (this.refreshing) return this.refreshing;
            const controller = new AbortController();
            this.abortController = controller;
            this.refreshing = (async () => {
                try {
                    const downloads = await this.service.listDownloads({ signal: controller.signal });
                    if (controller.signal.aborted) return false;
                    const recovered = this.health === 'unavailable';
                    this.downloads = downloads;
                    this.health = 'healthy';
                    this.lastError = null;
                    this.lastSuccessAt = Date.now();
                    this.pollDelay = POLL_MS;
                    if (recovered && !this.storageInfo) void this.loadStorageInfo();
                    return true;
                } catch (error) {
                    if (controller.signal.aborted || this.service.isRequestAbortedError?.(error)) return false;
                    this.lastError = error;
                    if (this.service.isServiceUnavailableError?.(error)) {
                        this.health = 'unavailable';
                        this.pollDelay = Math.min(MAX_BACKOFF_MS, Math.max(5000, this.pollDelay * 2));
                    } else {
                        this.health = 'failed';
                        this.pollDelay = Math.min(MAX_BACKOFF_MS, Math.max(5000, this.pollDelay * 2));
                    }
                    return false;
                } finally {
                    if (this.abortController === controller) this.abortController = null;
                    this.loaded = true;
                    this.refreshing = null;
                    this.render();
                }
            })();
            return this.refreshing;
        }

        async refreshNow() {
            clearTimeout(this.pollTimer);
            await this.refresh();
            this.schedulePoll();
        }

        async loadStorageInfo() {
            if (!this.service?.getSettings) return;
            try {
                const settings = await this.service.getSettings();
                this.storageInfo = {
                    folder: settings?.storage?.supported ? settings.storage.downloadPath : '',
                    retentionDays: settings?.torrentRetentionDays
                };
            } catch {
                this.storageInfo = null;
            }
            this.renderStorage();
        }

        // ---------- TMDB titles and posters ----------

        metaKey(item) {
            return item?.linked ? `${item.mediaType}:${item.tmdbId}` : '';
        }

        metaFor(item) {
            const value = this.meta.get(this.metaKey(item));
            return value && value.name !== undefined ? value : null;
        }

        displayTitle(item) {
            return this.metaFor(item)?.name || item.title || 'Без названия';
        }

        async loadMetaCache() {
            const values = await storageGet([META_CACHE_KEY]);
            const cache = values[META_CACHE_KEY];
            if (!cache || typeof cache !== 'object') return;
            const now = Date.now();
            Object.entries(cache).forEach(([key, value]) => {
                if (value && typeof value === 'object' && now - Number(value.fetchedAt || 0) < META_TTL_MS) {
                    this.meta.set(key, value);
                }
            });
        }

        saveMetaCacheSoon() {
            clearTimeout(this.metaSaveTimer);
            this.metaSaveTimer = setTimeout(() => {
                // A card borrowed from the film's local copy is not kept, so TMDB is asked again next visit.
                const entries = [...this.meta.entries()]
                    .filter(([, value]) => value && value.name !== undefined && !value.localOnly)
                    .sort((first, second) => Number(second[1].fetchedAt || 0) - Number(first[1].fetchedAt || 0))
                    .slice(0, META_LIMIT);
                try {
                    chrome.storage.local.set({ [META_CACHE_KEY]: Object.fromEntries(entries) });
                } catch { /* Posters are only a convenience. */ }
            }, 400);
        }

        requestMeta(items) {
            items.forEach((item) => {
                const key = this.metaKey(item);
                if (!key || this.metaPending.has(key)) return;
                if (this.meta.has(key) && this.identities.has(key)) return;
                this.metaPending.add(key);
                this.metaQueue.push(item);
            });
            this.pumpMeta();
        }

        pumpMeta() {
            while (this.metaActive < META_CONCURRENCY && this.metaQueue.length) {
                const item = this.metaQueue.shift();
                const key = this.metaKey(item);
                this.metaActive += 1;
                this.loadItemMeta(item, key)
                    .catch(() => {
                        if (!this.meta.has(key)) this.meta.set(key, { failed: true });
                        if (!this.identities.has(key)) this.identities.set(key, null);
                    })
                    .finally(() => {
                        this.metaActive -= 1;
                        this.metaPending.delete(key);
                        this.render();
                        this.pumpMeta();
                    });
            }
        }

        /**
         * TMDB gives the title, year and poster; this browser's verified mapping
         * gives the Kinopoisk ID the film's page opens by. When TMDB does not
         * answer, the film's own page may have left its card here: its title,
         * year and poster stand in for this visit. Neither is retried during it.
         */
        async loadItemMeta(item, key) {
            const needsMeta = !this.meta.has(key);
            const [details, kinopoiskId] = await Promise.all([
                needsMeta ? this.fetchTmdbMeta(item) : null,
                this.identities.has(key) ? this.identities.get(key) : this.findKinopoiskId(item)
            ]);
            this.identities.set(key, kinopoiskId);
            if (!needsMeta) return;
            if (details) {
                this.meta.set(key, { ...details, fetchedAt: Date.now() });
                this.saveMetaCacheSoon();
                return;
            }
            const local = kinopoiskId ? await this.readLocalFilm(kinopoiskId) : null;
            this.meta.set(key, local ? { ...local, localOnly: true } : { failed: true });
        }

        async fetchTmdbMeta(item) {
            if (!this.tmdb?.getListingDetails) return null;
            try {
                return await this.tmdb.getListingDetails(item.tmdbId, item.mediaType);
            } catch {
                return null;
            }
        }

        async findKinopoiskId(item) {
            if (!this.idMapping?.findTrustedKinopoiskId) return null;
            try {
                const id = Number(await this.idMapping.findTrustedKinopoiskId(item.tmdbId, item.mediaType));
                return Number.isSafeInteger(id) && id > 0 ? id : null;
            } catch {
                return null;
            }
        }

        /** The title, year and poster of the film's card this browser keeps, or null. */
        async readLocalFilm(kinopoiskId) {
            const key = `${LOCAL_FILM_PREFIX}${kinopoiskId}`;
            const film = (await storageGet([key]))[key];
            const name = String(film?.name || '').trim();
            // A record can hold only parsed ratings (RatingsRefreshService), or a loading placeholder.
            if (!name || name === 'Loading...' || name === 'Unknown Movie') return null;
            const poster = [film.posterPreviewUrl, film.posterUrl, film.poster?.previewUrl, film.poster?.url]
                .find(url => typeof url === 'string' && /^https:\/\//i.test(url));
            const year = Number(film.year);
            return {
                name,
                alternativeName: String(film.alternativeName || film.enName || film.originalName || '').trim(),
                year: Number.isSafeInteger(year) && year > 0 ? year : 0,
                posterUrl: poster || ''
            };
        }

        // ---------- URLs ----------

        movieUrl(item, record = null) {
            const meta = this.metaFor(item) || {};
            const kinopoiskId = this.identities.get(this.metaKey(item));
            // A film this browser has a verified Kinopoisk ID for opens like any other
            // card; the others are looked up on the film page by title and year.
            const params = kinopoiskId
                ? new URLSearchParams({ movieId: String(kinopoiskId) })
                : new URLSearchParams({
                    resolveTmdbId: String(item.tmdbId),
                    source: 'home-tmdb-only',
                    title: meta.name || item.title || '',
                    originalTitle: meta.alternativeName || '',
                    year: meta.year ? String(meta.year) : '',
                    mediaType: item.mediaType === 'tv' ? 'tv' : 'movie'
                });
            if (record) {
                params.set('torrentDownload', record.id);
                if (Model.hasEpisode(record)) {
                    params.set('torrentSeason', String(record.seasonNumber));
                    params.set('torrentEpisode', String(record.episodeNumber));
                }
            }
            return chrome.runtime.getURL(`src/pages/movie-details/movie-details.html?${params.toString()}`);
        }

        // ---------- Events ----------

        bindEvents() {
            this.elements.filters?.addEventListener('click', (event) => {
                const button = event.target.closest('[data-filter]');
                if (button) this.setFilter(button.dataset.filter);
            });
            this.elements.search?.addEventListener('input', () => {
                this.view.query = this.elements.search.value;
                this.render();
            });
            this.elements.sort?.addEventListener('change', () => {
                this.view.sort = Model.SORTS.includes(this.elements.sort.value) ? this.elements.sort.value : 'activity';
                this.render();
            });
            this.elements.retry?.addEventListener('click', () => void this.refreshNow());
            this.elements.selectAll?.addEventListener('change', () => {
                const records = this.entries.flatMap(entry => entry.records);
                const state = Model.selectionState(records, this.selected);
                if (state === 'all') records.forEach(record => this.selected.delete(record.id));
                else records.forEach(record => this.selected.add(record.id));
                this.render();
            });
            this.elements.list?.addEventListener('click', (event) => {
                const action = event.target.closest('[data-action]');
                if (!action || !this.elements.list.contains(action)) return;
                if (action.tagName === 'A' && action.dataset.action === 'page') return;
                if (action.disabled) return;
                event.preventDefault();
                void this.handleAction(action.dataset.action, action.dataset.id, action.dataset.key);
            });
            this.elements.list?.addEventListener('change', (event) => {
                const box = event.target.closest('input[type="checkbox"][data-select]');
                if (!box) return;
                const ids = String(box.dataset.select).split(',').filter(Boolean);
                ids.forEach(id => (box.checked ? this.selected.add(id) : this.selected.delete(id)));
                this.render();
            });
            this.elements.empty?.addEventListener('click', (event) => {
                if (event.target.closest('[data-action="show-all"]')) {
                    this.elements.search.value = '';
                    this.view.query = '';
                    this.setFilter('all');
                }
            });
            this.elements.bulkBar?.addEventListener('click', (event) => {
                const button = event.target.closest('[data-bulk]');
                if (!button || button.disabled) return;
                void this.handleBulk(button.dataset.bulk);
            });
            document.addEventListener('keydown', (event) => {
                if (event.key !== 'Escape' || !this.selected.size || window.ConfirmDialog?.isOpen?.()) return;
                // Escape in the search field or the sort menu belongs to that control.
                if (event.target.closest?.('input:not([type="checkbox"]), select, textarea, [role="combobox"], [role="listbox"]')) return;
                this.selected.clear();
                this.render();
            });
            document.addEventListener('visibilitychange', () => {
                if (document.hidden || !this.waitingForVisible) return;
                this.waitingForVisible = false;
                void this.poll();
            });
            window.addEventListener('pagehide', () => this.stopPolling());
            window.addEventListener('pageshow', (event) => {
                // Back from a film page restores this page from the cache with polling stopped.
                if (event.persisted && this.gate === 'open') void this.refreshNow();
            });
        }

        setFilter(filter) {
            this.view.filter = Model.FILTERS.includes(filter) ? filter : 'all';
            this.elements.filters?.querySelectorAll('[data-filter]').forEach((button) => {
                const active = button.dataset.filter === this.view.filter;
                button.classList.toggle('is-active', active);
                button.setAttribute('aria-pressed', String(active));
            });
            this.render();
        }

        findRecord(id) {
            for (const item of this.items) {
                const record = item.records.find(candidate => candidate.id === id);
                if (record) return { item, record };
            }
            return null;
        }

        replaceRecord(updated) {
            if (!updated?.id) return;
            const index = this.downloads.findIndex(record => record.id === updated.id);
            if (index >= 0) this.downloads[index] = updated;
        }

        removeRecords(ids) {
            const gone = new Set(ids);
            this.downloads = this.downloads.filter(record => !gone.has(record.id));
            ids.forEach(id => this.selected.delete(id));
        }

        errorText(error) {
            if (this.service?.isServiceUnavailableError?.(error)) return 'MediaPlayer не отвечает. Проверьте, что MediaPlayer Suite запущен.';
            return error?.message || 'MediaPlayer не смог выполнить действие.';
        }

        async handleAction(action, id, key) {
            if (action === 'toggle') {
                if (this.collapsed.has(key)) this.collapsed.delete(key);
                else this.collapsed.add(key);
                this.render();
                return;
            }
            if (action === 'play-blocked') {
                toast('Эта загрузка не связана с фильмом из каталога, поэтому открыть плеер отсюда нельзя.', 'info');
                return;
            }
            if (action === 'delete-series') {
                const item = this.items.find(candidate => candidate.key === key);
                if (item) await this.deleteRecords(item.records, { seriesTitle: this.displayTitle(item) });
                return;
            }
            const found = this.findRecord(id);
            if (!found) return;
            const { item, record } = found;
            if (action === 'play') {
                window.location.href = this.movieUrl(item, record);
                return;
            }
            if (action === 'delete') {
                await this.deleteRecords([record]);
                return;
            }
            if (action === 'pause' || action === 'resume') {
                this.pending.add(record.id);
                this.render();
                try {
                    const updated = action === 'pause'
                        ? await this.service.pauseDownload(record.id)
                        : await this.service.resumeDownload(record.id);
                    this.replaceRecord(updated);
                } catch (error) {
                    toast(this.errorText(error), 'error');
                } finally {
                    this.pending.delete(record.id);
                    this.render();
                    void this.refreshNow();
                }
            }
        }

        describeRecords(records, seriesTitle = '') {
            if (records.length === 1) {
                const found = this.findRecord(records[0].id);
                const title = found ? this.displayTitle(found.item) : records[0].title;
                const code = Model.episodeCode(records[0]);
                return `«${title}»${code ? `, ${code}` : ''}`;
            }
            if (seriesTitle) return `${records.length} ${plural(records.length, 'серия', 'серии', 'серий')} «${seriesTitle}»`;
            return `${records.length} ${plural(records.length, 'загрузка', 'загрузки', 'загрузок')}`;
        }

        async deleteRecords(records, { seriesTitle = '' } = {}) {
            if (!records.length || this.bulkBusy) return false;
            const bytes = records.reduce((sum, record) => sum + Model.downloadedBytes(record), 0);
            const unfinished = records.some(record => record.status !== 'complete');
            const what = this.describeRecords(records, seriesTitle);
            const message = `С диска будет удалено: ${what} (${formatBytes(bytes)}).`
                + `${unfinished ? ' Незавершённые загрузки остановятся.' : ''} В каталоге всё останется, скачать можно заново.`;
            const confirmed = await window.ConfirmDialog?.confirm({
                title: records.length === 1 ? 'Удалить загрузку?' : `Удалить ${records.length} ${plural(records.length, 'загрузку', 'загрузки', 'загрузок')}?`,
                message,
                confirmLabel: 'Удалить',
                danger: true
            });
            if (!confirmed) return false;

            this.bulkBusy = true;
            records.forEach(record => this.pending.add(record.id));
            this.render();
            const deleted = [];
            let failure = null;
            for (const record of records) {
                try {
                    await this.service.deleteDownload(record.id);
                    deleted.push(record);
                } catch (error) {
                    failure = failure || error;
                    if (this.service?.isServiceUnavailableError?.(error)) break;
                }
            }
            records.forEach(record => this.pending.delete(record.id));
            this.removeRecords(deleted.map(record => record.id));
            this.bulkBusy = false;
            this.render();

            const freed = deleted.reduce((sum, record) => sum + Model.downloadedBytes(record), 0);
            if (!failure) {
                toast(`Удалено${deleted.length > 1 ? `: ${deleted.length}` : ''}. Освободилось ${formatBytes(freed)}.`, 'success');
            } else if (deleted.length) {
                toast(`Удалено ${deleted.length} из ${records.length}. ${this.errorText(failure)}`, 'error');
            } else {
                toast(this.errorText(failure), 'error');
            }
            void this.refreshNow();
            return true;
        }

        async handleBulk(action) {
            if (action === 'clear') {
                this.selected.clear();
                this.render();
                return;
            }
            const summary = Model.selectionSummary(this.selected, this.entries);
            if (action === 'delete') {
                await this.deleteRecords(summary.records);
                return;
            }
            const targets = action === 'pause' ? summary.pausable : action === 'resume' ? summary.resumable : [];
            if (!targets.length || this.bulkBusy) return;
            this.bulkBusy = true;
            targets.forEach(record => this.pending.add(record.id));
            this.render();
            let done = 0;
            let failure = null;
            for (const record of targets) {
                try {
                    const updated = action === 'pause'
                        ? await this.service.pauseDownload(record.id)
                        : await this.service.resumeDownload(record.id);
                    this.replaceRecord(updated);
                    done += 1;
                } catch (error) {
                    failure = failure || error;
                    if (this.service?.isServiceUnavailableError?.(error)) break;
                }
            }
            targets.forEach(record => this.pending.delete(record.id));
            this.bulkBusy = false;
            this.render();
            if (failure) {
                toast(`${action === 'pause' ? 'Поставлено на паузу' : 'Возобновлено'}: ${done} из ${targets.length}. ${this.errorText(failure)}`, 'error');
            } else {
                toast(`${action === 'pause' ? 'Поставлено на паузу' : 'Возобновлено'}: ${done}.`, 'success');
            }
            void this.refreshNow();
        }

        // ---------- Rendering ----------

        render() {
            const { elements } = this;
            const open = this.gate === 'open';
            this.items = open ? Model.groupDownloads(this.downloads) : [];
            this.entries = Model.visibleEntries(this.items, {
                ...this.view,
                titleOf: (item) => {
                    const meta = this.metaFor(item);
                    return [meta?.name || item.title, meta?.alternativeName].filter(Boolean);
                }
            });
            this.selected = Model.pruneSelection(this.selected, this.entries);
            if (open) this.requestMeta(this.items);

            const counts = Model.filterCounts(this.items);
            elements.filters?.querySelectorAll('[data-count]').forEach((node) => {
                node.textContent = String(counts[node.dataset.count] || 0);
            });
            if (elements.title) elements.title.textContent = FILTER_TITLES[this.view.filter];

            const waiting = this.gate === 'checking' || (open && !this.loaded);
            const hasAny = this.items.length > 0;
            if (elements.loader) elements.loader.hidden = !waiting;
            if (elements.controls) elements.controls.hidden = !open || !hasAny;
            this.renderSummary(open && hasAny);
            this.renderBanner(open && this.loaded);
            this.renderStorage();

            if (!open || !this.loaded) {
                this.clearList();
                if (elements.toolbar) elements.toolbar.hidden = true;
                this.renderEmpty(this.gate === 'off' ? 'off' : null);
                this.renderBulkBar();
                return;
            }
            if (!hasAny) {
                this.clearList();
                if (elements.toolbar) elements.toolbar.hidden = true;
                this.renderEmpty(this.health === 'healthy' ? 'none' : null);
                this.renderBulkBar();
                return;
            }
            if (!this.entries.length) {
                this.clearList();
                if (elements.toolbar) elements.toolbar.hidden = true;
                this.renderEmpty(this.view.query.trim() ? 'search' : 'filter');
                this.renderBulkBar();
                return;
            }
            this.renderEmpty(null);
            this.renderToolbar();
            this.renderList();
            this.renderBulkBar();
        }

        clearList() {
            this.cards.forEach(card => card.remove());
            this.cards.clear();
        }

        renderSummary(visible) {
            const node = this.elements.summary;
            if (!node) return;
            node.hidden = !visible;
            if (!visible) return;
            const summary = Model.summarize(this.items);
            const stale = this.health !== 'healthy';
            const cells = [
                [String(summary.cards), plural(summary.cards, 'загрузка', 'загрузки', 'загрузок')],
                [formatBytes(summary.onDiskBytes), 'на диске'],
                [String(summary.activeCount), 'качается сейчас'],
                [stale ? '—' : formatRate(summary.downloadSpeed), 'общая скорость']
            ];
            node.replaceChildren(...cells.map(([value, label]) => {
                const cell = el('div', 'downloads-summary__item');
                cell.append(el('span', 'downloads-summary__value', value), el('span', 'downloads-summary__label', label));
                return cell;
            }));
        }

        renderBanner(visible) {
            const { banner, bannerTitle, bannerText } = this.elements;
            if (!banner) return;
            const show = visible && this.health !== 'healthy' && this.health !== 'unknown';
            banner.hidden = !show;
            if (!show) return;
            const seconds = Math.max(1, Math.round(this.pollDelay / 1000));
            if (this.health === 'unavailable') {
                bannerTitle.textContent = 'MediaPlayer не отвечает.';
                bannerText.textContent = this.lastSuccessAt
                    ? `Показан список на ${formatClock(this.lastSuccessAt)}. Пауза, удаление и просмотр вернутся, когда служба ответит. Повторим проверку через ${seconds} с.`
                    : `Проверьте, что MediaPlayer Suite запущен на этом компьютере. Повторим проверку через ${seconds} с.`;
            } else {
                bannerTitle.textContent = 'Не удалось получить загрузки.';
                bannerText.textContent = this.errorText(this.lastError);
            }
        }

        renderStorage() {
            const { folder, folderPath, used, retention } = this.elements;
            const info = this.gate === 'open' ? this.storageInfo : null;
            if (folder && folderPath) {
                folder.hidden = !info?.folder;
                folderPath.textContent = info?.folder || '';
                folder.title = info?.folder || '';
            }
            if (used) {
                used.textContent = this.gate === 'open' && this.loaded && this.health !== 'failed'
                    ? formatBytes(Model.summarize(this.items).onDiskBytes)
                    : '—';
            }
            if (retention) {
                const days = Number(info?.retentionDays);
                retention.hidden = !info || !Number.isFinite(days);
                retention.textContent = days === 0
                    ? 'Готовые хранятся, пока вы их не удалите.'
                    : `Готовые хранятся ${days} ${plural(days, 'день', 'дня', 'дней')}, просмотр продлевает срок.`;
            }
        }

        renderEmpty(kind) {
            const node = this.elements.empty;
            if (!node) return;
            if (!kind) {
                node.hidden = true;
                node.replaceChildren();
                return;
            }
            const content = {
                off: {
                    icon: ICONS.plug,
                    title: 'MediaPlayer не подключён',
                    text: 'Торренты скачивает и хранит MediaPlayer Suite на этом компьютере. Подключите его в настройках, и здесь появятся все загрузки.',
                    action: () => {
                        const link = el('a', 'btn btn-primary', 'Открыть настройки MediaPlayer');
                        link.href = this.settingsUrl();
                        return link;
                    }
                },
                none: {
                    icon: ICONS.film,
                    title: 'Загрузок пока нет',
                    text: 'Откройте фильм, выберите источник «Торрент» и раздачу — загрузка появится здесь.'
                },
                filter: {
                    icon: ICONS.film,
                    title: 'Здесь пусто',
                    text: 'В этом разделе нет загрузок.',
                    action: () => {
                        const button = el('button', 'btn btn-secondary', 'Показать все');
                        button.type = 'button';
                        button.dataset.action = 'show-all';
                        return button;
                    }
                },
                search: {
                    icon: ICONS.film,
                    title: 'Ничего не найдено',
                    text: 'Попробуйте другое название.',
                    action: () => {
                        const button = el('button', 'btn btn-secondary', 'Сбросить поиск');
                        button.type = 'button';
                        button.dataset.action = 'show-all';
                        return button;
                    }
                }
            }[kind];
            if (node.dataset.kind === kind && !node.hidden) return;
            const badge = el('div', 'downloads-empty__icon');
            badge.append(icon(content.icon));
            node.replaceChildren(badge, el('h3', '', content.title), el('p', '', content.text));
            if (content.action) node.append(content.action());
            node.dataset.kind = kind;
            node.hidden = false;
        }

        renderToolbar() {
            const { toolbar, selectAll } = this.elements;
            if (!toolbar || !selectAll) return;
            toolbar.hidden = false;
            const records = this.entries.flatMap(entry => entry.records);
            const state = Model.selectionState(records, this.selected);
            selectAll.checked = state === 'all';
            selectAll.indeterminate = state === 'some';
            selectAll.disabled = this.bulkBusy;
        }

        renderBulkBar() {
            const { bulkBar, bulkCount, bulkPause, bulkResume, bulkDelete } = this.elements;
            if (!bulkBar) return;
            const summary = Model.selectionSummary(this.selected, this.entries);
            bulkBar.hidden = summary.count === 0;
            if (!summary.count) return;
            const offline = this.health !== 'healthy';
            bulkCount.textContent = `Выбрано: ${summary.count} · ${formatBytes(summary.bytes)}`;
            bulkPause.textContent = summary.pausable.length ? `Пауза (${summary.pausable.length})` : 'Пауза';
            bulkResume.textContent = summary.resumable.length ? `Продолжить (${summary.resumable.length})` : 'Продолжить';
            bulkDelete.textContent = `Удалить (${summary.count})`;
            bulkPause.disabled = offline || this.bulkBusy || !summary.pausable.length;
            bulkResume.disabled = offline || this.bulkBusy || !summary.resumable.length;
            bulkDelete.disabled = offline || this.bulkBusy;
            bulkPause.title = offline ? 'MediaPlayer не отвечает' : (summary.pausable.length ? '' : 'Среди выбранных нет загрузок, которые качаются');
            bulkResume.title = offline ? 'MediaPlayer не отвечает' : (summary.resumable.length ? '' : 'Среди выбранных нет загрузок на паузе или с ошибкой');
        }

        renderList() {
            const list = this.elements.list;
            const focusKey = list.contains(document.activeElement) ? document.activeElement?.dataset?.focusKey : null;
            const keep = new Set();
            this.entries.forEach((entry, index) => {
                const key = entry.item.key;
                keep.add(key);
                let card = this.cards.get(key);
                const signature = this.cardSignature(entry);
                if (!card || this.cardSignatures.get(card) !== signature) {
                    const next = entry.item.kind === 'series' ? this.buildSeriesCard(entry) : this.buildMovieCard(entry);
                    this.cardSignatures.set(next, signature);
                    if (card) card.replaceWith(next);
                    card = next;
                    this.cards.set(key, card);
                }
                entry.records.forEach(record => this.fillLive(card, record));
                if (list.children[index] !== card) list.insertBefore(card, list.children[index] || null);
            });
            this.cards.forEach((card, key) => {
                if (keep.has(key)) return;
                card.remove();
                this.cards.delete(key);
            });
            while (list.children.length > this.entries.length) list.lastElementChild.remove();
            if (focusKey && document.activeElement?.dataset?.focusKey !== focusKey) {
                const target = [...list.querySelectorAll('[data-focus-key]')].find(node => node.dataset.focusKey === focusKey);
                target?.focus({ preventScroll: true });
            }
        }

        /** Everything a card shows except the numbers that change on each poll. */
        cardSignature(entry) {
            const { item, records } = entry;
            const meta = this.metaFor(item);
            return JSON.stringify([
                item.kind,
                this.displayTitle(item),
                meta?.year || 0,
                meta?.posterUrl || '',
                this.identities.get(this.metaKey(item)) || 0,
                item.linked,
                this.collapsed.has(item.key),
                this.health,
                this.bulkBusy,
                item.records.length,
                item.records.map(record => record.status),
                records.map(record => [
                    record.id, record.status, record.quality, record.provider,
                    this.selected.has(record.id), this.pending.has(record.id),
                    record.seasonNumber, record.episodeNumber
                ])
            ]);
        }

        buildCheckbox(ids, label, state) {
            const wrap = el('label', 'dl-select');
            const box = el('input');
            box.type = 'checkbox';
            box.dataset.select = ids.join(',');
            box.dataset.focusKey = `select:${ids.join(',')}`;
            box.checked = state === 'all';
            box.indeterminate = state === 'some';
            box.disabled = this.bulkBusy;
            box.setAttribute('aria-label', label);
            wrap.append(box);
            return wrap;
        }

        buildPoster(item) {
            const poster = el('div', 'dl-poster');
            const fallback = el('span', 'dl-poster__fallback');
            fallback.append(icon(ICONS.film));
            poster.append(fallback);
            const url = this.metaFor(item)?.posterUrl;
            if (url) {
                const image = el('img');
                image.alt = '';
                image.loading = 'lazy';
                image.decoding = 'async';
                image.addEventListener('error', () => image.remove(), { once: true });
                image.src = url;
                poster.append(image);
            }
            return poster;
        }

        buildTitle(item, fallbackSub) {
            const head = el('div', 'dl-card__head');
            const title = el('h3', 'dl-card__title');
            const text = this.displayTitle(item);
            if (item.linked) {
                const link = el('a', '', text);
                link.href = this.movieUrl(item);
                link.dataset.action = 'page';
                link.dataset.focusKey = `title:${item.key}`;
                title.append(link);
            } else {
                title.textContent = text;
            }
            const year = this.metaFor(item)?.year;
            head.append(title, el('span', 'dl-card__sub', [year || '', fallbackSub].filter(Boolean).join(' · ')));
            return head;
        }

        buildMovieCard(entry) {
            const { item } = entry;
            const record = entry.records[0];
            const title = this.displayTitle(item);
            const card = el('article', 'dl-card');
            card.setAttribute('role', 'listitem');
            card.dataset.key = item.key;
            card.dataset.selected = String(this.selected.has(record.id));
            card.append(
                this.buildCheckbox([record.id], `Выбрать: ${title}`, this.selected.has(record.id) ? 'all' : 'none'),
                this.buildPoster(item)
            );

            const body = el('div', 'dl-card__body');
            body.append(this.buildTitle(item, item.linked ? (item.mediaType === 'tv' ? 'сериал' : 'фильм') : 'не связано с каталогом'));
            const release = [record.quality || 'Качество не указано', record.provider].filter(Boolean).join(' · ');
            const releaseLine = el('div', 'dl-card__release', release);
            releaseLine.title = release;
            body.append(releaseLine, this.buildLive(record));
            if (!item.linked) {
                const note = el('span', 'dl-note');
                note.append(icon(ICONS.link), document.createTextNode('MediaPlayer не знает, какой это фильм, поэтому открыть его страницу и плеер отсюда нельзя.'));
                body.append(note);
            }
            card.append(body, this.buildActions(item, record, { compact: false, title }));
            return card;
        }

        buildSeriesCard(entry) {
            const { item, records } = entry;
            const title = this.displayTitle(item);
            const selection = Model.selectionState(records, this.selected);
            const card = el('article', 'dl-card dl-card--series');
            card.setAttribute('role', 'listitem');
            card.dataset.key = item.key;
            card.dataset.selected = String(selection !== 'none');
            card.append(
                this.buildCheckbox(records.map(record => record.id), `Выбрать все показанные серии: ${title}`, selection),
                this.buildPoster(item)
            );

            const all = item.records;
            const ready = all.filter(record => record.status === 'complete').length;
            const active = all.filter(Model.isActive).length;
            const size = all.reduce((sum, record) => sum + Model.totalBytes(record), 0);
            const parts = [
                `${all.length} ${plural(all.length, 'серия', 'серии', 'серий')}`,
                formatBytes(size),
                `готово ${ready} из ${all.length}`
            ];
            if (active) parts.push(`качается ${active}`);

            const body = el('div', 'dl-card__body');
            body.append(this.buildTitle(item, 'сериал'), el('div', 'dl-card__release', parts.join(' · ')));
            const collapsed = this.collapsed.has(item.key);
            const toggle = el('button', 'dl-toggle');
            toggle.type = 'button';
            toggle.dataset.action = 'toggle';
            toggle.dataset.key = item.key;
            toggle.dataset.focusKey = `toggle:${item.key}`;
            toggle.setAttribute('aria-expanded', String(!collapsed));
            toggle.append(icon(ICONS.chevron), document.createTextNode(collapsed ? `Показать серии (${records.length})` : 'Скрыть серии'));
            body.append(toggle);

            const actions = el('div', 'dl-actions');
            actions.append(this.pageLink(item, 'Страница сериала'));
            const removeAll = this.iconButton('delete-series', '', `Удалить все серии: ${title}`, ICONS.delete, {
                danger: true,
                disabled: this.health !== 'healthy' || this.bulkBusy,
                reason: 'MediaPlayer не отвечает',
                key: item.key
            });
            actions.append(removeAll);
            card.append(body, actions);

            const episodes = el('div', 'dl-episodes');
            episodes.hidden = collapsed;
            episodes.id = `episodes-${item.key.replace(/[^a-z0-9-]/gi, '-')}`;
            toggle.setAttribute('aria-controls', episodes.id);
            records.forEach((record) => {
                const code = Model.episodeCode(record);
                const row = el('div', 'dl-episode');
                row.dataset.id = record.id;
                const label = code ? `${title}, ${code}` : title;
                row.append(
                    this.buildCheckbox([record.id], `Выбрать: ${label}`, this.selected.has(record.id) ? 'all' : 'none'),
                    el('span', 'dl-episode__code', code || 'Файл')
                );
                const rowBody = el('div', 'dl-episode__body');
                const name = [record.selectedFile?.name && !code ? record.selectedFile.name : '', record.quality, record.provider]
                    .filter(Boolean).join(' · ');
                rowBody.append(el('div', 'dl-episode__name', name || 'Качество не указано'), this.buildLive(record));
                row.append(rowBody, this.buildActions(item, record, { compact: true, title: label }));
                episodes.append(row);
            });
            card.append(episodes);
            return card;
        }

        pageLink(item, label) {
            const link = el('a', 'dl-icon-btn');
            link.href = this.movieUrl(item);
            link.dataset.action = 'page';
            link.dataset.focusKey = `page:${item.key}`;
            link.title = label;
            link.setAttribute('aria-label', `${label}: ${this.displayTitle(item)}`);
            link.append(icon(ICONS.page));
            return link;
        }

        iconButton(action, id, label, markup, { danger = false, disabled = false, reason = '', key = '' } = {}) {
            const button = el('button', `dl-icon-btn${danger ? ' dl-icon-btn--danger' : ''}`);
            button.type = 'button';
            button.dataset.action = action;
            if (id) button.dataset.id = id;
            if (key) button.dataset.key = key;
            button.dataset.focusKey = `${action}:${id || key}`;
            const text = disabled && reason ? `${label} — ${reason}` : label;
            button.title = text;
            button.setAttribute('aria-label', text);
            button.disabled = disabled;
            button.append(icon(markup));
            return button;
        }

        textButton(action, id, label, markup, { primary = false, disabled = false, reason = '' } = {}) {
            const button = el('button', `btn btn-sm ${primary ? 'btn-primary' : 'btn-secondary'}`);
            button.type = 'button';
            button.dataset.action = action;
            button.dataset.id = id;
            button.dataset.focusKey = `${action}:${id}`;
            button.disabled = disabled;
            if (disabled && reason) button.title = reason;
            button.append(icon(markup), document.createTextNode(label));
            return button;
        }

        buildActions(item, record, { compact, title }) {
            const actions = el('div', 'dl-actions');
            const offline = this.health !== 'healthy';
            const busy = this.pending.has(record.id) || this.bulkBusy;
            const reason = offline ? 'MediaPlayer не отвечает' : (busy ? 'Выполняется…' : '');
            const blocked = offline || busy;
            const episodeKnown = item.mediaType !== 'tv' || Model.hasEpisode(record);

            if (Model.canPlay(record)) {
                if (!item.linked || !episodeKnown) {
                    const play = this.textButton('play-blocked', record.id, 'Смотреть', ICONS.play);
                    play.setAttribute('aria-disabled', 'true');
                    play.title = !item.linked ? 'Не связано с фильмом из каталога' : 'Серия не определена';
                    if (compact) {
                        play.className = 'dl-icon-btn';
                        play.replaceChildren(icon(ICONS.play));
                        play.setAttribute('aria-label', `Смотреть: ${title} — ${play.title}`);
                    }
                    actions.append(play);
                } else if (compact) {
                    actions.append(this.iconButton('play', record.id, `Смотреть: ${title}`, ICONS.play, { disabled: offline, reason }));
                } else {
                    actions.append(this.textButton('play', record.id, 'Смотреть', ICONS.play, { primary: true, disabled: offline, reason }));
                }
            }
            if (Model.canPause(record)) {
                actions.append(this.iconButton('pause', record.id, `Пауза: ${title}`, ICONS.pause, { disabled: blocked, reason }));
            } else if (Model.canResume(record)) {
                const label = record.status === 'error' ? 'Повторить' : 'Продолжить';
                const markup = record.status === 'error' ? ICONS.retry : ICONS.resume;
                actions.append(compact
                    ? this.iconButton('resume', record.id, `${label}: ${title}`, markup, { disabled: blocked, reason })
                    : this.textButton('resume', record.id, label, markup, { disabled: blocked, reason }));
            }
            if (!compact && item.linked) actions.append(this.pageLink(item, item.mediaType === 'tv' ? 'Страница сериала' : 'Страница фильма'));
            actions.append(this.iconButton('delete', record.id, `Удалить: ${title}`, ICONS.delete, { danger: true, disabled: blocked, reason }));
            return actions;
        }

        buildLive(record) {
            const live = el('div', 'dl-live');
            live.dataset.id = record.id;
            return live;
        }

        /** The per-poll part of a record: state, sizes, speed, progress. Holds nothing focusable. */
        fillLive(card, record) {
            const live = [...card.querySelectorAll('.dl-live')].find(node => node.dataset.id === record.id);
            if (!live) return;
            const stale = this.health !== 'healthy';
            const percent = Math.round(Model.percent(record));
            const total = Model.totalBytes(record);
            const have = Model.downloadedBytes(record);
            const status = String(record.status || 'error');
            live.dataset.state = status;
            live.dataset.stale = String(stale);

            const line = el('div', 'dl-status');
            const state = el('span', 'dl-status__state');
            state.append(icon(ICONS.state[status] || ICONS.state.error));
            const label = STATUS_LABELS[status] || 'Состояние неизвестно';
            state.append(document.createTextNode(status === 'complete' ? label : `${label} · ${percent}%`));
            line.append(state);

            const details = [];
            if (status === 'complete') {
                details.push(formatBytes(total));
                const ago = formatAgo(record.completedAt);
                if (ago) details.push(`скачано ${ago}`);
            } else {
                details.push(total ? `${formatBytes(have)} из ${formatBytes(total)}` : formatBytes(have));
                if (!stale && Model.isActive(record)) {
                    details.push(formatRate(record.downloadSpeedBytesPerSecond));
                    details.push(`пиры: ${Math.max(0, Number(record.peers) || 0)}`);
                    const eta = formatEta(record.timeRemainingSeconds);
                    if (eta) details.push(`осталось ${eta}`);
                }
            }
            if (stale) details.push('данные устарели');
            line.append(el('span', '', details.join(' · ')));
            if (status === 'error') {
                line.append(el('span', 'dl-status__error', record.errorMessage || 'Загрузка остановилась. Нажмите «Повторить».'));
            }

            const parts = [line];
            if (status !== 'complete') {
                const bar = el('div', 'dl-progress');
                bar.setAttribute('role', 'progressbar');
                bar.setAttribute('aria-valuemin', '0');
                bar.setAttribute('aria-valuemax', '100');
                bar.setAttribute('aria-valuenow', String(percent));
                bar.setAttribute('aria-label', `Скачано ${percent}%`);
                const fill = el('span');
                fill.style.width = `${Model.percent(record).toFixed(2)}%`;
                // Keep the old width for one frame so the bar slides instead of jumping.
                const previous = live.querySelector('.dl-progress span')?.style.width;
                if (previous) {
                    fill.style.width = previous;
                    requestAnimationFrame(() => { fill.style.width = `${Model.percent(record).toFixed(2)}%`; });
                }
                bar.append(fill);
                parts.push(bar);
            }
            if (Model.isActive(record) && !stale && record.playable) {
                parts.push(el('span', 'dl-note', 'Можно смотреть, пока качается'));
            }
            live.replaceChildren(...parts);
        }
    }

    function boot() {
        if (!Model) {
            console.error('[Downloads] DownloadsLibraryModel is not loaded');
            return;
        }
        const page = new DownloadsPage();
        window.downloadsPage = page;
        void page.start();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
    else boot();
})();
