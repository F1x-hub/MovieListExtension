const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const {
    COMMENT_REACTION_TYPES,
    MAX_REACTIONS_PER_USER,
    MAX_REACTION_CATALOG_SIZE,
    CommentReactionService,
    normalizeReactionType,
    normalizeReactionTypes,
    normalizeReactionSummary,
    normalizeReactionConfig,
    normalizeReactionImageUrl,
    normalizeReactionShortcode,
    normalizeReactionAssetPath
} = require('../src/shared/services/CommentReactionService.js');

assert.deepEqual(COMMENT_REACTION_TYPES, [
    'like', 'love', 'laugh', 'wow', 'sad', 'fire',
    'clap', 'rocket', 'party', 'thinking', 'eyes', 'hundred'
]);
assert.equal(MAX_REACTIONS_PER_USER, 3);
assert.equal(MAX_REACTION_CATALOG_SIZE, 24);
assert.equal(CommentReactionService.MAX_REACTIONS_PER_USER, 3);
assert.equal(normalizeReactionType(' LOVE '), 'love');
assert.equal(normalizeReactionType('thumbs-up'), null);
assert.equal(normalizeReactionType('custom_1', ['custom_1']), 'custom_1');
assert.equal(normalizeReactionType('custom reaction', ['custom_1']), null);
assert.deepEqual(normalizeReactionTypes(['like', 'like', 'fire', 'sad']), ['like', 'fire', 'sad']);
assert.equal(CommentReactionService.buildReactionId('rating-123', 'user-456'), 'rating-123_user-456');
assert.equal(CommentReactionService.buildReactionId('rating/123', 'user-456'), null);

const customConfig = normalizeReactionConfig({
    reactions: [
        { id: 'custom_1', emoji: '🎬', label: 'Кино' },
        { id: 'custom_1', emoji: '🎞️', label: 'Дубликат ID' },
        { id: 'custom_2', emoji: '🎬', label: 'Дубликат эмодзи' }
    ]
});
assert.deepEqual(customConfig.reactions, [{ id: 'custom_1', emoji: '🎬', label: 'Кино', renderType: 'unicode' }]);
const customImageUrl = 'https://firebasestorage.googleapis.com/v0/b/movielistdb-13208.firebasestorage.app/o/comment_reaction_assets%2Fcustom_b45.png?alt=media&token=test';
assert.equal(normalizeReactionImageUrl(customImageUrl), customImageUrl);
assert.equal(normalizeReactionImageUrl('https://example.com/reaction.png'), null);
assert.equal(normalizeReactionShortcode(':b45:'), ':b45:');
assert.equal(normalizeReactionShortcode(`:${'a'.repeat(30)}:`), `:${'a'.repeat(30)}:`);
assert.equal(normalizeReactionShortcode(`:${'a'.repeat(31)}:`), null);
assert.equal(normalizeReactionAssetPath('comment_reaction_assets/custom_b45.png'), 'comment_reaction_assets/custom_b45.png');
assert.equal(normalizeReactionAssetPath('../comment_reaction_assets/custom_b45.png'), null);
const customImageConfig = normalizeReactionConfig({
    reactions: [{
        id: 'custom_b45',
        emoji: ':b45:',
        shortcode: ':b45:',
        label: 'Pepe',
        renderType: 'image',
        imageUrl: customImageUrl,
        storagePath: 'comment_reaction_assets/custom_b45.png'
    }]
});
assert.deepEqual(customImageConfig.reactions[0], {
    id: 'custom_b45',
    emoji: ':b45:',
    shortcode: ':b45:',
    label: 'Pepe',
    renderType: 'image',
    imageUrl: customImageUrl,
    storagePath: 'comment_reaction_assets/custom_b45.png'
});
assert.equal(CommentReactionService.createCustomReactionId().startsWith('custom_'), true);

