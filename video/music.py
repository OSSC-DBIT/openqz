"""Compose the soundtrack of the walkthrough video: an original 120 BPM track made entirely in
code (no samples, nothing to license). Writes public/music.wav.

    python music.py            (needs numpy)

To use a track of your own instead (one you bought or that is free to use), save it as
public/music.wav, any length, and render: this script is then not needed.

The video is cut on the beat: at 30 frames a second one beat is 15 frames, and every scene in
src/Intro.tsx lasts a whole number of beats. BEATS below must match the video's length.

How it is built: warm pad chords that duck under the kick (side-chain), a round sub bass, a
plucked melody with an echo and a hall reverb, a soft kick, finger snaps and a shaker."""

import pathlib
import wave

import numpy as np

SR = 44100
BPM = 120
BEAT = 60 / BPM
BEATS = 76  # 1140 frames at 30 fps
TAIL = 1.0  # the track ends with the picture; the last chord fades inside it
TOTAL = int(SR * BEAT * BEATS)
rng = np.random.default_rng(11)


def bus():
    return np.zeros(TOTAL)


drums, bass, pad, pluck = bus(), bus(), bus(), bus()


def add(track, buf, start_s, gain=1.0):
    i = int(start_s * SR)
    if i >= TOTAL or i < 0:
        return
    n = min(len(buf), TOTAL - i)
    track[i : i + n] += buf[:n] * gain


def lowpass(x, cutoff, slope=2.0):
    """Gentle low-pass in the frequency domain (the whole buffer at once)."""
    spectrum = np.fft.rfft(x)
    freqs = np.fft.rfftfreq(len(x), 1 / SR)
    spectrum *= 1 / np.sqrt(1 + (freqs / cutoff) ** (2 * slope))
    return np.fft.irfft(spectrum, len(x))


def highpass(x, cutoff):
    spectrum = np.fft.rfft(x)
    freqs = np.fft.rfftfreq(len(x), 1 / SR)
    spectrum *= 1 - 1 / np.sqrt(1 + (freqs / cutoff) ** 4)
    return np.fft.irfft(spectrum, len(x))


def midi(note):
    return 440 * 2 ** ((note - 69) / 12)


def adsr(n, attack, decay, sustain=0.0, release=0.05):
    t = np.arange(n) / SR
    length = n / SR
    a = np.minimum(1, t / max(attack, 1e-4))
    d = sustain + (1 - sustain) * np.exp(-np.maximum(0, t - attack) / decay)
    r = np.minimum(1, np.maximum(0, (length - t) / release))
    return a * d * r


def saw(freq, n, detune=0.0):
    """Band-limited saw with two slightly detuned voices for width."""
    t = np.arange(n) / SR
    out = np.zeros(n)
    for f in (freq * (1 - detune), freq * (1 + detune)):
        k = 1
        while f * k < 9000 and k < 40:
            out += np.sin(2 * np.pi * f * k * t + k) / k
            k += 1
    return out * 0.5


def kick():
    n = int(SR * 0.4)
    t = np.arange(n) / SR
    freq = 48 + 90 * np.exp(-t / 0.03)
    body = np.sin(2 * np.pi * np.cumsum(freq) / SR) * np.exp(-t / 0.16)
    click = rng.standard_normal(n) * np.exp(-t / 0.002) * 0.15
    return body + click


def snap():
    """A finger snap: two short filtered bursts."""
    n = int(SR * 0.12)
    t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    shape = np.exp(-t / 0.012) + 0.6 * np.exp(-np.maximum(0, t - 0.012) / 0.03) * (t >= 0.012)
    ring = np.sin(2 * np.pi * 1900 * t) * np.exp(-t / 0.02)
    return (noise * 0.5 + ring) * shape * 0.5


def shaker(accent=1.0):
    n = int(SR * 0.07)
    t = np.arange(n) / SR
    noise = np.diff(rng.standard_normal(n), prepend=0)
    return noise * np.minimum(1, t / 0.008) * np.exp(-t / 0.02) * 0.12 * accent


def pluck_note(note, length=0.5, bright=1.0):
    n = int(SR * length)
    t = np.arange(n) / SR
    f = midi(note)
    tone = np.sin(2 * np.pi * f * t) + 0.5 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t / 0.08) * bright + 0.25 * np.sin(2 * np.pi * 3 * f * t) * np.exp(-t / 0.04) * bright
    return tone * adsr(n, 0.003, 0.16, 0.0, 0.05)


def riser(length):
    n = int(SR * length)
    t = np.linspace(0, 1, n)
    noise = highpass(rng.standard_normal(n), 1500)
    return noise * t**3 * 0.5


# I  V  vi  IV with added colour notes: Cadd9  G  Am7  Fmaj7 (one bar each)
PROG = [
    (36, [60, 64, 67, 74]),
    (43, [59, 62, 67, 74]),
    (45, [57, 60, 64, 67]),
    (41, [57, 60, 65, 72]),
]
# the melody: degrees of the chord, in eighth notes, two bars long
MELODY = [3, 1, 2, 1, 3, 2, 1, 0, 2, 1, 3, 1, 2, 0, 1, 2]

K, S = kick(), snap()

