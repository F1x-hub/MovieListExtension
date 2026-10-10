import { i18n } from '../i18n/I18n.js';
import { whatsNew } from '../config/whatsNew.js';
import '../services/WhatsNewService.js';

const excluded = /\/(?:admin|options|update|offscreen)\/|update_instructions\.html/;
export function canShowWhatsNew(document, pathname) {
    if (excluded.test(pathname) || document.visibilityState === 'hidden' || document.fullscreenElement) return false;
    if (new URLSearchParams(document.location.search).get('whatsNewPreview') === 'draft') return false;
    if ([...document.querySelectorAll('video, audio')].some(media => !media.paused && !media.ended)) return false;
    return ![...document.querySelectorAll('.modal-overlay, [role="dialog"], [role="alertdialog"]')].some(node => {
        for (let current = node; current; current = current.parentElement) {
            const style = document.defaultView.getComputedStyle(current);
            if (current.hidden || style.display === 'none' || style.visibility === 'hidden') return false;
        }
        return true;
    });
}

export class WhatsNewDialog {
    constructor({ service, document = globalThis.document, chrome = globalThis.chrome, locale = i18n } = {}) {
        this.service = service || new globalThis.WhatsNewService({ entries: whatsNew });
        this.document = document;
        this.chrome = chrome;
        this.locale = locale;
        this.root = null;
        this.onStorage = (changes, area) => {
            if (area === 'sync' && changes.language) this.render(changes.language.newValue);
            if (area === 'local' && changes.whatsNewV1?.newValue?.seenVersion && this.root && !this.preview) {
                const seenVersion = changes.whatsNewV1.newValue.seenVersion;
                if (globalThis.WhatsNewService.validVersion(seenVersion)
                    && globalThis.WhatsNewService.compare(seenVersion, this.service.version) >= 0) void this.close(false);
            }
        };
    }
    text(key, lang = this.language) {
        return this.locale.locales[lang]?.whats_new?.[key] || this.locale.locales.en.whats_new[key];
    }
    node(tag, className, text) {
        const node = this.document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }
    async open({ manual = false, preview = false } = {}) {
        if (this.root || this.opening) return;
        this.opening = true;
        try {
            if (!manual && !canShowWhatsNew(this.document, this.document.location.pathname)) return;
            if (!manual) {
                const result = await this.chrome.runtime.sendMessage({ type: 'WHATS_NEW_PLAYBACK_SAFE' });
                if (!result?.safe || !canShowWhatsNew(this.document, this.document.location.pathname)) return;
            }
            const selection = manual ? { entries: this.service.history({ preview }), truncated: false } : await this.service.pending();
            if (!manual && !selection.entries.length) return;
            this.preview = preview;
            this.entries = selection.entries;
            this.truncated = selection.truncated;
            this.trigger = this.document.activeElement;
            this.language = this.locale.currentLocale;
            this.root = this.node('div', 'modal-overlay whats-new-overlay');
            this.root.setAttribute('role', 'dialog');
            this.root.setAttribute('aria-modal', 'true');
            this.root.setAttribute('aria-labelledby', 'whatsNewTitle');
            this.root.addEventListener('click', event => {
                if (event.target === this.root) void this.close(true);
            });
            this.root.addEventListener('keydown', event => this.keydown(event));
            this.document.body.append(this.root);
            this.chrome.storage.onChanged.addListener(this.onStorage);
            this.unsubscribe = this.locale.onLocaleChange(lang => this.render(lang));
            this.onPageHide = () => { void this.close(false, false); };
            this.document.defaultView.addEventListener('pagehide', this.onPageHide);
            this.render();
            this.root.querySelector('[data-whats-new="done"]').focus();
            // Another surface may acknowledge while this one awaits its state read.
            if (!manual) {
                const latest = await this.service.read();
                if (globalThis.WhatsNewService.validVersion(latest.seenVersion)
                    && globalThis.WhatsNewService.compare(latest.seenVersion, this.service.version) >= 0) await this.close(false);
            }
        } catch (error) {
            console.warn('[WhatsNew] Could not open release notes:', error);
            if (this.root) await this.close(false);
        } finally {
            this.opening = false;
        }
    }
    render(lang = this.language) {
        if (!this.root) return;
        this.language = this.locale.locales[lang] ? lang : 'en';
        const focusedAction = this.document.activeElement?.dataset.whatsNew;
        const scroll = this.root.querySelector('.whats-new-body')?.scrollTop || 0;
        const surface = this.node('section', 'whats-new-surface');
        const header = this.node('header', 'whats-new-header');
        const titleVersion = this.entries.length === 1 ? this.entries[0].version : this.service.version;
        const title = this.node('h2', '', this.preview ? this.text('draft') : this.text('title').replace('{version}', titleVersion));
        title.id = 'whatsNewTitle';
        const close = this.node('button', 'btn btn-secondary', '×');
        close.type = 'button'; close.dataset.whatsNew = 'close';
        close.setAttribute('aria-label', this.text('close'));
        close.addEventListener('click', () => { void this.close(true); });
        header.append(title, close);
        const body = this.node('div', 'whats-new-body');
        if (!this.entries.length) body.append(this.node('p', '', this.text('empty')));
        for (const entry of this.entries) {
            if (this.entries.length > 1) body.append(this.node('h3', '', entry.version));
            const list = this.node('ul', 'whats-new-list');
            for (const highlight of entry.highlights) {
                const item = this.node('li');
                item.append(this.node('strong', '', highlight.title[this.language] || highlight.title.en),
                    this.node('p', '', highlight.text[this.language] || highlight.text.en));
                list.append(item);
            }
            body.append(list);
        }
        if (this.truncated) {
            const history = this.node('button', 'btn btn-secondary', this.text('earlier'));
            history.type = 'button'; history.dataset.whatsNew = 'history';
            history.addEventListener('click', () => {
                this.entries = this.service.history(); this.truncated = false; this.render();
                this.root.querySelector('[data-whats-new="done"]').focus();
            });
            body.append(history);
        }
        const footer = this.node('footer', 'whats-new-footer');
        const done = this.node('button', 'btn btn-primary', this.text('done'));
        done.type = 'button'; done.dataset.whatsNew = 'done';
        done.addEventListener('click', () => { void this.close(true); });
        footer.append(done); surface.append(header, body, footer);
        this.root.replaceChildren(surface);
        body.scrollTop = scroll;
        if (focusedAction) (this.root.querySelector(`[data-whats-new="${focusedAction}"]`) || done).focus();
    }
    keydown(event) {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); void this.close(true); }
        if (event.key !== 'Tab') return;
        const buttons = [...this.root.querySelectorAll('button:not([disabled])')];
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (event.shiftKey && (this.document.activeElement === first || !this.root.contains(this.document.activeElement))) {
            event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (this.document.activeElement === last || !this.root.contains(this.document.activeElement))) {
            event.preventDefault(); first.focus();
        }
    }
    async close(acknowledge, restoreFocus = true) {
        if (!this.root) return;
        if (acknowledge && !this.preview) {
            try { await this.service.acknowledge(); }
            catch (error) { console.warn('[WhatsNew] Could not save acknowledgement:', error); }
        }
        this.chrome.storage.onChanged.removeListener(this.onStorage);
        this.unsubscribe?.();
        this.document.defaultView.removeEventListener('pagehide', this.onPageHide);
        this.root?.remove(); this.root = null;
        if (restoreFocus && this.trigger?.isConnected) this.trigger.focus();
    }
}

let dialog;
export async function showWhatsNew(options = {}) {
    dialog ||= new WhatsNewDialog();
    await dialog.open(options);
}
