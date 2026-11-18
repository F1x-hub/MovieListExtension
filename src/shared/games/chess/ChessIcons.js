/**
 * Flat piece glyphs for the chess page's HTML (captured pieces, the promotion
 * choice, the move list). Drawn for this project, one 40×40 path set per type;
 * fill and outline come from the page's `--chess-piece-*` content colours
 * through the `.chess-glyph--w` / `--b` classes, so no colour lives here.
 */

const BASE = '<path d="M10.5 31h19a1.6 1.6 0 0 1 1.6 1.6V35H8.9v-2.4a1.6 1.6 0 0 1 1.6-1.6z"/>';

const GLYPHS = {
    p: `<circle cx="20" cy="11.6" r="5"/><path d="M15.6 18.6h8.8l-1.5 3c2.6 2.4 3.9 5.9 4.2 9.4H12.9c.3-3.5 1.6-7 4.2-9.4z"/>${BASE}`,
    r: `<path d="M12 7.5h3.6v3.1h3V7.5h2.8v3.1h3V7.5H28v6.9l-2.6 2.3.9 14.3H13.7l.9-14.3-2.6-2.3z"/>${BASE}`,
    n: `<path d="M13.2 31c.3-4.5 2.2-7.6 5.3-9.8-2.6.3-4.7 1.3-6.5 3.1l-2.6-2.5c1.1-4.5 4-8.9 8.4-11.8l.2-2.9 3.6 1.7c5.4.9 8.9 5.4 8.7 12.5-.1 3.5-.9 6.6-2 9.7z"/><circle class="chess-glyph__eye" cx="21.4" cy="13.6" r="1.1"/>${BASE}`,
    b: `<circle cx="20" cy="6.9" r="2.3"/><path d="M20 9.8c4.3 2.9 6.6 6.8 6.6 10.4 0 2.7-1.4 4.3-3.3 5.2l1 5.6h-8.6l1-5.6c-1.9-.9-3.3-2.5-3.3-5.2 0-3.6 2.3-7.5 6.6-10.4z"/><path class="chess-glyph__cut" d="M18.2 17.4l4.2-4.2"/>${BASE}`,
    q: `<circle cx="20" cy="6.6" r="2.3"/><circle cx="10.2" cy="11.2" r="2"/><circle cx="29.8" cy="11.2" r="2"/><path d="M10.4 13.6l3.4 10.4h12.4l3.4-10.4-4.8 5.1L23 10.4 20 18l-3-7.6-1.8 8.3z"/><path d="M13.9 25.2h12.2l1.3 5.8H12.6z"/>${BASE}`,
    k: `<path d="M18.6 3.4h2.8V6h2.6v2.7h-2.6v2.6h-2.8V8.7H16V6h2.6z"/><path d="M20 12.4c-6.1 0-9.6 3.4-9.6 7.3 0 2.8 1.8 4.8 3.6 6l-.9 5.3h13.8l-.9-5.3c1.8-1.2 3.6-3.2 3.6-6 0-3.9-3.5-7.3-9.6-7.3z"/>${BASE}`
};

const escapeAttribute = text => String(text).replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));

/** Inline SVG of a piece; `label` makes it an image with a name, otherwise it is decorative. */
export function pieceGlyph(type, color, { className = '', label = '' } = {}) {
    const body = GLYPHS[type];
    if (!body) return '';
    const a11y = label ? `role="img" aria-label="${escapeAttribute(label)}"` : 'aria-hidden="true"';
    return `<svg class="chess-glyph chess-glyph--${color === 'b' ? 'b' : 'w'} ${className}" viewBox="0 0 40 40" ${a11y}>${body}</svg>`;
}

export const PIECE_TYPES = Object.freeze(['k', 'q', 'r', 'b', 'n', 'p']);
