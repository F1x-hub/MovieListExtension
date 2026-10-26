import {
    AmbientLight,
    Color,
    DirectionalLight,
    Euler,
    ExtrudeGeometry,
    Group,
    HemisphereLight,
    Mesh,
    MeshPhysicalMaterial,
    MeshStandardMaterial,
    PerspectiveCamera,
    Quaternion,
    Raycaster,
    Scene,
    Shape,
    ShapeGeometry,
    SRGBColorSpace,
    Vector2,
    Vector3,
    WebGLRenderer
} from '../../../libs/three.rubiks.min.js';
import { dot, moveFromLayerTurn } from './RubiksCubeModel.js';

const STICKER_COLORS = {
    white: '#f4f6f8',
    yellow: '#ffd21f',
    red: '#d6202f',
    orange: '#ff6d10',
    green: '#00a651',
    blue: '#0b5fd7'
};
const BODY_COLOR = '#0c0d10';
const CUBIE_SIZE = 0.96;
const STICKER_SIZE = 0.8;
const AXES = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
// Screen pixels before a press becomes a drag, and pixels per quarter turn.
const DRAG_THRESHOLD = 7;
const PIXELS_PER_QUARTER = 130;

function roundedRectShape(size, radius) {
    const half = size / 2;
    const shape = new Shape();
    shape.moveTo(-half + radius, -half);
    shape.lineTo(half - radius, -half);
    shape.quadraticCurveTo(half, -half, half, -half + radius);
    shape.lineTo(half, half - radius);
    shape.quadraticCurveTo(half, half, half - radius, half);
    shape.lineTo(-half + radius, half);
    shape.quadraticCurveTo(-half, half, -half, half - radius);
    shape.lineTo(-half, -half + radius);
    shape.quadraticCurveTo(-half, -half, -half + radius, -half);
    return shape;
}

/** Rounded plastic cubie body: an extruded rounded square with bevelled faces. */
function createBodyGeometry() {
    const bevel = 0.07;
    const geometry = new ExtrudeGeometry(roundedRectShape(CUBIE_SIZE - bevel * 2, 0.08), {
        depth: CUBIE_SIZE - bevel * 2,
        bevelEnabled: true,
        bevelThickness: bevel,
        bevelSize: bevel,
        bevelSegments: 3,
        curveSegments: 4
    });
    geometry.center();
    return geometry;
}

function easeOutCubic(t) {
    return 1 - (1 - t) ** 3;
}

function roundAxis(vector) {
    const values = [vector.x, vector.y, vector.z];
    const index = values.reduce((best, value, i) => (Math.abs(value) > Math.abs(values[best]) ? i : best), 0);
    const axis = [0, 0, 0];
    axis[index] = Math.sign(values[index]);
    return axis;
}

/**
 * WebGL view of the cube: 27 rounded cubies, layer turns animated on a pivot,
 * free arcball rotation on the background and drag-to-turn on the stickers.
 * The renderer never owns the puzzle state; it recolours itself from the model
 * after every committed move.
 */
export class RubiksCubeRenderer {
    static isSupported(doc = globalThis.document) {
        if (typeof globalThis.WebGLRenderingContext === 'undefined') return false;
        try {
            const canvas = doc.createElement('canvas');
            return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
        } catch {
            return false;
        }
    }

