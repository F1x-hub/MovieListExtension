(function exposeErrorDialog(root) {
    class ErrorDialog {
        constructor() {
            this.overlay = null;
            this.current = null;
            this.options = {};
            this.localeUnsubscribe = null;
        }

        ensureDom() {
            if (this.overlay || typeof document === 'undefined') return;

            this.overlay = document.createElement('div');
            this.overlay.id = 'appErrorDialog';
            this.overlay.className = 'modal-overlay app-error-dialog';
            this.overlay.hidden = true;
            this.overlay.setAttribute('role', 'alertdialog');
            this.overlay.setAttribute('aria-modal', 'true');
            this.overlay.innerHTML = `
                <div class="modal app-error-dialog__modal" role="document">
                    <div class="app-error-dialog__icon" aria-hidden="true">!</div>
                    <h2 class="app-error-dialog__title" id="appErrorDialogTitle"></h2>
                    <p class="app-error-dialog__message" id="appErrorDialogMessage"></p>
                    <details class="app-error-dialog__details">
                        <summary></summary>
                        <pre></pre>
                    </details>
                    <div class="app-error-dialog__actions">
                        <button type="button" class="btn btn-secondary" data-error-action="close"></button>
                        <button type="button" class="btn btn-primary" data-error-action="primary"></button>
                    </div>
                </div>
            `;
            document.body.appendChild(this.overlay);

            this.overlay.addEventListener('click', (event) => {
                const action = event.target.closest('[data-error-action]')?.dataset.errorAction;
                if (action) this.handleAction(action);
                if (event.target === this.overlay) this.hide();
            });
            this.overlay.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') this.hide();
            });
        }

        bindLocaleUpdates() {
            if (this.localeUnsubscribe || !root.i18n?.onLocaleChange) return;
            this.localeUnsubscribe = root.i18n.onLocaleChange(() => {
                if (!this.overlay?.hidden && this.current) this.render();
            });
        }

        show(error, options = {}) {
            this.ensureDom();
            if (!this.overlay) return;
            this.current = error;
            this.options = options;
            this.bindLocaleUpdates();
            this.render();
            this.overlay.hidden = false;
            document.body.classList.add('app-error-dialog-open');
            this.overlay.querySelector('[data-error-action="primary"]')?.focus();
        }

        render() {
            const presentation = root.ErrorPresentation.getPresentation(this.current, this.options);
            this.overlay.setAttribute('aria-labelledby', 'appErrorDialogTitle');
            this.overlay.setAttribute('aria-describedby', 'appErrorDialogMessage');
            this.overlay.querySelector('#appErrorDialogTitle').textContent = presentation.title;
            this.overlay.querySelector('#appErrorDialogMessage').textContent = presentation.message;
            this.overlay.querySelector('.app-error-dialog__details summary').textContent = presentation.detailsLabel;
            this.overlay.querySelector('.app-error-dialog__details pre').textContent = presentation.technicalDetails;

            const primary = this.overlay.querySelector('[data-error-action="primary"]');
            const close = this.overlay.querySelector('[data-error-action="close"]');
            primary.textContent = presentation.primaryLabel;
            primary.dataset.action = presentation.primary;
            close.textContent = presentation.closeLabel;
            close.hidden = presentation.primary === 'close';
        }

        async handleAction(action) {
            if (action === 'close') {
                this.hide();
                return;
            }

            const resolvedAction = this.overlay.querySelector('[data-error-action="primary"]')?.dataset.action;
            if (resolvedAction === 'retry') {
                this.hide();
                await this.resetQuotaCircuitIfNeeded();
                await (this.options.onRetry || this.defaultRetry).call(this);
            } else if (resolvedAction === 'back') {
                this.hide();
                (this.options.onBack || this.defaultBack).call(this);
            } else {
                this.hide();
            }
        }

        async resetQuotaCircuitIfNeeded() {
            const presentation = root.ErrorPresentation?.getPresentation?.(this.current, this.options);
            const code = presentation?.error?.code || this.current?.code || this.current?.error?.code;
            if (code !== 'KINOPOISK_DAILY_LIMIT') return;
            if (typeof root.kinopoiskQuota?.resetQuotaState === 'function') {
                await root.kinopoiskQuota.resetQuotaState();
            }
        }

        defaultRetry() {
            const url = new URL(window.location.href);
            if (url.searchParams.has('resolveTmdbId')) {
                url.searchParams.set('retry', String(Date.now()));
                window.location.assign(url.toString());
                return;
            }
            window.location.reload();
        }

        defaultBack() {
            if (window.history.length > 1) {
                window.history.back();
            } else {
                this.hide();
            }
        }

        hide() {
            if (!this.overlay) return;
            this.overlay.hidden = true;
            document.body.classList.remove('app-error-dialog-open');
        }
    }

    root.ErrorDialog = ErrorDialog;
    root.errorDialog = root.errorDialog || new ErrorDialog();

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { ErrorDialog };
    }
})(typeof globalThis !== 'undefined' ? globalThis : window);
