import {
    PINNED_LIMIT,
    computeDecades,
    computeFavoritePeople,
    computeGenres,
    computeTasteMatch,
    computeWatchTime,
    fillDecades,
    normalizePinned,
    reactableRatingIds,
    summarizeMarathon,
    summarizeReactions,
    swapPinned,
    togglePinned
} from './ProfileInsights.js';
import { ProfileActivityCalendar } from './ProfileActivityCalendar.js';

// Firestore `in` queries accept at most 30 values; only existing documents are billed.
const IN_QUERY_CHUNK = 30;

function chunk(values, size) {
    const chunks = [];
    for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
    return chunks;
}

/**
 * The ratings calendar and taste match of «Обзор», the whole «Статистика» tab and
 * pinned favorites. Reads stay bounded: the user's ratings come from the
 * ProfileService snapshot the page already loaded, movie metadata from one
 * batched cache read. Reaction summaries and marathon items are read when the
 * statistics tab first opens, by `in`/equality queries that bill only for
 * documents that exist.
 */
export class ProfileInsightsView {
    constructor({ db, profileService, userService, i18n, safeImageUrl, escapeHtml, movieUrl, onPinnedChange, onWatchTime }) {
        this.db = db;
        this.profileService = profileService;
        this.userService = userService;
        this.i18n = i18n;
        this.safeImageUrl = safeImageUrl;
        this.escape = escapeHtml;
        this.movieUrl = movieUrl;
        this.onPinnedChange = onPinnedChange;
        this.onWatchTime = onWatchTime;
        this.loadId = 0;
        this.data = null;
        this.statisticsRequested = false;
        this.reactionMeta = null;
        this.pinned = [];
        this.pinSaving = false;
        this.elements = {
            favorites: document.getElementById('profileFavorites'),
            favoritesList: document.getElementById('profileFavoritesList'),
            favoritesHint: document.getElementById('profileFavoritesHint'),
            activity: document.getElementById('profileActivity'),
            match: document.getElementById('profileMatch'),
            insights: document.getElementById('profileInsights')
        };
    }

    t(key, params = {}) {
        let text = this.i18n.get(`profile.insights.${key}`);
        Object.entries(params).forEach(([name, value]) => { text = text.replaceAll(`{${name}}`, String(value)); });
        return text;
    }

    /** A text whose noun form follows the number: `key_one`, `key_few`, `key_many`, `key_other`. */
    tn(key, n, params = {}) {
        let category;
        try { category = new Intl.PluralRules(this.locale).select(n); } catch { category = 'other'; }
        return this.t(`${key}_${category}`, { n: n.toLocaleString(this.locale), ...params });
    }

    get locale() {
        return this.i18n.currentLocale === 'ru' ? 'ru-RU' : 'en-US';
    }

    /** Clears everything that belonged to the previous profile or load. */
    reset() {
        this.loadId++;
        this.data = null;
        const { activity, match, insights } = this.elements;
        if (activity) {
            activity.replaceChildren();
            activity.hidden = false;
            activity.classList.add('is-loading');
            activity.setAttribute('aria-busy', 'true');
        }
        if (match) {
            match.replaceChildren();
            match.hidden = true;
        }
        if (insights) insights.innerHTML = this.loader();
    }

    loader() {
        return `
            <div class="app-loader app-loader--inline app-loader--compact" role="status" aria-label="${this.escape(this.i18n.get('profile.loading'))}">
                <div class="app-loader__indicator" aria-hidden="true"></div>
            </div>`;
    }

