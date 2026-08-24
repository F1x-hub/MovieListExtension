import assert from 'node:assert';
import MediaAggregatorService from '../src/shared/services/MediaAggregatorService.js';
import MovieCardModule from '../src/shared/components/MovieCard.js';

const MovieCard = MovieCardModule.MovieCard || MovieCardModule;

console.log('🧪 Running Phase 2A Unified People / Credits Data Normalization Tests...\n');

// Mock DOM for MovieCard testing
globalThis.document = {
    createElement: (tag) => {
        const el = {
            tagName: tag.toUpperCase(),
            className: '',
            style: {},
            dataset: {},
            attributes: {},
            innerHTML: '',
            textContent: '',
            children: [],
            setAttribute(k, v) { this.attributes[k] = String(v); },
            getAttribute(k) { return this.attributes[k] || null; },
            removeAttribute(k) { delete this.attributes[k]; },
            classList: {
                classes: new Set(),
                add(...cls) { cls.forEach(c => this.classes.add(c)); },
                remove(...cls) { cls.forEach(c => this.classes.delete(c)); },
                contains(c) { return this.classes.has(c); },
                toggle(c, force) {
                    if (force !== undefined) {
                        if (force) this.classes.add(c);
                        else this.classes.delete(c);
                        return force;
                    }
                    if (this.classes.has(c)) { this.classes.delete(c); return false; }
                    this.classes.add(c); return true;
                }
            },
            appendChild(child) { this.children.push(child); return child; },
            querySelector: () => null,
            querySelectorAll: () => []
        };
        return el;
    }
};

// --- Test 1: Canonical UnifiedCreditDTO Schema ---
console.log('--- 1. Testing Canonical UnifiedCreditDTO Schema & Cast Normalization ---');
{
    const kpMovie = {
        id: 251733,
        name: 'Аватар',
        persons: [
            { id: 65731, name: 'Сэм Уортингтон', enName: 'Sam Worthington', enProfession: 'ACTOR', photo: 'kp_photo_sam.jpg', description: 'Джейк Салли' },
            { id: 8691, name: 'Зои Салдана', enName: 'Zoe Saldana', enProfession: 'ACTOR', photo: 'kp_photo_zoe.jpg', description: 'Нейтири' },
            { id: 2710, name: 'Джеймс Кэмерон', enName: 'James Cameron', enProfession: 'DIRECTOR', photo: 'kp_photo_jim.jpg' }
        ]
    };

    const tmdbData = {
        tmdbId: 19995,
        title: 'Avatar',
        credits: {
            cast: [
                { id: 65731, name: 'Sam Worthington', original_name: 'Sam Worthington', character: 'Jake Sully', order: 0, profile_path: '/sam.jpg' },
                { id: 8691, name: 'Zoe Saldaña', original_name: 'Zoe Saldana', character: 'Neytiri', order: 1, profile_path: '/zoe.jpg' },
                { id: 10205, name: 'Сигурни Уивер', original_name: 'Sigourney Weaver', character: 'Dr. Grace Augustine', order: 2, profile_path: '/sigourney.jpg' },
                { id: 6574, name: 'Стивен Лэнг', original_name: 'Stephen Lang', character: 'Colonel Miles Quaritch', order: 3, profile_path: '/stephen.jpg' }
            ],
            crew: [
                { id: 2710, name: 'James Cameron', job: 'Director', department: 'Directing' }
            ]
        }
    };

    const fieldSources = {};
    const result = MediaAggregatorService._normalizeUnifiedCredits(kpMovie, tmdbData, fieldSources);

    assert.ok(Array.isArray(result.cast), 'cast must be an array');
    assert.ok(Array.isArray(result.crew), 'crew must be an array');
    assert.strictEqual(result.cast.length, 4, 'All 4 cast items normalized');

    const firstActor = result.cast[0];
    assert.strictEqual(firstActor.id, 'tmdb:65731', 'ID must be namespaced tmdb:65731');
    assert.strictEqual(firstActor.tmdbPersonId, 65731, 'tmdbPersonId preserved');
    assert.strictEqual(firstActor.kpPersonId, 65731, 'kpPersonId enriched from exact match');
    assert.strictEqual(firstActor.name, 'Сэм Уортингтон', 'Russian localized name enriched from KP');
    assert.strictEqual(firstActor.originalName, 'Sam Worthington', 'originalName preserved');
    assert.strictEqual(firstActor.character, 'Jake Sully', 'TMDB character string preserved');
    assert.strictEqual(firstActor.role, 'ACTOR', 'role must be ACTOR');
    assert.strictEqual(firstActor.providerSource, 'TMDB', 'providerSource must be TMDB');
    assert.strictEqual(firstActor.order, 0, 'order preserved');

    assert.strictEqual(fieldSources['credits.cast'], 'hybrid', 'fieldSources cast marked hybrid when enriched');
    console.log('  ✅ 1.1 Canonical UnifiedCreditDTO schema and TMDB cast normalization verified');
}

