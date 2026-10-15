/** Accessible, reusable presentation for page-owned native sorting selects. */
class SortControl {
    static instances = new WeakMap();
    static current = null;
    static nextId = 0;

    static enhance(select, options = {}) {
        if (!select || select.tagName !== 'SELECT') return null;
        return SortControl.instances.get(select) || new SortControl(select, options);
    }

    constructor(select, options = {}) {
        this.hiddenSelect = select;
        this.settings = options;
        this.document = select.ownerDocument;
        this.window = this.document.defaultView;
        this.isOpen = false;
        this.destroyed = false;
        this.activeIndex = -1;
        this.typeBuffer = '';
        this.listeners = [];
        this.original = { hidden: select.hidden, tabIndex: select.getAttribute('tabindex'), nativeClass: select.classList.contains('sort-control__native') };
        const id = `sort-control-${++SortControl.nextId}`;
        this.element = this.document.createElement('div');
        this.element.className = 'sort-control';
        this.trigger = this.document.createElement('button');
        this.trigger.type = 'button';
        this.trigger.id = `${id}-trigger`;
        this.trigger.className = 'sort-control__trigger';
        this.trigger.setAttribute('role', 'combobox');
        this.trigger.setAttribute('aria-haspopup', 'listbox');
        this.trigger.setAttribute('aria-expanded', 'false');
        this.trigger.setAttribute('aria-controls', `${id}-list`);
        this.valueLabel = this.document.createElement('span');
        this.valueLabel.className = 'sort-control__value';
        const chevron = this.document.createElement('span');
        chevron.className = 'sort-control__chevron';
        chevron.setAttribute('aria-hidden', 'true');
        this.trigger.append(this.valueLabel, chevron);
        this.hint = this.document.createElement('span');
        this.hint.className = 'sort-control__hint';
        this.hint.id = `${id}-hint`;
        this.hint.hidden = true;
        this.element.append(this.trigger, this.hint);
        select.after(this.element);
        select.hidden = true;
        select.classList.add('sort-control__native');
        select.tabIndex = -1;
        this.list = this.document.createElement('div');
        this.list.id = `${id}-list`;
        this.list.className = 'sort-control__list';
        this.list.setAttribute('role', 'listbox');
        this.list.hidden = true;
        this.portalParent = select.closest('[role="dialog"][aria-modal="true"]') || this.document.body;
        this.portalParent.append(this.list);
        this.listen(this.trigger, 'click', () => this.isOpen ? this.close() : this.open());
        this.listen(this.trigger, 'keydown', event => this.onKeyDown(event));
        this.listen(select, 'change', () => this.syncFromNative());
        this.listen(this.list, 'click', event => {
            const option = event.target.closest('[role="option"]');
            if (option && this.list.contains(option)) this.commit(Number(option.dataset.index));
        });
        this.listen(this.list, 'pointerdown', event => event.preventDefault());
        this.listen(this.document, 'pointerdown', event => {
            if (!this.element.contains(event.target) && !this.list.contains(event.target)) this.close();
        });
        this.listen(this.trigger, 'blur', () => this.close());
        this.listen(this.document, 'click', event => {
            const label = event.target.closest?.('label');
            if (label?.control === select) {
                event.preventDefault();
                this.trigger.focus();
            }
        });
        this.listen(this.window, 'resize', () => this.position());
        this.listen(this.document, 'scroll', event => {
            if (!this.list.contains(event.target)) this.position();
        }, true);
        this.observer = new this.window.MutationObserver(() => this.syncFromNative());
        this.observer.observe(select, { childList: true, subtree: true, characterData: true, attributes: true });
        SortControl.instances.set(select, this);
        this.syncFromNative();
    }

    listen(target, type, handler, capture = false) {
        target.addEventListener(type, handler, capture);
        this.listeners.push(() => target.removeEventListener(type, handler, capture));
    }

