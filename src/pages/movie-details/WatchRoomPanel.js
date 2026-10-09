/**
 * Watch room UI for the MovieDetails player header: create/join/invite
 * controls, the invite popover, the members popover with role changes,
 * and the provider hand-off between room members.
 *
 * Strangler step (plan 2026-10-04, 6.5): methods moved verbatim and
 * installed onto MovieDetailsManager.prototype; they still use MovieDetails
 * state through `this`. The room protocol itself lives in
 * src/shared/services/WatchRoomStagingController.js.
 *
 * Depends on MOVIE_DETAILS_TORRENT_SOURCE from TorrentSourcePanel.js.
 */

// The active or pending room of this tab. sessionStorage survives a reload and
// a same-tab navigation to the invited film, but not closing the tab.
const WATCH_ROOM_SESSION_KEY = 'movieExtensionWatchRoomSessionV1';
// An invite hand-off to another film waits this long for the player.
const WATCH_ROOM_PENDING_JOIN_TTL_MS = 30 * 60 * 1000;

class MovieDetailsWatchRoomPanelMethods {
    setWatchRoomStatus(message, { timeoutMs = 0 } = {}) {
        clearTimeout(this.watchRoomStatusTimer);
        this.watchRoomStatusTimer = null;
        if (this.elements?.watchRoomStatus) this.elements.watchRoomStatus.textContent = message || '';
        this.elements?.watchRoomControls?.classList.toggle('is-connected', Boolean(message));
        if (message && timeoutMs > 0) {
            this.watchRoomStatusTimer = setTimeout(() => {
                if (this.elements?.watchRoomStatus?.textContent === message) this.setWatchRoomStatus('');
            }, timeoutMs);
        }
    }

    // The browser blocked autoplay: a click in this tab lets the room start
    // the player, so offer one visible button instead of a silent pause.
    setWatchRoomPlaybackBlocked(blocked) {
        const button = this.elements?.resumeWatchRoomPlaybackBtn;
        if (button) button.hidden = !blocked;
        if (blocked) this.setWatchRoomStatus('Нажмите «Включить просмотр», чтобы присоединиться');
        else if (this.elements?.watchRoomStatus?.textContent === 'Нажмите «Включить просмотр», чтобы присоединиться') {
            this.setWatchRoomStatus('');
        }
    }

    // Shown ten minutes before the room closes: everyone sees the time left,
    // the owner also gets the extend button.
    setWatchRoomExpiryWarning(warning) {
        const button = this.elements?.extendWatchRoomBtn;
        if (button) button.hidden = !warning?.canExtend;
        if (!warning) return;
        const minutes = Math.max(1, Math.ceil(Number(warning.remainingMs) / 60_000));
        this.setWatchRoomStatus(warning.canExtend
            ? `Комната закроется через ${minutes} мин. — её можно продлить`
            : `Комната закроется через ${minutes} мин.`);
    }

    async extendWatchRoom() {
        const button = this.elements?.extendWatchRoomBtn;
        if (button) button.disabled = true;
        try {
            await this.watchRoomController?.extendRoom();
        } catch (error) {
            this.setWatchRoomStatus(error.message || 'Не удалось продлить комнату');
        } finally {
            if (button) button.disabled = false;
        }
    }

    handleWatchRoomAction(event) {
        const action = event.target?.closest?.('[data-watch-room-action]')?.dataset?.watchRoomAction;
        if (!action) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        console.info('[WatchRoomUITrace] action-dispatched', { action });
        if (action === 'create') {
            void this.createWatchRoom();
        } else if (action === 'join') {
            void this.joinWatchRoom();
        } else if (action === 'copy-code') {
            this.openWatchRoomInvite('share');
        } else if (action === 'toggle-members') {
            this.toggleWatchRoomMembers();
        } else if (action === 'close-invite') {
            this.closeWatchRoomInvite({ restoreFocus: true });
        } else if (action === 'leave') {
            void this.leaveWatchRoom();
        } else if (action === 'resume-playback') {
            this.watchRoomController?.resumeBlockedPlayback();
        } else if (action === 'extend') {
            void this.extendWatchRoom();
        }
    }

