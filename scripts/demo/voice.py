"""Speak every narration line of the demo video (scripts/demo/lines.json) with Microsoft Edge's
free neural voices, and write how long each line takes.

    python -m pip install edge-tts
    python scripts/demo/voice.py [out_dir]          (default recordings/demo-voice)

Writes <id>.mp3 for each line and durations.json ({id: seconds}). Lines already spoken with the
same text and voice are kept (cache.json), so editing one line re-speaks only that one. Only the
narration text is sent to Microsoft's speech service.
"""

import asyncio
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

import edge_tts

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
FFMPEG = Path.home() / "AppData/Local/Programs/Python/Python313/Lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe"


def ffmpeg() -> str:
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        return str(FFMPEG) if FFMPEG.exists() else "ffmpeg"


def duration(path: Path) -> float:
    out = subprocess.run([ffmpeg(), "-i", str(path)], capture_output=True, text=True).stderr
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", out)
    if not m:
        raise RuntimeError(f"no duration for {path}")
    h, mi, s = m.groups()
    return int(h) * 3600 + int(mi) * 60 + float(s)


async def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "recordings" / "demo-voice"
    out.mkdir(parents=True, exist_ok=True)
    cfg = json.loads((HERE / "lines.json").read_text(encoding="utf-8"))
    voice, rate = cfg["voice"], cfg.get("rate", "+0%")
    cache_file = out / "cache.json"
    cache = json.loads(cache_file.read_text()) if cache_file.exists() else {}
    durations = {}
    for key, line in cfg["lines"].items():
        path = out / f"{key}.mp3"
        sig = hashlib.sha1(f"{voice}|{rate}|{line['text']}".encode()).hexdigest()
        if cache.get(key) != sig or not path.exists():
            await edge_tts.Communicate(line["text"], voice, rate=rate).save(str(path))
            cache[key] = sig
            print("spoke", key)
        durations[key] = round(duration(path), 3)
    cache_file.write_text(json.dumps(cache, indent=1))
    (out / "durations.json").write_text(json.dumps(durations, indent=1))
    print(f"{len(durations)} lines, {sum(durations.values()) / 60:.1f} minutes of narration, voice {voice}")


asyncio.run(main())
