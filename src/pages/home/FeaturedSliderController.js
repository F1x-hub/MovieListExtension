/**
 * FeaturedSliderController - UI Component for Featured Carousel
 * Handles carousel pagination, dot indicators, translateX transforms,
 * and fluid pointer drag & swipe gestures with zero service dependencies.
 * Implements adaptive itemsPerPage and cardWidth calculations based on container width.
 */
class FeaturedSliderController {
    /**
     * @param {Object} options
     * @param {HTMLElement} options.sliderElement - Container holding the slide cards
     * @param {HTMLElement} options.paginationElement - Container holding pagination dots
     * @param {number} [options.gap=20] - Gap between slide cards in px
     */
    constructor({
        sliderElement,
        paginationElement,
        gap = 20
    } = {}) {
        this.sliderElement = sliderElement;
        this.paginationElement = paginationElement;
        this.gap = gap;

        this.items = [];
        this.itemsPerPage = 5;
        this.cardWidth = 256;
        this.currentPage = 0;
        this.totalPages = 0;
        this.currentOffset = 0;

        // Pointer Drag & Gesture State
        this.isPointerDown = false;
        this.isDragging = false;
        this.preventClick = false;
        this.hasCapturedPointer = false;
        this.startX = 0;
        this.startY = 0;
        this.startOffset = 0;
        this.pointerId = null;
        this.velocityHistory = [];
        this.wheelDebounceTimeout = null;
        this.dragBound = false;

        // Resize Observer State
        this.resizeObserver = null;
        this.resizeTimeout = null;

        // Bind handler contexts
        this.handleResize = this.handleResize.bind(this);
        this.onPointerDown = this.onPointerDown.bind(this);
        this.onPointerMove = this.onPointerMove.bind(this);
        this.onPointerUp = this.onPointerUp.bind(this);
        this.onPointerCancel = this.onPointerCancel.bind(this);
        this.onDragStart = this.onDragStart.bind(this);
        this.onClickCapture = this.onClickCapture.bind(this);
        this.onWheel = this.onWheel.bind(this);
    }

    /**
     * Determine itemsPerPage and cardWidth based on container width
     * @param {number} containerWidth
     */
    calculateLayout(containerWidth) {
        const width = containerWidth || (this.sliderElement?.parentElement?.clientWidth) || 1280;

        if (width >= 1280) {
            this.itemsPerPage = 5;
        } else if (width >= 960) {
            this.itemsPerPage = 4;
        } else if (width >= 640) {
            this.itemsPerPage = 3;
        } else {
            this.itemsPerPage = 2;
        }

        // Available width minus gaps divided by itemsPerPage
        const totalGaps = (this.itemsPerPage - 1) * this.gap;
        this.cardWidth = Math.floor((width - totalGaps) / this.itemsPerPage);

        // Apply dynamic width to card DOM elements
        if (this.sliderElement) {
            const cards = this.sliderElement.querySelectorAll('.featured-card');
            cards.forEach(card => {
                card.style.width = `${this.cardWidth}px`;
                card.style.minWidth = `${this.cardWidth}px`;
            });
        }
    }

    /**
     * Compute translateX offset for a given page index
     * @param {number} pageIndex
     * @returns {number}
     */
    getPageOffset(pageIndex) {
        if (this.totalPages <= 0) return 0;
        const safePage = Math.max(0, Math.min(pageIndex, this.totalPages - 1));
        let targetIndex = safePage * this.itemsPerPage;
        if (safePage === this.totalPages - 1 && this.items.length > this.itemsPerPage) {
            targetIndex = Math.max(0, this.items.length - this.itemsPerPage);
        }
        if (targetIndex === 0) return 0;
        return -(targetIndex * (this.cardWidth + this.gap));
    }

    /**
     * Initialize carousel with items
     * @param {Array} items - List of items in the slider
     */
    init(items = []) {
        this.items = Array.isArray(items) ? items : [];

        if (this.items.length === 0) {
            if (this.paginationElement) this.paginationElement.innerHTML = '';
            this.unbindDragEvents();
            return;
        }

        const container = this.sliderElement?.parentElement;
        const width = container ? container.clientWidth : 1280;
        this.calculateLayout(width);

        this.totalPages = Math.ceil(this.items.length / this.itemsPerPage);
        this.createPaginationDots();
        this.showPage(0, false);

        this.bindResizeObserver();
        this.bindDragEvents();
    }

