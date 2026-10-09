// A watch room synchronizes the shared timeline only. Player preferences such
// as audio track, subtitles, quality, volume, and playback speed must remain
// local to each participant's browser.
const ROOM_SYNC_TIMELINE_ACTIONS = new Set(['play', 'pause', 'seek']);
const ROOM_SYNC_OBSERVED_TELEMETRY_KINDS = new Set(['play', 'pause', 'seeking', 'seeked']);
const ROOM_SYNC_PUBLISHED_TELEMETRY_KINDS = new Set(['play', 'pause', 'seeked']);
const PRESENCE_HEARTBEAT_MS = 30_000;
const PRESENCE_STALE_MS = 90_000;
const PRESENCE_STALE_CHECK_MS = 15_000;
const RTDB_SERVER_TIMESTAMP = { '.sv': 'timestamp' };
const PRESENCE_V2_NODE = 'presenceV2';
// Timeline accuracy. Room timestamps are estimated server time
// (`.info/serverTimeOffset`), never a participant's raw wall clock, so a
// skewed computer clock cannot shift everyone else's position.
// A playing follower is corrected only when it drifts past the playing
// threshold for consecutive samples; a paused follower is aligned tighter
// because a paused seek costs no visible playback.
const ROOM_SYNC_PLAYING_SEEK_THRESHOLD_MS = 1_000;
const ROOM_SYNC_PAUSED_SEEK_THRESHOLD_MS = 300;
const ROOM_SYNC_DRIFT_CONFIRMATIONS = 2;
const ROOM_SYNC_DRIFT_COOLDOWN_MS = 4_000;
const ROOM_SYNC_PLAYING_SAMPLE_MAX_AGE_MS = 3_000;
const ROOM_SYNC_EXPECTED_SEEK_MS = 10_000;
const ROOM_SYNC_EXPECTED_SEEK_TOLERANCE_MS = 1_500;
const ROOM_SYNC_EXPECTED_PHASE_MS = 5_000;
// Position jumps smaller than this are drift re-anchors, not a member's seek.
const ROOM_SYNC_SEEK_NOTICE_MS = 10_000;
// Members are warned this long before the room closes; the owner can extend.
const ROOM_EXPIRY_WARNING_MS = 10 * 60 * 1000;
// Buffering: a member reports itself as loading after a stall of this length,
// the timeline publisher then pauses the room until that member can play
// again, for at most the wait limit. A member triggers at most one wait per
// cooldown so a slow connection cannot keep pausing everyone.
const ROOM_SYNC_BUFFER_REPORT_DELAY_MS = 1_500;
const ROOM_SYNC_BUFFER_WAIT_MAX_MS = 20_000;
const ROOM_SYNC_BUFFER_MEMBER_COOLDOWN_MS = 60_000;
const ROOM_SYNC_READINESS_TELEMETRY_KINDS = new Set(['waiting', 'playing', 'canplay']);
// A follower switching to the room's episode waits for the new player before
// applying the timeline; the timeout keeps a silent provider from blocking
// the room forever.
const ROOM_SYNC_SELECTION_SWITCH_TIMEOUT_MS = 15_000;
const ROOM_SYNC_SELECTION_READY_TELEMETRY_KINDS = new Set(['loadedmetadata', 'snapshot', 'play', 'seeked', 'timeupdate']);

// Canonical series position shared by a room. Movies have no selection.
function normalizeRoomSelection(value) {
    // `Number(null)` is 0, so a missing number must be rejected explicitly.
    if (value?.seasonNumber == null || value?.episodeNumber == null
        || value.seasonNumber === '' || value.episodeNumber === '') return null;
    const seasonNumber = Number(value.seasonNumber);
    const episodeNumber = Number(value?.episodeNumber);
    if (!Number.isInteger(seasonNumber) || seasonNumber < 0 || seasonNumber > 1_000) return null;
    if (!Number.isInteger(episodeNumber) || episodeNumber < 0 || episodeNumber > 100_000) return null;
    return { seasonNumber, episodeNumber };
}

function roomSelectionKey(selection) {
    return selection ? `${selection.seasonNumber}:${selection.episodeNumber}` : null;
}

function getWatchRoomFrameOrigin(iframe) {
    try {
        const base = typeof window !== 'undefined' ? window.location?.href : undefined;
        const url = new URL(iframe?.src || iframe?.getAttribute?.('src') || '', base);
        if (url.origin !== 'null') return url.origin;
        return url.protocol === 'chrome-extension:' && url.host ? `${url.protocol}//${url.host}` : null;
    } catch {
        return null;
    }
}

// Invite codes carry the room's Kinopoisk ID before the server join code
// (`<kinopoiskId>:<inviteId>.<secret>`) so the film is checked before the
// invite is redeemed. The parser also finds a code inside a pasted message
// and still accepts a bare server join code.
const WATCH_ROOM_INVITE_PATTERN = /(?:(\d{1,10}):)?([A-Za-z0-9-]{8,64}\.[A-Za-z0-9_-]{32,128})/;

function parseWatchRoomInvite(text) {
    const match = String(text || '').match(WATCH_ROOM_INVITE_PATTERN);
    if (!match) return null;
    const kinopoiskId = match[1] ? Number(match[1]) : null;
    return {
        kinopoiskId: Number.isInteger(kinopoiskId) && kinopoiskId > 0 ? kinopoiskId : null,
        joinCode: match[2],
    };
}

function formatWatchRoomInvite(kinopoiskId, joinCode) {
    const parsed = parseWatchRoomInvite(joinCode);
    if (!parsed) return String(joinCode || '');
    const id = Number(kinopoiskId);
    return Number.isInteger(id) && id > 0 ? `${id}:${parsed.joinCode}` : parsed.joinCode;
}

// Server error codes shown to people in Russian. The server keeps English
// messages for logs; unknown codes fall back to a generic Russian text.
const WATCH_ROOM_ERROR_MESSAGES = {
    AUTH_REQUIRED: 'Нужно войти в аккаунт',
    INVALID_USER: 'Нужно войти в аккаунт',
    APPROVAL_REQUIRED: 'Аккаунт ещё не одобрен администратором',
    INVALID_INVITE: 'Код приглашения недействителен',
    INVITE_INVALID: 'Код приглашения недействителен',
    INVITE_NOT_FOUND: 'Код приглашения недействителен',
    INVITE_EXPIRED: 'Срок действия приглашения истёк',
    INVITE_EXHAUSTED: 'Приглашение уже использовано максимальное число раз',
    ROOM_FULL: 'В комнате нет свободных мест',
    ROOM_NOT_FOUND: 'Комната не найдена',
    ROOM_NOT_JOINABLE: 'Комната уже завершена или истекла',
    ROOM_ACCESS_DENIED: 'Вы больше не участник этой комнаты',
    ROOM_OWNER_REQUIRED: 'Это может сделать только создатель комнаты',
    OWNER_MUST_END_ROOM: 'Создатель не может выйти — только завершить комнату',
    ROOM_ROLE_TARGET_INVALID: 'Роль создателя изменить нельзя',
    ROOM_EXTENSION_LIMIT: 'Комнату нельзя продлить дольше 12 часов с момента создания',
    INVALID_MEMBER_ROLE: 'Недопустимая роль участника',
    INVALID_CONTENT: 'Сначала откройте фильм с подтверждённым Кинопоиск ID',
    INVALID_PROVIDER: 'Источник плеера не поддерживается комнатой',
    INVALID_PROVIDER_SOURCE: 'Не удалось подтвердить ролик для комнаты',
};

function watchRoomErrorMessage(code, status) {
    if (WATCH_ROOM_ERROR_MESSAGES[code]) return WATCH_ROOM_ERROR_MESSAGES[code];
    if (status >= 500 || status === 0) return 'Сервер комнат временно недоступен, попробуйте позже';
    return 'Не удалось выполнить действие комнаты';
}

// Player command failures reported by the provider bridge.
const PLAYER_COMMAND_RESULT_TIMEOUT_MS = 8_000;

