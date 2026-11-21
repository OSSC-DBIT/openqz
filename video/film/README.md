# OpenQZ film: "One tile becomes everything"

A 15-second motion piece at 120 BPM (30 beats). One pink tile turns into type, answer tiles, a
cube, a report, a bold counter, a grid and the wordmark, then folds back into itself, so it loops.
Plum, cream and pink plus black and white; DM Sans only; a locked-off frontal camera.

| Bar | Beats | Technique |
| --- | --- | --- |
| 1 | 1-4 | Hook: the tile pulses, becomes a circle, a pill, a text box |
| 2 | 5-8 | Kinetic type: TEACH. TEST. PLAY. KNOW. inflate out of the box |
| 3 | 9-12 | Shape morphing: the box splits into 2, then 4 answer tiles; B is picked |
| 4 | 13-16 | 2D to 3D: the tiles gather into a square that becomes a turning cube |
| 5 | 17-20 | Data and UI: the cube's top face opens into a report; bars, 67%, 1,000 |
| 6 | 21-24 | Bold counter: 10 developers, 50+ hours, 100% open source, then it deflates |
| 7 | 25-28 | Strongest moment: 16 tiles burst out, flip in two waves, spell OpenQZ |
| end | 29-30 | Title: the OpenQZ wordmark and "by OSSC DBIT", folding back into the tile |

`film.html` draws every frame from the time alone (`window.seek(t)`); `window.renderAudio()`
writes the soundtrack with the Web Audio API (kick on every beat, a hit on each scene change, a
riser into bar 7, plus bass, pad, arpeggio, clap and hats).

Render (Playwright lives in `frontend/`, so the script runs from a copy there):

```bash
cp video/film/render.mjs frontend/e2e/_render.mjs && cd frontend
export FILM_DIR="$PWD/../video/film"
node e2e/_render.mjs beats /tmp/beats 0.4          # one frame per beat, to review
node e2e/_render.mjs audio /tmp/music.wav
for r in "0 300" "300 600" "600 900"; do node e2e/_render.mjs frames /tmp/sub $r; done
# 3 subframes per frame, averaged for motion blur, 60 fps, with the soundtrack:
ffmpeg -framerate 180 -i /tmp/sub/sub-%05d.jpeg -i /tmp/music.wav \
  -filter_complex "[0:v]tmix=frames=3:weights='1 1 1',select='eq(mod(n\,3)\,2)',setpts=N/60/TB,format=yuv420p[v]" \
  -map "[v]" -map 1:a -r 60 -c:v libx264 -preset slow -crf 18 -c:a aac -b:a 192k -shortest openqz-film.mp4
```

The ffmpeg bundled with Remotion has no `tmix`; `pip install imageio-ffmpeg` gives one that does.

`video/out/openqz-film-gaslight.mp4` is the same picture with "Gaslight (120 bpm)" by Dante Ross,
public domain (CC0), from archive.org (`Gaslight120Bpm`), cut from 1:40.475 so its bars land on
the film's.

## The long intro (intro.html, 99 s)

The same language at full length: `intro.html` loads `core.js` (the 15-second film, shared with
`film.html`), `icons.js` (lucide icons, the app's own set) and `intro.js` (the new scenes). Every
scene starts on the pink tile and folds back into it, and is a whole number of bars at 120 BPM.

| Seconds | Scene |
| --- | --- |
| 0 to 8 | Logo: tile, OpenQZ wordmark, tagline, DBIT line, OSSC flip |
| 8 to 20 | The short film, 0 to 12 s (counter says 4 kinds, 6 question types, 1 attempt) |
| 20 to 28 | Four kinds of activity |
| 28 to 36 | Six question types |
| 36 to 44 | Import from a Google Form |
| 44 to 48 | Branch, semester, sections |
| 48 to 56 | Room: join code, QR, guests |
| 56 to 64 | A student answers on a phone |
| 64 to 72 | Fair exams (full screen, tab switches, second device, one attempt, keys, unblock) |
| 72 to 80 | Live game leaderboard |
| 80 to 88 | Report, exports, office sheets become accounts |
| 88 to 96 | Built by OSSC DBIT, the numbers, open source |
| 96 to 99 | The short film, 12 to 15 s (grid spells OpenQZ, back to the tile) |

Render with `FILM_FILE=intro.html` (same steps as above, frames 0 to 5940). Music: "Gaslight
(120 bpm)" by Dante Ross (CC0, archive.org `Gaslight120Bpm`), from 0:48.475 for 99 s with a 3 s
fade out.
