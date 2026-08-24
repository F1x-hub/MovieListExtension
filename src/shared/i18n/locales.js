export const locales = {
    en: {
        errors: {
            actions: {
                retry: "Try again",
                back: "Go back",
                close: "Close"
            },
            details: "Technical details",
            generic: {
                title: "Something went wrong",
                message: "We couldn't complete this request. Please try again later."
            },
            kinopoisk: {
                daily_limit: {
                    title: "Kinopoisk API limit reached",
                    message: "Kinopoisk data is temporarily unavailable. Please try again later. {time}"
                },
                unavailable: {
                    title: "Kinopoisk is temporarily unavailable",
                    message: "The Kinopoisk service did not respond. Please try again."
                },
                auth: {
                    title: "Kinopoisk API authentication failed",
                    message: "The Kinopoisk API key was rejected. Check the configured key or endpoint."
                },
                access: {
                    title: "Kinopoisk API access denied",
                    message: "The configured Kinopoisk endpoint refused access to this request."
                },
                rate_limit: {
                    title: "Kinopoisk requests are temporarily limited",
                    message: "Too many Kinopoisk requests were made. Please try again shortly."
                },
                server: {
                    title: "Kinopoisk server error",
                    message: "Kinopoisk returned a server error. Please try again later."
                },
                network: {
                    title: "Kinopoisk connection error",
                    message: "The extension could not connect to Kinopoisk. Check your connection and try again."
                }
            },
            tmdb: {
                unavailable: {
                    title: "TMDB is temporarily unavailable",
                    message: "Movie data could not be loaded from TMDB. Please try again."
                }
            },
            auth: {
                required: {
                    title: "Sign-in required",
                    message: "Please sign in to continue."
                }
            },
            movie: {
                not_found: {
                    title: "Movie not found",
                    message: "The requested movie could not be found."
                }
            },
            person: {
                invalid: {
                    title: "Invalid person link",
                    message: "The person link is invalid or incomplete."
                },
                not_found: {
                    title: "Person not found",
                    message: "The requested person could not be found."
                },
                provider: {
                    title: "Person data is unavailable",
                    message: "Person information could not be loaded. Please try again."
                }
            },
            playback: {
                unavailable: {
                    title: "Playback unavailable",
                    message: "The video source could not be loaded. Please try another source."
                }
            }
        },
        bookmarks: {
            title: "Bookmarks",
            sidebar: {
                all: "All",
                watching: "Watching",
                watched: "Watched",
                plan_to_watch: "Plan to Watch",
                favorites: "Favorites",
                collections: "COLLECTIONS",
                create_collection: "Create Collection"
            },
            header: {
                all_bookmarks: "All Bookmarks"
            },
            search: {
                placeholder: "Search in bookmarks..."
            },
            sort: {
                updated_desc: "Recently Updated",
                created_desc: "Recently Added",
                title_asc: "Title (A-Z)",
                year_desc: "Year (Newest)",
                rating_desc: "Rating"
            },
            empty: {
                title: "No bookmarks found",
                message: "Add using the bookmarks menu on any movie."
            }
        },
        settings: {
            title: "Settings",
            subtitle: "Customize your movie rating experience",
            nav: {
                appearance: "Appearance",
                language: "Language",
                extras: "Extras"
            },
            display_mode: {
                title: "Display Mode",
                description: "Choose how you want to interact with the extension.",
                popup: {
                    title: "Popup",
                    description: "Classic extension popup. Opens when you click the icon."
                },
                sidepanel: {
                    title: "Side Panel",
                    description: "Opens as a native Chrome side panel. Stays visible across tabs."
                }
            },
            language: "Language",
            select_language: "Select Language",
            save: "Save Settings",
            reset: "Reset to Defaults",
            reset_confirm: "Are you sure you want to reset all settings to default?",
            saved: "Settings saved successfully!",
            save_failed: "Failed to save settings",
            reset_done: "Settings reset to defaults"
        },
        navbar: {
            random: "Random",
            rated: "Rated",
            search_placeholder: "Search movies...",
            sign_in: "Sign In",
            view_profile: "View Profile",
            settings: "Settings",
            admin_panel: "Admin Panel",
            theme: "Theme",
            log_out: "Log Out"
        },
        profile: {
            stats: {
                rated: "Movies Rated",
                average: "Average Rating",
                favorites: "Watching",
                watchlist: "Watchlist"
            },
            recent_ratings: "Recent Ratings",
            view_all: "View All",
            open_list: "Open list",
            unknown_title: "Unknown title",
            continue_watching: {
                title: "Continue watching",
                subtitle: "Return to something you already started.",
                eyebrow: "Watching now",
                start_here: "Ready to start",
                progress: "Viewing progress",
                empty_title: "Your current watch will appear here",
                empty_text: "Add a movie or series to your Watching list."
            },
            taste: {
                title: "My taste",
                subtitle: "What appears most often in your ratings.",
                empty: "Rate a few movies to reveal your favorite genres.",
                distribution_empty: "Your rating distribution will appear here."
            },
            edit_profile: "Edit Profile",
            loading: "Loading profile...",
            error: "Failed to load profile",
            try_again: "Try Again",
            joined: "Member since",
            favorite_genre: "Favorite genre",
            edit_modal: {
                title: "Edit Profile",
                banner: "Profile Banner",
                photo: "Profile Photo",
                upload_banner: "Upload Banner",
                upload_photo: "Upload Photo",
                remove: "Remove",
                first_name: "First Name",
                last_name: "Last Name",
                username: "Username",
                bio: "Bio / About Me",
                display_name_format: "Display Name in Navigation",
                favorite_genre: "Favorite Genre",
                social_links: "Social Links (optional)",
                cancel: "Cancel",
                save: "Save Changes"
            },
            cropper: {
                title: "Crop Image",
                avatar: "Avatar",
                banner: "Banner",
                cancel: "Cancel",
                apply: "Apply",
                gif_bypass: "GIF image cannot be cropped in browser, using original image."
            }
        },
        ratings: {
            title: "Rated",
            subtitle: "Manage and explore your movie ratings",
            filters: {
                title: "Filters & Search",
                clear: "Clear Filters",
                search_placeholder: "Search by title...",
                genre: "Genre",
                all_genres: "All Genres",
                year: "Year",
                all_years: "All Years",
                avg_rating: "Average Rating",
                any_average: "Any Average",
                user: "User",
                all_users: "All Users",
                sort: "Sort By"
            },
            sort: {
                date_newest: "Date Added (Newest)",
                date_oldest: "Date Added (Oldest)",
                rating_high: "My Rating (High to Low)",
                rating_low: "My Rating (Low to High)",
                avg_high: "Avg Rating (High to Low)",
                avg_low: "Avg Rating (Low to High)",
                title_az: "Title (A-Z)",
                title_za: "Title (Z-A)",
                year_newest: "Year (Newest)",
                year_oldest: "Year (Oldest)"
            },
            loading: "Loading your collection...",
            empty: {
                title: "No movies found",
                message: "Try adjusting your filters or start rating some movies!",
                search_btn: "Search Movies"
            },
            error: {
                title: "Something went wrong",
                message: "Failed to load movies",
                retry: "Try Again"
            },
            modal: {
                rate_movie: "Rate This Movie",
                your_rating: "Your Rating",
                share_thoughts: "Share Your Thoughts",
                placeholder: "What did you think about this movie? (Optional)",
                cancel: "Cancel",
                save: "Save Rating"
            }
        },
        movie_card: {
            add_favorite: "Add to Favorites",
            remove_favorite: "Remove from Favorites",
            add_watchlist: "Add to Plan to Watch",
            remove_watchlist: "Remove from Plan to Watch",
            add_watching: "Add to Watching",
            remove_watching: "Remove from Watching",
            add_watched: "Add to Watched",
            remove_watched: "Remove from Watched",
            edit_rating: "Edit Rating",
            add_collection: "Add to Collection",
            remove: "Remove",
            remove_bookmarks: "Remove from Bookmarks",
            kinopoisk: "Kinopoisk",
            imdb: "IMDb",
            tmdb: "TMDB",
            avg_rating: "Avg Rating",
            my_rating: "My Rating",
            unknown_movie: "Unknown Movie",
            not_available: "N/A"
        },
        random: {
            title: "Random Movie",
            subtitle: "Let the dice decide what to watch next!",
            config: {
                title: "Configuration",
                reset: "Reset Filters",
                year_range: "Year Range",
                rating: "Rating (Kinopoisk)",
                votes: "Votes Count",
                type: "Type",
                genres: "Genres",
                countries: "Countries",
                hint: "(Include / Exclude)",
                min: "Min",
                max: "Max"
            },
            states: {
                ready_title: "Ready to roll?",
                ready_subtitle: "Configure filters to your mood",
                roll_btn: "Find Movie",
                searching: "Searching specifically for you...",
                no_movie: "No movie found with these criteria.",
                relax_filters: "Try relaxing the filters.",
                try_again: "Try Again"
            },
            types: {
                movie: "Movies",
                tv_series: "TV Series",
                cartoon: "Cartoons",
                anime: "Anime"
            },
            genres: {
                comedy: "Comedies",
                cartoon: "Cartoons",
                horror: "Horror",
                sci_fi: "Sci-Fi",
                thriller: "Thrillers",
                action: "Action",
                melodrama: "Melodramas",
                detective: "Detectives",
                adventure: "Adventure",
                fantasy: "Fantasy",
                war: "War",
                family: "Family",
                anime: "Anime",
                history: "History",
                drama: "Dramas",
                documentary: "Documentaries",
                kids: "Kids",
                crime: "Crime",
                biography: "Biographies",
                western: "Westerns",
                film_noir: "Film-Noir",
                sport: "Sports",
                reality_tv: "Reality-TV",
                short: "Shorts",
                music: "Music",
                musical: "Musicals",
                talk_show: "Talk-Show",
                game: "Game"
            },
            countries: {
                russia: "Russia",
                ussr: "USSR",
                usa: "USA",
                kazakhstan: "Kazakhstan",
                france: "France",
                south_korea: "South Korea",
                uk: "United Kingdom",
                japan: "Japan",
                italy: "Italy",
                spain: "Spain",
                germany: "Germany",
                turkey: "Turkey",
                sweden: "Sweden",
                denmark: "Denmark",
                norway: "Norway",
                hong_kong: "Hong Kong",
                australia: "Australia",
                belgium: "Belgium",
                netherlands: "Netherlands",
                greece: "Greece",
                austria: "Austria"
            }
        },
        movie_details: {
            loading: "Loading movie info...",
            wait: "Please wait",
            back_to_search: "Back to Search",
            rate_title: "Rate This Movie",
            write_review: "Write a Review",
            review_placeholder: "What did you think about this movie?",
            save_rating: "Save Rating",
            cancel: "Cancel",
            watch_movie: "Watch Movie",
            click_to_expand: "Click to expand",
            source: "Source:",
            select_source: "Select a source",
            loading_player: "Loading player...",
            error_title: "Error",
            error_loading_movie: "Failed to load movie",
            not_found: "Movie not found. Return to search.",
            login_required: "Please log in to watch the movie.",
            return_btn: "Return to Search",
            tabs: {
                about: "About",
                actors: "Actors",
                awards: "Awards"
            },
            meta: {
                year: "Year of production:",
                country: "Country:",
                genre: "Genre:",
                slogan: "Slogan:",
                director: "Director:",
                writer: "Writer:",
                producer: "Producer:",
                operator: "Operator:",
                composer: "Composer:",
                designer: "Designer:",
                editor: "Editor:",
                budget: "Budget:",
                fees_usa: "Fees in USA:",
                fees_world: "Fees in World:",
                fees_russia: "Fees in Russia:",
                premiere_russia: "Premiere in Russia:",
                premiere_world: "Premiere in World:",
                premiere_digital: "Digital Release:",
                audience: "Audience",
                age_rating: "Age Rating:",
                rating_mpaa: "MPAA Rating",
                duration: "Duration:",
                hours: "h",
                minutes: "min"
            },
            description: "Description",
            no_description: "No description available",
            sequels: "Sequels and Prequels",
            similar_movies: "Similar Movies",
            similar_series: "Similar Series",
            similar_cartoons: "Similar Cartoons",
            similar_anime: "Similar",
            frames: "Movie Frames",
            user_ratings_title: "User Ratings",
            loading_reviews: "Loading reviews...",
            error_loading_reviews: "Error loading reviews",
            empty_reviews: "Be the first to rate this movie!",
            be_first: "Be the first!",
            edit: "Edit",
            delete: "Delete",
            votes_count: "{count} votes",
            profession: {
                director: "Director",
                writer: "Writer",
                producer: "Producer",
                operator: "Operator",
                composer: "Composer",
                designer: "Designer",
                editor: "Editor",
                actor: "Actor"
            },
            awards_tab: {
                no_data: "No information about awards",
                nomination: "Nomination",
                winner: "Winner",
                nominee: "Nominee",
                show_all: "Show all awards ({count})"
            },
            actors_tab: {
                no_data: "Actor information missing",
                unknown: "Unknown"
            }
        },
        search: {
            hero_badge: "Search Movies & TV Series",
            placeholder: "Search for movies...",
            recent_searches: "Recent Searches",
            clear_history: "Clear all history",
            no_recent: "No recent searches",
            search_btn: "Search",
            filters_btn: "Filters",
            year_range: "Year Range:",
            from: "From",
            to: "To",
            genres: "Genres:",
            countries: "Countries:",
            clear_filters: "Clear Filters",
            apply_filters: "Apply Filters",
            results_title: "Search Results",
            found_count: "Found {count} movies",
            empty_title: "Search for movies",
            empty_text: "Enter a movie title to start searching",
            no_results_title: "Movies not found",
            no_results_text: "Try changing your search query or use filters",
            prev: "Previous",
            next: "Next",
            page_info: "Page {current} of {total}",
            movie_details_modal: "Movie Details",
            rate_this: "Rate This Movie",
            movie_detail_btn: "Movie Detail",
            close: "Close",
            error_query: "Please enter a search query",
            error_login: "Please log in to search for movies",
            error_api: "Kinopoisk API key not configured. Please check the configuration.",
            error_generic: "An error occurred while searching for movies",
            error_cyrillic: "Problem with Cyrillic search \"{query}\". Try English title or other keywords.",
            error_server: "Server temporarily unavailable. Try later or change query.",
            error_not_found: "Nothing found for your query. Try other keywords.",
            error_forbidden: "API access problem. Check settings.",
            error_network: "Internet connection problem. Check connection."
        },
        popup: {
            update: {
                title: "Update Available",
                version: "New version ready",
                btn: "Update"
            },
            header: {
                title: "Movie Ratings",
                not_authenticated: "Not authenticated",
                signed_in_as: "Signed in as {user}"
            },
            auth: {
                google_btn: "Continue with Google",
                or: "or",
                email_label: "Email Address",
                email_placeholder: "Your email address",
                password_label: "Password",
                password_placeholder: "Your password",
                login_btn: "Sign In",
                register_btn: "Sign Up",
                forgot_password: "Forgot password?",
                back: "Back",
                no_account: "Don't have an account?",
                have_account: "Already have an account?",
                register_info: "Continue",
                first_name_label: "First Name",
                first_name_placeholder: "Your name",
                last_name_label: "Last Name",
                last_name_placeholder: "Your surname",
                confirm_password_label: "Repeat Password",
                confirm_password_placeholder: "Repeat password",
                create_account: "Create Account",
                password_min_length: "Password must be at least 6 characters long",
                passwords_dont_match: "Passwords do not match",
                fill_all: "Please fill in all fields",
                loading_login: "Signing in...",
                loading_register: "Creating account...",
                loading_checking: "Checking...",
                loading_google: "Signing in..."
            },
            approval: {
                pending_registered_title: "Application Under Review",
                pending_registered_msg: "Your account has been successfully registered and is waiting for administrator approval. Once approved, you will receive full access to the extension.",
                pending_login_title: "Account Awaiting Approval",
                pending_login_msg: "Your registration is currently under review by the administrator. Access will be granted once approved.",
                rejected_title: "Access Restricted",
                rejected_msg: "Your registration was rejected by the administrator.",
                back_to_login: "Back to Sign In"
            },
            content: {
                search_placeholder: "Search movies...",
                settings: "Settings",
                logout: "Sign Out",
                recent_ratings: "Recent Ratings",
                view_all: "View All",
                refresh: "Refresh",
                empty_title: "No ratings yet",
                empty_text: "Start rating movies to see them here!",
                loading: "Loading..."
            }
        },
        person_details: {
            loading: "Loading person details...",
            wait: "Please wait",
            error_title: "Information not found",
            error_text: "Failed to load person information",
            invalid_link: "Invalid person link",
            not_found: "Person information not found",
            provider_error: "Temporary provider failure. Please try again later.",
            back: "Back",
            retry: "Retry",
            home: "Home",
            biography: "Biography",
            show_all_bio: "Show full biography",
            hide_bio: "Hide",
            facts: "Facts",
            show_more_facts: "Show more facts",
            hide_facts: "Hide",
            known_for: "Known For",
            previous_movies: "Previous movies",
            next_movies: "Next movies",
            filmography: "Filmography",
            filmography_empty: "Filmography unavailable",
            all_media: "All",
            movies_media: "Movies",
            series_media: "Series",
            show_more: "Show more",
            show_less: "Show less",
            acting: "Acting",
            directing: "Directing",
            writing: "Writing",
            production: "Production",
            music: "Music",
            other: "Other Work",
            birthday: "Birthday",
            birthplace: "Birthplace",
            deathday: "Date of death",
            age: "Age",
            years_old: "years old",
            years_at_death: "years old at death",
            aliases: "Other names",
            show_more_aliases: "Show more"
        }
    },
    ru: {
        errors: {
            actions: {
                retry: "Повторить",
                back: "Вернуться назад",
                close: "Закрыть"
            },
            details: "Технические детали",
            generic: {
                title: "Что-то пошло не так",
                message: "Не удалось выполнить запрос. Попробуйте ещё раз позже."
            },
            kinopoisk: {
                daily_limit: {
                    title: "Лимит Kinopoisk API исчерпан",
                    message: "Данные Kinopoisk временно недоступны. Попробуйте позже. {time}"
                },
                unavailable: {
                    title: "Kinopoisk временно недоступен",
                    message: "Сервис Kinopoisk не ответил. Попробуйте ещё раз."
                },
                auth: {
                    title: "Ошибка авторизации Kinopoisk API",
                    message: "Ключ Kinopoisk API отклонён. Проверьте ключ или endpoint."
                },
                access: {
                    title: "Доступ к Kinopoisk API отклонён",
                    message: "Настроенный endpoint Kinopoisk отказал в доступе к запросу."
                },
                rate_limit: {
                    title: "Kinopoisk временно ограничил запросы",
                    message: "Было отправлено слишком много запросов. Попробуйте через несколько секунд."
                },
                server: {
                    title: "Ошибка сервера Kinopoisk",
                    message: "Kinopoisk вернул ошибку сервера. Попробуйте позже."
                },
                network: {
                    title: "Ошибка соединения с Kinopoisk",
                    message: "Не удалось подключиться к Kinopoisk. Проверьте соединение и повторите попытку."
                }
            },
            tmdb: {
                unavailable: {
                    title: "TMDB временно недоступен",
                    message: "Не удалось загрузить данные фильма из TMDB. Попробуйте ещё раз."
                }
            },
            auth: {
                required: {
                    title: "Требуется вход",
                    message: "Войдите в аккаунт, чтобы продолжить."
                }
            },
            movie: {
                not_found: {
                    title: "Фильм не найден",
                    message: "Запрошенный фильм не удалось найти."
                }
            },
            person: {
                invalid: {
                    title: "Некорректная ссылка на персону",
                    message: "Ссылка на персону неполная или содержит ошибку."
                },
                not_found: {
                    title: "Персона не найдена",
                    message: "Запрошенную персону не удалось найти."
                },
                provider: {
                    title: "Данные персоны недоступны",
                    message: "Не удалось загрузить информацию о персоне. Попробуйте ещё раз."
                }
            },
            playback: {
                unavailable: {
                    title: "Воспроизведение недоступно",
                    message: "Не удалось загрузить источник видео. Попробуйте другой источник."
                }
            }
        },
        bookmarks: {
            title: "Закладки",
            sidebar: {
                all: "Все",
                watching: "Смотрю",
                watched: "Просмотрено",
                plan_to_watch: "Буду смотреть",
                favorites: "Избранное",
                collections: "КОЛЛЕКЦИИ",
                create_collection: "Создать коллекцию"
            },
            header: {
                all_bookmarks: "Все закладки"
            },
            search: {
                placeholder: "Поиск в закладках..."
            },
            sort: {
                updated_desc: "Недавно обновленные",
                created_desc: "Недавно добавленные",
                title_asc: "Название (А-Я)",
                year_desc: "Год (Новые)",
                rating_desc: "Рейтинг"
            },
            empty: {
                title: "Закладок нет",
                message: "Добавьте их через меню закладок на карточке фильма."
            }
        },
        settings: {
            title: "Настройки",
            subtitle: "Персонализируйте расширение под себя",
            nav: {
                appearance: "Внешний вид",
                language: "Язык",
                extras: "Дополнительно"
            },
            display_mode: {
                title: "Режим отображения",
                description: "Выберите, как вы хотите взаимодействовать с расширением.",
                popup: {
                    title: "Попап",
                    description: "Классическое окно. Открывается при нажатии на иконку."
                },
                sidepanel: {
                    title: "Боковая панель",
                    description: "Открывается как панель Chrome. Видна при переключении вкладок."
                }
            },
            language: "Язык",
            select_language: "Выберите язык",
            save: "Сохранить настройки",
            reset: "Сбросить по умолчанию",
            reset_confirm: "Вы уверены, что хотите сбросить все настройки к значениям по умолчанию?",
            saved: "Настройки успешно сохранены!",
            save_failed: "Не удалось сохранить настройки",
            reset_done: "Настройки сброшены"
        },
        navbar: {
            random: "Случайный",
            rated: "Оцененные",
            search_placeholder: "Поиск фильмов...",
            sign_in: "Войти",
            view_profile: "Профиль",
            settings: "Настройки",
            admin_panel: "Админ панель",
            theme: "Тема",
            log_out: "Выйти"
        },
        profile: {
            stats: {
                rated: "Оценок",
                average: "Средняя оценка",
                favorites: "Смотрю",
                watchlist: "Буду смотреть"
            },
            recent_ratings: "Недавние оценки",
            view_all: "Все оценки",
            open_list: "Открыть список",
            unknown_title: "Без названия",
            continue_watching: {
                title: "Продолжить просмотр",
                subtitle: "Вернитесь к тому, что уже начали.",
                eyebrow: "Смотрю сейчас",
                start_here: "Можно начать",
                progress: "Прогресс просмотра",
                empty_title: "Здесь появится ваш текущий просмотр",
                empty_text: "Добавьте фильм или сериал в список «Смотрю»."
            },
            taste: {
                title: "Мой вкус",
                subtitle: "Что чаще всего появляется в ваших оценках.",
                empty: "Оцените несколько фильмов, чтобы увидеть любимые жанры.",
                distribution_empty: "Здесь появится распределение ваших оценок."
            },
            edit_profile: "Редактировать",
            loading: "Загрузка профиля...",
            error: "Не удалось загрузить профиль",
            try_again: "Повторить",
            joined: "Участник с",
            favorite_genre: "Любимый жанр",
            edit_modal: {
                title: "Редактировать профиль",
                banner: "Обложка профиля",
                photo: "Фото профиля",
                upload_banner: "Загрузить",
                upload_photo: "Загрузить",
                remove: "Удалить",
                first_name: "Имя",
                last_name: "Фамилия",
                username: "Никнейм",
                bio: "О себе",
                display_name_format: "Отображаемое имя",
                favorite_genre: "Любимый жанр",
                social_links: "Социальные сети",
                cancel: "Отмена",
                save: "Сохранить"
            },
            cropper: {
                title: "Обрезать изображение",
                avatar: "Аватарка",
                banner: "Баннер",
                cancel: "Отмена",
                apply: "Применить",
                gif_bypass: "GIF-изображение обрезается без браузера, используется оригинал."
            }
        },
        ratings: {
            title: "Оцененные",
            subtitle: "Управляйте и изучайте свои оценки",
            filters: {
                title: "Фильтры и Поиск",
                clear: "Сбросить",
                search_placeholder: "Поиск по названию...",
                genre: "Жанр",
                all_genres: "Все жанры",
                year: "Год",
                all_years: "Все года",
                avg_rating: "Средний рейтинг",
                any_average: "Любой рейтинг",
                user: "Пользователь",
                all_users: "Все пользователи",
                sort: "Сортировка"
            },
            sort: {
                date_newest: "Дата добавления (Сначала новые)",
                date_oldest: "Дата добавления (Сначала старые)",
                rating_high: "Моя оценка (Высокая)",
                rating_low: "Моя оценка (Низкая)",
                avg_high: "Средний рейтинг (Высокий)",
                avg_low: "Средний рейтинг (Низкий)",
                title_az: "Название (А-Я)",
                title_za: "Название (Я-А)",
                year_newest: "Год (Новые)",
                year_oldest: "Год (Старые)"
            },
            loading: "Загрузка коллекции...",
            empty: {
                title: "Фильмы не найдены",
                message: "Попробуйте изменить фильтры или оцените пару фильмов!",
                search_btn: "Найти фильмы"
            },
            error: {
                title: "Что-то пошло не так",
                message: "Не удалось загрузить фильмы",
                retry: "Повторить"
            },
            modal: {
                rate_movie: "Оценить",
                your_rating: "Ваша оценка",
                share_thoughts: "Поделитесь мнением",
                placeholder: "Что вы думаете об этом фильме? (Необязательно)",
                cancel: "Отмена",
                save: "Сохранить"
            }
        },
        movie_card: {
            add_favorite: "В избранное",
            remove_favorite: "Из избранного",
            add_watchlist: "Буду смотреть",
            remove_watchlist: "Не буду смотреть",
            add_watching: "Смотрю",
            remove_watching: "Больше не смотрю",
            add_watched: "Просмотрено",
            remove_watched: "Убрать из Просмотренного",
            edit_rating: "Изменить оценку",
            add_collection: "В коллекцию",
            remove: "Удалить",
            remove_bookmarks: "Из закладок",
            kinopoisk: "Кинопоиск",
            imdb: "IMDb",
            tmdb: "TMDB",
            avg_rating: "Средний",
            my_rating: "Моя оценка",
            unknown_movie: "Неизвестный фильм",
            not_available: "—"
        },
        random: {
            title: "Случайный фильм",
            subtitle: "Пусть кости решат, что смотреть дальше!",
            config: {
                title: "Настройка",
                reset: "Сбросить фильтры",
                year_range: "Год выхода",
                rating: "Рейтинг (Кинопоиск)",
                votes: "Количество голосов",
                type: "Тип",
                genres: "Жанры",
                countries: "Страны",
                hint: "(Включить / Исключить)",
                min: "Мин",
                max: "Макс"
            },
            states: {
                ready_title: "Готовы к броску?",
                ready_subtitle: "Настройте фильтры под настроение",
                roll_btn: "Найти фильм",
                searching: "Ищем специально для вас...",
                no_movie: "Фильм по таким критериям не найден.",
                relax_filters: "Попробуйте смягчить фильтры.",
                try_again: "Повторить"
            },
            types: {
                movie: "Фильмы",
                tv_series: "Сериалы",
                cartoon: "Мультфильмы",
                anime: "Аниме"
            },
            genres: {
                comedy: "Комедии",
                cartoon: "Мультфильмы",
                horror: "Ужасы",
                sci_fi: "Фантастика",
                thriller: "Триллеры",
                action: "Боевики",
                melodrama: "Мелодрамы",
                detective: "Детективы",
                adventure: "Приключения",
                fantasy: "Фэнтези",
                war: "Военные",
                family: "Семейные",
                anime: "Аниме",
                history: "Исторические",
                drama: "Драмы",
                documentary: "Документальные",
                kids: "Детские",
                crime: "Криминал",
                biography: "Биографии",
                western: "Вестерны",
                film_noir: "Фильмы-нуар",
                sport: "Спортивные",
                reality_tv: "Реальное ТВ",
                short: "Короткометражки",
                music: "Музыкальные",
                musical: "Мюзиклы",
                talk_show: "Ток-шоу",
                game: "Игры"
            },
            countries: {
                russia: "Россия",
                ussr: "СССР",
                usa: "США",
                kazakhstan: "Казахстан",
                france: "Франция",
                south_korea: "Южная Корея",
                uk: "Великобритания",
                japan: "Япония",
                italy: "Италия",
                spain: "Испания",
                germany: "Германия",
                turkey: "Турция",
                sweden: "Швеция",
                denmark: "Дания",
                norway: "Норвегия",
                hong_kong: "Гонконг",
                australia: "Австралия",
                belgium: "Бельгия",
                netherlands: "Нидерланды",
                greece: "Греция",
                austria: "Австрия"
            }
        },
        movie_details: {
            loading: "Загрузка информации о фильме...",
            wait: "Пожалуйста, подождите",
            back_to_search: "Вернуться к поиску",
            rate_title: "Оценить",
            write_review: "Написать отзыв",
            review_placeholder: "Что вы думаете об этом фильме?",
            save_rating: "Сохранить",
            cancel: "Отмена",
            watch_movie: "Смотреть",
            click_to_expand: "Нажмите, чтобы развернуть",
            source: "Источник:",
            select_source: "Выберите источник",
            loading_player: "Загрузка плеера...",
            error_title: "Ошибка",
            error_loading_movie: "Ошибка загрузки фильма",
            not_found: "Фильм не найден. Вернитесь к поиску.",
            login_required: "Пожалуйста, войдите в систему для просмотра фильма",
            return_btn: "Вернуться к поиску",
            tabs: {
                about: "О фильме",
                actors: "Актёры",
                awards: "Награды"
            },
            meta: {
                year: "Год производства:",
                country: "Страна:",
                genre: "Жанр:",
                slogan: "Слоган:",
                director: "Режиссер:",
                writer: "Сценарий:",
                producer: "Продюсер:",
                operator: "Оператор:",
                composer: "Композитор:",
                designer: "Художник:",
                editor: "Монтаж:",
                budget: "Бюджет:",
                fees_usa: "Сборы в США:",
                fees_world: "Сборы в мире:",
                fees_russia: "Сборы в России:",
                premiere_russia: "Премьера в России:",
                premiere_world: "Премьера в мире:",
                premiere_digital: "Цифровой релиз:",
                audience: "Зрители",
                age_rating: "Возраст:",
                rating_mpaa: "Рейтинг MPAA",
                duration: "Время:",
                hours: "ч",
                minutes: "мин"
            },
            description: "Описание",
            no_description: "Описание отсутствует",
            sequels: "Сиквелы и приквелы",
            similar_movies: "Похожие фильмы",
            similar_series: "Похожие сериалы",
            similar_cartoons: "Похожие мультфильмы",
            similar_anime: "Похожее",
            frames: "Кадры из фильма",
            user_ratings_title: "Оценки пользователей",
            loading_reviews: "Загрузка отзывов...",
            error_loading_reviews: "Ошибка загрузки отзывов",
            empty_reviews: "Будьте первым, кто оценит этот фильм!",
            be_first: "Будьте первым!",
            edit: "Редактировать",
            delete: "Удалить",
            votes_count: "{count} оценок",
            profession: {
                director: "Режиссер",
                writer: "Сценарист",
                producer: "Продюсер",
                operator: "Оператор",
                composer: "Композитор",
                designer: "Художник",
                editor: "Монтажер",
                actor: "Актер"
            },
            awards_tab: {
                no_data: "Нет информации о наградах",
                nomination: "Номинация",
                winner: "Победитель",
                nominee: "Номинация",
                show_all: "Показать все награды ({count})"
            },
            actors_tab: {
                no_data: "Информация об актерах отсутствует",
                unknown: "Неизвестно"
            }
        },
        search: {
            hero_badge: "Поиск фильмов и сериалов",
            placeholder: "Поиск фильмов...",
            recent_searches: "История поиска",
            clear_history: "Очистить историю",
            no_recent: "Нет недавних поисков",
            search_btn: "Поиск",
            filters_btn: "Фильтры",
            year_range: "Года:",
            from: "От",
            to: "До",
            genres: "Жанры:",
            countries: "Страны:",
            clear_filters: "Очистить",
            apply_filters: "Применить",
            results_title: "Результаты поиска",
            found_count: "Найдено {count} фильмов",
            empty_title: "Поиск фильмов",
            empty_text: "Введите название фильма, чтобы начать поиск",
            no_results_title: "Фильмы не найдены",
            no_results_text: "Попробуйте изменить запрос или воспользуйтесь фильтрами",
            prev: "Назад",
            next: "Вперед",
            page_info: "Страница {current} из {total}",
            movie_details_modal: "Детали фильма",
            rate_this: "Оценить",
            movie_detail_btn: "Подробнее",
            close: "Закрыть",
            error_query: "Пожалуйста, введите поисковый запрос",
            error_login: "Пожалуйста, войдите в систему для поиска фильмов",
            error_api: "Ключ Kinopoisk API не настроен. Пожалуйста, проверьте конфигурацию.",
            error_generic: "Произошла ошибка при поиске фильмов",
            error_cyrillic: "Проблема с поиском на кириллице \"{query}\". Попробуйте английское название или другие ключевые слова.",
            error_server: "Сервер временно недоступен. Попробуйте позже или измените запрос.",
            error_not_found: "По вашему запросу ничего не найдено. Попробуйте другие ключевые слова.",
            error_forbidden: "Проблема с доступом к API. Проверьте настройки.",
            error_network: "Проблема с подключением к интернету. Проверьте соединение."
        },
        popup: {
            update: {
                title: "Доступно обновление",
                version: "Новая версия готова",
                btn: "Обновить"
            },
            header: {
                title: "Movie Ratings",
                not_authenticated: "Не авторизован",
                signed_in_as: "Вошли как {user}"
            },
            auth: {
                google_btn: "Продолжить с Google",
                or: "или",
                email_label: "Электронная почта",
                email_placeholder: "Ваш адрес электронной почты",
                password_label: "Пароль",
                password_placeholder: "Ваш пароль",
                login_btn: "Войти",
                register_btn: "Регистрация",
                forgot_password: "Забыли пароль?",
                back: "Назад",
                no_account: "Нет аккаунта?",
                have_account: "Уже есть аккаунт?",
                register_info: "Продолжить",
                first_name_label: "Имя",
                first_name_placeholder: "Ваше имя",
                last_name_label: "Фамилия",
                last_name_placeholder: "Ваша фамилия",
                confirm_password_label: "Повторите пароль",
                confirm_password_placeholder: "Повторите пароль",
                create_account: "Зарегистрироваться",
                password_min_length: "Пароль должен быть не менее 6 символов",
                passwords_dont_match: "Пароли не совпадают",
                fill_all: "Пожалуйста, заполните все поля",
                loading_login: "Вход...",
                loading_register: "Создание аккаунта...",
                loading_checking: "Проверка...",
                loading_google: "Вход через Google..."
            },
            approval: {
                pending_registered_title: "Заявка на рассмотрении",
                pending_registered_msg: "Ваш аккаунт успешно создан и ожидает подтверждения администратором. После одобрения вы получите полный доступ к расширению.",
                pending_login_title: "Аккаунт ожидает подтверждения",
                pending_login_msg: "Ваша регистрация находится на рассмотрении у администратора. Доступ будет открыт сразу после проверки.",
                rejected_title: "Доступ ограничен",
                rejected_msg: "Ваша регистрация была отклонена администратором.",
                back_to_login: "Вернуться ко входу"
            },
            content: {
                search_placeholder: "Поиск фильмов...",
                settings: "Настройки",
                logout: "Выйти",
                recent_ratings: "Недавние оценки",
                view_all: "Все оценки",
                refresh: "Обновить",
                empty_title: "Оценок пока нет",
                empty_text: "Оцените фильмы, чтобы увидеть их здесь!",
                loading: "Загрузка..."
            }
        },
        person_details: {
            loading: "Загрузка информации о персоне...",
            wait: "Пожалуйста, подождите",
            error_title: "Информация не найдена",
            error_text: "Не удалось загрузить информацию о персоне",
            invalid_link: "Неверная ссылка на персону",
            not_found: "Информация о персоне не найдена",
            provider_error: "Временная ошибка сервиса. Попробуйте позже.",
            back: "Назад",
            retry: "Повторить",
            home: "На главную",
            biography: "Биография",
            show_all_bio: "Показать полностью",
            hide_bio: "Скрыть",
            facts: "Факты",
            show_more_facts: "Показать ещё факты",
            hide_facts: "Скрыть",
            known_for: "Известен по",
            previous_movies: "Предыдущие фильмы",
            next_movies: "Следующие фильмы",
            filmography: "Фильмография",
            filmography_empty: "Фильмография недоступна",
            all_media: "Все",
            movies_media: "Фильмы",
            series_media: "Сериалы",
            show_more: "Показать ещё",
            show_less: "Скрыть",
            acting: "Актёрские работы",
            directing: "Режиссура",
            writing: "Сценарии",
            production: "Продюсирование",
            music: "Музыка",
            other: "Другие работы",
            birthday: "Дата рождения",
            birthplace: "Место рождения",
            deathday: "Дата смерти",
            age: "Возраст",
            years_old: "лет",
            years_at_death: "лет на момент смерти",
            aliases: "Другие имена",
            show_more_aliases: "Показать ещё"
        }
    }
};