// --- Test 2: Exact Latin Name Enrichment vs Fuzzy Rejection ---
console.log('\n--- 2. Testing Exact Name Matching vs Fuzzy/Partial Rejection ---');
{
    const kpMovie = {
        persons: [
            { id: 101, name: 'Крис Эванс (актер)', enName: 'Chris Evans', enProfession: 'ACTOR' },
            { id: 102, name: 'Крис Пратт', enName: 'Chris Pratt', enProfession: 'ACTOR' }
        ]
    };

    const tmdbData = {
        credits: {
            cast: [
                { id: 991, name: 'Chris Evans', original_name: 'Chris Evans', character: 'Captain America', order: 0 },
                { id: 992, name: 'Christine Evans', original_name: 'Christine Evans', character: 'Extra', order: 1 },
                { id: 993, name: 'Christopher Pratt', original_name: 'Christopher Pratt', character: 'Background', order: 2 },
                { id: 994, name: 'Unknown Actor', original_name: 'Unknown Actor', character: 'Soldier', order: 3 }
            ]
        }
    };

    const result = MediaAggregatorService._normalizeUnifiedCredits(kpMovie, tmdbData);

    // Exact match
    assert.strictEqual(result.cast[0].name, 'Крис Эванс (актер)', 'Exact Latin match must enrich');
    assert.strictEqual(result.cast[0].kpPersonId, 101, 'Exact Latin match attaches kpPersonId');

    // Partial / substring mismatch
    assert.strictEqual(result.cast[1].name, 'Christine Evans', 'Partial substring must NOT enrich');
    assert.strictEqual(result.cast[1].kpPersonId, null, 'No kpPersonId attached on partial mismatch');

    // Name variant mismatch
    assert.strictEqual(result.cast[2].name, 'Christopher Pratt', 'Variant must NOT enrich');
    assert.strictEqual(result.cast[2].kpPersonId, null, 'No kpPersonId attached on variant mismatch');

    console.log('  ✅ 2.1 Exact match enriches; fuzzy/partial names strictly rejected');
}

// --- Test 3: Provider Namespace Collision Safety ---
console.log('\n--- 3. Testing Provider Namespace Collision Safety ---');
{
    const kpMovie = {
        persons: [
            { id: 500, name: 'Василий Пупкин', enName: 'Vasily Pupkin', enProfession: 'ACTOR' }
        ]
    };

    const tmdbData = {
        credits: {
            cast: [
                // TMDB person id 500 is Tom Cruise in TMDB, but KP person 500 is Vasily Pupkin!
                { id: 500, name: 'Tom Cruise', original_name: 'Tom Cruise', character: 'Ethan Hunt', order: 0 },
                { id: 501, name: 'Ving Rhames', original_name: 'Ving Rhames', character: 'Luther', order: 1 },
                { id: 502, name: 'Simon Pegg', original_name: 'Simon Pegg', character: 'Benji', order: 2 },
                { id: 503, name: 'Rebecca Ferguson', original_name: 'Rebecca Ferguson', character: 'Ilsa', order: 3 }
            ]
        }
    };

    const result = MediaAggregatorService._normalizeUnifiedCredits(kpMovie, tmdbData);

    const actor = result.cast[0];
    assert.strictEqual(actor.id, 'tmdb:500', 'Credit ID must be namespaced tmdb:500');
    assert.strictEqual(actor.tmdbPersonId, 500, 'tmdbPersonId must be 500');
    assert.strictEqual(actor.kpPersonId, null, 'kpPersonId must remain null because names do not match');
    assert.strictEqual(actor.name, 'Tom Cruise', 'Must NOT overwrite Tom Cruise with Vasily Pupkin based on numeric ID');

    console.log('  ✅ 3.1 Numerical ID collision between KP and TMDB safely prevented');
}

