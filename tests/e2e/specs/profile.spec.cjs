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

        await test.step('statistics read reactions and marathons only when opened', async () => {
            expect(reads).toHaveLength(0);
            await page.locator('#profileTabStatisticsBtn').click();
            await expect(page.locator('.insight-genres__row')).toHaveCount(2);
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

            // A person shows the films behind their number; one panel serves everyone.
            const people = page.locator('.insight-person');
            const panel = page.locator('.insight-films');
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
                    const films = document.querySelector('.insight-films');
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
