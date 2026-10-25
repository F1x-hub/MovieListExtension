const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');
const cinema = require('../src/shared/services/CinemaChannelService.js');
const { programmeModel } = require('../src/pages/live/LiveProgramme.js');
const root = path.resolve(__dirname, '..');
const markup = fs.readFileSync(path.join(root, 'src/pages/live/live.html'), 'utf8').match(/<main class="live-root">[\s\S]*?<\/main>/)[0];
const code = fs.readFileSync(path.join(root, 'src/pages/live/LiveProgramme.js'), 'utf8');
const NOW = new Date(2026, 9, 25, 19, 12).getTime();
const at = (hour, minute = 0) => new Date(2026, 9, 25, hour, minute).getTime();
function show(id, from, to, durationSec = (to - from) / 1000) {
    return cinema.normalizeChannel({ mode: 'movie', title: `Показ ${id}`, startedAt: new Date(from), endsAt: new Date(to),
        movie: { kinopoiskId: 301, durationSec, posterUrl: `https://example.com/${id}.jpg` } },
    { id, docPath: `cinemaSchedule/${id}`, scheduled: true });
}
const fixtures = () => [show('past', at(14), at(15)), show('current', at(18), at(20, 35)),
    show('next', at(21), at(22, 40)), show('late', at(22, 55), at(24, 42))];
function mount() {
    const dom = new JSDOM(`<!doctype html><html lang="ru"><body>${markup}</body></html>`, { runScripts: 'outside-only', url: 'https://extension.local/src/pages/live/live.html' });
    const { window } = dom;
    window.CinemaChannel = cinema;
    window.eval(code);
    const byId = name => window.document.getElementById(`liveProgramme${name}`);
    const translate = (key, params = {}) => [key, ...Object.values(params)].join(' ');
    const component = new window.LiveProgramme(byId(''), translate);
    const items = fixtures();
    const render = patch => component.render({ items, channel: items[1], position: { state: 'live' }, nowMs: NOW, ready: true, ...patch });
    return { dom, window, byId, component, items, render };
}

test('programme includes overlapping local-day slots and identifies actual resolved playback', () => {
    const items = [...fixtures(), show('carry-in', at(-1), at(1)), show('tomorrow', at(24, 42), at(26)),
        show('ends-at-midnight', at(-2), at(0))];
    const current = items[1];
    const model = programmeModel(items, current, { state: 'live' }, NOW, cinema);
    assert.deepEqual(model.rows.map(row => row.item.id), ['carry-in', 'past', 'current', 'next', 'late']);
    assert.equal(model.rows.find(row => row.item.id === 'current').status, 'current');
    assert.equal(model.next.id, 'next');
    const stopped = programmeModel(items, cinema.normalizeChannel({ mode: 'off', startedAt: new Date(at(19)) }), { state: 'off' }, NOW, cinema);
    assert.equal(stopped.rows.find(row => row.item.id === 'current').status, 'not_on_air');
    const earlyEnd = programmeModel(items, current, { state: 'ended' }, NOW, cinema);
    assert.equal(earlyEnd.rows.find(row => row.item.id === 'current').status, 'finished');
    assert.equal(earlyEnd.rows.find(row => row.item.id === 'current').endMs, at(20, 35));
});

test('public next strip and programme identify exact episodes even with a custom screening title', () => {
    const app = mount();
    try {
        const next = app.items[2];
        next.title = 'Вечерний сериал';
        Object.assign(next.movie, { mediaType: 'tv-series', seasonNumber: 0, episodeNumber: 2, episodeTitle: '<Спецвыпуск>' });
        app.render();
        assert.match(app.byId('Meta').textContent, /S00E02 · <Спецвыпуск>/);
        app.byId('Toggle').click();
        const row = app.byId('List').querySelector('[data-programme-show="cinemaSchedule/next"]');
        assert.match(row.textContent, /S00E02 · <Спецвыпуск>/);
        assert.equal(row.querySelector('спецвыпуск'), null);
    } finally { app.dom.window.close(); }
});

test('manual on-air show is included, while schedule IDs cannot impersonate it', () => {
    const items = fixtures();
    const manual = cinema.normalizeChannel({ mode: 'youtube', title: 'Live', startedAt: new Date(at(19)),
        youtube: { videoId: 'dQw4w9WgXcQ', live: true } }, { id: 'current' });
    const model = programmeModel(items, manual, { state: 'live' }, NOW, cinema);
    assert.equal(model.rows.filter(row => row.status === 'current').length, 1);
    assert.equal(model.rows.find(row => row.status === 'current').item.docPath, 'settings/cinemaChannel');
    assert.equal(model.rows.find(row => row.item.docPath === 'cinemaSchedule/current').status, 'not_on_air');
    assert.equal(model.rows.find(row => row.status === 'current').endMs, Infinity);
});

