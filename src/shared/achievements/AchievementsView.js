/**
 * The achievements tab of the profile: points and overall progress, filters,
 * every achievement grouped by category, and a dialog that pages through all
 * tiers of one achievement with its unlock date and the share of users who
 * reached that tier.
 *
 * Progress to the next tier is known only for the signed-in owner (it is
 * recomputed here); other users see the tiers stored on their user document.
 */
import { ACHIEVEMENTS, ACHIEVEMENTS_BY_ID, CATEGORIES } from './AchievementCatalog.js';
import { frameChoices, frameLevel, inSeason, rankFor, totalPoints } from './AchievementEngine.js';
import { renderAvatarFrame, renderBadge } from './AchievementBadge.js';
import { AchievementService } from './AchievementService.js';
import { CatPeek } from './CatPeek.js';
import { CAT_FRAME, TRAIL_ID, TRAIL_STEPS, catFrameUnlocked, trailSteps } from './catTrail.js';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const ELEMENT_IDS = ['achFramePrev', 'achFrameNext', 'achFrameName', 'achRankFrame', 'achRankName', 'achRankNext', 'achRankBar', 'achEarned', 'achTiers', 'achTiersBar', 'achFilters', 'achNote', 'achSections', 'achLoader',
    'achMessage', 'achModal', 'achClose', 'achPrev', 'achNext', 'achDialogTags', 'achDialogBadge', 'achDialogTitle',
    'achDialogCondition', 'achDialogLevel', 'achDialogText', 'achDialogProgress', 'achDialogBar'];
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class AchievementsView {
    /**
     * @param {Object} options
     * @param {Object} options.i18n
     * @param {Object} options.db - Firestore (compat)
     * @param {Object} options.profileService
     * @param {Function} [options.onSynced] - receives {stored, points} after the owner's recompute
     */
    constructor({ i18n, db, profileService, onSynced = null, onFrameChange = null }) {
        this.i18n = i18n;
        this.db = db;
        this.service = new AchievementService({ db, profileService });
        this.onSynced = onSynced;
        this.onFrameChange = onFrameChange;
        this.filter = 'all';
        this.stored = {};
        this.results = null;
        this.stats = null;
        this.isOwn = false;
        this.loadedUid = null;
        // The locked cat frame is looked at in the picker without being chosen.
        this.peeking = false;
        this.dialog = null;
        this.el = Object.fromEntries(ELEMENT_IDS.map(id => [id, document.getElementById(id)]));
        this.bindEvents();
    }

    t(key, params = {}) {
        let text = this.i18n.get(`achievements.${key}`);
        Object.entries(params).forEach(([name, value]) => { text = text.replaceAll(`{${name}}`, String(value)); });
        return text;
    }

    item(id, field, params) {
        return this.t(`items.${id}.${field}`, params);
    }

    get locale() {
        return this.i18n.currentLocale === 'ru' ? 'ru-RU' : 'en-US';
    }

    /** Forget the shown profile (another user was opened). */
    reset() {
        this.loadedUid = null;
        this.results = null;
        this.stored = {};
        this.peeking = false;
        this.closeDialog();
    }

    /**
     * Shows a profile's achievements. The owner's progress is recomputed once
     * per profile load; switching tabs back and forth does not repeat reads.
     */
    async show({ uid, isOwn, profile }) {
        if (!uid || !profile) return;
        this.isOwn = Boolean(isOwn);
        this.profile = profile;
        if (this.loadedUid === uid) {
            this.render();
            return;
        }
        this.loadedUid = uid;
        this.results = null;
        this.stored = profile.achievements && typeof profile.achievements === 'object' ? profile.achievements : {};
        this.el.achNote.hidden = this.isOwn;
        this.el.achNote.textContent = this.isOwn ? '' : this.t('other_note');
        this.render();
        this.loadStats().then(() => this.loadedUid === uid && this.render());
        if (!this.isOwn) return;

        try {
            const hadRecord = Object.keys(this.stored).length > 0;
            this.syncing = this.service.sync(uid, profile);
            const synced = await this.syncing;
            if (this.loadedUid !== uid) return;
            this.stored = synced.stored;
            this.results = Object.fromEntries(synced.results.map(result => [result.id, result]));
            this.render();
            this.onSynced?.({ stored: synced.stored, points: synced.points });
            this.announce(synced.unlocked, hadRecord);
            if (synced.trailStep && typeof Utils !== 'undefined') Utils.showToast(this.t(`cat.toast_${synced.trailStep}`), 'info');
        } catch (error) {
            console.warn('[Achievements] Recompute failed:', error);
        }
    }

    /** Share of users per tier, maintained by the aggregateAchievementStats function. */
    async loadStats() {
        if (this.stats) return;
        try {
            const snapshot = await this.db.collection('achievementStats').doc('global').get();
            this.stats = snapshot.exists ? snapshot.data() : { participants: 0, tiers: {} };
        } catch (error) {
            console.warn('[Achievements] Owner shares unavailable:', error?.code || error);
            this.stats = { participants: 0, tiers: {} };
        }
    }

    /** Percent of users who reached a tier, or null when unknown. */
    shareOf(id, tier) {
        const participants = Number(this.stats?.participants) || 0;
        const count = Number(this.stats?.tiers?.[id]?.[tier]) || 0;
        // A zero count means the stats function has not counted this tier yet.
        if (participants <= 0 || count <= 0) return null;
        const percent = Math.min(100, (count / participants) * 100);
        return percent.toLocaleString(this.locale, { maximumFractionDigits: percent < 10 ? 1 : 0 });
    }

    announce(unlocked, hadRecord) {
        if (!unlocked.length || typeof Utils === 'undefined') return;
        // The first recompute turns an existing history into tiers at once: one summary instead of a toast storm.
        if (!hadRecord || unlocked.length > 3) {
            Utils.showToast(this.t('unlocked_many', { n: new Set(unlocked.map(item => item.id)).size }), 'success');
            return;
        }
        unlocked.forEach(({ id, tier }) => Utils.showToast(this.t('unlocked_toast', { name: this.item(id, 'name'), tier: ROMAN[tier - 1] }), 'success'));
    }

    tierOf(id) {
        return Math.max(0, Number(this.stored[id]?.tier) || 0);
    }

    stateOf(def) {
        const tier = this.tierOf(def.id);
        if (tier >= def.tiers.length) return 'done';
        if (tier > 0) return 'earned';
        const progress = this.results?.[def.id];
        return progress && progress.value > 0 ? 'progress' : 'locked';
    }

    matchesFilter(def) {
        const state = this.stateOf(def);
        if (this.filter === 'earned') return state === 'earned' || state === 'done';
        if (this.filter === 'progress') return state === 'progress' || state === 'earned';
        if (this.filter === 'locked') return state === 'locked';
        return true;
    }

    isSecret(def) {
        return def.hidden && this.tierOf(def.id) === 0;
    }

    /** A season boundary as «15 декабря» / "15 December": day before month, as the texts write dates. */
    seasonDay({ month, day }) {
        const locale = this.i18n.currentLocale === 'ru' ? 'ru-RU' : 'en-GB';
        return new Date(2000, month - 1, day).toLocaleDateString(locale, { day: 'numeric', month: 'long' });
    }

    /** {start, end} for a seasonal achievement's condition text. */
    seasonDates(def) {
        return def.season ? { start: this.seasonDay(def.season.start), end: this.seasonDay(def.season.end) } : {};
    }

    /** When a seasonal achievement not earned yet can be earned: until its last day while the season runs, otherwise from its first. */
    seasonChip(def, now = Date.now()) {
        if (!def.season || this.tierOf(def.id) > 0 || this.isSecret(def)) return '';
        const text = inSeason(def.season, now)
            ? this.t('season_until', { date: this.seasonDay(def.season.end) })
            : this.t('season_from', { date: this.seasonDay(def.season.start) });
        return `<span class="ach-chip">${escape(text)}</span>`;
    }

    render() {
        this.el.achLoader.hidden = true;
        const totalTiers = ACHIEVEMENTS.reduce((sum, def) => sum + def.tiers.length, 0);
        const reachedTiers = ACHIEVEMENTS.reduce((sum, def) => sum + Math.min(def.tiers.length, this.tierOf(def.id)), 0);
        const earned = ACHIEVEMENTS.filter(def => this.tierOf(def.id) > 0).length;
        const rank = rankFor(totalPoints(this.stored));
        const points = this.t('rank_points', { n: rank.points.toLocaleString(this.locale) });
        this.renderFramePicker(rank.level);
        this.el.achRankName.textContent = rank.level ? this.t('rank_' + rank.level) : this.t('rank_none');
        this.el.achRankNext.textContent = rank.next === null
            ? points + ' · ' + this.t('rank_max')
            : points + ' · ' + this.t('rank_next', { name: this.t('rank_' + (rank.level + 1)), next: rank.next.toLocaleString(this.locale) });
        this.el.achRankBar.style.width = Math.round(rank.progress * 100) + '%';
        this.el.achEarned.textContent = this.t('earned_count', { n: earned, m: ACHIEVEMENTS.length });
        this.el.achTiers.textContent = this.t('tiers_progress', { n: reachedTiers, m: totalTiers });
        this.el.achTiersBar.style.width = `${Math.round((reachedTiers / totalTiers) * 100)}%`;
        this.el.achSections.innerHTML = CATEGORIES.map(category => {
            const defs = ACHIEVEMENTS.filter(def => def.category === category && this.matchesFilter(def));
            if (!defs.length) return '';
            const all = ACHIEVEMENTS.filter(def => def.category === category);
            const got = all.filter(def => this.tierOf(def.id) > 0).length;
            return `<section class="ach-section">
                <h2 class="ach-section__title">${escape(this.t(`cat_${category}`))} <span>${got} / ${all.length}</span></h2>
                <div class="ach-grid">${defs.map(def => this.cardHTML(def)).join('')}</div>
            </section>`;
        }).join('');
        if (this.dialog) this.renderDialog();
    }

    /**
     * Frame preview with arrows: the owner pages through the cat's frame and the
     * frames of ranks already reached; the arrow past either end stays disabled.
     * Until the cat trail is done its place holds the silhouette that opens the den.
     */
    renderFramePicker(rankLevel) {
        const picker = this.isOwn;
        const unlocked = catFrameUnlocked(this.stored);
        const peeking = picker && this.peeking && !unlocked;
        const shown = peeking ? CAT_FRAME : frameLevel(rankLevel, this.profile?.rankFrameLevel, unlocked);
        if (peeking) {
            const step = String(trailSteps(this.stored));
            // Kept while it stands for the same step, so focus and the cat's pose survive a re-render.
            if (this.el.achRankFrame.querySelector('.cat-peek')?.dataset.step !== step) {
                this.peek?.dispose();
                this.el.achRankFrame.innerHTML = `<button type="button" class="cat-scene cat-peek" data-step="${step}" aria-label="${escape(this.t('cat.open'))}"></button>`;
                const button = this.el.achRankFrame.firstElementChild;
                this.peek = new CatPeek(button, Number(step), button.closest('.ach-stat') || button);
            }
        } else {
            this.peek?.dispose();
            this.peek = null;
            this.el.achRankFrame.innerHTML = shown ? renderAvatarFrame(shown, { label: false }) : '';
        }
        this.el.achRankFrame.ariaHidden = String(!peeking);
        const choices = frameChoices(rankLevel);
        this.el.achFramePrev.hidden = this.el.achFrameNext.hidden = !picker;
        this.el.achFramePrev.disabled = shown === choices[0];
        this.el.achFrameNext.disabled = shown === choices.at(-1);
        const name = shown === CAT_FRAME ? this.t('frame_cat') : this.t('rank_' + shown);
        this.el.achFrameName.textContent = !picker ? ''
            : peeking ? this.t(`cat.title_${trailSteps(this.stored)}`)
            : shown === 0 ? this.t('frame_none') : this.t('frame_name', { name });
    }

    stepFrame(delta) {
        if (!this.isOwn || !this.profile) return;
        const rankLevel = rankFor(totalPoints(this.stored)).level;
        const unlocked = catFrameUnlocked(this.stored);
        const choices = frameChoices(rankLevel);
        const chosen = frameLevel(rankLevel, this.profile.rankFrameLevel, unlocked);
        const next = choices[choices.indexOf(this.peeking && !unlocked ? CAT_FRAME : chosen) + delta];
        if (next === undefined) return;
        this.peeking = next === CAT_FRAME && !unlocked;
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
            this.el.achRankFrame.animate([{ opacity: 0, transform: `translateX(${delta * 16}px) scale(0.9)` }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
        }
        if (this.peeking || next === chosen) {
            this.renderFramePicker(rankLevel);
            return;
        }
        // Choosing the current rank clears the choice, so the frame follows future ranks.
        this.profile.rankFrameLevel = next === rankLevel ? null : next;
        this.renderFramePicker(rankLevel);
        this.onFrameChange?.(this.profile.rankFrameLevel);
    }

    /** The scene of the cat trail, opened from the silhouette or from the secret card. */
    async openDen() {
        const uid = this.loadedUid;
        if (!this.isOwn || catFrameUnlocked(this.stored)) return;
        const { CatDen } = await import('./CatDen.js');
        if (this.loadedUid !== uid || !this.isOwn) return;
        this.den ??= new CatDen({
            t: (key, params) => this.t(key, params),
            onPetted: () => this.finishTrail(),
            onWear: () => this.wearCatFrame()
        });
        this.den.open(Math.min(trailSteps(this.stored), TRAIL_STEPS - 1), uid);
    }

    async finishTrail() {
        const uid = this.loadedUid;
        // The recompute in flight must not answer after this write with what it read before it.
        await this.syncing?.catch(() => {});
        const { stored, points } = await this.service.completeTrail(uid, this.stored);
        if (this.loadedUid !== uid) return;
        this.stored = stored;
        this.profile.achievements = stored;
        if (this.results?.[TRAIL_ID]) Object.assign(this.results[TRAIL_ID], { value: TRAIL_STEPS, tier: 1, next: null, progress: 1 });
        this.render();
        this.onSynced?.({ stored, points, persist: true });
        // Closed before the cat could show it: say it in words.
        if (!this.den?.dialog) this.announce([{ id: TRAIL_ID, tier: 1 }], true);
    }

    wearCatFrame() {
        this.peeking = false;
        this.profile.rankFrameLevel = CAT_FRAME;
        this.renderFramePicker(rankFor(totalPoints(this.stored)).level);
        this.onFrameChange?.(CAT_FRAME, { show: true });
        // The reward goes on where everyone will see it.
        const frame = document.getElementById('profileRankFrame');
        const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
        frame?.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
        if (still) return;
        frame?.animate([
            { opacity: 0, transform: 'translate(-50%, -50%) scale(1.6) rotate(-12deg)' },
            { opacity: 1, transform: 'translate(-50%, -50%) scale(0.93) rotate(3deg)', offset: 0.55 },
            { opacity: 1, transform: 'translate(-50%, -50%) scale(1.03) rotate(-1deg)', offset: 0.8 },
            { opacity: 1, transform: 'translate(-50%, -50%)' }
        ], { duration: 820, delay: 320, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'backwards' });
    }

    cardHTML(def) {
        const tier = this.tierOf(def.id);
        const state = this.stateOf(def);
        const secret = this.isSecret(def);
        const name = secret ? this.t('hidden_name') : this.item(def.id, 'name');
        const result = this.results?.[def.id];
        let progressText = '';
        let width = tier >= def.tiers.length ? 100 : 0;
        if (tier >= def.tiers.length) {
            progressText = this.t('maxed');
        } else if (result && !secret) {
            progressText = this.t('progress', { value: result.value.toLocaleString(this.locale), next: result.next.toLocaleString(this.locale) });
            width = Math.round(result.progress * 100);
        } else if (secret) {
            progressText = def.trail && this.isOwn ? this.t(`cat.title_${trailSteps(this.stored)}`) : this.t('hidden_text');
        }
        const share = tier > 0 ? this.shareOf(def.id, tier) : null;
        const level = def.oneOff ? '' : `<span class="ach-chip">${escape(this.t('level', { n: tier, m: def.tiers.length }))}</span>`;
        const shareChip = share === null ? '' : `<span class="ach-chip">${escape(this.t('share', { n: share }))}</span>`;
        // Once the cat has answered, its eyes shine through the locked badge.
        const trail = def.trail && secret && this.isOwn ? trailSteps(this.stored) : 0;
        return `<button type="button" class="ach-card ach-card--${state}${secret ? ' ach-card--secret' : ''}" data-id="${def.id}"${trail ? ` data-trail="${trail}"` : ''}>
            <span class="ach-card__badge${tier === 0 ? ' is-locked' : ''}">${renderBadge(def, Math.max(1, tier))}${trail ? '<span class="ach-card__eyes" aria-hidden="true"><i></i><i></i></span>' : ''}</span>
            <span class="ach-card__chips">${level}${shareChip}${this.seasonChip(def)}</span>
            <span class="ach-card__name">${escape(name)}</span>
            <span class="ach-card__progress">${escape(progressText)}</span>
            <span class="ach-bar" aria-hidden="true"><span style="width:${width}%"></span></span>
        </button>`;
    }

    bindEvents() {
        this.el.achFilters?.addEventListener('click', event => {
            const button = event.target.closest('[data-filter]');
            if (!button) return;
            this.filter = button.dataset.filter;
            this.el.achFilters.querySelectorAll('[data-filter]').forEach(item => {
                item.classList.toggle('is-active', item === button);
                item.setAttribute('aria-pressed', String(item === button));
            });
            this.render();
        });
        this.el.achSections?.addEventListener('click', event => {
            const card = event.target.closest('.ach-card');
            if (!card) return;
            if (card.dataset.id === TRAIL_ID && this.isOwn && this.tierOf(TRAIL_ID) === 0) this.openDen();
            else this.openDialog(card.dataset.id, card);
        });
        this.el.achRankFrame?.addEventListener('click', event => event.target.closest('.cat-peek') && this.openDen());
        this.el.achFramePrev?.addEventListener('click', () => this.stepFrame(-1));
        this.el.achFrameNext?.addEventListener('click', () => this.stepFrame(1));
        this.el.achClose?.addEventListener('click', () => this.closeDialog());
        this.el.achModal?.addEventListener('click', event => { if (event.target === this.el.achModal) this.closeDialog(); });
        this.el.achPrev?.addEventListener('click', () => this.stepDialog(-1));
        this.el.achNext?.addEventListener('click', () => this.stepDialog(1));
        document.addEventListener('keydown', event => {
            if (!this.dialog) return;
            if (event.key === 'Escape') this.closeDialog();
            if (event.key === 'ArrowLeft') this.stepDialog(-1);
            if (event.key === 'ArrowRight') this.stepDialog(1);
        });
    }

    openDialog(id, trigger) {
        const def = ACHIEVEMENTS_BY_ID[id];
        if (!def) return;
        this.dialog = { def, index: Math.min(def.tiers.length, Math.max(1, this.tierOf(id))), trigger };
        this.el.achModal.hidden = false;
        this.renderDialog();
        this.el.achClose.focus();
    }

    closeDialog() {
        if (!this.dialog) return;
        const trigger = this.dialog.trigger;
        this.dialog = null;
        this.el.achModal.hidden = true;
        trigger?.focus?.();
    }

    stepDialog(delta) {
        if (!this.dialog) return;
        const next = this.dialog.index + delta;
        if (next < 1 || next > this.dialog.def.tiers.length) return;
        this.dialog.index = next;
        this.renderDialog();
    }

    renderDialog() {
        const { def, index } = this.dialog;
        const reached = this.tierOf(def.id);
        const secret = this.isSecret(def);
        const earned = index <= reached;
        const date = this.stored[def.id]?.at?.[index];
        const share = this.shareOf(def.id, index);
        this.el.achDialogTags.innerHTML = [
            share === null ? '' : `<span class="ach-chip">${escape(this.t('share', { n: share }))}</span>`,
            earned && date
                ? `<span class="ach-chip ach-chip--ok">${escape(this.t('obtained', { date: new Date(date).toLocaleDateString(this.locale) }))}</span>`
                : `<span class="ach-chip">${escape(this.t('not_obtained'))}</span>`,
            this.seasonChip(def)
        ].join('');
        this.el.achDialogBadge.className = `ach-dialog__badge${earned ? '' : ' is-locked'}`;
        this.el.achDialogBadge.innerHTML = renderBadge(def, index, { title: this.item(def.id, 'name') });
        const name = secret ? this.t('hidden_name') : this.item(def.id, 'name');
        this.el.achDialogTitle.textContent = def.oneOff ? name : `${name} · ${ROMAN[index - 1]}`;
        this.el.achDialogCondition.textContent = secret ? this.t('hidden_text') : this.item(def.id, 'condition', { n: def.tiers[index - 1].toLocaleString(this.locale), ...this.seasonDates(def) });
        this.el.achDialogLevel.hidden = def.oneOff;
        this.el.achDialogLevel.textContent = this.t('tier', { n: `${index} / ${def.tiers.length}` });
        this.el.achDialogText.textContent = secret ? '' : this.item(def.id, 'text');
        // Progress is known only on the owner's profile; other users see reached tiers.
        const value = this.results?.[def.id]?.value ?? null;
        const threshold = def.tiers[index - 1];
        if (earned) {
            this.el.achDialogProgress.textContent = this.t('progress', { value: threshold.toLocaleString(this.locale), next: threshold.toLocaleString(this.locale) });
            this.el.achDialogBar.style.width = '100%';
        } else if (value !== null && !secret) {
            this.el.achDialogProgress.textContent = this.t('progress', { value: Math.min(value, threshold).toLocaleString(this.locale), next: threshold.toLocaleString(this.locale) });
            this.el.achDialogBar.style.width = `${Math.round(Math.min(1, value / threshold) * 100)}%`;
        } else {
            this.el.achDialogProgress.textContent = '';
            this.el.achDialogBar.style.width = '0%';
        }
        this.el.achPrev.disabled = index <= 1;
        this.el.achNext.disabled = index >= def.tiers.length;
        this.el.achPrev.hidden = this.el.achNext.hidden = def.tiers.length <= 1;
    }
}
