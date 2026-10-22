import {
    PINNED_LIMIT,
    computeDecades,
    computeFavoritePeople,
    computeMonthlyActivity,
    computeTasteMatch,
    computeWatchTime,
    normalizePinned,
    reactableRatingIds,
    summarizeMarathon,
    summarizeReactions,
    swapPinned,
    togglePinned
} from './ProfileInsights.js';

// Firestore `in` queries accept at most 30 values; only existing documents are billed.
const IN_QUERY_CHUNK = 30;

function chunk(values, size) {
    const chunks = [];
    for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
    return chunks;
}

/**
 * Profile statistics, taste match, received reactions, marathon history and
 * pinned favorites. Reads stay bounded: the user's ratings come from the
 * ProfileService snapshot the page already loaded, movie metadata from one
 * batched cache read, reaction summaries and marathon items from `in`/equality
 * queries that bill only for documents that exist.
 */
export class ProfileInsightsView {
    constructor({ db, profileService, userService, i18n, safeImageUrl, escapeHtml, movieUrl, onPinnedChange }) {
        this.db = db;
        this.profileService = profileService;
        this.userService = userService;
        this.i18n = i18n;
        this.safeImageUrl = safeImageUrl;
        this.escape = escapeHtml;
        this.movieUrl = movieUrl;
        this.onPinnedChange = onPinnedChange;
        this.loadId = 0;
        this.reactionMeta = null;
        this.pinned = [];
        this.pinSaving = false;
        this.elements = {
            favorites: document.getElementById('profileFavorites'),
            favoritesList: document.getElementById('profileFavoritesList'),
            favoritesHint: document.getElementById('profileFavoritesHint'),
            insights: document.getElementById('profileInsights')
        };
    }

    t(key, params = {}) {
        let text = this.i18n.get(`profile.insights.${key}`);
        Object.entries(params).forEach(([name, value]) => { text = text.replaceAll(`{${name}}`, String(value)); });
        return text;
    }

    get locale() {
        return this.i18n.currentLocale === 'ru' ? 'ru-RU' : 'en-US';
    }

    reset() {
        this.loadId++;
        if (this.elements.insights) {
            this.elements.insights.replaceChildren();
            this.elements.insights.hidden = true;
        }
    }

