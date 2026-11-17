'use strict';

/**
 * Renders the New Year wheel music into src/shared/assets/audio/: a seamless
 * 32-bar loop for the spin and a short cue for the result. The piece is written
 * for this project (a swung holiday tune in D, AABA form) and synthesized here,
 * so the tracks carry no third-party melody or recording.
 *
 * Needs ffmpeg with libvorbis on PATH. Run: node scripts/generate-newyear-wheel-audio.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const RATE = 44100;
const OUT = path.join(__dirname, '..', 'src', 'shared', 'assets', 'audio');
const BEAT = 60 / 132;
// The score below is written in C and sounds a tone higher.
const TRANSPOSE = 2;

// [frequency ratio, level, decay speed]: upper partials die sooner, as on a struck bar.
const BELL = [[1, 1, 1], [2, 0.3, 1.6], [3, 0.1, 2.5], [4.1, 0.06, 4], [6.3, 0.05, 9]];
const CHIME = [[1, 1, 1], [2, 0.55, 1.2], [2.74, 0.4, 1.7], [3.76, 0.22, 2.4], [5.4, 0.12, 4]];
const BASS = [[1, 1, 1], [2, 0.4, 1.5], [3, 0.12, 2.5]];
const PLUCK = [[1, 1, 1], [2, 0.25, 2], [3, 0.08, 3]];
const SLEIGH_PARTIALS = [2900, 3650, 4480, 5300, 6400, 7700, 9100];

// [bass, second bass note, upper chord tones] as MIDI notes. Through C, Caug, C6
// and C7 the lowest chord tone climbs by semitones: that line carries the tune.
const CHORDS = {
    C: [48, 43, [55, 60, 64]],
    Caug: [48, 44, [56, 60, 64]],
    C6: [48, 43, [57, 60, 64]],
    C7: [48, 43, [58, 60, 64]],
    CoverG: [43, 48, [55, 60, 64]],
    F: [41, 48, [57, 60, 65]],
    Fm: [41, 48, [56, 60, 65]],
    Fsdim: [42, 48, [57, 60, 63]],
    Em7: [40, 47, [55, 59, 62]],
    A7: [45, 52, [55, 61, 64]],
    Dm7: [50, 45, [57, 60, 65]],
    D7: [50, 45, [57, 60, 66]],
    Gsus: [43, 50, [55, 60, 62]],
    G7: [43, 50, [55, 59, 65]]
};

const [G4, Gs4, A4, Bb4, B4, C5, Cs5, D5, E5, F5, Fs5, G5, Gs5, A5, Bb5, C6] =
    [67, 68, 69, 70, 71, 72, 73, 74, 76, 77, 78, 79, 80, 81, 82, 84];

// One 4/4 bar per entry: [[chord, beats], …], then the melody as [note, beats] pairs.
const OPENING = [
    [[['C', 4]], [[E5, 1.5], [G5, 0.5], [E5, 1], [C5, 1]]],
    [[['Caug', 4]], [[E5, 1.5], [Gs5, 0.5], [E5, 1], [C5, 1]]],
    [[['C6', 4]], [[E5, 0.5], [G5, 0.5], [A5, 1.5], [G5, 0.5], [E5, 1]]],
    [[['C7', 4]], [[G5, 1], [E5, 0.5], [C5, 0.5], [Bb4, 2]]],
    [[['F', 4]], [[A4, 1.5], [C5, 0.5], [F5, 1], [A5, 1]]],
    [[['Fm', 4]], [[Gs5, 1.5], [G5, 0.5], [F5, 1], [D5, 1]]],
    [[['Em7', 2], ['A7', 2]], [[G5, 1], [E5, 1], [Cs5, 0.5], [E5, 0.5], [A5, 1]]],
    [[['Dm7', 2], ['G7', 2]], [[D5, 1], [F5, 0.5], [D5, 0.5], [B4, 1], [G4, 1]]]
];
// The answer climbs where the opening fell.
const ANSWER = [
    [[['C', 4]], [[E5, 1.5], [G5, 0.5], [E5, 1], [C5, 1]]],
    [[['Caug', 4]], [[E5, 1.5], [Gs5, 0.5], [E5, 1], [Gs5, 1]]],
    [[['C6', 4]], [[A5, 1.5], [G5, 0.5], [E5, 1], [A5, 1]]],
    [[['C7', 4]], [[Bb5, 2], [G5, 1], [E5, 1]]],
    [[['F', 4]], [[A5, 1.5], [F5, 0.5], [C5, 1], [A4, 1]]],
    [[['Fm', 4]], [[Gs4, 1.5], [C5, 0.5], [F5, 1], [Gs5, 1]]]
];
const SECTIONS = [
    { name: 'opening', bars: OPENING },
    { name: 'answer', bars: [
        ...ANSWER,
        [[['Dm7', 2], ['G7', 2]], [[A5, 1], [F5, 1], [G5, 0.5], [F5, 0.5], [D5, 0.5], [B4, 0.5]]],
        [[['C', 2], ['C7', 2]], [[C5, 2], [E5, 1], [G5, 1]]]
    ] },
    { name: 'bridge', bars: [
        [[['F', 4]], [[A5, 2], [F5, 1], [A5, 1]]],
        [[['Fsdim', 4]], [[A5, 1], [C6, 1], [A5, 1], [Fs5, 1]]],
        [[['CoverG', 4]], [[G5, 2], [E5, 1], [G5, 1]]],
        [[['A7', 4]], [[A5, 1.5], [G5, 0.5], [E5, 1], [Cs5, 1]]],
        [[['Dm7', 4]], [[D5, 1], [F5, 1], [A5, 2]]],
        [[['D7', 4]], [[C6, 2], [A5, 1], [Fs5, 1]]],
        [[['Gsus', 4]], [[G5, 2], [D5, 1], [C5, 1]]],
        [[['G7', 4]], [[B4, 1], [D5, 1], [F5, 1], [G5, 1]]]
    ] },
    { name: 'reprise', bars: [
        ...ANSWER,
        [[['Dm7', 2], ['G7', 2]], [[A5, 1], [F5, 1], [D5, 1], [B4, 1]]],
        [[['C', 2], ['G7', 2]], [[C5, 2], [G4, 1], [B4, 0.5], [D5, 0.5]]]
    ] }
];

const hertz = midi => 440 * Math.pow(2, (midi + TRANSPOSE - 69) / 12);
// Swung eighths: the off-beat falls on the last third of the beat.
const swing = beats => (Math.abs(beats % 1 - 0.5) < 1e-6 ? Math.floor(beats) + 2 / 3 : beats);

// Seeded, so a rerun reproduces the same tracks.
function randomSource(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6D2B79F5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function createTrack(seconds, loop) {
    const length = Math.round(seconds * RATE);
    return { length, loop, left: new Float64Array(length), right: new Float64Array(length) };
}

/** Runs `sample(time)` from `start`; in a loop the tail folds back onto the beginning. */
function render(track, start, seconds, pan, sample) {
    const first = Math.round(start * RATE);
    const count = Math.round(seconds * RATE);
    const left = Math.cos((pan + 1) * Math.PI / 4);
    const right = Math.sin((pan + 1) * Math.PI / 4);
    for (let i = 0; i < count; i++) {
        let index = first + i;
        if (index >= track.length) {
            if (!track.loop) break;
            index %= track.length;
        }
        const value = sample(i / RATE);
        track.left[index] += value * left;
        track.right[index] += value * right;
    }
}

