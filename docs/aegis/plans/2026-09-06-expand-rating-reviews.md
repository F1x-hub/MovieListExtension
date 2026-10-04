# План: короткий комментарий и подробная рецензия к фильму

## Goal

Добавить к существующей оценке фильма отдельное необязательное поле `review` для
подробного текста до 5000 символов, не увеличивая высоту карточек и не ломая
существующие формы, реакции, сортировку, кэширование и старые записи.

Итоговая модель должна быть такой:

- `comment` — короткое мнение до 500 символов; остается быстрым полем для
  карточек и компактных форм.
- `review` — подробная рецензия до 5000 символов; редактируется на странице
  фильма и открывается целиком в отдельном читабельном окне.
- Рецензия всегда принадлежит существующей пользовательской оценке. Отдельной
  сущности «рецензия без оценки» в этой версии нет.

## Architecture

### Выбранный вариант

Хранить `review` в том же документе Firestore `ratings/{ratingId}`, где уже
хранятся `rating` и `comment`.

Это минимальное расширение текущей модели: старые документы без поля `review`
остаются валидными, миграция не нужна, удаление оценки автоматически удаляет и
рецензию, а существующие реакции продолжают использовать тот же `ratingId`.

### Почему не отдельная коллекция сейчас

Отдельная коллекция `reviews` дала бы более легкие списки оценок, но потребовала
бы новой связи, новых правил доступа, удаления сиротских документов,
дедупликации legacy-ID, новых запросов и миграционного сценария. Для лимита
5000 символов это преждевременное усложнение.

Текущие запросы рейтингов читают целые документы, поэтому после релиза нужно
измерить реальный размер ответов и скорость списков. Если рецензий станет много
и списки начнут заметно тяжелеть, отдельная коллекция будет следующей отдельной
архитектурной задачей с миграцией, а не скрытой частью этого изменения.

### Обязательный performance-gate

Хранение в том же документе разрешено только после измерения до начала UI-работ:

- для одного `getMovieRatings(..., 50)` сериализованный ответ с review не должен
  превышать 512 KiB;
- суммарный rating payload первой загрузки Ratings не должен превышать 2 MiB;
- p95 времени подготовки рейтингов не должен вырасти более чем на 20% от
  зафиксированного baseline.

Если хотя бы один порог не выполняется, реализацию этого плана нужно остановить
и вернуть архитектуру на отдельный review-design с хранилищем
`reviews/{ratingId}` и маленькими полями `hasReview`, `reviewLength` и
`reviewUpdatedAt`. Нельзя сначала выпустить same-document вариант, а затем
незаметно менять схему под нагрузкой.

### Владельцы данных

- `RatingService` остается единственным каноническим владельцем клиентской
  записи рейтинга.
- Background REST writer должен соблюдать тот же контракт, чтобы обходной путь
  не мог потерять рецензию.
- Firestore Rules — окончательный серверный ограничитель длины и типа данных.
- UI-лимиты `maxlength` и счетчики — только удобство, не защита.

### Семантика записи

1. В `addOrUpdateRating` добавить необязательный `options` последним параметром,
   после существующего `movieData`. Нельзя вставлять новый параметр внутрь
   текущей позиционной сигнатуры: это сломает все существующие вызовы.
2. `options.review` проверяется по наличию собственного свойства, а не через
   truthy-проверку:
   - свойство отсутствует — существующая рецензия сохраняется;
   - строка содержит текст — рецензия нормализуется и записывается;
   - явная пустая строка — рецензия удаляется;
   - значение другого типа — ошибка валидации до записи.
3. Для обычных быстрых форм `review` не передается. Поэтому редактирование
   короткого комментария на Search, Ratings, Favorites, Watchlist, Watching и
   Popup никогда не очищает уже существующую рецензию.
4. Для редактирования только текста существующей оценки добавить отдельный
   `RatingService.updateRatingText(userId, ratingId, patch)`. `patch` может
   содержать `comment`, `review`, `userName` и `userPhoto` только при явном
   наличии свойства. Метод должен в транзакции проверить владельца и менять
   только эти поля плюс `contentUpdatedAt`, сохраняя текущий legacy или canonical
   `ratingId`.
