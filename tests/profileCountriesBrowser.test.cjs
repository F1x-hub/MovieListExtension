// The profile's «Страны» section (src/pages/profile/ProfileCountriesPanel.js) in real Chromium,
// with the extension's own stylesheets: the map is shaded by tier, the list opens a country in
// the films panel and lights it on the map, the map opens and closes it too, hover outlines a
// country above its neighbours, small countries are rounded squares, Escape closes, both themes
// keep the chosen country apart from every shade, and a narrow window puts the list first.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json' };

const PAGE = `<!doctype html><html class="dark-theme"><head><meta charset="utf-8">
<link rel="stylesheet" href="/src/shared/styles/common.css">
<link rel="stylesheet" href="/src/shared/styles/theme.css">
<link rel="stylesheet" href="/src/shared/styles/components.css">
<link rel="stylesheet" href="/src/shared/styles/profile.css">
</head><body class="dark-theme"><main style="max-width:1112px;margin:24px auto;padding:0 16px">
<section class="profile-section"><div class="insight-body" id="body"></div></section></main>
<script type="module">
import { ProfileCountriesPanel } from '/src/pages/profile/ProfileCountriesPanel.js';
import { computeCountries } from '/src/pages/profile/ProfileInsights.js';
const TEXT = {
  countries_most: 'Чаще всего', countries_fewer: 'Свернуть', countries_elsewhere: 'Нет на карте: {list}.', countries_empty: 'Пусто',
  countries_legend_none: 'нет оценок', countries_legend_one: '1 фильм', countries_legend_few: '2–9', countries_legend_many: '10–49', countries_legend_most: '50 и больше',
  countries_all_many: 'Все {n} стран', countries_all_few: 'Все {n} страны', countries_all_one: 'Все {n} страна', countries_all_other: 'Все {n} страны',
  films_count_one: '{n} фильм', films_count_few: '{n} фильма', films_count_many: '{n} фильмов', films_count_other: '{n} фильма',
  genre_average: 'средняя {n}', country_catalog: 'Страна в каталоге', taste_scores: 'Ваши оценки', taste_all_scores: 'Все оценки',
  taste_order: 'Порядок', taste_order_best: 'Сначала лучшие', taste_order_worst: 'Сначала худшие', taste_order_recent: 'Недавние', taste_order_gap: 'Дальше от других',
  taste_average_one: '{n} фильм, в среднем {average}', taste_average_few: '{n} фильма, в среднем {average}', taste_average_many: '{n} фильмов, в среднем {average}', taste_average_other: '{n} фильма, в среднем {average}',
  taste_others: 'Другие в расширении', taste_same: 'так же', taste_above: 'вы ставите на {n} выше', taste_below: 'вы ставите на {n} ниже',
  taste_by_films_one: 'по {n} фильму', taste_by_films_few: 'по {n} фильмам', taste_by_films_many: 'по {n} фильмам', taste_by_films_other: 'по {n} фильмам',
  taste_more: 'Показать ещё {n} из {total}', people_more: 'Показать ещё {n}', taste_less: 'Свернуть'
};
// 250 American films, 64 British, 37 Canadian, 6 from Hong Kong, 1 from Malta, 2 Soviet, ...
const spec = [['США', 250], ['Великобритания', 64], ['Канада', 37], ['Япония', 28], ['Франция', 26], ['Германия', 22], ['Австралия', 12], ['Гонконг', 6], ['Мальта', 1], ['Грузия', 3], ['СССР', 2]];
const movies = {}; const ratings = []; let id = 1;
for (const [country, count] of spec) for (let i = 0; i < count; i++, id++) {
  movies[id] = { name: country + ' ' + i, year: 1990 + (i % 30), countries: [country], ratingsCount: 3, ratingsSum: 21 };
  ratings.push({ movieId: String(id), rating: 1 + (id % 10), createdAt: id });
}
const view = {
  data: { ratings, movies, isOther: false },
  i18n: { currentLocale: 'ru' },
  escape: value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),
  t(key, params = {}) { let text = TEXT[key] ?? key; for (const [k, v] of Object.entries(params)) text = text.replaceAll('{' + k + '}', String(v)); return text; },
  tn(key, n, params = {}) { return this.t(key + '_' + new Intl.PluralRules('ru-RU').select(n), { n, ...params }); },
  formatScore: n => n.toFixed(1).replace('.', ','),
  boldNumber: (key, n) => String(n),
  revealFilms() {},
  filmPoster: film => '<li><a class="insight-film" href="#">' + film.movieId + '</a></li>'
};
window.panel = new ProfileCountriesPanel(view);
window.panel.render(document.getElementById('body'), computeCountries(ratings, movies));
window.ready = true;
</script></body></html>`;

