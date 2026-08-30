const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const html = read('src', 'pages', 'admin', 'admin.html');
const script = read('src', 'pages', 'admin', 'admin.js');
const styles = read('src', 'shared', 'styles', 'admin.css');

assert.match(html, /identity-workspace/);
assert.match(html, /startIdentityWorkflowBtn/);
assert.match(html, /data-identity-subtab="kp-to-imdb"/);
assert.match(html, /role="tablist"/);
assert.match(html, /quickManualMappingPreview/);
assert.match(html, /Проверить кандидата/);
assert.match(html, /publishManualMappingsBtn/);

assert.match(script, /renderIdentityWorkspaceSummary\(counts, pendingImdb\)/);
assert.match(script, /this\.pendingImdbItems = pendingImdb \|\| \[\];/);
assert.match(script, /const pendingItems = this\.pendingImdbItems \|\| \[\];/);
assert.match(script, /tmdbCount === 0 && imdbCount > 0/);
assert.match(script, /this\.switchIdentitySubtab\(recommendedSubtab\)/);
assert.match(script, /await this\.verifyQuickManualMapping\(/);
assert.match(script, /isCompatibleType\(mediaType, kpType, kpMovie\)/);
assert.match(script, /Подтверждение заблокировано/);
assert.match(script, /publishLocalManualMappings\(\)/);

assert.match(styles, /\.identity-workspace/);
assert.match(styles, /\.identity-workstream-list/);
assert.match(styles, /\.identity-verification-card/);
assert.match(styles, /@media \(max-width: 680px\)/);

console.log('Admin identity workspace contract passed');