5. При text-only update поле `updatedAt` нельзя менять: оно остается временем
   последнего изменения оценки для обратной совместимости. Для очищенного
   `review` во всех путях записывается явная пустая строка `''`; отсутствие поля
   разрешено только в старых документах. Это одинаково для SDK и REST.
6. `updateRatingText` не должен менять `movies` aggregates,
   `lastRatingUpdatedAt`, `lastUpdated`, порядок оценки, watchlist-состояние,
   favorite-поля, среднее значение, кэш среднего или пользовательские жанры.
   Это предотвращает лишние побочные эффекты при чтении/редактировании текста.
7. Cloud Function `aggregateMovieRatings` должна игнорировать update, где
   `rating`, `movieId` и `userId` не изменились, даже если изменились
   `comment`, `review`, `contentUpdatedAt` или `updatedAt`. Create, delete и
   изменение числового рейтинга по-прежнему пересчитывают агрегаты.
8. Сохранение рейтинга, когда пользователь одновременно меняет число звезд и
   текст, остается путем `addOrUpdateRating`: изменение числового рейтинга
   действительно должно обновить агрегаты.

### Формат и безопасность текста

- В Firestore хранить обе величины как строки: `comment` и `review`.
- Legacy-формат объектов `{text}`/`{comment}` продолжать нормализовать только
  для обратной совместимости существующего `comment`.
- Для `review` не добавлять вложенный объект или HTML.
- Перед рендером применять существующую безопасную цепочку: нормализация,
  ограничение preview по исходному тексту, `escapeHtml`, `linkify`,
  `parseSpoilers`. Порядок нельзя менять так, чтобы пользовательский текст
  создавал HTML.
- Сохранить текущий синтаксис спойлеров `||текст||` и обработку YouTube-ссылок.
- Не помещать полный `review` в `data-*`, атрибуты карточек, URL, логи или
  текст ошибок. Для карточек передавать только `hasReview`, `reviewLength` или
  `ratingId`, а полный текст получать из текущего снимка/сервиса.

### Единица лимита

Лимит рецензии — 5000 Unicode characters после нормализации переводов строк и
обрезки внешних пробелов. Клиентский счетчик должен использовать тот же helper,
что и валидация, а Firestore Rules — проверку `review.size() <= 5000`. До UI-
реализации нужно подтвердить в Rules Emulator поведение для emoji, Cyrillic,
combining marks и CRLF; если счетчики клиента и Rules различаются, выбирается
строгая общая граница, а не две разные трактовки слова «символ».

`maxlength` остается только дополнительным браузерным ограничителем. Реальная
валидация выполняется на `input`, в `RatingService`, background writer и Rules;
обрезание текста без уведомления пользователя запрещено.

## Tech Stack

| Layer | Existing technology | Planned use |
|---|---|---|
| UI | Vanilla JS, HTML, CSS | Editor, bounded preview and reader dialog |
| Data | Firebase Firestore | Optional `review` field in rating document |
| Background | MV3 service worker + REST writer | Preserve/write `review` in direct API path |
| Server | Firebase Cloud Functions | Ignore text-only rating writes in aggregate trigger |
| Security | Firestore Rules | Enforce optional string with max 5000 chars |
| Localization | `src/shared/i18n/locales.js` | Labels, hints, counters and errors |
| Verification | Node contract tests, Rules Emulator, existing npm tests, ESLint, build | Regression and integration checks |

## Baseline/Authority Refs

The implementation must use these existing owners and contracts as the source of
truth:

- `src/shared/services/RatingService.js` — rating validation, transactions,
  canonical/legacy IDs, aggregation and rating reads.
- `functions/index.js` — Firestore `ratings` trigger; it must not treat a
  text-only edit as a rating aggregate change.
- `src/background/background.js` — direct REST rating write path and message
  handler.
- `rules/firestore.rules` — server-side rating validation and ownership rules.
- `src/shared/utils/Utils.js` — comment normalization, escaping helpers,
  spoilers and links.
- `src/pages/movie-details/movie-details.js` and
  `src/pages/movie-details/movie-details.html` — full rating authoring and
  movie-level rendering owner.
- `src/pages/movie-details/movie-details.css` — movie detail card, editor and
  reader styles.
