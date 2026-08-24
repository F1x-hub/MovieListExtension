/**
 * Shared back-to-top control for extension pages.
 * Uses the popup container when the popup owns scrolling and the document otherwise.
 */
class BackToTop {
    static BUTTON_ID = 'backToTopButton';
    static VISIBILITY_THRESHOLD = 240;

    static init() {
        if (!document.body || document.getElementById(BackToTop.BUTTON_ID)) {
            return;
        }

        const button = document.createElement('button');
        button.id = BackToTop.BUTTON_ID;
        button.type = 'button';
        button.className = 'back-to-top';
        button.setAttribute('aria-label', 'Наверх');
        button.setAttribute('aria-hidden', 'true');
        button.title = 'Наверх';
        button.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 19V5"></path>
                <path d="m5 12 7-7 7 7"></path>
            </svg>
        `;

        const popupContainer = document.querySelector('.popup-container');
        const usesElementScroll = Boolean(popupContainer);
        const scrollTarget = usesElementScroll ? popupContainer : window;
        const getScrollTop = () => usesElementScroll
            ? popupContainer.scrollTop
            : window.scrollY || document.documentElement.scrollTop;

        const updateVisibility = () => {
            const isVisible = getScrollTop() > BackToTop.VISIBILITY_THRESHOLD;
            button.classList.toggle('is-visible', isVisible);
            button.setAttribute('aria-hidden', String(!isVisible));
        };

        button.addEventListener('click', () => {
            const prefersReducedMotion = window.matchMedia?.(
                '(prefers-reduced-motion: reduce)'
            ).matches;
            const behavior = prefersReducedMotion ? 'auto' : 'smooth';

            if (usesElementScroll) {
                popupContainer.scrollTo({ top: 0, behavior });
            } else {
                window.scrollTo({ top: 0, behavior });
            }
        });

        scrollTarget.addEventListener('scroll', updateVisibility, { passive: true });
        window.addEventListener('resize', updateVisibility, { passive: true });
        document.body.append(button);
        updateVisibility();
    }
}

if (typeof window !== 'undefined') {
    window.BackToTop = BackToTop;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => BackToTop.init(), { once: true });
    } else {
        BackToTop.init();
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = BackToTop;
}
