#!/usr/bin/env node
/**
 * Jumps through the timeline of one source in the owner's Chrome and records, for each phase,
 * how many jumps landed inside the loaded part, how long the player's loader showed, how long
 * the last seek took, what the player removed from its buffer and which media requests
 * followed. Needs a connected `npm run live:bridge`.
 *
 *   node tests/live/player-seek.cjs [--reload] <titleId> list
 *   node tests/live/player-seek.cjs [--reload] <titleId> <source value, e.g. parser:hdrezka>
 *     --gaps=5,1,0.5,0.25,0.1   seconds between jumps (this is the default)
 *     --detail                  loaded seconds behind before each jump, delays of full flushes
 *     --shapes                  the addresses asked for, by shape
 *
 * Each gap runs +10 s, -10 s and +10/-10 in turn, then jumps inside the loaded part every
 * 2 s. Results go to .e2e-output/live/seek/. The page and a provider's frame emulate focus,
 * because a frame of a covered window stops answering. A frame behind a captcha or a stream
 * that never loads ends the run with "no playing video found"; it never solves one.
 */
const fs = require('node:fs');
const path = require('node:path');
const { connectThroughBridge } = require('./chrome-bridge.cjs');
const ORIGIN = 'chrome-extension://dgdejomdgiabgcfijcdhjefijdfiemhd';
const OUT = path.join(__dirname, '..', '..', '.e2e-output', 'live', 'seek');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const PROBE = `(() => {
  if (window.__seekProbe) return { already: true };
  let video = [...document.querySelectorAll('video')].find(v => v.currentSrc && v.duration > 60);
  if (!video) return null;
  const loader = [...document.querySelectorAll('div')].find(d => d.style.zIndex === '2147483647' && d.querySelector('animateTransform'));
  try { performance.setResourceTimingBufferSize(20000); } catch {}
  const s = window.__seekProbe = { jumps: [], loaderOn: [], video };
  video.addEventListener('seeking', () => { const j = s.jumps.at(-1); if (j && j.seekingAt == null) j.seekingAt = performance.now(); });
  video.addEventListener('seeked', () => { const j = s.jumps.at(-1); if (j) j.seekedAt = performance.now(); });
  video.addEventListener('waiting', () => { const j = s.jumps.at(-1); if (j) j.waiting = (j.waiting || 0) + 1; });
  // What the player itself throws out of the buffer: a provider's player owns that in a frame.
  s.removes = [];
  s.waits = [];
  // Other ways a player starts its buffer over: a new source, aborts, a rebuilt MediaSource.
  s.life = [];
  const note = (what, extra) => s.life.push({ at: performance.now(), what, extra, t: Math.round(video.currentTime) });
  for (const type of ['emptied', 'loadstart', 'durationchange', 'error', 'stalled']) video.addEventListener(type, () => note(type, type === 'durationchange' ? Math.round(video.duration) : undefined));
  try {
    for (const name of ['abort', 'changeType']) { const native = SourceBuffer.prototype[name]; SourceBuffer.prototype[name] = function (...a) { note('sb.' + name); return native.apply(this, a); }; }
    for (const name of ['addSourceBuffer', 'removeSourceBuffer', 'endOfStream', 'clearLiveSeekableRange']) { const native = MediaSource.prototype[name]; MediaSource.prototype[name] = function (...a) { note('ms.' + name); return native.apply(this, a); }; }
    const duration = Object.getOwnPropertyDescriptor(MediaSource.prototype, 'duration');
    Object.defineProperty(MediaSource.prototype, 'duration', { configurable: true, get() { return duration.get.call(this); }, set(value) { note('ms.duration=', Math.round(value)); duration.set.call(this, value); } });
    const append = SourceBuffer.prototype.appendBuffer;
    SourceBuffer.prototype.appendBuffer = function (...a) { try { return append.apply(this, a); } catch (error) { note('append threw', error.name); throw error; } };
  } catch {}
  video.addEventListener('waiting', () => s.waits.push(performance.now()));
  s.keeper = Boolean(window.SourceBuffer && SourceBuffer.prototype.remove.movieExtensionBufferKeeper);
  try {
    const remove = SourceBuffer.prototype.remove;
    SourceBuffer.prototype.remove = function (start, end) {
      s.removes.push({ at: performance.now(), start, end, t: video.currentTime, sinceJump: performance.now() - (s.jumps.at(-1)?.at ?? -Infinity) });
      return remove.call(this, start, end);
    };
  } catch {}
  let on = null;
  setInterval(() => {
    const vis = Boolean(loader) && loader.style.display === 'block';
    const t = performance.now();
    if (vis && on === null) on = t;
    if (!vis && on !== null) { s.loaderOn.push([on, t]); on = null; }
  }, 20);
  const inBuffer = t => { const r = video.buffered; for (let i = 0; i < r.length; i++) if (r.start(i) <= t + 0.25 && r.end(i) - t >= 0.5) return true; return false; };
  const ahead = () => { const r = video.buffered, t = video.currentTime; for (let i = 0; i < r.length; i++) if (r.start(i) <= t + 0.25 && r.end(i) > t) return r.end(i) - t; return 0; };
  s.ahead = ahead;
  s.jump = (delta, absolute) => {
    s.follow?.();
    if (!Number.isFinite(video.duration)) return false;
    const from = video.currentTime;
    const target = Math.max(0, Math.min(video.duration - 1, absolute ?? from + delta));
    s.jumps.push({ at: performance.now(), from, target, inBuffer: inBuffer(target), aheadBefore: ahead(), behindBefore: (() => { const r = video.buffered; for (let i = 0; i < r.length; i++) if (r.start(i) <= from && r.end(i) >= from) return Math.round(from - r.start(i)); return 0; })() });
    video.currentTime = target;
    return true;
  };
  s.randomInside = () => {
    const r = video.buffered, t = video.currentTime;
    for (let i = 0; i < r.length; i++) if (r.start(i) <= t + 0.25 && r.end(i) > t + 8) return s.jump(0, t + 3 + Math.random() * (r.end(i) - t - 6));
    return s.jump(5);
  };
  s.summary = () => {
    const media = /\\.(ts|m4s|mp4|m4a|aac|m4v|webm)(\\?|$)|seg|frag|chunk|range=|bytes=/i;
    const entries = performance.getEntriesByType('resource').filter(e => ['xmlhttprequest', 'fetch', 'video', 'other', 'media'].includes(e.initiatorType) && !/\\.m3u8(\\?|$)/i.test(e.name));
    return s.jumps.map((j, i) => {
      const end = s.jumps[i + 1]?.at ?? j.at + 3000;
      const windowEnd = Math.min(end, j.at + 2000);
      const loaderMs = s.loaderOn.filter(([a, b]) => b > j.at && a < end).reduce((sum, [a, b]) => sum + Math.min(b, end) - Math.max(a, j.at), 0);
      const req = entries.filter(e => e.startTime >= j.at && e.startTime < windowEnd);
      return { from: +j.from.toFixed(1), target: +j.target.toFixed(1), inBuffer: j.inBuffer, aheadBefore: +j.aheadBefore.toFixed(1),
        seekMs: j.seekedAt && j.seekingAt ? Math.round(j.seekedAt - j.at) : null, waiting: j.waiting || 0, loaderMs: Math.round(loaderMs),
        requests: req.length, mediaRequests: req.filter(e => media.test(e.name)).length, bytes: req.reduce((n, e) => n + (e.transferSize || 0), 0) };
    });
  };
  // The page keeps the rhythm itself: a command per jump through the bridge is too slow for 0.1 s.
  s.run = async (deltas, n, gapMs) => {
    for (let i = 0; i < n; i++) {
      const d = deltas[i % deltas.length];
      if (d === 'inside') s.randomInside(); else s.jump(d);
      await new Promise(r => setTimeout(r, gapMs));
    }
    return s.jumps.length;
  };
  // One phase as a whole: at 0.1 s a seek is replaced before it ends, so per-jump rows say little.
  s.now = () => performance.now();
  s.engine = () => document.documentElement.dataset.movieExtensionEngine || 'dash';
  // Venom renews its player into a new <video>: follow it.
  s.follow = () => { const next = [...document.querySelectorAll('video')].filter(v => v.isConnected && v.currentSrc && v.duration > 60 && v.dataset.ghost !== 'true' && !v.classList.contains('ghost-video')).sort((a, b) => b.duration - a.duration)[0]; if (next && next !== video) { video = next; s.video = next; s.followed = (s.followed || 0) + 1; for (const type of ['seeking', 'seeked', 'waiting']) video.addEventListener(type, () => { const j = s.jumps.at(-1); if (!j) return; if (type === 'seeking' && j.seekingAt == null) j.seekingAt = performance.now(); if (type === 'seeked') j.seekedAt = performance.now(); if (type === 'waiting') { j.waiting = (j.waiting || 0) + 1; s.waits.push(performance.now()); } }); } return true; };
  setInterval(s.follow, 200);
  s.window = (t0, t1) => {
    const media = /\\.(ts|m4s|mp4|m4a|aac|m4v|webm)(\\?|$)|seg|frag|chunk|range=|bytes=/i;
    const req = performance.getEntriesByType('resource').filter(e => e.startTime >= t0 && e.startTime < t1 && !/\\.m3u8(\\?|$)/i.test(e.name) && media.test(e.name));
    const shown = s.loaderOn.filter(([a, b]) => b > t0 && a < t1);
    const jumps = s.jumps.filter(j => j.at >= t0 && j.at < t1);
    return { jumps: jumps.length, insideLoaded: jumps.filter(j => j.inBuffer).length, loaderShows: shown.length,
      loaderMs: Math.round(shown.reduce((n, [a, b]) => n + Math.min(b, t1) - Math.max(a, t0), 0)),
      longestLoaderMs: Math.round(Math.max(0, ...shown.map(([a, b]) => Math.min(b, t1) - Math.max(a, t0)))),
      mediaRequests: req.length, mb: +(req.reduce((n, e) => n + (e.transferSize || 0), 0) / 1e6).toFixed(2),
      settleMs: (() => { const last = jumps.at(-1); return last?.seekedAt ? Math.round(last.seekedAt - last.at) : null; })(),
      engine: s.engine(), height: video.videoHeight, followed: s.followed || 0, aheadAfter: +ahead().toFixed(1), life: s.life.filter(x => x.at >= t0 && x.at < t1).map(x => x.what + (x.extra !== undefined ? x.extra : '') + '@' + x.t), ranges: (() => { const r = video.buffered; const out = []; for (let i = 0; i < r.length; i++) out.push(Math.round(r.start(i)) + '-' + Math.round(r.end(i))); return out.join(' '); })(), targets: jumps.map(j => Math.round(j.target) + (j.inBuffer ? '' : '!')).join(','), waits: s.waits.filter(x => x >= t0 && x < t1).length, playing: !video.paused && video.readyState > 2,
      removes: (() => { const r = s.removes.filter(x => x.at >= t0 && x.at < t1); const f = n => Number.isFinite(n) ? Math.round(n) : 'inf';
        return { count: r.length, behind: r.filter(x => x.end <= x.t + 1).length, across: r.filter(x => x.start <= x.t && x.end >= x.t).length, acrossDelays: r.filter(x => x.start <= x.t && x.end >= x.t).map(x => Math.round(x.sinceJump)), behindBefore: jumps.map(j => j.behindBefore), quality: video.videoHeight, ahead: r.filter(x => x.start >= x.t - 1).length, aheadLate: r.filter(x => x.start >= x.t - 1 && x.sinceJump > 2500).length,
          sample: r.slice(0, 3).map(x => f(x.start) + '-' + f(x.end) + ' @' + f(x.t)) }; })(),
      behindAfter: (() => { const r = video.buffered, t = video.currentTime; for (let i = 0; i < r.length; i++) if (r.start(i) <= t && r.end(i) >= t) return +(t - r.start(i)).toFixed(1); return 0; })(),
      // What was asked for, by shape: tells film segments from preview frames or audio.
      shapes: Object.entries(req.reduce((m, e) => { let k; try { const u = new URL(e.name); k = u.host + '/…/' + u.pathname.split('/').slice(-2).join('/').replace(/\\d+/g, 'N'); } catch { k = '?'; } (m[k] ||= [0, 0]); m[k][0]++; m[k][1] += e.transferSize || 0; return m; }, {}))
        .sort((a, b) => b[1][0] - a[1][0]).slice(0, 4).map(([k, [n, b]]) => n + 'x ' + k + ' ' + (b / 1e6).toFixed(1) + 'MB') };
  };
  return { found: true, loader: Boolean(loader), keeper: s.keeper, src: video.currentSrc.slice(0, 80) };
})()`;