    /**
     * Bind pointer and drag event listeners
     */
    bindDragEvents() {
        if (!this.sliderElement || this.dragBound) return;
        this.dragBound = true;

        this.sliderElement.addEventListener('pointerdown', this.onPointerDown);
        this.sliderElement.addEventListener('pointermove', this.onPointerMove);
        this.sliderElement.addEventListener('pointerup', this.onPointerUp);
        this.sliderElement.addEventListener('pointercancel', this.onPointerCancel);
        this.sliderElement.addEventListener('dragstart', this.onDragStart);
        this.sliderElement.addEventListener('click', this.onClickCapture, true); // Capture phase to prevent accidental card navigation when dragging
        this.sliderElement.addEventListener('wheel', this.onWheel, { passive: false });
    }

    /**
     * Unbind pointer and drag event listeners
     */
    unbindDragEvents() {
        if (!this.sliderElement || !this.dragBound) return;
        this.dragBound = false;

        this.sliderElement.removeEventListener('pointerdown', this.onPointerDown);
        this.sliderElement.removeEventListener('pointermove', this.onPointerMove);
        this.sliderElement.removeEventListener('pointerup', this.onPointerUp);
        this.sliderElement.removeEventListener('pointercancel', this.onPointerCancel);
        this.sliderElement.removeEventListener('dragstart', this.onDragStart);
        this.sliderElement.removeEventListener('click', this.onClickCapture, true);
        this.sliderElement.removeEventListener('wheel', this.onWheel);
    }

    /**
     * Handle pointerdown to initiate drag tracking without capturing pointer prematurely
     * @param {PointerEvent} e
     */
    onPointerDown(e) {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        if (this.totalPages <= 1) return;

        this.isPointerDown = true;
        this.isDragging = false;
        this.preventClick = false;
        this.hasCapturedPointer = false;
        this.startX = e.clientX;
        this.startY = e.clientY;
        this.startTime = performance.now();
        this.startOffset = this.currentOffset;
        this.pointerId = e.pointerId;
        this.velocityHistory = [{ x: e.clientX, t: performance.now() }];
    }

    /**
     * Handle pointermove for real-time translation and swipe thresholding with jitter filter
     * @param {PointerEvent} e
     */
    onPointerMove(e) {
        if (!this.isPointerDown) return;

        const deltaX = e.clientX - this.startX;
        const deltaY = e.clientY - this.startY;

        if (!this.isDragging) {
            const absX = Math.abs(deltaX);
            const absY = Math.abs(deltaY);
            const distance = Math.hypot(deltaX, deltaY);

            // Jitter deadzone: 10px threshold to filter out hand tremor during clicking
            if (distance >= 10) {
                if (absX >= absY) {
                    // Horizontal drag gesture confirmed: engage dragging and capture pointer
                    this.isDragging = true;
                    this.preventClick = true;
                    if (this.sliderElement) {
                        this.sliderElement.classList.add('is-dragging');
                        if (!this.hasCapturedPointer && e.pointerId != null) {
                            try {
                                this.sliderElement.setPointerCapture(e.pointerId);
                                this.hasCapturedPointer = true;
                            } catch {
                                // Ignore pointer capture error
                            }
                        }
                    }
                } else {
                    // Vertical page scrolling intent confirmed — cancel slider drag tracking
                    this.isPointerDown = false;
                    return;
                }
            } else {
                // Within jitter threshold: treat as click in progress, do not move DOM
                return;
            }
        }

        // Active dragging: prevent page scrolling / gestures
        e.preventDefault();

        const maxOffset = 0;
        const minOffset = this.getPageOffset(this.totalPages - 1);

        let targetOffset = this.startOffset + deltaX;

        // Apply elastic rubber-band damping beyond bounds
        if (targetOffset > maxOffset) {
            const overflow = targetOffset - maxOffset;
            targetOffset = maxOffset + overflow * 0.25;
        } else if (targetOffset < minOffset) {
            const overflow = minOffset - targetOffset;
            targetOffset = minOffset - overflow * 0.25;
        }

        this.currentOffset = targetOffset;
        if (this.sliderElement) {
            this.sliderElement.style.transform = `translateX(${targetOffset}px)`;
        }

        const now = performance.now();
        this.velocityHistory.push({ x: e.clientX, t: now });
        this.velocityHistory = this.velocityHistory.filter(p => now - p.t <= 100);
    }

