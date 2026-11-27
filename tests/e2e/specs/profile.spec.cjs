/**
 * The profile as its owner, another user and a newcomer see it: the ratings
 * calendar works with pointer and keyboard, the score filter sits beside the
 * list it filters, and the statistics tab reads its data only when opened.
 */
const { test, expect: baseExpect, emulator, setTheme, waitForStillness } = require('../lib/fixtures.cjs');
const { SECTIONS } = require('../lib/catalog.cjs');
const config = require('../lib/config.cjs');

// Soft, so one run reports everything that is wrong with the page.
const expect = baseExpect.configure({ soft: true, timeout: 8000 });
const PROFILE = 'src/pages/profile/profile.html';
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(config.PINNED_DATE).getTime();
const OTHER_UID = 'e2e-user-2';
const FILMS = [...SECTIONS.films, ...SECTIONS.series, ...SECTIONS.cartoons];
// The other user shares the first films, with close scores, so a taste match exists.
const scoreOf = index => [9, 8, 8, 7, 10, 6, 8, 5][index % 8];

async function seedRatings(uid, count) {
    for (let index = 0; index < count; index++) {
        const film = FILMS[index];
        await emulator.putDocument(`ratings/${uid}_${film.id}`, {
            userId: uid,
            movieId: film.id,
            rating: scoreOf(index),
            comment: index === 0 ? 'Отлично' : '',
            movieTitle: film.title || film.name,
            // Two ratings on every second day: the calendar gets days of both kinds.
            createdAt: new Date(NOW - Math.floor(index / 2) * 2 * DAY)
        });
        await emulator.putDocument(`movies/${film.id}`, {
            kinopoiskId: film.id,
            name: film.title || film.name,
            year: 1975 + index,
            movieLength: 120,
            hasCommunityRating: true,
            posterUrl: `https://image.tmdb.org/t/p/w342${film.poster_path}`,
            genres: [{ name: index % 3 ? 'драма' : 'фантастика' }],
            persons: [
                { id: 1, name: 'Анна Вымышленная', enProfession: 'actor', photo: `https://image.tmdb.org/t/p/w342${FILMS[0].poster_path}` },
                // Nine films rated 8+ among the first fourteen: a second, short row of posters.
                ...(index < 14 ? [{ id: 4, name: 'Вера Выдуманная', enProfession: 'actor', photo: `https://image.tmdb.org/t/p/w342${FILMS[1].poster_path}` }] : []),
                { id: 2 + (index % 2), name: index % 2 ? 'Пётр Ненастоящий' : 'Олег Придуманный', enProfession: 'director' }
            ]
        });
    }
}

async function open(page, extension, theme, search = '') {
    await page.evaluate(uid => {
        // The background achievement sync reads the same collections as the statistics tab.
        localStorage.setItem(`achievementsSyncedAt_${uid}`, String(Date.now()));
        return chrome.storage.sync.set({ language: 'ru' });
    }, extension.user.uid);
    await setTheme(page, theme);
    await page.goto(extension.url(PROFILE + search));
    await baseExpect(page.locator('#profileContent')).toBeVisible();
}

const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

