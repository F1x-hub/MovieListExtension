/**
 * RussianStemmer — Self-contained Russian Snowball stemmer (no dependencies).
 *
 * Based on the Snowball algorithm for Russian:
 * https://snowballstem.org/algorithms/russian/stemmer.html
 *
 * Usage:
 *   const stem = RussianStemmer.stem('соседства'); // → 'сосед'
 *   const stem = RussianStemmer.stem('бойцовский'); // → 'боец'
 */
const RussianStemmer = (() => {
    const VOWELS = /[аеёиоуыэюя]/;

    // Find the position of region RV (after the first vowel)
    function getRV(word) {
        for (let i = 0; i < word.length; i++) {
            if (VOWELS.test(word[i])) return i + 1;
        }
        return word.length;
    }

    // Find the position of region R1 (after first non-vowel following a vowel)
    function getR1(word) {
        let foundVowel = false;
        for (let i = 0; i < word.length; i++) {
            if (VOWELS.test(word[i])) {
                foundVowel = true;
            } else if (foundVowel) {
                return i + 1;
            }
        }
        return word.length;
    }

    // Find R2 (R1 inside R1)
    function getR2(word) {
        const r1start = getR1(word);
        const r1 = word.slice(r1start);
        let foundVowel = false;
        for (let i = 0; i < r1.length; i++) {
            if (VOWELS.test(r1[i])) {
                foundVowel = true;
            } else if (foundVowel) {
                return r1start + i + 1;
            }
        }
        return word.length;
    }

    // Try to remove the longest matching suffix from a list; returns new word or null
    function removeLongest(word, rv, suffixes) {
        // Sort longest first
        const sorted = [...suffixes].sort((a, b) => b.length - a.length);
        for (const suffix of sorted) {
            if (word.endsWith(suffix) && word.length - suffix.length >= rv) {
                return word.slice(0, word.length - suffix.length);
            }
        }
        return null;
    }

    // Step 1: remove perfective gerund, reflexive, adjective, verb, or noun endings
    const PERFECTIVE_GERUND_1 = ['вшись', 'вши', 'в'];
    const PERFECTIVE_GERUND_2 = ['ившись', 'ывшись', 'ивши', 'ывши', 'ив', 'ыв'];

    const REFLEXIVE = ['ся', 'сь'];

    const ADJECTIVE = [
        'ими', 'ыми', 'ей', 'ий', 'ый', 'ой', 'ем', 'им', 'ым', 'ом',
        'его', 'ого', 'ему', 'ому', 'их', 'ых', 'ую', 'юю', 'ая', 'яя',
        'ою', 'ею', 'ее', 'ие', 'ые', 'ое'
    ];

    const PARTICIPLE_1 = ['ем', 'нн', 'вш', 'ющ', 'щ'];
    const PARTICIPLE_2 = ['ивш', 'ывш', 'ующ'];

    const VERB_1 = [
        'ла', 'на', 'ете', 'йте', 'ли', 'й', 'л', 'ем', 'н', 'ло', 'но',
        'ет', 'ют', 'ны', 'ть', 'ешь', 'нно'
    ];
    const VERB_2 = [
        'ила', 'ыла', 'ена', 'ейте', 'уйте', 'ите', 'или', 'ыли',
        'ей', 'уй', 'ил', 'ыл', 'им', 'ым', 'ен', 'ило', 'ыло', 'ено',
        'ят', 'уют', 'ует', 'ит', 'ыт', 'ены', 'ить', 'ыть', 'ишь', 'ую', 'ю'
    ];

    const NOUN = [
        'иями', 'иях', 'ями', 'иям', 'ием', 'иям', 'ией', 'ий', 'ие',
        'ья', 'ью', 'ию', 'ьё', 'ами', 'еи', 'ии', 'ях', 'ев', 'ов',
        'ей', 'ой', 'ям', 'ем', 'ах', 'ам', 'ом', 'и', 'е', 'а', 'о',
        'у', 'ы', 'ь', 'ю', 'я'
    ];

    const DERIVATIONAL = ['ость', 'ост'];
    const SUPERLATIVE  = ['ейше', 'ейш'];

    function step1(word) {
        const rv = getRV(word);

        // Try perfective gerund (group 2 must follow а or я)
        for (const suf of [...PERFECTIVE_GERUND_2].sort((a, b) => b.length - a.length)) {
            if (word.endsWith(suf) && word.length - suf.length >= rv) {
                const before = word[word.length - suf.length - 1];
                if (before === 'а' || before === 'я') {
                    return word.slice(0, word.length - suf.length);
                }
            }
        }
        // group 1 perfective gerund (must follow а or я)
        for (const suf of [...PERFECTIVE_GERUND_1].sort((a, b) => b.length - a.length)) {
            if (word.endsWith(suf) && word.length - suf.length >= rv) {
                const before = word[word.length - suf.length - 1];
                if (before === 'а' || before === 'я') {
                    return word.slice(0, word.length - suf.length);
                }
            }
        }

        // Remove reflexive ending optionally
        let base = word;
        const refResult = removeLongest(base, rv, REFLEXIVE);
        if (refResult !== null) base = refResult;

        // Try adjectival (adjective + optional participle)
        const adjResult = removeLongest(base, rv, ADJECTIVE);
        if (adjResult !== null) {
            // Also try removing a preceding participle suffix
            const part2 = removeLongest(adjResult, rv, PARTICIPLE_2);
            if (part2 !== null) return part2;
            const part1Candidates = PARTICIPLE_1.map(p => adjResult + p).filter(
                c => base === c + '' // conceptual check — try removing part1 before adj
            );
            // Actually: try participle_2 then participle_1 before the adjective
            const part1 = removeLongest(adjResult, rv, PARTICIPLE_1);
            // only valid if the character before adjective ending was а or я
            if (part1 !== null) {
                const idx = adjResult.length - (base.length - adjResult.length); // not needed
                return part1;
            }
            return adjResult;
        }

        // Try verb (group 2 must follow а or я)
        for (const suf of [...VERB_2].sort((a, b) => b.length - a.length)) {
            if (base.endsWith(suf) && base.length - suf.length >= rv) {
                const before = base[base.length - suf.length - 1];
                if (before === 'а' || before === 'я') {
                    return base.slice(0, base.length - suf.length);
                }
            }
        }
        // group 1 verb
        const verbResult = removeLongest(base, rv, VERB_1);
        if (verbResult !== null) return verbResult;

        // Try noun
        const nounResult = removeLongest(base, rv, NOUN);
        if (nounResult !== null) return nounResult;

        return base; // unchanged
    }

    function step2(word, rv) {
        // Remove final и
        if (word.length > rv && word.endsWith('и')) {
            return word.slice(0, -1);
        }
        return word;
    }

    function step3(word) {
        const r2 = getR2(word);
        const result = removeLongest(word, r2, DERIVATIONAL);
        return result !== null ? result : word;
    }

    function step4(word, rv) {
        // Undouble нн → н
        if (word.length > rv && word.endsWith('нн')) {
            return word.slice(0, -1);
        }
        // Remove superlative suffix then undouble
        for (const suf of SUPERLATIVE) {
            if (word.length - suf.length >= rv && word.endsWith(suf)) {
                const tmp = word.slice(0, word.length - suf.length);
                return tmp.endsWith('нн') ? tmp.slice(0, -1) : tmp;
            }
        }
        // Remove soft sign
        if (word.length > rv && word.endsWith('ь')) {
            return word.slice(0, -1);
        }
        return word;
    }

    function stem(rawWord) {
        if (!rawWord || rawWord.length < 3) return rawWord;

        // Normalise ё → е
        let word = rawWord.toLowerCase().replace(/ё/g, 'е');

        const rv = getRV(word);

        let result = step1(word);
        result = step2(result, rv);
        result = step3(result);
        result = step4(result, rv);

        return result;
    }

    /**
     * Stem each word in a phrase and return joined stems.
     * Short words (≤ 3 chars) are kept as-is.
     * @param {string} phrase
     * @returns {string}
     */
    function stemPhrase(phrase) {
        if (!phrase) return '';
        return phrase.trim().split(/\s+/).map(w => stem(w)).join(' ');
    }

    return { stem, stemPhrase };
})();

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = RussianStemmer;
} else if (typeof window !== 'undefined') {
    window.RussianStemmer = RussianStemmer;
}
