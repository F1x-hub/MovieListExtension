import { WordGuessDataLoader, localDateKey, normalizeWord } from './WordGuessDataLoader.js';
import { t } from './gamesI18n.js';

export const WORD_GUESS_PROGRESS_KEY = 'wordGuessProgressV1';
// The first hint lands in the warm zone; each next one halves the best rank.
export const WORD_GUESS_FIRST_HINT_RANK = 1000;

function createDefaultProgressStorage() {
    const storage = globalThis.chrome?.storage?.local;
    if (!storage) return null;

    return {
        get(key) {
            return new Promise((resolve) => {
                try {
                    storage.get(key, (result) => resolve(result || {}));
                } catch {
                    resolve({});
                }
            });
        },
        set(key, value) {
            return new Promise((resolve) => {
                try {
                    storage.set({ [key]: value }, () => resolve());
                } catch {
                    resolve();
                }
            });
        },
        remove(key) {
            return new Promise((resolve) => {
                try {
                    storage.remove(key, () => resolve());
                } catch {
                    resolve();
                }
            });
        }
    };
}

export class WordGuessController {
    constructor({
        dataLoader = new WordGuessDataLoader(),
        now = () => new Date(),
        onStateChange = () => {},
        storage
    } = {}) {
        this.dataLoader = dataLoader;
        this.now = now;
        this.onStateChange = onStateChange;
        this.storage = storage === undefined ? createDefaultProgressStorage() : storage;
        this.persistencePromise = Promise.resolve();
        this.puzzle = null;
        this.history = [];
        this.attempts = 0;
        this.bestRank = null;
        this.day = null;
        this.status = 'idle';
        this.error = null;
        this.feedback = null;
        this.isWon = false;
        this.isRevealed = false;
        this.generation = 0;
    }

    async start() {
        const generation = ++this.generation;
        const currentDate = this.now();
        this.puzzle = null;
        this.history = [];
        this.attempts = 0;
        this.bestRank = null;
        this.day = localDateKey(currentDate);
        this.status = 'loading';
        this.error = null;
        this.feedback = null;
        this.isWon = false;
        this.isRevealed = false;
        this.emit('loading');

        try {
            const puzzle = await this.dataLoader.getPuzzleForDate(currentDate);
            if (generation !== this.generation) return null;
            this.puzzle = puzzle;
            await this.restoreProgress(puzzle, this.day);
            if (generation !== this.generation) return null;
            this.status = 'ready';
            if (this.isWon) this.status = 'won';
            else if (this.isRevealed) this.status = 'revealed';
            this.emit('ready');
            return this.getState();
        } catch (error) {
            if (generation !== this.generation) return null;
            this.status = 'error';
            console.warn('[WordGuess] Failed to load the daily puzzle:', error?.message || error);
            this.error = t('word_guess.load_error');
            this.emit('error');
            return this.getState();
        }
    }

    stop() {
        this.generation += 1;
        this.status = 'stopped';
    }

    submit(value) {
        if (this.status === 'loading' || this.status === 'idle') {
            return { kind: 'unavailable' };
        }
        if (this.status === 'error' || this.status === 'stopped' || !this.puzzle) {
            return { kind: 'unavailable' };
        }
        if (this.isWon) {
            return { kind: 'won', attempts: this.attempts };
        }
        if (this.isRevealed) {
            return { kind: 'revealed', attempts: this.attempts };
        }

        const word = normalizeWord(value);
        if (!word) return this.setFeedback({ kind: 'invalid', message: t('word_guess.enter_word') });

        const duplicate = this.history.find((entry) => entry.word === word);
        if (duplicate) {
            return this.setFeedback({ kind: 'duplicate', word, rank: duplicate.rank });
        }

        const rank = this.puzzle.getRank(word);
        if (rank === undefined) {
            return this.setFeedback({ kind: 'not-found', word, message: t('word_guess.not_found') });
        }

        const entry = this.recordEntry(word, rank);
        this.isWon = rank === 1;
        this.status = this.isWon ? 'won' : 'ready';
        this.persistProgress();
        return this.setFeedback({ kind: this.isWon ? 'win' : 'attempt', ...entry });
    }

    canPlay() {
        return this.status === 'ready' && Boolean(this.puzzle) && !this.isWon && !this.isRevealed;
    }

