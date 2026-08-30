// A watch room synchronizes the shared timeline only. Player preferences such
// as audio track, subtitles, quality, volume, and playback speed must remain
// local to each participant's browser.
const ROOM_SYNC_TIMELINE_ACTIONS = new Set(['play', 'pause', 'seek']);
const ROOM_SYNC_OBSERVED_TELEMETRY_KINDS = new Set(['play', 'pause', 'seeking', 'seeked']);
const ROOM_SYNC_PUBLISHED_TELEMETRY_KINDS = new Set(['play', 'pause', 'seeked']);

class WatchRoomStagingController {
    constructor({
        getIframe,
        getVideo,
        getMovie,
        getProviderId,
        getProviderSource,
        getPlayerBridge,
        onProviderChange,
        onStatus,
        onRoomUpdate,
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
        this.onProviderChange = onProviderChange || (async () => false);
        this.onStatus = onStatus || (() => {});
        this.onRoomUpdate = onRoomUpdate || (() => {});
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
        this.memberState = {};
        this.presenceState = {};
        this.pending = new Map();
        this.subscriptionId = null;
        this.guestReapplyTimer = null;
        this.ignoreRemoteTelemetryUntil = 0;
        this.activeProviderHint = null;
        this.providerSwitch = null;
        this.nativeVideo = null;
        this.nativeTelemetryDisposers = [];
        this.hostStateWriteChain = Promise.resolve();
        this.hostStatePatch = null;
        this.hostStateFlushQueued = false;
        this.hostStateRevision = 0;
        this.roomExpiryTimer = null;
        this.roomExpiryCheckDisposer = null;
        this.roomExpiryGeneration = 0;
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

    async callApi(action, payload = {}) {
        const firebaseManager = window.firebaseManager;
        // A movie page can finish rendering before Firebase restores the saved
        // session. Waiting here prevents a legitimate first click on “Создать”
        // from failing locally before any room request reaches the backend.
        const user = firebaseManager?.getCurrentUser?.()
            || await firebaseManager?.waitForAuthReady?.(10_000);
        if (!user) throw new Error('Нужен авторизованный аккаунт');
        const token = await user.getIdToken();
        const response = await fetch(
            'https://us-central1-movielistdb-13208.cloudfunctions.net/watchRoomsStaging',
            {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action,
                    requestId: this.makeRequestId(action),
                    displayName: await this.currentUserDisplayName(user),
                    ...payload,
                }),
            }
        );
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'Не удалось выполнить действие комнаты');
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
        const result = await this.callApi('create', {
            content: this.currentContent(),
            providerHint,
            providerSource: this.currentProviderSource(providerHint),
        });
        await this.connect(result.room, 'owner');
        return result.joinCode;
    }

    async join(joinCode) {
        this.onStatus('Подключаюсь…');
        const result = await this.callApi('join', { joinCode });
        const expected = this.currentContent();
        if (Number(result.room?.content?.kinopoiskId) !== expected.kinopoiskId) {
            throw new Error('В этой комнате выбран другой фильм');
        }
        await this.connect(result.room, result.room.role);
        return result.room;
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
        this.presenceRef = this.rtdb.ref(`roomLive/${room.roomId}/presence/${this.currentUserId()}`);
        this.presenceRoomRef = this.rtdb.ref(`roomLive/${room.roomId}/presence`);
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
            this.roomState = nextState;
            this.hostStateRevision = Math.max(this.hostStateRevision, Number(nextState.revision || 0));
            const publishedByAnotherMember = typeof nextState.updatedBy === 'string'
                && nextState.updatedBy !== this.currentUserId();
            if (this.role === 'viewer' || (this.role === 'controller' && publishedByAnotherMember)) {
                this.syncViewerState(nextState);
            } else if (this.role === 'owner' && publishedByAnotherMember) {
                this.applyRoomState(nextState);
            }
        }, (error) => {
            this.trace('state-listener-error', { code: error?.code || null });
            this.onStatus(`Нет доступа к состоянию комнаты: ${error?.message || 'неизвестная ошибка'}`);
        });
        this.membersRef.on('value', (snapshot) => {
            this.memberState = snapshot.val() || {};
            const currentMemberRole = this.memberState[this.currentUserId()]?.role;
            if (currentMemberRole === 'owner' || currentMemberRole === 'controller' || currentMemberRole === 'viewer') {
                this.role = currentMemberRole;
            }
            this.emitRoomUpdate();
        });
        this.presenceRoomRef.on('value', (snapshot) => {
            this.presenceState = snapshot.val() || {};
            this.emitRoomUpdate();
        });
        await this.markPresence();
        if (!this.room || this.room.roomId !== room.roomId) return false;
        this.armRoomExpiry(room);
        this.onStatus('');
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
            this.cancelTimeout(this.roomExpiryTimer);
            this.roomExpiryTimer = this.scheduleTimeout(recheck, remainingMs);
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
            this.applyRoomState(state);
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
                this.trace('viewer-provider-ready', { providerHint: task.providerHint, reason });
                this.applyRoomState(this.roomState);
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

    emitRoomUpdate() {
        if (!this.room) return;
        const members = Object.entries(this.memberState).map(([uid, member]) => {
            const memberDisplayName = String(member?.displayName || '').trim();
            const presenceDisplayName = String(this.presenceState[uid]?.displayName || '').trim();
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
                online: Boolean(this.presenceState[uid]),
                isCurrentUser: uid === this.currentUserId(),
            };
        }).sort((left, right) => {
            const roleOrder = { owner: 0, controller: 1, viewer: 2 };
            const difference = roleOrder[left.role] - roleOrder[right.role];
            return difference || left.displayName.localeCompare(right.displayName);
        });
        this.onRoomUpdate({ roomId: this.room.roomId, role: this.role, members });
    }

    async markPresence() {
        if (!this.presenceRef || !this.role) return;
        const displayName = await this.currentUserDisplayName();
        const record = {
            connectedAtMs: Date.now(),
            role: this.role,
            ...(displayName ? { displayName } : {}),
        };
        try {
            const disconnect = this.presenceRef.onDisconnect?.();
            await Promise.resolve(disconnect?.remove?.());
            await this.presenceRef.set(record);
        } catch (error) {
            this.onStatus(`Не удалось обновить присутствие: ${error.message}`);
        }
    }

    disconnect(updateStatus = true, { presenceMode = 'remove' } = {}) {
        this.clearRoomExpiry();
        if (this.stateRef) this.stateRef.off();
        if (this.membersRef) this.membersRef.off();
        if (this.presenceRoomRef) this.presenceRoomRef.off();
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
        this.hostStatePatch = null;
        this.hostStateFlushQueued = false;
        this.hostStateRevision = 0;
        this.hostStateWriteChain = Promise.resolve();
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
            iframe.contentWindow.postMessage(message, '*');
            return;
        }
        const video = this.getVideo?.();
        if (!video) throw new Error('Плеер ещё загружается');
        if (message.type === 'ROOM_SYNC_COMMAND' && ROOM_SYNC_TIMELINE_ACTIONS.has(message.action)) {
            if (message.action === 'seek' && Number.isFinite(Number(message.positionMs))) {
                video.currentTime = Math.max(0, Number(message.positionMs) / 1000);
            } else if (message.action === 'play') {
                video.play?.().catch?.(() => {});
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
        if (ROOM_SYNC_OBSERVED_TELEMETRY_KINDS.has(data.kind)) {
            this.trace('telemetry-received', { kind: data.kind });
        }
        const isRemotePlaybackEffect = Date.now() <= this.ignoreRemoteTelemetryUntil;
        if (this.canControlTimeline() && !isRemotePlaybackEffect) this.publishHostTelemetry(data);
        if (this.role === 'viewer' && !isRemotePlaybackEffect
            && ROOM_SYNC_OBSERVED_TELEMETRY_KINDS.has(data.kind)) {
            clearTimeout(this.guestReapplyTimer);
            this.guestReapplyTimer = setTimeout(() => this.applyRoomState(this.roomState), 160);
        }
    }

    bindNativeVideoTelemetry() {
        this.unbindNativeVideoTelemetry();
        const video = this.getVideo?.();
        if (!video) return;
        this.nativeVideo = video;
        ['play', 'pause', 'seeking', 'seeked'].forEach((kind) => {
            const listener = () => this.handleRoomTelemetry({
                kind,
                currentTimeMs: Number(video.currentTime || 0) * 1000,
            });
            video.addEventListener(kind, listener);
            this.nativeTelemetryDisposers.push(() => video.removeEventListener(kind, listener));
        });
    }

    refreshPlayerBridge() {
        if (!this.room || !this.subscriptionId) return;
        // A provider can remount its iframe while the room remains active. The
        // subscription belongs to that iframe document, so the replacement must
        // receive the existing subscription before it can emit host telemetry.
        this.postToPlayer({ type: 'ROOM_SYNC_SUBSCRIBE', subscriptionId: this.subscriptionId });
        this.trace('player-subscribed', { reason: 'player-ready' });
        const video = this.getVideo?.();
        if (video !== this.nativeVideo) this.bindNativeVideoTelemetry();
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
        const basePositionMs = Number(data.currentTimeMs);
        if (!Number.isFinite(basePositionMs) || basePositionMs < 0) return;
        this.queueHostStatePatch({
            phase,
            basePositionMs: Math.round(basePositionMs),
            effectiveAtMs: Date.now(),
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
        this.queueHostStatePatch({
            providerHint: normalized,
            providerSource: normalizedSource,
            effectiveAtMs: Date.now(),
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
                    this.onStatus(`Ошибка синхронизации: ${error.message}`);
                }
            });
    }

    applyRoomState(state) {
        if (!state || !this.role) return;
        const basePositionMs = Number(state.basePositionMs || 0);
        const effectiveAtMs = Number(state.effectiveAtMs || Date.now());
        const targetMs = state.phase === 'playing'
            ? basePositionMs + Math.max(0, Date.now() - effectiveAtMs)
            : basePositionMs;
        this.trace('viewer-state-apply', { revision: Number(state.revision || 0), phase: state.phase });
        this.ignoreRemoteTelemetryUntil = Date.now() + 1200;
        const seekRequestId = this.makeRequestId('room-seek');
        this.postToPlayer({ type: 'ROOM_SYNC_COMMAND', requestId: seekRequestId, action: 'seek', positionMs: targetMs });
        const playbackRequestId = this.makeRequestId('room-phase');
        this.postToPlayer({
            type: 'ROOM_SYNC_COMMAND',
            requestId: playbackRequestId,
            action: state.phase === 'playing' ? 'play' : 'pause',
        });
    }
}

if (typeof window !== 'undefined') window.WatchRoomStagingController = WatchRoomStagingController;
if (typeof module !== 'undefined' && module.exports) module.exports = { WatchRoomStagingController };
