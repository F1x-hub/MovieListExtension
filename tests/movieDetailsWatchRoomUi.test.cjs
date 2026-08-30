const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function compileMethod(source, name, nextMethod) {
  const start = source.indexOf(`    ${name}(`);
  const end = source.indexOf(`\n    ${nextMethod}(`, start);
  assert.ok(start >= 0 && end > start, `${name} method must remain locally owned by MovieDetails`);
  const declaration = source.slice(start, end);
  const paramsStart = declaration.indexOf('(');
  const paramsEnd = declaration.indexOf(') {', paramsStart);
  const params = declaration.slice(paramsStart + 1, paramsEnd);
  const body = declaration.slice(paramsEnd + 3, declaration.lastIndexOf('\n    }'));
  return new Function(`return function(${params}) {${body}}`)();
}

const source = fs.readFileSync('src/pages/movie-details/movie-details.js', 'utf8');
const markup = fs.readFileSync(path.join('src', 'pages', 'movie-details', 'movie-details.html'), 'utf8');
assert.match(source, /onRoomUpdate:\s*\(room\)\s*=>\s*this\.renderWatchRoomMembers\(room\)/);
const refreshWatchRoomControls = compileMethod(source, 'refreshWatchRoomControls', 'renderWatchRoomMembers');
const renderWatchRoomMembers = compileMethod(source, 'renderWatchRoomMembers', 'async setWatchRoomMemberRole');

assert.match(source, /controller:\s*'управляющий'/);
assert.match(source, /Разрешить управление/);
assert.match(source, /Сделать зрителем/);
assert.match(source, /canManageRoles\s*&&\s*!member\.isCurrentUser/);
assert.match(source, /await this\.setWatchRoomMemberRole\(member\.uid, nextRole\);\s*this\.setWatchRoomStatus\(''\);/);
assert.match(markup, /id="createWatchRoomBtn"[^>]*data-watch-room-action="create"/);
assert.match(markup, /id="joinWatchRoomBtn"[^>]*data-watch-room-action="join"/);
assert.match(source, /watchRoomControls\.addEventListener\('click', \(event\) => this\.handleWatchRoomAction\(event\), true\)/);
assert.match(source, /event\.stopImmediatePropagation\(\);/);
assert.match(source, /if \(action === 'create'\) \{\s*void this\.createWatchRoom\(\);/);
assert.match(source, /else if \(action === 'join'\) \{\s*void this\.joinWatchRoom\(\);/);

const participantButton = {
  hidden: false,
  attributes: new Map(),
  setAttribute(name, value) { this.attributes.set(name, value); },
};
const createButton = { hidden: true, disabled: true };
const joinButton = { hidden: true, disabled: true };
const list = {
  children: null,
  replaceChildren(...children) { this.children = children; },
};
const view = {
  watchRoomController: { room: null, role: null },
  watchRoomJoinCode: 'expired-invite-code',
  elements: {
    createWatchRoomBtn: createButton,
    joinWatchRoomBtn: joinButton,
    copyWatchRoomCodeBtn: { hidden: false },
    watchRoomMembersBtn: participantButton,
    watchRoomMembersPopover: { hidden: false },
    watchRoomParticipantCount: { textContent: '2' },
    watchRoomMembersList: list,
  },
  refreshWatchRoomControls,
};

renderWatchRoomMembers.call(view, { roomId: null, role: null, members: [] });

assert.equal(createButton.hidden, false);
assert.equal(createButton.disabled, false);
assert.equal(joinButton.hidden, false);
assert.equal(joinButton.disabled, false);
assert.equal(view.elements.copyWatchRoomCodeBtn.hidden, true);
assert.equal(participantButton.hidden, true);
assert.equal(view.elements.watchRoomMembersPopover.hidden, true);
assert.equal(participantButton.attributes.get('aria-expanded'), 'false');
assert.equal(view.elements.watchRoomParticipantCount.textContent, '0');
assert.deepEqual(list.children, []);
assert.equal(view.watchRoomJoinCode, null);

console.log('movieDetailsWatchRoomUi.test.cjs: an expired room returns the UI to create/join state without restoration');
