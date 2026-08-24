/**
 * Shared loading/ready/error/unavailable lifecycle for every player source.
 */
(function(global) {
    'use strict';

    const STATES = Object.freeze({
        LOADING: 'loading',
        READY: 'ready',
        ERROR: 'error',
        UNAVAILABLE: 'unavailable',
        CANCELLED: 'cancelled'
    });
    const DEFAULT_TIMEOUT_MS = 5000;

    function ensureStyles(doc) {
        if (!doc?.head || doc.getElementById?.('player-source-lifecycle-styles')) return;
        const style = doc.createElement('style');
        style.id = 'player-source-lifecycle-styles';
        style.textContent = `
            .player-source-lifecycle-host { position: relative; }
            .player-source-lifecycle {
                position: absolute; inset: 0; z-index: 30; display: grid; place-items: center;
                padding: 24px; text-align: center; color: #f7f7f7;
                background: rgba(8, 10, 15, .92); font: 500 14px/1.45 system-ui, sans-serif;
            }
            .player-source-lifecycle[hidden] { display: none; }
            .player-source-lifecycle__content { display: grid; justify-items: center; gap: 12px; max-width: 360px; }
            .player-source-lifecycle__indicator {
                width: 28px; height: 28px; border: 3px solid rgba(255,255,255,.24);
                border-top-color: #fff; border-radius: 50%; animation: player-source-spin .8s linear infinite;
            }
            .player-source-lifecycle__actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }
            .player-source-lifecycle__action {
                border: 1px solid rgba(255,255,255,.28); border-radius: 8px; padding: 8px 13px;
                color: inherit; background: rgba(255,255,255,.1); cursor: pointer;
            }
            .player-source-lifecycle__action:hover { background: rgba(255,255,255,.18); }
            @keyframes player-source-spin { to { transform: rotate(360deg); } }
            @media (prefers-reduced-motion: reduce) { .player-source-lifecycle__indicator { animation: none; } }
        `;
        doc.head.appendChild(style);
    }

    function setState(container, state, options = {}) {
        if (!container || state === STATES.CANCELLED) return null;
        const doc = container.ownerDocument || global.document;
        ensureStyles(doc);
        container.querySelector?.('[data-player-bootstrap-loader]')?.remove();
        container.classList?.add('player-source-lifecycle-host');
        if (container.dataset) container.dataset.sourceState = state;

        let overlay = container.querySelector?.('.player-source-lifecycle');
        if (state === STATES.READY) {
            overlay?.remove();
            return null;
        }

        if (!overlay) {
            overlay = doc?.createElement?.('div');
            if (!overlay) return null;
            overlay.className = 'player-source-lifecycle';
            container.appendChild(overlay);
        }

        const isLoading = state === STATES.LOADING;
        const defaultMessage = isLoading
            ? 'Загрузка источника…'
            : state === STATES.UNAVAILABLE
                ? 'Источник недоступен или не ответил вовремя.'
                : 'Не удалось загрузить источник.';
        overlay.setAttribute('role', isLoading ? 'status' : 'alert');
        overlay.setAttribute('aria-live', 'polite');
        overlay.innerHTML = `
            <div class="player-source-lifecycle__content">
                ${isLoading ? '<div class="player-source-lifecycle__indicator" aria-hidden="true"></div>' : ''}
                <div class="player-source-lifecycle__message"></div>
                <div class="player-source-lifecycle__actions"></div>
            </div>
        `;
        const message = overlay.querySelector('.player-source-lifecycle__message');
        if (message) message.textContent = options.message || defaultMessage;
        const actions = overlay.querySelector('.player-source-lifecycle__actions');

        const addAction = (label, handler, action) => {
            if (!actions || typeof handler !== 'function') return;
            const button = doc.createElement('button');
            button.type = 'button';
            button.className = 'player-source-lifecycle__action';
            button.dataset.action = action;
            button.textContent = label;
            button.addEventListener('click', handler);
            actions.appendChild(button);
        };

        if (!isLoading) {
            addAction('Повторить', options.onRetry, 'retry');
            addAction('Искать источники заново', options.onResearch, 'research');
        }
        return overlay;
    }

    function watchIframe(iframe, options = {}) {
        let active = true;
        let timer = null;
        const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        const isCurrent = options.isRequestCurrent || (() => true);

        const emit = (state, detail = {}) => {
            if (!active || !isCurrent()) return false;
            options.onState?.(state, detail);
            return true;
        };
        const finish = (state, detail) => {
            if (!active) return;
            if (timer) clearTimeout(timer);
            active = false;
            if (isCurrent()) options.onState?.(state, detail);
            cleanup();
        };
        const onLoad = () => finish(STATES.READY, { reason: 'load' });
        const onError = () => finish(STATES.ERROR, { reason: 'error' });
        const cleanup = () => {
            iframe?.removeEventListener?.('load', onLoad);
            iframe?.removeEventListener?.('error', onError);
        };

        iframe?.addEventListener?.('load', onLoad);
        iframe?.addEventListener?.('error', onError);
        emit(STATES.LOADING, { reason: 'start' });
        timer = setTimeout(() => finish(STATES.UNAVAILABLE, { reason: 'timeout' }), timeoutMs);

        return {
            cancel() {
                if (!active) return;
                active = false;
                if (timer) clearTimeout(timer);
                cleanup();
            }
        };
    }

    function watchVideo(video, options = {}) {
        let active = true;
        let timer = null;
        const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        const isCurrent = options.isRequestCurrent || (() => true);
        const cleanup = () => {
            video?.removeEventListener?.('loadeddata', onReady);
            video?.removeEventListener?.('canplay', onReady);
            video?.removeEventListener?.('error', onError);
        };
        const finish = (state, detail) => {
            if (!active) return;
            active = false;
            if (timer) clearTimeout(timer);
            cleanup();
            if (isCurrent()) options.onState?.(state, detail);
        };
        const onReady = () => finish(STATES.READY, { reason: 'ready' });
        const onError = () => finish(STATES.ERROR, { reason: 'media-error', error: video?.error || null });

        video?.addEventListener?.('loadeddata', onReady);
        video?.addEventListener?.('canplay', onReady);
        video?.addEventListener?.('error', onError);
        if (isCurrent()) options.onState?.(STATES.LOADING, { reason: 'start' });
        if (video?.error) {
            onError();
        } else if (video?.readyState >= 2) {
            onReady();
        } else {
            timer = setTimeout(() => finish(STATES.UNAVAILABLE, { reason: 'timeout' }), timeoutMs);
        }

        return {
            cancel() {
                if (!active) return;
                active = false;
                if (timer) clearTimeout(timer);
                cleanup();
            }
        };
    }

    global.PlayerSourceLifecycle = {
        STATES,
        DEFAULT_TIMEOUT_MS,
        setState,
        watchIframe,
        watchVideo
    };
})(typeof window !== 'undefined' ? window : globalThis);
