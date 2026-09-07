/**
 * Shared rating text limits and normalization contract.
 * Keep this file loaded before RatingService.js in every extension page.
 */
const RatingConfig = Object.freeze({
    SHORT_COMMENT_MAX_LENGTH: 500,
    LONG_REVIEW_MAX_LENGTH: 5000,

    normalizeLineBreaks(value) {
        return String(value).replace(/\r\n?/g, '\n');
    },

    normalizeText(value, maxLength) {
        if (value === undefined || value === null) return '';
        if (typeof value !== 'string') {
            throw new TypeError('Rating text must be a string');
        }

        const normalized = this.normalizeLineBreaks(value).trim();
        if (Array.from(normalized).length > maxLength) {
            throw new RangeError(`Rating text must be ${maxLength} characters or less`);
        }
        return normalized;
    },

    normalizeComment(value) {
        return this.normalizeText(value, this.SHORT_COMMENT_MAX_LENGTH);
    },

    normalizeReview(value) {
        return this.normalizeText(value, this.LONG_REVIEW_MAX_LENGTH);
    },

    getLength(value) {
        return Array.from(this.normalizeLineBreaks(String(value ?? ''))).length;
    }
});

if (typeof module !== 'undefined' && module.exports) {
    module.exports = RatingConfig;
}
if (typeof globalThis !== 'undefined') {
    globalThis.RatingConfig = RatingConfig;
}
if (typeof window !== 'undefined') {
    window.RatingConfig = RatingConfig;
}
