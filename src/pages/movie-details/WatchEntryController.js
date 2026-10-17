/** Optional watch alias; provider buttons keep their identity and delegation. */
(function(global) {
    'use strict';
    class WatchEntryController {
        constructor({ container, onWatch, onTorrent }) {
            this.container = container;
            this.doc = container.ownerDocument;
            this.onWatch = onWatch;
            this.onTorrent = onTorrent;
            this.cleanups = [];
        }
        text(key, fallback) { return global.PlayerLocale?.t(key, {}, fallback) || fallback; }

        ensure() {
            if (this.group) return;
            const doc = this.doc;
            this.anchor = doc.createComment('watch-source-location');
            this.container.before(this.anchor);
            const group = this.group = doc.createElement('div');
            group.id = 'watchEntryGroup';
            group.className = 'watch-entry-group';
            const button = (id, text) => {
                const node = doc.createElement('button');
                node.id = id; node.type = 'button'; node.textContent = text;
                node.className = 'watch-entry-button';
                group.append(node); return node;
            };
            this.watch = button('watchEntryBtn', 'Смотреть');
            this.toggle = button('sourcePopoverToggle', '');
            this.toggle.setAttribute('aria-label', 'Выбрать источник');
            this.toggle.setAttribute('aria-haspopup', 'dialog');
            this.toggle.setAttribute('aria-controls', 'sourcePopover');
            this.toggle.setAttribute('aria-expanded', 'false');
            this.toggle.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
            this.torrent = button('torrentEntryBtn', 'Торрент');
            this.torrent.hidden = true;
            const popover = this.popover = doc.createElement('div');
            popover.id = 'sourcePopover';
            popover.className = 'watch-source-popover popover-surface';
            popover.hidden = true;
            popover.setAttribute('role', 'dialog');
            popover.setAttribute('aria-label', 'Источники видео');
            group.append(popover);
            this.anchor.after(group);
            popover.append(this.container);
            const listen = (target, name, callback) => {
                target.addEventListener(name, callback);
                this.cleanups.push(() => target.removeEventListener(name, callback));
            };
            const localeCleanup = global.PlayerLocale?.subscribe(() => this.sync(this.lastValue, this.lastOptions));
            if (localeCleanup) this.cleanups.push(localeCleanup);
            listen(this.watch, 'click', () => { this.close(false); this.onWatch(this.watch.dataset.aliasValue || null); });
            listen(this.torrent, 'click', () => { this.close(false); this.onTorrent(); });
            listen(this.toggle, 'click', () => this.popover.hidden ? this.open() : this.close(true));
            listen(this.toggle, 'keydown', event => {
                if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
                    event.preventDefault(); this.open(event.key === 'ArrowUp');
                }
            });
            listen(this.container, 'click', event => { if (event.target.closest('.source-btn')) this.close(true); });
            listen(doc, 'pointerdown', event => { if (!group.contains(event.target)) this.close(false); });
            listen(doc, 'focusin', event => { if (!group.contains(event.target)) this.close(false); });
            listen(doc.defaultView, 'resize', () => { if (!this.popover.hidden) this.align(); });
            listen(group, 'keydown', event => {
                if (this.popover.hidden) return;
                if (event.key === 'Escape') { event.preventDefault(); this.close(true); }
                if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !this.popover.contains(event.target)) return;
                const buttons = this.buttons();
                if (!buttons.length) return;
                event.preventDefault();
                const index = buttons.indexOf(doc.activeElement);
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
                    : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
                buttons[next].focus();
            });
        }

        buttons() { return [...this.container.querySelectorAll('.source-btn')].filter(node => !node.hidden && !node.disabled); }
        open(last = false) {
            this.popover.hidden = false;
            this.align();
            this.toggle.setAttribute('aria-expanded', 'true');
            const buttons = this.buttons();
            (last ? buttons.at(-1) : buttons.find(node => node.classList.contains('active')) || buttons[0])?.focus();
        }
        align() {
            this.popover.style.left = '0px';
            const box = this.popover.getBoundingClientRect();
            const available = this.doc.defaultView.innerWidth - 20;
            const offset = box.right > available ? available - box.right : box.left < 20 ? 20 - box.left : 0;
            this.popover.style.left = `${offset}px`;
        }
        close(focus = false) {
            if (!this.popover || this.popover.hidden) return;
            this.popover.hidden = true;
            this.toggle.setAttribute('aria-expanded', 'false');
            if (focus) this.toggle.focus();
        }
        beforeRebuild() {
            const focused = this.doc.activeElement;
            this.focusedValue = this.container.contains(focused) ? focused.dataset.value : null;
        }
        sync(value, { torrentEligible = false, busy = false, sourceLocked = false } = {}) {
            this.lastValue = value;
            this.lastOptions = { torrentEligible, busy, sourceLocked };
            this.ensure();
            this.torrent.hidden = !torrentEligible;
            this.watch.textContent = busy ? this.text('watch_searching', 'Поиск источников…') : this.text('watch', 'Смотреть');
            this.torrent.textContent = this.text('torrent', 'Торрент');
            this.toggle.setAttribute('aria-label', this.text('choose_source', 'Выбрать источник'));
            this.popover.setAttribute('aria-label', this.text('video_sources', 'Источники видео'));
            this.watch.setAttribute('aria-busy', String(busy));
            this.watch.disabled = busy;
            this.toggle.disabled = sourceLocked;
            this.torrent.disabled = sourceLocked;
            if (sourceLocked) {
                const focusedInside = this.popover.contains(this.doc.activeElement);
                this.close(false);
                if (focusedInside) this.watch.focus();
            }
            const isTorrent = value === 'mediaplayer:torrent';
            this.torrent.setAttribute('aria-pressed', String(isTorrent));
            this.watch.setAttribute('aria-pressed', String(!isTorrent && Boolean(value)));
            if (!isTorrent && this.buttons().some(node => node.dataset.value === value)) this.watch.dataset.aliasValue = value;
            else if (!this.buttons().some(node => node.dataset.value === this.watch.dataset.aliasValue)) delete this.watch.dataset.aliasValue;
            if (!this.popover.hidden && this.focusedValue) {
                (this.buttons().find(node => node.dataset.value === this.focusedValue) || this.buttons()[0] || this.toggle).focus();
            }
            this.focusedValue = null;
        }
        destroy() {
            this.cleanups.splice(0).forEach(cleanup => cleanup());
            if (this.anchor?.parentNode) this.anchor.after(this.container);
            this.group?.remove(); this.anchor?.remove();
            this.group = null;
        }
    }
    global.WatchEntryController = WatchEntryController;
})(typeof window !== 'undefined' ? window : globalThis);
