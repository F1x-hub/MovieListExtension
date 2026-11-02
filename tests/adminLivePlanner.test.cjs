const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');
const { installLivePlannerFixture } = require('./helpers/livePlannerFixture.cjs');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));

async function mount({ unknownDuration = false } = {}) {
    const errors = [];
    const console = new VirtualConsole(); console.on('jsdomError', error => errors.push(error));
    const dom = new JSDOM(read('src/pages/admin/admin.html'), { url: 'https://extension.local/src/pages/admin/admin.html', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: console });
    const w = dom.window;
    w.HTMLElement.prototype.scrollIntoView = () => {};
    w.eval(read('src/shared/utils/Utils.js'));
    w.eval(read('src/shared/services/CinemaChannelService.js'));
    w.eval(`(${installLivePlannerFixture.toString()})()`);
    if (unknownDuration) {
        w.KinopoiskService.prototype.searchMovies = async () => ({ docs: [{ id: 258687, name: 'Без длительности', year: 2014, duration: 0, posterUrl: '' }] });
        w.KinopoiskService.prototype.getMovieById = async () => ({ id: 258687, name: 'Без длительности', year: 2014, duration: 0, posterUrl: '' });
    }
    w.eval(read('src/shared/components/SortControl.js'));
    w.eval(read('src/shared/components/CustomDateTimePicker.js').replace(/^export /gm, '') + '\nwindow.CustomDatePicker = CustomDatePicker;');
    w.eval(read('src/pages/admin/LiveSchedulePlanner.js'));
    w.eval(read('src/pages/admin/LiveSeriesEditor.js'));
    w.eval(read('src/pages/admin/admin-live.js'));
    await settle();
    return { dom, w, errors, $: id => w.document.getElementById(id) };
}

test('actual admin markup wires the 24-hour grid and keeps upcoming shows out of the on-air state', async t => {
    const f = await mount(); t.after(() => f.dom.window.close());
    assert.deepEqual(f.errors, []);
    assert.equal(f.w.document.querySelectorAll('.live-planner__block').length, 2);
    assert.equal(f.w.document.querySelector('.live-planner__tick span').textContent, '00:00');
    assert.equal(f.w.document.querySelector('.live-planner__tick:last-child span').textContent, '24:00');
    assert.equal(f.$('liveNowState').textContent, 'Следующий показ');
    assert.equal(f.$('liveStopBtn').hidden, true);
    assert.equal(f.w.document.querySelectorAll('.live-planner__block.is-live').length, 0);
    assert.equal(f.w.document.querySelector('[data-live-mode="movie"]').hidden, false);
    assert.equal(f.$('livePlannerDate').type, 'hidden');
    assert.ok(f.$('livePlannerDatePicker').querySelector('.custom-picker-trigger'));
    assert.ok(f.w.document.querySelector('script[src$="/SortControl.js"]'), 'real admin markup includes SortControl before planner');
    assert.equal(f.$('livePlannerZoom').hidden, true);
    assert.equal(f.$('livePlannerZoom').querySelector('option[value="3"]').textContent, '3 часа');
    assert.equal(f.$('livePlannerViewport').getAttribute('role'), 'slider');
    assert.equal(f.$('livePlannerOverviewBlocks').children.length, 2);
    assert.ok(f.w.SortControl.instances.get(f.$('livePlannerZoom')));
    assert.equal(f.$('liveSlotEnd').readOnly, false, 'the end can be typed when the drag is not convenient');
    assert.equal(f.w.document.querySelectorAll('.live-planner__block [data-resize="end"]').length, 2, 'every block resizes from its right edge');
    assert.equal(f.$('liveMovieMarginInput'), null, 'the margin field is gone');
});

