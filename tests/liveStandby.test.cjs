const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');
const cinema = require('../src/shared/services/CinemaChannelService.js');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src/pages/live/live.html'), 'utf8');
const markup = html.match(/<main class="live-root">[\s\S]*?<\/main>/)[0];
const code = fs.readFileSync(path.join(root, 'src/pages/live/LiveStandby.js'), 'utf8');
const NOW = new Date(2026, 9, 25, 12, 0, 0).getTime();

function scheduled(id, atMs, mode = 'movie') {
    return cinema.normalizeChannel({
        mode, title: `Показ ${id}`, startedAt: new Date(atMs), endsAt: new Date(atMs + 3600_000),
        movie: mode === 'movie' ? { kinopoiskId: 301, durationSec: 1800, posterUrl: `https://example.com/${id}.jpg` } : null,
        youtube: mode === 'youtube' ? { videoId: 'dQw4w9WgXcQ', live: false, durationSec: 900 } : null
    }, { id, docPath: `cinemaSchedule/${id}`, scheduled: true });
}

function mount() {
    const dom = new JSDOM(`<!doctype html><html lang="ru"><body>${markup}</body></html>`, { runScripts: 'outside-only', url: 'https://extension.local/src/pages/live/live.html' });
    const { window } = dom;
    window.CinemaChannel = cinema;
    window.eval(code);
    const byId = id => window.document.getElementById(id);
    const standby = new window.LiveStandby(byId('liveEmpty'), key => `t:${key}`);
    return { dom, window, byId, render: value => standby.render({ channel: cinema.normalizeChannel({ mode: 'off' }), position: { state: 'off', offsetSec: 0 }, next: null, nowMs: NOW, ...value }) };
}

test('standby shows next snapshot metadata and a ceil-rounded countdown, updating without writes', () => {
    const app = mount();
    try {
        const next = scheduled('next', NOW + 30_100);
        app.render({ next });
        assert.equal(app.byId('liveStandbyCountdown').textContent, '0:31');
        assert.equal(app.byId('liveStandbyCountdownWrap').hidden, false);
        assert.equal(app.byId('liveStandbyNextName').textContent, next.title);
        assert.equal(app.byId('liveStandbyPoster').src, next.movie.posterUrl);
        assert.equal(app.byId('liveEmptyTitle').textContent, 't:standby_gap_title');
        app.render({ next, nowMs: NOW + 10_100 });
        assert.equal(app.byId('liveStandbyCountdown').textContent, '0:20');
        assert.equal(app.window.firebase, undefined, 'component requires no Firebase access');
    } finally { app.dom.window.close(); }
});

test('early-ended current snapshot announces its next show without changing the allotted slot', () => {
    const app = mount();
    try {
        const channel = scheduled('current', NOW - 10_000);
        const next = scheduled('next', channel.endsAtMs);
        app.render({ channel, position: { state: 'ended', offsetSec: 9 }, next });
        assert.equal(app.byId('liveEmptyTitle').textContent, 't:standby_ended_title');
        assert.equal(app.byId('liveEmptyText').textContent, 't:standby_ended_text');
        assert.equal(app.byId('liveStandbyNextName').textContent, next.title);
        assert.equal(app.byId('liveStandbyCountdown').textContent, '59:50');
        assert.equal(channel.endsAtMs, next.startedAtMs);
    } finally { app.dom.window.close(); }
});

test('empty/ended schedule hides previous next-show and countdown UI', () => {
    const app = mount();
    try {
        app.render({ next: scheduled('next', NOW + 60_000) });
        app.render({});
        assert.equal(app.byId('liveEmptyTitle').textContent, 't:standby_empty_title');
        for (const id of ['liveStandbyCountdownWrap', 'liveStandbyNext']) assert.equal(app.byId(id).hidden, true);
        assert.equal(app.byId('liveStandbyNoTime').hidden, false);
        assert.equal(app.byId('liveStandbyNoTime').textContent, 't:standby_no_shows');
        app.render({ channel: scheduled('ended', NOW - 3600_000), position: { state: 'ended', offsetSec: 1800 } });
        assert.equal(app.byId('liveEmptyTitle').textContent, 't:ended_title');
    } finally { app.dom.window.close(); }
});

test('connection error overrides stale upcoming metadata and safe text never inserts source HTML', () => {
    const app = mount();
    try {
        const next = { ...scheduled('next', NOW + 60_000), title: '<img src=x onerror=alert(1)>' };
        app.render({ next });
        assert.equal(app.byId('liveStandbyNextName').textContent, next.title);
        assert.equal(app.byId('liveStandbyNextName').childElementCount, 0);
        app.render({ next, errorKeys: ['unavailable_title', 'unavailable_reload'] });
        assert.equal(app.byId('liveEmptyTitle').textContent, 't:unavailable_title');
        assert.equal(app.byId('liveStandbyCountdownWrap').hidden, true);
        assert.equal(app.byId('liveStandbyNoTime').textContent, 't:standby_connection_hint');
    } finally { app.dom.window.close(); }
});

test('next snapshot replaces failed artwork and fullscreen uses the standby screen', async () => {
    const app = mount();
    try {
        app.render({ next: scheduled('one', NOW + 60_000) });
        app.byId('liveStandbyPoster').dispatchEvent(new app.window.Event('error'));
        assert.equal(app.byId('liveStandbyPoster').hidden, true);
        app.render({ next: scheduled('two', NOW + 120_000, 'youtube') });
        assert.equal(app.byId('liveStandbyPoster').hidden, false);
        assert.match(app.byId('liveStandbyPoster').src, /i\.ytimg\.com/);
        let entered = 0;
        app.byId('liveStandbyScreen').requestFullscreen = async () => { entered++; };
        app.byId('liveStandbyFullscreen').click();
        await Promise.resolve();
        assert.equal(entered, 1);
        assert.equal(app.byId('liveStandbyFullscreen').getAttribute('aria-label'), 't:fullscreen');
    } finally { app.dom.window.close(); }
});
