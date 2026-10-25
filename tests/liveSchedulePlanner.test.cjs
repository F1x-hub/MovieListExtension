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
    <select id="livePlannerZoom"><option value="24" selected>24 часа</option><option value="12">12 часов</option></select>
    <div id="livePlannerScroll"><div id="livePlannerCanvas"><div id="livePlannerRuler"></div>
      <div id="livePlannerTrack"></div><div id="livePlannerLine"><span></span></div>
    </div></div>
    <span id="livePlannerStats"></span><button id="livePlannerAdd">Добавить</button>
    <aside><img id="liveSelectedPoster"><strong id="liveSelectedName"></strong><span id="liveSelectedMeta"></span>
      <span id="liveSelectionBadge"></span><input id="liveSlotStart" type="time" step="1"><input id="liveSlotEnd" type="time" step="1" readonly>
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
    Object.defineProperty(byId('livePlannerCanvas'), 'clientWidth', { configurable: true, get: () => 2400 });
    Object.defineProperty(byId('livePlannerScroll'), 'clientWidth', { configurable: true, get: () => 2400 });
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

test('pointercancel restores selection and selected blocks offer no resize handles', async () => {
    const app = mount();
    try {
        const moving = slot('moving', 21, 22);
        app.planner.setItems([moving], null);
        app.startDrag('moving', 2100); app.move(1500);
        await app.drop(1500, 'pointercancel');
        assert.equal(app.changes.length, 0);
        assert.equal(app.byId('liveSlotStart').value, '21:00');
        app.planner.select(moving);
        assert.equal(app.window.document.querySelectorAll('[data-handle], .live-planner__handle').length, 0);
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

test('new draft preserves source seconds, moves its end with the start, and ignores the readonly end input', () => {
    const app = mount();
    try {
        app.planner.setDraft({ key: 'yt:one', mode: 'youtube', title: 'Video', durationSec: 3667 });
        assert.equal(app.planner.range.end - app.planner.range.start, 3667_000, 'no upward minute rounding');
        app.input('liveSlotStart', '15:00');
        assert.equal(app.planner.range.start.getTime(), DAY + 15 * HOUR);
        assert.equal(app.planner.range.end.getTime(), DAY + 15 * HOUR + 3667_000);
        assert.equal(app.byId('liveSlotEnd').readOnly, true);
        app.input('liveSlotEnd', '23:00');
        assert.equal(app.planner.range.end.getTime(), DAY + 15 * HOUR + 3667_000, 'end input cannot resize the computed range');
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
        app.input('liveSlotEnd', '23:00');
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