    refreshWatchRoomControls() {
        const connected = Boolean(this.watchRoomController?.room);
        const isOwner = this.watchRoomController?.role === 'owner';
        if (!connected) this.watchRoomJoinCode = null;
        if ((connected && this.watchRoomInviteMode === 'join') || (!connected && this.watchRoomInviteMode === 'share')) {
            this.closeWatchRoomInvite?.();
        }
        if (this.elements.createWatchRoomBtn) {
            this.elements.createWatchRoomBtn.hidden = connected;
            if (!connected) this.elements.createWatchRoomBtn.disabled = false;
        }
        if (this.elements.joinWatchRoomBtn) {
            this.elements.joinWatchRoomBtn.hidden = connected;
            if (!connected) this.elements.joinWatchRoomBtn.disabled = false;
        }
        if (this.elements.copyWatchRoomCodeBtn) {
            this.elements.copyWatchRoomCodeBtn.hidden = !connected || !isOwner || !this.watchRoomJoinCode;
        }
        if (this.elements.watchRoomMembersBtn) this.elements.watchRoomMembersBtn.hidden = !connected;
        if (!connected && this.elements.extendWatchRoomBtn) this.elements.extendWatchRoomBtn.hidden = true;
        if (this.elements.leaveWatchRoomBtn) {
            this.elements.leaveWatchRoomBtn.hidden = !connected;
            this.elements.leaveWatchRoomBtn.title = isOwner ? 'Завершить комнату для всех' : 'Выйти из комнаты';
            if (this.elements.leaveWatchRoomLabel) {
                this.elements.leaveWatchRoomLabel.textContent = isOwner ? 'Завершить' : 'Выйти';
            }
        }
        if (!connected && this.elements.watchRoomMembersPopover) {
            this.elements.watchRoomMembersPopover.hidden = true;
            this.elements.watchRoomMembersBtn?.setAttribute('aria-expanded', 'false');
        }
    }

    renderWatchRoomMembers({ roomId, members = [] } = {}) {
        // The controller reports `roomId: null` when the room ended, expired
        // or was left; there is nothing to return to after a reload.
        if (roomId === null) this.clearWatchRoomSession();
        // Keep the saved room alive for as long as the room itself after an
        // extension, so a later reload still rejoins it.
        const expiresAtMs = Number(this.watchRoomController?.room?.expiresAtMs);
        if (roomId && Number.isFinite(expiresAtMs)) this.updateWatchRoomSessionExpiry?.(expiresAtMs);
        const safeMembers = Array.isArray(members) ? members : [];
        const canManageRoles = this.watchRoomController?.role === 'owner';
        const roleLabels = {
            owner: 'создатель',
            controller: 'управляющий',
            viewer: 'зритель',
        };
        if (this.elements.watchRoomParticipantCount) {
            this.elements.watchRoomParticipantCount.textContent = String(safeMembers.length);
        }
        if (this.elements.watchRoomMembersList) {
            this.elements.watchRoomMembersList.replaceChildren(...safeMembers.map((member) => {
                const item = document.createElement('li');
                item.className = `watch-room-member${member.online ? ' watch-room-member--online' : ''}`;
                const presence = document.createElement('span');
                presence.className = 'watch-room-member__presence';
                presence.setAttribute('aria-hidden', 'true');
                const name = document.createElement('span');
                name.className = 'watch-room-member__name';
                name.textContent = `${member.displayName}${member.isCurrentUser ? ' (вы)' : ''}`;
                const role = document.createElement('span');
                role.className = 'watch-room-member__role';
                role.textContent = roleLabels[member.role] || roleLabels.viewer;
                item.append(presence, name, role);
                if (canManageRoles && !member.isCurrentUser && member.role !== 'owner') {
                    const roleAction = document.createElement('button');
                    const nextRole = member.role === 'controller' ? 'viewer' : 'controller';
                    roleAction.type = 'button';
                    roleAction.className = 'watch-room-member__role-action';
                    roleAction.textContent = nextRole === 'controller' ? 'Разрешить управление' : 'Сделать зрителем';
                    roleAction.addEventListener('click', async () => {
                        roleAction.disabled = true;
                        this.setWatchRoomStatus('Меняю роль…');
                        try {
                            await this.setWatchRoomMemberRole(member.uid, nextRole);
                            this.setWatchRoomStatus('');
                        } catch (error) {
                            this.setWatchRoomStatus(error.message || 'Не удалось изменить роль');
                        } finally {
                            roleAction.disabled = false;
                        }
                    });
                    item.append(roleAction);
                }
                return item;
            }));
        }
        this.refreshWatchRoomControls();
    }

