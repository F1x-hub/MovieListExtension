import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Load Utils in Node environment
const Utils = (await import('../src/shared/utils/Utils.js')).default || (await import('../src/shared/utils/Utils.js')).Utils;

describe('Rating Comment Normalization & Generic HTML Escaping', () => {
    describe('1. Utils.normalizeRatingComment Contract', () => {
        it('normalizes clean strings', () => {
            assert.strictEqual(Utils.normalizeRatingComment('hello'), 'hello');
        });

        it('trims whitespace from strings', () => {
            assert.strictEqual(Utils.normalizeRatingComment('  hello  '), 'hello');
        });

        it('normalizes legacy { text: "hello" } object shape', () => {
            assert.strictEqual(Utils.normalizeRatingComment({ text: 'hello' }), 'hello');
            assert.strictEqual(Utils.normalizeRatingComment({ text: '  hello  ', spoiler: false }), 'hello');
        });

        it('normalizes legacy { comment: "hello" } object shape', () => {
            assert.strictEqual(Utils.normalizeRatingComment({ comment: 'hello' }), 'hello');
            assert.strictEqual(Utils.normalizeRatingComment({ comment: '  spaced comment  ' }), 'spaced comment');
        });

        it('handles malicious script text within legacy object safely without escaping at normalization layer', () => {
            assert.strictEqual(Utils.normalizeRatingComment({ text: '<script>alert(1)</script>' }), '<script>alert(1)</script>');
        });

        it('returns empty string for null and undefined', () => {
            assert.strictEqual(Utils.normalizeRatingComment(null), '');
            assert.strictEqual(Utils.normalizeRatingComment(undefined), '');
        });

        it('returns empty string for empty object {} and unknown object shapes without stringifying', () => {
            assert.strictEqual(Utils.normalizeRatingComment({}), '');
            assert.strictEqual(Utils.normalizeRatingComment({ unexpected: 'hello' }), '');
            assert.strictEqual(Utils.normalizeRatingComment({ foo: 123, bar: 'baz' }), '');
        });

        it('never outputs [object Object]', () => {
            const outputs = [
                Utils.normalizeRatingComment({}),
                Utils.normalizeRatingComment({ unexpected: 'hello' }),
                Utils.normalizeRatingComment({ nested: { text: 'hi' } }),
                Utils.normalizeRatingComment(null),
                Utils.normalizeRatingComment(undefined)
            ];
            for (const out of outputs) {
                assert.doesNotMatch(out, /\[object Object\]/);
            }
        });
    });

    describe('2. Utils.escapeHtml Generic Escaping Contract', () => {
        it('escapes HTML special characters generically', () => {
            assert.strictEqual(Utils.escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
            assert.strictEqual(Utils.escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
            assert.strictEqual(Utils.escapeHtml('Tom & Jerry "Special" \'Edition\''), 'Tom &amp; Jerry &quot;Special&quot; &#039;Edition&#039;');
        });

        it('handles null and undefined by returning empty string', () => {
            assert.strictEqual(Utils.escapeHtml(null), '');
            assert.strictEqual(Utils.escapeHtml(undefined), '');
        });

        it('is domain-agnostic and does not inspect .text or .comment', () => {
            // Because escapeHtml is a generic primitive, if passed a raw object directly it stringifies it
            // which proves domain logic is NOT inside escapeHtml
            const obj = { text: 'hello' };
            assert.strictEqual(Utils.escapeHtml(obj), '[object Object]');
        });
    });

    describe('3. End-to-End Rendering Pipeline: raw -> normalize -> escapeHtml', () => {
        function renderPipeline(rawComment) {
            const normalized = Utils.normalizeRatingComment(rawComment);
            return Utils.escapeHtml(normalized);
        }

        it('safely renders plain text comments', () => {
            assert.strictEqual(renderPipeline('Great movie!'), 'Great movie!');
            assert.strictEqual(renderPipeline('  Great movie!  '), 'Great movie!');
        });

        it('safely renders and escapes legacy object comments with XSS payloads', () => {
            assert.strictEqual(renderPipeline({ text: '<img src=x onerror=alert(1)>' }), '&lt;img src=x onerror=alert(1)&gt;');
            assert.strictEqual(renderPipeline({ text: '<b>Bold review</b>' }), '&lt;b&gt;Bold review&lt;/b&gt;');
        });

        it('safely renders legacy clean text object comments', () => {
            assert.strictEqual(renderPipeline({ text: 'Общество мертвых поэтов' }), 'Общество мертвых поэтов');
        });

        it('safely renders unknown/empty objects as empty string, NEVER [object Object]', () => {
            assert.strictEqual(renderPipeline({}), '');
            assert.strictEqual(renderPipeline({ unexpected: 'hello' }), '');
            assert.strictEqual(renderPipeline(null), '');
            assert.strictEqual(renderPipeline(undefined), '');
        });
    });
});
