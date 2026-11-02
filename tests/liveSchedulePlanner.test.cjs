const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');
const helpers = require('../src/pages/admin/LiveSchedulePlanner.js');
const cinema = require('../src/shared/services/CinemaChannelService.js');
const plannerPath = path.resolve(__dirname, '../src/pages/admin/LiveSchedulePlanner.js');
const plannerCode = fs.readFileSync(plannerPath, 'utf8');
const sortCode = fs.readFileSync(path.resolve(__dirname, '../src/shared/components/SortControl.js'), 'utf8');
const pickerCode = fs.readFileSync(path.resolve(__dirname, '../src/shared/components/CustomDateTimePicker.js'), 'utf8').replace(/^export /gm, '') + '\nwindow.CustomDatePicker = CustomDatePicker;';
const HOUR = 3600_000;
const DAY = new Date(2026, 9, 25).getTime();
const settle = () => new Promise(resolve => setImmediate(resolve));

const markup = `<!doctype html><html><body>
  <section aria-label="Программа передач">
    <button id="livePlannerPrev">Назад</button><input id="livePlannerDate" type="hidden"><div id="livePlannerDatePicker"></div>
    <button id="livePlannerNext">Вперёд</button><button id="livePlannerToday">Сегодня</button>
    <button id="livePlannerNow">Сейчас</button><span id="livePlannerTimezone"></span>
    <select id="livePlannerZoom"><option value="24" selected>24 часа</option><option value="12">12 часов</option><option value="6">6 часов</option><option value="3">3 часа</option></select>
    <div id="livePlannerOverviewHours"></div><span id="livePlannerViewRange"></span>
    <div id="livePlannerOverviewTrack"><div id="livePlannerOverviewBlocks"></div><div id="livePlannerViewport" role="slider" tabindex="0"></div></div>
    <div id="livePlannerScroll"><div id="livePlannerCanvas"><div id="livePlannerRuler"></div>
      <div id="livePlannerTrack"></div><div id="livePlannerLine"><span></span></div>
    </div></div>
    <span id="livePlannerStats"></span><button id="livePlannerAdd">Добавить</button>
    <aside><img id="liveSelectedPoster"><strong id="liveSelectedName"></strong><span id="liveSelectedMeta"></span>
      <span id="liveSelectionBadge"></span><input id="liveSlotStart" type="time" step="1"><input id="liveSlotEnd" type="time" step="1">
      <span id="liveSlotDuration"></span><p id="liveSlotNote"></p><button id="liveDeleteShowBtn">Удалить</button>
    </aside>
  </section>
</body></html>`;

function slot(id, startHour, endHour, extra = {}) {
    return {
        id, docPath: `cinemaSchedule/${id}`, scheduled: true, mode: 'movie', title: `Показ ${id}`,
        startedAtMs: DAY + startHour * HOUR, endsAtMs: DAY + endHour * HOUR,
        playbackStartedAtMs: NaN, explicitEnd: true,
        updatedAtMs: DAY, updatedAtVersion: `${DAY / 1000}:100`,
        movie: { kinopoiskId: 301, durationSec: (endHour - startHour) * 3600, posterUrl: '', pausedAtSec: null },
        ...extra
    };
}

