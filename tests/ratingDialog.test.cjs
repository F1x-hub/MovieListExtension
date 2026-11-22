// The shared rating dialog (src/shared/components/RatingDialog.js), used by Movie
// Details and Ratings: what it shows before and after its read, the write lock, and
// which RatingService call a save turns into.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><html><body><button id="opener">Rate</button></body></html>', { pretendToBeVisual: true, runScripts: 'outside-only' });
const { window } = dom;
const { document } = window;
// jsdom has no layout: treat every connected element as rendered.
Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', { get() { return this.isConnected ? document.body : null; } });

const toasts = [];
window.i18n = { get: key => key };
window.Utils = {
    normalizeRatingComment: value => String(value || '').trim(),
    normalizeRatingReview: value => String(value || '').replace(/\r\n?/g, '\n').trim(),
    showToast: (message, type) => toasts.push({ message, type })
};
window.console = { ...console, error() {} };
window.eval(fs.readFileSync('src/shared/components/RatingDialog.js', 'utf8'));
const { RatingDialog } = window;

const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
};
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
// Objects built inside the jsdom window have that realm's prototypes.
const plain = value => JSON.parse(JSON.stringify(value));
const $ = selector => document.querySelector(selector);
const shown = () => $('#ratingModal').style.display !== 'none';
const pressed = () => [...document.querySelectorAll('.star-rating-btn')]
    .filter(button => button.getAttribute('aria-pressed') === 'true')
    .map(button => Number(button.dataset.rating));
const keydown = (target, key, options = {}) => target.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }));
const movie = { kinopoiskId: 101, name: 'Film', year: 2020, genres: ['Драма'], posterUrl: 'https://image.test/p.jpg' };

