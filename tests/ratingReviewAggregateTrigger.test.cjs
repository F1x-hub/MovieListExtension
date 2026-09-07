const assert = require('assert/strict');
const fs = require('fs');
const { isAggregateRelevantRatingChange } = require('../functions/ratingAggregation.js');

const base = {
    userId: 'user-1',
    movieId: 42,
    rating: 8,
    comment: 'комментарий',
    review: 'рецензия'
};

assert.equal(isAggregateRelevantRatingChange(null, base), true);
assert.equal(isAggregateRelevantRatingChange(base, null), true);
assert.equal(isAggregateRelevantRatingChange(base, { ...base, review: 'обновлено' }), false);
assert.equal(isAggregateRelevantRatingChange(base, { ...base, comment: 'обновлено' }), false);
assert.equal(isAggregateRelevantRatingChange(base, { ...base, rating: 9 }), true);
assert.equal(isAggregateRelevantRatingChange(base, { ...base, movieId: 43 }), true);
assert.equal(isAggregateRelevantRatingChange(base, { ...base, userId: 'user-2' }), true);

const indexSource = fs.readFileSync(require.resolve('../functions/index.js'), 'utf8');
assert.match(indexSource, /isAggregateRelevantRatingChange/);
assert.match(indexSource, /Ignored text-only rating update/);

console.log('Rating review aggregate trigger tests passed');