    /**
     * Loads and renders every insight card for one profile. Cards appear as their
     * data arrives; a failed source hides only its own card.
     */
    async load({ targetUid, viewerUid, isOther }) {
        const loadId = ++this.loadId;
        const container = this.elements.insights;
        if (!container || !targetUid) return;
        container.replaceChildren();
        const stale = () => loadId !== this.loadId;

        let ratings;
        try {
            ratings = await this.profileService.getSortedUniqueRatings(targetUid);
        } catch (error) {
            console.warn('ProfileInsights: ratings unavailable', error);
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
        container.hidden = false;
        container.append(this.renderStatsCard(ratings, movies, isOther));

        const tasks = [
            this.loadReactions(ratings, titles).then(card => card && !stale() && container.append(card)),
            this.loadMarathon(targetUid, isOther).then(card => card && !stale() && container.append(card))
        ];
        if (isOther && viewerUid) {
            tasks.unshift(this.loadTasteMatch(viewerUid, ratings, titles).then(card => {
                // The match is the most personal card on someone else's profile: keep it first.
                if (card && !stale()) container.prepend(card);
            }));
        }
        await Promise.allSettled(tasks);
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

    card(className, title, subtitle = '') {
        const section = document.createElement('section');
        section.className = `profile-dashboard-card insight-card ${className}`;
        section.innerHTML = `
            <div class="dashboard-section-header">
                <div>
                    <h2 class="section-title">${this.escape(title)}</h2>
                    ${subtitle ? `<p class="dashboard-section-subtitle">${this.escape(subtitle)}</p>` : ''}
                </div>
            </div>
            <div class="insight-card__body"></div>`;
        return { section, body: section.querySelector('.insight-card__body') };
    }

    // ---- Statistics ------------------------------------------------------------

    renderStatsCard(ratings, movies, isOther) {
        const { section, body } = this.card('insight-card--stats', this.t('stats_title'), this.t(isOther ? 'stats_subtitle_other' : 'stats_subtitle'));
        if (!ratings.length) {
            body.innerHTML = `<span class="taste-empty">${this.escape(this.t('stats_empty'))}</span>`;
            return section;
        }

        const watch = computeWatchTime(ratings, movies);
        const decades = computeDecades(ratings, movies);
        const topDecade = decades.slice().sort((a, b) => b.count - a.count)[0];
        const hours = Math.round(watch.minutes / 60);
        const watchValue = watch.minutes >= 60 ? this.t('hours', { n: hours.toLocaleString(this.locale) }) : this.t('minutes', { n: watch.minutes });
        const watchNote = watch.films
            ? this.t('watch_note', { films: watch.films }) + (watch.series ? ` · ${this.t('watch_series_note')}` : '')
            : this.t('watch_unknown');
        const days = watch.minutes >= 24 * 60 ? ` <span class="insight-metric__aside">${this.escape(this.t('days', { n: (watch.minutes / 1440).toFixed(1) }))}</span>` : '';

        body.innerHTML = `
            <div class="insight-metrics">
                <div class="insight-metric">
                    <span class="insight-metric__label">${this.escape(this.t('watch_time'))}</span>
                    <strong class="insight-metric__value">${this.escape(watch.films ? watchValue : '—')}${days}</strong>
                    <span class="insight-metric__note">${this.escape(watchNote)}</span>
                </div>
                <div class="insight-metric">
                    <span class="insight-metric__label">${this.escape(this.t('top_decade'))}</span>
                    <strong class="insight-metric__value">${this.escape(topDecade ? this.t('decade', { n: topDecade.decade }) : '—')}</strong>
                    <span class="insight-metric__note">${this.escape(topDecade ? this.t('decade_note', { n: topDecade.count }) : this.t('decades_empty'))}</span>
                </div>
            </div>
            <div class="insight-block">
                <h3 class="insight-block__title">${this.escape(this.t('activity_title'))}</h3>
                ${this.renderActivity(computeMonthlyActivity(ratings))}
            </div>
            <div class="insight-block">
                <h3 class="insight-block__title">${this.escape(this.t('decades_title'))}</h3>
                ${this.renderDecades(decades)}
            </div>
            <div class="insight-block">
                <h3 class="insight-block__title">${this.escape(this.t('people_title'))}</h3>
                ${this.renderPeople(computeFavoritePeople(ratings, movies))}
            </div>`;
        return section;
    }

    renderActivity(buckets) {
        const max = Math.max(...buckets.map(bucket => bucket.count), 0);
        if (max === 0) return `<span class="taste-empty">${this.escape(this.t('activity_empty'))}</span>`;
        const monthName = new Intl.DateTimeFormat(this.locale, { month: 'short' });
        const fullName = new Intl.DateTimeFormat(this.locale, { month: 'long', year: 'numeric' });
        const bars = buckets.map(bucket => {
            const date = new Date(bucket.year, bucket.month, 1);
            const height = bucket.count ? Math.max(6, Math.round((bucket.count / max) * 100)) : 0;
            const label = this.t('activity_bar', { month: fullName.format(date), n: bucket.count });
            return `
                <div class="insight-activity__col" title="${this.escape(label)}">
                    <span class="insight-activity__count">${bucket.count || ''}</span>
                    <div class="insight-activity__track"><span style="height: ${height}%"></span></div>
                    <span class="insight-activity__month">${this.escape(monthName.format(date).replace('.', ''))}</span>
                </div>`;
        }).join('');
        return `<div class="insight-activity" role="img" aria-label="${this.escape(this.t('activity_title'))}">${bars}</div>`;
    }

    renderDecades(decades) {
        if (!decades.length) return `<span class="taste-empty">${this.escape(this.t('decades_empty'))}</span>`;
        const max = Math.max(...decades.map(item => item.count));
        return `<div class="insight-bars">${decades.map(item => `
            <div class="insight-bars__row">
                <span>${this.escape(this.t('decade', { n: item.decade }))}</span>
                <div class="rating-distribution__bar"><span style="width: ${Math.max(6, Math.round((item.count / max) * 100))}%"></span></div>
                <span class="rating-distribution__count">${item.count}</span>
            </div>`).join('')}</div>`;
    }

    renderPeople({ actors, directors, basis }) {
        if (!actors.length && !directors.length) {
            return `<span class="taste-empty">${this.escape(this.t(basis ? 'people_few' : 'people_empty'))}</span>`;
        }
        const person = entry => {
            const photo = this.safeImageUrl(entry.photo);
            const initials = this.escape(entry.name.charAt(0).toUpperCase());
            const label = this.t('people_count', { n: entry.count });
            return `
                <a class="insight-person" href="../person-details/person-details.html?personKey=kp:${encodeURIComponent(entry.id)}" title="${this.escape(`${entry.name} · ${label}`)}">
                    <span class="insight-person__photo">${photo ? `<img src="${this.escape(photo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : initials}</span>
                    <span class="insight-person__name">${this.escape(entry.name)}</span>
                    <span class="insight-person__count">${this.escape(label)}</span>
                </a>`;
        };
        const group = (titleKey, list) => list.length ? `
            <div class="insight-people__group">
                <span class="insight-people__label">${this.escape(this.t(titleKey))}</span>
                <div class="insight-people">${list.map(person).join('')}</div>
            </div>` : '';
        return group('actors', actors) + group('directors', directors);
    }

    // ---- Taste match -------------------------------------------------------------

    async loadTasteMatch(viewerUid, otherRatings, titles) {
        let ownRatings;
        try {
            ownRatings = await this.profileService.getSortedUniqueRatings(viewerUid);
        } catch (error) {
            console.warn('ProfileInsights: own ratings unavailable for the match', error);
            return null;
        }
        const match = computeTasteMatch(ownRatings, otherRatings);
        const { section, body } = this.card('insight-card--match', this.t('match_title'), this.t('match_subtitle'));
        if (match.score === null) {
            body.innerHTML = `<span class="taste-empty">${this.escape(this.t(match.common ? 'match_few' : 'match_none', { n: match.common }))}</span>`;
            return section;
        }
        const poster = pair => {
            const info = titles.get(pair.movieId) || {};
            const title = info.title || '';
            return `
                <a class="insight-poster" href="${this.escape(this.movieUrl(pair.movieId))}" title="${this.escape(title)}">
                    ${info.posterUrl ? `<img src="${this.escape(info.posterUrl)}" alt="${this.escape(title)}" loading="lazy">` : `<span class="insight-poster__fallback">${this.escape(title)}</span>`}
                    <span class="insight-poster__scores">${pair.mine} · ${pair.theirs}</span>
                </a>`;
        };
        const disagreement = pair => {
            const info = titles.get(pair.movieId) || {};
            return `
                <li>
                    <a href="${this.escape(this.movieUrl(pair.movieId))}">${this.escape(info.title || '')}</a>
                    <span class="insight-diff">${this.escape(this.t('you'))} ${pair.mine} · ${this.escape(this.t('them'))} ${pair.theirs}</span>
                </li>`;
        };
        body.innerHTML = `
            <div class="insight-match">
                <div class="insight-match__score" style="--match: ${match.score}%">
                    <strong>${match.score}%</strong>
                </div>
                <div>
                    <strong class="insight-match__label">${this.escape(this.t('match_label', { n: match.score }))}</strong>
                    <span class="insight-metric__note">${this.escape(this.t('match_common', { n: match.common }))}</span>
                </div>
            </div>
            <div class="insight-block">
                <h3 class="insight-block__title">${this.escape(this.t('both_liked'))}</h3>
                ${match.bothLiked.length
                    ? `<div class="insight-posters">${match.bothLiked.map(poster).join('')}</div>`
                    : `<span class="taste-empty">${this.escape(this.t('both_liked_empty'))}</span>`}
            </div>
            <div class="insight-block">
                <h3 class="insight-block__title">${this.escape(this.t('disagreements'))}</h3>
                ${match.disagreements.length
                    ? `<ul class="insight-list">${match.disagreements.map(disagreement).join('')}</ul>`
                    : `<span class="taste-empty">${this.escape(this.t('disagreements_empty'))}</span>`}
            </div>`;
        return section;
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

    async loadReactions(ratings, titles) {
        const ids = reactableRatingIds(ratings);
        let summaries = [];
        try {
            const documentId = firebase.firestore.FieldPath.documentId();
            const snapshots = await Promise.all(chunk(ids, IN_QUERY_CHUNK).map(part => this.db
                .collection('commentReactionSummaries').where(documentId, 'in', part).get()));
            snapshots.forEach(snapshot => snapshot.forEach(doc => summaries.push({ id: doc.id, ...doc.data() })));
        } catch (error) {
            console.warn('ProfileInsights: reaction summaries unavailable', error);
            return null;
        }
        const summary = summarizeReactions(summaries);
        const { section, body } = this.card('insight-card--reactions', this.t('reactions_title'), this.t('reactions_subtitle'));
        if (!summary.total) {
            body.innerHTML = `<span class="taste-empty">${this.escape(this.t('reactions_empty'))}</span>`;
            return section;
        }
        const meta = await this.loadReactionMeta();
        const icon = type => {
            const reaction = meta[type];
            if (!reaction) return '';
            const image = reaction.renderType === 'image' ? this.safeImageUrl(reaction.imageUrl) : '';
            return image
                ? `<img src="${this.escape(image)}" alt="${this.escape(reaction.label)}" title="${this.escape(reaction.label)}">`
                : `<span title="${this.escape(reaction.label)}">${this.escape(reaction.emoji)}</span>`;
        };
        const byRating = new Map(ratings.map(rating => [String(rating.id), rating]));
        const types = summary.byType.filter(item => meta[item.type]).slice(0, 6);
        body.innerHTML = `
            <div class="insight-metrics insight-metrics--single">
                <div class="insight-metric">
                    <span class="insight-metric__label">${this.escape(this.t('reactions_total'))}</span>
                    <strong class="insight-metric__value">${summary.total.toLocaleString(this.locale)}</strong>
                    <span class="insight-metric__note">${this.escape(this.t('reactions_reviews', { n: summary.reviews }))}</span>
                </div>
            </div>
            ${types.length ? `<div class="insight-reactions">${types.map(item => `<span class="insight-reaction">${icon(item.type)}<b>${item.count}</b></span>`).join('')}</div>` : ''}
            <div class="insight-block">
                <h3 class="insight-block__title">${this.escape(this.t('reactions_top'))}</h3>
                <ul class="insight-list">${summary.top.map(item => {
                    const rating = byRating.get(item.ratingId);
                    const movieId = String(rating?.movieId ?? item.movieId ?? '');
                    const title = titles.get(movieId)?.title || this.i18n.get('profile.unknown_title');
                    return `<li>
                        <a href="${this.escape(this.movieUrl(movieId))}">${this.escape(title)}</a>
                        <span class="insight-diff">${this.escape(this.t('reactions_count', { n: item.total }))}</span>
                    </li>`;
                }).join('')}</ul>
            </div>`;
        return section;
    }

    // ---- Marathon history ------------------------------------------------------------

    async loadMarathon(targetUid, isOther) {
        let items = [];
        try {
            const snapshot = await this.db.collection('randomMarathons').doc('current')
                .collection('items').where('addedBy', '==', targetUid).get();
            snapshot.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
        } catch (error) {
            // Unapproved accounts cannot read the marathon; the card is simply absent.
            console.warn('ProfileInsights: marathon history unavailable', error?.code || error);
            return null;
        }
        const summary = summarizeMarathon(items);
        const { section, body } = this.card('insight-card--marathon', this.t('marathon_title'), this.t(isOther ? 'marathon_subtitle_other' : 'marathon_subtitle'));
        if (!summary.added) {
            body.innerHTML = `<span class="taste-empty">${this.escape(this.t(isOther ? 'marathon_empty_other' : 'marathon_empty'))}</span>`;
            return section;
        }
        const metric = (label, value) => `
            <div class="insight-metric">
                <span class="insight-metric__label">${this.escape(label)}</span>
                <strong class="insight-metric__value">${value}</strong>
            </div>`;
        body.innerHTML = `
            <div class="insight-metrics insight-metrics--three">
                ${metric(this.t('marathon_rounds'), summary.rounds)}
                ${metric(this.t('marathon_added'), summary.added)}
                ${metric(this.t('marathon_selected'), summary.selected)}
            </div>
            <div class="insight-block">
                <h3 class="insight-block__title">${this.escape(this.t('marathon_watched'))}</h3>
                ${summary.watched.length ? `<div class="insight-posters">${summary.watched.map(item => {
                    const poster = this.safeImageUrl(item.posterUrl);
                    return `<a class="insight-poster" href="${this.escape(this.movieUrl(item.movieId))}" title="${this.escape(item.title)}">
                        ${poster ? `<img src="${this.escape(poster)}" alt="${this.escape(item.title)}" loading="lazy">` : `<span class="insight-poster__fallback">${this.escape(item.title)}</span>`}
                        ${item.roundId ? `<span class="insight-poster__scores">${this.escape(this.t('marathon_round', { n: item.roundId }))}</span>` : ''}
                    </a>`;
                }).join('')}</div>` : `<span class="taste-empty">${this.escape(this.t('marathon_watched_empty'))}</span>`}
            </div>`;
        return section;
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
            favoritesHint.hidden = !isOwn;
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