for beat in range(BEATS):
    t0 = beat * BEAT
    bar = beat // 4
    root, chord = PROG[bar % 4]
    intro = beat < 5  # the opening scene: pad and melody only
    lift = beat >= 39  # second half: a little more energy
    last = beat >= BEATS - 8
    hold = last and beat >= BEATS - 4  # the final bar rings out

    if not intro and not hold:
        add(drums, K, t0, 0.9)
        if beat % 2 == 1:
            add(drums, S, t0, 0.8)
        for k in range(4):  # shaker in sixteenths, accents on the off-beats
            add(drums, shaker(1.0 if k == 2 else 0.55 if k % 2 else 0.35), t0 + k * BEAT / 4, 1.0 if lift else 0.75)

    if not intro and not hold:
        n = int(SR * BEAT * 0.9)
        sub = np.sin(2 * np.pi * midi(root) * np.arange(n) / SR) * adsr(n, 0.01, 0.5, 0.6, 0.08)
        add(bass, sub, t0, 0.5)
        if lift and beat % 4 == 3:  # a walk up into the next bar
            m = int(SR * BEAT * 0.4)
            add(bass, np.sin(2 * np.pi * midi(root + 7) * np.arange(m) / SR) * adsr(m, 0.01, 0.2, 0.3, 0.05), t0 + BEAT / 2, 0.35)

    if beat % 4 == 0:
        bars = 2.0 if hold else 1.0
        n = int(SR * BEAT * 4.1 * bars)
        for note in chord:
            add(pad, saw(midi(note), n, 0.004) * adsr(n, 0.35, 3.0, 0.7, 0.5), t0, 0.07)

    if not hold:
        for k in range(2):
            step = (beat * 2 + k) % len(MELODY)
            note = chord[MELODY[step] % len(chord)] + 12
            if intro and k == 1:
                continue  # the opening plays every other note
            add(pluck, pluck_note(note, 0.55, 1.2 if lift else 0.8), t0 + k * BEAT / 2, 0.16)
            if lift and step % 4 == 0:
                add(pluck, pluck_note(note + 12, 0.4, 1.0), t0 + k * BEAT / 2, 0.05)

# a rise only into the three big turns of the film, not every cut
for beat in (16, 39, 60):
    add(drums, riser(BEAT * 2), (beat - 2) * BEAT, 0.5)

# the closing chord: bright and long
for note in (48, 60, 64, 67, 74, 79):
    n = int(SR * BEAT * 7)
    add(pad, saw(midi(note), n, 0.005) * adsr(n, 0.01, 2.2, 0.25, 1.2), (BEATS - 8) * BEAT, 0.05)
    add(pluck, pluck_note(note + 12, 2.0, 1.5), (BEATS - 8) * BEAT, 0.08)

# ---- mix

# side-chain: pad and bass duck on every kick, which gives the track its pulse
duck = np.ones(TOTAL)
for beat in range(5, BEATS - 4):
    i = int(beat * BEAT * SR)
    n = min(int(SR * 0.3), TOTAL - i)
    duck[i : i + n] = np.minimum(duck[i : i + n], 0.25 + 0.75 * (np.arange(n) / n) ** 1.6)

pad = lowpass(pad, 2400) * duck
bass = lowpass(bass, 220) * (0.5 + 0.5 * duck)
pluck = lowpass(pluck, 6500)

# echo on the melody: three repeats, a dotted eighth apart
echo = np.zeros(TOTAL)
step = int(SR * BEAT * 0.75)
for k, gain in enumerate((0.34, 0.2, 0.1), start=1):
    echo[k * step :] += pluck[: TOTAL - k * step] * gain
pluck = pluck + lowpass(echo, 3500)


def hall(x, seconds=1.8, mix_amount=0.2):
    """Reverb: convolve with a burst of decaying noise."""
    n = int(SR * seconds)
    impulse = rng.standard_normal(n) * np.exp(-np.arange(n) / SR / (seconds / 5))
    impulse = lowpass(impulse, 5000)
    size = len(x) + n
    wet = np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(impulse, size), size)[: len(x)]
    wet /= max(1e-9, np.max(np.abs(wet)))
    return x + wet * np.max(np.abs(x)) * mix_amount


left = drums * 0.9 + bass + hall(pad, 2.2, 0.25) + hall(pluck, 1.8, 0.3)
# width: the melody's echo and the pad sit slightly differently in the right ear
shift = int(SR * 0.011)
right_pluck = np.roll(pluck, shift)
right_pluck[:shift] = 0
right = drums * 0.9 + bass + hall(pad * 0.95, 2.4, 0.25) + hall(right_pluck, 1.8, 0.3)


def master(x):
    x = np.tanh(x * 1.1)  # gentle glue
    fade_in = int(SR * 0.6)
    fade_out = int(SR * 2.8)
    x[:fade_in] *= np.linspace(0, 1, fade_in) ** 2
    x[-fade_out:] *= np.linspace(1, 0, fade_out) ** 1.6
    return x


left, right = master(left), master(right)
peak = max(np.max(np.abs(left)), np.max(np.abs(right)))
stereo = np.stack([left, right], axis=1) / peak * 0.88

out = pathlib.Path(__file__).with_name("public")
out.mkdir(exist_ok=True)
with wave.open(str(out / "music.wav"), "wb") as f:
    f.setnchannels(2)
    f.setsampwidth(2)
    f.setframerate(SR)
    f.writeframes((stereo * 32767).astype("<i2").tobytes())
print(f"music.wav: {TOTAL / SR:.1f} s, {BEATS} beats at {BPM} BPM")
