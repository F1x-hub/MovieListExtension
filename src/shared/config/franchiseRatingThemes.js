/**
 * Picks the icon set of the rating dialog for a title: franchise films are rated
 * with their own icons instead of stars (see `RatingIcons.js`).
 *
 * Spider-Man and Star Wars keep their own modules. The franchises below match by
 * title alone. A franchise name has to open the title, or stand as a whole word,
 * and be followed by the end, a number or a subtitle, so «Неуловимые мстители»,
 * «Токийские мстители», «Дюнкерк», «Тэцуо: Железный человек» and «Суперменеджер»
 * keep the stars.
 */
import { isSpidermanMovie } from './spidermanMovies.js';
import { isStarWarsMovie } from './starwarsMovies.js';

const TITLE_FIELDS = ['name', 'title', 'movieTitle', 'nameRu', 'alternativeName', 'enName', 'originalTitle', 'nameOriginal', 'nameEn'];

// What may follow a franchise name: the end of the title, a number or a subtitle.
const NAME_END = String.raw`(?=$|\s*\d|\s*[:.,!?—–-])`;

const FRANCHISES = [
    {
        theme: 'ironman',
        titles: [
            new RegExp(String.raw`^(?:несокрушимый\s+)?железный\s+человек(?:${NAME_END}|\s+и\s)`, 'i'),
            new RegExp(String.raw`^(?:the\s+invincible\s+)?iron\s*-?\s*man(?:${NAME_END}|\s+(?:and|&)\s)`, 'i')
        ],
        // Marvel's hero dates from 1963; the «Iron Man» films of 1931 and 1951 are about boxing.
        since: 1963
    },
    {
        theme: 'avengers',
        titles: [
            new RegExp(String.raw`^мстители${NAME_END}`, 'i'),
            new RegExp(String.raw`^(?:marvel['’]?s\s+)?(?:the\s+)?avengers${NAME_END}`, 'i')
        ],
        // The British series of 1961 and its 1998 film are also «Мстители» / «The Avengers».
        since: 1999
    },
    {
        theme: 'superman',
        titles: [
            // «Возвращение Супермена», «Бэтмен против Супермена»; JS `\b` does not know Cyrillic.
            /(?<![а-яё])супермен(?:а|у|ом|е)?(?![а-яё])/i,
            /\bsuperman\b/i,
            new RegExp(String.raw`^человек\s+из\s+стали${NAME_END}`, 'i'),
            new RegExp(String.raw`^man\s+of\s+steel${NAME_END}`, 'i')
        ]
    },
    {
        theme: 'dune',
        titles: [
            new RegExp(String.raw`^(?:дети\s+)?дюн[аы]${NAME_END}`, 'i'),
            new RegExp(String.raw`^(?:frank\s+herbert['’]?s\s+)?(?:children\s+of\s+)?dune${NAME_END}`, 'i')
        ]
    }
];

export const RATING_THEMES = Object.freeze(['spiderman', 'starwars', ...FRANCHISES.map(franchise => franchise.theme)]);

/**
 * @param {object|null|undefined} movie - a movie as Movie Details holds it
 * @returns {string} one of RATING_THEMES, or '' for the ordinary stars
 */
export function getRatingTheme(movie) {
    if (!movie) return '';
    if (isSpidermanMovie(movie)) return 'spiderman';
    if (isStarWarsMovie(movie)) return 'starwars';

    const titles = TITLE_FIELDS
        .map(field => movie[field])
        .filter(title => typeof title === 'string')
        .map(title => title.trim())
        .filter(Boolean);
    if (titles.length === 0) return '';

    const year = Number.parseInt(movie.year, 10);
    const franchise = FRANCHISES.find(candidate =>
        !(candidate.since && year > 0 && year < candidate.since)
        && titles.some(title => candidate.titles.some(pattern => pattern.test(title))));
    return franchise ? franchise.theme : '';
}