function mount(options = {}) {
    const dom = new JSDOM(markup, { url: 'https://extension.local/src/pages/admin/admin.html', runScripts: 'outside-only', pretendToBeVisual: true });
    const { window } = dom;
    const frames = new Map(); let frameId = 0;
    window.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId; };
    window.cancelAnimationFrame = id => frames.delete(id);
    window.CinemaChannel = { ...cinema, now: () => DAY + 12 * HOUR };
    const observers = [];
    if (options.observeSize) window.ResizeObserver = class {
        constructor(callback) { this.callback = callback; observers.push(this); }
        observe(target) { this.target = target; }
        disconnect() { this.disconnected = true; }
    };
    const byId = id => window.document.getElementById(id);
    Object.defineProperty(byId('livePlannerCanvas'), 'clientWidth', { configurable: true,
        get: () => options.dynamicWidth ? Number.parseFloat(byId('livePlannerCanvas').style.width) || 2352 : 2400 });
    Object.defineProperty(byId('livePlannerScroll'), 'clientWidth', { configurable: true, get: () => options.viewportWidth || 2400 });
    byId('livePlannerOverviewTrack').getBoundingClientRect = () => ({ left: 100, right: 1100, width: 1000 });
    byId('livePlannerScroll').getBoundingClientRect = () => ({ left: 0, right: 2400, width: 2400, top: 0, bottom: 100, height: 100 });
    window.eval(sortCode);
    window.eval(pickerCode);
    window.eval(plannerCode);
    const changes = [], statuses = [], selections = [], adds = [];
    const planner = new window.LiveSchedulePlanner({
        DatePicker: window.CustomDatePicker,
        onSelect: item => selections.push(item), onAdd: () => adds.push(true),
        onRemove: options.onRemove || (async () => true), onRange: () => {},
        onStatus: (message, tone) => statuses.push({ message, tone }),
        onChange: async (item, start, end) => {
            changes.push({ item, startMs: start.getTime(), endMs: end.getTime() });
            if (options.onChange) return options.onChange(item, start, end);
            return { ...item, startedAtMs: start.getTime(), endsAtMs: end.getTime(), updatedAtMs: item.updatedAtMs + 1 };
        }
    });
    const flushFrame = () => {
        const pending = [...frames.values()]; frames.clear();
        for (const callback of pending) callback(window.performance.now());
    };
    const pointer = (target, type, x, button = 0) => {
        const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, button });
        Object.defineProperty(event, 'pointerId', { value: 1 });
        target.dispatchEvent(event);
    };
    const startDrag = (id, x) => {
        const block = window.document.querySelector(`.live-planner__block[data-id="${id}"]`);
        assert.ok(block, `rendered block ${id}`);
        pointer(block, 'pointerdown', x);
    };
    return {
        dom, window, planner, byId, changes, statuses, selections, adds, observers,
        startDrag, flushFrame,
        move(x, flush = true) { pointer(window.document, 'pointermove', x); if (flush) flushFrame(); },
        async drop(x, type = 'pointerup') { pointer(window.document, type, x); await settle(); },
        input(id, value) { byId(id).value = value; byId(id).dispatchEvent(new window.Event('input', { bubbles: true })); },
        close() { planner.destroy(); dom.window.close(); }
    };
}

test('local day boundaries and wall-time ranges honor 23/25-hour New York DST days', () => {
    const script = `
        const { dayBounds, dateKey, timeInput, rangeFromInputs } = require(${JSON.stringify(plannerPath)});
        const spring = new Date(2026, 2, 8, 12), fall = new Date(2026, 10, 1, 12);
        const hours = day => { const b = dayBounds(day); return (b.endMs-b.startMs)/3600000; };
        const range = rangeFromInputs(spring, '01:30', '03:30');
        let missing = false, invalid = false;
        try { rangeFromInputs(spring, '02:30', '03:30'); } catch { missing = true; }
        try { rangeFromInputs(new Date(NaN), '01:00', '02:00'); } catch { invalid = true; }
        const midnight = new Date(dayBounds(spring).startMs);
        process.stdout.write(JSON.stringify({ zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          spring: hours(spring), fall: hours(fall), key: dateKey(spring), time: timeInput(new Date(2026,2,8,1,5)),
          midnightHour: midnight.getHours(), duration: (range.end-range.start)/3600000, missing, invalid }));
    `;
    const result = JSON.parse(execFileSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: 'America/New_York' }, encoding: 'utf8' }));
    assert.deepEqual(result, { zone: 'America/New_York', spring: 23, fall: 25, key: '2026-03-08', time: '01:05', midnightHour: 0, duration: 1, missing: true, invalid: true });
});

test('time input ranges cross midnight at 00:00 and reject invalid values', () => {
    const day = new Date(2026, 9, 25, 12);
    const overnight = helpers.rangeFromInputs(day, '23:00', '00:00');
    assert.equal(overnight.end.getDate(), 26);
    assert.equal(overnight.end - overnight.start, HOUR);
    const fullDay = helpers.rangeFromInputs(day, '12:00', '12:00');
    assert.equal(fullDay.end.getDate(), 26);
    for (const [start, end] of [['24:00', '01:00'], ['10:61', '11:00'], ['', '11:00'], ['9:00', '11:00'], ['10:00', 'wrong']]) {
        assert.throws(() => helpers.rangeFromInputs(day, start, end));
    }
});

