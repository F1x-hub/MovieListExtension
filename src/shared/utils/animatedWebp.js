/**
 * Animated profile images. A GIF keeps its animation but is a heavy format, so
 * before upload it is re-encoded in the browser as an animated WebP: ImageDecoder
 * reads the frames, a canvas draws each one at the size it is displayed and
 * encodes it as a still WebP, and the stills are joined into one animation here.
 * No encoder library, WebAssembly or server step is involved.
 */

// The profile shows the avatar at 130px and the banner in a 3:1 strip; frames
// larger than twice that only add bytes. A frame is scaled until it still covers
// the box, so the `object-fit: cover` crop keeps its full resolution.
export const ANIMATED_IMAGE_BOX = Object.freeze({
    avatar: Object.freeze({ width: 256, height: 256 }),
    banner: Object.freeze({ width: 1500, height: 500 })
});

const WEBP_QUALITY = 0.75;
const MAX_FRAMES = 600;
const MAX_DURATION_MS = 0xFFFFFF;
// Browsers play a frame of 10 ms or less as 100 ms; the same value keeps the pace.
const DEFAULT_DURATION_MS = 100;

const ANIMATION_FLAG = 0x02;
const ALPHA_FLAG = 0x10;
const NO_BLEND = 0x02;

function fourcc(bytes, offset) {
    return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

function readUint32(bytes, offset) {
    return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function writeAscii(target, offset, text) {
    for (let index = 0; index < text.length; index += 1) target[offset + index] = text.charCodeAt(index);
    return offset + text.length;
}

function writeUint(target, offset, value, byteCount) {
    for (let index = 0; index < byteCount; index += 1) target[offset + index] = (value >>> (8 * index)) & 0xFF;
    return offset + byteCount;
}

function sameBytes(left, right) {
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
        if (left[index] !== right[index]) return false;
    }
    return true;
}

/** Size of a frame scaled down until it still covers `box`; never scaled up. */
export function coverSize(width, height, box) {
    const scale = Math.min(1, Math.max(box.width / width, box.height / height));
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale))
    };
}

/**
 * Takes the image chunks out of a still WebP file. An animation frame carries the
 * same chunks (ALPH, then VP8 or VP8L), each padded to an even length.
 * @param {Uint8Array} bytes
 * @returns {{ data: Uint8Array, hasAlpha: boolean }}
 */
export function readStillWebp(bytes) {
    if (bytes.length < 20 || fourcc(bytes, 0) !== 'RIFF' || fourcc(bytes, 8) !== 'WEBP') {
        throw new Error('Not a WebP file');
    }
    const end = Math.min(bytes.length, readUint32(bytes, 4) + 8);
    const parts = [];
    let length = 0;
    let hasAlpha = false;
    let hasImage = false;
    for (let offset = 12; offset + 8 <= end;) {
        const id = fourcc(bytes, offset);
        const size = readUint32(bytes, offset + 4);
        if (offset + 8 + size > end) throw new Error('Truncated WebP chunk');
        if (id === 'ANIM' || id === 'ANMF') throw new Error('Expected a still WebP frame');
        if (id === 'ALPH' || id === 'VP8 ' || id === 'VP8L') {
            if (id === 'ALPH') hasAlpha = true;
            else hasImage = true;
            // The fifth byte of a lossless header holds its "alpha is used" bit.
            if (id === 'VP8L' && size >= 5 && (bytes[offset + 12] & 0x10)) hasAlpha = true;
            parts.push(bytes.subarray(offset, offset + 8 + size));
            length += 8 + size + (size & 1);
        }
        offset += 8 + size + (size & 1);
    }
    if (!hasImage) throw new Error('WebP frame has no image data');

    const data = new Uint8Array(length);
    let position = 0;
    for (const part of parts) {
        data.set(part, position);
        position += part.length + (part.length & 1);
    }
    return { data, hasAlpha };
}

/**
 * Joins still WebP frames of one size into an animated WebP that loops forever.
 * Every frame replaces the whole canvas, so no frame depends on the one before.
 * @param {Array<{ data: Uint8Array, duration: number }>} frames - still WebP files and their durations in ms
 * @param {{ width: number, height: number }} size - canvas size shared by all frames
 * @returns {Uint8Array}
 */