    /**
     * @param {HTMLElement} host - element the canvas fills
     * @param {{ size?: number, getState: () => import('./RubiksCubeModel.js').RubiksCubeState,
     *   canInteract: () => boolean, onLayerTurn: (move: string) => void }} options
     */
    constructor(host, { size = 3, getState, canInteract, onLayerTurn }) {
        this.host = host;
        this.size = size;
        this.getState = getState;
        this.canInteract = canInteract;
        this.onLayerTurn = onLayerTurn;
        this.frame = null;
        this.needsRender = true;
        this.activeTurn = null;
        this.pointer = null;
        this.disposed = false;

        this.renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
        this.renderer.outputColorSpace = SRGBColorSpace;
        this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
        this.canvas = this.renderer.domElement;
        this.canvas.className = 'rubiks-canvas';
        host.appendChild(this.canvas);

        this.scene = new Scene();
        this.camera = new PerspectiveCamera(32, 1, 0.1, 100);
        this.camera.position.set(0, 0, this.cameraDistance());
        this.scene.add(new HemisphereLight('#ffffff', '#30343c', 1.1));
        this.scene.add(new AmbientLight('#ffffff', 0.35));
        const key = new DirectionalLight('#ffffff', 2.1);
        key.position.set(4, 7, 6);
        this.scene.add(key);
        const rim = new DirectionalLight('#9fb4ff', 0.6);
        rim.position.set(-6, -3, -4);
        this.scene.add(rim);

        this.root = new Group();
        this.root.quaternion.setFromEuler(new Euler(0.45, -0.62, 0));
        this.scene.add(this.root);
        this.pivot = new Group();
        this.root.add(this.pivot);

        this.buildCubies();
        this.raycaster = new Raycaster();
        this.bindPointer();
        this.resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.resize()) : null;
        this.resizeObserver?.observe(host);
        this.resize();
        this.syncColors();
        this.loop = this.loop.bind(this);
        this.frame = requestAnimationFrame(this.loop);
    }

    buildCubies() {
        this.bodyGeometry = createBodyGeometry();
        this.stickerGeometry = new ShapeGeometry(roundedRectShape(STICKER_SIZE, 0.11), 4);
        this.bodyMaterial = new MeshStandardMaterial({ color: BODY_COLOR, roughness: 0.55, metalness: 0.05 });
        this.stickerMaterials = Object.fromEntries(Object.entries(STICKER_COLORS).map(([name, hex]) => [
            name,
            new MeshPhysicalMaterial({ color: new Color(hex), roughness: 0.28, clearcoat: 0.6, clearcoatRoughness: 0.25 })
        ]));
        this.cubies = [];
        this.stickers = [];
        const max = this.size - 1;
        const coordinates = Array.from({ length: this.size }, (_, index) => 2 * index - max);
        // Grid positions are the model's doubled coordinates; only the shell is built.
        coordinates.forEach(x => coordinates.forEach(y => coordinates.forEach(z => {
            const grid = [x, y, z];
            if (!grid.some(value => Math.abs(value) === max)) return;
            const cubie = new Group();
            cubie.userData.grid = grid;
            cubie.position.set(x / 2, y / 2, z / 2);
            const body = new Mesh(this.bodyGeometry, this.bodyMaterial);
            body.userData.cubie = cubie;
            cubie.add(body);
            [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].forEach(normal => {
                if (dot(normal, grid) !== max) return;
                const sticker = new Mesh(this.stickerGeometry, this.stickerMaterials.white);
                const n = new Vector3(...normal);
                sticker.position.copy(n).multiplyScalar(CUBIE_SIZE / 2 + 0.004);
                sticker.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), n);
                sticker.userData = { cubie, normal };
                cubie.add(sticker);
                this.stickers.push(sticker);
            });
            this.root.add(cubie);
            this.cubies.push(cubie);
        })));
    }

    /** Puts every cubie back on its grid slot and paints stickers from the model. */
    syncColors() {
        const state = this.getState();
        this.cubies.forEach(cubie => {
            if (cubie.parent !== this.root) this.root.attach(cubie);
            cubie.position.set(...cubie.userData.grid.map(value => value / 2));
            cubie.quaternion.identity();
        });
        this.pivot.quaternion.identity();
        this.stickers.forEach(sticker => {
            const color = state.colorAt(sticker.userData.cubie.userData.grid, sticker.userData.normal);
            sticker.material = this.stickerMaterials[color] || this.bodyMaterial;
        });
        this.requestRender();
    }

    requestRender() {
        this.needsRender = true;
    }

    /** Keeps cubes of every size filling about the same share of the view. */
    cameraDistance() {
        // A turned cube's silhouette is about 1.75 edges tall; fit it into the
        // vertical field of view, measured from the cube's front.
        const halfFov = (this.camera.fov * Math.PI) / 360;
        return this.size * (0.875 / Math.tan(halfFov) + 0.5);
    }

    resize() {
        const width = this.host.clientWidth || 1;
        const height = this.host.clientHeight || 1;
        this.renderer.setSize(width, height, false);
        this.camera.aspect = width / height;
        // Keep the whole cube in frame on narrow viewports.
        this.camera.position.z = this.cameraDistance() * (width < height ? (height / width) * 0.95 : 1);
        this.camera.updateProjectionMatrix();
        this.requestRender();
    }

    loop(time) {
        if (this.disposed) return;
        if (this.activeTurn?.animation) this.stepAnimation(time);
        if (this.needsRender) {
            this.needsRender = false;
            this.renderer.render(this.scene, this.camera);
        }
        this.frame = requestAnimationFrame(this.loop);
    }

    /** Collects the cubies of a layer onto the pivot, ready to rotate. */
    grabLayer(axis, layers) {
        this.pivot.quaternion.identity();
        this.cubies.forEach(cubie => {
            if (layers.includes(dot(cubie.userData.grid, axis))) this.pivot.attach(cubie);
        });
    }

    setPivotAngle(axis, angle) {
        this.pivot.quaternion.setFromAxisAngle(new Vector3(...axis), angle);
        this.requestRender();
    }

    /** Animates a parsed move; resolves once the layer has landed. */
    animateMove(parsed, duration) {
        return new Promise(resolve => {
            if (this.disposed) { resolve(); return; }
            this.grabLayer(parsed.axis, parsed.layers);
            this.startAnimation(parsed.axis, 0, parsed.direction * parsed.quarterTurns * Math.PI / 2, duration, resolve);
        });
    }

    /**
     * Turns the pivot from one angle to another. Hidden tabs stop animation
     * frames, so a timer lands the layer anyway and the move queue never stalls.
     */
    startAnimation(axis, from, to, duration, onDone) {
        const animation = { from, to, duration: Math.max(1, duration), start: null, onDone, timer: null };
        animation.timer = setTimeout(() => this.completeAnimation(animation), animation.duration + 150);
        this.activeTurn = { axis, animation };
        this.requestRender();
    }

    completeAnimation(animation) {
        if (this.activeTurn?.animation !== animation) return;
        clearTimeout(animation.timer);
        this.setPivotAngle(this.activeTurn.axis, animation.to);
        this.activeTurn = null;
        animation.onDone();
    }

    stepAnimation(time) {
        const turn = this.activeTurn;
        const animation = turn.animation;
        if (animation.start === null) animation.start = time;
        const progress = Math.min(1, (time - animation.start) / animation.duration);
        if (progress >= 1) {
            this.completeAnimation(animation);
            return;
        }
        this.setPivotAngle(turn.axis, animation.from + (animation.to - animation.from) * easeOutCubic(progress));
    }

    isBusy() {
        return Boolean(this.activeTurn);
    }

    // --- Pointer input ---------------------------------------------------------

    bindPointer() {
        const canvas = this.canvas;
        this.handlers = {
            down: event => this.onPointerDown(event),
            move: event => this.onPointerMove(event),
            up: event => this.onPointerUp(event)
        };
        canvas.addEventListener('pointerdown', this.handlers.down);
        canvas.addEventListener('pointermove', this.handlers.move);
        canvas.addEventListener('pointerup', this.handlers.up);
        canvas.addEventListener('pointercancel', this.handlers.up);
    }

    pointerNdc(event) {
        const rect = this.canvas.getBoundingClientRect();
        return new Vector2(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            -((event.clientY - rect.top) / rect.height) * 2 + 1
        );
    }

    onPointerDown(event) {
        if (event.button !== 0 || this.pointer) return;
        // Matrices are refreshed by rendering, which may not have run yet.
        this.scene.updateMatrixWorld();
        this.camera.updateMatrixWorld();
        this.raycaster.setFromCamera(this.pointerNdc(event), this.camera);
        const hit = this.canInteract() && !this.isBusy()
            ? this.raycaster.intersectObjects(this.stickers, false)[0]
            : null;
        this.pointer = {
            id: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            lastX: event.clientX,
            lastY: event.clientY,
            sticker: hit?.object || null,
            mode: null
        };
        this.capturePointer('set', event.pointerId);
        this.canvas.classList.add('is-dragging');
    }

    onPointerMove(event) {
        const pointer = this.pointer;
        if (!pointer || event.pointerId !== pointer.id) return;
        const dx = event.clientX - pointer.startX;
        const dy = event.clientY - pointer.startY;
        if (!pointer.mode) {
            if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
            pointer.mode = pointer.sticker && this.beginLayerDrag(pointer, dx, dy) ? 'layer' : 'orbit';
        }
        if (pointer.mode === 'orbit') {
            this.orbit(event.clientX - pointer.lastX, event.clientY - pointer.lastY);
        } else {
            const drag = pointer.layer;
            const along = dx * drag.screenDir.x + dy * drag.screenDir.y;
            drag.angle = (along / PIXELS_PER_QUARTER) * (Math.PI / 2) * drag.sign;
            this.setPivotAngle(drag.axis, drag.angle);
        }
        pointer.lastX = event.clientX;
        pointer.lastY = event.clientY;
    }

    onPointerUp(event) {
        const pointer = this.pointer;
        if (!pointer || event.pointerId !== pointer.id) return;
        this.pointer = null;
        this.capturePointer('release', event.pointerId);
        this.canvas.classList.remove('is-dragging');
        if (pointer.mode === 'layer') this.finishLayerDrag(pointer.layer);
    }

    /** Pointer capture can throw for a pointer the browser no longer tracks. */
    capturePointer(action, pointerId) {
        try {
            this.canvas[`${action}PointerCapture`]?.(pointerId);
        } catch { /* Dragging still works without capture. */ }
    }

    /** Free rotation of the whole cube about the camera's screen axes. */
    orbit(dx, dy) {
        const speed = 0.0095;
        const yaw = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), dx * speed);
        const pitch = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), dy * speed);
        this.root.quaternion.premultiply(yaw).premultiply(pitch).normalize();
        this.requestRender();
    }

    /** Projects a cube-local direction from a point to a normalised screen vector. */
    screenDirection(localPoint, localDir) {
        const rect = this.canvas.getBoundingClientRect();
        const toScreen = point => {
            const projected = this.root.localToWorld(point.clone()).project(this.camera);
            return new Vector2((projected.x + 1) * rect.width / 2, (1 - projected.y) * rect.height / 2);
        };
        const a = toScreen(localPoint);
        const b = toScreen(localPoint.clone().add(localDir.clone().multiplyScalar(0.5)));
        return b.sub(a);
    }

    /**
     * Picks the layer a sticker drag turns: of the two directions lying in the
     * sticker's face, the one closest to the drag on screen wins, and the layer
     * rotates about the axis perpendicular to both.
     */
    beginLayerDrag(pointer, dx, dy) {
        const { cubie, normal } = pointer.sticker.userData;
        const grid = cubie.userData.grid;
        const center = new Vector3(...grid).multiplyScalar(0.5).add(new Vector3(...normal).multiplyScalar(0.5));
        const drag = new Vector2(dx, dy).normalize();
        let best = null;
        AXES.forEach(tangent => {
            if (dot(tangent, normal) !== 0) return;
            const screen = this.screenDirection(center, new Vector3(...tangent));
            if (screen.lengthSq() < 1e-6) return;
            const score = screen.clone().normalize().dot(drag);
            if (!best || Math.abs(score) > Math.abs(best.score)) best = { tangent, screen, score };
        });
        if (!best) return false;
        const n = new Vector3(...normal);
        const axisVector = n.clone().cross(new Vector3(...best.tangent));
        const axis = roundAxis(axisVector);
        // Dragging along +tangent on a face with normal n turns the layer about n×t.
        const screenDir = best.screen.clone().normalize();
        pointer.layer = {
            axis,
            layer: dot(grid, axis),
            screenDir,
            sign: 1,
            angle: 0
        };
        this.grabLayer(axis, [pointer.layer.layer]);
        this.activeTurn = { axis, drag: true };
        return true;
    }

    finishLayerDrag(drag) {
        const quarter = Math.PI / 2;
        // A third of a quarter turn commits the first turn, like a real cube's
        // snap; beyond that the layer lands on the nearest quarter.
        const raw = drag.angle / quarter;
        const size = Math.abs(raw) < 1 ? (Math.abs(raw) > 0.33 ? 1 : 0) : Math.round(Math.abs(raw));
        const quarters = Math.sign(raw) * size;
        const target = quarters * quarter;
        const start = drag.angle;
        this.startAnimation(drag.axis, start, target, 90 + Math.abs(target - start) * 120, () => {
            const move = moveFromLayerTurn(drag.axis, drag.layer, quarters, this.size);
            if (move) this.onLayerTurn(move);
            else this.syncColors();
        });
    }

    /** Rotates the view to a default angle (used by the "reset view" control). */
    resetView() {
        this.root.quaternion.setFromEuler(new Euler(0.45, -0.62, 0));
        this.requestRender();
    }

    /** Arrow-key view rotation in quarter steps of free rotation. */
    nudgeView(dx, dy) {
        this.orbit(dx, dy);
    }

    dispose() {
        this.disposed = true;
        if (this.frame !== null) cancelAnimationFrame(this.frame);
        clearTimeout(this.activeTurn?.animation?.timer);
        this.activeTurn = null;
        this.resizeObserver?.disconnect();
        this.canvas.removeEventListener('pointerdown', this.handlers.down);
        this.canvas.removeEventListener('pointermove', this.handlers.move);
        this.canvas.removeEventListener('pointerup', this.handlers.up);
        this.canvas.removeEventListener('pointercancel', this.handlers.up);
        this.bodyGeometry.dispose();
        this.stickerGeometry.dispose();
        this.bodyMaterial.dispose();
        Object.values(this.stickerMaterials).forEach(material => material.dispose());
        this.renderer.dispose();
        this.renderer.forceContextLoss?.();
        this.canvas.remove();
    }
}
