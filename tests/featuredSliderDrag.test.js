/**
 * tests/featuredSliderDrag.test.js
 * 
 * Test suite for FeaturedSliderController:
 * - Layout calculations across responsive breakpoints
 * - Pointer drag & swipe gestures (pointerdown, pointermove, pointerup, pointercancel)
 * - Thresholding (vertical scroll rejection vs horizontal swipe engagement)
 * - Real-time translateX translation & rubber-band elastic bounds
 * - Velocity & displacement page snapping
 * - Click capture suppression for movie cards
 * - Horizontal wheel/trackpad scrolling
 * - Lifecycle management and memory cleanups
 */

import assert from 'node:assert';
import fs from 'node:fs';

// Load FeaturedSliderController
const fileContent = fs.readFileSync('src/pages/home/FeaturedSliderController.js', 'utf-8');

// Create a sandbox to evaluate the class
const sandbox = {
    window: {
        addEventListener() {},
        removeEventListener() {}
    },
    document: {
        createElement(tag) {
            const classes = new Set();
            return {
                tagName: tag.toUpperCase(),
                className: '',
                dataset: {},
                classList: {
                    add(c) { classes.add(c); },
                    remove(c) { classes.delete(c); },
                    contains(c) { return classes.has(c); }
                },
                setAttribute() {},
                getAttribute() {},
                removeAttribute() {},
                addEventListener() {},
                removeEventListener() {}
            };
        }
    },
    performance: { now: () => Date.now() },
    ResizeObserver: class {
        observe() {}
        disconnect() {}
    }
};

const fn = new Function('window', 'document', 'performance', 'ResizeObserver', `${fileContent}; return FeaturedSliderController;`);
const FeaturedSliderController = fn(sandbox.window, sandbox.document, sandbox.performance, sandbox.ResizeObserver);

// Mock DOM elements helper
function createMockSliderElement() {
    const listeners = {};
    const classes = new Set();
    const capturedPointers = new Set();

    return {
        tagName: 'DIV',
        parentElement: { clientWidth: 1280 },
        style: {
            transform: '',
            transition: ''
        },
        classList: {
            add(c) { classes.add(c); },
            remove(c) { classes.delete(c); },
            contains(c) { return classes.has(c); }
        },
        querySelectorAll(selector) {
            return [];
        },
        addEventListener(event, handler, useCapture = false) {
            const key = useCapture ? `${event}_capture` : event;
            listeners[key] = listeners[key] || [];
            listeners[key].push(handler);
        },
        removeEventListener(event, handler, useCapture = false) {
            const key = useCapture ? `${event}_capture` : event;
            if (!listeners[key]) return;
            listeners[key] = listeners[key].filter(h => h !== handler);
        },
        dispatchEvent(event, useCapture = false) {
            const key = useCapture ? `${event.type}_capture` : event.type;
            if (listeners[key]) {
                listeners[key].forEach(handler => handler(event));
            }
        },
        setPointerCapture(id) {
            capturedPointers.add(id);
        },
        releasePointerCapture(id) {
            capturedPointers.delete(id);
        },
        hasPointerCapture(id) {
            return capturedPointers.has(id);
        }
    };
}

function createMockPaginationElement() {
    return {
        tagName: 'DIV',
        innerHTML: '',
        children: [],
        appendChild(child) {
            this.children.push(child);
        },
        querySelectorAll(selector) {
            return this.children;
        }
    };
}

console.log('🧪 Running FeaturedSliderController Drag & Gesture Tests...\n');

// 1. Layout calculations
console.log('--- 1. Testing Layout Calculations Across Viewport Widths ---');
{
    const sliderEl = createMockSliderElement();
    const pagEl = createMockPaginationElement();
    const controller = new FeaturedSliderController({ sliderElement: sliderEl, paginationElement: pagEl, gap: 20 });

    controller.calculateLayout(1400);
    assert.strictEqual(controller.itemsPerPage, 5, 'Width >= 1280px should have 5 itemsPerPage');

    controller.calculateLayout(1000);
    assert.strictEqual(controller.itemsPerPage, 4, 'Width >= 960px should have 4 itemsPerPage');

    controller.calculateLayout(700);
    assert.strictEqual(controller.itemsPerPage, 3, 'Width >= 640px should have 3 itemsPerPage');

    controller.calculateLayout(500);
    assert.strictEqual(controller.itemsPerPage, 2, 'Width < 640px should have 2 itemsPerPage');

    console.log('  ✅ 1.1 Responsive itemsPerPage calculated correctly');
}

