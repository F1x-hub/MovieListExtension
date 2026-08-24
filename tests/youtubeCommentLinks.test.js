import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const module = await import('../src/shared/utils/Utils.js');
const Utils = module.default || module.Utils;

const videoId = 'dQw4w9WgXcQ';
const reportedUrl = 'https://www.youtube.com/watch?v=bWcASV2sey0&list=RDbWcASV2sey0&start_radio=1';

assert.deepEqual(
    Utils.extractYouTubeVideoInfo(reportedUrl),
    { id: 'bWcASV2sey0', startSeconds: 0 },
    'The reported YouTube watch URL should be recognized despite playlist parameters'
);

assert.deepEqual(
    Utils.extractYouTubeVideoInfo(`https://www.youtube.com/watch?v=${videoId}`),
    { id: videoId, startSeconds: 0 },
    'watch URL should return the video ID'
);

assert.deepEqual(
    Utils.extractYouTubeVideoInfo(`https://youtu.be/${videoId}?t=1m20s`),
    { id: videoId, startSeconds: 80 },
    'short URL should preserve a human-readable timestamp'
);

assert.deepEqual(
    Utils.extractYouTubeVideoInfo(`https://www.youtube.com/shorts/${videoId}?start=42`),
    { id: videoId, startSeconds: 42 },
    'Shorts URL should be supported'
);

assert.deepEqual(
    Utils.extractYouTubeVideoInfo(`https://www.youtube.com/embed/${videoId}.`),
    { id: videoId, startSeconds: 0 },
    'Trailing sentence punctuation should not become part of the video ID'
);

assert.deepEqual(
    Utils.extractYouTubeVideoInfo(`https://www.youtube.com/watch?v=${videoId}&amp;t=90`),
    { id: videoId, startSeconds: 90 },
    'HTML-escaped query separators should be parsed correctly'
);

assert.equal(
    Utils.extractYouTubeVideoInfo(`https://example.com/youtube/watch?v=${videoId}`),
    null,
    'A non-YouTube host must not be intercepted'
);

assert.equal(
    Utils.extractYouTubeVideoInfo('https://www.youtube.com/channel/UC1234567890'),
    null,
    'A YouTube channel URL is not a playable video URL'
);

const escapedComment = Utils.escapeHtml(
    `Trailer: https://www.youtube.com/watch?v=${videoId}&t=12. Plain: https://example.com/page`
);
const linkedComment = Utils.linkify(escapedComment);
const commentDocument = new JSDOM(`<div>${linkedComment}</div>`).window.document;
const youtubeAnchor = commentDocument.querySelector('.chat-link--youtube');

assert.match(linkedComment, /class="chat-link chat-link--youtube/);
assert.match(linkedComment, new RegExp(`data-youtube-id="${videoId}"`));
assert.match(linkedComment, /data-youtube-start="12"/);
assert.ok(youtubeAnchor, 'YouTube links should have a dedicated marker class');
assert.equal(youtubeAnchor.dataset.youtubeId, videoId);
assert.equal(youtubeAnchor.dataset.youtubeStart, '12');
assert.match(linkedComment, /href="https:\/\/example\.com\/page" target="_blank"/);
assert.doesNotMatch(linkedComment, /example\.com\/page[^<]*data-youtube-id/);

console.log('✅ YouTube comment link parsing and linkification tests passed');