(async () => {
    const server = http.createServer((request, response) => {
        const url = decodeURIComponent(request.url.split('?')[0]);
        if (url === '/') { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(PAGE); return; }
        const file = path.join(root, url);
        if (!file.startsWith(root) || !fs.existsSync(file)) { response.writeHead(404); response.end(); return; }
        response.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
        response.end(fs.readFileSync(file));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1240, height: 1000 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(() => {
            // Transitions would leave mid-way colours in a headless frame.
            document.addEventListener('DOMContentLoaded', () => {
                const style = document.createElement('style');
                style.textContent = '* { transition: none !important; }';
                document.head.appendChild(style);
            });
        });
        await page.goto(origin);
        await page.waitForFunction(() => window.ready === true);

        const info = await page.evaluate(() => {
            const fill = selector => getComputedStyle(document.querySelector(selector)).fill;
            return {
                shaded: document.querySelectorAll('.insight-map__country[data-code]').length,
                small: [...document.querySelectorAll('.insight-map__small')].map(el => el.dataset.code).sort(),
                circles: document.querySelectorAll('.insight-map circle').length,
                rows: [...document.querySelectorAll('.insight-countries__rows .insight-genres__row')].map(row => row.dataset.value),
                more: [...document.querySelectorAll('.insight-countries__more .insight-genres__row')].map(row => row.dataset.value),
                moreHidden: document.querySelector('.insight-countries__more').hidden,
                all: document.querySelector('.insight-countries__all').textContent,
                elsewhere: document.querySelector('.insight-map__elsewhere').textContent,
                tipShown: getComputedStyle(document.querySelector('.insight-map__tip')).display !== 'none',
                svgHidden: document.querySelector('.insight-map__svg').getAttribute('aria-hidden'),
                focusableInMap: document.querySelectorAll('.insight-map [tabindex]').length,
                tiers: { usa: fill('[data-code="US"]'), uk: fill('[data-code="GB"]'), canada: fill('[data-code="CA"]'), georgia: fill('[data-code="GE"]'), malta: fill('[data-code="MT"]') }
            };
        });
        assert.equal(info.shaded, 8, 'US GB CA JP FR DE AU GE');
        assert.deepEqual(info.small, ['HK', 'MT']);
        assert.equal(info.circles, 0, 'the only circle in the interface is an avatar');
        assert.deepEqual(info.rows, ['US', 'GB', 'CA', 'JP', 'FR', 'DE']);
        assert.deepEqual(info.more, ['AU', 'HK', 'GE', 'MT'], 'the rest, in order, under map and list');
        assert.equal(info.moreHidden, true);
        assert.equal(info.all, 'Все 10 стран');
        assert.equal(info.elsewhere, 'Нет на карте: СССР — 2 фильма.');
        assert.equal(info.tipShown, false, 'a hidden tooltip takes no room under the map');
        assert.equal(info.svgHidden, 'true');
        assert.equal(info.focusableInMap, 0, 'the list, not the map, is the keyboard path');
        assert.equal(info.tiers.usa, info.tiers.uk, '250 and 64 films are one shade (50 and more)');
        assert.notEqual(info.tiers.uk, info.tiers.canada);
        assert.notEqual(info.tiers.georgia, info.tiers.malta, '3 films and 1 film are different shades');

        // The list opens a country: the panel, the expanded row and the lit country agree.
        await page.click('[data-taste="country"][data-value="JP"]');
        const opened = await page.evaluate(() => {
            const panel = document.getElementById('insightCountryFilms');
            return { open: panel.classList.contains('is-open'), name: panel.querySelector('.insight-films__name').textContent,
                link: panel.querySelector('.insight-films__link').getAttribute('href'), group: panel.dataset.group,
                chosen: [...document.querySelectorAll('.insight-map .is-chosen')].map(el => el.dataset.code),
                fill: getComputedStyle(document.querySelector('[data-code="JP"]')).fill,
                content: getComputedStyle(document.body).color };
        });
        assert.deepEqual([opened.open, opened.name, opened.group], [true, 'Япония', 'country']);
        assert.equal(opened.link, '../catalog/catalog.html?category=films&country=JP');
        assert.deepEqual(opened.chosen, ['JP']);
        assert.notEqual(opened.fill, info.tiers.usa, 'the chosen country stands apart from the brightest shade');

        // The map opens another country and closes it again; a country beyond the six unfolds the list.
        const point = async code => page.evaluate(code => {
            const el = document.querySelector(`.insight-map [data-code="${code}"]`);
            const box = el.getBoundingClientRect();
            for (const fy of [0.5, 0.6, 0.4, 0.7, 0.3]) for (const fx of [0.5, 0.4, 0.6, 0.3, 0.7]) {
                const x = box.left + box.width * fx, y = box.top + box.height * fy;
                if (document.elementFromPoint(x, y) === el) return { x, y };
            }
            return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
        }, code);
        let at = await point('AU');
        await page.mouse.move(at.x, at.y);
        const hover = await page.evaluate(() => ({ code: document.querySelector('.insight-map .is-hover')?.dataset.code,
            outline: Boolean(document.querySelector('.insight-map__outline').getAttribute('d')),
            tip: document.querySelector('.insight-map__tip').textContent }));
        assert.deepEqual([hover.code, hover.outline], ['AU', true]);
        assert.match(hover.tip, /^Австралия12 фильмов · средняя \d,\d$/);
        await page.mouse.click(at.x, at.y);
        assert.equal(await page.getAttribute('[data-taste="country"][data-value="AU"]', 'aria-expanded'), 'true');
        assert.equal(await page.isVisible('[data-taste="country"][data-value="AU"]'), true, 'a seventh country unfolds the list');
        const unfolded = await page.evaluate(() => {
            const map = document.querySelector('.insight-countries__map').getBoundingClientRect();
            const list = document.querySelector('.insight-countries__list').getBoundingClientRect();
            const more = document.querySelector('.insight-countries__more').getBoundingClientRect();
            const bright = [...document.querySelectorAll('.insight-countries .insight-genres__bar i')]
                .filter(bar => getComputedStyle(bar).backgroundColor === getComputedStyle(document.body).color).length;
            return { below: more.top >= Math.max(map.bottom, list.bottom) - 1, wide: more.width > list.width * 1.5, bright };
        });
        assert.deepEqual(unfolded, { below: true, wide: true, bright: 1 }, 'the rest sits under both, across the width, and one bar is bright');
        assert.equal(await page.textContent('.insight-countries__all'), 'Свернуть');
        await page.mouse.click(at.x, at.y);
        assert.equal(await page.evaluate(() => document.querySelectorAll('.insight-map .is-chosen').length), 0, 'a second press closes');

        // A small country is a rounded square and outlined as one.
        at = await point('HK');
        await page.mouse.move(at.x, at.y);
        assert.equal(await page.evaluate(() => document.querySelector('.insight-map .is-hover')?.tagName), 'rect');
        assert.match(await page.getAttribute('.insight-map__outline', 'd'), /a3\.5,3\.5/);
        await page.mouse.move(2, 2);
        assert.equal(await page.evaluate(() => document.querySelector('.insight-map__outline').hasAttribute('d')), false);

        // Escape closes from the list.
        await page.click('[data-taste="country"][data-value="FR"]');
        await page.keyboard.press('Escape');
        assert.equal(await page.evaluate(() => document.getElementById('insightCountryFilms').classList.contains('is-open')), false);

        // Both themes keep five distinct shades and the chosen country apart from them.
        for (const theme of ['dark', 'light']) {
            await page.evaluate(theme => { for (const el of [document.documentElement, document.body]) el.className = `${theme}-theme`; }, theme);
            await page.click('[data-taste="country"][data-value="JP"]');
            const shades = await page.evaluate(() => {
                const legend = [...document.querySelectorAll('.insight-map__legend i')].map(el => getComputedStyle(el).backgroundColor);
                return { legend, chosen: getComputedStyle(document.querySelector('[data-code="JP"]')).fill };
            });
            assert.equal(new Set(shades.legend).size, 5, `${theme}: five legend shades ${shades.legend}`);
            assert.ok(!shades.legend.includes(shades.chosen), `${theme}: chosen is no shade`);
            await page.screenshot({ path: path.join(root, '.e2e-output', `profile-countries-${theme}.png`), fullPage: true });
            await page.keyboard.press('Escape');
        }

        // A narrow window: the list first, the map under it.
        await page.setViewportSize({ width: 400, height: 900 });
        const order = await page.evaluate(() => {
            const top = selector => document.querySelector(selector).getBoundingClientRect().top;
            return { list: top('.insight-countries__list'), map: top('.insight-countries__map'), scroll: document.documentElement.scrollWidth > innerWidth };
        });
        assert.ok(order.list < order.map, 'list above the map');
        assert.equal(order.scroll, false, 'no sideways scroll at 400px');

        assert.deepEqual(errors, []);
        console.log('profileCountriesBrowser: shades, list and map selection, hover outline, small squares, Escape, both themes and narrow layout passed');
    } finally {
        await browser.close();
        server.close();
    }
})().catch(error => { console.error(error); process.exit(1); });
