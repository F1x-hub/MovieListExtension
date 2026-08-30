const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src/pages/admin/admin.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'src/pages/admin/admin.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/shared/styles/admin.css'), 'utf8');

[
  'data-target="provider-keys"',
  'id="pane-provider-keys"',
  'id="providerKeysList"',
  'id="providerKeysQuotaValue"',
  'id="providerKeysQuotaLabel"',
  '<option value="tmdb">TMDB</option>',
  'id="addProviderKeyModal"',
  'id="providerKeyForm"',
  'id="providerKeySecret"',
  'id="providerKeyConfirmModal"',
].forEach((requiredMarkup) => {
  assert.ok(html.includes(requiredMarkup), `Missing provider key markup: ${requiredMarkup}`);
});

[
  'loadProviderKeys',
  'renderProviderKeysQuotaSummary',
  "TMDB не публикует дневной остаток",
  'handleProviderKeySubmit',
  'handleProviderKeyAction',
  'confirmProviderKeyRevoke',
  'setProviderKeyFormError',
  'this.providerKeyModalTrigger?.focus?.()',
  'secretInput.value = \'\'',
].forEach((requiredBehavior) => {
  assert.ok(js.includes(requiredBehavior), `Missing provider key behavior: ${requiredBehavior}`);
});

assert.ok(!js.includes('localStorage.setItem(\'providerKey'), 'Raw provider keys must not be persisted');
assert.ok(!js.includes('data-secret'), 'Raw provider keys must not enter DOM data attributes');
assert.ok(css.includes('.provider-keys-table'), 'Provider key table needs dedicated styling');
assert.ok(css.includes('.provider-keys-quota-summary'), 'Provider key quota summary needs dedicated styling');
assert.ok(css.includes('@media (max-width: 760px)'), 'Provider keys need a mobile card layout');

console.log('adminProviderKeysUIContract.test.js: all tests passed');