const reactionDocuments = new Map();
const configDocuments = new Map();
const fakeDb = {
    runTransaction: async (callback) => callback({
        get: async (reference) => reference.get(),
        set: async (reference, data, options) => reference.set(data, options),
        delete: async (reference) => reference.delete()
    }),
    collection: (collectionName) => {
        const documents = collectionName === 'settings' ? configDocuments : reactionDocuments;
        return {
        doc: (id) => ({
            get: async () => ({
                exists: documents.has(id),
                data: () => documents.get(id)
            }),
            set: async (data, options = {}) => {
                documents.set(id, options.merge
                    ? { ...(documents.get(id) || {}), ...data }
                    : data);
            },
            delete: async () => documents.delete(id)
        })
        };
    }
};
const reactionService = new CommentReactionService({
    db: fakeDb,
    getCurrentUser: () => ({ uid: 'user-456' })
});

const summary = normalizeReactionSummary({
    ratingId: 'rating-123',
    counts: { like: 2.8, love: -1, fire: '3' }
}, 'fallback-id', 101);
assert.deepEqual(summary.counts, {
    like: 2,
    love: 0,
    laugh: 0,
    wow: 0,
    sad: 0,
    fire: 3,
    clap: 0,
    rocket: 0,
    party: 0,
    thinking: 0,
    eyes: 0,
    hundred: 0
});
assert.equal(summary.total, 5);

const serviceContract = (async () => {
    await reactionService.toggleReaction({ userId: 'user-456', ratingId: 'rating-123', movieId: 101, type: 'like' });
    await reactionService.toggleReaction({ userId: 'user-456', ratingId: 'rating-123', movieId: 101, type: 'love' });
    await reactionService.toggleReaction({ userId: 'user-456', ratingId: 'rating-123', movieId: 101, type: 'fire' });
    assert.deepEqual(reactionDocuments.get('rating-123_user-456').types, ['like', 'love', 'fire']);
    assert.equal(reactionDocuments.get('rating-123_user-456').type, 'like');
    assert.equal(reactionDocuments.get('rating-123_user-456').schemaVersion, 2);
    await assert.rejects(
        reactionService.toggleReaction({ userId: 'user-456', ratingId: 'rating-123', movieId: 101, type: 'sad' }),
        (error) => error.code === 'MAX_COMMENT_REACTIONS'
    );
    await reactionService.toggleReaction({ userId: 'user-456', ratingId: 'rating-123', movieId: 101, type: 'love' });
    assert.deepEqual(reactionDocuments.get('rating-123_user-456').types, ['like', 'fire']);

    reactionDocuments.clear();
    reactionDocuments.set('legacy-rating_user-456', {
        ratingId: 'legacy-rating',
        movieId: '101',
        userId: 'user-456',
        type: 'wow'
    });
    await reactionService.toggleReaction({ userId: 'user-456', ratingId: 'legacy-rating', movieId: '101', type: 'love' });
    assert.deepEqual(reactionDocuments.get('legacy-rating_user-456').types, ['wow', 'love']);
    assert.equal(reactionDocuments.get('legacy-rating_user-456').type, 'wow');
    await assert.rejects(
        reactionService.toggleReaction({ userId: 'user-456', ratingId: 'legacy-rating', movieId: '', type: 'like' }),
        /Invalid comment reaction payload/
    );

    configDocuments.set('commentReactions', {
        reactions: [
            { id: 'custom_1', emoji: '🎬', label: 'Кино' },
            { id: 'like', emoji: '👍', label: 'Like' }
        ],
        reactionTypes: ['custom_1', 'like'],
        maxReactionsPerUser: 3
    });
    const customReactionService = new CommentReactionService({
        db: fakeDb,
        getCurrentUser: () => ({ uid: 'user-456' })
    });
    await customReactionService.loadConfig();
    assert.deepEqual(customReactionService.getReactionTypes(), ['custom_1', 'like']);
    await customReactionService.toggleReaction({
        userId: 'user-456',
        ratingId: 'custom-rating',
        movieId: 101,
        type: 'custom_1'
    });
    assert.deepEqual(reactionDocuments.get('custom-rating_user-456').types, ['custom_1']);
})();

