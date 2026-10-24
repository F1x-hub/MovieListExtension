import { i18n } from '../i18n/I18n.js';

// Offers MovieList Hub on full extension pages when the Windows host is
// missing or too old for component installs. The extension's UpdateService
// records the host state; this prompt only reads it and never starts the host.
const STATE_KEY = 'extension_update_state_v2';
const PROMPT_KEY = 'hubPromptV1';
const SETUP_URL = 'https://github.com/F1x-hub/MovieListExtension/releases/latest/download/MovieListSetup.exe';
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
const AFTER_DOWNLOAD_SNOOZE_MS = 24 * 60 * 60 * 1000;
const excluded = /\/(?:admin|options|update|offscreen|popup)\//;

export function hubPromptReason(state, platform) {
    if (!/win/i.test(String(platform || ''))) return null;
    if (['missing', 'forbidden', 'not_configured'].includes(state?.hostAvailability)) return 'missing';
    if (state?.hostAvailability === 'available' && state.componentCapabilities?.mediaPlayerInstall !== true) return 'outdated';
    return null;
}

export class HubPrompt {
    constructor({ document = globalThis.document, chrome = globalThis.chrome, locale = i18n,
        platform = globalThis.navigator?.userAgentData?.platform || globalThis.navigator?.platform, now = () => Date.now() } = {}) {
        this.document = document;
        this.chrome = chrome;
        this.locale = locale;
        this.platform = platform;
        this.now = now;
        this.root = null;
        this.onStorageChanged = (changes, area) => {
            if (area === 'local' && (changes[STATE_KEY] || changes[PROMPT_KEY])) void this.evaluate();
        };
    }

    async start() {
        if (excluded.test(this.document.location.pathname)) return;
        this.chrome.storage?.onChanged?.addListener(this.onStorageChanged);
        await this.evaluate();
    }

    dispose() {
        this.chrome.storage?.onChanged?.removeListener(this.onStorageChanged);
        this.remove();
    }

    async evaluate() {
        let stored;
        try {
            stored = await this.chrome.storage.local.get([STATE_KEY, PROMPT_KEY]);
        } catch {
            return;
        }
        const reason = hubPromptReason(stored[STATE_KEY], this.platform);
        const dismissed = stored[PROMPT_KEY];
        const snoozed = dismissed?.reason === reason && Number(dismissed.until) > this.now();
        if (!reason || snoozed) {
            // Keep the post-download instructions until the user closes them.
            if (!this.keepOpen || !reason) this.remove();
            return;
        }
        if (this.root?.dataset.reason !== reason) this.render(reason);
    }

    text(key) {
        const value = this.locale.get?.(`hub_prompt.${key}`);
        return typeof value === 'string' ? value : key;
    }

    render(reason) {
        this.remove();
        const document = this.document;
        const root = document.createElement('section');
        root.className = 'hub-prompt';
        root.dataset.reason = reason;
        root.setAttribute('role', 'region');
        root.setAttribute('aria-labelledby', 'hubPromptTitle');

        const title = document.createElement('h2');
        title.className = 'hub-prompt__title';
        title.id = 'hubPromptTitle';
        title.textContent = this.text(`${reason}_title`);
        const body = document.createElement('p');
        body.className = 'hub-prompt__text';
        body.textContent = this.text(`${reason}_text`);

        const actions = document.createElement('div');
        actions.className = 'hub-prompt__actions';
        const download = document.createElement('a');
        download.className = 'btn btn-primary hub-prompt__download';
        download.href = SETUP_URL;
        download.rel = 'noopener';
        download.textContent = this.text('download');
        download.addEventListener('click', () => {
            body.textContent = this.text('after_download');
            download.remove();
            later.textContent = this.text('close');
            this.keepOpen = true;
            void this.snooze(reason, AFTER_DOWNLOAD_SNOOZE_MS, false);
        });
        const later = document.createElement('button');
        later.type = 'button';
        later.className = 'btn btn-secondary hub-prompt__later';
        later.textContent = this.text('later');
        later.addEventListener('click', () => {
            if (this.keepOpen) this.remove();
            else void this.snooze(reason, SNOOZE_MS, true);
        });

        actions.append(download, later);
        root.append(title, body, actions);
        document.body.append(root);
        this.root = root;
    }

    async snooze(reason, duration, close) {
        try {
            await this.chrome.storage.local.set({ [PROMPT_KEY]: { reason, until: this.now() + duration } });
        } catch {
            // Without storage the prompt simply returns on the next page load.
        }
        if (close) this.remove();
    }

    remove() {
        this.keepOpen = false;
        this.root?.remove();
        this.root = null;
    }
}

let prompt;
export async function showHubPrompt(options) {
    prompt ||= new HubPrompt(options);
    await prompt.start();
    return prompt;
}
