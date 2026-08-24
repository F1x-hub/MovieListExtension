/**
 * Custom Date & Time Picker Component
 * Premium Obsidian-Zinc UI replacing native browser input widgets
 */

const MONTHS_RU = [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
];

const MONTHS_RU_SHORT = [
    'янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.',
    'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'
];

const WEEKDAYS_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

// Shared active pickers set for mutual exclusivity
const activePickers = new Set();

const DEFAULT_TIME_PRESETS = ['09:00', '12:00', '15:00', '18:00', '21:00'];
const TIME_PRESETS_STORAGE_KEY = 'custom_user_time_presets';

/**
 * Load saved time presets from localStorage / chrome.storage
 * @returns {string[]}
 */
export function getSavedTimePresets() {
    try {
        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(TIME_PRESETS_STORAGE_KEY) : null;
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
    } catch (e) {
        console.warn('[CustomDateTimePicker] Failed to parse saved time presets:', e);
    }
    return [...DEFAULT_TIME_PRESETS];
}

/**
 * Save user time presets to localStorage and chrome.storage
 * @param {string[]} presets
 */
export function saveTimePresets(presets) {
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(TIME_PRESETS_STORAGE_KEY, JSON.stringify(presets));
        }
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            chrome.storage.local.set({ [TIME_PRESETS_STORAGE_KEY]: presets }).catch(() => {});
        }
    } catch (e) {
        console.warn('[CustomDateTimePicker] Failed to save time presets:', e);
    }
}

/**
 * Format Date object to YYYY-MM-DD string
 * @param {Date} date
 * @returns {string}
 */
