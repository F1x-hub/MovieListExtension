/** Viewer standby renders from existing channel snapshots; it never writes data. */
(function () {
    'use strict';
    class LiveStandby {
        constructor(root, translate) {
            this.root = root; this.t = translate; this.cover = '';
            const $ = id => document.getElementById(id);
            this.els = Object.fromEntries(['liveStandbyScreen', 'liveStandbyLabel', 'liveStandbyClock', 'liveStandbyZone',
                'liveStandbyCountdown', 'liveStandbyCountdownWrap', 'liveStandbyNoTime', 'liveStandbyNext',
                'liveStandbyPoster', 'liveStandbyNextName', 'liveStandbyNextTime', 'liveStandbyFullscreen',
                'liveEmptyTitle', 'liveEmptyText', 'liveStandbySchedule', 'liveStandbyScheduleTitle',
                'liveStandbyScheduleTime', 'liveStandbyScheduleName', 'liveStandbyScheduleMeta']
                .map(id => [id.replace(/^live/, ''), $(id)]));
            this.els.StandbyFullscreen.innerHTML = window.Icons?.FULLSCREEN || '';
            this.els.StandbyFullscreen.addEventListener('click', async () => {
                try {
                    if (document.fullscreenElement) await document.exitFullscreen();
                    else await this.els.StandbyScreen.requestFullscreen();
                } catch { /* Fullscreen may be unavailable in an embedded browser. */ }
            });
            this.els.StandbyPoster.addEventListener('error', () => { this.els.StandbyPoster.hidden = true; });
        }
        text(el, value) { if (el && el.textContent !== value) el.textContent = value; }
        render({ channel, position, next, nowMs, errorKeys = null }) {
            const t = this.t, e = this.els;
            const error = Boolean(errorKeys), upcoming = !error && next;
            const ended = !error && channel?.mode !== 'off' && position?.state === 'ended';
            const time = new Date(nowMs);
            this.text(e.StandbyClock, time.toLocaleTimeString(document.documentElement.lang || 'ru', { hour12: false }));
            this.text(e.StandbyZone, Intl.DateTimeFormat().resolvedOptions().timeZone);
            this.text(e.EmptyTitle, error ? t(errorKeys[0]) : upcoming ? t(ended ? 'standby_ended_title' : 'standby_gap_title') : t(ended ? 'ended_title' : 'standby_empty_title'));
            this.text(e.EmptyText, error ? t(errorKeys[1]) : upcoming ? t(ended ? 'standby_ended_text' : 'standby_gap_text') : t('standby_empty_text'));
            this.text(e.StandbyLabel, t(error ? 'standby_unavailable_label' : upcoming ? ended ? 'standby_ended_label' : 'standby_gap_label' : 'standby_empty_label'));
            e.StandbyCountdownWrap.hidden = !upcoming; e.StandbyNoTime.hidden = Boolean(upcoming);
            e.StandbyNext.hidden = !upcoming; e.StandbySchedule.hidden = !upcoming;
            this.text(e.StandbyNoTime, t(error ? 'standby_connection_hint' : 'standby_no_shows'));
            e.StandbyFullscreen.setAttribute('aria-label', t('fullscreen'));
            this.root.querySelectorAll('[data-standby-i18n]').forEach(el => this.text(el, t(el.dataset.standbyI18n)));
            if (!upcoming) return;
            const seconds = Math.max(0, Math.ceil((next.startedAtMs - nowMs) / 1000));
            this.text(e.StandbyCountdown, window.CinemaChannel.formatClock(seconds));
            const when = new Date(next.startedAtMs);
            const clock = when.toLocaleTimeString(document.documentElement.lang || 'ru', { hour: '2-digit', minute: '2-digit', hour12: false });
            const sameDay = when.getFullYear() === time.getFullYear() && when.getMonth() === time.getMonth() && when.getDate() === time.getDate();
            const date = sameDay ? '' : when.toLocaleDateString(document.documentElement.lang || 'ru', { day: 'numeric', month: 'short' });
            const label = [date, clock].filter(Boolean).join(' · ');
            this.text(e.StandbyNextTime, `${t('standby_next')} · ${label}`);
            this.text(e.StandbyNextName, next.title || t('movie_on_air'));
            this.text(e.StandbyScheduleTitle, t('standby_next_show'));
            this.text(e.StandbyScheduleTime, label);
            this.text(e.StandbyScheduleName, next.title || t('movie_on_air'));
            const duration = next[next.mode]?.durationSec;
            this.text(e.StandbyScheduleMeta, `${next.mode === 'youtube' ? 'YouTube' : t('standby_movie')}${duration ? ` · ${window.CinemaChannel.formatClock(duration)}` : ''}`);
            const cover = window.CinemaChannel.coverUrl(next);
            if (cover !== this.cover) {
                this.cover = cover; e.StandbyPoster.hidden = !cover;
                if (cover) e.StandbyPoster.src = cover;
                else e.StandbyPoster.removeAttribute('src');
            }
        }
    }
    if (typeof window !== 'undefined') window.LiveStandby = LiveStandby;
    if (typeof module !== 'undefined' && module.exports) module.exports = { LiveStandby };
})();