test('overlap uses half-open intervals and ignores the selected entry', () => {
    const occupied = slot('one', 17, 18);
    assert.equal(helpers.overlaps(DAY + 16 * HOUR, DAY + 17 * HOUR, [occupied]), false);
    assert.equal(helpers.overlaps(DAY + 18 * HOUR, DAY + 19 * HOUR, [occupied]), false);
    assert.equal(helpers.overlaps(DAY + 17.5 * HOUR, DAY + 18.5 * HOUR, [occupied]), true);
    assert.equal(helpers.overlaps(occupied.startedAtMs, occupied.endsAtMs, [occupied], 'one'), false);
});

test('pointer can cross occupied 18/17 hours from 21 and save once after reaching free 15', async () => {
    const app = mount();
    try {
        const moving = slot('moving', 21, 22);
        app.planner.setItems([moving, slot('occupied', 17, 19)], null);
        app.startDrag('moving', 2100);
        assert.ok(app.planner.drag);
        app.move(1800);
        assert.equal(app.byId('liveSlotStart').value, '18:00');
        assert.equal(app.window.document.querySelector('[data-id="moving"]').classList.contains('is-overlap'), true);
        assert.equal(app.changes.length, 0, 'hovering over an occupied slot never saves');
        app.move(1700);
        assert.equal(app.byId('liveSlotStart').value, '17:00');
        assert.equal(app.changes.length, 0);
        app.move(1500);
        assert.equal(app.byId('liveSlotStart').value, '15:00');
        assert.equal(app.window.document.querySelector('[data-id="moving"]').classList.contains('is-overlap'), false);
        await app.drop(1500);
        assert.equal(app.changes.length, 1);
        assert.equal(app.changes[0].startMs, DAY + 15 * HOUR);
        assert.equal(app.changes[0].endMs, DAY + 16 * HOUR);
        assert.equal(app.planner.items.find(item => item.id === 'moving').startedAtMs, DAY + 15 * HOUR);
        assert.equal(app.planner.busy, false);
    } finally { app.close(); }
});

test('occupied drop restores original position and never calls the save callback', async () => {
    const app = mount();
    try {
        const moving = slot('moving', 21, 22);
        app.planner.setItems([moving, slot('occupied', 17, 19)], null);
        app.startDrag('moving', 2100); app.move(1800);
        await app.drop(1800);
        assert.equal(app.changes.length, 0);
        assert.equal(app.byId('liveSlotStart').value, '21:00');
        assert.equal(app.byId('liveSlotEnd').value, '22:00');
        assert.equal(app.planner.items[0].startedAtMs, moving.startedAtMs);
        assert.equal(app.planner.drag, null);
        assert.equal(app.planner.dirty, false);
        assert.match(app.statuses.at(-1).message, /Место занято/);
    } finally { app.close(); }
});

test('rejected save rolls back preview and releases busy state', async () => {
    const app = mount({ onChange: async () => { throw Object.assign(new Error('CONFLICT'), { code: 'cinema/stale' }); } });
    try {
        const moving = slot('moving', 21, 22);
        app.planner.setItems([moving], null);
        app.startDrag('moving', 2100); app.move(1500, false);
        await app.drop(1500);
        assert.equal(app.changes.length, 1, 'pointerup flushes its pending preview frame');
        assert.equal(app.byId('liveSlotStart').value, '21:00');
        assert.equal(app.byId('liveSlotEnd').value, '22:00');
        assert.equal(app.planner.items[0].startedAtMs, moving.startedAtMs);
        assert.equal(app.planner.busy, false);
        assert.equal(app.byId('livePlannerCanvas').getAttribute('aria-busy'), 'false');
        assert.match(app.statuses.at(-1).message, /другой вкладке/);
    } finally { app.close(); }
});