    async setWatchRoomMemberRole(targetUid, role) {
        if (!this.watchRoomController) throw new Error('Комната недоступна');
        await this.watchRoomController.setMemberRole(targetUid, role);
    }

    toggleWatchRoomMembers() {
        const popover = this.elements?.watchRoomMembersPopover;
        const button = this.elements?.watchRoomMembersBtn;
        if (!popover || !button || button.hidden) return;
        if (popover.hidden) this.closeWatchRoomInvite();
        popover.hidden = !popover.hidden;
        button.setAttribute('aria-expanded', String(!popover.hidden));
    }

    async copyWatchRoomCode() {
        if (!this.watchRoomJoinCode) return;
        try {
            await navigator.clipboard.writeText(this.watchRoomJoinCode);
            this.setWatchRoomStatus('Код приглашения скопирован', { timeoutMs: 2500 });
        } catch {
            // Clipboard access can be denied; show the code for manual copying.
            this.openWatchRoomInvite('share');
        }
    }

    // One popover serves both directions: entering a received code ("join")
    // and showing the owner's code ("share").
    openWatchRoomInvite(mode) {
        const els = this.elements || {};
        const popover = els.watchRoomInvitePopover;
        const input = els.watchRoomInviteInput;
        if (!popover || !input) return;
        if (mode === 'share' && !this.watchRoomJoinCode) return;

        const isJoin = mode === 'join';
        this.watchRoomInviteMode = mode;
        this.watchRoomInviteTrigger = isJoin ? els.joinWatchRoomBtn : els.copyWatchRoomCodeBtn;
        if (els.watchRoomMembersPopover) els.watchRoomMembersPopover.hidden = true;
        els.watchRoomMembersBtn?.setAttribute('aria-expanded', 'false');

        els.watchRoomInviteTitle.textContent = isJoin ? 'Войти в комнату' : 'Код приглашения';
        els.watchRoomInviteHint.textContent = isJoin
            ? 'Вставьте код от создателя комнаты — нужный фильм откроется сам.'
            : 'Передайте этот код участникам. Фильм в нём уже указан, а после перезагрузки страницы вы вернётесь в комнату автоматически.';
        input.readOnly = !isJoin;
        input.value = isJoin ? '' : this.watchRoomJoinCode;
        input.placeholder = isJoin ? 'Код приглашения' : '';
        els.watchRoomInviteSubmitBtn.textContent = isJoin ? 'Войти' : 'Копировать';
        els.watchRoomInviteSubmitBtn.disabled = false;
        els.watchRoomInviteCancelBtn.textContent = isJoin ? 'Отмена' : 'Готово';
        this.setWatchRoomInviteError('');

        popover.hidden = false;
        els.joinWatchRoomBtn?.setAttribute('aria-expanded', String(isJoin));
        els.copyWatchRoomCodeBtn?.setAttribute('aria-expanded', String(!isJoin));
        input.focus();
        if (!isJoin) input.select();
    }

    closeWatchRoomInvite({ restoreFocus = false } = {}) {
        const els = this.elements || {};
        if (!els.watchRoomInvitePopover || els.watchRoomInvitePopover.hidden) return false;
        els.watchRoomInvitePopover.hidden = true;
        els.joinWatchRoomBtn?.setAttribute('aria-expanded', 'false');
        els.copyWatchRoomCodeBtn?.setAttribute('aria-expanded', 'false');
        const trigger = this.watchRoomInviteTrigger;
        this.watchRoomInviteMode = null;
        this.watchRoomInviteTrigger = null;
        if (restoreFocus && trigger && !trigger.hidden) trigger.focus();
        return true;
    }

