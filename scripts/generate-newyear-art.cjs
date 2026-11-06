/**
 * Pre-renders the New Year season's static pictures into
 * src/shared/assets/seasonal/newyear/ as WebP.
 *
 * The forest and the tree are painted needle by needle, which takes about a
 * second of main-thread time. Every extension page is a full page load, so that
 * work happens here, once, instead of on every navigation. Rerun this script only
 * after changing scripts/newyear-art/painters.js, the arrangement in
 * src/shared/seasonal/newyear/ or the `--ny-*` painter tokens:
 *
 *     node scripts/generate-newyear-art.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'src/shared/assets/seasonal/newyear');
const RUNTIME = path.join(ROOT, 'src/shared/seasonal/newyear');
const QUALITY = 0.8;

async function main() {
    fs.mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch();
    try {
        const page = await browser.newPage();
        const css = fs.readFileSync(path.join(ROOT, 'src/shared/styles/seasonal-newyear.css'), 'utf8')
            // Only the tokens matter here; assets would not resolve from about:blank.
            .replace(/url\([^)]*\)/g, 'none');
        await page.setContent(`<!doctype html><html class="season-newyear"><head><style>${css}</style></head><body></body></html>`);
        for (const file of [path.join(RUNTIME, 'art.js'), path.join(RUNTIME, 'tree.js'), path.join(RUNTIME, 'gifts.js'), path.join(__dirname, 'newyear-art/painters.js')]) {
            await page.addScriptTag({ path: file });
        }
        const jobs = await page.evaluate(() => window.NyArtJobs.list());
        let total = 0;
        for (const job of jobs) {
            const dataUrl = await page.evaluate(({ item, quality }) => window.NyArtJobs.run(item, quality), { item: job, quality: QUALITY });
            const prefix = 'data:image/webp;base64,';
            if (!dataUrl.startsWith(prefix)) throw new Error(`${job.name}: browser did not produce WebP`);
            const bytes = Buffer.from(dataUrl.slice(prefix.length), 'base64');
            fs.writeFileSync(path.join(OUT, `${job.name}.webp`), bytes);
            total += bytes.length;
            console.log(`${job.name}.webp  ${(bytes.length / 1024).toFixed(0)} KB`);
        }
        console.log(`Total: ${(total / 1024 / 1024).toFixed(2)} MB in ${jobs.length} files`);
    } finally {
        await browser.close();
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
