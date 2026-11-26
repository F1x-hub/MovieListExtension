/**
 * Admin workspace: section routing through the URL hash, loading a section the first time it
 * opens, the «Обзор» overview, the Ctrl+K search and the live-channel mirror.
 * Extends AdminPanelManager (admin.js); loads after it and before DOMContentLoaded.
 */
(function () {
    'use strict';

    if (typeof AdminPanelManager === 'undefined') return;

    const SECTIONS = {
        overview: 'Обзор',
        users: 'Пользователи',
        approvals: 'Заявки',
        reports: 'Репорты',
        'reaction-settings': 'Реакции',
        'tmdb-fallbacks': 'Проверка ID',
        ratings: 'Оценки',
        'live-channel': 'Эфир',
        usage: 'Firestore',
        'provider-keys': 'API-ключи'
    };
    const SECTION_HINTS = {
        overview: 'задачи состояние',
        users: 'участники аккаунты права удалить',
        approvals: 'одобрение регистрация вход',
        reports: 'жалобы ошибки обратная связь',
        'reaction-settings': 'эмодзи комментарии',
        'tmdb-fallbacks': 'tmdb кинопоиск imdb связь маппинг',
        ratings: 'фильмы кэш каталог',
        'live-channel': 'программа передача трансляция',
        usage: 'чтения записи лимит квота хранилище',
        'provider-keys': 'ключ квота кинопоиск tmdb'
    };
    const TONE_ORDER = { danger: 0, warning: 1, error: 2, neutral: 3 };
    const proto = AdminPanelManager.prototype;
    const $ = (id) => document.getElementById(id);

    function sectionFromHash() {
        const raw = decodeURIComponent((window.location.hash || '').replace(/^#/, ''));
        return Object.prototype.hasOwnProperty.call(SECTIONS, raw) ? raw : null;
    }

    function plural(count, forms) {
        return `${Number(count).toLocaleString('ru-RU')} ${Utils.selectRussianPlural(count, forms)}`;
    }

    function formatTime(timestamp) {
        return new Date(timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    }

    function formatCompact(value) {
        if (!Number.isFinite(value)) return '';
        if (value >= 10000) return `${Math.round(value / 1000).toLocaleString('ru-RU')} тыс.`;
        return value.toLocaleString('ru-RU');
    }

    proto.initWorkspace = function initWorkspace() {
        if (this.workspaceReady) return;
        this.workspaceReady = true;
        this.loadedSections = new Set();
        this.currentSection = null;

        $('refreshOverviewBtn')?.addEventListener('click', () => this.loadOverview(true));
        document.querySelectorAll('[data-goto]').forEach((button) => {
            button.addEventListener('click', () => this.showSection(button.dataset.goto, { focus: true }));
        });
        document.querySelectorAll('[data-quick-action]').forEach((button) => {
            button.addEventListener('click', () => this.runQuickAction(button.dataset.quickAction));
        });
        window.addEventListener('popstate', () => this.showSection(sectionFromHash() || 'overview', { fromHistory: true }));
        window.addEventListener('hashchange', () => this.showSection(sectionFromHash() || 'overview', { fromHistory: true }));

        const version = typeof chrome !== 'undefined' && chrome.runtime?.getManifest ? chrome.runtime.getManifest()?.version : '';
        if (version && $('adminBrandVersion')) $('adminBrandVersion').textContent = `Сеанс · v${version}`;

        this.initAdminSearch();
        this.initLiveMirror();

        const initial = sectionFromHash() || 'overview';
        this.showSection(initial, { replaceHistory: true });
        // The overview also feeds the menu counters, so it loads whichever section opened first.
        if (initial !== 'overview') this.loadOverview();
    };

    proto.reloadWorkspace = function reloadWorkspace() {
        if (!this.workspaceReady) return;
        this.loadedSections.clear();
        const section = this.currentSection || 'overview';
        this.currentSection = null;
        this.showSection(section, { replaceHistory: true });
        if (section !== 'overview') this.loadOverview(true);
    };

    proto.showSection = function showSection(target, options = {}) {
        const section = Object.prototype.hasOwnProperty.call(SECTIONS, target) ? target : 'overview';
        const alreadyShown = this.currentSection === section;
        this.currentSection = section;

        document.querySelectorAll('.admin-section-nav .sidebar-link').forEach((link) => {
            const isActive = link.dataset.target === section;
            link.classList.toggle('active', isActive);
            if (isActive) link.setAttribute('aria-current', 'page');
            else link.removeAttribute('aria-current');
        });
        document.querySelectorAll('#adminContent > .settings-pane').forEach((pane) => {
            pane.classList.toggle('active', pane.id === `pane-${section}`);
        });

        if (!options.fromHistory && sectionFromHash() !== section) {
            const url = `${window.location.pathname}${window.location.search}#${section}`;
            if (options.replaceHistory) window.history.replaceState(null, '', url);
            else window.history.pushState(null, '', url);
        }
        document.title = `${SECTIONS[section]} — Админ-панель`;

        if (!alreadyShown) {
            this.ensureSectionLoaded(section);
            if (window.scrollY > 0) window.scrollTo({ top: 0 });
        }
        if (options.focus) {
            const heading = document.querySelector(`#pane-${section} .pane-header h2`);
            if (heading) {
                heading.setAttribute('tabindex', '-1');
                heading.focus({ preventScroll: true });
            }
        }
    };

    proto.ensureSectionLoaded = function ensureSectionLoaded(section) {
        // These three cache their own data and redraw from it.
        if (section === 'usage') { this.loadFirestoreUsage().catch(() => {}); return; }
        if (section === 'provider-keys') { this.loadProviderKeys().catch(() => {}); return; }
        if (section === 'reaction-settings') { this.loadCommentReactionConfig().catch(() => {}); return; }

        if (this.loadedSections.has(section)) return;
        this.loadedSections.add(section);
        if (section === 'overview') this.loadOverview();
        else if (section === 'users') this.loadUsers();
        else if (section === 'approvals') this.loadApprovals();
        else if (section === 'ratings') this.loadMovies();
        else if (section === 'tmdb-fallbacks') this.loadTmdbFallbacks();
    };

    proto.loadOverview = async function loadOverview(force = false) {
        if (this.overviewRequest && !force) return this.overviewRequest;
        this.loadedSections?.add('overview');
        this.loadedSections?.add('approvals');
        this.loadedSections?.add('tmdb-fallbacks');
        this.overviewLoading = true;
        const updated = $('adminOverviewUpdated');
        if (updated) updated.textContent = 'Обновляем…';
        const refresh = $('refreshOverviewBtn');
        if (refresh) refresh.disabled = true;
        this.renderOverview();

        this.providerKeysLoadFailed = false;
        this.usageLoadFailed = false;
        const tasks = [
            this.loadApprovals(),
            this.loadTmdbFallbacks(),
            this.loadProviderKeys(force).catch(() => { this.providerKeysLoadFailed = true; }),
            this.loadFirestoreUsage(force).catch(() => { this.usageLoadFailed = true; }),
            this.loadCommunityCounts()
        ];
        this.overviewRequest = Promise.allSettled(tasks).then(() => {
            this.overviewLoading = false;
            this.overviewUpdatedAt = Date.now();
            if (refresh) refresh.disabled = false;
            this.renderOverview();
        }).finally(() => {
            this.overviewRequest = null;
        });
        return this.overviewRequest;
    };

    proto.loadCommunityCounts = async function loadCommunityCounts() {
        if (!this.adminService?.getCommunityCounts) return;
        this.communityCounts = await this.adminService.getCommunityCounts();
        const usersNav = $('adminNavUsersCount');
        const ratingsNav = $('adminNavRatingsCount');
        if (usersNav) usersNav.textContent = formatCompact(this.communityCounts.users);
        if (ratingsNav) ratingsNav.textContent = formatCompact(this.communityCounts.ratings);
        this.renderOverview();
    };

    proto.getProviderKeyProblems = function getProviderKeyProblems(keys) {
        const list = Array.isArray(keys) ? keys : [];
        if (!list.length) return [{ text: 'API-ключи не добавлены: каталог работает без своих квот' }];
        const problems = [];
        const kinopoisk = list.filter((key) => key?.provider === 'kinopoisk');
        const activeKinopoisk = kinopoisk.filter((key) => key?.status === 'active');
        if (kinopoisk.length && !activeKinopoisk.length) {
            problems.push({ text: 'Нет активного ключа Кинопоиска' });
        }
        activeKinopoisk.forEach((key) => {
            const quota = key.quota;
            if (quota?.mode !== 'provider_exact' || !Number.isFinite(quota.remaining) || !Number.isFinite(quota.limit) || quota.limit <= 0) return;
            const label = key.label || 'Без названия';
            if (quota.remaining <= 0) {
                problems.push({ text: `Кинопоиск «${label}»: дневная квота исчерпана` });
            } else if (quota.remaining / quota.limit < 0.15) {
                problems.push({ text: `Кинопоиск «${label}»: осталось ${quota.remaining.toLocaleString('ru-RU')} из ${quota.limit.toLocaleString('ru-RU')}` });
            }
        });
        return problems;
    };

    proto.collectAttentionItems = function collectAttentionItems() {
        const items = [];
        const add = (item) => items.push(item);

        if (this.reportsLoaded && this.pendingReports?.length) {
            const count = this.pendingReports.length;
            const detail = this.pendingReports.slice(0, 2)
                .map((report) => (report.text || '').trim().replace(/\s+/g, ' ').slice(0, 90))
                .filter(Boolean)
                .join(' · ');
            add({ tone: 'danger', title: `${plural(count, ['репорт ждёт', 'репорта ждут', 'репортов ждут'])} решения`, detail: detail || 'Сообщения пользователей об ошибках', action: 'Разобрать', section: 'reports' });
        }

        if (this.approvalsLoadFailed) {
            add({ tone: 'error', title: 'Не удалось загрузить заявки на вход', detail: 'Проверьте соединение и повторите.', action: 'Повторить', run: () => this.loadApprovals() });
        } else if (this.pendingUsers?.length) {
            const names = this.pendingUsers.slice(0, 3).map((user) => user.displayName || user.email || 'без имени').join(', ');
            const more = this.pendingUsers.length > 3 ? ` и ещё ${this.pendingUsers.length - 3}` : '';
            add({ tone: 'warning', title: `${plural(this.pendingUsers.length, ['заявка', 'заявки', 'заявок'])} на вход`, detail: `Ждут одобрения: ${names}${more}`, action: 'Разобрать', section: 'approvals' });
        }

        if (this.identityLoadFailed) {
            add({ tone: 'error', title: 'Не удалось загрузить очередь проверки ID', detail: 'Связи TMDB, Кинопоиска и IMDb сейчас не видны.', action: 'Повторить', run: () => this.loadTmdbFallbacks() });
        } else if (this.identityCounts?.total > 0) {
            const parts = [];
            if (this.identityCounts.critical) parts.push(`${this.identityCounts.critical} влияют на Главную`);
            if (this.identityCounts.all) parts.push(`TMDB → Кинопоиск: ${this.identityCounts.all}`);
            if (this.identityCounts.imdb) parts.push(`Кинопоиск → IMDb: ${this.identityCounts.imdb}`);
            add({ tone: 'warning', title: `${plural(this.identityCounts.total, ['тайтл ждёт', 'тайтла ждут', 'тайтлов ждут'])} проверки ID`, detail: parts.join(' · '), action: 'Проверить', section: 'tmdb-fallbacks' });
        }

        if (this.providerKeysLoadFailed) {
            add({ tone: 'error', title: 'Не удалось загрузить API-ключи', detail: 'Квоты провайдеров неизвестны.', action: 'Повторить', run: () => this.loadProviderKeys(true).catch(() => {}) });
        } else if (Array.isArray(this.providerKeys) && this.providerKeysFetched) {
            const problems = this.getProviderKeyProblems(this.providerKeys);
            if (problems.length) {
                add({ tone: 'warning', title: problems.length === 1 ? problems[0].text : `${plural(problems.length, ['проблема', 'проблемы', 'проблем'])} с API-ключами`, detail: problems.length === 1 ? 'Откройте ключи, чтобы проверить квоту или добавить ещё один.' : problems.map((problem) => problem.text).join(' · '), action: 'Ключи', section: 'provider-keys' });
            }
        }

        if (this.usageLoadFailed) {
            add({ tone: 'error', title: 'Нет статистики Firestore', detail: 'Cloud Monitoring не ответил.', action: 'Повторить', run: () => this.loadFirestoreUsage(true).catch(() => {}) });
        } else if (this.firestoreUsage) {
            const labels = { reads: 'чтения', writes: 'записи', storage: 'хранилище' };
            Object.keys(labels).forEach((name) => {
                const metric = this.firestoreUsage[name];
                if (metric?.available !== true || !Number.isFinite(metric.percent)) return;
                if (metric.status !== 'warning' && metric.status !== 'critical') return;
                add({
                    tone: metric.status === 'critical' ? 'danger' : 'warning',
                    title: `Firestore: ${labels[name]} — ${Math.round(metric.percent)}% лимита`,
                    detail: name === 'storage' ? 'Место в бесплатном тарифе заканчивается.' : 'Дневной лимит сбрасывается по тихоокеанскому времени.',
                    action: 'Подробнее',
                    section: 'usage'
                });
            });
        }

        return items.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);
    };

    // Several loaders finish together; draw once after them. A microtask, not
    // requestAnimationFrame: that never fires in a background tab, and the overview stayed empty.
    proto.renderOverview = function renderOverview() {
        if (!this.workspaceReady || this.overviewRenderQueued) return;
        this.overviewRenderQueued = true;
        queueMicrotask(() => {
            this.overviewRenderQueued = false;
            this.renderOverviewNow();
        });
    };

    proto.renderOverviewNow = function renderOverviewNow() {
        const list = $('adminAttentionList');
        if (!list) return;
        const items = this.collectAttentionItems();
        const summary = $('adminAttentionSummary');
        const navCount = $('adminNavOverviewCount');
        const urgent = items.filter((item) => item.tone !== 'neutral').length;

        if (navCount) {
            navCount.textContent = urgent > 0 ? String(urgent) : '';
            navCount.dataset.tone = items.some((item) => item.tone === 'danger') ? 'danger' : (urgent > 0 ? 'warning' : '');
        }

        if (!items.length && this.overviewLoading) {
            list.setAttribute('aria-busy', 'true');
            if (summary) summary.textContent = 'Собираем задачи…';
        } else {
            list.setAttribute('aria-busy', String(Boolean(this.overviewLoading)));
            if (summary) {
                summary.textContent = items.length
                    ? `${plural(items.length, ['задача', 'задачи', 'задач'])} · сначала срочные`
                    : (this.overviewLoading ? 'Собираем задачи…' : 'Всё разобрано');
            }
            list.replaceChildren(...(items.length ? items.map((item) => this.createAttentionItem(item)) : [this.createAttentionEmpty()]));
        }

        const updated = $('adminOverviewUpdated');
        if (updated && !this.overviewLoading && this.overviewUpdatedAt) {
            updated.textContent = `Обновлено в ${formatTime(this.overviewUpdatedAt)}`;
        }
        this.renderHealthCards();
    };

    proto.createAttentionItem = function createAttentionItem(item) {
        const li = document.createElement('li');
        li.className = 'admin-attention-item';
        li.dataset.tone = item.tone;

        const mark = document.createElement('span');
        mark.className = 'admin-attention-mark';
        mark.setAttribute('aria-hidden', 'true');

        const text = document.createElement('div');
        text.className = 'admin-attention-text';
        const title = document.createElement('strong');
        title.textContent = item.title;
        const detail = document.createElement('span');
        detail.textContent = item.detail || '';
        text.append(title, detail);

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'admin-attention-action';
        button.textContent = item.action;
        button.addEventListener('click', () => {
            if (item.run) item.run();
            else this.showSection(item.section, { focus: true });
        });

        li.append(mark, text, button);
        return li;
    };

    proto.createAttentionEmpty = function createAttentionEmpty() {
        const li = document.createElement('li');
        li.className = 'admin-attention-empty';
        li.textContent = 'Новых заявок, репортов и задач проверки нет. Ключи и лимиты в норме.';
        return li;
    };

    proto.setHealthBadge = function setHealthBadge(id, text, tone) {
        const badge = $(id);
        if (!badge) return;
        badge.textContent = text;
        badge.dataset.tone = tone || 'neutral';
    };

    proto.renderHealthCards = function renderHealthCards() {
        // Firestore reads
        const reads = this.firestoreUsage?.reads;
        const writes = this.firestoreUsage?.writes;
        const readsValue = $('adminHealthReadsValue');
        const readsNote = $('adminHealthReadsNote');
        const readsBar = $('adminHealthReadsBar');
        if (this.usageLoadFailed) {
            if (readsValue) readsValue.textContent = '—';
            if (readsNote) readsNote.textContent = 'Статистика недоступна';
            this.setHealthBadge('adminHealthReadsBadge', 'Ошибка', 'danger');
        } else if (reads?.available === true && Number.isFinite(reads.percent)) {
            if (readsValue) readsValue.textContent = `${this.formatFirestoreCount(reads.usedToday)} из ${this.formatFirestoreCount(reads.limit)}`;
            if (readsBar) readsBar.style.width = `${Math.max(0, Math.min(100, reads.percent))}%`;
            const writesText = writes?.available === true ? `Записи: ${this.formatFirestoreCount(writes.usedToday)} из ${this.formatFirestoreCount(writes.limit)}` : 'Записи: нет данных';
            if (readsNote) readsNote.textContent = writesText;
            const tone = reads.status === 'critical' ? 'danger' : reads.status === 'warning' ? 'warning' : 'neutral';
            this.setHealthBadge('adminHealthReadsBadge', `${Math.round(reads.percent)}%`, tone);
        } else if (this.firestoreUsage) {
            if (readsValue) readsValue.textContent = '—';
            if (readsNote) readsNote.textContent = 'Cloud Monitoring не отдал метрику';
            this.setHealthBadge('adminHealthReadsBadge', 'Нет данных', 'neutral');
        }

        // Provider keys
        const keysValue = $('adminHealthKeysValue');
        const keysNote = $('adminHealthKeysNote');
        if (this.providerKeysLoadFailed) {
            if (keysValue) keysValue.textContent = '—';
            if (keysNote) keysNote.textContent = 'Не удалось загрузить ключи';
            this.setHealthBadge('adminHealthKeysBadge', 'Ошибка', 'danger');
        } else if (this.providerKeysFetched) {
            const active = this.providerKeys.filter((key) => key?.status === 'active').length;
            const problems = this.getProviderKeyProblems(this.providerKeys);
            if (keysValue) keysValue.textContent = `${active} ${Utils.selectRussianPlural(active, ['активный', 'активных', 'активных'])} из ${this.providerKeys.length}`;
            const quota = $('providerKeysQuotaValue')?.textContent?.trim();
            const quotaLabel = $('providerKeysQuotaLabel')?.textContent?.trim();
            if (keysNote) keysNote.textContent = problems[0]?.text || (quota && quota !== '— / —' ? `${quotaLabel}: ${quota}` : 'Квоты в норме');
            this.setHealthBadge('adminHealthKeysBadge', problems.length ? 'Внимание' : 'В норме', problems.length ? 'warning' : 'neutral');
        }

        // Community
        const usersValue = $('adminHealthUsersValue');
        const usersNote = $('adminHealthUsersNote');
        if (this.communityCounts) {
            const { users, ratings } = this.communityCounts;
            if (usersValue) usersValue.textContent = Number.isFinite(users) ? plural(users, ['участник', 'участника', 'участников']) : '—';
            const parts = [];
            if (Number.isFinite(ratings)) parts.push(plural(ratings, ['оценка', 'оценки', 'оценок']));
            if (Array.isArray(this.pendingUsers) && !this.approvalsLoadFailed) parts.push(`${this.pendingUsers.length} ждут одобрения`);
            if (usersNote) usersNote.textContent = parts.join(' · ') || 'Нет данных';
        }

        this.renderLiveHealth();
    };

    proto.initLiveMirror = function initLiveMirror() {
        const card = $('liveNowCard');
        if (!card || typeof MutationObserver === 'undefined') return;
        const observer = new MutationObserver(() => this.renderLiveHealth());
        observer.observe(card, { attributes: true, attributeFilter: ['data-state'], subtree: true, childList: true, characterData: true });
        this.renderLiveHealth();
    };

    proto.renderLiveHealth = function renderLiveHealth() {
        const card = $('liveNowCard');
        if (!card) return;
        const state = card.dataset.state || 'off';
        const stateText = $('liveNowState')?.textContent?.trim() || '';
        const title = $('liveNowTitle')?.textContent?.trim() || '';
        const meta = $('liveNowMeta')?.textContent?.trim() || '';
        const onAir = state === 'live';
        const titleEl = $('adminHealthLiveTitle');
        const metaEl = $('adminHealthLiveMeta');
        if (titleEl && title) titleEl.textContent = title;
        if (metaEl) metaEl.textContent = meta;
        this.setHealthBadge('adminHealthLiveBadge', stateText || (onAir ? 'В эфире' : 'Выключен'), onAir ? 'danger' : 'neutral');
        const nav = $('adminNavLiveState');
        if (nav) {
            nav.textContent = onAir ? 'В эфире' : '';
            nav.dataset.tone = onAir ? 'danger' : '';
        }
    };

    proto.runQuickAction = function runQuickAction(action) {
        if (action === 'live-add') {
            this.showSection('live-channel');
            $('livePlannerAdd')?.click();
        } else if (action === 'manual-mapping') {
            this.showSection('tmdb-fallbacks');
            this.switchIdentitySubtab?.('tmdb-to-kp');
            const input = $('manualMapTmdbId');
            input?.scrollIntoView({ block: 'center' });
            input?.focus({ preventScroll: true });
        } else if (action === 'add-key') {
            this.showSection('provider-keys');
            this.openAddProviderKeyModal();
        } else if (action === 'approvals') {
            this.showSection('approvals', { focus: true });
        }
    };

    // ---- Ctrl+K search -------------------------------------------------------------------

    proto.initAdminSearch = function initAdminSearch() {
        const wrap = $('adminSearch');
        const input = $('adminSearchInput');
        const results = $('adminSearchResults');
        if (!wrap || !input || !results) return;
        wrap.hidden = false;
        this.searchResults = [];
        this.searchActiveIndex = -1;

        document.addEventListener('keydown', (event) => {
            if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.key === 'k' || event.key === 'K' || event.code === 'KeyK')) {
                event.preventDefault();
                input.focus();
                input.select();
            }
        });
        input.addEventListener('input', () => this.updateAdminSearch(input.value));
        input.addEventListener('focus', () => { if (input.value.trim()) this.updateAdminSearch(input.value); });
        input.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                if (!this.searchResults.length) return;
                const step = event.key === 'ArrowDown' ? 1 : -1;
                this.setSearchActive((this.searchActiveIndex + step + this.searchResults.length) % this.searchResults.length);
            } else if (event.key === 'Enter') {
                const item = this.searchResults[this.searchActiveIndex >= 0 ? this.searchActiveIndex : 0];
                if (item) {
                    event.preventDefault();
                    this.pickSearchResult(item);
                }
            } else if (event.key === 'Escape') {
                if (!results.hidden) {
                    event.preventDefault();
                    this.closeAdminSearch();
                } else {
                    input.blur();
                }
            }
        });
        document.addEventListener('click', (event) => {
            if (!wrap.contains(event.target)) this.closeAdminSearch();
        });
    };

    proto.closeAdminSearch = function closeAdminSearch() {
        const results = $('adminSearchResults');
        const input = $('adminSearchInput');
        if (results) results.hidden = true;
        input?.setAttribute('aria-expanded', 'false');
        input?.removeAttribute('aria-activedescendant');
        this.searchActiveIndex = -1;
    };

    proto.buildAdminSearchResults = function buildAdminSearchResults(rawQuery) {
        const query = rawQuery.trim().toLowerCase();
        if (!query) return [];
        const results = [];
        const seenUsers = new Set();

        Object.entries(SECTIONS).forEach(([key, label]) => {
            const haystack = `${label} ${SECTION_HINTS[key] || ''}`.toLowerCase();
            if (haystack.includes(query)) results.push({ kind: 'section', group: 'Разделы', label, meta: 'Открыть раздел', section: key });
        });

        const cachedUsers = (() => {
            try { return this.cacheService?.getCachedUsers?.() || []; } catch { return []; }
        })();
        [...(this.pendingUsers || []), ...(this.users || []), ...cachedUsers].forEach((user) => {
            if (!user?.id || seenUsers.has(user.id)) return;
            const haystack = `${user.displayName || ''} ${user.email || ''} ${user.id}`.toLowerCase();
            if (!haystack.includes(query)) return;
            seenUsers.add(user.id);
            results.push({ kind: 'user', group: 'Пользователи', label: user.displayName || 'Пользователь без имени', meta: user.email || user.id, user });
        });

        (this.unmappedQueueData || []).forEach((item) => {
            const haystack = `${item.title || ''} ${item.originalTitle || ''} ${item.tmdbId || ''}`.toLowerCase();
            if (!haystack.includes(query)) return;
            results.push({ kind: 'identity', group: 'Проверка ID', label: item.title || item.originalTitle || `TMDB ${item.tmdbId}`, meta: `${item.year || 'год неизвестен'} · TMDB ${item.mediaType}:${item.tmdbId}`, key: item.key });
        });

        const numeric = query.match(/^\d{2,}$/);
        if (numeric) {
            results.push({ kind: 'manual-tmdb', group: 'Действия', label: `Связать TMDB ${numeric[0]} с Кинопоиском`, meta: 'Ручная связь', tmdbId: numeric[0] });
        }

        const order = ['Разделы', 'Пользователи', 'Проверка ID', 'Действия'];
        return results
            .sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group))
            .slice(0, 10);
    };

    proto.updateAdminSearch = function updateAdminSearch(value) {
        const results = $('adminSearchResults');
        const input = $('adminSearchInput');
        if (!results || !input) return;
        this.searchResults = this.buildAdminSearchResults(value);
        this.searchActiveIndex = this.searchResults.length ? 0 : -1;

        if (!value.trim()) {
            this.closeAdminSearch();
            return;
        }

        const nodes = [];
        let lastGroup = '';
        if (!this.searchResults.length) {
            const empty = document.createElement('div');
            empty.className = 'admin-search-empty';
            empty.textContent = 'Ничего не нашлось. Пользователи ищутся среди загруженных страниц.';
            nodes.push(empty);
        }
        this.searchResults.forEach((item, index) => {
            if (item.group !== lastGroup) {
                lastGroup = item.group;
                const group = document.createElement('div');
                group.className = 'admin-search-group';
                group.setAttribute('role', 'presentation');
                group.textContent = item.group;
                nodes.push(group);
            }
            const option = document.createElement('div');
            option.className = 'admin-search-option';
            option.id = `adminSearchOption${index}`;
            option.setAttribute('role', 'option');
            option.setAttribute('aria-selected', String(index === this.searchActiveIndex));
            const label = document.createElement('span');
            label.className = 'admin-search-option-label';
            label.textContent = item.label;
            const meta = document.createElement('span');
            meta.className = 'admin-search-option-meta';
            meta.textContent = item.meta;
            option.append(label, meta);
            option.addEventListener('click', () => this.pickSearchResult(item));
            nodes.push(option);
        });
        results.replaceChildren(...nodes);
        results.hidden = false;
        input.setAttribute('aria-expanded', 'true');
        if (this.searchActiveIndex >= 0) input.setAttribute('aria-activedescendant', `adminSearchOption${this.searchActiveIndex}`);
        else input.removeAttribute('aria-activedescendant');
    };

    proto.setSearchActive = function setSearchActive(index) {
        this.searchActiveIndex = index;
        const input = $('adminSearchInput');
        document.querySelectorAll('#adminSearchResults [role="option"]').forEach((option, position) => {
            const isActive = position === index;
            option.setAttribute('aria-selected', String(isActive));
            if (isActive) option.scrollIntoView({ block: 'nearest' });
        });
        input?.setAttribute('aria-activedescendant', `adminSearchOption${index}`);
    };

    proto.pickSearchResult = function pickSearchResult(item) {
        const input = $('adminSearchInput');
        this.closeAdminSearch();
        if (input) input.value = '';

        if (item.kind === 'section') {
            this.showSection(item.section, { focus: true });
        } else if (item.kind === 'user') {
            this.showSection('users');
            this.selectedUserId = item.user.id;
            const known = (this.users || []).find((user) => user.id === item.user.id);
            this.renderUserDetail(known || item.user);
            document.querySelectorAll('#usersTableBody tr[data-user-id]').forEach((row) => {
                row.classList.toggle('is-selected', row.dataset.userId === item.user.id);
            });
            $('userDetailPanel')?.scrollIntoView({ block: 'nearest' });
        } else if (item.kind === 'identity') {
            this.showSection('tmdb-fallbacks');
            this.switchIdentitySubtab?.('tmdb-to-kp');
            this.selectIdentityTask?.(item.key, { focus: true });
        } else if (item.kind === 'manual-tmdb') {
            this.showSection('tmdb-fallbacks');
            this.switchIdentitySubtab?.('tmdb-to-kp');
            const tmdbInput = $('manualMapTmdbId');
            if (tmdbInput) {
                tmdbInput.value = item.tmdbId;
                tmdbInput.scrollIntoView({ block: 'center' });
                $('manualMapKpId')?.focus({ preventScroll: true });
            }
        }
    };
})();