(async () => {
    const dialog = RatingDialog.shared();
    assert.equal(RatingDialog.shared(), dialog, 'one dialog per page');

    // A press opens the dialog before its read answers, with the choice locked until it does.
    {
        let read = deferred();
        const loaded = [];
        const open = (known, extra = {}) => dialog.open({ movie, known, load: () => read.promise, onLoaded: rating => loaded.push(rating), ...extra });
        $('#opener').focus();
        open({ id: 'known', rating: 7, comment: 'Known comment' });
        assert.equal(shown(), true, 'the dialog shows before the read answers');
        assert.equal($('#ratingModal').getAttribute('role'), 'dialog');
        assert.equal($('#ratingModal').getAttribute('aria-modal'), 'true');
        assert.equal(document.activeElement, $('#ratingModalClose'), 'focus moves into the dialog');
        assert.equal(document.querySelectorAll('.star-rating-btn').length, 10);
        assert.deepEqual(pressed(), [7], 'with the rating the page already knows');
        assert.equal($('#ratingComment').value, 'Known comment');
        assert.equal($('#ratingMovieTitle').textContent, 'Film');
        assert.equal($('#ratingMovieMeta').textContent, '2020 • Драма');
        assert.equal($('.rating-modal-body').inert, true, 'nothing can be chosen from unconfirmed data');
        assert.equal($('#saveRatingBtn').getAttribute('aria-disabled'), 'true');
        await new Promise(resolve => setTimeout(resolve, 180));
        assert.equal($('#ratingStatus').textContent, 'rating_dialog.status_loading', 'a slow read says what is happening');

        read.resolve(null);
        await flush();
        assert.equal($('.rating-modal-body').inert, false);
        assert.equal($('#saveRatingBtn').hasAttribute('aria-disabled'), false);
        assert.deepEqual(pressed(), [7], 'a failed read, reported as null, keeps the known rating');
        assert.equal($('#ratingComment').value, 'Known comment');
        assert.deepEqual(loaded, [{ id: 'known', rating: 7, comment: 'Known comment' }]);

        keydown($('#ratingStars'), 'Escape');
        assert.equal(shown(), false, 'Escape closes the dialog');
        assert.equal(document.activeElement, $('#opener'), 'and returns focus to the opener');

        read = deferred();
        loaded.length = 0;
        open(null);
        dialog.close();
        assert.equal($('.rating-modal-body').inert, false, 'closing releases the lock');
        read.resolve({ id: 'late', rating: 3, comment: 'Late reply' });
        await flush();
        assert.equal(shown(), false, 'a late reply does not reopen a closed dialog');
        assert.deepEqual(loaded, [], 'and is not reported to the page');

        read = deferred();
        const stale = read;
        open(null);
        read = deferred();
        open(null);
        stale.resolve({ id: 'stale', rating: 2, comment: 'Stale reply' });
        await flush();
        assert.equal($('.rating-modal-body').inert, true, 'a stale reply cannot unlock the newer opening');
        read.resolve({ id: 'fresh', rating: 6, comment: 'Fresh reply', review: 'Long text' });
        await flush();
        assert.equal($('.rating-modal-body').inert, false);
        assert.deepEqual(pressed(), [6]);
        assert.equal($('#ratingComment').value, 'Fresh reply');
        assert.equal($('#ratingReview').value, 'Long text', 'the review comes with the read');
        assert.equal($('#reviewContainer').inert, false, 'stored texts open the text section');
        assert.equal($('#writeReviewBtn').getAttribute('aria-expanded'), 'true');
        dialog.close();
    }

    // Stars: hover previews, a click chooses, the keyboard moves between them.
    {
        dialog.open({ movie, known: null, theme: 'dune', iconMarkup: '<span class="franchise-rating-icon dune-rating-icon"></span>' });
        const star = rating => $(`.star-rating-btn[data-rating="${rating}"]`);
        assert.equal(star(1).className, 'star-rating-btn dune-rating-btn', 'franchise films get their own icons');
        assert.ok(star(1).querySelector('.dune-rating-icon'));
        assert.equal($('#ratingStatus').textContent, 'rating_dialog.status_prompt');
        star(4).dispatchEvent(new window.Event('pointerover', { bubbles: true }));
        assert.equal($('#ratingStatus').dataset.state, 'preview');
        assert.equal(star(4).classList.contains('hover'), true);
        star(8).click();
        assert.deepEqual(pressed(), [8]);
        assert.equal($('#ratingStatus').dataset.state, 'selected');
        star(8).focus();
        keydown(star(8), 'ArrowRight');
        assert.equal(document.activeElement, star(9));
        keydown(star(9), 'Home');
        assert.equal(document.activeElement, star(1));

        // Tab stays inside the dialog.
        $('#saveRatingBtn').focus();
        keydown($('#saveRatingBtn'), 'Tab');
        assert.equal(document.activeElement, $('#ratingModalClose'), 'Tab from the last control wraps to the first');
        keydown($('#ratingModalClose'), 'Tab', { shiftKey: true });
        assert.equal(document.activeElement, $('#saveRatingBtn'), 'Shift+Tab from the first wraps to the last');

        // The counters follow the text.
        $('#writeReviewBtn').click();
        assert.equal(document.activeElement, $('#ratingComment'), 'opening the text section focuses the comment');
        $('#ratingComment').value = 'Хорошо';
        $('#ratingComment').dispatchEvent(new window.Event('input'));
        assert.equal($('#charCount').textContent, '6');
        $('#ratingReview').value = 'x'.repeat(12);
        $('#ratingReview').dispatchEvent(new window.Event('input'));
        assert.equal($('#reviewCharCount').textContent, '12');
        dialog.close();
    }

    // A save without a rating says so; one over the review limit points at the field.
    {
        toasts.length = 0;
        let saves = 0;
        dialog.open({ movie, known: null, save: async () => { saves++; } });
        $('#saveRatingBtn').click();
        await flush();
        assert.deepEqual(toasts, [{ message: 'rating_dialog.choose_rating', type: 'warning' }]);
        $('.star-rating-btn[data-rating="5"]').click();
        $('#ratingReview').removeAttribute('maxlength');
        $('#ratingReview').value = 'x'.repeat(5001);
        $('#saveRatingBtn').click();
        await flush();
        assert.equal(saves, 0);
        assert.equal($('#ratingReviewError').hidden, false);
        assert.equal($('#ratingReview').getAttribute('aria-invalid'), 'true');
        $('#ratingReview').value = '';
        $('#ratingReview').dispatchEvent(new window.Event('input'));
        assert.equal($('#ratingReviewError').hidden, true, 'typing clears the error');
        $('#ratingReview').setAttribute('maxlength', '5000');
        dialog.close();
    }

    // A running write locks the dialog: one press means one write, and the dialog
    // cannot be dismissed or edited until the write settles.
    {
        toasts.length = 0;
        let writes = 0;
        let settle = deferred();
        const saved = [];
        dialog.open({
            movie,
            known: null,
            save: () => { writes++; return settle.promise; },
            onSaved: request => { saved.push(request); throw new Error('refresh failed'); }
        });
        $('.star-rating-btn[data-rating="8"]').click();
        $('#saveRatingBtn').click();
        $('#saveRatingBtn').click();
        await flush();
        assert.equal(writes, 1, 'a second press while saving does not write again');
        assert.equal($('#saveRatingBtn').disabled, true);
        assert.equal($('#saveRatingBtn').classList.contains('btn--pending'), true);
        assert.equal($('#saveRatingBtn').getAttribute('aria-busy'), 'true');
        assert.equal($('#cancelRatingBtn').disabled, true);
        assert.equal($('#ratingModalClose').disabled, true);
        assert.equal($('.rating-modal-body').inert, true, 'the choice cannot change during the write');
        keydown($('#saveRatingBtn'), 'Escape');
        assert.equal(dialog.close(), false);
        assert.equal(shown(), true, 'a running write cannot be dismissed');

        settle.reject(new Error('Failed to save rating: offline'));
        await flush();
        assert.deepEqual(toasts, [{ message: 'rating_dialog.save_error', type: 'error' }],
            'a failure is announced even with the text section collapsed, without technical text');
        assert.equal($('#saveRatingBtn').disabled, false);
        assert.equal($('#saveRatingBtn').classList.contains('btn--pending'), false);
        assert.equal(document.activeElement, $('#saveRatingBtn'), 'focus returns to the control that can retry');
        assert.equal($('#cancelRatingBtn').disabled, false);
        assert.equal($('.rating-modal-body').inert, false);
        assert.deepEqual(pressed(), [8], 'a failure keeps the chosen rating');
        assert.equal(shown(), true);

        toasts.length = 0;
        settle = deferred();
        $('#saveRatingBtn').click();
        settle.resolve();
        await flush();
        await flush();
        assert.equal(writes, 2);
        assert.equal(dialog.isSaving(), false);
        assert.equal(shown(), false, 'a finished write closes the dialog');
        assert.equal(saved.length, 1);
        assert.deepEqual(toasts, [], 'a failed refresh after a stored write is not reported as a failed save');

        dialog.open({ movie, known: null });
        assert.equal($('#saveRatingBtn').disabled, false, 'the dialog opens clean the next time');
        assert.equal($('#saveRatingBtn').classList.contains('btn--pending'), false);
        assert.equal($('#cancelRatingBtn').disabled, false);
        dialog.close();
    }

    // Series on Ratings link to the episode scores on Movie Details.
    {
        dialog.open({ movie, known: null, episodeLink: 'chrome-extension://id/src/pages/movie-details/movie-details.html?movieId=101' });
        assert.equal($('#episodeRatingLink').hidden, false);
        assert.match($('#episodeRatingLink').href, /movie-details\.html\?movieId=101$/);
        dialog.close();
        dialog.open({ movie, known: null });
        assert.equal($('#episodeRatingLink').hidden, true);
        assert.equal($('#episodeRatingLink').hasAttribute('href'), false);
        dialog.close();
    }

    // The request and the RatingService call it becomes.
    {
        const requestFor = async (known, edit) => {
            let request = null;
            dialog.open({ movie, known, save: async value => { request = value; } });
            edit();
            $('#saveRatingBtn').click();
            await flush();
            return request;
        };
        const calls = [];
        const service = {
            updateRatingText: async (...args) => { calls.push(['updateRatingText', ...args]); return { id: args[1] }; },
            addOrUpdateRating: async (...args) => { calls.push(['addOrUpdateRating', ...args]); return { id: 'new' }; }
        };
        const write = request => RatingDialog.write(service, { uid: 'u1', displayName: 'User', photoURL: '', movie }, request);
        const existing = { id: 'u1_101', rating: 7, comment: 'Old', review: 'Stored review' };

        let request = await requestFor(existing, () => {
            $('#ratingComment').value = 'New';
        });
        assert.deepEqual({ ...request }, {
            rating: 7, comment: 'New', review: 'Stored review', existingId: 'u1_101',
            ratingChanged: false, commentChanged: true, reviewChanged: false
        });
        await write(request);
        assert.deepEqual(plain(calls.pop()), ['updateRatingText', 'u1', 'u1_101', { comment: 'New' }],
            'a comment-only edit patches the text and leaves the stored review alone');

        request = await requestFor(existing, () => $('.star-rating-btn[data-rating="9"]').click());
        await write(request);
        const call = calls.pop();
        assert.equal(call[0], 'addOrUpdateRating');
        assert.deepEqual(plain(call.slice(1, 7)), ['u1', 'User', '', 101, 9, 'Old']);
        assert.deepEqual(plain(call[8]), {}, 'an untouched review is not sent, so the service keeps it');

        request = await requestFor(existing, () => {
            $('#ratingReview').value = '';
            $('#ratingReview').dispatchEvent(new window.Event('input'));
        });
        await write(request);
        assert.deepEqual(plain(calls.pop()), ['updateRatingText', 'u1', 'u1_101', { review: '' }], 'clearing the review removes it');

        request = await requestFor(existing, () => {});
        assert.equal(await write(request), null, 'nothing changed, nothing written');
        assert.equal(calls.length, 0);

        request = await requestFor(null, () => $('.star-rating-btn[data-rating="6"]').click());
        await write(request);
        assert.equal(calls.pop()[0], 'addOrUpdateRating', 'a first rating is a new document');
    }

    console.log('Rating dialog tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
