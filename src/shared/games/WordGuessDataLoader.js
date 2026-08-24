const MANIFEST_PATH = 'src/shared/data/games/word-guess/manifest.json';
const DAY_MS = 24 * 60 * 60 * 1000;

export function normalizeWord(value) {
    return String(value ?? '')
        .trim()
        .toLowerCase()
        .replaceAll('ё', 'е');
}

function defaultGetUrl(path) {
    if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
        return chrome.runtime.getURL(path);
    }
    return path;
}

function defaultFetch(...args) {
    return globalThis.fetch(...args);
}

function dateKey(date) {
    const value = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(value.getTime())) throw new Error('Некорректная дата daily puzzle');
    return value.toISOString().slice(0, 10);
}

function isDateKey(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value));
}

function validateDateKey(value, label) {
    if (!isDateKey(value)) throw new Error(`Некорректная дата ${label}: ${value}`);
    const [year, month, day] = String(value).split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
        throw new Error(`Некорректная дата ${label}: ${value}`);
    }
}

function dateAtUtcMidnight(value) {
    const [year, month, day] = String(value).split('-').map(Number);
    return Date.UTC(year, month - 1, day);
}

function decodeBase64(encoded) {
    if (typeof globalThis.atob === 'function') {
        const binary = globalThis.atob(encoded);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
            bytes[index] = binary.charCodeAt(index);
        }
        return bytes;
    }

    if (typeof globalThis.Buffer === 'function') {
        return Uint8Array.from(globalThis.Buffer.from(encoded, 'base64'));
    }

    throw new Error('Base64 декодер недоступен для WordGuess data');
}

function decodeUint16LittleEndian(encoded, expectedLength, puzzleId) {
    const bytes = decodeBase64(encoded);
    if (bytes.length !== expectedLength * 2) {
        throw new Error(`Некорректный размер таблицы рангов: ${puzzleId}`);
    }

    const ranks = new Uint16Array(expectedLength);
    for (let index = 0; index < expectedLength; index += 1) {
        ranks[index] = bytes[index * 2] | (bytes[index * 2 + 1] << 8);
    }
    return ranks;
}

export class WordGuessDataLoader {
    constructor({ fetchImpl = defaultFetch, getUrl = defaultGetUrl } = {}) {
        this.fetchImpl = fetchImpl;
        this.getUrl = getUrl;
        this.manifest = null;
        this.manifestPromise = null;
        this.vocabulary = null;
        this.vocabularyPromise = null;
        this.puzzleCache = new Map();
        this.inFlight = new Map();
    }

    async getPuzzleForDate(date = new Date()) {
        const manifest = await this.loadManifest();
        const entry = this.resolveEntry(manifest, dateKey(date));
        return this.loadPuzzle(entry);
    }

    async loadManifest() {
        if (this.manifest) return this.manifest;
        if (!this.manifestPromise) {
            this.manifestPromise = this.fetchJson(MANIFEST_PATH)
                .then((manifest) => {
                    this.manifest = this.validateManifest(manifest);
                    return this.manifest;
                })
                .catch((error) => {
                    this.manifestPromise = null;
                    throw error;
                });
        }
        return this.manifestPromise;
    }

    resolveEntry(manifest, requestedDate) {
        const exact = manifest.puzzles.find((entry) => entry.date === requestedDate);
        if (exact) return exact;
        throw new Error(`На дату ${requestedDate} нет загадки WordGuess`);
    }

    async loadPuzzle(entry) {
        const path = entry.path;
        if (this.puzzleCache.has(path)) return this.puzzleCache.get(path);
        if (!this.inFlight.has(path)) {
            this.inFlight.set(path, Promise.all([
                this.fetchJson(path),
                this.loadVocabulary(this.manifest.vocabulary.path)
            ])
                .then(([puzzle, vocabulary]) => {
                    const validated = this.validatePuzzle(puzzle, entry.id, vocabulary);
                    this.puzzleCache.set(path, validated);
                    return validated;
                })
                .finally(() => this.inFlight.delete(path)));
        }
        return this.inFlight.get(path);
    }

    async loadVocabulary(path) {
        if (this.vocabulary) return this.vocabulary;
        if (!this.vocabularyPromise) {
            this.vocabularyPromise = this.fetchJson(path)
                .then((vocabulary) => {
                    this.vocabulary = this.validateVocabulary(vocabulary);
                    return this.vocabulary;
                })
                .catch((error) => {
                    this.vocabularyPromise = null;
                    throw error;
                });
        }
        return this.vocabularyPromise;
    }

    async fetchJson(path) {
        if (typeof this.fetchImpl !== 'function') {
            throw new Error('fetch недоступен для загрузки WordGuess data');
        }
        const response = await this.fetchImpl(this.getUrl(path));
        if (!response || response.ok === false) {
            throw new Error(`Не удалось загрузить WordGuess data: ${path}`);
        }
        return response.json();
    }