- `src/shared/components/CommentReactionBar.js` and
  `src/shared/services/CommentReactionService.js` — reaction identity and
  summary contract; do not create a second reaction system for reviews.
- `src/shared/services/RatingsCacheService.js` and
  `src/shared/services/AdminRatingsCacheService.js` — rating cache payloads and
  invalidation boundaries.
- `src/shared/components/ReportWidget.js` and `src/shared/firestore.js` — report
  input and persistence contract.
- `docs/design-system.md` — neutral tokens, theme parity, dialog and focus
  requirements.
- `src/shared/i18n/locales.js` — all user-visible strings.
- `tests/ratingTransaction.test.js`, `tests/ratingAggregation.test.cjs`,
  `tests/ratingServiceDedup.test.cjs`, `tests/ratingUniquenessContract.test.js`,
  `tests/movieDetailsRendering.test.js`,
  `tests/movieDetailsAccessibilityPhase6C.test.js`,
  `tests/youtubeCommentLinks.test.js`, `tests/movieCardRatings.test.js` and
  `tests/popupSurfaceContract.test.js` — existing regression boundaries.

Before implementation, inspect the current working tree and preserve unrelated
user changes. Do not edit generated `dist/` files; regenerate them only through
the existing build command.

## Compatibility Boundary

### Data compatibility

- Existing ratings without `review` read as `review: ''` in UI view models.
- Existing canonical and random legacy rating IDs remain supported.
- No backfill and no data rewrite for old documents.
- Existing `comment` limit remains exactly 500.
- New `review` is optional and has a server-enforced limit of 5000.
- Missing `review` must remain allowed by Rules.
- Existing reaction documents and reaction summary documents remain unchanged.
- Deleting a rating deletes its review with the rating document; existing reaction
  cleanup behavior must remain intact.
- `updatedAt` keeps its existing rating-update meaning. Text-only edits use the
  optional `contentUpdatedAt`, which is excluded from aggregate and sort logic.

### API compatibility

- Keep all current positional `addOrUpdateRating` callers working unchanged.
- Append the options argument instead of changing parameter order.
- Background `ADD_RATING` messages must still work when `review` is absent.
- REST update masks must include `review` only when it was explicitly supplied;
  otherwise an old review must not be overwritten by a quick save.
- Existing sort/render signatures must not include the full review body.
- Existing `ratingComment` element IDs may remain for tests and callers even if
  the visible label changes from a generic “review” to “Короткое мнение”.

### UX compatibility

- Compact movie cards retain bounded height and do not show 5000 characters.
- Existing quick forms retain a 500-character textarea and remain fast to use.
- The full editor is available from the movie-details rating flow.
- Compact surfaces expose an explicit navigation action to Movie Details for
  creating or editing the full review; a marker without a usable next action is
  not acceptable.
- A review-only read view uses a separate reader dialog/drawer, not a nested
  dialog inside the rating editor.
- One rating keeps one reaction bar, regardless of whether it has a comment,
  review, both or neither.

## TDD Route

Strict test-first TDD is not required because the user asked for an implementation
plan, not strict TDD. The implementation route is contract-first:

1. Add pure normalization and persistence contract tests.
2. Implement shared limits and service behavior until those tests pass.
3. Add UI contract/accessibility tests before changing movie-details markup.
4. Implement UI and then run the full existing regression suite.

## Requirement Ready Check

The following decisions are fixed for this implementation slice:

- Two fields, not one enlarged field.
- `comment` remains 500; `review` is optional and 5000.
- The long text is stored in the existing rating document.
- Full authoring is on Movie Details; compact forms do not author long text.
- Preview is bounded; full text is shown in a reader dialog.
- Explicit empty review clears it; omitted review preserves it.
- Review-only edits do not touch rating aggregates.
- No replies, titles, likes, attachments, drafts, standalone reviews or review
  sorting in this slice.

## Files

### Files to add

- `src/shared/config/rating.config.js` — shared `comment`/`review` limits. Load
  it before `RatingService.js` in every current rating-service page and through
  `importScripts` in background; no conditional runtime fallback is allowed.
- `tests/ratingReviewContract.test.js` — static and pure contract checks.
- `tests/ratingReviewService.test.cjs` — service behavior with mocked transaction
  reads/writes, including preserve/clear and no-aggregate-side-effect cases.
