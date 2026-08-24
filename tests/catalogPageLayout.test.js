const assert = require('node:assert/strict');

global.window = {
    getComputedStyle() {
        return { gridTemplateColumns: '' };
    }
};
global.document = {
    addEventListener() {}
};

require('../src/pages/catalog/catalog.js');

function createPage(template) {
    window.getComputedStyle = () => ({ gridTemplateColumns: template });
    const page = Object.create(window.CatalogPage.prototype);
    page.elements = { grid: {} };
    page.catalogService = { pageSize: 24 };
    return page;
}

assert.equal(createPage('180px 180px 180px 180px 180px 180px 180px').getCatalogPageSize(), 21);
assert.equal(createPage('180px 180px 180px 180px 180px 180px').getCatalogPageSize(), 18);
assert.equal(createPage('repeat(5, minmax(170px, 1fr))').getCatalogPageSize(), 15);
assert.equal(createPage('180px 180px').getCatalogPageSize(), 12);
assert.equal(createPage('none').getCatalogPageSize(), 24);

console.log('✅ Catalog responsive page-size tests passed');
