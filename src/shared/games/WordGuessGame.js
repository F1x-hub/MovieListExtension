import { WordGuessController } from './WordGuessController.js';
import { WordGuessRenderer } from './WordGuessRenderer.js';

const WORD_GUESS_STYLES_ID = 'wordGuessGameStyles';
const WORD_GUESS_STYLES_PATH = 'src/shared/styles/WordGuessGame.css';

export class WordGuessGame {
    constructor(callbacks = {}, options = {}) {
        this.callbacks = callbacks;
        this.dataLoader = options.dataLoader;
        this.now = options.now;
        this.storage = options.storage;
        this.container = options.container || null;
        this.controller = null;
        this.renderer = null;
    }

    async start() {
        this.ensureStylesLoaded();
        this.container ||= document.getElementById('wordGuessGame');
        if (!this.container) throw new Error('WordGuess container не найден');

        this.renderer = new WordGuessRenderer({ container: this.container, controller: null });
        this.controller = new WordGuessController({
            dataLoader: this.dataLoader,
            now: this.now || (() => new Date()),
            storage: this.storage,
            onStateChange: (state) => {
                this.renderer.render(state);
                this.callbacks.onStatsUpdate?.({
                    score: state.attempts,
                    highScore: state.bestRank ?? 0,
                    level: 1,
                    lines: state.history.length
                });
            }
        });
        this.renderer.controller = this.controller;
        this.renderer.render(this.controller.getState());
        return this.controller.start();
    }

    render() {
        this.renderer?.render(this.controller?.getState() || { status: 'loading' });
    }

    stop() {
        this.controller?.stop();
        this.renderer?.destroy();
        this.controller = null;
        this.renderer = null;
    }

    ensureStylesLoaded() {
        if (typeof document === 'undefined' || document.getElementById(WORD_GUESS_STYLES_ID)) return;
        const link = document.createElement('link');
        link.id = WORD_GUESS_STYLES_ID;
        link.rel = 'stylesheet';
        link.href = typeof chrome !== 'undefined' && chrome.runtime?.getURL
            ? chrome.runtime.getURL(WORD_GUESS_STYLES_PATH)
            : WORD_GUESS_STYLES_PATH;
        document.head.appendChild(link);
    }
}
