/** Shared numeric editing chrome; the original input owns values and validation. */
class NumberStepper {
    static instances = new WeakMap();

    static enhance(input) {
        if (!input || input.type !== 'number') return null;
        const existing = NumberStepper.instances.get(input);
        if (existing) return existing;
        return new NumberStepper(input);
    }

    constructor(input) {
        this.input = input;
        const document = input.ownerDocument;
        this.element = document.createElement('span');
        this.element.className = 'number-stepper';
        this.buttons = document.createElement('span');
        this.buttons.className = 'number-stepper__buttons';
        input.before(this.element);
        this.element.append(input, this.buttons);
        this.controls = [1, -1].map(direction => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `number-stepper__button number-stepper__button--${direction > 0 ? 'up' : 'down'}`;
            button.tabIndex = -1;
            button.addEventListener('mousedown', event => event.preventDefault());
            button.addEventListener('click', () => this.step(direction));
            this.buttons.append(button);
            return button;
        });
        NumberStepper.instances.set(input, this);
        ['input', 'change', 'focus', 'pointerenter'].forEach(type => input.addEventListener(type, () => this.sync()));
        this.element.addEventListener('pointerenter', () => this.sync());
        this.sync();
    }

    label(key) {
        const view = this.input.ownerDocument.defaultView;
        const translation = view.i18n?.get(`filter_controls.${key}`);
        if (translation && translation !== `filter_controls.${key}`) return translation;
        const ru = (view.i18n?.currentLocale || view.navigator.language || '').startsWith('ru');
        return key === 'increase' ? (ru ? 'Увеличить' : 'Increase') : (ru ? 'Уменьшить' : 'Decrease');
    }

    sync() {
        const input = this.input;
        const value = input.value.trim() === '' ? null : Number(input.value);
        const context = input.getAttribute('aria-label') || Array.from(input.labels || []).map(label => label.textContent.trim()).join(' ') || input.placeholder || '';
        this.controls.forEach((button, index) => {
            const rawLimit = index === 0 ? input.max : input.min;
            const limited = value !== null && rawLimit !== '' && (index === 0 ? value >= Number(rawLimit) : value <= Number(rawLimit));
            const disabled = input.disabled || input.readOnly || limited;
            if (button.disabled !== disabled) button.disabled = disabled;
            const label = `${this.label(index === 0 ? 'increase' : 'decrease')}${context ? `: ${context}` : ''}`;
            if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label);
            if (button.title !== label) button.title = label;
        });
    }

    step(direction) {
        const input = this.input;
        this.sync();
        if (this.controls[direction > 0 ? 0 : 1].disabled) return;
        const previous = input.value;
        input.focus({ preventScroll: true });
        try {
            if (direction > 0) input.stepUp();
            else input.stepDown();
        } catch {
            const min = input.min === '' ? -Infinity : Number(input.min);
            const max = input.max === '' ? Infinity : Number(input.max);
            input.value = String(Math.max(min, Math.min(max, (Number(input.value) || 0) + direction)));
        }
        if (input.value !== previous) {
            const Event = input.ownerDocument.defaultView.Event;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }
        this.sync();
    }

    static start(document) {
        const enhance = root => {
            if (root.nodeType !== 1) return;
            if (root.matches('input[type="number"]')) NumberStepper.enhance(root)?.sync();
            root.querySelectorAll('input[type="number"]').forEach(input => NumberStepper.enhance(input)?.sync());
        };
        enhance(document.documentElement);
        const Observer = document.defaultView.MutationObserver;
        const observer = new Observer(records => {
            records.forEach(record => {
                if (record.type === 'attributes') {
                    if (record.target.matches('input[type="number"]')) NumberStepper.enhance(record.target)?.sync();
                } else record.addedNodes.forEach(enhance);
            });
        });
        observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'readonly', 'min', 'max', 'step', 'value', 'aria-label', 'placeholder'] });
    }
}

if (typeof window !== 'undefined') {
    window.NumberStepper = NumberStepper;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => NumberStepper.start(document), { once: true });
    else NumberStepper.start(document);
}
