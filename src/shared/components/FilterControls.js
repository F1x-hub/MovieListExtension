/** Shared include/exclude choices and bounded range editors. */
class FilterChoice {
    static settings = new WeakMap();
    static groups = new WeakMap();
    static disclosures = new WeakMap();
    static summaries = new WeakMap();
    static nextId = 0;
    static defaultLabels = { neutral: 'Не выбрано', include: 'Включить', exclude: 'Исключить' };

    static create({ label, value, id, state = 'neutral', className = '', onChange, labels = {}, document: ownerDocument = document }) {
        const button = ownerDocument.createElement('button');
        button.type = 'button';
        button.className = `filter-choice ${className}`.trim();
        if (id) button.id = id;
        button.dataset.value = String(value ?? '');
        button.dataset.filterValue = String(value ?? '');
        if (id !== undefined) button.dataset.filterId = String(id);
        const text = ownerDocument.createElement('span');
        text.className = 'tag-text';
        text.textContent = label;
        const icon = ownerDocument.createElement('span');
        icon.className = 'tag-status-icon';
        icon.setAttribute('aria-hidden', 'true');
        const description = ownerDocument.createElement('span');
        description.className = 'filter-choice__description';
        description.id = `filter-choice-description-${++FilterChoice.nextId}`;
        button.setAttribute('aria-label', text.textContent);
        button.setAttribute('aria-describedby', description.id);
        button.append(text, icon, description);
        FilterChoice.settings.set(button, { labels: { ...FilterChoice.defaultLabels, ...labels }, onChange, description });
        FilterChoice.setState(button, state);
        button.addEventListener('click', () => {
            const next = { neutral: 'include', include: 'exclude', exclude: 'neutral' }[button.dataset.state];
            FilterChoice.setState(button, next, { emit: true });
        });
        return button;
    }

    static setState(button, state, { emit = false } = {}) {
        if (!button) return;
        const next = ['neutral', 'include', 'exclude'].includes(state) ? state : 'neutral';
        const changed = button.dataset.state !== next;
        const settings = FilterChoice.settings.get(button) || { labels: FilterChoice.defaultLabels };
        button.dataset.state = next;
        button.dataset.filterState = next;
        for (const prefix of ['state', 'filter']) {
            button.classList.toggle(`${prefix}-include`, next === 'include');
            button.classList.toggle(`${prefix}-exclude`, next === 'exclude');
        }
        const label = button.querySelector('.tag-text')?.textContent || '';
        button.setAttribute('aria-label', label);
        button.setAttribute('aria-pressed', String(next !== 'neutral'));
        const description = settings.description || button.querySelector('.filter-choice__description');
        if (description) description.textContent = settings.labels[next];
        const icon = button.querySelector('.tag-status-icon');
        if (icon) icon.textContent = { neutral: '', include: '✓', exclude: '×' }[next];
        FilterChoice.refreshDisclosure(button.closest('.filter-choices'));
        FilterChoice.refreshSummary(button.closest('.filter-choices'));
        if (changed && emit) {
            const group = button.closest('.filter-choices');
            const liveRegion = Array.from(group?.children || []).find(child => child.classList.contains('filter-choices__status'));
            if (liveRegion) liveRegion.textContent = `${label}: ${settings.labels[next]}`;
            settings.onChange?.(next, button);
            const view = button.ownerDocument.defaultView;
            button.dispatchEvent(new view.Event('change', { bubbles: true }));
        }
    }

