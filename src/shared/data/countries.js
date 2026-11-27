/**
 * Countries of films: the names Kinopoisk and TMDB give, turned into ISO 3166-1
 * alpha-2 codes, and back into names in the interface language.
 *
 * Names are matched against what the browser itself calls every region in Russian
 * and English (`Intl.DisplayNames`), plus the spellings the two catalogues use
 * that the browser does not («США», «Корея Южная», «Germany (FRG)»…). One film
 * named «США» and another named «United States of America» are one country.
 *
 * Countries that no longer exist (the USSR, Yugoslavia…) keep their own name: they
 * are not handed to any present country, and the map lists them apart.
 */

// The catalogues' own spellings, lower case, «ё» as «е».
const ALIASES = {
    'сша': 'US', 'соединенные штаты': 'US', 'united states of america': 'US', 'usa': 'US',
    'великобритания': 'GB', 'united kingdom': 'GB', 'uk': 'GB', 'англия': 'GB',
    'германия (фрг)': 'DE', 'фрг': 'DE', 'west germany': 'DE',
    'корея южная': 'KR', 'южная корея': 'KR', 'республика корея': 'KR', 'south korea': 'KR', 'korea': 'KR',
    'корея северная': 'KP', 'северная корея': 'KP', 'кндр': 'KP', 'north korea': 'KP',
    'оаэ': 'AE', 'объединенные арабские эмираты': 'AE',
    'гонконг': 'HK', 'hong kong': 'HK', 'макао': 'MO', 'macao': 'MO', 'macau': 'MO',
    'тайвань': 'TW', 'taiwan': 'TW', 'китай (тайвань)': 'TW',
    'чехия': 'CZ', 'czech republic': 'CZ',
    'белоруссия': 'BY', 'беларусь': 'BY', 'belarus': 'BY',
    'молдавия': 'MD', 'молдова': 'MD',
    'киргизия': 'KG', 'кыргызстан': 'KG',
    'македония': 'MK', 'северная македония': 'MK', 'macedonia': 'MK',
    'босния-герцеговина': 'BA', 'босния и герцеговина': 'BA',
    'кот-д’ивуар': 'CI', "кот-д'ивуар": 'CI', "cote d'ivoire": 'CI', "côte d'ivoire": 'CI',
    'конго (дрк)': 'CD', 'демократическая республика конго': 'CD', 'конго': 'CG',
    'бирма': 'MM', 'мьянма': 'MM', 'myanmar': 'MM', 'burma': 'MM',
    'палестина': 'PS', 'palestinian territory': 'PS', 'palestine': 'PS',
    'иран': 'IR', 'iran': 'IR', 'вьетнам': 'VN', 'vietnam': 'VN', 'viet nam': 'VN',
    'сирия': 'SY', 'syrian arab republic': 'SY', 'лаос': 'LA', "lao people's democratic republic": 'LA',
    'ливия': 'LY', 'libyan arab jamahiriya': 'LY', 'боливия': 'BO', 'венесуэла': 'VE',
    'россия': 'RU', 'russia': 'RU', 'russian federation': 'RU',
    'косово': 'XK', 'kosovo': 'XK', 'ватикан': 'VA', 'holy see': 'VA',
    'юар': 'ZA', 'южно-африканская республика': 'ZA', 'turkey': 'TR', 'congo': 'CG'
};

// Lower case, «ё» as «е». The map lists these apart instead of on a present country.
export const HISTORICAL_COUNTRIES = Object.freeze([
    'ссср', 'soviet union', 'югославия', 'yugoslavia', 'чехословакия', 'czechoslovakia',
    'германия (гдр)', 'гдр', 'east germany', 'сербия и черногория', 'serbia and montenegro',
    'российская империя', 'zaire', 'заир'
]);
const HISTORICAL = new Set(HISTORICAL_COUNTRIES);

// «Trinidad & Tobago» and «Trinidad and Tobago» are one name.
const fold = name => String(name ?? '').trim().toLowerCase().replaceAll('ё', 'е').replaceAll('&', ' and ').replace(/\s+/g, ' ');

// Retired codes the browser still names, some exactly like a present country (DD is «Германия»),
// groupings and private-use codes: none is a country a film can be from today.
const SKIPPED_CODES = new Set([
    'AN', 'BU', 'CS', 'DD', 'DY', 'FQ', 'FX', 'HV', 'JT', 'MI', 'NH', 'NQ', 'NT', 'PC', 'PU', 'PZ',
    'RH', 'SU', 'TP', 'VD', 'WK', 'YD', 'YU', 'ZR', 'EU', 'EZ', 'UN', 'QO', 'ZZ', 'AQ'
]);

let lookup = null;

/** Every two-letter region the browser can name, keyed by its Russian and English names. */
function buildLookup() {
    const table = new Map(Object.entries(ALIASES));
    const names = ['ru', 'en'].map(locale => {
        try { return new Intl.DisplayNames([locale], { type: 'region', fallback: 'none' }); } catch { return null; }
    }).filter(Boolean);
    for (let first = 65; first <= 90; first++) {
        for (let second = 65; second <= 90; second++) {
            const code = String.fromCharCode(first, second);
            if (SKIPPED_CODES.has(code)) continue;
            for (const display of names) {
                let name;
                try { name = display.of(code); } catch { name = undefined; }
                if (!name) continue;
                const key = fold(name);
                if (!table.has(key)) table.set(key, code);
            }
        }
    }
    return table;
}

/** The ISO alpha-2 code of a catalogue's country name, or null (unknown or historical). */
export function countryCode(name) {
    const key = fold(name);
    if (!key || HISTORICAL.has(key)) return null;
    lookup ||= buildLookup();
    return lookup.get(key) || null;
}

/** Whether the name is a country that no longer exists. */
export function isHistoricalCountry(name) {
    return HISTORICAL.has(fold(name));
}

/**
 * One key per country for counting: the ISO code, or the folded name for a historical
 * or unknown country, so nothing a catalogue names is lost from a count.
 */
export function countryKey(name) {
    const key = fold(name);
    if (!key) return null;
    return countryCode(key) || `name:${key}`;
}

/** Country names of a film document: plain strings or `{ name }` objects. */
export function filmCountries(movie) {
    const list = Array.isArray(movie?.countries) ? movie.countries : [];
    return list.map(item => String(item?.name ?? item ?? '').trim()).filter(Boolean);
}

// The interface's own short names where the browser's are long or official.
const SHORT_NAMES = {
    ru: { US: 'США', GB: 'Великобритания', KR: 'Южная Корея', KP: 'Северная Корея', AE: 'ОАЭ', HK: 'Гонконг', MO: 'Макао', CD: 'ДР Конго', BA: 'Босния и Герцеговина', XK: 'Косово' },
    en: { US: 'USA', GB: 'UK', HK: 'Hong Kong', MO: 'Macao', CD: 'DR Congo', XK: 'Kosovo' }
};
const displays = new Map();

/** A country's name in the interface language: «США» for US in Russian. */
export function countryName(code, locale = 'ru') {
    const language = String(locale || 'ru').slice(0, 2);
    const short = SHORT_NAMES[language]?.[code];
    if (short) return short;
    if (!displays.has(language)) {
        try { displays.set(language, new Intl.DisplayNames([language], { type: 'region', fallback: 'code' })); } catch { displays.set(language, null); }
    }
    try { return displays.get(language)?.of(code) || code; } catch { return code; }
}

/** A historical country's name as the catalogue gave it, with a capital letter. */
export function historicalName(name) {
    const text = String(name ?? '').trim();
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}