for (const theme of ['dark', 'light']) {
    test(`the owner's profile: calendar, filter and statistics (${theme})`, async ({ page, extension }, testInfo) => {
        await seedRatings(extension.user.uid, 24);
        const reads = [];
        extension.context.on('request', request => {
            const body = request.postData() || '';
            if (/commentReactionSummaries|randomMarathons/.test(decodeURIComponent(body))) reads.push(body);
        });
        await open(page, extension, theme);
        const grid = page.locator('.activity-calendar__grid');
        await baseExpect(grid).toBeVisible();
        await waitForStillness(page);
        await page.screenshot({ path: testInfo.outputPath(`overview-${theme}.png`), fullPage: true });

        await test.step('the header carries the numbers', async () => {
            await expect(page.locator('#statTotalRatings')).toHaveText('24');
            await expect(page.locator('[data-stat="ratings"] .profile-fact__label')).toHaveText('оценки');
            await expect(page.locator('#statWatchTime')).toHaveText('48 ч');
        });

        await test.step('cells are readable squares and every shade stands out from the page', async () => {
            const cell = await grid.locator('[data-level="2"]').first().evaluate(element => {
                const style = getComputedStyle(element);
                return { width: element.getBoundingClientRect().width, radius: parseFloat(style.borderTopLeftRadius.match(/[0-9.]+(?=px)/)[0]) };
            });
            expect(cell.width).toBeGreaterThan(14);
            expect(cell.radius).toBeLessThanOrEqual(4);
            const ratios = await page.evaluate(() => {
                const canvas = document.createElement('canvas').getContext('2d');
                const channels = color => {
                    canvas.clearRect(0, 0, 1, 1);
                    canvas.fillStyle = color;
                    canvas.fillRect(0, 0, 1, 1);
                    return [...canvas.getImageData(0, 0, 1, 1).data].slice(0, 3);
                };
                const luminance = color => {
                    const [r, g, b] = channels(color).map(value => (value / 255 <= 0.04045 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4));
                    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
                };
                const root = document.querySelector('.profile-activity');
                const probe = document.createElement('i');
                root.append(probe);
                const pageColor = luminance(getComputedStyle(document.querySelector('.profile-main')).backgroundColor);
                const result = [1, 2, 3, 4].map(level => {
                    probe.className = 'activity-cell';
                    probe.dataset.level = level;
                    const value = luminance(getComputedStyle(probe).backgroundColor);
                    return (Math.max(value, pageColor) + 0.05) / (Math.min(value, pageColor) + 0.05);
                });
                probe.remove();
                return result;
            });
            for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(3);
        });

        await test.step('pointer: every point of the grid belongs to a day', async () => {
            await page.locator('.activity-day').scrollIntoViewIfNeeded();
            const box = await grid.boundingBox();
            for (const [x, y] of [[0.3, 0.1], [0.5, 0.5], [0.71, 0.93], [0.9, 0.3]]) {
                await page.mouse.move(box.x + box.width * x, box.y + box.height * y);
                await expect(page.locator('.activity-tooltip')).toBeVisible();
            }
            const misplaced = await grid.evaluate(element => [...element.querySelectorAll('[data-day]')].filter(cell => {
                const rect = cell.getBoundingClientRect();
                element.dispatchEvent(new MouseEvent('click', { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }));
                return cell.getAttribute('aria-selected') !== 'true';
            }).length);
            expect(misplaced).toBe(0);
        });

        await test.step('the chosen day lists its films, and the buttons walk the rated days', async () => {
            await grid.evaluate(element => [...element.querySelectorAll('[data-level="2"]')]
                .sort((a, b) => b.dataset.day - a.dataset.day)[0].setAttribute('data-e2e-latest', ''));
            await grid.locator('[data-e2e-latest]').click();
            await expect(page.locator('.activity-day__film')).toHaveCount(2);
            await expect(page.locator('.activity-day__count')).toHaveText('2 оценки');
            await expect(page.locator('[data-step="1"]')).toBeDisabled();
            const date = await page.locator('.activity-day__date').textContent();
            await page.locator('[data-step="-1"]').click();
            await expect(page.locator('.activity-day__film')).toHaveCount(2);
            expect(await page.locator('.activity-day__date').textContent()).not.toBe(date);
        });

        await test.step('keyboard: one tab stop, arrows move, the edge keeps native scrolling', async () => {
            await expect(grid.locator('[tabindex="0"]')).toHaveCount(1);
            await grid.locator('[tabindex="0"]').focus();
            const before = await page.locator('.activity-day__date').textContent();
            await page.keyboard.press('ArrowLeft');
            expect(await page.locator('.activity-day__date').textContent()).not.toBe(before);
            await page.keyboard.press('Home');
            expect(await page.evaluate(() => document.activeElement.dataset.day)).toBe('0');
            await page.keyboard.press('ArrowLeft');
            expect(await page.evaluate(() => document.activeElement.dataset.day)).toBe('0');
            await page.keyboard.press('End');
            await expect(grid.locator('[tabindex="0"]')).toHaveCount(1);
        });

        await test.step('the score filter is beside its list and says what it shows', async () => {
            const filter = page.locator('.rating-distribution__row[data-rating="8"]');
            await filter.scrollIntoViewIfNeeded();
            const list = await page.locator('#recentRatingsList').boundingBox();
            const row = await filter.boundingBox();
            expect(Math.abs(row.y - list.y)).toBeLessThan(400);
            expect(row.x).toBeLessThan(list.x);
            await filter.click();
            await expect(page.locator('#ratingFilterStatus')).toHaveText('Оценка 8: 9');
            await expect(page.locator('.recent-rating-card')).toHaveCount(9);
            await page.locator('#ratingFilterReset').click();
            await expect(page.locator('#ratingFilterReset')).toBeHidden();
            await expect(filter).toBeFocused();
            // Bars are proportional: the same count has the same length, a smaller one is shorter.
            const widths = await page.locator('.rating-distribution__row').evaluateAll(rows => rows.map(element => [
                Number(element.querySelector('.rating-distribution__count').textContent),
                parseFloat(element.querySelector('i').style.width)
            ]));
            for (const [count, width] of widths) expect(width).toBeCloseTo((count / 9) * 100, 3);
        });

        await test.step('the search reaches every rating and works together with the score', async () => {
            const input = page.locator('#ratingSearch');
            const query = (FILMS[20].title || FILMS[20].name).slice(0, 8);
            const expected = FILMS.slice(0, 24).filter(film => (film.title || film.name).toLowerCase().includes(query.toLowerCase())).length;
            await input.fill(query.toUpperCase());
            await expect(page.locator('#ratingFilterStatus')).toHaveText(`Найдено: ${expected}`);
            await expect(page.locator('.recent-rating-card')).toHaveCount(expected);
            await expect(page.locator('.recent-rating-card mark').first()).toBeVisible();
            expect(await page.locator('.rating-distribution__count').evaluateAll(items => items.reduce((sum, item) => sum + Number(item.textContent), 0))).toBe(expected);
            const row = page.locator(`.rating-distribution__row[data-rating="${scoreOf(20)}"]`);
            await row.click();
            await expect(row).toBeFocused();
            await expect(page.locator('#ratingFilterStatus')).toContainText(`Оценка ${scoreOf(20)}, найдено: `);
            await page.screenshot({ path: testInfo.outputPath(`search-${theme}.png`), fullPage: true });
            await row.click();
            await input.fill('нет такого фильма');
            await expect(page.locator('.recent-ratings-empty')).toHaveText('По запросу «нет такого фильма» ничего не найдено.');
            await expect(page.locator('.rating-distribution__row:disabled')).toHaveCount(10);
            await page.locator('#ratingSearchClear').click();
            await expect(input).toBeFocused();
            await expect(page.locator('#ratingSearchClear')).toBeHidden();
            await expect(page.locator('.recent-rating-card')).toHaveCount(10);
            // The field starts where the list does, beside the score filter.
            const field = await input.boundingBox();
            const list = await page.locator('#recentRatingsList').boundingBox();
            const bars = await page.locator('#ratingDistribution').boundingBox();
            expect(field.x).toBeCloseTo(list.x, 0);
            expect(Math.abs(field.y - bars.y)).toBeLessThan(2);
        });

        await test.step('statistics read reactions and marathons only when opened', async () => {
            expect(reads).toHaveLength(0);
            await page.locator('#profileTabStatisticsBtn').click();
            // The countries section lists its countries in the same rows: count the genres only.
            await expect(page.locator('.insight-taste .insight-genres__row')).toHaveCount(2);
            await expect(page.locator('.insight-decades__item')).toHaveCount(3);
            await expect(page.locator('.insight-person')).toHaveCount(4);
            await expect.poll(() => reads.length).toBeGreaterThan(0);
            await expect(page.locator('#profileInsights .app-loader')).toHaveCount(0);
            // A portrait keeps its whole picture inside its frame.
            const frames = await page.locator('.insight-person__photo').evaluateAll(items => items.map(item => [item.offsetWidth, item.offsetHeight, item.scrollHeight]));
            for (const [width, height, content] of frames) {
                expect(height / width).toBeCloseTo(1.5, 1);
                expect(content).toBeLessThanOrEqual(height);
            }
            await page.screenshot({ path: testInfo.outputPath(`statistics-${theme}.png`), fullPage: true });

            // A genre and a decade show their films in one panel under both charts.
            const taste = page.locator('#insightTasteFilms');
            const genre = page.locator('.insight-taste .insight-genres__row').first();
            await expect(taste).toBeHidden();
            await genre.click();
            await waitForStillness(page);
            await expect(genre).toHaveAttribute('aria-expanded', 'true');
            await expect(taste.locator('.insight-films__name')).toHaveText(await genre.locator('.insight-genres__name').textContent());
            await expect(taste.locator('.insight-films__note')).toHaveText(/^16 фильмов, в среднем \d,\d$/);
            await expect(taste.locator('.insight-films__grid > li:visible')).toHaveCount(14);
            await expect(taste.locator('[data-only]')).toHaveCount(10);
            await expect(taste.locator('.insight-films__link')).toHaveAttribute('href', /catalog\.html\?category=films&genre=\d+$/);
            await page.screenshot({ path: testInfo.outputPath(`statistics-genre-${theme}.png`), fullPage: true });
            await taste.locator('[data-films-more]').click();
            await expect(taste.locator('.insight-films__grid > li:visible')).toHaveCount(16);
            await expect(taste.locator('.insight-films__grid > li').nth(14).locator('a')).toBeFocused();
            await taste.locator('[data-films-less]').click();
            await expect(taste.locator('.insight-films__grid > li:visible')).toHaveCount(14);
            // One score, then all of them again.
            const eights = taste.locator('[data-only="8"]');
            const count = Number(await eights.locator('span').first().innerText());
            await eights.click();
            await expect(taste.locator('.insight-films__grid > li:visible')).toHaveCount(count);
            expect(new Set(await taste.locator('.insight-films__score b').allInnerTexts())).toEqual(new Set(['8']));
            await taste.locator('.insight-strip__reset').click();
            await expect(eights).toBeFocused();
            await expect(taste.locator('.insight-strip__reset')).toBeHidden();
            // The order is the shared list control; its Escape closes the list, not the panel.
            const order = taste.locator('.sort-control__trigger');
            await order.click();
            await page.keyboard.press('Escape');
            await expect(taste).toBeVisible();
            await order.click();
            await page.getByRole('option', { name: 'Сначала худшие' }).click();
            const worst = (await taste.locator('.insight-films__score b').allInnerTexts()).map(Number);
            expect(worst).toEqual([...worst].sort((a, b) => a - b));
            // A decade takes the panel over; a year narrows the whole story.
            const decade = page.locator('.insight-decades__button[data-value="1980"]');
            await decade.click();
            await waitForStillness(page);
            await expect(page.locator('.insight-taste__groups [data-taste][aria-expanded="true"]')).toHaveCount(1);
            await expect(page.locator('.sort-control__list')).toHaveCount(1);
            await expect(taste.locator('.insight-films__name')).toHaveText('1980-е');
            await expect(taste.locator('.insight-films__grid > li:visible')).toHaveCount(10);
            const offset = await decade.evaluate(button => {
                const box = button.getBoundingClientRect();
                const films = document.querySelector('#insightTasteFilms');
                const left = parseFloat(getComputedStyle(films, '::before').left) + films.parentElement.getBoundingClientRect().left + 6;
                return Math.abs(left - (box.left + box.width / 2));
            });
            expect(offset).toBeLessThan(2);
            await taste.locator('[data-only="1983"]').click();
            await expect(taste.locator('.insight-films__name')).toHaveText('1983 год');
            await expect(taste.locator('.insight-films__note')).toHaveText('1 фильм');
            await expect(taste.locator('.insight-films__link')).toHaveAttribute('href', /yearFrom=1983&yearTo=1983$/);
            await page.screenshot({ path: testInfo.outputPath(`statistics-year-${theme}.png`), fullPage: true });
            await page.keyboard.press('Escape');
            await expect(taste).toBeHidden();
            await expect(decade).toBeFocused();
            await decade.click();
            await decade.click();
            await expect(taste).toBeHidden();
            // Left open, so the narrow windows below are checked with it.
            await genre.click();

            // A person shows the films behind their number; one panel serves everyone.
            const people = page.locator('.insight-person');
            const panel = page.locator('#insightFilms');
            await expect(panel).toBeHidden();
            for (const index of [0, 1]) {
                const person = people.nth(index);
                const count = await person.locator('.insight-person__count').innerText();
                await person.click();
                await waitForStillness(page);
                await expect(person).toHaveAttribute('aria-expanded', 'true');
                await expect(page.locator('.insight-person[aria-expanded="true"]')).toHaveCount(1);
                await expect(panel.locator('.insight-films__name')).toHaveText(await person.locator('.insight-person__name').innerText());
                await expect(panel.locator('.insight-films__note')).toContainText(`${count} с оценкой 8 и выше, в среднем`);
                await expect(panel.locator('.insight-films__grid > li')).toHaveCount(parseInt(count, 10));
                await expect(panel.locator('.insight-films__grid > li:visible')).toHaveCount(Math.min(parseInt(count, 10), 14));
                const scores = await panel.locator('.insight-films__score b').allInnerTexts();
                expect(scores.map(Number)).toEqual(scores.map(Number).sort((a, b) => b - a));
                // The pointer stands under the chosen photo.
                const offset = await person.locator('.insight-person__photo').evaluate(photo => {
                    const box = photo.getBoundingClientRect();
                    const films = document.querySelector('#insightFilms');
                    const left = parseFloat(getComputedStyle(films, '::before').left) + films.parentElement.getBoundingClientRect().left + 6;
                    return Math.abs(left - (box.left + box.width / 2));
                });
                expect(offset).toBeLessThan(2);
                await page.screenshot({ path: testInfo.outputPath(`statistics-films-${index}-${theme}.png`), fullPage: true });
            }
            await expect(panel.locator('.insight-films__link')).toHaveAttribute('href', /personKey=kp:\d+$/);
            await people.nth(1).click();
            await expect(panel).toBeHidden();
            await expect(page.locator('.insight-person[aria-expanded="true"]')).toHaveCount(0);
            // The rest of a long list opens in place, and focus moves to the first film it adds.
            await people.nth(0).click();
            await panel.locator('.insight-films__grid + .insight-films__more').click();
            await expect(panel.locator('.insight-films__grid > li:visible')).toHaveCount(15);
            await expect(panel.locator('.insight-films__grid > li').nth(14).locator('a')).toBeFocused();
            await expect(panel.locator('.insight-films__grid + .insight-films__more')).toHaveCount(0);
            // Left open, so the narrow windows below are checked with it.

            expect(new URL(page.url()).searchParams.get('tab')).toBe('statistics');
            await expect(page.locator('#profileTabOverview')).toBeHidden();
            await expect(page.locator('#profileTabAchievements')).toBeHidden();
        });

        await test.step('nothing overflows on narrow windows', async () => {
            for (const width of [1024, 768, 390]) {
                await page.setViewportSize({ width, height: 900 });
                for (const tab of ['statistics', 'overview']) {
                    await page.locator(`[data-profile-tab="${tab}"]`).click();
                    expect(await overflow(page), `${tab} at ${width}px`).toBeLessThanOrEqual(0);
                    if (tab === 'statistics') await page.screenshot({ path: testInfo.outputPath(`statistics-${theme}-${width}.png`), fullPage: true });
                }
                const size = await grid.locator('[data-day]:visible').first().evaluate(element => element.getBoundingClientRect().width);
                expect(size, `cell at ${width}px`).toBeGreaterThan(10);
                await page.screenshot({ path: testInfo.outputPath(`overview-${theme}-${width}.png`), fullPage: true });
            }
        });
    });
}

