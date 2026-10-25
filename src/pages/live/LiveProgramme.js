/** Public, read-only programme built from the live page's existing snapshots. */
(function () {
    'use strict';

    const identity = item => item?.docPath || item?.id;
    const activePosition = position => ['live', 'paused'].includes(position?.state);

    function programmeModel(items, channel, position, nowMs, cinema) {
        const today = new Date(nowMs);
        const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
        const dayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime();
        const active = activePosition(position) && channel?.mode !== 'off' ? channel : null;
        const sources = [...items];
        if (active && !sources.some(item => identity(item) === identity(active))) sources.push(active);
        const next = cinema.nextScheduled(items, nowMs);
        const rows = sources.filter(item => item?.mode !== 'off' && Number.isFinite(item?.startedAtMs))
            .map(item => {
                const bounds = cinema.getScheduleBounds(item);
                const current = active && identity(item) === identity(active);
                const ended = bounds.endMs <= nowMs || (identity(item) === identity(channel) && position?.state === 'ended');
                const status = current ? 'current' : ended ? 'finished' : item.startedAtMs > nowMs
                    ? identity(item) === identity(next) ? 'next' : 'later' : 'not_on_air';
                const progress = current && Number.isFinite(bounds.endMs)
                    ? Math.min(100, Math.max(0, Math.floor((nowMs - bounds.startMs) / (bounds.endMs - bounds.startMs) * 100))) : null;
                return { item, ...bounds, status, progress };
            })
            .filter(row => row.startMs < dayEnd && row.endMs > dayStart)
            .sort((a, b) => a.startMs - b.startMs || String(identity(a.item)).localeCompare(String(identity(b.item))));
        return { rows, next, active, dayStart, dayEnd };
    }

    class LiveProgramme {
        constructor(root, translate) {
            this.root = root;
            this.t = translate;
            this.open = false;
            this.filter = 'all';
            this.signature = '';
            this.snapshot = null;
            const $ = name => root.querySelector(`#liveProgramme${name}`);
            this.els = Object.fromEntries(['Next', 'Eyebrow', 'Time', 'Poster', 'Name', 'Meta', 'Wait', 'Toggle', 'ToggleText',
                'Panel', 'Title', 'Date', 'Filters', 'All', 'Upcoming', 'List', 'Empty', 'EmptyTitle', 'EmptyText', 'Notice',
                'Footnote', 'Collapse'].map(name => [name, $(name)]));
            this.header = document.getElementById('liveProgrammeButton');
            root.querySelectorAll('[data-programme-icon]').forEach(el => {
                el.innerHTML = window.Icons?.[el.dataset.programmeIcon] || '';
            });
            this.toggle = () => this.setOpen(!this.open);
            this.show = () => { this.setOpen(true); root.scrollIntoView({ block: 'start', behavior: 'auto' }); };
            this.collapse = () => { this.setOpen(false); this.els.Toggle.focus({ preventScroll: true }); };
            this.chooseFilter = event => {
                const button = event.target.closest('[data-programme-filter]');
                if (!button) return;
                this.filter = button.dataset.programmeFilter;
                if (this.snapshot) this.render(this.snapshot);
            };
            this.imageError = () => { this.els.Poster.hidden = true; };
            this.els.Toggle.addEventListener('click', this.toggle);
            this.header?.addEventListener('click', this.show);
            this.els.Collapse.addEventListener('click', this.collapse);
            this.els.Filters.addEventListener('click', this.chooseFilter);
            this.els.Poster.addEventListener('error', this.imageError);
        }

        text(el, value) { if (el.textContent !== value) el.textContent = value; }
        get locale() { return document.documentElement.lang || 'ru'; }
        time(ms) { return new Date(ms).toLocaleTimeString(this.locale, { hour: '2-digit', minute: '2-digit', hour12: false }); }
        date(ms) { return new Date(ms).toLocaleDateString(this.locale, { day: 'numeric', month: 'short' }); }
        relativeTime(ms, dayStart, dayEnd) {
            return ms < dayStart || ms >= dayEnd ? `${this.date(ms)} · ${this.time(ms)}` : this.time(ms);
        }
        meta(item) {
            const media = item[item.mode];
            const episode = media?.mediaType === 'tv-series';
            return [episode ? `S${String(media.seasonNumber).padStart(2, '0')}E${String(media.episodeNumber).padStart(2, '0')}`
                : item.mode === 'youtube' ? 'YouTube' : this.t('standby_movie'),
                episode ? media.episodeTitle : '',
                media?.live ? this.t('programme_stream') : media?.durationSec ? window.CinemaChannel.formatClock(media.durationSec) : '']
                .filter(Boolean).join(' · ');
        }
        setOpen(open) {
            this.open = open;
            this.root.classList.toggle('is-open', open);
            this.els.Panel.hidden = !open;
            this.els.Toggle.setAttribute('aria-expanded', String(open));
            this.header?.setAttribute('aria-expanded', String(open));
            this.text(this.els.ToggleText, this.t(open ? 'programme_collapse' : 'programme_today'));
        }
        render(snapshot) {
            this.snapshot = snapshot;
            const { items = [], channel = null, position = null, nowMs, ready = false, error = false } = snapshot;
            const cinema = window.CinemaChannel, e = this.els, t = this.t;
            if (!this.navObserver && window.ResizeObserver) {
                const nav = document.querySelector('.nav-header');
                if (nav) {
                    this.navObserver = new ResizeObserver(() => {
                        this.root.style.setProperty('--live-programme-top', `${Math.ceil(nav.getBoundingClientRect().height) + 12}px`);
                    });
                    this.navObserver.observe(nav);
                }
            }
            this.root.setAttribute('aria-label', t('programme_label'));
            e.Filters.setAttribute('aria-label', t('programme_filters'));
            const model = programmeModel(items, channel, position, nowMs, cinema);
            const next = ready ? model.next : null;
            this.root.hidden = false;
            this.text(e.Eyebrow, t('standby_next'));
            this.text(e.Time, next ? this.relativeTime(next.startedAtMs, model.dayStart, model.dayEnd) : '—');
            this.text(e.Name, next ? next.title || t('movie_on_air') : !ready ? t(error ? 'programme_unavailable' : 'programme_loading')
                : model.active ? t('programme_last') : t('programme_no_next'));
            this.text(e.Meta, next ? this.meta(next) : !ready ? t(error ? 'programme_error_text' : 'programme_loading_text')
                : model.rows.length ? t('programme_history_hint') : t('programme_empty_text'));
            this.text(e.Wait, next ? t('programme_in', { time: cinema.formatClock(Math.max(0, Math.ceil((next.startedAtMs - nowMs) / 1000))) }) : '');
            e.Wait.hidden = !next;
            const cover = next ? cinema.coverUrl(next) : '';
            if (cover !== this.cover) {
                this.cover = cover;
                e.Poster.hidden = !cover;
                if (cover) e.Poster.src = cover;
                else e.Poster.removeAttribute('src');
            }
            this.root.classList.toggle('has-next-poster', Boolean(cover));
            if (this.header) {
                this.text(this.header.querySelector('span'), t('programme_full'));
                this.header.hidden = false;
            }
            this.text(e.Title, t('programme_today'));
            this.text(e.Date, `${new Date(nowMs).toLocaleDateString(this.locale, { day: 'numeric', month: 'long', weekday: 'long' })} · ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
            this.text(e.Notice, t('programme_stale'));
            e.Notice.hidden = !error || !ready;
            this.text(e.Footnote, t('programme_footnote'));
            this.text(e.Collapse.querySelector('span'), t('programme_collapse'));
            const upcoming = model.rows.filter(row => ['current', 'next', 'later'].includes(row.status));
            this.text(e.All, t('programme_all', { count: model.rows.length }));
            this.text(e.Upcoming, t('programme_upcoming', { count: upcoming.length }));
            e.All.setAttribute('aria-pressed', String(this.filter === 'all'));
            e.Upcoming.setAttribute('aria-pressed', String(this.filter === 'upcoming'));
            const rows = this.filter === 'all' ? model.rows : upcoming;
            const signature = JSON.stringify([this.locale, this.filter, ready, error, model.dayStart,
                rows.map(row => [identity(row.item), row.item.title, this.meta(row.item), cinema.coverUrl(row.item), row.startMs, row.endMs, row.status, row.progress])]);
            if (signature !== this.signature) {
                this.signature = signature;
                const nodes = [];
                rows.forEach((row, index) => {
                    const previous = rows[index - 1];
                    if (previous && row.startMs > previous.endMs) {
                        const gap = document.createElement('li');
                        gap.className = 'live-programme__break';
                        gap.textContent = t('programme_break', { from: this.time(previous.endMs), to: this.time(row.startMs) });
                        nodes.push(gap);
                    }
                    nodes.push(this.row(row, model));
                });
                e.List.replaceChildren(...nodes);
            }
            e.List.hidden = !rows.length;
            e.Empty.hidden = rows.length > 0;
            this.text(e.EmptyTitle, t(!ready ? error ? 'programme_unavailable' : 'programme_loading'
                : model.rows.length ? 'programme_no_upcoming' : 'programme_empty'));
            this.text(e.EmptyText, t(!ready ? error ? 'programme_error_text' : 'programme_loading_text'
                : model.rows.length ? 'programme_all_hint' : 'programme_empty_text'));
            this.setOpen(this.open);
        }
        row(row, model) {
            const { item, startMs, endMs, status, progress } = row;
            const li = document.createElement('li');
            li.className = `live-programme__show is-${status}`;
            li.dataset.programmeShow = identity(item);
            if (status === 'current') li.setAttribute('aria-current', 'true');
            const times = document.createElement('div'); times.className = 'live-programme__times';
            const start = document.createElement('time'); start.dateTime = new Date(startMs).toISOString();
            start.textContent = this.relativeTime(startMs, model.dayStart, model.dayEnd);
            const end = document.createElement('small');
            end.textContent = Number.isFinite(endMs) ? this.t('programme_until', { time: this.relativeTime(endMs, model.dayStart, model.dayEnd) }) : this.t('programme_stream');
            times.append(start, end);
            const artwork = document.createElement('div'); artwork.className = 'live-programme__artwork';
            const cover = window.CinemaChannel.coverUrl(item);
            if (cover) {
                const poster = document.createElement('img'); poster.src = cover; poster.alt = ''; poster.loading = 'lazy';
                poster.addEventListener('error', () => { poster.hidden = true; }, { once: true });
                artwork.append(poster);
            }
            const copy = document.createElement('div'); copy.className = 'live-programme__copy';
            const title = document.createElement('h3'); title.textContent = item.title || this.t('movie_on_air');
            const meta = document.createElement('p'); meta.textContent = this.meta(item); copy.append(title, meta);
            if (progress !== null) {
                const bar = document.createElement('div'); bar.className = 'live-programme__progress'; bar.setAttribute('aria-hidden', 'true');
                const fill = document.createElement('span'); fill.style.width = `${progress}%`; bar.append(fill); copy.append(bar);
            }
            const badge = document.createElement('span'); badge.className = 'live-programme__status';
            badge.textContent = this.t(`programme_${status}`);
            li.append(times, artwork, copy, badge);
            return li;
        }
        destroy() {
            this.navObserver?.disconnect();
            this.els.Toggle.removeEventListener('click', this.toggle);
            this.header?.removeEventListener('click', this.show);
            this.els.Collapse.removeEventListener('click', this.collapse);
            this.els.Filters.removeEventListener('click', this.chooseFilter);
            this.els.Poster.removeEventListener('error', this.imageError);
        }
    }
    if (typeof window !== 'undefined') window.LiveProgramme = LiveProgramme;
    if (typeof module !== 'undefined' && module.exports) module.exports = { LiveProgramme, programmeModel };
})();
