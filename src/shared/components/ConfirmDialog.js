/**
 * ConfirmDialog - shared in-page replacement for window.confirm().
 *
 *   const confirmed = await ConfirmDialog.confirm({
 *       title: 'Удалить отзыв?',
 *       message: 'Это действие нельзя отменить.',
 *       confirmLabel: 'Удалить',
 *       danger: true
 *   });
 *
 * Resolves true only when the confirm button is pressed. Cancel, Escape and a
 * backdrop click resolve false. Focus starts on Cancel so Enter never confirms a
 * destructive action by accident, stays trapped inside the dialog, and returns
 * to the element that was focused before it opened. Styles live in
 * components.css (`.confirm-dialog*`).
 */
(function () {
    const DEFAULT_LABELS = {
        title: ['confirm_dialog.title', 'Подтвердите действие'],
        confirm: ['confirm_dialog.confirm', 'Подтвердить'],
        cancel: ['confirm_dialog.cancel', 'Отмена']
    };

    function translate([key, fallback]) {
        try {
            const value = window.i18n?.get?.(key);
            return value && value !== key ? value : fallback;
        } catch {
            return fallback;
        }
    }

    function isVisible(element) {
        return Boolean(element?.isConnected && !element.disabled && element.offsetParent !== null);
    }

    class ConfirmDialogController {
        constructor() {
            this.root = null;
            this.pending = null;
            this.returnFocusTo = null;
            this.handleKeydown = this.handleKeydown.bind(this);
        }

        ensureElements() {
            if (this.root?.isConnected) return this.root;

            const root = document.createElement('div');
            root.className = 'modal-overlay confirm-dialog-overlay';
            root.hidden = true;
            root.setAttribute('role', 'alertdialog');
            root.setAttribute('aria-modal', 'true');
            root.setAttribute('aria-labelledby', 'sharedConfirmDialogTitle');
            root.setAttribute('aria-describedby', 'sharedConfirmDialogMessage');
            root.tabIndex = -1;
            root.innerHTML = `
                <div class="modal confirm-dialog">
                    <div class="confirm-dialog__body">
                        <h2 class="confirm-dialog__title" id="sharedConfirmDialogTitle"></h2>
                        <p class="confirm-dialog__message" id="sharedConfirmDialogMessage"></p>
                    </div>
                    <div class="confirm-dialog__footer">
                        <button type="button" class="btn btn-secondary" data-confirm-dialog="cancel"></button>
                        <button type="button" class="btn btn-danger" data-confirm-dialog="confirm"></button>
                    </div>
                </div>
            `;

            root.addEventListener('mousedown', (event) => {
                if (event.target === root) this.settle(false);
            });
            root.querySelector('[data-confirm-dialog="cancel"]').addEventListener('click', () => this.settle(false));
            root.querySelector('[data-confirm-dialog="confirm"]').addEventListener('click', () => this.settle(true));
            root.addEventListener('keydown', this.handleKeydown);

            document.body.appendChild(root);
            this.root = root;
            return root;
        }

        /**
         * @param {{ title?: string, message?: string, confirmLabel?: string, cancelLabel?: string, danger?: boolean }} [options]
         * @returns {Promise<boolean>}
         */
        confirm({ title, message = '', confirmLabel, cancelLabel, danger = false } = {}) {
            if (typeof document === 'undefined' || !document.body) {
                return Promise.resolve(false);
            }

            // A newer request supersedes one that is still open.
            this.settle(false, { restoreFocus: false });

            const root = this.ensureElements();
            const confirmButton = root.querySelector('[data-confirm-dialog="confirm"]');
            const cancelButton = root.querySelector('[data-confirm-dialog="cancel"]');

            root.querySelector('.confirm-dialog__title').textContent = title || translate(DEFAULT_LABELS.title);
            root.querySelector('.confirm-dialog__message').textContent = message || '';
            confirmButton.textContent = confirmLabel || translate(DEFAULT_LABELS.confirm);
            cancelButton.textContent = cancelLabel || translate(DEFAULT_LABELS.cancel);
            confirmButton.classList.toggle('btn-danger', danger);
            confirmButton.classList.toggle('btn-primary', !danger);

            this.returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            root.hidden = false;
            cancelButton.focus();
            // Callers opened from a mousedown handler would otherwise get focus moved
            // back to the pressed element by the browser's default action.
            setTimeout(() => {
                if (this.isOpen() && !root.contains(document.activeElement)) cancelButton.focus();
            }, 0);

            return new Promise((resolve) => {
                this.pending = resolve;
            });
        }

        isOpen() {
            return Boolean(this.root && !this.root.hidden);
        }

        getElement() {
            return this.root;
        }

        cancel() {
            this.settle(false);
        }

        settle(confirmed, { restoreFocus = true } = {}) {
            const resolve = this.pending;
            if (!resolve) return;
            this.pending = null;
            if (this.root) this.root.hidden = true;

            const target = this.returnFocusTo;
            this.returnFocusTo = null;
            if (restoreFocus && isVisible(target)) target.focus();

            resolve(Boolean(confirmed));
        }

        handleKeydown(event) {
            if (!this.isOpen()) return;

            if (event.key === 'Escape') {
                event.preventDefault();
                // Page-level dialog stacks must not close the layer underneath as well.
                event.stopPropagation();
                this.settle(false);
                return;
            }

            if (event.key !== 'Tab') return;
            event.stopPropagation();
            const buttons = Array.from(this.root.querySelectorAll('button:not([disabled])'));
            if (buttons.length === 0) return;
            const first = buttons[0];
            const last = buttons[buttons.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            } else if (!this.root.contains(document.activeElement)) {
                event.preventDefault();
                first.focus();
            }
        }
    }

    const controller = new ConfirmDialogController();
    const api = {
        confirm: (options) => controller.confirm(options),
        isOpen: () => controller.isOpen(),
        cancel: () => controller.cancel(),
        getElement: () => controller.getElement()
    };

    if (typeof window !== 'undefined') {
        window.ConfirmDialog = api;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { ConfirmDialog: api, ConfirmDialogController };
    }
})();