- `tests/ratingReviewAggregateTrigger.test.cjs` — aggregate-trigger skip policy,
  timestamp semantics and deploy contract.

### Files to modify

- `src/shared/services/RatingService.js`
  - Add the 5000-character review validation.
  - Append `options` to `addOrUpdateRating`.
  - Add `updateRatingText(userId, ratingId, patch)` with ownership, current
    document ID and field-presence checks.
  - Preserve `updatedAt` and write `contentUpdatedAt` for text-only updates.
  - Preserve review on all calls where it is omitted.
  - Invalidate text-bearing rating caches without invalidating average caches.
  - Normalize review output for all rating read view models.
  - Keep canonical/legacy deduplication unchanged.
- `src/background/background.js`
  - Accept an optional review in `addRatingViaAPI` and the trusted message path.
  - Apply the same normalization and 5000-character validation.
  - Add `review` to create payloads and update masks only when explicitly present.
  - Never replace an existing review with an absent message property.
- `functions/index.js`
  - Skip aggregate work when only text/profile/timestamp fields changed.
  - Keep `lastRatingUpdatedAt` based on actual rating changes, not review edits.
  - Add a pure, testable predicate or contract block for aggregate-relevant
    changes; do not rely only on a UI test.
- `rules/firestore.rules`
  - Extend `isValidRatingData` with an optional string review of max 5000.
  - Allow optional `contentUpdatedAt` as a timestamp.
  - Validate review-report target metadata against the referenced rating document.
  - Add a diff-based text-update guard so comment/review changes cannot change
    `userId`, `movieId` or `rating`; keep owner/admin and reaction rules intact.
- `src/shared/utils/Utils.js`
  - Add a named `normalizeRatingReview` or a clearly scoped generic helper.
  - Preserve current comment normalization behavior and legacy object support.
  - Add boundary-focused tests for whitespace, Unicode, emoji and invalid types.
- `src/pages/movie-details/movie-details.html`
  - Keep short comment textarea at `maxlength="500"`.
  - Add a labeled, collapsible long-review textarea at `maxlength="5000"`.
  - Add visible counters for both fields.
  - Add a separate reader dialog with accessible name, scrollable body and close
    control; do not nest it in the rating editor.
- `src/pages/movie-details/movie-details.js`
  - Load and save both fields with explicit presence/touched semantics.
  - Use `updateRatingText` for review-only changes where rating stars are not
    changed.
  - Render short comment and bounded review preview separately.
  - Open full review through the reader dialog using the current rating snapshot.
  - Add generation/lifecycle guards around async reader open/render/close flows.
  - Extend delegated YouTube-link handling to the review text selector.
  - Keep exactly one reaction bar per rating card.
- `src/pages/movie-details/movie-details.css`
  - Add scoped preview, “read full review” affordance and reader dialog styles.
  - Bound preview height with line clamp or an equivalent deterministic rule.
  - Make the reader body scrollable and preserve line breaks.
  - Use existing semantic neutral tokens and provide dark/light parity.
  - Handle mobile viewport height, long URLs and long unbroken text.
- `src/shared/services/RatingsCacheService.js`
  - Version cached rating view models and strip full review text from compact
    caches; retain only `hasReview` and `reviewLength` there.
  - Provide explicit invalidation for text-bearing caches after a successful edit.
- `src/shared/services/AdminRatingsCacheService.js`
  - Keep admin table payloads bounded and expose only a safe review indicator or
    preview unless the administrator explicitly opens the review.
- `src/shared/components/ReportWidget.js`
  - Support a rating-review target context without copying the full reported
    review into the report body.
- `src/shared/firestore.js`
  - Persist validated report target metadata through `addReport`.
- `src/shared/i18n/locales.js`
  - Add localized labels, placeholders, counters, visibility notice, clear/read
    actions, validation error and empty/error states in all supported locales.
- `src/pages/search/search.js`
  - Render only a bounded indicator/preview and `hasReview`; never inject full
    review text into compact cards.
- `src/pages/ratings/ratings.js`
  - Add `hasReview`/review length to view models and render signatures, not the
    full review body.
