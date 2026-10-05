import assert from 'node:assert';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const { MovieDetailsPlayerSurface } = await import('../src/pages/movie-details/PlayerSurface.js')
    .then(module => module.default || module);

console.log('🧪 Running MovieDetails player audit regression tests...');

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../src/pages/movie-details/movie-details.html');
const source = read('../src/pages/movie-details/movie-details.js');
const playerCss = read('../src/shared/styles/player.css');

// Methods installed onto MovieDetails from the page's panel modules.
const methodSource = [
    source,
    read('../src/pages/movie-details/TorrentSourcePanel.js'),
    read('../src/pages/movie-details/WatchRoomPanel.js'),
    read('../src/pages/movie-details/MetaRenderer.js')
].join('\n');

function extractMethod(name) {
    const signature = new RegExp(`\\n    (?:async )?${name}\\(([^)]*)\\) \\{`);
    const match = signature.exec(methodSource);
    assert.ok(match, `method ${name} must exist`);
    const bodyStart = match.index + match[0].length;
    let depth = 1;
    let index = bodyStart;
    while (depth > 0 && index < methodSource.length) {
        const char = methodSource[index];
        if (char === '{') depth += 1;
        else if (char === '}') depth -= 1;
        index += 1;
    }
    const isAsync = match[0].includes('async ');
    return new Function(`return ${isAsync ? 'async ' : ''}function ${name}(${match[1]}) {${methodSource.slice(bodyStart, index - 1)}}`)();
}

function createElement(id = '') {
    const attributes = new Map();
    return {
        id,
        style: {},
        hidden: false,
        disabled: false,
        dataset: {},
        textContent: '',
        classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
        setAttribute: (key, value) => attributes.set(key, String(value)),
        getAttribute: key => attributes.get(key) ?? null,
        removeAttribute: key => attributes.delete(key),
        querySelector: () => null,
        querySelectorAll: () => []
    };
}

// 1. The auto-next prompt must survive every player-surface reset.
{
    const { document } = new JSDOM(html).window;
    const container = document.getElementById('videoContainer');
    const prompt = document.getElementById('playerAutoNextPrompt');
    assert.ok(container && prompt, 'player container and auto-next prompt must exist');
    assert.equal(container.contains(prompt), false, 'auto-next prompt must not live inside the resettable video container');
    const stage = container.parentElement;
    assert.ok(stage?.classList.contains('player-stage'), 'video container must be wrapped by the player stage');
    assert.equal(stage.contains(prompt), true, 'auto-next prompt must be positioned by the player stage');

    container.innerHTML = '';
    assert.equal(prompt.isConnected, true, 'clearing the video container must keep the auto-next prompt attached');
    assert.match(playerCss, /\.player-stage\s*\{[^}]*position:\s*relative/, 'player stage must anchor overlay positioning');
}

// 2. KinoGo/Ex-FS films must not enable the provider episode arrows.
{
    const updatePlayerNavigationControls = extractMethod('updatePlayerNavigationControls');
    const runNavigation = (movie, selection) => {
        const messages = [];
        const iframe = {
            src: 'https://provider.example/embed',
            dataset: { playerSourceActive: 'true' },
            contentWindow: { postMessage: message => messages.push(message) },
            addEventListener() {},
            getAttribute() { return this.src; }
        };
        const elements = {
            playerNavControls: createElement('playerNavControls'),
            playerPrevEpisodeBtn: createElement('playerPrevEpisodeBtn'),
            playerNextEpisodeBtn: createElement('playerNextEpisodeBtn'),
            playerEpisodesListBtn: createElement('playerEpisodesListBtn'),
            videoContainer: {
                querySelector: () => iframe,
                querySelectorAll: () => [iframe]
            }
        };
        const adapter = {
            id: 'kinogo',
            supportsNativeBridgeSource: () => true,
            supportsPrevNext: () => true,
            supportsEpisodePicker: () => true,
            canHandle: () => true
        };
        const manager = {
            selectedMovie: movie,
            elements,
            activePlayerId: 'kinogo',
            unavailableProviderIds: new Set(),
            providerAdapters: { kinogo: adapter },
            playbackController: {
                getSelection: () => selection,
                getSelectionContext: () => ({ selection, selectionVersion: 1 }),
                getActiveProvider: () => 'kinogo',
                getAdapter: () => adapter
            },
            postToPlayerFrame: (frame, message) => frame.contentWindow.postMessage(message),
            getEpisodeSequence: () => [],
            getSeasonEpisodeCount: () => 0
        };
        const originalDocument = globalThis.document;
        const originalInfo = console.info;
        globalThis.document = undefined;
        console.info = () => {};
        try {
            try {
                updatePlayerNavigationControls.call(manager);
            } catch {
                // Later navigation rendering needs a richer page harness; the
                // canonical dispatch decision happens before that point.
            }
        } finally {
            globalThis.document = originalDocument;
            console.info = originalInfo;
            manager._canonicalPickerSyncTimers?.forEach(timer => clearTimeout(timer));
        }
        return messages.filter(message => message?.type === 'SET_CANONICAL_PICKER_MODE' && message.enabled);
    };

    assert.equal(
        runNavigation({ kinopoiskId: 1, type: 'movie' }, { seasonNumber: null, episodeNumber: null }).length,
        0,
        'films must not ask KinoGo/Ex-FS to show episode arrows'
    );
    assert.ok(
        runNavigation({ kinopoiskId: 2, type: 'tv-series' }, { seasonNumber: 1, episodeNumber: 2 }).length > 0,
        'series must still enable canonical episode navigation'
    );
}