test('another profile starts with the taste match and has no links to the viewer\'s lists', async ({ page, extension }, testInfo) => {
    await emulator.putDocument(`users/${OTHER_UID}`, { displayName: 'Второй Зритель', username: 'second', displayNameFormat: 'username', approvalStatus: 'approved', isAdmin: false, createdAt: new Date('2025-10-15T12:00:00Z') });
    await seedRatings(extension.user.uid, 10);
    await seedRatings(OTHER_UID, 14);
    await open(page, extension, 'dark', `?userId=${OTHER_UID}`);
    await expect(page.locator('.profile-match__value')).toHaveText('100%');
    await expect(page.locator('#profileMatch .insight-poster')).toHaveCount(6);
    await expect(page.locator('#continueWatchingSection')).toBeHidden();
    await expect(page.locator('#profileMenu')).toBeHidden();
    await expect(page.locator('#profileStats [href]')).toHaveCount(0);
    // Another person's ratings are searched as well, with words that are theirs.
    await expect(page.locator('#ratingSearch')).toHaveAttribute('placeholder', 'Найти фильм в оценках этого пользователя');
    const title = FILMS[12].title || FILMS[12].name;
    await page.locator('#ratingSearch').fill(title);
    await expect(page.locator(`.recent-rating-card[data-movie-id="${FILMS[12].id}"]`)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.recent-rating-card')).toHaveCount(10);
    await expect(page.locator('#joinDateText')).toHaveText('Участник с октября 2025');
    await waitForStillness(page);
    await page.screenshot({ path: testInfo.outputPath('other.png'), fullPage: true });
});

test('a profile without ratings shows one next step', async ({ page, extension }, testInfo) => {
    await open(page, extension, 'dark');
    await expect(page.locator('#profileStart')).toBeVisible();
    await expect(page.locator('#profileStart a')).toHaveCount(2);
    for (const hidden of ['#profileStats', '#profileFavorites', '#profileActivity', '#profileAchievements', '#recentRatingsSection', '#continueWatchingSection']) {
        await expect(page.locator(hidden)).toBeHidden();
    }
    await page.locator('#profileTabStatisticsBtn').click();
    await expect(page.locator('#profileInsights')).toContainText('Статистика появится после первых оценок');
    await page.screenshot({ path: testInfo.outputPath('empty.png'), fullPage: true });
});

/** Moves the hand over the cat's head: `passes` strokes, one per direction. */
async function pet(page, passes, { stepMs = 22, reach = 0.15, samples = 14 } = {}) {
    const stage = await page.locator('.cat-den__stage').boundingBox();
    const at = share => stage.x + stage.width * (0.5 + share);
    const y = stage.y + stage.height * 0.36;
    for (let pass = 0; pass < passes; pass++) {
        const [from, to] = pass % 2 ? [reach, -reach] : [-reach, reach];
        for (let index = 0; index <= samples; index++) {
            await page.mouse.move(at(from + (to - from) * index / samples), y);
            if (stepMs) await page.waitForTimeout(stepMs);
        }
    }
}

for (const theme of ['dark', 'light']) {
    test(`the cat trail: call, box, petting and the frame (${theme})`, async ({ page, extension }, testInfo) => {
        const { uid } = extension.user;
        const user = async () => (await emulator.listDocuments('users')).find(item => item.id === uid);
        const trail = async () => (await user())?.achievements?.cat_trail;
        const shot = name => page.screenshot({ path: testInfo.outputPath(`cat-${theme}-${name}.png`) });
        const den = page.locator('.cat-den');
        const stage = page.locator('.cat-den__stage');
        const title = page.locator('.cat-den__title');
        const frame = page.locator('#profileRankFrame');
        const label = page.locator('#achFrameName');
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));

        await test.step('a silhouette stands first in the picker and opens the den', async () => {
            await open(page, extension, theme, '?tab=achievements');
            await expect(label).toHaveText('Без рамки');
            await page.locator('#achFramePrev').click();
            await expect(page.locator('#achFramePrev')).toBeDisabled();
            await expect(label).toHaveText('Там кто-то есть');
            await expect(frame).toBeHidden();
            expect((await user()).rankFrameLevel).toBeUndefined();
            await page.locator('.cat-peek').scrollIntoViewIfNeeded();
            await page.waitForTimeout(500);
            await shot('picker-0');
            await page.locator('.cat-peek').click();
            await expect(title).toHaveText('Там кто-то есть');
            await expect(stage).toHaveAttribute('data-step', '0');
            await expect(page.locator('.cat-paw.is-passed')).toHaveCount(0);
            await page.waitForTimeout(900);
            await shot('step-0');
            await page.keyboard.press('Escape');
            await expect(den).toHaveCount(0);
            await expect(page.locator('.cat-peek')).toBeFocused();
        });

        await test.step('«мяу» in a review opens the eyes', async () => {
            await emulator.putDocument(`ratings/${uid}_${FILMS[0].id}`, { userId: uid, movieId: FILMS[0].id, rating: 8, comment: 'Ну мяу же!', movieTitle: FILMS[0].title || FILMS[0].name, createdAt: new Date(NOW) });
            // Not open(): setting the theme loads the page once more, and the step is announced only once.
            await page.reload();
            await expect(page.locator('.utils-toast').filter({ hasText: 'открыл глаза' })).toBeVisible();
            expect((await trail()).steps).toBe(1);
            const card = page.locator('[data-id="cat_trail"]');
            await expect(card).toContainText('Он вас услышал');
            await card.scrollIntoViewIfNeeded();
            await expect(card.locator('.ach-card__eyes')).toBeVisible();
            await shot('card-1');
            await card.click();
            // The step plays out: the den opens as it was left.
            await expect(stage).toHaveAttribute('data-step', '0');
            await expect(stage).toHaveAttribute('data-step', '1');
            await expect(page.locator('.cat-paw.is-passed')).toHaveCount(1);
            await page.waitForTimeout(3200);
            await shot('step-1');
            // A hand over it: the lids close, but the cat and its lashes stay in sight and the dialog does not jump.
            const size = () => den.evaluate(dialog => [dialog.offsetTop, dialog.offsetHeight]);
            const before = await size();
            await page.mouse.move(0, 0);
            await pet(page, 1);
            await expect(stage).toHaveClass(/is-shy/);
            await expect(page.locator('.cat-den__hint')).toHaveText('Зажмурился. Значит, ещё рано.');
            const lid = side => page.locator(`[data-cat="eye-${side}"]`).evaluate(eye => Number(getComputedStyle(eye).getPropertyValue('--lid')));
            await expect.poll(() => lid('l')).toBeGreaterThan(0.9);
            expect(await page.locator('.cat-eyes').evaluate(eyes => Number(getComputedStyle(eyes).opacity))).toBe(1);
            expect(await page.locator('[data-cat="figure"]').getAttribute('opacity')).toBe('1');
            expect(await size()).toEqual(before);
            await shot('shy');
            await expect(page.locator('.cat-den__hint')).toHaveText('Подглядывает одним глазом.');
            await page.waitForTimeout(300);
            await shot('peek');
            await page.mouse.move(0, 0);
            await expect(stage).not.toHaveClass(/is-shy/);
            await expect.poll(() => lid('l')).toBeLessThan(0.1);
            await page.locator('.cat-den__close').click();
            await expect(den).toHaveCount(0);
        });

        await test.step('a box with a film brings it out', async () => {
            await emulator.putDocument(`users/${uid}/collections/box`, { id: 'box', name: 'Коробка', icon: 'L', movieIds: [] });
            await open(page, extension, theme, '?tab=achievements');
            await page.waitForTimeout(1500);
            expect((await trail()).steps).toBe(1);
            await emulator.putDocument(`users/${uid}/collections/box`, { id: 'box', name: 'Коробка', icon: 'L', movieIds: [FILMS[0].id] });
            await page.reload();
            await expect(page.locator('.utils-toast').filter({ hasText: 'залез в вашу коробку' })).toBeVisible();
            expect((await trail()).steps).toBe(2);
            await page.locator('#achFramePrev').click();
            await expect(label).toHaveText('Залез в вашу коробку');
            await page.locator('.cat-peek').scrollIntoViewIfNeeded();
            await page.waitForTimeout(700);
            await shot('picker-2');
            await page.locator('.cat-peek').hover();
            await page.waitForTimeout(700);
            await shot('picker-2-hover');
            await page.locator('.cat-peek').click();
            await expect(stage).toHaveAttribute('data-step', '2');
            await page.waitForTimeout(900);
            await shot('sniff');
            await expect(title).toHaveText('Залез в вашу коробку');
            await expect(stage).toHaveAttribute('role', 'button');
            await page.waitForTimeout(700);
            await shot('step-2');
        });

        await test.step('hurrying startles it, a slow hand does not', async () => {
            await pet(page, 2);
            await expect(stage).toHaveAttribute('data-strokes', '2');
            await pet(page, 3, { stepMs: 0, reach: 0.19, samples: 6 });
            await expect(stage).toHaveClass(/is-startled/);
            await shot('startled');
            await expect(stage).not.toHaveClass(/is-startled/);
            await page.mouse.move(0, 0);
            await pet(page, 5);
            await shot('petting');
            for (let turn = 0; turn < 8 && await page.locator('.is-revealed').count() === 0; turn++) await pet(page, 1 + turn % 2);
            await expect(page.locator('.cat-den__hint')).toHaveText('Медленно моргнул. На кошачьем это значит «я вам верю».');
            await expect(title).toHaveText('Свой человек');
            await baseExpect(page.locator('.cat-den__bit').nth(20)).toBeAttached({ timeout: 8000 });
            await page.waitForTimeout(250);
            await shot('reveal');
            // Every part of the frame was found and drawn.
            expect(await page.locator('.cat-den__frame image').evaluateAll(images => Promise.all(images.map(image => fetch(image.href.baseVal).then(response => response.ok))))).not.toContain(false);
            await page.waitForTimeout(3000);
            await shot('done');
            await expect(page.locator('.cat-paw.is-passed')).toHaveCount(3);
            await expect.poll(async () => (await trail())?.tier).toBe(1);
            // A reward, not a rank: nothing but its own points moves.
            expect((await user()).achievements.cat_trail.steps).toBe(3);
        });

        await test.step('the frame is worn, saved and drawn around the photo', async () => {
            await page.locator('[data-den="wear"]').click();
            await expect(den).toHaveCount(0);
            await expect(label).toHaveText('Рамка: Kitty');
            await expect(frame.locator('image')).toHaveAttribute('href', /kitty-label\.webp$/);
            await expect.poll(async () => (await user()).rankFrameLevel).toBe(-1);
            await expect(page.locator('[data-id="cat_trail"]')).toContainText('Свой человек');
            const loaded = await page.evaluate(() => fetch(document.querySelector('#profileRankFrame image').href.baseVal).then(response => response.ok));
            expect(loaded).toBe(true);
            const [photo, overlay] = await Promise.all([page.locator('.profile-photo').boundingBox(), frame.locator('svg').boundingBox()]);
            expect(Math.abs(photo.x + photo.width / 2 - overlay.x - overlay.width / 2)).toBeLessThan(1);
            expect(Math.abs(photo.y + photo.height / 2 - overlay.y - overlay.height / 2)).toBeLessThan(1);
            const [whiskers, name] = await Promise.all([frame.locator('image').boundingBox(), page.locator('.profile-name').first().boundingBox()]);
            expect(whiskers.x + whiskers.width * 2259 / 2280).toBeLessThanOrEqual(name.x);
            // Other pages draw it in the bar, without the lettering.
            await expect(page.locator('#navRankFrame image')).toHaveAttribute('href', /kitty\.webp$/);
            await page.waitForTimeout(1500);
            await shot('worn');
        });

        await test.step('it outlives the review and the box, and can be taken off', async () => {
            await emulator.putDocument(`users/${uid}/collections/box`, { id: 'box', name: 'Разное', icon: 'L', movieIds: [] });
            await open(page, extension, theme, '?tab=achievements');
            await expect(frame.locator('image')).toBeVisible();
            await page.setViewportSize({ width: 390, height: 900 });
            expect(await overflow(page)).toBeLessThanOrEqual(0);
            await page.setViewportSize(config.VIEWPORT);
            await page.locator('#achFrameNext').click();
            await expect.poll(async () => (await user()).rankFrameLevel).toBeUndefined();
            await page.locator('[data-id="cat_trail"]').click();
            await expect(page.locator('#achDialogCondition')).toHaveText('Позвать кота, дать ему коробку и погладить');
            await page.waitForTimeout(400);
            await shot('dialog');
            expect((await trail()).tier).toBe(1);
        });
        expect(errors).toEqual([]);
    });
}

