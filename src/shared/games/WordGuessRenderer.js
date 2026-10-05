import { escapeHtml, plural, t } from './gamesI18n.js';

export class WordGuessRenderer {
    constructor({ container, controller }) {
        this.container = container;
        this.controller = controller;
        this.form = null;
        this.input = null;
        this.submitHandler = null;
        this.hintHandler = null;
        this.giveUpHandler = null;
        this.giveUpArmed = false;
        this.giveUpTimer = null;
        this.shellReady = false;
    }

    render(state) {
        if (!this.container) return;
        this.ensureShell();

        const loading = this.get('[data-role="loading"]');
        const error = this.get('[data-role="load-error"]');
        const content = this.get('[data-role="content"]');
        if (loading) loading.hidden = state.status !== 'loading';
        if (error) {
            error.hidden = state.status !== 'error';
            if (state.status === 'error') error.textContent = state.error || t('word_guess.load_error');
        }
        if (content) content.hidden = state.status === 'loading' || state.status === 'error';
        if (state.status === 'loading' || state.status === 'error') return;

        this.get('[data-role="attempts"]').textContent = String(state.attempts);
        this.get('[data-role="best-rank"]').textContent = state.bestRank === null ? '—' : String(state.bestRank);
        this.get('[data-role="puzzle-id"]').textContent = state.puzzleId
            ? t('word_guess.puzzle_of_day_id', { id: state.puzzleId })
            : t('word_guess.puzzle_of_day');
        this.renderFeedback(state.feedback);
        this.renderHistory(state.history);

        const victory = this.get('[data-role="victory"]');
        if (victory) {
            victory.hidden = !state.isWon;
            this.get('[data-role="victory-text"]').textContent = t('word_guess.victory_text', {
                count: state.attempts,
                attempts: plural(state.attempts, 'word_guess.attempt_forms')
            });
        }
        const revealed = this.get('[data-role="revealed"]');
        if (revealed) {
            revealed.hidden = !state.isRevealed;
            this.get('[data-role="revealed-answer"]').textContent = state.isRevealed ? state.answer || '' : '';
        }
        const finished = Boolean(state.isWon || state.isRevealed);
        if (this.form) this.form.hidden = finished;
        if (this.input) this.input.disabled = finished;
        const button = this.get('[data-role="submit"]');
        if (button) button.disabled = finished;
        const actions = this.get('[data-role="actions"]');
        if (actions) actions.hidden = finished;
        if (finished) this.disarmGiveUp();
        const hintCount = this.get('[data-role="hint-count"]');
        if (hintCount) hintCount.textContent = state.hintsUsed ? `· ${state.hintsUsed}` : '';
    }