    /**
     * Handle pointerup to finalize gesture, distinguish click intent from drag, and snap
     * @param {PointerEvent} e
     */
    onPointerUp(e) {
        if (!this.isPointerDown) return;
        this.isPointerDown = false;

        if (this.hasCapturedPointer && e.pointerId != null) {
            try {
                if (this.sliderElement && this.sliderElement.hasPointerCapture(e.pointerId)) {
                    this.sliderElement.releasePointerCapture(e.pointerId);
                }
            } catch {
                // Ignore pointer release error
            }
            this.hasCapturedPointer = false;
        }

        if (this.sliderElement) {
            this.sliderElement.classList.remove('is-dragging');
        }

        const totalDist = Math.hypot(e.clientX - this.startX, e.clientY - this.startY);
        const duration = performance.now() - (this.startTime || 0);

        // Explicit click intent: if no real drag occurred or movement was within jitter threshold (< 10px)
        if (!this.isDragging || (totalDist < 10 && duration < 350)) {
            this.isDragging = false;
            this.preventClick = false;
            this.pointerId = null;
            return;
        }

        this.isDragging = false;

        // Calculate velocity from recent motion points
        const now = performance.now();
        const validPoints = this.velocityHistory.filter(p => now - p.t <= 100);
        let velocityX = 0;
        if (validPoints.length >= 2) {
            const first = validPoints[0];
            const last = validPoints[validPoints.length - 1];
            const dt = last.t - first.t;
            if (dt > 10) {
                velocityX = (last.x - first.x) / dt; // px per ms
            }
        }

        const deltaX = e.clientX - this.startX;
        let targetPage = this.currentPage;

        // 1. High-velocity swipe / flick detection
        if (Math.abs(velocityX) > 0.25) {
            if (velocityX < -0.25 && this.currentPage < this.totalPages - 1) {
                targetPage = this.currentPage + 1;
            } else if (velocityX > 0.25 && this.currentPage > 0) {
                targetPage = this.currentPage - 1;
            }
        } else {
            // 2. Position displacement threshold
            const pageStep = this.cardWidth + this.gap;
            const threshold = pageStep * 0.22;

            if (deltaX < -threshold && this.currentPage < this.totalPages - 1) {
                targetPage = this.currentPage + 1;
            } else if (deltaX > threshold && this.currentPage > 0) {
                targetPage = this.currentPage - 1;
            } else {
                // Find closest page to current offset
                let closestPage = this.currentPage;
                let minDiff = Infinity;
                for (let i = 0; i < this.totalPages; i++) {
                    const diff = Math.abs(this.currentOffset - this.getPageOffset(i));
                    if (diff < minDiff) {
                        minDiff = diff;
                        closestPage = i;
                    }
                }
                targetPage = closestPage;
            }
        }

        this.showPage(targetPage, true);

        // Keep preventClick active briefly to swallow card click from the completed drag gesture
        setTimeout(() => {
            this.preventClick = false;
        }, 80);

        this.pointerId = null;
    }

    /**
     * Handle pointer cancellation (e.g. system gesture takeover)
     * @param {PointerEvent} e
     */
    onPointerCancel(e) {
        if (!this.isPointerDown) return;
        this.isPointerDown = false;
        this.isDragging = false;

        if (this.hasCapturedPointer && e.pointerId != null) {
            try {
                if (this.sliderElement && this.sliderElement.hasPointerCapture(e.pointerId)) {
                    this.sliderElement.releasePointerCapture(e.pointerId);
                }
            } catch {
                // Ignore pointer release error
            }
            this.hasCapturedPointer = false;
        }

        if (this.sliderElement) {
            this.sliderElement.classList.remove('is-dragging');
        }

        this.showPage(this.currentPage, true);

        this.preventClick = false;
        this.pointerId = null;
    }

    /**
     * Prevent native HTML5 image/link drag
     * @param {DragEvent} e
     */
    onDragStart(e) {
        // Only prevent native drag when actively interacting with slider
        if (this.isDragging || this.isPointerDown) {
            e.preventDefault();
        }
    }

