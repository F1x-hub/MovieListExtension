/**
 * Downloads page: every torrent the local MediaPlayer keeps for this browser,
 * in one place. Films and series can be filtered, searched, selected, paused,
 * resumed and deleted here; Watch opens the film's page, whose player
 * starts that exact copy (`?torrentDownload=`), so playback keeps the one
 * player with its timeline, tracks and saved position.
 *
 * MediaPlayer owns the records. The page polls them while it is visible and
 * backs off while the service does not answer. Rules that need no DOM live in
 * DownloadsLibraryModel.js. Every text the page writes comes from the
 * `downloads` locale group; texts MediaPlayer sends (error messages, file
 * names) are shown as they come.
 */
import { i18n } from '../../shared/i18n/I18n.js';

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

    const STATUSES = Object.freeze(['starting', 'downloading', 'paused', 'error', 'complete']);

    const ICONS = Object.freeze({
        play: '<svg data-icon="PLAY" aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M5 3.9C5 2.9 5.9 2.3 6.7 2.9L16.2 8.9C17 9.5 17 10.5 16.2 11.1L6.7 17.1C5.9 17.7 5 17.1 5 16.1Z"/></svg>',
        pause: '<svg data-icon="PAUSE" aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M5.2 3H6.8A1.2 1.2 0 0 1 8 4.2V15.8A1.2 1.2 0 0 1 6.8 17H5.2A1.2 1.2 0 0 1 4 15.8V4.2A1.2 1.2 0 0 1 5.2 3ZM13.2 3H14.8A1.2 1.2 0 0 1 16 4.2V15.8A1.2 1.2 0 0 1 14.8 17H13.2A1.2 1.2 0 0 1 12 15.8V4.2A1.2 1.2 0 0 1 13.2 3Z"/></svg>',
        resume: '<svg data-icon="ARROW_DOWN" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 4V16M5 11L10 16L15 11"/></svg>',
        retry: '<svg data-icon="REFRESH" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9A7 7 0 0 1 15.6 5.6L17 7M17 3V7H13M17 11A7 7 0 0 1 4.4 14.4L3 13M3 17V13H7"/></svg>',
        delete: '<svg data-icon="TRASH" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M7 4V3A1 1 0 0 1 8 2H12A1 1 0 0 1 13 3V4H16A1 1 0 0 1 17 5V6A1 1 0 0 1 16 7H4A1 1 0 0 1 3 6V5A1 1 0 0 1 4 4Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 8V15A2 2 0 0 0 7 17H13A2 2 0 0 0 15 15V8M10 10V13"/></svg>',
        page: '<svg data-icon="EXTERNAL" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6A2 2 0 0 0 4 7V14A2 2 0 0 0 6 16H13A2 2 0 0 0 15 14V12M9 11L14 6"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M11.4 2H17A1 1 0 0 1 18 3V8.6A.6 .6 0 0 1 17 9L11 3A.6 .6 0 0 1 11.4 2Z"/></svg>',
        chevron: '<svg data-icon="CHEVRON_DOWN" aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 7.5L10 12.5L15 7.5"/></svg>',
        film: '<svg data-icon="FILM" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M5 3H15A3 3 0 0 1 18 6V14A3 3 0 0 1 15 17H5A3 3 0 0 1 2 14V6A3 3 0 0 1 5 3ZM7.5 5H12.5A0.5 0.5 0 0 1 13 5.5V8.5A0.5 0.5 0 0 1 12.5 9H7.5A0.5 0.5 0 0 1 7 8.5V5.5A0.5 0.5 0 0 1 7.5 5ZM7.5 11H12.5A0.5 0.5 0 0 1 13 11.5V14.5A0.5 0.5 0 0 1 12.5 15H7.5A0.5 0.5 0 0 1 7 14.5V11.5A0.5 0.5 0 0 1 7.5 11ZM4 5H5A0.5 0.5 0 0 1 5.5 5.5V6.5A0.5 0.5 0 0 1 5 7H4A0.5 0.5 0 0 1 3.5 6.5V5.5A0.5 0.5 0 0 1 4 5ZM4 9H5A0.5 0.5 0 0 1 5.5 9.5V10.5A0.5 0.5 0 0 1 5 11H4A0.5 0.5 0 0 1 3.5 10.5V9.5A0.5 0.5 0 0 1 4 9ZM4 13H5A0.5 0.5 0 0 1 5.5 13.5V14.5A0.5 0.5 0 0 1 5 15H4A0.5 0.5 0 0 1 3.5 14.5V13.5A0.5 0.5 0 0 1 4 13ZM15 5H16A0.5 0.5 0 0 1 16.5 5.5V6.5A0.5 0.5 0 0 1 16 7H15A0.5 0.5 0 0 1 14.5 6.5V5.5A0.5 0.5 0 0 1 15 5ZM15 9H16A0.5 0.5 0 0 1 16.5 9.5V10.5A0.5 0.5 0 0 1 16 11H15A0.5 0.5 0 0 1 14.5 10.5V9.5A0.5 0.5 0 0 1 15 9ZM15 13H16A0.5 0.5 0 0 1 16.5 13.5V14.5A0.5 0.5 0 0 1 16 15H15A0.5 0.5 0 0 1 14.5 14.5V13.5A0.5 0.5 0 0 1 15 13Z"/></svg>',
        link: '<svg data-icon="LINK" aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.4 11.6L11.6 8.4M9.6 5.9L11.2 4.3A3.18 3.18 0 0 1 15.7 8.8L14.1 10.4M10.4 14.1L8.8 15.7A3.18 3.18 0 0 1 4.3 11.2L5.9 9.6"/></svg>',
        plug: '<svg data-icon="PLUG" aria-hidden="true" width="30" height="30" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 2.6V6M13 2.6V6M10 14V17.4"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M4 6H16A1 1 0 0 1 17 7V8A7 7 0 0 1 3 8V7A1 1 0 0 1 4 6Z"/></svg>',
        state: Object.freeze({
            downloading: '<svg data-icon="ARROW_DOWN" aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 4V16M5 11L10 16L15 11"/></svg>',
            starting: '<svg data-icon="CLOCK" aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 3A7 7 0 1 0 10 17A7 7 0 1 0 10 3Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6V10L12.6 12"/></svg>',
            paused: '<svg data-icon="PAUSE" aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M5.2 3H6.8A1.2 1.2 0 0 1 8 4.2V15.8A1.2 1.2 0 0 1 6.8 17H5.2A1.2 1.2 0 0 1 4 15.8V4.2A1.2 1.2 0 0 1 5.2 3ZM13.2 3H14.8A1.2 1.2 0 0 1 16 4.2V15.8A1.2 1.2 0 0 1 14.8 17H13.2A1.2 1.2 0 0 1 12 15.8V4.2A1.2 1.2 0 0 1 13.2 3Z"/></svg>',
            error: '<svg data-icon="WARNING" aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 3.2L17.4 16H2.6Z"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M10 3.2L17.4 16H2.6ZM10 7H10A1 1 0 0 1 11 8V10.6A1 1 0 0 1 10 11.6H10A1 1 0 0 1 9 10.6V8A1 1 0 0 1 10 7ZM10 12.45A1.15 1.15 0 1 0 10 14.75A1.15 1.15 0 1 0 10 12.45Z"/></svg>',
            complete: '<svg data-icon="CHECK" aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 10.6L8 14.6L16 5.4"/></svg>'
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

    // ---------- Texts ----------

    /** The text under `downloads.<key>`, with `{name}` placeholders filled in. */
    function t(key, params = null) {
        const text = String(i18n.get(`downloads.${key}`));
        if (!params) return text;
        return text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
    }

    function locale() {
        return i18n.currentLocale === 'ru' ? 'ru-RU' : 'en-US';
    }

    /** The noun form for `count` from `downloads.plural.<noun>_one|_few|_many`. */
    function plural(count, noun) {
        let category = 'many';
        try {
            category = new Intl.PluralRules(i18n.currentLocale).select(Number(count));
        } catch { /* falls back to the general form */ }
        const form = category === 'one' || category === 'few' ? category : 'many';
        return t(`plural.${noun}_${form}`);
    }

    function number(value, digits = 1) {
        return Number(value).toLocaleString(locale(), { maximumFractionDigits: digits, minimumFractionDigits: 0 });
    }

    function formatBytes(value) {
        const bytes = Number(value);
        if (!Number.isFinite(bytes) || bytes <= 0) return `0 ${t('units.b')}`;
        if (bytes < 1024) return `${Math.round(bytes)} ${t('units.b')}`;
        const units = ['kb', 'mb', 'gb', 'tb'];
        let amount = bytes;
        let unit = -1;
        do {
            amount /= 1024;
            unit += 1;
        } while (amount >= 1024 && unit < units.length - 1);
        return `${number(amount, amount >= 100 ? 0 : 1)} ${t(`units.${units[unit]}`)}`;
    }

    function formatRate(value) {
        const rate = Number(value);
        return t('units.rate', { size: formatBytes(Number.isFinite(rate) && rate > 0 ? rate : 0) });
    }

    function formatEta(value) {
        const seconds = Number(value);
        if (!Number.isFinite(seconds) || seconds <= 0) return '';
        if (seconds < 60) return t('eta.less_than_minute');
        const minutes = Math.round(seconds / 60);
        if (minutes < 60) return t('eta.minutes', { minutes });
        const hours = Math.floor(minutes / 60);
        if (hours < 48) return t('eta.hours', { hours, minutes: minutes % 60 });
        return t('eta.days', { days: Math.round(hours / 24) });
    }

    function formatAgo(value) {
        const time = Date.parse(String(value || ''));
        if (!Number.isFinite(time)) return '';
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const startOfToday = today.getTime();
        if (time >= startOfToday) return t('ago.today');
        if (time >= startOfToday - 86400000) return t('ago.yesterday');
        const days = Math.ceil((startOfToday - time) / 86400000);
        return t('ago.days', { count: days, days: plural(days, 'day') });
    }

    function formatClock(time) {
        return new Date(time).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
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
            // Paint in the last known language at once; init() confirms it from storage.
            i18n.restoreLanguage();
            this.translateStatic();
            await i18n.init();
            this.renderedLocale = i18n.currentLocale;
            this.translateStatic();
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

        /** Markup texts (`data-i18n`) plus the few attributes one `data-i18n` cannot carry. */
        translateStatic() {
            i18n.translatePage();
            document.title = t('page_title');
            this.elements.search?.setAttribute('aria-label', t('controls.search_label'));
        }

        /**
         * Settings changed the language: repaint every text on the page. Cards are
         * rebuilt because their signature holds the locale.
         */
        async handleSettingsUpdate(settings) {
            if (!settings?.language || settings.language === this.renderedLocale) return;
            const refreshId = this.localeRefreshId = (this.localeRefreshId || 0) + 1;
            await i18n.init();
            if (refreshId !== this.localeRefreshId || i18n.currentLocale === this.renderedLocale) return;
            this.renderedLocale = i18n.currentLocale;
            this.translateStatic();
            if (this.elements.empty) delete this.elements.empty.dataset.kind;
            this.render();
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
            return this.metaFor(item)?.name || item.title || t('untitled');
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
            chrome.runtime?.onMessage?.addListener?.((message) => {
                if (message?.type === 'SETTINGS_UPDATED') void this.handleSettingsUpdate(message.settings);
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
            if (this.service?.isServiceUnavailableError?.(error)) return t('errors.unavailable');
            return error?.message || t('errors.action_failed');
        }

        async handleAction(action, id, key) {
            if (action === 'toggle') {
                if (this.collapsed.has(key)) this.collapsed.delete(key);
                else this.collapsed.add(key);
                this.render();
                return;
            }
            if (action === 'play-blocked') {
                toast(t('toast.play_blocked'), 'info');
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
                return code ? t('confirm.what_episode', { title, code }) : t('confirm.what_title', { title });
            }
            const count = records.length;
            if (seriesTitle) return t('confirm.what_episodes', { count, episodes: plural(count, 'episode'), title: seriesTitle });
            return t('confirm.what_downloads', { count, downloads: plural(count, 'download') });
        }

        async deleteRecords(records, { seriesTitle = '' } = {}) {
            if (!records.length || this.bulkBusy) return false;
            const bytes = records.reduce((sum, record) => sum + Model.downloadedBytes(record), 0);
            const unfinished = records.some(record => record.status !== 'complete');
            const what = this.describeRecords(records, seriesTitle);
            const message = t('confirm.message', { what, size: formatBytes(bytes) })
                + (unfinished ? t('confirm.unfinished') : '') + t('confirm.keep');
            const confirmed = await window.ConfirmDialog?.confirm({
                title: records.length === 1
                    ? t('confirm.title_one')
                    : t('confirm.title_many', { count: records.length, downloads: plural(records.length, 'download_acc') }),
                message,
                confirmLabel: t('confirm.confirm'),
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
                toast(deleted.length > 1
                    ? t('toast.deleted_many', { count: deleted.length, size: formatBytes(freed) })
                    : t('toast.deleted_one', { size: formatBytes(freed) }), 'success');
            } else if (deleted.length) {
                toast(t('toast.deleted_partial', { done: deleted.length, total: records.length, error: this.errorText(failure) }), 'error');
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
            const verb = action === 'pause' ? 'paused' : 'resumed';
            if (failure) {
                toast(t(`bulk.${verb}_partial`, { done, total: targets.length, error: this.errorText(failure) }), 'error');
            } else {
                toast(t(`bulk.${verb}`, { done }), 'success');
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
            if (elements.title) elements.title.textContent = t(`titles.${this.view.filter}`);

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
                [String(summary.cards), plural(summary.cards, 'download')],
                [formatBytes(summary.onDiskBytes), t('summary.on_disk')],
                [String(summary.activeCount), t('summary.active')],
                [stale ? '—' : formatRate(summary.downloadSpeed), t('summary.speed')]
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
                bannerTitle.textContent = t('banner.unavailable_title');
                bannerText.textContent = this.lastSuccessAt
                    ? t('banner.stale_text', { time: formatClock(this.lastSuccessAt), seconds })
                    : t('banner.offline_text', { seconds });
            } else {
                bannerTitle.textContent = t('banner.failed_title');
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
                    ? t('storage.retention_forever')
                    : t('storage.retention_days', { count: days, days: plural(days, 'day') });
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
                    title: t('empty.off_title'),
                    text: t('empty.off_text'),
                    action: () => {
                        const link = el('a', 'btn btn-primary', t('empty.off_action'));
                        link.href = this.settingsUrl();
                        return link;
                    }
                },
                none: {
                    icon: ICONS.film,
                    title: t('empty.none_title'),
                    text: t('empty.none_text')
                },
                filter: {
                    icon: ICONS.film,
                    title: t('empty.filter_title'),
                    text: t('empty.filter_text'),
                    action: () => {
                        const button = el('button', 'btn btn-secondary', t('empty.filter_action'));
                        button.type = 'button';
                        button.dataset.action = 'show-all';
                        return button;
                    }
                },
                search: {
                    icon: ICONS.film,
                    title: t('empty.search_title'),
                    text: t('empty.search_text'),
                    action: () => {
                        const button = el('button', 'btn btn-secondary', t('empty.search_action'));
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
            bulkCount.textContent = t('bulk.selected', { count: summary.count, size: formatBytes(summary.bytes) });
            bulkPause.textContent = summary.pausable.length ? t('bulk.pause_count', { count: summary.pausable.length }) : t('bulk.pause');
            bulkResume.textContent = summary.resumable.length ? t('bulk.resume_count', { count: summary.resumable.length }) : t('bulk.resume');
            bulkDelete.textContent = t('bulk.delete_count', { count: summary.count });
            bulkPause.disabled = offline || this.bulkBusy || !summary.pausable.length;
            bulkResume.disabled = offline || this.bulkBusy || !summary.resumable.length;
            bulkDelete.disabled = offline || this.bulkBusy;
            bulkPause.title = offline ? t('actions.offline') : (summary.pausable.length ? '' : t('bulk.no_pausable'));
            bulkResume.title = offline ? t('actions.offline') : (summary.resumable.length ? '' : t('bulk.no_resumable'));
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
                i18n.currentLocale,
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
                this.buildCheckbox([record.id], t('card.select', { title }), this.selected.has(record.id) ? 'all' : 'none'),
                this.buildPoster(item)
            );

            const body = el('div', 'dl-card__body');
            const kind = item.linked ? t(item.mediaType === 'tv' ? 'card.kind_series' : 'card.kind_movie') : t('card.unlinked');
            body.append(this.buildTitle(item, kind));
            const release = [record.quality || t('card.quality_unknown'), record.provider].filter(Boolean).join(' · ');
            const releaseLine = el('div', 'dl-card__release', release);
            releaseLine.title = release;
            body.append(releaseLine, this.buildLive(record));
            if (!item.linked) {
                const note = el('span', 'dl-note');
                note.append(icon(ICONS.link), document.createTextNode(t('card.unlinked_note')));
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
                this.buildCheckbox(records.map(record => record.id), t('card.select_series', { title }), selection),
                this.buildPoster(item)
            );

            const all = item.records;
            const ready = all.filter(record => record.status === 'complete').length;
            const active = all.filter(Model.isActive).length;
            const size = all.reduce((sum, record) => sum + Model.totalBytes(record), 0);
            const parts = [
                t('card.episodes', { count: all.length, episodes: plural(all.length, 'episode') }),
                formatBytes(size),
                t('card.ready', { ready, total: all.length })
            ];
            if (active) parts.push(t('card.downloading', { count: active }));

            const body = el('div', 'dl-card__body');
            body.append(this.buildTitle(item, t('card.kind_series')), el('div', 'dl-card__release', parts.join(' · ')));
            const collapsed = this.collapsed.has(item.key);
            const toggle = el('button', 'dl-toggle');
            toggle.type = 'button';
            toggle.dataset.action = 'toggle';
            toggle.dataset.key = item.key;
            toggle.dataset.focusKey = `toggle:${item.key}`;
            toggle.setAttribute('aria-expanded', String(!collapsed));
            toggle.append(icon(ICONS.chevron), document.createTextNode(collapsed ? t('card.show_episodes', { count: records.length }) : t('card.hide_episodes')));
            body.append(toggle);

            const actions = el('div', 'dl-actions');
            actions.append(this.pageLink(item, t('card.series_page')));
            const removeAll = this.iconButton('delete-series', '', t('card.delete_series', { title }), ICONS.delete, {
                danger: true,
                disabled: this.health !== 'healthy' || this.bulkBusy,
                reason: t('actions.offline'),
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
                    this.buildCheckbox([record.id], t('card.select', { title: label }), this.selected.has(record.id) ? 'all' : 'none'),
                    el('span', 'dl-episode__code', code || t('card.file'))
                );
                const rowBody = el('div', 'dl-episode__body');
                const name = [record.selectedFile?.name && !code ? record.selectedFile.name : '', record.quality, record.provider]
                    .filter(Boolean).join(' · ');
                rowBody.append(el('div', 'dl-episode__name', name || t('card.quality_unknown')), this.buildLive(record));
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
            link.setAttribute('aria-label', t('card.page_label', { label, title: this.displayTitle(item) }));
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
            const text = disabled && reason ? t('card.disabled_reason', { label, reason }) : label;
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
            const reason = offline ? t('actions.offline') : (busy ? t('actions.busy') : '');
            const blocked = offline || busy;
            const episodeKnown = item.mediaType !== 'tv' || Model.hasEpisode(record);

            if (Model.canPlay(record)) {
                if (!item.linked || !episodeKnown) {
                    const play = this.textButton('play-blocked', record.id, t('actions.watch'), ICONS.play);
                    play.setAttribute('aria-disabled', 'true');
                    play.title = !item.linked ? t('actions.not_linked') : t('actions.episode_unknown');
                    if (compact) {
                        play.className = 'dl-icon-btn';
                        play.replaceChildren(icon(ICONS.play));
                        play.setAttribute('aria-label', t('actions.watch_blocked', { title, reason: play.title }));
                    }
                    actions.append(play);
                } else if (compact) {
                    actions.append(this.iconButton('play', record.id, t('actions.watch_title', { title }), ICONS.play, { disabled: offline, reason }));
                } else {
                    actions.append(this.textButton('play', record.id, t('actions.watch'), ICONS.play, { primary: true, disabled: offline, reason }));
                }
            }
            if (Model.canPause(record)) {
                actions.append(this.iconButton('pause', record.id, t('actions.pause_title', { title }), ICONS.pause, { disabled: blocked, reason }));
            } else if (Model.canResume(record)) {
                const label = record.status === 'error' ? t('actions.retry') : t('actions.resume');
                const markup = record.status === 'error' ? ICONS.retry : ICONS.resume;
                actions.append(compact
                    ? this.iconButton('resume', record.id, t('actions.action_title', { label, title }), markup, { disabled: blocked, reason })
                    : this.textButton('resume', record.id, label, markup, { disabled: blocked, reason }));
            }
            if (!compact && item.linked) actions.append(this.pageLink(item, t(item.mediaType === 'tv' ? 'card.series_page' : 'card.movie_page')));
            actions.append(this.iconButton('delete', record.id, t('actions.delete_title', { title }), ICONS.delete, { danger: true, disabled: blocked, reason }));
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
            const label = t(STATUSES.includes(status) ? `status.${status}` : 'status.unknown');
            state.append(document.createTextNode(status === 'complete' ? label : `${label} · ${percent}%`));
            line.append(state);

            const details = [];
            if (status === 'complete') {
                details.push(formatBytes(total));
                const ago = formatAgo(record.completedAt);
                if (ago) details.push(t('live.downloaded_ago', { ago }));
            } else {
                details.push(total ? t('live.progress', { have: formatBytes(have), total: formatBytes(total) }) : formatBytes(have));
                if (!stale && Model.isActive(record)) {
                    details.push(formatRate(record.downloadSpeedBytesPerSecond));
                    details.push(t('live.peers', { count: Math.max(0, Number(record.peers) || 0) }));
                    const eta = formatEta(record.timeRemainingSeconds);
                    if (eta) details.push(t('live.remaining', { eta }));
                }
            }
            if (stale) details.push(t('live.stale'));
            line.append(el('span', '', details.join(' · ')));
            if (status === 'error') {
                line.append(el('span', 'dl-status__error', record.errorMessage || t('live.error_default')));
            }

            const parts = [line];
            if (status !== 'complete') {
                const bar = el('div', 'dl-progress');
                bar.setAttribute('role', 'progressbar');
                bar.setAttribute('aria-valuemin', '0');
                bar.setAttribute('aria-valuemax', '100');
                bar.setAttribute('aria-valuenow', String(percent));
                bar.setAttribute('aria-label', t('live.progress_label', { percent }));
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
                parts.push(el('span', 'dl-note', t('live.playable')));
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