    ensureShell() {
        if (this.shellReady) return;
        this.container.replaceChildren();
        this.container.innerHTML = `
            <section class="word-guess-shell" aria-labelledby="wordGuessTitle">
                <div class="word-guess-heading">
                    <div>
                        <span class="word-guess-eyebrow">${escapeHtml(t('word_guess.eyebrow'))}</span>
                        <h2 id="wordGuessTitle">${escapeHtml(t('word_guess.title'))}</h2>
                    </div>
                    <span class="word-guess-puzzle-id" data-role="puzzle-id">${escapeHtml(t('word_guess.puzzle_of_day'))}</span>
                </div>
                <div class="word-guess-stats" aria-label="${escapeHtml(t('word_guess.stats_label'))}">
                    <div class="word-guess-stat"><span>${escapeHtml(t('word_guess.attempts'))}</span><strong data-role="attempts">0</strong></div>
                    <div class="word-guess-stat"><span>${escapeHtml(t('word_guess.best_rank'))}</span><strong data-role="best-rank">—</strong></div>
                </div>
                <p class="word-guess-status" data-role="loading">${escapeHtml(t('word_guess.loading'))}</p>
                <p class="word-guess-status word-guess-status--error" data-role="load-error" hidden></p>
                <div data-role="content" hidden>
                    <form class="word-guess-form" data-role="form">
                        <label for="wordGuessInput">${escapeHtml(t('word_guess.input_label'))}</label>
                        <div class="word-guess-input-row">
                            <input id="wordGuessInput" name="word" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" aria-describedby="wordGuessFeedback" placeholder="${escapeHtml(t('word_guess.placeholder'))}">
                            <button class="word-guess-submit" data-role="submit" type="submit">${escapeHtml(t('word_guess.submit'))}</button>
                        </div>
                    </form>
                    <div class="word-guess-actions" data-role="actions">
                        <button class="word-guess-action" data-role="hint" type="button">${escapeHtml(t('word_guess.hint'))} <span data-role="hint-count"></span></button>
                        <button class="word-guess-action word-guess-action--danger" data-role="give-up" type="button">${escapeHtml(t('word_guess.give_up'))}</button>
                    </div>
                    <p class="word-guess-feedback" id="wordGuessFeedback" data-role="feedback" aria-live="polite"></p>
                    <section class="word-guess-history" aria-labelledby="wordGuessHistoryTitle">
                        <div class="word-guess-history-heading">
                            <h3 id="wordGuessHistoryTitle">${escapeHtml(t('word_guess.history_title'))}</h3>
                            <span data-role="history-count">0</span>
                        </div>
                        <ol class="word-guess-history-list" data-role="history" tabindex="0" aria-label="${escapeHtml(t('word_guess.history_label'))}"></ol>
                        <p class="word-guess-empty" data-role="empty">${escapeHtml(t('word_guess.history_empty'))}</p>
                    </section>
                    <section class="word-guess-victory" data-role="victory" role="status" hidden>
                        <span class="word-guess-victory-label">${escapeHtml(t('word_guess.victory_label'))}</span>
                        <strong>${escapeHtml(t('word_guess.rank_one'))}</strong>
                        <p data-role="victory-text"></p>
                        <p>${escapeHtml(t('word_guess.next_tomorrow'))}</p>
                    </section>
                    <section class="word-guess-victory word-guess-revealed" data-role="revealed" role="status" hidden>
                        <span class="word-guess-victory-label">${escapeHtml(t('word_guess.revealed_label'))}</span>
                        <strong data-role="revealed-answer"></strong>
                        <p>${escapeHtml(t('word_guess.next_tomorrow'))}</p>
                    </section>
                </div>
            </section>
        `;
        this.form = this.get('[data-role="form"]');
        this.input = this.get('#wordGuessInput');
        this.submitHandler = (event) => {
            event.preventDefault();
            const result = this.controller.submit(this.input.value);
            if (result.kind !== 'unavailable') this.input.value = '';
            if (!this.input.disabled) this.input.focus({ preventScroll: true });
        };
        this.form.addEventListener('submit', this.submitHandler);

        this.hintHandler = () => {
            this.disarmGiveUp();
            this.controller.hint();
            if (!this.input.disabled) this.input.focus({ preventScroll: true });
        };
        this.get('[data-role="hint"]').addEventListener('click', this.hintHandler);

        // Giving up ends the day, so the first click only arms the button.
        this.giveUpHandler = () => {
            if (!this.giveUpArmed) {
                this.armGiveUp();
                return;
            }
            this.disarmGiveUp();
            this.controller.giveUp();
        };
        this.get('[data-role="give-up"]').addEventListener('click', this.giveUpHandler);
        this.shellReady = true;
    }

    armGiveUp() {
        const button = this.get('[data-role="give-up"]');
        if (!button) return;
        this.giveUpArmed = true;
        button.classList.add('is-armed');
        button.textContent = t('word_guess.give_up_confirm');
        clearTimeout(this.giveUpTimer);
        this.giveUpTimer = setTimeout(() => this.disarmGiveUp(), 4000);
    }

    disarmGiveUp() {
        clearTimeout(this.giveUpTimer);
        this.giveUpTimer = null;
        this.giveUpArmed = false;
        const button = this.container ? this.get('[data-role="give-up"]') : null;
        if (!button) return;
        button.classList.remove('is-armed');
        button.textContent = t('word_guess.give_up');
    }

    renderFeedback(feedback) {
        const element = this.get('[data-role="feedback"]');
        if (!element) return;
        element.className = 'word-guess-feedback';
        if (!feedback) {
            element.textContent = '';
            return;
        }
        if (feedback.kind === 'not-found') {
            element.classList.add('is-error');
            element.textContent = t('word_guess.not_found');
        } else if (feedback.kind === 'duplicate') {
            element.classList.add('is-duplicate');
            element.textContent = t('word_guess.duplicate', { rank: feedback.rank });
        } else if (feedback.kind === 'invalid') {
            element.classList.add('is-error');
            element.textContent = feedback.message;
        } else if (feedback.kind === 'win') {
            element.classList.add('is-success');
            element.textContent = t('word_guess.win_feedback', {
                count: feedback.attempt,
                attempts: plural(feedback.attempt, 'word_guess.attempt_forms')
            });
        } else if (feedback.kind === 'attempt') {
            element.classList.add('is-success');
            element.textContent = t('word_guess.attempt_feedback', { attempt: feedback.attempt, rank: feedback.rank });
        } else if (feedback.kind === 'hint') {
            element.classList.add('is-hint');
            element.textContent = t('word_guess.hint_feedback', { word: feedback.word, rank: feedback.rank });
        } else if (feedback.kind === 'hint-unavailable') {
            element.classList.add('is-duplicate');
            element.textContent = feedback.message;
        } else if (feedback.kind === 'revealed') {
            element.textContent = t('word_guess.revealed_feedback', { word: feedback.answer });
        }
    }