export function muxAnimatedWebp(frames, { width, height }) {
    if (!Array.isArray(frames) || frames.length === 0) throw new Error('An animation needs at least one frame');
    if (!(width >= 1 && width <= 16383 && height >= 1 && height <= 16383)) throw new Error('Unsupported animation size');

    const stills = frames.map(frame => ({
        ...readStillWebp(frame.data),
        duration: Math.min(MAX_DURATION_MS, Math.max(0, Math.round(Number(frame.duration) || 0)))
    }));
    const bodySize = 4 + 18 + 14 + stills.reduce((sum, still) => sum + 8 + 16 + still.data.length, 0);
    const out = new Uint8Array(8 + bodySize);
    let offset = writeAscii(out, 0, 'RIFF');
    offset = writeUint(out, offset, bodySize, 4);
    offset = writeAscii(out, offset, 'WEBP');

    offset = writeAscii(out, offset, 'VP8X');
    offset = writeUint(out, offset, 10, 4);
    offset = writeUint(out, offset, ANIMATION_FLAG | (stills.some(still => still.hasAlpha) ? ALPHA_FLAG : 0), 4);
    offset = writeUint(out, offset, width - 1, 3);
    offset = writeUint(out, offset, height - 1, 3);

    offset = writeAscii(out, offset, 'ANIM');
    offset = writeUint(out, offset, 6, 4);
    offset = writeUint(out, offset, 0, 4); // background colour: transparent
    offset = writeUint(out, offset, 0, 2); // loop count: forever

    for (const still of stills) {
        offset = writeAscii(out, offset, 'ANMF');
        offset = writeUint(out, offset, 16 + still.data.length, 4);
        offset = writeUint(out, offset, 0, 3); // frame x
        offset = writeUint(out, offset, 0, 3); // frame y
        offset = writeUint(out, offset, width - 1, 3);
        offset = writeUint(out, offset, height - 1, 3);
        offset = writeUint(out, offset, still.duration, 3);
        offset = writeUint(out, offset, NO_BLEND, 1);
        out.set(still.data, offset);
        offset += still.data.length;
    }
    return out;
}

/**
 * Re-encodes an animated image as WebP frames drawn at the display size.
 * @param {Blob} file - an animated image the browser can decode (a GIF)
 * @param {{ width: number, height: number }} box - display box the frames must cover
 * @param {{ quality?: number, isCurrent?: () => boolean }} [options] - `isCurrent`
 *   returning false stops the work, for a file the user has already replaced
 * @returns {Promise<{ bytes: Uint8Array, width: number, height: number, frameCount: number } | null>}
 *   null when the browser cannot decode the file this way or the work was stopped
 */
export async function convertAnimatedImage(file, box, { quality = WEBP_QUALITY, isCurrent = () => true } = {}) {
    if (typeof ImageDecoder !== 'function' || typeof OffscreenCanvas !== 'function') return null;

    const decoder = new ImageDecoder({ data: await file.arrayBuffer(), type: file.type });
    try {
        await decoder.tracks.ready;
        await decoder.completed;
        const frameCount = decoder.tracks.selectedTrack?.frameCount || 0;
        if (frameCount < 1 || frameCount > MAX_FRAMES) return null;

        const frames = [];
        let canvas;
        let context;
        let size;
        for (let index = 0; index < frameCount; index += 1) {
            if (!isCurrent()) return null;
            // The decoder returns every frame fully composed, whatever the GIF's
            // own frame offsets and disposal modes are.
            const { image } = await decoder.decode({ frameIndex: index });
            let duration;
            try {
                if (!canvas) {
                    size = coverSize(image.displayWidth, image.displayHeight, box);
                    canvas = new OffscreenCanvas(size.width, size.height);
                    context = canvas.getContext('2d');
                    context.imageSmoothingEnabled = true;
                    context.imageSmoothingQuality = 'high';
                }
                context.clearRect(0, 0, size.width, size.height);
                context.drawImage(image, 0, 0, size.width, size.height);
                duration = Math.round((image.duration || 0) / 1000) || DEFAULT_DURATION_MS;
            } finally {
                image.close();
            }

            const blob = await canvas.convertToBlob({ type: 'image/webp', quality });
            if (blob.type !== 'image/webp') return null;
            const data = new Uint8Array(await blob.arrayBuffer());
            const previous = frames[frames.length - 1];
            // A frame identical to the one before it only extends that frame.
            if (previous && sameBytes(previous.data, data)) previous.duration += duration;
            else frames.push({ data, duration });
        }

        const bytes = frames.length === 1 ? frames[0].data : muxAnimatedWebp(frames, size);
        return { bytes, width: size.width, height: size.height, frameCount: frames.length };
    } finally {
        decoder.close();
    }
}

/**
 * Smaller animated WebP copy of a profile GIF, ready to upload instead of it.
 * @param {File} file
 * @param {'avatar' | 'banner'} mode
 * @param {{ isCurrent?: () => boolean }} [options]
 * @returns {Promise<File | null>} null when the original should be uploaded:
 *   the browser cannot convert it, or the copy would not be smaller
 */
export async function compressAnimatedImage(file, mode, options = {}) {
    const converted = await convertAnimatedImage(file, ANIMATED_IMAGE_BOX[mode] || ANIMATED_IMAGE_BOX.banner, options);
    if (!converted || converted.bytes.length >= file.size) return null;
    return new File([converted.bytes], `animated-${mode}-${Date.now()}.webp`, { type: 'image/webp' });
}
