from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from sqlalchemy.orm import Session as DBSession
import os

from database import get_db
from models import Chunk, Session
from schemas import ChunkAckResponse

router = APIRouter(prefix="/api/chunks", tags=["chunks"])

TEMP_DIR = os.getenv("TEMP_DIR", "/tmp/transcription_pipeline")


@router.post("/upload", response_model=ChunkAckResponse)
async def upload_chunk(
    audio: UploadFile = File(...),
    chunk_id: str = Form(...),
    session_id: str = Form(...),
    seq_no: int = Form(...),
    duration_ms: int = Form(...),
    db: DBSession = Depends(get_db),
):
    # Verify session exists
    session = db.query(Session).filter(Session.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Save WAV to temp storage: /tmp/transcription_pipeline/{session_id}/chunk_000001.wav
    session_dir = os.path.join(TEMP_DIR, session_id)
    os.makedirs(session_dir, exist_ok=True)

    chunk_path = os.path.join(session_dir, f"chunk_{seq_no:06d}.wav")
    contents = await audio.read()
    with open(chunk_path, "wb") as f:
        f.write(contents)

    # Ack to DB — upsert by (session_id, seq_no) so re-uploads from OPFS
    # don't create duplicate rows even when a new chunk_id is generated
    existing = (
        db.query(Chunk)
        .filter(Chunk.session_id == session_id, Chunk.seq_no == seq_no)
        .first()
    )
    if not existing:
        chunk = Chunk(
            id=chunk_id,
            session_id=session_id,
            seq_no=seq_no,
            duration_ms=duration_ms,
        )
        db.add(chunk)
        db.commit()

    return {"ok": True}