    renderHistory(history) {
        const list = this.get('[data-role="history"]');
        const empty = this.get('[data-role="empty"]');
        const count = this.get('[data-role="history-count"]');
        if (!list || !empty || !count) return;
        count.textContent = String(history.length);
        empty.hidden = history.length > 0;

        const sortedHistory = [...history].sort((left, right) => (
            left.rank - right.rank || left.attempt - right.attempt
        ));
        const maxRank = sortedHistory.reduce((max, entry) => Math.max(max, entry.rank), 1);
        const existingItems = new Map(
            [...list.children].map((item) => [item.dataset.word, item])
        );
        const nextItems = sortedHistory.map((entry, index) => {
            let item = existingItems.get(entry.word);
            if (!item) {
                item = document.createElement('li');
                item.className = `word-guess-history-item ${this.rankTone(entry.rank)} is-entering`;
                item.dataset.word = entry.word;
                item.innerHTML = `<span class="word-guess-attempt-number">${entry.attempt}</span><span class="word-guess-word"></span><span class="word-guess-rank"><strong>${entry.rank}</strong></span>`;
                item.querySelector('.word-guess-word').textContent = entry.word;
                if (entry.hint) {
                    item.classList.add('is-hint');
                    const badge = document.createElement('span');
                    badge.className = 'word-guess-hint-badge';
                    badge.textContent = t('word_guess.hint_badge');
                    item.querySelector('.word-guess-word').append(' ', badge);
                }
                item.setAttribute('aria-label', t(entry.hint ? 'word_guess.history_hint_aria' : 'word_guess.history_item_aria', {
                    attempt: entry.attempt,
                    word: entry.word,
                    rank: entry.rank
                }));
                requestAnimationFrame(() => item.classList.remove('is-entering'));
            }
            item.classList.remove('rank-1', 'rank-near', 'rank-mid', 'rank-far');
            item.classList.add(this.rankTone(entry.rank));
            item.style.setProperty('--word-guess-stagger', `${Math.min(index, 8) * 50}ms`);
            item.style.setProperty('--word-guess-rank-fill', `${this.rankFill(entry.rank, maxRank)}%`);
            item.style.setProperty('--word-guess-rank-color', this.rankColor(entry.rank, maxRank));
            return item;
        });
        list.replaceChildren(...nextItems);
    }

    rankTone(rank) {
        if (rank === 1) return 'rank-1';
        if (rank <= 3) return 'rank-near';
        if (rank <= 10) return 'rank-mid';
        return 'rank-far';
    }

    rankFill(rank, maxRank) {
        const closeness = this.rankCloseness(rank, maxRank);
        return Math.round(12 + Math.max(0, closeness) * 88);
    }

    rankColor(rank, maxRank) {
        if (rank <= 1) return 'hsl(142 62% 54%)';
        const closeness = this.rankCloseness(rank, maxRank);
        const hue = Math.round(8 + closeness * 134);
        const lightness = Math.round(57 + closeness * 8);
        return `hsl(${hue} 78% ${lightness}%)`;
    }

    rankCloseness(rank, maxRank) {
        if (rank <= 1) return 1;
        const visualMaxRank = Math.max(maxRank, 10000);
        return Math.max(0, 1 - (Math.log(rank) / Math.log(visualMaxRank)));
    }

    get(selector) {
        return this.container.querySelector(selector);
    }

    destroy() {
        clearTimeout(this.giveUpTimer);
        this.giveUpTimer = null;
        this.giveUpArmed = false;
        if (this.form && this.submitHandler) this.form.removeEventListener('submit', this.submitHandler);
        this.container?.replaceChildren();
        this.form = null;
        this.input = null;
        this.shellReady = false;
    }
}
