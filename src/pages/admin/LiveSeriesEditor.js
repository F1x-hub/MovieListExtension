/** Episode catalogue for the live editor. It never reads personal watch progress. */
(function () {
    'use strict';
    const isSeries = movie => movie?.isSeries === true
        || movie?.mediaType === 'tv-series'
        || ['tv-series', 'mini-series', 'animated-series', 'tv', 'series'].includes(String(movie?.type || '').toLowerCase().replace(/_/g, '-'));
    const episodeCode = episode => `S${String(episode.seasonNumber).padStart(2, '0')}E${String(episode.episodeNumber).padStart(2, '0')}`;

    class LiveSeriesEditor {
        constructor({ root, loadCatalogue, onChange, onExisting, onContinue, getItems, getDay, onState }) {
            this.root = root; this.loadCatalogue = loadCatalogue; this.onChange = onChange;
            this.onExisting = onExisting; this.onContinue = onContinue; this.getItems = getItems; this.getDay = getDay;
            this.onState = onState; this.version = 0; this.cache = new Map(); this.movie = null;
            this.selection = null; this.seasons = []; this.episodes = []; this.loading = false; this.busy = false;
            this.continuation = false; this.recorded = null; this.lastAdded = null;
            const $ = suffix => root.querySelector(`#liveSeries${suffix}`);
            this.ui = Object.fromEntries(['Seasons', 'Episodes', 'State', 'Retry', 'Detail', 'Code', 'Title', 'Meta', 'Last', 'Continue']
                .map(key => [key, $(key)]));
            this.pendingFocus = null;
            this.focusListener = event => {
                if (!this.ui.Seasons.contains(event.target) && !this.ui.Episodes.contains(event.target)) this.pendingFocus = null;
            };
            document.addEventListener('focusin', this.focusListener);
            window.addEventListener('pagehide', () => document.removeEventListener('focusin', this.focusListener), { once: true });
            this.ui.Retry.addEventListener('click', () => this.open(this.movie));
            this.ui.Continue.addEventListener('click', () => {
                if (this.busy || this.loading) return;
                if (this.recorded) this.onContinue?.(this.recorded);
                else if (this.existing) this.onExisting?.(this.existing);
            });
        }
        get active() { return isSeries(this.movie); }
        get ready() { return this.active && !this.loading && Boolean(this.selection); }
        get existing() {
            if (!this.selection || !this.movie || this.recorded) return null;
            const day = this.getDay?.() || new Date(window.CinemaChannel.now());
            const start = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
            const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
            return (this.getItems?.() || []).find(item => item.movie?.mediaType === 'tv-series'
                && item.movie.kinopoiskId === this.movie.kinopoiskId
                && item.movie.seasonNumber === this.selection.seasonNumber && item.movie.episodeNumber === this.selection.episodeNumber
                && item.startedAtMs < end && window.CinemaChannel.getScheduleBounds(item).endMs > start) || null;
        }
        notify() { this.onChange?.(this.selection); this.onState?.(); }
        hide() {
            this.version++; this.movie = null; this.selection = null; this.recorded = null;
            this.loading = false; this.continuation = false; this.root.hidden = true;
            this.episodes = []; this.seasons = []; this.preview = null; this.lastAdded = null; this.pendingFocus = null;
        }
        async open(movie, { initial = null, notify = true } = {}) {
            const version = ++this.version;
            if (this.movie?.kinopoiskId !== movie?.kinopoiskId) this.cache.clear();
            this.movie = movie; this.selection = null; this.recorded = null; this.lastAdded = null;
            this.preview = null;
            this.continuation = false; this.loading = true; this.seasons = []; this.episodes = [];
            this.root.hidden = false; this.ui.State.textContent = 'Загружаем сезоны и серии…'; this.ui.Retry.hidden = true;
            this.render(); if (notify) this.notify(); else this.onState?.();
            try {
                const catalogue = await this.loadCatalogue(movie);
                if (version !== this.version) return false;
                this.tmdb = catalogue.tmdb;
                this.movie = { ...movie, tmdbId: catalogue.tmdbId };
                this.seasons = (catalogue.seasons || []).filter(season => Number.isInteger(Number(season.number)) && Number(season.number) >= 0)
                    .map(season => ({ ...season, number: Number(season.number) })).sort((a, b) => a.number - b.number);
                const season = initial ? this.seasons.find(item => item.number === initial.seasonNumber)
                    : this.seasons.find(item => item.number > 0) || this.seasons[0];
                if (!season) throw new Error('Список сезонов пока не опубликован.');
                return await this.loadSeason(season.number, { episodeNumber: initial?.episodeNumber, notify });
            } catch (error) {
                if (version !== this.version) return false;
                this.fail(error); return false;
            }
        }
        fail(error) {
            this.loading = false; this.selection = null; this.ui.State.textContent = error?.message || 'Не удалось получить список серий. Попробуйте снова.';
            this.ui.Retry.hidden = false; this.render(); this.notify();
        }
        async loadSeason(number, { episodeNumber = null, notify = true, firstOnly = false } = {}) {
            const version = ++this.version;
            this.seasonNumber = number; this.selection = null; this.recorded = null;
            this.episodes = []; this.preview = null; this.loading = true; this.ui.State.textContent = 'Загружаем серии…'; this.ui.Retry.hidden = true;
            this.render(); if (notify) this.notify(); else this.onState?.();
            try {
                let data = this.cache.get(number);
                if (!data) {
                    data = await this.tmdb.getSeasonDetails(this.movie.tmdbId, number);
                    if (version !== this.version) return false;
                    if (!Array.isArray(data?.episodes) || !data.episodes.length) throw new Error('Список серий пока не опубликован.');
                    this.cache.set(number, data);
                }
                if (version !== this.version) return false;
                this.episodes = data.episodes.filter(ep => Number.isSafeInteger(Number(ep.episodeNumber)) && Number(ep.episodeNumber) > 0)
                    .map(ep => ({ ...ep, seasonNumber: number, episodeNumber: Number(ep.episodeNumber),
                        name: String(ep.name || `Серия ${ep.episodeNumber}`).slice(0, 200) }))
                    .sort((a, b) => a.episodeNumber - b.episodeNumber);
                if (!this.episodes.length) throw new Error('Список серий пока не опубликован.');
                this.loading = false; this.ui.State.textContent = '';
                const target = this.episodes.find(ep => ep.episodeNumber === episodeNumber)
                    || (firstOnly ? this.episodes[0] : this.episodes.find(ep => this.released(ep)) || this.episodes[0]);
                this.select(target, { notify, continuation: this.continuation }); return true;
            } catch (error) {
                if (version !== this.version) return false;
                this.fail(error); return false;
            }
        }
        released(ep) {
            const date = ep.airDate ? Date.parse(`${String(ep.airDate).slice(0, 10)}T00:00:00`) : NaN;
            return !Number.isFinite(date) || date <= window.CinemaChannel.now();
        }
        select(ep, { notify = true, continuation = false } = {}) {
            this.recorded = null; this.continuation = continuation;
            this.selection = this.released(ep) ? {
                mediaType: 'tv-series', seasonNumber: ep.seasonNumber, episodeNumber: ep.episodeNumber,
                episodeTitle: ep.name, tmdbId: this.movie.tmdbId,
                durationSec: Number(ep.runtime) > 0 ? Math.round(Number(ep.runtime) * 60) : 0
            } : null;
            this.preview = ep;
            this.ui.State.textContent = this.selection ? '' : `Серия ещё не вышла${ep.airDate ? ` · ${ep.airDate}` : ''}.`;
            this.render(); if (notify) this.notify(); else this.onState?.();
        }
        setRecorded(movie, item) {
            if (this.movie?.kinopoiskId !== movie.kinopoiskId) { this.cache.clear(); this.seasons = []; this.episodes = []; }
            this.version++; this.movie = movie; this.recorded = item; this.loading = false;
            this.selection = { ...item.movie }; this.preview = { ...item.movie, name: item.movie.episodeTitle || `Серия ${item.movie.episodeNumber}` };
            this.seasonNumber = item.movie.seasonNumber; this.root.hidden = false;
            this.ui.State.textContent = 'Выбран показ из программы. Сезон и серия при переносе сохраняются.';
            this.ui.Retry.hidden = true; this.render();
        }
        async prepareNext(item) {
            this.lastAdded = item; this.recorded = null; this.continuation = true;
            const movie = this.movie;
            const number = item.movie.seasonNumber;
            let current = this.cache.get(number);
            if (!current) {
                const pending = this.open(movie, { initial: item.movie, notify: false });
                // open/loadSeason own their version checks; their success must still
                // belong to this movie before continuation can mutate the draft.
                if (!await pending || this.movie?.kinopoiskId !== movie?.kinopoiskId || this.root.hidden) return false;
                current = this.cache.get(number);
            }
            this.continuation = true; this.lastAdded = item;
            const next = [...(current?.episodes || [])].sort((a, b) => a.episodeNumber - b.episodeNumber)
                .find(ep => ep.episodeNumber > item.movie.episodeNumber);
            if (next) { this.select({ ...next, seasonNumber: number }, { continuation: true }); return true; }
            const season = number > 0 ? this.seasons.find(s => s.number > number) : null;
            if (season) return this.loadSeason(season.number, { firstOnly: true });
            this.selection = null; this.preview = null; this.ui.State.textContent = number === 0
                ? 'Спецвыпуск добавлен. Выберите следующий показ сами.' : 'Это последняя серия. Другие серии автоматически не добавляются.';
            this.render(); this.notify(); return false;
        }
        setBusy(value) { this.busy = Boolean(value); this.syncDisabled(); }
        syncDisabled() {
            this.ui.Seasons.querySelectorAll('button').forEach(button => { button.disabled = this.busy || this.loading; });
            this.ui.Episodes.querySelectorAll('button').forEach(button => { button.disabled = this.busy || this.loading || button.dataset.future === 'true'; });
            this.ui.Retry.disabled = this.busy || this.loading;
            this.ui.Continue.disabled = this.busy || this.loading;
        }
        render() {
            const active = document.activeElement;
            const focus = this.ui.Seasons.contains(active) ? { group: 'Seasons', season: active.dataset.seasonNumber }
                : this.ui.Episodes.contains(active) ? { group: 'Episodes', season: active.dataset.seasonNumber, episode: active.dataset.episodeNumber }
                    : null;
            if (focus) this.pendingFocus = focus;
            else if (active && active !== document.body) this.pendingFocus = null;
            this.root.setAttribute('aria-busy', String(this.loading));
            this.ui.Seasons.replaceChildren(...this.seasons.map(season => {
                const button = document.createElement('button'); button.type = 'button'; button.className = 'live-series__season';
                button.dataset.seasonNumber = String(season.number);
                button.textContent = season.number === 0 ? 'Спецвыпуски' : `Сезон ${season.number}`;
                button.setAttribute('aria-pressed', String(season.number === this.seasonNumber));
                button.addEventListener('click', () => { this.continuation = false; this.loadSeason(season.number); }); return button;
            }));
            const day = this.getDay?.() || new Date(window.CinemaChannel.now());
            const start = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
            const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
            const items = this.getItems?.() || [];
            this.ui.Episodes.replaceChildren(...this.episodes.map(ep => {
                const button = document.createElement('button'); button.type = 'button'; button.className = 'live-series__episode';
                button.dataset.seasonNumber = String(ep.seasonNumber); button.dataset.episodeNumber = String(ep.episodeNumber);
                button.dataset.future = String(!this.released(ep));
                button.setAttribute('aria-pressed', String(ep.seasonNumber === this.selection?.seasonNumber && ep.episodeNumber === this.selection?.episodeNumber));
                const added = items.find(item => item.movie?.kinopoiskId === this.movie.kinopoiskId
                    && item.movie?.seasonNumber === ep.seasonNumber && item.movie?.episodeNumber === ep.episodeNumber
                    && item.startedAtMs < end && window.CinemaChannel.getScheduleBounds(item).endMs > start);
                button.classList.toggle('is-added', Boolean(added));
                const title = document.createElement('strong'); title.textContent = `${ep.episodeNumber} серия`;
                const name = document.createElement('span'); name.textContent = ep.name;
                const meta = document.createElement('small'); meta.textContent = !this.released(ep) ? `Ещё не вышла · ${ep.airDate || ''}`
                    : added ? 'В программе' : Number(ep.runtime) > 0 ? `${ep.runtime} мин` : 'Длительность неизвестна';
                button.append(title, name, meta);
                button.addEventListener('click', () => { if (added) this.onExisting?.(added); else this.select(ep); }); return button;
            }));
            const ep = this.preview; this.ui.Detail.hidden = !ep;
            if (ep) {
                this.ui.Code.textContent = episodeCode(ep); this.ui.Title.textContent = ep.name || ep.episodeTitle || `Серия ${ep.episodeNumber}`;
                this.ui.Meta.textContent = this.recorded ? `Показ ${episodeCode(ep)} · длительность и серия фиксированы`
                    : this.selection?.durationSec ? `Длительность этой серии · ${window.CinemaChannel.formatClock(this.selection.durationSec)}`
                        : 'Укажите длительность этой серии перед добавлением.';
            }
            this.ui.Last.hidden = !this.lastAdded;
            if (this.lastAdded) this.ui.Last.textContent = `Добавлено: ${episodeCode(this.lastAdded.movie)}. Следующая серия добавится только по нажатию кнопки.`;
            this.ui.Continue.hidden = !this.recorded && !this.existing;
            this.ui.Continue.textContent = this.recorded ? 'Подготовить следующую серию' : 'Выбрать существующий показ';
            this.syncDisabled();
            const pending = this.pendingFocus;
            if (pending) {
                const target = [...this.ui[pending.group].querySelectorAll('button')].find(button => !button.disabled
                    && button.dataset.seasonNumber === pending.season
                    && (pending.group === 'Seasons' || button.dataset.episodeNumber === pending.episode));
                if (target) { target.focus({ preventScroll: true }); this.pendingFocus = null; }
                else if (!this.loading) this.pendingFocus = null;
            }
        }
    }
    if (typeof window !== 'undefined') window.LiveSeriesEditor = LiveSeriesEditor;
    if (typeof module !== 'undefined' && module.exports) module.exports = { LiveSeriesEditor, isSeries, episodeCode };
})();
