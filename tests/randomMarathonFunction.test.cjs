const assert = require('node:assert/strict');
const {
  MAX_MOVIES_PER_USER,
  createRandomMarathonService,
  displayNameFromProfile,
  isApprovedProfile,
  normalizeMovie,
  normalizePoster,
} = require('../functions/randomMarathon');
const { PosterUrl } = require('../src/shared/utils/PosterUrl.js');

assert.equal(MAX_MOVIES_PER_USER, 3);
assert.deepEqual(normalizeMovie({
  kpId: '123',
  title: '  Example  ',
  year: '2024',
  poster: 'https://image.openmoviedb.com/poster.jpg',
  rating: '8.2',
}), {
  kpId: 123,
  title: 'Example',
  year: 2024,
  poster: 'https://image.openmoviedb.com/poster.jpg',
  rating: 8.2,
});

assert.equal(normalizeMovie({
  kpId: 123,
  poster: 'http://st.kp.yandex.net/images/film_iphone/iphone360_123.jpg?d=20240101',
}).poster, 'https://st.kp.yandex.net/images/film_iphone/iphone360_123.jpg');

assert.throws(() => normalizeMovie({ kpId: 0, title: 'bad' }), /Kinopoisk movie ID/);
assert.throws(() => normalizeMovie({ kpId: 123, title: 'bad', year: '<img>' }), /year is invalid/);
assert.throws(() => normalizeMovie({ kpId: 123, title: 'bad', rating: 11 }), /rating is invalid/);
assert.throws(() => normalizeMovie({ kpId: 123, title: 'x'.repeat(301) }), /title is too long/);

// Kinopoisk serves posters from Yandex in extensionless sizes; those used to be
// refused, so a film could not join the marathon («Не удалось проверить данные фильма»).
const kinopoiskPosters = [
  'https://image.openmoviedb.com/kinopoisk-images/1599028/637271d5-61b4-4e46-ac83-6d07494c7645/orig',
  'https://image.openmoviedb.com/kinopoisk-ott-images/1648503/2a000001876d5a7d3f2c9e9f3b0d5f0c2b8b/orig',
  'https://avatars.mds.yandex.net/get-kinopoisk-image/1599028/637271d5-61b4-4e46-ac83-6d07494c7645/600x900',
  'https://avatars.mds.yandex.net/get-kinopoisk-image/1599028/637271d5-61b4-4e46-ac83-6d07494c7645/orig',
];
for (const poster of kinopoiskPosters) {
  assert.equal(normalizeMovie({ kpId: 301, title: 'Матрица', year: 1999, rating: 8.5, poster }).poster, poster,
    `${poster} is kept`);
}
assert.equal(normalizeMovie({ kpId: 301, poster: { url: kinopoiskPosters[2], previewUrl: 'x' } }).poster, kinopoiskPosters[2],
  'a raw Kinopoisk poster object gives its URL');
assert.equal(normalizePoster('//avatars.mds.yandex.net/get-kinopoisk-image/1/x/orig'),
  'https://avatars.mds.yandex.net/get-kinopoisk-image/1/x/orig', 'a protocol-relative poster becomes https');

// A poster that does not qualify is dropped; the movie still joins and the page
// falls back to the Kinopoisk poster by ID.
for (const poster of [
  'javascript:alert(1)',
  'http://example.test/poster.jpg',
  'https://image.tmdb.org/other/poster.jpg',
  'https://st.kp.yandex.net/robots.txt',
  'https://user:pass@avatars.mds.yandex.net/get-kinopoisk-image/1/x/orig',
  'https://avatars.mds.yandex.net:8443/get-kinopoisk-image/1/x/orig',
  'https://avatars.mds.yandex.net:443/get-kinopoisk-image/1/x/orig',
  'https://image.openmoviedb.com/a\nb',
  `https://image.openmoviedb.com/${'x'.repeat(2048)}`,
  42,
  null,
]) {
  const movie = normalizeMovie({ kpId: 123, title: 'Movie', poster });
  assert.equal(movie.poster, null, `${String(poster).slice(0, 60)} is dropped`);
  assert.equal(movie.kpId, 123);
}

// The server accepts exactly the posters the Random page sends (PosterUrl.safe),
// so the two lists cannot drift apart again.
const posterSamples = [
  ...kinopoiskPosters,
  'https://image.tmdb.org/t/p/w500/abc.jpg',
  'http://st.kp.yandex.net/images/film_iphone/iphone360_289.jpg?d=old',
  'https://st.kp.yandex.net/images/film_big/278217.jpg',
  'https://st.kp.yandex.net/301.jpg',
  'https://image.openmoviedb.com/poster',
  'https://unsupported.example/poster.jpg',
  'ftp://image.tmdb.org/t/p/w500/abc.jpg',
  'https://avatars.mds.yandex.net:8443/get-kinopoisk-image/1/x/orig',
  'https://avatars.mds.yandex.net/get-kinopoisk-image/1/x/orig#frag',
  'not a url',
  '',
];
for (const sample of posterSamples) {
  const client = PosterUrl.safe(sample);
  const server = normalizePoster(sample);
  assert.equal(Boolean(server), Boolean(client), `server and page agree on ${sample || '(empty)'}`);
  if (client) {
    const withoutQuery = new URL(client);
    withoutQuery.search = '';
    withoutQuery.hash = '';
    assert.equal(server, withoutQuery.href, `the stored poster is the page's URL without query: ${sample}`);
  }
}

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
      .filter(([path]) => path.startsWith(`${this.collection.path}/`) && path.split('/').length === this.collection.path.split('/').length + 1)
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
  // The film from the report: a Kinopoisk poster in a Yandex size joins the round.
  await fakeService.addMovie({
    actorUid: 'viewer-1',
    profile: participant,
    movie: { kpId: 5, title: 'Movie 5', year: 2021, rating: 7.4, poster: kinopoiskPosters[0] },
  });
  assert.equal(fakeDb.store.get('randomMarathons/current/items/1_5').poster, kinopoiskPosters[0]);

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