// 3. Close button closes; backdrop click only minimizes.
{
    const closeVideoModal = extractMethod('closeVideoModal');
    const calls = [];
    const manager = {
        isEmbedded: false,
        activePlayerId: 'kinogo',
        closeEpisodePicker: () => calls.push('picker'),
        minimizePlayer: () => calls.push('minimize'),
        destroyPlayer: () => calls.push('destroy'),
        releasePlayerRegistryEntry: id => calls.push(`release:${id}`)
    };
    await closeVideoModal.call(manager);
    assert.ok(calls.includes('destroy'), 'close must destroy the player');
    assert.ok(calls.includes('release:kinogo'), 'close must release the active provider frame so audio cannot continue');
    assert.equal(calls.includes('minimize'), false, 'close must not minimize');

    const backdropListener = source.match(/videoPlayerModal\.addEventListener\('mousedown', \(e\) => \{([\s\S]*?)\}\);/)?.[1] || '';
    assert.match(backdropListener, /minimizePlayer\(\)/, 'backdrop click must minimize the player');
    assert.doesNotMatch(backdropListener, /closeVideoModal/, 'backdrop click must not close the player');
    assert.match(html, /id="minimizeVideoBtn"[^>]*type="button"[^>]*aria-label=/, 'player header must expose an explicit minimize control');
}

// 4. Admin-only announce button uses one correct, icon-based markup.
{
    assert.doesNotMatch(source, /Аннонс/, 'announce label must be spelled correctly');
    assert.doesNotMatch(source, /📣/, 'announce button must not use a colored emoji');
    const patchAdminControl = extractMethod('patchAdminControl');
    let inserted = '';
    const actions = {
        querySelector: () => null,
        insertAdjacentHTML: (_position, markup) => { inserted = markup; }
    };
    const manager = {
        authVerified: true,
        selectedMovie: { kinopoiskId: 42 },
        elements: { movieDetailsContainer: { querySelector: () => actions } },
        isPageContextCurrent: () => true,
        renderAnnounceButton: extractMethod('renderAnnounceButton')
    };
    patchAdminControl.call(manager, true, {});
    assert.match(inserted, /announce-movie-btn/);
    assert.match(inserted, /Анонсировать/);
    assert.match(inserted, /<svg/);

    inserted = '';
    patchAdminControl.call(manager, false, {});
    assert.equal(inserted, '', 'non-admins must not receive the announce button');
}

