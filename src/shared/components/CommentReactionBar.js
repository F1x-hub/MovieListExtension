const FALLBACK_REACTION_TYPES = [
    'like',
    'love',
    'laugh',
    'wow',
    'sad',
    'fire',
    'clap',
    'rocket',
    'party',
    'thinking',
    'eyes',
    'hundred'
];
const FALLBACK_REACTION_META = {
    like: { emoji: '👍', label: 'Like' },
    love: { emoji: '❤️', label: 'Love' },
    laugh: { emoji: '😂', label: 'Funny' },
    wow: { emoji: '😮', label: 'Wow' },
    sad: { emoji: '😢', label: 'Sad' },
    fire: { emoji: '🔥', label: 'Fire' },
    clap: { emoji: '👏', label: 'Applause' },
    rocket: { emoji: '🚀', label: 'Great' },
    party: { emoji: '🎉', label: 'Celebration' },
    thinking: { emoji: '🤔', label: 'Thinking' },
    eyes: { emoji: '👀', label: 'Interesting' },
    hundred: { emoji: '💯', label: 'Perfect' }
};
let reactionBarInstance = 0;

function reactionBarEscapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function getReactionTypes() {
    return Array.isArray(globalThis.CommentReactionTypes)
        ? globalThis.CommentReactionTypes
        : FALLBACK_REACTION_TYPES;
}

function getReactionMeta(type) {
    return globalThis.CommentReactionMeta?.[type] || FALLBACK_REACTION_META[type];
}

function getSafeReactionImageUrl(meta) {
    if (meta?.renderType !== 'image' || !meta.imageUrl) return null;
    return globalThis.CommentReactionService?.normalizeReactionImageUrl?.(meta.imageUrl) || null;
}

function getReactionLabel(type) {
    const fallback = getReactionMeta(type)?.label || type;
    const translationKey = `movie_details.reaction_labels.${type}`;
    const translated = globalThis.i18n?.get?.(translationKey);
    return translated && translated !== translationKey ? translated : fallback;
}

function getReactionAriaLabel(type, count) {
    const label = getReactionLabel(type);
    return count > 0 ? `${label}: ${count}` : label;
}

function renderReactionVisual(type) {
    const meta = getReactionMeta(type);
    const imageUrl = getSafeReactionImageUrl(meta);
    if (!imageUrl) {
        return `<span class="comment-reaction-emoji" aria-hidden="true">${reactionBarEscapeHtml(meta?.emoji || '')}</span>`;
    }

    return `
        <span class="comment-reaction-visual" aria-hidden="true">
            <img class="comment-reaction-image" data-comment-reaction-image
                src="${reactionBarEscapeHtml(imageUrl)}" alt="" loading="lazy" decoding="async">
            <span class="comment-reaction-emoji comment-reaction-image-fallback" hidden>${reactionBarEscapeHtml(meta.shortcode || meta.emoji || '')}</span>
        </span>
    `;
}

function bindReactionImageFallback(root) {
    root?.querySelectorAll?.('[data-comment-reaction-image]').forEach((image) => {
        if (image.dataset.fallbackBound === 'true') return;
        image.dataset.fallbackBound = 'true';
        image.addEventListener('error', () => {
            image.hidden = true;
            const fallback = image.parentElement?.querySelector('.comment-reaction-image-fallback');
            if (fallback) fallback.hidden = false;
        }, { once: true });
    });
}

function getReactionSummary(summary = {}) {
    const counts = {};
    getReactionTypes().forEach((type) => {
        const value = Number(summary?.counts?.[type]);
        counts[type] = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
    });
    return { counts };
}

function getUserReactionTypes(userReaction) {
    const values = Array.isArray(userReaction) ? userReaction : [userReaction];
    const availableTypes = getReactionTypes();
    return [...new Set(values.filter((type) => availableTypes.includes(type)))];
}

function renderReactionButton(type, count, isActive, className, showCount = true) {
    const label = getReactionLabel(type);
    return `
        <button type="button" class="${className}${isActive ? ' is-active' : ''}${showCount && count === 0 ? ' is-empty' : ''}"
            data-action="toggle-comment-reaction" data-reaction-type="${reactionBarEscapeHtml(type)}"
            aria-label="${reactionBarEscapeHtml(getReactionAriaLabel(type, count))}"
            title="${reactionBarEscapeHtml(label)}" aria-pressed="${isActive ? 'true' : 'false'}"
            data-count="${count}">
            ${renderReactionVisual(type)}
            ${showCount ? `<span class="comment-reaction-count">${count > 0 ? count : ''}</span>` : ''}
        </button>
    `;
}

