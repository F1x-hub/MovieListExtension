const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = {
  console,
  setTimeout,
  clearTimeout,
  Utils: {
    getDisplayName(profile, fallbackUser) {
      return profile?.displayNameFormat === 'username' ? profile.username : fallbackUser?.displayName || 'Участник';
    },
  },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('src/shared/services/RandomMarathonService.js', 'utf8'), context);

(async () => {
  let roundCallback;
  let itemsCallback;
  let finishDecoration;
  let changes = 0;
  const service = new context.RandomMarathonService({});
  service._getRoundRef = () => ({
    onSnapshot(callback) {
      roundCallback = callback;
      return () => {};
    },
  });
  service._getItemsRef = () => ({
    where() {
      return {
        onSnapshot(callback) {
          itemsCallback = callback;
          return () => {};
        },
      };
    },
  });
  service._decorateItems = () => new Promise((resolve) => {
    finishDecoration = resolve;
  });

  const unsubscribe = service.subscribe(() => { changes += 1; }, (error) => { throw error; });
  roundCallback({ exists: true, id: 'current', data: () => ({ roundId: 1 }) });
  itemsCallback({ docs: [] });
  unsubscribe();
  finishDecoration([]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(changes, 0, 'a disposed subscription must not publish a late decorated snapshot');

  let profileReads = 0;
  const profileService = new context.RandomMarathonService({
    db: {
      collection() {
        return { doc() {
          return { get: async () => {
            profileReads += 1;
            if (profileReads === 1) throw new Error('temporary read failure');
            return { exists: true, id: 'viewer', data: () => ({ username: 'fresh-nick' }) };
          } };
        } };
      },
    },
  });
  assert.equal(await profileService._getUserProfile('viewer'), null);
  const freshProfile = await profileService._getUserProfile('viewer');
  assert.equal(freshProfile.id, 'viewer');
  assert.equal(freshProfile.username, 'fresh-nick');
  assert.equal(profileReads, 2, 'failed profile reads must not poison the profile cache');

  let mutation;
  const mutationService = new context.RandomMarathonService({});
  mutationService._callMutation = async (action, payload) => {
    mutation = { action, payload };
  };
  mutationService.getCurrent = async () => ({ round: null, items: [] });
  await mutationService.resolveCurrent('watched', '5', '5_44');
  assert.equal(mutation.action, 'resolve');
  assert.equal(mutation.payload.resolution, 'watched');
  assert.equal(mutation.payload.expectedRoundId, 5);
  assert.equal(mutation.payload.expectedItemId, '5_44');
  await assert.rejects(() => mutationService.resolveCurrent('removed'), /Текущий фильм уже изменился/);

  let fallbackReads = 0;
  const fastMutationService = new context.RandomMarathonService({});
  fastMutationService._callMutation = async () => ({ round: null, items: [] });
  fastMutationService.getCurrent = async () => {
    fallbackReads += 1;
    return { round: null, items: [] };
  };
  await fastMutationService.removeMovie('1_55');
  assert.equal(fallbackReads, 0, 'a mutation response must be used without an extra full Firestore read');

  const displayService = new context.RandomMarathonService({});
  displayService._getUserProfile = async () => ({ displayNameFormat: 'username', username: 'Fix' });
  const decoratedMutation = await displayService._stateFromMutation({
    round: { roundId: 1, status: 'collecting' },
    items: [{ id: '1_55', addedBy: 'viewer', addedByName: 'Irakli Lagvilava', state: 'queued' }],
  });
  assert.equal(decoratedMutation.items[0].addedByName, 'Fix', 'mutation responses must use the selected display format immediately');

  console.log('Random marathon client contract passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
