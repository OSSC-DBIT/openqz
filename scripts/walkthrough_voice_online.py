"""Speak the walkthrough narration with Microsoft Edge's free online neural voices (realistic).

    pip install edge-tts
    python scripts/walkthrough_voice_online.py recordings/<date-time> [voice]

Writes voice-<id>.mp3 for every segment in scripts/walkthrough_narration.json. The narration text is
sent to Microsoft's online speech service. Default voice: "online_voice" in the JSON
(en-IN-NeerjaExpressiveNeural). List others with: edge-tts --list-voices
"""

import asyncio
import json
import sys
from pathlib import Path

import edge_tts

HERE = Path(__file__).resolve().parent


async def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    out = Path(sys.argv[1])
    cfg = json.loads((HERE / "walkthrough_narration.json").read_text(encoding="utf-8"))
    voice = sys.argv[2] if len(sys.argv) > 2 else cfg.get("online_voice", "en-IN-NeerjaExpressiveNeural")
    rate = cfg.get("online_rate", "-4%")
    for seg in cfg["segments"]:
        path = out / f"voice-{seg['id']}.mp3"
        await edge_tts.Communicate(seg["text"], voice, rate=rate).save(str(path))
        print(path.name, voice)


asyncio.run(main())
