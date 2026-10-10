# Tubi the Frog

Tubi the wizard frog

automated snack dispenser
animatronic speaking frog (conversational ai)
mobile website to activate and interact with tubi

## Local setup

Install the system audio decoder required for browser-recorded WebM audio:

```sh
# macOS
brew install ffmpeg

# Raspberry Pi OS
sudo apt update && sudo apt install -y ffmpeg
```

Then install the app and local Whisper speech-recognition dependencies. Whisper downloads its selected model the first time it runs; transcription itself stays local. The default is `base`; set `WHISPER_MODEL=small` for higher accuracy at the cost of speed and memory, or `WHISPER_MODEL=tiny` for lower-resource devices.

```sh
npm install
python3 -m venv .venv
.venv/bin/pip install -r python/requirements.txt
npm run build
npm start
```