- `src/shared/components/MovieCard.js`
  - Add only a boolean/length review indicator if the current card surface needs
    it; never add full review text to `data-*` attributes.
- `src/popup/popup.js`
  - Preserve review through the existing short edit modal.
  - Show a compact “Есть рецензия” indicator where the popup shows a rating.
  - Keep the popup modal at 500 characters and direct users to Movie Details for
    long-text authoring.
- `src/pages/admin/admin.js`
  - Add a safe review-present indicator or short bounded preview in rating
    moderation views and delete confirmation; do not expose a full 5000-character
    body in a table cell.
- Relevant HTML files for Search, Ratings, Favorites, Watchlist, Watching
  - Keep their quick comment inputs at 500 and update misleading visible copy.
  - Do not duplicate the full review editor across every page.
- `src/popup/popup.html`, `src/pages/collection/collection.html`,
  `src/pages/admin/admin.html`, `src/pages/home/home.html`,
  `src/pages/profile/profile.html`, `src/pages/person-details/person-details.html`,
  `src/pages/random/random.html`, `src/pages/bookmarks/bookmarks.html`
  - Load `../../shared/config/rating.config.js` (or the page-relative equivalent)
    before `RatingService.js` wherever that service is currently loaded.
- `package.json`
  - Add a targeted `test:rating-review` script and include it in the existing
    pretest chain only after the new tests are stable.

## Implementation Tasks

### Phase 0 — establish the baseline

1. Run `cmd /c git status --short` and record unrelated modifications without
   resetting, cleaning or overwriting them.
2. Run the existing targeted rating and movie-details tests to establish whether
   the baseline is green.
3. Confirm the actual script names in `package.json`, the current locale list and
   how movie-details dialogs handle focus/escape before editing those owners.
4. Add the shared config explicitly before every existing `RatingService.js`
   script, including Popup, Collection, Admin, Home, Profile, Person Details,
   Random and Bookmarks. Add it before background validation via `importScripts`.
   Do not leave a runtime fallback for a missing config.
5. Capture the baseline serialized rating payload and p95 timing for Movie Details
   with 50 ratings and for the first Ratings-page batch. Stop before UI work if
   either performance-gate threshold from Architecture fails.

### Phase 1 — define and test the data contract

1. Add constants for `SHORT_COMMENT_MAX_LENGTH = 500` and
   `LONG_REVIEW_MAX_LENGTH = 5000` in `src/shared/config/rating.config.js`.
2. Add `normalizeRatingReview` with deterministic behavior: non-null string
   input, trim outer whitespace, preserve internal whitespace and line breaks,
   reject over-limit input, and return an empty string for an absent optional
   value at the view-model boundary.
3. Verify the client/Rules meaning of “character” in the Rules Emulator, then add
   tests for lengths 0, 1, 500, 501, 4999, 5000 and 5001, including emoji,
   Cyrillic, combining characters, newlines, whitespace-only input and long URLs.
   The counter and validator must use the confirmed same unit.
4. Add tests that a rating document with no review is valid and a review with a
   non-string value or 5001 characters is rejected.
5. Add a static parity assertion that the UI limit, service limit, background
   limit and Firestore Rule limit all remain 5000, while comment remains 500.

### Phase 2 — implement service and background persistence

1. Extend `RatingService.addOrUpdateRating` without changing existing argument
   positions.
2. Test a new rating with review, an existing rating with review replacement,
   explicit review clearing and an omitted review preserving the old value.
3. Implement `updateRatingText` using a transaction that verifies the owner,
   updates only requested text/profile fields plus `contentUpdatedAt`, and
   preserves `updatedAt`.
4. Test that review-only updates do not write movie aggregate fields, update
   rating sums, remove watchlist entries, invalidate average state or alter
   favorite fields.
5. Test that a text-only update preserves `updatedAt`, writes `contentUpdatedAt`
   and invalidates only rating-text caches. A second tab must not show stale text
   after its cache is invalidated.
6. Test both canonical IDs and existing random legacy IDs; the update must target
   the existing document rather than silently creating a duplicate.
7. Extend the background REST writer. For creates, send `review` only when
   supplied. For updates, add `review` to the body and update mask only when the
   message owns that property. Verify absent review does not clear stored data and
   explicit empty review becomes the same empty-string state as the SDK path.