test('persistent strip is outside the hidden standby and filters/collapse preserve state', () => {
    const app = mount();
    try {
        app.render();
        assert.equal(app.byId('').closest('#liveEmpty'), null);
        assert.equal(app.byId('').hidden, false);
        assert.equal(app.byId('Panel').hidden, true);
        assert.equal(app.byId('Name').textContent, 'Показ next');
        app.byId('Toggle').click();
        assert.equal(app.byId('Panel').hidden, false);
        assert.equal(app.byId('Toggle').getAttribute('aria-expanded'), 'true');
        assert.equal(app.byId('List').querySelectorAll('.live-programme__show').length, 4);
        app.byId('Upcoming').focus(); app.byId('Upcoming').click();
        assert.equal(app.byId('List').querySelectorAll('.live-programme__show').length, 3);
        const first = app.byId('List').firstChild;
        app.render({ nowMs: NOW + 1000 });
        assert.equal(app.byId('List').firstChild, first, 'second ticks do not rebuild stable programme rows');
        assert.equal(app.window.document.activeElement, app.byId('Upcoming'));
        app.byId('Collapse').click();
        assert.equal(app.byId('Panel').hidden, true);
        assert.equal(app.window.document.activeElement, app.byId('Toggle'));
        app.byId('Toggle').click();
        assert.equal(app.byId('Upcoming').getAttribute('aria-pressed'), 'true');
        assert.equal(app.window.firebase, undefined, 'programme requires no auth or Firestore client');
    } finally { app.dom.window.close(); }
});

test('loading, failed, stale and successful empty snapshots have distinct states', () => {
    const app = mount();
    try {
        app.render({ items: [], channel: null, ready: false });
        assert.equal(app.byId('Name').textContent, 'programme_loading');
        app.render({ items: [], channel: null, ready: false, error: true });
        assert.equal(app.byId('EmptyTitle').textContent, 'programme_unavailable');
        app.render({ error: true });
        assert.equal(app.byId('Notice').hidden, false);
        assert.equal(app.byId('Name').textContent, 'Показ next');
        app.render({ items: [], channel: null });
        assert.equal(app.byId('EmptyTitle').textContent, 'programme_empty');
        assert.equal(app.byId('Notice').hidden, true);
        assert.equal(app.byId('Poster').hidden, true);
        assert.equal(app.byId('Wait').hidden, true);
        app.render({ items: app.items.slice(0, 2) });
        assert.equal(app.byId('Name').textContent, 'programme_last');
        app.byId('Upcoming').click();
        app.render({ channel: null, position: null, nowMs: at(23), items: app.items.slice(0, 2) });
        assert.equal(app.byId('EmptyTitle').textContent, 'programme_no_upcoming');
    } finally { app.dom.window.close(); }
});

test('future snapshots update the bar without replacing active player; text and artwork failures are safe', () => {
    const app = mount();
    try {
        const frame = app.window.document.createElement('iframe');
        app.window.document.getElementById('liveScreen').append(frame);
        app.render();
        const next = { ...app.items[2], title: '<img src=x onerror=alert(1)>', startedAtMs: at(20, 45) };
        app.render({ items: [app.items[0], app.items[1], next] });
        assert.equal(app.byId('Name').textContent, next.title);
        assert.equal(app.byId('Name').childElementCount, 0);
        assert.equal(app.window.document.querySelector('.live-programme__copy h3 img'), null);
        assert.equal(frame.isConnected, true);
        app.byId('Poster').dispatchEvent(new app.window.Event('error'));
        assert.equal(app.byId('Poster').hidden, true);
        app.render({ items: [app.items[1], show('tomorrow', at(25), at(26))] });
        assert.equal(app.byId('Poster').hidden, false);
        assert.match(app.byId('Time').textContent, /26/);
        const late = app.byId('List').querySelector('[data-programme-show="cinemaSchedule/current"]');
        assert.ok(late);
        app.component.destroy();
        app.byId('Toggle').click();
        assert.equal(app.byId('Panel').hidden, true);
    } finally { app.dom.window.close(); }
});

test('programme dates and status labels refresh after locale change and local midnight', () => {
    const app = mount();
    try {
        app.render();
        assert.match(app.byId('List').querySelector('[data-programme-show="cinemaSchedule/late"] small').textContent, /26/);
        const previous = app.byId('List').firstChild;
        app.window.document.documentElement.lang = 'en';
        app.render();
        assert.notEqual(app.byId('List').firstChild, previous);
        assert.match(app.byId('Date').textContent, /October/);
        app.render({ nowMs: at(24, 10), channel: app.items[3] });
        assert.equal(app.byId('List').querySelectorAll('.live-programme__show').length, 1);
        assert.equal(app.byId('List').querySelector('.is-current h3').textContent, 'Показ late');
    } finally { app.dom.window.close(); }
});

test('calendar-day bounds respect 23/25-hour daylight-saving days', () => {
    const result = spawnSync(process.execPath, ['-e', `
        const {programmeModel}=require('./src/pages/live/LiveProgramme.js');
        const cinema=require('./src/shared/services/CinemaChannelService.js');
        const hours=[new Date(2026,2,8,12),new Date(2026,10,1,12)].map(date=>{
            const m=programmeModel([],null,null,date.getTime(),cinema);return(m.dayEnd-m.dayStart)/3600000;
        }); console.log(JSON.stringify(hours));
    `], { cwd: root, env: { ...process.env, TZ: 'America/New_York' }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.trim()), [23, 25]);
});
