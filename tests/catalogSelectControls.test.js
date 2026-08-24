const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { CATALOG_CATEGORIES } = require('../src/shared/config/catalogCategories.js');

const dom = new JSDOM(`
    <label for="catalogSort">Сортировка</label>
    <select id="catalogSort">
        <option value="popularity.desc">Популярные</option>
        <option value="vote_average.desc">По рейтингу</option>
    </select>
    <input id="catalogYearFrom" type="number" min="1870" max="2100" step="1">
`);

global.window = dom.window;
global.document = dom.window.document;
global.Event = dom.window.Event;
const addEventListener = document.addEventListener.bind(document);
document.addEventListener = (type, listener, options) => {
    if (type === 'DOMContentLoaded') return;
    return addEventListener(type, listener, options);
};
require('../src/pages/catalog/catalog.js');

assert.deepEqual(
    CATALOG_CATEGORIES.films.sortOptions.map(option => option.value),
    ['popularity.desc', 'vote_average.desc', 'primary_release_date.desc']
);
assert.deepEqual(
    CATALOG_CATEGORIES.series.sortOptions.map(option => option.value),
    ['popularity.desc', 'vote_average.desc', 'first_air_date.desc']
);

const select = document.getElementById('catalogSort');
const customSelect = window.CatalogSelect.enhance(select);
let changeCount = 0;
select.addEventListener('change', () => changeCount += 1);

customSelect.setOptions(CATALOG_CATEGORIES.series.sortOptions);
assert.equal(select.classList.contains('catalog-select__native'), true);
assert.equal(customSelect.triggerText.textContent, 'Популярные');
assert.equal(customSelect.menu.querySelectorAll('[role="option"]').length, 3);

customSelect.open();
assert.equal(customSelect.menu.hidden, false);
customSelect.menu.querySelector('[data-value="first_air_date.desc"]').click();
assert.equal(select.value, 'first_air_date.desc');
assert.equal(customSelect.triggerText.textContent, 'Новые сериалы');
assert.equal(changeCount, 1);
assert.equal(customSelect.menu.hidden, true);

const yearInput = document.getElementById('catalogYearFrom');
const customNumberInput = window.CatalogNumberInput.enhance(yearInput);
yearInput.value = '2000';
customNumberInput.incrementButton.click();
assert.equal(yearInput.value, '2001');
customNumberInput.decrementButton.click();
assert.equal(yearInput.value, '2000');
assert.equal(yearInput.classList.contains('catalog-number__input'), true);

console.log('✅ Catalog custom select and category sort tests passed');
