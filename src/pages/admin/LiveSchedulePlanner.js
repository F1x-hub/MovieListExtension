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
    const exactTime = date => `${timeInput(date)}${date.getSeconds() ? `:${pad(date.getSeconds())}` : ''}`;
    const mediaLabel = media => media?.mediaType === 'tv-series'
        ? `Сериал · S${pad(media.seasonNumber)}E${pad(media.episodeNumber)}`
        : media?.mode === 'movie' ? 'Фильм' : 'YouTube';

    /** Keep the shared calendar's presentation while placing this popup outside the clipped grid. */
    function createDatePicker(Base, options) {
        class PlannerDatePicker extends Base {
            open() {
                if (this.triggerBtn.disabled) return;
                window.SortControl?.current?.close();
                super.open(); this.position(); this.focusDate(this.selectedDate);
            }
            close() {
                const restore = this.dropdown?.contains(document.activeElement);
                super.close();
                if (restore && !this.triggerBtn.disabled) this.triggerBtn.focus({ preventScroll: true });
            }
            handleDocumentClick(event) {
                if (!this.container.contains(event.target) && !this.dropdown.contains(event.target)) this.close();
            }
            renderCalendarGrid() {
                super.renderCalendarGrid();
                // Day shortcuts already live in the programme toolbar. Keeping
                // one calendar grid leaves room for every week on narrow screens.
                this.dropdown.querySelector('.custom-calendar-presets')?.remove();
                this.dropdown.querySelectorAll('.custom-calendar-day').forEach(button => {
                    const date = new Date(Number(button.dataset.year), Number(button.dataset.month), Number(button.dataset.day));
                    button.dataset.date = dateKey(date);
                    button.disabled = button.classList.contains('disabled');
                    button.tabIndex = button.classList.contains('selected') ? 0 : -1;
                    button.setAttribute('aria-label', date.toLocaleDateString('ru-RU', { dateStyle: 'full' }));
                    button.setAttribute('aria-pressed', String(button.classList.contains('selected')));
                });
                this.position();
            }
            focusDate(date) {
                if (this.viewMonth !== date.getMonth() || this.viewYear !== date.getFullYear()) {
                    this.viewMonth = date.getMonth(); this.viewYear = date.getFullYear(); this.renderCalendarGrid();
                }
                const target = [...this.dropdown.querySelectorAll('[data-date]')].find(button => button.dataset.date === dateKey(date));
                if (target && !target.disabled) {
                    this.dropdown.querySelectorAll('[data-date]').forEach(button => { button.tabIndex = button === target ? 0 : -1; });
                    target.focus({ preventScroll: true });
                    if (target.offsetTop < this.dropdown.scrollTop) this.dropdown.scrollTop = target.offsetTop;
                    else if (target.offsetTop + target.offsetHeight > this.dropdown.scrollTop + this.dropdown.clientHeight) {
                        this.dropdown.scrollTop = target.offsetTop + target.offsetHeight - this.dropdown.clientHeight;
                    }
                }
            }
            handleKeyDown(event) {
                if (!this.isOpen) return;
                if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); this.triggerBtn.focus(); return; }
                if (event.key === 'Tab') { this.close(); return; }
                const focused = event.target.closest?.('[data-date]');
                if (!focused || !this.dropdown.contains(focused)) return;
                const date = new Date(`${focused.dataset.date}T12:00:00`);
                const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
                if (step) date.setDate(date.getDate() + step);
                else if (event.key === 'Home') date.setDate(date.getDate() - (date.getDay() + 6) % 7);
                else if (event.key === 'End') date.setDate(date.getDate() + 6 - (date.getDay() + 6) % 7);
                else if (['PageUp', 'PageDown'].includes(event.key)) {
                    const day = date.getDate(), delta = event.key === 'PageUp' ? -1 : 1;
                    date.setDate(1); date.setMonth(date.getMonth() + delta);
                    date.setDate(Math.min(day, new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()));
                } else return;
                event.preventDefault(); this.focusDate(date);
            }
            position() {
                if (!this.isOpen) return;
                const rect = this.triggerBtn.getBoundingClientRect(), margin = 8;
                if (rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth) { this.close(); return; }
                const width = Math.min(320, window.innerWidth - margin * 2);
                this.dropdown.style.width = `${width}px`;
                this.dropdown.style.left = `${Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin))}px`;
                const below = window.innerHeight - rect.bottom - margin * 2, above = rect.top - margin * 2;
                const desired = this.dropdown.scrollHeight || 370, openAbove = below < desired && above > below;
                const height = Math.max(0, Math.min(desired, openAbove ? above : below));
                this.dropdown.style.maxHeight = `${height}px`;
                this.dropdown.style.top = `${openAbove ? Math.max(margin, rect.top - height - margin) : rect.bottom + margin}px`;
            }
        }
        const picker = new PlannerDatePicker(options);
        picker.dropdown.classList.add('live-planner-calendar');
        picker.dropdown.setAttribute('role', 'dialog'); picker.dropdown.setAttribute('aria-label', 'Выбрать день программы');
        picker.dropdown.id = 'livePlannerCalendar'; picker.triggerBtn.setAttribute('aria-controls', picker.dropdown.id);
        picker.triggerBtn.setAttribute('aria-label', 'День программы');
        document.body.append(picker.dropdown);
        return picker;
    }

    class LiveSchedulePlanner {
        constructor({ onSelect, onAdd, onChange, onRemove, onRange, onStatus, DatePicker }) {
            this.onSelect = onSelect; this.onAdd = onAdd; this.onChange = onChange;
            this.onRemove = onRemove; this.onRange = onRange; this.onStatus = onStatus;
            this.items = []; this.selected = null; this.source = null; this.busy = false;
            this.date = new Date(window.CinemaChannel.now());
            this.drag = null; this.frame = null; this.dirty = false;
            const $ = id => document.getElementById(id);
            this.ui = Object.fromEntries(['livePlannerDate', 'livePlannerPrev', 'livePlannerNext', 'livePlannerToday',
                'livePlannerNow', 'livePlannerZoom', 'livePlannerScroll', 'livePlannerCanvas', 'livePlannerRuler',
                'livePlannerTrack', 'livePlannerLine', 'livePlannerStats', 'livePlannerAdd', 'liveSlotStart',
                'liveSlotEnd', 'liveSlotDuration', 'liveSlotNote', 'liveSelectedPoster', 'liveSelectedName',
                'liveSelectedMeta', 'liveDeleteShowBtn', 'liveSelectionBadge', 'livePlannerTimezone',
                'livePlannerOverviewHours', 'livePlannerOverviewTrack', 'livePlannerOverviewBlocks', 'livePlannerViewport', 'livePlannerViewRange']
                .map(id => [id.replace(/^live/, ''), $(id)]));
            this.ui.PlannerDate.value = dateKey(this.date);
            if (DatePicker && $('livePlannerDatePicker')) this.datePicker = createDatePicker(DatePicker, {
                container: $('livePlannerDatePicker'), initialValue: dateKey(this.date), minDate: new Date(1970, 0, 1),
                onChange: value => { if (!this.syncingDate) this.setDay(new Date(`${value}T12:00:00`)); }
            });
            this.zoomControl = window.SortControl?.enhance(this.ui.PlannerZoom, { onBeforeOpen: () => this.datePicker?.close() });
            this.ui.SlotEnd.readOnly = true;
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
            if (this.ui.PlannerOverviewTrack) {
                for (let hour = 0; hour <= 24; hour += 2) {
                    const label = document.createElement('span'); label.textContent = pad(hour);
                    label.style.left = `${hour / 24 * 100}%`; this.ui.PlannerOverviewHours.append(label);
                }
                this.ui.PlannerOverviewTrack.addEventListener('pointerdown', event => this.startOverviewDrag(event));
                this.ui.PlannerViewport.addEventListener('keydown', event => this.overviewKey(event));
            }
            this.overviewScrollListener = () => this.updateOverview();
            this.ui.PlannerScroll.addEventListener('scroll', this.overviewScrollListener, { passive: true });
            this.ui.PlannerAdd.addEventListener('click', () => { this.beginDraft(); this.onAdd?.(); });
            this.ui.SlotStart.addEventListener('input', () => {
                this.dirty = true;
                this.renderNote(); this.onRange?.();
            });
            this.ui.DeleteShowBtn.addEventListener('click', () => this.remove());
            this.ui.PlannerTrack.addEventListener('pointerdown', event => this.startDrag(event));
            this.ui.PlannerTrack.addEventListener('keydown', event => this.keyMove(event));
            this.moveListener = event => this.overviewDrag ? this.moveOverview(event) : this.queueMove(event);
            this.finishListener = event => {
                if (!this.overviewDrag) return this.finishDrag(event);
                if (event.type === 'pointercancel') this.scrollOverview(this.overviewDrag.original);
                this.overviewDrag = null;
            };
            document.addEventListener('pointermove', this.moveListener);
            document.addEventListener('pointerup', this.finishListener);
            document.addEventListener('pointercancel', this.finishListener);
            this.resizeListener = () => { this.zoom(false); this.datePicker?.position(); };
            this.calendarScrollListener = () => this.datePicker?.position();
            document.addEventListener('scroll', this.calendarScrollListener, true);
            window.addEventListener('resize', this.resizeListener);
            // The admin pane starts hidden. Its final width arrives when the
            // user opens it, even if the browser window itself never resized.
            if (typeof ResizeObserver === 'function') {
                this.resizeObserver = new ResizeObserver(this.resizeListener);
                this.resizeObserver.observe(this.ui.PlannerScroll);
            }
            window.addEventListener('pagehide', () => this.destroy(), { once: true });
            this.beginDraft(); this.render(); this.zoom(false);
        }
        get range() {
            if (this.drag) return { start: new Date(this.drag.start), end: new Date(this.drag.end) };
            // Preserve seconds and an ambiguous DST occurrence on untouched legacy entries.
            if (this.selected && !this.dirty) {
                const bounds = boundsFor(this.selected);
                return { start: new Date(bounds.startMs), end: new Date(bounds.endMs) };
            }
            const start = !this.selected && !this.dirty && Number.isFinite(this.draftStartMs)
                ? new Date(this.draftStartMs) : localTime(this.date, this.ui.SlotStart.value);
            const bounds = this.selected && boundsFor(this.selected);
            const length = bounds ? bounds.endMs - bounds.startMs : (this.source?.durationSec || 3600) * 1000;
            return { start, end: new Date(start.getTime() + length) };
        }
        syncDate() {
            const value = dateKey(this.date); this.ui.PlannerDate.value = value;
            if (this.datePicker && this.datePicker.getValue() !== value) {
                this.syncingDate = true;
                try { this.datePicker.setValue(value); } finally { this.syncingDate = false; }
            }
        }
        setBusy(value) {
            this.busy = value;
            this.ui.PlannerCanvas.setAttribute('aria-busy', String(value));
            this.ui.DeleteShowBtn.disabled = value;
            for (const key of ['PlannerDate', 'PlannerPrev', 'PlannerNext', 'PlannerToday', 'PlannerNow', 'PlannerAdd', 'SlotStart', 'SlotEnd']) this.ui[key].disabled = value;
            this.ui.PlannerZoom.disabled = value; this.zoomControl?.setDisabled(value);
            this.ui.PlannerViewport?.setAttribute('aria-disabled', String(value));
            if (value) this.overviewDrag = null;
            if (this.datePicker) { this.datePicker.triggerBtn.disabled = value; if (value) this.datePicker.close(); }
            this.onRange?.();
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
            this.syncDate();
            this.beginDraft(); this.render(); this.zoom(false);
        }
        changeDay(delta) { this.setDay(new Date(this.date.getFullYear(), this.date.getMonth(), this.date.getDate() + delta)); }
        beginDraft(atMs) {
            this.selected = null; this.dirty = false;
            if (Number.isFinite(atMs)) { this.date = new Date(atMs); this.syncDate(); }
            const day = dayBounds(this.date);
            let start = Number.isFinite(atMs) ? atMs : Math.max(day.startMs, Math.ceil(window.CinemaChannel.now() / STEP_MS) * STEP_MS);
            if (!Number.isFinite(atMs) && start >= day.endMs) start = day.startMs;
            const length = (this.source?.durationSec || 3600) * 1000;
            if (!Number.isFinite(atMs)) {
                for (const item of [...this.items].sort((a, b) => a.startedAtMs - b.startedAtMs)) {
                    const bounds = boundsFor(item);
                    if (start < bounds.endMs && start + length > bounds.startMs) start = bounds.endMs;
                }
                if (start >= day.endMs) start = day.startMs;
            }
            this.ui.SlotStart.value = timeInput(new Date(start));
            this.draftStartMs = start;
            this.ui.SlotEnd.value = exactTime(new Date(start + length));
            this.renderSelection(); this.renderTrack(); this.onSelect?.(null); this.onRange?.();
        }
        setDraft(source, { startMs, preserveStart = false } = {}) {
            const same = this.source?.key === source?.key && !this.selected;
            if (preserveStart && !same && !this.selected && !Number.isFinite(startMs)) {
                try { startMs = this.range.start.getTime(); } catch { /* Keep the invalid input visible. */ }
            }
            this.source = source;
            if (Number.isFinite(startMs)) this.beginDraft(startMs);
            else if (!same && !preserveStart) this.beginDraft();
            this.renderSelection(); this.onRange?.();
        }
        nearestFreeStart(startMs, durationSec) {
            if (!Number.isFinite(startMs) || !(durationSec > 0)) return null;
            const length = durationSec * 1000;
            let start = startMs;
            for (const item of [...this.items].sort((a, b) => boundsFor(a).startMs - boundsFor(b).startMs)) {
                const bounds = boundsFor(item);
                if (start < bounds.endMs && start + length > bounds.startMs) start = bounds.endMs;
            }
            return Number.isFinite(start) ? start : null;
        }
        fillRange(item) {
            const bounds = boundsFor(item);
            this.ui.SlotStart.value = timeInput(new Date(bounds.startMs));
            this.ui.SlotEnd.value = exactTime(new Date(bounds.endMs));
        }
        select(item) {
            if (this.busy) return;
            this.selected = item; this.dirty = false;
            this.source = { key: `${item.mode}:${item.id}`, mode: item.mode, title: item.title,
                ...(item.movie?.mediaType === 'tv-series' ? item.movie : {}),
                cover: window.CinemaChannel.coverUrl(item), durationSec: item[item.mode]?.durationSec || 0 };
            this.date = new Date(item.startedAtMs); this.syncDate();
            this.fillRange(item); this.render(); this.onSelect?.(item); this.onRange?.();
        }
        renderSelection() {
            const item = this.selected;
            const media = item ? { title: item.title, cover: window.CinemaChannel.coverUrl(item),
                ...(item.movie?.mediaType === 'tv-series' ? item.movie : {}),
                durationSec: item[item.mode]?.durationSec || 0, mode: item.mode } : this.source;
            this.ui.SelectedName.textContent = media?.title || 'Выберите передачу слева';
            this.ui.SelectedMeta.textContent = media ? `${mediaLabel(media)}${media.durationSec ? ` · ${window.CinemaChannel.formatClock(media.durationSec)}` : ' · длительность не определена'}` : 'Фильм, отдельная серия или видео YouTube';
            this.ui.SelectedPoster.hidden = !media?.cover;
            if (media?.cover) this.ui.SelectedPoster.src = media.cover;
            this.ui.SelectionBadge.textContent = item ? 'В расписании' : 'Новый показ';
            this.ui.DeleteShowBtn.hidden = !item;
            this.renderNote();
        }
        renderNote() {
            try {
                const { start, end } = this.range;
                this.ui.SlotEnd.value = exactTime(end);
                const minutes = Math.floor((end - start) / 60_000), seconds = Math.round((end - start) / 1000) % 60;
                const length = this.selected?.[this.selected.mode]?.durationSec || this.source?.durationSec || 0;
                this.ui.SlotDuration.textContent = `${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)} ч ` : ''}${minutes % 60} мин${seconds ? ` ${seconds} с` : ''}`;
                this.ui.SlotNote.textContent = length > 0 && end - start < length * 1000
                    ? 'Показ прервётся в конце диапазона. Скорость видео не меняется.'
                    : length > 0 && end - start > length * 1000 + 59_000
                        ? 'После окончания видео будет заставка до следующего показа. Скорость видео не меняется.'
                        : this.source && !length ? 'Укажите длительность источника перед добавлением.'
                        : 'Длительность фиксирована. Перенесите блок по шкале или измените время начала.';
            } catch (error) { this.ui.SlotDuration.textContent = '—'; this.ui.SlotNote.textContent = error.message; }
        }
        zoom(focus) {
            const old = this.overviewWindow();
            const width = this.ui.PlannerScroll.clientWidth > 48 ? this.ui.PlannerScroll.clientWidth - 48 : 880;
            const scale = 24 / Number(this.ui.PlannerZoom.value);
            this.ui.PlannerCanvas.style.width = `${Math.round(width * scale)}px`;
            if (scale === 1) this.ui.PlannerScroll.scrollLeft = 0;
            else if (focus) {
                const day = dayBounds(this.date);
                let anchor = this.selected ? this.selected.startedAtMs : window.CinemaChannel.now();
                try { if (this.source) anchor = this.range.start.getTime(); } catch { /* Keep the visible day for an invalid draft. */ }
                this.scrollOverview((anchor - day.startMs) / (day.endMs - day.startMs) - this.overviewWindow().size / 2);
            } else this.scrollOverview(old.start);
            this.renderRuler(); this.updateOverview();
        }
        overviewWindow() {
            const canvas = this.ui.PlannerCanvas.clientWidth || Number.parseFloat(this.ui.PlannerCanvas.style.width) || 880;
            const visible = Math.max(0, this.ui.PlannerScroll.clientWidth - 48);
            const size = visible > 0 ? Math.min(1, visible / canvas) : Number(this.ui.PlannerZoom.value) / 24;
            return { canvas, size, start: Math.min(1 - size, Math.max(0, this.ui.PlannerScroll.scrollLeft / canvas)) };
        }
        scrollOverview(start) {
            const view = this.overviewWindow();
            this.ui.PlannerScroll.scrollLeft = Math.min(1 - view.size, Math.max(0, start)) * view.canvas;
            this.updateOverview();
        }
        updateOverview() {
            const viewport = this.ui.PlannerViewport;
            if (!viewport) return;
            const view = this.overviewWindow(), day = dayBounds(this.date), span = day.endMs - day.startMs;
            const at = fraction => fraction >= 1 - 1e-7 ? '24:00' : timeInput(new Date(day.startMs + Math.round(fraction * span / 60_000) * 60_000));
            const text = `${at(view.start)}–${at(view.start + view.size)}`;
            viewport.style.left = `${view.start * 100}%`; viewport.style.width = `${view.size * 100}%`;
            viewport.setAttribute('aria-valuemax', String(Math.round((1 - view.size) * span / 60_000)));
            viewport.setAttribute('aria-valuenow', String(Math.round(view.start * span / 60_000)));
            viewport.setAttribute('aria-valuetext', text);
            this.ui.PlannerViewRange.textContent = `На дорожке: ${text}`;
        }
        renderOverview(entries, day) {
            if (!this.ui.PlannerOverviewBlocks) return;
            const span = day.endMs - day.startMs;
            this.ui.PlannerOverviewBlocks.replaceChildren(...entries.map(item => {
                const bounds = boundsFor(item), start = Math.max(day.startMs, bounds.startMs), end = Math.min(day.endMs, bounds.endMs);
                const block = document.createElement('span'); block.style.left = `${(start - day.startMs) / span * 100}%`;
                block.style.width = `${(end - start) / span * 100}%`; return block;
            }));
            this.updateOverview();
        }
        startOverviewDrag(event) {
            if (event.button !== 0 || this.busy || this.drag) return;
            const box = this.ui.PlannerOverviewTrack.getBoundingClientRect(); if (!box.width) return;
            event.preventDefault(); this.ui.PlannerViewport.focus({ preventScroll: true });
            const view = this.overviewWindow(), point = (event.clientX - box.left) / box.width;
            this.overviewDrag = { offset: this.ui.PlannerViewport.contains(event.target) ? point - view.start : view.size / 2, original: view.start };
            this.ui.PlannerOverviewTrack.setPointerCapture?.(event.pointerId);
            this.moveOverview(event);
        }
        moveOverview(event) {
            const box = this.ui.PlannerOverviewTrack.getBoundingClientRect();
            if (!this.overviewDrag || !box.width) return;
            this.scrollOverview((event.clientX - box.left) / box.width - this.overviewDrag.offset);
        }
        overviewKey(event) {
            if (this.busy) return;
            const view = this.overviewWindow(), day = dayBounds(this.date);
            const step = (event.shiftKey ? 60 : 15) * 60_000 / (day.endMs - day.startMs);
            let start;
            if (event.key === 'Home') start = 0;
            else if (event.key === 'End') start = 1 - view.size;
            else if (event.key === 'ArrowLeft') start = view.start - step;
            else if (event.key === 'ArrowRight') start = view.start + step;
            else if (event.key === 'PageUp') start = view.start - view.size;
            else if (event.key === 'PageDown') start = view.start + view.size;
            else return;
            event.preventDefault(); this.scrollOverview(start);
        }
        render() { this.renderRuler(); this.renderTrack(); this.renderSelection(); this.tick(); }
        renderRuler() {
            const day = dayBounds(this.date), span = day.endMs - day.startMs;
            const width = this.overviewWindow().canvas, labelStep = Math.max(1, Math.ceil(40 / (width * 3600_000 / span)));
            this.ui.PlannerRuler.replaceChildren();
            for (let at = day.startMs; at <= day.endMs; at += 15 * 60_000) {
                const date = new Date(at), tick = document.createElement('span');
                tick.className = 'live-planner__tick'; tick.style.left = `${(at - day.startMs) / span * 100}%`;
                if (date.getMinutes() === 0 || at === day.endMs) {
                    tick.classList.add('is-hour');
                    const label = document.createElement('span'); label.textContent = at === day.endMs ? '24:00' : timeInput(date);
                    label.hidden = at !== day.endMs && date.getHours() % labelStep !== 0;
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
                block.classList.toggle('is-live', this.current?.id === item.id && ['live', 'paused'].includes(window.CinemaChannel.computePosition(this.current).state));
                block.style.left = `${(start - day.startMs) / span * 100}%`; block.style.width = `${(end - start) / span * 100}%`;
                const times = `${timeInput(new Date(b.startMs))} — ${b.endMs === day.endMs ? '24:00' : timeInput(new Date(b.endMs))}`;
                const label = item.movie?.mediaType === 'tv-series'
                    ? [item.title, mediaLabel(item.movie), item.movie.episodeTitle].filter(Boolean).join(' · ') : item.title;
                block.title = `${label} · ${times}`; block.setAttribute('aria-label', `${label}, ${times}. Стрелки — перенос на 5 минут, Shift и стрелки — на 15 минут.`);
                const time = document.createElement('small'); time.className = 'live-planner__time'; time.textContent = times;
                const name = document.createElement('strong'); name.textContent = item.title || 'Без названия';
                const meta = document.createElement('span'); meta.className = 'live-planner__kind'; meta.textContent = mediaLabel({ mode: item.mode, ...item.movie });
                block.append(time, name, meta);
                const mini = document.createElement('span'); mini.className = 'live-planner__mini';
                mini.innerHTML = window.Icons?.PLAY || ''; mini.setAttribute('aria-hidden', 'true'); block.append(mini);
                const occupied = this.drag?.item.id === item.id && overlaps(this.drag.start, this.drag.end, this.items, item.id);
                block.classList.toggle('is-overlap', Boolean(occupied));
                if (occupied) block.title = 'Место занято — перетащите дальше';
                track.append(block);
            }
            gap(edge, day.endMs);
            this.ui.PlannerStats.textContent = `${entries.length} показов · ${dateKey(this.date)}`;
            this.renderOverview(entries, day);
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
            this.drag = { item,
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
            const length = d.originalEnd - d.originalStart;
            d.start = Math.max(d.day.startMs, Math.min(d.day.endMs - Math.min(length, d.day.endMs - d.day.startMs), d.originalStart + delta));
            d.end = d.start + length;
            this.ui.SlotStart.value = timeInput(new Date(d.start)); this.ui.SlotEnd.value = timeInput(new Date(d.end));
            this.dirty = true; this.renderTrack(); this.renderNote();
        }
        async finishDrag(event) {
            if (!this.drag) return;
            if (this.frame) { cancelAnimationFrame(this.frame); this.frame = null; this.move(); }
            const drag = this.drag; this.drag = null;
            if (event.type === 'pointercancel') { this.select(drag.item); return; }
            if (drag.start === drag.originalStart && drag.end === drag.originalEnd) { this.dirty = false; return; }
            await this.saveRange(drag.item, new Date(drag.start));
        }
        cancelDrag(message) {
            if (!this.drag) return;
            const item = this.drag.item; this.drag = null;
            if (this.frame) cancelAnimationFrame(this.frame); this.frame = null;
            this.dirty = false; this.fillRange(item); this.renderTrack();
            if (message) this.onStatus?.(message, 'error');
        }
        async saveRange(item, start) {
            if (this.busy) return;
            const bounds = boundsFor(item), end = new Date(start.getTime() + bounds.endMs - bounds.startMs);
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
            event.preventDefault(); const bounds = boundsFor(item), delta = (event.key === 'ArrowRight' ? STEP_MS : -STEP_MS) * (event.shiftKey ? 3 : 1);
            this.select(item);
            this.saveRange(item, new Date(bounds.startMs + delta))
                .then(() => [...this.ui.PlannerTrack.querySelectorAll('[data-id]')].find(entry => entry.dataset.id === item.id)?.focus({ preventScroll: true }));
        }
        destroy() {
            if (this.frame) cancelAnimationFrame(this.frame);
            document.removeEventListener('pointermove', this.moveListener);
            document.removeEventListener('pointerup', this.finishListener);
            document.removeEventListener('pointercancel', this.finishListener);
            window.removeEventListener('resize', this.resizeListener);
            this.ui.PlannerScroll.removeEventListener('scroll', this.overviewScrollListener);
            document.removeEventListener('scroll', this.calendarScrollListener, true);
            this.resizeObserver?.disconnect();
            this.zoomControl?.destroy();
            this.datePicker?.close(); this.datePicker?.dropdown.remove();
        }
    }
    const api = { LiveSchedulePlanner, dayBounds, dateKey, timeInput, rangeFromInputs, overlaps };
    if (typeof window !== 'undefined') Object.assign(window, api);
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
