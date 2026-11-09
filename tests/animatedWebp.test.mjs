import assert from 'node:assert/strict';
import {
    ANIMATED_IMAGE_BOX,
    compressAnimatedImage,
    convertAnimatedImage,
    coverSize,
    muxAnimatedWebp,
    readStillWebp
} from '../src/shared/utils/animatedWebp.js';

const ascii = text => [...text].map(char => char.charCodeAt(0));
const uint = (value, byteCount) => Array.from({ length: byteCount }, (_, index) => (value >>> (8 * index)) & 0xFF);
const chunk = (id, payload) => [...ascii(id), ...uint(payload.length, 4), ...payload, ...(payload.length & 1 ? [0] : [])];
const riff = (...chunks) => {
    const body = [...ascii('WEBP'), ...chunks.flat()];
    return new Uint8Array([...ascii('RIFF'), ...uint(body.length, 4), ...body]);
};
const readUint = (bytes, offset, byteCount) => {
    let value = 0;
    for (let index = 0; index < byteCount; index += 1) value += bytes[offset + index] * 2 ** (8 * index);
    return value;
};
const text = (bytes, offset) => String.fromCharCode(...bytes.subarray(offset, offset + 4));

// --- Display size ----------------------------------------------------------
assert.deepEqual(coverSize(445, 688, ANIMATED_IMAGE_BOX.avatar), { width: 256, height: 396 },
    'the shorter side reaches the box, so a cover crop keeps its resolution');
assert.deepEqual(coverSize(512, 512, ANIMATED_IMAGE_BOX.avatar), { width: 256, height: 256 });
assert.deepEqual(coverSize(128, 128, ANIMATED_IMAGE_BOX.avatar), { width: 128, height: 128 }, 'never scaled up');
assert.deepEqual(coverSize(640, 480, ANIMATED_IMAGE_BOX.banner), { width: 640, height: 480 }, 'never scaled up');
assert.deepEqual(coverSize(3000, 1000, ANIMATED_IMAGE_BOX.banner), { width: 1500, height: 500 });
assert.deepEqual(coverSize(4000, 500, ANIMATED_IMAGE_BOX.banner), { width: 4000, height: 500 },
    'a strip already at the box height is not shrunk below it');
assert.deepEqual(coverSize(1, 9000, { width: 256, height: 256 }), { width: 1, height: 9000 });

// --- Reading a still frame -------------------------------------------------
const lossyPayload = [1, 2, 3, 4, 5]; // odd length: the chunk carries one pad byte
const lossy = riff(chunk('VP8 ', lossyPayload));
assert.deepEqual([...readStillWebp(lossy).data], chunk('VP8 ', lossyPayload));
assert.equal(readStillWebp(lossy).hasAlpha, false);
assert.equal(readStillWebp(lossy).data.length % 2, 0);

// A file that ends without the pad byte still yields an even-sized chunk.
assert.deepEqual([...readStillWebp(lossy.subarray(0, lossy.length - 1)).data], chunk('VP8 ', lossyPayload));

const extended = riff(
    chunk('VP8X', [0x10, 0, 0, 0, 9, 0, 0, 9, 0, 0]),
    chunk('ICCP', [7, 7, 7]),
    chunk('ALPH', [9, 9, 9]),
    chunk('VP8 ', [4, 4]),
    chunk('EXIF', [1])
);
const extendedFrame = readStillWebp(extended);
assert.deepEqual([...extendedFrame.data], [...chunk('ALPH', [9, 9, 9]), ...chunk('VP8 ', [4, 4])],
    'only the image chunks travel into an animation frame, in file order');
assert.equal(extendedFrame.hasAlpha, true);

assert.equal(readStillWebp(riff(chunk('VP8L', [0x2F, 0, 0, 0, 0x10, 0]))).hasAlpha, true, 'lossless alpha bit');
assert.equal(readStillWebp(riff(chunk('VP8L', [0x2F, 0, 0, 0, 0x00, 0]))).hasAlpha, false);

assert.throws(() => readStillWebp(new Uint8Array(40)), /Not a WebP file/);
assert.throws(() => readStillWebp(riff(chunk('EXIF', [1, 2]))), /no image data/);
assert.throws(() => readStillWebp(riff(chunk('ANIM', [0, 0, 0, 0, 0, 0]), chunk('VP8 ', [1, 2]))), /still WebP frame/);
const truncated = riff(chunk('VP8 ', [1, 2, 3, 4, 5, 6]));
truncated[16] = 200; // the chunk claims more bytes than the file has
assert.throws(() => readStillWebp(truncated), /Truncated/);

