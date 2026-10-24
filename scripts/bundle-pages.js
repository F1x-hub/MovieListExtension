/**
 * Build step: concatenate a page's consecutive classic `defer` scripts into one
 * `<page>.bundle.js` in dist/, so the page starts with one script request
 * instead of dozens. Sources and other pages are untouched.
 *
 * Execution order is preserved: deferred and module scripts run in document
 * order, so only runs of adjacent classic `defer` tags are merged and any
 * module or non-deferred script ends a run. Files keep sharing the global
 * scope exactly as separate classic scripts do. A file that starts with a
 * 'use strict' directive or reads `document.currentScript` would behave
 * differently inside a bundle, so the build fails instead of guessing. A file
 * with a relative `import()` resolves modules against its own URL, so it stays
 * a separate tag (ending the run) rather than being bundled.
 */
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist');
const PAGES = ['src/pages/home/home.html'];
const MIN_RUN = 5;

const SCRIPT_TAG = /<script\b([^>]*)>\s*<\/script>/g;
const BETWEEN_TAGS = /^(?:\s|<!--[\s\S]*?-->)*$/;

function attr(attrs, name) {
    const match = new RegExp(`\\b${name}(?:\\s*=\\s*"([^"]*)")?`, 'i').exec(attrs);
    return match ? (match[1] ?? true) : null;
}

/**
 * Runs of adjacent classic deferred scripts, in document order.
 * @param {string} html
 * @param {(src: string) => boolean} [canBundle] - per-file veto; a vetoed file
 *   stays its own tag and ends the run, keeping the order intact
 */
function findDeferRuns(html, canBundle = () => true) {
    const runs = [];
    let current = [];
    let previousEnd = -1;
    for (const match of html.matchAll(SCRIPT_TAG)) {
        const attrs = match[1];
        const src = attr(attrs, 'src');
        const type = attr(attrs, 'type');
        const bundlable = typeof src === 'string' && attr(attrs, 'defer') !== null
            && !attr(attrs, 'async') && (type === null || type === 'text/javascript')
            && !/^[a-z]+:/i.test(src) && canBundle(src);
        const adjacent = previousEnd >= 0 && BETWEEN_TAGS.test(html.slice(previousEnd, match.index));
        if (!bundlable || !adjacent) {
            if (current.length) runs.push(current);
            current = [];
        }
        if (bundlable) current.push({ src, start: match.index, end: match.index + match[0].length, tag: match[0] });
        previousEnd = match.index + match[0].length;
    }
    if (current.length) runs.push(current);
    return runs;
}

/**
 * A relative `import()` in a classic script resolves against that script's own
 * URL; inside a bundle it would resolve against the bundle and miss the module.
 */
function hasRelativeDynamicImport(code) {
    return /\bimport\(\s*(['"`])\.{1,2}\//.test(code);
}

// A leading byte-order mark would sit mid-bundle; strip it per file.
function stripBom(code) {
    return code.charCodeAt(0) === 0xfeff ? code.slice(1) : code;
}

function assertBundlable(file, code) {
    const body = stripBom(code).replace(/^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*/, '');
    if (/^(['"])use strict\1/.test(body)) {
        throw new Error(`${file} starts with a 'use strict' directive; bundling would change its mode`);
    }
    if (/document\.currentScript/.test(code)) {
        throw new Error(`${file} reads document.currentScript, which differs inside a bundle`);
    }
}

/**
 * @param {string} htmlPath - Absolute path of the page inside dist
 * @returns {{bundlePath: string, files: string[]}[]} written bundles
 */
function bundlePage(htmlPath) {
    let html = fs.readFileSync(htmlPath, 'utf8');
    const pageDir = path.dirname(htmlPath);
    const pageName = path.basename(htmlPath, '.html');
    const runs = findDeferRuns(html, src => {
        const file = path.resolve(pageDir, src);
        return fs.existsSync(file) && !hasRelativeDynamicImport(fs.readFileSync(file, 'utf8'));
    }).filter(run => run.length >= MIN_RUN);
    const written = [];

    // Replace from the end so earlier offsets stay valid.
    runs.slice().reverse().forEach((run, reverseIndex) => {
        const index = runs.length - 1 - reverseIndex;
        const bundleName = runs.length === 1 ? `${pageName}.bundle.js` : `${pageName}.bundle-${index + 1}.js`;
        const parts = run.map(({ src }) => {
            const file = path.resolve(pageDir, src);
            const code = fs.readFileSync(file, 'utf8');
            assertBundlable(src, code);
            // `;` guards against a file whose last statement lacks a semicolon.
            return `\n;// ---- ${src}\n${stripBom(code)}\n`;
        });
        fs.writeFileSync(path.join(pageDir, bundleName), parts.join(''), 'utf8');
        const first = run[0];
        const last = run[run.length - 1];
        html = `${html.slice(0, first.start)}<script defer src="${bundleName}"></script>${html.slice(last.end)}`;
        // Preloads of bundled files would fetch scripts that are no longer requested.
        run.forEach(({ src }) => {
            const escaped = src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            html = html.replace(new RegExp(`\\s*<link\\b[^>]*rel="preload"[^>]*href="${escaped}"[^>]*>`, 'g'), '');
        });
        written.unshift({ bundlePath: path.join(pageDir, bundleName), files: run.map(item => item.src) });
    });

    fs.writeFileSync(htmlPath, html, 'utf8');
    return written;
}

if (require.main === module) {
    try {
        for (const page of PAGES) {
            const htmlPath = path.join(distDir, page);
            if (!fs.existsSync(htmlPath)) throw new Error(`Missing ${page} in dist; run copy-files first`);
            for (const { bundlePath, files } of bundlePage(htmlPath)) {
                console.log(`Bundled ${files.length} scripts into ${path.relative(distDir, bundlePath)}`);
            }
        }
    } catch (error) {
        console.error(error.message || error);
        process.exitCode = 1;
    }
}

module.exports = { findDeferRuns, bundlePage, assertBundlable, hasRelativeDynamicImport };