    setWatchRoomInviteError(message) {
        const error = this.elements?.watchRoomInviteError;
        if (!error) return;
        error.textContent = message || '';
        error.hidden = !message;
        this.elements.watchRoomInviteInput?.setAttribute('aria-invalid', message ? 'true' : 'false');
    }

    async submitWatchRoomInvite() {
        const els = this.elements || {};
        const input = els.watchRoomInviteInput;
        if (!input || els.watchRoomInvitePopover?.hidden) return;

        if (this.watchRoomInviteMode === 'share') {
            try {
                await navigator.clipboard.writeText(this.watchRoomJoinCode);
                this.closeWatchRoomInvite({ restoreFocus: true });
                this.setWatchRoomStatus('Код приглашения скопирован', { timeoutMs: 2500 });
            } catch {
                input.select();
                this.setWatchRoomInviteError('Не удалось скопировать автоматически. Скопируйте код вручную (Ctrl+C).');
            }
            return;
        }

        const joinCode = input.value.trim();
        if (!joinCode) {
            this.setWatchRoomInviteError('Введите код приглашения.');
            input.focus();
            return;
        }
        if (!this.watchRoomController) {
            this.setWatchRoomInviteError('Комнаты недоступны в этой сборке.');
            return;
        }
        this.setWatchRoomInviteError('');
        els.watchRoomInviteSubmitBtn.disabled = true;
        if (els.joinWatchRoomBtn) els.joinWatchRoomBtn.disabled = true;
        try {
            const room = await this.watchRoomController.join(joinCode);
            this.watchRoomJoinCode = room?.role === 'owner' ? joinCode : null;
            this.saveWatchRoomSession(joinCode, room);
            this.closeWatchRoomInvite();
            this.refreshWatchRoomControls();
        } catch (error) {
            if (error?.code === 'WRONG_MOVIE' && error.kinopoiskId) {
                this.closeWatchRoomInvite();
                await this.offerWatchRoomMovieHandOff(joinCode, error.kinopoiskId);
                return;
            }
            this.setWatchRoomInviteError(error.message || 'Не удалось войти в комнату.');
            input.focus();
            input.select();
        } finally {
            els.watchRoomInviteSubmitBtn.disabled = false;
            if (els.joinWatchRoomBtn) els.joinWatchRoomBtn.disabled = false;
        }
    }

    getWatchRoomProviderId() {
        const selected = this.activeSourceValue
            || this.elements?.sourceButtonsContainer?.querySelector('.source-btn.active')?.getAttribute('data-value');
        if (selected === MOVIE_DETAILS_TORRENT_SOURCE) return 'kinogo';
        return selected?.startsWith('parser:') ? selected.slice('parser:'.length) : 'kinogo';
    }

    getWatchRoomPlayerBridge() {
        return this.getWatchRoomProviderId() === 'rutube' ? this.rutubeWatchRoomBridge : null;
    }

    getWatchRoomProviderSource() {
        if (this.getWatchRoomProviderId() !== 'rutube') return null;
        const sources = this.playerRegistry?.rutube?.sources || this.currentEpisodes || this.currentSources || [];
        const source = sources.find((candidate) => {
            const videoId = candidate?.metadata?.rutubeVideoId;
            return typeof videoId === 'string' && /^[a-z0-9_-]{8,80}$/i.test(videoId);
        });
        const videoId = source?.metadata?.rutubeVideoId;
        return videoId ? { version: 1, providerId: 'rutube', videoId } : null;
    }

    async changeWatchRoomProvider(providerId, providerSource = null) {
        const normalized = String(providerId || '').trim().toLowerCase();
        if (!/^[a-z0-9_-]{1,40}$/.test(normalized)) return false;
        if (normalized === 'rutube' && !/^[a-z0-9_-]{8,80}$/i.test(String(providerSource?.videoId || ''))) {
            this.setWatchRoomStatus('Создатель не передал корректный ролик Rutube');
            return false;
        }
        const sourceValue = `parser:${normalized}`;
        const sourceButton = this.elements?.sourceButtonsContainer?.querySelector(`[data-value="${sourceValue}"]`);
        if (!sourceButton || !this.parserRegistry?.get(normalized)) {
            this.setWatchRoomStatus('Источник создателя недоступен в вашем регионе');
            return false;
        }
        return this.changeVideoSource(sourceValue, { fromWatchRoom: true, providerSource });
    }