    /**
     * Loads one profile's ratings and movie metadata and renders what «Обзор»
     * shows; the statistics tab renders now if it is open, otherwise on opening.
     */
    async load({ targetUid, viewerUid, isOther, displayName = '' }) {
        if (!targetUid) return;
        this.reset();
        const loadId = this.loadId;
        const stale = () => loadId !== this.loadId;

        let ratings;
        try {
            ratings = await this.profileService.getSortedUniqueRatings(targetUid);
        } catch (error) {
            console.warn('ProfileInsights: ratings unavailable', error);
            if (!stale()) this.showUnavailable();
            return;
        }
        if (stale()) return;

        const movieIds = [...new Set(ratings.map(rating => rating.movieId).filter(Boolean).map(String))];
        let movies = {};
        try {
            movies = movieIds.length ? await this.profileService.movieCacheService.getBatchCachedMovies(movieIds) : {};
        } catch (error) {
            console.warn('ProfileInsights: movie metadata unavailable', error);
        }
        if (stale()) return;

        const titles = this.buildTitleIndex(ratings, movies);
        // The owner picks favorites from their own rated titles, best scores first.
        this.library = isOther ? [] : ratings
            .filter(rating => rating.movieId != null && titles.has(String(rating.movieId)))
            .map(rating => ({ movieId: String(rating.movieId), score: Number(rating.rating) || 0, ...titles.get(String(rating.movieId)) }))
            .sort((a, b) => b.score - a.score);
        this.data = { targetUid, isOther, ratings, movies, titles, watch: computeWatchTime(ratings, movies) };

        this.onWatchTime?.(this.data.watch);
        this.renderActivity();
        if (this.statisticsRequested) this.renderStatistics();
        if (isOther && viewerUid) await this.loadTasteMatch(viewerUid, displayName, stale);
    }

    /** Opening the «Статистика» tab; the first time it also reads reactions and marathons. */
    showStatistics() {
        this.statisticsRequested = true;
        const { insights } = this.elements;
        if (!this.data) {
            if (insights && !insights.childElementCount) insights.innerHTML = this.loader();
            return;
        }
        if (!this.data.statisticsRendered) this.renderStatistics();
    }

    showUnavailable() {
        const { activity, insights } = this.elements;
        this.finishActivity(true);
        if (insights) insights.innerHTML = `<p class="taste-empty">${this.escape(this.i18n.get('profile.recent_ratings_failed'))}</p>`;
        activity?.replaceChildren();
    }

    buildTitleIndex(ratings, movies) {
        const index = new Map();
        for (const rating of ratings) {
            const movieId = String(rating.movieId ?? '');
            if (!movieId) continue;
            const movie = movies[movieId] || movies[Number(movieId)] || {};
            index.set(movieId, {
                title: movie.name || movie.alternativeName || rating.movieTitle || this.i18n.get('profile.unknown_title'),
                posterUrl: this.safeImageUrl(movie.posterUrl || movie.posterPath || rating.posterPath || ''),
                year: movie.year || null
            });
        }
        return index;
    }

    // ---- Ratings by day ------------------------------------------------------------

    finishActivity(hidden) {
        const { activity } = this.elements;
        if (!activity) return;
        activity.hidden = hidden;
        activity.classList.remove('is-loading');
        activity.removeAttribute('aria-busy');
    }

    renderActivity() {
        const { activity } = this.elements;
        const { ratings, titles } = this.data;
        if (!activity) return;
        this.finishActivity(!ratings.length);
        if (!ratings.length) return;
        new ProfileActivityCalendar({
            container: activity,
            t: (key, params) => this.t(key, params),
            tn: (key, n, params) => this.tn(key, n, params),
            locale: this.locale,
            escape: this.escape,
            titleOf: rating => titles.get(String(rating.movieId)) || { title: this.i18n.get('profile.unknown_title'), posterUrl: '' },
            movieUrl: this.movieUrl
        }).render(ratings);
    }

    // ---- Statistics tab --------------------------------------------------------------

    section(className, title, subtitle = '') {
        const section = document.createElement('section');
        section.className = `profile-section ${className}`;
        section.innerHTML = `
            <div class="profile-section__header profile-section__header--text">
                <h2 class="section-title">${this.escape(title)}</h2>
                <p class="dashboard-section-subtitle">${this.escape(subtitle)}</p>
            </div>
            <div class="insight-body"></div>`;
        return { section, subtitle: section.querySelector('.dashboard-section-subtitle'), body: section.querySelector('.insight-body') };
    }

    renderStatistics() {
        const { insights } = this.elements;
        const data = this.data;
        if (!insights || !data) return;
        data.statisticsRendered = true;
        if (!data.ratings.length) {
            insights.innerHTML = `<p class="taste-empty">${this.escape(this.t('stats_empty'))}</p>`;
            return;
        }
        // The slots are in place before their data, so sections never swap or jump.
        const marathon = this.section('insight-marathon', this.t('marathon_title'));
        const reactions = this.section('insight-reactions-card', this.t('reactions_title'));
        marathon.body.innerHTML = this.loader();
        reactions.body.innerHTML = this.loader();
        const pair = document.createElement('div');
        pair.className = 'insight-columns insight-columns--wide';
        pair.append(marathon.section, reactions.section);
        insights.replaceChildren(this.renderTaste(data), this.renderPeople(data), pair);
        const stale = () => data !== this.data;
        return Promise.allSettled([
            this.loadMarathon(data.targetUid, data.isOther, marathon, stale),
            this.loadReactions(data.ratings, data.titles, reactions, stale)
        ]);
    }

