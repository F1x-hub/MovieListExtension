const assert = require('node:assert/strict');
const { RutubeWatchRoomBridge } = require('../src/shared/services/player/RutubeWatchRoomBridge');

;(async () => {
    let clock = 1_000;
    const sent = [];
    const iframeWindow = { postMessage: (message, origin) => sent.push({ message, origin }) };
    const iframe = { src: 'https://rutube.ru/play/embed/a1b2c3d4e5f6?getPlayOptions=duration', contentWindow: iframeWindow };
    global.window = { location: { href: 'chrome-extension://test/page.html' } };

const bridge = new RutubeWatchRoomBridge({ getIframe: () => iframe, now: () => clock });
assert.equal(bridge.isActive(), true);

const pendingProbe = bridge.probe(100);
const ready = bridge.handleWindowMessage({
  source: iframeWindow,
  origin: 'https://rutube.ru',
  data: JSON.stringify({ type: 'player:ready', data: { playerId: 'video_frame' } }),
});
assert.equal(ready.handled, true);
assert.equal(ready.ready, true);
assert.deepEqual((await pendingProbe).capabilities, {
  observeTime: true, play: true, pause: true, seek: true, duration: true,
});

bridge.subscribe('room-sync-1');
bridge.command({ action: 'seek', positionMs: 12_500 });
bridge.command({ action: 'play' });
bridge.command({ action: 'pause' });
assert.deepEqual(sent, [
  { message: JSON.stringify({ type: 'player:setCurrentTime', data: { time: 12.5 } }), origin: 'https://rutube.ru' },
  { message: JSON.stringify({ type: 'player:play', data: {} }), origin: 'https://rutube.ru' },
  { message: JSON.stringify({ type: 'player:pause', data: {} }), origin: 'https://rutube.ru' },
]);

bridge.handleWindowMessage({
  source: iframeWindow,
  origin: 'https://rutube.ru',
  data: JSON.stringify({ type: 'player:currentTime', data: { time: 10 } }),
});
const playing = bridge.handleWindowMessage({
  source: iframeWindow,
  origin: 'https://rutube.ru',
  data: JSON.stringify({ type: 'player:changeState', data: { state: 'playing' } }),
});
assert.deepEqual(playing.messages, [{
  type: 'ROOM_SYNC_TELEMETRY', subscriptionId: 'room-sync-1', kind: 'play', currentTimeMs: 10_000,
}]);

clock += 250;
const seek = bridge.handleWindowMessage({
  source: iframeWindow,
  origin: 'https://rutube.ru',
  data: JSON.stringify({ type: 'player:currentTime', data: { time: 20 } }),
});
assert.equal(seek.messages[0].kind, 'seeked');
assert.equal(seek.messages[0].currentTimeMs, 20_000);

const blocked = bridge.handleWindowMessage({
  source: iframeWindow,
  origin: 'https://evil.example',
  data: JSON.stringify({ type: 'player:changeState', data: { state: 'paused' } }),
});
assert.equal(blocked.handled, false);
assert.equal(bridge.handleWindowMessage({ source: iframeWindow, origin: 'https://rutube.ru', data: '{bad' }).handled, false);

bridge.handleWindowMessage({ source: iframeWindow, origin: 'https://rutube.ru', data: JSON.stringify({ type: 'player:adStart', data: {} }) });
const adPause = bridge.handleWindowMessage({
  source: iframeWindow,
  origin: 'https://rutube.ru',
  data: JSON.stringify({ type: 'player:changeState', data: { state: 'paused' } }),
});
assert.deepEqual(adPause.messages, []);

    console.log('rutubeWatchRoomBridge.test.cjs: official Rutube protocol is normalized safely');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