async function main() {
  const args = process.argv.slice(2);
  const reload = args.includes('--reload');
  const [titleId, source] = args.filter(a => !a.startsWith('--'));
  const chrome = await connectThroughBridge();
  if (!chrome) throw new Error('bridge not connected');
  const evalIn = (s, e) => chrome.evaluate(s, e);
  if (reload) {
    const { targetId } = await chrome.send('Target.createTarget', { url: `${ORIGIN}/src/pages/update/update_instructions.html`, newWindow: true, width: 500, height: 400 });
    const s = (await chrome.send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
    await sleep(800);
    await evalIn(s, `(setTimeout(() => chrome.runtime.reload(), 50), 'reloading')`).catch(() => {});
    await sleep(3000);
    await chrome.send('Target.closeTarget', { targetId }).catch(() => {});
    console.log('extension reloaded');
  }
  const { targetId } = await chrome.send('Target.createTarget', { url: 'about:blank', newWindow: true, width: 1500, height: 950 });
  const page = (await chrome.send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  await chrome.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, page);
  // A hidden window slows timers and media, which spoils every number below.
  await chrome.send('Page.bringToFront', {}, page).catch(() => {});
  await chrome.send('Emulation.setFocusEmulationEnabled', { enabled: true }, page).catch(() => {});
  await chrome.send('Page.navigate', { url: `${ORIGIN}/src/pages/movie-details/movie-details.html?movieId=${titleId}` }, page);
  const waitFor = async (expr, ms) => { const d = Date.now() + ms; for (;;) { try { if (await evalIn(page, expr)) return true; } catch {} if (Date.now() > d) return false; await sleep(500); } };
  await waitFor(`Boolean([...document.querySelectorAll('.watch-movie-btn')].find(n => n.getBoundingClientRect().width > 0))`, 30000);
  await evalIn(page, `(async () => { const tab = await chrome.tabs.getCurrent(); await chrome.tabs.update(tab.id, { muted: true }); })()`);
  const click = async sel => {
    const p = await evalIn(page, `(() => { const n = [...document.querySelectorAll(${JSON.stringify(sel)})].find(i => i.getBoundingClientRect().width > 0); if (!n) return null; n.scrollIntoView({ block: 'center' }); const b = n.getBoundingClientRect(); return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }; })()`);
    if (!p) return false;
    await sleep(150);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await chrome.send('Input.dispatchMouseEvent', { type, ...p, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 }, page);
    return true;
  };
  await click('.watch-movie-btn');
  await waitFor(`document.querySelectorAll('.source-btn').length > 0`, 40000);
  // Sources arrive one by one: the list is read once it has stopped growing, or holds the one asked for.
  let sources = [];
  for (let quiet = 0, waited = 0; quiet < 5 && waited < 45; waited++) {
    const now = await evalIn(page, `[...document.querySelectorAll('.source-btn')].map(n => n.dataset.value + ' | ' + n.textContent.trim().replace(/\\s+/g, ' ').slice(0, 40))`);
    quiet = now.length === sources.length ? quiet + 1 : 0;
    sources = now;
    if (source && source !== 'list' && sources.some(item => item.startsWith(source + ' |'))) break;
    await sleep(1000);
  }
  console.log('sources:', sources);
  if (!source || source === 'list') { await chrome.send('Target.closeTarget', { targetId }); chrome.close(); return; }
  if (!sources.some(item => item.startsWith(source + ' |'))) { await chrome.send('Target.closeTarget', { targetId }); throw new Error(`"${source}" is not offered for this title`); }
  await click('#sourcePopoverToggle');
  await waitFor(`[...document.querySelectorAll('.source-btn[data-value="${source}"]')].some(n => n.getBoundingClientRect().width > 0)`, 4000);
  if (!await click(`.source-btn[data-value="${source}"]`)) {
    console.log('source button hidden, clicking it in the page');
    await evalIn(page, `document.querySelector('.source-btn[data-value="${source}"]')?.click()`);
  }
  await sleep(2000);
  console.log('active:', await evalIn(page, `document.querySelector('#videoContainer iframe')?.src?.slice(0, 60) || document.querySelector('#videoContainer video')?.currentSrc?.slice(0, 60) || 'nothing'`));

  // Find the context holding the playing video: this page, or the provider's frame (and the
  // frames inside it), each with its own session. A frame of a hidden window stops answering,
  // so every session emulates focus, which keeps it visible to Chrome when covered.
  const frameSessions = new Map();
  const attachFrames = async () => {
    const host = await evalIn(page, `(() => { try { return new URL(document.querySelector('#videoContainer iframe').src).host; } catch { return null; } })()`).catch(() => null);
    if (!host) return;
    const { targetInfos } = await chrome.send('Target.getTargets', {});
    // Only the player's own frame and the frames it holds inside, never other tabs' frames:
    // a player nested deeper lives on the hosts its parent frames name.
    const known = new Set([host]);
    for (const frame of frameSessions.values()) {
      known.add(frame.host);
      const inner = await evalIn(frame.session, `[...document.querySelectorAll('iframe')].map(node => { try { return new URL(node.src).host; } catch { return null; } }).filter(Boolean)`).catch(() => []);
      inner.forEach(name => known.add(name));
    }
    for (const info of targetInfos.filter(item => item.type === 'iframe' && !frameSessions.has(item.targetId))) {
      let frameHost = null;
      try { frameHost = new URL(info.url).host; } catch { /* about:blank */ }
      if (!frameHost || !known.has(frameHost)) continue;
      const attachedFrame = await chrome.send('Target.attachToTarget', { targetId: info.targetId, flatten: true }).catch(() => null);
      if (!attachedFrame?.sessionId) continue;
      await chrome.send('Emulation.setFocusEmulationEnabled', { enabled: true }, attachedFrame.sessionId).catch(() => {});
      frameSessions.set(info.targetId, { session: attachedFrame.sessionId, host: frameHost });
    }
  };
  const FIND = `(() => { const v = [...document.querySelectorAll('video')].find(x => x.currentSrc && x.duration > 60); if (!v) return null; if (v.paused) v.play().catch(() => {}); return { t: v.currentTime, paused: v.paused, host: location.host }; })()`;
  let ctx = null;
  let clickedCenter = false;
  const started = Date.now();
  const deadline = Date.now() + 90000;
  while (!ctx && Date.now() < deadline) {
    await sleep(1500);
    const local = await evalIn(page, FIND).catch(() => null);
    if (local) { ctx = { host: local.host, eval: code => evalIn(page, code), probe: () => evalIn(page, PROBE) }; break; }
    await attachFrames();
    for (const frame of frameSessions.values()) {
      const framed = await evalIn(frame.session, FIND).catch(() => null);
      if (framed) { ctx = { host: framed.host, eval: code => evalIn(frame.session, code), probe: () => evalIn(frame.session, PROBE) }; break; }
    }
    if (ctx) break;
    if (!clickedCenter && Date.now() - started > 15000) {
      clickedCenter = true;
      const p = await evalIn(page, `(() => { const b = document.getElementById('videoContainer').getBoundingClientRect(); return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }; })()`);
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await chrome.send('Input.dispatchMouseEvent', { type, ...p, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 }, page);
      console.log('clicked the player');
    }
  }
  if (!ctx) {
    const st = await evalIn(page, `JSON.stringify({ state: document.getElementById('videoContainer')?.dataset?.sourceState, frame: document.querySelector('#videoContainer iframe')?.src?.slice(0, 60), text: document.getElementById('videoContainer')?.innerText?.slice(0, 200) })`).catch(() => null);
    const { data } = await chrome.send('Page.captureScreenshot', { format: 'png' }, page);
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'fail.png'), Buffer.from(data, 'base64'));
    await chrome.send('Target.closeTarget', { targetId }).catch(() => {});
    throw new Error('no playing video found ' + st);
  }
  console.log('video in', ctx.host);
  console.log('probe', await ctx.probe());
  // Let the loaded part grow.
  const growUntil = Date.now() + 75000;
  let ahead = 0;
  while (Date.now() < growUntil) { ahead = await ctx.eval('__seekProbe.ahead()'); if (ahead >= 55) break; await sleep(2000); }
  console.log('loaded ahead before jumps:', ahead.toFixed(1), 's');

  // --gaps 5,1,0.5,0.25,0.1 (seconds). Each gap runs +10 s, -10 s, and +10/-10 in turn,
  // which keeps every jump inside the loaded part however fast it goes.
  const gapsArg = args.find(a => a.startsWith('--gaps='))?.slice(7) || '5,1,0.5,0.25,0.1';
  const gaps = gapsArg.split(',').map(Number).filter(g => g > 0);
  const phases = [];
  for (const g of gaps) {
    const gap = Math.round(g * 1000);
    const one = Math.min(12, Math.max(6, Math.round(40 / g)));
    // --forward: four +10 s presses that fit in 50 s of loaded data. All four land inside
    // it unless the player throws loaded data away on a jump.
    if (args.includes('--forward')) { phases.push({ name: `+10 x4 every ${g} s`, deltas: [10], n: 4, gap, ahead: 50 }); continue; }
    phases.push({ name: `+10 every ${g} s`, deltas: [10], n: Math.min(one, Math.floor(50000 / gap)), gap });
    phases.push({ name: `-10 every ${g} s`, deltas: [-10], n: Math.min(one, Math.floor(50000 / gap)), gap });
    phases.push({ name: `+10/-10 every ${g} s`, deltas: [10, -10], n: Math.min(Math.max(12, Math.round(8 / g)), Math.floor(50000 / gap)), gap });
  }
  phases.push({ name: 'inside loaded every 2 s', deltas: ['inside'], n: 6, gap: 2000 });
  const results = [];
  for (const ph of phases) {
    // Each phase starts with loaded data ahead, as a viewer's next press would.
    const ready = Date.now() + (ph.ahead ? 90000 : 40000);
    let aheadNow = 0;
    while (Date.now() < ready && (aheadNow = await ctx.eval('__seekProbe.ahead()')) < (ph.ahead || 40)) await sleep(1000);
    if (ph.ahead && aheadNow < ph.ahead) console.log(`  only ${Math.round(aheadNow)} s loaded ahead before "${ph.name}": the player keeps less than ${ph.ahead} s`);
    await chrome.send('Page.bringToFront', {}, page).catch(() => {});
    const visibility = await evalIn(page, 'document.visibilityState').catch(() => '?');
    if (visibility !== 'visible') console.log(`  window ${visibility} before "${ph.name}": keep it in view`);
    const t0 = await ctx.eval('__seekProbe.now()');
    try { await ctx.eval(`__seekProbe.run(${JSON.stringify(ph.deltas)}, ${ph.n}, ${ph.gap})`); } catch (error) {
      // The frame went away mid-phase: say what the page shows before giving up.
      await sleep(4000);
      console.log(`  "${ph.name}" lost its frame: ${error.message}`);
      console.log('  page:', await evalIn(page, `JSON.stringify({ state: document.getElementById('videoContainer')?.dataset?.sourceState, frame: document.querySelector('#videoContainer iframe')?.src?.slice(0, 70), text: document.getElementById('videoContainer')?.innerText?.slice(0, 160), active: document.querySelector('.source-btn.active, .source-btn[aria-pressed="true"], .source-btn[aria-checked="true"]')?.dataset?.value })`).catch(e => e.message));
      for (const frame of frameSessions.values()) console.log('  frame:', await evalIn(frame.session, `JSON.stringify({ href: location.href.slice(0, 70), videos: [...document.querySelectorAll('video')].map(v => [(v.currentSrc || '-').slice(0, 12), Math.round(v.duration), v.readyState, v.paused, Math.round(v.currentTime), v.error && v.error.code, v.error && v.error.message]), text: document.body?.innerText?.slice(0, 120) })`).catch(e => e.message));
      throw error;
    }
    await sleep(2500);
    const stats = await ctx.eval(`__seekProbe.window(${t0}, __seekProbe.now())`);
    results.push({ phase: ph.name, ...stats });
    console.log(`${ph.name.padEnd(26)} jumps ${String(stats.jumps).padStart(3)} | inside ${String(stats.insideLoaded).padStart(3)} | loader ${stats.loaderShows}x ${stats.loaderMs} ms (longest ${stats.longestLoaderMs}) | media req ${stats.mediaRequests} (${stats.mb} MB) | ${stats.engine} ${stats.height}p | last seek ${stats.settleMs} ms | ahead ${stats.aheadAfter} s | behind ${stats.behindAfter} s | waits ${stats.waits}${stats.playing ? '' : ' NOT PLAYING'} | removes ${stats.removes.count} (behind ${stats.removes.behind}, across ${stats.removes.across}, ahead ${stats.removes.ahead}, late ${stats.removes.aheadLate}) ${stats.removes.sample.join(' ')}`);
    if (args.includes('--detail')) console.log(`    targets (! = outside loaded): ${stats.targets} | loaded now: ${stats.ranges} | lifecycle: ${stats.life.join(' ') || 'none'}`);
    if (args.includes('--detail')) console.log(`    behind before each jump: ${stats.removes.behindBefore.join(',')} | across-flush delays ms: ${stats.removes.acrossDelays.join(',')} | ${stats.removes.quality}p`);
    if (args.includes('--shapes') && stats.shapes.length) console.log('    ' + stats.shapes.join('\n    '));
  }
  const rows = await ctx.eval('__seekProbe.summary()');
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${titleId}-${source}.json`), JSON.stringify({ titleId, source, host: ctx.host, results, rows }, null, 1));
  await chrome.send('Target.closeTarget', { targetId }).catch(() => {});
  chrome.close();
}
main().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