test('fresh snapshot changing an entry cancels its drag and adopts server bounds without saving', async () => {
    const app = mount();
    try {
        const moving = slot('moving', 21, 22);
        app.planner.setItems([moving], null);
        app.startDrag('moving', 2100); app.move(1500);
        const fresh = { ...moving, startedAtMs: DAY + 20 * HOUR, endsAtMs: DAY + 21 * HOUR, updatedAtMs: DAY + 1 };
        app.planner.setItems([fresh], null);
        assert.equal(app.planner.drag, null);
        assert.equal(app.byId('liveSlotStart').value, '20:00');
        assert.equal(app.planner.selected, fresh);
        await app.drop(1500);
        assert.equal(app.changes.length, 0);
        assert.match(app.statuses.at(-1).message, /Расписание изменилось/);
    } finally { app.close(); }
});

test('same-millisecond server revision change also cancels a stale drag', async () => {
    const app = mount();
    try {
        const moving = slot('moving', 21, 22);
        app.planner.setItems([moving], null);
        app.startDrag('moving', 2100); app.move(1500);
        const fresh = { ...moving, updatedAtVersion: `${DAY / 1000}:200` };
        app.planner.setItems([fresh], null);
        assert.equal(app.planner.drag, null, 'nanosecond-aware server version invalidates preview');
        await app.drop(1500);
        assert.equal(app.changes.length, 0);
    } finally { app.close(); }
});

test('pointercancel restores selection and blocks resize only from their right edge', async () => {
    const app = mount();
    try {
        const moving = slot('moving', 21, 22);
        app.planner.setItems([moving], null);
        app.startDrag('moving', 2100); app.move(1500);
        await app.drop(1500, 'pointercancel');
        assert.equal(app.changes.length, 0);
        assert.equal(app.byId('liveSlotStart').value, '21:00');
        app.planner.select(moving);
        assert.equal(app.window.document.querySelectorAll('[data-resize]').length, 1);
        assert.equal(app.window.document.querySelectorAll('[data-resize="end"]').length, 1, 'no left-edge handle');
    } finally { app.close(); }
});

test('a hidden pane opening fits the day grid without a window resize and disconnects its observer', () => {
    const app = mount({ observeSize: true });
    try {
        const observer = app.observers[0], scroll = app.byId('livePlannerScroll');
        assert.equal(observer.target, scroll);
        Object.defineProperty(scroll, 'clientWidth', { configurable: true, value: 0 });
        observer.callback();
        assert.equal(app.byId('livePlannerCanvas').style.width, '880px');
        Object.defineProperty(scroll, 'clientWidth', { configurable: true, value: 1700 });
        observer.callback();
        assert.equal(app.byId('livePlannerCanvas').style.width, '1652px');
        app.byId('livePlannerZoom').value = '12'; observer.callback();
        assert.equal(app.byId('livePlannerCanvas').style.width, '3304px');
        app.planner.destroy(); assert.equal(observer.disconnected, true);
    } finally { app.close(); }
});

test('new draft preserves source seconds, moves its end with the start, and a typed end sets its length', () => {
    const app = mount();
    try {
        app.planner.setDraft({ key: 'yt:one', mode: 'youtube', title: 'Video', durationSec: 3667 });
        assert.equal(app.planner.range.end - app.planner.range.start, 3667_000, 'no upward minute rounding');
        app.input('liveSlotStart', '15:00');
        assert.equal(app.planner.range.start.getTime(), DAY + 15 * HOUR);
        assert.equal(app.planner.range.end.getTime(), DAY + 15 * HOUR + 3667_000);
        assert.equal(app.byId('liveSlotEnd').readOnly, false);
        app.input('liveSlotEnd', '23:00');
        assert.equal(app.planner.range.end.getTime(), DAY + 23 * HOUR, 'the typed end sets the length');
        app.input('liveSlotStart', '16:00');
        assert.equal(app.planner.range.end.getTime(), DAY + 24 * HOUR, 'a moved start keeps the typed length');
        app.planner.setDraft({ key: 'yt:one', mode: 'youtube', title: 'Video', durationSec: 3700 });
        assert.equal(app.planner.range.end.getTime(), DAY + 24 * HOUR, 'a late length of the same source keeps the typed end');
        app.input('liveSlotEnd', '01:30');
        assert.equal(app.planner.range.end.getTime(), DAY + 25.5 * HOUR, 'an earlier clock time is the next day');
        app.input('liveSlotEnd', '16:03');
        assert.throws(() => app.planner.range, /хотя бы 5 минут/);
        app.input('liveSlotEnd', '9:5');
        assert.throws(() => app.planner.range, /ЧЧ:ММ/);
        app.planner.setDraft({ key: 'yt:two', mode: 'youtube', title: 'Other', durationSec: 600 });
        assert.equal(app.planner.range.end - app.planner.range.start, 600_000, 'another source starts from its own length');
        assert.equal(app.changes.length, 0, 'metadata only fills the form; it does not save');
    } finally { app.close(); }
});