8. Keep client-side errors localized and avoid logging the review body.
9. Add a direct trigger test proving a review/comment-only rating write does not
   update `movies.lastRatingUpdatedAt`, while a star change does.

### Phase 3 — enforce the server boundary

1. Update `rules/firestore.rules` so `review` is optional, must be a string when
   present and must have size no greater than 5000. Validate `contentUpdatedAt`
   when present as a timestamp.
2. Keep `comment` validation at 500 and add a diff-based guard that a text-only
   update cannot change `userId`, `movieId` or `rating`.
3. Add or extend Rules Emulator tests for missing review, valid boundary review,
   oversized review, wrong type, explicit empty review and unauthorized update.
4. Add the report target schema and validate that target rating ID, movie ID and
   author ID match the referenced public rating. Do not allow arbitrary target
   metadata to be presented as authoritative admin context.
5. Verify that `commentReactions` rules and rating ownership behavior are
   unchanged.

### Phase 4 — build the Movie Details authoring flow

1. In the existing rating editor, keep the short field and add a visually
   separated collapsible section titled “Подробная рецензия”.
2. Show a clear notice that the long text is public. Add `label`/ARIA bindings,
   placeholder, `maxlength="5000"`, counter and validation state.
3. Preserve current IDs where tests or callers depend on them, but change visible
   wording so the 500-character field is clearly “Короткое мнение”.
4. On edit, load both text fields. Track whether the review field was opened or
   changed; closing the section without editing must not clear a stored review.
5. On save, pass review only when the user changed the long field. Empty after an
   explicit edit means persist `review: ''` and hide the review in UI. If only
   the review changed, call
   `updateRatingText`; if stars changed, use `addOrUpdateRating` with options.
6. Render the card with at most one short comment block and one bounded review
   preview. If both exist, preserve their distinction. If only review exists,
   show the review preview in the same bounded area.
7. Add a “Читать рецензию” action only when review text exists. It must be a
   button, not a text link disguised as a button, and must not expand the card in
   the list.
8. Add explicit compact-surface navigation: owners get “Открыть фильм и
   редактировать рецензию”, other users get “Открыть фильм и читать”. The action
   must carry only movie/rating IDs, never the review body.
9. Add the reader dialog/drawer with full text, preserved paragraphs, spoiler
   controls, safe links, close button, Escape handling, outside-click handling,
   focus entry, focus restoration and a scrollable body.
10. Extend `initSelectionPopup` to work with the long-review textarea. Wrapping a
    selected range in spoiler markers must revalidate the 5000-character limit,
    preserve selection and show a localized error instead of silently truncating.
11. Prevent stale async render results from opening a review for a previous movie
   or previous rating snapshot.
12. Ensure reaction picker/menu behavior still attaches to the same rating ID and
    there is not a duplicate reaction bar for the review.

### Phase 5 — keep every compact surface safe

1. Leave all Search, Ratings, Favorites, Watchlist and Watching comment fields at
   500 characters.
2. Leave Popup short edit at 500 and make it preserve review via omitted-review
   service semantics.
3. Add a small review-present marker or bounded preview where a rating already
   appears. Do not add a second large block to grid/list cards.
4. Update rating render signatures to use `hasReview` and/or `reviewLength`, not
   the body. This keeps rerender comparisons small and stable.
5. Ensure no `MovieCard` or popup `data-*` attribute contains the complete review.
6. Strip full review bodies before writing compact `RatingsCacheService`, session
   storage and admin caches. Movie Details may retain a full current snapshot for
   the reader only.
7. Apply the same safe rendering/link behavior on any surface that does show a
   bounded preview.

### Phase 6 — moderation and abuse handling

1. Add an owner-only edit/delete path for the review through the existing rating
   menu; do not create a second ownership rule.
2. In admin rating views, show whether a review exists and a safe short preview.
3. Extend the existing report flow with required target metadata
   (`targetType: 'rating-review'`, `targetRatingId`, `targetMovieId`,
   `targetAuthorId`) and Rules-side cross-checks against the rating document.
   Keep the report text separate from the reported review and do not copy the
   entire review into every report.