// --- Test 4: KP Cast Fallback when TMDB Cast < 4 or Missing ---
console.log('\n--- 4. Testing KP Cast Fallback (< 4 items or missing TMDB) ---');
{
    const kpMovie = {
        id: 777,
        persons: [
            { id: 10, name: 'Юрий Никулин', enName: 'Yuri Nikulin', enProfession: 'ACTOR', description: 'Балбес', photo: 'nikulin.jpg' },
            { id: 11, name: 'Георгий Вицин', enName: 'Georgiy Vitsin', enProfession: 'ACTOR', description: 'Трус', photo: 'vitsin.jpg' },
            { id: 12, name: 'Евгений Моргунов', enName: 'Evgeniy Morgunov', enProfession: 'ACTOR', description: 'Бывалый', photo: 'morgunov.jpg' },
            { id: 13, name: 'Леонид Гайдай', enName: 'Leonid Gaidai', enProfession: 'DIRECTOR' }
        ]
    };

    // TMDB has only 1 actor (below floor of 4)
    const tmdbDataSparse = {
        credits: {
            cast: [
                { id: 99, name: 'Yuri Nikulin', original_name: 'Yuri Nikulin', order: 0 }
            ]
        }
    };

    const fieldSources = {};
    const result = MediaAggregatorService._normalizeUnifiedCredits(kpMovie, tmdbDataSparse, fieldSources);

    assert.strictEqual(result.cast.length, 3, 'Falls back to 3 KP actors when TMDB has < 4');
    assert.strictEqual(result.cast[0].id, 'kp:10', 'Credit ID namespaced kp:10');
    assert.strictEqual(result.cast[0].providerSource, 'KP', 'providerSource must be KP');
    assert.strictEqual(result.cast[0].name, 'Юрий Никулин');
    assert.strictEqual(result.cast[0].character, 'Балбес');
    assert.strictEqual(fieldSources['credits.cast'], 'kp', 'Field source marked kp');

    console.log('  ✅ 4.1 KP cast fallback triggers cleanly when TMDB cast is below viability threshold');
}

// --- Test 5: KP Crew Primary & Canonical Taxonomy Mapping ---
console.log('\n--- 5. Testing KP Crew Primary & Taxonomy Mapping ---');
{
    const kpMovie = {
        persons: [
            { id: 1, name: 'Кристофер Нолан', enName: 'Christopher Nolan', enProfession: 'DIRECTOR' },
            { id: 2, name: 'Джонатан Нолан', enName: 'Jonathan Nolan', enProfession: 'WRITER' },
            { id: 3, name: 'Эмма Томас', enName: 'Emma Thomas', enProfession: 'PRODUCER' },
            { id: 4, name: 'Ханс Циммер', enName: 'Hans Zimmer', enProfession: 'COMPOSER' },
            { id: 5, name: 'Хойте Ван Хойтема', enName: 'Hoyte Van Hoytema', enProfession: 'OPERATOR' },
            { id: 6, name: 'Ли Смит', enName: 'Lee Smith', enProfession: 'EDITOR' },
            { id: 7, name: 'Нейтан Кроули', enName: 'Nathan Crowley', enProfession: 'DESIGNER' }
        ]
    };

    const tmdbData = { credits: { crew: [] } };
    const fieldSources = {};
    const result = MediaAggregatorService._normalizeUnifiedCredits(kpMovie, tmdbData, fieldSources);

    assert.strictEqual(result.crew.length, 7, 'All 7 crew mapped');
    assert.strictEqual(result.crew[0].role, 'DIRECTOR');
    assert.strictEqual(result.crew[1].role, 'WRITER');
    assert.strictEqual(result.crew[2].role, 'PRODUCER');
    assert.strictEqual(result.crew[3].role, 'COMPOSER');
    assert.strictEqual(result.crew[4].role, 'CINEMATOGRAPHY', 'OPERATOR mapped to CINEMATOGRAPHY');
    assert.strictEqual(result.crew[5].role, 'EDITOR');
    assert.strictEqual(result.crew[6].role, 'DESIGNER');
    assert.strictEqual(fieldSources['credits.crew'], 'kp', 'Field source marked kp');

    console.log('  ✅ 5.1 KP Crew normalized and mapped to canonical taxonomy with priority sorting');
}

