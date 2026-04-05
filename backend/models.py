from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, Text
from sqlalchemy.sql import func
from database import Base


class Session(Base):
    __tablename__ = "sessions"

    id = Column(String, primary_key=True)
    started_at = Column(DateTime, server_default=func.now())
    ended_at = Column(DateTime, nullable=True)
    # recording | transcribing | done | error
    status = Column(String, default="recording")


class Chunk(Base):
    __tablename__ = "chunks"

    id = Column(String, primary_key=True)
    session_id = Column(String, ForeignKey("sessions.id"), nullable=False)
    seq_no = Column(Integer, nullable=False)
    duration_ms = Column(Integer, nullable=False)
    acked_at = Column(DateTime, server_default=func.now())


class Utterance(Base):
    __tablename__ = "utterances"

    id = Column(String, primary_key=True)
    session_id = Column(String, ForeignKey("sessions.id"), nullable=False)
    # "A", "B", "C" etc — from AssemblyAI diarization
    speaker = Column(String, nullable=False)
    start_ms = Column(Integer, nullable=False)
    end_ms = Column(Integer, nullable=False)
    text = Column(Text, nullable=False)