    static enhanceGroup(container, { label, labels = {}, legendLabels = {}, showLegend = true, legendId = null, compactLimit = 0, moreLabel = 'Ещё {count}', lessLabel = 'Свернуть' } = {}) {
        if (!container) return null;
        const states = { ...FilterChoice.defaultLabels, ...labels };
        container.classList.add('filter-choices');
        container.setAttribute('role', 'group');
        if (label) container.setAttribute('aria-label', label);
        let legend = FilterChoice.groups.get(container);
        if (showLegend && (!legend || legend.parentElement !== container)) {
            legend = container.ownerDocument.createElement('div');
            legend.className = 'filter-choices__legend';
            legend.id = `filter-choice-legend-${++FilterChoice.nextId}`;
            FilterChoice.groups.set(container, legend);
            container.prepend(legend);
        }
        if (showLegend) {
            const visibleStates = { ...states, ...legendLabels };
            legend.replaceChildren();
            ['neutral', 'include', 'exclude'].forEach((state, index) => {
                if (index) legend.append(container.ownerDocument.createTextNode(' → '));
                const sample = container.ownerDocument.createElement('span');
                sample.className = `filter-choices__sample filter-choices__sample--${state}`;
                sample.textContent = `${state === 'include' ? '✓ ' : state === 'exclude' ? '× ' : ''}${visibleStates[state]}`;
                legend.append(sample);
            });
        }
        let liveRegion = Array.from(container.children).find(child => child.classList.contains('filter-choices__status'));
        if (!liveRegion) {
            liveRegion = container.ownerDocument.createElement('div');
            liveRegion.className = 'filter-choices__status';
            liveRegion.setAttribute('aria-live', 'polite');
            liveRegion.setAttribute('aria-atomic', 'true');
            container.append(liveRegion);
        }
        const described = new Set((container.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
        Array.from(described).filter(id => id.startsWith('filter-choice-legend-')).forEach(id => described.delete(id));
        const descriptionId = showLegend ? legend.id : legendId;
        if (descriptionId) described.add(descriptionId);
        container.setAttribute('aria-describedby', Array.from(described).join(' '));
        container.querySelectorAll('.filter-choice').forEach(button => {
            const settings = FilterChoice.settings.get(button);
            if (settings) settings.labels = states;
            FilterChoice.setState(button, button.dataset.state);
        });
        FilterChoice.configureDisclosure(container, { compactLimit, moreLabel, lessLabel });
        return container;
    }

    /** Compact long mobile lists without hiding active filters or changing values. */
    static configureDisclosure(container, { compactLimit, moreLabel, lessLabel }) {
        const choices = Array.from(container.children).filter(child => child.classList.contains('filter-choice'));
        let disclosure = FilterChoice.disclosures.get(container);
        if (compactLimit < 1 || choices.length <= compactLimit) {
            disclosure?.button.remove();
            container.classList.remove('filter-choices--collapsible', 'filter-choices--expanded');
            choices.forEach(choice => choice.removeAttribute('data-filter-overflow'));
            FilterChoice.disclosures.delete(container);
            return;
        }
        if (!disclosure) {
            const button = container.ownerDocument.createElement('button');
            button.type = 'button';
            button.className = 'filter-choices__more';
            if (!container.id) container.id = `filter-choice-group-${++FilterChoice.nextId}`;
            button.setAttribute('aria-controls', container.id);
            disclosure = { button, expanded: false };
            FilterChoice.disclosures.set(container, disclosure);
            button.addEventListener('click', () => {
                disclosure.expanded = !disclosure.expanded;
                FilterChoice.refreshDisclosure(container);
            });
        }
        Object.assign(disclosure, { compactLimit, moreLabel, lessLabel });
        container.classList.add('filter-choices--collapsible');
        container.append(disclosure.button);
        FilterChoice.refreshDisclosure(container);
    }

    static refreshDisclosure(container) {
        const disclosure = FilterChoice.disclosures.get(container);
        if (!disclosure) return;
        const activeElement = container.ownerDocument.activeElement;
        const choices = Array.from(container.children).filter(child => child.classList.contains('filter-choice'));
        choices.forEach((choice, index) => choice.toggleAttribute('data-filter-overflow', index >= disclosure.compactLimit));
        const hiddenChoices = choices.slice(disclosure.compactLimit).filter(choice => choice.dataset.state === 'neutral');
        disclosure.button.textContent = disclosure.expanded ? disclosure.lessLabel : disclosure.moreLabel.replace('{count}', hiddenChoices.length);
        disclosure.button.setAttribute('aria-expanded', String(disclosure.expanded));
        disclosure.button.hidden = !disclosure.expanded && hiddenChoices.length === 0;
        container.classList.toggle('filter-choices--expanded', disclosure.expanded);
        if (disclosure.button.hidden && activeElement === disclosure.button) choices[0]?.focus();
        if (!disclosure.expanded && hiddenChoices.includes(activeElement)
            && container.ownerDocument.defaultView.matchMedia?.('(max-width: 600px)').matches) {
            disclosure.button.focus();
        }
    }

    static enhanceSummary(container, labels) {
        const summary = container.closest('.filter-disclosure')?.querySelector('.filter-disclosure__selection');
        if (!summary) return;
        FilterChoice.summaries.set(container, { summary, ...labels });
        FilterChoice.refreshSummary(container);
    }

    static refreshSummary(container) {
        const settings = FilterChoice.summaries.get(container);
        if (!settings) return;
        const selected = Array.from(container.querySelectorAll('.filter-choice')).filter(choice => choice.dataset.state !== 'neutral');
        const names = selected.map(choice => `${choice.dataset.state === 'include' ? '✓' : '×'} ${choice.querySelector('.tag-text').textContent}`);
        const counts = ['include', 'exclude'].map(state => {
            const count = selected.filter(choice => choice.dataset.state === state).length;
            return count ? settings[state].replace('{count}', count) : '';
        }).filter(Boolean);
        settings.summary.textContent = selected.length <= 2 ? names.join(' · ') || settings.empty : counts.join(' · ');
        settings.summary.title = names.join(' · ');
    }

    /** Style page-owned single selections without taking over their events. */
    static enhanceSingleGroup(container, { selector = 'button, a', label } = {}) {
        if (!container) return null;
        container.classList.add('filter-choices');
        if (!['NAV', 'UL', 'OL'].includes(container.tagName) && !container.hasAttribute('role')) container.setAttribute('role', 'group');
        if (label) container.setAttribute('aria-label', label);
        container.querySelectorAll(selector).forEach(item => item.classList.add('filter-choice'));
        return container;
    }

    static syncSingleGroup(container, { value, attribute = 'data-value', selector = 'button, a' } = {}) {
        if (!container) return;
        container.querySelectorAll(selector).forEach(item => {
            const selected = item.getAttribute(attribute) === String(value);
            item.classList.toggle('is-active', selected);
            if (item.tagName === 'BUTTON') item.setAttribute('aria-pressed', String(selected));
            else if (item.tagName === 'A') {
                if (selected) item.setAttribute('aria-current', 'true');
                else item.removeAttribute('aria-current');
            }
        });
    }
}

class RangeControl {
    static instances = new WeakMap();
    static nextId = 0;

    static enhance(from, to, options = {}) {
        if (!from || !to) return null;
        const existing = RangeControl.instances.get(from);
        if (existing) {
            existing.updateOptions(options);
            return existing;
        }
        return new RangeControl(from, to, options);
    }

    constructor(from, to, options) {
        this.from = from;
        this.to = to;
        this.options = { ...options };
        this.document = from.ownerDocument;
        this.isSlider = from.type === 'range' && to.type === 'range';
        this.listeners = [];
        this.destroyed = false;
        this.original = [from, to].map(input => ({ input, className: input.className, label: input.getAttribute('aria-label'), min: input.getAttribute('min'), max: input.getAttribute('max') }));
        const fromHost = from.closest('.number-stepper') || from;
        const sharedParent = fromHost.parentElement?.contains(to) ? fromHost.parentElement : null;
        this.element = sharedParent || from.parentElement;
        this.hadRangeClass = this.element.classList.contains('filter-range');
        this.element.classList.add('filter-range');
        [from, to].forEach((input, index) => {
            input.classList.add(this.isSlider ? 'filter-range__slider' : 'filter-field');
            const label = index === 0 ? options.fromLabel : options.toLabel;
            if (label) input.setAttribute('aria-label', label);
            if (Number.isFinite(options.min)) input.min = String(options.min);
            if (Number.isFinite(options.max)) input.max = String(options.max);
        });
        this.baseBounds = [from, to].map(input => ({ min: input.min, max: input.max }));
        if (this.isSlider) {
            this.fields = this.document.createElement('div');
            this.fields.className = 'filter-range__fields';
            const id = ++RangeControl.nextId;
            this.numberFields = [from, to].map((source, index) => {
                const label = this.document.createElement('label');
                label.className = 'filter-range__field-label';
                const caption = this.document.createElement('span');
                caption.textContent = (index === 0 ? options.fromFieldLabel : options.toFieldLabel) || (index === 0 ? 'От' : 'До');
                const input = this.document.createElement('input');
                input.type = 'number';
                input.id = `filter-range-${id}-${index}`;
                input.className = 'filter-field';
                const accessibleLabel = index === 0 ? options.fromLabel : options.toLabel;
                if (accessibleLabel) input.setAttribute('aria-label', accessibleLabel);
                input.step = source.step || '1';
                input.min = source.min;
                input.max = source.max;
                label.append(caption, input);
                this.fields.append(label);
                this.listen(input, 'input', () => {
                    const value = Number(input.value);
                    const { min, max } = this.bounds(source);
                    if (!input.value.trim() || !Number.isFinite(value) || value < min || value > max || source.disabled) return;
                    const otherValue = this.read(index === 0 ? this.to : this.from);
                    const gap = Math.max(0, Number(this.options.minGap) || 0);
                    if (otherValue !== null && (index === 0 ? otherValue - value : value - otherValue) < gap) return;
                    source.value = String(value);
                    source.dispatchEvent(new this.document.defaultView.Event('input', { bubbles: true }));
                });
                this.listen(input, 'change', () => {
                    if (source.disabled) return;
                    const value = Number(input.value);
                    if (input.value.trim() && Number.isFinite(value)) source.value = String(value);
                    this.normalize(source);
                    this.render();
                    source.dispatchEvent(new this.document.defaultView.Event('input', { bubbles: true }));
                    source.dispatchEvent(new this.document.defaultView.Event('change', { bubbles: true }));
                });
                return input;
            });
            this.element.before(this.fields);
        }
        [from, to].forEach(input => {
            this.listen(input, 'input', () => {
                if (this.isSlider) this.normalize(input);
                this.render(true);
            });
            this.listen(input, 'change', () => {
                this.normalize(input);
                this.render();
                this.commit();
            });
        });
        RangeControl.instances.set(from, this);
        this.syncFromNative();
    }

    listen(input, type, callback) {
        input.addEventListener(type, callback);
        this.listeners.push(() => input.removeEventListener(type, callback));
    }

    updateOptions(options = {}) {
        this.options = { ...this.options, ...options };
        [this.from, this.to].forEach((input, index) => {
            const label = index === 0 ? this.options.fromLabel : this.options.toLabel;
            if (label) input.setAttribute('aria-label', label);
            else {
                const original = this.original[index].label;
                if (original === null) input.removeAttribute('aria-label');
                else input.setAttribute('aria-label', original);
            }
        });
        this.numberFields?.forEach((input, index) => {
            const caption = input.closest('.filter-range__field-label')?.querySelector(':scope > span');
            if (caption) caption.textContent = (index === 0 ? this.options.fromFieldLabel : this.options.toFieldLabel) || (index === 0 ? 'От' : 'До');
            const accessibleLabel = index === 0 ? this.options.fromLabel : this.options.toLabel;
            if (accessibleLabel) input.setAttribute('aria-label', accessibleLabel);
            else input.removeAttribute('aria-label');
        });
        this.render();
        return this;
    }

    bounds(input) {
        const index = input === this.to ? 1 : 0;
        const { min: rawMin, max: rawMax } = this.baseBounds[index];
        const min = rawMin === '' ? -Infinity : Number(rawMin);
        const max = rawMax === '' ? Infinity : Number(rawMax);
        return { min: Number.isFinite(min) ? min : -Infinity, max: Number.isFinite(max) ? max : Infinity };
    }

    read(input) {
        if (!input.value.trim()) return null;
        const value = Number(input.value);
        return Number.isFinite(value) ? value : null;
    }

    normalizedValue(input, value, rounding = 'round') {
        if (value === null) return null;
        const { min, max } = this.bounds(input);
        let next = Math.max(min, Math.min(max, value));
        const step = input.step === 'any' ? 0 : Number(input.step || '1');
        if (Number.isFinite(step) && step > 0) {
            const base = Number.isFinite(min) ? min : 0;
            next = base + Math[rounding]((next - base) / step) * step;
            next = Number(next.toFixed(10));
        }
        return Math.max(min, Math.min(max, next));
    }

    normalize(changed = null) {
        let lower = this.normalizedValue(this.from, this.read(this.from));
        let upper = this.normalizedValue(this.to, this.read(this.to));
        const gap = Math.max(0, Math.min(Number(this.options.minGap) || 0, this.bounds(this.to).max - this.bounds(this.from).min));
        if (lower !== null && upper !== null && upper - lower < gap) {
            if (changed === this.from) lower = this.normalizedValue(this.from, upper - gap, 'floor');
            else upper = this.normalizedValue(this.to, lower + gap, 'ceil');
            // If a bound prevents moving the changed side, move its counterpart.
            if (upper - lower < gap) {
                lower = this.normalizedValue(this.from, upper - gap, 'floor');
                upper = this.normalizedValue(this.to, lower + gap, 'ceil');
            }
        }
        this.from.value = lower === null ? '' : String(lower);
        this.to.value = upper === null ? '' : String(upper);
    }

    render(preserveDraft = false) {
        const lower = this.read(this.from);
        const upper = this.read(this.to);
        const format = this.options.formatValue || (value => String(value));
        if (this.options.fromDisplay) this.options.fromDisplay.textContent = lower === null ? '' : format(lower);
        if (this.options.toDisplay) this.options.toDisplay.textContent = upper === null ? '' : format(upper);
        this.numberFields?.forEach((input, index) => {
            if (!preserveDraft || this.document.activeElement !== input) input.value = (index === 0 ? this.from : this.to).value;
        });
        const bar = this.options.rangeBar;
        const { min, max } = this.bounds(this.from);
        if (bar && lower !== null && upper !== null && Number.isFinite(min) && Number.isFinite(max) && max > min) {
            const left = Math.max(0, Math.min(100, ((lower - min) / (max - min)) * 100));
            const right = Math.max(left, Math.min(100, ((upper - min) / (max - min)) * 100));
            bar.style.left = `${left}%`;
            bar.style.width = `${right - left}%`;
            bar.style.right = 'auto';
        }
        this.numberFields?.forEach((input, index) => { input.disabled = (index === 0 ? this.from : this.to).disabled; });
        if (this.isSlider) {
            const gap = Math.max(0, Number(this.options.minGap) || 0);
            const fromBounds = this.bounds(this.from);
            const toBounds = this.bounds(this.to);
            const fromMin = Number.isFinite(fromBounds.min) ? fromBounds.min : 0;
            const fromMax = upper === null
                ? (Number.isFinite(fromBounds.max) ? fromBounds.max : 100)
                : Math.min(fromBounds.max, upper - gap);
            const toMin = lower === null
                ? (Number.isFinite(toBounds.min) ? toBounds.min : 0)
                : Math.max(toBounds.min, lower + gap);
            const toMax = Number.isFinite(toBounds.max) ? toBounds.max : 100;
            [[this.from, fromMin, fromMax], [this.to, toMin, toMax]].forEach(([input, min, max], index) => {
                if (this.numberFields?.[index]) {
                    this.numberFields[index].min = String(min);
                    this.numberFields[index].max = String(max);
                }
                input.setAttribute('aria-valuemin', String(min));
                input.setAttribute('aria-valuemax', String(max));
                if (input.value.trim()) {
                    const value = Number(input.value);
                    input.setAttribute('aria-valuenow', String(value));
                    input.setAttribute('aria-valuetext', (this.options.formatValue || String)(value));
                } else {
                    input.removeAttribute('aria-valuenow');
                    input.removeAttribute('aria-valuetext');
                }
            });
        }
        const Stepper = this.document.defaultView.NumberStepper;
        [...(this.numberFields || []), this.from, this.to].filter(input => input.type === 'number').forEach(input => Stepper?.enhance(input)?.sync());
    }

    snapshot() { return `${this.from.value}|${this.to.value}`; }

    commit() {
        const snapshot = this.snapshot();
        if (snapshot === this.lastCommitted) return;
        this.lastCommitted = snapshot;
        this.options.onCommit?.(this.read(this.from), this.read(this.to));
    }

    syncFromNative() {
        if (this.destroyed) return;
        this.normalize();
        this.render();
        this.lastCommitted = this.snapshot();
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.listeners.splice(0).forEach(remove => remove());
        this.fields?.remove();
        if (!this.hadRangeClass) this.element.classList.remove('filter-range');
        this.original.forEach(({ input, className, label, min, max }) => {
            input.className = className;
            for (const [name, value] of [['aria-label', label], ['aria-valuemin', null], ['aria-valuemax', null], ['aria-valuenow', null], ['aria-valuetext', null], ['min', min], ['max', max]]) {
                if (value === null) input.removeAttribute(name);
                else input.setAttribute(name, value);
            }
        });
        RangeControl.instances.delete(this.from);
    }
}

if (typeof window !== 'undefined') {
    window.FilterChoice = FilterChoice;
    window.RangeControl = RangeControl;
}
if (typeof module !== 'undefined' && module.exports) module.exports = { FilterChoice, RangeControl };
