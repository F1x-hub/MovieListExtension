(function (global) {
    'use strict';
    let sequence = 0;
    const sources = new Set(['animego', 'seasonvar', 'exfs', 'kinogo', 'rutube', 'officialyt', 'kodik', 'vidsrc', 'torrent', 'unknown']);
    const types = new Set(['resolveOk', 'resolveFail', 'fallback', 'decodeFailed']);
    const reasons = new Set(['policy', 'decode', 'aborted', 'timeout', 'network', 'http', 'unknown']);
    const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(value, 2100000000000) : 0;
    const nullableTime = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? number(value) : null;
    function safeReport(report) {
        const counters = Array.isArray(report?.counters) ? report.counters.slice(0, 252).filter(value => sources.has(value?.providerId) && types.has(value?.type) && reasons.has(value?.reason)).map(value => ({ providerId: value.providerId, type: value.type, reason: value.reason, count: number(value.count) })) : [];
        const ttff = Array.isArray(report?.ttff) ? report.ttff.slice(0, 27).filter(value => sources.has(value?.providerId) && ['exact', 'approximate', 'unknown'].includes(value?.quality)).map(value => ({ providerId: value.providerId, quality: value.quality, count: number(value.count), meanMs: value.quality === 'unknown' ? null : number(value.meanMs), maxMs: value.quality === 'unknown' ? null : number(value.maxMs),
            measuredCount: value.quality === 'unknown' ? 0 : number(value.measuredCount),
            p50Ms: value.quality === 'unknown' ? null : nullableTime(value.p50Ms),
            p95Ms: value.quality === 'unknown' ? null : nullableTime(value.p95Ms),
            histogram: Array.from({ length: 11 }, (_, index) => value.quality === 'unknown' ? 0 : number(value.histogram?.[index])) })) : [];
        const qoe = Array.isArray(report?.qoe) ? report.qoe.slice(0, 9).filter(value => sources.has(value?.providerId)).map(value => ({ providerId: value.providerId,
            sessions: number(value.sessions), stallCount: number(value.stallCount), rebufferMsTotal: number(value.rebufferMsTotal), rebufferMsMax: number(value.rebufferMsMax) })) : [];
        return { schema: 1, retentionDays: 7, counters, ttff, qoe };
    }
    class PlayerDiagnosticsPanel {
        text(key, fallback) { return global.PlayerLocale?.t(key, {}, fallback) || fallback; }
        localize() {
            if (!this.dialog) return;
            const label = this.text('diagnostics', 'Диагностика');
            this.button.setAttribute('aria-label', label); this.button.title = label;
            this.dialog.querySelector('h2').textContent = this.text('diagnostics_title', 'Диагностика плеера');
            this.dialog.querySelector('.confirm-dialog__message').textContent = this.text('diagnostics_note', this.noteFallback);
            this.copyButton.textContent = this.text('diagnostics_copy', 'Копировать JSON');
            this.resetButton.textContent = this.text('diagnostics_reset', 'Сбросить');
            this.dialog.querySelector('[data-action="close"]').textContent = this.text('close', 'Закрыть');
            this.dialog.querySelector('summary').textContent = this.text('diagnostics_technical', 'Технические данные JSON');
            if (this.report) this.renderSummary(this.report);
        }
        constructor({ host, playerHost, before } = {}) {
            this.host = host;
            this.playerHost = playerHost;
            this.before = before;
            this.generation = 0;
            this.ensure();
            this.onOpen = () => { void this.open(); };
            global.addEventListener('movie-player-diagnostics', this.onOpen);
            this.onFrameMessage = event => this.handleFrameMessage(event);
            global.addEventListener('message', this.onFrameMessage);
            this.observer = new global.MutationObserver(() => this.syncTrigger());
            if (playerHost) this.observer.observe(playerHost, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
            this.syncTrigger();
        }
        syncTrigger() {
            if (!this.button || this.disposed) return;
            const frame = this.playerHost?.querySelector('iframe');
            if (frame !== this.frame?.element || frame?.src !== this.frame?.src) {
                this.frame?.element.removeEventListener('load', this.onFrameLoad);
                this.frame = null;
                if (frame) {
                    try {
                        const url = new URL(frame.src);
                        if (['https:', 'http:'].includes(url.protocol)) {
                            this.frame = { element: frame, src: frame.src, origin: url.origin };
                            this.onFrameLoad = () => this.queryFrameMenu();
                            frame.addEventListener('load', this.onFrameLoad);
                            this.queryFrameMenu();
                        }
                    } catch { /* Unsupported frames retain the header fallback. */ }
                }
            }
            this.button.hidden = Boolean(this.playerHost?.querySelector('.player-settings-button') || this.frame?.available);
        }
        queryFrameMenu() {
            if (!this.frame || this.disposed) return;
            this.frame.available = false;
            this.frame.requestId = ++sequence;
            this.button.hidden = false;
            this.frame.element.contentWindow?.postMessage({ type: 'PLAYER_DIAGNOSTICS_QUERY',
                requestId: this.frame.requestId }, this.frame.origin);
        }
        handleFrameMessage(event) {
            const frame = this.frame;
            if (this.disposed || !frame || !frame.element.isConnected || frame.element.src !== frame.src
                || event.source !== frame.element.contentWindow || event.origin !== frame.origin) return;
            if (event.data?.type === 'PLAYER_READY') this.queryFrameMenu();
            if (event.data?.requestId !== frame.requestId) return;
            if (event.data.type === 'PLAYER_DIAGNOSTICS_AVAILABLE') {
                frame.available = event.data.available === true;
                this.syncTrigger();
            } else if (event.data.type === 'PLAYER_DIAGNOSTICS_OPEN' && frame.available) {
                void this.open();
            }
        }
        ensure() {
            if (this.disposed || !this.host?.isConnected) return null;
            if (this.dialog?.isConnected) return this.dialog;
            const doc = this.host.ownerDocument;
            const button = doc.createElement('button');
            button.type = 'button'; button.className = 'modal-close player-diagnostics-trigger';
            button.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
            const dialog = doc.createElement('dialog');
            dialog.className = 'player-diagnostics-dialog';
            const titleId = `playerDiagnosticsTitle${++sequence}`;
            dialog.setAttribute('aria-labelledby', titleId);
            dialog.innerHTML = `<div class="confirm-dialog__body"><h2 class="confirm-dialog__title" id="${titleId}">Диагностика плеера</h2><p class="confirm-dialog__message">Локальная статистика за 7 дней. Без URL, названий и данных аккаунта. TTFF: exact — первый кадр; approximate — приближение; unknown — нет достоверного измерения.</p><pre class="player-diagnostics-report" tabindex="0"></pre><p class="player-diagnostics-status" role="status" aria-live="polite"></p></div><div class="confirm-dialog__footer"><button type="button" class="btn btn-secondary" data-action="copy">Копировать JSON</button><button type="button" class="btn btn-secondary" data-action="reset">Сбросить</button><button type="button" class="btn btn-secondary" data-action="close">Закрыть</button></div>`;
            this.button = button; this.dialog = dialog;
            const details = doc.createElement('details');
            const summary = doc.createElement('summary'); details.append(summary);
            const output = dialog.querySelector('pre');
            output.before(details); details.append(output);
            this.summary = doc.createElement('div'); this.summary.className = 'player-diagnostics-summary';
            details.before(this.summary);
            this.output = output; this.status = dialog.querySelector('[role="status"]');
            this.copyButton = dialog.querySelector('[data-action="copy"]');
            this.resetButton = dialog.querySelector('[data-action="reset"]');
            this.noteFallback = dialog.querySelector('.confirm-dialog__message').textContent;
            this.localize();
            this.localeCleanup = global.PlayerLocale?.subscribe(() => this.localize());
            this.copyButton.disabled = true;
            button.addEventListener('click', () => this.open());
            dialog.querySelector('[data-action="close"]').addEventListener('click', () => dialog.close());
            dialog.addEventListener('cancel', event => { event.preventDefault(); dialog.close(); });
            // Native dialog owns focus and Escape; do not let the page's modal
            // stack trap Tab or close the player underneath this top-layer dialog.
            dialog.addEventListener('keydown', event => {
                if (event.key === 'Tab' || event.key === 'Escape') event.stopPropagation();
            });
            dialog.addEventListener('close', () => {
                this.generation++;
                if (!this.disposed) {
                    const target = this.returnFocus?.isConnected && !this.returnFocus.closest('[hidden]')
                        ? this.returnFocus : this.playerHost?.querySelector('.player-settings-button') || this.button;
                    target?.focus();
                }
            });
            this.copyButton.addEventListener('click', () => this.copy());
            this.resetButton.addEventListener('click', () => this.reset());
            this.host.insertBefore(button, this.before || null); doc.body.appendChild(dialog);
            return dialog;
        }
        async open() {
            if (!this.ensure()) return;
            if (!this.dialog.open) {
                const doc = this.host.ownerDocument;
                this.returnFocus = doc.activeElement !== doc.body ? doc.activeElement : this.button;
                this.dialog.showModal();
            }
            this.dialog.querySelector('[data-action="close"]').focus();
            await this.refresh();
        }
        async refresh() {
            const token = ++this.generation;
            this.copyButton.disabled = true; this.json = null; this.report = null;
            this.summary.replaceChildren();
            this.status.textContent = this.text('diagnostics_loading', 'Загрузка статистики…');
            try {
                if (!global.PlayerMetrics?.report) throw Error('UNAVAILABLE');
                const report = await global.PlayerMetrics.report();
                if (this.disposed || token !== this.generation) return;
                this.report = safeReport(report);
                this.renderSummary(this.report);
                this.json = JSON.stringify(this.report, null, 2);
                this.output.textContent = this.json; this.status.textContent = ''; this.copyButton.disabled = false;
            } catch {
                if (!this.disposed && token === this.generation) { this.output.textContent = ''; this.status.textContent = this.text('diagnostics_load_failed', 'Не удалось загрузить статистику.'); }
            }
        }
        renderSummary(report) {
            const doc = this.host.ownerDocument;
            this.summary.replaceChildren();
            const add = (label, value) => {
                const row = doc.createElement('p');
                const title = doc.createElement('strong'); title.textContent = label;
                row.append(title, doc.createTextNode(`: ${value}`)); this.summary.append(row);
            };
            const count = type => report.counters.filter(row => row.type === type).reduce((total, row) => total + row.count, 0);
            add(this.text('diagnostics_ready_count', 'Ответов о готовности источника'), count('resolveOk'));
            add(this.text('diagnostics_failure_count', 'Ошибок источника'), count('resolveFail') + count('decodeFailed'));
            add(this.text('diagnostics_fallback_count', 'Переходов на другой источник'), count('fallback'));
            const noData = this.text('diagnostics_no_data', 'Нет данных');
            const milliseconds = value => `${Math.round(value)} ${this.text('diagnostics_ms', 'мс')}`;
            for (const row of report.qoe.length ? report.qoe : [{ sessions: 0 }]) {
                const prefix = row.providerId ? `${row.providerId} — ` : '';
                add(prefix + this.text('diagnostics_qoe_sessions', 'Сессий с измерением'), row.sessions || noData);
                add(prefix + this.text('diagnostics_stalls', 'Остановок для буферизации'), row.sessions ? row.stallCount : noData);
                add(prefix + this.text('diagnostics_rebuffer_total', 'Всего буферизация'), row.sessions ? milliseconds(row.rebufferMsTotal) : noData);
                add(prefix + this.text('diagnostics_rebuffer_max', 'Самая долгая буферизация'), row.sessions ? milliseconds(row.rebufferMsMax) : noData);
            }
            const quantiles = row => row?.measuredCount && row.p50Ms !== null && row.p95Ms !== null
                ? `${milliseconds(row.p50Ms)} / ${milliseconds(row.p95Ms)}` : noData;
            if (!report.ttff.length) add(this.text('diagnostics_ttff_quantiles', 'TTFF p50 / p95'), noData);
            for (const row of report.ttff) {
                const label = `${row.providerId} — ${this.text('diagnostics_first_frame', 'Первый кадр')}`;
                add(label, row.quality === 'unknown'
                    ? this.text('diagnostics_frame_unknown', 'Измерение недоступно; это не ошибка воспроизведения.')
                    : `${Math.round(row.meanMs)} ms (${row.quality === 'approximate' ? this.text('diagnostics_approximate', 'приблизительно') : this.text('diagnostics_exact', 'измерено')})`);
                add(`${row.providerId} (${row.quality}) — ${this.text('diagnostics_ttff_quantiles', 'TTFF p50 / p95')}`, quantiles(row));
            }
            add(this.text('diagnostics_quantile_label', 'Интервалы TTFF'), this.text('diagnostics_quantile_note', 'p50/p95 — верхние границы интервалов; точные и приблизительные измерения считаются отдельно.'));
        }
        async copy() {
            if (this.disposed || !this.json) return;
            try {
                await global.navigator.clipboard.writeText(this.json);
                if (!this.disposed) this.status.textContent = this.text('diagnostics_copied', 'JSON скопирован.');
            } catch { if (!this.disposed) this.status.textContent = this.text('diagnostics_copy_failed', 'Не удалось скопировать. Выделите JSON вручную.'); }
        }
        async reset() {
            if (this.disposed || this.resetButton.disabled) return;
            this.resetButton.disabled = true; this.copyButton.disabled = true;
            try {
                if (!global.PlayerMetrics?.reset || await global.PlayerMetrics.reset() !== true) throw Error('RESET_FAILED');
                if (!this.disposed) { await this.refresh(); if (!this.disposed && this.json) this.status.textContent = this.text('diagnostics_reset_done', 'Статистика сброшена.'); }
            } catch { if (!this.disposed) this.status.textContent = this.text('diagnostics_reset_failed', 'Не удалось сбросить статистику.'); }
            finally { if (!this.disposed) { this.resetButton.disabled = false; this.copyButton.disabled = !this.json; } }
        }
        destroy() {
            this.observer?.disconnect();
            this.frame?.element.removeEventListener('load', this.onFrameLoad);
            this.frame = null;
            global.removeEventListener('message', this.onFrameMessage);
            global.removeEventListener('movie-player-diagnostics', this.onOpen);
            this.localeCleanup?.();
            this.disposed = true; this.generation++;
            if (this.dialog?.open) this.dialog.close();
            this.dialog?.remove(); this.button?.remove(); this.json = null; this.report = null;
        }
    }
    global.PlayerDiagnosticsPanel = PlayerDiagnosticsPanel;
})(typeof window === 'undefined' ? globalThis : window);
