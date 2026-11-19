// Salvo (Залп): locale coverage, terrain, blast and projectile rules, the computer's aim, and the games menu link.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { locales } from '../src/shared/i18n/locales.js';
import { Z } from '../src/shared/games/zalp/ZalpCore.js';
import '../src/shared/games/zalp/ZalpWorld.js';
import '../src/shared/games/zalp/ZalpEntities.js';
import '../src/shared/games/zalp/ZalpWeapons.js';
import '../src/shared/games/zalp/ZalpAI.js';

const lookup = (root, key) => key.split('.').reduce((v, part) => v?.[part], root);

// ---------------------------------------------------------------- locales
const shape = (node, prefix = '') => Object.entries(node).flatMap(([k, v]) => (typeof v === 'object' ? shape(v, `${prefix}${k}.`) : [`${prefix}${k}`])).sort();
assert.deepEqual(shape(locales.en.games.zalp), shape(locales.ru.games.zalp), 'en and ru Salvo strings have the same keys');
for (const lang of ['en', 'ru']) {
    assert.equal(typeof lookup(locales[lang], 'games.menu.zalp.title'), 'string', `${lang} menu card title`);
    assert.ok(lookup(locales[lang], 'games.zalp.names').split('|').length >= 10, `${lang} has enough fighter names`);
    for (const w of Z.WEAPONS) {
        assert.equal(typeof lookup(locales[lang], `games.zalp.weapons.${w.id}.name`), 'string', `${lang} name for ${w.id}`);
        assert.equal(typeof lookup(locales[lang], `games.zalp.weapons.${w.id}.desc`), 'string', `${lang} description for ${w.id}`);
    }
}
assert.equal(Z.WEAPON_BY_ID.rocket.name, 'Ракета', 'weapon names follow the active locale (Russian fallback in Node)');

const used = new Set();
for (const file of fs.readdirSync('src/shared/games/zalp').map((f) => `src/shared/games/zalp/${f}`).concat('src/pages/zalp/zalp.js')) {
    for (const m of fs.readFileSync(file, 'utf8').matchAll(/'(zalp\.[\w.]+)'/g)) used.add(m[1]);
}
const html = fs.readFileSync('src/pages/zalp/zalp.html', 'utf8');
for (const m of html.matchAll(/data-i18n="(?:\[[\w-]+\])?games\.(zalp\.[\w.]+)"/g)) used.add(m[1]);
assert.ok(used.size > 60, 'the scan found the Salvo strings');
for (const key of used) {
    if (/[._]$/.test(key)) continue; // a prefix completed at runtime ('zalp.teams.' + colour, 'zalp.err.' + code)
    for (const lang of ['en', 'ru']) assert.equal(typeof lookup(locales[lang], `games.${key}`), 'string', `${lang} has games.${key}`);
}

// the page obeys the extension CSP: no inline script or style, scripts load as files
assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, 'no inline scripts in zalp.html');
assert.doesNotMatch(html, /\sstyle=|<style/, 'no inline styles in zalp.html');
assert.doesNotMatch(html, /https?:\/\//, 'zalp.html loads nothing from the network');
assert.match(html, /<script src="zalp\.js" type="module"><\/script>/);

// ---------------------------------------------------------------- terrain
for (const seed of [11, 4242, 99173]) {
    const w = new Z.World(seed, 'meadow');
    let solid = 0, nearEdge = 0;
    for (let y = 0; y < w.waterY; y += 3) {
        for (let x = 0; x < w.W; x += 3) {
            if (!w.solid(x, y)) continue;
            solid++;
            if (x < 60 || x > w.W - 60) nearEdge++;
        }
    }
    assert.ok(solid > 20000, `seed ${seed} has ground to fight on`);
    assert.equal(nearEdge, 0, `seed ${seed}: islands fade out before the map edge instead of being cut`);
    const spots = w.spawnPoints(10, 150);
    assert.equal(spots.length, 10);
    for (const s of spots) assert.ok(s.y < w.waterY - 20, 'fighters start above the water');
}

// a flat test range: solid below y = 800
function flatWorld() {
    const w = new Z.World(7, 'meadow');
    w.data.fill(0);
    for (let y = 800; y < w.H; y++) for (let x = 0; x < w.W; x++) w.data[(y * w.W + x) << 1] = 255;
    return w;
}

// ---------------------------------------------------------------- blast and projectiles
assert.equal(Z.blast(0, 50, 50), 50, 'a direct hit deals full damage');
assert.equal(Z.blast(200, 50, 50), 0, 'out of reach deals nothing');
assert.ok(Z.blast(20, 50, 50) > Z.blast(40, 50, 50), 'damage falls off with distance');

const range = flatWorld();
const rocket = new Z.Proj(Object.assign({}, Z.WEAPON_BY_ID.rocket.proj, { x: 300, y: 790, vx: 0, vy: 400 }));
let ev = null;
for (let i = 0; i < 240 && !ev; i++) ev = Z.stepProj(rocket, Z.K.STEP, range, [], 0, true);
assert.equal(ev && ev.type, 'explode', 'a rocket explodes on the ground');
assert.ok(Math.abs(rocket.y - 800) < 3, 'at the surface');

const grenade = new Z.Proj(Object.assign({}, Z.WEAPON_BY_ID.grenade.proj, { x: 500, y: 780, vx: 60, vy: 0, fuse: 3 }));
let exploded = null, rested = false;
for (let i = 0; i < 120 * 4 && !exploded; i++) {
    const e = Z.stepProj(grenade, Z.K.STEP, range, [], 0, true);
    if (grenade.rest) rested = true;
    if (e && e.type === 'explode') exploded = i * Z.K.STEP;
}
assert.ok(rested, 'a grenade comes to rest on flat ground');
assert.ok(exploded > 2.9 && exploded < 3.1, 'and goes off when its fuse runs out');

// ---------------------------------------------------------------- the computer's aim
const teams = [0, 1].map((idx) => ({ idx, ai: idx === 1, name: 'T' + idx, units: [], ammo: Object.fromEntries(Z.WEAPONS.map((w) => [w.id, w.ammo])) }));
const shooter = new Z.Unit(teams[1], 'AI', 1400, 800 - Z.K.UNIT_R - 1);
const target = new Z.Unit(teams[0], 'Target', 1000, 800 - Z.K.UNIT_R - 1);
teams[0].units.push(target); teams[1].units.push(shooter);
const g = { world: range, units: [shooter, target], wind: 0, opts: { diff: 2 }, teams };
const ai = new Z.AI(g, shooter);
while (!ai.work(1000)) { /* run every candidate */ }
const best = ai.job.best;
assert.ok(best && best.score > 20, `the computer finds a damaging shot (score ${best && best.score})`);
if (best.hit) assert.ok(Math.hypot(best.hit.x - target.x, best.hit.y - target.y) < 60, 'its predicted hit lands at the target');

// ---------------------------------------------------------------- games menu
const modal = fs.readFileSync('src/shared/components/GamesModal.js', 'utf8');
assert.match(modal, /class="game-menu-card game-menu-card--zalp" role="menuitem" href="\$\{escapeHtml\(chrome\.runtime\.getURL\('src\/pages\/zalp\/zalp\.html'\)\)\}"/,
    'the games menu links to the Salvo page');

console.log('zalpGame tests passed');