    validateManifest(manifest) {
        if (!manifest || manifest.schemaVersion !== 2 || !manifest.vocabulary?.path
            || manifest.vocabulary.encoding !== 'uint16-le-base64'
            || !Array.isArray(manifest.puzzles) || !manifest.puzzles.length) {
            throw new Error('Некорректная схема WordGuess manifest');
        }

        const seenIds = new Set();
        const seenDates = new Set();
        const puzzles = manifest.puzzles
            .map((entry) => ({
                ...entry,
                id: String(entry.id || '').trim(),
                date: String(entry.date || '').trim(),
                path: String(entry.path || '').trim()
            }))
            .sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));

        for (const entry of puzzles) {
            if (!entry.id || !entry.path || !isDateKey(entry.date)) {
                throw new Error('Некорректная запись WordGuess manifest');
            }
            if (seenIds.has(entry.id) || seenDates.has(entry.date)) {
                throw new Error('Дубликат puzzle ID или даты в WordGuess manifest');
            }
            seenIds.add(entry.id);
            seenDates.add(entry.date);
            validateDateKey(entry.date, 'WordGuess manifest');
        }

        const anchorDate = manifest.rotation?.anchorDate;
        const endDate = manifest.rotation?.endDate;
        if (anchorDate) validateDateKey(anchorDate, 'rotation');
        if (endDate) validateDateKey(endDate, 'rotation');
        if ((anchorDate && !endDate) || (!anchorDate && endDate)) {
            throw new Error('WordGuess rotation должна содержать anchorDate и endDate вместе');
        }
        if (anchorDate && endDate) {
            const expectedDays = Math.floor(
                (dateAtUtcMidnight(endDate) - dateAtUtcMidnight(anchorDate)) / DAY_MS
            ) + 1;
            if (expectedDays !== puzzles.length || puzzles[0].date !== anchorDate
                || puzzles[puzzles.length - 1].date !== endDate) {
                throw new Error('WordGuess manifest должен содержать непрерывный календарь');
            }
            for (let index = 1; index < puzzles.length; index += 1) {
                const previousDate = dateAtUtcMidnight(puzzles[index - 1].date);
                const currentDate = dateAtUtcMidnight(puzzles[index].date);
                if (currentDate - previousDate !== DAY_MS) {
                    throw new Error('WordGuess manifest содержит пропуск даты');
                }
            }
        }
        return { ...manifest, puzzles };
    }

    validateVocabulary(vocabulary) {
        if (!vocabulary || vocabulary.schemaVersion !== 1 || !Array.isArray(vocabulary.words)
            || !vocabulary.words.length) {
            throw new Error('Некорректная схема WordGuess vocabulary');
        }

        const words = [];
        const wordToIndex = new Map();
        for (const value of vocabulary.words) {
            const word = normalizeWord(value);
            if (!/^[а-я]+$/i.test(word) || wordToIndex.has(word)) {
                throw new Error('Некорректное или повторяющееся слово в WordGuess vocabulary');
            }
            wordToIndex.set(word, words.length);
            words.push(word);
        }

        return { ...vocabulary, words, wordToIndex };
    }

    validatePuzzle(puzzle, expectedId, vocabulary) {
        if (!puzzle || puzzle.schemaVersion !== 2 || puzzle.rankEncoding !== 'uint16-le-base64'
            || typeof puzzle.rankTable !== 'string') {
            throw new Error(`Некорректная схема WordGuess puzzle: ${expectedId}`);
        }

        const answer = normalizeWord(puzzle.answer);
        if (!/^[а-яё]{5}$/i.test(answer) || Number(puzzle.wordLength) !== 5) {
            throw new Error(`Загаданное слово должно состоять из 5 кириллических букв: ${expectedId}`);
        }

        if (Number(puzzle.wordCount) !== vocabulary.words.length) {
            throw new Error(`WordGuess puzzle не совпадает с vocabulary: ${expectedId}`);
        }

        const rankTable = decodeUint16LittleEndian(puzzle.rankTable, vocabulary.words.length, expectedId);
        const seenRanks = new Set();
        for (const rank of rankTable) {
            if (rank < 1 || rank > rankTable.length || seenRanks.has(rank)) {
                throw new Error(`Некорректная таблица рангов WordGuess: ${expectedId}`);
            }
            seenRanks.add(rank);
        }

        const answerIndex = vocabulary.wordToIndex.get(answer);
        if (answerIndex === undefined || rankTable[answerIndex] !== 1) {
            throw new Error(`WordGuess puzzle должен иметь ранг 1 для ответа: ${expectedId}`);
        }

        return {
            ...puzzle,
            puzzleId: String(puzzle.puzzleId || expectedId),
            answer,
            wordLength: 5,
            wordCount: vocabulary.words.length,
            rankTable,
            getRank(word) {
                const index = vocabulary.wordToIndex.get(normalizeWord(word));
                return index === undefined ? undefined : rankTable[index];
            }
        };
    }
}

export { MANIFEST_PATH };