test('late source length fills the draft end without resetting the chosen start', () => {
    const app = mount();
    try {
        app.planner.setDraft({ key: 'yt:one', mode: 'youtube', title: 'Video', durationSec: 0 });
        app.input('liveSlotStart', '15:00');
        app.planner.setDraft({ key: 'yt:one', mode: 'youtube', title: 'Video', durationSec: 97 });
        assert.equal(app.planner.range.start.getTime(), DAY + 15 * HOUR);
        assert.equal(app.planner.range.end.getTime(), DAY + 15 * HOUR + 97_000);
        app.planner.setDraft({ key: 'yt:one', mode: 'youtube', title: 'Video', durationSec: 121 });
        assert.equal(app.planner.range.start.getTime(), DAY + 15 * HOUR);
        assert.equal(app.planner.range.end.getTime(), DAY + 15 * HOUR + 121_000);
    } finally { app.close(); }
});

test('keyboard moves both boundaries by five minutes or fifteen with Shift and preserves legacy exact length', async () => {
    const app = mount();
    try {
        const moving = slot('legacy', 21, 22, { endsAtMs: DAY + 22 * HOUR + 17_000, movie: { kinopoiskId: 301, durationSec: 7200 } });
        app.planner.setItems([moving], null);
        const key = (name, shiftKey) => app.window.document.querySelector('[data-id="legacy"]').dispatchEvent(new app.window.KeyboardEvent('keydown', { key: name, shiftKey, bubbles: true }));
        key('ArrowLeft', false); await settle();
        assert.equal(app.changes[0].startMs, moving.startedAtMs - 5 * 60_000);
        assert.equal(app.changes[0].endMs, moving.endsAtMs - 5 * 60_000);
        key('ArrowRight', true); await settle();
        assert.equal(app.changes[1].startMs, moving.startedAtMs + 10 * 60_000);
        assert.equal(app.changes[1].endMs, moving.endsAtMs + 10 * 60_000);
        assert.equal(app.changes[1].endMs - app.changes[1].startMs, HOUR + 17_000, 'existing slot length differs from metadata and remains exact');
    } finally { app.close(); }
});

test('dragging the right edge resizes only the end, snaps to five minutes and stops at the next show', async () => {
    const app = mount();
    try {
        app.planner.setItems([slot('show', 21, 22), slot('next', 23, 24)], null);
        const handle = () => app.window.document.querySelector('[data-id="show"] [data-resize="end"]');
        const press = x => {
            const event = new app.window.MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x, button: 0 });
            Object.defineProperty(event, 'pointerId', { value: 1 });
            handle().dispatchEvent(event);
        };
        press(2200);
        assert.equal(app.planner.drag.mode, 'resize');
        app.move(2251);
        assert.equal(app.byId('liveSlotStart').value, '21:00', 'the start never moves');
        assert.equal(app.byId('liveSlotEnd').value, '22:30');
        app.move(2600);
        assert.equal(app.byId('liveSlotEnd').value, '23:00', 'the end stops at the next show');
        assert.equal(app.window.document.querySelector('[data-id="show"]').classList.contains('is-overlap'), false);
        await app.drop(2600);
        assert.equal(app.changes.length, 1);
        assert.equal(app.changes[0].startMs, DAY + 21 * HOUR);
        assert.equal(app.changes[0].endMs, DAY + 23 * HOUR);

        press(2300); app.move(1000);
        assert.equal(app.byId('liveSlotEnd').value, '21:05', 'a show keeps at least five minutes');
        await app.drop(1000);
        assert.equal(app.changes.at(-1).endMs, DAY + 21 * HOUR + 5 * 60_000);

        press(2105); app.move(2106);
        await app.drop(2106);
        assert.equal(app.changes.length, 2, 'a click on the edge without moving saves nothing');
    } finally { app.close(); }
});

