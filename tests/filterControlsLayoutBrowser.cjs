const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const captureDir = process.env.FILTER_CAPTURE_DIR;
const surfaces = {
    random: { manager: 'RandomManager', panel: '.config-card' },
    search: { manager: 'SearchManager', panel: '#filters' },
    ratings: { manager: 'RatingsPageManager', panel: '.filters-section' }
};

async function fixture(page, baseUrl, surface, theme) {
    await page.goto(`${baseUrl}/src/pages/${surface}/${surface}.html`, { waitUntil: 'load' });
    if (surface === 'ratings') {
        // The server strips scripts: this is the initial paint even if startup
        // or localization never settles, before any controls are enhanced.
        const controls = await page.evaluate(theme => {
            document.documentElement.classList.toggle('light-theme', theme === 'light');
            document.body.classList.toggle('light-theme', theme === 'light');
            return [...document.querySelectorAll('[data-filter-control], [data-sort-control]')].map(select => {
                const style = getComputedStyle(select);
                return {
                    id: select.id, visible: select.getClientRects().length > 0,
                    height: select.getBoundingClientRect().height,
                    background: style.backgroundColor, color: style.color,
                    surface: style.getPropertyValue('--ui-color-surface').trim(),
                    content: style.getPropertyValue('--ui-color-content').trim(),
                    radius: style.borderTopLeftRadius
                };
            });
        }, theme);
        // Every enhanced select in the Rated markup (genre, year, user, my rating, sort).
        const expectedControls = (read('src/pages/ratings/ratings.html').match(/data-(?:filter|sort)-control/g) || []).length;
        assert.ok(expectedControls >= 4);
        assert.equal(controls.length, expectedControls);
        for (const control of controls) {
            assert.ok(control.visible, `${control.id}: native fallback stays usable before startup`);
            assert.ok(control.height >= 44, `${control.id}: initial control has full height`);
            assert.equal(control.radius, '12px');
            // Resolve tokens through CSS so hex/rgb notation does not affect comparison.
            const expected = await page.evaluate(({ surface, content }) => {
                const probe = document.createElement('span');
                probe.style.backgroundColor = surface;
                probe.style.color = content;
                document.body.append(probe);
                const style = getComputedStyle(probe);
                const result = { background: style.backgroundColor, color: style.color };
                probe.remove();
                return result;
            }, control);
            assert.equal(control.background, expected.background, `${control.id}/${theme}: themed before JS`);
            assert.equal(control.color, expected.color, `${control.id}/${theme}: readable before JS`);
        }
        if (captureDir) await page.locator('.filters-section').screenshot({ path: path.join(captureDir, `ratings-${theme}-${page.viewportSize().width}-startup.png`) });
    }
    await page.addScriptTag({ content: read('src/shared/i18n/locales.js').replace('export const locales', 'window.testLocales') });
    await page.addScriptTag({ content: read('src/shared/i18n/I18n.js').replace(/^import .*;\r?\n/gm, '').replace('export const i18n', 'const i18n').replace('export { I18n };', '').replace('this.locales = locales;', 'this.locales = window.testLocales;') });
    for (const file of ['src/shared/config/discoveryFilters.js', 'src/shared/components/NumberStepper.js', 'src/shared/components/FilterControls.js', 'src/shared/components/SortControl.js']) {
        await page.addScriptTag({ content: read(file) });
    }
    await page.addScriptTag({ content: read(`src/pages/${surface}/${surface}.js`).replace(/^import .*;\r?\n/gm, '') + `\nwindow.FixtureManager = ${surfaces[surface].manager};` });
    await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; } .main-container { opacity: 1; }' });
    await page.evaluate(({ surface, theme }) => {
        document.documentElement.classList.toggle('light-theme', theme === 'light');
        document.body.classList.toggle('light-theme', theme === 'light');
        i18n.currentLocale = 'ru';
        i18n.translatePage();
        const manager = Object.create(window.FixtureManager.prototype);
        const element = id => document.getElementById(id);
        if (surface === 'random') {
            manager.elements = Object.fromEntries(['typeTags', 'genreTags', 'countryTags', 'configBody', 'configHeader', 'toggleConfigBtn'].map(id => [id, element(id)]));
            manager.populateFilterData();
            manager.renderTags();
            manager.setupSliders();
            manager.toggleConfig(true);
            const choices = element('genreTags').querySelectorAll('.filter-choice');
            FilterChoice.setState(choices[0], 'include');
            FilterChoice.setState(choices[2], 'exclude');
        } else if (surface === 'search') {
            manager.elements = Object.fromEntries(['yearFromFilter', 'yearToFilter', 'genreCheckboxes', 'countryCheckboxes'].map(id => [id, element(id)]));
            manager.initializeFilters();
            element('filters').style.display = 'block';
            FilterChoice.setState(element('genreCheckboxes').querySelector('.filter-choice'), 'include');
        } else {
            document.querySelectorAll('[data-filter-control], [data-sort-control]').forEach(select => SortControl.enhance(select));
            manager.initDoubleSlider(element('avgRatingFrom'), element('avgRatingTo'), element('avgRatingMinDisplay'), element('avgRatingMaxDisplay'), element('avgRatingRange'), () => {});
        }
    }, { surface, theme });
    await page.evaluate(() => document.fonts.ready);
}