    /**
     * Capture-phase click listener to suppress accidental card navigation ONLY when dragging
     * @param {MouseEvent} e
     */
    onClickCapture(e) {
        if (this.preventClick) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            this.preventClick = false;
        }
    }

    /**
     * Support horizontal trackpad / wheel scroll navigation
     * @param {WheelEvent} e
     */
    onWheel(e) {
        if (this.totalPages <= 1) return;

        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : (e.shiftKey ? e.deltaY : 0);
        if (Math.abs(delta) < 20) return;

        e.preventDefault();

        if (this.wheelDebounceTimeout) return;

        if (delta > 0 && this.currentPage < this.totalPages - 1) {
            this.showPage(this.currentPage + 1, true);
        } else if (delta < 0 && this.currentPage > 0) {
            this.showPage(this.currentPage - 1, true);
        }

        this.wheelDebounceTimeout = setTimeout(() => {
            this.wheelDebounceTimeout = null;
        }, 320);
    }

    /**
     * Bind resize listener with ResizeObserver or window fallback
     */
    bindResizeObserver() {
        this.unbindResizeObserver();

        const container = this.sliderElement?.parentElement;
        if (typeof ResizeObserver !== 'undefined' && container) {
            this.resizeObserver = new ResizeObserver((entries) => {
                for (const entry of entries) {
                    const width = entry.contentRect ? entry.contentRect.width : container.clientWidth;
                    this.onResizeDebounced(width);
                }
            });
            this.resizeObserver.observe(container);
        } else if (typeof window !== 'undefined') {
            window.addEventListener('resize', this.handleResize);
        }
    }

    /**
     * Unbind resize observer/listeners
     */
    unbindResizeObserver() {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
        if (typeof window !== 'undefined') {
            window.removeEventListener('resize', this.handleResize);
        }
        if (this.resizeTimeout) {
            clearTimeout(this.resizeTimeout);
            this.resizeTimeout = null;
        }
    }

    /**
     * Handle window resize event
     */
    handleResize() {
        const container = this.sliderElement?.parentElement;
        const width = container ? container.clientWidth : (typeof window !== 'undefined' ? window.innerWidth : 1280);
        this.onResizeDebounced(width);
    }

    /**
     * Debounced layout adjustment on resize
     * @param {number} width
     */
    onResizeDebounced(width) {
        if (this.resizeTimeout) clearTimeout(this.resizeTimeout);
        this.resizeTimeout = setTimeout(() => {
            if (this.items.length === 0) return;

            const oldTotalPages = this.totalPages;
            this.calculateLayout(width);
            this.totalPages = Math.ceil(this.items.length / this.itemsPerPage);

            if (this.totalPages !== oldTotalPages) {
                this.createPaginationDots();
            }

            const safePage = Math.min(this.currentPage, Math.max(0, this.totalPages - 1));
            this.showPage(safePage, false);
        }, 100);
    }

    /**
     * Render pagination capsule dots and attach click listeners
     */
    createPaginationDots() {
        if (!this.paginationElement) return;

        this.paginationElement.innerHTML = '';
        if (this.totalPages <= 1) return;

        for (let i = 0; i < this.totalPages; i++) {
            const dot = document.createElement('div');
            dot.className = 'pagination-dot';
            dot.dataset.page = i;
            dot.setAttribute('role', 'button');
            dot.setAttribute('aria-label', `Слайд ${i + 1}`);
            dot.addEventListener('click', () => this.showPage(i, true));
            this.paginationElement.appendChild(dot);
        }
    }

    /**
     * Navigate to a specific page index
     * @param {number} pageIndex
     * @param {boolean} [animate=true]
     */
    showPage(pageIndex, animate = true) {
        if (pageIndex < 0 || (this.totalPages > 0 && pageIndex >= this.totalPages)) return;

        this.currentPage = pageIndex;
        const offset = this.getPageOffset(pageIndex);
        this.currentOffset = offset;

        if (this.sliderElement) {
            if (!animate) {
                this.sliderElement.style.transition = 'none';
            } else {
                this.sliderElement.style.transition = '';
            }
            this.sliderElement.style.transform = `translateX(${offset}px)`;
        }

        this.updateActiveDot(pageIndex);
    }

    /**
     * Highlight the active pagination capsule
     * @param {number} pageIndex
     */
    updateActiveDot(pageIndex) {
        if (!this.paginationElement) return;
        const dots = this.paginationElement.querySelectorAll('.pagination-dot');
        dots.forEach((dot, index) => {
            if (index === pageIndex) {
                dot.classList.add('active');
                dot.setAttribute('aria-current', 'true');
            } else {
                dot.classList.remove('active');
                dot.removeAttribute('aria-current');
            }
        });
    }

    /**
     * Clean up listeners and reset state
     */
    destroy() {
        this.unbindResizeObserver();
        this.unbindDragEvents();
        if (this.paginationElement) this.paginationElement.innerHTML = '';
        if (this.sliderElement) {
            this.sliderElement.style.transform = '';
            this.sliderElement.classList.remove('is-dragging');
        }
        this.items = [];
    }
}

if (typeof window !== 'undefined') {
    window.FeaturedSliderController = FeaturedSliderController;
}
