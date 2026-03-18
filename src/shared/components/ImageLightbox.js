/**
 * Shared component for displaying an enlarged image in a modal overlay (lightbox).
 */
class ImageLightbox {
    /**
     * Shows the image in a lightbox modal.
     * @param {string} url - The URL of the image to display.
     */
    static show(url) {
        if (!url) return;

        let overlay = document.getElementById('shared-image-lightbox-overlay');
        
        // Create the overlay and its contents if it doesn't exist
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'shared-image-lightbox-overlay';
            overlay.className = 'image-lightbox-overlay';
            
            const img = document.createElement('img');
            img.id = 'shared-image-lightbox-image';
            img.className = 'image-lightbox-image';
            
            const closeBtn = document.createElement('button');
            closeBtn.className = 'image-lightbox-close';
            closeBtn.innerHTML = '✕';
            
            overlay.appendChild(img);
            overlay.appendChild(closeBtn);
            document.body.appendChild(overlay);
            
            const closeLightbox = () => {
                overlay.classList.remove('visible');
            };
            
            closeBtn.addEventListener('click', closeLightbox);
            
            // Close when clicking outside the image
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    closeLightbox();
                }
            });
            
            // Close on Escape key press
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && overlay.classList.contains('visible')) {
                    closeLightbox();
                }
            });
        }
        
        // Update the image source and display it
        const img = document.getElementById('shared-image-lightbox-image');
        img.src = url;
        
        // Small timeout to ensure transition plays if it was just created
        requestAnimationFrame(() => {
            overlay.classList.add('visible');
        });
    }
}

// Make it available globally
window.ImageLightbox = ImageLightbox;
