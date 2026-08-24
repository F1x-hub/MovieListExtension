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
 * - Filmography section with media filters (All/Movies/Series) and category-specific +20 pagination
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
        this.activeMediaFilter = 'all'; // 'all' | 'movie' | 'tv'
        this.categoryVisibleCounts = {
            acting: 20,
            directing: 20,
            writing: 20,
            production: 20,
            music: 20,
            other: 20
        };

        this.isBioExpanded = false;
        this.isFactsExpanded = false;
        this.isAliasesExpanded = false;

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
        this.showLoading();

        try {
            if (!this.personDetailsService) {
                if (typeof window.PersonDetailsService !== 'undefined') {
                    this.personDetailsService = new window.PersonDetailsService();
                } else {
                    throw new Error('PersonDetailsService is not available');
                }
            }

            const person = await this.personDetailsService.getPersonDetails(personKey);
            this.currentPerson = person;

            this.renderPerson(person);
            this.showContent();
        } catch (err) {
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
                const target = e.target?.closest?.('.movie-card-component, .person-details-card-fallback, [data-action="view-details"]');
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
                    const card = btn.closest('.movie-card-component, .person-details-card-fallback');
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
                                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                                    <circle cx="12" cy="7" r="4"></circle>
                                </svg>
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

        const heroHtml = this.renderHero(person);
        const bioHtml = this.renderBiography(person);
        const factsHtml = this.renderFacts(person);
        const knownForHtml = this.renderKnownFor(person);
        const filmographyHtml = this.renderFilmography(person);

        this.personContainer.innerHTML = `
            ${heroHtml}
            ${bioHtml}
            ${factsHtml}
            ${knownForHtml}
            ${filmographyHtml}
        `;

        // Post-render: Mount MovieCard instances in KnownFor and Filmography
        this.mountMovieCards(person);
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

        return `
            <header class="person-hero" aria-label="${this.escapeHtml(primaryName)}">
                <div class="person-hero__portrait-wrapper">
                    ${person.photoUrl ? `
                    <img src="${this.escapeHtml(person.photoUrl)}" alt="${this.escapeHtml(primaryName)}" class="person-hero__portrait" decoding="async">
                    ` : `
                    <div class="person-hero__portrait-placeholder">
                        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                            <circle cx="12" cy="7" r="4"></circle>
                        </svg>
                    </div>
                    `}
                </div>
                <div class="person-hero__info">
                    <div class="person-hero__names">
                        <h1 class="person-hero__name">${this.escapeHtml(primaryName)}</h1>
                        ${secondaryName ? `<h2 class="person-hero__original-name">${this.escapeHtml(secondaryName)}</h2>` : ''}
                    </div>

                    ${professions.length > 0 ? `
                    <div class="person-hero__professions" aria-label="Professions">
                        ${professions.map(p => `<span class="person-badge">${this.escapeHtml(p)}</span>`).join('')}
                    </div>
                    ` : ''}

                    <div class="person-hero__meta">
                        ${person.birthday ? `
                        <div class="person-meta-item">
                            <span class="person-meta-label">${this.escapeHtml(this.i18n.get('person_details.birthday'))}</span>
                            <span class="person-meta-value">
                                ${this.escapeHtml(person.birthday)}
                                ${age !== null && !isDeceased ? `(${age} ${this.escapeHtml(this.i18n.get('person_details.years_old'))})` : ''}
                            </span>
                        </div>
                        ` : ''}

                        ${person.deathday ? `
                        <div class="person-meta-item">
                            <span class="person-meta-label">${this.escapeHtml(this.i18n.get('person_details.deathday'))}</span>
                            <span class="person-meta-value">
                                ${this.escapeHtml(person.deathday)}
                                ${age !== null ? `(${age} ${this.escapeHtml(this.i18n.get('person_details.years_at_death'))})` : ''}
                            </span>
                        </div>
                        ` : ''}

                        ${person.birthplace ? `
                        <div class="person-meta-item">
                            <span class="person-meta-label">${this.escapeHtml(this.i18n.get('person_details.birthplace'))}</span>
                            <span class="person-meta-value">${this.escapeHtml(person.birthplace)}</span>
                        </div>
                        ` : ''}
                    </div>

                    ${aliases.length > 0 ? `
                    <div class="person-hero__aliases">
                        <span class="person-meta-label">${this.escapeHtml(this.i18n.get('person_details.aliases'))}</span>
                        <div class="person-aliases-list" id="personAliasesList">
                            ${aliases.slice(0, 3).map(a => `<span class="person-alias-tag">${this.escapeHtml(a)}</span>`).join('')}
                            ${aliases.length > 3 ? `
                            <span class="person-aliases-remaining" id="personAliasesRemaining" style="display: none;">
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
            award: '<svg class="person-bio__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 4h8v4a4 4 0 0 1-8 0V4Z"></path><path d="M8 6H5a3 3 0 0 0 3 3"></path><path d="M16 6h3a3 3 0 0 1-3 3"></path><path d="M12 12v5"></path><path d="M8 21h8"></path><path d="M9 17h6"></path></svg>',
            film: '<svg class="person-bio__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m8 5 3 4"></path><path d="m14 5 3 4"></path><path d="M3 9h18"></path><path d="M3 15h18"></path><path d="m8 19 3-4"></path><path d="m14 19 3-4"></path></svg>'
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
            : '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="9 18 15 12 9 6"></polyline></svg>';

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
     * Render Filmography Section.
     * @param {Object} person
     * @returns {string}
     */
    renderFilmography(person) {
        const filmography = person.filmography || {};
        const categories = ['acting', 'directing', 'writing', 'production', 'music', 'other'];

        // Artwork and navigation are separate concerns. Keep provider-backed items visible
        // even when TMDB -> KP mapping is unresolved.
        let totalRenderableCount = 0;
        for (const cat of categories) {
            const items = Array.isArray(filmography[cat]) ? filmography[cat].filter(i => this.isRenderableFilmographyItem(i)) : [];
            totalRenderableCount += items.length;
        }

        if (totalRenderableCount === 0) {
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

        return `
            <section class="person-section" id="filmographySection" aria-labelledby="filmographyHeading">
                <div class="person-section__header">
                    <h2 class="person-section__title" id="filmographyHeading">
                        <span>${this.escapeHtml(this.i18n.get('person_details.filmography'))}</span>
                        <span class="person-section__count">${totalRenderableCount}</span>
                    </h2>
                    <div class="filmography-controls" role="tablist" aria-label="Filmography Type Filter">
                        <button type="button" class="filmography-filter-pill ${this.activeMediaFilter === 'all' ? 'active' : ''}" data-action="filter-filmography" data-filter="all">
                            ${this.escapeHtml(this.i18n.get('person_details.all_media'))}
                        </button>
                        <button type="button" class="filmography-filter-pill ${this.activeMediaFilter === 'movie' ? 'active' : ''}" data-action="filter-filmography" data-filter="movie">
                            ${this.escapeHtml(this.i18n.get('person_details.movies_media'))}
                        </button>
                        <button type="button" class="filmography-filter-pill ${this.activeMediaFilter === 'tv' ? 'active' : ''}" data-action="filter-filmography" data-filter="tv">
                            ${this.escapeHtml(this.i18n.get('person_details.series_media'))}
                        </button>
                    </div>
                </div>
                <div class="filmography-categories-container" id="filmographyCategoriesContainer">
                    ${this.renderFilmographyCategories(person)}
                </div>
            </section>
        `;
    }

    /**
     * Render all active Filmography Categories based on current filter & pagination.
     * @param {Object} person
     * @returns {string}
     */
    renderFilmographyCategories(person) {
        const filmography = person.filmography || {};
        const categoryOrder = ['acting', 'directing', 'writing', 'production', 'music', 'other'];
        const labelMap = {
            acting: this.i18n.get('person_details.acting'),
            directing: this.i18n.get('person_details.directing'),
            writing: this.i18n.get('person_details.writing'),
            production: this.i18n.get('person_details.production'),
            music: this.i18n.get('person_details.music'),
            other: this.i18n.get('person_details.other')
        };

        const sections = [];

        for (const category of categoryOrder) {
            let items = Array.isArray(filmography[category]) ? filmography[category] : [];

            // Keep valid provider items visible even when navigation mapping is unresolved.
            items = items.filter(i => this.isRenderableFilmographyItem(i));

            // Apply media filter if not 'all'
            if (this.activeMediaFilter !== 'all') {
                items = items.filter(i => (i.providerMediaType || 'movie').toLowerCase() === this.activeMediaFilter);
            }

            if (items.length === 0) continue;

            const visibleLimit = this.categoryVisibleCounts[category] || 20;
            const hasMore = items.length > visibleLimit;

            sections.push(`
                <div class="filmography-category" data-category="${category}">
                    <div class="filmography-category__header">
                        <h3 class="filmography-category__title">${this.escapeHtml(labelMap[category] || category)}</h3>
                        <span class="filmography-category__count">${items.length}</span>
                    </div>
                    <div class="filmography-grid" id="filmographyGrid_${category}">
                        <!-- MovieCards mounted dynamically in mountMovieCards -->
                    </div>
                    ${hasMore ? `
                    <button type="button" class="btn-show-more-filmography" data-action="show-more-category" data-category="${category}">
                        ${this.escapeHtml(this.i18n.get('person_details.show_more'))} (+20)
                    </button>
                    ` : ''}
                </div>
            `);
        }

        if (sections.length === 0) {
            return `
                <div class="filmography-empty-message">
                    <p>${this.escapeHtml(this.i18n.get('person_details.filmography_empty'))}</p>
                </div>
            `;
        }

        return sections.join('');
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

        // 2. Mount Filmography Category cards
        const filmography = person.filmography || {};
        const categories = ['acting', 'directing', 'writing', 'production', 'music', 'other'];

        for (const category of categories) {
            const gridEl = document.getElementById(`filmographyGrid_${category}`);
            if (!gridEl) continue;

            let items = Array.isArray(filmography[category]) ? filmography[category] : [];
            items = items.filter(i => this.isRenderableFilmographyItem(i));

            if (this.activeMediaFilter !== 'all') {
                items = items.filter(i => (i.providerMediaType || 'movie').toLowerCase() === this.activeMediaFilter);
            }

            const visibleLimit = this.categoryVisibleCounts[category] || 20;
            const visibleItems = items.slice(0, visibleLimit);

            gridEl.innerHTML = '';
            for (const item of visibleItems) {
                const cardEl = this.createPersonMovieCard(item);
                if (cardEl) gridEl.appendChild(cardEl);
            }
        }
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

        const card = carousel.querySelector('.movie-card-component, .person-details-card-fallback');
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
    createPersonMovieCard(item) {
        const hasNavigationTarget = this.hasNavigationTarget(item);

        if (typeof window.MovieCard !== 'undefined') {
            const cardData = {
                movie: {
                    id: hasNavigationTarget ? item.kinopoiskId : null,
                    kinopoiskId: hasNavigationTarget ? item.kinopoiskId : null,
                    tmdbId: item.tmdbId || null,
                    isTmdbOnly: !hasNavigationTarget,
                    name: item.name || item.originalName,
                    alternativeName: item.originalName,
                    year: item.year,
                    posterUrl: item.posterUrl,
                    // Isolate rating: do not mislabel TMDB vote average as Kinopoisk score
                    ratingKp: null,
                    genres: []
                }
            };
            const card = window.MovieCard.create(cardData, {
                variant: 'search',
                showGenres: false,
                showDescription: false,
                showThreeDotMenu: hasNavigationTarget,
                showFavorite: hasNavigationTarget,
                showWatchlist: hasNavigationTarget,
                showWatching: hasNavigationTarget,
                showWatched: hasNavigationTarget
            });

            if (!item.posterUrl) {
                this.replacePersonMoviePosterFallback(card);
            }

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

        // Fallback standard element if MovieCard not loaded
        const card = document.createElement(hasNavigationTarget ? 'a' : 'div');
        if (hasNavigationTarget) {
            card.href = `../movie-details/movie-details.html?movieId=${encodeURIComponent(item.kinopoiskId)}`;
            card.setAttribute('data-movie-id', String(item.kinopoiskId));
        }
        card.className = 'movie-card movie-card--search person-details-card-fallback';
        card.setAttribute('aria-label', item.name || item.originalName || 'Movie');
        card.innerHTML = `
            <div class="poster-container">
                ${item.posterUrl ? `<img src="${this.escapeHtml(item.posterUrl)}" alt="" class="movie-poster" loading="lazy">` : `<span class="person-details-poster-placeholder" aria-hidden="true">${this.getPersonMoviePosterPlaceholder()}</span>`}
            </div>
            <div class="movie-info">
                <div class="movie-title">${this.escapeHtml(item.name || item.originalName || 'Movie')}</div>
                ${item.year ? `<div class="movie-year">${this.escapeHtml(String(item.year))}</div>` : ''}
            </div>
        `;
        return card;
    }

    getPersonMoviePosterPlaceholder() {
        const sharedIcon = typeof Icons !== 'undefined' && Icons.MOVIE_CLAPPER
            ? Icons.MOVIE_CLAPPER
            : '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 4h16v16H4z"></path><path d="m4 8 16-4"></path><path d="m4 12 16-4"></path><path d="M8 4v4"></path><path d="M14 4v4"></path><path d="M20 4v4"></path></svg>';
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

        const searchUrl = `https://www.kinopoisk.ru/new-search/?text=${encodeURIComponent(title)}`;
        const links = card.querySelectorAll?.('[data-action="view-details"]') || [];
        links.forEach(link => {
            link.setAttribute('href', searchUrl);
            link.setAttribute('data-external-search', 'kinopoisk');
            link.setAttribute('title', `${title} — поиск на Кинопоиске`);
        });

        if (card.tagName === 'A' && typeof card.setAttribute === 'function') {
            card.setAttribute('href', searchUrl);
            card.setAttribute('data-action', 'view-details');
            card.setAttribute('data-external-search', 'kinopoisk');
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

    removeMovieCardNavigation(card) {
        if (!card) return card;

        card.dataset.hasNavigationTarget = 'false';
        card.querySelectorAll('a.mc-poster-container, a.mc-title').forEach(anchor => {
            const replacement = document.createElement('div');
            replacement.className = anchor.className;
            replacement.innerHTML = anchor.innerHTML;
            Array.from(anchor.attributes).forEach(attribute => {
                if (attribute.name !== 'class' && attribute.name !== 'href') {
                    replacement.setAttribute(attribute.name, attribute.value);
                }
            });
            replacement.removeAttribute('data-action');
            replacement.removeAttribute('data-movie-id');
            anchor.replaceWith(replacement);
        });

        card.querySelectorAll('[data-action="view-details"]').forEach(element => {
            element.removeAttribute('data-action');
            element.removeAttribute('data-movie-id');
            element.removeAttribute('href');
        });

        return card;
    }

    /**
     * Switch media type filter in Filmography.
     * @param {string} filter - 'all' | 'movie' | 'tv'
     */
    setMediaFilter(filter) {
        if (this.activeMediaFilter === filter) return;
        this.activeMediaFilter = filter;

        // Reset pagination visible limits on filter switch
        this.categoryVisibleCounts = {
            acting: 20,
            directing: 20,
            writing: 20,
            production: 20,
            music: 20,
            other: 20
        };

        const container = document.getElementById('filmographyCategoriesContainer');
        if (container && this.currentPerson) {
            container.innerHTML = this.renderFilmographyCategories(this.currentPerson);
            this.mountMovieCards(this.currentPerson);
        }

        // Update active filter pills
        const pills = document.querySelectorAll('.filmography-filter-pill');
        pills.forEach(pill => {
            if (pill.getAttribute('data-filter') === filter) {
                pill.classList.add('active');
            } else {
                pill.classList.remove('active');
            }
        });
    }

    /**
     * Increment visible items for a specific filmography category (+20).
     * @param {string} category
     */
    showMoreCategory(category) {
        this.categoryVisibleCounts[category] = (this.categoryVisibleCounts[category] || 20) + 20;
        const container = document.getElementById('filmographyCategoriesContainer');
        if (container && this.currentPerson) {
            container.innerHTML = this.renderFilmographyCategories(this.currentPerson);
            this.mountMovieCards(this.currentPerson);
        }
    }

    /**
     * Toggle Biography text clamp.
     */
    toggleBiography() {
        this.isBioExpanded = !this.isBioExpanded;
        const textEl = document.getElementById('personBioText');
        const btnEl = document.querySelector('[data-action="toggle-bio"]');

        if (textEl) {
            if (this.isBioExpanded) {
                textEl.classList.remove('person-bio__text--clamped');
            } else {
                textEl.classList.add('person-bio__text--clamped');
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
            remainingEl.style.display = this.isAliasesExpanded ? 'inline' : 'none';
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
