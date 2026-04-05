from pydantic import BaseModel
from datetime import datetime


class SessionResponse(BaseModel):
    id: str
    started_at: datetime
    status: str

    class Config:
        from_attributes = True


class SessionListItem(BaseModel):
    id: str
    started_at: datetime
    ended_at: datetime | None
    status: str
    chunk_count: int

    class Config:
        from_attributes = True


class ChunkAckResponse(BaseModel):
    ok: bool


class UtteranceResponse(BaseModel):
    speaker: str
    start_ms: int
    end_ms: int
    text: str

    class Config:
        from_attributes = True


class TranscriptResponse(BaseModel):
    status: str
    utterances: list[UtteranceResponse]


class ChunksResponse(BaseModel):
    acked_seq_nos: list[int]
