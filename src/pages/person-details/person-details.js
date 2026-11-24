/**
 * PersonDetails Page Controller
 * 
 * Manages the PersonDetails UI lifecycle on top of PersonDetailsService:
 * - Reads personKey from query parameters (?personKey=tmdb:{id} | kp:{id})
 * - State machine: loading -> ready -> error
 * - Hero profile rendering with portrait, names, professions, runtime-calculated age, vital metadata, and aliases
 * - Safe biography rendering with collapse/expand toggle (XSS-safe textContent)
 * - Sanitized facts section with expandable toggle
 * - Known For section using MovieCard carousel (max 10, verified KP IDs only)
 * - Filmography: one role at a time (main role first) with media filters, sorting,
 *   the character or job and episode count on every card, and paging by whole rows
 * - Delegated CSP-safe event handling
 */

import { I18n } from '../../shared/i18n/I18n.js';

function createAppError(code, options = {}) {
    const ErrorCtor = globalThis.AppError;
    if (typeof ErrorCtor === 'function') return new ErrorCtor(code, options);
    const fallback = new Error(options.message || code);
    Object.assign(fallback, {
        name: 'AppError',
        code,
        category: options.category || 'unknown',
        retryable: options.retryable !== false,
        params: { ...(options.params || {}) },
        context: { ...(options.context || {}) },
        userMessage: options.userMessage || null,
        cause: options.cause || null
    });
    return fallback;
}

class PersonDetailsPageController {
    static FILMOGRAPHY_CATEGORIES = ['acting', 'directing', 'writing', 'production', 'music', 'self', 'other'];
    static FILMOGRAPHY_SORTS = ['newest', 'oldest', 'rating', 'popular'];
    static FILMOGRAPHY_SORT_KEY = 'personFilmographySortV1';
    // Rows shown at first and added by «Показать ещё»; the cards per row follow the grid.
    static FILMOGRAPHY_ROWS = 4;
    static FALLBACK_COLUMNS = 6;
    // «Self - Host», «Himself», «Играет самого себя»: the words before the actual part.
    static SELF_PREFIX = /^\s*(?:self|him\s*self|her\s*self|them\s*sel(?:f|ves)|(?:играет\s+)?(?:сам(?:ого|у|а)?|самих)\s+себя)\b\s*(?:[-–—:,]\s*)?/i;
    // The job a role tab already names, so a card does not repeat it.
    static CATEGORY_JOBS = {
        acting: ['actor', 'actress', 'acting'],
        directing: ['director', 'режиссер', 'режиссёр'],
        writing: ['writer', 'сценарист'],
        production: ['producer', 'продюсер'],
        music: ['composer', 'композитор', 'original music composer', 'music']
    };

    constructor() {
        this.i18n = window.i18n || new I18n();
        this.personDetailsService = typeof window.PersonDetailsService !== 'undefined'
            ? new window.PersonDetailsService()
            : null;

        // Elements
        this.mainContainer = document.getElementById('personDetailsMain');
        this.loadingState = document.getElementById('loadingState');
        this.errorState = document.getElementById('errorState');
        this.errorTitle = document.getElementById('errorTitle');
        this.errorMessage = document.getElementById('errorMessage');
        this.errorBackBtn = document.getElementById('errorBackBtn');
        this.personContainer = document.getElementById('personDetailsContainer');

        // State
        this.currentPerson = null;
        this.personRequestController = null;
        window.addEventListener?.('pagehide', () => this.personRequestController?.abort());
        // Filmography view: the role tab, 'all' | 'movie' | 'tv', the order and how many rows show.
        this.activeRole = null;
        this.activeMediaFilter = 'all';
        this.activeSort = this.readStoredSort();
        this.filmographyRows = PersonDetailsPageController.FILMOGRAPHY_ROWS;
        this.filmographyColumns = 0;
        this.filmographySortControl = null;
        this.filmographyResizeObserver = null;
        this.filmographyLayoutFrame = null;
        // Character names in Russian in the Russian interface (CharacterNameTranslator).
        this.characterTranslation = null;

        this.isBioExpanded = false;
        this.isFactsExpanded = false;
        this.isAliasesExpanded = false;

        // Awards come from the person's Kinopoisk awards page after the page is shown.
        this.awardsService = null;
        this.personAwards = null;
        this.awardsRequestedFor = null;

        // Known-For carousel lifecycle state
        this.knownForCarousel = null;
        this.knownForResizeObserver = null;
        this.knownForScrollHandler = null;
        this.knownForResizeHandler = null;
        this.knownForUpdateFrame = null;
    }

    /**
     * Initialize page lifecycle.
     */
    async init() {
        try {
            globalThis.quotaTracker?.resetForNewPageLoad();
            await this.i18n.init();
            this.i18n.translatePage();

            // Initialize navigation if available
            if (typeof window.Navigation !== 'undefined') {
                new window.Navigation();
            }

            this.bindGlobalEvents();

            const urlParams = new URLSearchParams(window.location.search);
            const personKey = urlParams.get('personKey');

            if (!personKey || typeof personKey !== 'string' || personKey.trim().length === 0) {
                this.renderError('INVALID_KEY', this.i18n.get('person_details.invalid_link'));
                return;
            }

            const normalizedPersonKey = personKey.trim();
            await this.loadPerson(normalizedPersonKey);
            globalThis.quotaTracker?.logSummary(`Person details: ${normalizedPersonKey}`);
        } catch (err) {
            console.error('PersonDetailsPageController init error:', err);
            this.renderError('UNKNOWN', this.i18n.get('person_details.error_text'), err);
        }
    }

    /**
     * Load person data from PersonDetailsService.
     * @param {string} personKey
     */
    async loadPerson(personKey) {
        this.personRequestController?.abort();
        const request = new AbortController();
        this.personRequestController = request;
        this.personAwards = null;
        this.awardsRequestedFor = null;
        this.showLoading();

        try {
            if (!this.personDetailsService) {
                if (typeof window.PersonDetailsService !== 'undefined') {
                    this.personDetailsService = new window.PersonDetailsService();
                } else {
                    throw new Error('PersonDetailsService is not available');
                }
            }

            const person = await this.personDetailsService.getPersonDetails(personKey, { signal: request.signal });
            if (request.signal.aborted || this.personRequestController !== request) return;
            this.currentPerson = person;

            this.renderPerson(person);
            this.showContent();
            void this.loadPersonAwards(person, request);
            // Start only after the base page is mounted; updates preserve the page and carousel track.
            this.personDetailsService.enrichPersonDetails?.(person, {
                signal: request.signal,
                onUpdate: updated => {
                    if (!request.signal.aborted && this.personRequestController === request) {
                        this.updateEnrichedCards(updated);
                        // A TMDB person gets a Kinopoisk ID only from the enrichment.
                        void this.loadPersonAwards(updated, request);
                    }
                }
            }).catch(error => console.warn('[PersonDetails] Enrichment failed:', error.message));
        } catch (err) {
            if (request.signal.aborted || this.personRequestController !== request) return;
            console.error('Failed to load person details:', err);
            if (err.code === 'INVALID_PERSON_KEY') {
                this.renderError('INVALID_KEY', this.i18n.get('person_details.invalid_link'), err);
            } else if (err.code === 'PERSON_NOT_FOUND' || err.status === 404) {
                this.renderError('NOT_FOUND', this.i18n.get('person_details.not_found'), err);
            } else {
                this.renderError('PROVIDER_ERROR', this.i18n.get('person_details.provider_error'), err);
            }
        }
    }

    /**
     * State Machine: Show loading skeleton.
     */
    showLoading() {
        if (this.loadingState) this.loadingState.style.display = 'flex';
        if (this.errorState) this.errorState.style.display = 'none';
        if (this.personContainer) this.personContainer.style.display = 'none';
    }

    /**
     * State Machine: Show ready content.
     */
    showContent() {
        if (this.loadingState) this.loadingState.style.display = 'none';
        if (this.errorState) this.errorState.style.display = 'none';
        if (this.personContainer) this.personContainer.style.display = 'flex';
        if (typeof Utils !== 'undefined') Utils.revealContent?.(this.personContainer);
    }

    /**
     * State Machine: Show user-friendly error state.
     * @param {string} type
     * @param {string} message
     */
    renderError(type, message, cause = null) {
        if (this.loadingState) this.loadingState.style.display = 'none';
        if (this.personContainer) this.personContainer.style.display = 'none';

        const errorCode = {
            INVALID_KEY: 'INVALID_PERSON_KEY',
            NOT_FOUND: 'PERSON_NOT_FOUND',
            PROVIDER_ERROR: 'PERSON_PROVIDER_ERROR'
        }[type] || 'GENERIC_LOAD_ERROR';
        const normalizedCause = cause && window.errorNormalizer?.normalize?.(cause, {
            operation: 'person-details-load',
            category: 'person'
        });
        const error = normalizedCause && normalizedCause.code !== 'GENERIC_LOAD_ERROR'
            ? normalizedCause
            : createAppError(errorCode, {
                category: 'person',
                retryable: errorCode === 'PERSON_PROVIDER_ERROR',
                userMessage: message,
                cause
            });
        if (window.errorDialog?.show) {
            window.errorDialog.show(error, {
                context: { operation: 'person-details-load', category: 'person' },
                onRetry: () => this.loadPerson(new URLSearchParams(window.location.search).get('personKey')),
                onBack: () => this.goBackFromError()
            });
            if (this.errorState) this.errorState.style.display = 'none';
            return;
        }

        if (this.errorState) {
            this.errorState.style.display = 'flex';
            if (this.errorMessage) {
                this.errorMessage.textContent = message || this.i18n.get('person_details.error_text');
            }
            if (this.errorTitle) {
                if (type === 'NOT_FOUND' || type === 'INVALID_KEY') {
                    this.errorTitle.textContent = this.i18n.get('person_details.error_title');
                } else {
                    this.errorTitle.textContent = this.i18n.get('person_details.error_title');
                }
            }
        }
    }

    goBackFromError() {
        if (window.history.length > 1) {
            window.history.back();
        } else {
            window.location.href = '../home/home.html';
        }
    }

