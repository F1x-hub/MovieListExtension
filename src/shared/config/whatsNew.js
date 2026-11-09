export const whatsNew = [
    {
        id: '1.5.5', version: '1.5.5', date: '2026-11-10',
        highlights: [
            { id: 'franchise-icons', title: { ru: 'Иконки франшиз для коллекций', en: 'Franchise icons for collections' }, text: { ru: 'В выборе иконки появился раздел «Франшизы»: 51 цветная плитка, от Marvel и DC до «Звёздных войн» и «Гарри Поттера».', en: 'The icon picker has a Franchises section: 51 colour tiles, from Marvel and DC to Star Wars and Harry Potter.' } },
            { id: 'bookmarks-instant', title: { ru: 'Закладки переключаются мгновенно', en: 'Bookmarks switch instantly' }, text: { ru: 'Списки «Смотрю», «Просмотрено», «Буду смотреть», «Избранное» и коллекции открываются сразу, без секундной паузы.', en: 'Watching, Watched, Plan to Watch, Favorites and collections open at once, without the one-second pause.' } },
            { id: 'collection-menu-fixed', title: { ru: 'Меню и счётчики коллекций исправлены', en: 'Collection menus and counts fixed' }, text: { ru: 'Иконка больше не сдвигает название коллекции, меню «⋮» в закладках открывается, а счётчики показывают настоящее число фильмов.', en: 'An icon no longer pushes the collection name aside, the “⋮” menu on Bookmarks opens, and the counts show the real number of films.' } },
            { id: 'downloads-without-tmdb', title: { ru: 'Скачанный фильм открывается и без TMDB', en: 'A downloaded film opens without TMDB' }, text: { ru: 'Фильм из «Загрузок» открывается, даже когда TMDB не отвечает.', en: 'A film from Downloads opens even when TMDB does not answer.' } },
            { id: 'lighter-animated-avatars', title: { ru: 'Анимированные аватары стали легче', en: 'Lighter animated avatars' }, text: { ru: 'GIF для аватара и баннера сохраняет анимацию, но при загрузке сжимается в несколько раз.', en: 'A GIF avatar or banner keeps its animation and is compressed several times over on upload.' } },
            { id: 'lighter-updates', title: { ru: 'Обновления стали легче', en: 'Lighter updates' }, text: { ru: 'Архив обновления уменьшился примерно на четверть.', en: 'The update archive is about a quarter smaller.' } }
        ]
    },
    {
        id: '1.5.4', version: '1.5.4', date: '2026-11-09', skipAnnouncement: true,
        highlights: [
            { id: 'mediaplayer-cache-on-film-disk', title: { ru: 'Медиаплеер не забивает диск C:', en: 'The media player no longer fills drive C:' }, text: { ru: 'Подготовленная для просмотра копия фильма хранится рядом с самим фильмом и удаляется вместе с ним, а не копится на диске C:.', en: 'The copy of a film prepared for watching is kept next to the film and deleted with it instead of piling up on drive C:.' } }
        ]
    },
    {
        id: '1.5.3', version: '1.5.3', date: '2026-11-09',
        highlights: [
            { id: 'downloads-page', title: { ru: 'Страница «Загрузки»', en: 'A Downloads page' }, text: { ru: 'Все торренты медиаплеера в одном месте: фильмы и сериалы с прогрессом, поиском и фильтрами. Загрузки можно ставить на паузу, продолжать и удалять по одной или сразу несколько, а «Смотреть» открывает фильм на этой копии.', en: 'Every media player torrent in one place: films and series with progress, search and filters. Pause, resume or delete one download or several at once, and “Watch” opens the film on that copy.' } },
            { id: 'torrent-whole-film', title: { ru: 'Весь фильм на шкале', en: 'The whole film on the track' }, text: { ru: 'Пока торрент скачивается, плеер сразу показывает полную длину фильма и отмечает, что уже можно смотреть, а что ещё качается.', en: 'While a torrent downloads, the player shows the film’s full length at once and marks what can be watched now and what is still downloading.' } },
            { id: 'torrent-from-start', title: { ru: 'Торрент с начала', en: 'Torrents start at the beginning' }, text: { ru: 'Фильм, который ещё скачивается, начинается с первой минуты, а не с середины.', en: 'A film that is still downloading starts at its first minute, not in the middle.' } },
            { id: 'preview-right-frame', title: { ru: 'Нужный кадр при наведении', en: 'The right frame on hover' }, text: { ru: 'Подсказка над шкалой плеера сразу показывает кадр этого момента и никогда не подставляет кадр из другого места.', en: 'The hint over the player track shows the frame of that moment at once and never a frame from somewhere else.' } },
            { id: 'mediaplayer-pause', title: { ru: 'Пауза останавливает загрузку', en: 'Pause stops the download' }, text: { ru: 'Медиаплеер больше не докачивает фильм на паузе, даже если открыт плеер, и продолжает большую загрузку после перезагрузки компьютера.', en: 'The media player no longer keeps downloading a paused film, even with the player open, and continues a big download after the computer restarts.' } }
        ]
    },
    {
        id: '1.5.2', version: '1.5.2', date: '2026-11-08', skipAnnouncement: true,
        highlights: [
            { id: 'mediaplayer-big-download', title: { ru: 'Большие фильмы запускаются сразу', en: 'Big films start right away' }, text: { ru: 'Медиаплеер больше не замирает на несколько минут, когда начинает скачивать большой фильм, и не пишет, что он недоступен.', en: 'The media player no longer freezes for several minutes when it starts downloading a big film, and no longer says it is unavailable.' } }
        ]
    },
    {
        id: '1.5.1', version: '1.5.1', date: '2026-11-08',
        highlights: [
            { id: 'ratings-steady', title: { ru: 'Рейтинги КП и IMDb без ожидания', en: 'KP and IMDb ratings without the wait' }, text: { ru: 'На главной, на странице фильма и в «Оценках» рейтинги появляются быстро и не пропадают, а фильмы с одинаковым названием больше не путаются.', en: 'On Home, the film page and Rated, ratings arrive quickly and stay, and films with the same name are no longer mixed up.' } },
            { id: 'light-theme-ratings', title: { ru: 'Светлая тема читается', en: 'A readable light theme' }, text: { ru: 'Рейтинги Кинопоиска и IMDb и карточки закладок хорошо видны в светлой теме.', en: 'Kinopoisk and IMDb ratings and Bookmarks cards are easy to read in the light theme.' } },
            { id: 'not-on-kinopoisk', title: { ru: 'Если фильма нет на Кинопоиске', en: 'When a film is not on Kinopoisk' }, text: { ru: 'Страница так и говорит и предлагает вернуться назад, а не повторять поиск, который не поможет.', en: 'The page says so and offers to go back instead of repeating a search that cannot help.' } },
            { id: 'torrent-file-choice', title: { ru: 'Понятный выбор файла', en: 'A clear choice of file' }, text: { ru: 'В списке файлов раздачи видно, какой файл запускается и какой играет, а у копий Blu-ray — длина, озвучки и субтитры каждого файла.', en: 'The release file list shows which file is starting and which is playing, and Blu-ray copies show each file’s length, dubs and subtitles.' } },
            { id: 'bluray-russian-dub', title: { ru: 'Русская озвучка на Blu-ray', en: 'Russian dub on Blu-ray' }, text: { ru: 'Медиаплеер сам включает русскую дорожку диска Blu-ray, если она есть, и подписывает языки дорожек.', en: 'The media player plays a Blu-ray disc’s Russian track when it has one and names the languages of its tracks.' } }
        ]
    },
    {
        id: '1.5.0', version: '1.5.0', date: '2026-11-07',
        highlights: [
            { id: 'sources-back', title: { ru: 'Источники снова работают', en: 'Sources work again' }, text: { ru: 'KinoGo, Ex-FS, HDRezka и AnimeGo снова запускаются в плеере.', en: 'KinoGo, Ex-FS, HDRezka and AnimeGo play in the player again.' } },
            { id: 'watch-one-press', title: { ru: '«Смотреть» с одного нажатия', en: '“Watch” takes one press' }, text: { ru: 'Фильм стартует с первого нажатия, а если источника нет, плеер об этом скажет.', en: 'A film starts on the first press, and if there is no source, the player says so.' } },
            { id: 'torrent-side-panel', title: { ru: 'Торренты рядом с плеером', en: 'Torrents beside the player' }, text: { ru: 'Панель раздач открывается сбоку и не закрывает видео. Различия между раздачами видны сразу.', en: 'The sources panel opens at the side and leaves the video uncovered. The differences between releases are visible at once.' } },
            { id: 'stable-pages', title: { ru: 'Страницы не прыгают', en: 'Pages stay in place' }, text: { ru: 'Панель навигации, главная и настройки больше не сдвигаются при загрузке.', en: 'The navigation bar, Home and Settings no longer shift while they load.' } },
            { id: 'all-in-bookmarks', title: { ru: 'Всё в закладках', en: 'Everything in Bookmarks' }, text: { ru: 'Избранное, «Буду смотреть» и «Смотрю» теперь открываются в закладках. Кнопки на сторонних сайтах убраны, а фильмы, добавленные ими, в закладках не показываются.', en: 'Favorites, Watchlist and Watching now open in Bookmarks. The buttons on external sites are gone, and films added with them do not appear in Bookmarks.' } },
            { id: 'new-year-season', title: { ru: 'Новый год с 15 декабря', en: 'New Year from 15 December' }, text: { ru: 'С 15 декабря по 14 января: зимнее оформление, новогодний сеанс на главной и подарки с фильмами.', en: 'From 15 December to 14 January: winter decor, a New Year show on Home and gifts that open onto films.' } }
        ]
    },
    {
        id: '1.4.10', version: '1.4.10', date: '2026-11-04',
        highlights: [
            { id: 'torrent-more-sources', title: { ru: 'Больше торрент-раздач', en: 'More torrent sources' }, text: { ru: 'Поиск находит фильмы, которые трекеры держат в разделах аниме и «Другое», например «Ариэтти из страны лилипутов».', en: 'Search now finds films that trackers keep in their anime and “Other” sections, such as “The Secret World of Arrietty”.' } },
            { id: 'torrent-year-title', title: { ru: 'Фильмы с годом в названии', en: 'Films named after a year' }, text: { ru: 'Раздачи «1917» и похожих фильмов больше не отсеиваются из-за числа в названии.', en: 'Releases of “1917” and similar films are no longer dropped because of the number in their title.' } },
            { id: 'torrent-search-status', title: { ru: 'Понятный итог поиска', en: 'A clear search result' }, text: { ru: 'Панель раздач честно сообщает, что поиск ничего не нашёл или завершился ошибкой, а не пишет про сохранённые загрузки.', en: 'The sources panel now says when a search found nothing or failed instead of talking about saved downloads.' } },
            { id: 'update-stale-offer', title: { ru: 'Без старых обновлений', en: 'No outdated update offers' }, text: { ru: 'Всплывающее окно и настройки больше не предлагают версию старше установленной.', en: 'The popup and Settings no longer offer a version older than the one installed.' } }
        ]
    },
    {
        id: '1.4.9', version: '1.4.9', date: '2026-11-02',
        highlights: [
            { id: 'live-real-length', title: { ru: 'Фильм идёт до конца', en: 'Films play to the end' }, text: { ru: 'Эфир узнаёт настоящую длину файла и больше не обрывает фильм раньше времени.', en: 'Live learns the real length of the file and no longer cuts a film off early.' } },
            { id: 'live-resize', title: { ru: 'Длина показа с конца', en: 'Resize a show from its end' }, text: { ru: 'Ведущий меняет длину показа, потянув правый край блока, клавишами Alt+стрелки или в поле «Конец».', en: 'The host changes a show’s length by dragging the block’s right edge, with Alt+arrows or in the “End” field.' } },
            { id: 'live-player', title: { ru: 'Плеер на весь кадр', en: 'Full-frame player' }, text: { ru: 'Плеер в эфире сразу занимает весь кадр, без мелькания страницы фильма и лишней прокрутки.', en: 'The Live player fills the frame at once, without the movie page flashing or an extra scrollbar.' } },
            { id: 'live-pause', title: { ru: 'Без зависаний на паузе', en: 'No more stuck pauses' }, text: { ru: 'Конец YouTube-ролика больше не ставит программу на паузу, а ведущий всегда может продолжить показ.', en: 'The end of a YouTube video no longer pauses the programme, and the host can always resume a show.' } }
        ]
    },
    {
        id: '1.4.8', version: '1.4.8', date: '2026-10-30',
        highlights: [
            { id: 'actor-age', title: { ru: 'Возраст актёров', en: 'Actors’ age' }, text: { ru: 'На вкладке «Актёры» видно, сколько лет было каждому актёру на премьере фильма.', en: 'The Actors tab shows how old each actor was at the film’s release.' } },
            { id: 'halloween-hat', title: { ru: 'Ведьмина шляпа', en: 'A witch hat' }, text: { ru: 'Хэллоуинская тыква в логотипе надела ведьмину шляпу.', en: 'The Halloween pumpkin in the logo now wears a witch hat.' } },
            { id: 'live-autostart', title: { ru: 'Эфир стартует сам', en: 'Live starts by itself' }, text: { ru: 'Эфир сразу запускается с текущего момента, а ставить на паузу может только ведущий.', en: 'Live starts at the current moment right away, and only the host can pause it.' } },
            { id: 'security', title: { ru: 'Безопасность', en: 'Security' }, text: { ru: 'Закрыт обход одобрения аккаунтов, а ключи Spotify больше не хранятся в расширении.', en: 'The account-approval bypass is closed, and Spotify keys are no longer stored in the extension.' } }
        ]
    },
    {
        id: '1.4.7', version: '1.4.7', date: '2026-10-27',
        highlights: [
            { id: 'achievement-scenes', title: { ru: 'Иллюстрированные ачивки', en: 'Illustrated achievements' }, text: { ru: 'Каждая ачивка теперь нарисована сценой, которая растёт с уровнем: от совёнка в гнезде до золотого филина, от свечи до вечного огня.', en: 'Every achievement is now an illustrated scene that grows with the tier: from an owlet in a nest to a golden owl, from a candle to an eternal flame.' } },
            { id: 'rubiks-3d', title: { ru: 'Кубик Рубика в 3D', en: 'Rubik’s Cube in 3D' }, text: { ru: 'Кубик стал объёмным: вращайте грани мышкой, крутите весь кубик и вводите алгоритмы в стандартной нотации.', en: 'The cube is now 3D: turn layers with the mouse, rotate the whole cube and type algorithms in standard notation.' } },
            { id: 'rubiks-sizes', title: { ru: 'Кубики от 2×2 до 7×7', en: 'Cubes from 2×2 to 7×7' }, text: { ru: 'Выберите размер кубика: у каждого своя честная разборка, рекорд и средние Ao5 и Ao12.', en: 'Pick a cube size: each has a proper scramble, its own record and Ao5/Ao12 averages.' } },
            { id: 'live-stable', title: { ru: 'Стабильный эфир', en: 'Steadier Live' }, text: { ru: 'Пауза и перемотка больше не сбивают программу, а подключение зрителя не перезапускает показ с начала.', en: 'Pausing and seeking no longer break the programme, and a viewer joining no longer restarts the show.' } }
        ]
    },
    {
        id: '1.4.6', version: '1.4.6', date: '2026-10-26',
        highlights: [
            { id: 'live-series', title: { ru: 'Сериалы в эфире', en: 'Series on Live' }, text: { ru: 'В программу эфира можно ставить сериалы по сериям, а зрители видят, какая серия идёт сейчас и что будет дальше.', en: 'Live programmes can schedule series episode by episode, and viewers see which episode is on now and what comes next.' } },
            { id: 'kinogo-exfs', title: { ru: 'KinoGo и Ex-FS снова играют', en: 'KinoGo and Ex-FS play again' }, text: { ru: 'Видео с этих источников снова запускается в плеере расширения, в том числе в эфире.', en: 'Videos from these sources start in the extension player again, including on Live.' } },
            { id: 'voiceovers', title: { ru: 'Выбор озвучки', en: 'Voiceover choice' }, text: { ru: 'Озвучки Ex-FS и KinoGo снова есть в меню плеера, а после смены озвучки просмотр продолжается с того же места.', en: 'Ex-FS and KinoGo voiceovers are back in the player menu, and switching one continues from the same moment.' } },
            { id: 'progress-bar', title: { ru: 'Полоса прогресса', en: 'Progress bar' }, text: { ru: 'Полоса прогресса снова видна в плеерах этих источников.', en: 'The progress bar is visible again in these players.' } }
        ]
    },
    {
        id: '1.4.5', version: '1.4.5', date: '2026-10-25',
        highlights: [
            { id: 'live-planner', title: { ru: 'Программа эфира на весь день', en: 'A full-day Live programme' }, text: { ru: 'Ведущий собирает сетку показов на сутки из каталога и YouTube, а в паузах зрители видят заставку MovieList TV с отсчётом до следующего показа.', en: 'The host builds a day of shows from the catalogue and YouTube, and between shows viewers see the MovieList TV standby screen with a countdown.' } },
            { id: 'youtube-player', title: { ru: 'YouTube в нашем плеере', en: 'YouTube in our player' }, text: { ru: 'Трейлеры, официальные фильмы на YouTube и показы в «Эфире» открываются в плеере расширения, а ролики сами завершаются вовремя.', en: 'Trailers, official YouTube films and Live shows open in the extension player, and videos end on time by themselves.' } },
            { id: 'activity-calendar', title: { ru: 'Календарь оценок', en: 'Ratings calendar' }, text: { ru: 'В статистике профиля оценки за год показаны календарём по дням.', en: 'Profile statistics show a year of ratings as a daily calendar.' } },
            { id: 'volume-keys', title: { ru: 'Громкость со стрелок', en: 'Arrow-key volume' }, text: { ru: 'Стрелки ↑/↓ снова меняют громкость с каждым нажатием.', en: 'The ↑/↓ keys change the volume on every press again.' } }
        ]
    },    {
        id: '1.4.4', version: '1.4.4', date: '2026-10-25',
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
