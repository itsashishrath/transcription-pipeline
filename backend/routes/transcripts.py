from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException, UploadFile, File
from sqlalchemy.orm import Session as DBSession
from datetime import datetime, timezone
import wave
import glob
import io
import os
import uuid

from database import get_db, SessionLocal
from models import Session, Chunk, Utterance
from schemas import TranscriptResponse, UtteranceResponse
from services.assemblyai import transcribe_audio_bytes

router = APIRouter(prefix="/api/sessions", tags=["transcripts"])

TEMP_DIR = os.getenv("TEMP_DIR", "/tmp/transcription_pipeline")


def _concatenate_chunks(session_id: str) -> bytes:
    """
    Read all chunk WAVs for a session in seq order,
    concatenate PCM data into one valid WAV file, return as bytes.
    """
    pattern = os.path.join(TEMP_DIR, session_id, "chunk_*.wav")
    paths = sorted(glob.glob(pattern))

    if not paths:
        raise RuntimeError(f"No chunks found for session {session_id}")

    output = io.BytesIO()
    with wave.open(output, "wb") as out_wav:
        for i, path in enumerate(paths):
            with wave.open(path, "rb") as in_wav:
                if i == 0:
                    out_wav.setparams(in_wav.getparams())
                out_wav.writeframes(in_wav.readframes(in_wav.getnframes()))

    return output.getvalue()


def _run_transcription(session_id: str) -> None:
    """Background task: concatenate chunks → AssemblyAI → store utterances."""
    db = SessionLocal()
    try:
        audio_bytes = _concatenate_chunks(session_id)
        utterances = transcribe_audio_bytes(audio_bytes)
        _store_utterances(session_id, utterances, db)
    except Exception as exc:
        session = db.query(Session).filter(Session.id == session_id).first()
        if session:
            session.status = "error"
        db.commit()
        raise exc
    finally:
        db.close()

    # Clean up temp chunks after successful transcription
    try:
        session_dir = os.path.join(TEMP_DIR, session_id)
        for path in glob.glob(os.path.join(session_dir, "chunk_*.wav")):
            os.unlink(path)
    except Exception:
        pass


def _store_utterances(session_id: str, utterances: list[dict], db: DBSession) -> None:
    """Write utterance rows and mark session done. Shared by all transcription paths."""
    for u in utterances:
        db.add(
            Utterance(
                id=str(uuid.uuid4()),
                session_id=session_id,
                speaker=u["speaker"],
                start_ms=u["start_ms"],
                end_ms=u["end_ms"],
                text=u["text"],
            )
        )
    session = db.query(Session).filter(Session.id == session_id).first()
    if session:
        session.status = "done"
    db.commit()


def _run_transcription_from_bytes(session_id: str, audio_bytes: bytes) -> None:
    """Background task for direct file upload — no chunk concatenation needed."""
    db = SessionLocal()
    try:
        utterances = transcribe_audio_bytes(audio_bytes)
        _store_utterances(session_id, utterances, db)
    except Exception as exc:
        session = db.query(Session).filter(Session.id == session_id).first()
        if session:
            session.status = "error"
        db.commit()
        raise exc
    finally:
        db.close()


@router.post("/from-file")
async def create_from_file(
    background_tasks: BackgroundTasks,
    audio: UploadFile = File(...),
    db: DBSession = Depends(get_db),
):
    """
    Accept a direct audio file upload (MP3, WAV, M4A, FLAC, etc.),
    create a session, and start transcription immediately.
    No chunking or OPFS involved — the file goes straight to AssemblyAI.
    """
    audio_bytes = await audio.read()

    session = Session(
        id=str(uuid.uuid4()),
        status="transcribing",
        ended_at=datetime.now(timezone.utc),
    )
    db.add(session)
    db.commit()

    background_tasks.add_task(_run_transcription_from_bytes, session.id, audio_bytes)

    return {"id": session.id, "status": "transcribing"}


@router.post("/{session_id}/transcribe")
def start_transcription(
    session_id: str,
    background_tasks: BackgroundTasks,
    db: DBSession = Depends(get_db),
):
    session = db.query(Session).filter(Session.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    chunk_count = db.query(Chunk).filter(Chunk.session_id == session_id).count()
    if chunk_count == 0:
        raise HTTPException(status_code=400, detail="No chunks uploaded for this session")

    session.status = "transcribing"
    session.ended_at = datetime.now(timezone.utc)
    db.commit()

    background_tasks.add_task(_run_transcription, session_id)

    return {"ok": True, "status": "transcribing", "chunks": chunk_count}


@router.post("/{session_id}/retry")
def retry_transcription(
    session_id: str,
    background_tasks: BackgroundTasks,
    db: DBSession = Depends(get_db),
):
    session = db.query(Session).filter(Session.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.status not in ("error", "transcribing"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot retry a session with status '{session.status}'. Only 'error' sessions can be retried.",
        )

    # Check chunk files still exist on disk (wiped on server reboot)
    pattern = os.path.join(TEMP_DIR, session_id, "chunk_*.wav")
    chunk_files = glob.glob(pattern)
    if not chunk_files:
        # Tell the client to re-upload from OPFS instead of hard-failing
        return {
            "ok": False,
            "needs_reupload": True,
            "message": "Chunk files are missing from server temp storage (server may have restarted). Re-upload from browser storage.",
        }

    # Clear previous failed utterances so we don't double-insert
    db.query(Utterance).filter(Utterance.session_id == session_id).delete()
    session.status = "transcribing"
    db.commit()

    background_tasks.add_task(_run_transcription, session_id)

    return {"ok": True, "status": "transcribing", "chunks": len(chunk_files)}


@router.get("/{session_id}/transcript", response_model=TranscriptResponse)
def get_transcript(session_id: str, db: DBSession = Depends(get_db)):
    session = db.query(Session).filter(Session.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    utterances = (
        db.query(Utterance)
        .filter(Utterance.session_id == session_id)
        .order_by(Utterance.start_ms)
        .all()
    )

    return TranscriptResponse(
        status=session.status,
        utterances=[
            UtteranceResponse(
                speaker=u.speaker,
                start_ms=u.start_ms,
                end_ms=u.end_ms,
                text=u.text,
            )
            for u in utterances
        ],
    )