test('the cat can be petted with the keyboard, in a narrow window and without motion', async ({ page, extension }, testInfo) => {
    await emulator.putDocument(`users/${extension.user.uid}`, {
        displayName: extension.user.displayName, email: extension.user.email, approvalStatus: 'approved', isAdmin: false,
        achievements: { cat_trail: { tier: 0, steps: 2 } }
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, extension, 'dark', '?tab=achievements');
    await page.locator('[data-id="cat_trail"]').click();
    const stage = page.locator('.cat-den__stage');
    await expect(stage).toHaveAttribute('role', 'button');
    await stage.focus();
    for (let index = 0; index < 8; index++) {
        await page.keyboard.press('Enter');
        await page.waitForTimeout(320);
    }
    await expect(stage).toHaveAttribute('data-strokes', '8');
    await page.screenshot({ path: testInfo.outputPath('cat-narrow.png') });
    expect(await page.locator('.cat-den').evaluate(dialog => dialog.scrollWidth - dialog.clientWidth)).toBeLessThanOrEqual(0);
    await page.keyboard.press('Enter');
    await expect(page.locator('.cat-den__title')).toHaveText('Свой человек');
    await expect(page.locator('[data-den="wear"]')).toBeFocused();
    await expect(page.locator('.cat-den__reward')).toBeVisible();
    expect(await page.locator('.cat-den').evaluate(dialog => dialog.scrollWidth - dialog.clientWidth)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: testInfo.outputPath('cat-narrow-done.png') });
});