    syncFromNative() {
        if (this.destroyed) return;
        const select = this.hiddenSelect;
        this.options = Array.from(select.options);
        this.valueLabel.textContent = this.options[select.selectedIndex]?.textContent || '';
        this.trigger.disabled = select.disabled;
        const labels = Array.from(select.labels || []);
        const labelledBy = select.getAttribute('aria-labelledby') || labels.map((label, index) => {
            // A wrapping label now contains the trigger: reference its text-only
            // caption instead, so the accessible name cannot recurse into itself.
            const caption = label.contains(this.trigger)
                ? Array.from(label.children).find(child => child.tagName === 'SPAN' && !child.contains(select) && !child.contains(this.trigger))
                : label;
            if (!caption) return '';
            if (!caption.id) caption.id = `${this.trigger.id}-label-${index}`;
            return caption.id;
        }).join(' ');
        if (labelledBy) this.trigger.setAttribute('aria-labelledby', `${labelledBy} ${this.trigger.id}`);
        else this.trigger.removeAttribute('aria-labelledby');
        if (labelledBy) this.list.setAttribute('aria-labelledby', labelledBy);
        else this.list.removeAttribute('aria-labelledby');
        const ariaLabel = select.getAttribute('aria-label');
        if (ariaLabel) this.trigger.setAttribute('aria-label', `${ariaLabel}: ${this.valueLabel.textContent}`);
        else this.trigger.removeAttribute('aria-label');
        this.list.setAttribute('aria-label', ariaLabel || this.valueLabel.textContent);
        const describedBy = [select.getAttribute('aria-describedby'), !this.hint.hidden && this.hint.id].filter(Boolean).join(' ');
        if (describedBy) this.trigger.setAttribute('aria-describedby', describedBy);
        else this.trigger.removeAttribute('aria-describedby');
        this.list.replaceChildren(...this.options.map((option, index) => {
            const item = this.document.createElement('div');
            item.className = 'sort-control__option';
            item.id = `${this.list.id}-${index}`;
            item.dataset.index = String(index);
            item.setAttribute('role', 'option');
            item.setAttribute('aria-selected', String(option.selected));
            item.setAttribute('aria-disabled', String(this.optionDisabled(index)));
            item.textContent = option.textContent;
            return item;
        }));
        if (select.disabled || !this.enabledIndices().length) this.close();
        if (this.isOpen) {
            this.setActive(this.optionDisabled(this.activeIndex) ? this.firstEnabled() : this.activeIndex);
            this.position();
        }
    }

    optionDisabled(index) {
        const option = this.options[index];
        return !option || option.disabled || (option.parentElement.tagName === 'OPTGROUP' && option.parentElement.disabled);
    }

    enabledIndices() { return this.options.map((_, index) => index).filter(index => !this.optionDisabled(index)); }
    firstEnabled() { return this.enabledIndices()[0] ?? -1; }

    open() {
        if (this.destroyed || this.hiddenSelect.disabled) return;
        this.settings.onBeforeOpen?.();
        this.syncFromNative();
        if (this.hiddenSelect.disabled || !this.enabledIndices().length) return;
        if (SortControl.current && SortControl.current !== this) SortControl.current.close();
        SortControl.current = this;
        this.isOpen = true;
        this.list.hidden = false;
        this.trigger.setAttribute('aria-expanded', 'true');
        this.trigger.focus();
        this.position();
        if (this.isOpen) this.setActive(this.optionDisabled(this.hiddenSelect.selectedIndex) ? this.firstEnabled() : this.hiddenSelect.selectedIndex);
    }

    close() {
        this.isOpen = false;
        this.list.hidden = true;
        this.trigger.setAttribute('aria-expanded', 'false');
        this.trigger.removeAttribute('aria-activedescendant');
        this.typeBuffer = '';
        this.window.clearTimeout(this.typeTimer);
        if (SortControl.current === this) SortControl.current = null;
    }

    focus() { this.trigger.focus(); }

    setActive(index) {
        this.activeIndex = index;
        Array.from(this.list.children).forEach((item, itemIndex) => item.classList.toggle('sort-control__option--active', itemIndex === index));
        const item = this.list.children[index];
        if (item) {
            this.trigger.setAttribute('aria-activedescendant', item.id);
            // Scroll this popup only; scrollIntoView can also move the document
            // (especially before a freshly opened fixed popup is positioned).
            const top = item.offsetTop;
            const bottom = top + item.offsetHeight;
            if (top < this.list.scrollTop) this.list.scrollTop = top;
            else if (bottom > this.list.scrollTop + this.list.clientHeight) {
                this.list.scrollTop = Math.max(0, bottom - this.list.clientHeight);
            }
        }
    }

    commit(index) {
        if (this.hiddenSelect.disabled || this.optionDisabled(index)) return;
        this.setValue(this.options[index].value, { emit: true });
        this.close();
        this.trigger.focus();
    }

    setValue(value, { emit = false } = {}) {
        const index = this.options.findIndex(option => option.value === String(value));
        if (index < 0) return false;
        const changed = this.hiddenSelect.value !== String(value);
        this.hiddenSelect.value = String(value);
        this.syncFromNative();
        if (changed && emit) this.hiddenSelect.dispatchEvent(new this.window.Event('change', { bubbles: true }));
        return true;
    }

