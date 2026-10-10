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
            const selection = manual ? { entries: this.service.history({ preview }),
                seenVersion: (await this.service.read().catch(() => ({}))).seenVersion } : await this.service.pending();
            if (!manual && !selection.entries.length) return;
            this.preview = preview;
            this.entries = selection.entries;
            this.seenVersion = selection.seenVersion;
            this.visibleCount = 10;
            this.expanded = new Set(this.entries[0] ? [this.entries[0].id] : []);
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
        const title = this.node('h2', '', this.text('title'));
        title.id = 'whatsNewTitle';
        const close = this.node('button', 'btn btn-secondary', '×');
        close.type = 'button'; close.dataset.whatsNew = 'close';
        close.setAttribute('aria-label', this.text('close'));
        close.addEventListener('click', () => { void this.close(true); });
        header.append(title, close);
        const body = this.node('div', 'whats-new-body');
        if (!this.entries.length) body.append(this.node('p', '', this.text('empty')));
        for (const [index, entry] of this.entries.slice(0, this.visibleCount).entries()) {
            const version = this.node('section', 'whats-new-version');
            const heading = this.node('h3', 'whats-new-version-heading');
            const toggle = this.node('button', 'whats-new-version-toggle');
            toggle.type = 'button'; toggle.dataset.whatsNew = `version-${entry.id}`;
            toggle.id = `whatsNewVersion-${index}`;
            const panel = this.node('div', 'whats-new-version-panel');
            panel.id = `whatsNewPanel-${index}`;
            panel.setAttribute('role', 'region'); panel.setAttribute('aria-labelledby', toggle.id);
            toggle.setAttribute('aria-controls', panel.id);
            const label = this.node('span', 'whats-new-version-label');
            const formatter = new Intl.DateTimeFormat(this.language === 'ru' ? 'ru-RU' : 'en-US', {
                day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
            });
            const date = new Date(`${entry.date}T00:00:00Z`);
            const formattedDate = this.language === 'ru'
                ? formatter.formatToParts(date).filter(part => ['day', 'month', 'year'].includes(part.type)).map(part => part.value).join(' ')
                : formatter.format(date);
            label.append(this.node('strong', '', entry.draft ? this.text('draft') : this.text('version').replace('{version}', entry.version)),
                this.node('span', 'whats-new-version-date', '· ' + formattedDate));
            toggle.append(label);
            if (index > 0 && !entry.draft && globalThis.WhatsNewService.validVersion(this.seenVersion)
                && globalThis.WhatsNewService.compare(entry.version, this.seenVersion) > 0) {
                toggle.append(this.node('span', 'whats-new-version-new', this.text('new')));
            }
            const chevron = this.node('span', 'whats-new-version-chevron', '›');
            chevron.setAttribute('aria-hidden', 'true'); toggle.append(chevron);
            const setExpanded = () => {
                const expanded = this.expanded.has(entry.id);
                toggle.setAttribute('aria-expanded', String(expanded));
                panel.classList.toggle('is-open', expanded);
                panel.setAttribute('aria-hidden', String(!expanded));
                panel.inert = !expanded;
            };
            toggle.addEventListener('click', () => {
                if (this.expanded.has(entry.id)) this.expanded.delete(entry.id); else this.expanded.add(entry.id);
                setExpanded();
            });
            setExpanded();
            const list = this.node('ul', 'whats-new-list');
            for (const highlight of entry.highlights) {
                const item = this.node('li');
                item.append(this.node('strong', '', highlight.title[this.language] || highlight.title.en),
                    this.node('p', '', highlight.text[this.language] || highlight.text.en));
                list.append(item);
            }
            const content = this.node('div', 'whats-new-version-content');
            content.append(list); panel.append(content); heading.append(toggle); version.append(heading, panel); body.append(version);
        }
        if (this.entries.length > this.visibleCount) {
            const more = this.node('button', 'btn btn-secondary', this.text('more'));
            more.type = 'button'; more.dataset.whatsNew = 'more';
            more.addEventListener('click', () => {
                const firstNewIndex = this.visibleCount;
                this.visibleCount += 10; this.render();
                this.root.querySelectorAll('.whats-new-version-toggle')[firstNewIndex]?.focus();
            });
            body.append(more);
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
        const toggle = event.target.closest?.('.whats-new-version-toggle');
        if (toggle && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault(); toggle.click(); return;
        }
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