test('Alt+arrows change only the end; a typed end on a saved show is applied and overlaps are refused', async () => {
    const app = mount();
    try {
        app.planner.setItems([slot('show', 21, 22), slot('next', 23, 24)], null);
        const key = (name, extra) => app.window.document.querySelector('[data-id="show"]')
            .dispatchEvent(new app.window.KeyboardEvent('keydown', { key: name, bubbles: true, ...extra }));
        key('ArrowRight', { altKey: true }); await settle();
        assert.equal(app.changes[0].startMs, DAY + 21 * HOUR);
        assert.equal(app.changes[0].endMs, DAY + 22 * HOUR + 5 * 60_000);
        key('ArrowLeft', { altKey: true, shiftKey: true }); await settle();
        assert.equal(app.changes[1].endMs, DAY + 22 * HOUR - 10 * 60_000);

        const saved = app.planner.items.find(item => item.id === 'show');
        app.planner.select(saved);
        app.input('liveSlotEnd', '23:30');
        assert.equal(app.planner.dirty, true);
        await app.planner.saveSlot(saved, app.planner.range.start, app.planner.range.end);
        assert.equal(app.changes.length, 2, 'an overlapping end is refused before saving');
        assert.match(app.statuses.at(-1).message, /Место занято/);
        assert.equal(app.byId('liveSlotEnd').value, '21:50', 'the form returns to the saved end');
    } finally { app.close(); }
});

test('the on-air block follows its playback clock; it is resized, never moved, and slides while paused', async () => {
    const app = mount();
    try {
        const block = id => app.window.document.querySelector(`.live-planner__block[data-id="${id}"]`);
        const left = id => Number.parseFloat(block(id).style.left);
        const live = slot('live', 11, 13, { playbackStartedAtMs: DAY + 10 * HOUR });
        app.planner.setItems([live, slot('next', 14, 15)], live);
        assert.ok(Math.abs(left('live') - 10 / 24 * 100) < 0.01, 'a seek one hour ahead draws the show from 10:00');
        assert.equal(block('live').querySelector('.live-planner__time').textContent, '10:00 — 13:00');
        assert.equal(block('live').classList.contains('is-live'), true);
        app.startDrag('live', 1100);
        assert.equal(app.planner.drag, null, 'the running show is not moved');
        assert.match(app.statuses.at(-1).message, /перематывайте его в плеере/);
        const press = x => {
            const event = new app.window.MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x, button: 0 });
            Object.defineProperty(event, 'pointerId', { value: 1 });
            block('live').querySelector('[data-resize="end"]').dispatchEvent(event);
        };
        press(1300); app.move(1450);
        assert.equal(app.byId('liveSlotEnd').value, '14:00', 'the end stops at the next show');
        await app.drop(1450);
        assert.equal(app.changes.length, 1);
        assert.equal(app.changes[0].startMs, DAY + 11 * HOUR, 'the grid start is never touched');
        assert.equal(app.changes[0].endMs, DAY + 14 * HOUR);
        press(1400); app.move(0);
        assert.equal(app.byId('liveSlotEnd').value, '12:05', 'a drag never ends the running show in the past');
        await app.drop(0);

        const paused = slot('paused', 11, 13, { movie: { kinopoiskId: 301, durationSec: 7200, posterUrl: '', pausedAtSec: 1800 } });
        app.planner.setItems([paused], paused);
        assert.ok(Math.abs(left('paused') - 11.5 / 24 * 100) < 0.01, 'paused at 30 minutes: drawn from 11:30');
        assert.equal(block('paused').querySelector('[data-resize]'), null, 'a paused show is resized from the end field');
        app.window.CinemaChannel.now = () => DAY + 12 * HOUR + 10 * 60_000;
        app.planner.tick();
        assert.ok(Math.abs(left('paused') - (11.5 + 10 / 60) / 24 * 100) < 0.01, 'the paused block slides with the clock');
    } finally { app.close(); }
});

