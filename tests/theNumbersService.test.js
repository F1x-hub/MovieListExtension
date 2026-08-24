const assert = require('node:assert/strict');
require('../src/shared/config/theNumbersMappings.js');
const TheNumbersService = require('../src/shared/services/TheNumbersService.js');

const fixture = `
<h1>Spider-Man 3 (2007)</h1>
<table id="movie_finances">
  <tr class="heading"><td colspan="3"><b>Theatrical Performance</b></td></tr>
  <tr><td><b>Domestic Box Office</b></td><td class="data">$338,007,351</td><td></td></tr>
  <tr><td><b>International Box Office</b></td><td class="data sum">$558,329,917</td><td></td></tr>
  <tr><td><b>Worldwide Box Office</b></td><td class="data">$896,337,268</td><td></td></tr>
  <tr class="heading"><td colspan="3"><b>Domestic Physical Disc Sales</b></td></tr>
  <tr><td><b>DVD Sales (estimated)</b></td><td class="data">$126,623,606</td><td></td></tr>
  <tr><td><b>Blu-ray Sales (estimated)</b></td><td class="data sum">$914,915</td><td></td></tr>
  <tr><td><b>Total</b></td><td class="data">$127,538,521</td><td></td></tr>
</table>
<script>
window.movieBoxOfficeCharts = {
  labels: ["2007-05-04", "2007-05-05", "2007-05-06"],
  data: [59841919, 111178651, 151116516],
  bands: {
    "2007-05-06": { "p10": 151116516, "p50": 151116516, "p90": 151116516 }
  },
  canvases: []
};
</script>
<span>OpusData ID: 170100</span>`;

const parsed = TheNumbersService.parseHtml(fixture, 'https://www.the-numbers.com/movie/Spider-Man-3');
assert.equal(parsed.theatrical.domestic, 338007351);
assert.equal(parsed.theatrical.international, 558329917);
assert.equal(parsed.theatrical.worldwide, 896337268);
assert.deepEqual(parsed.physicalMedia.dvdSales, { amount: 126623606, estimated: true });
assert.deepEqual(parsed.physicalMedia.bluRaySales, { amount: 914915, estimated: true });
assert.deepEqual(parsed.physicalMedia.total, { amount: 127538521, estimated: false });
assert.equal(parsed.opusDataId, '170100');
assert.equal(parsed.chart.type, 'domestic-cumulative');
assert.equal(parsed.chart.points.length, 3);
assert.deepEqual(parsed.chart.points[2], {
    date: '2007-05-06',
    cumulative: 151116516,
    band: { bottom10: 151116516, median: 151116516, top10: 151116516 }
});

const storageData = {};
const storage = {
    async get(key) {
        if (typeof key === 'string') return { [key]: storageData[key] };
        return Object.fromEntries(key.map(item => [item, storageData[item]]));
    },
    async set(values) {
        Object.assign(storageData, values);
    }
};

let fetchCount = 0;
const service = new TheNumbersService({
    storage,
    fetchImpl: async () => {
        fetchCount += 1;
        return { ok: true, text: async () => fixture };
    }
});

