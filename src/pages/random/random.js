
import { i18n } from '../../shared/i18n/I18n.js';
import { RandomWheelAudio } from './RandomWheelAudio.js';

const DEFAULT_SPINNER_POSTER = '/src/shared/assets/icons/app/icon128-white.png';
const PREVIEW_POSTERS = [];
const DEFAULT_ROLL_DURATION_SECONDS = 6;
const MIN_ROLL_DURATION_SECONDS = 2;
const MAX_ROLL_DURATION_SECONDS = 1800;
const ROLL_DURATION_STORAGE_KEY = 'random_wheel_duration_seconds';
const ROLL_VOLUME_STORAGE_KEY = 'random_wheel_volume_percent';
const RECENT_RESULTS_STORAGE_KEY = 'random_recent_results';
const SKIP_SEEN_STORAGE_KEY = 'random_skip_seen';
const RECENT_RESULTS_LIMIT = 30;
// Kinopoisk draws per roll while looking for an unseen movie; each costs API quota.
const SKIP_SEEN_MAX_ATTEMPTS = 3;
const DEFAULT_ROLL_VOLUME_PERCENT = 100;
function getSafePosterUrl(value) {
    return typeof PosterUrl !== 'undefined' ? PosterUrl.safe(value) : '';
}

function getMarathonPosterUrls(value, kpId) {
    const urls = [];
    const savedUrl = getSafePosterUrl(value);
    if (savedUrl) urls.push(savedUrl);

    const movieId = Number(kpId);
    if (Number.isSafeInteger(movieId) && movieId > 0) {
        const fallbackUrl = `https://st.kp.yandex.net/images/film_iphone/iphone360_${movieId}.jpg`;
        if (!urls.includes(fallbackUrl)) urls.push(fallbackUrl);
    }

    return urls;
}

/**
 * RandomManager - Controller for the Random Movie page
 */
class RandomManager {
    constructor() {
        this.types = [];
        this.genres = [];
        this.countries = [];
        this.elements = {
            typeTags: document.getElementById('typeTags'),
            genreTags: document.getElementById('genreTags'),
            countryTags: document.getElementById('countryTags'),
            yearFrom: document.getElementById('yearFrom'),
            yearTo: document.getElementById('yearTo'),
            ratingFrom: document.getElementById('ratingFrom'),
            ratingTo: document.getElementById('ratingTo'),
            votesFrom: document.getElementById('votesFrom'),
            votesTo: document.getElementById('votesTo'),
            resetBtn: document.getElementById('resetFiltersBtn'),
            rollDiceBtn: document.getElementById('rollDiceBtn'),
            initialState: document.getElementById('initialState'),
            loadingState: document.getElementById('loadingState'),
            resultContainer: document.getElementById('resultContainer'),
            movieResult: document.getElementById('movieResult'),
            errorState: document.getElementById('errorState'),
            configHeader: document.getElementById('configHeader'),
            configBody: document.getElementById('configBody'),
            toggleConfigBtn: document.getElementById('toggleConfigBtn'),
            tryAgainBtn: document.getElementById('tryAgainBtn')
        };

        this.kinopoiskService = new KinopoiskService();

        // ── Pool State ──
        this.pool = [];        // [{ kpId, title, year, poster, rating }]
        this.currentMovie = null;
        this.POOL_KEY = 'randomPool';
        this._searchTimer = null;
        this._poolSearchId = 0;
        this._marathonSearchId = 0;
        this._requestId = 0;
        this._findBusy = false;
        this._posterSpinId = 0;
        this._modalFocus = new Map();
        this._modalKeyHandlers = [];
        this.rollAnimRunning = false;
        this._rollAnimationId = 0;
        const storedRollVolume = localStorage.getItem(ROLL_VOLUME_STORAGE_KEY);
        const savedRollVolume = storedRollVolume === null ? DEFAULT_ROLL_VOLUME_PERCENT : Number(storedRollVolume);
        this.rollVolumePercent = Number.isInteger(savedRollVolume) && savedRollVolume >= 0 && savedRollVolume <= 100
            ? savedRollVolume : DEFAULT_ROLL_VOLUME_PERCENT;
        this._rollAudio = new RandomWheelAudio(this.rollVolumePercent / 100);
        window.addEventListener('pagehide', () => this._cleanup());
        const savedRollDuration = Number(localStorage.getItem(ROLL_DURATION_STORAGE_KEY));
        this.rollDurationSeconds = Number.isInteger(savedRollDuration)
            && savedRollDuration >= MIN_ROLL_DURATION_SECONDS
            && savedRollDuration <= MAX_ROLL_DURATION_SECONDS
            ? savedRollDuration : DEFAULT_ROLL_DURATION_SECONDS;
        this.marathonService = null;
        this.marathonState = { round: null, items: [] };
        this.marathonIsAdmin = false;
        this._marathonUnsubscribe = null;
        this._marathonSearchTimer = null;
        this._marathonMutationRunning = false;
        this._marathonPendingAction = null;
        this._marathonAuthRefreshId = 0;
        this._marathonPendingRemovals = new Set();
        this._marathonPendingAdds = new Map();

        this.init();

    }


    async init() {
        await i18n.init();
        if (this._disposed) return;
        // The wheel overlay is built from translated text, so the locale must be loaded first.
        this._buildRollOverlay();
        i18n.translatePage();
        
        this.populateFilterData();
        this.renderTags();
        this.setupSliders();
        this.loadPreferences();
        this._renderConfigSummary();
        this.setupEventListeners();
        await this.loadPool();
        if (this._disposed) return;
        await this.initMarathon();
        if (this._disposed) return;

        // Listen for language changes
        this._settingsMessageHandler = (message) => {
            if (message.type === 'SETTINGS_UPDATED') {
                this.handleSettingsUpdate(message.settings);
            }
        };
        chrome.runtime.onMessage.addListener(this._settingsMessageHandler);
    }

    async handleSettingsUpdate(settings) {
        if (settings.language && settings.language !== this._renderedLocale) {
            const localeId = this._localeRefreshId = (this._localeRefreshId || 0) + 1;
            await i18n.init();
            if (!this._disposed && localeId === this._localeRefreshId) {
                const filters = this.getFilters();
                i18n.translatePage();
                this.populateFilterData();
                this.renderTags();
                this._restoreTagFilters(filters);
                this._renderConfigSummary();
                // Marathon and pool text is rendered from the locale, not data-i18n.
                this._renderMarathon();
                this._refreshPoolModalIfOpen();
                this.setupSliders();
                if (this.currentMovie && !this._findBusy && this.elements.movieResult.style.display !== 'none') {
                    const focused = document.activeElement;
                    const focusClass = ['cmc-reload-btn', 'cmc-pool-btn', 'cmc-watch-btn'].find(name => focused?.classList.contains(name));
                    await this.displayMovie(this.currentMovie, { transition: false });
                    if (focusClass) this.elements.movieResult.querySelector(`.${focusClass}`)?.focus();
                }
                if (this.elements.errorState.style.display !== 'none' && this._failureKind) this._showFailure(this._failureKind);
            }
        }
    }

    populateFilterData() {
        Object.assign(this, DiscoveryFilters.getOptions(i18n));
    }

    setupSliders() {
        this.rangeControls?.forEach(control => control.destroy());
        this.rangeControls = [];
        this.initDoubleSlider('year', 1900, 2030, 0); // min gap 0
        this.initDoubleSlider('rating', 1, 10, 0.5); // min gap 0.5
        this.initDoubleSlider('votes', 0, 2000000, 1000); // Votes
    }

    initDoubleSlider(idPrefix, minLimit, maxLimit, minGap) {
        const formatValue = val => {
            if (idPrefix === 'votes') {
                if (val >= 1000000) return (val / 1000000).toFixed(1) + 'M';
                if (val >= 1000) return (val / 1000).toFixed(0) + 'k';
            }
            return val;
        };
        const fieldLabel = document.getElementById(`${idPrefix}Slider`).parentElement.querySelector('label').textContent.trim();
        const control = RangeControl.enhance(document.getElementById(`${idPrefix}From`), document.getElementById(`${idPrefix}To`), {
            min: minLimit, max: maxLimit, minGap,
            fromDisplay: document.getElementById(`${idPrefix}MinDisplay`),
            toDisplay: document.getElementById(`${idPrefix}MaxDisplay`),
            rangeBar: document.getElementById(`${idPrefix}RangeBar`),
            formatValue,
            fromLabel: `${fieldLabel}: ${i18n.get('random.config.min')}`,
            toLabel: `${fieldLabel}: ${i18n.get('random.config.max')}`,
            fromFieldLabel: i18n.get('random.config.min'),
            toFieldLabel: i18n.get('random.config.max'),
            onCommit: () => this.savePreferences()
        });
        this.rangeControls.push(control);
    }

    renderTags() {
        this._renderedLocale = i18n.currentLocale;
        let legendId = null;
        for (const [type, values, container] of [
            ['type', this.types, this.elements.typeTags],
            ['genre', this.genres, this.elements.genreTags],
            ['country', this.countries, this.elements.countryTags]
        ]) {
            container.replaceChildren(...values.map(value => this.createTag(value, type)));
            const label = container.parentElement.querySelector('label')?.textContent.trim() || '';
            FilterChoice.enhanceGroup(container, {
                label, labels: this.getChoiceStateLabels(),
                legendLabels: this.getChoiceStateLegendLabels(),
                showLegend: legendId === null, legendId, compactLimit: 6,
                moreLabel: i18n.get('filter_controls.more'), lessLabel: i18n.get('filter_controls.less')
            });
            legendId ||= container.querySelector('.filter-choices__legend')?.id || null;
        }
    }

    getChoiceStateLabels() {
        return Object.fromEntries(['neutral', 'include', 'exclude'].map(state => [state, i18n.get(`random.tag_states.${state}`)]));
    }

    getChoiceStateLegendLabels() {
        return Object.fromEntries(['neutral', 'include', 'exclude'].map(state => [state, i18n.get(`random.tag_state_legend.${state}`)]));
    }

    createTag(data, type) {
        const label = typeof data === 'object' && data !== null ? data.label : data;
        const value = typeof data === 'object' && data !== null ? data.value : data;
        const button = FilterChoice.create({ label, value, className: 'tag-btn', labels: this.getChoiceStateLabels() });
        button.dataset.type = type;
        return button;
    }

    _setTagState(button, state) {
        FilterChoice.setState(button, state, { emit: false });
    }

    _restoreTagFilters(filters) {
        for (const button of document.querySelectorAll('.tag-btn')) {
            const keys = { type: 'types', genre: 'genres', country: 'countries' };
            const key = keys[button.dataset.type];
            const exclude = `exclude${key[0].toUpperCase()}${key.slice(1)}`;
            const state = Array.isArray(filters[exclude]) && filters[exclude].includes(button.dataset.value) ? 'exclude'
                : Array.isArray(filters[key]) && filters[key].includes(button.dataset.value) ? 'include' : 'neutral';
            this._setTagState(button, state);
        }
    }

    setDefaultFilters() {
        // Set default values for sliders
        const filterIds = {
            'yearFrom': 1990,
            'yearTo': 2026,
            'ratingFrom': 7,
            'ratingTo': 10,
            'votesFrom': 10000,
            'votesTo': 2000000
        };

        Object.keys(filterIds).forEach(id => {
            const el = document.getElementById(id);
            if(el) {
                el.value = filterIds[id];
                // Trigger input event to update slider visuals
                el.dispatchEvent(new Event('input'));
            }
        });
        this.rangeControls?.forEach(control => control.syncFromNative());
    }