4. Add a visible report action for another user’s full review. The action must
   remain available in the reader, use the existing report widget, and show a
   success/error state without closing the reader unexpectedly.
5. Show the target rating/movie/author in the admin moderation view and handle a
   report whose rating was deleted between submission and moderation.
6. Do not add client-side trust assumptions: Firestore ownership and admin Rules
   remain authoritative.

### Phase 7 — localization, responsive styling and accessibility

1. Add strings for both fields, public visibility, character counters, read/close,
   validation, review-present marker, report and empty/error states.
2. Use existing design tokens from `docs/design-system.md`; do not introduce a
   decorative color palette or generic global selectors.
3. Keep preview bounded with a deterministic line clamp/max-height and
   `overflow-wrap:anywhere` for URLs.
4. Make the full reader fit mobile viewports using a dynamic viewport-safe max
   height and an independently scrollable text region.
5. Verify dark and light themes, keyboard-only focus, visible focus ring, tab
   order, screen-reader name/description, Escape and overlay close behavior.
6. Ensure every textarea has an associated label and the counter is announced
   without becoming noisy on every keystroke.

### Phase 8 — verification and release preparation

1. Add the targeted review contract and service scripts to `package.json` only
   after they run deterministically.
2. Run targeted tests for normalization, service transactions, background REST,
   aggregate-trigger policy, Rules Emulator, Movie Details rendering,
   accessibility, links, caches and reports.
3. Deploy Firestore Rules and the aggregate-trigger change before the extension
   build. Smoke-test an old client write and a new review write, then build the
   extension. The new Rules are backward-compatible because `review` remains
   optional.
4. Run the full existing suite with `cmd /c npm test`.
5. Run `cmd /c npm run lint`.
6. Run `cmd /c npm run build`; inspect generated output only as a build artifact,
   never by editing `dist/` manually.
7. Run `cmd /c git diff --check` and review the complete diff for accidental
   changes to aggregates, reaction IDs, old comment behavior and unrelated UI.

## UI Acceptance Scenarios

Manually verify the unpacked extension in both light and dark themes, on desktop
and a narrow mobile viewport:

| Scenario | Expected result |
|---|---|
| No comment, no review | Existing empty rating card remains unchanged except no review marker |
| 500-character comment | Short field accepts exactly 500 and card stays bounded |
| 501-character comment | UI prevents it and server rejects direct invalid writes |
| 5000-character review | Editor accepts it, card shows bounded preview, reader shows all text |
| 5001-character review | UI prevents it and server rejects it |
| Comment + review | Both labels remain understandable; one reaction bar is shown |
| Review without comment | Review preview and read action still appear correctly |
| Existing rating with review | Movie Details loads the review without clearing it |
| Quick comment edit | Existing review is preserved exactly |
| Explicitly cleared review | Review field disappears after reload and reader action is removed |
| Legacy random rating ID | Text update modifies the legacy document, without duplicate rating |
| Spoiler and YouTube URL | Spoiler control and link behavior match existing comments safely |
| Live snapshot/rerender | Current movie/rating remains correct; stale reader is not opened |
| Keyboard reader flow | Focus enters reader, Escape closes, focus returns to opener |
| Delete rating | Rating, review and existing reaction cleanup follow current behavior |
| Report review | Report identifies the exact rating/movie/author target |
| Text-only aggregate | Review edit leaves movie aggregate and rating order unchanged |
| Old-client compatibility | Old quick save preserves a review created by the new client |
| Cache refresh | Same user sees the edited review after cache and page reload |

## Verification

### Automated checks

The following must pass before claiming the feature is ready:

```text
cmd /c node tests/ratingReviewContract.test.js
cmd /c node tests/ratingReviewService.test.cjs
cmd /c node tests/ratingReviewAggregateTrigger.test.cjs
cmd /c npm run test:visual-design
cmd /c npm run test:ratings-page
cmd /c npm test
cmd /c npm run lint
cmd /c npm run build
cmd /c git diff --check
```

If an existing script uses a different exact command, use the script name from
`package.json` and document the substitution in the delivery note.

### Evidence to retain

- Test output for the boundary and preserve/clear cases.
- Rules and background update-mask contract output.
- Aggregate-trigger output proving text-only updates do not mutate movie aggregates.
- Screenshots or a recorded manual checklist for desktop/mobile and both themes.
- Final `git diff --check` result and build result.
- Confirmation that no full review appears in `data-*`, logs or compact cards.