    /**
     * Bind delegated UI event listeners.
     */
    bindGlobalEvents() {
        if (this.errorBackBtn) {
            this.errorBackBtn.addEventListener('click', () => {
                if (window.history.length > 1) {
                    window.history.back();
                } else {
                    window.location.href = '../home/home.html';
                }
            });
        }

        if (this.personContainer) {
            this.personContainer.addEventListener('click', (e) => {
                const target = e.target?.closest?.('.movie-card-component, [data-action="view-details"]');
                if (!target) return;

                const actionTarget = e.target?.closest?.('[data-action="view-details"]');
                console.log('[PersonDetails] Movie card click captured', {
                    phase: 'capture',
                    targetTag: e.target?.tagName || null,
                    cardTag: target.tagName || null,
                    action: actionTarget?.getAttribute('data-action') || null,
                    movieId: actionTarget?.getAttribute('data-movie-id')
                        || target.getAttribute('data-movie-id')
                        || null,
                    href: actionTarget?.getAttribute('href') || null,
                    defaultPrevented: e.defaultPrevented
                });
            }, true);

            this.personContainer.addEventListener('click', (e) => {
                const btn = e.target.closest('button, [data-action]');
                if (!btn) return;

                const action = btn.getAttribute('data-action');
                if (!action) return;

                if (action === 'view-details') {
                    const href = btn.getAttribute('href');
                    const card = btn.closest('.movie-card-component');
                    const movieId = btn.getAttribute('data-movie-id')
                        || card?.getAttribute('data-movie-id')
                        || '';
                    console.log('[PersonDetails] Movie card navigation requested', {
                        targetTag: btn.tagName || null,
                        movieId: movieId || null,
                        href: href || null,
                        cardTag: card?.tagName || null,
                        defaultPrevented: e.defaultPrevented
                    });
                    if ((!href || href === '#') && !movieId) return;

                    e.preventDefault();
                    if (movieId && typeof Utils !== 'undefined' && typeof Utils.openMoviePage === 'function') {
                        console.log('[PersonDetails] Opening movie via Utils.openMoviePage', { movieId });
                        Utils.openMoviePage(movieId, false);
                    } else if (href && href !== '#') {
                        console.log('[PersonDetails] Opening movie via href fallback', { href });
                        window.location.href = href;
                    } else {
                        console.warn('[PersonDetails] Movie card has no usable navigation target', {
                            movieId: movieId || null,
                            href: href || null
                        });
                    }
                } else if (action === 'toggle-bio') {
                    this.toggleBiography();
                } else if (action === 'toggle-facts') {
                    this.toggleFacts();
                } else if (action === 'toggle-aliases') {
                    this.toggleAliases();
                } else if (action === 'filter-filmography') {
                    const filter = btn.getAttribute('data-filter') || 'all';
                    this.setMediaFilter(filter);
                } else if (action === 'filter-filmography-role') {
                    const role = btn.getAttribute('data-role');
                    if (role) this.setFilmographyRole(role);
                } else if (action === 'show-more-category') {
                    const category = btn.getAttribute('data-category');
                    if (category) {
                        this.showMoreCategory(category);
                    }
                } else if (action === 'scroll-known-for-prev') {
                    this.scrollKnownFor(-1);
                } else if (action === 'scroll-known-for-next') {
                    this.scrollKnownFor(1);
                }
            });

            // Delegated CSP-safe image error handler for portrait
            this.personContainer.addEventListener('error', (e) => {
                if (e.target && e.target.classList && e.target.classList.contains('person-hero__portrait')) {
                    const img = e.target;
                    const wrapper = img.closest('.person-hero__portrait-wrapper');
                    if (wrapper) {
                        img.style.display = 'none';
                        let placeholder = wrapper.querySelector('.person-hero__portrait-placeholder');
                        if (!placeholder) {
                            placeholder = document.createElement('div');
                            placeholder.className = 'person-hero__portrait-placeholder';
                            placeholder.innerHTML = `
                                <svg data-icon="USER" aria-hidden="true" width="40" height="40" viewBox="0 0 20 20" fill="none"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M10 2A4 4 0 1 0 10 10A4 4 0 1 0 10 2Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 12C13.6 12 16 13.8 16.6 16.2C16.7 16.7 16.4 17 15.9 17H4.1C3.6 17 3.3 16.7 3.4 16.2C4 13.8 6.4 12 10 12Z"/></svg>
                            `;
                            wrapper.appendChild(placeholder);
                        }
                    }
                }
            }, true);
        }
    }

    /**
     * Render entire person details DOM structure.
     * @param {Object} person - PersonDetailsDTO
     */
    renderPerson(person) {
        if (!this.personContainer || !person) return;

        // Update document title
        const primaryName = person.name || person.originalName || 'Person';
        document.title = `${primaryName} — Movie Rating Extension`;

        // A new person starts on their main role, all media and the first rows.
        this.filmographySortControl?.destroy?.();
        this.filmographySortControl = null;
        this.activeRole = null;
        this.activeMediaFilter = 'all';
        this.filmographyRows = PersonDetailsPageController.FILMOGRAPHY_ROWS;

        const heroHtml = this.renderHero(person);
        const bioHtml = this.renderBiography(person);
        const factsHtml = this.renderFacts(person);
        const knownForHtml = this.renderKnownFor(person);
        const awardsHtml = this.renderAwardsSection(this.personAwards);
        const filmographyHtml = this.renderFilmography(person);

        // Who the person is, what they are known for and won, everything they made,
        // and the trivia last.
        this.personContainer.innerHTML = `
            ${heroHtml}
            ${bioHtml}
            ${knownForHtml}
            ${awardsHtml}
            ${filmographyHtml}
            ${factsHtml}
        `;

        // Before the cards mount: the previous render's translation must not reach them.
        this.setupCharacterTranslation();
        // Post-render: Mount MovieCard instances in KnownFor and Filmography
        this.refreshPlaceholderPosters(person);
        this.mountMovieCards(person);
        this.bindFilmographyControls();
        if (typeof Utils !== 'undefined') Utils.bindImageReveal?.(this.personContainer, '.person-hero__portrait');
    }

    /**
     * Character names in Russian by themselves in the Russian interface: TMDB and
     * Kinopoisk keep foreign characters in their original spelling, and Chrome's
     * on-device translator shows them in Russian (CharacterNameTranslator).
     */
    setupCharacterTranslation() {
        this.characterTranslation?.destroy();
        this.characterTranslation = null;
        const Translator = typeof window !== 'undefined' ? window.CharacterNameTranslator : null;
        if (typeof Translator?.shared !== 'function' || this.i18n.currentLocale !== 'ru') return;
        this.characterTranslation = Translator.shared().autoTranslate({
            elements: () => this.personContainer?.querySelectorAll?.('.person-credit__role') || [],
            originalLabel: name => this.i18n.get('character_names.original_title').replace('{name}', name)
        });
    }

    /**
     * Render Hero Section.
     * @param {Object} person
     * @returns {string}
     */
    renderHero(person) {
        const isEnglish = this.i18n.currentLocale === 'en';
        const primaryName = isEnglish && person.originalName ? person.originalName : (person.name || person.originalName || 'Unknown');
        const secondaryName = person.originalName && person.originalName.trim().toLowerCase() !== primaryName.trim().toLowerCase()
            ? person.originalName.trim()
            : null;

        // Professions (max 4, unique)
        const rawProfessions = Array.isArray(person.professions) ? person.professions : [];
        const professions = Array.from(new Set(rawProfessions.map(p => typeof p === 'string' ? p.trim() : '').filter(Boolean))).slice(0, 4);

        // Age calculation
        const age = this.calculatePersonAge(person.birthday, person.deathday);
        const isDeceased = Boolean(person.deathday);

        // Aliases (max 3 initial)
        const rawAliases = Array.isArray(person.aliases) ? person.aliases : [];
        const aliases = rawAliases.filter(a => a && typeof a === 'string' && a.trim() !== primaryName && a.trim() !== secondaryName);

        const facts = [];
        if (person.birthday) {
            const ageText = age !== null && !isDeceased ? ` · ${this.formatAge(age)}` : '';
            facts.push([this.i18n.get('person_details.birthday'), `${this.formatPersonDate(person.birthday)}${ageText}`]);
        }
        if (person.deathday) {
            const ageText = age !== null ? ` · ${this.i18n.get('person_details.at_death').replace('{age}', this.formatAge(age))}` : '';
            facts.push([this.i18n.get('person_details.deathday'), `${this.formatPersonDate(person.deathday)}${ageText}`]);
        }
        if (person.birthplace) facts.push([this.i18n.get('person_details.birthplace'), person.birthplace]);

        return `
            <header class="person-hero" aria-label="${this.escapeHtml(primaryName)}">
                <div class="person-hero__portrait-wrapper">
                    ${person.photoUrl ? `
                    <img src="${this.escapeHtml(person.photoUrl)}" alt="${this.escapeHtml(primaryName)}" class="person-hero__portrait" decoding="async">
                    ` : `
                    <div class="person-hero__portrait-placeholder">
                        <svg data-icon="USER" aria-hidden="true" width="40" height="40" viewBox="0 0 20 20" fill="none"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M10 2A4 4 0 1 0 10 10A4 4 0 1 0 10 2Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 12C13.6 12 16 13.8 16.6 16.2C16.7 16.7 16.4 17 15.9 17H4.1C3.6 17 3.3 16.7 3.4 16.2C4 13.8 6.4 12 10 12Z"/></svg>
                    </div>
                    `}
                </div>
                <div class="person-hero__info">
                    <div class="person-hero__names">
                        <h1 class="person-hero__name">${this.escapeHtml(primaryName)}</h1>
                        ${secondaryName ? `<p class="person-hero__original-name">${this.escapeHtml(secondaryName)}</p>` : ''}
                    </div>

                    ${professions.length > 0 ? `
                    <p class="person-hero__professions">${professions.map(p => this.escapeHtml(p)).join(' · ')}</p>
                    ` : ''}

                    ${facts.length > 0 ? `
                    <dl class="person-hero__facts">
                        ${facts.map(([label, value]) => `<div class="person-hero__fact"><dt>${this.escapeHtml(label)}</dt><dd>${this.escapeHtml(value)}</dd></div>`).join('')}
                    </dl>
                    ` : ''}

                    <a class="person-hero__awards" id="personHeroAwards" href="#personAwardsSection" hidden></a>

                    ${aliases.length > 0 ? `
                    <div class="person-hero__aliases">
                        <span class="person-hero__aliases-label">${this.escapeHtml(this.i18n.get('person_details.aliases'))}</span>
                        <div class="person-aliases-list" id="personAliasesList">
                            ${aliases.slice(0, 3).map(a => `<span class="person-alias-tag">${this.escapeHtml(a)}</span>`).join('')}
                            ${aliases.length > 3 ? `
                            <span class="person-aliases-remaining" id="personAliasesRemaining" hidden>
                                ${aliases.slice(3).map(a => `<span class="person-alias-tag">${this.escapeHtml(a)}</span>`).join('')}
                            </span>
                            <button type="button" class="btn-toggle-aliases" data-action="toggle-aliases" aria-expanded="false" aria-controls="personAliasesRemaining">
                                +${aliases.length - 3} ${this.escapeHtml(this.i18n.get('person_details.show_more_aliases'))}
                            </button>
                            ` : ''}
                        </div>
                    </div>
                    ` : ''}
                </div>
            </header>
        `;
    }