    // Opens the room's episode through the same canonical path as the
    // in-player episode navigation, so every provider applies it its own way.
    async changeWatchRoomSelection(selection) {
        const movie = this.selectedMovie;
        const seasonNumber = Number(selection?.seasonNumber);
        const episodeNumber = Number(selection?.episodeNumber);
        if (!movie || !Number.isInteger(seasonNumber) || !Number.isInteger(episodeNumber)) return false;
        const isSeries = Boolean(movie.isSeries || (movie.type && ['tv-series', 'mini-series', 'animated-series', 'tv'].includes(movie.type)));
        if (!isSeries) return false;
        await this.playSelection({
            kinopoiskId: movie.kinopoiskId,
            tmdbId: movie.tmdbId || null,
            imdbId: movie.externalId?.imdb || movie.imdbId || null,
            title: movie.nameRu || movie.name || '',
            mediaType: movie.type || 'tv-series',
            seasonNumber,
            episodeNumber,
            episodeTitle: null,
            source: 'PLAYER_NAVIGATION',
            initialTimestamp: 0,
        });
        return true;
    }

    async createWatchRoom() {
        if (!this.watchRoomController) {
            this.setWatchRoomStatus('Комнаты недоступны в этой сборке');
            return;
        }
        try {
            this.elements.createWatchRoomBtn.disabled = true;
            const joinCode = await this.watchRoomController.create();
            this.watchRoomJoinCode = joinCode;
            this.saveWatchRoomSession(joinCode, this.watchRoomController.room);
            this.refreshWatchRoomControls();
            await this.copyWatchRoomCode();
        } catch (error) {
            this.setWatchRoomStatus(error.message || 'Не удалось создать комнату');
        } finally {
            this.elements.createWatchRoomBtn.disabled = false;
        }
    }

    async leaveWatchRoom() {
        const controller = this.watchRoomController;
        if (!controller?.room) return;
        const isOwner = controller.role === 'owner';
        if (isOwner && window.ConfirmDialog) {
            const confirmed = await window.ConfirmDialog.confirm({
                title: 'Завершить комнату?',
                message: 'Просмотр закончится для всех участников, код приглашения перестанет работать.',
                confirmLabel: 'Завершить',
                danger: true,
            });
            if (!confirmed) return;
        }
        const button = this.elements.leaveWatchRoomBtn;
        if (button) button.disabled = true;
        try {
            await controller.leaveOrEnd();
            this.clearWatchRoomSession();
            this.watchRoomJoinCode = null;
            this.refreshWatchRoomControls();
            this.setWatchRoomStatus(isOwner ? 'Комната завершена' : 'Вы вышли из комнаты', { timeoutMs: 3000 });
        } catch (error) {
            this.setWatchRoomStatus(error.message || 'Не удалось выйти из комнаты');
        } finally {
            if (button) button.disabled = false;
        }
    }

    readWatchRoomSession() {
        let session;
        try {
            session = JSON.parse(window.sessionStorage?.getItem(WATCH_ROOM_SESSION_KEY) || 'null');
        } catch {
            session = null;
        }
        const kinopoiskId = Number(session?.kinopoiskId);
        const expiresAtMs = Number(session?.expiresAtMs);
        if (typeof session?.invite !== 'string' || !Number.isInteger(kinopoiskId) || kinopoiskId <= 0
            || !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
            if (session) this.clearWatchRoomSession();
            return null;
        }
        return { invite: session.invite, kinopoiskId, expiresAtMs };
    }

    saveWatchRoomSession(invite, room = null, { kinopoiskId = this.selectedMovie?.kinopoiskId } = {}) {
        const roomExpiry = Number(room?.expiresAtMs);
        const session = {
            invite: String(invite || ''),
            kinopoiskId: Number(kinopoiskId),
            expiresAtMs: Number.isFinite(roomExpiry) ? roomExpiry : Date.now() + WATCH_ROOM_PENDING_JOIN_TTL_MS,
        };
        if (!session.invite || !Number.isInteger(session.kinopoiskId) || session.kinopoiskId <= 0) return;
        try {
            window.sessionStorage?.setItem(WATCH_ROOM_SESSION_KEY, JSON.stringify(session));
        } catch {
            // Storage can be unavailable; the room still works until a reload.
        }
    }