    /**
     * Reveals an unguessed word that is closer than the current best rank. The
     * hint counts as an attempt and never reveals the answer itself.
     */
    hint() {
        if (!this.canPlay()) return { kind: 'unavailable' };
        if (typeof this.puzzle.getWordByRank !== 'function') return { kind: 'unavailable' };

        if (this.bestRank !== null && this.bestRank <= 2) {
            return this.setFeedback({
                kind: 'hint-unavailable',
                message: t('word_guess.hint_unavailable')
            });
        }

        const usedWords = new Set(this.history.map((entry) => entry.word));
        let target = this.bestRank === null
            ? Math.min(WORD_GUESS_FIRST_HINT_RANK, this.puzzle.wordCount || WORD_GUESS_FIRST_HINT_RANK)
            : Math.floor(this.bestRank / 2);
        target = Math.max(2, target);
        while (target >= 2) {
            const word = this.puzzle.getWordByRank(target);
            if (word && !usedWords.has(word)) {
                const entry = this.recordEntry(word, target, { hint: true });
                this.persistProgress();
                return this.setFeedback({ kind: 'hint', ...entry });
            }
            target -= 1;
        }
        return this.setFeedback({
            kind: 'hint-unavailable',
            message: t('word_guess.hint_unavailable')
        });
    }

    /** Ends today's game by revealing the answer; the result is kept for the day. */
    giveUp() {
        if (!this.canPlay()) return { kind: 'unavailable' };
        this.isRevealed = true;
        this.status = 'revealed';
        this.persistProgress();
        return this.setFeedback({ kind: 'revealed', answer: this.puzzle.answer });
    }

    recordEntry(word, rank, { hint = false } = {}) {
        const entry = { word, rank, attempt: this.history.length + 1 };
        if (hint) entry.hint = true;
        this.history.push(entry);
        this.attempts += 1;
        this.bestRank = this.bestRank === null ? rank : Math.min(this.bestRank, rank);
        return entry;
    }

    async restoreProgress(puzzle, currentDay) {
        if (!this.storage) return;

        try {
            const stored = await this.storage.get(WORD_GUESS_PROGRESS_KEY);
            const progress = stored?.[WORD_GUESS_PROGRESS_KEY];
            if (!progress || progress.day !== currentDay || progress.puzzleId !== puzzle.puzzleId) {
                if (progress) await this.storage.remove(WORD_GUESS_PROGRESS_KEY);
                return;
            }

            const restoredHistory = [];
            const seenWords = new Set();
            for (const entry of Array.isArray(progress.history) ? progress.history : []) {
                const word = normalizeWord(entry?.word);
                const rank = Number(entry?.rank);
                if (!word || seenWords.has(word) || puzzle.getRank(word) !== rank) continue;
                const restored = { word, rank, attempt: restoredHistory.length + 1 };
                if (entry.hint === true) restored.hint = true;
                restoredHistory.push(restored);
                seenWords.add(word);
            }

            this.history = restoredHistory;
            this.attempts = restoredHistory.length;
            this.bestRank = restoredHistory.length
                ? Math.min(...restoredHistory.map((entry) => entry.rank))
                : null;
            this.isWon = restoredHistory.some((entry) => entry.rank === 1);
            this.isRevealed = !this.isWon && progress.isRevealed === true;
        } catch {
            // Persistence is best-effort; gameplay remains available if storage fails.
        }
    }

    persistProgress() {
        if (!this.storage || !this.puzzle || !this.day) return;
        const progress = {
            day: this.day,
            puzzleId: this.puzzle.puzzleId,
            history: this.history.map((entry) => ({ ...entry })),
            attempts: this.attempts,
            bestRank: this.bestRank,
            isWon: this.isWon,
            isRevealed: this.isRevealed
        };
        this.persistencePromise = this.persistencePromise
            .catch(() => {})
            .then(() => this.storage.set(WORD_GUESS_PROGRESS_KEY, progress))
            .catch(() => {});
    }

    getState() {
        return {
            status: this.status,
            error: this.error,
            feedback: this.feedback ? { ...this.feedback } : null,
            puzzleId: this.puzzle?.puzzleId || null,
            history: this.history.map((entry) => ({ ...entry })),
            attempts: this.attempts,
            bestRank: this.bestRank,
            isWon: this.isWon,
            isRevealed: this.isRevealed,
            hintsUsed: this.history.filter((entry) => entry.hint).length,
            answer: this.isWon || this.isRevealed ? this.puzzle?.answer || null : null
        };
    }

    setFeedback(feedback) {
        this.feedback = feedback;
        this.emit(feedback.kind);
        return { ...feedback, attempts: this.attempts, bestRank: this.bestRank };
    }

    emit(event) {
        this.onStateChange(this.getState(), event);
    }
}

export { normalizeWord };
