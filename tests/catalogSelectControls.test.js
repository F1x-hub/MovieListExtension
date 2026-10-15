const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { CATALOG_CATEGORIES } = require('../src/shared/config/catalogCategories.js');
const SortControl = require('../src/shared/components/SortControl.js');
const { RangeControl } = require('../src/shared/components/FilterControls.js');

const dom = new JSDOM(`
    <label for="catalogSort">Сортировка</label>
    <select id="catalogSort">
        <option value="popularity.desc">Популярные</option>
        <option value="vote_average.desc">По рейтингу</option>
    </select>
    <label for="catalogYearFrom">Год от</label>
    <input id="catalogYearFrom" type="number" min="1870" max="2100" step="1">
    <label for="catalogYearTo">Год до</label>
    <input id="catalogYearTo" type="number" min="1870" max="2100" step="1">
`);

global.window = dom.window;
global.document = dom.window.document;
global.Event = dom.window.Event;

assert.deepEqual(
    CATALOG_CATEGORIES.films.sortOptions.map(option => option.value),
    ['popularity.desc', 'vote_average.desc', 'primary_release_date.desc']
);
assert.deepEqual(
    CATALOG_CATEGORIES.series.sortOptions.map(option => option.value),
    ['popularity.desc', 'vote_average.desc', 'first_air_date.desc']
);

const select = document.getElementById('catalogSort');
const sortControl = SortControl.enhance(select);
let changeCount = 0;
select.addEventListener('change', () => changeCount += 1);

sortControl.setOptions(CATALOG_CATEGORIES.series.sortOptions);
assert.equal(select.classList.contains('sort-control__native'), true);
assert.equal(sortControl.valueLabel.textContent, 'Популярные');
assert.equal(sortControl.list.querySelectorAll('[role="option"]').length, 3);
sortControl.list.children[2].click();
assert.equal(select.value, 'first_air_date.desc');
assert.equal(sortControl.valueLabel.textContent, 'Новые сериалы');
assert.equal(changeCount, 1);
assert.equal(sortControl.list.hidden, true);

const from = document.getElementById('catalogYearFrom');
const to = document.getElementById('catalogYearTo');
const range = RangeControl.enhance(from, to, { fromLabel: 'Год от', toLabel: 'Год до' });
from.value = '2200';
to.value = '2000';
from.dispatchEvent(new Event('change', { bubbles: true }));
assert.equal(from.value, '2000');
assert.equal(to.value, '2000');
assert.equal(from.getAttribute('aria-label'), 'Год от');
assert.equal(to.getAttribute('aria-label'), 'Год до');
assert.equal(from.classList.contains('filter-field'), true);
assert.equal(to.classList.contains('filter-field'), true);
range.destroy();

console.log('✅ Catalog uses the shared sort and range controls');