export function formatDateISO(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Format Date object or YYYY-MM-DD string to readable Russian text
 * @param {Date|string} date
 * @returns {string}
 */
export function formatDateHuman(date) {
    const d = typeof date === 'string' ? new Date(date + 'T00:00:00') : new Date(date);
    if (isNaN(d.getTime())) return '';
    const day = d.getDate();
    const monthName = MONTHS_RU_SHORT[d.getMonth()];
    const year = d.getFullYear();
    return `${day} ${monthName} ${year}`;
}

export class CustomDatePicker {
    /**
     * @param {Object} options
     * @param {HTMLElement} options.container - Container element to render picker into
     * @param {HTMLInputElement} [options.targetInput] - Hidden or synced input element (value: YYYY-MM-DD)
     * @param {string} [options.initialValue] - Initial date string (YYYY-MM-DD)
     * @param {Date} [options.minDate] - Optional minimum selectable date
     * @param {Function} [options.onChange] - Callback on date change
     */
    constructor(options) {
        this.container = options.container;
        this.targetInput = options.targetInput;
        this.minDate = options.minDate || new Date(new Date().setHours(0, 0, 0, 0));
        this.onChange = options.onChange;

        const initial = options.initialValue 
            ? new Date(options.initialValue + 'T00:00:00') 
            : new Date();
            
        this.selectedDate = isNaN(initial.getTime()) ? new Date() : initial;
        this.viewMonth = this.selectedDate.getMonth();
        this.viewYear = this.selectedDate.getFullYear();
        this.isOpen = false;

        this.onDocClick = this.handleDocumentClick.bind(this);
        this.onKeyDown = this.handleKeyDown.bind(this);

        this.render();
        this.attachEvents();
    }

    render() {
        this.container.innerHTML = `
            <div class="custom-picker-wrapper">
                <button type="button" class="custom-picker-trigger" aria-haspopup="dialog" aria-expanded="false">
                    <div class="custom-picker-trigger-content">
                        <span class="custom-picker-icon">
                            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                        </span>
                        <span class="custom-picker-value">${formatDateHuman(this.selectedDate)}</span>
                    </div>
                    <span class="custom-picker-chevron">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                    </span>
                </button>
                <div class="custom-picker-dropdown custom-date-picker-dropdown" style="display: none;"></div>
            </div>
        `;

        this.wrapper = this.container.querySelector('.custom-picker-wrapper');
        this.triggerBtn = this.container.querySelector('.custom-picker-trigger');
        this.valueDisplay = this.container.querySelector('.custom-picker-value');
        this.dropdown = this.container.querySelector('.custom-date-picker-dropdown');

        this.syncTargetInput();
    }

    attachEvents() {
        this.triggerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });
    }

    toggle() {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    open() {
        if (this.isOpen) return;

        // Close all other active pickers
        activePickers.forEach(p => {
            if (p !== this) p.close();
        });
        activePickers.add(this);

        this.isOpen = true;
        this.wrapper?.classList.add('active');
        this.triggerBtn.classList.add('active');
        this.triggerBtn.setAttribute('aria-expanded', 'true');
        this.viewMonth = this.selectedDate.getMonth();
        this.viewYear = this.selectedDate.getFullYear();
        this.renderCalendarGrid();
        this.dropdown.style.display = 'block';

        document.addEventListener('click', this.onDocClick);
        document.addEventListener('keydown', this.onKeyDown);
    }

    close() {
        if (!this.isOpen) return;
        activePickers.delete(this);

        this.isOpen = false;
        this.wrapper?.classList.remove('active');
        this.triggerBtn.classList.remove('active');
        this.triggerBtn.setAttribute('aria-expanded', 'false');
        this.dropdown.style.display = 'none';

        document.removeEventListener('click', this.onDocClick);
        document.removeEventListener('keydown', this.onKeyDown);
    }

    handleDocumentClick(e) {
        if (!this.container.contains(e.target)) {
            this.close();
        }
    }

    handleKeyDown(e) {
        if (e.key === 'Escape') {
            this.close();
        }
    }

    renderCalendarGrid() {
        const monthTitle = `${MONTHS_RU[this.viewMonth]} ${this.viewYear}`;
        
        // Days of week
        const weekdaysHtml = WEEKDAYS_RU
            .map(w => `<span class="custom-calendar-weekday">${w}</span>`)
            .join('');

        // Grid calculation
        const firstDayOfMonth = new Date(this.viewYear, this.viewMonth, 1);
        let firstDayIndex = firstDayOfMonth.getDay() - 1;
        if (firstDayIndex < 0) firstDayIndex = 6;

        const daysInMonth = new Date(this.viewYear, this.viewMonth + 1, 0).getDate();
        const daysInPrevMonth = new Date(this.viewYear, this.viewMonth, 0).getDate();

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const selYear = this.selectedDate.getFullYear();
        const selMonth = this.selectedDate.getMonth();
        const selDay = this.selectedDate.getDate();

        let daysHtml = '';

        // Previous month trailing days
        for (let i = firstDayIndex - 1; i >= 0; i--) {
            const dayNum = daysInPrevMonth - i;
            const dateObj = new Date(this.viewYear, this.viewMonth - 1, dayNum);
            const isDisabled = this.minDate && dateObj < this.minDate;
            daysHtml += `
                <button type="button" class="custom-calendar-day other-month ${isDisabled ? 'disabled' : ''}" 
                    data-year="${this.viewYear}" data-month="${this.viewMonth - 1}" data-day="${dayNum}">
                    ${dayNum}
                </button>
            `;
        }

        // Current month days
        for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
            const dateObj = new Date(this.viewYear, this.viewMonth, dayNum);
            const isToday = dateObj.getTime() === today.getTime();
            const isSelected = selYear === this.viewYear && selMonth === this.viewMonth && selDay === dayNum;
            const isDisabled = this.minDate && dateObj < this.minDate;

            let classes = ['custom-calendar-day'];
            if (isToday) classes.push('today');
            if (isSelected) classes.push('selected');
            if (isDisabled) classes.push('disabled');

            daysHtml += `
                <button type="button" class="${classes.join(' ')}" 
                    data-year="${this.viewYear}" data-month="${this.viewMonth}" data-day="${dayNum}">
                    ${dayNum}
                </button>
            `;
        }

        // Next month leading days (fill up to 35 or 42 grid cells)
        const totalRendered = firstDayIndex + daysInMonth;
        const totalCells = totalRendered > 35 ? 42 : 35;
        const remainingCells = totalCells - totalRendered;
        for (let dayNum = 1; dayNum <= remainingCells; dayNum++) {
            const dateObj = new Date(this.viewYear, this.viewMonth + 1, dayNum);
            const isDisabled = this.minDate && dateObj < this.minDate;
            daysHtml += `
                <button type="button" class="custom-calendar-day other-month ${isDisabled ? 'disabled' : ''}" 
                    data-year="${this.viewYear}" data-month="${this.viewMonth + 1}" data-day="${dayNum}">
                    ${dayNum}
                </button>
            `;
        }

        this.dropdown.innerHTML = `
            <div class="custom-calendar-header">
                <span class="custom-calendar-title">${monthTitle}</span>
                <div class="custom-calendar-nav">
                    <button type="button" class="custom-calendar-nav-btn prev-month" aria-label="Предыдущий месяц">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                    </button>
                    <button type="button" class="custom-calendar-nav-btn next-month" aria-label="Следующий месяц">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                    </button>
                </div>
            </div>
            <div class="custom-calendar-weekdays">${weekdaysHtml}</div>
            <div class="custom-calendar-grid">${daysHtml}</div>
            <div class="custom-calendar-presets">
                <button type="button" class="custom-preset-btn" data-preset="today">Сегодня</button>
                <button type="button" class="custom-preset-btn" data-preset="tomorrow">Завтра</button>
                <button type="button" class="custom-preset-btn" data-preset="plus3">+3 дня</button>
                <button type="button" class="custom-preset-btn" data-preset="plus7">+1 неделя</button>
            </div>
        `;

        // Nav events
        this.dropdown.querySelector('.prev-month')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.prevMonth();
        });
        this.dropdown.querySelector('.next-month')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.nextMonth();
        });

        // Day click events
        this.dropdown.querySelectorAll('.custom-calendar-day:not(.disabled)').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const y = parseInt(btn.dataset.year, 10);
                const m = parseInt(btn.dataset.month, 10);
                const d = parseInt(btn.dataset.day, 10);
                this.selectDate(new Date(y, m, d));
                this.close();
            });
        });

        // Preset events
        this.dropdown.querySelectorAll('.custom-preset-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const preset = btn.dataset.preset;
                const targetDate = new Date();
                targetDate.setHours(0, 0, 0, 0);

                if (preset === 'tomorrow') {
                    targetDate.setDate(targetDate.getDate() + 1);
                } else if (preset === 'plus3') {
                    targetDate.setDate(targetDate.getDate() + 3);
                } else if (preset === 'plus7') {
                    targetDate.setDate(targetDate.getDate() + 7);
                }

                this.selectDate(targetDate);
                this.close();
            });
        });
    }

    prevMonth() {
        this.viewMonth--;
        if (this.viewMonth < 0) {
            this.viewMonth = 11;
            this.viewYear--;
        }
        this.renderCalendarGrid();
    }

    nextMonth() {
        this.viewMonth++;
        if (this.viewMonth > 11) {
            this.viewMonth = 0;
            this.viewYear++;
        }
        this.renderCalendarGrid();
    }

    selectDate(date) {
        this.selectedDate = new Date(date);
        this.valueDisplay.textContent = formatDateHuman(this.selectedDate);
        this.syncTargetInput();

        if (typeof this.onChange === 'function') {
            this.onChange(formatDateISO(this.selectedDate), this.selectedDate);
        }
    }

    syncTargetInput() {
        if (this.targetInput) {
            this.targetInput.value = formatDateISO(this.selectedDate);
            this.targetInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    setValue(dateStr) {
        const d = new Date(dateStr + 'T00:00:00');
        if (!isNaN(d.getTime())) {
            this.selectDate(d);
        }
    }

    getValue() {
        return formatDateISO(this.selectedDate);
    }
}

export class CustomTimePicker {
    /**
     * @param {Object} options
     * @param {HTMLElement} options.container - Container element to render picker into
     * @param {HTMLInputElement} [options.targetInput] - Hidden or synced input element (value: HH:MM)
     * @param {string} [options.initialValue] - Initial time string (HH:MM)
     * @param {Function} [options.onChange] - Callback on time change
     */
    constructor(options) {
        this.container = options.container;
        this.targetInput = options.targetInput;
        this.onChange = options.onChange;

        const initial = options.initialValue || '12:00';
        const [h, m] = initial.split(':').map(n => parseInt(n, 10) || 0);
        this.selectedHour = Math.min(Math.max(h, 0), 23);
        this.selectedMinute = Math.min(Math.max(m, 0), 59);
        this.isOpen = false;
        this.isAddingPreset = false;

        this.savedPresets = getSavedTimePresets();

        this.onDocClick = this.handleDocumentClick.bind(this);
        this.onKeyDown = this.handleKeyDown.bind(this);

        this.render();
        this.attachEvents();
    }

    render() {
        const formattedTime = this.getFormattedTime();
        this.container.innerHTML = `
            <div class="custom-picker-wrapper">
                <div class="custom-picker-trigger custom-time-trigger" aria-haspopup="dialog" aria-expanded="false">
                    <div class="custom-picker-trigger-content">
                        <span class="custom-picker-icon custom-time-toggle-btn" title="Выбрать время">
                            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        </span>
                        <input type="text" class="custom-time-direct-input" maxlength="5" value="${formattedTime}" placeholder="12:00" spellcheck="false" autocomplete="off" aria-label="Время отправки">
                    </div>
                    <span class="custom-picker-chevron custom-time-toggle-btn" title="Открыть выбор времени">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                    </span>
                </div>
                <div class="custom-picker-dropdown custom-time-picker-dropdown" style="display: none;"></div>
            </div>
        `;

        this.wrapper = this.container.querySelector('.custom-picker-wrapper');
        this.triggerEl = this.container.querySelector('.custom-picker-trigger');
        this.directInput = this.container.querySelector('.custom-time-direct-input');
        this.dropdown = this.container.querySelector('.custom-time-picker-dropdown');

        this.syncTargetInput();
    }

    attachEvents() {
        // Toggle dropdown when clicking trigger container, icon, or chevron
        this.triggerEl.addEventListener('click', (e) => {
            if (e.target === this.directInput) {
                // Focus direct input, open dropdown if not open
                if (!this.isOpen) this.open();
                return;
            }
            e.stopPropagation();
            this.toggle();
        });

        // Direct typing and auto-formatting
        this.directInput.addEventListener('input', (e) => {
            let val = e.target.value.replace(/[^0-9:]/g, '');
            if (val.length === 2 && !val.includes(':') && e.inputType !== 'deleteContentBackward') {
                val = val + ':';
            }
            e.target.value = val;

            const match = val.match(/^(\d{1,2}):(\d{1,2})$/);
            if (match) {
                const h = parseInt(match[1], 10);
                const m = parseInt(match[2], 10);
                if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
                    this.setTime(h, m, { updateDropdown: true, smoothScroll: false });
                }
            }
        });

        this.directInput.addEventListener('blur', () => {
            this.directInput.value = this.getFormattedTime();
        });
    }

    toggle() {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    open() {
        if (this.isOpen) return;

        // Close all other active pickers
        activePickers.forEach(p => {
            if (p !== this) p.close();
        });
        activePickers.add(this);

        this.isOpen = true;
        this.isAddingPreset = false;
        this.wrapper?.classList.add('active');
        this.triggerEl.classList.add('active');
        this.triggerEl.setAttribute('aria-expanded', 'true');
        this.renderTimeDropdown();
        // Make visible but hidden so getBoundingClientRect works, scroll, then reveal
        this.dropdown.style.visibility = 'hidden';
        this.dropdown.style.display = 'block';

        requestAnimationFrame(() => {
            this.scrollToSelected({ smooth: false });
            this.dropdown.style.visibility = '';
        });

        document.addEventListener('click', this.onDocClick);
        document.addEventListener('keydown', this.onKeyDown);
    }

    close() {
        if (!this.isOpen) return;
        activePickers.delete(this);

        this.isOpen = false;
        this.isAddingPreset = false;
        this.wrapper?.classList.remove('active');
        this.triggerEl.classList.remove('active');
        this.triggerEl.setAttribute('aria-expanded', 'false');
        this.dropdown.style.display = 'none';

        document.removeEventListener('click', this.onDocClick);
        document.removeEventListener('keydown', this.onKeyDown);
    }

    handleDocumentClick(e) {
        if (!this.container.contains(e.target)) {
            this.close();
        }
    }

    handleKeyDown(e) {
        if (e.key === 'Escape') {
            this.close();
        }
    }

    getFormattedTime() {
        const hh = String(this.selectedHour).padStart(2, '0');
        const mm = String(this.selectedMinute).padStart(2, '0');
        return `${hh}:${mm}`;
    }

    renderTimeDropdown() {
        const hh = String(this.selectedHour).padStart(2, '0');
        const mm = String(this.selectedMinute).padStart(2, '0');
        const currentFormatted = `${hh}:${mm}`;

        // Render Presets List & Custom User Times
        let presetsHtml = '';
        this.savedPresets.forEach(presetTime => {
            const isActive = presetTime === currentFormatted;
            presetsHtml += `
                <div class="custom-time-preset-pill ${isActive ? 'active' : ''}" data-preset="${presetTime}">
                    <span class="custom-time-preset-text">${presetTime}</span>
                    <button type="button" class="custom-time-preset-remove" data-remove="${presetTime}" title="Удалить пресет">×</button>
                </div>
            `;
        });

        // Add button / Inline Form
        const addPresetSection = this.isAddingPreset
            ? `
                <div class="custom-time-add-form">
                    <input type="text" class="custom-time-add-input" maxlength="5" value="${currentFormatted}" placeholder="ЧЧ:ММ" autofocus spellcheck="false">
                    <button type="button" class="custom-time-add-save" title="Сохранить время">✓</button>
                    <button type="button" class="custom-time-add-cancel" title="Отмена">✕</button>
                </div>
            `
            : `
                <button type="button" class="custom-time-add-trigger-btn" title="Добавить свое время для быстрого выбора">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    <span>Добавить</span>
                </button>
            `;

        // All 24 Hours: 00 to 23
        let hoursHtml = '';
        for (let h = 0; h < 24; h++) {
            const hStr = String(h).padStart(2, '0');
            const isSelected = h === this.selectedHour;
            hoursHtml += `
                <button type="button" class="custom-time-item ${isSelected ? 'selected' : ''}" data-hour="${h}">
                    ${hStr}
                </button>
            `;
        }

        // All 60 Minutes: 00 to 59
        let minutesHtml = '';
        for (let m = 0; m < 60; m++) {
            const mStr = String(m).padStart(2, '0');
            const isSelected = m === this.selectedMinute;
            minutesHtml += `
                <button type="button" class="custom-time-item ${isSelected ? 'selected' : ''}" data-minute="${m}">
                    ${mStr}
                </button>
            `;
        }

        this.dropdown.innerHTML = `
            <!-- Saved Presets Bar -->
            <div class="custom-time-presets-section">
                <div class="custom-time-presets-top">
                    <span class="custom-time-presets-title">Сохраненное время</span>
                    ${addPresetSection}
                </div>
                <div class="custom-time-presets-bar">${presetsHtml}</div>
            </div>

            <!-- Stepper HUD -->
            <div class="custom-time-stepper-header">
                <div class="custom-time-stepper-cell">
                    <button type="button" class="custom-time-step-btn step-hour-up" aria-label="Увеличить час">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
                    </button>
                    <span class="custom-time-stepper-value custom-time-stepper-value-hour">${hh}</span>
                    <button type="button" class="custom-time-step-btn step-hour-down" aria-label="Уменьшить час">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                    </button>
                </div>
                <span class="custom-time-stepper-colon">:</span>
                <div class="custom-time-stepper-cell">
                    <button type="button" class="custom-time-step-btn step-min-up" aria-label="Увеличить минуту">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
                    </button>
                    <span class="custom-time-stepper-value custom-time-stepper-value-min">${mm}</span>
                    <button type="button" class="custom-time-step-btn step-min-down" aria-label="Уменьшить минуту">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                    </button>
                </div>
            </div>

            <!-- Full Hours & Minutes Scroll Columns -->
            <div class="custom-time-columns-container">
                <div class="custom-time-column-wrapper">
                    <span class="custom-time-column-header">Часы (00-23)</span>
                    <div class="custom-time-column-list hours-list">${hoursHtml}</div>
                </div>
                <div class="custom-time-column-wrapper">
                    <span class="custom-time-column-header">Минуты (00-59)</span>
                    <div class="custom-time-column-list minutes-list">${minutesHtml}</div>
                </div>
            </div>

            <!-- Footer Quick Actions -->
            <div class="custom-time-footer">
                <button type="button" class="custom-preset-btn set-current-time-btn">Сейчас</button>
                <button type="button" class="custom-preset-btn custom-time-done-btn">Готово</button>
            </div>
        `;

        this.attachDropdownEvents();
    }

    attachDropdownEvents() {
        // Preset clicks
        this.dropdown.querySelectorAll('.custom-time-preset-pill').forEach(pill => {
            pill.addEventListener('click', (e) => {
                // If clicked remove button
                if (e.target.closest('.custom-time-preset-remove')) {
                    e.stopPropagation();
                    const toRemove = e.target.closest('.custom-time-preset-remove').dataset.remove;
                    this.removePreset(toRemove);
                    return;
                }
                e.stopPropagation();
                const presetTime = pill.dataset.preset;
                this.setValue(presetTime, { smoothScroll: false });
            });
        });

        // Add preset trigger
        this.dropdown.querySelector('.custom-time-add-trigger-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.isAddingPreset = true;
            this.renderTimeDropdown();
            const input = this.dropdown.querySelector('.custom-time-add-input');
            input?.focus();
            input?.select();
            this.scrollToSelected({ smooth: false });
        });

        // Save new preset
        const saveBtn = this.dropdown.querySelector('.custom-time-add-save');
        const addInput = this.dropdown.querySelector('.custom-time-add-input');
        const cancelBtn = this.dropdown.querySelector('.custom-time-add-cancel');

        const doSavePreset = () => {
            const val = addInput?.value?.trim();
            const match = val ? val.match(/^(\d{1,2}):(\d{1,2})$/) : null;
            if (match) {
                const h = parseInt(match[1], 10);
                const m = parseInt(match[2], 10);
                if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
                    const formatted = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                    this.addPreset(formatted);
                    this.isAddingPreset = false;
                    this.setTime(h, m, { updateDropdown: false });
                    this.renderTimeDropdown();
                    this.scrollToSelected({ smooth: false });
                }
            }
        };

        saveBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            doSavePreset();
        });

        addInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.stopPropagation();
                doSavePreset();
            } else if (e.key === 'Escape') {
                e.stopPropagation();
                this.isAddingPreset = false;
                this.renderTimeDropdown();
                this.scrollToSelected({ smooth: false });
            }
        });

        cancelBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.isAddingPreset = false;
            this.renderTimeDropdown();
            this.scrollToSelected({ smooth: false });
        });

        // Steppers — Target update without destroying DOM
        this.dropdown.querySelector('.step-hour-up')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.setTime((this.selectedHour + 1) % 24, this.selectedMinute, { smoothScroll: true });
        });
        this.dropdown.querySelector('.step-hour-down')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.setTime((this.selectedHour - 1 + 24) % 24, this.selectedMinute, { smoothScroll: true });
        });
        this.dropdown.querySelector('.step-min-up')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.setTime(this.selectedHour, (this.selectedMinute + 1) % 60, { smoothScroll: true });
        });
        this.dropdown.querySelector('.step-min-down')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.setTime(this.selectedHour, (this.selectedMinute - 1 + 60) % 60, { smoothScroll: true });
        });

        // Hour clicks
        this.dropdown.querySelectorAll('.hours-list .custom-time-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const h = parseInt(item.dataset.hour, 10);
                this.setTime(h, this.selectedMinute, { smoothScroll: true });
            });
        });

        // Minute clicks
        this.dropdown.querySelectorAll('.minutes-list .custom-time-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const m = parseInt(item.dataset.minute, 10);
                this.setTime(this.selectedHour, m, { smoothScroll: true });
            });
        });

        // Current time button
        this.dropdown.querySelector('.set-current-time-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const now = new Date();
            this.setTime(now.getHours(), now.getMinutes(), { smoothScroll: true });
        });

        // Done button
        this.dropdown.querySelector('.custom-time-done-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.close();
        });
    }

    updateDropdownValues({ smoothScroll = false } = {}) {
        if (!this.dropdown) return;

        const hh = String(this.selectedHour).padStart(2, '0');
        const mm = String(this.selectedMinute).padStart(2, '0');
        const currentFormatted = `${hh}:${mm}`;

        // 1. Update Stepper HUD text
        const hourVal = this.dropdown.querySelector('.custom-time-stepper-value-hour');
        const minVal = this.dropdown.querySelector('.custom-time-stepper-value-min');
        if (hourVal) hourVal.textContent = hh;
        if (minVal) minVal.textContent = mm;

        // 2. Update list items selection
        this.dropdown.querySelectorAll('.hours-list .custom-time-item').forEach(item => {
            const h = parseInt(item.dataset.hour, 10);
            item.classList.toggle('selected', h === this.selectedHour);
        });

        this.dropdown.querySelectorAll('.minutes-list .custom-time-item').forEach(item => {
            const m = parseInt(item.dataset.minute, 10);
            item.classList.toggle('selected', m === this.selectedMinute);
        });

        // 3. Update preset active states
        this.dropdown.querySelectorAll('.custom-time-preset-pill').forEach(pill => {
            pill.classList.toggle('active', pill.dataset.preset === currentFormatted);
        });

        // 4. Scroll to item without rebuilding DOM
        this.scrollToSelected({ smooth: smoothScroll });
    }

    addPreset(timeStr) {
        if (!this.savedPresets.includes(timeStr)) {
            this.savedPresets.push(timeStr);
            this.savedPresets.sort();
            saveTimePresets(this.savedPresets);
        }
    }

    removePreset(timeStr) {
        this.savedPresets = this.savedPresets.filter(p => p !== timeStr);
        saveTimePresets(this.savedPresets);
        this.renderTimeDropdown();
        this.scrollToSelected({ smooth: false });
    }

    scrollToSelected({ smooth = false } = {}) {
        const scrollColumn = (listEl, selectedItem) => {
            if (!listEl || !selectedItem || typeof listEl.getBoundingClientRect !== 'function' || typeof selectedItem.getBoundingClientRect !== 'function') return;
            const listRect = listEl.getBoundingClientRect();
            const itemRect = selectedItem.getBoundingClientRect();
            // Position of item relative to list's current scroll position
            const relativeTop = listEl.scrollTop + itemRect.top - listRect.top;
            const itemHeight = itemRect.height || 32;
            const containerHeight = listEl.clientHeight;
            const targetScrollTop = relativeTop - (containerHeight / 2) + (itemHeight / 2);
            if (smooth) {
                listEl.scrollTo({ top: Math.max(0, targetScrollTop), behavior: 'smooth' });
            } else {
                listEl.scrollTop = Math.max(0, targetScrollTop);
            }
        };

        const hoursList = this.dropdown.querySelector('.hours-list');
        const minutesList = this.dropdown.querySelector('.minutes-list');
        const selHour = hoursList?.querySelector('.custom-time-item.selected');
        const selMinute = minutesList?.querySelector('.custom-time-item.selected');

        scrollColumn(hoursList, selHour);
        scrollColumn(minutesList, selMinute);
    }

    setTime(hour, minute, { updateDropdown = true, smoothScroll = false } = {}) {
        this.selectedHour = Math.min(Math.max(hour, 0), 23);
        this.selectedMinute = Math.min(Math.max(minute, 0), 59);
        const formatted = this.getFormattedTime();
        if (this.directInput) {
            this.directInput.value = formatted;
        }
        this.syncTargetInput();

        if (updateDropdown && this.isOpen) {
            this.updateDropdownValues({ smoothScroll });
        }

        if (typeof this.onChange === 'function') {
            this.onChange(formatted, { hour: this.selectedHour, minute: this.selectedMinute });
        }
    }

    syncTargetInput() {
        if (this.targetInput) {
            this.targetInput.value = this.getFormattedTime();
            this.targetInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    setValue(timeStr, { smoothScroll = false } = {}) {
        if (!timeStr) return;
        const [h, m] = timeStr.split(':').map(Number);
        if (!isNaN(h) && !isNaN(m)) {
            this.setTime(h, m, { updateDropdown: true, smoothScroll });
        }
    }

    getValue() {
        return this.getFormattedTime();
    }
}