## Aegis Visibility

### Plan Basis

This plan is based on the current rating service, background REST writer,
Firestore rules, aggregate Cloud Function, rating caches, duplicated compact
rating forms, Movie Details rendering, report flow, reaction identity,
localization and visual-system documents inspected before planning.

### BaselineUsageDraft

- Use the existing rating document and `ratingId` as the review identity.
- Reuse existing dialogs, focus lifecycle, reaction bar and text safety helpers.
- Keep the 500-character comment contract intact across all quick surfaces.
- Add only additive optional data and explicit text-only update semantics.

### Architecture Integrity Lens

The change has one data owner (`RatingService`), one full authoring owner
(`Movie Details`), existing compact consumers, one server authority (Rules) and
one aggregate authority (`functions/index.js`). It does not introduce a second
rating identity, a second reaction system or a parallel review collection.

### Plan Pressure Test

- The main data-loss risk is an old quick form overwriting an existing review;
  presence-based options and a background update-mask test address it.
- The main aggregate risk is the Firestore `ratings` trigger reacting to text
  updates; the trigger guard and preserved `updatedAt` address it.
- The main UI risk is allowing 5000 characters to expand cards;
  bounded previews, no full `data-*` text and a separate reader address it.
- The main data-integrity risk is treating text-only edits as rating edits;
  `updateRatingText` explicitly avoids aggregate side effects.
- The main public-content risk is an unmoderated long-text surface; the reader
  report action, validated target metadata and admin handling are launch gates.
- The main performance risk is larger whole-document rating reads; measure the
  baseline first and block same-document rollout if the explicit thresholds fail.

### Plan-Time Complexity Check

The implementation is medium-sized because the rating write path is shared by
several pages, but the schema remains additive and the long editor has one owner.
Do not expand scope with replies, search, sorting, feeds or a new collection in
the same change.

### Requirement Ready Check

All product decisions required to begin implementation are resolved in the
section above. Any new request involving replies, standalone reviews,
attachments, review likes, review sorting or a separate collection must become a
new design decision before code is added.

### Execution Readiness View

- Execution Route: inline implementation in the current worktree.
- Required checkpoints: after service/rules, after Movie Details UI, and before
  release verification.
- TDD mode: contract-first, not strict TDD.
- Stop condition: do not claim completion until automated checks, build, diff
  check and the manual acceptance matrix pass.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Quick editor erases review | Omitted-review preservation in service and REST tests |
| Text edit reorders ratings | Preserve `updatedAt` and guard the aggregate trigger |
| Full review bloats cards | Preview clamp, reader dialog, no full data attributes |
| Aggregate changes on text edit | Separate transactional `updateRatingText` |
| Full review bloats caches | Version compact caches and strip review bodies |
| Legacy rating duplication | Resolve/update existing canonical or legacy ID |
| Unsafe HTML or links | Existing escape/link/spoiler pipeline and focused tests |
| Dialog traps focus or breaks mobile | Reuse dialog lifecycle and accessibility tests |
| Reactions duplicated or detached | Keep `ratingId` and one reaction bar per rating |
| Rule/client limits diverge | Shared constants plus static parity contract |
| Rating lists get heavier | Apply the pre-rollout payload gate; stop and redesign if it fails |
| Public abuse without context | Targeted report metadata and launch gate |
| Localization gap | Add strings before UI is considered complete |

## Non-Goals

The following are intentionally excluded:

- Increasing `comment` above 500.
- A standalone review without a numeric rating.
- Review title, author profile, replies, likes, bookmarks or review sorting.
- Attachments, drafts, autosave or revision history.
- Full review text on Search/Ratings/Favorites/Watchlist/Watching/Popup cards.
- A new `reviews` collection or migration in this release.
- Editing generated `dist/` output manually.

## Retirement

There is no old review subsystem to retire. Keep the existing short comment path
and reaction components. If a future separate-review collection is introduced,
that must include an explicit migration, dual-read period, orphan cleanup,
Rules review, reaction identity decision and removal of the same-document field;
none of those retirement steps are part of this plan.
