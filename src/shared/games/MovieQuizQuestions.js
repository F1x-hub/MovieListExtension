/**
 * Question kinds of the movie quiz and the pure rules behind them.
 *
 * - frame: a still from the film (Kinopoisk images, popular movies only);
 * - poster: the poster starts zoomed in and blurred and clears up over time,
 *   so an early answer scores more;
 * - description: the plot summary with the title and proper names hidden.
 */

export const QUESTION_TYPES = ['frame', 'poster', 'description'];
export const POSTER_REVEAL_MS = 9000;
export const POSTER_MAX_POINTS = 100;
export const POSTER_MIN_POINTS = 40;
export const QUESTION_POINTS = 100;
const DESCRIPTION_MIN_LENGTH = 60;
const DESCRIPTION_MAX_LENGTH = 340;
// A summary with most of its words hidden says nothing; such a movie gets another kind.
const MAX_MASKED_SHARE = 0.4;

const WORD_RE = /[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu;
const QUOTE_RE = /«[^«»]*»|"[^"]*"|“[^”]*”|„[^“”]*[“”]/gu;
const PART_NUMBER_RE = /^(?:\d{1,2}|[IVX]{1,4})$/;

function normalize(word) {
    return String(word).toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
}

/** Points for a correct answer: posters pay more the sooner they are guessed. */
export function pointsFor(type, elapsedMs = 0) {
    if (type !== 'poster') return QUESTION_POINTS;
    const progress = Math.min(1, Math.max(0, elapsedMs / POSTER_REVEAL_MS));
    return Math.round(POSTER_MAX_POINTS - (POSTER_MAX_POINTS - POSTER_MIN_POINTS) * progress);
}

/** Cuts a summary at a sentence end (or a word) within the length limit. */
export function clipDescription(text, maxLength = DESCRIPTION_MAX_LENGTH) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (clean.length <= maxLength) return clean;
    const head = clean.slice(0, maxLength);
    const sentenceEnd = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
    if (sentenceEnd >= maxLength * 0.5) return head.slice(0, sentenceEnd + 1);
    const space = head.lastIndexOf(' ');
    return `${head.slice(0, space > 0 ? space : maxLength).replace(/[,;:—–-]+$/, '')}…`;
}

function titleStems(title) {
    return (String(title || '').match(WORD_RE) || [])
        .filter(word => word.length >= 3)
        .map(word => {
            const lower = normalize(word);
            return lower.slice(0, Math.max(3, lower.length - 2));
        });
}

function startsSentence(text, index) {
    const before = text.slice(0, index).replace(/[\s«"„“(]+$/u, '');
    return !before || /[.!?…]$/.test(before);
}

/**
 * Splits a summary into text and hidden parts: words of the title (in any
 * form) and capitalised words inside a sentence, which are names. Returns null
 * when the summary is too short or would be mostly hidden.
 */
export function maskDescription(text, title) {
    const clipped = clipDescription(text);
    if (clipped.length < DESCRIPTION_MIN_LENGTH) return null;
    const stems = titleStems(title);
    const tokens = [...clipped.matchAll(WORD_RE)].map(match => {
        const word = match[0];
        const lower = normalize(word);
        return {
            word,
            index: match.index,
            masked: stems.some(stem => lower.startsWith(stem))
                || (/^\p{Lu}/u.test(word) && !startsSentence(clipped, match.index))
        };
    });

    // A quoted title («Ледниковый период 3») goes as a whole, numbers included.
    for (const quote of clipped.matchAll(QUOTE_RE)) {
        const start = quote.index;
        const end = start + quote[0].length;
        const inside = tokens.filter(token => token.index > start && token.index < end);
        if (inside.some(token => token.masked)) inside.forEach(token => { token.masked = true; });
    }
    // A part number right after a hidden title word («Шрек 2», «Рокки IV») is hidden too.
    tokens.forEach((token, position) => {
        const previous = tokens[position - 1];
        if (token.masked || !previous?.masked || !PART_NUMBER_RE.test(token.word)) return;
        const gap = clipped.slice(previous.index + previous.word.length, token.index);
        if (/^[\s:–—-]*$/.test(gap)) token.masked = true;
    });

    const segments = [];
    let cursor = 0;
    let maskedLetters = 0;
    let letters = 0;
    for (const { word, index, masked } of tokens) {
        letters += word.length;
        if (!masked) continue;
        if (index > cursor) segments.push({ text: clipped.slice(cursor, index), masked: false });
        segments.push({ text: word, masked: true });
        maskedLetters += word.length;
        cursor = index + word.length;
    }
    if (cursor < clipped.length) segments.push({ text: clipped.slice(cursor), masked: false });
    if (!letters || maskedLetters / letters > MAX_MASKED_SHARE) return null;
    return segments;
}

/** Kinds of question this movie can carry. */
export function availableTypes(movie) {
    const types = [];
    if (movie?.quizImageUrl) types.push('frame');
    if (movie?.posterUrl) types.push('poster');
    if (movie?.description && maskDescription(movie.description, movie.name)) types.push('description');
    return types;
}

/**
 * Gives every question a kind, spreading the kinds as evenly as the movies
 * allow: each round takes the least used kind its movie supports.
 */
export function planQuestionTypes(movies, random = Math.random) {
    const used = Object.fromEntries(QUESTION_TYPES.map(type => [type, 0]));
    return movies.map(movie => {
        const types = availableTypes(movie);
        if (!types.length) return null;
        const fewest = Math.min(...types.map(type => used[type]));
        const candidates = types.filter(type => used[type] === fewest);
        const type = candidates[Math.floor(random() * candidates.length)];
        used[type] += 1;
        return type;
    });
}
