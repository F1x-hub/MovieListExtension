const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');

async function main() {
    const dom = new JSDOM('<body><label for="rating">Rating</label><input id="rating" type="number" min="1" max="2" step="0.1" value="1.5"></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
    const { window } = dom;
    const { document } = window;
    window.eval(fs.readFileSync(path.join(root, 'src/shared/components/NumberStepper.js'), 'utf8'));
    try {
        const input = document.getElementById('rating');
        const stepper = window.NumberStepper.enhance(input);
        assert.equal(window.NumberStepper.enhance(input), stepper);
        assert.equal(input.id, 'rating');
        assert.equal(document.querySelectorAll('.number-stepper').length, 1);
        assert.equal(stepper.controls[0].getAttribute('aria-label'), 'Increase: Rating');
        let inputs = 0, changes = 0;
        input.addEventListener('input', () => inputs++);
        input.addEventListener('change', () => changes++);
        stepper.controls[0].click();
        assert.equal(input.value, '1.6', 'Custom up arrow follows decimal step without floating point drift');
        assert.equal(inputs, 1);
        assert.equal(changes, 1);
        assert.equal(document.activeElement, input, 'Clicking a custom arrow preserves numeric editing focus');
        stepper.controls[1].click();
        assert.equal(input.value, '1.5');
        input.value = '2'; stepper.sync();
        assert.equal(stepper.controls[0].disabled, true);
        stepper.controls[0].click();
        assert.equal(input.value, '2');
        assert.equal(changes, 2, 'Bounded arrows emit no duplicate commit');
        input.value = '1'; stepper.sync();
        assert.equal(stepper.controls[1].disabled, true);
        input.readOnly = true; stepper.sync();
        assert.ok(stepper.controls.every(button => button.disabled));
        input.readOnly = false;
        input.disabled = true; stepper.sync();
        assert.ok(stepper.controls.every(button => button.disabled));
        input.disabled = false; input.value = ''; stepper.sync();
        stepper.controls[0].click();
        assert.equal(input.value, '1', 'Empty fields use native bounded stepping');
        window.i18n = { currentLocale: 'ru', get: key => key.endsWith('increase') ? 'Увеличить' : 'Уменьшить' };
        input.setAttribute('aria-label', 'Средняя оценка от'); stepper.sync();
        assert.equal(stepper.controls[0].getAttribute('aria-label'), 'Увеличить: Средняя оценка от');

        await new Promise(resolve => window.setTimeout(resolve, 0));
        const dynamic = document.createElement('input');
        dynamic.type = 'number'; dynamic.min = '0'; dynamic.max = '10'; dynamic.step = 'any';
        document.body.append(dynamic);
        await new Promise(resolve => window.setTimeout(resolve, 0));
        const dynamicStepper = window.NumberStepper.instances.get(dynamic);
        assert.ok(dynamicStepper, 'Dynamic numeric fields receive the same shared control');
        dynamicStepper.controls[0].click();
        assert.equal(dynamic.value, '1', 'Step-any fields use a bounded increment fallback');
        dynamic.disabled = true;
        await new Promise(resolve => window.setTimeout(resolve, 0));
        assert.ok(dynamicStepper.controls.every(button => button.disabled), 'Disabled state is observed after dynamic updates');
        assert.equal(document.querySelectorAll('.number-stepper').length, 2, 'Observing component markup does not create nested steppers');
    } finally { window.close(); }

    const pages = fs.readdirSync(path.join(root, 'src/pages'), { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => `src/pages/${entry.name}/${entry.name}.html`);
    pages.push('src/popup/popup.html');
    let checked = 0;
    for (const file of pages) {
        const full = path.join(root, file);
        if (!fs.existsSync(full)) continue;
        const html = fs.readFileSync(full, 'utf8');
        if (!html.includes('styles/common.css')) continue;
        const scripts = Array.from(html.matchAll(/<script\b[^>]*src="([^"]*NumberStepper\.js)"[^>]*>/g), match => match[1]);
        assert.equal(scripts.length, 1, `${file}: one shared number-stepper entry point`);
        assert.ok(fs.existsSync(path.resolve(path.dirname(full), scripts[0])));
        checked++;
    }
    assert.ok(checked >= 18);
    console.log(`NumberStepper passed: step/bounds/events/focus, readonly/disabled, dynamic inputs, localization and ${checked} page entry points.`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