    setOptions(options) {
        const value = this.hiddenSelect.value;
        this.hiddenSelect.replaceChildren(...options.map(({ value: optionValue, label, labelKey, disabled }) => {
            const option = this.document.createElement('option');
            option.value = String(optionValue);
            option.textContent = label;
            option.disabled = Boolean(disabled);
            if (labelKey) option.dataset.i18n = labelKey;
            return option;
        }));
        if (Array.from(this.hiddenSelect.options).some(option => option.value === value)) this.hiddenSelect.value = value;
        this.syncFromNative();
    }

    setDisabled(disabled, reason = '') {
        this.hiddenSelect.disabled = Boolean(disabled);
        this.hint.textContent = reason;
        this.hint.hidden = !disabled || !reason;
        this.syncFromNative();
    }

    onKeyDown(event) {
        if (this.trigger.disabled || event.altKey || event.ctrlKey || event.metaKey) return;
        const { key } = event;
        if (key === 'Tab') {
            if (this.isOpen) this.commit(this.activeIndex);
            return;
        }
        if (key === 'Escape' && this.isOpen) {
            event.preventDefault();
            event.stopPropagation();
            this.close();
            this.trigger.focus();
            return;
        }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(key)) {
            event.preventDefault();
            if (!this.isOpen) {
                this.open();
                if (key === 'Home') this.setActive(this.firstEnabled());
                if (key === 'End') this.setActive(this.enabledIndices().at(-1));
                return;
            }
            if (key === 'Enter' || key === ' ') { this.commit(this.activeIndex); return; }
            const indices = this.enabledIndices();
            const current = indices.indexOf(this.activeIndex);
            const next = key === 'Home' ? indices[0] : key === 'End' ? indices.at(-1) : indices[Math.max(0, Math.min(indices.length - 1, current + (key === 'ArrowDown' ? 1 : -1)))];
            this.setActive(next);
        } else if (key.length === 1) {
            event.preventDefault();
            if (!this.isOpen) this.open();
            this.window.clearTimeout(this.typeTimer);
            this.typeBuffer += key.toLocaleLowerCase();
            const repeated = Array.from(this.typeBuffer).every(character => character === this.typeBuffer[0]);
            const prefix = repeated ? this.typeBuffer[0] : this.typeBuffer;
            const indices = this.enabledIndices();
            const start = repeated ? indices.indexOf(this.activeIndex) + 1 : 0;
            const ordered = indices.slice(start).concat(indices.slice(0, start));
            const match = ordered.find(index => this.options[index].textContent.trim().toLocaleLowerCase().startsWith(prefix));
            if (match !== undefined) this.setActive(match);
            this.typeTimer = this.window.setTimeout(() => { this.typeBuffer = ''; }, 700);
        }
    }

    position() {
        if (!this.isOpen) return;
        const rect = this.trigger.getBoundingClientRect();
        const width = this.window.innerWidth;
        const height = this.window.innerHeight;
        if (rect.bottom <= 0 || rect.top >= height || rect.right <= 0 || rect.left >= width || !this.trigger.isConnected) { this.close(); return; }
        const margin = 8;
        const below = Math.max(0, height - rect.bottom - margin * 2);
        const above = Math.max(0, rect.top - margin * 2);
        const desired = Math.min(320, this.list.scrollHeight || 320);
        const openAbove = below < desired && above > below;
        const maxHeight = Math.min(320, openAbove ? above : below);
        this.list.style.width = `${Math.max(0, Math.min(Math.max(rect.width, 240), width - margin * 2))}px`;
        this.list.style.maxHeight = `${maxHeight}px`;
        const listWidth = Number.parseFloat(this.list.style.width);
        this.list.style.left = `${Math.max(margin, Math.min(rect.left, width - listWidth - margin))}px`;
        this.list.style.top = `${openAbove ? Math.max(margin, rect.top - Math.min(this.list.scrollHeight || desired, maxHeight) - margin) : rect.bottom + margin}px`;
    }

    destroy() {
        if (this.destroyed) return;
        this.close();
        this.destroyed = true;
        this.observer.disconnect();
        this.listeners.splice(0).forEach(remove => remove());
        this.element.remove();
        this.list.remove();
        this.hiddenSelect.hidden = this.original.hidden;
        if (!this.original.nativeClass) this.hiddenSelect.classList.remove('sort-control__native');
        if (this.original.tabIndex === null) this.hiddenSelect.removeAttribute('tabindex');
        else this.hiddenSelect.setAttribute('tabindex', this.original.tabIndex);
        SortControl.instances.delete(this.hiddenSelect);
    }
}

if (typeof window !== 'undefined') window.SortControl = SortControl;
if (typeof module !== 'undefined' && module.exports) module.exports = SortControl;