/** One struck, decaying note. */
function strike(track, start, frequency, level, pan, partials, decay) {
    render(track, start, Math.min(decay * 7, 3.2), pan, time => {
        let sum = 0;
        for (const [ratio, partialLevel, speed] of partials) {
            sum += partialLevel * Math.exp(-time * speed / decay) * Math.sin(2 * Math.PI * frequency * ratio * time);
        }
        return sum * level * Math.min(1, time / 0.004);
    });
}

/** A held string-like tone: two detuned copies, one to each side. */
function pad(track, start, seconds, frequency, level) {
    const release = 0.3;
    [[0.9975, -0.6], [1.0025, 0.6]].forEach(([detune, pan]) => {
        render(track, start, seconds + release, pan, time => {
            const envelope = Math.min(1, time / 0.09) * (time > seconds ? Math.max(0, 1 - (time - seconds) / release) : 1);
            let sum = 0;
            for (let harmonic = 1; harmonic <= 5; harmonic++) {
                sum += Math.sin(2 * Math.PI * frequency * detune * harmonic * time) / Math.pow(harmonic, 1.7);
            }
            return sum * envelope * level;
        });
    });
}

function kick(track, start, level) {
    let phase = 0;
    render(track, start, 0.4, 0, time => {
        phase += 2 * Math.PI * (45 + 75 * Math.exp(-time / 0.03)) / RATE;
        return Math.sin(phase) * Math.exp(-time / 0.1) * Math.min(1, time / 0.002) * level;
    });
}