const dom = new JSDOM('<!doctype html><html><body></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.CommentReactionTypes = COMMENT_REACTION_TYPES;
global.CommentReactionMeta = {
    like: { emoji: '👍', label: 'Like' },
    love: { emoji: '❤️', label: 'Love' },
    laugh: { emoji: '😂', label: 'Funny' },
    wow: { emoji: '😮', label: 'Wow' },
    sad: { emoji: '😢', label: 'Sad' },
    fire: { emoji: '🔥', label: 'Fire' }
};

const { CommentReactionBar } = require('../src/shared/components/CommentReactionBar.js');
const wrapper = document.createElement('div');
document.body.appendChild(wrapper);
wrapper.innerHTML = CommentReactionBar.render({
    ratingId: 'rating-123',
    movieId: 101,
    summary,
    userReaction: ['love', 'fire']
});
const bar = wrapper.firstElementChild;
assert.equal(bar.getAttribute('data-rating-id'), 'rating-123');
assert.equal(bar.querySelectorAll('[data-comment-reaction-selected-list] [data-reaction-type]').length, 3);
assert.equal(bar.querySelectorAll('[data-comment-reaction-picker] [data-reaction-type]').length, 12);
assert.equal(bar.querySelector('[data-comment-reaction-picker]').hidden, true);
assert.equal(bar.querySelector('[data-action="toggle-comment-reaction-picker"]').getAttribute('aria-expanded'), 'false');
assert.equal(bar.querySelector('[data-comment-reaction-picker] [data-reaction-type="love"]').getAttribute('aria-pressed'), 'true');
assert.equal(bar.querySelector('[data-comment-reaction-selected-list] [data-reaction-type="fire"]').getAttribute('aria-pressed'), 'true');
assert.equal(bar.querySelector('[data-comment-reaction-selected-list] [data-reaction-type="like"] .comment-reaction-count').textContent, '2');
assert.equal(bar.querySelectorAll('[data-comment-reaction-picker] .comment-reaction-count').length, 0);

CommentReactionBar.update(bar, { counts: { like: 4 } }, ['like', 'sad']);
assert.equal(bar.querySelector('[data-comment-reaction-selected-list] [data-reaction-type="like"]').classList.contains('is-active'), true);
assert.equal(bar.querySelector('[data-comment-reaction-selected-list] [data-reaction-type="like"] .comment-reaction-count').textContent, '4');
assert.equal(bar.querySelector('[data-comment-reaction-selected-list] [data-reaction-type="sad"]').classList.contains('is-active'), true);
assert.equal(bar.querySelector('[data-comment-reaction-picker] [data-reaction-type="love"]').getAttribute('aria-pressed'), 'false');
assert.equal(bar.querySelectorAll('[data-comment-reaction-picker] .comment-reaction-count').length, 0);

CommentReactionBar.setPickerOpen(bar, true);
assert.equal(bar.querySelector('[data-comment-reaction-picker]').hidden, false);
assert.equal(bar.querySelector('[data-action="toggle-comment-reaction-picker"]').getAttribute('aria-expanded'), 'true');
CommentReactionBar.closeOpenPickers();
assert.equal(bar.querySelector('[data-comment-reaction-picker]').hidden, true);

const placementTrigger = bar.querySelector('[data-action="toggle-comment-reaction-picker"]');
const placementPicker = bar.querySelector('[data-comment-reaction-picker]');
const placementControls = bar.querySelector('.comment-reaction-controls');
Object.defineProperty(dom.window, 'innerWidth', { configurable: true, value: 500 });
Object.defineProperty(dom.window, 'innerHeight', { configurable: true, value: 300 });
placementTrigger.getBoundingClientRect = () => ({ top: 250, bottom: 282, left: 110, right: 142, width: 32, height: 32 });
placementControls.getBoundingClientRect = () => ({ top: 250, bottom: 282, left: 110, right: 400, width: 290, height: 32 });
placementPicker.getBoundingClientRect = () => ({ top: 0, bottom: 150, left: 0, right: 230, width: 230, height: 150 });
CommentReactionBar.setPickerOpen(bar, true);
assert.equal(placementPicker.dataset.placement, 'above');
assert.equal(placementPicker.style.left, '0px');
CommentReactionBar.setPickerOpen(bar, false);

Object.defineProperty(dom.window, 'innerHeight', { configurable: true, value: 800 });
CommentReactionBar.setPickerOpen(bar, true);
assert.equal(placementPicker.dataset.placement, 'below');
assert.equal(placementPicker.style.left, '0px');
CommentReactionBar.setPickerOpen(bar, false);

// Test chronological ordering: old reactions stay on left, new reactions added on right
const orderWrapper = document.createElement('div');
orderWrapper.innerHTML = CommentReactionBar.render({
    ratingId: 'order-rating',
    movieId: 200,
    summary: { counts: { wow: 1 }, order: ['wow'] },
    userReaction: []
});
const orderBar = orderWrapper.firstElementChild;
let visibleTypes = Array.from(orderBar.querySelectorAll('[data-comment-reaction-selected-list] [data-reaction-type]'))
    .map(btn => btn.dataset.reactionType);
assert.deepEqual(visibleTypes, ['wow']);

// User adds 'like' (which in catalog is at index 0 before 'wow') -> must append to right
CommentReactionBar.update(orderBar, { counts: { wow: 1, like: 1 } }, ['like']);
visibleTypes = Array.from(orderBar.querySelectorAll('[data-comment-reaction-selected-list] [data-reaction-type]'))
    .map(btn => btn.dataset.reactionType);
assert.deepEqual(visibleTypes, ['wow', 'like']);

// User adds 'fire' -> must append to right
CommentReactionBar.update(orderBar, { counts: { wow: 1, like: 1, fire: 1 } }, ['like', 'fire']);
visibleTypes = Array.from(orderBar.querySelectorAll('[data-comment-reaction-selected-list] [data-reaction-type]'))
    .map(btn => btn.dataset.reactionType);
assert.deepEqual(visibleTypes, ['wow', 'like', 'fire']);

// User un-reacts from 'wow' (count drops to 0) -> 'wow' removed, remaining maintain order
CommentReactionBar.update(orderBar, { counts: { wow: 0, like: 1, fire: 1 } }, ['like', 'fire']);
visibleTypes = Array.from(orderBar.querySelectorAll('[data-comment-reaction-selected-list] [data-reaction-type]'))
    .map(btn => btn.dataset.reactionType);
assert.deepEqual(visibleTypes, ['like', 'fire']);

// Test isPending state disabling buttons and setting aria-busy
CommentReactionBar.update(orderBar, { counts: { like: 1, fire: 1 } }, ['like', 'fire'], { isPending: true });
const pendingBtns = orderBar.querySelectorAll('[data-comment-reaction-selected-list] button');
pendingBtns.forEach(btn => {
    assert.equal(btn.disabled, true);
    assert.equal(btn.getAttribute('aria-busy'), 'true');
});
assert.equal(orderBar.getAttribute('data-pending'), 'true');

CommentReactionBar.update(orderBar, { counts: { like: 1, fire: 1 } }, ['like', 'fire'], { isPending: false });
assert.equal(orderBar.hasAttribute('data-pending'), false);

global.CommentReactionTypes = ['custom_1'];
global.CommentReactionMeta = { custom_1: { emoji: '🎬', label: 'Кино' } };
global.i18n = { get: (key) => key };
const customWrapper = document.createElement('div');
customWrapper.innerHTML = CommentReactionBar.render({
    ratingId: 'custom-rating',
    movieId: 101,
    userReaction: ['custom_1']
});
assert.equal(
    customWrapper.querySelector('[data-reaction-type="custom_1"]').getAttribute('title'),
    'Кино'
);

global.CommentReactionService = CommentReactionService;
global.CommentReactionMeta = {
    custom_b45: {
        emoji: ':b45:',
        shortcode: ':b45:',
        label: 'Pepe',
        renderType: 'image',
        imageUrl: customImageUrl
    }
};
global.CommentReactionTypes = ['custom_b45'];
const imageWrapper = document.createElement('div');
imageWrapper.innerHTML = CommentReactionBar.render({
    ratingId: 'custom-image-rating',
    movieId: 101,
    userReaction: ['custom_b45']
});
const imageBar = imageWrapper.firstElementChild;
assert.equal(imageBar.querySelector('[data-comment-reaction-image]').getAttribute('src'), customImageUrl);
CommentReactionBar.update(imageBar, {}, ['custom_b45']);
const image = imageBar.querySelector('[data-comment-reaction-image]');
assert.equal(image.dataset.fallbackBound, 'true');
image.dispatchEvent(new dom.window.Event('error'));
assert.equal(image.hidden, true);
assert.equal(imageBar.querySelector('.comment-reaction-image-fallback').hidden, false);

serviceContract
    .then(() => console.log('Comment reaction contracts passed'))
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