    /**
     * Render Biography Section.
     * @param {Object} person
     * @returns {string}
     */
    renderBiography(person) {
        const bio = (person.biography || '').trim();
        if (!bio) return '';

        const isLong = bio.length > 400 || bio.split('\n').length > 5;

        return `
            <section class="person-section" id="biographySection" aria-labelledby="biographyHeading">
                <div class="person-section__header">
                    <h2 class="person-section__title" id="biographyHeading">${this.escapeHtml(this.i18n.get('person_details.biography'))}</h2>
                </div>
                <div class="person-bio__card">
                    <div class="person-bio__text ${isLong ? 'person-bio__text--clamped' : ''}" id="personBioText">
                        ${bio.split(/\n+/).map(p => `<p>${this.renderBiographyParagraph(p)}</p>`).join('')}
                    </div>
                    ${isLong ? `
                    <button type="button" class="btn-toggle-bio" data-action="toggle-bio" aria-expanded="false" aria-controls="personBioText">
                        <span>${this.escapeHtml(this.i18n.get('person_details.show_all_bio'))}</span>
                    </button>
                    ` : ''}
                </div>
            </section>
        `;
    }

    /**
     * Replace provider emoji markers with the page's outline icon language.
     * @param {string} paragraph
     * @returns {string}
     */
    renderBiographyParagraph(paragraph) {
        const escaped = this.escapeHtml(paragraph.trim());
        const iconMap = {
            '🌟': this.getBiographyIcon('star'),
            '⭐': this.getBiographyIcon('star'),
            '✨': this.getBiographyIcon('star'),
            '💥': this.getBiographyIcon('star'),
            '🏆': this.getBiographyIcon('award'),
            '🏅': this.getBiographyIcon('award'),
            '🎬': this.getBiographyIcon('film'),
            '🎥': this.getBiographyIcon('film'),
            '🎞️': this.getBiographyIcon('film'),
            '🎭': this.getBiographyIcon('film')
        };

        return escaped.replace(/🌟|⭐|✨|💥|🏆|🏅|🎬|🎥|🎞️|🎭/gu, emoji => iconMap[emoji] || '');
    }

    /**
     * Return a small accessible outline icon for biography metadata markers.
     * @param {'star'|'award'|'film'} type
     * @returns {string}
     */
    getBiographyIcon(type) {
        const fallbackIcons = {
            star: '<svg class="person-bio__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>',
            award: '<svg data-icon="TROPHY" class="person-bio__icon" aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 3H14V8A4 4 0 0 1 6 8Z"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M10 3L10 12C12.21 12 14 10.21 14 8L14 3L10 3Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 5H2.6V5.6A3.6 3.6 0 0 0 6.2 9.2M14 5H17.4V5.6A3.6 3.6 0 0 1 13.8 9.2M10 12V16M6 17H14"/></svg>',
            film: '<svg data-icon="FILM" class="person-bio__icon" aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M5 3H15A3 3 0 0 1 18 6V14A3 3 0 0 1 15 17H5A3 3 0 0 1 2 14V6A3 3 0 0 1 5 3ZM7.5 5H12.5A0.5 0.5 0 0 1 13 5.5V8.5A0.5 0.5 0 0 1 12.5 9H7.5A0.5 0.5 0 0 1 7 8.5V5.5A0.5 0.5 0 0 1 7.5 5ZM7.5 11H12.5A0.5 0.5 0 0 1 13 11.5V14.5A0.5 0.5 0 0 1 12.5 15H7.5A0.5 0.5 0 0 1 7 14.5V11.5A0.5 0.5 0 0 1 7.5 11ZM4 5H5A0.5 0.5 0 0 1 5.5 5.5V6.5A0.5 0.5 0 0 1 5 7H4A0.5 0.5 0 0 1 3.5 6.5V5.5A0.5 0.5 0 0 1 4 5ZM4 9H5A0.5 0.5 0 0 1 5.5 9.5V10.5A0.5 0.5 0 0 1 5 11H4A0.5 0.5 0 0 1 3.5 10.5V9.5A0.5 0.5 0 0 1 4 9ZM4 13H5A0.5 0.5 0 0 1 5.5 13.5V14.5A0.5 0.5 0 0 1 5 15H4A0.5 0.5 0 0 1 3.5 14.5V13.5A0.5 0.5 0 0 1 4 13ZM15 5H16A0.5 0.5 0 0 1 16.5 5.5V6.5A0.5 0.5 0 0 1 16 7H15A0.5 0.5 0 0 1 14.5 6.5V5.5A0.5 0.5 0 0 1 15 5ZM15 9H16A0.5 0.5 0 0 1 16.5 9.5V10.5A0.5 0.5 0 0 1 16 11H15A0.5 0.5 0 0 1 14.5 10.5V9.5A0.5 0.5 0 0 1 15 9ZM15 13H16A0.5 0.5 0 0 1 16.5 13.5V14.5A0.5 0.5 0 0 1 16 15H15A0.5 0.5 0 0 1 14.5 14.5V13.5A0.5 0.5 0 0 1 15 13Z"/></svg>'
        };

        const sharedIcon = typeof Icons !== 'undefined' && type === 'star'
            ? Icons.STAR
            : (typeof Icons !== 'undefined' && type === 'film' ? Icons.MOVIE_CLAPPER : null);

        if (!sharedIcon) return fallbackIcons[type] || '';
        return sharedIcon.replace('<svg ', '<svg class="person-bio__icon" aria-hidden="true" ');
    }

    /**
     * Render Facts Section.
     * @param {Object} person
     * @returns {string}
     */
    renderFacts(person) {
        const facts = Array.isArray(person.facts) ? person.facts.filter(f => f && typeof f === 'string' && f.trim().length > 0) : [];
        if (facts.length === 0) return '';

        const initialFacts = facts.slice(0, 5);
        const remainingFacts = facts.slice(5);

        return `
            <section class="person-section" id="factsSection" aria-labelledby="factsHeading">
                <div class="person-section__header">
                    <h2 class="person-section__title" id="factsHeading">
                        <span>${this.escapeHtml(this.i18n.get('person_details.facts'))}</span>
                        <span class="person-section__count">${facts.length}</span>
                    </h2>
                </div>
                <ul class="person-facts__list" id="personFactsList">
                    ${initialFacts.map(fact => `
                    <li class="person-fact-item">
                        <span>${this.escapeHtml(fact)}</span>
                    </li>
                    `).join('')}
                </ul>
                ${remainingFacts.length > 0 ? `
                <ul class="person-facts__list person-facts__list--remaining is-collapsed" id="personFactsRemaining">
                    ${remainingFacts.map(fact => `
                    <li class="person-fact-item">
                        <span>${this.escapeHtml(fact)}</span>
                    </li>
                    `).join('')}
                </ul>
                <button type="button" class="btn-toggle-facts" data-action="toggle-facts" aria-expanded="false" aria-controls="personFactsRemaining">
                    <span>${this.escapeHtml(this.i18n.get('person_details.show_more_facts'))} (${remainingFacts.length})</span>
                </button>
                ` : ''}
            </section>
        `;
    }

    /**
     * Render Known For Carousel Section.
     * @param {Object} person
     * @returns {string}
     */
    renderKnownFor(person) {
        const knownFor = Array.isArray(person.knownFor) ? person.knownFor : [];
        // Omit section if less than 3 items
        if (knownFor.length < 3) return '';

        const previousIcon = typeof Icons !== 'undefined' && Icons.CHEVRON_LEFT
            ? Icons.CHEVRON_LEFT
            : '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg>';
        const nextIcon = typeof Icons !== 'undefined' && Icons.CHEVRON_RIGHT
            ? Icons.CHEVRON_RIGHT
            : '<svg data-icon="CHEVRON_RIGHT" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7.5 5L12.5 10L7.5 15"/></svg>';

        return `
            <section class="person-section" id="knownForSection" aria-labelledby="knownForHeading">
                <div class="person-section__header">
                    <h2 class="person-section__title" id="knownForHeading">
                        <span>${this.escapeHtml(this.i18n.get('person_details.known_for'))}</span>
                        <span class="person-section__count">${knownFor.length}</span>
                    </h2>
                </div>
                <div class="known-for-carousel-wrapper">
                    <button type="button" class="carousel-nav-btn carousel-nav-btn--prev" data-action="scroll-known-for-prev" aria-label="${this.escapeHtml(this.i18n.get('person_details.previous_movies'))}">
                        ${previousIcon}
                    </button>
                    <div class="known-for-carousel" id="knownForCarousel" tabindex="0" role="region" aria-label="${this.escapeHtml(this.i18n.get('person_details.known_for'))}">
                        <!-- MovieCards mounted dynamically in mountMovieCards -->
                    </div>
                    <button type="button" class="carousel-nav-btn carousel-nav-btn--next" data-action="scroll-known-for-next" aria-label="${this.escapeHtml(this.i18n.get('person_details.next_movies'))}">
                        ${nextIcon}
                    </button>
                </div>
            </section>
        `;
    }

