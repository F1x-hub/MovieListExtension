import assert from 'node:assert';
import { getTimestamp } from '../src/shared/utils/dateUtils.js';

// Case 1: Firestore Timestamp object
const mockFirestoreTimestamp = {
    toDate: () => new Date('2026-01-01T00:00:00Z')
};
assert.strictEqual(
    getTimestamp(mockFirestoreTimestamp),
    new Date('2026-01-01T00:00:00Z').getTime(),
    'Firestore Timestamp with .toDate() failed'
);

// Case 2: ISO Date string
const isoStr = '2026-05-15T10:30:00.000Z';
assert.strictEqual(
    getTimestamp(isoStr),
    new Date(isoStr).getTime(),
    'ISO String parsing failed'
);

// Case 3: Serialized object { seconds: number }
const objSeconds = { seconds: 1700000000, nanoseconds: 0 };
assert.strictEqual(
    getTimestamp(objSeconds),
    1700000000000,
    'Object with { seconds: number } failed'
);

// Case 4: undefined / null
assert.strictEqual(getTimestamp(undefined), 0, 'undefined should return 0');
assert.strictEqual(getTimestamp(null), 0, 'null should return 0');

// Case 5: Invalid date string (must return 0, NOT NaN)
const invalidResult = getTimestamp('invalid-date-string');
assert.strictEqual(invalidResult, 0, 'Invalid string should return 0');
assert.strictEqual(Number.isNaN(invalidResult), false, 'Invalid string must NOT return NaN');

console.log('✅ All getTimestamp unit tests (imported from dateUtils.js) passed successfully!');
