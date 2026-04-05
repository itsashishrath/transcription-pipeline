import os
import time
import requests
from dotenv import load_dotenv

load_dotenv()

API_KEY = os.getenv("ASSEMBLYAI_API_KEY", "")
BASE_URL = "https://api.assemblyai.com"


def transcribe_audio_bytes(audio_bytes: bytes) -> list[dict]:
    """
    Upload raw audio bytes to AssemblyAI, transcribe with speaker diarization,
    poll until complete, return list of utterances.
    """
    headers = {"authorization": API_KEY}

    # Step 1: upload the audio file
    upload_res = requests.post(
        f"{BASE_URL}/v2/upload",
        headers=headers,
        data=audio_bytes,
    )
    upload_res.raise_for_status()
    audio_url = upload_res.json()["upload_url"]

    # Step 2: submit transcription request
    transcript_res = requests.post(
        f"{BASE_URL}/v2/transcript",
        headers=headers,
        json={
            "audio_url": audio_url,
            "speech_models": ["universal-3-pro", "universal-2"],
            "speaker_labels": True,
            "language_code": "en",
        },
    )
    transcript_res.raise_for_status()
    transcript_id = transcript_res.json()["id"]

    # Step 3: poll until done
    polling_url = f"{BASE_URL}/v2/transcript/{transcript_id}"
    while True:
        poll = requests.get(polling_url, headers=headers).json()
        if poll["status"] == "completed":
            return [
                {
                    "speaker": u["speaker"],
                    "start_ms": u["start"],
                    "end_ms": u["end"],
                    "text": u["text"],
                }
                for u in (poll.get("utterances") or [])
            ]
        if poll["status"] == "error":
            raise RuntimeError(f"AssemblyAI error: {poll['error']}")
        time.sleep(3)
