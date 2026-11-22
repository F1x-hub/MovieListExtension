/**
 * RatingDialog - the one dialog for rating a film, on Movie Details and on Ratings.
 *
 *   RatingDialog.shared().open({
 *       movie,                      // { kinopoiskId, name, posterUrl, year, genres }
 *       theme, iconMarkup,          // franchise rating theme and its button icon (stars by default)
 *       known,                      // the rating the page already has, shown at once
 *       load: () => promise,        // fresh read; the choice stays locked until it answers
 *       onLoaded: rating => {},     // the read's answer (or `known` after a failed read)
 *       episodeLink,                // series: link to the episode scores on Movie Details
 *       save: async request => {},  // throws to keep the dialog open with an error toast
 *       onSaved: request => {}      // after the dialog closed on a successful save
 *   });
 *
 * `request` is { rating, comment, review, existingId, ratingChanged, commentChanged,
 * reviewChanged }; `RatingDialog.write()` turns it into the right RatingService call,
 * so both pages write a rating the same way. A review the user never touched is not
 * sent, so RatingService keeps the stored one.
 *
 * The dialog builds its own markup, keeps Tab inside itself, closes on Escape, the
 * close button, Cancel and a press on the backdrop, and returns focus to the element
 * that opened it. While the fresh read or a write is running it cannot be changed, and
 * during a write it cannot be dismissed. Styles: src/shared/styles/rating-dialog.css.
 * Uses the global `i18n`, `Utils` and `RatingConfig` when the page loads them.
 */
