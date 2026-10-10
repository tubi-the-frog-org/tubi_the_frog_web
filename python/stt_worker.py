#!/usr/bin/env python3
import json
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"text": "No audio provided."}))
        return 0

    audio_path = Path(sys.argv[1])
    text = "No audio file was found."

    if audio_path.exists():
        try:
            import whisper  # type: ignore

            model = whisper.load_model("tiny")
            result = model.transcribe(str(audio_path), fp16=False)
            text = (result.get("text") or "").strip() or "I did not catch that clearly."
        except Exception:
            text = "Demo transcription placeholder."

    print(json.dumps({"text": text}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
