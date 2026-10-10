#!/usr/bin/env python3
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import whisper


def append_transcript(output_path: Path | None, text: str) -> None:
    if output_path is None:
        return

    output_path.parent.mkdir(parents=True, exist_ok=True)
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "text": text,
    }
    with output_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, ensure_ascii=False) + "\n")


def convert_to_wav(path: Path) -> Path:
    wav_path = path.with_suffix(".wav")
    if wav_path.exists():
        return wav_path

    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        raise RuntimeError(
            "ffmpeg is required to decode browser audio. Install it with "
            "'brew install ffmpeg' on macOS or 'sudo apt install ffmpeg' on Raspberry Pi."
        )

    command = [
        ffmpeg,
        "-y",
        "-i",
        str(path),
        "-ar",
        "16000",
        "-ac",
        "1",
        "-f",
        "wav",
        str(wav_path),
    ]
    subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return wav_path


def transcribe_audio(path: Path) -> str:
    audio_path = path
    if path.suffix.lower() in {".webm", ".ogg", ".opus", ".m4a"}:
        audio_path = convert_to_wav(path)

    model_name = os.environ.get("WHISPER_MODEL", "base")
    model = whisper.load_model(model_name)
    result = model.transcribe(str(audio_path), fp16=False)
    return (result.get("text") or "").strip() or "I could not understand the audio."


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"text": "No audio provided."}))
        return 0

    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2]) if len(sys.argv) >= 3 else None
    text = "No audio file was found."

    if input_path.exists():
        try:
            text = transcribe_audio(input_path)
        except Exception as exc:
            text = f"Speech transcription failed: {exc}"

    append_transcript(output_path, text)
    print(json.dumps({"text": text}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