test('catalogue length pre-fills an editable field and a typed end sets the slot length', async t => {
    const f = await mount(); t.after(() => f.dom.window.close());
    f.$('liveMovieSearch').value = '258687';
    f.$('liveMovieSearch').dispatchEvent(new f.w.Event('input', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 400));
    f.w.document.querySelector('.live-result').click();
    assert.equal(f.$('liveMovieDurationInput').value, '169');
    assert.equal(f.$('liveMovieDurationInput').readOnly, false, 'the catalogue length can be corrected');
    assert.match(f.$('liveMovieMeta').textContent, /по каталогу 169 мин/);
    f.$('livePlannerNext').click();
    f.$('liveSlotStart').value = '16:00'; f.$('liveSlotStart').dispatchEvent(new f.w.Event('input', { bubbles: true }));
    assert.equal(f.$('liveSlotEnd').value, '18:49', 'a new block matches the source length');
    f.$('liveMovieDurationInput').value = '175';
    f.$('liveMovieDurationInput').dispatchEvent(new f.w.Event('input', { bubbles: true }));
    assert.equal(f.$('liveSlotEnd').value, '18:55', 'the end follows the corrected length');
    f.$('liveSlotEnd').value = '19:10'; f.$('liveSlotEnd').dispatchEvent(new f.w.Event('input', { bubbles: true }));
    assert.equal(f.$('liveSlotDuration').textContent, '3 ч 10 мин');
    assert.match(f.$('liveSlotNote').textContent, /Запас 15 мин после видео/);
    assert.equal(f.$('liveStartBtn').disabled, false);
    f.$('liveChannelForm').dispatchEvent(new f.w.Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    const write = f.w.liveFixture.writes.find(item => item.action === 'create');
    assert.equal(write.input.kinopoiskId, 258687);
    assert.equal(write.input.durationMin, '175', 'the corrected length is the source length');
    assert.equal(write.start.getHours(), 16); assert.equal(write.end.getHours(), 19); assert.equal(write.end.getMinutes(), 10);
    assert.equal(write.end - write.start, 190 * 60_000, 'the typed end sets the slot; the film stays 175 minutes');
    assert.equal(f.$('liveStartBtn').textContent, 'Применить время');
    assert.equal(f.$('liveMovieDurationInput').readOnly, true, 'a saved show keeps its length');
    assert.deepEqual(f.errors, []);
});

test('selecting, retiming and removing an existing show use schedule APIs', async t => {
    const f = await mount(); t.after(() => f.dom.window.close());
    f.w.document.querySelector('[data-id="second"]').dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.equal(f.$('liveTitleInput').readOnly, true);
    f.$('liveSlotStart').value = '16:00'; f.$('liveSlotStart').dispatchEvent(new f.w.Event('input', { bubbles: true }));
    f.$('liveSlotEnd').value = '17:00'; f.$('liveSlotEnd').dispatchEvent(new f.w.Event('input', { bubbles: true }));
    assert.match(f.$('liveSlotNote').textContent, /прервётся/, 'a slot shorter than the film warns');
    f.$('liveChannelForm').dispatchEvent(new f.w.Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    const write = f.w.liveFixture.writes.find(item => item.action === 'update');
    assert.equal(write.item.id, 'second'); assert.equal(write.start.getHours(), 16);
    assert.equal(write.end - write.start, 60 * 60_000, 'a typed end changes the saved slot');
    assert.equal(f.w.liveFixture.items.find(item => item.id === 'second').movie.durationSec, 7200);
    assert.equal(f.$('liveStartBtn').disabled, false);
    f.$('liveDeleteShowBtn').click(); await settle();
    assert.equal(f.w.liveFixture.items.some(item => item.id === 'second'), false);
    assert.equal(f.w.liveFixture.writes.some(item => item.action === 'manual'), false);
    assert.equal(f.$('liveDeleteShowBtn').hidden, true);
    assert.deepEqual(f.errors, []);
});

test('unknown movie length is required before adding and supplies the fixed block length', async t => {
    const f = await mount({ unknownDuration: true }); t.after(() => f.dom.window.close());
    f.$('livePlannerNext').click();
    f.$('liveMovieSearch').value = '258687';
    f.$('liveMovieSearch').dispatchEvent(new f.w.Event('input', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 400));
    f.w.document.querySelector('.live-result').click();
    assert.equal(f.$('liveMovieDurationInput').readOnly, false);
    assert.equal(f.$('liveStartBtn').disabled, true, 'an unknown-length source cannot be scheduled yet');
    f.$('liveMovieDurationInput').value = '15,5';
    f.$('liveMovieDurationInput').dispatchEvent(new f.w.Event('input', { bubbles: true }));
    assert.equal(f.$('liveStartBtn').disabled, false);
    f.$('liveChannelForm').dispatchEvent(new f.w.Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    const write = f.w.liveFixture.writes.find(item => item.action === 'create');
    assert.ok(write);
    assert.equal(write.end - write.start, 930_000);
    assert.deepEqual(f.errors, []);
});

test('retiming a saved slot preserves its exact legacy length even when source metadata differs', async t => {
    const f = await mount(); t.after(() => f.dom.window.close());
    const item = f.w.liveFixture.items.find(item => item.id === 'second');
    item.endsAtMs = item.startedAtMs + 3617_000;
    for (const callback of f.w.liveFixture.subscribers) callback([...f.w.liveFixture.items]);
    f.w.document.querySelector('[data-id="second"]').dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.equal(f.w.document.querySelectorAll('[data-handle], .live-planner__handle').length, 0);
    f.$('liveSlotStart').value = '16:00'; f.$('liveSlotStart').dispatchEvent(new f.w.Event('input', { bubbles: true }));
    f.$('liveChannelForm').dispatchEvent(new f.w.Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    const write = f.w.liveFixture.writes.find(item => item.action === 'update');
    assert.ok(write);
    assert.equal(write.end - write.start, 3617_000);
    assert.equal(write.item.movie.durationSec, 7200, 'source metadata is not migrated');
    assert.deepEqual(f.errors, []);
});