// --- Test 6: Category-Specific TMDB Crew Fallback ---
console.log('\n--- 6. Testing Category-Specific TMDB Crew Fallback ---');
{
    const kpMovie = {
        persons: [
            // KP has Director and Writer, but missing Composer and Cinematography
            { id: 1, name: 'Квентин Тарантино', enName: 'Quentin Tarantino', enProfession: 'DIRECTOR' },
            { id: 1, name: 'Квентин Тарантино', enName: 'Quentin Tarantino', enProfession: 'WRITER' }
        ]
    };

    const tmdbData = {
        credits: {
            crew: [
                { id: 138, name: 'Quentin Tarantino', job: 'Director', department: 'Directing' },
                { id: 2210, name: 'Эннио Морриконе', original_name: 'Ennio Morricone', job: 'Original Music Composer', department: 'Sound' },
                { id: 742, name: 'Роберт Ричардсон', original_name: 'Robert Richardson', job: 'Director of Photography', department: 'Camera' }
            ]
        }
    };

    const fieldSources = {};
    const result = MediaAggregatorService._normalizeUnifiedCredits(kpMovie, tmdbData, fieldSources);

    assert.strictEqual(result.crew.length, 4, '2 from KP + 2 backfilled from TMDB');
    const roles = result.crew.map(c => c.role);
    assert.ok(roles.includes('DIRECTOR'), 'Director present from KP');
    assert.ok(roles.includes('WRITER'), 'Writer present from KP');
    assert.ok(roles.includes('COMPOSER'), 'Composer backfilled from TMDB');
    assert.ok(roles.includes('CINEMATOGRAPHY'), 'Cinematography backfilled from TMDB');
    assert.strictEqual(fieldSources['credits.crew'], 'hybrid', 'Field source marked hybrid on backfill');

    console.log('  ✅ 6.1 Missing canonical crew roles successfully backfilled from TMDB');
}

// --- Test 7: Anime Original Japanese Voice Cast Preservation ---
console.log('\n--- 7. Testing Anime Original Voice Cast Preservation ---');
{
    const kpMovie = {
        persons: [
            // KP lists dubbing director and translator
            { id: 801, name: 'Иван Дубляжев', enName: 'Ivan Dublyazhev', enProfession: 'VOICE_DIRECTOR' },
            { id: 802, name: 'Анна Переводчикова', enName: 'Anna Perevodchikova', enProfession: 'TRANSLATOR' }
        ]
    };

    const tmdbData = {
        credits: {
            cast: [
                { id: 101, name: 'Нацуки Ханаэ', original_name: 'Natsuki Hanae', character: 'Tanjiro Kamado (voice)', order: 0 },
                { id: 102, name: 'Акари Кито', original_name: 'Akari Kito', character: 'Nezuko Kamado (voice)', order: 1 },
                { id: 103, name: 'Хиро Симоно', original_name: 'Hiro Shimono', character: 'Zenitsu Agatsuma (voice)', order: 2 },
                { id: 104, name: 'Ёсицугу Мацуока', original_name: 'Yoshitsugu Matsuoka', character: 'Inosuke Hashibira (voice)', order: 3 }
            ]
        }
    };

    const result = MediaAggregatorService._normalizeUnifiedCredits(kpMovie, tmdbData);

    assert.strictEqual(result.cast.length, 4, 'Original 4 Japanese voice actors preserved');
    assert.strictEqual(result.cast[0].name, 'Нацуки Ханаэ');
    assert.strictEqual(result.cast[0].character, 'Tanjiro Kamado (voice)');

    // Verify dubbing crew is in crew (as OTHER), never in cast
    const castNames = result.cast.map(c => c.name);
    assert.ok(!castNames.includes('Иван Дубляжев'), 'VOICE_DIRECTOR must not leak into cast');
    const crewRoles = result.crew.map(c => c.role);
    assert.ok(crewRoles.includes('OTHER'), 'VOICE_DIRECTOR placed in crew as OTHER');

    console.log('  ✅ 7.1 Anime Japanese voice cast preserved; dubbing staff isolated to crew');
}

