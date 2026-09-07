const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

// Render the production markup and styles without network/authentication dependencies.
const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'src/pages/movie-details/movie-details.html');
const html = fs.readFileSync(filename, 'utf8')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<link\b[^>]*href="([^"]+)"[^>]*>/gi, (tag, href) => {
        if (!href.endsWith('.css')) return '';
        return `<style>${fs.readFileSync(path.resolve(path.dirname(filename), href), 'utf8')}</style>`;
    });

(async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.route('**/*', route => route.abort());
        for (const theme of ['dark-theme', 'light-theme']) {
            for (const [width, height] of [[1366, 768], [1920, 1080], [390, 844], [910, 512]]) {
                await page.setViewportSize({ width, height });
                await page.setContent(html);
                await page.evaluate(themeName => {
                    document.body.className = `${themeName} player-modal-open`;
                    const modal = document.querySelector('#videoPlayerModal');
                    modal.style.display = 'flex';
                    document.querySelector('#sourceButtonsContainer').innerHTML = '<button class="source-btn">Торрент</button>';
                    document.querySelector('#torrentWorkspaceBtn').hidden = false;
                    document.querySelector('#torrentSourcePanel').hidden = false;
                    const disclosure = document.querySelector('#torrentSourceDisclosure');
                    disclosure.hidden = false;
                    disclosure.open = true;
                    document.querySelector('#torrentSourceControls').hidden = false;
                    document.querySelector('#torrentSourceList').innerHTML = Array.from({ length: 30 }, (_, i) =>
                        `<button class="torrent-source-card">Раздача ${i} — 4K 2160p<br>11 ГБ · Сиды: 20</button>`).join('');
                }, theme);
                await page.waitForTimeout(350);
                const geometry = await page.evaluate(() => {
                    const modal = document.querySelector('#videoPlayerModal .video-modal');
                    const body = modal.querySelector('.video-body');
                    const video = document.querySelector('#videoContainer');
                    const rect = video.getBoundingClientRect();
                    const shell = modal.getBoundingClientRect();
                    const clipped = body.getBoundingClientRect();
                    const initialVisible = rect.top >= clipped.top && rect.bottom <= clipped.bottom + 1;
                    body.scrollTop = body.scrollHeight;
                    const sources = document.querySelector('#torrentSourceList').getBoundingClientRect();
                    return { initialVisible, video: rect.toJSON(), body: clipped.toJSON(), shellTop: shell.top, shellBottom: shell.bottom,
                        horizontalOverflow: body.scrollWidth > body.clientWidth,
                        sourcesReachable: sources.top < clipped.bottom && sources.bottom > clipped.top };
                });
                assert.ok(geometry.initialVisible, `${theme} ${width}x${height}: player clipped ${JSON.stringify(geometry)}`);
                assert.ok(geometry.shellTop >= 0 && geometry.shellBottom <= height + 1, 'modal exceeds viewport');
                assert.equal(geometry.horizontalOverflow, false, 'horizontal overflow');
                assert.ok(geometry.sourcesReachable, 'release list cannot be reached');
                if (width === 1366) {
                    await page.evaluate(() => { document.querySelector('#videoPlayerModal .video-body').scrollTop = 0; });
                    await page.screenshot({ path: path.join(require('node:os').tmpdir(), `torrent-modal-${theme}.png`) });
                }
                console.log(`PASS ${theme} ${width}x${height}`);
            }
        }
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
