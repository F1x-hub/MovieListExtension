import assert from 'node:assert';
import fs from 'node:fs';

console.log('Running subtitle appearance settings contract tests...');

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../src/pages/settings/settings.html');
const css = read('../src/pages/settings/settings.css');
const settings = read('../src/pages/settings/settings.js');

for (const id of [
    'subtitleFontSizePercent',
    'subtitleColor',
    'subtitlePosition',
    'subtitleOffsetPercent',
    'subtitleBackgroundOpacity',
    'subtitleTextShadow',
    'subtitleAppearanceResetBtn',
    'subtitleAppearancePreviewFrame'
]) {
    assert.match(html, new RegExp(`id="${id}"`), `Settings must expose #${id}`);
}

assert.match(html, /<fieldset class="subtitle-appearance-controls">/, 'subtitle controls must be grouped accessibly');
assert.match(html, /role="note"/, 'subtitle compatibility guidance must be visible');
assert.match(html, /поддерживаемым субтитрам встроенного плеера/i, 'guidance must state the support boundary');
assert.match(html, /id="subtitleFontSizePercent"[^>]*min="75"[^>]*max="200"[^>]*step="5"/);
assert.match(html, /id="subtitleOffsetPercent"[^>]*min="2"[^>]*max="20"/);
assert.match(html, /id="subtitleBackgroundOpacity"[^>]*min="0"[^>]*max="0\.9"[^>]*step="0\.05"/);

assert.match(settings, /const SUBTITLE_APPEARANCE_STORAGE_KEY = 'movieExtensionSubtitleAppearanceV1';/);
assert.match(settings, /version:\s*1,/);
assert.match(settings, /fontSizePercent:\s*100,/);
assert.match(settings, /color:\s*'#ffffff',/);
assert.match(settings, /position:\s*'bottom',/);
assert.match(settings, /offsetPercent:\s*6,/);
assert.match(settings, /backgroundOpacity:\s*0\.45,/);
assert.match(settings, /textShadow:\s*'strong'/);
assert.match(settings, /function normalizeSubtitleAppearance\(value\)/, 'stored appearance must be normalized');
assert.match(settings, /result\[SUBTITLE_APPEARANCE_STORAGE_KEY\]/, 'appearance must load from shared local storage');
assert.match(settings, /\[SUBTITLE_APPEARANCE_STORAGE_KEY\]: subtitleAppearance/, 'appearance must save under the shared key');
assert.match(settings, /\[SUBTITLE_APPEARANCE_STORAGE_KEY\]: defaultSubtitleAppearance/, 'global reset must restore subtitle defaults');
assert.match(settings, /subtitleAppearanceResetBtn\.addEventListener\('click'/, 'local reset must be keyboard-accessible');
assert.match(settings, /updateSubtitleAppearanceUI\(\)/, 'controls must update the live preview');

assert.match(css, /\.subtitle-appearance-editor\s*\{[\s\S]*?grid-template-columns:/, 'editor must use a compact grid');
assert.match(css, /\.subtitle-appearance-preview__caption\s*\{[\s\S]*?color:\s*var\(--subtitle-preview-color/, 'preview must reflect the selected color');
assert.match(css, /\.subtitle-appearance-preview__frame\[data-position="top"\]/, 'preview must represent top positioning');
assert.match(css, /@media \(max-width: 768px\)[\s\S]*?\.subtitle-appearance-editor\s*\{[\s\S]*?grid-template-columns:\s*1fr/, 'editor must stack on smaller screens');

console.log('Subtitle appearance settings contract tests passed');
