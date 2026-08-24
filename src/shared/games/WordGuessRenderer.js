export class WordGuessRenderer {
    constructor({ container, controller }) {
        this.container = container;
        this.controller = controller;
        this.form = null;
        this.input = null;
        this.submitHandler = null;
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
            if (state.status === 'error') error.textContent = state.error || 'Не удалось загрузить слово дня';
        }
        if (content) content.hidden = state.status === 'loading' || state.status === 'error';
        if (state.status === 'loading' || state.status === 'error') return;

        this.get('[data-role="attempts"]').textContent = String(state.attempts);
        this.get('[data-role="best-rank"]').textContent = state.bestRank === null ? '—' : String(state.bestRank);
        this.get('[data-role="puzzle-id"]').textContent = state.puzzleId ? `Задача дня · ${state.puzzleId}` : 'Задача дня';
        this.renderFeedback(state.feedback);
        this.renderHistory(state.history);

        const victory = this.get('[data-role="victory"]');
        if (victory) {
            victory.hidden = !state.isWon;
            this.get('[data-role="victory-attempts"]').textContent = String(state.attempts);
        }
        if (this.form) this.form.hidden = state.isWon;
        if (this.input) this.input.disabled = state.isWon;
        const button = this.get('[data-role="submit"]');
        if (button) button.disabled = state.isWon;
    }

    ensureShell() {
        if (this.shellReady) return;
        this.container.replaceChildren();
        this.container.innerHTML = `
            <section class="word-guess-shell" aria-labelledby="wordGuessTitle">
                <div class="word-guess-heading">
                    <div>
                        <span class="word-guess-eyebrow">СЕМАНТИЧЕСКАЯ ИГРА</span>
                        <h2 id="wordGuessTitle">Угадай слово</h2>
                    </div>
                    <span class="word-guess-puzzle-id" data-role="puzzle-id">Задача дня</span>
                </div>
                <div class="word-guess-stats" aria-label="Статистика игры">
                    <div class="word-guess-stat"><span>Попытки</span><strong data-role="attempts">0</strong></div>
                    <div class="word-guess-stat"><span>Лучший ранг</span><strong data-role="best-rank">—</strong></div>
                </div>
                <p class="word-guess-status" data-role="loading">Загружаем слово дня…</p>
                <p class="word-guess-status word-guess-status--error" data-role="load-error" hidden></p>
                <div data-role="content" hidden>
                    <form class="word-guess-form" data-role="form">
                        <label for="wordGuessInput">Введите слово</label>
                        <div class="word-guess-input-row">
                            <input id="wordGuessInput" name="word" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" aria-describedby="wordGuessFeedback" placeholder="Например, море">
                            <button class="word-guess-submit" data-role="submit" type="submit">Проверить</button>
                        </div>
                    </form>
                    <p class="word-guess-feedback" id="wordGuessFeedback" data-role="feedback" aria-live="polite"></p>
                    <section class="word-guess-history" aria-labelledby="wordGuessHistoryTitle">
                        <div class="word-guess-history-heading">
                            <h3 id="wordGuessHistoryTitle">История попыток</h3>
                            <span data-role="history-count">0</span>
                        </div>
                        <ol class="word-guess-history-list" data-role="history" tabindex="0" aria-label="Список попыток"></ol>
                        <p class="word-guess-empty" data-role="empty">Попытки появятся здесь</p>
                    </section>
                    <section class="word-guess-victory" data-role="victory" role="status" hidden>
                        <span class="word-guess-victory-label">СЛОВО УГАДАНО</span>
                        <strong>Ранг 1</strong>
                        <p>Победа за <span data-role="victory-attempts">0</span> попыток.</p>
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
        this.shellReady = true;
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
            element.textContent = 'Слово не найдено';
        } else if (feedback.kind === 'duplicate') {
            element.classList.add('is-duplicate');
            element.textContent = `Это слово уже было введено · Ранг ${feedback.rank}`;
        } else if (feedback.kind === 'invalid') {
            element.classList.add('is-error');
            element.textContent = feedback.message;
        } else if (feedback.kind === 'win') {
            element.classList.add('is-success');
            element.textContent = `Ранг 1 · победа за ${feedback.attempt} ${this.pluralize(feedback.attempt, 'попытку', 'попытки', 'попыток')}`;
        } else if (feedback.kind === 'attempt') {
            element.classList.add('is-success');
            element.textContent = `Попытка ${feedback.attempt} · Ранг ${feedback.rank}`;
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
                item.setAttribute('aria-label', `Попытка ${entry.attempt}: ${entry.word}, ранг ${entry.rank}`);
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

    pluralize(value, one, few, many) {
        const mod10 = value % 10;
        const mod100 = value % 100;
        if (mod10 === 1 && mod100 !== 11) return one;
        if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
        return many;
    }

    get(selector) {
        return this.container.querySelector(selector);
    }

    destroy() {
        if (this.form && this.submitHandler) this.form.removeEventListener('submit', this.submitHandler);
        this.container?.replaceChildren();
        this.form = null;
        this.input = null;
        this.shellReady = false;
    }
}