    /**
     * «11 ноября 1974» from '1974-11-11'; a year alone stays a year.
     * @param {string} value
     * @returns {string}
     */
    formatPersonDate(value) {
        const text = String(value || '').trim();
        const match = text.match(/^(\d{4})(?:-(\d{2})-(\d{2}))?/);
        if (!match) return text;
        if (!match[2]) return match[1];
        const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
        if (Number.isNaN(date.getTime())) return text;
        try {
            const locale = this.i18n.currentLocale === 'en' ? 'en-GB' : 'ru-RU';
            return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
                .format(date)
                .replace(/\s*г\.$/, '');
        } catch {
            return text;
        }
    }

    /**
     * «52 года» / «52 years».
     * @param {number} age
     * @returns {string}
     */
    formatAge(age) {
        const forms = this.i18n.get('person_details.age_years');
        if (!forms || typeof forms !== 'object') return `${age} ${this.i18n.get('person_details.years_old')}`;
        const pluralCategory = () => {
            try {
                return new Intl.PluralRules(this.i18n.currentLocale || 'ru').select(age);
            } catch {
                return 'other';
            }
        };
        return (forms[pluralCategory()] || forms.other).replace('{count}', String(age));
    }

    /**
     * The person's Kinopoisk ID: the route's own for a Kinopoisk person, the one the
     * enrichment matched by name and birthday for a TMDB person.
     * @param {Object} person
     * @returns {number|null}
     */
    getKinopoiskPersonId(person) {
        const id = Number(person?.identity?.kpPersonId) || Number(person?._meta?.kpPersonMatch?.id);
        return Number.isSafeInteger(id) && id > 0 ? id : null;
    }

    /**
     * Awards section. It stays hidden until the person's awards have loaded, and for a
     * person without awards it is never shown.
     * @param {Array|null} awards
     * @returns {string}
     */
    renderAwardsSection(awards) {
        const content = this.renderAwardsContent(awards);
        return `<section class="person-section person-awards" id="personAwardsSection" aria-labelledby="personAwardsHeading"${content ? '' : ' hidden'}>${content}</section>`;
    }

    renderAwardsContent(awards) {
        if (!Array.isArray(awards) || awards.length === 0 || typeof window.AwardsList === 'undefined') return '';
        return `
            <div class="person-section__header">
                <h2 class="person-section__title" id="personAwardsHeading">
                    <span>${this.escapeHtml(this.i18n.get('person_details.awards'))}</span>
                    <span class="person-section__count">${awards.length}</span>
                </h2>
            </div>
            ${window.AwardsList.render(awards, { mode: 'person', i18n: this.i18n, idPrefix: 'personAwards' })}
        `;
    }

    async loadPersonAwards(person, request) {
        const kpId = this.getKinopoiskPersonId(person);
        if (!kpId || this.awardsRequestedFor === kpId) return;
        this.awardsRequestedFor = kpId;
        if (!this.awardsService && typeof window.AwardsParsingService !== 'undefined') {
            this.awardsService = new window.AwardsParsingService();
        }
        if (!this.awardsService?.getPersonAwards) return;

        try {
            const awards = await this.awardsService.getPersonAwards(kpId, { signal: request?.signal });
            if (request?.signal?.aborted || (request && this.personRequestController !== request)) return;
            if (!Array.isArray(awards) || awards.length === 0) return;
            this.personAwards = awards;
            this.mountPersonAwards(awards);
        } catch (error) {
            console.warn('[PersonDetails] Awards failed:', error?.message || error);
        }
    }

    mountPersonAwards(awards) {
        const section = document.getElementById('personAwardsSection');
        const content = this.renderAwardsContent(awards);
        if (!section || !content) return;
        section.innerHTML = content;
        section.hidden = false;

        const heroLink = document.getElementById('personHeroAwards');
        if (heroLink && typeof window.AwardsList?.summaryHtml === 'function') {
            heroLink.innerHTML = `${this.getBiographyIcon('award').replace('class="person-bio__icon" ', '')}<span>${window.AwardsList.summaryHtml(awards, this.i18n)}</span>`;
            heroLink.hidden = false;
        }
    }

    /**
     * Render Filmography Section.
     * @param {Object} person
     * @returns {string}
     */
    renderFilmography(person) {
        const state = this.getFilmographyState(person);

        // Artwork and navigation are separate concerns. Keep provider-backed items visible
        // even when TMDB -> KP mapping is unresolved.
        if (state.roles.length === 0) {
            return `
                <section class="person-section" id="filmographySection" aria-labelledby="filmographyHeading">
                    <div class="person-section__header">
                        <h2 class="person-section__title" id="filmographyHeading">${this.escapeHtml(this.i18n.get('person_details.filmography'))}</h2>
                    </div>
                    <div class="filmography-empty-message">
                        <p>${this.escapeHtml(this.i18n.get('person_details.filmography_empty'))}</p>
                    </div>
                </section>
            `;
        }

        const count = value => `<span class="filmography-choice__count" data-count>${value}</span>`;
        const roleChoices = state.roles.length > 1 ? `
            <div class="filmography-roles filter-choices" role="group" aria-label="${this.escapeHtml(this.i18n.get('person_details.role_filter'))}">
                ${state.roles.map(role => `
                <button type="button" class="filmography-role-choice filter-choice ${role.category === state.role ? 'is-active' : ''}" aria-pressed="${role.category === state.role}" data-action="filter-filmography-role" data-role="${role.category}">
                    <span>${this.escapeHtml(this.getFilmographyRoleLabel(role.category))}</span>${count(role.items.length)}
                </button>
                `).join('')}
            </div>
        ` : '';
        const mediaChoice = (filter, labelKey) => `
                    <button type="button" class="filmography-filter-pill filter-choice ${state.mediaFilter === filter ? 'active is-active' : ''}" aria-pressed="${state.mediaFilter === filter}" data-action="filter-filmography" data-filter="${filter}"${filter !== 'all' && state.mediaCounts[filter] === 0 ? ' disabled' : ''}>
                        <span>${this.escapeHtml(this.i18n.get(labelKey))}</span>${count(state.mediaCounts[filter])}
                    </button>`;
        const sortOptions = this.getFilmographySortOptions(person)
            .map(sort => `<option value="${sort}"${sort === state.sort ? ' selected' : ''}>${this.escapeHtml(this.i18n.get(`person_details.sort_${sort}`))}</option>`)
            .join('');

        return `
            <section class="person-section person-filmography" id="filmographySection" aria-labelledby="filmographyHeading">
                <div class="person-section__header">
                    <h2 class="person-section__title" id="filmographyHeading">
                        <span>${this.escapeHtml(this.i18n.get('person_details.filmography'))}</span>
                        <span class="person-section__count" id="filmographyTotal">${state.total}</span>
                    </h2>
                </div>
                <div class="filmography-toolbar">
                    ${roleChoices}
                    <div class="filmography-toolbar__row">
                        <div class="filmography-controls filter-choices" role="group" aria-label="${this.escapeHtml(this.i18n.get('person_details.media_filter'))}">
                            ${mediaChoice('all', 'person_details.all_media')}
                            ${mediaChoice('movie', 'person_details.movies_media')}
                            ${mediaChoice('tv', 'person_details.series_media')}
                        </div>
                        <label class="filmography-sort">
                            <span class="filmography-sort__label">${this.escapeHtml(this.i18n.get('person_details.sort_label'))}</span>
                            <select class="filmography-sort__select" id="filmographySort">${sortOptions}</select>
                        </label>
                    </div>
                </div>
                <div class="filmography-categories-container" id="filmographyCategoriesContainer">
                    ${this.renderFilmographyCategories(person)}
                </div>
            </section>
        `;
    }

    /**
     * The grid of the role tab in view, with its «show more» button. Cards are
     * mounted into it by syncFilmographyGrid.
     * @param {Object} person
     * @returns {string}
     */
    renderFilmographyCategories(person) {
        const state = this.getFilmographyState(person);
        if (!state.role || state.items.length === 0) {
            return `
                <div class="filmography-empty-message">
                    <p>${this.escapeHtml(this.i18n.get('person_details.filmography_empty'))}</p>
                </div>
            `;
        }

        const remaining = Math.max(0, state.items.length - this.getFilmographyVisibleLimit());
        return `
            <div class="filmography-category" data-category="${state.role}">
                <h3 class="filmography-category__title">${this.escapeHtml(this.getFilmographyRoleLabel(state.role))}</h3>
                <div class="filmography-grid" id="filmographyGrid_${state.role}">
                    <!-- MovieCards mounted dynamically in syncFilmographyGrid -->
                </div>
                <button type="button" class="btn btn-secondary btn-show-more-filmography" data-action="show-more-category" data-category="${state.role}"${remaining > 0 ? '' : ' hidden'}>
                    ${this.escapeHtml(this.formatShowMore(Math.min(remaining, this.getFilmographyPageStep())))}
                </button>
            </div>
        `;
    }

    /**
     * Everything the filmography shows for the current choices: the roles in order
     * (main role first) with their titles, the role in view, its titles per media
     * type, and the titles of the current filter in the current order.
     * @param {Object} person
     * @returns {{roles: Array<{category: string, items: Array}>, role: string|null, mediaFilter: string, mediaCounts: Object, items: Array, sort: string, total: number}}
     */
    getFilmographyState(person) {
        const filmography = person?.filmography || {};
        const roles = PersonDetailsPageController.FILMOGRAPHY_CATEGORIES
            .map(category => ({ category, items: this.uniqueFilmographyItems(filmography[category]) }))
            .filter(role => role.items.length > 0);
        const primary = this.getPrimaryFilmographyRole(person, roles);
        if (primary) roles.sort((a, b) => (b.category === primary) - (a.category === primary));

        const role = roles.some(entry => entry.category === this.activeRole) ? this.activeRole : (roles[0]?.category || null);
        const roleItems = roles.find(entry => entry.category === role)?.items || [];
        const mediaCounts = { all: roleItems.length, movie: 0, tv: 0 };
        for (const item of roleItems) mediaCounts[this.creditMediaType(item)]++;
        // A filter with nothing in this role falls back to all titles.
        const mediaFilter = this.activeMediaFilter !== 'all' && mediaCounts[this.activeMediaFilter] > 0 ? this.activeMediaFilter : 'all';
        const sort = this.getFilmographySortOptions(person).includes(this.activeSort) ? this.activeSort : 'newest';
        const items = this.sortFilmographyItems(
            mediaFilter === 'all' ? roleItems : roleItems.filter(item => this.creditMediaType(item) === mediaFilter),
            sort
        );
        const total = new Set(roles.flatMap(entry => entry.items.map(item => this.personMediaKey(item)))).size;
        return { roles, role, mediaFilter, mediaCounts, items, sort, total };
    }