/** A brush on the snare: a short burst of bright noise. */
function brush(track, start, level, decay, pan, random) {
    let previous = 0;
    render(track, start, decay * 7, pan, time => {
        const noise = random() * 2 - 1;
        const bright = noise - previous;
        previous = noise;
        return (0.4 * noise + 0.6 * bright) * Math.exp(-time / decay) * Math.min(1, time / 0.003) * level;
    });
}

/** A sleigh-bell shake: detuned high partials that bounce twice. */
function jingle(track, start, level, pan, random) {
    for (const [delay, bounce] of [[0, 1], [0.027, 0.55], [0.061, 0.3]]) {
        for (const partial of SLEIGH_PARTIALS) {
            const frequency = partial * (0.97 + random() * 0.06);
            render(track, start + delay, 0.3, pan, time => Math.sin(2 * Math.PI * frequency * time)
                * Math.exp(-time / 0.045) * Math.min(1, time / 0.002) * level * bounce / 3);
        }
    }
}

function bell(track, start, midi, level, decay, octaveLevel = 0.3) {
    strike(track, start, hertz(midi), level, 0, BELL, decay);
    strike(track, start, hertz(midi + 12), level * octaveLevel, 0.25, BELL, decay * 0.7);
}

/** A quiet echo on the opposite side, on the swing grid, gives the dry voices some room. */
function addEcho(track) {
    const delay = Math.round(BEAT * 2 / 3 * RATE);
    const left = Float64Array.from(track.left);
    const right = Float64Array.from(track.right);
    for (let i = 0; i < track.length; i++) {
        let source = i - delay;
        if (source < 0) {
            if (!track.loop) continue;
            source += track.length;
        }
        track.left[i] += right[source] * 0.2;
        track.right[i] += left[source] * 0.2;
    }
}

function chordAt(chords, beat) {
    let from = 0;
    for (const [name, beats] of chords) {
        if (beat < from + beats) return CHORDS[name];
        from += beats;
    }
    return CHORDS[chords[chords.length - 1][0]];
}

function renderSpin() {
    const bars = SECTIONS.flatMap(section => section.bars.map(bar => ({ section: section.name, bar })));
    const track = createTrack(bars.length * 4 * BEAT, true);
    const random = randomSource(2027);
    bars.forEach(({ section, bar: [chords, notes] }, index) => {
        const barStart = index * 4 * BEAT;
        const at = beats => barStart + swing(beats) * BEAT;
        const bridge = section === 'bridge';
        const full = section === 'reprise';

        // A chime marks every eight bars.
        if (index % 8 === 0) strike(track, barStart, hertz(60), 0.11, 0, CHIME, 1.7);

        let from = 0;
        for (const [name, beats] of chords) {
            const [low, second, tones] = CHORDS[name];
            strike(track, at(from), hertz(low), 0.2, 0, BASS, 0.34);
            if (beats === 4) strike(track, at(from + 2), hertz(second), 0.17, 0, BASS, 0.34);
            tones.forEach(tone => pad(track, at(from), beats * BEAT - 0.05, hertz(tone), bridge ? 0.03 : 0.022));
            from += beats;
        }
        // The last swung eighth leans into the next bar's bass.
        strike(track, at(3.5), hertz(chordAt(chords, 3)[1]), 0.1, 0, BASS, 0.2);

        for (const beat of [1, 3]) {
            chordAt(chords, beat)[2].forEach((tone, voice) => {
                strike(track, at(beat), hertz(tone + 12), 0.045, (voice - 1) * 0.4, PLUCK, 0.22);
            });
            brush(track, at(beat), bridge ? 0.035 : 0.055, 0.05, 0.15, random);
        }
        if (!bridge) {
            kick(track, at(0), 0.2);
            kick(track, at(2), 0.16);
        }
        for (let beat = 0; beat < 4; beat++) {
            jingle(track, at(beat), 0.1 * (beat % 2 ? 0.75 : 1), -0.45, random);
            jingle(track, at(beat + 0.5), 0.05, 0.45, random);
        }

        // Triplet arpeggios sparkle through the bridge and, quieter, through the reprise.
        if (bridge || full) {
            for (let third = 0; third < 12; third++) {
                const tones = chordAt(chords, Math.floor(third / 3))[2];
                const ladder = [...tones, ...tones.map(tone => tone + 12)].sort((a, b) => a - b);
                strike(track, barStart + third * BEAT / 3, hertz(ladder[third % 6] + 12), bridge ? 0.04 : 0.024,
                    third % 2 ? 0.55 : -0.55, BELL, 0.16);
            }
        }

        let beat = 0;
        for (const [midi, beats] of notes) {
            bell(track, at(beat), midi, 0.2, bridge ? 0.7 : 0.45, section === 'opening' ? 0.3 : 0.45);
            // The reprise adds a glockenspiel two octaves up.
            if (full) strike(track, at(beat), hertz(midi + 24), 0.035, -0.3, BELL, 0.3);
            beat += beats;
        }
    });
    addEcho(track);
    return track;
}