(async () => {
    const movie = { kinopoiskId: 123, name: 'Spider-Man 3', year: 2007 };
    const first = await service.refreshMovie(movie);
    const second = await service.refreshMovie(movie);

    assert.equal(first.theatrical.domestic, 338007351);
    assert.equal(second.status, 'fresh');
    assert.equal(fetchCount, 1, 'A fresh snapshot must prevent a second network request');

assert.equal(
    TheNumbersService.resolveSourceUrl(movie),
    'https://www.the-numbers.com/movie/Spider-Man-3'
);

const verifiedMappings = [
    ['Dead Poets Society', 1989, 'https://www.the-numbers.com/movie/Dead-Poets-Society-(1989)'],
    ['The End of Oak Street', 2026, 'https://www.the-numbers.com/movie/End-of-Oak-Street-The-(2026)'],
    ['Longlegs', 2024, 'https://www.the-numbers.com/movie/Longlegs-(2024)'],
    ["Le Fabuleux destin d'Amélie Poulain", 2001, 'https://www.the-numbers.com/movie/Fabuleux-destin-d-Amelie-Poulain-Le-(2001)'],
    ['Pleasantville', 1998, 'https://www.the-numbers.com/movie/Pleasantville'],
    ['Star Wars: Episode V - The Empire Strikes Back', 1980, 'https://www.the-numbers.com/movie/Star-Wars-Ep-V-The-Empire-Strikes-Back']
];

for (const [title, year, expectedUrl] of verifiedMappings) {
    assert.equal(
        TheNumbersService.resolveSourceUrl({ name: title, year }),
        expectedUrl,
        `The Numbers mapping should resolve ${title}`
    );
}

assert.equal(
    TheNumbersService.resolveSourceUrl({ name: 'End of Oak Street, The', year: 2026 }),
    'https://www.the-numbers.com/movie/End-of-Oak-Street-The-(2026)',
    'The Numbers mapping should resolve the article-order alias'
);

assert.equal(
    TheNumbersService.resolveSourceUrl({ name: 'Le Fabuleux destin d’Amelie Poulain', year: 2001 }),
    'https://www.the-numbers.com/movie/Fabuleux-destin-d-Amelie-Poulain-Le-(2001)',
    'The Numbers mapping should normalize apostrophes and accents'
);

    assert.equal(
        TheNumbersService.resolveSourceUrl({ name: 'Dead Poets Society', year: 1988 }),
        'https://www.the-numbers.com/movie/Dead-Poets-Society-(1989)',
        'The Numbers mapping should allow a one-year earlier release difference'
    );

    assert.equal(
        TheNumbersService.resolveSourceUrl({ name: 'Longlegs', year: 2025 }),
        'https://www.the-numbers.com/movie/Longlegs-(2024)',
        'The Numbers mapping should allow a one-year later release difference'
    );

    assert.equal(
        TheNumbersService.resolveSourceUrl({ name: 'Longlegs', year: 2026 }),
        null,
        'The Numbers mapping should reject years outside the one-year tolerance'
    );

    assert.equal(
        TheNumbersService.resolveSourceUrl(
            { name: 'Longlegs', year: 2025 },
            [
                { title: 'Longlegs', year: 2024, url: 'https://www.the-numbers.com/movie/Longlegs-(2024)' },
                { title: 'Longlegs', year: 2025, url: 'https://www.the-numbers.com/movie/Longlegs-(2025)' }
            ]
        ),
        'https://www.the-numbers.com/movie/Longlegs-(2025)',
        'The exact year should win over the one-year fallback'
    );

    assert.equal(
        TheNumbersService.resolveSourceUrl({ name: 'Star Wars Ep. V: The Empire Strikes Back', year: 1980 }),
        'https://www.the-numbers.com/movie/Star-Wars-Ep-V-The-Empire-Strikes-Back',
        'The Numbers mapping should resolve the provider title alias'
    );

    const discoveryStorageData = {};
    const discoveryStorage = {
        async get(key) {
            if (typeof key === 'string') return { [key]: discoveryStorageData[key] };
            return Object.fromEntries(key.map(item => [item, discoveryStorageData[item]]));
        },
        async set(values) {
            Object.assign(discoveryStorageData, values);
        }
    };
    const discoveryRequests = [];
    const octoberSkyFixture = fixture.replace('Spider-Man 3 (2007)', 'October Sky (1999)');
    const discoveryService = new TheNumbersService({
        storage: discoveryStorage,
        fetchImpl: async url => {
            discoveryRequests.push(url);
            if (url === 'https://www.the-numbers.com/movie/October-Sky') {
                return { ok: true, text: async () => octoberSkyFixture };
            }
            return { ok: false, status: 404, text: async () => '' };
        }
    });
    const discovered = await discoveryService.refreshMovie({
        kinopoiskId: 456,
        name: 'Октябрьское небо',
        enName: 'October Sky',
        year: 1999
    });
    assert.equal(discovered.sourceUrl, 'https://www.the-numbers.com/movie/October-Sky');
    assert.equal(discovered.theatrical.domestic, 338007351);
    assert.equal(discoveryRequests.length, 1, 'A verified generated slug should stop discovery immediately');
    await discoveryService.refreshMovie({
        kinopoiskId: 456,
        name: 'Октябрьское небо',
        enName: 'October Sky',
        year: 1999
    });
    assert.equal(discoveryRequests.length, 1, 'A discovered source should use the 24-hour snapshot cache');

    console.log('TheNumbersService tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