    updateWatchRoomSessionExpiry(expiresAtMs) {
        const session = this.readWatchRoomSession();
        if (!session || session.expiresAtMs >= expiresAtMs) return;
        this.saveWatchRoomSession(session.invite, { expiresAtMs }, { kinopoiskId: session.kinopoiskId });
    }

    clearWatchRoomSession() {
        try {
            window.sessionStorage?.removeItem(WATCH_ROOM_SESSION_KEY);
        } catch {
            // Nothing to clear when storage is unavailable.
        }
    }

    // The invite belongs to another film: remember it for this tab and open
    // that film's player, where the room is joined automatically.
    async offerWatchRoomMovieHandOff(invite, kinopoiskId) {
        const confirmed = window.ConfirmDialog
            ? await window.ConfirmDialog.confirm({
                title: 'Приглашение в другой фильм',
                message: 'Комната смотрит другой фильм. Открыть его и войти в комнату?',
                confirmLabel: 'Открыть фильм',
            })
            : true;
        if (!confirmed) return;
        this.saveWatchRoomSession(invite, null, { kinopoiskId });
        const url = new URL(window.location.href);
        url.search = new URLSearchParams({ movieId: String(kinopoiskId), autoplay: 'true' }).toString();
        url.hash = '';
        window.location.href = url.toString();
    }

    // Rejoins this tab's room once a player is ready: after a reload, or after
    // opening the film an invite pointed to. Server join is idempotent for an
    // existing member, so this neither uses an invite place nor changes roles.
    async resumeWatchRoomIfPending() {
        const controller = this.watchRoomController;
        if (!controller || controller.room || this.watchRoomResumeInFlight) return false;
        const session = this.readWatchRoomSession();
        if (!session || session.kinopoiskId !== Number(this.selectedMovie?.kinopoiskId)) return false;
        this.watchRoomResumeInFlight = true;
        this.setWatchRoomStatus('Возвращаюсь в комнату…');
        try {
            const room = await controller.join(session.invite);
            this.watchRoomJoinCode = room?.role === 'owner' ? session.invite : null;
            this.saveWatchRoomSession(session.invite, room);
            this.refreshWatchRoomControls();
            this.setWatchRoomStatus('');
            return true;
        } catch (error) {
            const status = Number(error?.status);
            if (status >= 400 && status < 500) {
                this.clearWatchRoomSession();
                this.setWatchRoomStatus(`Не удалось вернуться в комнату: ${error.message}`);
            } else {
                // The player or the network is not ready yet; the next ready
                // player retries.
                this.setWatchRoomStatus('');
            }
            return false;
        } finally {
            this.watchRoomResumeInFlight = false;
        }
    }

    async joinWatchRoom() {
        if (!this.watchRoomController) {
            this.setWatchRoomStatus('Комнаты недоступны в этой сборке');
            return;
        }
        if (this.watchRoomInviteMode === 'join') {
            this.closeWatchRoomInvite({ restoreFocus: true });
            return;
        }
        this.openWatchRoomInvite('join');
    }
}

function installMovieDetailsWatchRoomPanel(targetClass) {
    const source = MovieDetailsWatchRoomPanelMethods.prototype;
    Object.getOwnPropertyNames(source).forEach(name => {
        if (name === 'constructor') return;
        if (Object.prototype.hasOwnProperty.call(targetClass.prototype, name)) {
            throw new Error(`MovieDetails already defines ${name}`);
        }
        Object.defineProperty(targetClass.prototype, name, Object.getOwnPropertyDescriptor(source, name));
    });
    return targetClass;
}

if (typeof window !== 'undefined') {
    window.MovieDetailsWatchRoomPanelMethods = MovieDetailsWatchRoomPanelMethods;
    window.installMovieDetailsWatchRoomPanel = installMovieDetailsWatchRoomPanel;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MovieDetailsWatchRoomPanelMethods, installMovieDetailsWatchRoomPanel };
}
