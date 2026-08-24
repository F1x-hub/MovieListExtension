const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/pages/movie-details/movie-details.js', 'utf8')
    .replace(/^import .*;\r?$/gm, '');

const context = vm.createContext({
    window: {},
    document: {},
    i18n: { get: key => key },
    KinopoiskService: class {
        formatCurrency(value) { return value ? `$${Number(value).toLocaleString('en-US')}` : ''; }
    },
    Utils: { escapeHtml: value => String(value ?? '') },
    console,
    Date,
    Number,
    Math,
    Array,
    Object,
    Boolean,
    Event: class {}
});

vm.runInContext(source, context);

const MovieDetailsManager = context.window.MovieDetailsManager;
const manager = Object.create(MovieDetailsManager.prototype);
manager.escapeHtml = value => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
manager.formatTheNumbersAmount = MovieDetailsManager.prototype.formatTheNumbersAmount;
manager.formatTheNumbersUpdatedAt = MovieDetailsManager.prototype.formatTheNumbersUpdatedAt;
manager.renderTheNumbersChart = MovieDetailsManager.prototype.renderTheNumbersChart;

const financeMovie = {
    budget: 100,
    fees: { usa: 90, world: 190, russia: 10 },
    boxOffice: {
        theatrical: { domestic: 100, international: 100, worldwide: 200 },
        physicalMedia: {
            dvdSales: { amount: 0, estimated: true },
            bluRaySales: { amount: 0, estimated: true },
            total: { amount: 0, estimated: false }
        },
        sourceUrl: 'https://www.the-numbers.com/movie/Spider-Man-3',
        fetchedAt: Date.now()
    }
};

const html = manager.renderFinanceMetaItem(financeMovie);
assert(html.includes('$100'), 'The Numbers domestic/international values should render');
assert(html.includes('$200'), 'The Numbers worldwide value should render');
assert(!html.includes('$90'), 'Duplicate Kinopoisk domestic value should be suppressed');
assert(!html.includes('$190'), 'Duplicate Kinopoisk worldwide value should be suppressed');
assert(html.includes('Бюджет:'), 'Unique Kinopoisk budget should remain');
assert(html.includes('В России:'), 'Unique Kinopoisk Russia fees should remain');
assert(!html.includes('Продажи физических носителей'), 'Zero physical sales should hide the group');
assert(!html.includes('$0'), 'Zero physical sales should not render fake zero values');

const inlineFinanceHtml = manager.renderFinanceMetaItem({
    ...financeMovie,
    boxOffice: {
        ...financeMovie.boxOffice,
        chart: {
            type: 'domestic-cumulative',
            points: [
                { date: '2007-05-04', cumulative: 10, band: null },
                { date: '2007-05-05', cumulative: 20, band: null }
            ]
        }
    }
});
assert(inlineFinanceHtml.includes('the-numbers-chart--inline'), 'Chart should be nested inside Finance');

const chartHtml = manager.renderTheNumbersChart({
    boxOffice: {
        sourceUrl: 'https://www.the-numbers.com/movie/Spider-Man-3',
        chart: {
            type: 'domestic-cumulative',
            points: [
                { date: '2007-05-04', cumulative: 10, band: null },
                { date: '2007-05-05', cumulative: 20, band: { bottom10: 12, median: 22, top10: 32 } },
                { date: '2007-05-06', cumulative: 30, band: { bottom10: 18, median: 28, top10: 38 } }
            ]
        }
    }
});
assert(chartHtml.includes('<details class="the-numbers-chart">'), 'Chart should be collapsible');
assert(chartHtml.includes('Динамика сборов'), 'Chart should render the extension-local title');
assert(chartHtml.includes('the-numbers-chart__cume'), 'Chart should render the cumulative line');
assert(chartHtml.includes('the-numbers-chart__band'), 'Chart should render the comparison band');
assert(chartHtml.includes('the-numbers-chart__data-point'), 'Chart should render visible points on the cumulative line');
assert(chartHtml.includes('the-numbers-chart__median-point'), 'Chart should render visible points on the median line');
assert(chartHtml.includes('the-numbers-chart__active-points'), 'Chart should render the x-selected hover markers');
assert(chartHtml.includes('data-chart-point-count="3"'), 'Chart should expose point count for x-axis selection');
assert(chartHtml.includes('the-numbers-chart__tooltip'), 'Chart should include the custom extension tooltip');
assert(chartHtml.includes('data-chart-median="28"'), 'Chart points should carry comparison values for the tooltip');
assert.equal(manager.renderTheNumbersChart({ boxOffice: { chart: null } }), '', 'Missing chart data should render nothing');

console.log('TheNumbers finance rendering tests passed');
