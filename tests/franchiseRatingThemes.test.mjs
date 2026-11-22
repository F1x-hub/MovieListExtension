import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRatingTheme, RATING_THEMES } from '../src/shared/config/franchiseRatingThemes.js';
import { getRatingIconMarkup } from '../src/shared/components/RatingIcons.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Each franchise by its Russian and English titles, as Kinopoisk and TMDB name them.
const themed = {
    ironman: [
        { name: 'Железный человек', alternativeName: 'Iron Man', year: 2008 },
        { name: 'Железный человек 2', year: 2010 },
        { title: 'Iron Man 3', year: 2013 },
        { name: 'Железный человек: Восстание Техновора', year: 2013 },
        { name: 'Железный человек и Халк: Союз героев', year: 2013 },
        { name: 'Несокрушимый Железный человек', year: 2007 }
    ],
    avengers: [
        { name: 'Мстители', alternativeName: 'The Avengers', year: 2012 },
        { name: 'Мстители: Эра Альтрона', year: 2015 },
        { name: 'Мстители: Финал', alternativeName: 'Avengers: Endgame', year: 2019 },
        { title: 'Avengers: Infinity War', year: 2018 },
        { name: 'Мстители, общий сбор!', year: 2013 },
        { name: 'Мстители: Судный день' }
    ],
    superman: [
        { name: 'Супермен', year: 1978 },
        { name: 'Супермен', alternativeName: 'Superman', year: 2025 },
        { name: 'Возвращение Супермена', year: 2006 },
        { name: 'Бэтмен против Супермена: На заре справедливости', year: 2016 },
        { name: 'Человек из стали', alternativeName: 'Man of Steel', year: 2013 },
        { title: 'Superman & Lois', year: 2021 }
    ],
    dune: [
        { name: 'Дюна', year: 1984 },
        { name: 'Дюна', alternativeName: 'Dune', year: 2021 },
        { name: 'Дюна: Часть вторая', alternativeName: 'Dune: Part Two', year: 2024 },
        { name: 'Дюна 2' },
        { name: 'Дети Дюны', alternativeName: "Frank Herbert's Children of Dune", year: 2003 },
        { title: 'Dune: Prophecy', year: 2024 }
    ],
    spiderman: [
        { name: 'Человек-паук: Возвращение домой', year: 2017 }
    ],
    starwars: [
        { name: 'Звёздные войны: Эпизод 4 – Новая надежда', year: 1977 },
        { name: 'Андор', year: 2022 },
        { name: 'Звёздные войны: Бракованная партия', alternativeName: 'Star Wars: The Bad Batch', year: 2021 }
    ]
};

for (const [theme, movies] of Object.entries(themed)) {
    for (const movie of movies) {
        assert.equal(getRatingTheme(movie), theme, `${JSON.stringify(movie)} is rated with the ${theme} icons`);
    }
}

// Titles that only look like a franchise keep the stars.
const plain = [
    { name: 'Неуловимые мстители', alternativeName: 'The Elusive Avengers', year: 1966 },
    { name: 'Токийские мстители', alternativeName: 'Tokyo Revengers', year: 2021 },
    { name: 'Мстители', alternativeName: 'The Avengers', year: 1998 },
    { name: 'Мстители Гримм', alternativeName: 'Avengers Grimm', year: 2015 },
    { name: 'Тэцуо: Железный человек', alternativeName: 'Tetsuo: The Iron Man', year: 1989 },
    { title: 'Iron Man', year: 1931 },
    { name: 'Человек из железа', year: 1981 },
    { name: 'Суперменеджер, или Мотыга судьбы', year: 2011 },
    { name: 'Дюнкерк', alternativeName: 'Dunkirk', year: 2017 },
    { title: 'Dune Warriors', year: 1991 },
    { name: 'Интерстеллар', year: 2014 },
    // Star Wars matched these inside other words before.
    { name: 'Ящик Пандоры', year: 2008 },
    { name: 'Пандорум', alternativeName: 'Pandorum', year: 2009 },
    { name: 'Плохая партия', alternativeName: 'The Bad Batch', year: 2016 },
    {},
    null
];

for (const movie of plain) {
    assert.equal(getRatingTheme(movie), '', `${JSON.stringify(movie)} keeps the stars`);
}

// Every theme has its button markup, both pictures, and CSS that shows them. The shared rating
// dialog (film page and Ratings) owns these styles.
const css = fs.readFileSync(path.join(root, 'src/shared/styles/rating-dialog.css'), 'utf8');
for (const theme of RATING_THEMES) {
    assert.match(getRatingIconMarkup(theme), new RegExp(`class="[^"]*\\b${theme}-rating-icon\\b`), `${theme} has its own icon markup`);
    for (const state of ['active', 'inactive']) {
        const file = `src/shared/assets/icons/ratings/${theme}-rating-${state}.svg`;
        assert.match(fs.readFileSync(path.join(root, file), 'utf8'), /^<svg [^>]*viewBox=/, `${file} is an SVG picture`);
        assert.ok(css.includes(`ratings/${theme}-rating-${state}.svg`), `rating-dialog.css shows ${file}`);
    }
}
assert.match(getRatingIconMarkup(''), /^<svg /, 'an ordinary film keeps the star');
assert.match(getRatingIconMarkup('constructor'), /^<svg /, 'an unknown theme falls back to the star');

console.log('✅ Franchise rating themes: detection, markup and pictures');
