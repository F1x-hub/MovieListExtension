/**
 * User ratings and reviews on Movie Details: the live ratings list and its
 * Firestore listener, review cards and the review reader, comment reactions,
 * deleting a rating, and this page's side of the shared rating dialog
 * (src/shared/components/RatingDialog.js): the film, its franchise icons and the write.
 *
 * Strangler step: methods moved verbatim from movie-details.js and installed onto
 * MovieDetailsManager.prototype by installMovieDetailsUserRatings(); they reach page state and
 * helpers through `this`. Uses the global `i18n` that I18n.js assigns to window.
 */
(function (global) {
'use strict';

// Module-scoped helpers of movie-details.js. The installer hands over a getter, read
// when a helper runs, as when these methods still lived inside that module.
let readDeps = () => ({});
const getRatingIconMarkup = (...args) => readDeps().getRatingIconMarkup(...args);
const createAppError = (...args) => readDeps().createAppError(...args);
const getRatingTheme = (...args) => readDeps().getRatingTheme(...args);

class MovieDetailsUserRatingsMethods {
    async loadAndDisplayUserRatings(movieId) {
        return this.setupRatingsListener(movieId);
    }

    getRatingsRenderElements(movieId) {
        const ratingsSection = document.getElementById('userRatingsSection');
        if (!ratingsSection || String(ratingsSection.dataset.movieId || '') !== String(movieId)) return null;

        return {
            ratingsSection,
            loadingEl: ratingsSection.querySelector('.user-ratings-loading'),
            contentEl: ratingsSection.querySelector('.user-ratings-content')
        };
    }

    renderRatingsSnapshot(movieId, ratings, currentUser) {
        const renderElements = this.getRatingsRenderElements(movieId);
        if (!renderElements || !Array.isArray(ratings)) return false;

        const { contentEl, loadingEl } = renderElements;
        if (!contentEl) return false;

        if (ratings.length === 0) {
            contentEl.innerHTML = `<div class="user-ratings-empty"><p>${i18n.get('movie_details.empty_reviews')}</p></div>`;
            this._ratingsListEl = null;
        } else {
            contentEl.innerHTML = this.createUserRatingsSection(
                ratings,
                this._userProfileCache || new Map(),
                currentUser?.uid,
                this.commentReactionSummaries,
                this.commentUserReactions
            );
            this._ratingsListEl = contentEl.querySelector('.user-ratings-list');
            this.setupUsernameClickListeners();
        }

        if (loadingEl) loadingEl.style.display = 'none';
        if (this.pendingReviewRatingId && ratings.some(rating => String(rating.id) === String(this.pendingReviewRatingId))) {
            const ratingId = this.pendingReviewRatingId;
            this.pendingReviewRatingId = null;
            setTimeout(() => this.openReviewReaderByRatingId(ratingId), 0);
        }
        return true;
    }

    rehydrateRatingsForCurrentRender(movieId) {
        if (String(this.latestRatingsSnapshotMovieId || '') !== String(movieId)) return false;
        return this.renderRatingsSnapshot(movieId, this.latestRatingsSnapshot || [], this.latestRatingsSnapshotUser);
    }

    setupCommentReactionListeners() {
        if (this._commentReactionListenerBound) return;
        this._commentReactionListenerBound = true;

        document.addEventListener('click', async (event) => {
            const pickerToggle = event.target?.closest?.('[data-action="toggle-comment-reaction-picker"]');
            if (pickerToggle) {
                event.preventDefault();
                event.stopPropagation();
                const reactionBar = pickerToggle.closest('[data-comment-reactions]');
                const picker = reactionBar?.querySelector('[data-comment-reaction-picker]');
                if (reactionBar && picker && typeof CommentReactionBar !== 'undefined') {
                    const open = picker.hidden;
                    CommentReactionBar.setPickerOpen(reactionBar, open);
                    if (open) picker.querySelector('[data-reaction-type]:not([disabled])')?.focus();
                }
                return;
            }

            const button = event.target?.closest?.('[data-action="toggle-comment-reaction"]');
            if (!button) {
                if (!event.target?.closest?.('[data-comment-reactions]') && typeof CommentReactionBar !== 'undefined') {
                    CommentReactionBar.closeOpenPickers();
                }
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            await this.toggleCommentReaction(button);
        });

        this.getModalStack().register('comment-reaction-picker', {
            order: 100,
            isOpen: () => Boolean(
                typeof CommentReactionBar !== 'undefined'
                && document.querySelector('[data-comment-reaction-picker]:not([hidden])')?.closest('[data-comment-reactions]')
            ),
            close: () => {
                const picker = document.querySelector('[data-comment-reaction-picker]:not([hidden])');
                const reactionBar = picker?.closest('[data-comment-reactions]');
                const trigger = reactionBar?.querySelector('[data-action="toggle-comment-reaction-picker"]');
                CommentReactionBar.setPickerOpen(reactionBar, false);
                trigger?.focus();
            }
        });
    }

    async hydrateCommentReactions(ratings, currentUser) {
        const reactionService = firebaseManager.getCommentReactionService?.();
        if (!reactionService || !Array.isArray(ratings) || ratings.length === 0) return;

        const ratingIds = ratings.map((rating) => rating.id).filter(Boolean);
        if (ratingIds.length === 0) return;

        try {
            await reactionService.loadConfig?.();
            if (!this.commentReactionConfigUnsubscribe) {
                this.commentReactionConfigUnsubscribe = reactionService.subscribeToConfig?.(() => {
                    this.refreshCommentReactionBars();
                });
            }
            const [summaryMap, userReactionMap] = await Promise.all([
                reactionService.getSummaryMap(ratingIds),
                currentUser
                    ? reactionService.getUserReactionMap(currentUser.uid, ratingIds)
                    : Promise.resolve(new Map())
            ]);

            ratingIds.forEach((ratingId) => this.commentUserReactions.delete(ratingId));
            summaryMap.forEach((summary, ratingId) => this.commentReactionSummaries.set(ratingId, summary));
            userReactionMap.forEach((types, ratingId) => this.commentUserReactions.set(ratingId, types));

            ratings.forEach((rating) => {
                const bar = document.querySelector(`[data-comment-reactions="true"][data-rating-id="${rating.id}"]`);
                if (bar && typeof CommentReactionBar !== 'undefined') {
                    CommentReactionBar.update(
                        bar,
                        this.commentReactionSummaries.get(rating.id),
                        this.commentUserReactions.get(rating.id) || null
                    );
                }
            });
        } catch (error) {
            console.warn('[CommentReactions] Failed to hydrate reaction state:', error);
        }
    }

    refreshCommentReactionBars() {
        if (typeof CommentReactionBar === 'undefined') return;
        document.querySelectorAll('[data-comment-reactions="true"]').forEach((bar) => {
            const ratingId = bar.getAttribute('data-rating-id');
            if (!ratingId) return;
            CommentReactionBar.update(
                bar,
                this.commentReactionSummaries.get(ratingId),
                this.commentUserReactions.get(ratingId) || null
            );
        });
    }

    async toggleCommentReaction(button) {
        const reactionBar = button.closest('[data-comment-reactions]');
        const ratingId = button.getAttribute('data-rating-id') || reactionBar?.getAttribute('data-rating-id');
        const movieId = button.getAttribute('data-movie-id')
            || reactionBar?.getAttribute('data-movie-id')
            || this.selectedMovie?.kinopoiskId
            || this._currentMovieId;
        const type = button.getAttribute('data-reaction-type');
        if (!ratingId || !movieId || !type || this.commentReactionPending.has(ratingId)) return;

        if (reactionBar && typeof CommentReactionBar !== 'undefined') {
            CommentReactionBar.setPickerOpen(reactionBar, false);
        }

        const currentUser = this.currentUser || firebaseManager.getCurrentUser?.();
        if (!currentUser) {
            Utils.showToast(i18n.get('navbar.sign_in'), 'warning');
            return;
        }

        const reactionService = firebaseManager.getCommentReactionService?.();
        if (!reactionService) return;

        const storedTypes = this.commentUserReactions.get(ratingId);
        const previousTypes = Array.isArray(storedTypes) ? [...storedTypes] : (storedTypes ? [storedTypes] : []);
        const hasReaction = previousTypes.includes(type);
        const maxReactions = typeof CommentReactionService !== 'undefined'
            ? CommentReactionService.MAX_REACTIONS_PER_USER
            : 3;
        if (!hasReaction && previousTypes.length >= maxReactions) {
            Utils.showToast(i18n.get('movie_details.max_reactions'), 'warning');
            return;
        }

        const nextTypes = hasReaction
            ? previousTypes.filter((reactionType) => reactionType !== type)
            : [...previousTypes, type];
        const currentSummary = this.commentReactionSummaries.get(ratingId) || { counts: {} };
        const optimisticCounts = { ...(currentSummary.counts || {}) };

        if (hasReaction) {
            optimisticCounts[type] = Math.max(0, Number(optimisticCounts[type] || 0) - 1);
        } else {
            optimisticCounts[type] = Number(optimisticCounts[type] || 0) + 1;
        }

        const previousOrder = Array.isArray(currentSummary.order)
            ? currentSummary.order
            : Object.keys(currentSummary.counts || {}).filter((k) => Number(currentSummary.counts[k]) > 0);
        const optimisticOrder = [...previousOrder];
        if (!hasReaction && !optimisticOrder.includes(type)) {
            optimisticOrder.push(type);
        } else if (hasReaction && optimisticCounts[type] <= 0) {
            const idx = optimisticOrder.indexOf(type);
            if (idx !== -1) optimisticOrder.splice(idx, 1);
        }

        const optimisticSummary = {
            ...currentSummary,
            ratingId,
            movieId,
            counts: optimisticCounts,
            order: optimisticOrder,
            total: Object.values(optimisticCounts).reduce((sum, c) => sum + c, 0)
        };
        this.commentReactionPending.add(ratingId);
        this.commentUserReactions.set(ratingId, nextTypes);
        this.commentReactionSummaries.set(ratingId, optimisticSummary);

        if (reactionBar && typeof CommentReactionBar !== 'undefined') {
            CommentReactionBar.update(reactionBar, optimisticSummary, nextTypes, { isPending: true });
        }

        try {
            await reactionService.toggleReaction({
                userId: currentUser.uid,
                ratingId,
                movieId,
                type
            });
            this.commentReactionSummaries.set(ratingId, optimisticSummary);
            this.commentUserReactions.set(ratingId, nextTypes);
            if (reactionBar && typeof CommentReactionBar !== 'undefined') {
                CommentReactionBar.update(reactionBar, optimisticSummary, nextTypes, { isPending: false });
            }
        } catch (error) {
            this.commentUserReactions.set(ratingId, previousTypes);
            this.commentReactionSummaries.set(ratingId, currentSummary);
            if (reactionBar && typeof CommentReactionBar !== 'undefined') {
                CommentReactionBar.update(reactionBar, currentSummary, previousTypes, { isPending: false });
            }
            console.error('[CommentReactions] Failed to toggle reaction:', error);
            const message = error?.code === 'MAX_COMMENT_REACTIONS'
                ? i18n.get('movie_details.max_reactions')
                : i18n.get('movie_details.error_loading_reviews');
            Utils.showToast(message, 'error');
        } finally {
            this.commentReactionPending.delete(ratingId);
            if (reactionBar && typeof CommentReactionBar !== 'undefined') {
                const latestSummary = this.commentReactionSummaries.get(ratingId) || optimisticSummary;
                const latestTypes = this.commentUserReactions.get(ratingId) || nextTypes;
                CommentReactionBar.update(reactionBar, latestSummary, latestTypes, { isPending: false });
            }
        }
    }

    async setupRatingsListener(movieId) {
        // Отписываемся от предыдущего слушателя (смена фильма)
        this.destroyRatingsListener();

        if (String(this.latestRatingsSnapshotMovieId || '') !== String(movieId)) {
            this.latestRatingsSnapshot = null;
            this.latestRatingsSnapshotMovieId = null;
            this.latestRatingsSnapshotUser = null;
        }

        const ratingsSection = document.getElementById('userRatingsSection');
        if (!ratingsSection) return;

        const loadingEl = ratingsSection.querySelector('.user-ratings-loading');
        const contentEl = ratingsSection.querySelector('.user-ratings-content');

        if (loadingEl) loadingEl.style.display = 'flex';
        if (contentEl) contentEl.innerHTML = '';

        // Карта профилей пользователей (кеш на время жизни страницы)
        if (!this._userProfileCache) this._userProfileCache = new Map();

        // Используем onAuthStateChanged напрямую от Firebase для надежности
        const auth = firebaseManager.auth;

        if (this._unsubscribeAuthWait) {
            this._unsubscribeAuthWait();
            this._unsubscribeAuthWait = null;
        }

        this._unsubscribeAuthWait = auth.onAuthStateChanged(async (user) => {
            // Сразу отписываемся — нужен только первый вызов при инициализации/смене пользователя
            if (this._unsubscribeAuthWait) {
                this._unsubscribeAuthWait();
                this._unsubscribeAuthWait = null;
            }

            if (!user) {
                console.info('[RatingsListener] No authenticated user, loading public comments');
                this.currentUser = null;
                this.currentPersonalRating = null;
                this.currentSeriesEpisodeRatings = {
                    exists: false, episodes: {}
                };
                this.patchPersonalRating(null, this.capturePageContext(this.selectedMovie));
                this.updateSeriesEpisodeRatingUI();
                await this._startSnapshot(movieId, null, ratingsSection, loadingEl, contentEl);
                return;
            }

            console.log('[RatingsListener] Auth ready, starting snapshot for movieId:', movieId);
            await this._startSnapshot(movieId, user, ratingsSection, loadingEl, contentEl);
        });
    }

    async _startSnapshot(movieId, currentUser, ratingsSection, loadingEl, contentEl) {
        const db = firebaseManager.db;
        if (!db) {
            console.error('[RatingsListener] Firestore not initialized');
            if (contentEl) contentEl.innerHTML = `<div class="user-ratings-error"><p>${i18n.get('movie_details.error_loading_reviews')}</p></div>`;
            if (loadingEl) loadingEl.style.display = 'none';
            return;
        }

        this._currentMovieId = movieId;
        const previousUid = this.currentUser?.uid || null;
        this.currentUser = currentUser;
        if (previousUid !== (currentUser?.uid || null)) {
            this.episodeRatingUiVersion += 1;
            this.isEpisodeRatingMutationPending = false;
            this.currentPersonalRating = null;
            this.currentSeriesEpisodeRatings = {
                exists: false, episodes: {}
            };
            this.patchPersonalRating(null, this.capturePageContext(this.selectedMovie));
            this.updateSeriesEpisodeRatingUI();
            if (currentUser && this.selectedMovie && String(this.selectedMovie.kinopoiskId) === String(movieId)) {
                void this.loadPersonalState(movieId).catch(error => console.warn('[MovieDetails] Failed to refresh personal state after auth change:', error));
            }
        }
        const userService = firebaseManager.getUserService();

        // Флаг первого снимка — нужен, чтобы отобразить спиннер только однажды
        let isFirstSnapshot = true;

        // Инициализируем контейнер списка
        this._ratingsListEl = null;

        // Приводим ID фильма к правильному типу данных для точного сопоставления
        const targetMovieId = typeof movieId === 'number' ? movieId : (Number(movieId) || movieId);

        // Top-level коллекция с фильтром по movieId
        const collectionRef = db
            .collection('ratings')
            .where('movieId', '==', targetMovieId)
            .orderBy('createdAt', 'desc')
            .limit(50);

        this._ratingsUnsubscribe = collectionRef.onSnapshot(
            { includeMetadataChanges: true },
            async (snapshot) => {
                // Оффлайн-уведомление
                const liveRatingsSection = this.getRatingsRenderElements(movieId)?.ratingsSection || ratingsSection;
                if (snapshot.metadata.fromCache && !navigator.onLine) {
                    this._showOfflineBanner(liveRatingsSection);
                } else {
                    this._hideOfflineBanner(liveRatingsSection);
                }

                const isInitialSnapshot = isFirstSnapshot;
                const allRatings = isInitialSnapshot
                    ? snapshot.docs.map(d => ({ id: d.id, ...d.data() }))
                    : null;

                // Comments are useful before profile lookups settle. Keep this
                // snapshot as the render source so a same-movie DOM replacement
                // can rehydrate immediately instead of waiting for Firestore.
                if (isInitialSnapshot) {
                    isFirstSnapshot = false;
                    this.latestRatingsSnapshot = allRatings;
                    this.latestRatingsSnapshotMovieId = String(movieId);
                    this.latestRatingsSnapshotUser = currentUser || null;
                    this.renderRatingsSnapshot(movieId, allRatings, currentUser);
                    if (!snapshot.empty) this.hydrateCommentReactions(allRatings, currentUser);
                } else {
                    this.latestRatingsSnapshot = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
                    this.latestRatingsSnapshotMovieId = String(movieId);
                    this.latestRatingsSnapshotUser = currentUser || null;
                }

                // Ждём профили новых пользователей (только для добавленных)
                const addedDocs = snapshot.docChanges().filter(c => c.type === 'added');
                const newUserIds = addedDocs
                    .map(c => c.doc.data().userId)
                    .filter(uid => uid && !this._userProfileCache.has(uid));

                if (newUserIds.length > 0) {
                    try {
                        const profiles = await userService.getUserProfilesByIds([...new Set(newUserIds)]);
                        profiles.forEach(p => {
                            const key = p.userId || p.id;
                            if (key) this._userProfileCache.set(key, p);
                        });
                    } catch (e) {
                        console.warn('[RatingsListener] Failed to load user profiles:', e);
                    }
                }

                // Также обновляем профиль текущего пользователя, если нужен
                if (currentUser && !this._userProfileCache.has(currentUser.uid)) {
                    try {
                        const p = await userService.getUserProfile(currentUser.uid);
                        if (p) this._userProfileCache.set(currentUser.uid, p);
                    } catch { /* ignore */ }
                }

                if (isInitialSnapshot) {
                    // Refresh names and avatars after profile data arrives. The
                    // renderer resolves the live section rather than the old
                    // closure, so a same-movie rerender remains safe.
                    this.renderRatingsSnapshot(movieId, allRatings, currentUser);
                    return;
                }

                // Инкрементальные обновления
                const liveContentEl = this.getRatingsRenderElements(movieId)?.contentEl || contentEl;
                for (const change of snapshot.docChanges()) {
                    const rating = { id: change.doc.id, ...change.doc.data() };
                    switch (change.type) {
                        case 'added':    await this._onRatingAdded(rating, currentUser?.uid, liveContentEl); break;
                        case 'modified': this._onRatingModified(rating, currentUser?.uid); break;
                        case 'removed':  this._onRatingRemoved(rating.id); break;
                    }
                }
            },
            (error) => {
                console.error('[RatingsListener] Snapshot error:', error);
                if (typeof Utils !== 'undefined') {
                    Utils.showToast(i18n.get('movie_details.error_loading_reviews') || 'Ошибка загрузки отзывов', 'error');
                }
                const liveRenderElements = this.getRatingsRenderElements(movieId);
                const liveContentEl = liveRenderElements?.contentEl || contentEl;
                if (liveContentEl && !liveContentEl.querySelector('.user-ratings-list')) {
                    liveContentEl.innerHTML = `<div class="user-ratings-error"><p>${i18n.get('movie_details.error_loading_reviews')}</p></div>`;
                }
                const liveLoadingEl = liveRenderElements?.loadingEl || loadingEl;
                if (liveLoadingEl) liveLoadingEl.style.display = 'none';
            }
        );

        // Регистрируем обработчики отписки (идемпотентны)
        if (!this._ratingsListenerPageBound) {
            this._ratingsListenerPageBound = true;

            window.addEventListener('beforeunload', () => this.destroyRatingsListener());

            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') {
                    this.destroyRatingsListener();
                } else if (document.visibilityState === 'visible' && this._currentMovieId) {
                    this.setupRatingsListener(this._currentMovieId);
                }
            });
        }
    }

    /** Отписывается от текущего onSnapshot-слушателя */
    destroyRatingsListener() {
        if (this._unsubscribeAuthWait) {
            this._unsubscribeAuthWait();
            this._unsubscribeAuthWait = null;
        }
        if (this._ratingsUnsubscribe) {
            this._ratingsUnsubscribe();
            this._ratingsUnsubscribe = null;
        }
    }

    /** Показывает баннер «нет соединения» внутри секции рейтингов */
    _showOfflineBanner(ratingsSection) {
        if (ratingsSection.querySelector('.ratings-offline-banner')) return;
        const banner = document.createElement('div');
        banner.className = 'ratings-offline-banner';
        banner.innerHTML = '<span style="display:inline-flex;align-items:center;margin-right:6px;"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg></span> Нет соединения — данные могут быть устаревшими';
        ratingsSection.prepend(banner);
    }

    /** Удаляет баннер «нет соединения» */
    _hideOfflineBanner(ratingsSection) {
        ratingsSection.querySelector('.ratings-offline-banner')?.remove();
    }

    /**
     * Рендерит выпадающее меню действий карточки оценки в системном стиле .mc-menu-*
     */
    _renderRatingMenu(ratingId) {
        return `
            <div class="mc-menu-container user-rating-menu-container">
                <button type="button" class="mc-menu-btn" data-rating-id="${this.escapeHtml(ratingId)}" aria-haspopup="true" aria-expanded="false" aria-label="${i18n.get('movie_details.user_ratings_title')}" title="${i18n.get('movie_details.user_ratings_title')}">
                    <span class="mc-menu-icon"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg></span>
                </button>
                <div class="mc-menu-dropdown">
                    <button class="mc-menu-item" data-rating-id="${this.escapeHtml(ratingId)}" data-action="edit-user-rating">
                        <span class="mc-menu-item-icon"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg></span>
                        <span class="mc-menu-item-text">${i18n.get('movie_details.edit')}</span>
                    </button>
                    <button class="mc-menu-item delete-item" data-rating-id="${this.escapeHtml(ratingId)}" data-action="delete-user-rating">
                        <span class="mc-menu-item-icon"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></span>
                        <span class="mc-menu-item-text">${i18n.get('movie_details.delete')}</span>
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * Единая разметка содержимого карточки рейтинга для первичного и инкрементального рендера.
     */
    renderRatingCardInnerHtml(rating, {
        userProfile = this._userProfileCache?.get(rating.userId),
        currentUserId = null,
        reactionSummary = this.commentReactionSummaries?.get(rating.id),
        userReaction = this.commentUserReactions?.get(rating.id) || null
    } = {}) {
        const userName = userProfile?.displayName || rating.userName || 'Пользователь';
        const userPhoto = userProfile?.photoURL || '/src/shared/assets/icons/app/icon48.png';
        const isCurrentUser = Boolean(currentUserId && rating.userId === currentUserId);

        let dateStr = '';
        if (rating.createdAt) {
            const dateObj = rating.createdAt.toDate ? rating.createdAt.toDate() : new Date(rating.createdAt);
            if (!isNaN(dateObj.getTime())) {
                const d = dateObj.getDate().toString().padStart(2, '0');
                const m = (dateObj.getMonth() + 1).toString().padStart(2, '0');
                const y = dateObj.getFullYear();
                dateStr = `<span class="user-rating-date">${d}.${m}.${y}</span>`;
            }
        }

        const normalizedComment = Utils.normalizeRatingComment(rating.comment);
        const commentHtml = normalizedComment
            ? `<div class="user-rating-comment">${Utils.parseSpoilers(Utils.linkify(this.escapeHtml(normalizedComment)))}</div>`
            : '';
        const reactionHtml = typeof CommentReactionBar !== 'undefined'
            ? CommentReactionBar.render({
                ratingId: rating.id,
                movieId: rating.movieId || rating.kinopoiskId || this.selectedMovie?.kinopoiskId || this._currentMovieId,
                summary: reactionSummary,
                userReaction
            })
            : '';

        return `
            <div class="user-rating-header">
                <img src="${this.escapeHtml(userPhoto)}" alt="${this.escapeHtml(userName)}" class="user-rating-avatar" data-fallback="avatar" loading="lazy" decoding="async">
                <div class="user-rating-info">
                    <div class="user-rating-name-row">
                        <span class="user-rating-name clickable-username" role="link" tabindex="0" data-user-id="${this.escapeHtml(rating.userId)}">${this.escapeHtml(userName)}</span>
                        ${dateStr}
                    </div>
                    <div class="user-rating-score"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="color: #eab308; vertical-align: middle; margin-right: 4px;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>${this.escapeHtml(rating.rating)}/10</div>
                </div>
                ${isCurrentUser ? this._renderRatingMenu(rating.id) : ''}
            </div>
            ${commentHtml}
            ${this.renderRatingReview(rating)}
            ${reactionHtml}
        `;
    }

    /**
     * Строит DOM-элемент карточки рейтинга.
     * Используется как для первичного рендера, так и для инкрементального.
     */
    _buildRatingCard(rating, currentUserId) {
        const isCurrentUser = Boolean(currentUserId && rating.userId === currentUserId);
        const card = document.createElement('div');
        card.className = `user-rating-card${isCurrentUser ? ' current-user' : ''}`;
        card.dataset.ratingId = rating.id;
        card.innerHTML = this.renderRatingCardInnerHtml(rating, { currentUserId });
        return card;
    }

    /**
     * Обрабатывает событие «added» от onSnapshot.
     * Не дублирует карточку текущего пользователя, если она уже есть (оптимистичный UI).
     */
    async _onRatingAdded(rating, currentUserId, contentEl) {
        // Если секция пустая (empty-state), очищаем её и создаём список
        if (contentEl) {
            const emptyEl = contentEl.querySelector('.user-ratings-empty');
            if (emptyEl) {
                const container = document.createElement('div');
                container.className = 'user-ratings-container';
                container.innerHTML = `<h4 class="user-ratings-title">${i18n.get('movie_details.user_ratings_title')}</h4>`;
                const list = document.createElement('div');
                list.className = 'user-ratings-list';
                container.appendChild(list);
                contentEl.innerHTML = '';
                contentEl.appendChild(container);
                this._ratingsListEl = list;
            }
        }

        if (!this._ratingsListEl) {
            this._ratingsListEl = contentEl?.querySelector('.user-ratings-list');
        }
        if (!this._ratingsListEl) return;

        // Не дублируем, если карточка уже есть (оптимистичное добавление при сабмите)
        if (this._ratingsListEl.querySelector(`[data-rating-id="${rating.id}"]`)) return;

        const card = this._buildRatingCard(rating, currentUserId);
        card.classList.add('rating-card-visible');
        if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
            card.classList.add('rating-card-entering');
            card.addEventListener('animationend', () => card.classList.remove('rating-card-entering'), { once: true });
        }
        // Новые оценки — в начало списка
        this._ratingsListEl.prepend(card);
        this.hydrateCommentReactions([rating], this.currentUser);

        card.querySelectorAll('.clickable-username').forEach(el => {
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') el.click();
            });
            el.addEventListener('click', (e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                const userId = el.getAttribute('data-user-id');
                if (userId) {
                    e.preventDefault();
                    window.location.href = chrome.runtime.getURL(`src/pages/profile/profile.html?userId=${userId}`);
                }
            });
        });
    }

    /**
     * Обрабатывает событие «modified» от onSnapshot.
     * Обновляет существующую карточку на лету без перерендера всего списка.
     */
    async _onRatingModified(rating, currentUserId) {
        const existingCard = this._ratingsListEl?.querySelector(`[data-rating-id="${rating.id}"]`);
        if (!existingCard) return;

        // Обновляем оценку
        const scoreEl = existingCard.querySelector('.user-rating-score');
        if (scoreEl) scoreEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="color: #eab308; vertical-align: middle; margin-right: 4px;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>${this.escapeHtml(rating.rating)}/10`;

        // Обновляем комментарий
        let commentEl = existingCard.querySelector('.user-rating-comment');
        let reactionBarEl = existingCard.querySelector('.comment-reaction-bar');
        const normalizedComment = Utils.normalizeRatingComment(rating.comment);
        if (normalizedComment) {
            const newHtml = Utils.parseSpoilers(Utils.linkify(this.escapeHtml(normalizedComment)));
            if (commentEl) {
                commentEl.innerHTML = newHtml;
            } else {
                commentEl = document.createElement('div');
                commentEl.className = 'user-rating-comment';
                commentEl.innerHTML = newHtml;
                if (reactionBarEl) {
                    existingCard.insertBefore(commentEl, reactionBarEl);
                } else {
                    existingCard.appendChild(commentEl);
                }
            }
        } else if (commentEl) {
            commentEl.remove();
        }

        const reviewEl = existingCard.querySelector('.user-rating-review');
        const reviewHtml = this.renderRatingReview(rating);
        if (reviewHtml) {
            const wrapper = document.createElement('div');
            wrapper.innerHTML = reviewHtml;
            const nextReviewEl = wrapper.firstElementChild;
            if (reviewEl) {
                reviewEl.replaceWith(nextReviewEl);
            } else if (reactionBarEl) {
                existingCard.insertBefore(nextReviewEl, reactionBarEl);
            } else {
                existingCard.appendChild(nextReviewEl);
            }
        } else if (reviewEl) {
            reviewEl.remove();
        }

        if (!reactionBarEl && typeof CommentReactionBar !== 'undefined') {
            existingCard.insertAdjacentHTML('beforeend', CommentReactionBar.render({
                ratingId: rating.id,
                movieId: rating.movieId || rating.kinopoiskId || this.selectedMovie?.kinopoiskId || this._currentMovieId,
                summary: this.commentReactionSummaries.get(rating.id),
                userReaction: this.commentUserReactions.get(rating.id) || null
            }));
        }

        this.hydrateCommentReactions([rating], this.currentUser);

        // Пульс-анимация при изменении
        existingCard.classList.add('rating-card-updated');
        setTimeout(() => existingCard.classList.remove('rating-card-updated'), 600);
    }

    /** Обрабатывает событие «removed» — убирает карточку с анимацией */
    _onRatingRemoved(ratingId) {
        const existingCard = document.querySelector(`[data-rating-id="${CSS.escape(String(ratingId))}"]`);
        if (!existingCard) return;

        existingCard.classList.add('rating-card-leaving');
        setTimeout(() => {
            existingCard.remove();
            // Если карточек не осталось — показываем empty state
            const list = this._ratingsListEl || document.querySelector('.user-ratings-list');
            if (list && list.children.length === 0) {
                const container = list.closest('.user-ratings-container') || list.parentElement;
                if (container) {
                    container.innerHTML = `<div class="user-ratings-empty"><p>${i18n.get('movie_details.be_first')}</p></div>`;
                }
            }
        }, 300);
    }

    createUserRatingsSection(ratings, userProfileMap, currentUserId, reactionSummaries = this.commentReactionSummaries, userReactions = this.commentUserReactions) {
        if (ratings.length === 0) return `<div class="user-ratings-empty"><p>${i18n.get('movie_details.be_first')}</p></div>`;

        const ratingsHTML = ratings.map(rating => {
            const isCurrentUser = Boolean(currentUserId && rating.userId === currentUserId);
            const innerHtml = this.renderRatingCardInnerHtml(rating, {
                userProfile: userProfileMap?.get(rating.userId),
                currentUserId,
                reactionSummary: reactionSummaries?.get(rating.id),
                userReaction: userReactions?.get(rating.id) || null
            });
            return `<div class="user-rating-card ${isCurrentUser ? 'current-user' : ''}" data-rating-id="${this.escapeHtml(rating.id)}">${innerHtml}</div>`;
        }).join('');

        return `<div class="user-ratings-container"><h4 class="user-ratings-title">${i18n.get('movie_details.user_ratings_title')}</h4><div class="user-ratings-list">${ratingsHTML}</div></div>`;
    }

    renderRatingReview(rating) {
        const review = this.normalizeReviewForDisplay(rating?.review);
        if (!review) return '';

        const previewLimit = 360;
        const reviewChars = Array.from(review);
        const preview = reviewChars.slice(0, previewLimit).join('');
        const suffix = reviewChars.length > previewLimit ? '…' : '';
        return `
            <section class="user-rating-review" aria-label="Подробная рецензия">
                <div class="user-rating-review__label">Рецензия</div>
                <div class="user-rating-review__preview">${Utils.parseSpoilers(Utils.linkify(this.escapeHtml(preview + suffix)))}</div>
                <button class="user-rating-review__read btn btn-secondary" type="button" data-action="read-rating-review" data-rating-id="${this.escapeHtml(rating.id)}">Читать рецензию</button>
            </section>
        `;
    }

    openReviewReaderByRatingId(ratingId) {
        const rating = this.latestRatingsSnapshot?.find(item => String(item.id) === String(ratingId));
        if (rating) {
            this.openReviewReader(rating);
            return;
        }
        if (typeof Utils !== 'undefined') Utils.showToast('Рецензия ещё загружается', 'warning');
    }

    openReviewReader(rating) {
        const review = this.normalizeReviewForDisplay(rating?.review);
        if (!review || !this.elements.reviewReaderModal || !this.elements.reviewReaderBody) return;

        const profile = this._userProfileCache?.get(rating.userId);
        const userName = profile?.displayName || rating.userName || 'Пользователь';
        this.activeReviewReaderRating = rating;
        this.elements.reviewReaderTitle.textContent = `Рецензия — ${userName}`;
        this.elements.reviewReaderMeta.textContent = this.selectedMovie?.name || '';
        this.elements.reviewReaderBody.innerHTML = Utils.parseSpoilers(Utils.linkify(this.escapeHtml(review)));
        Utils.bindSpoilerReveal(this.elements.reviewReaderBody);
        if (this.elements.reviewReaderReport) {
            const isOwnReview = this.currentUser?.uid && this.currentUser.uid === rating.userId;
            this.elements.reviewReaderReport.hidden = Boolean(isOwnReview);
        }
        this.openAccessibleDialog(this.elements.reviewReaderModal, document.activeElement);
    }

    closeReviewReader() {
        this.closeAccessibleDialog(this.elements.reviewReaderModal);
        this.activeReviewReaderRating = null;
    }

    reportActiveReview() {
        const rating = this.activeReviewReaderRating;
        if (!rating || !window.reportWidget?.openForContext) return;
        const context = {
            targetType: 'rating-review',
            targetRatingId: rating.id,
            targetMovieId: Number(rating.movieId || this.selectedMovie?.kinopoiskId),
            targetAuthorId: rating.userId
        };
        this.closeReviewReader();
        window.reportWidget.openForContext(context);
    }

    setupUsernameClickListeners() {
        document.querySelectorAll('.clickable-username').forEach(el => {
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') el.click();
            });
            el.addEventListener('click', (e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                const userId = el.getAttribute('data-user-id');
                if (userId) {
                    e.preventDefault();
                    window.location.href = chrome.runtime.getURL(`src/pages/profile/profile.html?userId=${userId}`);
                }
            });
        });
    }

    async deleteUserRating(ratingId) {
        const confirmed = await window.ConfirmDialog.confirm({
            title: 'Удалить отзыв?',
            message: 'Оценка, комментарий и рецензия к этому фильму будут удалены без возможности восстановления.',
            confirmLabel: 'Удалить',
            danger: true
        });
        if (!confirmed) return;
        try {
            const ratingService = firebaseManager.getRatingService();
            await ratingService.deleteRating(this.currentUser.uid, ratingId);
            // The dialog must not offer it again while the refresh below is on its way.
            this.currentPersonalRating = null;
            document.querySelector(`[data-rating-id="${CSS.escape(String(ratingId))}"]`)?.remove();
            if (typeof Utils !== 'undefined') Utils.showToast('Отзыв удален', 'success');
            // The ratings listener owns the review list; only user-scoped controls need a refresh.
            await this.loadPersonalState(this.selectedMovie.kinopoiskId);
        } catch (error) {
            console.error('Error deleting rating:', error);
            if (typeof Utils !== 'undefined') Utils.showToast('Не удалось удалить отзыв', 'error');
        }
    }

    // Rating dialog: the shared RatingDialog (src/shared/components/RatingDialog.js).
    // This page gives it the film, the franchise icons, the fresh read and the write.
    getRatingDialog() {
        return global.RatingDialog.shared();
    }

    isRatingDialogOpen() {
        return Boolean(global.RatingDialog?.instance?.isOpen());
    }

    async showRatingModal(movie) {
        const dialog = this.getRatingDialog();
        if (dialog.isSaving()) return;
        this.selectedMovie = movie;
        const currentUser = firebaseManager.getCurrentUser();
        if (!currentUser) {
            this.page.showError(createAppError('AUTH_REQUIRED', {
                category: 'auth',
                retryable: false,
                context: { operation: 'rating-modal' }
            }));
            return;
        }
        this.currentUser = currentUser;

        const ratingTheme = getRatingTheme(movie);
        dialog.open({
            movie,
            theme: ratingTheme,
            iconMarkup: getRatingIconMarkup(ratingTheme),
            known: this.currentPersonalRating,
            load: () => firebaseManager.getRatingService().getRating(currentUser.uid, movie.kinopoiskId),
            onLoaded: rating => { this.currentPersonalRating = rating || null; },
            save: request => this.saveRating(movie, request),
            onSaved: () => this.refreshAfterRatingSave(movie)
        });
    }

    closeRatingModal() {
        return global.RatingDialog?.instance?.close() || false;
    }

    async saveRating(movie, request) {
        const currentUser = firebaseManager.getCurrentUser();
        if (!currentUser) {
            this.page.showError(createAppError('AUTH_REQUIRED', {
                category: 'auth',
                retryable: false,
                context: { operation: 'rating-save' }
            }));
            throw new Error('Signed out before the rating was saved');
        }
        const userProfile = await firebaseManager.getUserService().getUserProfile(currentUser.uid);
        await global.RatingDialog.write(firebaseManager.getRatingService(), {
            uid: currentUser.uid,
            displayName: userProfile?.displayName || currentUser.displayName || currentUser.email,
            photoURL: userProfile?.photoURL || '',
            movie
        }, request);
    }

    async refreshAfterRatingSave(movie) {
        if (typeof Utils !== 'undefined') Utils.showToast(i18n.get('rating_dialog.saved'), 'success');
        try {
            // The ratings listener patches the review list live; a full page reload
            // would reset scroll and drop render-bound enrichments.
            await this.loadPersonalState(movie.kinopoiskId);
        } catch (error) {
            console.error('Error refreshing personal state after saving a rating:', error);
        }
    }

    normalizeReviewForDisplay(value) {
        if (typeof Utils !== 'undefined' && typeof Utils.normalizeRatingReview === 'function') {
            return Utils.normalizeRatingReview(value);
        }
        return typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : '';
    }
}

function installMovieDetailsUserRatings(targetClass, getDeps = () => ({})) {
    readDeps = getDeps;
    const source = MovieDetailsUserRatingsMethods.prototype;
    Object.getOwnPropertyNames(source).forEach(name => {
        if (name === 'constructor') return;
        if (Object.prototype.hasOwnProperty.call(targetClass.prototype, name)) {
            throw new Error(`MovieDetails already defines ${name}`);
        }
        Object.defineProperty(targetClass.prototype, name, Object.getOwnPropertyDescriptor(source, name));
    });
    return targetClass;
}

global.MovieDetailsUserRatingsMethods = MovieDetailsUserRatingsMethods;
global.installMovieDetailsUserRatings = installMovieDetailsUserRatings;
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MovieDetailsUserRatingsMethods, installMovieDetailsUserRatings };
}
})(globalThis);
