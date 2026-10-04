/**
 * MovieDetailsModalStack - one keyboard owner for the page's dialogs and
 * popovers.
 *
 * Layers are ordered by `order` (lower is closer to the user). Escape closes
 * the first open layer; Tab is trapped inside the first open layer that
 * declares a focus container. Layers without a container (popovers inside the
 * player) let Tab fall through to the dialog that hosts them.
 */
class MovieDetailsModalStack {
    constructor({ trapFocus } = {}) {
        this.layers = [];
        this.trapFocus = typeof trapFocus === 'function' ? trapFocus : null;
        this.handleKeydown = this.handleKeydown.bind(this);
    }

    /**
     * @param {string} id
     * @param {{ order: number, isOpen: () => boolean, close: (event: KeyboardEvent) => void, getFocusContainer?: () => Element|null, stopPropagation?: boolean }} layer
     */
    register(id, layer) {
        if (!id || !Number.isFinite(layer?.order) || typeof layer?.isOpen !== 'function' || typeof layer?.close !== 'function') {
            throw new TypeError('Modal stack layers need an id, order, isOpen() and close()');
        }
        this.layers = this.layers
            .filter(existing => existing.id !== id)
            .concat({ id, ...layer })
            .sort((first, second) => first.order - second.order);
        return this;
    }

    isLayerOpen(layer) {
        try {
            return Boolean(layer.isOpen());
        } catch {
            return false;
        }
    }

    getTopOpenLayer() {
        return this.layers.find(layer => this.isLayerOpen(layer)) || null;
    }

    getFocusContainer() {
        for (const layer of this.layers) {
            if (typeof layer.getFocusContainer !== 'function' || !this.isLayerOpen(layer)) continue;
            const container = layer.getFocusContainer();
            if (container) return container;
        }
        return null;
    }

    handleKeydown(event) {
        if (event.key === 'Tab') {
            this.trapFocus?.(event, this.getFocusContainer());
            return;
        }
        if (event.key !== 'Escape') return;
        const layer = this.getTopOpenLayer();
        if (!layer) return;
        event.preventDefault();
        if (layer.stopPropagation) event.stopPropagation();
        layer.close(event);
    }

    attach(target = document) {
        target.addEventListener('keydown', this.handleKeydown);
        return () => target.removeEventListener('keydown', this.handleKeydown);
    }
}

if (typeof window !== 'undefined') {
    window.MovieDetailsModalStack = MovieDetailsModalStack;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MovieDetailsModalStack };
}
