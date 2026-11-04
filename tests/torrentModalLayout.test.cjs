const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

// Render the production markup and styles without network/authentication dependencies.
const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'src/pages/movie-details/movie-details.html');
// Network access is blocked below, so nested @imports (tokens, theme) must be inlined too.
function inlineStylesheet(file, seen = new Set()) {
    if (seen.has(file)) return '';
    seen.add(file);
    return fs.readFileSync(file, 'utf8').replace(
        /@import\s+(?:url\()?['"]([^'"]+)['"]\)?\s*;/g,
        (statement, href) => (/^https?:/.test(href) ? '' : inlineStylesheet(path.resolve(path.dirname(file), href), seen))
    );
}
const inlined = new Set();
const html = fs.readFileSync(filename, 'utf8')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<link\b[^>]*href="([^"]+)"[^>]*>/gi, (tag, href) => {
        if (!href.endsWith('.css')) return '';
        return `<style>${inlineStylesheet(path.resolve(path.dirname(filename), href), inlined)}</style>`;
    });
const captureDir = process.env.TORRENT_CAPTURE_DIR || os.tmpdir();

(async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.route('**/*', route => route.abort());
        for (const theme of ['dark-theme', 'light-theme']) {
            for (const [width, height] of [[1366, 768], [1440, 900], [1920, 1080], [390, 844], [910, 512]]) {
                await page.setViewportSize({ width, height });
                await page.setContent(html);
                await page.addScriptTag({ path: path.join(root, 'src/pages/movie-details/TorrentSourcePanel.js') });
                await page.addScriptTag({ path: path.join(root, 'src/shared/components/SortControl.js') });
                await page.addScriptTag({ path: path.join(root, 'src/shared/components/FilterControls.js') });
                await page.evaluate(themeName => {
                    document.documentElement.classList.add(themeName);
                    document.body.className = `${themeName} player-modal-open`;
                    const modal = document.querySelector('#videoPlayerModal');
                    modal.style.display = 'flex';
                    document.querySelector('#sourceButtonsContainer').innerHTML = '<button class="source-btn">Торрент</button>';
                    const panelElement = document.querySelector('#torrentSourcePanel');
                    panelElement.hidden = false;
                    window.FilterChoice?.enhanceSingleGroup(
                        panelElement.querySelector('.torrent-source-controls__filters'),
                        { selector: '[data-quality-filter]', label: 'Фильтр качества' }
                    );
                    panelElement.querySelectorAll('.torrent-source-controls__sort select').forEach(select => window.SortControl?.enhance(select));
                    const panel = Object.create(window.MovieDetailsTorrentPanelMethods.prototype);
                    panel.elements = {
                        torrentSourcePanel: panelElement,
                        torrentSourceStatus: document.querySelector('#torrentSourceStatus'),
                        torrentSourceControls: document.querySelector('#torrentSourceControls'),
                        torrentSourceList: document.querySelector('#torrentSourceList'),
                        torrentSourceSkeleton: document.querySelector('#torrentSourceSkeleton'),
                        torrentSourcesPane: document.querySelector('#torrentSourcesPane'),
                        torrentTabSources: document.querySelector('#torrentTabSources'),
                        torrentTabDownloads: document.querySelector('#torrentTabDownloads'),
                        torrentDownloadLibrary: document.querySelector('#torrentDownloadLibrary'),
                        torrentDownloadList: document.querySelector('#torrentDownloadList'),
                        torrentPlayerHint: document.querySelector('#torrentPlayerHint')
                    };
                    panel.torrentQualityFilter = 'all';
                    panel.torrentLanguageFilter = 'all';
                    panel.torrentSort = 'recommended';
                    panel.torrentSearchState = { status: 'completed', found: 30 };
                    panel.getMatchingTorrentDownloads = () => [];
                    panel.torrentSources = Array.from({ length: 30 }, (_, i) => ({
                        sourceId: `source-${i}`,
                        title: `Karigurashi no Arrietty / The Borrower Arrietty / The Secret World of Arrietty [Movie] [RUS(int), JAP, ENG+Sub] [2010, Blu-ray] [${i}]`,
                        quality: i % 3 ? '1080p' : '4K 2160p',
                        provider: 'rutracker',
                        seeders: 30 - i,
                        leechers: 2,
                        sizeBytes: (i + 2) * 1024 ** 3
                    }));
                    panel.renderTorrentSources(panel.torrentSources);
                    window.torrentLayoutPanel = panel;
                }, theme);
                await page.waitForTimeout(350);
                const geometry = await page.evaluate(() => {
                    const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
                    const list = document.querySelector('#torrentSourceList');
                    return {
                        modal: rect('#videoPlayerModal .video-modal'),
                        panel: rect('#torrentSourcePanel'),
                        video: rect('#videoContainer'),
                        workspace: rect('#playerWorkspace'),
                        listScrolls: list.scrollHeight > list.clientHeight,
                        listHeight: list.clientHeight,
                        cards: list.querySelectorAll('.torrent-source-card').length,
                        bodyOverflow: document.querySelector('#videoPlayerModal .video-body').scrollWidth
                            > document.querySelector('#videoPlayerModal .video-body').clientWidth,
                        rowOverflow: [...list.querySelectorAll('.torrent-source-card')].some(card => card.scrollWidth > card.clientWidth + 1)
                    };
                });
                const context = `${theme} ${width}x${height}: ${JSON.stringify(geometry)}`;
                assert.equal(geometry.cards, 30, `every release is listed ${context}`);
                assert.ok(geometry.workspace.left >= 0 && geometry.workspace.right <= width + 1, `workspace exceeds viewport width ${context}`);
                assert.equal(geometry.bodyOverflow, false, `player body overflows ${context}`);
                assert.equal(geometry.rowOverflow, false, `release row overflows ${context}`);
                assert.ok(geometry.listScrolls, `the list must scroll itself ${context}`);
                assert.ok(geometry.listHeight >= 120, `the list has room for releases ${context}`);
                if (width >= 900) {
                    assert.ok(geometry.panel.left >= geometry.modal.right, `panel overlaps the player ${context}`);
                    assert.ok(Math.abs(geometry.panel.height - geometry.modal.height) <= 1, `panel and player differ in height ${context}`);
                    assert.ok(Math.abs(geometry.panel.width - 400) <= 1, `panel keeps its width ${context}`);
                    assert.ok(geometry.modal.top >= 0 && geometry.modal.bottom <= height + 1, `player exceeds viewport ${context}`);
                    assert.ok(geometry.video.top >= geometry.modal.top && geometry.video.bottom <= geometry.modal.bottom + 1, `video is clipped ${context}`);
                } else {
                    assert.ok(geometry.panel.top >= geometry.modal.bottom, `narrow panel must follow the player ${context}`);
                    assert.ok(geometry.video.top >= 0 && geometry.video.bottom <= height, `video is clipped on a narrow screen ${context}`);
                }
                if (width === 1440) {
                    const shot = name => path.join(captureDir, `torrent-${name}-${theme}.png`);
                    await page.screenshot({ path: shot('list') });
                    await page.locator('#torrentSourcePanel').screenshot({ path: shot('panel') });
                }
                if (width === 390) {
                    await page.screenshot({ path: path.join(captureDir, `torrent-narrow-${theme}.png`) });
                }
                await page.evaluate(() => {
                    window.torrentLayoutPanel.showTorrentFileSelection('fixture', [1, 2, 3].map(episode => ({
                        fileId: String(episode), name: `Series.S01E0${episode}.2160p.WEB-DL.MultiAudio.mkv`,
                        seasonNumber: 1, episodeNumber: episode, sizeBytes: 4 * 1024 ** 3
                    })), { mediaType: 'tv', seasonNumber: 1, episodeNumber: 2 });
                });
                const picker = await page.evaluate(() => ({
                    pickerVisible: document.querySelector('#torrentFilePicker').getBoundingClientRect().height > 0,
                    listHidden: document.querySelector('#torrentSourcesPane').getBoundingClientRect().height === 0
                }));
                assert.ok(picker.pickerVisible && picker.listHidden, `file choice replaces the list ${theme} ${width}x${height}`);
                if (width === 1440) {
                    await page.locator('#torrentSourcePanel').screenshot({ path: path.join(captureDir, `torrent-files-${theme}.png`) });
                }
                await page.evaluate(() => { document.querySelector('#torrentSourcePanel').hidden = true; });
                await page.waitForTimeout(320);
                const closed = await page.evaluate(() => ({
                    modalWidth: document.querySelector('#videoPlayerModal .video-modal').getBoundingClientRect().width,
                    expected: Math.min(window.innerWidth * 0.94, 1180, window.innerHeight * 1.7778 - 320)
                }));
                // Below the side-by-side width the player keeps its size either way.
                if (width >= 900) {
                    assert.ok(Math.abs(closed.modalWidth - closed.expected) <= 2, `closing returns the full player width ${JSON.stringify(closed)}`);
                }
                console.log(`PASS ${theme} ${width}x${height}`);
            }
        }
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
