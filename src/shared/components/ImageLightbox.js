/**
 * Shared component for displaying an enlarged image or gallery in a modal overlay (lightbox).
 */
class ImageLightbox {
    static images = [];
    static currentIndex = 0;
    static imageGeneration = 0;
    static imageAnimation = null;
    static previousImage = null;

    /**
     * Extracts a valid image URL string from various input formats (string, object with url/previewUrl/src/image).
     * @param {string|object} item 
     * @returns {string}
     */
    static _normalizeUrl(item) {
        if (typeof item === 'string') return item.trim();
        if (item && typeof item === 'object') {
            return (item.url || item.previewUrl || item.src || item.image || (item.poster && item.poster.url) || (item.backdrop && item.backdrop.url) || '').trim();
        }
        return '';
    }

    /**
     * Shows the image or gallery in a lightbox modal.
     * @param {string|object|Array<string|object>} urlOrUrls - The URL of the image or array of URLs/objects to display.
     * @param {number} initialIndex - Starting index in the array.
     */
    static show(urlOrUrls, initialIndex = 0) {
        if (!urlOrUrls) return;

        if (Array.isArray(urlOrUrls)) {
            this.images = urlOrUrls.map(item => this._normalizeUrl(item)).filter(Boolean);
            this.currentIndex = Math.max(0, Math.min(initialIndex, this.images.length - 1));
        } else {
            const url = this._normalizeUrl(urlOrUrls);
            this.images = url ? [url] : [];
            this.currentIndex = 0;
        }

        if (this.images.length === 0) return;

        let overlay = document.getElementById('shared-image-lightbox-overlay');
        
        // Create the overlay and its contents if it doesn't exist
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'shared-image-lightbox-overlay';
            overlay.className = 'image-lightbox-overlay';
            
            const img = document.createElement('img');
            img.id = 'shared-image-lightbox-image';
            img.className = 'image-lightbox-image';

            const counter = document.createElement('div');
            counter.id = 'shared-image-lightbox-counter';
            counter.className = 'image-lightbox-counter';
            
            const closeBtn = document.createElement('button');
            closeBtn.className = 'image-lightbox-close';
            closeBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
            closeBtn.setAttribute('title', 'Закрыть (Esc)');

            const prevBtn = document.createElement('button');
            prevBtn.id = 'shared-image-lightbox-prev';
            prevBtn.className = 'image-lightbox-nav prev';
            prevBtn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>';
            prevBtn.setAttribute('title', 'Предыдущее фото (←)');

            const nextBtn = document.createElement('button');
            nextBtn.id = 'shared-image-lightbox-next';
            nextBtn.className = 'image-lightbox-nav next';
            nextBtn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';
            nextBtn.setAttribute('title', 'Следующее фото (→)');
            
            overlay.appendChild(img);
            overlay.appendChild(counter);
            overlay.appendChild(closeBtn);
            overlay.appendChild(prevBtn);
            overlay.appendChild(nextBtn);
            document.body.appendChild(overlay);
            
            const closeLightbox = () => {
                ImageLightbox.imageGeneration++;
                ImageLightbox.clearImageMotion();
                overlay.classList.remove('visible');
                overlay.inert = true;
                overlay.setAttribute('aria-hidden', 'true');
            };
            
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                closeLightbox();
            });

            prevBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                ImageLightbox.prev();
            });

            nextBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                ImageLightbox.next();
            });

            // Directional cursor and tooltip feedback on mouse movement over image
            img.addEventListener('mousemove', (e) => {
                if (ImageLightbox.images.length <= 1) {
                    img.style.cursor = 'default';
                    img.removeAttribute('title');
                    return;
                }
                const rect = img.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                const isRight = clickX > (rect.width / 2);
                img.style.cursor = isRight ? 'e-resize' : 'w-resize';
                img.setAttribute('title', isRight ? 'Следующее фото (→)' : 'Предыдущее фото (←)');
            });

            // Click left/right half of image to navigate
            img.addEventListener('click', (e) => {
                e.stopPropagation();
                if (ImageLightbox.images.length <= 1) return;

                const rect = img.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                if (clickX > rect.width / 2) {
                    ImageLightbox.next();
                } else {
                    ImageLightbox.prev();
                }
            });

            // Touch swipe gesture support for mobile / touch devices
            let touchStartX = 0;
            let touchStartY = 0;
            overlay.addEventListener('touchstart', (e) => {
                if (e.changedTouches && e.changedTouches[0]) {
                    touchStartX = e.changedTouches[0].clientX;
                    touchStartY = e.changedTouches[0].clientY;
                }
            }, { passive: true });

            overlay.addEventListener('touchend', (e) => {
                if (e.changedTouches && e.changedTouches[0]) {
                    const diffX = e.changedTouches[0].clientX - touchStartX;
                    const diffY = e.changedTouches[0].clientY - touchStartY;
                    if (Math.abs(diffX) > 40 && Math.abs(diffX) > Math.abs(diffY)) {
                        if (diffX < 0) {
                            ImageLightbox.next();
                        } else {
                            ImageLightbox.prev();
                        }
                    }
                }
            }, { passive: true });
            
            // Close when clicking outside the image
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    closeLightbox();
                }
            });
            
            // Keyboard navigation
            document.addEventListener('keydown', (e) => {
                if (!overlay.classList.contains('visible')) return;
                
                if (e.key === 'Escape') {
                    closeLightbox();
                } else if (e.key === 'ArrowRight') {
                    ImageLightbox.next();
                } else if (e.key === 'ArrowLeft') {
                    ImageLightbox.prev();
                }
            });
        }
        
        ImageLightbox.updateDisplay(false);
        
        overlay.inert = false;
        overlay.setAttribute('aria-hidden', 'false');
        overlay.classList.add('visible');
    }

    static clearImageMotion() {
        this.imageAnimation?.cancel();
        this.imageAnimation = null;
        this.previousImage?.remove();
        this.previousImage = null;
    }

    static updateDisplay(animate = false) {
        const img = document.getElementById('shared-image-lightbox-image');
        const counter = document.getElementById('shared-image-lightbox-counter');
        const prevBtn = document.getElementById('shared-image-lightbox-prev');
        const nextBtn = document.getElementById('shared-image-lightbox-next');

        if (img && this.images[this.currentIndex]) {
            const nextSrc = this.images[this.currentIndex];
            const generation = ++this.imageGeneration;
            this.clearImageMotion();
            const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
            if (animate && !reduced && img.getAttribute('src') !== nextSrc) {
                const preload = new Image();
                let settled = false;
                const commit = () => {
                    if (settled) return;
                    settled = true;
                    if (generation !== this.imageGeneration || !img.isConnected) return;
                    const overlay = img.parentElement;
                    if (!overlay.classList.contains('visible')) return;
                    // Keep the old pixels while the new image decodes. The copy is
                    // purely visual and cannot retain navigation or focus.
                    const old = img.cloneNode(false);
                    old.removeAttribute('id');
                    old.className = 'image-lightbox-crossfade';
                    old.setAttribute('aria-hidden', 'true');
                    const rect = img.getBoundingClientRect();
                    Object.assign(old.style, {
                        position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`,
                        width: `${rect.width}px`, height: `${rect.height}px`,
                        pointerEvents: 'none', objectFit: 'contain'
                    });
                    img.src = nextSrc;
                    if (typeof img.animate !== 'function'
                        || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
                    overlay.appendChild(old);
                    this.previousImage = old;
                    const styles = getComputedStyle(img);
                    const options = {
                        duration: parseFloat(styles.getPropertyValue('--motion-duration-menu')) || 160,
                        easing: styles.getPropertyValue('--motion-ease-out').trim() || 'ease-out'
                    };
                    const animation = img.animate([{ opacity: 0 }, { opacity: 1 }], options);
                    this.imageAnimation = animation;
                    const outgoing = old.animate([{ opacity: 1 }, { opacity: 0 }], options);
                    outgoing.finished.catch(() => {}).then(() => old.remove());
                    animation.finished.catch(() => {}).then(() => {
                        if (this.imageAnimation === animation) this.imageAnimation = null;
                        if (this.previousImage === old) this.previousImage = null;
                        old.remove();
                    });
                };
                preload.onload = () => {
                    if (typeof preload.decode === 'function') {
                        preload.decode().catch(() => {}).then(commit);
                    } else commit();
                };
                preload.onerror = commit;
                preload.src = nextSrc;
                if (preload.complete) {
                    if (preload.naturalWidth) preload.onload();
                    else commit();
                }
            } else {
                img.src = nextSrc;
            }
        }

        const isMultiple = this.images.length > 1;
        if (counter) {
            counter.style.display = isMultiple ? 'block' : 'none';
            counter.textContent = `${this.currentIndex + 1} / ${this.images.length}`;
        }
        if (prevBtn) prevBtn.style.display = isMultiple ? 'flex' : 'none';
        if (nextBtn) nextBtn.style.display = isMultiple ? 'flex' : 'none';
    }

    static next() {
        if (this.images.length <= 1) return;
        this.currentIndex = (this.currentIndex + 1) % this.images.length;
        this.updateDisplay(true);
    }

    static prev() {
        if (this.images.length <= 1) return;
        this.currentIndex = (this.currentIndex - 1 + this.images.length) % this.images.length;
        this.updateDisplay(true);
    }
}

// Make it available globally
window.ImageLightbox = ImageLightbox;