function renderWinner() {
    const track = createTrack(3.8, false);
    const random = randomSource(2028);
    // A triplet run up the dominant lands on the tune's home chord.
    [G4, B4, D5, F5, G5, B4 + 12].forEach((midi, index) => {
        bell(track, index * 0.1, midi, 0.17, 0.25);
        if (index % 2 === 0) jingle(track, index * 0.1, 0.08, index % 4 ? 0.4 : -0.4, random);
    });
    const landing = 0.6;
    [C5, E5, G5, C6].forEach(midi => bell(track, landing, midi, 0.17, 0.95));
    strike(track, landing, hertz(60), 0.14, 0, CHIME, 1.6);
    strike(track, landing, hertz(48), 0.24, 0, BASS, 0.6);
    kick(track, landing, 0.2);
    [55, 60, 64].forEach(tone => pad(track, landing, 1.6, hertz(tone), 0.03));
    [E5 + 12, G5 + 12, C6 + 12, E5 + 24, G5 + 24].forEach((midi, index) => {
        strike(track, landing + 0.12 + index * 0.08, hertz(midi), 0.055, index % 2 ? 0.5 : -0.5, BELL, 0.5);
    });
    for (let shake = 0; shake < 14; shake++) {
        jingle(track, landing + shake * 0.075, 0.1 * (1 - shake / 16), shake % 2 ? 0.5 : -0.5, random);
    }
    addEcho(track);
    const fade = Math.round(0.5 * RATE);
    for (let i = 0; i < fade; i++) {
        const index = track.length - fade + i;
        track.left[index] *= 1 - i / fade;
        track.right[index] *= 1 - i / fade;
    }
    return track;
}

function writeTrack(track, name, peak) {
    let loudest = 0;
    for (let i = 0; i < track.length; i++) {
        loudest = Math.max(loudest, Math.abs(track.left[i]), Math.abs(track.right[i]));
    }
    const gain = peak / loudest;
    const data = Buffer.alloc(track.length * 4);
    for (let i = 0; i < track.length; i++) {
        data.writeInt16LE(Math.round(track.left[i] * gain * 32767), i * 4);
        data.writeInt16LE(Math.round(track.right[i] * gain * 32767), i * 4 + 2);
    }
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + data.length, 4);
    header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(2, 22);
    header.writeUInt32LE(RATE, 24);
    header.writeUInt32LE(RATE * 4, 28);
    header.writeUInt16LE(4, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(data.length, 40);

    const wav = path.join(os.tmpdir(), `${name}-${process.pid}.wav`);
    const target = path.join(OUT, `${name}.ogg`);
    fs.writeFileSync(wav, Buffer.concat([header, data]));
    try {
        // Vorbis keeps the exact sample count, which an MP3's padding would break in a loop.
        execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-map_metadata', '-1',
            '-fflags', '+bitexact', '-flags:a', '+bitexact', '-c:a', 'libvorbis', '-q:a', '3', target]);
    } finally {
        fs.rmSync(wav, { force: true });
    }
    console.log(`${path.relative(process.cwd(), target)}: ${(track.length / RATE).toFixed(2)} s, ${fs.statSync(target).size} bytes`);
}

// Peaks chosen so the tracks sit at the loudness of the regular wheel music.
writeTrack(renderSpin(), 'random-wheel-spin-newyear', 0.435);
writeTrack(renderWinner(), 'random-wheel-winner-newyear', 0.314);