// 5. Provider URLs cannot inject frame attributes or non-web schemes.
{
    const dom = new JSDOM('<div id="videoContainer"></div>', { url: 'chrome-extension://test-id/src/pages/movie-details/movie-details.html' });
    const originalDocument = globalThis.document;
    const originalWindow = globalThis.window;
    globalThis.document = dom.window.document;
    globalThis.window = dom.window;
    try {
        const container = dom.window.document.getElementById('videoContainer');
        const surface = new MovieDetailsPlayerSurface({ getContainer: () => container });
        const getPlayerFrameOrigin = extractMethod('getPlayerFrameOrigin');
        assert.equal(MovieDetailsPlayerSurface.getSafeWebUrl('javascript:alert(1)'), null);
        assert.equal(MovieDetailsPlayerSurface.getSafeWebUrl('data:text/html,<b>x</b>'), null);
        assert.equal(MovieDetailsPlayerSurface.getSafeWebUrl(''), null, 'empty URLs must not resolve to the extension page');
        assert.equal(surface.mountFrame('javascript:alert(1)'), false);
        assert.match(container.textContent, /некорректный адрес/, 'rejected frames must explain the failure');

        assert.equal(surface.mountFrame('https://provider.example/embed?a="onload="alert(1)', {
            title: 'x" onload="alert(1)'
        }), true);
        const frame = container.querySelector('iframe');
        assert.ok(frame, 'web URLs must still create a frame');
        assert.equal(frame.getAttribute('onload'), null, 'URL quotes must not create attributes');
        assert.equal(getPlayerFrameOrigin(frame), 'https://provider.example');
        frame.dataset.playerSourceActive = 'true';
        assert.equal(surface.getActiveFrame(), frame);

        surface.showPlaceholder('<img src=x onerror=alert(1)>');
        assert.equal(container.querySelector('img'), null, 'placeholder text must not be parsed as HTML');

        const button = surface.showPoster('https://img.example/poster.jpg");background:red;("');
        assert.ok(button, 'poster fallback exposes its play button');
        const poster = container.querySelector('.player-surface__poster');
        assert.equal(poster.style.backgroundColor, '', 'poster URL must not inject CSS declarations');
        assert.match(poster.style.backgroundImage, /^url\(/);

        const wrapper = dom.window.document.createElement('div');
        wrapper.className = 'native-player-wrapper';
        surface.mountElement(wrapper);
        assert.deepEqual([...container.children], [wrapper], 'mountElement replaces previous surface content');
        surface.clear();
        assert.equal(container.children.length, 0);
    } finally {
        globalThis.document = originalDocument;
        globalThis.window = originalWindow;
    }

    const baseParser = read('../src/shared/services/parsers/BaseParserService.js');
    const toPlayerFrameSrcAttribute = new Function(`${baseParser.match(/function toPlayerFrameSrcAttribute[\s\S]*?\r?\n\}\r?\n/)[0]}
${baseParser.match(/function escapePlayerAttribute[\s\S]*?\r?\n\}\r?\n/)[0]}
return toPlayerFrameSrcAttribute;`)();
    assert.equal(toPlayerFrameSrcAttribute('javascript:alert(1)'), null);
    assert.doesNotMatch(toPlayerFrameSrcAttribute('https://provider.example/?q="x"'), /"/, 'parser frame src must be quote-safe');
}

// 6. Player messages are addressed and accepted only between host and frame.
{
    assert.doesNotMatch(source, /contentWindow\??\.postMessage\([\s\S]{0,400}?,\s*'\*'\)/, 'host must address frame messages to the frame origin');
    assert.doesNotMatch(source, /e\.data && e\.data\.type === 'PAUSED_CONFIRMATION'/, 'pause confirmation must be bound to the paused frame');

    const cleaner = read('../content-scripts/player-cleaner.js');
    assert.doesNotMatch(cleaner, /window\.parent\??\.postMessage\(/, 'cleaner must notify the host through postToHost');
    const listeners = [...cleaner.matchAll(/(?:addEventListener|listen)\((?:window, )?'message', \((\w+)\) => \{\s*\n\s*(.*)/g)];
    assert.ok(listeners.length >= 4, 'all cleaner message listeners must be checked');
    listeners.forEach(([, eventName, firstLine]) => {
        assert.equal(firstLine.trim(), `if (!isTrustedHostMessage(${eventName})) return;`, 'every cleaner command listener must verify the host first');
    });

    const trust = new Function('window', 'chrome', `${cleaner.match(/function isExtensionPageContext[\s\S]*?function postToHost/)[0].replace(/function postToHost$/, '')}
return isTrustedHostMessage;`);
    const parent = {};
    const frameWindow = { location: { protocol: 'https:' }, parent };
    const isTrusted = trust(frameWindow, { runtime: { id: 'ext-id' } });
    assert.equal(isTrusted({ data: { type: 'PAUSE' }, source: parent, origin: 'chrome-extension://ext-id' }), true);
    assert.equal(isTrusted({ data: { type: 'PAUSE' }, source: frameWindow, origin: 'https://provider.example' }), false, 'provider/ad scripts in the frame must be rejected');
    assert.equal(isTrusted({ data: { type: 'PAUSE' }, source: parent, origin: 'https://evil.example' }), false, 'foreign parent origins must be rejected');
}

// 7. Watch rooms use an in-player invite popover instead of native prompts.
{
    assert.doesNotMatch(source, /window\.prompt\(/, 'watch rooms must not use native prompt dialogs');
    assert.doesNotMatch(html, /тестов/i, 'watch room controls must not be labelled as a test feature');

    const dom = new JSDOM(html, { url: 'chrome-extension://test-id/src/pages/movie-details/movie-details.html' });
    const doc = dom.window.document;
    const byId = id => doc.getElementById(id);
    const joined = [];
    const manager = {
        elements: {
            joinWatchRoomBtn: byId('joinWatchRoomBtn'),
            copyWatchRoomCodeBtn: byId('copyWatchRoomCodeBtn'),
            watchRoomMembersBtn: byId('watchRoomMembersBtn'),
            watchRoomMembersPopover: byId('watchRoomMembersPopover'),
            watchRoomInvitePopover: byId('watchRoomInvitePopover'),
            watchRoomInviteTitle: byId('watchRoomInviteTitle'),
            watchRoomInviteHint: byId('watchRoomInviteHint'),
            watchRoomInviteInput: byId('watchRoomInviteInput'),
            watchRoomInviteError: byId('watchRoomInviteError'),
            watchRoomInviteCancelBtn: byId('watchRoomInviteCancelBtn'),
            watchRoomInviteSubmitBtn: byId('watchRoomInviteSubmitBtn')
        },
        watchRoomController: {
            join: async code => {
                if (code === 'bad') throw new Error('Код недействителен');
                joined.push(code);
            }
        },
        refreshWatchRoomControls() {},
        setWatchRoomStatus() {},
        openWatchRoomInvite: extractMethod('openWatchRoomInvite'),
        closeWatchRoomInvite: extractMethod('closeWatchRoomInvite'),
        setWatchRoomInviteError: extractMethod('setWatchRoomInviteError'),
        submitWatchRoomInvite: extractMethod('submitWatchRoomInvite'),
        joinWatchRoom: extractMethod('joinWatchRoom')
    };
    const popover = manager.elements.watchRoomInvitePopover;
    const input = manager.elements.watchRoomInviteInput;
    const error = manager.elements.watchRoomInviteError;

    await manager.joinWatchRoom();
    assert.equal(popover.hidden, false, 'join must open the invite popover');
    assert.equal(manager.elements.joinWatchRoomBtn.getAttribute('aria-expanded'), 'true');

    await manager.submitWatchRoomInvite();
    assert.equal(error.hidden, false, 'empty codes must show an inline error');
    assert.equal(joined.length, 0);

    input.value = 'bad';
    await manager.submitWatchRoomInvite();
    assert.match(error.textContent, /Код недействителен/, 'join failures must stay visible in the popover');
    assert.equal(popover.hidden, false);

    input.value = '  room-code  ';
    await manager.submitWatchRoomInvite();
    assert.deepEqual(joined, ['room-code']);
    assert.equal(popover.hidden, true, 'successful join must close the popover');

    const originalNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', {
        value: { clipboard: { writeText: async () => { throw new Error('denied'); } } },
        configurable: true
    });
    try {
        manager.watchRoomJoinCode = 'owner-code';
        manager.openWatchRoomInvite('share');
        assert.equal(input.readOnly, true);
        assert.equal(input.value, 'owner-code', 'share mode must show the code for manual copying');
        await manager.submitWatchRoomInvite();
        assert.equal(error.hidden, false, 'clipboard denial must explain manual copying');
        assert.equal(manager.closeWatchRoomInvite(), true);
        assert.equal(popover.hidden, true);
    } finally {
        Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true });
    }
}

// 8. Player chrome: source status, loading state, localized labels.
{
    assert.doesNotMatch(html, /aria-label="(?:Player sources|Episode navigation|Video player)"/, 'player chrome labels must be localized');
    assert.match(html, /class="source-toolbar__label"[^>]*>Источник</, 'source rail must be labelled instead of an unexplained icon');
    assert.doesNotMatch(html, /source-toolbar__mark/);

    const dom = new JSDOM('<div id="sources"></div><div id="videoContainer"></div>');
    const doc = dom.window.document;
    const originalDocument = globalThis.document;
    globalThis.document = doc;
    try {
        const sources = doc.getElementById('sources');
        ['parser:kinogo', 'parser:exfs', 'vidsrc:tt1'].forEach((value, index) => {
            const btn = doc.createElement('button');
            btn.className = `source-btn${index === 0 ? ' active' : ''}`;
            btn.setAttribute('data-value', value);
            btn.textContent = value.split(':')[1];
            sources.appendChild(btn);
        });
        const manager = {
            elements: { sourceButtonsContainer: sources, videoContainer: doc.getElementById('videoContainer') },
            unavailableProviderIds: new Set(['exfs']),
            getSourceButtonProviderKey: extractMethod('getSourceButtonProviderKey'),
            refreshSourceButtonStates: extractMethod('refreshSourceButtonStates')
        };
        const [kinogo, exfs, vidsrc] = sources.children;
        manager.elements.videoContainer.dataset.sourceState = 'loading';
        manager.refreshSourceButtonStates();
        assert.equal(kinogo.dataset.sourceState, 'loading');
        assert.match(kinogo.querySelector('.source-btn__state').textContent, /загружается/, 'status must have a text alternative');
        assert.equal(exfs.dataset.sourceState, 'unavailable', 'failed providers stay marked after switching away');
        assert.match(exfs.title, /недоступен/);
        assert.equal(vidsrc.dataset.sourceState, undefined);

        manager.elements.videoContainer.dataset.sourceState = 'ready';
        manager.refreshSourceButtonStates();
        assert.equal(kinogo.dataset.sourceState, 'ready');
        assert.equal(kinogo.title, 'kinogo: воспроизводится', 'button title must keep the provider name');
        assert.equal(kinogo.querySelectorAll('.source-btn__state').length, 1, 'status label must not duplicate');
    } finally {
        globalThis.document = originalDocument;
    }
    assert.match(playerCss, /\.source-btn\[data-source-state="unavailable"\]::before\s*\{[^}]*content:/, 'unavailable sources need a non-color glyph');
    assert.match(playerCss, /prefers-reduced-motion: reduce\)\s*\{\s*\.source-btn\[data-source-state="loading"\]/);

    const cleaner = read('../content-scripts/player-cleaner.js');
    assert.match(cleaner, /timeDisplay\.textContent = '0:00 \/ 0:00';\s*\/\/[^\n]*\n[^\n]*\n\s*timeDisplay\.style\.visibility = 'hidden';/, 'empty timecode must stay hidden until media has a duration');
    assert.match(cleaner, /syncPendingMediaState\(permanentVideo\);/, 'initial fetching media must show the loader');
    const navBlock = cleaner.slice(cleaner.indexOf("const prevEpisodeBtn = document.createElement('button');"), cleaner.indexOf('leftControls.appendChild(prevEpisodeBtn);'));
    assert.doesNotMatch(navBlock, /\.style\.(?:color|opacity|cursor|background)\s*=/, 'episode arrows must be styled by the cleaner stylesheet');
    assert.doesNotMatch(navBlock, /#4da6ff/, 'episode arrows must not use a chromatic accent');
    assert.match(navBlock, /aria-label', 'Предыдущая серия'/);
    assert.match(cleaner, /\.native-player-wrapper \.provider-native-episode-nav:disabled \{/);
}

// 9. Movie details page: labels, empty rows, countries, numbers, hierarchy.
{
    const originalI18n = globalThis.i18n;
    globalThis.i18n = { currentLocale: 'ru', get: key => ({ 'movie_details.meta.country': 'Страна:' })[key] || key };
    try {
        const manager = {
            metaLabel: extractMethod('metaLabel'),
            localizeCountryName: extractMethod('localizeCountryName'),
            formatVotes: extractMethod('formatVotes'),
            formatTheNumbersAmount: extractMethod('formatTheNumbersAmount')
        };
        assert.equal(manager.metaLabel('movie_details.meta.country'), 'Страна', 'metadata labels must not end with a colon');
        assert.equal(manager.localizeCountryName('United States of America'), 'Соединенные Штаты');
        assert.equal(manager.localizeCountryName('United Kingdom'), 'Великобритания');
        assert.equal(manager.localizeCountryName('Australia'), 'Австралия');
        assert.equal(manager.localizeCountryName('Atlantis'), 'Atlantis', 'unknown countries stay readable');
        assert.doesNotMatch(manager.formatVotes(2200), /k/i, 'vote counts must not use an English "k" suffix');
        assert.match(manager.formatVotes(2200), /2,2\s*тыс\./);
        assert.equal(manager.formatTheNumbersAmount(6432956), '$6 432 956', 'The Numbers amounts must match Kinopoisk money formatting');
    } finally {
        globalThis.i18n = originalI18n;
    }

    assert.doesNotMatch(source, /movie\.slogan \? `«\$\{this\.escapeHtml\(movie\.slogan\)\}»` : '—'/, 'empty slogans must not render a dash row');
    assert.doesNotMatch(source, /<span class="meta-label">\$\{i18n\.get\('movie_details\.meta\./, 'metadata labels must go through metaLabel');
    assert.match(source, /class="btn btn-secondary btn-lg rate-movie-btn"/, '"Оценить" must be secondary to "Смотреть"');

    const detailsCss = read('../src/pages/movie-details/movie-details.css');
    assert.doesNotMatch(detailsCss, /\.movie-detail-page-title--with-logo/, 'the text title must stay visible next to title artwork');
    assert.match(detailsCss, /\.production-company-logo,\s*\.light-theme \.production-company-logo\s*\{/, 'studio logos need a contrast well in both themes');
    assert.doesNotMatch(detailsCss, /#(?:10b981|f59e0b|ef4444)\b/i, 'details page must use semantic tokens instead of chromatic literals');
    assert.doesNotMatch(html, /style="color: #ef4444;"/);
}

// 10. One keyboard owner: Escape/Tab precedence lives in the modal stack.
{
    const { MovieDetailsModalStack } = await import('../src/pages/movie-details/ModalStack.js')
        .then(module => module.default || module);
    const closed = [];
    const trapped = [];
    const state = { picker: true, player: true, rating: false };
    const playerDialog = { id: 'player' };
    const stack = new MovieDetailsModalStack({ trapFocus: (_event, dialog) => trapped.push(dialog) });
    stack.register('video-player', { order: 80, isOpen: () => state.player, close: () => closed.push('player'), getFocusContainer: () => playerDialog });
    stack.register('episode-picker', { order: 50, stopPropagation: true, isOpen: () => state.picker, close: () => { closed.push('picker'); state.picker = false; } });
    stack.register('rating', { order: 70, isOpen: () => state.rating, close: () => closed.push('rating'), getFocusContainer: () => ({ id: 'rating' }) });
    stack.register('broken', { order: 5, isOpen: () => { throw new Error('detached'); }, close: () => closed.push('broken') });

    const keyEvent = key => ({ key, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } });
    const tab = keyEvent('Tab');
    stack.handleKeydown(tab);
    assert.deepEqual(trapped, [playerDialog], 'Tab must stay in the player while only a popover is above it');

    const firstEscape = keyEvent('Escape');
    stack.handleKeydown(firstEscape);
    assert.deepEqual(closed, ['picker'], 'Escape closes the topmost open layer only');
    assert.equal(firstEscape.prevented && firstEscape.stopped, true);
    stack.handleKeydown(keyEvent('Escape'));
    assert.deepEqual(closed, ['picker', 'player']);

    state.player = false;
    const idle = keyEvent('Escape');
    stack.handleKeydown(idle);
    assert.equal(idle.prevented, false, 'Escape without open layers must not be swallowed');
    assert.throws(() => stack.register('bad', { isOpen: () => true, close() {} }), /order/);

    assert.doesNotMatch(source, /document\.addEventListener\('keydown'/, 'MovieDetails must route keyboard dialogs through the modal stack');
    assert.match(html, /<script defer src="ModalStack\.js"><\/script>\s*(?:<script defer src="[^"]+"><\/script>\s*)*<script defer src="movie-details\.js" type="module">/, 'modal stack must load before MovieDetails');
    assert.doesNotMatch(source, /[^.\w]confirm\(/, 'MovieDetails must use the in-page confirmation dialog instead of window.confirm()');
    for (const id of ['confirm', 'announce', 'review-reader', 'torrent-source-disclosure', 'watch-room-invite', 'episode-picker', 'trailer', 'rating', 'video-player', 'comment-reaction-picker']) {
        assert.match(source, new RegExp(`register\\('${id}'`), `${id} must be a modal stack layer`);
    }
}

// 11. PlayerSurface is the single MovieDetails writer of #videoContainer.
{
    assert.doesNotMatch(source, /videoContainer\.(?:innerHTML\s*=|replaceChildren\(|appendChild\(|insertAdjacentHTML\()/, 'MovieDetails must write the player container only through PlayerSurface');
    assert.match(html, /<script defer src="ModalStack\.js"><\/script>\s*<script defer src="PlayerSurface\.js"><\/script>\s*(?:<script defer src="[^"]+"><\/script>\s*)*<script defer src="movie-details\.js" type="module">/, 'PlayerSurface must load before MovieDetails');
    assert.throws(() => new MovieDetailsPlayerSurface(), /getContainer/);
}

// 12. PlayerModalController owns the player dialog's visible state.
{
    const { MovieDetailsPlayerModal } = await import('../src/pages/movie-details/PlayerModalController.js')
        .then(module => module.default || module);
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    const originalDocument = globalThis.document;
    globalThis.document = doc;
    try {
        const modalElement = doc.getElementById('videoPlayerModal');
        const dock = doc.getElementById('restorePlayerBtn');
        const closeButton = doc.getElementById('closeVideoBtn');
        const pauses = [];
        const playerModal = new MovieDetailsPlayerModal({
            getModal: () => modalElement,
            getRestoreDock: () => dock,
            getCloseButton: () => closeButton,
            getRestoreTitle: () => 'Курьер',
            pausePlayback: async () => { pauses.push('pause'); return { success: true }; }
        });
        const panel = modalElement.querySelector('.modal');

        playerModal.open();
        assert.equal(playerModal.isShown(), true);
        assert.equal(doc.body.classList.contains('player-modal-open'), true, 'open locks page scrolling');

        await playerModal.minimize();
        assert.deepEqual(pauses, ['pause'], 'minimize pauses playback first');
        assert.equal(playerModal.isMinimized(), true);
        assert.equal(playerModal.isShown(), false);
        assert.equal(panel.classList.contains('minimized'), true);
        assert.equal(dock.style.display, 'flex');
        assert.equal(dock.querySelector('.restore-title').textContent, 'Курьер');
        assert.equal(doc.body.classList.contains('player-modal-open'), false);

        playerModal.restore();
        assert.equal(playerModal.isShown(), true);
        assert.equal(dock.style.display, 'none');
        assert.equal(doc.activeElement, closeButton, 'restore returns focus to the player');

        await playerModal.minimize({ pause: false });
        assert.deepEqual(pauses, ['pause'], 'PiP minimize keeps playing');
        assert.equal(panel.classList.contains('pip-hidden'), true);
        assert.equal(panel.classList.contains('minimized'), false);

        playerModal.hide();
        assert.equal(modalElement.style.display, 'none');
        assert.equal(playerModal.isMinimized(), false);
        assert.equal(panel.classList.contains('pip-hidden'), false);
        assert.equal(dock.style.display, 'none');
        assert.equal(doc.body.classList.contains('player-modal-open'), false);
    } finally {
        globalThis.document = originalDocument;
    }

    assert.doesNotMatch(source, /classList\.(?:add|remove)\('(?:minimized-overlay|player-modal-open)'\)/, 'MovieDetails must change player dialog state only through PlayerModalController');
    assert.match(html, /<script defer src="PlayerModalController\.js"><\/script>\s*(?:<script defer src="[^"]+"><\/script>\s*)*<script defer src="movie-details\.js" type="module">/);
}

// 13. Torrent workspace methods live in TorrentSourcePanel.js.
{
    const panelModule = await import('../src/pages/movie-details/TorrentSourcePanel.js')
        .then(module => module.default || module);
    const { MovieDetailsTorrentPanelMethods, installMovieDetailsTorrentPanel, MOVIE_DETAILS_TORRENT_SOURCE } = panelModule;
    const methodNames = Object.getOwnPropertyNames(MovieDetailsTorrentPanelMethods.prototype).filter(name => name !== 'constructor');
    for (const name of ['openTorrentPicker', 'renderTorrentSources', 'startTorrentPlayback', 'renderTorrentDownloads', 'revokeTorrentPlaybackSession']) {
        assert.ok(methodNames.includes(name), `${name} must live in the torrent panel`);
        assert.doesNotMatch(source, new RegExp(`\\n    (?:async )?${name}\\(`), `${name} must not be redefined in movie-details.js`);
    }

    class Host { existing() { return 'host'; } }
    installMovieDetailsTorrentPanel(Host);
    assert.equal(typeof Host.prototype.renderTorrentSources, 'function', 'installer adds the panel methods to the host prototype');
    class Conflict { renderTorrentSources() {} }
    assert.throws(() => installMovieDetailsTorrentPanel(Conflict), /already defines renderTorrentSources/, 'installer must not silently override page methods');

    assert.equal(MOVIE_DETAILS_TORRENT_SOURCE, source.match(/const MEDIA_PLAYER_TORRENT_SOURCE = '([^']+)'/)?.[1], 'torrent source marker must match MovieDetails');
    assert.match(source, /installMovieDetailsTorrentPanel\(MovieDetailsManager\)/);
    assert.match(html, /<script defer src="TorrentSourcePanel\.js"><\/script>\s*(?:<script defer src="[^"]+"><\/script>\s*)*<script defer src="movie-details\.js" type="module">/, 'torrent panel must load before MovieDetails');
}

// 14. Watch room UI methods live in WatchRoomPanel.js.
{
    const { MovieDetailsWatchRoomPanelMethods } = await import('../src/pages/movie-details/WatchRoomPanel.js')
        .then(module => module.default || module);
    const methodNames = Object.getOwnPropertyNames(MovieDetailsWatchRoomPanelMethods.prototype);
    for (const name of ['handleWatchRoomAction', 'openWatchRoomInvite', 'submitWatchRoomInvite', 'renderWatchRoomMembers', 'createWatchRoom', 'joinWatchRoom']) {
        assert.ok(methodNames.includes(name), `${name} must live in the watch room panel`);
        assert.doesNotMatch(source, new RegExp(`\\n    (?:async )?${name}\\(`), `${name} must not be redefined in movie-details.js`);
    }
    assert.match(source, /installMovieDetailsWatchRoomPanel\(MovieDetailsManager\)/);
    assert.match(html, /<script defer src="TorrentSourcePanel\.js"><\/script>\s*<script defer src="WatchRoomPanel\.js"><\/script>/, 'watch room panel uses the torrent source marker, so it loads after the torrent panel');
}

// 15. Metadata formatting lives in MetaRenderer.js.
{
    const { MovieDetailsMetaRendererMethods } = await import('../src/pages/movie-details/MetaRenderer.js')
        .then(module => module.default || module);
    const methodNames = Object.getOwnPropertyNames(MovieDetailsMetaRendererMethods.prototype);
    for (const name of ['renderFinanceMetaItem', 'renderTheNumbersChart', 'translateStatus', 'renderProductionCompanies', 'formatVotes', 'metaLabel', 'localizeCountryName']) {
        assert.ok(methodNames.includes(name), `${name} must live in the meta renderer`);
        assert.doesNotMatch(source, new RegExp(`\\n    (?:async )?${name}\\(`), `${name} must not be redefined in movie-details.js`);
    }
    assert.match(source, /installMovieDetailsMetaRenderer\(MovieDetailsManager\)/);
    assert.match(html, /<script defer src="MetaRenderer\.js"><\/script>\s*(?:<script defer src="[^"]+"><\/script>\s*)*<script defer src="movie-details\.js" type="module">/);
}

console.log('✅ MovieDetails player audit regression tests passed!');
