/**
 * CharacterNameTranslator - character names in Russian, translated on the device by
 * Chrome's Translator API (stable desktop Chrome 138+), by themselves in the Russian
 * interface.
 *
 * TMDB and Kinopoisk keep a foreign film's characters in their original spelling
 * («Patrick Jane»), so there is no Russian name to show. This translates them on the
 * device. Names translated before show as the page opens; with the en→ru model on the
 * device, the rest follow at once. Otherwise Chrome downloads the model once, and only
 * with a user activation, which starting the download uses up: a second after the
 * reader's first click or key press on a page with names (the page's own handlers
 * have it first), and the names switch in place when the model is ready. Only the
 * Latin part of a name is translated; notes such as «(озвучка)» stay, and the original
 * goes to the tooltip. Translations are kept in chrome.storage.local, so a name is
 * translated once.
 */
class CharacterNameTranslator {
    static CACHE_KEY = 'characterNameTranslationsV1';
    static CACHE_LIMIT = 3000;
    static SOURCE_LANGUAGE = 'en';
    static TARGET_LANGUAGE = 'ru';
    static MAX_NAME_LENGTH = 120;
    // Events after which the page has a user activation (it lasts about five seconds).
    static ACTIVATION_EVENTS = ['click', 'keyup'];
    // Starting the download uses the activation up, so the page's handlers go first.
    static ACTIVATION_DELAY_MS = 1000;
    static ACTIVATION_ATTEMPTS = 3;

    static instance = null;

    /** The page's one translator, so a model and its kept names are shared. */
    static shared() {
        CharacterNameTranslator.instance ||= new CharacterNameTranslator();
        return CharacterNameTranslator.instance;
    }

    constructor({
        translatorApi = globalThis.Translator,
        storage = globalThis.chrome?.storage?.local,
        eventTarget = globalThis.window,
        userActivation = globalThis.navigator?.userActivation
    } = {}) {
        this.api = translatorApi;
        this.storage = storage;
        this.eventTarget = eventTarget;
        this.userActivation = userActivation;
        this.translator = null;
        this.creating = null;
        this.ready = null;
        this.cache = new Map();
        // A name asked for by two updates at once goes to the model once.
        this.inflight = new Map();
        this.loading = null;
        this.writeTimer = null;
    }

    isSupported() {
        return typeof this.api?.availability === 'function' && typeof this.api?.create === 'function';
    }

    /** The kept translations, read once per page. */
    load() {
        this.loading ||= (async () => {
            if (typeof this.storage?.get !== 'function') return;
            try {
                const stored = await this.storage.get(CharacterNameTranslator.CACHE_KEY);
                const pairs = stored?.[CharacterNameTranslator.CACHE_KEY];
                for (const [source, translation] of Array.isArray(pairs) ? pairs : []) {
                    if (typeof source === 'string' && typeof translation === 'string' && translation) this.cache.set(source, translation);
                }
            } catch {
                // Names are translated again without the kept ones.
            }
        })();
        return this.loading;
    }

    /** 'unsupported', 'unavailable', 'downloadable', 'downloading' or 'available'. */
    async availability() {
        if (!this.isSupported()) return 'unsupported';
        try {
            return await this.api.availability({
                sourceLanguage: CharacterNameTranslator.SOURCE_LANGUAGE,
                targetLanguage: CharacterNameTranslator.TARGET_LANGUAGE
            });
        } catch {
            return 'unavailable';
        }
    }

    /**
     * The translator, once. Starting a model download needs the page's user activation,
     * which lasts a few seconds after a click or key press, and uses it up; see
     * createOnActivation().
     * @returns {Promise<Object>}
     */
    create() {
        if (this.translator) return Promise.resolve(this.translator);
        if (!this.creating) {
            let created;
            try {
                created = this.api.create({
                    sourceLanguage: CharacterNameTranslator.SOURCE_LANGUAGE,
                    targetLanguage: CharacterNameTranslator.TARGET_LANGUAGE
                });
            } catch (error) {
                created = Promise.reject(error);
            }
            this.creating = Promise.resolve(created).then(translator => {
                this.translator = translator;
                return translator;
            }).catch(error => {
                this.creating = null;
                throw error;
            });
        }
        return this.creating;
    }