async function main() {
    if (captureDir) fs.mkdirSync(captureDir, { recursive: true });
    // Real HTML, CSS, components and page filter initialization. Auth/providers
    // are intentionally excluded, so layout can be checked deterministically.
    const server = http.createServer((request, response) => {
        const pathname = new URL(request.url, 'http://localhost').pathname;
        const file = path.resolve(root, '.' + decodeURIComponent(pathname));
        const relative = path.relative(root, file);
        if (relative.startsWith('..') || path.isAbsolute(relative)) return response.writeHead(403).end();
        fs.readFile(file, (error, data) => {
            if (error) return response.writeHead(404).end();
            const ext = path.extname(file);
            response.setHeader('Content-Type', ({ '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' })[ext] || 'application/octet-stream');
            response.end(ext === '.html' ? data.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '') : data);
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const browser = await chromium.launch({ headless: true });
    try {
        // Include plain selects outside SortControl: page/theme background
        // shorthands must not reset the shared custom-chevron geometry.
        for (const theme of ['dark', 'light']) {
            for (const [surface, id] of [['admin', 'user-page-size-select'], ['settings', 'subtitlePosition']]) {
                const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
                await page.route('**/*', route => route.request().url().startsWith(baseUrl) ? route.continue() : route.abort());
                await page.goto(`${baseUrl}/src/pages/${surface}/${surface}.html`, { waitUntil: 'load' });
                const chrome = await page.locator(`#${id}`).evaluate((select, theme) => {
                    document.documentElement.classList.toggle('light-theme', theme === 'light');
                    document.body.classList.toggle('light-theme', theme === 'light');
                    for (let parent = select; parent; parent = parent.parentElement) {
                        parent.hidden = false;
                        if (getComputedStyle(parent).display === 'none') parent.style.setProperty('display', 'block', 'important');
                    }
                    const style = getComputedStyle(select);
                    return { appearance: style.appearance, size: style.backgroundSize, repeat: style.backgroundRepeat, position: style.backgroundPosition, padding: style.paddingInlineEnd };
                }, theme);
                assert.equal(chrome.appearance, 'none', `${surface}/${theme}: no OS select arrow`);
                assert.equal(chrome.size, '5px 5px, 5px 5px', `${surface}/${theme}: page/theme backgrounds preserve arrow size`);
                assert.equal(chrome.repeat, 'no-repeat, no-repeat');
                assert.match(chrome.position, /100% - 19px.*100% - 14px/);
                assert.equal(chrome.padding, '34px', 'Text has space before the custom indicator');
                if (captureDir) await page.locator(`#${id}`).screenshot({ path: path.join(captureDir, `${surface}-${theme}-custom-select.png`) });
                await page.close();
            }
        }
        for (const width of [1440, 768, 390, 320]) {
            for (const theme of ['dark', 'light']) {
                for (const [surface, { panel }] of Object.entries(surfaces)) {
                    const page = await browser.newPage({ viewport: { width, height: 1000 }, deviceScaleFactor: 1 });
                    const errors = [];
                    page.on('pageerror', error => errors.push(error.message));
                    await page.route('**/*', route => route.request().url().startsWith(baseUrl) ? route.continue() : route.abort());
                    await fixture(page, baseUrl, surface, theme);
                    const metrics = await page.locator(panel).evaluate(element => {
                        const rect = element.getBoundingClientRect();
                        const style = getComputedStyle(element);
                        return {
                            width: rect.width, height: rect.height, radius: parseFloat(style.borderTopLeftRadius), padding: parseFloat(style.paddingLeft),
                            overflow: document.documentElement.scrollWidth > innerWidth,
                            chips: [...element.querySelectorAll('.filter-choice')].filter(chip => chip.getClientRects().length).map(chip => ({ height: chip.getBoundingClientRect().height, radius: parseFloat(getComputedStyle(chip).borderRadius) })),
                            duplicatedValues: [...element.querySelectorAll('.slider-values, .slider-labels')].some(row => getComputedStyle(row).display !== 'none')
                        };
                    });
                    assert.ok(metrics.radius >= 16, `${surface}/${theme}/${width}: panel corners stay rounded`);
                    assert.equal(metrics.overflow, false, `${surface}/${theme}/${width}: no horizontal page overflow`);
                    assert.equal(metrics.duplicatedValues, false, `${surface}: range values are not displayed twice`);
                    for (const chip of metrics.chips) {
                        assert.ok(chip.height >= 44 && chip.height <= 45, `${surface}: chips keep a compact 44px hit target (${chip.height})`);
                        assert.ok(chip.radius >= 100, `${surface}: discovery choices stay pill-shaped`);
                    }
                    if (surface === 'random') assert.equal(metrics.padding, 0, 'Random header/body own padding without an inset square header');
                    if (surface === 'random' && width === 390) assert.ok(metrics.height < 1200, 'Mobile Random avoids showing the full genre/country directory');
                    if (surface === 'random' && width === 768) {
                        const votes = await page.locator('#votesSlider').boundingBox();
                        assert.ok(votes.width > metrics.width * 0.8, 'Tablet votes use the available row instead of leaving an empty grid cell');
                    }
                    if (surface === 'search') {
                        const year = await page.locator('.year-range-inputs').boundingBox();
                        assert.ok(year.width <= 340, 'Search year fields stay proportionate');
                        assert.ok(metrics.height < 420, 'Closed Search filters leave space for results at every viewport');
                    }
                    if (surface === 'ratings' && width > 900) {
                        assert.ok(metrics.height < 330, `Ratings filter panel stays compact (${theme}/${width}: ${Math.round(metrics.width)} × ${Math.round(metrics.height)})`);
                        const rows = await page.locator('.filters-grid > .filter-group').evaluateAll(groups => groups
                            .filter(group => group.getClientRects().length)
                            .map(group => ({ top: group.getBoundingClientRect().top,
                                secondary: group.matches('.filter-group--sort, .filter-group--range') })));
                        const primary = rows.filter(row => !row.secondary), secondary = rows.filter(row => row.secondary);
                        assert.ok(primary.every(row => Math.abs(row.top - primary[0].top) < 1), `Primary Ratings fields align in one row (${width})`);
                        assert.equal(secondary.length, 2);
                        assert.ok(Math.abs(secondary[0].top - secondary[1].top) < 1, 'Sort and average rating align in the second row');
                        const trigger = await page.locator('.filter-group--sort .sort-control__trigger').boundingBox();
                        assert.equal(Math.round(trigger.height), 44, 'Sorting label fits a single control line');
                    }
                    if (captureDir) await page.locator(panel).screenshot({ path: path.join(captureDir, `${surface}-${theme}-${width}.png`) });
                    const number = page.locator(`${panel} input[type="number"]`).last();
                    await number.hover();
                    assert.equal(await number.evaluate(input => getComputedStyle(input).appearance), 'textfield', 'Numeric fields use project chrome without OS spinner appearance');
                    const oldNumber = await number.inputValue();
                    await number.focus();
                    await page.keyboard.press('ArrowDown');
                    assert.ok(Number(await number.inputValue()) < Number(oldNumber), 'Removing numeric spinners preserves native keyboard stepping');
                    await number.fill(oldNumber);
                    await number.press('Tab');
                    const stepper = number.locator('..');
                    const contained = await stepper.evaluate(wrapper => {
                        const input = wrapper.querySelector('input');
                        const field = input.getBoundingClientRect();
                        return Array.from(wrapper.querySelectorAll('.number-stepper__button')).every(button => {
                            // Visible borders must not change the bounding geometry.
                            button.style.border = '1px solid currentColor';
                            const rect = button.getBoundingClientRect();
                            return rect.top >= field.top && rect.bottom <= field.bottom && rect.left >= field.left && rect.right <= field.right;
                        });
                    });
                    assert.equal(contained, true, 'Both custom arrow buttons stay inside the input, including with visible borders');
                    if (captureDir && surface === 'ratings' && width === 1440) await stepper.locator('..').screenshot({ path: path.join(captureDir, `number-stepper-${theme}-border-check.png`) });
                    await stepper.evaluate(wrapper => wrapper.querySelectorAll('.number-stepper__button').forEach(button => button.style.removeProperty('border')));
                    const down = stepper.locator('.number-stepper__button--down');
                    const up = stepper.locator('.number-stepper__button--up');
                    await down.click();
                    assert.ok(Number(await number.inputValue()) < Number(oldNumber), 'Custom decrease arrow edits the original number field');
                    await up.click();
                    assert.equal(Number(await number.inputValue()), Number(oldNumber), 'Custom increase arrow uses the native step');
                    if (surface !== 'search') assert.equal(await up.isDisabled(), true, 'Custom arrows disable at the upper range bound');
                    if (surface === 'search') {
                        const summary = page.locator('#genreFilterSection > summary');
                        assert.equal(await summary.evaluate(element => getComputedStyle(element).listStyleType), 'none', 'Native disclosure marker is removed');
                        await summary.focus();
                        await page.keyboard.press('Enter');
                        assert.equal(await page.locator('#genreFilterSection').evaluate(element => element.open), true, 'Custom-chevron disclosure retains native keyboard behavior');
                        if (captureDir) await page.locator(panel).screenshot({ path: path.join(captureDir, `search-${theme}-${width}-expanded.png`) });
                    }
                    if (surface !== 'ratings' && width <= 600) {
                        const group = page.locator(surface === 'random' ? '#genreTags' : '#genreCheckboxes');
                        const more = group.locator('.filter-choices__more');
                        const overflowChoice = group.locator('.filter-choice').last();
                        await more.click();
                        assert.equal(await more.getAttribute('aria-expanded'), 'true');
                        await overflowChoice.click();
                        await more.click();
                        assert.equal(await overflowChoice.isVisible(), true, 'Collapsing keeps an included overflow choice visible');
                        await overflowChoice.click();
                        assert.equal(await overflowChoice.isVisible(), true, 'Excluded overflow choices also remain visible');
                        await overflowChoice.click();
                        assert.equal(await overflowChoice.isVisible(), false, 'Clearing an overflow choice returns it to the collapsed directory');
                        assert.equal(await more.evaluate(button => document.activeElement === button), true, 'Focus returns to the disclosure when a focused choice becomes hidden');
                        assert.equal(await more.getAttribute('aria-expanded'), 'false');
                        await more.click();
                        await group.evaluate(container => container.querySelectorAll('.filter-choice').forEach(choice => FilterChoice.setState(choice, 'include')));
                        await more.click();
                        assert.equal(await more.isVisible(), false, 'No disclosure is needed when every overflow choice is active');
                        assert.equal(await group.locator('.filter-choice').first().evaluate(choice => document.activeElement === choice), true, 'Removing the last disclosure preserves keyboard focus');
                    }
                    assert.deepEqual(errors, [], `${surface}: no runtime errors in the layout fixture`);
                    console.log(`${surface}/${theme}/${width}: ${Math.round(metrics.width)} × ${Math.round(metrics.height)}, rounded, compact, no overflow`);
                    await page.close();
                }
            }
        }
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
