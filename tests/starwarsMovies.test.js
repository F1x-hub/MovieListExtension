import assert from 'node:assert';
import { isStarWarsMovie } from '../src/shared/config/starwarsMovies.js';

console.log('🧪 Running Star Wars Movies Detection Unit Test...');

// Test 1: Explicit Kinopoisk IDs
assert.strictEqual(isStarWarsMovie({ kinopoiskId: 447 }), true, 'Episode IV KP ID should be Star Wars');
assert.strictEqual(isStarWarsMovie({ kinopoiskId: 1048347 }), true, 'Mandalorian KP ID should be Star Wars');

// Test 2: Title patterns in Russian and English
assert.strictEqual(isStarWarsMovie({ name: 'Звёздные войны: Эпизод 4' }), true, 'Russian title should match');
assert.strictEqual(isStarWarsMovie({ title: 'Star Wars: Ahsoka' }), true, 'English title should match');
assert.strictEqual(isStarWarsMovie({ nameRu: 'Мандалорец' }), true, 'Spin-off title should match');

// Test 3: Non-Star Wars movies
assert.strictEqual(isStarWarsMovie({ name: 'Человек-паук' }), false, 'Spider-Man should not match Star Wars');
assert.strictEqual(isStarWarsMovie({ name: 'Интерстеллар' }), false, 'Interstellar should not match Star Wars');

console.log('✅ All Star Wars movie detection unit tests passed!');