test('a running show is edited on its playback clock: the end is set from where the film began', async () => {
    const app = mount();
    try {
        // Grid 11:00-13:00, seeked so the film began at 10:00; now is 12:00.
        const live = slot('live', 11, 13, { playbackStartedAtMs: DAY + 10 * HOUR });
        app.planner.setItems([live], live);
        app.planner.select(live);
        assert.equal(app.byId('liveSlotStart').value, '10:00', 'the start is where the film began');
        assert.equal(app.byId('liveSlotStart').readOnly, true);
        assert.equal(app.byId('liveSlotEnd').value, '13:00');
        app.input('liveSlotEnd', '12:15');
        assert.equal(app.byId('liveSlotDuration').textContent, '2 ч 15 мин', 'the length counts from the playback start');
        await app.planner.saveSelection();
        assert.equal(app.changes.length, 1);
        assert.equal(app.changes[0].startMs, DAY + 11 * HOUR, 'the grid start is kept');
        assert.equal(app.changes[0].endMs, DAY + 12 * HOUR + 15 * 60_000, 'the end is exactly what the admin typed');

        // A far seek: the wanted end falls before the grid start.
        const far = slot('far', 11, 13, { playbackStartedAtMs: DAY + 9 * HOUR });
        app.window.CinemaChannel.now = () => DAY + 11 * HOUR + 5 * 60_000;
        app.planner.setItems([far], far);
        app.planner.select(far);
        app.input('liveSlotEnd', '10:55');
        const options = [];
        app.planner.onChange = async (item, start, end, extra) => { options.push({ start: start.getTime(), end: end.getTime(), extra }); return { ...item, startedAtMs: start.getTime(), endsAtMs: end.getTime() }; };
        await app.planner.saveSelection();
        assert.equal(options[0].start, DAY + 9 * HOUR, 'the grid starts where the film began');
        assert.equal(options[0].end, DAY + 10 * HOUR + 55 * 60_000);
        assert.equal(options[0].extra.keepPlayback, true, 'the playback clock is not moved');
    } finally { app.close(); }
});

test('endAfter reads the end on the clock after the start, across midnight', () => {
    const start = new Date(DAY + 23 * HOUR);
    assert.equal(helpers.endAfter(start, '23:30').getTime(), DAY + 23.5 * HOUR);
    assert.equal(helpers.endAfter(start, '01:00').getTime(), DAY + 25 * HOUR);
    assert.equal(helpers.endAfter(start, '23:00').getTime(), DAY + 47 * HOUR, 'the same clock time is a full day later');
});

test('saveRange preserves stored duration and ignores an obsolete third end argument', async () => {
    const app = mount();
    try {
        const moving = slot('legacy', 21, 22, { endsAtMs: DAY + 22 * HOUR + 17_000 });
        app.planner.setItems([moving], null); app.planner.select(moving);
        await app.planner.saveRange(moving, new app.window.Date(DAY + 15 * HOUR), new app.window.Date(DAY + 19 * HOUR));
        assert.equal(app.changes.length, 1);
        assert.equal(app.changes[0].endMs - app.changes[0].startMs, HOUR + 17_000);
        assert.equal(app.changes[0].endMs, DAY + 16 * HOUR + 17_000);
    } finally { app.close(); }
});

test('real custom date picker and zoom controls synchronize the day grid', async () => {
    const app = mount();
    try {
        const host = app.byId('livePlannerDatePicker');
        const dateTrigger = host.querySelector('.custom-picker-trigger');
        assert.ok(dateTrigger, 'planner instantiates the actual CustomDatePicker');
        assert.equal(app.byId('livePlannerDate').type, 'hidden');
        dateTrigger.getBoundingClientRect = () => ({ left: 100, top: 100, right: 300, bottom: 140, width: 200, height: 40 });
        dateTrigger.click();
        assert.equal(dateTrigger.getAttribute('aria-expanded'), 'true');
        app.window.document.querySelector('#livePlannerCalendar [data-year="2026"][data-month="9"][data-day="26"]').click();
        assert.equal(app.byId('livePlannerDate').value, '2026-10-26');
        assert.equal(helpers.dateKey(app.planner.date), '2026-10-26');
        const select = app.byId('livePlannerZoom');
        assert.equal(select.hidden, true, 'native zoom is a hidden data source');
        const enhanced = app.window.SortControl.instances.get(select);
        assert.ok(enhanced);
        enhanced.trigger.click();
        enhanced.list.querySelector('[role="option"][data-index="1"]').click();
        assert.equal(select.value, '12');
        assert.equal(enhanced.valueLabel.textContent, '12 часов');
        assert.equal(app.byId('livePlannerCanvas').style.width, '4704px');
        await settle();
    } finally { app.close(); }
});

