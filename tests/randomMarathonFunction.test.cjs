const assert = require('node:assert/strict');
const {
  MAX_MOVIES_PER_USER,
  createRandomMarathonService,
  displayNameFromProfile,
  isApprovedProfile,
  normalizeMovie,
} = require('../functions/randomMarathon');

assert.equal(MAX_MOVIES_PER_USER, 3);
assert.deepEqual(normalizeMovie({
  kpId: '123',
  title: '  Example  ',
  year: '2024',
  poster: 'https://example.test/poster.jpg',
  rating: '8.2',
}), {
  kpId: 123,
  title: 'Example',
  year: 2024,
  poster: 'https://example.test/poster.jpg',
  rating: 8.2,
});

assert.throws(() => normalizeMovie({ kpId: 0, title: 'bad' }), /Kinopoisk movie ID/);
assert.throws(() => normalizeMovie({ kpId: 123, title: 'bad', year: '<img>' }), /year is invalid/);
assert.throws(() => normalizeMovie({ kpId: 123, title: 'bad', rating: 11 }), /rating is invalid/);
assert.throws(() => normalizeMovie({ kpId: 123, title: 'x'.repeat(301) }), /title is too long/);
assert.throws(() => normalizeMovie({ kpId: 123, title: 'bad', poster: 'javascript:alert(1)' }), /poster is invalid/);

assert.equal(isApprovedProfile({ approvalStatus: 'approved' }), true);
assert.equal(isApprovedProfile({}), true);
assert.equal(isApprovedProfile({ approvalStatus: 'pending' }), false);
assert.equal(displayNameFromProfile({ displayNameFormat: 'username', username: 'cinema_nick' }), 'cinema_nick');
assert.equal(displayNameFromProfile({ firstName: 'Ира', lastName: 'Лагвилава' }), 'Ира Лагвилава');

class FakeSnapshot {
  constructor(ref, value) {
    this.id = ref.id;
    this.exists = value !== undefined;
    this._value = value;
    this.docs = [];
  }

  data() {
    return this._value;
  }
}

class FakeRef {
  constructor(db, path) {
    this.db = db;
    this.path = path;
    this.id = path.split('/').pop();
  }

  collection(name) {
    return new FakeCollection(this.db, `${this.path}/${name}`);
  }

  async get() {
    return new FakeSnapshot(this, this.db.store.get(this.path));
  }
}

class FakeQuery {
  constructor(collection, field, value) {
    this.collection = collection;
    this.field = field;
    this.value = value;
  }

  async get() {
    const snapshot = new FakeSnapshot(new FakeRef(this.collection.db, this.collection.path), undefined);
    snapshot.docs = [...this.collection.db.store.entries()]
      .filter(([path, data]) => path.startsWith(`${this.collection.path}/`) && path.split('/').length === this.collection.path.split('/').length + 1)
      .filter(([, data]) => data?.[this.field] === this.value)
      .map(([path, data]) => {
        const ref = new FakeRef(this.collection.db, path);
        return { id: ref.id, ref, data: () => data };
      });
    return snapshot;
  }
}

class FakeCollection extends FakeRef {
  doc(id) {
    return new FakeRef(this.db, `${this.path}/${id}`);
  }

  where(field, operator, value) {
    assert.equal(operator, '==');
    return new FakeQuery(this, field, value);
  }
}

class FakeTransaction {
  constructor(db) {
    this.db = db;
    this.writes = [];
  }

  async get(target) {
    return target.get();
  }

  set(ref, data) {
    this.writes.push(() => this.db.store.set(ref.path, { ...data }));
  }

  update(ref, data) {
    this.writes.push(() => this.db.store.set(ref.path, { ...(this.db.store.get(ref.path) || {}), ...data }));
  }

  delete(ref) {
    this.writes.push(() => this.db.store.delete(ref.path));
  }
}

class FakeDb {
  constructor() {
    this.store = new Map();
  }