test('a press plays the cat\'s story to its end at once', async ({ page, extension }) => {
    await emulator.putDocument(`users/${extension.user.uid}`, {
        displayName: extension.user.displayName, email: extension.user.email, approvalStatus: 'approved', isAdmin: false,
        achievements: { cat_trail: { tier: 0, steps: 2 } }
    });
    await open(page, extension, 'dark', '?tab=achievements');
    await page.locator('[data-id="cat_trail"]').click();
    const stage = page.locator('.cat-den__stage');
    await expect(stage).toHaveAttribute('data-step', '0');
    await stage.click();
    await baseExpect(stage).toHaveAttribute('role', 'button', { timeout: 4500 });
    await expect(page.locator('.cat-den__title')).toHaveText('Залез в вашу коробку');
    await expect.poll(() => page.locator('[data-cat="head"]').getAttribute('transform')).toMatch(/^translate\(32[0-9.]* (19|20)/);
    await expect(page.locator('[data-cat="paw-r"]')).toHaveAttribute('display', 'inline');
});

test('a frame chosen without the trail is not shown', async ({ page, extension }) => {
    await emulator.putDocument(`users/${OTHER_UID}`, { displayName: 'Второй Зритель', username: 'second', displayNameFormat: 'username', approvalStatus: 'approved', isAdmin: false, rankFrameLevel: -1, createdAt: new Date('2025-10-15T12:00:00Z') });
    await open(page, extension, 'dark', `?userId=${OTHER_UID}`);
    await expect(page.locator('#profileName')).toContainText('second');
    await expect(page.locator('#profileRankFrame')).toBeHidden();
});