function formatRoomPosition(positionMs) {
    const totalSeconds = Math.max(0, Math.floor(Number(positionMs || 0) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

class WatchRoomApiError extends Error {
    constructor(message, { code = 'ROOM_API_ERROR', status = 0, cause } = {}) {
        super(message);
        this.name = 'WatchRoomApiError';
        this.code = code;
        this.status = status;
        this.statusCode = status;
        if (cause) this.cause = cause;
    }

    get retryable() {
        return this.status === 0 || this.status >= 500;
    }
}

class WatchRoomStagingController {
    constructor({
        getIframe,
        getVideo,
        getMovie,
        getProviderId,
        getProviderSource,
        getPlayerBridge,
        getSelection,
        onProviderChange,
        onSelectionRequest,
        onStatus,
        onRoomUpdate,
        onPlaybackBlocked,
        onExpiryWarning,
        now = () => Date.now(),
        // Window timer methods must keep their Window receiver in Chromium.
        // Passing the methods by reference makes `this` the controller and can
        // throw "Illegal invocation" when a room expiry timer is armed.
        setTimeout: scheduleTimeout = (...args) => globalThis.setTimeout(...args),
        clearTimeout: cancelTimeout = (...args) => globalThis.clearTimeout(...args),
        document: lifecycleDocument = globalThis.document,
        window: lifecycleWindow = globalThis.window,
    } = {}) {
        this.getIframe = getIframe;
        this.getVideo = getVideo;
        this.getMovie = getMovie;
        this.getProviderId = getProviderId;
        this.getProviderSource = getProviderSource;
        this.getPlayerBridge = getPlayerBridge;
        this.getSelection = getSelection;
        this.onProviderChange = onProviderChange || (async () => false);
        this.onSelectionRequest = onSelectionRequest || (async () => false);
        this.onStatus = onStatus || (() => {});
        this.onRoomUpdate = onRoomUpdate || (() => {});
        this.onPlaybackBlocked = onPlaybackBlocked || (() => {});
        this.onExpiryWarning = onExpiryWarning || (() => {});
        this.expiryWarningFor = null;
        this.accessExpiryRef = null;
        this.readinessRef = null;
        this.readinessRoomRef = null;
        this.readinessState = {};
        this.localReadiness = null;
        this.bufferReportTimer = null;
        this.bufferWait = null;
        this.bufferWaitCooldowns = new Map();
        this.playbackBlocked = false;
        this.lastLocalOverrideNoticeAt = 0;
        this.now = now;
        this.scheduleTimeout = scheduleTimeout;
        this.cancelTimeout = cancelTimeout;
        this.lifecycleDocument = lifecycleDocument;
        this.lifecycleWindow = lifecycleWindow;
        this.role = null;
        this.room = null;
        this.roomState = null;
        this.rtdb = null;
        this.stateRef = null;
        this.membersRef = null;
        this.presenceRef = null;
        this.presenceRoomRef = null;
        this.legacyPresenceRoomRef = null;
        this.connectionStateRef = null;
        this.serverTimeOffsetRef = null;
        this.serverTimeOffsetMs = 0;
        this.playerSample = null;
        this.driftConfirmations = 0;
        this.lastDriftCorrectionAt = 0;
        this.presenceConnectionId = null;
        this.presenceReady = false;
        this.presenceWriteChain = Promise.resolve();
        this.presenceSessionGeneration = 0;
        this.presenceHeartbeatTimer = null;
        this.presenceStaleTimer = null;
        this.presenceTimerGeneration = 0;
        this.rtdbConnected = null;
        this.memberState = {};
        this.presenceState = {};
        this.pending = new Map();
        this.subscriptionId = null;
        this.guestReapplyTimer = null;
        this.ignoreRemoteTelemetryUntil = 0;
        this.expectedPlayerEffects = { seekTargetMs: null, seekUntil: 0, phase: null, phaseUntil: 0 };
        this.activeProviderHint = null;
        this.providerSwitch = null;
        this.selectionSwitch = null;
        this.nativeVideo = null;
        this.nativeTelemetryDisposers = [];
        this.hostStateWriteChain = Promise.resolve();
        this.hostStatePatch = null;
        this.hostStateFlushQueued = false;
        this.hostStateRevision = 0;
        this.roomExpiryTimer = null;
        this.roomExpiryCheckDisposer = null;
        this.roomExpiryGeneration = 0;
        this.pendingCreateRequestId = null;
    }

    makeRequestId(prefix) {
        const suffix = globalThis.crypto?.randomUUID?.().replace(/-/g, '')
            || `${Date.now()}${Math.random().toString(36).slice(2)}`;
        return `${prefix}-${suffix}`.slice(0, 128);
    }

    trace(stage, details = {}) {
        console.info('[RoomSyncTrace]', stage, {
            roomId: this.room?.roomId || null,
            role: this.role,
            ...details,
        });
    }

    async callApi(action, payload = {}, { requestId = null } = {}) {
        const firebaseManager = window.firebaseManager;
        // A movie page can finish rendering before Firebase restores the saved
        // session. Waiting here prevents a legitimate first click on “Создать”
        // from failing locally before any room request reaches the backend.
        const user = firebaseManager?.getCurrentUser?.()
            || await firebaseManager?.waitForAuthReady?.(10_000);
        if (!user) throw new Error('Нужен авторизованный аккаунт');
        const token = await user.getIdToken();
        const displayName = await this.currentUserDisplayName(user);
        let response;
        try {
            response = await fetch(
                'https://us-central1-movielistdb-13208.cloudfunctions.net/watchRoomsStaging',
                {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action,
                        requestId: requestId || this.makeRequestId(action),
                        displayName,
                        ...payload,
                    }),
                }
            );
        } catch (error) {
            throw new WatchRoomApiError('Соединение с сервером комнаты недоступно', {
                code: 'NETWORK_ERROR',
                cause: error,
            });
        }
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            const code = body.code || `HTTP_${response.status}`;
            throw new WatchRoomApiError(watchRoomErrorMessage(code, response.status), {
                code,
                status: response.status,
            });
        }
        return body;
    }

    async currentUserDisplayName(user = window.firebaseManager?.getCurrentUser?.()) {
        const cachedDisplay = await this.readCachedUserDisplayName(user);
        const visibleDisplay = this.readVisibleUserDisplayName();
        const displayName = String(cachedDisplay || visibleDisplay || user?.displayName || user?.email?.split('@')?.[0] || '').trim();
        return displayName.slice(0, 48);
    }

    async readCachedUserDisplayName(user) {
        if (!user?.uid || !globalThis.chrome?.storage?.local?.get) return '';
        try {
            const { userDisplayCache } = await chrome.storage.local.get(['userDisplayCache']);
            if (userDisplayCache?.uid !== user.uid) return '';
            return String(userDisplayCache.displayName || '').trim().slice(0, 48);
        } catch {
            return '';
        }
    }

    readVisibleUserDisplayName() {
        const displayName = String(globalThis.document?.getElementById?.('navUserName')?.textContent || '').trim();
        const genericNames = new Set(['user', 'пользователь', 'участник']);
        return genericNames.has(displayName.toLowerCase()) ? '' : displayName.slice(0, 48);
    }

    currentContent() {
        const movie = this.getMovie?.();
        const kinopoiskId = Number(movie?.kinopoiskId);
        if (!Number.isInteger(kinopoiskId) || kinopoiskId <= 0) {
            throw new Error('Сначала откройте фильм с подтверждённым Кинопоиск ID');
        }
        return {
            kinopoiskId,
            mediaType: movie?.isSeries ? 'series' : 'movie',
            title: String(movie?.nameRu || movie?.name || movie?.title || '').slice(0, 160),
        };
    }

    async create() {
        this.onStatus('Создаю комнату…');
        const providerHint = this.currentProviderId();
        const content = this.currentContent();
        const providerSource = this.currentProviderSource(providerHint);
        this.pendingCreateRequestId ||= this.makeRequestId('create');
        try {
            const result = await this.callApi('create', {
                content,
                providerHint,
                providerSource,
            }, { requestId: this.pendingCreateRequestId });
            this.pendingCreateRequestId = null;
            await this.connect(result.room, 'owner');
            return formatWatchRoomInvite(content.kinopoiskId, result.joinCode);
        } catch (error) {
            // Keep the key for retryable failures: the server may have
            // committed the room before the response was lost or failed.
            if (!error?.retryable) {
                this.pendingCreateRequestId = null;
            }
            throw error;
        }
    }

    async join(inviteText) {
        const invite = parseWatchRoomInvite(inviteText);
        if (!invite) {
            throw new WatchRoomApiError('Код приглашения не распознан', { code: 'INVALID_INVITE', status: 400 });
        }
        const current = this.currentContent();
        if (invite.kinopoiskId && invite.kinopoiskId !== current.kinopoiskId) {
            // Checked before redemption so a wrong page does not use up a
            // place in the room.
            const error = new WatchRoomApiError('Это приглашение в комнату другого фильма', {
                code: 'WRONG_MOVIE',
                status: 409,
            });
            error.kinopoiskId = invite.kinopoiskId;
            throw error;
        }
        this.onStatus('Подключаюсь…');
        const result = await this.callApi('join', { joinCode: invite.joinCode });
        const expected = current;
        if (Number(result.room?.content?.kinopoiskId) !== expected.kinopoiskId) {
            throw new Error('В этой комнате выбран другой фильм');
        }
        await this.connect(result.room, result.room.role);
        return result.room;
    }

    // A member leaves; the owner ends the room for everyone because a room
    // cannot continue without its owner.
    async leaveOrEnd() {
        const roomId = this.room?.roomId;
        if (!roomId) return null;
        const action = this.role === 'owner' ? 'end' : 'leave';
        this.onStatus(action === 'end' ? 'Завершаю комнату…' : 'Выхожу из комнаты…');
        try {
            await this.callApi(action, { roomId });
        } catch (error) {
            // Missing membership or an already removed room means the user is
            // out of the room anyway; any other failure keeps the room.
            const alreadyGone = error?.status === 403 || error?.status === 404;
            if (!alreadyGone) {
                this.onStatus('');
                throw error;
            }
        }
        if (this.room?.roomId === roomId) {
            this.disconnect(false);
            this.onRoomUpdate({ roomId: null, role: null, members: [] });
        }
        this.onStatus(action === 'end' ? 'Комната завершена' : 'Вы вышли из комнаты');
        return action;
    }

    async connect(room, role) {
        this.disconnect(false);
        const expiresAtMs = Number(room?.expiresAtMs);
        if (!Number.isFinite(expiresAtMs)) {
            throw new Error('У комнаты не указано корректное время окончания');
        }
        this.room = room;
        this.role = role;
        if (this.now() >= expiresAtMs) {
            this.endExpiredRoomSession('Время комнаты истекло');
            return false;
        }
        this.rtdb = window.firebaseManager?.getRealtimeDatabase?.();
        if (!this.rtdb) throw new Error('Realtime Database недоступна в этой сборке');
        const userId = this.currentUserId();
        if (!userId) throw new Error('Нужен авторизованный аккаунт');
        const probe = await this.probePlayer();
        const required = ['observeTime', 'play', 'pause', 'seek', 'duration'];
        if (!required.every((name) => probe.capabilities?.[name] === true)) {
            throw new Error('Выбранный источник ещё не готов к синхронизации');
        }
        this.trace('player-probed', { nativeVideo: probe.nativeVideo === true });
        if (role === 'viewer') {
            // The player was successfully probed before the room subscription.
            // Its selected provider is therefore already ready and must not be
            // remounted when the room starts with that same provider.
            this.activeProviderHint = this.currentProviderId();
            this.trace('viewer-current-provider', { providerHint: this.activeProviderHint });
        }
        this.subscriptionId = this.makeRequestId('room-sync');
        this.postToPlayer({ type: 'ROOM_SYNC_SUBSCRIBE', subscriptionId: this.subscriptionId });
        this.trace('player-subscribed', { reason: 'room-connect' });
        this.bindNativeVideoTelemetry();
        this.stateRef = this.rtdb.ref(`roomLive/${room.roomId}/state`);
        this.membersRef = this.rtdb.ref(`roomLive/${room.roomId}/members`);
        this.presenceConnectionId = this.makeRequestId('presence');
        this.presenceRef = this.rtdb.ref(`roomLive/${room.roomId}/${PRESENCE_V2_NODE}/${userId}/${this.presenceConnectionId}`);
        this.presenceRoomRef = this.rtdb.ref(`roomLive/${room.roomId}/${PRESENCE_V2_NODE}`);
        this.legacyPresenceRoomRef = this.rtdb.ref(`roomLive/${room.roomId}/presence`);
        this.connectionStateRef = this.rtdb.ref('.info/connected');
        this.serverTimeOffsetRef = this.rtdb.ref('.info/serverTimeOffset');
        this.serverTimeOffsetRef.on('value', (snapshot) => {
            const offsetMs = Number(snapshot?.val?.());
            this.serverTimeOffsetMs = Number.isFinite(offsetMs) ? offsetMs : 0;
        });
        this.stateRef.on('value', (snapshot) => {
            const nextState = snapshot.val();
            this.trace('state-received', {
                exists: Boolean(nextState),
                revision: Number(nextState?.revision || 0),
                phase: nextState?.phase || null,
            });
            if (this.room?.roomId !== room.roomId) return;
            if (!nextState) {
                this.endExpiredRoomSession('Комната больше недоступна');
                return;
            }
            const previousState = this.roomState;
            this.roomState = nextState;
            this.announceRemoteStateChange(previousState, nextState);
            this.hostStateRevision = Math.max(this.hostStateRevision, Number(nextState.revision || 0));
            const publishedByAnotherMember = typeof nextState.updatedBy === 'string'
                && nextState.updatedBy !== this.currentUserId();
            if (publishedByAnotherMember && this.bufferWait) this.cancelBufferWait();
            if (this.role === 'viewer' || (this.role === 'controller' && publishedByAnotherMember)) {
                this.syncViewerState(nextState);
            } else if (this.role === 'owner' && publishedByAnotherMember) {
                this.followRoomState(nextState);
            } else if (this.role === 'owner' && !normalizeRoomSelection(nextState.selection)) {
                // Rooms are created without an episode; the owner seeds the
                // episode it is watching so joining members open the same one.
                this.publishHostSelection(this.getSelection?.());
            }
        }, (error) => {
            this.trace('state-listener-error', { code: error?.code || null });
            this.onStatus(`Нет доступа к состоянию комнаты: ${error?.message || 'неизвестная ошибка'}`);
        });
        this.membersRef.on('value', (snapshot) => {
            this.memberState = snapshot.val() || {};
            const currentMemberRole = this.memberState[this.currentUserId()]?.role;
            const previousRole = this.role;
            if (currentMemberRole === 'owner' || currentMemberRole === 'controller' || currentMemberRole === 'viewer') {
                this.role = currentMemberRole;
            }
            this.emitRoomUpdate();
            if (previousRole && previousRole !== this.role) void this.markPresence();
        });
        const updatePresenceSource = (source, snapshot) => {
            if (!snapshot?.key) return;
            const current = this.presenceState[snapshot.key] || {};
            const value = snapshot.val();
            if (value && typeof value === 'object') current[source] = value;
            else delete current[source];
            if (Object.keys(current).length > 0) this.presenceState[snapshot.key] = current;
            else delete this.presenceState[snapshot.key];
            this.emitRoomUpdate();
        };
        const handlePresenceChild = (snapshot) => updatePresenceSource('v2', snapshot);
        const handleLegacyPresenceChild = (snapshot) => updatePresenceSource('legacy', snapshot);
        const handlePresenceRemoved = (snapshot) => updatePresenceSource('v2', snapshot);
        const handleLegacyPresenceRemoved = (snapshot) => updatePresenceSource('legacy', snapshot);
        const handleRealtimeListenerError = (error) => this.handleRealtimeListenerError(error);
        this.presenceRoomRef.on('child_added', handlePresenceChild, handleRealtimeListenerError);
        this.presenceRoomRef.on('child_changed', handlePresenceChild, handleRealtimeListenerError);
        this.presenceRoomRef.on('child_removed', handlePresenceRemoved, handleRealtimeListenerError);
        this.legacyPresenceRoomRef.on('child_added', handleLegacyPresenceChild, handleRealtimeListenerError);
        this.legacyPresenceRoomRef.on('child_changed', handleLegacyPresenceChild, handleRealtimeListenerError);
        this.legacyPresenceRoomRef.on('child_removed', handleLegacyPresenceRemoved, handleRealtimeListenerError);
        this.connectionStateRef.on('value', (snapshot) => {
            this.handleRealtimeConnectionState(snapshot?.val?.() === true);
        }, handleRealtimeListenerError);
        // The server moves this value when the owner extends the room.
        this.accessExpiryRef = this.rtdb.ref(`roomAccess/${userId}/${room.roomId}/expiresAtMs`);
        this.accessExpiryRef.on('value', (snapshot) => {
            this.handleAccessExpiry(Number(snapshot?.val?.()));
        }, handleRealtimeListenerError);
        this.readinessRef = this.rtdb.ref(`roomLive/${room.roomId}/readiness/${userId}`);
        this.readinessRoomRef = this.rtdb.ref(`roomLive/${room.roomId}/readiness`);
        this.readinessRoomRef.on('value', (snapshot) => {
            this.readinessState = snapshot?.val?.() || {};
            this.evaluateBufferWait();
        }, handleRealtimeListenerError);
        await this.markPresence({ rearmDisconnect: true });
        if (!this.room || this.room.roomId !== room.roomId) return false;
        this.armRoomExpiry(room);
        this.schedulePresenceHeartbeat();
        this.schedulePresenceStaleCheck();
        if (this.rtdbConnected !== false) this.onStatus('');
        return true;
    }

    armRoomExpiry(room) {
        this.clearRoomExpiry();
        const expiresAtMs = Number(room?.expiresAtMs);
        if (!Number.isFinite(expiresAtMs)) throw new Error('У комнаты не указано корректное время окончания');
        const roomId = room.roomId;
        const generation = ++this.roomExpiryGeneration;
        const recheck = () => {
            if (this.roomExpiryGeneration !== generation || this.room?.roomId !== roomId) return;
            const remainingMs = expiresAtMs - this.now();
            if (remainingMs <= 0) {
                this.endExpiredRoomSession('Время комнаты истекло');
                return;
            }
            const warningInMs = remainingMs - ROOM_EXPIRY_WARNING_MS;
            if (warningInMs <= 0) {
                if (this.expiryWarningFor !== expiresAtMs) {
                    this.expiryWarningFor = expiresAtMs;
                    this.onExpiryWarning({ expiresAtMs, remainingMs, canExtend: this.role === 'owner' });
                }
            } else if (this.expiryWarningFor !== null) {
                this.expiryWarningFor = null;
                this.onExpiryWarning(null);
            }
            this.cancelTimeout(this.roomExpiryTimer);
            this.roomExpiryTimer = this.scheduleTimeout(recheck, warningInMs > 0 ? warningInMs : remainingMs);
            this.roomExpiryTimer?.unref?.();
        };
        const onVisibilityChange = () => {
            if (this.lifecycleDocument?.hidden === false) recheck();
        };
        this.roomExpiryCheckDisposer = () => {
            this.lifecycleDocument?.removeEventListener?.('visibilitychange', onVisibilityChange);
            this.lifecycleWindow?.removeEventListener?.('focus', recheck);
        };
        this.lifecycleDocument?.addEventListener?.('visibilitychange', onVisibilityChange);
        this.lifecycleWindow?.addEventListener?.('focus', recheck);
        recheck();
    }

    clearRoomExpiry() {
        this.roomExpiryGeneration += 1;
        this.cancelTimeout(this.roomExpiryTimer);
        this.roomExpiryTimer = null;
        this.roomExpiryCheckDisposer?.();
        this.roomExpiryCheckDisposer = null;
    }

    endExpiredRoomSession(reason) {
        if (!this.room) return;
        this.clearRoomExpiry();
        this.onStatus(reason);
        this.disconnect(false, { presenceMode: 'keep-on-disconnect' });
        this.onRoomUpdate({ roomId: null, role: null, members: [] });
    }

    currentUserId() {
        return window.firebaseManager?.getCurrentUser?.()?.uid || null;
    }

    currentProviderId() {
        const value = String(this.getProviderId?.() || '').trim().toLowerCase();
        return /^[a-z0-9_-]{1,40}$/.test(value) ? value : 'kinogo';
    }

    currentProviderSource(providerHint = this.currentProviderId()) {
        const source = this.getProviderSource?.();
        if (providerHint !== 'rutube') return null;
        const videoId = String(source?.videoId || '').trim();
        if (!/^[a-z0-9_-]{8,80}$/i.test(videoId)) {
            throw new Error('Для Rutube дождитесь загрузки точного ролика перед созданием комнаты');
        }
        return { version: 1, providerId: 'rutube', videoId };
    }

    canControlTimeline() {
        return this.role === 'owner' || this.role === 'controller';
    }

    currentRoomSelection() {
        return normalizeRoomSelection(this.getSelection?.());
    }

    // Follows a room state that another member published: first the room's
    // episode, then its timeline.
    followRoomState(state) {
        if (!state || !this.role) return;
        if (!this.syncRoomSelection(state)) return;
        this.applyRoomState(state);
    }

    // Returns true when the local player already shows the room's episode.
    // Otherwise it starts one switch to that episode and returns false; the
    // timeline is applied after the new player reports readiness.
    syncRoomSelection(state) {
        const roomSelection = normalizeRoomSelection(state?.selection);
        if (!roomSelection) return true;
        const key = roomSelectionKey(roomSelection);
        if (this.selectionSwitch?.key === key) return false;
        if (roomSelectionKey(this.currentRoomSelection()) === key) return true;
        this.cancelSelectionSwitch(this.selectionSwitch);
        const task = { key, selection: roomSelection, requested: false, timeout: null };
        this.selectionSwitch = task;
        task.timeout = this.scheduleTimeout(() => {
            if (this.selectionSwitch !== task) return;
            this.trace('room-selection-timeout', { selection: key });
            this.completeSelectionSwitch(task, 'timeout', { force: true });
        }, ROOM_SYNC_SELECTION_SWITCH_TIMEOUT_MS);
        task.timeout?.unref?.();
        this.onStatus(`Переключаю на ${roomSelection.seasonNumber} сезон, ${roomSelection.episodeNumber} серию…`);
        this.trace('room-selection-switch-start', { selection: key });
        void Promise.resolve()
            .then(() => this.onSelectionRequest({ ...roomSelection }))
            .then((changed) => {
                if (this.selectionSwitch !== task) return;
                if (changed === false) throw new Error('серия недоступна в этом источнике');
                task.requested = true;
                this.trace('room-selection-requested', { selection: key });
            })
            .catch((error) => {
                if (this.selectionSwitch !== task) return;
                this.cancelSelectionSwitch(task);
                this.onStatus(`Не удалось открыть серию комнаты: ${error?.message || 'неизвестная ошибка'}`);
            });
        return false;
    }

    completeSelectionSwitch(task, reason, { force = false } = {}) {
        if (!task || this.selectionSwitch !== task) return;
        if (!force && !task.requested) return;
        if (!force && roomSelectionKey(this.currentRoomSelection()) !== task.key) return;
        this.cancelSelectionSwitch(task);
        this.trace('room-selection-ready', { selection: task.key, reason });
        this.onStatus('');
        // Only player telemetry describes the new episode; any other sample
        // still belongs to the previous episode's player.
        if (!reason.startsWith('telemetry-')) this.playerSample = null;
        if (!this.roomState || !this.role) return;
        const roomKey = roomSelectionKey(normalizeRoomSelection(this.roomState.selection));
        if (force && roomKey === task.key && roomSelectionKey(this.currentRoomSelection()) !== task.key) {
            // Do not retry in a loop: the member can pick the episode by hand.
            this.onStatus('Серия комнаты не загрузилась у вас — откройте её вручную');
            return;
        }
        this.followRoomState(this.roomState);
    }

    cancelSelectionSwitch(task) {
        if (!task) return;
        this.cancelTimeout(task.timeout);
        task.timeout = null;
        if (this.selectionSwitch === task) this.selectionSwitch = null;
    }

    // Called for every canonical episode change on this page. An owner or
    // controller publishes the change; a viewer is returned to the room's
    // episode because the room decides what everyone watches.
    publishHostSelection(selection) {
        const normalized = normalizeRoomSelection(selection);
        if (!normalized || !this.room || !this.roomState || !this.stateRef) return;
        if (this.selectionSwitch) return;
        const key = roomSelectionKey(normalized);
        const pendingKey = roomSelectionKey(normalizeRoomSelection(this.hostStatePatch?.selection));
        const roomKey = roomSelectionKey(normalizeRoomSelection(this.roomState.selection));
        if ((pendingKey || roomKey) === key) return;
        if (!this.canControlTimeline()) {
            // A viewer's own auto-next waits for the room's next episode
            // instead of bouncing back to the one that just ended.
            if (!roomKey || selection?.source === 'AUTO_NEXT') return;
            this.onStatus('Серию в комнате выбирает создатель или управляющий');
            this.followRoomState(this.roomState);
            return;
        }
        this.trace('host-selection-publish', { selection: key });
        // A new episode starts from its beginning until the player reports
        // its real position through play/seek telemetry.
        this.queueHostStatePatch({
            selection: normalized,
            phase: 'paused',
            basePositionMs: 0,
            effectiveAtMs: this.serverNow(),
        }, 'selection');
    }

    async setMemberRole(targetUid, role) {
        if (this.role !== 'owner' || !this.room?.roomId) {
            throw new Error('Только создатель комнаты может менять роли');
        }
        const result = await this.callApi('setMemberRole', {
            roomId: this.room.roomId,
            targetUid,
            role,
        });
        return result.room;
    }

    async syncViewerState(state) {
        const providerHint = String(state?.providerHint || 'kinogo').trim().toLowerCase();
        if (!/^[a-z0-9_-]{1,40}$/.test(providerHint)) {
            this.onStatus('Источник комнаты имеет некорректный идентификатор');
            return;
        }
        if (providerHint === this.activeProviderHint) {
            this.followRoomState(state);
            return;
        }
        if (this.providerSwitch?.providerHint === providerHint) return;
        if (this.providerSwitch) this.cancelViewerProviderSwitch(this.providerSwitch);
        const task = { providerHint };
        this.providerSwitch = task;
        this.onStatus('Переключаю источник комнаты…');
        this.trace('viewer-provider-switch-start', { providerHint });
        try {
            const changed = await this.onProviderChange(providerHint, state?.providerSource || null);
            if (!changed) throw new Error('Этот источник недоступен у вас');
            if (this.providerSwitch !== task || !this.room) return;
            if (this.getIframe?.()?.contentWindow) {
                task.awaitingPlayerReady = true;
                this.armViewerProviderReadyTimeout(task);
                this.trace('viewer-provider-awaiting-ready', { providerHint });
                return;
            }
            await this.completeViewerProviderSwitch(task, 'source-change-finished');
        } catch (error) {
            if (this.providerSwitch === task) {
                this.cancelViewerProviderSwitch(task);
                this.onStatus(`Источник комнаты недоступен: ${error.message}`);
            }
        } finally {
            if (this.providerSwitch === task && !task.completionPromise && !task.awaitingPlayerReady) {
                this.cancelViewerProviderSwitch(task);
            }
        }
    }

    armViewerProviderReadyTimeout(task) {
        clearTimeout(task.readyTimeout);
        task.readyTimeout = setTimeout(() => {
            if (this.providerSwitch !== task) return;
            this.trace('viewer-provider-ready-timeout', { providerHint: task.providerHint });
            this.cancelViewerProviderSwitch(task);
            this.onStatus('Новый источник комнаты не подтвердил готовность');
        }, 8_000);
    }

    cancelViewerProviderSwitch(task) {
        if (!task) return;
        clearTimeout(task.readyTimeout);
        task.readyTimeout = null;
        task.awaitingPlayerReady = false;
        if (this.providerSwitch === task) this.providerSwitch = null;
    }

    async completeViewerProviderSwitch(task, reason) {
        if (this.role !== 'viewer' || this.providerSwitch !== task || !this.room) return false;
        if (task.completionPromise) return task.completionPromise;
        task.completionPromise = (async () => {
            try {
                const probe = await this.probePlayer();
                const required = ['observeTime', 'play', 'pause', 'seek', 'duration'];
                if (!required.every((name) => probe.capabilities?.[name] === true)) {
                    throw new Error('Новый источник ещё не готов к синхронизации');
                }
                if (this.providerSwitch !== task || !this.room) return false;
                const activeProvider = this.currentProviderId();
                if (activeProvider !== task.providerHint) {
                    this.trace('viewer-provider-ready-ignored', {
                        expectedProviderHint: task.providerHint,
                        activeProvider,
                        reason,
                    });
                    return false;
                }
                this.activeProviderHint = task.providerHint;
                this.playerSample = null;
                this.trace('viewer-provider-ready', { providerHint: task.providerHint, reason });
                this.followRoomState(this.roomState);
                return true;
            } catch (error) {
                if (this.providerSwitch === task) {
                    this.trace('viewer-provider-error', {
                        providerHint: task.providerHint,
                        reason,
                        code: error?.code || null,
                    });
                    this.onStatus(`Источник комнаты недоступен: ${error.message}`);
                }
                return false;
            } finally {
                if (this.providerSwitch === task) this.cancelViewerProviderSwitch(task);
            }
        })();
        return task.completionPromise;
    }

    getLatestPresenceRecord(value) {
        if (!value || typeof value !== 'object') return null;
        if (Object.prototype.hasOwnProperty.call(value, 'v2')
            || Object.prototype.hasOwnProperty.call(value, 'legacy')) {
            return [value.v2, value.legacy]
                .map((source) => this.getLatestPresenceRecord(source))
                .filter(Boolean)
                .sort((left, right) => {
                    const leftSeen = Number(left.lastSeenAtMs ?? left.connectedAtMs ?? 0);
                    const rightSeen = Number(right.lastSeenAtMs ?? right.connectedAtMs ?? 0);
                    return rightSeen - leftSeen;
                })[0] || null;
        }
        if (value.role || value.lastSeenAtMs !== undefined || value.connectedAtMs !== undefined) return value;
        return Object.values(value)
            .filter((record) => record && typeof record === 'object')
            .sort((left, right) => {
                const leftSeen = Number(left.lastSeenAtMs ?? left.connectedAtMs ?? 0);
                const rightSeen = Number(right.lastSeenAtMs ?? right.connectedAtMs ?? 0);
                return rightSeen - leftSeen;
            })[0] || null;
    }

    isPresenceOnline(presence) {
        if (!presence) return false;
        const lastSeenAtMs = Number(presence.lastSeenAtMs ?? presence.connectedAtMs);
        if (!Number.isFinite(lastSeenAtMs)) return true;
        return this.now() - lastSeenAtMs <= PRESENCE_STALE_MS;
    }

    emitRoomUpdate() {
        if (!this.room) return;
        const members = Object.entries(this.memberState).map(([uid, member]) => {
            const memberDisplayName = String(member?.displayName || '').trim();
            const presence = this.getLatestPresenceRecord(this.presenceState[uid]);
            const presenceDisplayName = String(presence?.displayName || '').trim();
            const displayName = (memberDisplayName && memberDisplayName !== 'Участник'
                ? memberDisplayName
                : presenceDisplayName || memberDisplayName || (member?.role === 'owner' ? 'Создатель' : 'Участник')
            ).slice(0, 48);
            const role = member?.role === 'owner'
                ? 'owner'
                : member?.role === 'controller'
                    ? 'controller'
                    : 'viewer';
            return {
                uid,
                role,
                displayName,
                online: this.isPresenceOnline(presence),
                isCurrentUser: uid === this.currentUserId(),
            };
        }).sort((left, right) => {
            const roleOrder = { owner: 0, controller: 1, viewer: 2 };
            const difference = roleOrder[left.role] - roleOrder[right.role];
            return difference || left.displayName.localeCompare(right.displayName);
        });
        this.onRoomUpdate({ roomId: this.room.roomId, role: this.role, members });
    }

    handleRealtimeListenerError(error) {
        this.trace('rtdb-listener-error', { code: error?.code || null });
        if (this.room) {
            this.onStatus(error?.code === 'permission_denied'
                ? 'Доступ к комнате больше недоступен'
                : 'Соединение с комнатой восстанавливается…');
        }
    }

    handleRealtimeConnectionState(connected) {
        if (!this.room) return;
        this.rtdbConnected = connected;
        this.trace('rtdb-connection-state', { connected });
        if (!connected) {
            this.onStatus('Соединение с комнатой восстанавливается…');
            this.emitRoomUpdate();
            return;
        }
        this.onStatus('');
        void this.markPresence({ rearmDisconnect: true }).then(() => {
            if (this.room) this.emitRoomUpdate();
        });
    }

    async writePresence({ rearmDisconnect = false } = {}) {
        const presenceRef = this.presenceRef;
        const roomId = this.room?.roomId;
        const sessionGeneration = this.presenceSessionGeneration;
        const isCurrentSession = () => this.presenceSessionGeneration === sessionGeneration
            && this.presenceRef === presenceRef
            && this.room?.roomId === roomId;
        if (!presenceRef || !this.role || !roomId || this.rtdbConnected === false) return false;
        const displayName = await this.currentUserDisplayName();
        if (!isCurrentSession()) return false;
        const role = this.role;
        if (!role) return false;
        const record = {
            connectedAtMs: RTDB_SERVER_TIMESTAMP,
            lastSeenAtMs: RTDB_SERVER_TIMESTAMP,
            role,
            ...(displayName ? { displayName } : {}),
        };
        if (rearmDisconnect) {
            const disconnect = presenceRef.onDisconnect?.();
            await Promise.resolve(disconnect?.remove?.());
            if (!isCurrentSession()) return false;
        }
        try {
            if (this.presenceReady) {
                await presenceRef.update({ lastSeenAtMs: RTDB_SERVER_TIMESTAMP, role });
            } else {
                await presenceRef.set(record);
            }
        } catch (error) {
            if (!isCurrentSession()) return false;
            if (!this.presenceReady) throw error;
            await presenceRef.set(record);
        }
        if (!isCurrentSession()) return false;
        this.presenceReady = true;
        return true;
    }

    async markPresence(options = {}) {
        const task = this.presenceWriteChain
            .catch(() => {})
            .then(() => this.writePresence(options))
            .catch((error) => {
                this.onStatus(`Не удалось обновить присутствие: ${error.message}`);
                return false;
            });
        this.presenceWriteChain = task;
        return task;
    }

    schedulePresenceHeartbeat() {
        this.cancelTimeout(this.presenceHeartbeatTimer);
        const generation = ++this.presenceTimerGeneration;
        const tick = async () => {
            if (this.presenceTimerGeneration !== generation || !this.room) return;
            if (this.rtdbConnected !== false) await this.markPresence();
            if (this.presenceTimerGeneration !== generation || !this.room) return;
            this.presenceHeartbeatTimer = this.scheduleTimeout(tick, PRESENCE_HEARTBEAT_MS);
            this.presenceHeartbeatTimer?.unref?.();
        };
        this.presenceHeartbeatTimer = this.scheduleTimeout(tick, PRESENCE_HEARTBEAT_MS);
        this.presenceHeartbeatTimer?.unref?.();
    }

    schedulePresenceStaleCheck() {
        this.cancelTimeout(this.presenceStaleTimer);
        const generation = this.presenceTimerGeneration;
        const tick = () => {
            if (this.presenceTimerGeneration !== generation || !this.room) return;
            this.emitRoomUpdate();
            this.presenceStaleTimer = this.scheduleTimeout(tick, PRESENCE_STALE_CHECK_MS);
            this.presenceStaleTimer?.unref?.();
        };
        this.presenceStaleTimer = this.scheduleTimeout(tick, PRESENCE_STALE_CHECK_MS);
        this.presenceStaleTimer?.unref?.();
    }

    disconnect(updateStatus = true, { presenceMode = 'remove' } = {}) {
        this.clearRoomExpiry();
        this.presenceTimerGeneration += 1;
        this.presenceSessionGeneration += 1;
        this.cancelTimeout(this.presenceHeartbeatTimer);
        this.cancelTimeout(this.presenceStaleTimer);
        this.presenceHeartbeatTimer = null;
        this.presenceStaleTimer = null;
        if (this.stateRef) this.stateRef.off();
        if (this.membersRef) this.membersRef.off();
        if (this.presenceRoomRef) this.presenceRoomRef.off();
        if (this.legacyPresenceRoomRef) this.legacyPresenceRoomRef.off();
        if (this.connectionStateRef) this.connectionStateRef.off();
        if (this.serverTimeOffsetRef) this.serverTimeOffsetRef.off();
        if (this.accessExpiryRef) this.accessExpiryRef.off();
        if (this.readinessRoomRef) this.readinessRoomRef.off();
        if (this.readinessRef && this.localReadiness && presenceMode === 'remove') {
            this.readinessRef.onDisconnect?.().cancel?.().catch?.(() => {});
            this.readinessRef.remove?.().catch?.(() => {});
        }
        clearTimeout(this.bufferReportTimer);
        this.bufferReportTimer = null;
        if (this.bufferWait) clearTimeout(this.bufferWait.timeout);
        this.bufferWait = null;
        this.accessExpiryRef = null;
        this.readinessRef = null;
        this.readinessRoomRef = null;
        this.readinessState = {};
        this.localReadiness = null;
        if (this.expiryWarningFor !== null) {
            this.expiryWarningFor = null;
            this.onExpiryWarning(null);
        }
        if (this.presenceRef) {
            this.presenceRef.off();
            if (presenceMode === 'remove') {
                this.presenceRef.onDisconnect?.().cancel?.().catch?.(() => {});
                this.presenceRef.remove?.().catch?.(() => {});
            }
        }
        this.stateRef = null;
        this.membersRef = null;
        this.presenceRef = null;
        this.presenceRoomRef = null;
        this.legacyPresenceRoomRef = null;
        this.connectionStateRef = null;
        this.serverTimeOffsetRef = null;
        this.serverTimeOffsetMs = 0;
        this.playerSample = null;
        this.driftConfirmations = 0;
        this.lastDriftCorrectionAt = 0;
        this.presenceConnectionId = null;
        this.presenceReady = false;
        this.presenceWriteChain = Promise.resolve();
        this.rtdbConnected = null;
        this.rtdb = null;
        this.room = null;
        this.role = null;
        this.roomState = null;
        this.memberState = {};
        this.presenceState = {};
        this.subscriptionId = null;
        this.activeProviderHint = null;
        this.cancelViewerProviderSwitch(this.providerSwitch);
        this.providerSwitch = null;
        this.cancelSelectionSwitch(this.selectionSwitch);
        this.hostStatePatch = null;
        this.hostStateFlushQueued = false;
        this.hostStateRevision = 0;
        this.hostStateWriteChain = Promise.resolve();
        this.expectedPlayerEffects = { seekTargetMs: null, seekUntil: 0, phase: null, phaseUntil: 0 };
        if (this.playbackBlocked) {
            this.playbackBlocked = false;
            this.onPlaybackBlocked(false);
        }
        this.unbindNativeVideoTelemetry();
        this.pending.forEach(({ reject }) => reject?.(new Error('Комната закрыта')));
        this.pending.clear();
        clearTimeout(this.guestReapplyTimer);
        this.guestReapplyTimer = null;
        if (updateStatus) this.onStatus('');
    }

    postToPlayer(message) {
        const bridge = this.getPlayerBridge?.();
        if (bridge?.isActive?.()) {
            if (message.type === 'ROOM_SYNC_SUBSCRIBE') {
                bridge.subscribe(message.subscriptionId);
                return;
            }
            if (message.type === 'ROOM_SYNC_COMMAND') {
                bridge.command(message);
                return;
            }
        }
        const iframe = this.getIframe?.();
        if (iframe?.contentWindow) {
            const targetOrigin = getWatchRoomFrameOrigin(iframe);
            if (!targetOrigin) throw new Error('Плеер ещё загружается');
            iframe.contentWindow.postMessage(message, targetOrigin);
            return;
        }
        const video = this.getVideo?.();
        if (!video) throw new Error('Плеер ещё загружается');
        if (message.type === 'ROOM_SYNC_COMMAND' && ROOM_SYNC_TIMELINE_ACTIONS.has(message.action)) {
            if (message.action === 'seek' && Number.isFinite(Number(message.positionMs))) {
                video.currentTime = Math.max(0, Number(message.positionMs) / 1000);
            } else if (message.action === 'play') {
                video.play?.().catch?.((error) => {
                    this.handlePlayerCommandFailure('play', error?.name === 'NotAllowedError' ? 'PLAYBACK_BLOCKED' : 'COMMAND_FAILED');
                });
            } else if (message.action === 'pause') {
                video.pause?.();
            }
        }
    }

    async probePlayer() {
        const deadline = Date.now() + 6000;
        let lastProbeError = null;
        while (Date.now() < deadline) {
            const bridge = this.getPlayerBridge?.();
            if (bridge?.isActive?.()) {
                try {
                    return await bridge.probe(Math.min(900, Math.max(120, deadline - Date.now())));
                } catch (error) {
                    lastProbeError = error;
                    await new Promise((resolve) => setTimeout(resolve, 120));
                    continue;
                }
            }
            const nativeVideo = this.getVideo?.();
            const duration = Number(nativeVideo?.duration);
            if (nativeVideo && Number(nativeVideo.readyState) >= 1 && (!Number.isFinite(duration) || duration > 0)) {
                return {
                    capabilities: { observeTime: true, play: true, pause: true, seek: true, duration: true },
                    nativeVideo: true,
                };
            }
            const iframe = this.getIframe?.();
            if (iframe?.contentWindow) {
                try {
                    const result = await this.probeIframe(Math.min(900, Math.max(120, deadline - Date.now())));
                    const required = ['observeTime', 'play', 'pause', 'seek', 'duration'];
                    if (required.every((name) => result.capabilities?.[name] === true)) return result;
                    lastProbeError = new Error('Источник ещё загружает метаданные');
                } catch (error) {
                    lastProbeError = error;
                }
            }
            await new Promise((resolve) => setTimeout(resolve, 120));
        }
        throw lastProbeError || new Error('Плеер ещё загружается');
    }

    handleProviderPlayerMessage(event) {
        const bridge = this.getPlayerBridge?.();
        if (!bridge?.isActive?.()) return { handled: false, ready: false };
        const result = bridge.handleWindowMessage?.(event) || { handled: false, ready: false, messages: [] };
        result.messages?.forEach((message) => this.handlePlayerMessage(message));
        return result;
    }

    probeIframe(timeoutMs = 6000) {
        const requestId = this.makeRequestId('room-probe');
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(requestId);
                reject(new Error('Источник не ответил на проверку синхронизации'));
            }, timeoutMs);
            this.pending.set(requestId, {
                resolve: (result) => { clearTimeout(timeout); resolve(result); },
                reject: (error) => { clearTimeout(timeout); reject(error); },
            });
            try {
                this.postToPlayer({ type: 'ROOM_SYNC_PROBE', requestId });
            } catch (error) {
                clearTimeout(timeout);
                this.pending.delete(requestId);
                reject(error);
            }
        });
    }

    handlePlayerMessage(data) {
        if (!data) return;
        if (data.type === 'ROOM_SYNC_PROBE_RESULT' || data.type === 'ROOM_SYNC_COMMAND_RESULT') {
            const pending = this.pending.get(data.requestId);
            if (!pending) return;
            this.pending.delete(data.requestId);
            if (data.type === 'ROOM_SYNC_COMMAND_RESULT' && data.ok !== true) {
                pending.reject(new Error(data.code || 'Команда плеера не выполнена'));
            } else {
                pending.resolve(data);
            }
            return;
        }
        if (data.type !== 'ROOM_SYNC_TELEMETRY' || data.subscriptionId !== this.subscriptionId) return;
        this.handleRoomTelemetry(data);
    }

    handleRoomTelemetry(data) {
        this.recordPlayerSample(data);
        if (this.selectionSwitch) {
            // The player is moving to the room's episode: its events are an
            // effect of the room, never a new room state.
            if (ROOM_SYNC_SELECTION_READY_TELEMETRY_KINDS.has(data.kind)) {
                this.completeSelectionSwitch(this.selectionSwitch, `telemetry-${data.kind}`);
            }
            return;
        }
        if (ROOM_SYNC_READINESS_TELEMETRY_KINDS.has(data.kind)) {
            this.updateLocalBuffering(data.kind);
            return;
        }
        if (data.kind === 'timeupdate') {
            if (data.paused === false) this.updateLocalBuffering('progress');
            this.reconcileTimelineDrift();
            return;
        }
        if (ROOM_SYNC_OBSERVED_TELEMETRY_KINDS.has(data.kind)) {
            this.trace('telemetry-received', { kind: data.kind });
        }
        // Evaluate the expectation first so a matching event is consumed even
        // when it also falls inside the short fallback window.
        const isExpectedEffect = this.consumeExpectedPlayerEffect(data);
        const isRemotePlaybackEffect = isExpectedEffect || Date.now() <= this.ignoreRemoteTelemetryUntil;
        if (this.canControlTimeline() && !isRemotePlaybackEffect) {
            // A manual action by the publisher ends an automatic buffering wait.
            if (this.bufferWait && ROOM_SYNC_PUBLISHED_TELEMETRY_KINDS.has(data.kind)) this.cancelBufferWait();
            this.publishHostTelemetry(data);
        }
        if (data.kind === 'play') this.setPlaybackBlocked(false);
        if (this.role === 'viewer' && !isRemotePlaybackEffect
            && ROOM_SYNC_OBSERVED_TELEMETRY_KINDS.has(data.kind)) {
            this.noticeLocalOverride(data);
            clearTimeout(this.guestReapplyTimer);
            this.guestReapplyTimer = setTimeout(() => this.followRoomState(this.roomState), 160);
        }
    }

    bindNativeVideoTelemetry() {
        this.unbindNativeVideoTelemetry();
        const video = this.getVideo?.();
        if (!video) return;
        this.nativeVideo = video;
        let lastTimeupdateAt = 0;
        ['play', 'pause', 'seeking', 'seeked', 'timeupdate', 'waiting', 'playing', 'canplay'].forEach((kind) => {
            const listener = () => {
                const observedAtMs = Date.now();
                if (kind === 'timeupdate') {
                    if (observedAtMs - lastTimeupdateAt < 750) return;
                    lastTimeupdateAt = observedAtMs;
                }
                this.handleRoomTelemetry({
                    kind,
                    currentTimeMs: Number(video.currentTime || 0) * 1000,
                    paused: Boolean(video.paused),
                    observedAtMs,
                });
            };
            video.addEventListener(kind, listener);
            this.nativeTelemetryDisposers.push(() => video.removeEventListener(kind, listener));
        });
    }

    refreshPlayerBridge() {
        if (!this.room || !this.subscriptionId) return;
        // A replacement player document starts with an unknown position.
        this.playerSample = null;
        // A provider can remount its iframe while the room remains active. The
        // subscription belongs to that iframe document, so the replacement must
        // receive the existing subscription before it can emit host telemetry.
        this.postToPlayer({ type: 'ROOM_SYNC_SUBSCRIBE', subscriptionId: this.subscriptionId });
        this.trace('player-subscribed', { reason: 'player-ready' });
        const video = this.getVideo?.();
        if (video !== this.nativeVideo) this.bindNativeVideoTelemetry();
        if (this.selectionSwitch) this.completeSelectionSwitch(this.selectionSwitch, 'player-ready');
        const task = this.providerSwitch;
        if (this.role === 'viewer' && task && this.currentProviderId() === task.providerHint) {
            this.trace('viewer-provider-ready-signal', { providerHint: task.providerHint });
            void this.completeViewerProviderSwitch(task, 'player-ready');
        }
    }

    unbindNativeVideoTelemetry() {
        this.nativeTelemetryDisposers.forEach((dispose) => dispose());
        this.nativeTelemetryDisposers = [];
        this.nativeVideo = null;
    }

    publishHostTelemetry(data) {
        if (!this.stateRef || !this.roomState || !ROOM_SYNC_PUBLISHED_TELEMETRY_KINDS.has(data.kind)) return;
        const phase = data.kind === 'play' ? 'playing'
            : data.kind === 'pause' ? 'paused'
                : (this.hostStatePatch?.phase || this.roomState.phase);
        let basePositionMs = Number(data.currentTimeMs);
        if (!Number.isFinite(basePositionMs) || basePositionMs < 0) return;
        // Telemetry crosses a postMessage hop; a playing position keeps
        // advancing until it is published.
        const observedAtMs = Number(data.observedAtMs);
        if (phase === 'playing' && Number.isFinite(observedAtMs)) {
            basePositionMs += Math.max(0, Date.now() - observedAtMs);
        }
        this.queueHostStatePatch({
            phase,
            basePositionMs: Math.round(basePositionMs),
            effectiveAtMs: this.serverNow(),
        }, data.kind);
    }

    publishHostProvider(providerId, providerSource = null) {
        const normalized = String(providerId || '').trim().toLowerCase();
        if (this.role !== 'owner' || !this.stateRef || !this.roomState || !/^[a-z0-9_-]{1,40}$/.test(normalized)) return;
        let normalizedSource = null;
        if (normalized === 'rutube') {
            const videoId = String(providerSource?.videoId || '').trim();
            if (!/^[a-z0-9_-]{8,80}$/i.test(videoId)) {
                this.onStatus('Не удалось подтвердить ролик Rutube для комнаты');
                return;
            }
            normalizedSource = { version: 1, providerId: 'rutube', videoId };
        }
        const currentSource = this.hostStatePatch?.providerSource ?? this.roomState.providerSource ?? null;
        if ((this.hostStatePatch?.providerHint || this.roomState.providerHint) === normalized
            && JSON.stringify(currentSource) === JSON.stringify(normalizedSource)) return;
        // RTDB validates the whole state node, so every write must refresh
        // `effectiveAtMs`. Re-anchor the current room position with it so a
        // source change does not rewind the shared timeline.
        const pendingTimeline = this.hostStatePatch
            && this.hostStatePatch.basePositionMs !== undefined
            && this.hostStatePatch.effectiveAtMs !== undefined;
        const timelineAnchor = pendingTimeline ? {} : {
            basePositionMs: Math.round(this.expectedRoomPositionMs(this.roomState)),
            effectiveAtMs: this.serverNow(),
        };
        this.queueHostStatePatch({
            providerHint: normalized,
            providerSource: normalizedSource,
            ...timelineAnchor,
        }, 'provider');
    }

    queueHostStatePatch(patch, kind) {
        if (!this.canControlTimeline() || !this.stateRef || !this.roomState || !this.currentUserId()) return;
        this.hostStatePatch = { ...(this.hostStatePatch || {}), ...patch, kind };
        if (this.hostStateFlushQueued) return;
        this.hostStateFlushQueued = true;
        Promise.resolve().then(() => this.flushHostStatePatch());
    }

    flushHostStatePatch() {
        this.hostStateFlushQueued = false;
        const patch = this.hostStatePatch;
        this.hostStatePatch = null;
        if (!patch || !this.canControlTimeline() || !this.stateRef || !this.roomState) return;
        const stateRef = this.stateRef;
        const roomId = this.room?.roomId;
        this.hostStateWriteChain = this.hostStateWriteChain
            .catch(() => {})
            .then(async () => {
                const uid = this.currentUserId();
                if (!uid || this.stateRef !== stateRef || this.room?.roomId !== roomId || !this.roomState) return;
                const revision = Math.max(this.hostStateRevision, Number(this.roomState.revision || 0)) + 1;
                const update = { ...patch, revision, updatedBy: uid };
                delete update.kind;
                this.trace('host-state-publish', { kind: patch.kind, revision, phase: update.phase || this.roomState.phase });
                try {
                    await stateRef.update(update);
                    if (this.stateRef !== stateRef || this.room?.roomId !== roomId) return;
                    this.hostStateRevision = revision;
                    this.roomState = { ...this.roomState, ...update };
                    this.trace('host-state-published', { revision });
                } catch (error) {
                    if (this.stateRef !== stateRef || this.room?.roomId !== roomId) return;
                    this.hostStateRevision = Number(this.roomState?.revision || 0);
                    this.trace('host-state-rejected', { revision, code: error?.code || null });
                    // The local player already shows the rejected action; bring
                    // it back to the shared room state so nobody drifts apart.
                    this.onStatus('Действие не передалось комнате — возвращаю общий момент', { timeoutMs: 5000 });
                    this.followRoomState(this.roomState);
                }
            });
    }

    // Waits for the provider bridge's result for one room command. Bridges
    // that never answer (Rutube, a direct video) simply time out silently.
    trackPlayerCommand(requestId, action) {
        const timeout = setTimeout(() => this.pending.delete(requestId), PLAYER_COMMAND_RESULT_TIMEOUT_MS);
        this.pending.set(requestId, {
            resolve: () => clearTimeout(timeout),
            reject: (error) => {
                clearTimeout(timeout);
                this.handlePlayerCommandFailure(action, error?.message);
            },
        });
    }

    handlePlayerCommandFailure(action, code) {
        if (!this.room) return;
        this.trace('player-command-failed', { action, code: code || null });
        if (action === 'play' && code === 'PLAYBACK_BLOCKED') {
            this.setPlaybackBlocked(true);
            return;
        }
        if (action === 'seek' && code === 'INVALID_POSITION') {
            this.onStatus('Ваша версия видео короче — момент комнаты за её пределами', { timeoutMs: 6000 });
            return;
        }
        if (code === 'VIDEO_UNAVAILABLE') {
            this.onStatus('Плеер ещё не готов — синхронизация продолжится после загрузки', { timeoutMs: 5000 });
        }
    }

    // The browser refused to start playback without a click in this tab.
    setPlaybackBlocked(blocked) {
        const next = Boolean(blocked) && Boolean(this.room);
        if (this.playbackBlocked === next) return;
        this.playbackBlocked = next;
        this.onPlaybackBlocked(next);
    }

    // Called from a click: the user activation lets the player start.
    resumeBlockedPlayback() {
        this.setPlaybackBlocked(false);
        if (!this.roomState) return;
        this.playerSample = null;
        this.followRoomState(this.roomState);
    }

    memberDisplayName(uid) {
        const name = String(this.memberState?.[uid]?.displayName || '').trim();
        return name && name !== 'Участник' ? name.slice(0, 48) : 'Участник';
    }

    // Tells followers what another member just did. Drift re-anchors and
    // small corrections stay silent; only explicit actions are announced.
    announceRemoteStateChange(previous, next) {
        if (!previous || !next || typeof next.updatedBy !== 'string') return;
        if (next.updatedBy === this.currentUserId()) return;
        if (Number(next.revision || 0) <= Number(previous.revision || 0)) return;
        const name = this.memberDisplayName(next.updatedBy);
        const previousSelection = roomSelectionKey(normalizeRoomSelection(previous.selection));
        const nextSelection = normalizeRoomSelection(next.selection);
        let message = '';
        if (nextSelection && roomSelectionKey(nextSelection) !== previousSelection) {
            message = `${name} включает ${nextSelection.seasonNumber} сезон, ${nextSelection.episodeNumber} серию`;
        } else if (previous.phase !== next.phase && next.phase === 'paused') {
            const loading = this.bufferingMemberNames(next.updatedBy);
            message = loading.length
                ? `Ждём, пока загрузится у ${loading.join(', ')}`
                : `${name} поставил(а) паузу`;
        } else if (previous.phase !== next.phase && next.phase === 'playing') {
            message = `${name} продолжает просмотр`;
        } else {
            const expectedMs = this.expectedRoomPositionMs(previous, Date.now());
            const nextMs = this.expectedRoomPositionMs(next, Date.now());
            if (Math.abs(nextMs - expectedMs) >= ROOM_SYNC_SEEK_NOTICE_MS) {
                message = `${name} перемотал(а) на ${formatRoomPosition(nextMs)}`;
            }
        }
        if (message) this.onStatus(message, { timeoutMs: 4000 });
    }

    // A viewer's own pause or seek is undone by the room; say why, at most
    // once in a while so repeated clicks do not spam the status line.
    noticeLocalOverride(data) {
        const state = this.roomState;
        if (!state) return;
        const roomPlaying = state.phase === 'playing';
        if (data?.kind === 'play' && roomPlaying) return;
        if (data?.kind === 'pause' && !roomPlaying) return;
        if ((data?.kind === 'seeking' || data?.kind === 'seeked')
            && Math.abs(Number(data.currentTimeMs) - this.expectedRoomPositionMs(state)) <= ROOM_SYNC_PLAYING_SEEK_THRESHOLD_MS) return;
        const nowMs = Date.now();
        if (nowMs - this.lastLocalOverrideNoticeAt < 10_000) return;
        this.lastLocalOverrideNoticeAt = nowMs;
        const controllers = Object.entries(this.memberState || {})
            .filter(([, member]) => member?.role === 'owner' || member?.role === 'controller')
            .map(([uid]) => this.memberDisplayName(uid));
        const who = controllers.length ? controllers.join(', ') : 'создатель комнаты';
        this.onStatus(`Просмотром управляет ${who}`, { timeoutMs: 4000 });
    }

    handleAccessExpiry(expiresAtMs) {
        if (!this.room || !Number.isFinite(expiresAtMs)) return;
        const currentExpiresAtMs = Number(this.room.expiresAtMs);
        if (Number.isFinite(currentExpiresAtMs) && expiresAtMs <= currentExpiresAtMs) return;
        this.room = { ...this.room, expiresAtMs };
        this.armRoomExpiry(this.room);
        const until = new Date(expiresAtMs).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        this.onStatus(`Комната продлена до ${until}`, { timeoutMs: 5000 });
        this.emitRoomUpdate();
    }

    async extendRoom() {
        if (this.role !== 'owner' || !this.room?.roomId) {
            throw new Error('Продлить комнату может только её создатель');
        }
        const result = await this.callApi('extend', { roomId: this.room.roomId });
        this.handleAccessExpiry(Number(result?.expiresAtMs));
        return result;
    }

    isMemberOnline(uid) {
        return this.isPresenceOnline(this.getLatestPresenceRecord(this.presenceState[uid]));
    }

    bufferingMemberNames(exceptUid = null) {
        return Object.entries(this.readinessState || {})
            .filter(([uid, readiness]) => uid !== exceptUid && readiness?.status === 'resolving')
            .map(([uid]) => (uid === this.currentUserId() ? 'вас' : this.memberDisplayName(uid)));
    }

    // Reports this member's own buffering to the room. A short stall is
    // ignored; progress, `playing` or `canplay` report the member ready again.
    updateLocalBuffering(kind) {
        if (kind === 'waiting') {
            if (this.roomState?.phase !== 'playing' || this.bufferReportTimer) return;
            this.bufferReportTimer = setTimeout(() => {
                this.bufferReportTimer = null;
                this.writeLocalReadiness('resolving', 'buffering');
            }, ROOM_SYNC_BUFFER_REPORT_DELAY_MS);
            return;
        }
        clearTimeout(this.bufferReportTimer);
        this.bufferReportTimer = null;
        if (this.localReadiness === 'resolving') this.writeLocalReadiness('ready', 'playable');
    }

    writeLocalReadiness(status, code) {
        const readinessRef = this.readinessRef;
        if (!readinessRef || !this.room || this.localReadiness === status) return;
        if (!this.localReadiness) readinessRef.onDisconnect?.().remove?.()?.catch?.(() => {});
        this.localReadiness = status;
        this.trace('readiness-publish', { status });
        Promise.resolve(readinessRef.update?.({ status, code })).catch(() => {});
    }

    // Runs on the timeline publisher only: pauses the room while another
    // online member is loading, and resumes when it can play again.
    evaluateBufferWait() {
        if (!this.isTimelineAuthority() || !this.roomState) {
            if (this.bufferWait) this.cancelBufferWait();
            return;
        }
        const nowMs = Date.now();
        const selfUid = this.currentUserId();
        const loading = Object.entries(this.readinessState || {})
            .filter(([uid, readiness]) => uid !== selfUid
                && readiness?.status === 'resolving'
                && this.isMemberOnline(uid))
            .map(([uid]) => uid);
        if (this.bufferWait) {
            if (![...this.bufferWait.members].some((uid) => loading.includes(uid))) {
                this.finishBufferWait('ready');
            }
            return;
        }
        if (this.roomState.phase !== 'playing') return;
        const members = loading.filter((uid) => (this.bufferWaitCooldowns.get(uid) || 0) <= nowMs);
        if (!members.length) return;
        const local = this.localPlaybackState(nowMs);
        const positionMs = Math.round(local?.positionMs ?? this.expectedRoomPositionMs(this.roomState, nowMs));
        members.forEach((uid) => this.bufferWaitCooldowns.set(uid, nowMs + ROOM_SYNC_BUFFER_MEMBER_COOLDOWN_MS));
        this.bufferWait = {
            members: new Set(members),
            positionMs,
            timeout: setTimeout(() => this.finishBufferWait('timeout'), ROOM_SYNC_BUFFER_WAIT_MAX_MS),
        };
        this.trace('buffer-wait-start', { members: members.length });
        this.setLocalPhase('pause');
        this.queueHostStatePatch({
            phase: 'paused',
            basePositionMs: positionMs,
            effectiveAtMs: this.serverNow(nowMs),
        }, 'buffer-wait');
        this.onStatus(`Ждём, пока загрузится у ${members.map((uid) => this.memberDisplayName(uid)).join(', ')}`);
    }

    finishBufferWait(reason) {
        const wait = this.bufferWait;
        if (!wait) return;
        clearTimeout(wait.timeout);
        this.bufferWait = null;
        // Resume only the pause this wait created; any later action wins.
        if (!this.isTimelineAuthority() || this.roomState?.phase !== 'paused') return;
        this.trace('buffer-wait-finish', { reason });
        this.setLocalPhase('play');
        this.queueHostStatePatch({
            phase: 'playing',
            basePositionMs: wait.positionMs,
            effectiveAtMs: this.serverNow(),
        }, 'buffer-resume');
        this.onStatus(reason === 'timeout' ? 'Продолжаем без ожидания' : '', { timeoutMs: 3000 });
    }

    cancelBufferWait() {
        if (!this.bufferWait) return;
        clearTimeout(this.bufferWait.timeout);
        this.bufferWait = null;
        this.trace('buffer-wait-cancelled');
    }

    // Plays or pauses this member's own player as a room effect, so the
    // resulting event is not published again.
    setLocalPhase(action) {
        this.expectPlayerEffects({ phase: action });
        const requestId = this.makeRequestId('room-phase');
        this.trackPlayerCommand(requestId, action);
        try {
            this.postToPlayer({ type: 'ROOM_SYNC_COMMAND', requestId, action });
        } catch {
            this.pending.delete(requestId);
        }
        if (this.playerSample) this.playerSample = { ...this.playerSample, paused: action === 'pause', atMs: Date.now() };
    }

    // Estimated Firebase server time. Room timestamps use this clock so that
    // participants with skewed wall clocks still agree on the timeline.
    serverNow(localMs = Date.now()) {
        return localMs + (Number(this.serverTimeOffsetMs) || 0);
    }

    expectedRoomPositionMs(state, localAtMs = Date.now()) {
        const basePositionMs = Math.max(0, Number(state?.basePositionMs || 0));
        if (state?.phase !== 'playing') return basePositionMs;
        const effectiveAtMs = Number(state.effectiveAtMs);
        const elapsedMs = Number.isFinite(effectiveAtMs) ? this.serverNow(localAtMs) - effectiveAtMs : 0;
        return basePositionMs + Math.max(0, elapsedMs);
    }

    recordPlayerSample(data) {
        const positionMs = Number(data?.currentTimeMs);
        if (!Number.isFinite(positionMs) || positionMs < 0) return;
        const nowMs = Date.now();
        const observedAtMs = Number(data.observedAtMs);
        let paused = this.playerSample?.paused ?? null;
        if (typeof data.paused === 'boolean') paused = data.paused;
        else if (data.kind === 'play') paused = false;
        else if (data.kind === 'pause') paused = true;
        this.playerSample = {
            positionMs,
            paused,
            atMs: Number.isFinite(observedAtMs) ? Math.min(observedAtMs, nowMs) : nowMs,
        };
    }

    // Best local estimate of the participant's own player, or null when it
    // is unknown. A direct native video is read synchronously; a framed
    // provider is extrapolated from its latest telemetry sample.
    localPlaybackState(nowMs = Date.now()) {
        const framed = this.getPlayerBridge?.()?.isActive?.() || this.getIframe?.()?.contentWindow;
        const video = framed ? null : this.getVideo?.();
        if (video) {
            const positionMs = Number(video.currentTime) * 1000;
            return Number.isFinite(positionMs) ? { positionMs, paused: Boolean(video.paused) } : null;
        }
        const sample = this.playerSample;
        if (!sample || typeof sample.paused !== 'boolean') return null;
        if (sample.paused) return { positionMs: sample.positionMs, paused: true };
        const ageMs = Math.max(0, nowMs - sample.atMs);
        if (ageMs > ROOM_SYNC_PLAYING_SAMPLE_MAX_AGE_MS) return null;
        return { positionMs: sample.positionMs + ageMs, paused: false };
    }

    // Player events caused by a room command are matched to that command
    // instead of relying only on a fixed time window: a slow HLS seek can
    // report `seeked` seconds later, and echoing it would publish a new room
    // state and bounce between controllers.
    expectPlayerEffects({ seekTargetMs = null, phase = null } = {}, nowMs = Date.now()) {
        if (seekTargetMs !== null) {
            this.expectedPlayerEffects.seekTargetMs = seekTargetMs;
            this.expectedPlayerEffects.seekUntil = nowMs + ROOM_SYNC_EXPECTED_SEEK_MS;
        }
        if (phase !== null) {
            this.expectedPlayerEffects.phase = phase;
            this.expectedPlayerEffects.phaseUntil = nowMs + ROOM_SYNC_EXPECTED_PHASE_MS;
        }
    }

    consumeExpectedPlayerEffect(data, nowMs = Date.now()) {
        const expected = this.expectedPlayerEffects;
        if (data?.kind === 'seeking' || data?.kind === 'seeked') {
            if (expected.seekTargetMs === null || nowMs > expected.seekUntil) return false;
            const positionMs = Number(data.currentTimeMs);
            if (!Number.isFinite(positionMs)
                || Math.abs(positionMs - expected.seekTargetMs) > ROOM_SYNC_EXPECTED_SEEK_TOLERANCE_MS) return false;
            if (data.kind === 'seeked') {
                expected.seekTargetMs = null;
                expected.seekUntil = 0;
            }
            return true;
        }
        if (data?.kind === 'play' || data?.kind === 'pause') {
            if (expected.phase !== data.kind || nowMs > expected.phaseUntil) return false;
            expected.phase = null;
            expected.phaseUntil = 0;
            return true;
        }
        return false;
    }

    isTimelineAuthority() {
        return this.canControlTimeline()
            && typeof this.roomState?.updatedBy === 'string'
            && this.roomState.updatedBy === this.currentUserId();
    }

    // Runs on periodic player time samples. The participant who published the
    // current state re-anchors the room when its own playback slipped (for
    // example after buffering); every other participant seeks back onto the
    // room timeline. Corrections need consecutive confirmations and a
    // cooldown so one noisy sample or a slow seek cannot cause a seek loop.
    reconcileTimelineDrift() {
        if (!this.room || !this.roomState || !this.role || this.providerSwitch || this.selectionSwitch) return;
        const nowMs = Date.now();
        if (nowMs <= this.ignoreRemoteTelemetryUntil) return;
        const local = this.localPlaybackState(nowMs);
        if (this.roomState.phase !== 'playing' || !local || local.paused) {
            this.driftConfirmations = 0;
            return;
        }
        const driftMs = local.positionMs - this.expectedRoomPositionMs(this.roomState, nowMs);
        if (Math.abs(driftMs) <= ROOM_SYNC_PLAYING_SEEK_THRESHOLD_MS) {
            this.driftConfirmations = 0;
            return;
        }
        this.driftConfirmations += 1;
        if (this.driftConfirmations < ROOM_SYNC_DRIFT_CONFIRMATIONS) return;
        if (nowMs - this.lastDriftCorrectionAt < ROOM_SYNC_DRIFT_COOLDOWN_MS) return;
        this.driftConfirmations = 0;
        this.lastDriftCorrectionAt = nowMs;
        this.trace('timeline-drift-correction', {
            driftMs: Math.round(driftMs),
            authority: this.isTimelineAuthority(),
        });
        if (this.isTimelineAuthority()) {
            this.queueHostStatePatch({
                phase: 'playing',
                basePositionMs: Math.round(local.positionMs),
                effectiveAtMs: this.serverNow(nowMs),
            }, 'drift');
            return;
        }
        this.applyRoomState(this.roomState);
    }

    applyRoomState(state) {
        if (!state || !this.role) return;
        const nowMs = Date.now();
        const shouldPlay = state.phase === 'playing';
        const targetMs = this.expectedRoomPositionMs(state, nowMs);
        const local = this.localPlaybackState(nowMs);
        const seekThresholdMs = shouldPlay ? ROOM_SYNC_PLAYING_SEEK_THRESHOLD_MS : ROOM_SYNC_PAUSED_SEEK_THRESHOLD_MS;
        // An unknown local position is always corrected; a known one is
        // seeked only when it is outside the tolerance, which avoids a
        // rebuffer on every pause/play published by the room.
        const needsSeek = !local || Math.abs(local.positionMs - targetMs) > seekThresholdMs;
        const needsPhase = !local || local.paused === shouldPlay;
        this.driftConfirmations = 0;
        this.trace('viewer-state-apply', {
            revision: Number(state.revision || 0),
            phase: state.phase,
            seek: needsSeek,
            driftMs: local ? Math.round(local.positionMs - targetMs) : null,
        });
        if (!needsSeek && !needsPhase) return;
        this.ignoreRemoteTelemetryUntil = nowMs + 1200;
        this.expectPlayerEffects({
            seekTargetMs: needsSeek ? targetMs : null,
            phase: needsPhase ? (shouldPlay ? 'play' : 'pause') : null,
        }, nowMs);
        if (needsSeek) {
            this.lastDriftCorrectionAt = nowMs;
            const seekRequestId = this.makeRequestId('room-seek');
            this.trackPlayerCommand(seekRequestId, 'seek');
            this.postToPlayer({ type: 'ROOM_SYNC_COMMAND', requestId: seekRequestId, action: 'seek', positionMs: targetMs });
        }
        if (needsPhase) {
            const playbackRequestId = this.makeRequestId('room-phase');
            this.trackPlayerCommand(playbackRequestId, shouldPlay ? 'play' : 'pause');
            if (!shouldPlay) this.setPlaybackBlocked(false);
            this.postToPlayer({
                type: 'ROOM_SYNC_COMMAND',
                requestId: playbackRequestId,
                action: shouldPlay ? 'play' : 'pause',
            });
        }
        // Optimistic sample until the player reports the applied state.
        this.playerSample = {
            positionMs: needsSeek ? targetMs : local.positionMs,
            paused: !shouldPlay,
            atMs: nowMs,
        };
    }
}

if (typeof window !== 'undefined') {
    window.WatchRoomStagingController = WatchRoomStagingController;
    window.parseWatchRoomInvite = parseWatchRoomInvite;
    window.formatWatchRoomInvite = formatWatchRoomInvite;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        WatchRoomStagingController,
        WatchRoomApiError,
        parseWatchRoomInvite,
        formatWatchRoomInvite,
        watchRoomErrorMessage,
        formatRoomPosition,
    };
}
