/**
 * Helpers shared by the networked games (Battleship, chess): game codes typed or
 * pasted by players, the name a profile shows and the approved-player search
 * behind «Вызвать игрока».
 */

const CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
const SEARCH_LIMIT = 8;

/** A typed game code ("k7q-2mx", "K7Q 2MX", a pasted link) as the canonical code, or null. */
export function normalizeGameCode(value) {
    const text = String(value ?? '').trim();
    const fromLink = /[?&]game=([A-Za-z0-9]{6})\b/.exec(text)?.[1];
    const code = (fromLink || text).replace(/[\s-]+/g, '').toUpperCase();
    return CODE_PATTERN.test(code) ? code : null;
}

/** The name a profile shows, following the owner's display preference. */
export function profileDisplayName(profile) {
    if (!profile) return '';
    if (profile.displayNameFormat === 'username' && profile.username) return String(profile.username);
    const fullName = [profile.firstName, profile.lastName].map(part => String(part || '').trim()).filter(Boolean).join(' ');
    return fullName || String(profile.displayName || profile.username || '').trim();
}

export function safeHttpsUrl(value) {
    const text = String(value ?? '').trim();
    if (!text || text.length > 2048) return null;
    try {
        return new URL(text).protocol === 'https:' ? text : null;
    } catch {
        return null;
    }
}

function capitalize(text) {
    return text ? text.charAt(0).toLocaleUpperCase() + text.slice(1) : text;
}

/**
 * Approved players whose username, first name or display name starts with the
 * text. Three small prefix queries; Firestore matching is case-sensitive, so
 * names are tried capitalized and usernames lowercased.
 * @param {Object} db - Firestore (compat)
 * @param {string} text
 * @param {{ selfUid?: string|null, limit?: number }} [options]
 * @returns {Promise<Array<{ uid: string, name: string, username: string|null, photo: string|null }>>}
 */
export async function searchApprovedPlayers(db, text, { selfUid = null, limit = SEARCH_LIMIT } = {}) {
    const query = String(text ?? '').trim().replace(/^@/, '');
    if (query.length < 2) return [];
    const users = db.collection('users');
    const prefix = (field, value) => users.where(field, '>=', value).where(field, '<=', `${value}\uf8ff`).limit(limit).get();
    const lower = query.toLocaleLowerCase();
    const capital = capitalize(query);
    const answers = await Promise.allSettled([
        prefix('usernameLower', lower),
        prefix('firstName', capital),
        prefix('displayName', capital)
    ]);
    if (answers.every(answer => answer.status === 'rejected')) throw answers[0].reason;
    const players = new Map();
    for (const answer of answers) {
        if (answer.status !== 'fulfilled') continue;
        for (const doc of answer.value.docs) {
            const profile = doc.data() || {};
            if (doc.id === selfUid || players.has(doc.id)) continue;
            if (profile.approvalStatus && profile.approvalStatus !== 'approved') continue;
            const name = profileDisplayName(profile);
            if (!name) continue;
            players.set(doc.id, {
                uid: doc.id,
                name,
                username: profile.username ? String(profile.username) : null,
                photo: safeHttpsUrl(profile.photoURL)
            });
        }
    }
    return [...players.values()].slice(0, limit);
}
