/**
 * Shared component for displaying an enlarged image or gallery in a modal overlay (lightbox).
 */
class ImageLightbox {
    static images = [];
    static currentIndex = 0;

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
                overlay.classList.remove('visible');
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
        
        requestAnimationFrame(() => {
            overlay.classList.add('visible');
        });
    }

    static updateDisplay(animate = false) {
        const img = document.getElementById('shared-image-lightbox-image');
        const counter = document.getElementById('shared-image-lightbox-counter');
        const prevBtn = document.getElementById('shared-image-lightbox-prev');
        const nextBtn = document.getElementById('shared-image-lightbox-next');

        if (img && this.images[this.currentIndex]) {
            const nextSrc = this.images[this.currentIndex];
            if (animate && img.src !== nextSrc) {
                img.style.opacity = '0.5';
                img.style.transform = 'scale(0.98)';
                const newImg = new Image();
                newImg.onload = () => {
                    img.src = nextSrc;
                    img.style.opacity = '1';
                    img.style.transform = 'scale(1)';
                };
                newImg.onerror = () => {
                    img.src = nextSrc;
                    img.style.opacity = '1';
                    img.style.transform = 'scale(1)';
                };
                newImg.src = nextSrc;
            } else {
                img.src = nextSrc;
                img.style.opacity = '1';
                img.style.transform = 'scale(1)';
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
