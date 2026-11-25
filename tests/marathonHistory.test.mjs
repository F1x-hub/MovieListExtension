import assert from 'node:assert/strict';
import {
    bestFilm, describeRound, listRounds, loadMarathonItems, participation, raterIds, ratedWhileOn, scoreWatched, summarizePerson
} from '../src/shared/utils/marathonHistory.js';

const day = number => Date.UTC(2026, 9, number, 18);
const stamp = number => ({ toMillis: () => day(number) });
const item = (roundId, kpId, addedBy, fields = {}) => ({
    id: `${roundId}_${kpId}`, roundId, kpId, addedBy, addedByName: addedBy.toUpperCase(), title: `Film ${kpId}`,
    state: 'watched', addedAt: stamp(1), selectedAt: stamp(kpId), resolvedAt: stamp(kpId + 1), ...fields
});
const rating = (userId, movieId, score, at) => ({ id: `${userId}_${movieId}`, userId, userName: userId.toUpperCase(), movieId, rating: score, createdAt: stamp(at) });

const items = [
    item(1, 2, 'a'), item(1, 4, 'b'), item(1, 5, 'b', { state: 'removed' }),
    item(2, 10, 'a'), item(2, 12, 'c', { state: 'queued', selectedAt: null, resolvedAt: null })
];
const ratings = [
    rating('a', 2, 6, 3), rating('b', '2', 9, 3), rating('viewer', 2, 9, 4),
    // Rated long before the marathon: a participant's score counts, a stranger's does not.
    rating('b', 4, 10, -300), rating('stranger', 4, 1, -300), rating('a', 4, 8, 6), rating('a', 10, 0, 11)
];

// A rating belongs to the evening from the pick to a week after the film was watched.
assert.equal(ratedWhileOn(items[0], rating('x', 2, 5, 2)), true);
assert.equal(ratedWhileOn(items[0], rating('x', 2, 5, 10)), true);
assert.equal(ratedWhileOn(items[0], rating('x', 2, 5, 11)), false);
assert.equal(ratedWhileOn(items[0], rating('x', 2, 5, 1)), false);
assert.equal(ratedWhileOn(items[4], rating('x', 12, 5, 12)), false, 'a film still on the wheel was not watched');

// Finished rounds only, newest first; a completed current round is already history.
assert.deepEqual(listRounds(items, { roundId: 2, status: 'active' }).map(round => round.roundId), [1]);
assert.deepEqual(listRounds(items, { roundId: 2, status: 'completed' }).map(round => round.roundId), [2, 1]);
const [first] = listRounds(items, { roundId: 2, status: 'active' });
assert.deepEqual([first.films, first.bringers, first.from, first.to], [2, 2, day(2), day(5)]);
assert.deepEqual(listRounds([item(1, 3, 'a', { state: 'queued' })], { roundId: 2, status: 'collecting' }), [], 'a round nobody watched is no history');

const round = describeRound(first, ratings, new Map([['a', 'Аня'], ['b', 'Боря']]));
assert.deepEqual(round.films.map(film => [film.kpId, film.average]), [[4, 9], [2, 8]]);
assert.deepEqual(round.films[0].scores.map(entry => [entry.name, entry.score]), [['Боря', 10], ['Аня', 8]]);
assert.deepEqual(round.films[1].scores.map(entry => entry.name).sort(), ['', 'Аня', 'Боря'], 'the name stored with a rating is never shown');
assert.deepEqual(raterIds(ratings), ['a', 'b', 'viewer', 'stranger']);
assert.equal(round.best.kpId, 4);
assert.deepEqual(round.people.map(person => [person.userId, person.average]), [['b', 9], ['a', 8]]);

// One enthusiastic score does not beat the company; with nothing else it still wins.
const solo = { average: 10, scores: [{}], watchedAt: 1 };
const shared = { average: 7, scores: [{}, {}], watchedAt: 2 };
assert.equal(bestFilm([solo, shared]), shared);
assert.equal(bestFilm([solo, { average: null, scores: [], watchedAt: 0 }]), solo);
assert.equal(bestFilm([]), null);

// Taking part means bringing a film or rating one while it was on.
assert.deepEqual(participation(items, 'viewer', [ratings[2]]), { rounds: 1, brought: 0, broughtWatched: 0, watched: 1 });
assert.deepEqual(participation(items, 'c', []), { rounds: 1, brought: 1, broughtWatched: 0, watched: 0 });
assert.equal(participation(items, 'stranger', [ratings[4]]).rounds, 0);
assert.equal(participation(items, 'nobody', []).rounds, 0);
assert.equal(participation(null, '', null).rounds, 0);

const person = summarizePerson(items, 'a', ratings.filter(entry => entry.userId === 'a'), ratings);
assert.deepEqual(person.films.map(film => film.kpId), [10, 2], 'newest first');
assert.equal(person.films[0].average, null);
assert.equal(person.average, 8);
assert.equal(person.best.kpId, 2);
assert.deepEqual([person.rounds, person.brought, person.watched], [2, 2, 2]);

// A score only its own picker gave is shown but says nothing about the company.
const lonely = summarizePerson([item(1, 2, 'a')], 'a', [], [rating('a', 2, 10, 3)]);
assert.equal(lonely.films[0].average, 10);
assert.deepEqual([lonely.average, lonely.best], [null, null]);

assert.deepEqual([...scoreWatched(items, ratings)].map(([kpId, film]) => [kpId, film.average]), [[2, 8], [4, 9], [10, null]]);

// Statistics and achievements share one read; a failure is not remembered.
let reads = 0;
let fail = true;
const db = { collection: () => ({ doc: () => ({ collection: () => ({ get: async () => {
    reads++;
    if (fail) throw new Error('denied');
    return { docs: [{ id: '1_2', data: () => ({ roundId: 1 }) }] };
} }) }) }) };
await assert.rejects(loadMarathonItems(db), /denied/);
fail = false;
assert.deepEqual(await loadMarathonItems(db), [{ id: '1_2', roundId: 1 }]);
await loadMarathonItems(db);
assert.equal(reads, 2);

console.log('Marathon history: rounds, company scores, participation and shared reads passed');