(function (global) {
'use strict';

const COMMENT_MAX = 500;
const REVIEW_MAX = 5000;
const FALLBACK_POSTER = '/src/shared/assets/icons/app/icon48.png';
const DEFAULT_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>';
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function t(key, values = {}) {
    const fullKey = `rating_dialog.${key}`;
    let text = fullKey;
    try {
        const value = global.i18n?.get?.(fullKey);
        if (typeof value === 'string' && value !== fullKey) text = value;
    } catch { /* keep the key */ }
    Object.entries(values).forEach(([name, value]) => {
        text = text.split(`{${name}}`).join(String(value));
    });
    return text;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function textLength(value) {
    const config = global.RatingConfig;
    return config?.getLength ? config.getLength(value) : Array.from(String(value || '').replace(/\r\n?/g, '\n')).length;
}

function normalizeComment(value) {
    if (typeof global.Utils?.normalizeRatingComment === 'function') return global.Utils.normalizeRatingComment(value);
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeReview(value) {
    if (typeof global.Utils?.normalizeRatingReview === 'function') return global.Utils.normalizeRatingReview(value);
    return typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : '';
}

function showToast(message, type) {
    if (typeof global.Utils?.showToast === 'function') global.Utils.showToast(message, type);
}

function formatGenres(genres) {
    if (typeof global.Utils?.formatGenres === 'function') return global.Utils.formatGenres(genres, 3);
    if (!Array.isArray(genres)) return genres || '';
    return genres.slice(0, 3)
        .map(genre => (typeof genre === 'object' && genre ? (genre.name || genre.genre || '') : genre))
        .filter(Boolean)
        .join(', ');
}

const CLOSE_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
const PEN_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>';
const EYE_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';

class RatingDialog {
    constructor() {
        this.root = null;
        this.elements = {};
        this.options = null;
        this.rating = 0;
        this.original = { id: null, rating: 0, comment: '', review: '' };
        this.reviewTouched = false;
        this.reviewVisible = false;
        this.saving = false;
        this.load = null;
        this.loadingHintTimer = null;
        this.trigger = null;
        this.spoilerPopup = null;
        this.spoilerTarget = null;
    }

    static shared() {
        if (!RatingDialog.instance) RatingDialog.instance = new RatingDialog();
        return RatingDialog.instance;
    }

    /**
     * Writes a request from the dialog through RatingService.
     * @returns {Promise<Object|null>} the service's answer, or null when nothing changed
     */
    static async write(ratingService, { uid, displayName, photoURL = '', movie }, request) {
        const { rating, comment, review, existingId, ratingChanged, commentChanged, reviewChanged } = request;
        if (existingId && !ratingChanged) {
            if (!commentChanged && !reviewChanged) return null;
            const patch = {};
            if (commentChanged) patch.comment = comment;
            if (reviewChanged) patch.review = review;
            return ratingService.updateRatingText(uid, existingId, patch);
        }
        return ratingService.addOrUpdateRating(
            uid, displayName, photoURL,
            Number(movie?.kinopoiskId || movie?.movieId), rating,
            comment, movie, reviewChanged ? { review } : {}
        );
    }

    ensureElements() {
        if (this.root?.isConnected) return this.root;

        const root = document.createElement('div');
        root.id = 'ratingModal';
        root.className = 'modal-overlay rating-dialog-overlay';
        root.style.display = 'none';
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-modal', 'true');
        root.setAttribute('aria-labelledby', 'ratingModalTitle');
        root.tabIndex = -1;
        root.innerHTML = `
            <div class="modal rating-modal-redesign">
                <div class="rating-modal-header">
                    <h2 class="modal-title" id="ratingModalTitle"></h2>
                    <button type="button" class="modal-close" id="ratingModalClose">${CLOSE_ICON}</button>
                </div>
                <div class="rating-modal-body">
                    <div class="rating-poster-container">
                        <img id="ratingMoviePoster" class="rating-modal-poster" src="${FALLBACK_POSTER}" alt="">
                        <div class="rating-movie-info-overlay">
                            <h3 id="ratingMovieTitle" class="rating-movie-title"></h3>
                            <p id="ratingMovieMeta" class="rating-movie-meta"></p>
                        </div>
                    </div>
                    <div class="rating-stars-container">
                        <p id="ratingStatus" class="rating-status" aria-live="polite"></p>
                        <div class="stars-wrapper" id="ratingStars" role="group" aria-describedby="ratingStatus"></div>
                        <a class="episode-rating-link" id="episodeRatingLink" hidden></a>
                    </div>
                    <div class="rating-review-section">
                        <button type="button" id="writeReviewBtn" class="btn review-write-btn" aria-controls="reviewContainer" aria-expanded="false">
                            <span class="icon">${PEN_ICON}</span> <span data-rating-dialog-text="write_review"></span>
                        </button>
                        <div id="reviewContainer" class="review-container" style="display: none;" inert>
                            <div class="review-content">
                                <div class="rating-text-field">
                                    <label for="ratingComment" class="rating-text-label" data-rating-dialog-text="comment_label"></label>
                                    <textarea id="ratingComment" class="review-textarea" rows="4" maxlength="${COMMENT_MAX}"></textarea>
                                    <div class="char-counter" aria-live="polite"><span id="charCount">0</span>/${COMMENT_MAX}</div>
                                </div>
                                <div class="rating-text-field rating-review-field">
                                    <label for="ratingReview" class="rating-text-label" data-rating-dialog-text="review_label"></label>
                                    <p class="rating-review-visibility" data-rating-dialog-text="review_visibility"></p>
                                    <textarea id="ratingReview" class="review-textarea review-textarea--long" rows="10" maxlength="${REVIEW_MAX}"></textarea>
                                    <div class="char-counter" aria-live="polite"><span id="reviewCharCount">0</span>/${REVIEW_MAX}</div>
                                    <div id="ratingReviewError" class="rating-review-error" role="alert" hidden></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="rating-modal-footer">
                    <button type="button" id="cancelRatingBtn" class="btn btn-secondary" data-rating-dialog-text="cancel"></button>
                    <button type="button" id="saveRatingBtn" class="btn btn-accent" data-rating-dialog-text="save"></button>
                </div>
            </div>
        `;

        const $ = selector => root.querySelector(selector);
        this.elements = {
            root,
            title: $('#ratingModalTitle'),
            close: $('#ratingModalClose'),
            body: $('.rating-modal-body'),
            poster: $('#ratingMoviePoster'),
            movieTitle: $('#ratingMovieTitle'),
            movieMeta: $('#ratingMovieMeta'),
            status: $('#ratingStatus'),
            stars: $('#ratingStars'),
            episodeLink: $('#episodeRatingLink'),
            writeReview: $('#writeReviewBtn'),
            reviewContainer: $('#reviewContainer'),
            comment: $('#ratingComment'),
            commentCount: $('#charCount'),
            review: $('#ratingReview'),
            reviewCount: $('#reviewCharCount'),
            reviewError: $('#ratingReviewError'),
            cancel: $('#cancelRatingBtn'),
            save: $('#saveRatingBtn')
        };
        this.bindEvents();
        // The extension CSP blocks inline onerror.
        this.elements.poster.addEventListener('error', () => {
            if (!this.elements.poster.src.endsWith(FALLBACK_POSTER)) this.elements.poster.src = FALLBACK_POSTER;
        });

        document.body.appendChild(root);
        this.root = root;
        return root;
    }

    bindEvents() {
        const { root, close, cancel, save, stars, writeReview, comment, review } = this.elements;

        close.addEventListener('click', () => this.close());
        cancel.addEventListener('click', () => this.close());
        save.addEventListener('click', () => this.submit());
        root.addEventListener('mousedown', event => {
            if (event.target === root) this.close();
        });
        root.addEventListener('keydown', event => this.handleKeydown(event));
        root.addEventListener('scroll', () => this.hideSpoilerPopup(), true);

        stars.addEventListener('pointerover', event => {
            const button = event.target.closest('.star-rating-btn');
            if (button) this.paintStars(Number(button.dataset.rating), true);
        });
        stars.addEventListener('pointerleave', () => this.paintStars(this.rating, false));
        stars.addEventListener('focusin', event => {
            const button = event.target.closest('.star-rating-btn');
            if (button) this.paintStars(Number(button.dataset.rating), true);
        });
        stars.addEventListener('focusout', event => {
            if (event.target.closest('.star-rating-btn')) this.paintStars(this.rating, false);
        });
        stars.addEventListener('keydown', event => {
            const button = event.target.closest('.star-rating-btn');
            if (!button) return;
            const buttons = [...stars.querySelectorAll('.star-rating-btn')];
            const index = buttons.indexOf(button);
            const target = {
                ArrowLeft: Math.max(0, index - 1),
                ArrowDown: Math.max(0, index - 1),
                ArrowRight: Math.min(buttons.length - 1, index + 1),
                ArrowUp: Math.min(buttons.length - 1, index + 1),
                Home: 0,
                End: buttons.length - 1
            }[event.key];
            if (target === undefined) return;
            event.preventDefault();
            buttons[target].focus();
        });
        stars.addEventListener('click', event => {
            const button = event.target.closest('.star-rating-btn');
            if (!button) return;
            this.rating = Number(button.dataset.rating);
            this.paintStars(this.rating, false);
        });

        writeReview.addEventListener('click', () => {
            this.setReviewVisible(!this.reviewVisible);
            if (this.reviewVisible) comment.focus();
        });
        comment.addEventListener('input', () => {
            this.elements.commentCount.textContent = textLength(comment.value);
        });
        review.addEventListener('input', () => {
            this.reviewTouched = true;
            this.elements.reviewCount.textContent = textLength(review.value);
            this.clearReviewError();
        });
        for (const field of [comment, review]) {
            field.addEventListener('mouseup', () => this.updateSpoilerPopup(field));
            field.addEventListener('keyup', () => this.updateSpoilerPopup(field));
            field.addEventListener('blur', () => setTimeout(() => this.hideSpoilerPopup(), 200));
        }
        window.addEventListener('resize', () => this.hideSpoilerPopup());
    }

    applyTexts() {
        const { root, title, close, stars, episodeLink, comment, review } = this.elements;
        title.textContent = t('title');
        close.setAttribute('aria-label', t('close'));
        stars.setAttribute('aria-label', t('stars_label'));
        episodeLink.textContent = t('rate_episodes');
        comment.placeholder = t('comment_placeholder');
        review.placeholder = t('review_placeholder');
        root.querySelectorAll('[data-rating-dialog-text]').forEach(element => {
            element.textContent = t(element.dataset.ratingDialogText);
        });
    }

    /**
     * @param {Object} options - see the file comment
     */
    open(options = {}) {
        if (this.saving) return;
        const movie = options.movie || {};
        this.ensureElements();
        this.applyTexts();
        this.endLoad();
        this.setSaving(false);
        this.options = options;
        this.trigger = options.trigger || (document.activeElement instanceof HTMLElement ? document.activeElement : null);

        const { poster, movieTitle, movieMeta, episodeLink } = this.elements;
        const posterUrl = global.MovieCard?.safeImageUrl ? global.MovieCard.safeImageUrl(movie.posterUrl) : movie.posterUrl;
        poster.src = posterUrl || FALLBACK_POSTER;
        poster.alt = movie.name || '';
        movieTitle.textContent = movie.name || '';
        movieMeta.textContent = [movie.year, formatGenres(movie.genres)].filter(Boolean).join(' • ');

        this.renderStars(options.theme || '', options.iconMarkup || DEFAULT_ICON);
        episodeLink.hidden = !options.episodeLink;
        if (options.episodeLink) episodeLink.href = options.episodeLink;
        else episodeLink.removeAttribute('href');

        // Open at once with what the page already knows. The read below only
        // confirms it, so a press never waits for the network.
        this.applyRating(options.known || null);
        this.show();

        if (typeof options.load === 'function') void this.runLoad(options.load, options.known || null);
    }

    async runLoad(read, known) {
        const load = this.beginLoad();
        let fresh;
        try {
            fresh = await read();
        } catch {
            fresh = null;
        }
        // Closed or reopened meanwhile: the reply belongs to a dialog that is gone.
        if (this.load !== load) return;
        this.endLoad();
        // A failed read answers null, which must not erase a known rating.
        this.applyRating(fresh || known);
        if (typeof this.options?.onLoaded === 'function') this.options.onLoaded(fresh || known);
    }

    renderStars(theme, iconMarkup) {
        const { stars } = this.elements;
        stars.innerHTML = '';
        for (let score = 1; score <= 10; score++) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = theme ? `star-rating-btn ${theme}-rating-btn` : 'star-rating-btn';
            button.dataset.rating = String(score);
            button.setAttribute('aria-label', t('star_aria', { rating: score }));
            button.setAttribute('aria-pressed', 'false');
            button.innerHTML = iconMarkup;
            stars.appendChild(button);
        }
    }

    applyRating(existing) {
        const comment = normalizeComment(existing?.comment);
        const review = normalizeReview(existing?.review);
        this.original = {
            id: existing?.id || null,
            rating: Number(existing?.rating) || 0,
            comment,
            review
        };
        this.rating = this.original.rating;
        this.reviewTouched = false;
        this.paintStars(this.rating, false);
        this.elements.comment.value = comment;
        this.elements.commentCount.textContent = textLength(comment);
        this.elements.review.value = review;
        this.elements.reviewCount.textContent = textLength(review);
        this.clearReviewError();
        this.setReviewVisible(Boolean(comment || review));
    }

    setReviewVisible(visible) {
        const { reviewContainer, writeReview } = this.elements;
        this.reviewVisible = visible;
        reviewContainer.style.display = visible ? 'grid' : 'none';
        reviewContainer.classList.toggle('is-open', visible);
        reviewContainer.inert = !visible;
        writeReview.setAttribute('aria-expanded', String(visible));
    }

    paintStars(rating, isHover) {
        this.elements.stars.querySelectorAll('.star-rating-btn').forEach(button => {
            const score = Number(button.dataset.rating);
            if (score <= rating) {
                button.classList.add(isHover ? 'hover' : 'active');
                if (isHover) button.classList.remove('active');
            } else {
                button.classList.remove('active', 'hover');
            }
            const selected = isHover ? this.rating : rating;
            button.setAttribute('aria-pressed', String(selected > 0 && score === selected));
        });
        const { status } = this.elements;
        const key = rating > 0 ? (isHover ? 'status_preview' : 'status_selected') : 'status_prompt';
        const word = RatingDialog.scoreWord(rating);
        status.textContent = word ? `${t(key, { rating })} — ${word}` : t(key, { rating });
        status.dataset.state = rating > 0 ? (isHover ? 'preview' : 'selected') : 'empty';
    }

    /** Word for a 1–10 score («Шедевр», «Плохо»...), or '' when there is none. */
    static scoreWord(value) {
        const score = Math.round(Number(value));
        if (!(score >= 1 && score <= 10)) return '';
        const key = `rating_dialog.words.${score}`;
        const word = t(`words.${score}`);
        return word === key ? '' : word;
    }

    /**
     * Until the fresh read answers, the choice stays locked: it could be replaced
     * by a rating changed in another tab, and saving would overwrite that one.
     */
    beginLoad() {
        clearTimeout(this.loadingHintTimer);
        const load = {};
        this.load = load;
        this.elements.body.inert = true;
        this.elements.save.setAttribute('aria-disabled', 'true');
        // Like other loaders, the hint waits 150ms so a quick read never flashes it.
        this.loadingHintTimer = setTimeout(() => {
            this.elements.status.textContent = t('status_loading');
            this.elements.status.dataset.state = 'loading';
        }, 150);
        return load;
    }

    endLoad() {
        clearTimeout(this.loadingHintTimer);
        this.load = null;
        if (!this.elements.body) return;
        this.elements.body.inert = this.saving;
        this.elements.save.removeAttribute('aria-disabled');
    }

    /**
     * While a rating is being written the dialog shows it and cannot be edited
     * or dismissed, so what was saved is always what the user last saw.
     */
    setSaving(saving) {
        this.saving = saving;
        const { save, cancel, close, body } = this.elements;
        if (!save) return;
        save.disabled = saving;
        save.classList.toggle('btn--pending', saving);
        save.setAttribute('aria-busy', String(saving));
        cancel.disabled = saving;
        close.disabled = saving;
        body.inert = saving || Boolean(this.load);
    }

    /** @returns {Object|null} what to save, or null after telling the user what is missing */
    buildRequest() {
        if (!this.rating || this.rating < 1) {
            showToast(t('choose_rating'), 'warning');
            return null;
        }
        const comment = normalizeComment(this.elements.comment.value);
        const review = normalizeReview(this.elements.review.value);
        if (textLength(review) > REVIEW_MAX) {
            this.showReviewError(t('review_too_long', { max: REVIEW_MAX }));
            return null;
        }
        const reviewChanged = review !== this.original.review;
        return {
            rating: this.rating,
            comment,
            review,
            existingId: this.original.id,
            ratingChanged: !this.original.id || this.rating !== this.original.rating,
            commentChanged: comment !== this.original.comment,
            reviewChanged: reviewChanged || this.reviewTouched
        };
    }

    async submit() {
        if (this.saving || this.load || !this.isOpen()) return;
        const request = this.buildRequest();
        if (!request) return;
        const { save, onSaved } = this.options || {};

        this.setSaving(true);
        try {
            if (typeof save === 'function') await save(request);
        } catch (error) {
            console.error('Error saving rating:', error);
            this.setSaving(false);
            this.elements.save.focus();
            // A toast, not the review field's error slot: that slot sits inside a
            // section that is usually collapsed, where nobody would see it.
            showToast(t('save_error'), 'error');
            return;
        }

        // The buttons keep their state while the dialog closes, so they do not
        // visibly flip back; open() resets them the next time.
        this.saving = false;
        this.close();
        if (typeof onSaved === 'function') {
            try {
                await onSaved(request);
            } catch (error) {
                console.error('Error after saving a rating:', error);
            }
        }
    }

    show() {
        const { root } = this;
        root.style.display = 'flex';
        // Priority order, not document order.
        const target = ['.modal-close', FOCUSABLE]
            .map(selector => root.querySelector(selector))
            .find(Boolean) || root;
        target.focus();
    }

    close() {
        // A write cannot be recalled, so the dialog stays until it settles.
        if (this.saving || !this.isOpen()) return false;
        this.endLoad();
        this.hideSpoilerPopup();
        this.root.style.display = 'none';
        const trigger = this.trigger;
        this.trigger = null;
        if (trigger?.isConnected && !trigger.disabled && trigger.offsetParent !== null) trigger.focus();
        const onClose = this.options?.onClose;
        if (typeof onClose === 'function') onClose();
        return true;
    }

    isOpen() {
        return Boolean(this.root?.isConnected && this.root.style.display !== 'none');
    }

    isSaving() {
        return this.saving;
    }

    getElement() {
        return this.root;
    }

    handleKeydown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            // The page's own dialog stack must not also treat this key.
            event.stopPropagation();
            this.close();
            return;
        }
        if (event.key !== 'Tab') return;
        event.stopPropagation();
        const focusable = [...this.root.querySelectorAll(FOCUSABLE)]
            .filter(element => element.offsetParent !== null && !element.closest('[inert]'));
        if (focusable.length === 0) {
            event.preventDefault();
            this.root.focus();
            return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === this.root)) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    showReviewError(message) {
        const { reviewError, review } = this.elements;
        reviewError.textContent = message;
        reviewError.hidden = false;
        review.setAttribute('aria-invalid', 'true');
    }

    clearReviewError() {
        const { reviewError, review } = this.elements;
        reviewError.textContent = '';
        reviewError.hidden = true;
        review.removeAttribute('aria-invalid');
    }

    // Spoiler action: selected text in the comment or review can be wrapped in ||…||.
    updateSpoilerPopup(field) {
        const selected = field.value.substring(field.selectionStart, field.selectionEnd).trim();
        if (!selected || document.activeElement !== field) {
            this.hideSpoilerPopup();
            return;
        }
        this.spoilerTarget = field;
        const popup = this.ensureSpoilerPopup();
        const coords = this.getSelectionCoords(field);
        popup.style.display = 'flex';
        const half = popup.offsetWidth / 2;
        const left = Math.max(half + 12, Math.min(window.innerWidth - half - 12, coords.left + coords.width / 2));
        popup.style.left = `${left}px`;
        popup.style.top = `${coords.top - 45}px`;
        popup.style.transform = 'translateX(-50%)';
    }

    ensureSpoilerPopup() {
        if (this.spoilerPopup?.isConnected) return this.spoilerPopup;
        const popup = document.createElement('div');
        popup.className = 'selection-popup';
        popup.innerHTML = `
            <button class="selection-popup-btn" type="button" title="${escapeHtml(t('spoiler_title'))}" aria-label="${escapeHtml(t('spoiler_aria'))}">
                ${EYE_ICON}
                <span>${escapeHtml(t('spoiler'))}</span>
            </button>
        `;
        popup.querySelector('button').addEventListener('mousedown', event => {
            event.preventDefault();
            event.stopPropagation();
            this.wrapSelectionWithSpoiler(this.spoilerTarget);
            this.hideSpoilerPopup();
        });
        document.body.appendChild(popup);
        this.spoilerPopup = popup;
        return popup;
    }

    hideSpoilerPopup() {
        if (this.spoilerPopup) this.spoilerPopup.style.display = 'none';
        this.spoilerTarget = null;
    }

    getSelectionCoords(field) {
        const { selectionStart, selectionEnd } = field;
        const style = window.getComputedStyle(field);
        const ghost = document.createElement('div');
        [
            'direction', 'boxSizing', 'width', 'height', 'overflowX', 'overflowY',
            'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
            'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
            'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize', 'lineHeight', 'fontFamily',
            'textAlign', 'textTransform', 'textIndent', 'textDecoration', 'letterSpacing', 'wordSpacing'
        ].forEach(property => { ghost.style[property] = style[property]; });

        const rect = field.getBoundingClientRect();
        Object.assign(ghost.style, {
            position: 'fixed',
            left: `${rect.left}px`,
            top: `${rect.top - field.scrollTop}px`,
            width: `${rect.width}px`,
            height: 'auto',
            visibility: 'hidden',
            pointerEvents: 'none',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word'
        });
        ghost.textContent = field.value.substring(0, selectionStart);
        const span = document.createElement('span');
        span.textContent = field.value.substring(selectionStart, selectionEnd);
        ghost.appendChild(span);
        document.body.appendChild(ghost);
        const spanRect = span.getBoundingClientRect();
        ghost.remove();
        return { top: spanRect.top, left: spanRect.left, width: spanRect.width, height: spanRect.height };
    }

    wrapSelectionWithSpoiler(field) {
        if (!field) return false;
        const start = field.selectionStart;
        const end = field.selectionEnd;
        const selected = field.value.substring(start, end);
        if (!selected) return false;

        const candidate = field.value.substring(0, start) + `||${selected}||` + field.value.substring(end);
        const isReview = field === this.elements.review;
        const max = isReview ? REVIEW_MAX : COMMENT_MAX;
        if (textLength(candidate) > max) {
            if (isReview) this.showReviewError(t('spoiler_too_long', { max }));
            else showToast(t('spoiler_too_long', { max }), 'warning');
            return false;
        }
        field.value = candidate;
        field.focus();
        field.setSelectionRange(start, end + 4);
        field.dispatchEvent(new Event('input'));
        return true;
    }
}

RatingDialog.instance = null;
global.RatingDialog = RatingDialog;
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { RatingDialog };
}
})(globalThis);
