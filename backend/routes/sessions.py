from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session as DBSession
import uuid

from database import get_db
from models import Session, Chunk
from schemas import SessionResponse, SessionListItem

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