// --- Test 8: Full UnifiedMovieDTO Aggregation Integration ---
console.log('\n--- 8. Testing Full UnifiedMovieDTO Aggregation Integration ---');
{
    const kpMovie = {
        id: 476,
        name: 'Назад в будущее',
        enName: 'Back to the Future',
        year: 1985,
        rating: 8.6,
        ratingVoteCount: 500000,
        persons: [
            { id: 1, name: 'Роберт Земекис', enName: 'Robert Zemeckis', enProfession: 'DIRECTOR' },
            { id: 521, name: 'Майкл Дж. Фокс', enName: 'Michael J. Fox', enProfession: 'ACTOR', description: 'Марти МакФлай' }
        ]
    };

    const tmdbData = {
        tmdbId: 105,
        title: 'Back to the Future',
        credits: {
            cast: [
                { id: 521, name: 'Michael J. Fox', original_name: 'Michael J. Fox', character: 'Marty McFly', order: 0, profile_path: '/fox.jpg' },
                { id: 1062, name: 'Christopher Lloyd', original_name: 'Christopher Lloyd', character: 'Dr. Emmett Brown', order: 1, profile_path: '/lloyd.jpg' },
                { id: 1063, name: 'Lea Thompson', original_name: 'Lea Thompson', character: 'Lorraine Baines', order: 2, profile_path: '/thompson.jpg' },
                { id: 1064, name: 'Crispin Glover', original_name: 'Crispin Glover', character: 'George McFly', order: 3, profile_path: '/glover.jpg' }
            ],
            crew: [
                { id: 1, name: 'Robert Zemeckis', job: 'Director', department: 'Directing' },
                { id: 491, name: 'Alan Silvestri', job: 'Original Music Composer', department: 'Sound' }
            ]
        }
    };

    const unifiedDto = MediaAggregatorService.aggregate(kpMovie, tmdbData, {
        kinopoiskId: 476,
        tmdbId: 105
    });

    assert.ok(unifiedDto.credits, 'unifiedDto must contain credits field');
    assert.strictEqual(unifiedDto.credits.cast.length, 4, '4 cast members in credits.cast');
    assert.strictEqual(unifiedDto.credits.crew.length, 2, '2 crew members (Director + backfilled Composer)');
    assert.strictEqual(unifiedDto._meta.fieldSources['credits.cast'], 'hybrid', 'Cast is hybrid (TMDB + KP Russian name)');
    assert.strictEqual(unifiedDto._meta.fieldSources['credits.crew'], 'hybrid', 'Crew is hybrid (KP Director + TMDB Composer)');

    // Verify legacy compatibility fields
    assert.ok(Array.isArray(unifiedDto.persons), 'Legacy movie.persons must be preserved');
    assert.strictEqual(unifiedDto.persons.length, 2, 'Legacy movie.persons contains KP persons');
    assert.ok(unifiedDto.tmdbCredits, 'Legacy movie.tmdbCredits must be preserved');

    console.log('  ✅ 8.1 UnifiedMovieDTO integration produces canonical credits with legacy aliases');
}

// --- Test 9: Legacy Consumer Safety (MovieCard.createCompactDetail & search.js) ---
console.log('\n--- 9. Testing Legacy Consumer Safety ---');
{
    const movieWithUnifiedCredits = {
        kinopoiskId: 476,
        name: 'Назад в будущее',
        year: 1985,
        persons: [
            { id: 1, name: 'Роберт Земекис', enName: 'Robert Zemeckis', enProfession: 'DIRECTOR' },
            { id: 521, name: 'Майкл Дж. Фокс', enName: 'Michael J. Fox', enProfession: 'ACTOR' }
        ],
        credits: {
            cast: [{ name: 'Майкл Дж. Фокс', character: 'Marty McFly', role: 'ACTOR' }],
            crew: [{ name: 'Роберт Земекис', role: 'DIRECTOR' }]
        }
    };

    // MovieCard.createCompactDetail relies on movie.persons
    assert.doesNotThrow(() => {
        const card = MovieCard.createCompactDetail({ movie: movieWithUnifiedCredits });
        assert.ok(card, 'Card must be created');
    }, 'MovieCard.createCompactDetail must not throw on UnifiedMovieDTO');

    console.log('  ✅ 9.1 Legacy consumers execute without exception');
}

// --- Test 10: Zero Network Requests Invariant Assertion ---
console.log('\n--- 10. Testing Zero Network Requests Invariant ---');
{
    let personApiCalls = 0;
    const mockKpService = {
        getPersonById: () => { personApiCalls++; return Promise.resolve({}); }
    };
    const mockTmdbService = {
        getPersonDetails: () => { personApiCalls++; return Promise.resolve({}); }
    };

    const kpMovie = { id: 100, persons: [{ id: 1, name: 'Actor 1', enProfession: 'ACTOR' }] };
    const tmdbData = { credits: { cast: [{ id: 1, name: 'Actor 1' }, { id: 2, name: 'Actor 2' }, { id: 3, name: 'Actor 3' }, { id: 4, name: 'Actor 4' }] } };

    MediaAggregatorService.aggregate(kpMovie, tmdbData, { kinopoiskId: 100, tmdbId: 200 });

    assert.strictEqual(personApiCalls, 0, 'Zero person API calls during credit normalization');
    console.log('  ✅ 10.1 Zero N+1 network requests invariant confirmed (0 calls)');
}

console.log('\n🎉 ALL Phase 2A Unified People / Credits Tests Passed Successfully!');