    uniqueFilmographyItems(items) {
        const seen = new Set();
        return (Array.isArray(items) ? items : []).filter(item => {
            if (!this.isRenderableFilmographyItem(item)) return false;
            const key = this.personMediaKey(item);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    /**
     * The role the person is known for, so a director's page opens on directing:
     * TMDB's department, a Kinopoisk person's first profession, otherwise the role
     * with the most titles (appearances as themselves count last).
     * @param {Object} person
     * @param {Array<{category: string, items: Array}>} roles
     * @returns {string|null}
     */
    getPrimaryFilmographyRole(person, roles) {
        const present = new Set(roles.map(role => role.category));
        const department = {
            acting: 'acting', directing: 'directing', writing: 'writing', production: 'production', sound: 'music'
        }[String(person?.knownForDepartment || '').toLowerCase()];
        if (department && present.has(department)) return department;

        const profession = String(person?.professions?.[0] || '').toLowerCase();
        const byProfession = [
            [/акт[её]р|актриса|actor|actress/, 'acting'],
            [/режисс[её]р|director/, 'directing'],
            [/сценарист|writer/, 'writing'],
            [/продюсер|producer/, 'production'],
            [/композитор|composer/, 'music']
        ].find(([pattern]) => pattern.test(profession))?.[1];
        if (byProfession && present.has(byProfession)) return byProfession;

        const candidates = roles.filter(role => role.category !== 'self');
        return (candidates.length > 0 ? candidates : roles)
            .reduce((best, role) => (!best || role.items.length > best.items.length ? role : best), null)?.category || null;
    }

    getFilmographyRoleLabel(category) {
        return this.i18n.get(`person_details.${category}`);
    }

    /**
     * Orders a person can sort by. Popularity needs vote counts, which only TMDB has.
     * @param {Object} person
     * @returns {string[]}
     */
    getFilmographySortOptions(person) {
        const hasVotes = Object.values(person?.filmography || {}).flat().some(item => Number(item?.voteCount) > 0);
        return PersonDetailsPageController.FILMOGRAPHY_SORTS.filter(sort => sort !== 'popular' || hasVotes);
    }

    readStoredSort() {
        try {
            const value = globalThis.localStorage?.getItem(PersonDetailsPageController.FILMOGRAPHY_SORT_KEY);
            return PersonDetailsPageController.FILMOGRAPHY_SORTS.includes(value) ? value : 'newest';
        } catch {
            return 'newest';
        }
    }

    creditMediaType(item) {
        return String(item?.providerMediaType || 'movie').toLowerCase() === 'tv' ? 'tv' : 'movie';
    }

    /**
     * The release date a credit sorts by: TMDB's full date, otherwise 1 January of
     * its year (a Kinopoisk film often has only a year, and sometimes not even that).
     * @param {Object} item
     * @returns {string|null}
     */
    creditDate(item) {
        const date = String(item?.releaseDate || '').match(/^\d{4}-\d{2}-\d{2}/)?.[0];
        if (date) return date;
        const year = Number(item?.year);
        return Number.isInteger(year) && year > 0 ? `${year}-01-01` : null;
    }

    todayIsoDate() {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }

    /**
     * A title not out yet: a TMDB premiere after today, or a later year. Kinopoisk
     * gives only years, so its current-year films are never called announced.
     * @param {Object} item
     * @returns {boolean}
     */
    isUpcomingCredit(item) {
        const year = Number(item?.year);
        if (Number(item?.tmdbId) > 0 && /^\d{4}-\d{2}-\d{2}/.test(String(item?.releaseDate || ''))) {
            return String(item.releaseDate).slice(0, 10) > this.todayIsoDate();
        }
        return Number.isInteger(year) && year > new Date().getFullYear();
    }

    /**
     * Sorts a role's titles. Newest first lists TMDB titles without a date at the top,
     * where TMDB keeps work in production; a Kinopoisk title without a year is
     * unknown, not upcoming, and goes last in every order. Ratings are TMDB's
     * weighted toward the average for few votes, or Kinopoisk's own.
     * @param {Array<Object>} items
     * @param {string} sort
     * @returns {Array<Object>}
     */
    sortFilmographyItems(items, sort = 'newest') {
        const titleOf = item => String(item?.name || item?.originalName || '');
        const votesOf = item => Number(item?.voteCount) || 0;
        const ratingOf = item => {
            const rating = Number(item?.rating) || 0;
            if (rating <= 0) return null;
            if (!(Number(item?.tmdbId) > 0)) return rating;
            const votes = votesOf(item);
            if (votes <= 0) return null;
            const weight = 100;
            return (votes / (votes + weight)) * rating + (weight / (votes + weight)) * 6.5;
        };
        const dated = items.map(item => ({
            item,
            date: this.creditDate(item),
            // TMDB keeps a date off titles still in production.
            upcoming: !this.creditDate(item) && Number(item?.tmdbId) > 0
        }));
        const groupOf = entry => {
            if (entry.date) return 1;
            return entry.upcoming ? (sort === 'oldest' ? 2 : 0) : 3;
        };
        const byDate = (a, b, direction) => {
            const group = groupOf(a) - groupOf(b);
            if (group !== 0) return group;
            if (a.date && b.date && a.date !== b.date) return direction * a.date.localeCompare(b.date);
            return votesOf(b.item) - votesOf(a.item) || titleOf(a.item).localeCompare(titleOf(b.item), 'ru');
        };
        const byNumber = (a, b, value) => {
            const left = value(a.item);
            const right = value(b.item);
            if (left === null && right === null) return byDate(a, b, -1);
            if (left === null) return 1;
            if (right === null) return -1;
            return right - left || byDate(a, b, -1);
        };
        const compare = {
            newest: (a, b) => byDate(a, b, -1),
            oldest: (a, b) => byDate(a, b, 1),
            rating: (a, b) => byNumber(a, b, ratingOf),
            popular: (a, b) => byNumber(a, b, item => (votesOf(item) > 0 ? votesOf(item) + (Number(item?.popularity) || 0) / 1000 : null))
        }[sort] || ((a, b) => byDate(a, b, -1));
        return dated.sort(compare).map(entry => entry.item);
    }

    /**
     * Cards shown: whole rows of the grid, so the last row is never left ragged.
     * @returns {number}
     */
    getFilmographyVisibleLimit() {
        const columns = this.filmographyColumns || PersonDetailsPageController.FALLBACK_COLUMNS;
        return Math.max(1, columns * this.filmographyRows);
    }

    /** Cards one «Показать ещё» adds. */
    getFilmographyPageStep() {
        return (this.filmographyColumns || PersonDetailsPageController.FALLBACK_COLUMNS) * PersonDetailsPageController.FILMOGRAPHY_ROWS;
    }

    /**
     * Columns the grid lays out now, or 0 while it is not laid out (a hidden page).
     * @param {HTMLElement} grid
     * @returns {number}
     */
    measureFilmographyColumns(grid) {
        if (!grid || typeof window.getComputedStyle !== 'function') return 0;
        const tracks = String(window.getComputedStyle(grid).gridTemplateColumns || '').trim().split(/\s+/).filter(Boolean);
        return tracks.length > 0 && tracks.every(track => /^\d+(?:\.\d+)?px$/.test(track)) ? tracks.length : 0;
    }

    formatShowMore(count) {
        const template = this.i18n.get('person_details.show_more_count');
        return typeof template === 'string' && template.includes('{count}')
            ? template.replace('{count}', String(count))
            : `${this.i18n.get('person_details.show_more')} (${count})`;
    }

    /**
     * «8 эпизодов» / «8 episodes».
     * @param {number|null} count
     * @returns {string}
     */
    formatEpisodes(count) {
        const episodes = Number(count);
        if (!Number.isInteger(episodes) || episodes <= 0) return '';
        const forms = this.i18n.get('person_details.episodes');
        if (!forms || typeof forms !== 'object') return String(episodes);
        let category = 'other';
        try {
            category = new Intl.PluralRules(this.i18n.currentLocale || 'ru').select(episodes);
        } catch { /* The plural form only picks a word. */ }
        return (forms[category] || forms.other || '{count}').replace('{count}', String(episodes));
    }

    /**
     * What the person did on a title: the characters for a role, the precise job
     * for crew («Исполнительный продюсер», «Роман») when the tab does not already
     * say it, without the «Self» of an appearance as themselves.
     * @param {Object} item
     * @returns {string}
     */
    creditRoleText(item) {
        const category = item?.category;
        if (category === 'acting' || category === 'self') {
            // Kinopoisk's Cyrillic name where it has one (Russian productions); TMDB and
            // Kinopoisk both keep a foreign character in its original spelling. TMDB's
            // «(voice)»-style notes stay with the Kinopoisk name.
            let character = item?.character;
            if (this.i18n.currentLocale !== 'en' && item?.characterLocal) {
                const notes = /\(/.test(item.characterLocal) ? [] : (String(item?.character || '').match(/\((?:voice|uncredited|archive footage)\)/gi) || []);
                character = [item.characterLocal, ...new Set(notes.map(note => note.toLowerCase()))].join(' ');
            }
            const parts = String(character || '').split(' / ')
                .map(part => (category === 'self' ? part.replace(PersonDetailsPageController.SELF_PREFIX, '') : part).trim())
                .filter(Boolean)
                // Kinopoisk writes some parts in lower case («отец»).
                .map(part => part.charAt(0).toLocaleUpperCase() + part.slice(1));
            return this.localizeCreditNotes([...new Set(parts)].join(' / '));
        }
        const jobs = (Array.isArray(item?.jobs) && item.jobs.length > 0 ? item.jobs : [item?.job])
            .map(job => String(job || '').trim())
            .filter(job => job && !(PersonDetailsPageController.CATEGORY_JOBS[category] || []).includes(job.toLowerCase()));
        return [...new Set(jobs.map(job => this.localizeJob(job)))].slice(0, 3).join(', ');
    }

    localizeJob(job) {
        const jobs = this.i18n.get('person_details.jobs');
        const label = jobs && typeof jobs === 'object' ? jobs[job.toLowerCase()] : null;
        return label || job.charAt(0).toLocaleUpperCase() + job.slice(1);
    }

    /**
     * «(voice)», «(uncredited)» and «(archive footage)» in TMDB's characters, in the
     * interface language.
     * @param {string} text
     * @returns {string}
     */
    localizeCreditNotes(text) {
        const notes = this.i18n.get('person_details.credit_notes');
        if (!text || !notes || typeof notes !== 'object') return text || '';
        return text.replace(/\((voice|uncredited|archive footage)\)/gi, (match, note) => {
            const label = notes[note.toLowerCase().replace(' ', '_')];
            return label ? `(${label})` : match;
        });
    }

    /**
     * Mount MovieCard component instances into Known-For carousel and Filmography grids.
     * @param {Object} person
     */
    mountMovieCards(person) {
        if (!person) return;

        // 1. Mount Known For cards
        const knownForContainer = document.getElementById('knownForCarousel');
        if (knownForContainer && Array.isArray(person.knownFor) && person.knownFor.length >= 3) {
            knownForContainer.innerHTML = '';
            for (const item of person.knownFor) {
                if (!this.isRenderableFilmographyItem(item)) continue;
                const cardEl = this.createPersonMovieCard(item);
                if (cardEl) knownForContainer.appendChild(cardEl);
            }
        }

        this.bindKnownForCarousel();

        // 2. Mount the cards of the role tab in view
        this.syncFilmographyGrid(person);
    }

    /**
     * Brings the role tab's grid in line with the current choices. Cards already
     * shown are kept, in their new order, unless their data changed, so a late
     * poster or year neither reloads the other posters nor resets the page.
     * @param {Object} [person]
     * @returns {Array<HTMLElement>} The cards added by this call
     */
    syncFilmographyGrid(person = this.currentPerson) {
        if (!person) return [];
        const state = this.getFilmographyState(person);
        this.activeRole = state.role;
        this.activeMediaFilter = state.mediaFilter;
        const grid = state.role ? document.getElementById(`filmographyGrid_${state.role}`) : null;
        if (!grid) return [];

        this.filmographyColumns = this.measureFilmographyColumns(grid) || this.filmographyColumns;
        const visible = state.items.slice(0, this.getFilmographyVisibleLimit());
        const current = Array.from(grid.children || []);
        const existing = new Map(current.map(card => [card.dataset?.personMediaKey, card]));
        const added = [];
        const cards = visible.map(item => {
            const card = existing.get(this.personMediaKey(item));
            if (card && card.dataset.personCardState === this.personCardState(item)) return card;
            const created = this.createPersonMovieCard(item, { lazyPoster: true });
            added.push(created);
            return created;
        });
        const unchanged = cards.length === current.length && cards.every((card, index) => card === current[index]);
        if (!unchanged) {
            if (typeof grid.replaceChildren === 'function') {
                grid.replaceChildren(...cards);
            } else {
                grid.innerHTML = '';
                cards.forEach(card => grid.appendChild(card));
            }
        }

        const button = typeof document.querySelector === 'function'
            ? document.querySelector(`.btn-show-more-filmography[data-category="${state.role}"]`)
            : null;
        if (button) {
            const remaining = Math.max(0, state.items.length - visible.length);
            button.hidden = remaining === 0;
            button.textContent = this.formatShowMore(Math.min(remaining, this.getFilmographyPageStep()));
        }
        this.syncFilmographyToolbar(state);
        // New cards get their character names in Russian too.
        void this.characterTranslation?.refresh();
        return added;
    }

    /**
     * Updates the tab counts, the pressed choices and the total without rebuilding
     * the buttons, so keyboard focus stays where it is.
     * @param {Object} state - getFilmographyState result
     */
    syncFilmographyToolbar(state) {
        const section = document.getElementById('filmographySection');
        if (!section || typeof section.querySelectorAll !== 'function') return;
        for (const button of section.querySelectorAll('[data-action="filter-filmography-role"]')) {
            const role = state.roles.find(entry => entry.category === button.getAttribute('data-role'));
            const active = role?.category === state.role;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-pressed', String(active));
            const count = button.querySelector('[data-count]');
            if (count && role) count.textContent = String(role.items.length);
        }
        for (const button of section.querySelectorAll('[data-action="filter-filmography"]')) {
            const filter = button.getAttribute('data-filter');
            const active = filter === state.mediaFilter;
            button.classList.toggle('active', active);
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-pressed', String(active));
            button.disabled = filter !== 'all' && !state.mediaCounts[filter];
            const count = button.querySelector('[data-count]');
            if (count) count.textContent = String(state.mediaCounts[filter] || 0);
        }
        const total = document.getElementById('filmographyTotal');
        if (total) total.textContent = String(state.total);
    }

    /**
     * The sort menu and the grid's column tracking, after the section is in the page.
     */
    bindFilmographyControls() {
        const select = document.getElementById('filmographySort');
        if (select && typeof select.addEventListener === 'function') {
            select.addEventListener('change', () => this.setFilmographySort(select.value));
            this.filmographySortControl = window.SortControl?.enhance?.(select) || null;
        }

        this.filmographyResizeObserver?.disconnect();
        this.filmographyResizeObserver = null;
        const container = document.getElementById('filmographyCategoriesContainer');
        if (!container || typeof ResizeObserver === 'undefined') return;
        // Rows stay whole when the window resizes, and the page's first layout (it
        // renders hidden) sets the real number of columns.
        this.filmographyResizeObserver = new ResizeObserver(() => {
            if (this.filmographyLayoutFrame !== null) return;
            this.filmographyLayoutFrame = window.requestAnimationFrame(() => {
                this.filmographyLayoutFrame = null;
                const grid = document.getElementById(`filmographyGrid_${this.activeRole}`);
                const columns = this.measureFilmographyColumns(grid);
                if (columns && columns !== this.filmographyColumns) this.syncFilmographyGrid();
            });
        });
        this.filmographyResizeObserver.observe(container);
    }

    /**
     * Remove existing Known-For listeners/observers before binding the current DOM.
     */
    unbindKnownForCarousel() {
        if (this.knownForCarousel && this.knownForScrollHandler) {
            this.knownForCarousel.removeEventListener('scroll', this.knownForScrollHandler);
        }
        if (this.knownForResizeHandler && typeof window.removeEventListener === 'function') {
            window.removeEventListener('resize', this.knownForResizeHandler);
        }
        if (this.knownForResizeObserver) {
            this.knownForResizeObserver.disconnect();
        }
        if (this.knownForUpdateFrame !== null) {
            if (typeof window.cancelAnimationFrame === 'function') {
                window.cancelAnimationFrame(this.knownForUpdateFrame);
            }
            this.knownForUpdateFrame = null;
        }

        this.knownForCarousel = null;
        this.knownForScrollHandler = null;
        this.knownForResizeHandler = null;
        this.knownForResizeObserver = null;
    }

    /**
     * Bind native scroll and resize updates for the current Known-For carousel.
     */
    bindKnownForCarousel() {
        this.unbindKnownForCarousel();

        const carousel = document.getElementById('knownForCarousel');
        const prevButton = typeof document.querySelector === 'function'
            ? document.querySelector('[data-action="scroll-known-for-prev"]')
            : null;
        const nextButton = typeof document.querySelector === 'function'
            ? document.querySelector('[data-action="scroll-known-for-next"]')
            : null;
        if (!carousel || !prevButton || !nextButton) return;

        this.knownForCarousel = carousel;
        this.knownForScrollHandler = () => this.scheduleKnownForControlUpdate();
        this.knownForResizeHandler = () => this.scheduleKnownForControlUpdate();
        carousel.addEventListener('scroll', this.knownForScrollHandler, { passive: true });
        if (typeof window.addEventListener === 'function') {
            window.addEventListener('resize', this.knownForResizeHandler, { passive: true });
        }

        if (typeof ResizeObserver !== 'undefined') {
            this.knownForResizeObserver = new ResizeObserver(() => this.scheduleKnownForControlUpdate());
            this.knownForResizeObserver.observe(carousel);
        }

        this.updateKnownForControls();
    }

    /**
     * Coalesce scroll/resize work to one update per animation frame.
     */
    scheduleKnownForControlUpdate() {
        if (this.knownForUpdateFrame !== null) return;

        const update = () => {
            this.knownForUpdateFrame = null;
            this.updateKnownForControls();
        };

        if (typeof window.requestAnimationFrame === 'function') {
            this.knownForUpdateFrame = window.requestAnimationFrame(update);
        } else {
            update();
        }
    }

    /**
     * Measure the rendered card and gap so the carousel never duplicates CSS widths in JS.
     * @param {HTMLElement} carousel
     * @returns {{cardWidth: number, gap: number, viewportWidth: number, scrollWidth: number, maxScrollLeft: number, visibleCardCount: number, scrollStep: number}}
     */
    getKnownForCarouselMetrics(carousel = this.knownForCarousel) {
        if (!carousel) {
            return { cardWidth: 0, gap: 0, viewportWidth: 0, scrollWidth: 0, maxScrollLeft: 0, visibleCardCount: 0, scrollStep: 0 };
        }

        const card = carousel.querySelector('.movie-card-component');
        const cardWidth = card?.getBoundingClientRect?.().width || 0;
        const styles = typeof window.getComputedStyle === 'function' ? window.getComputedStyle(carousel) : null;
        const gap = Number.parseFloat(styles?.columnGap || styles?.gap || '0') || 0;
        const viewportWidth = carousel.clientWidth || 0;
        const scrollWidth = carousel.scrollWidth || 0;
        const maxScrollLeft = Math.max(0, scrollWidth - viewportWidth);
        const itemAdvance = cardWidth + gap;
        const visibleCardCount = itemAdvance > 0
            ? Math.max(1, Math.floor((viewportWidth + gap) / itemAdvance))
            : 0;
        const scrollStep = itemAdvance > 0
            ? Math.max(itemAdvance, (visibleCardCount * itemAdvance) - gap)
            : viewportWidth;

        return { cardWidth, gap, viewportWidth, scrollWidth, maxScrollLeft, visibleCardCount, scrollStep };
    }

    /**
     * Update button disabled/hidden state from actual scroll metrics.
     */
    updateKnownForControls() {
        const carousel = this.knownForCarousel || document.getElementById('knownForCarousel');
        if (!carousel) return;

        const prevButton = typeof document.querySelector === 'function'
            ? document.querySelector('[data-action="scroll-known-for-prev"]')
            : null;
        const nextButton = typeof document.querySelector === 'function'
            ? document.querySelector('[data-action="scroll-known-for-next"]')
            : null;
        if (!prevButton || !nextButton) return;

        const metrics = this.getKnownForCarouselMetrics(carousel);
        const tolerance = 1;
        const hasOverflow = metrics.maxScrollLeft > tolerance;
        const atStart = carousel.scrollLeft <= tolerance;
        const atEnd = carousel.scrollLeft >= metrics.maxScrollLeft - tolerance;

        prevButton.hidden = !hasOverflow;
        nextButton.hidden = !hasOverflow;
        prevButton.disabled = !hasOverflow || atStart;
        nextButton.disabled = !hasOverflow || atEnd;
        prevButton.setAttribute('aria-label', this.i18n.get('person_details.previous_movies'));
        nextButton.setAttribute('aria-label', this.i18n.get('person_details.next_movies'));
        prevButton.setAttribute('aria-disabled', String(prevButton.disabled));
        nextButton.setAttribute('aria-disabled', String(nextButton.disabled));
    }

    /**
     * Scroll by one measured visible group, clamped to the actual scroll range.
     * @param {-1|1} direction
     */
    scrollKnownFor(direction) {
        const carousel = this.knownForCarousel || document.getElementById('knownForCarousel');
        if (!carousel) return;

        const metrics = this.getKnownForCarouselMetrics(carousel);
        const target = Math.max(0, Math.min(
            metrics.maxScrollLeft,
            carousel.scrollLeft + (direction * metrics.scrollStep)
        ));
        const reducedMotion = typeof window.matchMedia === 'function'
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        if (typeof carousel.scrollTo === 'function') {
            carousel.scrollTo({ left: target, behavior: reducedMotion ? 'auto' : 'smooth' });
        } else {
            carousel.scrollLeft = target;
        }
        this.scheduleKnownForControlUpdate();
    }

    /**
     * Helper to create MovieCard element for person filmography/known-for item.
     * @param {Object} item - FilmographyItemDTO
     * @returns {HTMLElement|null}
     */
    createPersonMovieCard(item, { lazyPoster = false } = {}) {
        const hasNavigationTarget = this.hasNavigationTarget(item);

        if (!window.MovieCard || typeof window.MovieCard.create !== 'function') {
            throw new Error('[PersonDetails] MovieCard component must be loaded before rendering cards');
        }

        const cardData = {
            movie: {
                id: hasNavigationTarget ? item.kinopoiskId : null,
                kinopoiskId: hasNavigationTarget ? item.kinopoiskId : null,
                tmdbId: item.tmdbId || null,
                mediaType: item.providerMediaType || 'movie',
                isTmdbOnly: !hasNavigationTarget,
                name: item.name || item.originalName,
                alternativeName: item.originalName,
                year: item.year,
                posterUrl: this.personPosterUrl(item),
                // Isolate rating: do not mislabel TMDB vote average as Kinopoisk score
                ratingKp: null,
                genres: []
            }
        };
        const card = window.MovieCard.create(cardData, {
            variant: 'search',
            lazyPoster,
            showGenres: false,
            showDescription: false,
            showThreeDotMenu: hasNavigationTarget,
            showFavorite: hasNavigationTarget,
            showWatchlist: hasNavigationTarget,
            showWatching: hasNavigationTarget,
            showWatched: hasNavigationTarget
        });

        card.dataset.personMediaKey = this.personMediaKey(item);
        card.dataset.personCardState = this.personCardState(item);
        card.dataset.lazyPoster = String(lazyPoster);
        if (!this.personPosterUrl(item)) {
            this.replacePersonMoviePosterFallback(card);
        }
        this.decoratePersonCredit(card, item);

        console.log('[PersonDetails] Movie card rendered', {
            name: item.name || item.originalName || null,
            tmdbId: item.tmdbId || null,
            kinopoiskId: item.kinopoiskId || null,
            posterUrl: item.posterUrl || null,
            posterSource: item.posterSource || null,
            hasArtwork: Boolean(item.hasArtwork),
            hasNavigationTarget,
            cardTag: card.tagName || null,
            href: card.querySelector?.('[data-action="view-details"]')?.getAttribute('href')
                || card.getAttribute?.('href')
                || null
        });

        if (!hasNavigationTarget) {
            this.applyKinopoiskSearchNavigation(card, item);
        }
        return card;
    }

    personMediaKey(item) {
        return item.tmdbId ? `tmdb:${item.providerMediaType || 'movie'}:${item.tmdbId}` : `kp:${item.kinopoiskId}`;
    }

    personCardState(item) {
        return JSON.stringify([
            item.kinopoiskId || null, this.personPosterUrl(item), item.posterSource || null,
            item.year || null, this.creditMediaType(item), item.character || null, item.characterLocal || null,
            item.jobs || null, item.episodeCount || null
        ]);
    }

    /**
     * Adds what the person did on the title under the card's year: the character or
     * job and, for a series, the episodes; a title not out yet says so beside its year.
     * @param {HTMLElement} card
     * @param {Object} item
     */
    decoratePersonCredit(card, item) {
        const content = card?.querySelector?.('.mc-content');
        if (!content || typeof document.createElement !== 'function') return;
        const role = this.creditRoleText(item);
        const episodes = this.formatEpisodes(item?.episodeCount);
        if (role || episodes) {
            const credit = document.createElement('p');
            credit.className = 'person-credit';
            if (role) {
                const roleLine = document.createElement('span');
                roleLine.className = 'person-credit__role';
                roleLine.textContent = role;
                roleLine.title = role;
                credit.appendChild(roleLine);
            }
            if (episodes) {
                const episodesLine = document.createElement('span');
                episodesLine.className = 'person-credit__episodes';
                episodesLine.textContent = episodes;
                credit.appendChild(episodesLine);
            }
            content.appendChild(credit);
        }
        if (this.isUpcomingCredit(item)) {
            const meta = content.querySelector?.('.mc-meta-subtitle');
            if (meta) {
                const status = document.createElement('span');
                status.className = 'person-credit__status';
                status.textContent = this.i18n.get('person_details.upcoming');
                meta.appendChild(status);
            }
        }
    }

    /**
     * Kinopoisk gives films without a poster one shared «no poster» picture (a grey
     * letter K, bright in the dark theme). A picture that stands for three or more
     * different films is that placeholder, not artwork: those cards get the page's
     * neutral placeholder instead.
     * @param {Object} person
     */
    refreshPlaceholderPosters(person) {
        const films = new Map();
        for (const item of [...Object.values(person?.filmography || {}).flat(), ...(person?.knownFor || [])]) {
            if (!item?.posterUrl) continue;
            const ids = films.get(item.posterUrl) || new Set();
            ids.add(String(item.kinopoiskId || item.tmdbId || item.providerMediaId || item.name || ''));
            films.set(item.posterUrl, ids);
        }
        this.placeholderPosterUrls = new Set([...films].filter(([, ids]) => ids.size >= 3).map(([url]) => url));
    }

    personPosterUrl(item) {
        const url = item?.posterUrl || null;
        return url && !this.placeholderPosterUrls?.has(url) ? url : null;
    }

    updateEnrichedCards(person) {
        this.currentPerson = person;
        this.refreshPlaceholderPosters(person);
        // Known For cards change in place; the filmography grid is brought in line
        // below, since a late year or type can also move a title or its filter.
        const knownFor = new Map((person.knownFor || []).map(item => [this.personMediaKey(item), item]));
        const track = document.getElementById('knownForCarousel');
        for (const card of track?.querySelectorAll?.('[data-person-media-key]') || []) {
            const item = knownFor.get(card.dataset.personMediaKey);
            if (!item || card.dataset.personCardState === this.personCardState(item)) continue;
            const replacement = this.createPersonMovieCard(item, { lazyPoster: card.dataset.lazyPoster === 'true' });
            const scrollLeft = track.scrollLeft;
            card.replaceWith(replacement);
            track.scrollLeft = scrollLeft;
        }
        this.syncFilmographyGrid(person);
    }

    getPersonMoviePosterPlaceholder() {
        const sharedIcon = typeof Icons !== 'undefined' && Icons.MOVIE_CLAPPER
            ? Icons.MOVIE_CLAPPER
            : '<svg data-icon="MOVIE_CLAPPER" aria-hidden="true" width="40" height="40" viewBox="0 0 20 20" fill="none"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M2.27 3.28L5.78 2.47L5.12 6.73L2.2 7.4L1.53 4.48Q1.3 3.5 2.27 3.28ZM7.54 2.06L11.04 1.25L10.38 5.51L6.88 6.32ZM12.8 0.85L15.92 0.13Q16.89 -0.1 17.12 0.88L17.79 3.8L12.14 5.11Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9H17V15A2 2 0 0 1 15 17H5A2 2 0 0 1 3 15Z"/></svg>';
        return sharedIcon.replace('<svg ', '<svg class="person-details-poster-placeholder__icon" aria-hidden="true" ');
    }

    replacePersonMoviePosterFallback(card) {
        const poster = card?.querySelector?.('.mc-poster');
        if (!poster) return card;

        const placeholder = document.createElement('span');
        placeholder.className = 'person-details-poster-placeholder';
        placeholder.setAttribute('aria-hidden', 'true');
        placeholder.innerHTML = this.getPersonMoviePosterPlaceholder();
        poster.replaceWith(placeholder);
        return card;
    }

    applyKinopoiskSearchNavigation(card, item) {
        if (!card || !item) return card;

        const title = item.name || item.originalName || '';
        if (!title) return card;

        const params = new URLSearchParams({
            resolveTmdbId: String(item.tmdbId || ''),
            source: 'home-tmdb-only',
            title,
            originalTitle: item.originalName || '',
            year: String(item.year || ''),
            mediaType: item.providerMediaType || 'movie'
        });
        const searchUrl = item.tmdbId
            ? `../movie-details/movie-details.html?${params.toString()}`
            : `https://www.kinopoisk.ru/new-search/?text=${encodeURIComponent(title)}`;
        const links = card.querySelectorAll?.('[data-action="view-details"]') || [];
        links.forEach(link => {
            link.setAttribute('href', searchUrl);
            if (!item.tmdbId) link.setAttribute('data-external-search', 'kinopoisk');
            link.setAttribute('title', item.tmdbId ? title : `${title} — поиск на Кинопоиске`);
        });

        if (card.tagName === 'A' && typeof card.setAttribute === 'function') {
            card.setAttribute('href', searchUrl);
            card.setAttribute('data-action', 'view-details');
            if (!item.tmdbId) card.setAttribute('data-external-search', 'kinopoisk');
        }

        return card;
    }

    isRenderableFilmographyItem(item) {
        const hasTitle = Boolean(String(item?.name || item?.originalName || '').trim());
        const hasProviderIdentity = Number(item?.tmdbId) > 0
            || Number(item?.providerMediaId) > 0
            || this.hasNavigationTarget(item);
        return hasTitle && hasProviderIdentity;
    }

    hasNavigationTarget(item) {
        return Boolean(item?.hasNavigationTarget || Number(item?.kinopoiskId) > 0);
    }

    /**
     * Switch media type filter in Filmography.
     * @param {string} filter - 'all' | 'movie' | 'tv'
     */
    setMediaFilter(filter) {
        if (!['all', 'movie', 'tv'].includes(filter) || this.activeMediaFilter === filter) return;
        this.activeMediaFilter = filter;
        this.filmographyRows = PersonDetailsPageController.FILMOGRAPHY_ROWS;
        this.refreshFilmographyView();
    }

    /**
     * Shows another role tab, from its first rows; a media filter it has nothing
     * for goes back to all titles.
     * @param {string} role
     */
    setFilmographyRole(role) {
        if (!PersonDetailsPageController.FILMOGRAPHY_CATEGORIES.includes(role) || this.activeRole === role) return;
        this.activeRole = role;
        this.filmographyRows = PersonDetailsPageController.FILMOGRAPHY_ROWS;
        const container = document.getElementById('filmographyCategoriesContainer');
        if (container && this.currentPerson) {
            container.innerHTML = this.renderFilmographyCategories(this.currentPerson);
            this.syncFilmographyGrid(this.currentPerson);
            if (typeof Utils !== 'undefined') Utils.revealContent?.(container);
        }
    }

    /**
     * Orders the titles and remembers the order for the next person.
     * @param {string} sort
     */
    setFilmographySort(sort) {
        if (!PersonDetailsPageController.FILMOGRAPHY_SORTS.includes(sort) || this.activeSort === sort) return;
        this.activeSort = sort;
        try {
            globalThis.localStorage?.setItem(PersonDetailsPageController.FILMOGRAPHY_SORT_KEY, sort);
        } catch { /* The order is still applied to this page. */ }
        this.filmographyRows = PersonDetailsPageController.FILMOGRAPHY_ROWS;
        this.refreshFilmographyView();
    }

    refreshFilmographyView() {
        const container = document.getElementById('filmographyCategoriesContainer');
        if (!container || !this.currentPerson) return;
        this.syncFilmographyGrid(this.currentPerson);
        if (typeof Utils !== 'undefined') Utils.revealContent?.(container);
    }

    /**
     * Adds the next rows. When the button goes away with the last of them, keyboard
     * focus moves to the first new card instead of falling back to the page.
     * @param {string} category
     */
    showMoreCategory(category) {
        if (category !== this.activeRole) return;
        this.filmographyRows += PersonDetailsPageController.FILMOGRAPHY_ROWS;
        const button = typeof document.querySelector === 'function'
            ? document.querySelector(`.btn-show-more-filmography[data-category="${category}"]`)
            : null;
        const hadFocus = Boolean(button && document.activeElement === button);
        const added = this.syncFilmographyGrid(this.currentPerson);
        // The title link is the card's keyboard stop; the poster link is skipped by Tab.
        if (hadFocus && button.hidden) (added[0]?.querySelector?.('.mc-title-link') || added[0]?.querySelector?.('[data-action="view-details"]'))?.focus?.();
    }

    /**
     * Toggle Biography text clamp.
     */
    toggleBiography() {
        this.isBioExpanded = !this.isBioExpanded;
        const textEl = document.getElementById('personBioText');
        const btnEl = document.querySelector('[data-action="toggle-bio"]');

        if (textEl) {
            const previousHeight = textEl.getBoundingClientRect().height;
            textEl._bioEntry?.cancel();
            if (this.isBioExpanded) {
                textEl.classList.remove('person-bio__text--clamped');
            } else {
                textEl.classList.add('person-bio__text--clamped');
            }
            if (textEl.animate && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
                textEl._bioEntry = textEl.animate([
                    { height: `${previousHeight}px` }, { height: `${textEl.getBoundingClientRect().height}px` }
                ], { duration: parseFloat(getComputedStyle(textEl).getPropertyValue('--motion-duration-disclosure')) || 200, easing: getComputedStyle(textEl).getPropertyValue('--motion-ease-out').trim() || 'ease-out' });
            }
        }

        if (btnEl) {
            btnEl.setAttribute('aria-expanded', String(this.isBioExpanded));
            const span = btnEl.querySelector('span');
            if (span) {
                span.textContent = this.isBioExpanded
                    ? this.i18n.get('person_details.hide_bio')
                    : this.i18n.get('person_details.show_all_bio');
            }
        }
    }

    /**
     * Toggle Facts remaining items.
     */
    toggleFacts() {
        this.isFactsExpanded = !this.isFactsExpanded;
        const remainingEl = document.getElementById('personFactsRemaining');
        const btnEl = document.querySelector('[data-action="toggle-facts"]');

        if (remainingEl) {
            remainingEl.classList.toggle('is-expanded', this.isFactsExpanded);
            remainingEl.classList.toggle('is-collapsed', !this.isFactsExpanded);
        }

        if (btnEl) {
            btnEl.setAttribute('aria-expanded', String(this.isFactsExpanded));
            const span = btnEl.querySelector('span');
            if (span) {
                span.textContent = this.isFactsExpanded
                    ? this.i18n.get('person_details.hide_facts')
                    : `${this.i18n.get('person_details.show_more_facts')} (${(this.currentPerson?.facts?.length || 5) - 5})`;
            }
        }
    }

    /**
     * Toggle Aliases remaining tags.
     */
    toggleAliases() {
        this.isAliasesExpanded = !this.isAliasesExpanded;
        const remainingEl = document.getElementById('personAliasesRemaining');
        const btnEl = document.querySelector('[data-action="toggle-aliases"]');

        if (remainingEl) {
            remainingEl.hidden = !this.isAliasesExpanded;
        }

        if (btnEl) {
            btnEl.setAttribute('aria-expanded', String(this.isAliasesExpanded));
            btnEl.textContent = this.isAliasesExpanded
                ? this.i18n.get('person_details.show_less')
                : `+${(this.currentPerson?.aliases?.length || 3) - 3} ${this.i18n.get('person_details.show_more_aliases')}`;
        }
    }

    /**
     * Pure Age Calculation Helper.
     * @param {string|null} birthday - 'YYYY-MM-DD' or 'YYYY'
     * @param {string|null} [deathday=null] - 'YYYY-MM-DD' or 'YYYY'
     * @returns {number|null}
     */
    calculatePersonAge(birthday, deathday = null) {
        if (!birthday || typeof birthday !== 'string') return null;
        const birthMatch = birthday.trim().match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/);
        if (!birthMatch) return null;

        const birthYear = parseInt(birthMatch[1], 10);
        const birthMonth = birthMatch[2] ? parseInt(birthMatch[2], 10) : null;
        const birthDay = birthMatch[3] ? parseInt(birthMatch[3], 10) : null;

        let targetYear, targetMonth, targetDay;

        if (deathday && typeof deathday === 'string' && deathday.trim().length > 0) {
            const deathMatch = deathday.trim().match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/);
            if (deathMatch) {
                targetYear = parseInt(deathMatch[1], 10);
                targetMonth = deathMatch[2] ? parseInt(deathMatch[2], 10) : 12;
                targetDay = deathMatch[3] ? parseInt(deathMatch[3], 10) : 31;
            } else {
                return null;
            }
        } else {
            const now = new Date();
            targetYear = now.getFullYear();
            targetMonth = now.getMonth() + 1;
            targetDay = now.getDate();
        }

        if (isNaN(birthYear) || isNaN(targetYear) || birthYear <= 0 || targetYear < birthYear) {
            return null;
        }

        let age = targetYear - birthYear;
        if (birthMonth !== null) {
            if (targetMonth < birthMonth || (targetMonth === birthMonth && birthDay !== null && targetDay < birthDay)) {
                age--;
            }
        }

        return age >= 0 && age <= 130 ? age : null;
    }

    /**
     * Safe HTML Escaper.
     * @param {string} str
     * @returns {string}
     */
    escapeHtml(str) {
        if (typeof Utils !== 'undefined' && Utils.escapeHtml) {
            return Utils.escapeHtml(str);
        }
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
}

// Auto-initialize in browser window
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        const controller = new PersonDetailsPageController();
        controller.init();
        if (typeof window !== 'undefined') {
            window.personDetailsController = controller;
        }
    });
}

export { PersonDetailsPageController };
