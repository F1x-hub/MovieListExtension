/**
 * Profile showcase: achievement points and the highest-tier badges, linking to
 * the profile's «Достижения» tab. It reads the stored snapshot on the user
 * document; the owner's profile refreshes that snapshot in the background at
 * most once per SYNC_INTERVAL_MS.
 */
import { ACHIEVEMENTS_BY_ID, pointsFor } from './AchievementCatalog.js';
import { rankFor, totalPoints } from './AchievementEngine.js';
import { renderBadge } from './AchievementBadge.js';

const SHOWCASE_SIZE = 6;
export const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function topAchievements(stored = {}, limit = SHOWCASE_SIZE) {
    return Object.entries(stored)
        .map(([id, entry]) => ({ def: ACHIEVEMENTS_BY_ID[id], tier: Number(entry?.tier) || 0 }))
        .filter(item => item.def && item.tier > 0)
        .sort((a, b) => b.tier - a.tier || pointsFor(b.def, b.tier) - pointsFor(a.def, a.tier))
        .slice(0, limit);
}

export function renderShowcase(container, stored, { isOwn, uid, i18n }) {
    if (!container) return;
    const t = (key, params = {}) => {
        let text = i18n.get(`achievements.${key}`);
        Object.entries(params).forEach(([name, value]) => { text = text.replaceAll(`{${name}}`, String(value)); });
        return text;
    };
    const items = topAchievements(stored);
    const href = `../profile/profile.html?${isOwn ? '' : `userId=${encodeURIComponent(uid)}&`}tab=achievements`;
    const rank = rankFor(totalPoints(stored));
    const rankName = rank.level ? t('rank_' + rank.level) : t('rank_none');
    container.hidden = false;
    container.innerHTML = `
        <div class="profile-achievements__header">
            <h2 class="section-title">${escape(t('showcase_title'))}</h2>
            <span class="profile-achievements__points">${escape(t('rank'))}: <b>${escape(rankName)}</b></span>
            <a class="dashboard-section-link profile-achievements__link" href="${href}">${escape(t('view_all'))} →</a>
        </div>
        ${items.length ? `<div class="profile-achievements__list">${items.map(({ def, tier }) => {
            const name = i18n.get(`achievements.items.${def.id}.name`);
            const label = def.oneOff ? name : `${name} · ${ROMAN[tier - 1]}`;
            return `<a class="profile-achievements__item" href="${href}" title="${escape(label)}">${renderBadge(def, tier, { title: label })}<span>${escape(label)}</span></a>`;
        }).join('')}</div>` : `<p class="taste-empty">${escape(t(isOwn ? 'showcase_empty_own' : 'showcase_empty_other'))}</p>`}`;
}