  collection(name) {
    return new FakeCollection(this, name);
  }

  async runTransaction(callback) {
    const transaction = new FakeTransaction(this);
    const result = await callback(transaction);
    transaction.writes.forEach((write) => write());
    return result;
  }
}

(async () => {
  const fakeDb = new FakeDb();
  fakeDb.store.set('randomMarathons/current', {
    roundId: 1,
    status: 'collecting',
    participantCounts: {},
  });
  const fakeService = createRandomMarathonService({
    db: fakeDb,
    FieldValue: { serverTimestamp: () => ({ seconds: 1 }) },
  });
  const participant = { approvalStatus: 'approved', displayNameFormat: 'username', username: 'viewer' };
  for (let movieId = 1; movieId <= 3; movieId += 1) {
    await fakeService.addMovie({ actorUid: 'viewer-1', profile: participant, movie: { kpId: movieId, title: `Movie ${movieId}` } });
  }
  await assert.rejects(
    () => fakeService.addMovie({ actorUid: 'viewer-1', profile: participant, movie: { kpId: 4, title: 'Movie 4' } }),
    (error) => error.code === 'MOVIE_LIMIT'
  );
  await fakeService.addMovie({ actorUid: 'admin-1', profile: { isAdmin: true }, movie: { kpId: 4, title: 'Movie 4' } });
  await fakeService.addMovie({ actorUid: 'admin-1', profile: { isAdmin: true }, movie: { kpId: 6, title: 'Movie 6' } });
  await fakeService.addMovie({ actorUid: 'admin-1', profile: { isAdmin: true }, movie: { kpId: 7, title: 'Movie 7' } });
  await fakeService.addMovie({ actorUid: 'admin-1', profile: { isAdmin: true }, movie: { kpId: 8, title: 'Movie 8' } });
  await fakeService.removeMovie({ actorUid: 'viewer-1', profile: participant, itemId: '1_1' });
  await fakeService.addMovie({ actorUid: 'viewer-1', profile: participant, movie: { kpId: 5, title: 'Movie 5' } });

  const raceDb = new FakeDb();
  raceDb.store.set('randomMarathons/current', {
    roundId: 1,
    status: 'active',
    currentItemId: '1_1',
    completedCount: 0,
  });
  raceDb.store.set('randomMarathons/current/items/1_1', {
    roundId: 1,
    kpId: 101,
    state: 'selected',
  });
  raceDb.store.set('randomMarathons/current/items/1_2', {
    roundId: 1,
    kpId: 102,
    state: 'queued',
  });
  const raceService = createRandomMarathonService({
    db: raceDb,
    FieldValue: { serverTimestamp: () => ({ seconds: 2 }) },
  });
  const admin = { actorUid: 'admin-1', profile: { isAdmin: true } };
  await raceService.resolveCurrent({ ...admin, expectedRoundId: 1, expectedItemId: '1_1', resolution: 'watched' });
  await raceService.rollNext(admin);
  await assert.rejects(
    () => raceService.resolveCurrent({ ...admin, expectedRoundId: 1, expectedItemId: '1_1', resolution: 'watched' }),
    (error) => error.code === 'CURRENT_MOVIE_STALE'
  );

  const finishedDb = new FakeDb();
  finishedDb.store.set('randomMarathons/current', { roundId: 2, status: 'completed', currentItemId: null });
  finishedDb.store.set('randomMarathons/current/items/2_201', { roundId: 2, kpId: 201, state: 'queued' });
  const finishedService = createRandomMarathonService({
    db: finishedDb,
    FieldValue: { serverTimestamp: () => ({ seconds: 3 }) },
  });
  await assert.rejects(
    () => finishedService.removeMovie({ ...admin, itemId: '2_201' }),
    (error) => error.code === 'ROUND_NOT_ACTIVE'
  );

  console.log('Random marathon function contract passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
