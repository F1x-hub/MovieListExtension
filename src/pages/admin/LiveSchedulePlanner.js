/** Day-grid editor. Slot changes are saved only after a valid drop or form submit. */
(function () {
    'use strict';
    const STEP_MS = 5 * 60_000;
    const pad = value => String(value).padStart(2, '0');
    const dateKey = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const timeInput = date => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    function dayBounds(date) {
        const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
        return { startMs: start.getTime(), endMs: end.getTime() };
    }
    function localTime(day, value) {
        if (!/^\d{2}:\d{2}$/.test(value)) throw new Error('Укажите начало и конец показа.');
        const [hour, minute] = value.split(':').map(Number);
        if (hour > 23 || minute > 59) throw new Error('Укажите корректное время.');
        const result = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);
        if (result.getHours() !== hour || result.getMinutes() !== minute) throw new Error('Этого времени нет в выбранном часовом поясе.');
        return result;
    }
    function rangeFromInputs(day, startText, endText) {
        const start = localTime(day, startText);
        const endDay = new Date(day.getFullYear(), day.getMonth(), day.getDate() + (endText <= startText ? 1 : 0));
        return { start, end: localTime(endDay, endText) };
    }
    function boundsFor(item) {
        if (typeof window !== 'undefined' && window.CinemaChannel?.getScheduleBounds) return window.CinemaChannel.getScheduleBounds(item);
        return { startMs: item.startedAtMs, endMs: item.endsAtMs };
    }
    function overlaps(startMs, endMs, items, ignoreId) {
        return items.some(item => {
            const bounds = boundsFor(item);
            return item.id !== ignoreId && startMs < bounds.endMs && endMs > bounds.startMs;
        });
    }
    const signature = item => item ? [item.id, item.startedAtMs, item.endsAtMs, item.updatedAtMs, item.updatedAtVersion].join('|') : '';

    class LiveSchedulePlanner {
        constructor({ onSelect, onAdd, onChange, onRemove, onRange, onStatus }) {
            this.onSelect = onSelect; this.onAdd = onAdd; this.onChange = onChange;
            this.onRemove = onRemove; this.onRange = onRange; this.onStatus = onStatus;
            this.items = []; this.selected = null; this.source = null; this.busy = false;
            this.date = new Date(window.CinemaChannel.now()); this.endTouched = false;
            this.drag = null; this.frame = null; this.dirty = false;
            const $ = id => document.getElementById(id);
            this.ui = Object.fromEntries(['livePlannerDate', 'livePlannerPrev', 'livePlannerNext', 'livePlannerToday',
                'livePlannerNow', 'livePlannerZoom', 'livePlannerScroll', 'livePlannerCanvas', 'livePlannerRuler',
                'livePlannerTrack', 'livePlannerLine', 'livePlannerStats', 'livePlannerAdd', 'liveSlotStart',
                'liveSlotEnd', 'liveSlotDuration', 'liveSlotNote', 'liveSelectedPoster', 'liveSelectedName',
                'liveSelectedMeta', 'liveDeleteShowBtn', 'liveSelectionBadge', 'livePlannerTimezone']
                .map(id => [id.replace(/^live/, ''), $(id)]));
            this.ui.PlannerDate.value = dateKey(this.date);
            if (window.Icons) {
                this.ui.PlannerPrev.innerHTML = window.Icons.CHEVRON_LEFT;
                this.ui.PlannerNext.innerHTML = window.Icons.CHEVRON_RIGHT;
            }
            const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            this.ui.PlannerTimezone.textContent = `Ваше время · ${zone}`;
            this.ui.PlannerPrev.addEventListener('click', () => this.changeDay(-1));
            this.ui.PlannerNext.addEventListener('click', () => this.changeDay(1));
            this.ui.PlannerToday.addEventListener('click', () => this.setDay(new Date(window.CinemaChannel.now())));
            this.ui.PlannerDate.addEventListener('change', () => {
                const value = this.ui.PlannerDate.value;
                if (/^\d{4}-\d{2}-\d{2}$/.test(value)) this.setDay(new Date(`${value}T12:00:00`));
            });
            this.ui.PlannerNow.addEventListener('click', () => {
                this.setDay(new Date(window.CinemaChannel.now()));
                const day = dayBounds(this.date);
                this.ui.PlannerScroll.scrollLeft = (window.CinemaChannel.now() - day.startMs) / (day.endMs - day.startMs)
                    * this.ui.PlannerCanvas.clientWidth - this.ui.PlannerScroll.clientWidth / 2;
            });
            this.ui.PlannerZoom.addEventListener('change', () => this.zoom(true));
            this.ui.PlannerAdd.addEventListener('click', () => { this.beginDraft(); this.onAdd?.(); });
            for (const input of [this.ui.SlotStart, this.ui.SlotEnd]) input.addEventListener('input', () => {
                this.dirty = true;
                if (input === this.ui.SlotEnd) this.endTouched = true;
                this.renderNote(); this.onRange?.();
            });
            this.ui.DeleteShowBtn.addEventListener('click', () => this.remove());
            this.ui.PlannerTrack.addEventListener('pointerdown', event => this.startDrag(event));
            this.ui.PlannerTrack.addEventListener('keydown', event => this.keyMove(event));
            this.moveListener = event => this.queueMove(event);
            this.finishListener = event => this.finishDrag(event);
            document.addEventListener('pointermove', this.moveListener);
            document.addEventListener('pointerup', this.finishListener);
            document.addEventListener('pointercancel', this.finishListener);
            this.resizeListener = () => this.zoom(false);
            window.addEventListener('resize', this.resizeListener);
            window.addEventListener('pagehide', () => this.destroy(), { once: true });
            this.beginDraft(); this.render(); this.zoom(false);
        }
        get range() {
            const result = rangeFromInputs(this.date, this.ui.SlotStart.value, this.ui.SlotEnd.value);
            // Preserve seconds and an ambiguous DST occurrence on untouched legacy entries.
            if (this.selected && !this.dirty) {
                const bounds = boundsFor(this.selected);
                return { start: new Date(bounds.startMs), end: new Date(bounds.endMs) };
            }
            return result;
        }
        setBusy(value) {
            this.busy = value;
            this.ui.PlannerCanvas.setAttribute('aria-busy', String(value));
            this.ui.DeleteShowBtn.disabled = value;
            for (const key of ['PlannerDate', 'PlannerPrev', 'PlannerNext', 'PlannerToday', 'PlannerNow', 'PlannerAdd', 'SlotStart', 'SlotEnd']) this.ui[key].disabled = value;
        }
        setItems(items, current) {
            this.current = current;
            if (this.drag) {
                const fresh = items.find(item => item.id === this.drag.item.id);
                if (signature(fresh) !== signature(this.drag.item)) this.cancelDrag('Расписание изменилось. Повторите перенос.');
            }
            this.items = items;
            if (this.selected && !this.drag && !this.dirty && !this.busy) {
                const fresh = items.find(item => item.id === this.selected.id);
                if (fresh) { this.selected = fresh; this.fillRange(fresh); }
                else this.beginDraft();
            }
            this.render();
        }
        setDay(date) {
            if (this.busy) return;
            this.cancelDrag(); this.date = date;
            this.ui.PlannerDate.value = dateKey(date);
            this.beginDraft(); this.render(); this.zoom(false);
        }
        changeDay(delta) { this.setDay(new Date(this.date.getFullYear(), this.date.getMonth(), this.date.getDate() + delta)); }
        beginDraft(atMs) {
            this.selected = null; this.dirty = false; this.endTouched = false;
            const day = dayBounds(this.date);
            let start = Number.isFinite(atMs) ? atMs : Math.max(day.startMs, Math.ceil(window.CinemaChannel.now() / STEP_MS) * STEP_MS);
            if (start >= day.endMs) start = day.startMs;
            const length = Math.ceil((this.source?.durationSec || 3600) / 60) * 60_000;
            if (!Number.isFinite(atMs)) {
                for (const item of [...this.items].sort((a, b) => a.startedAtMs - b.startedAtMs)) {
                    const bounds = boundsFor(item);
                    if (start < bounds.endMs && start + length > bounds.startMs) start = bounds.endMs;
                }
                if (start >= day.endMs) start = day.startMs;
            }
            this.ui.SlotStart.value = timeInput(new Date(start));
            this.ui.SlotEnd.value = timeInput(new Date(start + length));
            this.renderSelection(); this.renderTrack(); this.onSelect?.(null); this.onRange?.();
        }
        setDraft(source) {
            const same = this.source?.key === source?.key && !this.selected;
            this.source = source;
            if (!same) this.beginDraft();
            else if (!this.endTouched && source?.durationSec) {
                try { this.ui.SlotEnd.value = timeInput(new Date(this.range.start.getTime() + Math.ceil(source.durationSec / 60) * 60_000)); } catch { /* incomplete time input */ }
            }
            this.renderSelection(); this.onRange?.();
        }
        fillRange(item) {
            const bounds = boundsFor(item);
            this.ui.SlotStart.value = timeInput(new Date(bounds.startMs));
            this.ui.SlotEnd.value = timeInput(new Date(bounds.endMs));
        }
        select(item) {
            if (this.busy) return;
            this.selected = item; this.dirty = false; this.endTouched = false;
            this.source = { key: `${item.mode}:${item.id}`, mode: item.mode, title: item.title,
                cover: window.CinemaChannel.coverUrl(item), durationSec: item[item.mode]?.durationSec || 0 };
            this.date = new Date(item.startedAtMs); this.ui.PlannerDate.value = dateKey(this.date);
            this.fillRange(item); this.render(); this.onSelect?.(item); this.onRange?.();
        }
        renderSelection() {
            const item = this.selected;
            const media = item ? { title: item.title, cover: window.CinemaChannel.coverUrl(item),
                durationSec: item[item.mode]?.durationSec || 0, mode: item.mode } : this.source;
            this.ui.SelectedName.textContent = media?.title || 'Выберите передачу слева';
            this.ui.SelectedMeta.textContent = media ? `${media.mode === 'movie' ? 'Фильм' : 'YouTube'}${media.durationSec ? ` · ${window.CinemaChannel.formatClock(media.durationSec)}` : ' · длительность не определена'}` : 'Фильм из каталога или видео YouTube';
            this.ui.SelectedPoster.hidden = !media?.cover;
            if (media?.cover) this.ui.SelectedPoster.src = media.cover;
            this.ui.SelectionBadge.textContent = item ? 'В расписании' : 'Новый показ';
            this.ui.DeleteShowBtn.hidden = !item;
            this.renderNote();
        }
        renderNote() {
            try {
                const { start, end } = this.range;
                const minutes = Math.round((end - start) / 60_000);
                const length = this.selected?.[this.selected.mode]?.durationSec || this.source?.durationSec || 0;
                this.ui.SlotDuration.textContent = `${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)} ч ` : ''}${minutes % 60} мин`;
                this.ui.SlotNote.textContent = length > 0 && end - start < length * 1000
                    ? 'Показ прервётся в конце диапазона. Скорость видео не меняется.'
                    : length > 0 && end - start > length * 1000 + 59_000
                        ? 'После окончания видео будет заставка до следующего показа. Скорость видео не меняется.'
                        : 'Передачи начинаются по программе. В свободных промежутках — заставка канала.';
            } catch (error) { this.ui.SlotDuration.textContent = '—'; this.ui.SlotNote.textContent = error.message; }
        }
        zoom(focus) {
            const width = Math.max(880, this.ui.PlannerScroll.clientWidth - 48);
            const scale = 24 / Number(this.ui.PlannerZoom.value);
            this.ui.PlannerCanvas.style.width = `${Math.round(width * scale)}px`;
            if (scale === 1) this.ui.PlannerScroll.scrollLeft = 0;
            else if (focus) {
                const day = dayBounds(this.date);
                const anchor = this.selected ? this.selected.startedAtMs : window.CinemaChannel.now();
                this.ui.PlannerScroll.scrollLeft = (anchor - day.startMs) / (day.endMs - day.startMs)
                    * this.ui.PlannerCanvas.clientWidth - this.ui.PlannerScroll.clientWidth / 2;
            }
        }
        render() { this.renderRuler(); this.renderTrack(); this.renderSelection(); this.tick(); }
        renderRuler() {
            const day = dayBounds(this.date), span = day.endMs - day.startMs;
            this.ui.PlannerRuler.replaceChildren();
            for (let at = day.startMs; at <= day.endMs; at += 15 * 60_000) {
                const date = new Date(at), tick = document.createElement('span');
                tick.className = 'live-planner__tick'; tick.style.left = `${(at - day.startMs) / span * 100}%`;
                if (date.getMinutes() === 0 || at === day.endMs) {
                    tick.classList.add('is-hour');
                    const label = document.createElement('span'); label.textContent = at === day.endMs ? '24:00' : timeInput(date);
                    label.title = date.toLocaleString(); tick.append(label);
                }
                this.ui.PlannerRuler.append(tick);
            }
        }
        renderTrack() {
            const day = dayBounds(this.date), span = day.endMs - day.startMs;
            const entries = this.items.map(item => this.drag?.item.id === item.id
                ? { ...item, startedAtMs: this.drag.start, endsAtMs: this.drag.end } : item)
                .filter(item => { const b = boundsFor(item); return b.startMs < day.endMs && b.endMs > day.startMs; })
                .sort((a, b) => a.startedAtMs - b.startedAtMs);
            const track = this.ui.PlannerTrack; track.replaceChildren(); let edge = day.startMs;
            const gap = (start, end) => {
                if (end - start < 10 * 60_000) return;
                const button = document.createElement('button'); button.type = 'button'; button.className = 'live-planner__gap';
                button.style.left = `${(start - day.startMs) / span * 100}%`; button.style.width = `${(end - start) / span * 100}%`;
                button.setAttribute('aria-label', `Добавить показ с ${timeInput(new Date(start))} до ${end === day.endMs ? '24:00' : timeInput(new Date(end))}`);
                if (end - start >= 40 * 60_000) button.textContent = '+ Добавить';
                button.disabled = this.busy;
                button.addEventListener('click', () => { this.beginDraft(start); this.onAdd?.(); }); track.append(button);
            };
            for (const item of entries) {
                const b = boundsFor(item), start = Math.max(day.startMs, b.startMs), end = Math.min(day.endMs, b.endMs);
                gap(edge, start); edge = Math.max(edge, end);
                const block = document.createElement('div'); block.className = 'live-planner__block'; block.dataset.id = item.id;
                block.tabIndex = 0; block.setAttribute('role', 'button'); block.setAttribute('aria-pressed', String(this.selected?.id === item.id));
                block.classList.toggle('is-selected', this.selected?.id === item.id);
                block.classList.toggle('is-live', this.current?.id === item.id && window.CinemaChannel.computePosition(this.current).state !== 'ended');
                block.style.left = `${(start - day.startMs) / span * 100}%`; block.style.width = `${(end - start) / span * 100}%`;
                const times = `${timeInput(new Date(b.startMs))} — ${b.endMs === day.endMs ? '24:00' : timeInput(new Date(b.endMs))}`;
                block.title = `${item.title} · ${times}`; block.setAttribute('aria-label', `${item.title}, ${times}. Стрелки — перенос, Shift и стрелки — конец показа.`);
                const time = document.createElement('small'); time.className = 'live-planner__time'; time.textContent = times;
                const name = document.createElement('strong'); name.textContent = item.title || 'Без названия';
                const meta = document.createElement('span'); meta.className = 'live-planner__kind'; meta.textContent = item.mode === 'movie' ? 'Фильм' : 'YouTube';
                block.append(time, name, meta);
                const mini = document.createElement('span'); mini.className = 'live-planner__mini';
                mini.innerHTML = window.Icons?.PLAY || ''; mini.setAttribute('aria-hidden', 'true'); block.append(mini);
                if (this.selected?.id === item.id) for (const side of ['start', 'end']) {
                    const handle = document.createElement('span'); handle.className = `live-planner__handle is-${side}`;
                    handle.dataset.handle = side; handle.setAttribute('aria-hidden', 'true'); block.append(handle);
                }
                const occupied = this.drag?.item.id === item.id && overlaps(this.drag.start, this.drag.end, this.items, item.id);
                block.classList.toggle('is-overlap', Boolean(occupied));
                if (occupied) block.title = 'Место занято — перетащите дальше';
                track.append(block);
            }
            gap(edge, day.endMs);
            this.ui.PlannerStats.textContent = `${entries.length} показов · ${dateKey(this.date)}`;
        }
        tick() {
            const day = dayBounds(this.date), at = window.CinemaChannel.now();
            this.ui.PlannerLine.hidden = at < day.startMs || at >= day.endMs;
            this.ui.PlannerLine.style.left = `${(at - day.startMs) / (day.endMs - day.startMs) * 100}%`;
            this.ui.PlannerLine.firstElementChild.textContent = `${timeInput(new Date(at))} · сейчас`;
        }
        startDrag(event) {
            const block = event.target.closest('.live-planner__block');
            if (!block || event.button !== 0 || this.busy) return;
            const item = this.items.find(entry => entry.id === block.dataset.id); if (!item) return;
            event.preventDefault(); this.select(item);
            const bounds = boundsFor(item), day = dayBounds(this.date);
            this.drag = { item, side: event.target.closest('[data-handle]')?.dataset.handle || 'move',
                x: event.clientX, scroll: this.ui.PlannerScroll.scrollLeft, day,
                scale: (day.endMs - day.startMs) / this.ui.PlannerCanvas.clientWidth,
                originalStart: bounds.startMs, originalEnd: bounds.endMs, start: bounds.startMs, end: bounds.endMs };
            this.ui.PlannerCanvas.setPointerCapture?.(event.pointerId);
        }
        queueMove(event) {
            if (!this.drag) return;
            this.lastMove = { x: event.clientX };
            if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = null; this.move(); });
        }
        move() {
            if (!this.drag || !this.lastMove) return;
            const d = this.drag, box = this.ui.PlannerScroll.getBoundingClientRect(), x = this.lastMove.x;
            if (x < box.left + 25) this.ui.PlannerScroll.scrollLeft -= 20;
            else if (x > box.right - 25) this.ui.PlannerScroll.scrollLeft += 20;
            const delta = Math.round(((x - d.x + this.ui.PlannerScroll.scrollLeft - d.scroll) * d.scale) / STEP_MS) * STEP_MS;
            if (d.side === 'move') {
                const length = d.originalEnd - d.originalStart;
                d.start = Math.max(d.day.startMs, Math.min(d.day.endMs - Math.min(length, d.day.endMs - d.day.startMs), d.originalStart + delta));
                d.end = d.start + length;
            } else if (d.side === 'start') d.start = Math.max(d.day.startMs, Math.min(d.originalEnd - STEP_MS, d.originalStart + delta));
            else d.end = Math.max(d.originalStart + STEP_MS, Math.min(d.day.endMs, d.originalEnd + delta));
            this.ui.SlotStart.value = timeInput(new Date(d.start)); this.ui.SlotEnd.value = timeInput(new Date(d.end));
            this.dirty = true; this.renderTrack(); this.renderNote();
        }
        async finishDrag(event) {
            if (!this.drag) return;
            if (this.frame) { cancelAnimationFrame(this.frame); this.frame = null; this.move(); }
            const drag = this.drag; this.drag = null;
            if (event.type === 'pointercancel') { this.select(drag.item); return; }
            if (drag.start === drag.originalStart && drag.end === drag.originalEnd) { this.dirty = false; return; }
            await this.saveRange(drag.item, new Date(drag.start), new Date(drag.end));
        }
        cancelDrag(message) {
            if (!this.drag) return;
            const item = this.drag.item; this.drag = null;
            if (this.frame) cancelAnimationFrame(this.frame); this.frame = null;
            this.dirty = false; this.fillRange(item); this.renderTrack();
            if (message) this.onStatus?.(message, 'error');
        }
        async saveRange(item, start, end) {
            if (this.busy) return;
            if (overlaps(start.getTime(), end.getTime(), this.items, item.id)) {
                this.dirty = false; this.fillRange(item); this.render();
                this.onStatus?.('Место занято. Показ возвращён на прежнее время.', 'error'); return;
            }
            this.setBusy(true);
            try {
                const saved = await this.onChange(item, start, end);
                this.dirty = false;
                if (saved) { this.items = this.items.map(entry => entry.id === item.id ? saved : entry); this.selected = saved; }
                else this.selected = this.items.find(entry => entry.id === item.id) || null;
            } catch (error) {
                this.dirty = false; this.selected = this.items.find(entry => entry.id === item.id) || null;
                this.onStatus?.(error.code === 'cinema/stale' ? 'Передачу изменили в другой вкладке. Выберите её заново.' : error.message || 'Не удалось сохранить время.', 'error');
            } finally { this.setBusy(false); if (this.selected) this.fillRange(this.selected); this.render(); this.onRange?.(); }
        }
        async remove() {
            if (this.busy || !this.selected) return;
            const item = this.selected; this.setBusy(true);
            try { if (await this.onRemove(item)) { this.items = this.items.filter(entry => entry.id !== item.id); this.beginDraft(); } }
            catch (error) { this.onStatus?.(error.message || 'Не удалось удалить передачу.', 'error'); }
            finally { this.setBusy(false); this.render(); this.onRange?.(); }
        }
        keyMove(event) {
            const block = event.target.closest('.live-planner__block'); if (!block || this.busy) return;
            const item = this.items.find(entry => entry.id === block.dataset.id); if (!item) return;
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); this.select(item); return; }
            if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
            event.preventDefault(); const bounds = boundsFor(item), delta = event.key === 'ArrowRight' ? STEP_MS : -STEP_MS;
            this.select(item); this.saveRange(item, new Date(bounds.startMs + (event.shiftKey ? 0 : delta)), new Date(bounds.endMs + delta));
        }
        destroy() {
            if (this.frame) cancelAnimationFrame(this.frame);
            document.removeEventListener('pointermove', this.moveListener);
            document.removeEventListener('pointerup', this.finishListener);
            document.removeEventListener('pointercancel', this.finishListener);
            window.removeEventListener('resize', this.resizeListener);
        }
    }
    const api = { LiveSchedulePlanner, dayBounds, dateKey, timeInput, rangeFromInputs, overlaps };
    if (typeof window !== 'undefined') Object.assign(window, api);
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
