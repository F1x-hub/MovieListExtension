export const whatsNew = [
    {
        id: '1.4.3', version: '1.4.3', date: '2026-10-25',
        highlights: [
            { id: 'hub-restart', title: { ru: 'Хаб предлагает перезапуск', en: 'The hub offers a restart' }, text: { ru: 'После самообновления MovieList Hub показывает новую версию и кнопку «Перезапустить хаб», а не возвращается к старой карточке.', en: 'After updating itself, MovieList Hub shows the new version and a “Restart hub” button instead of returning to the old card.' } },
            { id: 'service-upgrade', title: { ru: 'Исправления служб доходят до всех', en: 'Service fixes reach every install' }, text: { ru: 'Обновление медиаплеера теперь применяет новые настройки служб и к уже установленным копиям, поэтому исправление ночного падения работает и у вас.', en: 'MediaPlayer updates now apply new service settings to existing installs too, so the midnight crash fix reaches you as well.' } },
            { id: 'notes', title: { ru: 'Аккуратнее обновления', en: 'Smoother updates' }, text: { ru: 'Хаб и расширение показывают, что происходит с обновлением медиаплеера на каждом этапе.', en: 'The hub and the extension show what happens to the MediaPlayer update at every step.' } }
        ]
    },
    {
        id: '1.4.2', version: '1.4.2', date: '2026-10-25',
        highlights: [
            { id: 'progress', title: { ru: 'Видно, как обновляется медиаплеер', en: 'See MediaPlayer updates progress' }, text: { ru: 'Хаб и настройки показывают настоящий этап обновления и сколько уже скачано, а не одно «Установка…».', en: 'The hub and Settings show the real update phase and how much is downloaded instead of a bare “Installing…”.' } },
            { id: 'slow-links', title: { ru: 'Обновления на медленном интернете', en: 'Updates on slow connections' }, text: { ru: 'Большие обновления больше не обрываются через 30 минут: время загрузки зависит от размера, а прерванная загрузка продолжается с того же места.', en: 'Large updates no longer stop after 30 minutes: the time limit follows the size, and an interrupted download resumes where it stopped.' } },
            { id: 'midnight', title: { ru: 'Медиаплеер не падает в полночь', en: 'MediaPlayer no longer stops at midnight' }, text: { ru: 'Служба медиаплеера больше не останавливается при ночной смене журналов и сама восстанавливается после сбоя.', en: 'The MediaPlayer service no longer stops when logs rotate at night and recovers on its own after a failure.' } }
        ]
    },
    {
        id: '1.4.1', version: '1.4.1', date: '2026-10-24',
        highlights: [
            { id: 'hub', title: { ru: 'MovieList Hub', en: 'MovieList Hub' }, text: { ru: 'Один установщик для всего: ставит расширение, подключает автообновления и показывает версии компонентов. Если хаб не установлен или устарел, расширение предложит его скачать.', en: 'One installer for everything: it installs the extension, connects automatic updates and shows component versions. If the hub is missing or outdated, the extension offers to download it.' } },
            { id: 'mediaplayer', title: { ru: 'Медиаплеер обновляется сам', en: 'MediaPlayer updates itself' }, text: { ru: 'Торрент-плеер MediaPlayer ставится и восстанавливается из хаба, а новые версии устанавливаются в фоне без запросов Windows.', en: 'The MediaPlayer torrent player installs and repairs from the hub, and new versions install in the background without Windows prompts.' } },
            { id: 'torrent-series', title: { ru: 'Сериалы через торренты', en: 'Series over torrents' }, text: { ru: 'Выбор файла в раздаче, отдельные загрузки для каждой серии, дорожки озвучки и субтитры в общих настройках плеера.', en: 'Pick a file in the torrent, keep separate downloads per episode, and choose audio tracks and subtitles in the shared player settings.' } },
            { id: 'achievements', title: { ru: 'Достижения и ранги', en: 'Achievements and ranks' }, text: { ru: 'Тридцать достижений за оценки, просмотры и марафоны, ранг профиля с рамкой вокруг фото и витрина лучших значков.', en: 'Thirty achievements for ratings, watching and marathons, a profile rank with a frame around the photo and a showcase of top badges.' } },
            { id: 'recommendations', title: { ru: 'Потому что вы оценили', en: 'Because you rated' }, text: { ru: 'На Главной появилась подборка по вашей недавней высокой оценке, а уже оценённые фильмы отмечены на карточках.', en: 'Home now has picks based on your recent high rating, and films you already rated are marked on cards.' } },
            { id: 'quiet-popup', title: { ru: 'Новости без лишних окон', en: 'Release notes without interruptions' }, text: { ru: '«Что нового» теперь открывается только на страницах расширения и больше не появляется в маленьком окне попапа.', en: 'What’s new now opens only on extension pages and no longer pops up in the small popup window.' } }
        ]
    },
    {
        id: '1.4.0', version: '1.4.0', date: '2026-10-22',
        highlights: [
            { id: 'profile-favorites', title: { ru: 'Любимые фильмы в профиле', en: 'Favorite movies on your profile' }, text: { ru: 'Закрепите до пяти любимых фильмов вверху профиля: выберите их из своих оценок и расставьте по местам перетаскиванием.', en: 'Pin up to five favorite movies at the top of your profile: pick them from your ratings and drag them into order.' } },
            { id: 'profile-stats', title: { ru: 'Статистика и совпадение вкусов', en: 'Statistics and taste match' }, text: { ru: 'Время за просмотром, оценки по месяцам, любимые десятилетия, актёры и режиссёры. В чужом профиле видно, насколько ваши вкусы совпадают.', en: 'Watch time, ratings per month, favorite decades, actors and directors. Another user\'s profile shows how closely your tastes match.' } },
            { id: 'hdrezka', title: { ru: 'Новый источник HDRezka', en: 'A new HDRezka source' }, text: { ru: 'Фильмы с HDRezka с выбором качества и озвучки прямо в плеере расширения.', en: 'Films from HDRezka with quality and voiceover choice right in the extension player.' } },
            { id: 'live-smooth', title: { ru: 'Эфир плавнее', en: 'Smoother Live' }, text: { ru: 'Полноэкранный показ больше не подтормаживает, когда окно не в фокусе, а по названию фильма можно перейти к его странице и оценить.', en: 'Fullscreen showings no longer stutter when the window is not focused, and the film title opens its page so you can rate it.' } },
            { id: 'wheel', title: { ru: 'Честнее колесо марафона', en: 'A fairer marathon wheel' }, text: { ru: 'Колесо останавливается в случайной точке фильма, а когда остаётся последний фильм, он выбирается сразу без вращения.', en: 'The wheel stops at a random point of the chosen film, and the last remaining film is picked at once without a spin.' } },
            { id: 'english', title: { ru: 'Эфир и марафон на английском', en: 'Live and marathon in English' }, text: { ru: 'Страница «Эфир», киномарафон, пул и колесо теперь переведены на английский язык.', en: 'The Live page, movie marathon, pool and wheel are now translated into English.' } }
        ]
    },
    {
        id: '1.3.10', version: '1.3.10', date: '2026-10-19',
        highlights: [
            { id: 'halloween', title: { ru: 'Хэллоуин в расширении', en: 'Halloween in the extension' }, text: { ru: 'С 17 октября по 7 ноября: тыква-логотип, гирлянда, кладбище с призраком и тыквы по краям экрана. Оформление отключается в Настройках.', en: 'From 17 October to 7 November: a pumpkin logo, a lantern garland, a graveyard with a ghost and pumpkins at the screen edges. Turn it off in Settings.' } },
            { id: 'horror-picks', title: { ru: 'Подборка ужасов', en: 'Horror picks' }, text: { ru: 'Баннер на Главной с отсчётом до 31 октября ведёт прямо к фильмам ужасов в Каталоге.', en: 'A Home banner counts down to 31 October and leads straight to horror films in the Catalog.' } },
            { id: 'youtube-official', title: { ru: 'Официальные фильмы на YouTube', en: 'Official films on YouTube' }, text: { ru: 'Новый источник с лицензионными фильмами Мосфильма, Ленфильма и других студий.', en: 'A new source with licensed films from Mosfilm, Lenfilm and other studios.' } },
            { id: 'sources', title: { ru: 'Источники надёжнее', en: 'More reliable sources' }, text: { ru: 'В списке только те источники, где фильм точно есть. Если один не запустился, плеер сам пробует следующий.', en: 'Only sources that really have the film are listed. If one does not start, the player tries the next one.' } },
            { id: 'live-schedule', title: { ru: 'Эфир по расписанию', en: 'Scheduled Live shows' }, text: { ru: 'Ведущий может запланировать показ на дату и время.', en: 'The host can schedule a showing for a date and time.' } }
        ]
    },
    {
        id: '1.3.9', version: '1.3.9', date: '2026-10-19',
        highlights: [
            { id: 'live', title: { ru: 'Эфир — кино как по телевизору', en: 'Live — watch together like TV' }, text: { ru: 'Новая страница «Эфир» в верхнем меню: один показ для всех, кто зайдёт позже, попадает на тот же момент. Ведущий запускает фильм или ссылку YouTube и управляет показом прямо в плеере.', en: 'A new Live page in the top menu: one shared showing, and late joiners land on the same moment. The host starts a film or a YouTube link and drives it from the player.' } },
            { id: 'live-relay', title: { ru: 'Трансляция ведущего', en: 'Host relay' }, text: { ru: 'Если у зрителя источник недоступен, он подключается к трансляции вкладки ведущего. Озвучка, качество и субтитры остаются у каждого свои.', en: 'If a source is unavailable for a viewer, they join a relay of the host\'s tab. Voiceover, quality and subtitles stay personal.' } },
            { id: 'watch-default', title: { ru: 'Новый просмотр для всех', en: 'The new player for everyone' }, text: { ru: 'Интерфейс «Смотреть» теперь включён у всех пользователей — без настроек и админ-панели.', en: 'The Watch interface is now on for every user, with no settings or admin switch.' } },
            { id: 'polish', title: { ru: 'Аккуратнее интерфейс', en: 'A cleaner interface' }, text: { ru: 'Скелетоны вместо мигающих загрузчиков, мягкое свечение постера, плавные отклики кнопок и всплывающие уведомления с отменой.', en: 'Skeletons instead of flashing loaders, a soft poster glow, gentle button feedback and toasts with undo.' } },
            { id: 'contrast', title: { ru: 'Светлая тема читается', en: 'Readable light theme' }, text: { ru: 'Исправлен контраст админки, каталога, кнопок ошибок и счётчиков; мелкий текст стал крупнее.', en: 'Contrast fixes across admin, catalog, error buttons and counters; small text is larger.' } }
        ]
    },
    {
        id: '1.3.8', version: '1.3.8', date: '2026-10-18',
        highlights: [
            { id: 'discovery', title: { ru: 'Быстрее поиск и оценки', en: 'Faster search and ratings' }, text: { ru: 'Поиск и загрузка оценок Кинопоиска и IMDb сначала используют быстрые запросы. Недостающие оценки догружаются на карточках, а страницы Кинопоиска остаются запасным вариантом.', en: 'Search and Kinopoisk/IMDb ratings try fast requests first. Missing ratings fill in on cards, with Kinopoisk pages retained as a fallback.' } },
            { id: 'rating-sync', title: { ru: 'Оценки в ваших аккаунтах', en: 'Sync ratings to your accounts' }, text: { ru: 'В настройках интеграций можно включить перенос новых и удалённых оценок в IMDb и Кинопоиск через ваш вход на этих сайтах. Неудачные отправки повторяются в фоне.', en: 'Enable IMDb and Kinopoisk integrations in Settings to mirror ratings and removals through your signed-in site sessions. Failed sends retry in the background.' } },
            { id: 'calendar', title: { ru: 'Календарь открывается быстрее', en: 'A faster calendar' }, text: { ru: 'Сохранённый календарь появляется сразу, свежие даты догружаются постепенно. Подписи читаются в обеих темах, а названия открываются в новой вкладке средней кнопкой мыши.', en: 'The saved calendar appears immediately while fresh dates load progressively. Labels follow both themes, and title links support opening a new tab.' } },
            { id: 'player', title: { ru: 'Удобнее управление плеером', en: 'Refined player controls' }, text: { ru: 'Кнопки плеера получили единые значки и более плавное появление. Горячие клавиши продолжают работать после клика по управлению; настройки озвучки и качества запоминаются для фильма.', en: 'Player buttons share consistent icons and smoother transitions. Shortcuts keep working after clicking controls, and voiceover and quality preferences are remembered per title.' } },
            { id: 'movie-details', title: { ru: 'Полнее карточки фильмов', en: 'More complete film details' }, text: { ru: 'Поздно пришедшие данные восстанавливают сезоны, фон и оценки без перезагрузки. В наградах видны имена победителей и номинантов, а в профиле можно отфильтровать фильмы по своей оценке.', en: 'Late data restores seasons, artwork and ratings without a reload. Awards show winners and nominees, and profile ratings can be filtered by your score.' } },
            { id: 'identity', title: { ru: 'Новый знак MovieList', en: 'A new MovieList mark' }, text: { ru: 'Хлопушка с символом воспроизведения объединяет значки расширения и навигацию. Отдельный значок вкладки остаётся различимым на светлой и тёмной панели браузера.', en: 'A clapperboard and play symbol unify the extension icons and navigation. A dedicated tab icon stays readable on light and dark browser bars.' } }
        ]
    },
    {
        id: '1.3.7', version: '1.3.7', date: '2026-10-15',
        highlights: [
            { id: 'sorting', title: { ru: 'Сортировка в одном стиле', en: 'Consistent sorting everywhere' }, text: { ru: 'Оценённые, избранное и другие списки используют одинаковые элементы сортировки. Названия вариантов читаются целиком, а выбирать их можно с клавиатуры.', en: 'Rated, Favorites and other lists share the same sorting controls. Option labels stay readable, with full keyboard navigation.' } },
            { id: 'filters', title: { ru: 'Фильтры стали компактнее', en: 'More compact filters' }, text: { ru: 'В поиске жанры и страны раскрываются по нажатию, а выбранное видно сразу. На телефоне длинные списки можно развернуть, сохранив активные фильтры на виду.', en: 'Search genres and countries expand on demand while keeping your choices visible. Long mobile lists reveal more options without hiding active filters.' } },
            { id: 'numbers', title: { ru: 'Свои стрелки для числовых полей', en: 'Custom numeric controls' }, text: { ru: 'Год и рейтинг можно менять аккуратными стрелками внутри поля. Кнопки учитывают шаг и границы значения, а ввод с клавиатуры по-прежнему работает.', en: 'Adjust years and ratings with compact arrows inside each field. Buttons respect steps and limits, and keyboard editing still works.' } },
            { id: 'motion', title: { ru: 'Спокойнее и плавнее', en: 'Calmer, smoother navigation' }, text: { ru: 'Обновлены переходы карточек, вкладок и окон. Декоративные эффекты не крутятся бесконечно, а настройка уменьшения движения учитывается во всём интерфейсе.', en: 'Cards, tabs and dialogs have more restrained transitions. Decorative effects stop after a short sequence, and reduced-motion preferences are respected.' } },
            { id: 'loading', title: { ru: 'Меньше ожидания в карточке фильма', en: 'Less waiting in Movie Details' }, text: { ru: 'Оценка, избранное и другие личные действия становятся доступны независимо от дополнительных сведений. Знакомые постеры остаются на месте при обновлении карточек.', en: 'Rating, Favorites and other personal actions become ready independently of optional metadata. Previously loaded posters stay visible when cards refresh.' } },
            { id: 'continue', title: { ru: 'Продолжайте сериал с нужного места', en: 'Continue from the right episode' }, text: { ru: 'Карточка следующей серии открывает сохранённый эпизод и позицию. Переключение источника больше не ждёт сохранения прогресса, а запоздавший запуск не заменяет новый плеер.', en: 'The next-episode card opens the saved episode and position. Switching sources no longer waits for progress storage, and a stale start cannot replace the newest player.' } }
        ]
    },
    {
        id: '1.3.6', version: '1.3.6', date: '2026-10-10',
        highlights: [
            { id: 'seasons', title: { ru: 'Удобнее выбирать серии', en: 'Find your next episode more easily' }, text: { ru: 'Переключайте сезоны, смотрите оценки сообщества и открывайте нужную серию в одной карточке.', en: 'Switch seasons, see community ratings and open an episode in one clear card.' } },
            { id: 'episode-ratings', title: { ru: 'Оценивайте каждую серию отдельно', en: 'Rate episodes individually' }, text: { ru: 'Оценки серий не меняют вашу оценку всего сериала. Поставленная оценка также отмечает серию просмотренной.', en: 'Episode scores stay separate from your rating of the whole series. Rating an episode also marks it as watched.' } },
            { id: 'rooms', title: { ru: 'Больше удобства в совместном просмотре', en: 'More convenient watch rooms' }, text: { ru: 'После перезагрузки вкладки можно вернуться в комнату; приглашение поможет открыть нужный фильм. Владелец может продлить или завершить просмотр, а участники — выйти.', en: 'Rejoin after reloading the tab, and use an invitation to open the right film. Owners can extend or end a room, and members can leave.' } },
            { id: 'room-sync', title: { ru: 'Смотрите вместе без лишних расхождений', en: 'Stay together while watching' }, text: { ru: 'Комната лучше удерживает общий момент и выбранную серию, сообщает о действиях участников и может подождать, пока у кого-то загрузится видео.', en: 'Rooms keep playback and episode selection in sync more reliably, show participants’ actions and can wait while someone’s video loads.' } },
            { id: 'loading', title: { ru: 'Страницы открываются плавнее', en: 'Smoother page loading' }, text: { ru: 'Профили актёров появляются быстрее, а главная и карточки фильмов меньше скачут во время загрузки.', en: 'Actor profiles appear sooner, with fewer layout jumps on the home page and film details.' } },
            { id: 'popup', title: { ru: 'Удобнее пользоваться окном расширения', en: 'A more usable extension window' }, text: { ru: 'Улучшены навигация с клавиатуры, размеры и расположение элементов. Забытый пароль теперь можно восстановить прямо из окна входа.', en: 'Keyboard navigation, sizing and spacing have improved. You can now reset a forgotten password directly from the sign-in window.' } }
        ]
    },
    {
        id: '1.3.5', version: '1.3.5', date: '2026-10-07',
        highlights: [
            { id: 'anime', title: { ru: 'Новый источник для аниме', en: 'A new anime source' }, text: { ru: 'Смотрите аниме через AnimeGo, выбирайте озвучку и качество. Плеер запоминает место просмотра и помогает перейти к следующей серии.', en: 'Watch anime through AnimeGo and choose your dub and quality. The player remembers your position and helps you move to the next episode.' } },
            { id: 'wheel', title: { ru: 'Выбирайте фильм с помощью колеса', en: 'Pick a film with the poster wheel' }, text: { ru: 'В случайном выборе и киномарафоне появилось колесо с постерами и музыкой. Настройте длительность вращения и громкость по своему вкусу.', en: 'Random picks and movie marathons now use a poster wheel with music. Adjust the spin duration and volume to your liking.' } },
            { id: 'reactions', title: { ru: 'Не пропускайте реакции на ваши оценки', en: 'See reactions to your ratings' }, text: { ru: 'При открытии расширения вы увидите, кто отреагировал на ваши оценки. Нажмите на уведомление, чтобы открыть фильм.', en: 'When you open the extension, see who reacted to your ratings. Select a notification to open the film.' } },
            { id: 'rating-links', title: { ru: 'Открывайте фильм на Кинопоиске и IMDb', en: 'Open films on Kinopoisk and IMDb' }, text: { ru: 'Нажмите на оценку Кинопоиска или IMDb в карточке фильма, чтобы перейти на его страницу в новой вкладке.', en: 'Select the Kinopoisk or IMDb score in film details to open its page in a new tab.' } }
        ]
    },
    {
        id: '1.3.2', version: '1.3.2', date: '2026-09-14',
        highlights: [
            { id: 'audio', title: { ru: 'Проще выбрать озвучку', en: 'Find your preferred audio' }, text: { ru: 'В списке торрент-источников появились фильтры русского и английского звука. Рядом с каждым вариантом видны язык, качество и год выпуска.', en: 'Torrent sources now have Russian and English audio filters. Each option shows its language, quality and release year.' } },
            { id: 'sources', title: { ru: 'Качественные варианты найти легче', en: 'Find higher-quality sources more easily' }, text: { ru: 'Варианты с хорошим качеством поднимаются выше съёмок из кинотеатра. Настраивать и проверять источники поиска можно прямо в настройках.', en: 'Higher-quality options appear above cinema recordings. You can configure and check search sources directly in Settings.' } },
            { id: 'random', title: { ru: 'Добавляйте фильмы в случайный выбор', en: 'Add films to your random picks' }, text: { ru: 'Отправьте фильм в свой список для случайного выбора прямо из его карточки — пригодится, когда сложно решить, что посмотреть.', en: 'Add a film to your random-pick pool directly from its details, for those times when you cannot decide what to watch.' } },
            { id: 'updates', title: { ru: 'Обновления учитывают просмотр', en: 'Updates respect your viewing' }, text: { ru: 'Автоматическое обновление ждёт безопасного момента. Если вы обновляете расширение вручную во время просмотра, оно сначала попросит подтверждение.', en: 'Automatic updates wait for a safe moment. If you update manually while watching, the extension asks for confirmation first.' } }
        ]
    },
    {
        id: '1.3.0', version: '1.3.0', date: '2026-09-08',
        highlights: [
            { id: 'reviews', title: { ru: 'Расскажите подробнее о фильме', en: 'Share more about a film' }, text: { ru: 'Кроме оценки можно написать развёрнутый отзыв. В карточке виден короткий фрагмент, а полный текст открывается в отдельном окне.', en: 'Add a longer review alongside your score. Cards show a short preview, with the full text available in a separate dialog.' } },
            { id: 'downloads', title: { ru: 'Управляйте загрузками фильмов', en: 'Manage film downloads' }, text: { ru: 'Следите за ходом торрент-загрузки, ставьте её на паузу и продолжайте позже. Список загрузок остаётся доступным при повторном открытии карточки фильма.', en: 'Track torrent download progress, pause a download and resume it later. Downloads stay available when you reopen film details.' } },
            { id: 'updater', title: { ru: 'Обновляйте расширение удобнее', en: 'Keep the extension up to date' }, text: { ru: 'Один раз установите программу обновления — и новые версии можно устанавливать автоматически или вручную, без повторной настройки при каждом выпуске.', en: 'After connecting the updater once, install new versions automatically or manually without repeating setup for each release.' } }
        ]
    }
];
