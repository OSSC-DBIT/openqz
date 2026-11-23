# The narrated demo video

One edited video of the whole flow, recorded on the real app: the super admin sets up a class,
a teacher builds and assigns a quiz (desktop), a student answers on a phone, the teacher marks and
releases, then a club runs a live game (big screen and phones) and a self-paced room.

| File | What it does |
| --- | --- |
| `lines.json` | The script: every narration line (`text`), the caption shown before the action (`do`), the six steps, and the voice |
| `voice.py` | Speaks every line with Microsoft Edge's neural voices (`edge-tts`, voice `en-IN-NeerjaExpressiveNeural`) into `recordings/demo-voice/`, with each line's length. Only changed lines are spoken again |
| `record.mjs` | Drives the app in Chromium: desktop pages at 1536x864, phones at 390x844. Captures every page as timed frames (Chrome screencast) and logs when each line starts. Waits for the narrator, so the voice never overlaps |
| `edit.mjs` | Builds `OpenQZ-demo.mp4`: opener from the intro film, step cards, screens in desktop and phone frames, captions and subtitles, the narration at its logged times, and music lowered under the voice |

## Make it

Record against a clean copy of the app, so no test data shows (your dev stack keeps running):

```bash
# 1. a clean stack on :8094 (production images, its own database, email off)
cp .env /tmp/demo.env   # then set HTTP_PORT=8094, CORS_ORIGINS=http://localhost:8094, SMTP_HOST= and SMTP_USER=, add ADMIN_EMAIL / ADMIN_PASSWORD
export ENV_FILE=/tmp/demo.env API_IMAGE=openqzdemo-api:local WEB_IMAGE=openqzdemo-web:local
docker compose -p openqzdemo --env-file /tmp/demo.env -f compose.yaml up -d --build --wait
docker compose -p openqzdemo --env-file /tmp/demo.env -f compose.yaml exec -T api python -m app.cli create-admin --from-env
bash scripts/seed_demo.sh http://localhost:8094

# 2. voice, recording, edit
python -m pip install edge-tts
python scripts/demo/voice.py
node scripts/demo/record.mjs http://localhost:8094
node scripts/demo/edit.mjs recordings/demo-<date-time>
```

The class is CSE semester 3 section A with subject BCS304, as the narration says. A second take
needs a fresh database (`docker compose -p openqzdemo ... down -v`, then step 1 again), or
`DEMO_SEM`, `DEMO_SEC` and `DEMO_SUBJECT` set to a free class for a trial. `UNTIL=<scene>` stops
after one scene.

Music: "Gaslight (120 bpm)" by Dante Ross, CC0 (`video/music/gaslight.mp3`). The voice text is sent
to Microsoft's speech service when `voice.py` runs; nothing else leaves the machine.