    /**
     * The translator as soon as Chrome allows it: now when the model is on the device
     * or already downloading, otherwise after the reader's first click or key press on
     * the page. Null when Chrome cannot translate here.
     * @returns {Promise<Object|null>}
     */
    whenReady() {
        this.ready ||= (async () => {
            await this.load();
            if (!this.isSupported()) return null;
            const availability = await this.availability();
            if (!['available', 'downloading', 'downloadable'].includes(availability)) return null;
            // Only starting a download needs (and uses up) a user activation.
            if (availability !== 'downloadable') {
                try {
                    return await this.create();
                } catch {
                    // Chrome wants an activation after all: the next interaction.
                }
            }
            return this.createOnActivation();
        })();
        return this.ready;
    }

    /**
     * Creates the translator a moment after a click or key press, while the page still
     * has the activation it gave; when the page's own handlers used it up, the next one.
     * A failed start waits for the next interaction too, a few times.
     * @returns {Promise<Object|null>}
     */
    createOnActivation() {
        const target = this.eventTarget;
        if (typeof target?.addEventListener !== 'function') return Promise.resolve(null);
        const events = CharacterNameTranslator.ACTIVATION_EVENTS;
        return new Promise(resolve => {
            let attempts = CharacterNameTranslator.ACTIVATION_ATTEMPTS;
            let timer = null;
            const listen = on => events.forEach(type => (on ? target.addEventListener : target.removeEventListener).call(target, type, onInput, true));
            const start = () => {
                timer = null;
                if (this.userActivation && !this.userActivation.isActive) return;
                listen(false);
                this.create().then(resolve, error => {
                    console.warn('[CharacterNameTranslator] The translator could not start:', error?.message || error);
                    attempts -= 1;
                    if (attempts > 0) listen(true);
                    else resolve(null);
                });
            };
            const onInput = () => {
                timer ??= setTimeout(start, CharacterNameTranslator.ACTIVATION_DELAY_MS);
            };
            listen(true);
        });
    }

    /**
     * «Victor Stone / Cyborg (озвучка)» as parts: each name with the notes after it.
     * @param {string} text
     * @returns {Array<{base: string, notes: string}>}
     */
    static parts(text) {
        return String(text || '').split(' / ').map(part => {
            const match = part.match(/^(.*?)((?:\s*\([^()]*\))*)\s*$/);
            return { base: (match ? match[1] : part).trim(), notes: match ? match[2] : '' };
        });
    }

    /** A name or note written in Latin letters only, which this translates. */
    static isLatinName(base) {
        return /[A-Za-z]/.test(base) && !/[А-Яа-яЁё]/.test(base) && base.length <= CharacterNameTranslator.MAX_NAME_LENGTH;
    }

    /**
     * The text in order, as pieces to keep and Latin pieces to translate: each name,
     * and what a note in parentheses says when it is in Latin letters («Grace Rigsby
     * (Van Pelt)»). Separators, parentheses and Cyrillic notes such as «(озвучка)» stay.
     * @param {string} text
     * @returns {Array<{text: string, latin: boolean}>}
     */
    static segments(text) {
        const out = [];
        CharacterNameTranslator.parts(text).forEach((part, index) => {
            if (index > 0) out.push({ text: ' / ', latin: false });
            out.push({ text: part.base, latin: CharacterNameTranslator.isLatinName(part.base) });
            for (const note of part.notes.match(/\s*\([^()]*\)/g) || []) {
                const [, opening, inner] = note.match(/^(\s*\()\s*([^()]*?)\s*\)$/) || [null, note, ''];
                if (!inner) {
                    out.push({ text: note, latin: false });
                    continue;
                }
                out.push({ text: opening, latin: false });
                out.push({ text: inner, latin: CharacterNameTranslator.isLatinName(inner) });
                out.push({ text: ')', latin: false });
            }
        });
        return out;
    }

    static needsTranslation(text) {
        return CharacterNameTranslator.segments(text).some(segment => segment.latin);
    }

    /**
     * The text with every Latin piece in Russian, from kept translations only; null
     * when one of them has not been translated yet.
     * @param {string} text
     * @returns {string|null}
     */
    cachedText(text) {
        const segments = CharacterNameTranslator.segments(text);
        if (!segments.some(segment => segment.latin)) return null;
        const out = [];
        for (const segment of segments) {
            if (!segment.latin) {
                out.push(segment.text);
                continue;
            }
            const translated = this.cache.get(segment.text);
            if (!translated) return null;
            out.push(translated);
        }
        return out.join('');
    }