function getVisibleReactionTypes(types, counts, userReactionTypes, existingOrder = []) {
    const activeTypes = new Set(
        types.filter((type) => counts[type] > 0 || userReactionTypes.includes(type))
    );

    const result = [];
    if (Array.isArray(existingOrder)) {
        existingOrder.forEach((type) => {
            if (activeTypes.has(type) && !result.includes(type)) {
                result.push(type);
                activeTypes.delete(type);
            }
        });
    }

    userReactionTypes.forEach((type) => {
        if (activeTypes.has(type) && !result.includes(type)) {
            result.push(type);
            activeTypes.delete(type);
        }
    });

    types.forEach((type) => {
        if (activeTypes.has(type) && !result.includes(type)) {
            result.push(type);
            activeTypes.delete(type);
        }
    });

    return result;
}

class CommentReactionBar {
    static render({ ratingId, movieId, summary = {}, userReaction = null } = {}) {
        const safeRatingId = reactionBarEscapeHtml(ratingId);
        const safeMovieId = reactionBarEscapeHtml(movieId);
        const normalizedSummary = getReactionSummary(summary);
        const userReactionTypes = getUserReactionTypes(userReaction);
        const types = getReactionTypes();
        const reactionLabel = globalThis.i18n?.get?.('movie_details.reactions') || 'Reactions';
        const addReactionLabel = globalThis.i18n?.get?.('movie_details.add_reaction') || 'Add reaction';
        const chooseReactionLabel = globalThis.i18n?.get?.('movie_details.choose_reaction') || 'Choose a reaction';
        const pickerId = `comment-reaction-picker-${++reactionBarInstance}`;
        const baseOrder = Array.isArray(summary?.order)
            ? summary.order
            : Object.keys(summary?.counts || {}).filter((type) => Number(summary.counts[type]) > 0);
        const visibleTypes = getVisibleReactionTypes(types, normalizedSummary.counts, userReactionTypes, baseOrder);

        return `
            <div class="comment-reaction-bar" data-comment-reactions="true" data-rating-id="${safeRatingId}" data-movie-id="${safeMovieId}">
                <span class="comment-reaction-caption" aria-hidden="true">${reactionBarEscapeHtml(reactionLabel)}</span>
                <div class="comment-reaction-controls">
                    <div class="comment-reaction-list" data-comment-reaction-selected-list role="group" aria-label="${reactionBarEscapeHtml(reactionLabel)}">
                        ${visibleTypes.map((type) => renderReactionButton(
                            type,
                            normalizedSummary.counts[type],
                            userReactionTypes.includes(type),
                            'comment-reaction-btn'
                        )).join('')}
                    </div>
                    <button type="button" class="comment-reaction-trigger"
                        data-action="toggle-comment-reaction-picker"
                        aria-label="${reactionBarEscapeHtml(addReactionLabel)}"
                        title="${reactionBarEscapeHtml(addReactionLabel)}"
                        aria-haspopup="true" aria-expanded="false" aria-controls="${pickerId}">
                        <span aria-hidden="true">+</span>
                    </button>
                    <div id="${pickerId}" class="comment-reaction-picker" data-comment-reaction-picker
                        role="group" aria-label="${reactionBarEscapeHtml(chooseReactionLabel)}" hidden>
                        ${types.map((type) => renderReactionButton(
                            type,
                            normalizedSummary.counts[type],
                            userReactionTypes.includes(type),
                            'comment-reaction-picker-btn',
                            false
                        )).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    static update(element, summary = {}, userReaction = null, options = {}) {
        if (!element) return;
        const normalizedSummary = getReactionSummary(summary);
        const userReactionTypes = getUserReactionTypes(userReaction);
        const types = getReactionTypes();
        const selectedList = element.querySelector('[data-comment-reaction-selected-list]');
        const picker = element.querySelector('[data-comment-reaction-picker]');
        const trigger = element.querySelector('[data-action="toggle-comment-reaction-picker"]');

        const isPending = options?.isPending ?? (element.getAttribute('data-pending') === 'true');
        if (options?.isPending !== undefined) {
            if (options.isPending) {
                element.setAttribute('data-pending', 'true');
            } else {
                element.removeAttribute('data-pending');
            }
        }

        if (selectedList) {
            const currentDomOrder = Array.from(selectedList.querySelectorAll('[data-reaction-type]'))
                .map((btn) => btn.dataset.reactionType)
                .filter(Boolean);
            const baseOrder = currentDomOrder.length > 0
                ? currentDomOrder
                : (Array.isArray(summary?.order)
                    ? summary.order
                    : Object.keys(summary?.counts || {}).filter((type) => Number(summary.counts[type]) > 0));
            const visibleTypes = getVisibleReactionTypes(types, normalizedSummary.counts, userReactionTypes, baseOrder);
            selectedList.innerHTML = visibleTypes.map((type) => renderReactionButton(
                type,
                normalizedSummary.counts[type],
                userReactionTypes.includes(type),
                'comment-reaction-btn'
            )).join('');

            if (isPending) {
                selectedList.querySelectorAll('button').forEach((btn) => {
                    btn.disabled = true;
                    btn.setAttribute('aria-busy', 'true');
                });
            }
        }

        if (picker) {
            picker.innerHTML = types.map((type) => renderReactionButton(
                type,
                normalizedSummary.counts[type],
                userReactionTypes.includes(type),
                'comment-reaction-picker-btn',
                false
            )).join('');

            if (isPending) {
                picker.querySelectorAll('button').forEach((btn) => {
                    btn.disabled = true;
                    btn.setAttribute('aria-busy', 'true');
                });
            }
        }

        if (trigger) {
            trigger.disabled = isPending;
            if (isPending) {
                trigger.setAttribute('aria-busy', 'true');
            } else {
                trigger.removeAttribute('aria-busy');
            }
        }

        bindReactionImageFallback(element);
    }

    static setPickerOpen(element, open) {
        const bar = element?.matches?.('[data-comment-reactions]')
            ? element
            : element?.closest?.('[data-comment-reactions]');
        const picker = bar?.querySelector?.('[data-comment-reaction-picker]');
        const trigger = bar?.querySelector?.('[data-action="toggle-comment-reaction-picker"]');
        if (!bar || !picker || !trigger) return;

        if (!open) {
            picker.hidden = true;
            this.clearPickerPositioning(picker);
            trigger.setAttribute('aria-expanded', 'false');
            return;
        }

        this.closeOpenPickers(bar);
        picker.hidden = false;
        this.positionPicker(bar, picker, trigger);
        this.bindPickerPositioning(bar, picker, trigger);
        trigger.setAttribute('aria-expanded', 'true');
    }

    static positionPicker(bar, picker, trigger) {
        if (!bar?.isConnected || !picker?.isConnected || picker.hidden) return;

        const triggerRect = trigger.getBoundingClientRect();
        const controls = bar.querySelector('[data-comment-reaction-picker]')?.parentElement;
        const anchorRect = controls?.getBoundingClientRect?.() || triggerRect;
        picker.style.removeProperty('max-height');
        const pickerRect = picker.getBoundingClientRect();
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
        const gap = 8;
        const viewportPadding = 8;
        const spaceAbove = Math.max(0, triggerRect.top - gap - viewportPadding);
        const spaceBelow = Math.max(0, viewportHeight - triggerRect.bottom - gap - viewportPadding);
        const opensAbove = pickerRect.height > spaceBelow && spaceAbove >= spaceBelow;
        const availableHeight = opensAbove ? spaceAbove : spaceBelow;
        const desiredLeft = Math.max(anchorRect.left, triggerRect.left + (triggerRect.width / 2) - (pickerRect.width / 2));
        const maxLeft = Math.max(viewportPadding, viewportWidth - pickerRect.width - viewportPadding);

        const clampedLeft = Math.min(Math.max(viewportPadding, desiredLeft), maxLeft);
        const relativeLeft = Math.max(0, Math.round(clampedLeft - anchorRect.left));

        picker.style.maxHeight = `${Math.max(32, Math.floor(availableHeight))}px`;
        picker.style.left = `${relativeLeft}px`;
        picker.dataset.placement = opensAbove ? 'above' : 'below';
    }

    static bindPickerPositioning(bar, picker, trigger) {
        if (picker.__commentReactionPositionCleanup || typeof window === 'undefined') return;
        const reposition = () => {
            if (!picker.isConnected) {
                this.clearPickerPositioning(picker);
                return;
            }
            this.positionPicker(bar, picker, trigger);
        };
        window.addEventListener('resize', reposition);
        document.addEventListener('scroll', reposition, true);
        picker.__commentReactionPositionCleanup = () => {
            window.removeEventListener('resize', reposition);
            document.removeEventListener('scroll', reposition, true);
            delete picker.__commentReactionPositionCleanup;
        };
    }

    static clearPickerPositioning(picker) {
        picker?.__commentReactionPositionCleanup?.();
        if (picker) {
            picker.style.removeProperty('top');
            picker.style.removeProperty('left');
            picker.style.removeProperty('max-height');
            delete picker.dataset.placement;
        }
    }

    static closeOpenPickers(exceptBar = null) {
        if (typeof document === 'undefined') return;
        document.querySelectorAll('[data-comment-reaction-picker]').forEach((picker) => {
            const bar = picker.closest('[data-comment-reactions]');
            if (!bar || bar === exceptBar || picker.hidden) return;
            picker.hidden = true;
            this.clearPickerPositioning(picker);
            bar.querySelector('[data-action="toggle-comment-reaction-picker"]')
                ?.setAttribute('aria-expanded', 'false');
        });
    }
}

if (typeof window !== 'undefined') {
    window.CommentReactionBar = CommentReactionBar;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CommentReactionBar };
}
