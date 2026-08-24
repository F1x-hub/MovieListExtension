import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const rendererPath = path.join(rootDir, 'src/pages/home/HomeRenderer.js');
const source = fs.readFileSync(rendererPath, 'utf8');

const categoryStart = source.indexOf('renderCategoryGrid(items = [], container, options = {})');
const categoryEnd = source.indexOf('\n    /**', categoryStart + 1);
assert.ok(categoryStart >= 0, 'HomeRenderer.renderCategoryGrid must exist');
assert.ok(categoryEnd > categoryStart, 'renderCategoryGrid method boundary must be readable');

const categoryMethod = source.slice(categoryStart, categoryEnd);
assert.match(
    categoryMethod,
    /container\.appendChild\(fragment\)[\s\S]*this\.ratingEnricher\?\.observe\?\.\(container\)/,
    'Category grids must register rendered cards with the ratings enrichment observer'
);

console.log('✅ Home category grids register cards for KP/IMDb rating enrichment');
