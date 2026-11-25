const painted = new WeakMap();

/**
 * Replaces a block's content only when its markup changed. A page painted from its cache
 * gets the same data from the server a moment later, and rebuilding equal blocks restarts
 * their images and animations.
 * @param {Element} node
 * @param {string} html
 * @param {string} [key] What to compare when the markup carries generated ids
 * @returns {boolean} Whether the content was replaced
 */
export function setMarkup(node, html, key = html) {
    if (painted.get(node) === key && node.childNodes.length > 0) return false;
    painted.set(node, key);
    node.innerHTML = html;
    return true;
}