    formatWatchTime({ minutes, films }) {
        if (!films) return '—';
        return minutes >= 60
            ? this.t('hours', { n: Math.round(minutes / 60).toLocaleString(this.locale) })
            : this.t('minutes', { n: minutes });
    }

    watchNote(watch) {
        if (!watch.films) return this.t('watch_unknown');
        const days = Math.round(watch.minutes / 1440);
        return [
            this.tn('watch_note', watch.films, { time: this.formatWatchTime(watch) }),
            days > 1 ? this.tn('watch_days', days) : ''
        ].filter(Boolean).join(', ') + (watch.series ? `. ${this.t('watch_series_note')}` : '');
    }

    renderTaste({ ratings, movies, isOther, watch }) {
        const { section, body } = this.section('insight-taste', this.t(isOther ? 'taste_title_other' : 'taste_title'), this.watchNote(watch));
        body.innerHTML = `
            <div class="insight-columns">
                <div>
                    <h3 class="insight-subtitle">${this.escape(this.t('genres_title'))}</h3>
                    ${this.renderGenres(computeGenres(ratings, movies))}
                </div>
                <div>
                    <h3 class="insight-subtitle">${this.escape(this.t('decades_title'))}</h3>
                    ${this.renderDecades(fillDecades(computeDecades(ratings, movies)))}
                </div>
            </div>`;
        return section;
    }