// --- Joining frames --------------------------------------------------------
const first = riff(chunk('VP8 ', [1, 2, 3]));
const second = riff(chunk('VP8X', [0x10, 0, 0, 0, 0, 0, 0, 0, 0, 0]), chunk('ALPH', [5]), chunk('VP8 ', [6, 7]));
const animation = muxAnimatedWebp([
    { data: first, duration: 120 },
    { data: second, duration: 40.4 }
], { width: 300, height: 7 });

assert.equal(text(animation, 0), 'RIFF');
assert.equal(readUint(animation, 4, 4), animation.length - 8, 'the RIFF size covers the whole file');
assert.equal(text(animation, 8), 'WEBP');

// Walk the chunks: the file must be exactly VP8X, ANIM, then one ANMF per frame.
const walked = [];
for (let offset = 12; offset < animation.length;) {
    const size = readUint(animation, offset + 4, 4);
    walked.push({ id: text(animation, offset), offset: offset + 8, size });
    offset += 8 + size + (size & 1);
}
assert.deepEqual(walked.map(item => item.id), ['VP8X', 'ANIM', 'ANMF', 'ANMF']);

const [header, loop, frameOne, frameTwo] = walked;
assert.equal(header.size, 10);
assert.equal(animation[header.offset], 0x02 | 0x10, 'animation flag, plus alpha because one frame is transparent');
assert.equal(readUint(animation, header.offset + 4, 3), 299, 'canvas width - 1');
assert.equal(readUint(animation, header.offset + 7, 3), 6, 'canvas height - 1');
assert.equal(loop.size, 6);
assert.equal(readUint(animation, loop.offset + 4, 2), 0, 'loops forever');

const frameFields = frame => ({
    x: readUint(animation, frame.offset, 3),
    y: readUint(animation, frame.offset + 3, 3),
    width: readUint(animation, frame.offset + 6, 3) + 1,
    height: readUint(animation, frame.offset + 9, 3) + 1,
    duration: readUint(animation, frame.offset + 12, 3),
    flags: animation[frame.offset + 15],
    data: [...animation.subarray(frame.offset + 16, frame.offset + frame.size)]
});
assert.deepEqual(frameFields(frameOne), {
    x: 0, y: 0, width: 300, height: 7, duration: 120, flags: 0x02, data: chunk('VP8 ', [1, 2, 3])
}, 'a frame replaces the whole canvas instead of blending over the previous one');
assert.deepEqual(frameFields(frameTwo), {
    x: 0, y: 0, width: 300, height: 7, duration: 40, flags: 0x02, data: [...chunk('ALPH', [5]), ...chunk('VP8 ', [6, 7])]
});

const opaque = muxAnimatedWebp([{ data: first, duration: 1 }, { data: first, duration: 1 }], { width: 2, height: 2 });
assert.equal(opaque[20], 0x02, 'no alpha flag without a transparent frame');

const clamped = muxAnimatedWebp([
    { data: first, duration: 99_999_999 },
    { data: first, duration: -5 },
    { data: first, duration: 'soon' }
], { width: 2, height: 2 });
const durations = [];
for (let offset = 12; offset < clamped.length;) {
    const size = readUint(clamped, offset + 4, 4);
    if (text(clamped, offset) === 'ANMF') durations.push(readUint(clamped, offset + 20, 3));
    offset += 8 + size + (size & 1);
}
assert.deepEqual(durations, [0xFFFFFF, 0, 0], 'durations fit their 24-bit field');

assert.throws(() => muxAnimatedWebp([], { width: 2, height: 2 }), /at least one frame/);
assert.throws(() => muxAnimatedWebp([{ data: first, duration: 1 }], { width: 0, height: 2 }), /Unsupported animation size/);
assert.throws(() => muxAnimatedWebp([{ data: first, duration: 1 }], { width: 2, height: 20000 }), /Unsupported animation size/);
assert.throws(() => muxAnimatedWebp([{ data: new Uint8Array(30), duration: 1 }], { width: 2, height: 2 }), /Not a WebP file/);

// --- Without a decoder the original file is kept ---------------------------
assert.equal(typeof globalThis.ImageDecoder, 'undefined', 'this suite covers the no-decoder path');
const gif = { type: 'image/gif', size: 1000, arrayBuffer: async () => { throw new Error('must not be read'); } };
assert.equal(await convertAnimatedImage(gif, ANIMATED_IMAGE_BOX.avatar), null);
assert.equal(await compressAnimatedImage(gif, 'avatar'), null);

console.log('animatedWebp.test.mjs passed');
