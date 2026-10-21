/** Discover in a hidden site context, with a temporary inactive-tab fallback. */
(function (global) {
    'use strict';
    function error(code) { return Object.assign(new Error(code), { code }); }

    // Serialized by chrome.scripting; keep this function self-contained.
    async function inProviderPage(action, input, extensionRequest = false) {
        const origin = 'https://hdrezka.co';
        if (!extensionRequest && location.origin !== origin) return { error: 'HDREZKA_ACCESS_REQUIRED' };
        const fail = code => { throw Object.assign(new Error(code), { code }); };
        const pageUrl = value => {
            let url;
            try { url = new URL(value); } catch { fail('HDREZKA_INVALID_REQUEST'); }
            if (url.origin !== origin || url.username || url.password || url.search || url.hash
                || !/^\/films\/[a-z-]+\/[1-9]\d*-[a-z0-9-]+\.html$/.test(url.pathname)) fail('HDREZKA_INVALID_REQUEST');
            return url.href;
        };
        async function read(url, options = {}) {
            const response = await fetch(url, { ...options, credentials: extensionRequest ? 'include' : 'same-origin', redirect: 'error', signal: AbortSignal.timeout(8000) });
            const text = await response.text();
            if (response.status === 403 || /challenge-platform|cf-chl|Just a moment\.\.\./i.test(text)) fail('HDREZKA_ACCESS_REQUIRED');
            if (!response.ok || text.length > 2000000) fail('HDREZKA_UNAVAILABLE');
            return text;
        }
        function details(doc, url) {
            const movieId = new URL(url).pathname.match(/\/([1-9]\d*)-[^/]+\.html$/)?.[1];
            const items = [...doc.querySelectorAll('#translators-list [data-translator_id]')];
            const ordinary = items.filter(node => !/premium/i.test(node.className) && !node.classList.contains('b-prem_translator')
                && node.getAttribute('data-premium') !== '1' && node.getAttribute('data-is_premium') !== '1')
                .map(node => ({ id: node.getAttribute('data-translator_id'), name: node.textContent.trim().slice(0, 120) }))
                .filter(item => /^[1-9]\d{0,8}$/.test(item.id) && item.name);
            const translations = [...new Map(ordinary.map(item => [item.id, item])).values()];
            let kinopoiskId = null;
            for (const link of doc.querySelectorAll('a[href]')) {
                let target = link.getAttribute('href') || '';
                try { if (target.includes('/help/')) target = decodeURIComponent(atob(target.split('/help/')[1].split('/')[0])); } catch { continue; }
                const match = /^https:\/\/(?:www\.)?kinopoisk\.ru\/film\/([1-9]\d*)\//.exec(target);
                if (match) { kinopoiskId = match[1]; break; }
            }
            const activeId = items.find(node => node.classList.contains('active'))?.getAttribute('data-translator_id');
            return { movieId, kinopoiskId, translations,
                activeTranslationId: translations.find(item => item.id === activeId)?.id || translations[0]?.id || null };
        }
        try {
            if (action === 'search') {
                if (typeof input.query !== 'string' || input.query.length < 2 || input.query.length > 200) fail('HDREZKA_INVALID_REQUEST');
                const url = new URL('/search/', origin);
                url.search = new URLSearchParams({ do: 'search', subaction: 'search', q: input.query });
                const doc = new DOMParser().parseFromString(await read(url.href), 'text/html');
                const results = [...doc.querySelectorAll('.b-content__inline_item')].slice(0, 80).flatMap(card => {
                    const link = card.querySelector('.b-content__inline_item-link a');
                    if (!link) return [];
                    let target;
                    try { target = pageUrl(new URL(link.getAttribute('href'), origin).href); } catch { return []; }
                    const metadata = card.querySelector('.b-content__inline_item-link div')?.textContent || card.textContent;
                    const year = metadata.match(/(?:19|20)\d{2}/)?.[0];
                    return [{ url: target, title: link.textContent.trim().slice(0, 200), year: year || null, isSeries: false }];
                });
                return { results };
            }
            if (!['details', 'streams'].includes(action)) fail('HDREZKA_INVALID_REQUEST');
            const url = pageUrl(input.url);
            const doc = new DOMParser().parseFromString(await read(url), 'text/html');
            const info = details(doc, url);
            if (!info.movieId) fail('HDREZKA_UNAVAILABLE');
            if (!info.translations.length) fail('HDREZKA_NO_TRANSLATIONS');
            if (action === 'details') return info;
            const translationId = info.translations.some(item => item.id === input.translationId) ? input.translationId : info.activeTranslationId;
            const body = new URLSearchParams({ id: info.movieId, translator_id: translationId,
                is_camrip: '0', is_ads: '0', is_director: '0', action: 'get_movie', favs: doc.getElementById('ctrl_favs')?.value || '' });
            const text = await read(new URL('/ajax/get_cdn_series/', origin).href, {
                method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' }, body
            });
            let response;
            try { response = JSON.parse(text); }
            catch { fail('HDREZKA_INVALID_RESPONSE'); }
            if (Number(response?.premium_content) > 0) fail('HDREZKA_PREMIUM_REQUIRED');
            if (response?.success !== true) fail('HDREZKA_STREAM_UNAVAILABLE');
            return { ...info, activeTranslationId: translationId, response };
        } catch (failure) {
            return { error: /^HDREZKA_/.test(failure?.code || '') ? failure.code : 'HDREZKA_UNAVAILABLE' };
        }
    }

    // The background owns temporary acquisition across all extension pages.
    // User-opened tabs are never closed; only an automatically created context
    // may be removed after its last discovery request has settled.
    class HdrezkaSiteSessionCoordinator {
        constructor(api = global.chrome, requestHidden = null) {
            this.api = api;
            this.requestHidden = requestHidden;
            this.opening = null;
            this.sessionTabId = null;
            this.activeRequests = 0;
            this.cleanupTimer = null;
            this.closing = null;
            this.ownershipReady = (async () => {
                try {
                    const stored = (await this.api.storage?.session?.get('hdrezkaSiteSessionTab'))?.hdrezkaSiteSessionTab;
                    if (Number.isInteger(stored)) { this.sessionTabId = stored; this.scheduleCleanup(); }
                } catch { /* Acquisition also works without session persistence. */ }
            })();
            this.api.tabs.onActivated?.addListener(({ tabId }) => { void this.promoteSession(tabId); });
            this.api.tabs.onUpdated?.addListener((tabId, change) => {
                if (change.pinned === true) void this.promoteSession(tabId);
            });
        }

        async promoteSession(tabId) {
            await this.ownershipReady;
            if (this.sessionTabId !== tabId) return;
            clearTimeout(this.cleanupTimer);
            this.sessionTabId = null;
            try { await this.api.storage?.session?.remove('hdrezkaSiteSessionTab'); }
            catch { /* Explicitly used contexts no longer belong to cleanup. */ }
        }

        async ensureSite(query = '') {
            if (typeof query !== 'string' || query.length > 200) throw error('HDREZKA_INVALID_REQUEST');
            await this.ownershipReady;
            if (this.closing) await this.closing;
            if (this.opening) return this.opening;
            const work = (async () => {
                const tabs = await this.api.tabs.query({ url: 'https://hdrezka.co/*' });
                const tab = tabs.find(item => item.status === 'complete') || tabs[0];
                if (tab) return tab.id;
                // A newly created tab may still have only pendingUrl and be
                // absent from a URL-filtered query. Retain its ID across calls
                // and worker restarts, including a failed initial navigation.
                let stored = this.sessionTabId;
                if (stored === null) {
                    try { stored = (await this.api.storage?.session?.get('hdrezkaSiteSessionTab'))?.hdrezkaSiteSessionTab; }
                    catch { /* Session persistence is optional for acquisition. */ }
                }
                if (Number.isInteger(stored)) {
                    try {
                        const pending = await this.api.tabs.get(stored);
                        const target = pending.pendingUrl || pending.url || '';
                        if (target.startsWith('https://hdrezka.co/') || target === 'chrome-error://chromewebdata/'
                            || !target && pending.status === 'loading') {
                            this.sessionTabId = stored;
                            return stored;
                        }
                    } catch { /* A closed context is reacquired on demand. */ }
                }
                this.sessionTabId = null;
                const url = new URL(query ? '/search/' : '/', 'https://hdrezka.co');
                if (query) url.search = new URLSearchParams({ do: 'search', subaction: 'search', q: query });
                const created = await this.api.tabs.create({ url: url.href, active: false });
                this.sessionTabId = created.id;
                try { await this.api.storage?.session?.set({ hdrezkaSiteSessionTab: created.id }); }
                catch { /* In-memory ownership still prevents duplicate tabs. */ }
                return created.id;
            })().finally(() => { this.opening = null; });
            this.opening = work;
            return work;
        }

        async closeIdleSession() {
            this.cleanupTimer = null;
            if (this.activeRequests || !Number.isInteger(this.sessionTabId)) return;
            const id = this.sessionTabId;
            try {
                const tab = await this.api.tabs.get(id);
                if (this.activeRequests || this.sessionTabId !== id) return;
                const target = tab.pendingUrl || tab.url || '';
                // A tab explicitly focused by the user, or navigated elsewhere,
                // is no longer an unattended bootstrap context.
                if (!tab.active && !tab.pinned && (target.startsWith('https://hdrezka.co/') || target === 'chrome-error://chromewebdata/')) {
                    await this.api.tabs.remove(id);
                }
            } catch { /* The user may already have closed the owned context. */ }
            if (this.sessionTabId === id) {
                this.sessionTabId = null;
                try { await this.api.storage?.session?.remove('hdrezkaSiteSessionTab'); }
                catch { /* Stale IDs are verified before reuse. */ }
            }
        }

        scheduleCleanup() {
            clearTimeout(this.cleanupTimer);
            if (!this.activeRequests && Number.isInteger(this.sessionTabId)) {
                this.cleanupTimer = setTimeout(() => {
                    this.closing = this.closeIdleSession().finally(() => { this.closing = null; });
                }, 1500);
            }
        }

        async request(action, input) {
            if (!validRequest(action, input)) return { error: 'HDREZKA_INVALID_REQUEST' };
            await this.ownershipReady;
            this.activeRequests++;
            clearTimeout(this.cleanupTimer);
            try {
                if (this.closing) await this.closing;
                const existing = await this.api.tabs.query({ url: 'https://hdrezka.co/*' });
                if (!existing.length && this.requestHidden) {
                    const hidden = await this.requestHidden(action, input).catch(() => ({ error: 'HDREZKA_ACCESS_REQUIRED' }));
                    if (hidden && !['HDREZKA_ACCESS_REQUIRED', 'HDREZKA_UNAVAILABLE'].includes(hidden.error)) return hidden;
                }
                const tabId = await this.ensureSite();
                await waitForSiteTab(this.api, tabId);
                const results = await this.api.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: inProviderPage, args: [action, input] });
                const result = results?.[0]?.result || { error: 'HDREZKA_ACCESS_REQUIRED' };
                if (!result.error && this.requestHidden && this.sessionTabId === tabId) {
                    // Top-level navigation may refresh browser-managed access.
                    // Verify the hidden context before discarding the bootstrap.
                    const hidden = await this.requestHidden(action, input).catch(() => null);
                    if (hidden && !hidden.error) return hidden;
                }
                return result;
            } catch { return { error: 'HDREZKA_ACCESS_REQUIRED' }; }
            finally { this.activeRequests--; this.scheduleCleanup(); }
        }

        async handleMessage(message, sender) {
            if (!['HDREZKA_SITE_REQUEST', 'HDREZKA_ENSURE_SITE_SESSION', 'HDREZKA_OPEN_SITE'].includes(message?.type)) return null;
            if (sender?.id !== this.api.runtime.id || typeof sender?.url !== 'string'
                || !sender.url.startsWith(this.api.runtime.getURL(''))) return { error: 'HDREZKA_INVALID_REQUEST' };
            let opening = false;
            try {
                await this.ownershipReady;
                if (message.type === 'HDREZKA_SITE_REQUEST') return await this.request(message.action, message.input);
                if (message.type === 'HDREZKA_OPEN_SITE') {
                    opening = true;
                    this.activeRequests++;
                    clearTimeout(this.cleanupTimer);
                }
                const tabId = await this.ensureSite(message.type === 'HDREZKA_OPEN_SITE' ? message.query : '');
                if (message.type === 'HDREZKA_OPEN_SITE') {
                    clearTimeout(this.cleanupTimer);
                    await this.api.tabs.update(tabId, { active: true });
                    await this.promoteSession(tabId);
                }
                return { tabId };
            } catch (failure) {
                this.scheduleCleanup();
                return { error: failure?.code === 'HDREZKA_INVALID_REQUEST' ? failure.code : 'HDREZKA_ACCESS_REQUIRED' };
            } finally { if (opening) { this.activeRequests--; this.scheduleCleanup(); } }
        }
    }

    function validRequest(action, input) {
        return ['search', 'details', 'streams'].includes(action) && input && typeof input === 'object' && !Array.isArray(input)
            && (action === 'search' ? typeof input.query === 'string' && input.query.length >= 2 && input.query.length <= 200
                : Boolean(global.HdrezkaProtocol.pageUrl(input.url)));
    }

    async function waitForSiteTab(api, tabId) {
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
            const tab = await api.tabs.get(tabId);
            if (tab.status === 'complete') return;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw error('HDREZKA_ACCESS_REQUIRED');
    }

    class HdrezkaSessionService {
        constructor(api = global.chrome) {
            this.api = api;
            this.pending = new Map();
            this.cleanups = new Set();
            this.requiresSiteContext = false;
            this.openingSite = null;
        }

        async siteTab(query = '') {
            const result = await this.api.runtime.sendMessage({ type: 'HDREZKA_OPEN_SITE', query });
            if (!Number.isInteger(result?.tabId) || result.tabId < 0) throw error('HDREZKA_ACCESS_REQUIRED');
            return result.tabId;
        }

        // Explicit recovery may focus the same session; ordinary discovery
        // and playback never focus it or navigate a reused user tab.
        async openSite(query = '') {
            if (typeof query !== 'string' || query.length > 200) throw error('HDREZKA_INVALID_REQUEST');
            if (this.openingSite) return this.openingSite;
            const work = this.siteTab(query).finally(() => { this.openingSite = null; });
            this.openingSite = work;
            return work;
        }

        async request(action, input = {}) {
            if (!validRequest(action, input)) throw error('HDREZKA_INVALID_REQUEST');
            const key = JSON.stringify([action, input]);
            if (this.pending.has(key)) return this.pending.get(key);
            const work = this._request(action, input).finally(() => this.pending.delete(key));
            this.pending.set(key, work);
            return work;
        }

        async _request(action, input) {
            try {
                const tabs = await this.api.tabs.query({ url: 'https://hdrezka.co/*' });
                const tab = tabs.find(item => item.status === 'complete') || tabs[0];
                let result;
                if (!tab && !this.requiresSiteContext) {
                    result = await inProviderPage(action, input, true);
                    if (['HDREZKA_ACCESS_REQUIRED', 'HDREZKA_UNAVAILABLE'].includes(result?.error)) this.requiresSiteContext = true;
                }
                if (tab || this.requiresSiteContext) {
                    result = await this.api.runtime.sendMessage({ type: 'HDREZKA_SITE_REQUEST', action, input });
                }
                if (result?.error === 'HDREZKA_ACCESS_REQUIRED') this.requiresSiteContext = true;
                if (!result || result.error) throw error(result?.error || 'HDREZKA_UNAVAILABLE');
                return result;
            } catch (failure) {
                throw error(/^HDREZKA_/.test(failure?.code || '') ? failure.code : 'HDREZKA_ACCESS_REQUIRED');
            }
        }

        async resolve(value) {
            const url = global.HdrezkaProtocol.streamUrl(value, { routing: true });
            if (!url) throw error('HDREZKA_INVALID_STREAM');
            const api = this.api;
            const nonce = crypto.randomUUID().replaceAll('-', '');
            let frame;
            let port;
            let timer;
            let cancel;
            const cleanup = () => {
                clearTimeout(timer);
                port?.disconnect();
                frame?.remove();
                this.cleanups.delete(cancel);
            };
            try {
                const parent = global.document?.body || global.document?.documentElement;
                if (!parent) throw error('HDREZKA_RESOLVER_SETUP_FAILED');
                frame = global.document.createElement('iframe');
                frame.hidden = true;
                frame.style.display = 'none';
                frame.dataset.hdrezkaResolver = nonce;
                frame.src = api.runtime.getURL(`src/pages/hdrezka-resolver/resolver.html#${nonce}`);
                const result = await new Promise((resolve, reject) => {
                    cancel = () => reject(error('HDREZKA_RESOLVER_DISCONNECTED'));
                    this.cleanups.add(cancel);
                    timer = setTimeout(() => reject(Object.assign(error('HDREZKA_RESOLVE_FAILED'), { cdnReason: 'timeout' })), 12000);
                    frame.addEventListener('error', () => reject(error('HDREZKA_RESOLVER_SETUP_FAILED')), { once: true });
                    frame.addEventListener('load', () => {
                        try {
                            port = api.runtime.connect({ name: `hdrezka-resolver:${nonce}` });
                            port.onMessage.addListener(message => {
                                if (message?.url) resolve(message.url);
                                else {
                                    const diagnostic = global.HdrezkaProtocol.resolverFailure({ ...message, code: message?.error });
                                    reject(Object.assign(error(diagnostic.code), diagnostic));
                                }
                            });
                            port.onDisconnect.addListener(() => { void api.runtime.lastError; cancel(); });
                            port.postMessage({ url });
                        } catch { reject(error('HDREZKA_RESOLVER_SETUP_FAILED')); }
                    }, { once: true });
                    parent.appendChild(frame);
                });
                const final = global.HdrezkaProtocol.streamUrl(result);
                if (!final || new URL(final).pathname !== new URL(url).pathname || new URL(final).search !== new URL(url).search) throw error('HDREZKA_INVALID_STREAM');
                return final;
            } catch (failure) {
                const code = failure?.code;
                const result = error(/^HDREZKA_/.test(code || '') && code !== 'HDREZKA_ACCESS_REQUIRED' ? code : 'HDREZKA_RESOLVER_SETUP_FAILED');
                const diagnostic = global.HdrezkaProtocol.resolverFailure(failure);
                delete diagnostic.code;
                throw Object.assign(result, diagnostic);
            } finally { cleanup(); }
        }

        dispose() { for (const cleanup of [...this.cleanups]) void cleanup(); }
    }
    global.HdrezkaSiteSessionCoordinator = HdrezkaSiteSessionCoordinator;
    global.HdrezkaSiteRequest = inProviderPage;
    global.HdrezkaSessionService = HdrezkaSessionService;
})(typeof window !== 'undefined' ? window : globalThis);