    renderGenres(genres) {
        if (!genres.length) return `<p class="taste-empty">${this.escape(this.t('genres_empty'))}</p>`;
        const max = genres[0].count;
        const score = new Intl.NumberFormat(this.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
        return `<ul class="insight-genres">${genres.map((genre, index) => `
            <li class="insight-genres__row${index ? '' : ' is-top'}">
                <span class="insight-genres__name">${this.escape(genre.name)}</span>
                <span class="insight-genres__bar" aria-hidden="true"><i style="width: ${(genre.count / max) * 100}%"></i></span>
                <span class="insight-genres__count">${this.escape(genre.count)}</span>
                <span class="insight-genres__average">${this.escape(this.t('genre_average', { n: score.format(genre.average) }))}</span>
            </li>`).join('')}</ul>`;
    }

    renderDecades(decades) {
        if (!decades.length) return `<p class="taste-empty">${this.escape(this.t('decades_empty'))}</p>`;
        const max = Math.max(...decades.map(item => item.count));
        return `<ul class="insight-decades">${decades.map(({ decade, count }) => `
            <li class="insight-decades__item${count === max ? ' is-top' : ''}">
                <span class="insight-decades__count">${count || ''}</span>
                <span class="insight-decades__bar" aria-hidden="true"><i style="height: ${(count / max) * 100}%"></i></span>
                <span class="insight-decades__label">${this.escape(decade)}<span>${this.escape(this.t('decade_suffix'))}</span></span>
            </li>`).join('')}</ul>`;
    }

    renderPeople({ ratings, movies }) {
        const { actors, directors, basis } = computeFavoritePeople(ratings, movies);
        const { section, body } = this.section('insight-people-section', this.t('people_title'), this.t('people_note'));
        if (!actors.length && !directors.length) {
            body.innerHTML = `<p class="taste-empty">${this.escape(this.t(basis ? 'people_few' : 'people_empty'))}</p>`;
            return section;
        }
        const person = entry => {
            const photo = this.safeImageUrl(entry.photo);
            const label = this.tn('films_count', entry.count);
            return `
                <li>
                    <a class="insight-person" href="../person-details/person-details.html?personKey=kp:${encodeURIComponent(entry.id)}">
                        <span class="insight-person__photo" aria-hidden="true">${photo ? `<img src="${this.escape(photo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : this.escape(entry.name.charAt(0).toUpperCase())}</span>
                        <span class="insight-person__name">${this.escape(entry.name)}</span>
                        <span class="insight-person__count">${this.escape(label)}</span>
                    </a>
                </li>`;
        };
        const group = (titleKey, list, modifier) => list.length ? `
            <div class="insight-people__group insight-people__group--${modifier}">
                <h3 class="insight-subtitle">${this.escape(this.t(titleKey))}</h3>
                <ul class="insight-people">${list.map(person).join('')}</ul>
            </div>` : '';
        body.innerHTML = `<div class="insight-people__groups">${group('actors', actors, 'actors')}${group('directors', directors, 'directors')}</div>`;
        return section;
    }

    poster({ movieId, title, posterUrl, caption }) {
        return `
            <a class="insight-poster" href="${this.escape(this.movieUrl(movieId))}" title="${this.escape(title)}">
                <span class="insight-poster__image">${posterUrl ? `<img src="${this.escape(posterUrl)}" alt="${this.escape(title)}" loading="lazy" decoding="async">` : `<span class="insight-poster__fallback">${this.escape(title)}</span>`}</span>
                ${caption ? `<span class="insight-poster__caption">${this.escape(caption)}</span>` : ''}
            </a>`;
    }

    // ---- Taste match -------------------------------------------------------------

    async loadTasteMatch(viewerUid, displayName, stale) {
        const { match: container } = this.elements;
        if (!container) return;
        const { ratings, titles } = this.data;
        let ownRatings;
        try {
            ownRatings = await this.profileService.getSortedUniqueRatings(viewerUid);
        } catch (error) {
            console.warn('ProfileInsights: own ratings unavailable for the match', error);
            return;
        }
        if (stale()) return;
        const match = computeTasteMatch(ownRatings, ratings);
        const title = `<h2 class="section-title">${this.escape(this.t('match_title'))}</h2>`;
        container.hidden = false;
        if (match.score === null) {
            container.innerHTML = `<div>${title}<p class="taste-empty">${this.escape(match.common ? this.tn('match_few', match.common) : this.t('match_none'))}</p></div>`;
            return;
        }
        const poster = pair => {
            const info = titles.get(pair.movieId) || {};
            return this.poster({ movieId: pair.movieId, title: info.title || '', posterUrl: info.posterUrl, caption: this.t('match_scores', { mine: pair.mine, theirs: pair.theirs }) });
        };
        const disagreement = pair => `
            <li>
                <a class="insight-list__link" href="${this.escape(this.movieUrl(pair.movieId))}">
                    <span class="insight-list__title">${this.escape(titles.get(pair.movieId)?.title || '')}</span>
                    <span class="insight-list__note">${this.escape(this.t('match_difference', { mine: pair.mine, theirs: pair.theirs, name: displayName || this.t('them') }))}</span>
                </a>
            </li>`;
        container.innerHTML = `
            <div class="profile-match__score">
                ${title}
                <strong class="profile-match__value">${match.score}%</strong>
                <p class="dashboard-section-subtitle">${this.escape(this.tn('match_common', match.common))}</p>
            </div>
            <div>
                <h3 class="insight-subtitle">${this.escape(this.t('both_liked'))}</h3>
                ${match.bothLiked.length
                    ? `<div class="insight-posters">${match.bothLiked.map(poster).join('')}</div>`
                    : `<p class="taste-empty">${this.escape(this.t('both_liked_empty'))}</p>`}
            </div>
            <div>
                <h3 class="insight-subtitle">${this.escape(this.t('disagreements'))}</h3>
                ${match.disagreements.length
                    ? `<ul class="insight-list">${match.disagreements.slice(0, 3).map(disagreement).join('')}</ul>`
                    : `<p class="taste-empty">${this.escape(this.t('disagreements_empty'))}</p>`}
            </div>`;
    }

    // ---- Received reactions --------------------------------------------------------

    async loadReactionMeta() {
        if (this.reactionMeta) return this.reactionMeta;
        const meta = {};
        try {
            const Service = window.CommentReactionService;
            const config = Service ? await new Service({ db: this.db }).loadConfig() : null;
            (config?.reactions || []).forEach(reaction => { meta[reaction.id] = reaction; });
        } catch (error) {
            console.warn('ProfileInsights: reaction catalog unavailable', error);
        }
        this.reactionMeta = meta;
        return meta;
    }

    async loadReactions(ratings, titles, { section, subtitle, body }, stale) {
        const ids = reactableRatingIds(ratings);
        let summaries = [];
        try {
            const documentId = firebase.firestore.FieldPath.documentId();
            const snapshots = await Promise.all(chunk(ids, IN_QUERY_CHUNK).map(part => this.db
                .collection('commentReactionSummaries').where(documentId, 'in', part).get()));
            snapshots.forEach(snapshot => snapshot.forEach(doc => summaries.push({ id: doc.id, ...doc.data() })));
        } catch (error) {
            console.warn('ProfileInsights: reaction summaries unavailable', error);
            if (!stale()) section.remove();
            return;
        }
        if (stale()) return;
        const summary = summarizeReactions(summaries);
        if (!summary.total) {
            body.innerHTML = `<p class="taste-empty">${this.escape(this.t('reactions_empty'))}</p>`;
            return;
        }
        const meta = await this.loadReactionMeta();
        if (stale()) return;
        const icon = type => {
            const reaction = meta[type];
            if (!reaction) return '';
            const image = reaction.renderType === 'image' ? this.safeImageUrl(reaction.imageUrl) : '';
            return image
                ? `<img src="${this.escape(image)}" alt="${this.escape(reaction.label)}" title="${this.escape(reaction.label)}">`
                : `<span role="img" aria-label="${this.escape(reaction.label)}" title="${this.escape(reaction.label)}">${this.escape(reaction.emoji)}</span>`;
        };
        const byRating = new Map(ratings.map(rating => [String(rating.id), rating]));
        const types = summary.byType.filter(item => meta[item.type]).slice(0, 6);
        subtitle.textContent = `${this.tn('reactions_count', summary.total)} ${this.tn('reactions_reviews', summary.reviews)}`;
        body.innerHTML = `
            ${types.length ? `<div class="insight-reactions">${types.map(item => `<span class="insight-reaction">${icon(item.type)}<b>${item.count}</b></span>`).join('')}</div>` : ''}
            <ul class="insight-list" aria-label="${this.escape(this.t('reactions_top'))}">${summary.top.map(item => {
                const rating = byRating.get(item.ratingId);
                const movieId = String(rating?.movieId ?? item.movieId ?? '');
                const title = titles.get(movieId)?.title || this.i18n.get('profile.unknown_title');
                return `<li>
                    <a class="insight-list__link" href="${this.escape(this.movieUrl(movieId))}">
                        <span class="insight-list__title">${this.escape(title)}</span>
                        <span class="insight-list__note">${this.escape(this.tn('reactions_count', item.total))}</span>
                    </a>
                </li>`;
            }).join('')}</ul>`;
    }

    // ---- Marathon history ------------------------------------------------------------

    async loadMarathon(targetUid, isOther, { section, subtitle, body }, stale) {
        let items = [];
        try {
            const snapshot = await this.db.collection('randomMarathons').doc('current')
                .collection('items').where('addedBy', '==', targetUid).get();
            snapshot.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
        } catch (error) {
            // Unapproved accounts cannot read the marathon; the section is simply absent.
            console.warn('ProfileInsights: marathon history unavailable', error?.code || error);
            if (!stale()) section.remove();
            return;
        }
        if (stale()) return;
        const summary = summarizeMarathon(items);
        if (!summary.added) {
            body.innerHTML = `<p class="taste-empty">${this.escape(this.t(isOther ? 'marathon_empty_other' : 'marathon_empty'))}</p>`;
            return;
        }
        subtitle.textContent = [
            this.tn('marathon_rounds', summary.rounds),
            this.tn('marathon_added', summary.added),
            this.t('marathon_selected', { n: summary.selected })
        ].join(', ');
        body.innerHTML = summary.watched.length
            ? `<div class="insight-posters">${summary.watched.map(item => this.poster({
                movieId: item.movieId,
                title: item.title,
                posterUrl: this.safeImageUrl(item.posterUrl),
                caption: item.roundId ? this.t('marathon_round', { n: item.roundId }) : ''
            })).join('')}</div>`
            : `<p class="taste-empty">${this.escape(this.t('marathon_watched_empty'))}</p>`;
    }

    // ---- Favorite picker ------------------------------------------------------------

    openPicker(trigger) {
        if (!this.isOwn) return;
        this.closePicker();
        this.pickerReturnFocus = trigger || document.activeElement;
        const overlay = document.createElement('div');
        overlay.className = 'favorite-picker-overlay';
        overlay.innerHTML = `
            <div class="favorite-picker" role="dialog" aria-modal="true" aria-labelledby="favoritePickerTitle">
                <div class="favorite-picker__header">
                    <h2 id="favoritePickerTitle">${this.escape(this.t('picker_title'))}</h2>
                    <button type="button" class="favorite-picker__close" data-picker-close aria-label="${this.escape(this.i18n.get('profile.ui.close'))}">×</button>
                </div>
                <input type="search" class="favorite-picker__search" placeholder="${this.escape(this.t('picker_search'))}" aria-label="${this.escape(this.t('picker_search'))}">
                <div class="favorite-picker__list"></div>
            </div>`;
        document.body.append(overlay);
        this.picker = overlay;
        const search = overlay.querySelector('.favorite-picker__search');
        const list = overlay.querySelector('.favorite-picker__list');
        const render = () => this.renderPickerList(list, search.value);
        render();
        search.addEventListener('input', render);
        overlay.addEventListener('click', event => {
            if (event.target === overlay || event.target.closest('[data-picker-close]')) {
                this.closePicker();
                return;
            }
            const option = event.target.closest('[data-pick]');
            if (!option) return;
            const movie = this.library.find(entry => entry.movieId === option.dataset.pick);
            if (movie) this.togglePin(movie).then(() => this.closePicker());
        });
        overlay.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                this.closePicker();
            } else if (event.key === 'Tab') {
                const focusable = [...overlay.querySelectorAll('input, button:not([disabled])')];
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
            }
        });
        search.focus();
    }

    renderPickerList(list, query) {
        const needle = String(query || '').trim().toLowerCase();
        const entries = (this.library || [])
            .filter(entry => !this.isPinned(entry.movieId))
            .filter(entry => !needle || String(entry.title || '').toLowerCase().includes(needle));
        if (!entries.length) {
            list.innerHTML = `<p class="taste-empty">${this.escape(this.t(this.library?.length ? 'picker_empty' : 'picker_no_ratings'))}</p>`;
            return;
        }
        list.innerHTML = entries.slice(0, 60).map(entry => `
            <button type="button" class="favorite-picker__option" data-pick="${this.escape(entry.movieId)}">
                <span class="favorite-picker__poster">${entry.posterUrl ? `<img src="${this.escape(entry.posterUrl)}" alt="" loading="lazy">` : ''}</span>
                <span class="favorite-picker__title">${this.escape(entry.title)}${entry.year ? ` <small>${entry.year}</small>` : ''}</span>
                <span class="favorite-picker__score">${entry.score || '—'}</span>
            </button>`).join('');
    }

    closePicker() {
        if (!this.picker) return;
        this.picker.remove();
        this.picker = null;
        const target = this.pickerReturnFocus;
        this.pickerReturnFocus = null;
        // The slot that opened the picker is re-rendered after a pick; fall back to the list.
        (target?.isConnected ? target : this.elements.favoritesList?.querySelector('[data-add-slot], a'))?.focus?.();
    }

    // ---- Pinned favorites --------------------------------------------------------------

    isPinned(movieId) {
        return this.pinned.some(entry => entry.movieId === String(movieId));
    }

    renderFavorites(pinnedMovies, { isOwn }) {
        const { favorites, favoritesList, favoritesHint } = this.elements;
        this.pinned = normalizePinned(pinnedMovies);
        this.isOwn = isOwn;
        if (!favorites || !favoritesList) return;
        if (!this.pinned.length && !isOwn) {
            favorites.hidden = true;
            return;
        }
        favorites.hidden = false;
        const unpin = this.escape(this.t('unpin'));
        const cards = this.pinned.map((entry, index) => {
            const poster = this.safeImageUrl(entry.posterUrl);
            const title = entry.title || this.i18n.get('profile.unknown_title');
            return `
                <div class="favorite-slot${isOwn ? ' favorite-slot--movable' : ''}" data-index="${index}">
                    <a class="favorite-slot__link" href="${this.escape(this.movieUrl(entry.movieId))}" title="${this.escape(title)}" draggable="false"${isOwn ? ` aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"` : ''}>
                        <span class="favorite-slot__rank">${index + 1}</span>
                        ${poster ? `<img src="${this.escape(poster)}" alt="${this.escape(title)}" loading="lazy" draggable="false">` : `<span class="insight-poster__fallback">${this.escape(title)}</span>`}
                        <span class="favorite-slot__title">${this.escape(title)}${entry.year ? ` <small>${entry.year}</small>` : ''}</span>
                    </a>
                    ${isOwn ? `<button type="button" class="favorite-slot__remove" data-unpin="${this.escape(entry.movieId)}" aria-label="${unpin}: ${this.escape(title)}" title="${unpin}">×</button>` : ''}
                </div>`;
        });
        if (isOwn) {
            for (let index = this.pinned.length; index < PINNED_LIMIT; index++) {
                cards.push(`
                    <div class="favorite-slot">
                        <button type="button" class="favorite-slot--empty" data-add-slot>
                            <span class="favorite-slot__plus" aria-hidden="true">+</span>
                            <span>${this.escape(this.t('add_favorite'))}</span>
                        </button>
                    </div>`);
            }
        }
        favoritesList.innerHTML = cards.join('');
        if (favoritesHint) {
            favoritesHint.hidden = !isOwn || !this.pinned.length;
            favoritesHint.textContent = this.t(this.pinned.length >= PINNED_LIMIT ? 'pinned_full' : 'pinned_hint');
        }
        if (!favoritesList.dataset.bound) {
            favoritesList.dataset.bound = 'true';
            favoritesList.addEventListener('click', event => {
                const addSlot = event.target.closest('[data-add-slot]');
                if (addSlot) {
                    this.openPicker(addSlot);
                    return;
                }
                const button = event.target.closest('[data-unpin]');
                if (!button) return;
                event.preventDefault();
                this.togglePin({ movieId: button.dataset.unpin });
            });
            this.bindReorder(favoritesList);
        }
    }

    // ---- Reordering favorites -------------------------------------------------------------
    // Press and drag a poster onto another one to swap their places. Touch needs a
    // short hold first so a normal swipe still scrolls the page. Alt+Arrow keys swap
    // the focused poster with its neighbour.

    bindReorder(list) {
        const HOLD_MS = 300;
        const MOVE_PX = 6;
        let drag = null;

        const slotAt = (x, y) => {
            const element = document.elementFromPoint(x, y)?.closest('.favorite-slot--movable');
            return element && list.contains(element) && element !== drag?.slot ? element : null;
        };
        const clearTarget = () => list.querySelectorAll('.is-drop-target').forEach(slot => slot.classList.remove('is-drop-target'));
        const start = () => {
            drag.active = true;
            drag.slot.classList.add('is-dragging');
            list.classList.add('is-reordering');
        };
        const finish = commit => {
            if (!drag) return;
            clearTimeout(drag.timer);
            const { slot, active, target } = drag;
            slot.classList.remove('is-dragging');
            slot.style.removeProperty('transform');
            list.classList.remove('is-reordering');
            clearTarget();
            drag = null;
            if (!active) return;
            // The release ends a drag, not a click: do not open the movie.
            // The click (if any) follows pointerup in the same task; drop the guard afterwards.
            const swallow = event => { event.preventDefault(); event.stopPropagation(); };
            list.addEventListener('click', swallow, { capture: true, once: true });
            setTimeout(() => list.removeEventListener('click', swallow, { capture: true }), 0);
            if (commit && target) this.reorderPinned(Number(slot.dataset.index), Number(target.dataset.index));
        };

        list.addEventListener('pointerdown', event => {
            if (!this.isOwn || event.button !== 0 || event.target.closest('[data-unpin]')) return;
            const slot = event.target.closest('.favorite-slot--movable');
            if (!slot) return;
            drag = { slot, pointerId: event.pointerId, x: event.clientX, y: event.clientY, active: false, target: null, touch: event.pointerType !== 'mouse' };
            if (drag.touch) drag.timer = setTimeout(() => drag && start(), HOLD_MS);
        });
        list.addEventListener('pointermove', event => {
            if (!drag || event.pointerId !== drag.pointerId) return;
            const dx = event.clientX - drag.x;
            const dy = event.clientY - drag.y;
            if (!drag.active) {
                if (Math.hypot(dx, dy) < MOVE_PX) return;
                // A touch that moves before the hold is a scroll, not a drag.
                if (drag.touch) { finish(false); return; }
                start();
                drag.slot.setPointerCapture?.(event.pointerId);
            }
            drag.slot.style.transform = `translate(${dx}px, ${dy}px)`;
            const target = slotAt(event.clientX, event.clientY);
            if (target !== drag.target) {
                clearTarget();
                target?.classList.add('is-drop-target');
                drag.target = target;
            }
        });
        list.addEventListener('pointerup', event => drag && event.pointerId === drag.pointerId && finish(true));
        list.addEventListener('pointercancel', () => finish(false));
        // Once a touch drag is active the page must not scroll under the finger.
        list.addEventListener('touchmove', event => { if (drag?.active) event.preventDefault(); }, { passive: false });
        list.addEventListener('contextmenu', event => { if (drag) event.preventDefault(); });

        list.addEventListener('keydown', event => {
            if (!this.isOwn || !event.altKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
            const slot = event.target.closest('.favorite-slot--movable');
            if (!slot) return;
            event.preventDefault();
            const from = Number(slot.dataset.index);
            const to = from + (event.key === 'ArrowLeft' ? -1 : 1);
            if (to < 0 || to >= this.pinned.length) return;
            this.reorderPinned(from, to);
        });
    }

    async reorderPinned(from, to) {
        if (this.pinSaving || !this.isOwn) return;
        const next = swapPinned(this.pinned, from, to);
        if (next.every((entry, index) => entry.movieId === this.pinned[index]?.movieId)) return;
        const previous = this.pinned;
        // Show the new order at once; restore it if saving fails.
        this.renderFavorites(next, { isOwn: true });
        this.elements.favoritesList?.querySelector(`.favorite-slot--movable[data-index="${to}"] .favorite-slot__link`)?.focus({ preventScroll: true });
        this.pinSaving = true;
        try {
            await this.onPinnedChange(next);
        } catch (error) {
            console.error('ProfileInsights: reorder save failed', error);
            this.renderFavorites(previous, { isOwn: true });
            Utils.showToast(this.t('pin_failed'), 'error');
        } finally {
            this.pinSaving = false;
        }
    }

    /** Pin button markup for a rating card on the user's own profile. */
    pinButtonHTML(movie) {
        const pinned = this.isPinned(movie.movieId);
        const label = this.t(pinned ? 'unpin' : 'pin');
        return `<button type="button" class="recent-rating-pin${pinned ? ' is-pinned' : ''}" aria-pressed="${pinned}"
            aria-label="${this.escape(label)}" title="${this.escape(label)}"
            data-pin-movie="${this.escape(movie.movieId)}" data-pin-title="${this.escape(movie.title)}"
            data-pin-poster="${this.escape(movie.posterUrl)}" data-pin-year="${this.escape(movie.year || '')}">
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="${pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5"></path><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"></path></svg>
        </button>`;
    }

    bindPinButtons(list) {
        if (!list || list.dataset.pinBound) return;
        list.dataset.pinBound = 'true';
        list.addEventListener('click', event => {
            const button = event.target.closest('[data-pin-movie]');
            if (!button) return;
            event.preventDefault();
            event.stopPropagation();
            this.togglePin({
                movieId: button.dataset.pinMovie,
                title: button.dataset.pinTitle,
                posterUrl: button.dataset.pinPoster,
                year: button.dataset.pinYear
            });
        });
    }

    syncPinButtons() {
        document.querySelectorAll('[data-pin-movie]').forEach(button => {
            const pinned = this.isPinned(button.dataset.pinMovie);
            const label = this.t(pinned ? 'unpin' : 'pin');
            button.classList.toggle('is-pinned', pinned);
            button.setAttribute('aria-pressed', String(pinned));
            button.setAttribute('aria-label', label);
            button.title = label;
            button.querySelector('svg')?.setAttribute('fill', pinned ? 'currentColor' : 'none');
        });
    }

    async togglePin(movie) {
        if (this.pinSaving || !this.isOwn) return;
        const next = togglePinned(this.pinned, movie);
        if (!next) {
            Utils.showToast(this.t('pinned_full_toast', { n: PINNED_LIMIT }), 'info');
            return;
        }
        this.pinSaving = true;
        try {
            await this.onPinnedChange(next);
            this.renderFavorites(next, { isOwn: true });
            this.syncPinButtons();
        } catch (error) {
            console.error('ProfileInsights: pin save failed', error);
            Utils.showToast(this.t('pin_failed'), 'error');
        } finally {
            this.pinSaving = false;
        }
    }
}