// 2. getPageOffset and Bounds
console.log('--- 2. Testing Page Offsets and Clamping ---');
{
    const sliderEl = createMockSliderElement();
    const pagEl = createMockPaginationElement();
    const controller = new FeaturedSliderController({ sliderElement: sliderEl, paginationElement: pagEl, gap: 20 });

    const items = Array.from({ length: 10 }, (_, i) => ({ id: i }));
    controller.init(items);

    assert.strictEqual(controller.totalPages, 2, '10 items / 5 per page = 2 pages');
    assert.strictEqual(controller.getPageOffset(0), 0, 'Page 0 offset should be 0');
    assert.ok(controller.getPageOffset(1) < 0, 'Page 1 offset should be negative');

    console.log('  ✅ 2.1 Page offsets calculated accurately');
}

// 3. Pointer Drag Gesture & Intent Thresholding
console.log('--- 3. Testing Pointer Drag Thresholding & Intent Detection ---');
{
    const sliderEl = createMockSliderElement();
    const pagEl = createMockPaginationElement();
    const controller = new FeaturedSliderController({ sliderElement: sliderEl, paginationElement: pagEl, gap: 20 });
    controller.init(Array.from({ length: 10 }, (_, i) => ({ id: i })));

    // Sub-threshold movement / hand jitter (< 10px)
    controller.onPointerDown({ button: 0, clientX: 100, clientY: 100, pointerId: 1, pointerType: 'mouse' });
    assert.strictEqual(controller.isPointerDown, true);
    assert.strictEqual(controller.isDragging, false);

    controller.onPointerMove({ clientX: 105, clientY: 103, pointerId: 1, preventDefault() {} });
    assert.strictEqual(controller.isDragging, false, 'Movement < 10px should be treated as hand jitter and not start drag');

    // Horizontal intent confirmed (>= 10px)
    controller.onPointerMove({ clientX: 115, clientY: 102, pointerId: 1, preventDefault() {} });
    assert.strictEqual(controller.isDragging, true, 'Movement >= 10px horizontally should engage drag');
    assert.strictEqual(sliderEl.classList.contains('is-dragging'), true, 'is-dragging class should be present');

    controller.onPointerUp({ clientX: 115, clientY: 102, pointerId: 1 });
    assert.strictEqual(controller.isDragging, false);
    assert.strictEqual(sliderEl.classList.contains('is-dragging'), false);

    // Vertical intent test (page scroll takeover)
    controller.onPointerDown({ button: 0, clientX: 100, clientY: 100, pointerId: 2, pointerType: 'touch' });
    controller.onPointerMove({ clientX: 101, clientY: 115, pointerId: 2, preventDefault() {} });
    assert.strictEqual(controller.isDragging, false, 'Vertical gesture must cancel horizontal slider drag');
    assert.strictEqual(controller.isPointerDown, false, 'Pointer down state must be cancelled on vertical scroll');

    console.log('  ✅ 3.1 Thresholding ignores hand jitter (< 10px) and distinguishes vertical scroll from horizontal drag');
}

// 4. Rubber-band Bounds Damping
console.log('--- 4. Testing Elastic Rubber-band Bounds Damping ---');
{
    const sliderEl = createMockSliderElement();
    const pagEl = createMockPaginationElement();
    const controller = new FeaturedSliderController({ sliderElement: sliderEl, paginationElement: pagEl, gap: 20 });
    controller.init(Array.from({ length: 10 }, (_, i) => ({ id: i })));

    // Drag past left edge (positive offset)
    controller.onPointerDown({ button: 0, clientX: 100, clientY: 100, pointerId: 1, pointerType: 'mouse' });
    controller.onPointerMove({ clientX: 200, clientY: 100, pointerId: 1, preventDefault() {} }); // +100px drag

    // 100px overflow with 0.25 damping = 25px
    assert.strictEqual(controller.currentOffset, 25, 'Left overflow must be damped by 0.25x');

    controller.onPointerUp({ clientX: 200, clientY: 100, pointerId: 1 });
    // Should snap back to page 0
    assert.strictEqual(controller.currentPage, 0, 'Should snap back to page 0 on left boundary release');
    assert.strictEqual(controller.currentOffset, 0);

    console.log('  ✅ 4.1 Rubber-band damping and edge snap back confirmed');
}

