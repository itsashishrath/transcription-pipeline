from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session as DBSession
import uuid

from database import get_db
from models import Session, Chunk
from schemas import SessionResponse, SessionListItem, ChunksResponse

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@router.post("", response_model=SessionResponse)
def create_session(db: DBSession = Depends(get_db)):
    session = Session(id=str(uuid.uuid4()))
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@router.get("", response_model=list[SessionListItem])
def list_sessions(db: DBSession = Depends(get_db)):
    sessions = (
        db.query(Session)
        .order_by(Session.started_at.desc())
        .limit(50)
        .all()
    )
    result = []
    for s in sessions:
        chunk_count = db.query(Chunk).filter(Chunk.session_id == s.id).count()
        result.append(
            SessionListItem(
                id=s.id,
                started_at=s.started_at,
                ended_at=s.ended_at,
                status=s.status,
                chunk_count=chunk_count,
            )
        )
    return result


@router.get("/{session_id}/chunks", response_model=ChunksResponse)
def get_session_chunks(session_id: str, db: DBSession = Depends(get_db)):
    session = db.query(Session).filter(Session.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    seq_nos = [
        c.seq_no
        for c in db.query(Chunk.seq_no).filter(Chunk.session_id == session_id).all()
    ]
    return {"acked_seq_nos": seq_nos}