    /**
     * The text with every Latin piece translated by the model; kept translations first.
     * @param {string} text
     * @returns {Promise<string|null>} null without a translator
     */
    async translateText(text) {
        if (!this.translator) return null;
        const out = [];
        for (const segment of CharacterNameTranslator.segments(text)) {
            const source = segment.text;
            if (!segment.latin) {
                out.push(source);
                continue;
            }
            let translated = this.cache.get(source);
            if (!translated) {
                let pending = this.inflight.get(source);
                if (!pending) {
                    pending = Promise.resolve(this.translator.translate(source))
                        .then(result => String(result || '').trim())
                        .finally(() => this.inflight.delete(source));
                    this.inflight.set(source, pending);
                }
                translated = await pending;
                if (translated) this.remember(source, translated);
            }
            out.push(translated || source);
        }
        return out.join('');
    }

    remember(source, translation) {
        this.cache.delete(source);
        this.cache.set(source, translation);
        while (this.cache.size > CharacterNameTranslator.CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value);
        if (this.writeTimer === null) this.writeTimer = setTimeout(() => void this.flush(), 1000);
    }

    /** Keeps the translations now (normally a second after the last new one). */
    async flush() {
        if (this.writeTimer !== null) clearTimeout(this.writeTimer);
        this.writeTimer = null;
        try {
            await this.storage?.set?.({ [CharacterNameTranslator.CACHE_KEY]: [...this.cache] });
        } catch {
            // Names are translated again on the next page.
        }
    }

    /**
     * Shows each element's name in Russian, keeping the original in
     * `data-character-original` and the tooltip. Stops when `isActive()` turns false.
     * @param {Iterable<HTMLElement>} elements
     * @param {{originalLabel?: (name: string) => string, isActive?: () => boolean}} [options]
     * @returns {Promise<boolean>} false when the model failed
     */
    async translateElements(elements, { originalLabel = name => name, isActive = () => true } = {}) {
        for (const element of Array.from(elements || [])) {
            if (!isActive()) return true;
            if (!element?.isConnected || element.dataset.characterOriginal !== undefined) continue;
            const original = element.textContent.trim();
            if (!CharacterNameTranslator.needsTranslation(original)) continue;
            let translated = this.cachedText(original);
            // Without the model yet, only kept translations, with no wait.
            if (!translated && this.translator) {
                try {
                    translated = await this.translateText(original);
                } catch (error) {
                    console.warn('[CharacterNameTranslator] Translation failed:', error?.message || error);
                    return false;
                }
            }
            if (!isActive() || !translated || translated === original || !element.isConnected || element.dataset.characterOriginal !== undefined) continue;
            element.dataset.characterOriginal = original;
            element.textContent = translated;
            element.title = originalLabel(original);
        }
        return true;
    }

    /**
     * Translates a page's names by themselves: kept translations at once, the rest
     * when the translator is ready, and on `refresh()` the names the page adds later.
     * @param {{elements: () => Iterable<HTMLElement>, enabled?: boolean, originalLabel?: (name: string) => string}} options
     * @returns {CharacterTranslationControl}
     */
    autoTranslate(options) {
        return new CharacterTranslationControl(this, options);
    }
}

/** One page's automatic translation; see CharacterNameTranslator.autoTranslate. */
class CharacterTranslationControl {
    constructor(translator, { elements, enabled = true, originalLabel = name => name }) {
        this.translator = translator;
        this.elements = typeof elements === 'function' ? elements : () => [];
        this.originalLabel = originalLabel;
        this.active = Boolean(enabled) && translator.isSupported();
        this.destroyed = false;
        this.ready = this.active ? this.start() : Promise.resolve();
    }

    async start() {
        await this.translator.load();
        if (!this.active) return;
        // Kept translations need no model: they show before the next paint.
        await this.apply();
        const model = await this.translator.whenReady();
        if (model && this.active) await this.apply();
    }

    /** Translates names added since (more rows, another tab). */
    async refresh() {
        if (this.active) await this.apply();
    }

    async apply() {
        const ok = await this.translator.translateElements(this.elements(), {
            originalLabel: this.originalLabel,
            isActive: () => this.active
        });
        if (!ok) this.active = false;
    }

    /** Stops translating, for a page that drew its names again. */
    destroy() {
        this.active = false;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = CharacterNameTranslator;
    module.exports.CharacterTranslationControl = CharacterTranslationControl;
}
if (typeof window !== 'undefined') {
    window.CharacterNameTranslator = CharacterNameTranslator;
}