// 5. Velocity Swipe & Page Snapping
console.log('--- 5. Testing Velocity Flick and Distance Snapping ---');
{
    const sliderEl = createMockSliderElement();
    const pagEl = createMockPaginationElement();
    const controller = new FeaturedSliderController({ sliderElement: sliderEl, paginationElement: pagEl, gap: 20 });
    controller.init(Array.from({ length: 10 }, (_, i) => ({ id: i })));

    // Swipe left (advance to page 1)
    controller.onPointerDown({ button: 0, clientX: 500, clientY: 100, pointerId: 1, pointerType: 'mouse' });
    controller.onPointerMove({ clientX: 450, clientY: 100, pointerId: 1, preventDefault() {} });
    controller.onPointerMove({ clientX: 300, clientY: 100, pointerId: 1, preventDefault() {} });

    controller.onPointerUp({ clientX: 300, clientY: 100, pointerId: 1 });
    assert.strictEqual(controller.currentPage, 1, 'Swiping left should advance to page 1');

    // Swipe right (return to page 0)
    controller.onPointerDown({ button: 0, clientX: 300, clientY: 100, pointerId: 2, pointerType: 'mouse' });
    controller.onPointerMove({ clientX: 350, clientY: 100, pointerId: 2, preventDefault() {} });
    controller.onPointerMove({ clientX: 500, clientY: 100, pointerId: 2, preventDefault() {} });

    controller.onPointerUp({ clientX: 500, clientY: 100, pointerId: 2 });
    assert.strictEqual(controller.currentPage, 0, 'Swiping right should return to page 0');

    console.log('  ✅ 5.1 Page navigation via drag gestures verified');
}

// 6. Click Capture Suppression
console.log('--- 6. Testing Click Suppression on Drag vs Normal Click ---');
{
    const sliderEl = createMockSliderElement();
    const pagEl = createMockPaginationElement();
    const controller = new FeaturedSliderController({ sliderElement: sliderEl, paginationElement: pagEl, gap: 20 });
    controller.init(Array.from({ length: 10 }, (_, i) => ({ id: i })));

    // Test A: Normal click (no drag)
    controller.onPointerDown({ button: 0, clientX: 100, clientY: 100, pointerId: 1, pointerType: 'mouse' });
    controller.onPointerUp({ clientX: 100, clientY: 100, pointerId: 1 });

    let clickPrevented = false;
    let clickStopped = false;
    const normalClickEvent = {
        preventDefault() { clickPrevented = true; },
        stopPropagation() { clickStopped = true; },
        stopImmediatePropagation() { clickStopped = true; }
    };
    controller.onClickCapture(normalClickEvent);
    assert.strictEqual(clickPrevented, false, 'Normal click must not be suppressed');

    // Test B: Click after drag (> 6px movement)
    controller.onPointerDown({ button: 0, clientX: 100, clientY: 100, pointerId: 2, pointerType: 'mouse' });
    controller.onPointerMove({ clientX: 150, clientY: 100, pointerId: 2, preventDefault() {} });
    controller.onPointerUp({ clientX: 150, clientY: 100, pointerId: 2 });

    const dragClickEvent = {
        preventDefault() { clickPrevented = true; },
        stopPropagation() { clickStopped = true; },
        stopImmediatePropagation() { clickStopped = true; }
    };
    controller.onClickCapture(dragClickEvent);
    assert.strictEqual(clickPrevented, true, 'Click after dragging must be suppressed to avoid opening movie card');
    assert.strictEqual(clickStopped, true, 'Click after dragging must stop propagation');

    console.log('  ✅ 6.1 Accidental card navigation cleanly prevented after drag gestures');
}

// 7. Horizontal Wheel / Trackpad Scroll Navigation
console.log('--- 7. Testing Wheel & Trackpad Horizontal Navigation ---');
{
    const sliderEl = createMockSliderElement();
    const pagEl = createMockPaginationElement();
    const controller = new FeaturedSliderController({ sliderElement: sliderEl, paginationElement: pagEl, gap: 20 });
    controller.init(Array.from({ length: 10 }, (_, i) => ({ id: i })));

    let wheelDefaultPrevented = false;
    controller.onWheel({
        deltaX: 60,
        deltaY: 0,
        preventDefault() { wheelDefaultPrevented = true; }
    });
    assert.strictEqual(wheelDefaultPrevented, true, 'Horizontal wheel must prevent default');
    assert.strictEqual(controller.currentPage, 1, 'Horizontal wheel delta > 0 must navigate to next page');

    console.log('  ✅ 7.1 Trackpad / wheel horizontal navigation confirmed');
}

// 8. Lifecycle & Cleanups
console.log('--- 8. Testing Destroy & Resource Cleanups ---');
{
    const sliderEl = createMockSliderElement();
    const pagEl = createMockPaginationElement();
    const controller = new FeaturedSliderController({ sliderElement: sliderEl, paginationElement: pagEl, gap: 20 });
    controller.init(Array.from({ length: 10 }, (_, i) => ({ id: i })));

    controller.destroy();
    assert.strictEqual(controller.items.length, 0);
    assert.strictEqual(controller.dragBound, false, 'Drag event listeners must be unbound on destroy');

    console.log('  ✅ 8.1 Controller properly destroyed and cleaned up');
}

console.log('\n🎉 ALL FeaturedSliderController Drag & Gesture Tests Passed Successfully!');
