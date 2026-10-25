const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');
const { installLivePlannerFixture } = require('./helpers/livePlannerFixture.cjs');
const { installLiveSeriesFixture } = require('./helpers/liveSeriesFixture.cjs');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));

async function mount() {
    const errors = [];
    const console = new VirtualConsole(); console.on('jsdomError', error => errors.push(error));
    const dom = new JSDOM(read('src/pages/admin/admin.html'), { url: 'https://extension.local/src/pages/admin/admin.html',
        runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: console });
    const w = dom.window;
    w.HTMLElement.prototype.scrollIntoView = () => {};
    for (const file of ['src/shared/utils/Utils.js', 'src/shared/services/CinemaChannelService.js']) w.eval(read(file));
    w.eval(`(${installLivePlannerFixture.toString()})()`);
    w.eval(`(${installLiveSeriesFixture.toString()})()`);
    w.eval(read('src/shared/components/SortControl.js'));
    w.eval(read('src/shared/components/CustomDateTimePicker.js').replace(/^export /gm, '') + '\nwindow.CustomDatePicker = CustomDatePicker;');
    for (const file of ['LiveSchedulePlanner.js', 'LiveSeriesEditor.js', 'admin-live.js']) w.eval(read(`src/pages/admin/${file}`));
    await settle();
    const $ = id => w.document.getElementById(id);
    const input = (id, value) => { $(id).value = value; $(id).dispatchEvent(new w.Event('input', { bubbles: true })); };
    const choose = async () => {
        input('liveMovieSearch', '101');
        await new Promise(resolve => setTimeout(resolve, 400));
        w.document.querySelector('.live-result').click();
        await settle(); await settle();
    };
    const submit = async () => { $('liveChannelForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await settle(); await settle(); };
    return { dom, w, $, input, choose, submit, errors, episodes: () => [...$('liveSeriesEpisodes').querySelectorAll('button')] };
}

test('series editor adds exactly one episode with its runtime and prepares the next at the saved end', async t => {
    const f = await mount(); t.after(() => f.dom.window.close());
    await f.choose();
    assert.equal(f.$('liveSeriesCode').textContent, 'S01E01');
    assert.equal(f.$('liveMovieDurationInput').value, '42', 'series-wide 99 minutes must not become slot duration');
    assert.equal(f.$('liveMovieDurationInput').readOnly, true);
    f.input('liveSlotStart', '16:00');
    await f.submit();
    const writes = f.w.liveFixture.writes.filter(item => item.action === 'create');
    assert.equal(writes.length, 1, 'never bulk-add a season');
    assert.equal(writes[0].input.mediaType, 'tv-series');
    assert.equal(writes[0].input.seasonNumber, 1);
    assert.equal(writes[0].input.episodeNumber, 1);
    assert.equal(writes[0].end - writes[0].start, 42 * 60_000);
    assert.equal(f.$('liveSeriesCode').textContent, 'S01E02');
    assert.equal(f.$('liveSlotStart').value, '16:42');
    assert.match(f.$('liveStartBtn').textContent, /Добавить следующую.*S01E02/);
    assert.match(f.episodes()[0].textContent, /В программе/);
    const block = f.w.document.querySelector('[data-id="created-1"]');
    assert.match(block.title, /S01E01.*Название 1/);
    assert.match(block.getAttribute('aria-label'), /S01E01/);
    await f.submit();
    assert.equal(f.w.liveFixture.writes.filter(item => item.action === 'create').length, 2);
    assert.equal(f.$('liveSeriesCode').textContent, 'S01E03');
    assert.equal(f.$('liveMovieDurationInput').value, '');
    assert.equal(f.$('liveMovieDurationInput').readOnly, false);
    assert.equal(f.$('liveStartBtn').disabled, true, 'unknown episode length is required');
    assert.equal(f.episodes()[3].disabled, true, 'unreleased episodes cannot be scheduled');
    assert.deepEqual(f.errors, []);
});

test('episode collision blocks adding and nearest-free action preserves other screenings', async t => {
    const f = await mount(); t.after(() => f.dom.window.close());
    await f.choose(); f.input('liveSlotStart', '17:45');
    assert.equal(f.$('liveStartBtn').disabled, true);
    assert.equal(f.$('liveFindFreeSlotBtn').hidden, false);
    assert.match(f.$('liveSeriesTiming').textContent, /Интерстеллар/);
    await f.submit(); assert.equal(f.w.liveFixture.writes.length, 0);
    f.$('liveFindFreeSlotBtn').click();
    assert.equal(f.$('liveSlotStart').value, '20:00');
    assert.equal(f.$('liveStartBtn').disabled, false);
    await f.submit();
    assert.equal(f.w.liveFixture.writes[0].start.getHours(), 20);
    assert.equal(f.w.liveFixture.items.find(item => item.id === 'first').startedAtMs,
        new Date(f.w.CinemaChannel.now()).setHours(18, 0, 0, 0));
    assert.equal(f.w.liveFixture.writes.some(item => item.action === 'update'), false);
    assert.deepEqual(f.errors, []);
});

test('specials retain season zero and existing episode moves preserve identity and length', async t => {
    const f = await mount(); t.after(() => f.dom.window.close()); await f.choose();
    [...f.$('liveSeriesSeasons').querySelectorAll('button')].find(button => button.textContent === 'Спецвыпуски').click();
    await settle(); f.input('liveSlotStart', '16:00'); await f.submit();
    const write = f.w.liveFixture.writes[0];
    assert.equal(write.input.seasonNumber, 0); assert.equal(write.end - write.start, 20 * 60_000);
    f.w.document.querySelector('[data-id="created-1"]').dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    f.input('liveSlotStart', '17:00'); await f.submit();
    const move = f.w.liveFixture.writes.find(item => item.action === 'update');
    assert.equal(move.item.movie.seasonNumber, 0); assert.equal(move.item.movie.episodeNumber, 1);
    assert.equal(move.end - move.start, 20 * 60_000);
    assert.deepEqual(f.errors, []);
});

test('unavailable catalogue is retryable and stale replies cannot restore a cleared source', async t => {
    const f = await mount(); t.after(() => f.dom.window.close());
    f.w.liveSeriesFixture.fail = true; await f.choose();
    assert.equal(f.$('liveStartBtn').disabled, true);
    assert.equal(f.$('liveSeriesRetry').hidden, false);
    f.w.liveSeriesFixture.fail = false; f.$('liveSeriesRetry').click(); await settle(); await settle();
    assert.equal(f.$('liveSeriesCode').textContent, 'S01E01');
    let resolve; f.w.liveSeriesFixture.delay = new Promise(done => { resolve = done; });
    await f.choose();
    f.input('liveMovieSearch', ''); resolve(); await settle(); await settle();
    assert.equal(f.$('liveStartBtn').disabled, true);
    assert.equal(f.$('liveSeriesEditor').hidden, true);
    assert.deepEqual(f.errors, []);
});

test('last regular episode prepares the next season without bulk writes and preserves midnight', async t => {
    const f = await mount(); t.after(() => f.dom.window.close());
    f.w.liveSeriesFixture.episodes[1] = [f.w.liveSeriesFixture.episodes[1][0]];
    await f.choose(); f.input('liveSlotStart', '23:40'); await f.submit();
    assert.equal(f.$('liveSeriesCode').textContent, 'S02E01');
    assert.equal(f.$('liveSlotStart').value, '00:22');
    assert.equal(f.$('liveMovieDurationInput').value, '50');
    const first = f.w.liveFixture.writes[0];
    const nextDay = new Date(first.end); nextDay.setHours(0, 0, 0, 0);
    assert.equal(f.$('livePlannerDate').value, `${nextDay.getFullYear()}-${String(nextDay.getMonth() + 1).padStart(2, '0')}-${String(nextDay.getDate()).padStart(2, '0')}`);
    assert.equal(f.w.liveFixture.writes.length, 1);
    await f.submit();
    assert.equal(f.w.liveFixture.writes[1].start.getTime(), first.end.getTime());
    assert.equal(f.w.liveFixture.writes[1].input.seasonNumber, 2);
    assert.deepEqual(f.errors, []);
});

test('prepared next episode already on the day grid selects its existing slot instead of creating a duplicate', async t => {
    const f = await mount(); t.after(() => f.dom.window.close());
    const at = new Date(f.w.CinemaChannel.now()); at.setHours(20, 0, 0, 0);
    const existing = f.w.CinemaChannel.normalizeChannel({ mode: 'movie', title: 'Уже в программе',
        movie: { kinopoiskId: 101, mediaType: 'tv-series', seasonNumber: 1, episodeNumber: 2, durationSec: 44 * 60, tmdbId: 555 },
        startedAt: at, endsAt: new Date(at.getTime() + 44 * 60_000) }, { id: 'episode2', docPath: 'cinemaSchedule/episode2', scheduled: true });
    f.w.liveFixture.items.push(existing);
    for (const callback of f.w.liveFixture.subscribers) callback([...f.w.liveFixture.items]);
    await f.choose(); f.input('liveSlotStart', '16:00'); await f.submit();
    assert.equal(f.$('liveSeriesCode').textContent, 'S01E02');
    assert.equal(f.$('liveStartBtn').disabled, true);
    assert.equal(f.$('liveSeriesContinue').textContent, 'Выбрать существующий показ');
    f.$('liveSeriesContinue').click();
    assert.equal(f.$('liveStartBtn').textContent, 'Применить время');
    assert.equal(f.$('liveSlotStart').value, '20:00');
    assert.equal(f.w.liveFixture.writes.length, 1);
    assert.deepEqual(f.errors, []);
});

test('episode and season rerenders preserve keyboard focus without stealing focus from timing inputs', async t => {
    const f = await mount(); t.after(() => f.dom.window.close()); await f.choose();
    const episode = f.episodes()[1]; episode.focus(); episode.click();
    assert.equal(f.w.document.activeElement.dataset.episodeNumber, '2');
    const special = [...f.$('liveSeriesSeasons').querySelectorAll('button')].find(button => button.textContent === 'Спецвыпуски');
    special.focus(); special.click(); await settle(); await settle();
    assert.equal(f.w.document.activeElement.dataset.seasonNumber, '0');
    f.$('liveSlotStart').focus();
    for (const callback of f.w.liveFixture.subscribers) callback([...f.w.liveFixture.items]);
    assert.equal(f.w.document.activeElement, f.$('liveSlotStart'));
    assert.deepEqual(f.errors, []);
});