    setupEventListeners() {
        // Use Delegation for Tags
        document.body.addEventListener('click', (e) => {
            const btn = e.target.closest('.tag-btn');
            if (btn) {
                this.handleTagClick(btn);
            }
        });

        // Reset
        this.elements.resetBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent header toggle
            this.resetFilters();
        });

        // Toggle Config
        if (this.elements.configHeader) {
            this.elements.configHeader.addEventListener('click', () => this.toggleConfig());
        }

        // Roll Dice
        this.elements.rollDiceBtn.addEventListener('click', () => this.findRandomMovie());

        const skipSeenToggle = document.getElementById('skipSeenToggle');
        if (skipSeenToggle) {
            try {
                skipSeenToggle.checked = localStorage.getItem(SKIP_SEEN_STORAGE_KEY) !== 'false';
            } catch {
                // Default stays on.
            }
            skipSeenToggle.addEventListener('change', () => {
                try {
                    localStorage.setItem(SKIP_SEEN_STORAGE_KEY, String(skipSeenToggle.checked));
                } catch {
                    // The toggle still applies to this page view.
                }
            });
        }

        // Try Again
        if (this.elements.tryAgainBtn) {
            this.elements.tryAgainBtn.addEventListener('click', () => {
                if (this._failureKind === 'network') this.findRandomMovie(this._lastRandomFilters);
                else {
                    this.resetFilters();
                    this.toggleConfig(true);
                }
            });
        }

        this.setupPoolListeners();
        this._setupRollShortcut();
    }

    toggleConfig(forceState = null) {
        const body = this.elements.configBody;
        const btn = this.elements.toggleConfigBtn;
        
        if (!body || !btn) return;

        const icon = btn.querySelector('.icon-chevron');
        const isCollapsed = body.classList.contains('collapsed');
        const shouldExpand = forceState !== null ? forceState : isCollapsed;
        this.elements.configHeader.setAttribute('aria-expanded', String(shouldExpand));
        body.inert = !shouldExpand;

        if (shouldExpand) {
            body.classList.remove('collapsed');
            if (icon) icon.style.transform = 'rotate(180deg)';
        } else {
            body.classList.add('collapsed');
            if (icon) icon.style.transform = 'rotate(0deg)';
        }
    }

    handleTagClick(btn) {
        // FilterChoice owns the state cycle before this delegated persistence handler.
        this.savePreferences();
    }

    resetFilters() {
        this._cancelMovieRequest();
        document.querySelectorAll('.tag-btn').forEach(btn => {
            this._setTagState(btn, 'neutral');
        });
        
        this.setDefaultFilters();
        this.savePreferences();
        this.showState('initial');
    }

    getFilters() {
        const filters = {
            yearFrom: document.getElementById('yearFrom').value,
            yearTo: document.getElementById('yearTo').value,
            ratingFrom: document.getElementById('ratingFrom').value,
            ratingTo: document.getElementById('ratingTo').value,
            votesFrom: document.getElementById('votesFrom').value,
            votesTo: document.getElementById('votesTo').value,
            countries: [],
            excludeCountries: [],
            genres: [],
            excludeGenres: [],
            types: [],
            excludeTypes: []
        };

        document.querySelectorAll('.tag-btn').forEach(btn => {
            const state = btn.dataset.state;
            const value = btn.dataset.value;
            const type = btn.dataset.type; // 'genre' or 'country' or 'type'

            if (state === 'include') {
                if (type === 'type') filters.types.push(value);
                if (type === 'genre') filters.genres.push(value);
                if (type === 'country') filters.countries.push(value);
            } else if (state === 'exclude') {
                if (type === 'type') filters.excludeTypes.push(value);
                if (type === 'genre') filters.excludeGenres.push(value);
                if (type === 'country') filters.excludeCountries.push(value);
            }
        });

        return filters;
    }

    savePreferences() {
        const filters = this.getFilters();
        const prefs = {
            year: { from: filters.yearFrom, to: filters.yearTo },
            rating: { from: filters.ratingFrom, to: filters.ratingTo },
            votes: { from: filters.votesFrom, to: filters.votesTo },
            types: filters.types,
            excludeTypes: filters.excludeTypes,
            genres: filters.genres,
            excludeGenres: filters.excludeGenres,
            countries: filters.countries,
            excludeCountries: filters.excludeCountries
        };
        localStorage.setItem('random_filter_preferences', JSON.stringify(prefs));
        this._renderConfigSummary();
    }

    /** One-line digest of the active filters, readable while the panel is collapsed. */
    _renderConfigSummary() {
        const summary = document.getElementById('configSummary');
        if (!summary) return;
        const filters = this.getFilters();
        const parts = [
            `${filters.yearFrom}–${filters.yearTo}`,
            `★ ${Number(filters.ratingFrom).toFixed(1)}–${Number(filters.ratingTo).toFixed(1)}`
        ];
        const tags = [...document.querySelectorAll('.tag-btn')]
            .filter(button => button.dataset.state === 'include' || button.dataset.state === 'exclude')
            .map(button => {
                const text = button.querySelector('.tag-text')?.textContent || button.dataset.value;
                return button.dataset.state === 'exclude' ? `−${text}` : text;
            });
        const visibleTags = tags.slice(0, 4);
        if (tags.length > visibleTags.length) visibleTags.push(`+${tags.length - visibleTags.length}`);
        if (visibleTags.length) parts.push(visibleTags.join(', '));
        summary.textContent = parts.join(' · ');
    }

    loadPreferences() {
        const saved = localStorage.getItem('random_filter_preferences');
        if (!saved) return;

        try {
            const prefs = JSON.parse(saved);
            if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) return;

            // Restore sliders
            for (const [prefix, low, high, gap, defaultFrom, defaultTo] of [
                ['year', 1900, 2030, 0, 1990, 2026], ['rating', 1, 10, 0.5, 7, 10],
                ['votes', 0, 2000000, 1000, 10000, 2000000]
            ]) {
                const range = prefs[prefix] || {};
                const normalize = (value, fallback) => value !== null && value !== '' && value !== undefined && Number.isFinite(Number(value))
                    ? Math.max(low, Math.min(high, Number(value))) : fallback;
                let from = normalize(range.from, defaultFrom);
                let to = normalize(range.to, defaultTo);
                if (from > to) [from, to] = [to, from];
                to = Math.min(high, Math.max(to, from + gap));
                from = Math.max(low, Math.min(from, to - gap));
                const minInput = document.getElementById(`${prefix}From`);
                const maxInput = document.getElementById(`${prefix}To`);
                minInput.value = from;
                maxInput.value = to;
                minInput.dispatchEvent(new Event('input'));
            }

            // Restore tags
            const restoreTags = (tagList, type, state) => {
                if (!tagList || !Array.isArray(tagList)) return;
                tagList.forEach(value => {
                    const btn = Array.from(document.querySelectorAll('.tag-btn')).find(button => button.dataset.value === value && button.dataset.type === type);
                    if (btn) {
                        this._setTagState(btn, state);
                    }
                });
            };

            restoreTags(prefs.types, 'type', 'include');
            restoreTags(prefs.excludeTypes, 'type', 'exclude');
            restoreTags(prefs.genres, 'genre', 'include');
            restoreTags(prefs.excludeGenres, 'genre', 'exclude');
            restoreTags(prefs.countries, 'country', 'include');
            restoreTags(prefs.excludeCountries, 'country', 'exclude');
            this.rangeControls?.forEach(control => control.syncFromNative());

        } catch {
            console.error('Failed to load preferences');
        }
    }

    async findRandomMovie(retryFilters = null) {
        if (this._findBusy || this._disposed) return;
        clearTimeout(this._reloadTimer);
        this._cancelResultTransition();
        const requestId = ++this._requestId;
        this._findBusy = true;
        this.showState('loading');
        this.toggleConfig(false); // Collapse config to show result
        
        try {
            const filters = retryFilters || this.getFilters();
            this._lastRandomFilters = filters;
            
            // Wait for auth to be ready if needed, mostly for services
            if (window.firebaseManager) {
                await window.firebaseManager.waitForAuthReady();
            }
            if (requestId !== this._requestId || this._disposed) return;

            const movie = await this._getUnseenRandomMovie(filters, requestId);
            if (requestId !== this._requestId || this._disposed) return;
            if (movie) this._rememberRecentResult(movie);

            if (movie) {
                await this.displayMovie(movie, { requestId });
            } else {
                this._showFailure('empty');
            }

        } catch (error) {
            console.error('Error finding random movie:', error);
            if (requestId === this._requestId && !this._disposed) this._showFailure('network');
        } finally {
            if (requestId === this._requestId) this._findBusy = false;
        }
    }

    _isSkipSeenEnabled() {
        return document.getElementById('skipSeenToggle')?.checked !== false;
    }

    _readRecentResults() {
        try {
            const list = JSON.parse(localStorage.getItem(RECENT_RESULTS_STORAGE_KEY) || '[]');
            return Array.isArray(list) ? list.map(String) : [];
        } catch {
            return [];
        }
    }

    _rememberRecentResult(movie) {
        const id = movie?.id ?? movie?.kinopoiskId;
        if (id === undefined || id === null) return;
        const list = [String(id), ...this._readRecentResults().filter(item => item !== String(id))];
        try {
            localStorage.setItem(RECENT_RESULTS_STORAGE_KEY, JSON.stringify(list.slice(0, RECENT_RESULTS_LIMIT)));
        } catch {
            // History is a convenience; rolling still works without it.
        }
    }

    /**
     * Whether the signed-in user rated this movie. One batched query pair per
     * candidate (it also matches legacy string IDs); answers are remembered per
     * user for the page session, so repeated draws of a title cost nothing.
     */
    async _isRatedByUser(id, user) {
        if (!user?.uid) return false;
        const ratingService = typeof firebaseManager !== 'undefined' ? firebaseManager.getRatingService?.() : null;
        if (!ratingService?.getUserRatingsForMovies) return false;
        if (this._ratedCheckUid !== user.uid) {
            this._ratedCheckUid = user.uid;
            this._ratedCheckCache = new Map();
        }
        const key = String(Number(id));
        if (!this._ratedCheckCache.has(key)) {
            const ratings = await ratingService.getUserRatingsForMovies(user.uid, [Number(id)]);
            this._ratedCheckCache.set(key, Number(ratings?.get?.(key)?.rating) > 0);
        }
        return this._ratedCheckCache.get(key);
    }

    async _isSeenMovie(movie, recent, user) {
        const id = movie?.id ?? movie?.kinopoiskId;
        if (id === undefined || id === null) return false;
        if (recent.has(String(id))) return true;
        return this._isRatedByUser(id, user);
    }

    /** Draw until an unrated, not recently shown movie appears; fall back to the last draw. */
    async _getUnseenRandomMovie(filters, requestId) {
        if (!this._isSkipSeenEnabled()) return this.kinopoiskService.getRandomMovie(filters);
        const recent = new Set(this._readRecentResults());
        const user = typeof firebaseManager !== 'undefined' ? firebaseManager.getCurrentUser?.() : null;
        let movie = null;
        for (let attempt = 0; attempt < SKIP_SEEN_MAX_ATTEMPTS; attempt++) {
            let candidate;
            try {
                candidate = await this.kinopoiskService.getRandomMovie(filters);
            } catch (error) {
                // A later draw failing must not discard a movie already in hand.
                if (movie) return movie;
                throw error;
            }
            if (requestId !== this._requestId || this._disposed || !candidate) return candidate || movie;
            movie = candidate;
            let seen = false;
            try {
                seen = await this._isSeenMovie(candidate, recent, user);
            } catch {
                // An unavailable rating check shows the candidate rather than failing the roll.
            }
            if (!seen) return candidate;
        }
        return movie;
    }

    _showFailure(kind) {
        this._failureKind = kind;
        document.getElementById('randomFailureText').textContent = i18n.get(`random.states.${kind === 'empty' ? 'no_movie' : 'load_error'}`);
        document.getElementById('randomFailureHint').textContent = i18n.get(`random.states.${kind === 'empty' ? 'relax_filters' : 'load_error_hint'}`);
        this.elements.tryAgainBtn.textContent = i18n.get(`random.states.${kind === 'empty' ? 'relax_action' : 'retry_load'}`);
        this._renderRelaxSuggestions(kind === 'empty' ? this._lastRandomFilters : null);
        this.showState('error');
    }

    _stateText(key, params = {}) {
        let text = i18n.get(`random.states.${key}`);
        Object.entries(params).forEach(([name, value]) => { text = text.replaceAll(`{${name}}`, String(value)); });
        return text;
    }

    /** Each suggestion loosens one filter, saves it and rolls again. */
    _getRelaxSuggestions(filters) {
        if (!filters) return [];
        const setRange = (prefix, from, to) => {
            const minInput = document.getElementById(`${prefix}From`);
            const maxInput = document.getElementById(`${prefix}To`);
            if (from !== null && minInput) minInput.value = from;
            if (to !== null && maxInput) maxInput.value = to;
            minInput?.dispatchEvent(new Event('input'));
        };
        const suggestions = [];
        if (Number(filters.votesFrom) > 1000) {
            suggestions.push({ label: this._stateText('relax_votes', { count: (1000).toLocaleString(i18n.currentLocale) }), apply: () => setRange('votes', 1000, null) });
        }
        if (Number(filters.ratingFrom) > 6) {
            suggestions.push({ label: this._stateText('relax_rating', { value: '6.0' }), apply: () => setRange('rating', 6, null) });
        }
        if (Number(filters.yearFrom) > 1900 || Number(filters.yearTo) < 2030) {
            suggestions.push({ label: this._stateText('relax_years'), apply: () => setRange('year', 1900, 2030) });
        }
        const tagCount = ['genres', 'excludeGenres', 'countries', 'excludeCountries']
            .reduce((count, key) => count + (filters[key]?.length || 0), 0);
        if (tagCount > 0) {
            suggestions.push({
                label: this._stateText('relax_tags'),
                apply: () => document.querySelectorAll('.tag-btn[data-type="genre"], .tag-btn[data-type="country"]')
                    .forEach(button => this._setTagState(button, 'neutral'))
            });
        }
        return suggestions;
    }

    _renderRelaxSuggestions(filters) {
        let container = document.getElementById('randomRelaxOptions');
        if (!container) {
            container = document.createElement('div');
            container.id = 'randomRelaxOptions';
            container.className = 'random-relax-options';
            this.elements.tryAgainBtn.before(container);
        }
        const suggestions = this._getRelaxSuggestions(filters);
        container.replaceChildren();
        container.hidden = suggestions.length === 0;
        if (!suggestions.length) return;
        const title = document.createElement('p');
        title.className = 'random-relax-title';
        title.textContent = this._stateText('relax_suggestions');
        container.append(title);
        for (const suggestion of suggestions) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'btn random-relax-btn';
            button.textContent = suggestion.label;
            button.addEventListener('click', () => {
                suggestion.apply();
                this.rangeControls?.forEach(control => control.syncFromNative());
                this.savePreferences();
                this.findRandomMovie();
            });
            container.append(button);
        }
    }

    _cancelResultTransition() {
        clearTimeout(this._resultTimer);
        this._resultTimer = null;
        this._resultTransitionResolve?.();
        this._resultTransitionResolve = null;
    }

    _cancelMovieRequest() {
        this._requestId++;
        this._findBusy = false;
        clearTimeout(this._reloadTimer);
        this._cancelResultTransition();
    }

    _cleanup() {
        this._disposed = true;
        this.rangeControls?.forEach(control => control.destroy());
        this._marathonAuthRefreshId++;
        this._cancelMovieRequest();
        this._poolSearchId++;
        this._marathonSearchId++;
        clearTimeout(this._searchTimer);
        clearTimeout(this._marathonSearchTimer);
        this._stopPosterSpinning();
        this._stopRollAnimation();
        this._marathonUnsubscribe?.();
        for (const handler of this._modalKeyHandlers) document.removeEventListener('keydown', handler);
        if (this._rollShortcutHandler) document.removeEventListener('keydown', this._rollShortcutHandler);
        if (this._poolStorageHandler) chrome.storage.onChanged?.removeListener(this._poolStorageHandler);
        if (this._marathonAuthHandler) window.removeEventListener('authStateChanged', this._marathonAuthHandler);
        if (this._settingsMessageHandler) chrome.runtime.onMessage.removeListener(this._settingsMessageHandler);
    }

    async displayMovie(movie, { transition = true, requestId = this._requestId } = {}) {
        this.currentMovie = movie;  // ── Track current movie for pool feature
        this.elements.movieResult.innerHTML = '';
        
        // Use MovieCard component's compact detail view
        if (typeof MovieCard !== 'undefined') {
            // Create compact detailed card
            const card = MovieCard.createCompactDetail(movie);
            
            // Setup poster zoom listener
            const posterImg = card.querySelector('.cmc-poster');
            if (posterImg && typeof window.ImageLightbox !== 'undefined') {
                posterImg.style.cursor = 'zoom-in';
                this._makePosterAccessible(posterImg, movie.name);
            }
            
            this.elements.movieResult.innerHTML = '';
            this.elements.movieResult.appendChild(card);
            
            // Inject Add-to-Pool FAB over poster
            this._injectPoolFab(card, movie);
            this._applyResultPoster(card, movie);
            this._labelReloadShortcut(card);

            // Setup delegation for any interactive elements
            this.setupCardDelegation();

            // Smooth Unblur Transition before showing result
            const skeletonPoster = document.getElementById('skeletonPosterImg');
            if (transition && skeletonPoster && this.elements.loadingState.style.display !== 'none') {
                // 1. Stop dynamic spinning
                this._stopPosterSpinning();
                
                // 2. Focus on actual movie poster
                skeletonPoster.src = getMarathonPosterUrls(movie.posterUrl, movie.id ?? movie.kinopoiskId)[0] || DEFAULT_SPINNER_POSTER;
                skeletonPoster.classList.remove('spinning');
                
                // 3. Wait for blur-out transition (350ms in CSS)
                await new Promise(resolve => {
                    this._resultTransitionResolve = resolve;
                    this._resultTimer = setTimeout(() => {
                        this._resultTimer = null;
                        this._resultTransitionResolve = null;
                        if (requestId === this._requestId && !this._disposed) this.showState('result');
                        resolve();
                    }, 350);
                });
            } else {
                this.showState('result');
            }

        } else {
            console.error('MovieCard component not found');
            this._showFailure('network');
        }
    }

    /** Inject "add to pool" button into the card header, right of the reload button */
    _injectPoolFab(card, movie) {
        const header = card.querySelector('.cmc-header');
        if (!header) return;

        const svgPlus = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
        const svgCheck = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;

        const btn = document.createElement('button');
        const inPool = this._isInPool(movie.kinopoiskId);
        btn.className = 'cmc-pool-btn' + (inPool ? ' in-pool' : '');
        btn.title = inPool ? this._t('pool_remove') : this._t('pool_add');
        btn.innerHTML = inPool ? svgCheck : svgPlus;
        btn._poolIcons = { added: svgCheck, removed: svgPlus };
        btn.dataset.movieId = RandomPoolService.getMovieId(movie);
        btn.setAttribute('aria-pressed', String(inPool));

        btn.addEventListener('click', async () => {
            const kpId = RandomPoolService.getMovieId(movie);
            if (this._isInPool(kpId)) {
                await this._mutatePool(() => RandomPoolService.removeMovie(kpId), btn);
            } else {
                await this._addCurrentMovieToPool(btn);
            }
        });

        header.appendChild(btn);
        this._syncPoolFab();
    }
    
    /**
     * The card's poster falls back to its small app icon when the API URL is
     * missing or fails PosterUrl's host check. Try the Kinopoisk poster by ID next
     * (as the marathon does) and report a rejected host once so it can be reviewed.
     */
    _applyResultPoster(card, movie) {
        const image = card.querySelector('.cmc-poster');
        if (!image) return;
        const movieId = movie?.id ?? movie?.kinopoiskId;
        const urls = getMarathonPosterUrls(movie?.posterUrl, movieId);
        const raw = typeof movie?.posterUrl === 'string' ? movie.posterUrl.trim() : '';
        if (raw && !getSafePosterUrl(raw)) {
            let host = raw;
            try { host = new URL(raw.startsWith('//') ? `https:${raw}` : raw).hostname; } catch { /* keep raw */ }
            if (!this._reportedPosterHosts?.has(host)) {
                (this._reportedPosterHosts ||= new Set()).add(host);
                console.warn('[Random] Poster host not allowed by PosterUrl, using the Kinopoisk fallback:', host);
            }
        }
        if (!urls.length) return;
        // MovieCard's own placeholder when no URL is usable.
        const fallback = '/src/shared/assets/icons/app/icon48.png';
        let index = 0;
        image.addEventListener('error', function next() {
            index += 1;
            if (index < urls.length) image.src = urls[index];
            else {
                image.removeEventListener('error', next);
                if (fallback) image.src = fallback;
            }
        });
        image.src = urls[0];
    }

    /** The card's own reload button is the roll-again control; it announces the R shortcut. */
    _labelReloadShortcut(card) {
        const reload = card.querySelector('.cmc-reload-btn');
        if (!reload) return;
        const label = `${this._stateText('roll_again_title')} (R)`;
        reload.title = label;
        reload.setAttribute('aria-label', label);
        reload.setAttribute('aria-keyshortcuts', 'R');
    }

    /** "R" rolls again (any layout: matched by physical key) unless typing or a dialog is open. */
    _setupRollShortcut() {
        if (this._rollShortcutHandler) return;
        this._rollShortcutHandler = (event) => {
            if (event.code !== 'KeyR' || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
            const target = event.target;
            if (target?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
            if (this._activeModalId || this._hasForegroundDialog() || this._findBusy || this._disposed) return;
            event.preventDefault();
            this.findRandomMovie();
        };
        document.addEventListener('keydown', this._rollShortcutHandler);
    }

    setupCardDelegation() {
        // Simple delegation for the result container
        if (this.delegationSetup) return;
        this.delegationSetup = true;

        this.elements.movieResult.addEventListener('click', (e) => {
             // If it's not a left click, let the browser handle it (e.g. middle click for new tab)
             if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;

             const target = e.target;
             const actionBtn = target.closest('[data-action]');
             if (!actionBtn) return;
             
             const action = actionBtn.dataset.action;
             
             if (action === 'reload') {
                 if (this._findBusy || this._disposed) return;
                 // Animate button
                 const icon = actionBtn.querySelector('svg');
                 if (icon) {
                     icon.style.transition = 'transform 0.5s ease';
                     icon.style.transform = 'rotate(360deg)';
                 }
                 
                 // Always roll a new random movie (pool rolls only via the pool modal)
                 clearTimeout(this._reloadTimer);
                 this._reloadTimer = setTimeout(() => {
                     this._reloadTimer = null;
                     this.findRandomMovie();
                 }, 300);
                 return;
             }

             
             const movieId = actionBtn.dataset.movieId;
             
             if (action === 'view-details') {
                 // Open details page
                 e.preventDefault();
                 window.location.href = chrome.runtime.getURL(`src/pages/movie-details/movie-details.html?movieId=${movieId}`);
                 return;
             }
             
             // Handle other actions via helper
             if (window.firebaseManager) {
                 this.handleAction(action, movieId, actionBtn, e);
             }
        });
    }
    
    async handleAction(action, movieId, btn, e) {
        // If it's not a left click, let the browser handle it
        if (e && e.button !== 0) return;

        // Placeholder for quick actions
        // Ideally we should move action logic to a shared helper or mixin
        if (action === 'view-details') {
             if (e) e.preventDefault();
             window.location.href = chrome.runtime.getURL(`src/pages/movie-details/movie-details.html?movieId=${movieId}`);
        }
    }

    showState(state) {
        this.elements.initialState.style.display = 'none';
        this.elements.loadingState.style.display = 'none';
        this.elements.movieResult.style.display = 'none';
        this.elements.errorState.style.display = 'none';

        if (state === 'initial') {
            this._stopPosterSpinning();
            this.elements.initialState.style.display = 'block';
        }
        if (state === 'loading') {
            this._startPosterSpinning();
            this.elements.loadingState.style.display = 'block';
        }
        if (state === 'result') {
            this._stopPosterSpinning();
            this.elements.movieResult.style.display = 'flex'; // Flex for centering
        }
        if (state === 'error') {
            this._stopPosterSpinning();
            this.elements.errorState.style.display = 'flex';
        }
    }

    _startPosterSpinning() {
        this._stopPosterSpinning(); // Safety check
        const spinId = this._posterSpinId;

        const imgEl = document.getElementById('skeletonPosterImg');
        if (!imgEl) return;

        // Ensure CSP-safe error listener on DOM skeleton image
        if (!this._skeletonImgErrorBound) {
            this._skeletonImgErrorBound = true;
            imgEl.addEventListener('error', () => {
                imgEl.src = DEFAULT_SPINNER_POSTER;
            });
        }

        imgEl.classList.add('spinning');

        // Gather candidates from pool or preview list
        let poolCandidates = [];
        if (this.pool && this.pool.length > 0) {
            poolCandidates = this.pool.map(m => getSafePosterUrl(m.poster)).filter(Boolean);
        }
        
        let candidates = [...poolCandidates, ...PREVIEW_POSTERS];
        let activeCandidates = candidates.length > 0 ? [...candidates] : [DEFAULT_SPINNER_POSTER];

        // Pre-cache remote posters and prune failed URLs from active rotation
        candidates.forEach(url => {
            if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
                const temp = new Image();
                temp.onerror = () => {
                    if (spinId !== this._posterSpinId || this._disposed) return;
                    activeCandidates = activeCandidates.filter(u => u !== url);
                    if (activeCandidates.length === 0) {
                        activeCandidates = [DEFAULT_SPINNER_POSTER];
                        imgEl.src = DEFAULT_SPINNER_POSTER;
                    }
                };
                temp.src = url;
            }
        });

        let idx = 0;
        imgEl.src = activeCandidates[0] || DEFAULT_SPINNER_POSTER;

        if (activeCandidates.length > 1) {
            this._posterSpinInterval = setInterval(() => {
                if (activeCandidates.length === 0) {
                    imgEl.src = DEFAULT_SPINNER_POSTER;
                    return;
                }
                idx = (idx + 1) % activeCandidates.length;
                imgEl.src = activeCandidates[idx];
            }, 70);
        }
    }

    _stopPosterSpinning() {
        this._posterSpinId++;
        if (this._posterSpinInterval) {
            clearInterval(this._posterSpinInterval);
            this._posterSpinInterval = null;
        }
        const imgEl = document.getElementById('skeletonPosterImg');
        if (imgEl) {
            imgEl.classList.remove('spinning');
        }
    }

    // ════════════════════════════════════════════════════════════
    //  POOL FEATURE
    // ════════════════════════════════════════════════════════════

    /** Load pool from chrome.storage.local */
    async loadPool() {
        this._poolStorageHandler = (changes, area) => {
            if (area !== 'local' || !changes[this.POOL_KEY] || this._disposed) return;
            this._poolChangeId = (this._poolChangeId || 0) + 1;
            this.pool = RandomPoolService.normalizePool(changes[this.POOL_KEY].newValue);
            this._updatePoolUI();
        };
        chrome.storage.onChanged?.addListener(this._poolStorageHandler);
        try {
            const version = this._poolChangeId;
            const pool = await RandomPoolService.getPool();
            if (this._disposed) return;
            if (version === this._poolChangeId) this.pool = pool;
            this._updatePoolUI();
        } catch {
            console.warn('RandomManager: Failed to load pool');
        }
    }

    /** Apply an operation to current storage; never write a page-local snapshot. */
    async _mutatePool(action, button = null) {
        if (button?.disabled) return false;
        if (button) button.disabled = true;
        const statuses = ['poolStatus', 'poolModalStatus'].map(id => document.getElementById(id)).filter(Boolean);
        for (const status of statuses) status.textContent = '';
        try {
            await action();
            // An onChanged event or another tab may have already published a newer pool.
            const version = this._poolChangeId;
            const pool = await RandomPoolService.getPool();
            if (version === this._poolChangeId) this.pool = pool;
            this._updatePoolUI();
            return true;
        } catch (error) {
            console.warn('RandomManager: Failed to save pool', error);
            for (const status of statuses) status.textContent = i18n.get('random.pool.save_error');
            return false;
        } finally {
            if (button) button.disabled = false;
            this._updatePoolUI();
        }
    }

    /** Update the pool count badge */
    _updatePoolUI() {
        const el = document.getElementById('poolCount');
        if (el) el.textContent = this.pool.length;
        this._syncPoolFab();
        this._refreshPoolModalIfOpen();
        for (const button of document.querySelectorAll('#poolSearchResults .pool-result-add')) {
            const added = this._isInPool(button.dataset.movieId);
            button.classList.toggle('added', added);
            button.setAttribute('aria-pressed', String(added));
            button.title = added ? this._t('pool_already') : this._t('add');
        }
    }

    _syncPoolFab() {
        const button = this.elements.movieResult?.querySelector('.cmc-pool-btn');
        if (!button) return;
        const added = this._isInPool(button.dataset.movieId);
        button.classList.toggle('in-pool', added);
        button.setAttribute('aria-pressed', String(added));
        button.title = added ? this._t('pool_remove') : this._t('pool_add');
        button.setAttribute('aria-label', button.title);
        button.innerHTML = button._poolIcons[added ? 'added' : 'removed'];
    }

    /** Check if a kpId is already in the pool */
    _isInPool(kpId) {
        return RandomPoolService.isInPool(this.pool, kpId);
    }

    /** Calculate days in pool based on calendar dates */
    _getDaysInPool(addedAt) {
        if (!addedAt) return 0;
        const addedDate = new Date(addedAt);
        if (isNaN(addedDate.getTime())) return 0;
        const today = new Date();
        const d1 = new Date(addedDate.getFullYear(), addedDate.getMonth(), addedDate.getDate());
        const d2 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        return Math.max(0, Math.round((d2 - d1) / (1000 * 60 * 60 * 24)));
    }

    /** Add the currently displayed movie to the pool */
    async _addCurrentMovieToPool(button = null) {
        if (!this.currentMovie) return false;
        return this._mutatePool(() => RandomPoolService.addMovie(this.currentMovie), button);
    }

    /** Setup all pool-related event listeners */
    setupPoolListeners() {
        // Pool search input
        const searchInput = document.getElementById('poolSearchInput');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                clearTimeout(this._searchTimer);
                const searchId = ++this._poolSearchId;
                const q = e.target.value.trim();
                const resultsEl = document.getElementById('poolSearchResults');
                resultsEl.replaceChildren();
                resultsEl.classList.add('hidden');
                this._poolRenderedQuery = null;
                
                if (q.length < 2) { 
                    resultsEl.classList.add('hidden'); 
                    searchInput.style.borderColor = '';
                    return; 
                }
                
                // Показываем что идёт отсчёт
                searchInput.style.borderColor = 'var(--theme-text-secondary, #999)';
                
                this._searchTimer = setTimeout(() => {
                    searchInput.style.borderColor = 'var(--accent-color, #e67e22)';
                    this._searchForPool(q, searchId);
                }, 1000);
            });

            // Re-show results on click if they are hidden but query exists
            searchInput.addEventListener('click', () => {
                const q = searchInput.value.trim();
                const resultsEl = document.getElementById('poolSearchResults');
                if (q.length >= 2 && this._poolRenderedQuery === q && resultsEl?.hasChildNodes()) {
                    resultsEl.classList.remove('hidden');
                }
            });
        }

        // Close dropdown on outside click
        document.addEventListener('click', (e) => {
            // Ignore if clicking inside search wrap or on the lightbox overlay
            if (!e.target.closest('.pool-search-wrap') && !e.target.closest('#shared-image-lightbox-overlay')) {
                const resultsEl = document.getElementById('poolSearchResults');
                if (resultsEl) resultsEl.classList.add('hidden');
            }
        });

        // Show pool modal
        const showPoolBtn = document.getElementById('showPoolBtn');
        if (showPoolBtn) {
            showPoolBtn.addEventListener('click', () => {
                this._renderPoolModal();
                this._openModal('poolModal', 'closePoolModal');
            });
        }

        // Close pool modal
        const closePoolModal = document.getElementById('closePoolModal');
        if (closePoolModal) {
            closePoolModal.addEventListener('click', () => {
                this._closeModal('poolModal');
            });
        }

        // Close modal on backdrop click
        const poolModal = document.getElementById('poolModal');
        if (poolModal) {
            poolModal.addEventListener('click', (e) => {
                if (e.target === poolModal) this._closeModal('poolModal');
            });
        }

        // Clear pool
        const clearPoolBtn = document.getElementById('clearPoolBtn');
        if (clearPoolBtn) {
            clearPoolBtn.addEventListener('click', async () => {
                const confirmed = await window.ConfirmDialog.confirm({
                    title: i18n.get('random.pool.clear_title'), message: i18n.get('random.pool.clear_message'), danger: true
                });
                if (confirmed) await this._mutatePool(() => RandomPoolService.clear(), clearPoolBtn);
            });
        }

        // Roll from pool
        const rollFromPoolBtn = document.getElementById('rollFromPoolBtn');
        if (rollFromPoolBtn) {
            rollFromPoolBtn.addEventListener('click', () => {
                this._closeModal('poolModal');
                this._showRollReady(this.pool, () => this._rollFromPool());
            });
        }

        const showMarathonBtn = document.getElementById('showMarathonBtn');
        if (showMarathonBtn) {
            showMarathonBtn.addEventListener('click', () => {
                this._renderMarathon();
                this._openModal('marathonModal', 'closeMarathonModal');
            });
        }
        const closeMarathonBtn = document.getElementById('closeMarathonModal');
        if (closeMarathonBtn) {
            closeMarathonBtn.addEventListener('click', () => this._closeModal('marathonModal'));
        }
        const marathonModal = document.getElementById('marathonModal');
        if (marathonModal) {
            marathonModal.addEventListener('click', (event) => {
                if (event.target === marathonModal) this._closeModal('marathonModal');
            });
        }
        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            if (this._hasForegroundDialog()) return;
            if (this._activeModalId === 'rollAnimOverlay') return;
            this._closeModal('marathonModal');
            this._closeModal('poolModal');
        });
        const marathonSearchInput = document.getElementById('marathonSearchInput');
        if (marathonSearchInput) {
            marathonSearchInput.addEventListener('input', (event) => {
                clearTimeout(this._marathonSearchTimer);
                const searchId = ++this._marathonSearchId;
                const query = event.target.value.trim();
                const results = document.getElementById('marathonSearchResults');
                results?.replaceChildren();
                results?.classList.add('hidden');
                if (query.length < 2) {
                    results?.classList.add('hidden');
                    return;
                }
                this._marathonSearchTimer = setTimeout(() => this._searchForMarathon(query, searchId), 500);
            });
        }
    }

    _hasForegroundDialog() {
        return window.ConfirmDialog?.isOpen() || document.getElementById('shared-image-lightbox-overlay')?.classList.contains('visible');
    }

    _openModal(id, focusId = null) {
        const modal = document.getElementById(id);
        if (!modal) return;
        const wasHidden = modal.classList.contains('hidden');
        this._activeModalId = id;
        if (wasHidden) this._modalFocus.set(id, document.activeElement);
        modal.classList.remove('hidden');
        if (!modal.dataset.focusBound) {
            modal.dataset.focusBound = 'true';
            const trap = event => {
                if (event.key !== 'Tab' || this._activeModalId !== id || this._hasForegroundDialog() || modal.classList.contains('hidden')) return;
                const controls = Array.from(modal.querySelectorAll('button, a[href], input, select, textarea, [tabindex]'))
                    .filter(control => !control.disabled && control.tabIndex >= 0 && !control.closest('[hidden], .hidden')
                        && getComputedStyle(control).visibility !== 'hidden' && getComputedStyle(control).display !== 'none');
                if (!controls.length) {
                    event.preventDefault();
                    modal.focus();
                    return;
                }
                const first = controls[0];
                const last = controls[controls.length - 1];
                if (!modal.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)
                    || (!event.shiftKey && document.activeElement === last)) {
                    event.preventDefault();
                    (event.shiftKey ? last : first).focus();
                }
            };
            document.addEventListener('keydown', trap);
            this._modalKeyHandlers.push(trap);
        }
        modal.tabIndex = -1;
        if (wasHidden) (document.getElementById(focusId) || modal.querySelector('button:not([disabled])') || modal).focus();
    }

    _closeModal(id) {
        const modal = document.getElementById(id);
        if (!modal || modal.classList.contains('hidden')) return;
        modal.classList.add('hidden');
        if (this._activeModalId === id) this._activeModalId = ['rollAnimOverlay', 'marathonModal', 'poolModal']
            .find(modalId => {
                const remaining = document.getElementById(modalId);
                return remaining && !remaining.classList.contains('hidden');
            });
        if (id === 'marathonModal') {
            this._marathonSearchId++;
            clearTimeout(this._marathonSearchTimer);
        }
        const previous = this._modalFocus.get(id);
        this._modalFocus.delete(id);
        if (previous?.isConnected && !previous.disabled && !previous.closest('[hidden], .hidden')) previous.focus();
    }

    _createPoster(value) {
        const image = document.createElement('img');
        image.alt = '';
        const safe = getSafePosterUrl(value);
        if (safe) image.src = safe;
        else image.hidden = true;
        image.addEventListener('error', () => { image.hidden = true; }, { once: true });
        return image;
    }

    _createMovieLink(movieId, title, className) {
        const link = document.createElement('a');
        link.className = className;
        link.textContent = title || '—';
        const id = RandomPoolService.normalizeId(movieId);
        if (id) link.href = chrome.runtime.getURL(`src/pages/movie-details/movie-details.html?movieId=${id}`);
        return link;
    }

    _makePosterAccessible(image, title) {
        if (image.hidden || typeof window.ImageLightbox === 'undefined') return;
        image.tabIndex = 0;
        image.setAttribute('role', 'button');
        image.setAttribute('aria-label', this._t('open_poster', { title: title || this._t('movie') }));
        const show = () => window.ImageLightbox.show(image.src);
        image.addEventListener('click', show);
        image.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                show();
            }
        });
    }

    async initMarathon() {
        if (this._disposed || typeof RandomMarathonService === 'undefined' || typeof firebaseManager === 'undefined') return;
        try {
            await firebaseManager.waitForAuthReady();
            if (this._disposed) return;
            this.marathonService = new RandomMarathonService(firebaseManager);
            this._marathonAuthHandler = () => this._refreshMarathonForAuth().catch((error) => {
                if (this._disposed) return;
                console.warn('RandomManager: marathon auth refresh failed', error);
                this.marathonState = { round: null, items: [], error: this._formatMarathonError(error) };
                this._renderMarathon();
            });
            window.addEventListener('authStateChanged', this._marathonAuthHandler);
            await this._refreshMarathonForAuth();
        } catch (error) {
            if (this._disposed) return;
            console.warn('RandomManager: marathon is unavailable', error);
            this.marathonState = { round: null, items: [], error: this._formatMarathonError(error) };
            this._renderMarathon();
        }
    }

    async _refreshMarathonForAuth() {
        if (this._disposed || !this.marathonService || typeof firebaseManager === 'undefined') return;
        const refreshId = ++this._marathonAuthRefreshId;
        if (this._marathonUnsubscribe) {
            this._marathonUnsubscribe();
            this._marathonUnsubscribe = null;
        }
        const user = firebaseManager.getCurrentUser?.() || null;
        this.marathonIsAdmin = false;
        this.marathonState = { round: null, items: [] };
        this._renderMarathon();
        if (!user) {
            return;
        }
        const isAdmin = await this.marathonService.isAdmin().catch(() => false);
        if (refreshId !== this._marathonAuthRefreshId || this._disposed) return;
        this.marathonIsAdmin = isAdmin;
        this._marathonUnsubscribe = this.marathonService.subscribe(
            (state) => {
                if (refreshId !== this._marathonAuthRefreshId) return;
                this.marathonState = state;
                this._renderMarathon();
            },
            (error) => {
                if (refreshId !== this._marathonAuthRefreshId) return;
                console.warn('RandomManager: marathon subscription failed', error);
                this.marathonState = { round: null, items: [], error: this._formatMarathonError(error) };
                this._renderMarathon();
            }
        );
    }

    _getMarathonMovieId(movieOrItem) {
        if (typeof RandomPoolService !== 'undefined' && typeof RandomPoolService.getMovieId === 'function') {
            return RandomPoolService.getMovieId(movieOrItem);
        }
        const value = movieOrItem?.kinopoiskId ?? movieOrItem?.kpId ?? movieOrItem?.movieId ?? movieOrItem?.id;
        const id = Number(value);
        return Number.isInteger(id) && id > 0 ? id : null;
    }

    _getMarathonMovieKey(roundId, movieOrItem) {
        const movieId = this._getMarathonMovieId(movieOrItem);
        return movieId && roundId !== undefined && roundId !== null
            ? `${roundId}:${movieId}`
            : null;
    }

    _getMarathonDisplayItems() {
        const items = Array.isArray(this.marathonState?.items) ? this.marathonState.items : [];
        const roundId = this.marathonState?.round?.roundId;
        if (roundId === undefined || roundId === null || !this._marathonPendingAdds.size) return items;

        const visibleKeys = new Set(items
            .filter((item) => item.state !== 'removed')
            .map((item) => this._getMarathonMovieKey(roundId, item))
            .filter(Boolean));
        const pendingItems = [...this._marathonPendingAdds.values()]
            .filter((item) => String(item.roundId) === String(roundId))
            .filter((item) => !visibleKeys.has(this._getMarathonMovieKey(roundId, item)));
        return items.concat(pendingItems);
    }

    _addMovieToMarathon(movie) {
        if (this._marathonMutationRunning || !this.marathonService) return null;
        const round = this.marathonState?.round;
        if (!round || round.status !== 'collecting') return null;

        const entry = typeof RandomPoolService !== 'undefined' ? RandomPoolService.createEntry(movie) : null;
        const movieKey = this._getMarathonMovieKey(round.roundId, entry);
        if (!entry || !movieKey) return null;
        entry.poster = getMarathonPosterUrls(entry.poster, entry.kpId)[0] || '';

        const displayItems = this._getMarathonDisplayItems();
        if (displayItems.some((item) => item.state !== 'removed' && this._getMarathonMovieKey(round.roundId, item) === movieKey)) {
            return null;
        }
        const user = typeof firebaseManager !== 'undefined' ? firebaseManager.getCurrentUser?.() : null;
        const ownCount = displayItems.filter((item) => item.addedBy === user?.uid && item.state !== 'removed').length;
        if (!this.marathonIsAdmin && ownCount >= RandomMarathonService.maxMoviesPerUser) {
            const error = new Error(this._t('err_MOVIE_LIMIT'));
            error.code = 'MOVIE_LIMIT';
            if (!this._disposed) (window.ConfirmDialog ? window.ConfirmDialog.alert({ message: this._formatMarathonError(error) }) : window.alert(this._formatMarathonError(error)));
            return null;
        }

        const optimisticItem = {
            ...entry,
            id: `${round.roundId}_${entry.kpId}`,
            roundId: Number(round.roundId),
            addedBy: user?.uid || '',
            addedByName: user?.displayName || user?.email || this._t('participant'),
            state: 'queued',
            resolvedAt: null,
            resolvedBy: null,
            resolution: null,
            __pending: true
        };
        this._marathonPendingAdds.set(movieKey, optimisticItem);
        this._renderMarathon();
        return this._runMarathonAction(() => this.marathonService.addMovie(entry), { pendingAddKey: movieKey });
    }

    _renderMarathon() {
        const summary = document.getElementById('marathonSummary');
        const list = document.getElementById('marathonList');
        const actions = document.getElementById('marathonActions');
        if (!summary || !list || !actions) return;
        const { round, error } = this.marathonState || {};
        const user = typeof firebaseManager !== 'undefined' ? firebaseManager.getCurrentUser?.() : null;
        if (error) {
            summary.textContent = error;
            list.innerHTML = `<div class="pool-list-empty">${this._escapeHtml(this._t('try_later'))}</div>`;
            actions.innerHTML = '';
            this._refreshPoolModalIfOpen();
            return;
        }
        if (!round) {
            const marathonSearchInput = document.getElementById('marathonSearchInput');
            if (marathonSearchInput) marathonSearchInput.disabled = true;
            summary.textContent = user ? this._t('no_round') : this._t('sign_in');
            list.innerHTML = `<div class="pool-list-empty">${this._escapeHtml(this._t('admin_can_create'))}</div>`;
            actions.innerHTML = this.marathonIsAdmin
                ? `<button class="btn-roll-from-pool" data-marathon-action="create">${this._escapeHtml(this._t('create_round'))}</button>` : '';
            this._bindMarathonActions();
            this._syncMarathonActionState();
            this._refreshPoolModalIfOpen();
            return;
        }

        const displayItems = this._getMarathonDisplayItems().filter((item) => !this._marathonPendingRemovals.has(item.id));
        const ownCount = displayItems.filter((item) => item.addedBy === user?.uid && item.state !== 'removed').length;
        const marathonSearchInput = document.getElementById('marathonSearchInput');
        if (marathonSearchInput) {
            const canAdd = round.status === 'collecting'
                && (this.marathonIsAdmin || ownCount < RandomMarathonService.maxMoviesPerUser);
            marathonSearchInput.disabled = !canAdd;
            marathonSearchInput.placeholder = canAdd
                ? this._t('search_add')
                : (round.status === 'collecting' ? this._t('limit_reached') : this._t('adding_closed'));
        }
        const activeItems = displayItems.filter((item) => item.state !== 'removed');
        const resolvedCount = activeItems.filter((item) => item.state === 'watched').length;
        const statusLabel = ['collecting', 'active', 'completed', 'cancelled'].includes(round.status) ? this._t(`status_${round.status}`) : round.status;
        const ownCountLabel = this.marathonIsAdmin ? this._t('own_unlimited', { n: ownCount }) : `${ownCount}/3`;
        summary.replaceChildren();
        const status = document.createElement('strong');
        status.textContent = statusLabel;
        summary.append(status, this._t('summary', { round: Number(round.roundId) || 0, done: resolvedCount, total: activeItems.length, own: ownCountLabel }));
        list.innerHTML = '';
        if (!displayItems.length) list.innerHTML = `<div class="pool-list-empty">${this._escapeHtml(this._t('round_empty'))}</div>`;
        displayItems.forEach((item) => {
            const row = document.createElement('div');
            row.className = 'pool-list-item marathon-list-item';
            row.tabIndex = 0;
            row.setAttribute('role', 'button');
            row.setAttribute('aria-label', this._t('open_movie', { title: item.title || this._t('untitled') }));
            const stateLabel = item.__pending
                ? this._t('state_adding')
                : (['queued', 'selected', 'watched', 'removed'].includes(item.state) ? this._t(`state_${item.state}`) : item.state);
            const addedBy = item.addedByName || item.addedBy || this._t('participant');
            const posterUrls = getMarathonPosterUrls(item.poster, item.kpId);
            const poster = document.createElement('img');
            poster.className = 'marathon-item-poster';
            poster.alt = item.title ? this._t('open_poster_of', { title: item.title }) : this._t('open_poster_plain');
            let posterUrlIndex = 0;
            const markPosterUnavailable = () => {
                poster.classList.add('marathon-item-poster--unavailable');
                poster.removeAttribute('src');
                poster.removeAttribute('role');
                poster.removeAttribute('title');
                poster.tabIndex = -1;
            };
            const loadNextPoster = () => {
                if (posterUrlIndex >= posterUrls.length) {
                    markPosterUnavailable();
                    return;
                }
                poster.src = posterUrls[posterUrlIndex++];
            };
            poster.tabIndex = posterUrls.length ? 0 : -1;
            if (posterUrls.length) {
                poster.addEventListener('error', loadNextPoster);
                poster.setAttribute('role', 'button');
                poster.title = this._t('zoom_poster');
                const openPoster = (event) => {
                    event.stopPropagation();
                    if (!poster.hasAttribute('src')) return;
                    const currentPosterUrl = poster.currentSrc || poster.src;
                    if (currentPosterUrl && typeof window.ImageLightbox !== 'undefined') window.ImageLightbox.show(currentPosterUrl);
                };
                poster.addEventListener('click', openPoster);
                poster.addEventListener('keydown', (event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    openPoster(event);
                });
                loadNextPoster();
            } else {
                markPosterUnavailable();
            }
            const meta = document.createElement('div');
            meta.className = 'pool-list-item-meta';
            const title = document.createElement('div');
            title.className = 'pool-list-item-title';
            title.textContent = item.title || this._t('untitled');
            const sub = document.createElement('div');
            sub.className = 'pool-list-item-sub';
            sub.textContent = item.year || '';
            const author = document.createElement('div');
            author.className = 'marathon-item-author';
            const authorLabel = document.createElement('span');
            authorLabel.textContent = this._t('added_by');
            author.append(authorLabel, ` ${addedBy}`);
            meta.append(title, sub, author);
            const state = document.createElement('span');
            state.className = 'marathon-item-state';
            state.textContent = stateLabel;
            const rowActions = document.createElement('div');
            rowActions.className = 'marathon-item-actions';
            rowActions.appendChild(state);
            row.append(poster, meta, rowActions);
            row.addEventListener('click', () => {
                window.location.href = chrome.runtime.getURL(`src/pages/movie-details/movie-details.html?movieId=${item.kpId}`);
            });
            row.addEventListener('keydown', (event) => {
                if (event.target.closest?.('button')) return;
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    row.click();
                }
            });
            if (!item.__pending && ((round.status === 'collecting' && item.addedBy === user?.uid) || (this.marathonIsAdmin && item.state !== 'watched' && item.state !== 'removed'))) {
                const remove = document.createElement('button');
                remove.className = 'pool-list-item-remove';
                remove.title = this._t('remove_from_marathon');
                remove.setAttribute('aria-label', this._t('remove_title_from_marathon', { title: item.title || this._t('movie') }));
                remove.textContent = '×';
                remove.addEventListener('click', async (event) => {
                    event.stopPropagation();
                    this._marathonPendingRemovals.add(item.id);
                    this._renderMarathon();
                    await this._runMarathonAction(() => this.marathonService.removeMovie(item.id), { pendingRemovalId: item.id });
                });
                rowActions.appendChild(remove);
            }
            list.appendChild(row);
        });

        const current = round.currentItemId ? displayItems.find((item) => item.id === round.currentItemId) : null;
        if (current) {
            const currentLabel = document.createElement('div');
            currentLabel.className = 'marathon-current-movie';
            const currentLink = document.createElement('a');
            currentLink.className = 'marathon-current-movie-link';
            currentLink.href = chrome.runtime.getURL(`src/pages/movie-details/movie-details.html?movieId=${current.kpId}`);
            currentLink.textContent = current.title || this._t('untitled');
            currentLabel.append(this._t('current_movie'), currentLink);
            list.prepend(currentLabel);
        }
        actions.innerHTML = '';
        if (this.marathonIsAdmin && round.status === 'collecting') {
            actions.innerHTML += `<button class="btn-roll-from-pool" data-marathon-action="start">${this._escapeHtml(this._t('start_marathon'))}</button>`;
        }
        if (this.marathonIsAdmin && round.status === 'active' && !round.currentItemId) {
            const queuedCount = displayItems.filter((item) => item.state !== 'watched' && item.state !== 'removed').length;
            const rollLabel = this._escapeHtml(queuedCount === 1 ? this._t('pick_last') : this._t('spin_wheel'));
            actions.innerHTML += `<button class="btn-roll-from-pool" data-marathon-action="roll">${rollLabel}</button>`;
        }
        if (this.marathonIsAdmin && round.status === 'active' && current) {
            actions.innerHTML += `<button class="btn-roll-from-pool" data-marathon-action="watched">${this._escapeHtml(this._t('mark_watched'))}</button><button class="btn btn-danger" data-marathon-action="removed">${this._escapeHtml(this._t('remove_picked'))}</button>`;
        }
        if (this.marathonIsAdmin && ['completed', 'cancelled'].includes(round.status)) {
            actions.innerHTML += `<button class="btn-roll-from-pool" data-marathon-action="create">${this._escapeHtml(this._t('open_new_round'))}</button>`;
        }
        this._bindMarathonActions();
        this._syncMarathonActionState();
        this._refreshPoolModalIfOpen();
    }

    async _rollMarathonWithAnimation() {
        if (this._marathonMutationRunning || !this.marathonService) return;

        const queuedItems = this._getMarathonDisplayItems()
            .filter((item) => item.state !== 'watched' && item.state !== 'removed');
        if (!queuedItems.length) return;

        // Nothing to choose from: pick the last movie directly, without the wheel
        if (queuedItems.length === 1) {
            await this._runMarathonAction(() => this.marathonService.rollNext());
            return;
        }

        this._showRollPendingAnimation(queuedItems);
        const nextState = await this._runMarathonAction(
            () => this.marathonService.rollNext(),
            { deferRender: true }
        );
        if (!nextState) {
            this._stopRollAnimation();
            return;
        }
        const winnerId = nextState?.round?.currentItemId;
        const candidates = (nextState?.items || [])
            .filter((item) => item.state !== 'watched' && item.state !== 'removed');
        const winnerIndex = candidates.findIndex((item) => String(item.id) === String(winnerId));
        if (winnerIndex < 0) {
            this._stopRollAnimation();
            this._renderMarathon();
            return;
        }

        this._showRollAnimation(candidates, winnerIndex, {
            actionLabel: () => this._t('back_to_marathon'),
            onWinner: async (_winner, overlay) => {
                this._closeModal(overlay.id);
                this._renderMarathon();
            }
        });
    }

    _showRollPendingAnimation(entries) {
        const candidates = Array.isArray(entries) ? entries.filter(Boolean) : [];
        const overlay = document.getElementById('rollAnimOverlay');
        const wheel = document.getElementById('rollWheel');
        const center = document.getElementById('rollCenterBtn');
        const actionsBox = document.getElementById('rollActions');
        const title = overlay?.querySelector('.roll-title');
        if (!candidates.length || !overlay || !wheel || !center || !actionsBox) return;

        this._renderRollCandidates(wheel, candidates);
        if (title) title.textContent = this._t('choosing');
        actionsBox.style.visibility = 'hidden';
        overlay.querySelector('#rollPoolHint').hidden = true;
        center.disabled = true;
        center.textContent = this._t('spinning');
        wheel.classList.add('roll-wheel--pending');
        this._openModal('rollAnimOverlay');
        this._setRollBusy(true);
        this._rollAudio.startSpin();
    }

    _stopRollAnimation() {
        const overlay = document.getElementById('rollAnimOverlay');
        const wheel = document.getElementById('rollWheel');
        this._rollAnimationId++;
        this._rollAudio.stop();
        wheel?.classList.remove('roll-wheel--pending');
        if (wheel) wheel.style.removeProperty('transform');
        const volumePanel = overlay?.querySelector('#rollVolumePanel');
        if (volumePanel) volumePanel.hidden = true;
        overlay?.querySelector('#rollVolumeBtn')?.setAttribute('aria-expanded', 'false');
        this._closeModal('rollAnimOverlay');
        this._setRollBusy(false);
    }

    _refreshPoolModalIfOpen() {
        const poolModal = document.getElementById('poolModal');
        if (poolModal && !poolModal.classList.contains('hidden')) {
            const focused = document.activeElement;
            const itemId = focused?.closest('.pool-list-item')?.dataset.movieId;
            const targetClass = ['pool-list-item-remove', 'pool-list-item-marathon-add', 'pool-list-item-title'].find(name => focused?.classList.contains(name));
            this._renderPoolModal();
            if (itemId && targetClass) {
                const row = Array.from(poolModal.querySelectorAll('.pool-list-item')).find(item => item.dataset.movieId === itemId);
                (row?.querySelector(`.${targetClass}`) || document.getElementById('closePoolModal')).focus();
            }
        }
    }

    _bindMarathonActions() {
        const round = this.marathonState?.round;
        const expectedRoundId = round?.roundId;
        const expectedItemId = round?.currentItemId;
        document.querySelectorAll('[data-marathon-action]').forEach((button) => {
            button.onclick = async () => {
                const action = button.dataset.marathonAction;
                const handlers = {
                    create: () => this.marathonService.createRound(),
                    start: () => this.marathonService.startRound(),
                    watched: () => this.marathonService.resolveCurrent('watched', expectedRoundId, expectedItemId),
                    removed: () => this.marathonService.resolveCurrent('removed', expectedRoundId, expectedItemId)
                };
                if (action === 'roll') {
                    const candidates = this._getMarathonDisplayItems()
                        .filter((item) => item.state === 'queued');
                    this._showRollReady(candidates, () => this._rollMarathonWithAnimation());
                } else if (handlers[action]) {
                    await this._runMarathonAction(handlers[action], { pendingAction: action });
                }
            };
        });
    }

    _syncMarathonActionState() {
        const labels = {
            create: this._t('pending_create'),
            start: this._t('pending_start'),
            watched: this._t('pending_watched'),
            removed: this._t('pending_removed')
        };
        const buttons = [...document.querySelectorAll('#marathonActions [data-marathon-action]')];
        const loadingButton = this._marathonMutationRunning && this._marathonPendingAction
            ? buttons.find((button) => button.dataset.marathonAction === this._marathonPendingAction) || buttons[0]
            : null;
        buttons.forEach((button) => {
            const loading = button === loadingButton;
            button.disabled = this._marathonMutationRunning;
            button.classList.toggle('marathon-action-loading', loading);
            if (loading) {
                button.dataset.marathonIdleLabel ||= button.textContent;
                button.textContent = labels[this._marathonPendingAction] || this._t('pending_saving');
                button.setAttribute('aria-busy', 'true');
            } else {
                if (button.dataset.marathonIdleLabel) {
                    button.textContent = button.dataset.marathonIdleLabel;
                    delete button.dataset.marathonIdleLabel;
                }
                button.removeAttribute('aria-busy');
            }
        });
    }

    async _runMarathonAction(action, { pendingRemovalId = null, pendingAddKey = null, pendingAction = null, deferRender = false } = {}) {
        if (this._marathonMutationRunning) return null;
        this._marathonMutationRunning = true;
        this._marathonPendingAction = pendingAction;
        let shouldRender = true;
        this._syncMarathonActionState();
        try {
            const nextState = await action();
            if (this._disposed) return null;
            if (nextState?.round !== undefined && Array.isArray(nextState.items)) {
                this.marathonState = nextState;
                shouldRender = !deferRender;
            }
            return nextState;
        } catch (error) {
            console.warn('RandomManager: marathon action failed', error);
            if (!this._disposed) (window.ConfirmDialog ? window.ConfirmDialog.alert({ message: this._formatMarathonError(error) }) : window.alert(this._formatMarathonError(error)));
            return null;
        } finally {
            if (pendingRemovalId) this._marathonPendingRemovals.delete(pendingRemovalId);
            if (pendingAddKey) this._marathonPendingAdds.delete(pendingAddKey);
            this._marathonMutationRunning = false;
            this._marathonPendingAction = null;
            if (!this._disposed) {
                if (shouldRender) this._renderMarathon();
                else this._syncMarathonActionState();
            }
        }
    }

    _formatMarathonError(error) {
        const messages = {
            AUTH_REQUIRED: this._t('err_AUTH_REQUIRED'),
            ADMIN_REQUIRED: this._t('err_ADMIN_REQUIRED'),
            APPROVAL_REQUIRED: this._t('err_APPROVAL_REQUIRED'),
            MOVIE_LIMIT: this._t('err_MOVIE_LIMIT'),
            COLLECTION_CLOSED: this._t('err_COLLECTION_CLOSED'),
            DUPLICATE_MOVIE: this._t('err_DUPLICATE_MOVIE'),
            MOVIE_NOT_FOUND: this._t('err_MOVIE_NOT_FOUND'),
            STALE_MOVIE: this._t('err_STALE_MOVIE'),
            INVALID_ITEM: this._t('err_INVALID_ITEM'),
            FORBIDDEN: this._t('err_FORBIDDEN'),
            EMPTY_ROUND: this._t('err_EMPTY_ROUND'),
            ROUND_NOT_FOUND: this._t('err_ROUND_NOT_FOUND'),
            ROUND_NOT_COLLECTING: this._t('err_ROUND_NOT_COLLECTING'),
            CURRENT_MOVIE_EXISTS: this._t('err_CURRENT_MOVIE_EXISTS'),
            CURRENT_MOVIE_MISSING: this._t('err_CURRENT_MOVIE_MISSING'),
            CURRENT_MOVIE_STALE: this._t('err_CURRENT_MOVIE_STALE'),
            ROUND_NOT_ACTIVE: this._t('err_ROUND_NOT_ACTIVE'),
            ROUND_IN_PROGRESS: this._t('err_ROUND_IN_PROGRESS'),
            ORIGIN_NOT_ALLOWED: this._t('err_ORIGIN_NOT_ALLOWED'),
            INVALID_MOVIE: this._t('err_INVALID_MOVIE'),
            INVALID_RESOLUTION: this._t('err_INVALID_RESOLUTION')
        };
        if (error?.code && messages[error.code]) return messages[error.code];
        if (error?.code === 'permission-denied' || /permission|insufficient permissions/i.test(error?.message || '')) {
            return this._t('no_access');
        }
        return error?.message || this._t('action_failed');
    }

    async _searchForMarathon(query, searchId = ++this._marathonSearchId) {
        const results = document.getElementById('marathonSearchResults');
        if (!results || !this.marathonService) return;
        results.innerHTML = `<div style="padding:12px;color:#999;font-size:13px">${this._escapeHtml(this._t('searching'))}</div>`;
        results.classList.remove('hidden');
        try {
            const data = await this.kinopoiskService.searchMovies(query, 1, 20);
            if (this._disposed || searchId !== this._marathonSearchId || document.getElementById('marathonSearchInput').value.trim() !== query) return;
            const movies = data.docs || [];
            results.innerHTML = '';
            if (!movies.length) {
                results.innerHTML = `<div style="padding:12px;color:#999;font-size:13px">${this._escapeHtml(this._t('nothing_found'))}</div>`;
                return;
            }
            movies.slice(0, 8).forEach((movie) => {
                const row = document.createElement('div');
                row.className = 'pool-result-item';
                const poster = this._createPoster(movie.posterUrl);
                const meta = document.createElement('div');
                meta.className = 'pool-result-meta';
                const title = this._createMovieLink(RandomPoolService.getMovieId(movie), movie.name || movie.alternativeName, 'pool-result-title');
                const year = document.createElement('div');
                year.className = 'pool-result-sub';
                year.textContent = movie.year || '';
                meta.append(title, year);
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'pool-result-add';
                button.textContent = '+';
                button.setAttribute('aria-label', this._t('add_to_marathon'));
                row.append(poster, meta, button);
                this._makePosterAccessible(poster, movie.name || movie.alternativeName);
                row.querySelector('button').addEventListener('click', async (event) => {
                    event.stopPropagation();
                    const pending = this._addMovieToMarathon(movie);
                    if (pending) results.classList.add('hidden');
                    const result = pending ? await pending : null;
                    if (result) results.classList.add('hidden');
                });
                results.appendChild(row);
            });
        } catch (error) {
            if (this._disposed || searchId !== this._marathonSearchId || document.getElementById('marathonSearchInput').value.trim() !== query) return;
            results.innerHTML = `<div style="padding:12px;color:#999;font-size:13px">${this._escapeHtml(error.message || this._t('search_error'))}</div>`;
        }
    }

    /** Marathon, pool and wheel text in the interface language. */
    _t(key, params = {}) {
        let text = i18n.get(`random.pool_marathon.${key}`);
        Object.entries(params).forEach(([name, value]) => { text = text.replaceAll(`{${name}}`, String(value)); });
        return text;
    }

    _escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
    }

    /** Search Kinopoisk and display dropdown results */
    async _searchForPool(query, searchId = ++this._poolSearchId) {
        const resultsEl = document.getElementById('poolSearchResults');
        resultsEl.innerHTML = `<div style="padding:12px;color:#999;font-size:13px">${this._escapeHtml(this._t('searching'))}</div>`;
        resultsEl.classList.remove('hidden');

        try {
            const data = await this.kinopoiskService.searchMovies(query, 1, 20);
            if (this._disposed || searchId !== this._poolSearchId || document.getElementById('poolSearchInput').value.trim() !== query) return;
            const movies = data.docs || [];
            const sortedMovies = (data.searchSource === 'kinopoisk-graphql' || data.searchSource === 'kinopoisk-offscreen-scrape' || data.searchSource === 'kinopoisk-scrape')
                ? movies.slice(0, 8)
                : this.kinopoiskService.sortMoviesByRelevance(movies, query).slice(0, 8);
            this._renderSearchResults(sortedMovies, resultsEl);
            this._poolRenderedQuery = query;
        } catch {
            if (this._disposed || searchId !== this._poolSearchId || document.getElementById('poolSearchInput').value.trim() !== query) return;
            resultsEl.innerHTML = `<div style="padding:12px;color:#e74c3c;font-size:13px">${this._escapeHtml(this._t('search_error'))}</div>`;
        }
    }

    /** Render dropdown search results */
    _renderSearchResults(movies, container) {
        if (!movies.length) {
            container.innerHTML = `<div style="padding:12px;color:#999;font-size:13px">${this._escapeHtml(this._t('nothing_found'))}</div>`;
            return;
        }
        container.innerHTML = '';
        movies.forEach(m => {
            const kpId = RandomPoolService.getMovieId(m);
            const inPool = this._isInPool(kpId);
            const item = document.createElement('div');
            item.className = 'pool-result-item';
            const image = this._createPoster(m.posterUrl);
            this._makePosterAccessible(image, m.name || m.alternativeName);
            const meta = document.createElement('div');
            meta.className = 'pool-result-meta';
            const title = this._createMovieLink(kpId, m.name || m.alternativeName, 'pool-result-title');
            const sub = document.createElement('div');
            sub.className = 'pool-result-sub';
            const rawRating = m.kpRating;
            const rating = rawRating !== null && rawRating !== undefined && rawRating !== '' && Number.isFinite(Number(rawRating)) ? Number(rawRating).toFixed(1) : '—';
            sub.textContent = this._t('kp_rating', { year: m.year || '', rating });
            meta.append(title, sub);
            const addBtn = document.createElement('button');
            addBtn.type = 'button';
            addBtn.className = `pool-result-add${inPool ? ' added' : ''}`;
            addBtn.textContent = '+';
            addBtn.dataset.movieId = kpId;
            addBtn.title = inPool ? this._t('pool_already') : this._t('add');
            addBtn.setAttribute('aria-label', this._t('add_to_pool_title', { title: m.name || m.alternativeName || this._t('movie') }));
            addBtn.setAttribute('aria-pressed', String(inPool));
            addBtn.addEventListener('click', async () => {
                if (!this._isInPool(kpId)) await this._mutatePool(() => RandomPoolService.addMovie(m), addBtn);
            });
            item.append(image, meta, addBtn);
            container.appendChild(item);
        });
    }

    /** Render contents of the pool modal list */
    _renderPoolModal() {
        const list = document.getElementById('poolList');
        list.innerHTML = '';
        if (!this.pool.length) {
            list.innerHTML = `<div class="pool-list-empty">${this._escapeHtml(this._t('pool_empty'))}</div>`;
            return;
        }

        // Calculate total weight to show the actual percentage chance for each movie
        let totalWeight = 0;
        const weights = this.pool.map(m => {
            const diffDays = this._getDaysInPool(m.addedAt);
            return 1.0 + diffDays * 0.01;
        });
        weights.forEach(w => { totalWeight += w; });

        const marathonRound = this.marathonState?.round;
        const marathonUser = typeof firebaseManager !== 'undefined' ? firebaseManager.getCurrentUser?.() : null;
        const marathonItems = this._getMarathonDisplayItems();
        const marathonOwnCount = marathonUser
            ? marathonItems.filter((marathonItem) => marathonItem.addedBy === marathonUser.uid && marathonItem.state !== 'removed').length
            : 0;
        const marathonCanAdd = typeof RandomMarathonService !== 'undefined'
            && this.marathonService
            && marathonRound?.status === 'collecting'
            && (this.marathonIsAdmin || marathonOwnCount < RandomMarathonService.maxMoviesPerUser);

        this.pool.forEach(m => {
            const addedDate = m.addedAt ? new Date(m.addedAt) : new Date();
            const diffDays = this._getDaysInPool(m.addedAt);
            const bonusPercent = diffDays;
            const weight = 1.0 + diffDays * 0.01;
            const chancePercent = totalWeight > 0 ? ((weight / totalWeight) * 100).toFixed(1) : '0.0';
            const numericRating = Number(m.rating);
            const ratingLabel = Number.isFinite(numericRating) ? numericRating.toFixed(1) : '—';

            let dateStr;
            const today = new Date();
            if (today.toDateString() === addedDate.toDateString()) {
                dateStr = this._t('today');
            } else {
                dateStr = addedDate.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
            }

            const inMarathon = marathonRound && marathonItems.some((marathonItem) =>
                marathonItem.roundId === marathonRound.roundId
                && Number(marathonItem.kpId) === Number(m.kpId)
                && marathonItem.state !== 'removed'
            );
            const marathonAction = inMarathon
                ? `<span class="pool-list-item-marathon-state" aria-label="${this._escapeHtml(this._t('in_marathon_label'))}">${this._escapeHtml(this._t('in_marathon'))}</span>`
                : (marathonCanAdd
                    ? `<button type="button" class="pool-list-item-marathon-add" title="${this._escapeHtml(this._t('to_marathon_title'))}" aria-label="${this._escapeHtml(this._t('to_marathon_aria', { title: m.title || this._t('movie') }))}">${this._escapeHtml(this._t('to_marathon'))}</button>`
                    : '');
            const item = document.createElement('div');
            item.className = 'pool-list-item';
            item.dataset.movieId = m.kpId;
            item.innerHTML = `
                <img alt="">
                <div class="pool-list-item-meta">
                    <a class="pool-list-item-title" href="${chrome.runtime.getURL(`src/pages/movie-details/movie-details.html?movieId=${m.kpId}`)}">${this._escapeHtml(m.title || '—')}</a>
                    <div class="pool-list-item-sub">${this._escapeHtml(this._t('kp_rating', { year: m.year || '', rating: ratingLabel }))}</div>
                    <div class="pool-list-item-bonus">
                        <span>${this._escapeHtml(this._t('added_on', { date: dateStr }))}</span>
                        <span class="bonus-tag" title="${this._escapeHtml(this._t('bonus_title', { n: bonusPercent }))}">+${bonusPercent}%</span>
                        <span class="chance-tag" title="${this._escapeHtml(this._t('chance_title'))}">${chancePercent}%</span>
                    </div>
                </div>
                <div class="pool-list-item-actions">
                    ${marathonAction}
                    <button type="button" class="pool-list-item-remove" title="${this._escapeHtml(this._t('pool_remove'))}" aria-label="${this._escapeHtml(this._t('remove_from_pool_aria', { title: m.title || this._t('movie') }))}">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                    </button>
                </div>`;

            // Add zoom-in cursor to poster
            const img = item.querySelector('img');
            if (img) {
                // Fall back to the Kinopoisk poster by id; keep the empty slot so the row grid holds.
                const posterUrls = getMarathonPosterUrls(m.poster, m.kpId);
                const showNextPoster = () => {
                    const next = posterUrls.shift();
                    if (next) img.src = next;
                    else { img.removeAttribute('src'); img.style.visibility = 'hidden'; }
                };
                img.addEventListener('error', showNextPoster);
                showNextPoster();
                this._makePosterAccessible(img, m.title);
                img.style.cursor = 'zoom-in';
            }

            const removeButton = item.querySelector('.pool-list-item-remove');
            removeButton.addEventListener('click', async () => {
                await this._mutatePool(() => RandomPoolService.removeMovie(m.kpId), removeButton);
            });

            const addToMarathonBtn = item.querySelector('.pool-list-item-marathon-add');
            if (addToMarathonBtn) {
                addToMarathonBtn.addEventListener('click', async (event) => {
                    event.stopPropagation();
                    await this._addMovieToMarathon(m);
                });
            }

            list.appendChild(item);
        });
    }

    /** Pick a random movie from the pool and display it */
    _rollFromPool() {
        if (!this.pool.length) return;

        // Weighted selection based on days in pool (base weight = 1.0, +1% of base weight per day)
        let totalWeight = 0;
        const weights = this.pool.map(m => {
            const diffDays = this._getDaysInPool(m.addedAt);
            return 1.0 + diffDays * 0.01;
        });
        weights.forEach(w => { totalWeight += w; });

        let random = Math.random() * totalWeight;
        let winnerIdx = 0;
        for (let i = 0; i < this.pool.length; i++) {
            random -= weights[i];
            if (random <= 0) {
                winnerIdx = i;
                break;
            }
        }

        this._showRollAnimation(this.pool, winnerIdx, {
            onWinner: async (winner, overlay) => {
                const animationId = this._rollAnimationId;
                // Remove from pool only after the user has seen the result.
                const saved = await this._mutatePool(() => RandomPoolService.removeMovie(winner.kpId));
                if (this._disposed || animationId !== this._rollAnimationId) return;
                if (!saved) {
                    overlay.querySelector('#rollPoolHint').hidden = false;
                    overlay.querySelector('#rollPoolHint').textContent = i18n.get('random.pool.save_error');
                    return;
                }
                this._closeModal('rollAnimOverlay');
                window.location.href = chrome.runtime.getURL(`src/pages/movie-details/movie-details.html?movieId=${winner.kpId}`);
            },
            reroll: () => this._rollFromPool(),
            poolRemovalHint: true,
            actionLabel: (winner) => this._t('watch_title', { title: winner.title })
        });
    }

    // ── Roll Animation ────────────────────────────────────────────

    _buildRollOverlay() {
        const el = document.createElement('div');
        el.id = 'rollAnimOverlay';
        el.className = 'roll-modal-overlay hidden';
        el.innerHTML = `
            <div class="roll-modal-box" role="dialog" aria-modal="true" aria-labelledby="rollTitle">
                <button class="roll-settings-btn" id="rollSettingsBtn" type="button" aria-label="${this._escapeHtml(this._t('wheel_settings'))}" aria-expanded="false" aria-controls="rollSettingsPanel">
                    <svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.88 1.88-.06-.06A1.7 1.7 0 0 0 16 18.4a1.7 1.7 0 0 0-1 1.57V21h-6v-1.03A1.7 1.7 0 0 0 8 18.4a1.7 1.7 0 0 0-1.88.34l-.06.06-1.88-1.88.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.57-1H2v-4h1.03A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88L4.2 7.06l1.88-1.88.06.06A1.7 1.7 0 0 0 8 5.6a1.7 1.7 0 0 0 1-1.57V3h6v1.03A1.7 1.7 0 0 0 16 5.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 1.88 1.88-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.57 1H22v4h-1.03A1.7 1.7 0 0 0 19.4 15Z"/></svg>
                </button>
                <button class="roll-volume-btn" id="rollVolumeBtn" type="button" aria-label="${this._escapeHtml(this._t('volume'))}" aria-expanded="false" aria-controls="rollVolumePanel">
                    <svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path class="roll-volume-waves" d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/><path class="roll-volume-muted-mark" d="m16 9 5 6m0-6-5 6"/></svg>
                </button>
                <button class="roll-close-btn" id="rollCloseBtn" type="button" aria-label="${this._escapeHtml(this._t('close_wheel'))}">×</button>
                <div class="roll-title" id="rollTitle">${this._escapeHtml(this._t('wheel_title'))}</div>
                <form class="roll-settings-panel" id="rollSettingsPanel" novalidate hidden>
                    <label for="rollDurationInput">${this._escapeHtml(this._t('spin_time'))}</label>
                    <div class="roll-settings-field"><input id="rollDurationInput" type="number" min="2" max="1800" step="1" inputmode="numeric" aria-describedby="rollSettingsHint rollSettingsError" required><span>${this._escapeHtml(this._t('seconds'))}</span></div>
                    <div class="roll-settings-hint" id="rollSettingsHint">${this._escapeHtml(this._t('spin_hint'))}</div>
                    <div class="roll-settings-error" id="rollSettingsError" aria-live="polite"></div>
                    <button class="roll-settings-save" type="submit">${this._escapeHtml(this._t('save'))}</button>
                </form>
                <div class="popover-surface roll-volume-panel roll-volume-control" id="rollVolumePanel" hidden>
                    <label for="rollVolumeInput">${this._escapeHtml(this._t('volume'))}</label>
                    <output id="rollVolumeValue" for="rollVolumeInput" aria-hidden="true"></output>
                    <input id="rollVolumeInput" type="range" min="0" max="100" step="1">
                </div>
                <div class="roll-wheel-stage">
                    <div class="roll-wheel-pointer" aria-hidden="true"></div>
                    <div class="roll-wheel-frame"><div class="roll-wheel" id="rollWheel" aria-hidden="true"></div></div>
                    <button class="roll-wheel-center" id="rollCenterBtn">${this._escapeHtml(this._t('spin'))}</button>
                </div>
                <div class="roll-result" id="rollResult" aria-live="polite"></div>
                <p id="rollPoolHint" hidden aria-live="polite"></p>
                <div class="roll-actions" id="rollActions" style="visibility:hidden">
                    <button class="roll-action-btn secondary" id="rollRerollBtn">${this._escapeHtml(this._t('spin_again'))}</button>
                    <button class="roll-action-btn" id="rollGoBtn" style="flex:3">${this._escapeHtml(this._t('watch'))}</button>
                </div>
            </div>`;
        document.body.appendChild(el);

        const volumeInput = el.querySelector('#rollVolumeInput');
        const volumeValue = el.querySelector('#rollVolumeValue');
        const volumeButton = el.querySelector('#rollVolumeBtn');
        const volumePanel = el.querySelector('#rollVolumePanel');
        const hideVolume = () => {
            volumePanel.hidden = true;
            volumeButton.setAttribute('aria-expanded', 'false');
        };
        const showVolume = () => {
            volumeValue.textContent = `${this.rollVolumePercent}%`;
            const label = this.rollVolumePercent === 0 ? this._t('volume_off_label') : this._t('volume_label', { n: this.rollVolumePercent });
            volumeButton.setAttribute('aria-label', label);
            volumeButton.title = label;
            volumeButton.classList.toggle('is-muted', this.rollVolumePercent === 0);
            volumeInput.setAttribute('aria-valuetext', this.rollVolumePercent === 0
                ? this._t('volume_off') : `${this.rollVolumePercent}%`);
        };
        volumeInput.value = this.rollVolumePercent;
        showVolume();
        volumeInput.addEventListener('input', () => {
            this.rollVolumePercent = Number(volumeInput.value);
            this._rollAudio.setVolume(this.rollVolumePercent / 100);
            localStorage.setItem(ROLL_VOLUME_STORAGE_KEY, String(this.rollVolumePercent));
            showVolume();
        });

        const settingsButton = el.querySelector('#rollSettingsBtn');
        const settingsPanel = el.querySelector('#rollSettingsPanel');
        const durationInput = el.querySelector('#rollDurationInput');
        const settingsError = el.querySelector('#rollSettingsError');
        const hideSettings = () => {
            settingsPanel.hidden = true;
            settingsButton.setAttribute('aria-expanded', 'false');
        };
        volumeButton.addEventListener('click', () => {
            if (volumePanel.hidden) {
                hideSettings();
                volumePanel.hidden = false;
                volumeButton.setAttribute('aria-expanded', 'true');
                volumeInput.focus();
            } else {
                hideVolume();
                volumeButton.focus();
            }
        });
        settingsButton.addEventListener('click', () => {
            if (settingsPanel.hidden) {
                hideVolume();
                durationInput.value = this.rollDurationSeconds;
                settingsError.textContent = '';
                settingsPanel.hidden = false;
                settingsButton.setAttribute('aria-expanded', 'true');
                durationInput.focus();
            } else {
                hideSettings();
                settingsButton.focus();
            }
        });
        settingsPanel.addEventListener('submit', (event) => {
            event.preventDefault();
            const seconds = Number(durationInput.value);
            if (!Number.isInteger(seconds) || seconds < MIN_ROLL_DURATION_SECONDS || seconds > MAX_ROLL_DURATION_SECONDS) {
                settingsError.textContent = this._t('spin_time_error');
                durationInput.focus();
                return;
            }
            this.rollDurationSeconds = seconds;
            localStorage.setItem(ROLL_DURATION_STORAGE_KEY, String(seconds));
            hideSettings();
            settingsButton.focus();
        });
        const close = () => {
            if (!this.rollAnimRunning) {
                this._rollAudio.stop();
                hideSettings();
                hideVolume();
                this._closeModal('rollAnimOverlay');
            }
        };
        el.addEventListener('click', (event) => {
            if (!volumePanel.contains(event.target) && !volumeButton.contains(event.target)) hideVolume();
            if (event.target === el) close();
        });
        el.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !volumePanel.hidden) {
                event.stopPropagation();
                hideVolume();
                volumeButton.focus();
            } else if (event.key === 'Escape' && !this.rollAnimRunning) {
                event.stopPropagation();
                if (!settingsPanel.hidden) {
                    hideSettings();
                    settingsButton.focus();
                } else {
                    close();
                }
            }
        });
        el.querySelector('#rollCloseBtn').addEventListener('click', close);
        el.querySelector('#rollCenterBtn').addEventListener('click', () => this._rollStart?.());
        el.querySelector('#rollRerollBtn').addEventListener('click', () => this._rollAnimationReroll?.());
    }

    _setRollBusy(busy) {
        this.rollAnimRunning = busy;
        const overlay = document.getElementById('rollAnimOverlay');
        if (!overlay) return;
        overlay.querySelector('#rollSettingsBtn').disabled = busy;
        overlay.querySelector('#rollCloseBtn').disabled = busy;
        if (busy) {
            overlay.querySelector('#rollSettingsPanel').hidden = true;
            overlay.querySelector('#rollSettingsBtn').setAttribute('aria-expanded', 'false');
            if (document.activeElement?.disabled && overlay.contains(document.activeElement)) overlay.querySelector('#rollVolumeBtn').focus();
        }
    }

    _showRollReady(entries, start) {
        const candidates = Array.isArray(entries) ? entries.filter(Boolean) : [];
        if (!candidates.length || this.rollAnimRunning) return;
        const overlay = document.getElementById('rollAnimOverlay');
        const wheel = document.getElementById('rollWheel');
        const center = document.getElementById('rollCenterBtn');
        this._rollAnimationId++;
        this._rollAudio.stop();
        this._rollStart = start;
        wheel.classList.remove('roll-wheel--pending');
        wheel.style.transform = 'rotate(0deg)';
        this._renderRollCandidates(wheel, candidates);
        center.disabled = false;
        center.textContent = this._t('spin');
        overlay.querySelector('.roll-title').textContent = this._t('wheel_title');
        overlay.querySelector('#rollResult').textContent = this._t('on_wheel', { n: candidates.length });
        overlay.querySelector('#rollActions').style.visibility = 'hidden';
        overlay.querySelector('#rollPoolHint').hidden = true;
        this._openModal('rollAnimOverlay', 'rollCenterBtn');
        this._setRollBusy(false);
        center.focus();
    }

    _showRollAnimation(entries, winnerIdx, { onWinner = null, reroll = null, actionLabel = null, poolRemovalHint = false } = {}) {
        const candidates = Array.isArray(entries) ? entries.filter(Boolean) : [];
        if (!candidates.length || !Number.isInteger(winnerIdx) || !candidates[winnerIdx]) return;

        const overlay = document.getElementById('rollAnimOverlay');
        const wheel = document.getElementById('rollWheel');
        const center = document.getElementById('rollCenterBtn');
        const result = document.getElementById('rollResult');
        const goBtn = document.getElementById('rollGoBtn');
        const rerollBtn = document.getElementById('rollRerollBtn');
        const actionsBox = document.getElementById('rollActions');

        this._rollAnimationReroll = reroll;
        const finishWinner = onWinner || (async (winner, activeOverlay) => {
            this._closeModal(activeOverlay.id);
            window.location.href = chrome.runtime.getURL(`src/pages/movie-details/movie-details.html?movieId=${winner.kpId}`);
        });
        if (rerollBtn) rerollBtn.hidden = typeof reroll !== 'function';
        rerollBtn.disabled = false;
        actionsBox.style.visibility = 'hidden';
        overlay.querySelector('#rollPoolHint').hidden = true;
        goBtn.disabled = true;
        center.disabled = true;
        center.textContent = this._t('spinning');
        this._setRollBusy(true);
        result.textContent = this._t('choosing');
        const matrix = getComputedStyle(wheel).transform;
        const values = matrix.match(/^matrix\(([^)]+)\)$/)?.[1].split(',').map(Number);
        const startAngle = values ? Math.atan2(values[1], values[0]) * 180 / Math.PI : 0;
        wheel.classList.remove('roll-wheel--pending');
        wheel.style.transform = `rotate(${startAngle}deg)`;
        this._renderRollCandidates(wheel, candidates);
        this._openModal('rollAnimOverlay');
        const stepAngle = 360 / candidates.length;
        // Land at a random point inside the winner slice, away from its edges
        const sliceOffset = .15 + Math.random() * .7;
        const targetAngle = (360 - (winnerIdx + sliceOffset) * stepAngle) % 360;
        const forwardAngle = (targetAngle - startAngle + 360) % 360;
        const fullTurns = Math.max(2, Math.round(this.rollDurationSeconds * .65));
        const endAngle = startAngle + fullTurns * 360 + forwardAngle;
        const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        const duration = reducedMotion ? 0 : this.rollDurationSeconds * 1000;
        const animationId = ++this._rollAnimationId;
        const startTime = performance.now();
        if (duration > 0) this._rollAudio.startSpin(duration);
        else this._rollAudio.stop();

        const step = (now) => {
            if (animationId !== this._rollAnimationId) return;
            const progress = duration ? Math.min((now - startTime) / duration, 1) : 1;
            const eased = 1 - Math.pow(1 - progress, 3);
            wheel.style.transform = `rotate(${startAngle + (endAngle - startAngle) * eased}deg)`;
            if (progress < 1) {
                requestAnimationFrame(step);
            } else {
                this._rollAudio.finish();
                this._setRollBusy(false);
                const winner = candidates[winnerIdx];
                const title = document.createElement('a');
                title.className = 'roll-result-link';
                title.textContent = winner.title || this._t('untitled');
                const movieId = Number(winner.kpId);
                if (Number.isSafeInteger(movieId) && movieId > 0) {
                    title.href = chrome.runtime.getURL(`src/pages/movie-details/movie-details.html?movieId=${movieId}`);
                } else {
                    title.removeAttribute('href');
                }
                result.replaceChildren(title);
                const hint = overlay.querySelector('#rollPoolHint');
                hint.textContent = i18n.get('random.pool.watch_removes');
                hint.hidden = !poolRemovalHint;
                overlay.querySelector('.roll-title').textContent = this._t('picked');
                goBtn.textContent = typeof actionLabel === 'function'
                    ? actionLabel(winner)
                    : this._t('watch_title', { title: winner.title });
                actionsBox.style.visibility = 'visible';
                goBtn.disabled = false;
                center.textContent = this._t('done');
                goBtn.onclick = async () => {
                    if (animationId !== this._rollAnimationId || this.rollAnimRunning || this._disposed) return;
                    this._rollAudio.stop();
                    goBtn.disabled = true;
                    rerollBtn.disabled = true;
                    this._setRollBusy(true);
                    try {
                        await finishWinner(winner, overlay);
                    } finally {
                        if (animationId === this._rollAnimationId && !this._disposed) {
                            this._setRollBusy(false);
                            goBtn.disabled = false;
                            rerollBtn.disabled = false;
                        }
                    }
                };
            }
        };
        requestAnimationFrame(step);
    }

    _renderRollCandidates(wheel, candidates) {
        wheel.replaceChildren();
        const count = candidates.length;
        if (!count) return;

        const baseAngle = -90;
        const sectorAngle = 360 / count;
        const getBoundaryAngle = (index) => baseAngle + index * sectorAngle;

        candidates.forEach((movie, index) => {
            const startAngle = getBoundaryAngle(index);
            const middleAngle = startAngle + sectorAngle / 2;

            const slice = document.createElement('div');
            slice.className = 'roll-wheel-slice';

            if (count === 1) {
                slice.style.clipPath = 'circle(50% at 50% 50%)';
            } else {
                const points = ['50% 50%'];
                const arcSteps = Math.max(6, Math.ceil(sectorAngle / 2));
                for (let point = 0; point <= arcSteps; point++) {
                    const angleDeg = startAngle + (point / arcSteps) * sectorAngle;
                    const rad = angleDeg * Math.PI / 180;
                    points.push(`${(50 + 50 * Math.cos(rad)).toFixed(4)}% ${(50 + 50 * Math.sin(rad)).toFixed(4)}%`);
                }
                slice.style.clipPath = `polygon(${points.join(', ')})`;
            }

            const radians = middleAngle * Math.PI / 180;
            const art = document.createElement('img');
            art.className = 'roll-wheel-poster';
            art.alt = '';
            art.style.left = count === 1 ? '50%' : `${(50 + 31 * Math.cos(radians)).toFixed(4)}%`;
            art.style.top = count === 1 ? '50%' : `${(50 + 31 * Math.sin(radians)).toFixed(4)}%`;
            art.style.width = count === 1 ? '100%' : `${Math.min(70, Math.max(18, 130 * Math.sin(Math.PI / count)))}%`;
            if (count === 1) art.style.height = '100%';

            const posterUrls = getMarathonPosterUrls(movie.poster, movie.kpId);
            let posterIndex = 0;
            const nextPoster = () => {
                if (posterIndex >= posterUrls.length) {
                    art.removeAttribute('src');
                    slice.classList.add('roll-wheel-slice--no-poster');
                    return;
                }
                art.src = posterUrls[posterIndex++];
            };
            if (posterUrls.length) {
                art.addEventListener('error', nextPoster);
                nextPoster();
            } else {
                slice.classList.add('roll-wheel-slice--no-poster');
            }

            const label = document.createElement('span');
            label.className = 'roll-wheel-fallback';
            label.textContent = String(index + 1).padStart(2, '0');
            label.style.left = art.style.left;
            label.style.top = art.style.top;

            slice.append(art, label);
            wheel.appendChild(slice);
        });

        if (count > 1) {
            const svgNs = 'http://www.w3.org/2000/svg';
            const linesSvg = document.createElementNS(svgNs, 'svg');
            linesSvg.setAttribute('class', 'roll-wheel-lines');
            linesSvg.setAttribute('viewBox', '0 0 100 100');
            linesSvg.setAttribute('aria-hidden', 'true');

            const rInner = 12;
            const rOuter = 50;

            for (let i = 0; i < count; i++) {
                const boundaryAngle = getBoundaryAngle(i);
                const rad = boundaryAngle * Math.PI / 180;
                const cos = Math.cos(rad);
                const sin = Math.sin(rad);

                const line = document.createElementNS(svgNs, 'line');
                line.setAttribute('class', 'roll-wheel-line');
                line.setAttribute('x1', (50 + rInner * cos).toFixed(4));
                line.setAttribute('y1', (50 + rInner * sin).toFixed(4));
                line.setAttribute('x2', (50 + rOuter * cos).toFixed(4));
                line.setAttribute('y2', (50 + rOuter * sin).toFixed(4));
                line.setAttribute('stroke', 'var(--ui-color-content)');
                line.setAttribute('stroke-width', '3.5');
                line.setAttribute('stroke-linecap', 'round');
                line.setAttribute('vector-effect', 'non-scaling-stroke');
                linesSvg.appendChild(line);
            }

            wheel.appendChild(linesSvg);
        }
    }

    /** Load and display a specific movie by Kinopoisk ID */
    async _loadMovieById(kpId) {
        this.showState('loading');
        this.toggleConfig(false);
        try {
            if (window.firebaseManager) {
                await window.firebaseManager.waitForAuthReady();
            }
            const movie = await this.kinopoiskService.getMovieById(kpId);
            if (movie) {
                this.displayMovie(movie);
            } else {
                this.showState('error');
            }
        } catch (error) {
            console.error('RandomManager: Error loading movie by id:', error);
            this.showState('error');
        }
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    new RandomManager();
});