test('three-hour zoom and the full-day overview synchronize scrolling, keyboard and schedule thumbnails without writes', () => {
    const app = mount({ dynamicWidth: true });
    try {
        const select = app.byId('livePlannerZoom'), viewport = app.byId('livePlannerViewport');
        const scroll = app.byId('livePlannerScroll'), canvas = app.byId('livePlannerCanvas');
        app.planner.setItems([slot('one', 18, 19), slot('two', 21, 23)], null);
        assert.equal(app.byId('livePlannerOverviewBlocks').children.length, 2);
        assert.equal(app.byId('livePlannerOverviewHours').children.length, 13);
        assert.equal(viewport.style.width, '100%');
        select.value = '3'; select.dispatchEvent(new app.window.Event('change'));
        assert.equal(canvas.style.width, '18816px');
        assert.equal(viewport.style.width, '12.5%');
        scroll.scrollLeft = canvas.clientWidth / 4;
        scroll.dispatchEvent(new app.window.Event('scroll'));
        assert.equal(app.byId('livePlannerViewRange').textContent, 'На дорожке: 06:00–09:00');
        const key = name => viewport.dispatchEvent(new app.window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
        key('End'); assert.equal(viewport.getAttribute('aria-valuetext'), '21:00–24:00');
        assert.equal(viewport.getAttribute('aria-valuenow'), '1260');
        key('ArrowLeft'); assert.equal(viewport.getAttribute('aria-valuetext'), '20:45–23:45');
        key('Home'); assert.equal(viewport.getAttribute('aria-valuetext'), '00:00–03:00');
        app.planner.setBusy(true); key('End');
        assert.equal(viewport.getAttribute('aria-disabled'), 'true');
        assert.equal(viewport.getAttribute('aria-valuenow'), '0');
        assert.equal(app.changes.length, 0);
    } finally { app.close(); }
});

test('overview click and drag pan across the day, clamp edges and cancel without changing the selected screening', async () => {
    const app = mount({ dynamicWidth: true });
    try {
        const item = slot('one', 18, 19); app.planner.setItems([item], null); app.planner.select(item);
        const select = app.byId('livePlannerZoom'), track = app.byId('livePlannerOverviewTrack'), viewport = app.byId('livePlannerViewport');
        select.value = '3'; select.dispatchEvent(new app.window.Event('change'));
        const down = (target, x) => target.dispatchEvent(new app.window.MouseEvent('pointerdown', { button: 0, clientX: x, bubbles: true, cancelable: true }));
        down(track, 600); await app.drop(600);
        assert.equal(viewport.getAttribute('aria-valuetext'), '10:30–13:30');
        const original = app.byId('livePlannerScroll').scrollLeft;
        down(viewport, 600); app.move(50);
        assert.equal(viewport.getAttribute('aria-valuetext'), '00:00–03:00');
        await app.drop(50, 'pointercancel');
        assert.equal(app.byId('livePlannerScroll').scrollLeft, original);
        down(viewport, 600); app.move(1500); await app.drop(1500);
        assert.equal(viewport.getAttribute('aria-valuetext'), '21:00–24:00');
        assert.equal(app.planner.selected, item);
        assert.equal(app.planner.range.start.getTime(), item.startedAtMs);
        assert.equal(app.changes.length, 0, 'overview navigation never writes or retimes shows');
    } finally { app.close(); }
});

test('zoom uses the actual narrow viewport and keeps an exact three-hour window instead of stretching it', () => {
    const app = mount({ dynamicWidth: true, viewportWidth: 360 });
    try {
        assert.equal(app.byId('livePlannerCanvas').style.width, '312px');
        assert.equal(app.byId('livePlannerViewport').style.width, '100%');
        const select = app.byId('livePlannerZoom'); select.value = '3'; select.dispatchEvent(new app.window.Event('change'));
        assert.equal(app.byId('livePlannerCanvas').style.width, '2496px');
        assert.equal(app.byId('livePlannerViewport').style.width, '12.5%');
        assert.equal(app.byId('livePlannerViewport').getAttribute('aria-valuetext'), '10:30–13:30');
        assert.equal(app.changes.length, 0);
    } finally { app.close(); }
});
